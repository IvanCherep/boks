-- boks attributed recommendation experiments
--
-- Before this migration the production Supabase feed served newest-first and
-- recorded only views, so no recommendation strategy could be compared with
-- another. This adds the three pieces that comparison needs:
--
--   1. `recommendation_experiments` - which strategies currently receive traffic.
--      Data, not code, so the founder can change the split from /admin.
--   2. `recommendation_assignments` - which arm each reader is in, recorded once.
--   3. `recommendation_events`      - every behavior signal, attributed to an
--      algorithm, experiment, segment, feed rank and elapsed time.
--
-- Ranking itself stays in TypeScript (`lib/boks/recommendations`) so one
-- strategy implementation serves every backend. The database supplies candidate
-- rollups and returns raw counters; rates and uplift are computed in the app.

-- ---------------------------------------------------------------- experiments

create table if not exists public.recommendation_experiments (
  key text primary key,
  is_active boolean not null default false,
  control_algorithm_id text not null default 'balanced',
  arms jsonb not null default '[]'::jsonb,
  minimum_impressions_per_arm integer not null default 40 check (minimum_impressions_per_arm between 1 and 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create unique index if not exists recommendation_experiments_single_active_idx
  on public.recommendation_experiments (is_active)
  where is_active;

alter table public.recommendation_experiments enable row level security;

revoke all on table public.recommendation_experiments from anon, authenticated;
grant select on table public.recommendation_experiments to authenticated;

drop policy if exists "Readers can read the active experiment" on public.recommendation_experiments;
create policy "Readers can read the active experiment"
on public.recommendation_experiments
for select
to authenticated
using (is_active or public.is_boks_admin());

insert into public.recommendation_experiments (key, is_active, control_algorithm_id, arms, minimum_impressions_per_arm)
values (
  'boks-feed-v1',
  true,
  'balanced',
  -- Two arms, and two that actually differ. Four arms across a few dozen
  -- readers leaves too few per arm to see anything, and two quality rankers
  -- agree on 90-100% of their top ten so they cannot be told apart at all.
  -- `recency` shares ~20%, and asks whether ranking beats chronological.
  -- See `npm run verify:divergence`.
  '[
    {"algorithmId": "balanced", "weight": 50},
    {"algorithmId": "recency", "weight": 50}
  ]'::jsonb,
  40
)
on conflict (key) do nothing;

-- --------------------------------------------------------------- assignments

create table if not exists public.recommendation_assignments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  visitor_id text not null default '',
  experiment_key text not null,
  algorithm_id text not null,
  user_segment text not null default 'general',
  assigned_at timestamptz not null default now(),
  constraint recommendation_assignments_user_experiment_unique unique (user_id, experiment_key)
);

create index if not exists recommendation_assignments_experiment_idx
  on public.recommendation_assignments (experiment_key, algorithm_id);

alter table public.recommendation_assignments enable row level security;

revoke all on table public.recommendation_assignments from anon, authenticated;
grant select on table public.recommendation_assignments to authenticated;

drop policy if exists "Readers can read their own assignment" on public.recommendation_assignments;
create policy "Readers can read their own assignment"
on public.recommendation_assignments
for select
to authenticated
using ((select auth.uid()) = user_id or public.is_boks_admin());

-- -------------------------------------------------------------------- events

create table if not exists public.recommendation_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reel_id uuid references public.reels(id) on delete cascade,
  visitor_id text not null default '',
  session_id text not null default '',
  event_type text not null check (
    event_type in ('impression', 'start', 'complete', 'like', 'share', 'skip', 'comment', 'publish', 'preference')
  ),
  value numeric(10, 2) not null default 1 check (value >= 0 and value <= 86400),
  algorithm_id text not null default 'unassigned',
  experiment_key text not null default '',
  user_segment text not null default 'general',
  surface text not null default 'reader' check (surface in ('reader', 'author', 'admin')),
  rank integer not null default 0 check (rank >= 0 and rank <= 10000),
  client_elapsed_seconds numeric(10, 2) not null default 0 check (client_elapsed_seconds >= 0 and client_elapsed_seconds <= 86400),
  estimated_seconds numeric(10, 2) not null default 0 check (estimated_seconds >= 0 and estimated_seconds <= 86400),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists recommendation_events_algorithm_created_idx
  on public.recommendation_events (algorithm_id, created_at desc);
create index if not exists recommendation_events_created_idx
  on public.recommendation_events (created_at desc);
create index if not exists recommendation_events_reel_type_idx
  on public.recommendation_events (reel_id, event_type);
create index if not exists recommendation_events_user_created_idx
  on public.recommendation_events (user_id, created_at desc);

alter table public.recommendation_events enable row level security;

revoke all on table public.recommendation_events from anon, authenticated;
grant select on table public.recommendation_events to authenticated;

-- Readers never read the event stream; writes go through the batch RPC below so
-- attribution fields cannot be forged one row at a time.
drop policy if exists "Admins can read recommendation events" on public.recommendation_events;
create policy "Admins can read recommendation events"
on public.recommendation_events
for select
to authenticated
using (public.is_boks_admin());

-- ----------------------------------------------------------------- functions

create or replace function public.get_active_recommendation_experiment()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.recommendation_experiments;
begin
  select * into v_row
  from public.recommendation_experiments
  where is_active
  order by updated_at desc
  limit 1;

  if v_row.key is null then
    return jsonb_build_object(
      'key', 'boks-feed-v1',
      'controlAlgorithmId', 'balanced',
      'arms', '[]'::jsonb,
      'minimumImpressionsPerArm', 40,
      'updatedAt', null
    );
  end if;

  return jsonb_build_object(
    'key', v_row.key,
    'controlAlgorithmId', v_row.control_algorithm_id,
    'arms', v_row.arms,
    'minimumImpressionsPerArm', v_row.minimum_impressions_per_arm,
    'updatedAt', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_active_recommendation_experiment() from public, anon, authenticated;
grant execute on function public.get_active_recommendation_experiment() to authenticated;

create or replace function public.save_recommendation_experiment(
  p_key text,
  p_control_algorithm_id text,
  p_arms jsonb,
  p_minimum_impressions_per_arm integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_key text := coalesce(nullif(btrim(p_key), ''), 'boks-feed-v1');
  v_control text := coalesce(nullif(btrim(p_control_algorithm_id), ''), 'balanced');
  v_minimum integer := least(greatest(coalesce(p_minimum_impressions_per_arm, 40), 1), 100000);
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_arms, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_arms) = 0 then
    raise exception 'At least one experiment arm is required.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(p_arms) as arm
    where coalesce((arm ->> 'weight')::numeric, 0) > 0
  ) then
    raise exception 'At least one arm must receive traffic.' using errcode = '22023';
  end if;

  update public.recommendation_experiments
  set is_active = false
  where is_active and key <> v_key;

  insert into public.recommendation_experiments (
    key, is_active, control_algorithm_id, arms, minimum_impressions_per_arm, updated_at, updated_by
  )
  values (v_key, true, left(v_control, 60), p_arms, v_minimum, now(), v_caller)
  on conflict (key) do update
  set
    is_active = true,
    control_algorithm_id = excluded.control_algorithm_id,
    arms = excluded.arms,
    minimum_impressions_per_arm = excluded.minimum_impressions_per_arm,
    updated_at = now(),
    updated_by = excluded.updated_by;

  return public.get_active_recommendation_experiment();
end;
$$;

revoke all on function public.save_recommendation_experiment(text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_recommendation_experiment(text, text, jsonb, integer) to authenticated;

create or replace function public.record_recommendation_assignment(
  p_experiment_key text,
  p_algorithm_id text,
  p_user_segment text,
  p_visitor_id text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return;
  end if;

  insert into public.recommendation_assignments (user_id, visitor_id, experiment_key, algorithm_id, user_segment)
  values (
    v_uid,
    left(coalesce(p_visitor_id, ''), 120),
    left(coalesce(nullif(btrim(p_experiment_key), ''), 'boks-feed-v1'), 60),
    left(coalesce(nullif(btrim(p_algorithm_id), ''), 'unassigned'), 60),
    left(coalesce(nullif(btrim(p_user_segment), ''), 'general'), 40)
  )
  on conflict (user_id, experiment_key) do update
  set
    algorithm_id = excluded.algorithm_id,
    user_segment = excluded.user_segment,
    visitor_id = excluded.visitor_id;
end;
$$;

revoke all on function public.record_recommendation_assignment(text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_recommendation_assignment(text, text, text, text) to authenticated;

-- Batch write so a reading session costs one request instead of one per signal.
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
    select event
    from jsonb_array_elements(p_events) as event
    limit 100
  ),
  accepted as (
    insert into public.recommendation_events (
      user_id,
      reel_id,
      visitor_id,
      session_id,
      event_type,
      value,
      algorithm_id,
      experiment_key,
      user_segment,
      surface,
      rank,
      client_elapsed_seconds,
      estimated_seconds,
      metadata
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
      least(greatest(coalesce((event ->> 'estimatedSeconds')::numeric, 0), 0), 86400),
      coalesce(event -> 'metadata', '{}'::jsonb)
    from incoming
    where event ->> 'eventType' in
      ('impression', 'start', 'complete', 'like', 'share', 'skip', 'comment', 'publish', 'preference')
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

-- Candidate rollups for ranking. Returns counters only: the ranking formula
-- lives in `lib/boks/recommendations` so every backend ranks identically.
create or replace function public.get_recommendation_candidates(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 400);
  v_since timestamptz := now() - interval '60 days';
begin
  return coalesce((
    with recent_reels as (
      select r.*
      from public.reels r
      where r.status = 'published'
      order by r.created_at desc
      limit v_limit
    ),
    event_rollup as (
      select
        e.reel_id,
        count(*) filter (where e.event_type = 'impression')::integer as impressions,
        count(*) filter (where e.event_type = 'start')::integer as starts,
        count(*) filter (where e.event_type = 'complete')::integer as completes,
        count(*) filter (where e.event_type = 'skip')::integer as skips,
        count(*) filter (where e.event_type = 'share')::integer as shares,
        coalesce(sum(e.value) filter (where e.event_type = 'complete'), 0)::numeric as read_seconds_total
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where e.created_at >= v_since
      group by e.reel_id
    ),
    like_rollup as (
      select l.reel_id, count(*)::integer as likes
      from public.likes l
      join recent_reels rr on rr.id = l.reel_id
      group by l.reel_id
    ),
    comment_rollup as (
      select c.reel_id, count(*)::integer as comments
      from public.comments c
      join recent_reels rr on rr.id = c.reel_id
      group by c.reel_id
    )
    select jsonb_agg(jsonb_build_object(
      'id', r.id::text,
      'title', r.title,
      'authorName', r.author_name,
      'authorHandle', r.author_handle,
      'hook', r.hook,
      'body', r.text,
      'genre', r.genre,
      'mood', r.mood,
      'minutes', r.minutes,
      'createdAt', r.created_at,
      'impressions', coalesce(er.impressions, 0),
      'starts', coalesce(er.starts, 0),
      'completes', coalesce(er.completes, 0),
      'skips', coalesce(er.skips, 0),
      'shares', coalesce(er.shares, 0),
      'likes', coalesce(lr.likes, 0),
      'comments', coalesce(cr.comments, 0),
      'readSecondsTotal', coalesce(er.read_seconds_total, 0)
    ) order by r.created_at desc)
    from recent_reels r
    left join event_rollup er on er.reel_id = r.id
    left join like_rollup lr on lr.reel_id = r.id
    left join comment_rollup cr on cr.reel_id = r.id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_recommendation_candidates(integer) from public, anon, authenticated;
grant execute on function public.get_recommendation_candidates(integer) to authenticated;

-- Raw per-algorithm, per-segment, per-day counters. Rates, uplift and
-- confidence are derived in `lib/boks/recommendations/metrics.ts`.
create or replace function public.get_recommendation_lab(p_days integer default 30)
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

  return jsonb_build_object(
    'experiment', public.get_active_recommendation_experiment(),
    'days', v_days,
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'algorithmId', algorithm_id,
        'userSegment', user_segment,
        'readers', readers
      ))
      from (
        select algorithm_id, user_segment, count(*)::integer as readers
        from public.recommendation_assignments
        group by algorithm_id, user_segment
      ) assignment_rows
    ), '[]'::jsonb),
    'counters', coalesce((
      select jsonb_agg(to_jsonb(counter_rows))
      from (
        select
          e.algorithm_id as "algorithmId",
          e.user_segment as "userSegment",
          to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') as day,
          count(distinct e.user_id)::integer as visitors,
          count(*) filter (where e.event_type = 'impression')::integer as impressions,
          count(*) filter (where e.event_type = 'start')::integer as starts,
          count(*) filter (where e.event_type = 'complete')::integer as completes,
          count(*) filter (where e.event_type = 'skip')::integer as skips,
          count(*) filter (where e.event_type = 'like')::integer as likes,
          count(*) filter (where e.event_type = 'share')::integer as shares,
          count(*) filter (where e.event_type = 'comment')::integer as comments,
          coalesce(sum(e.value) filter (where e.event_type = 'complete'), 0)::numeric as "readSecondsTotal",
          coalesce(sum(e.client_elapsed_seconds) filter (where e.event_type = 'like' and e.client_elapsed_seconds > 0), 0)::numeric as "secondsToLikeTotal",
          count(*) filter (where e.event_type = 'like' and e.client_elapsed_seconds > 0)::integer as "secondsToLikeCount",
          coalesce(sum(e.client_elapsed_seconds) filter (where e.event_type = 'comment' and e.client_elapsed_seconds > 0), 0)::numeric as "secondsToCommentTotal",
          count(*) filter (where e.event_type = 'comment' and e.client_elapsed_seconds > 0)::integer as "secondsToCommentCount",
          coalesce(sum(e.rank) filter (where e.event_type = 'start'), 0)::numeric as "startRankTotal",
          count(*) filter (where e.event_type = 'start')::integer as "startRankCount",
          coalesce(sum(e.estimated_seconds / nullif(e.value, 0)) filter (where e.event_type = 'complete' and e.estimated_seconds > 0 and e.value > 0), 0)::numeric as "paceTotal",
          count(*) filter (where e.event_type = 'complete' and e.estimated_seconds > 0 and e.value > 0)::integer as "paceCount"
        from public.recommendation_events e
        where e.created_at >= v_since
          and e.surface = 'reader'
          and e.algorithm_id <> 'unassigned'
        group by e.algorithm_id, e.user_segment, date_trunc('day', e.created_at)
        order by date_trunc('day', e.created_at) asc
      ) counter_rows
    ), '[]'::jsonb),
    'topStories', coalesce((
      select jsonb_agg(to_jsonb(story_rows))
      from (
        select
          e.algorithm_id as "algorithmId",
          r.title,
          r.id::text as "storyId",
          count(*) filter (where e.event_type = 'start')::integer as starts,
          count(*) filter (where e.event_type = 'complete')::integer as completes,
          count(*) filter (where e.event_type = 'like')::integer as likes
        from public.recommendation_events e
        join public.reels r on r.id = e.reel_id
        where e.created_at >= v_since
          and e.surface = 'reader'
          and e.algorithm_id <> 'unassigned'
        group by e.algorithm_id, r.id, r.title
        having count(*) filter (where e.event_type = 'start') > 0
        order by count(*) filter (where e.event_type = 'complete') desc
        limit 40
      ) story_rows
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_recommendation_lab(integer) from public, anon, authenticated;
grant execute on function public.get_recommendation_lab(integer) to authenticated;
