-- boks feed provenance and reader-level outcomes
--
-- Phase 1 of RECSYS-RESEARCH-IMPLEMENTATION-PLAN.md. Two problems are fixed
-- here, and they are the two that block every scientific claim downstream.
--
-- 1. Nothing recorded what was actually served. Ranking ran in the browser, and
--    only the resulting events were stored. The candidate set, the reader
--    profile and the config are all mutable, so a feed could not be
--    reconstructed afterwards. `served_feed` and `served_feed_item` make a
--    served slate a durable, replayable fact. See docs/adr/ADR-001.
--
-- 2. Comparison statistics aggregated events. Events from one reader are
--    correlated, so 100 impressions from 3 readers is not 100 observations.
--    `get_reader_outcomes` returns one row per (reader, algorithm, day) so that
--    every downstream statistic has the reader as its analysis unit.

-- ------------------------------------------------------------- served feeds

create table if not exists public.served_feed (
  id                   uuid primary key default extensions.gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  session_id           text not null default '',
  served_at            timestamptz not null default now(),

  experiment_key       text not null default '',
  experiment_version   integer not null default 1,
  experiment_mode      text not null default 'single'
                       check (experiment_mode in ('single', 'interleaved')),
  algorithm_id         text,
  algorithm_a_id       text,
  algorithm_b_id       text,
  assignment_source    text not null default 'assigned'
                       check (assignment_source in ('assigned', 'requested', 'fallback')),

  candidate_request_id uuid not null,
  candidate_count      integer not null default 0 check (candidate_count >= 0),
  catalog_size         integer not null default 0 check (catalog_size >= 0),

  -- Which path produced this feed. A degraded feed is recorded and labelled,
  -- never diverted into a second instrumentation regime.
  serving_backend      text not null default 'worker'
                       check (serving_backend in ('worker', 'browser', 'd1_fallback')),
  degraded_mode        boolean not null default false,
  fallback_reason      text,

  signals_version      text not null default 'unknown',
  ranking_version      text not null default 'unknown',
  labeling_version     text not null default 'unknown',
  -- The reader signals the ranking actually saw. Required for replay, because
  -- the profile changes with every read.
  profile_snapshot     jsonb not null default '{}'::jsonb,
  seed                 text not null default '',
  build_id             text,

  constraint served_feed_mode_algorithms check (
    (experiment_mode = 'single' and algorithm_id is not null)
    or (experiment_mode = 'interleaved' and algorithm_a_id is not null and algorithm_b_id is not null)
  )
);

create index if not exists served_feed_user_served_idx on public.served_feed (user_id, served_at desc);
create index if not exists served_feed_experiment_idx on public.served_feed (experiment_key, served_at desc);
create index if not exists served_feed_backend_idx on public.served_feed (serving_backend, served_at desc);

create table if not exists public.served_feed_item (
  feed_id               uuid not null references public.served_feed(id) on delete cascade,
  reel_id               uuid not null references public.reels(id) on delete cascade,
  delivered_rank        integer not null check (delivered_rank >= 0),
  score                 numeric(12, 4),
  -- Interleaving: which ranker drafted this slot, and where it sat in that
  -- ranker's own list. Credit follows the draft, not a re-derivation.
  source_ranker_id      text,
  source_rank           integer check (source_rank is null or source_rank >= 0),
  credited_algorithm_id text,
  primary key (feed_id, delivered_rank),
  constraint served_feed_item_unique_reel unique (feed_id, reel_id)
);

create index if not exists served_feed_item_reel_idx on public.served_feed_item (reel_id);

alter table public.served_feed enable row level security;
alter table public.served_feed_item enable row level security;

revoke all on table public.served_feed from anon, authenticated;
revoke all on table public.served_feed_item from anon, authenticated;
grant select on table public.served_feed to authenticated;
grant select on table public.served_feed_item to authenticated;

drop policy if exists "Readers can read their own served feeds" on public.served_feed;
create policy "Readers can read their own served feeds"
on public.served_feed
for select
to authenticated
using ((select auth.uid()) = user_id or public.is_boks_admin());

drop policy if exists "Readers can read their own served feed items" on public.served_feed_item;
create policy "Readers can read their own served feed items"
on public.served_feed_item
for select
to authenticated
using (
  exists (
    select 1 from public.served_feed f
    where f.id = served_feed_item.feed_id
      and (f.user_id = (select auth.uid()) or public.is_boks_admin())
  )
);

-- ----------------------------------------------------------- event linkage

alter table public.recommendation_events
  add column if not exists feed_id uuid references public.served_feed(id) on delete set null,
  add column if not exists serving_backend text not null default 'unknown',
  add column if not exists labeling_version text not null default 'unknown',
  add column if not exists credited_algorithm_id text;

create index if not exists recommendation_events_feed_idx
  on public.recommendation_events (feed_id);

-- --------------------------------------------------------------- write path

-- Written by whoever served the feed. `serving_backend` records which, so a
-- browser-served or degraded feed is countable rather than indistinguishable.
create or replace function public.record_served_feed(p_feed jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_feed_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required to record a served feed.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Feed items must be a JSON array.' using errcode = '22023';
  end if;

  insert into public.served_feed (
    user_id, session_id, experiment_key, experiment_version, experiment_mode,
    algorithm_id, algorithm_a_id, algorithm_b_id, assignment_source,
    candidate_request_id, candidate_count, catalog_size,
    serving_backend, degraded_mode, fallback_reason,
    signals_version, ranking_version, labeling_version,
    profile_snapshot, seed, build_id
  )
  values (
    v_uid,
    left(coalesce(p_feed ->> 'sessionId', ''), 120),
    left(coalesce(p_feed ->> 'experimentKey', ''), 60),
    greatest(coalesce((p_feed ->> 'experimentVersion')::integer, 1), 1),
    coalesce(nullif(p_feed ->> 'experimentMode', ''), 'single'),
    nullif(p_feed ->> 'algorithmId', ''),
    nullif(p_feed ->> 'algorithmAId', ''),
    nullif(p_feed ->> 'algorithmBId', ''),
    coalesce(nullif(p_feed ->> 'assignmentSource', ''), 'assigned'),
    coalesce(nullif(p_feed ->> 'candidateRequestId', '')::uuid, extensions.gen_random_uuid()),
    greatest(coalesce((p_feed ->> 'candidateCount')::integer, 0), 0),
    greatest(coalesce((p_feed ->> 'catalogSize')::integer, 0), 0),
    coalesce(nullif(p_feed ->> 'servingBackend', ''), 'worker'),
    coalesce((p_feed ->> 'degradedMode')::boolean, false),
    nullif(p_feed ->> 'fallbackReason', ''),
    coalesce(nullif(p_feed ->> 'signalsVersion', ''), 'unknown'),
    coalesce(nullif(p_feed ->> 'rankingVersion', ''), 'unknown'),
    coalesce(nullif(p_feed ->> 'labelingVersion', ''), 'unknown'),
    coalesce(p_feed -> 'profileSnapshot', '{}'::jsonb),
    left(coalesce(p_feed ->> 'seed', ''), 120),
    nullif(p_feed ->> 'buildId', '')
  )
  returning id into v_feed_id;

  insert into public.served_feed_item (
    feed_id, reel_id, delivered_rank, score, source_ranker_id, source_rank, credited_algorithm_id
  )
  select
    v_feed_id,
    (item ->> 'reelId')::uuid,
    (item ->> 'deliveredRank')::integer,
    nullif(item ->> 'score', '')::numeric,
    nullif(item ->> 'sourceRankerId', ''),
    nullif(item ->> 'sourceRank', '')::integer,
    nullif(item ->> 'creditedAlgorithmId', '')
  from jsonb_array_elements(p_items) as item
  where (item ->> 'reelId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict do nothing;

  return v_feed_id;
end;
$$;

revoke all on function public.record_served_feed(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_served_feed(jsonb, jsonb) to authenticated;

-- Events gain provenance. A feed id that does not belong to the caller is
-- dropped rather than trusted, so provenance cannot be forged across readers.
create or replace function public.record_recommendation_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inserted integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required to record reader events.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_events, 'null'::jsonb)) <> 'array' then
    raise exception 'Events must be a JSON array.' using errcode = '22023';
  end if;

  with incoming as (
    select event from jsonb_array_elements(p_events) as event limit 100
  ),
  accepted as (
    insert into public.recommendation_events (
      user_id, reel_id, visitor_id, session_id, event_type, value,
      algorithm_id, experiment_key, user_segment, surface, rank,
      client_elapsed_seconds, active_seconds, progress, estimated_seconds,
      feed_id, serving_backend, labeling_version, credited_algorithm_id, metadata
    )
    select
      v_uid,
      nullif(event ->> 'storyId', '')::uuid,
      left(coalesce(event ->> 'visitorId', ''), 120),
      left(coalesce(event ->> 'sessionId', ''), 120),
      event ->> 'eventType',
      least(greatest(coalesce((event ->> 'value')::numeric, 1), 0), 86400),
      left(coalesce(nullif(btrim(event ->> 'algorithmId'), ''), 'unassigned'), 60),
      left(coalesce(event ->> 'experimentKey', ''), 60),
      left(coalesce(nullif(btrim(event ->> 'userSegment'), ''), 'general'), 40),
      coalesce(nullif(btrim(event ->> 'surface'), ''), 'reader'),
      least(greatest(coalesce((event ->> 'rank')::integer, 0), 0), 10000),
      least(greatest(coalesce((event ->> 'clientElapsedSeconds')::numeric, 0), 0), 86400),
      least(greatest(coalesce((event ->> 'activeSeconds')::numeric, 0), 0), 86400),
      least(greatest(coalesce((event ->> 'progress')::numeric, 0), 0), 1),
      least(greatest(coalesce((event ->> 'estimatedSeconds')::numeric, 0), 0), 86400),
      (
        select f.id from public.served_feed f
        where f.id = nullif(event ->> 'feedId', '')::uuid and f.user_id = v_uid
      ),
      left(coalesce(nullif(btrim(event ->> 'servingBackend'), ''), 'unknown'), 30),
      left(coalesce(nullif(btrim(event ->> 'labelingVersion'), ''), 'unknown'), 30),
      left(nullif(btrim(event ->> 'creditedAlgorithmId'), ''), 60),
      coalesce(event -> 'metadata', '{}'::jsonb)
    from incoming
    where event ->> 'eventType' in
      ('impression', 'start', 'complete', 'like', 'share', 'skip', 'comment', 'publish', 'preference', 'heartbeat')
      and coalesce(event ->> 'surface', 'reader') in ('reader', 'author', 'admin')
      and (event ->> 'storyId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    returning 1
  )
  select count(*)::integer into v_inserted from accepted;

  return v_inserted;
end;
$$;

revoke all on function public.record_recommendation_events(jsonb) from public, anon, authenticated;
grant execute on function public.record_recommendation_events(jsonb) to authenticated;

-- ------------------------------------------------------- reader-level rows

-- One row per (reader, algorithm, day). Every comparison statistic is built on
-- top of this, so no estimator can accidentally treat impressions as
-- independent observations.
--
-- Reading time sums the maximum per (session, boks) because `active_seconds` is
-- cumulative: summing rows would double-count every heartbeat.
create or replace function public.get_reader_outcomes(
  p_days integer default 30,
  p_experiment_key text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_key text := coalesce(nullif(btrim(p_experiment_key), ''), '');
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return coalesce((
    with scoped as (
      select *
      from public.recommendation_events
      where surface = 'reader'
        and created_at >= v_since
        and algorithm_id <> 'unassigned'
        and (v_key = '' or experiment_key = v_key)
    ),
    reading as (
      select
        user_id,
        algorithm_id,
        date_trunc('day', min(created_at)) as day,
        session_id,
        reel_id,
        max(active_seconds) as active_seconds
      from scoped
      group by user_id, algorithm_id, session_id, reel_id
    ),
    reading_rollup as (
      select user_id, algorithm_id, day, sum(active_seconds) as active_seconds,
             count(distinct session_id) as sessions
      from reading
      group by user_id, algorithm_id, day
    ),
    counts as (
      select
        user_id,
        algorithm_id,
        date_trunc('day', created_at) as day,
        count(*) filter (where event_type = 'impression')::integer as impressions,
        count(*) filter (where event_type = 'start')::integer as starts,
        count(*) filter (where event_type = 'complete')::integer as completes,
        count(*) filter (where event_type = 'skip')::integer as skips,
        count(*) filter (where event_type = 'like')::integer as likes,
        count(*) filter (where event_type = 'share')::integer as shares,
        count(*) filter (where event_type = 'comment')::integer as comments,
        count(distinct reel_id)::integer as boks_opened,
        count(*) filter (where feed_id is not null)::integer as attributed_events,
        count(*)::integer as total_events
      from scoped
      group by user_id, algorithm_id, date_trunc('day', created_at)
    )
    select jsonb_agg(jsonb_build_object(
      'userId', c.user_id::text,
      'algorithmId', c.algorithm_id,
      'day', to_char(c.day, 'YYYY-MM-DD'),
      'impressions', c.impressions,
      'starts', c.starts,
      'completes', c.completes,
      'skips', c.skips,
      'likes', c.likes,
      'shares', c.shares,
      'comments', c.comments,
      'boksOpened', c.boks_opened,
      'sessions', coalesce(r.sessions, 0)::integer,
      'activeSeconds', round(coalesce(r.active_seconds, 0))::integer,
      'attributedEvents', c.attributed_events,
      'totalEvents', c.total_events
    ) order by c.day, c.user_id)
    from counts c
    left join reading_rollup r
      on r.user_id = c.user_id and r.algorithm_id = c.algorithm_id and r.day = c.day
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_reader_outcomes(integer, text) from public, anon, authenticated;
grant execute on function public.get_reader_outcomes(integer, text) to authenticated;

-- ------------------------------------------------------------ data quality

-- Every check here answers "can these numbers be trusted", and each one is a
-- condition that used to be invisible.
create or replace function public.get_recommendation_data_quality(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with scoped as (
      select * from public.recommendation_events
      where surface = 'reader' and created_at >= v_since
    )
    select jsonb_build_object(
      'windowDays', v_days,
      'events', (select count(*)::integer from scoped),
      'eventsWithoutFeed', (select count(*)::integer from scoped where feed_id is null),
      'eventsUnattributed', (select count(*)::integer from scoped where algorithm_id = 'unassigned'),
      'feeds', (select count(*)::integer from public.served_feed where served_at >= v_since),
      'feedsByBackend', coalesce((
        select jsonb_object_agg(serving_backend, feeds)
        from (
          select serving_backend, count(*)::integer as feeds
          from public.served_feed where served_at >= v_since group by serving_backend
        ) backends
      ), '{}'::jsonb),
      'degradedFeeds', (
        select count(*)::integer from public.served_feed
        where served_at >= v_since and degraded_mode
      ),
      'emptyFeeds', (
        select count(*)::integer from public.served_feed f
        where f.served_at >= v_since
          and not exists (select 1 from public.served_feed_item i where i.feed_id = f.id)
      ),
      -- The event says one algorithm, the feed it belongs to says another.
      'algorithmMismatch', (
        select count(*)::integer
        from scoped e
        join public.served_feed f on f.id = e.feed_id
        where f.experiment_mode = 'single'
          and f.algorithm_id is not null
          and e.algorithm_id <> f.algorithm_id
      ),
      -- The event claims a slot that was never served in that feed.
      'rankNotInFeed', (
        select count(*)::integer
        from scoped e
        join public.served_feed f on f.id = e.feed_id
        where not exists (
          select 1 from public.served_feed_item i
          where i.feed_id = e.feed_id and i.reel_id = e.reel_id
        )
      ),
      'eventsBeforeFeed', (
        select count(*)::integer
        from scoped e join public.served_feed f on f.id = e.feed_id
        where e.created_at < f.served_at
      ),
      'duplicateOutcomes', (
        select count(*)::integer from (
          select session_id, reel_id
          from scoped
          where event_type in ('complete', 'skip')
          group by session_id, reel_id
          having count(*) > 1
        ) duplicates
      ),
      'clampedReadingTime', (
        select count(*)::integer from scoped where active_seconds >= 86400
      ),
      'outcomesWithoutTime', (
        select count(*)::integer from scoped
        where event_type in ('complete', 'skip') and active_seconds = 0
      ),
      'assignmentsWithoutEvents', (
        select count(*)::integer from public.recommendation_assignments a
        where not exists (select 1 from scoped e where e.user_id = a.user_id)
      ),
      'eventsWithoutAssignment', (
        select count(distinct e.user_id)::integer from scoped e
        where not exists (
          select 1 from public.recommendation_assignments a where a.user_id = e.user_id
        )
      ),
      'labelingVersions', coalesce((
        select jsonb_object_agg(labeling_version, events)
        from (
          select labeling_version, count(*)::integer as events
          from scoped group by labeling_version
        ) versions
      ), '{}'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_recommendation_data_quality(integer) from public, anon, authenticated;
grant execute on function public.get_recommendation_data_quality(integer) to authenticated;
