-- boks for-you foundation
--
-- Everything the ported `for_you` ranking needs that the schema did not hold,
-- plus the two product features it depends on.
--
-- The ranking itself stays in TypeScript (ADR: `docs/decisions/2026-09-12-
-- typescript-ranking-and-attributed-events.md`). This migration only supplies
-- inputs: derived content shape, author follows, and the per-reader state that
-- was previously trapped in `localStorage`.
--
-- Why per-reader state moves to the server: the reading profile drove
-- `fatigue`, `novelty` and `tasteMatch`, so the same person on a second device
-- was ranked as a cold-start reader. It also meant no server-side ranker could
-- ever see what a reader had already read.

-- ------------------------------------------------------------ content shape

-- Splitting an empty string on whitespace yields one empty element, so empty
-- text counted as one word - and therefore as a one-minute boks. Nothing read
-- it closely enough to notice until the reading-shape classifier needed a
-- reliable zero.
create or replace function public.boks_word_count(p_text text)
returns integer
language sql
immutable
as $$
  select coalesce(
    array_length(regexp_split_to_array(nullif(btrim(coalesce(p_text, '')), ''), '\s+'), 1),
    0
  );
$$;

grant execute on function public.boks_word_count(text) to authenticated;

-- Verse reads at a different pace from prose, and a 238 wpm estimate labels a
-- poem as "skipped" almost every time. The form is derived from the text - it
-- is a measurement, never an author's declaration, which is the same rule
-- `minutes` already follows.
create or replace function public.boks_reading_shape(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  v_text text := coalesce(p_text, '');
  v_words integer := public.boks_word_count(v_text);
  v_line_breaks integer := length(v_text) - length(replace(v_text, E'\n', ''));
  v_lines integer;
  v_avg_words numeric;
  v_short_ratio numeric;
begin
  if v_words = 0 then
    return 'unknown';
  end if;

  with lines as (
    select public.boks_word_count(line) as words
    from unnest(string_to_array(v_text, E'\n')) as line
    where btrim(line) <> ''
  )
  select count(*), coalesce(avg(words), 0), coalesce(avg(case when words between 1 and 8 then 1 else 0 end), 0)
  into v_lines, v_avg_words, v_short_ratio
  from lines;

  -- Short lines, many of them, broken often: verse.
  if v_line_breaks >= 3 and v_lines >= 4 and v_avg_words <= 8 and v_short_ratio >= 0.6 then
    return 'verse';
  end if;

  if public.boks_reading_minutes(v_words) <= 2 or v_words <= 300 then
    return 'short_prose';
  end if;

  return 'long_prose';
end;
$$;

grant execute on function public.boks_reading_shape(text) to authenticated;

alter table public.reels
  add column if not exists reading_shape text not null default 'unknown'
    check (reading_shape in ('verse', 'short_prose', 'long_prose', 'unknown')),
  add column if not exists line_break_count integer not null default 0;

create or replace function public.boks_set_reel_word_count()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.word_count := public.boks_word_count(new.text);
  new.minutes := public.boks_reading_minutes(new.word_count);
  new.reading_shape := public.boks_reading_shape(new.text);
  new.line_break_count := length(coalesce(new.text, '')) - length(replace(coalesce(new.text, ''), E'\n', ''));
  -- Handles are stored bare; the '@' belongs to the presentation.
  new.author_handle := ltrim(coalesce(new.author_handle, ''), '@');
  return new;
end;
$$;

drop trigger if exists reels_word_count on public.reels;
create trigger reels_word_count
before insert or update of text, author_handle on public.reels
for each row execute function public.boks_set_reel_word_count();

update public.reels
set
  reading_shape = public.boks_reading_shape(text),
  line_break_count = length(coalesce(text, '')) - length(replace(coalesce(text, ''), E'\n', ''));

-- ----------------------------------------------------------- author follows

create table if not exists public.author_follows (
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  author_user_id   uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (follower_user_id, author_user_id),
  constraint author_follows_not_self check (follower_user_id <> author_user_id)
);

create index if not exists author_follows_author_idx on public.author_follows (author_user_id);

alter table public.author_follows enable row level security;

revoke all on table public.author_follows from anon, authenticated;
grant select on table public.author_follows to authenticated;

drop policy if exists "Readers can read their own follows" on public.author_follows;
create policy "Readers can read their own follows"
on public.author_follows
for select
to authenticated
using (follower_user_id = (select auth.uid()));

-- Anonymous readers are deliberately excluded: a follow is a durable
-- relationship, and an anonymous session is not a durable identity.
create or replace function public.set_author_follow(p_author_user_id uuid, p_following boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_anonymous boolean := coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false);
begin
  if v_uid is null or v_anonymous then
    raise exception 'Sign in to follow an author.' using errcode = '42501';
  end if;
  if p_author_user_id is null then
    raise exception 'An author is required.' using errcode = '22023';
  end if;
  if p_author_user_id = v_uid then
    raise exception 'You cannot follow yourself.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.reels r
    where r.author_user_id = p_author_user_id and r.status = 'published'
  ) then
    raise exception 'That author has nothing published.' using errcode = '22023';
  end if;

  if coalesce(p_following, false) then
    insert into public.author_follows (follower_user_id, author_user_id)
    values (v_uid, p_author_user_id)
    on conflict do nothing;
  else
    delete from public.author_follows
    where follower_user_id = v_uid and author_user_id = p_author_user_id;
  end if;

  return jsonb_build_object(
    'authorUserId', p_author_user_id::text,
    'following', exists (
      select 1 from public.author_follows
      where follower_user_id = v_uid and author_user_id = p_author_user_id
    ),
    'followers', (
      select count(*)::integer from public.author_follows
      where author_user_id = p_author_user_id
    )
  );
end;
$$;

revoke all on function public.set_author_follow(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_author_follow(uuid, boolean) to authenticated;

create or replace function public.get_my_followed_authors()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'authorUserId', f.author_user_id::text,
      'authorName', coalesce(p.display_name, ''),
      'authorHandle', coalesce(p.handle, ''),
      'followedAt', f.created_at,
      'published', (
        select count(*)::integer from public.reels r
        where r.author_user_id = f.author_user_id and r.status = 'published'
      )
    ) order by f.created_at desc)
    from public.author_follows f
    left join public.user_profiles p on p.user_id = f.author_user_id
    where f.follower_user_id = v_uid
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_followed_authors() from public, anon, authenticated;
grant execute on function public.get_my_followed_authors() to authenticated;

-- --------------------------------------------------- candidates for the reader

-- One call returns the corpus, its rollups, the author priors, and the calling
-- reader's own history with each boks. Per-reader state is derived from the
-- event stream rather than stored again: `active_seconds` already rolls up with
-- max(), so a retried or duplicated event costs nothing here either.
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
  v_uid uuid := (select auth.uid());
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
    ),
    author_stats as (
      select
        r.author_user_id,
        count(*)::integer as published,
        (
          select count(*)::integer from public.author_follows f
          where f.author_user_id = r.author_user_id
        ) as followers
      from public.reels r
      where r.status = 'published' and r.author_user_id is not null
      group by r.author_user_id
    ),
    -- The reader's own history with each boks, per (session, boks) so a reader
    -- who returns across sessions accumulates exposure rather than overwriting.
    my_sessions as (
      select
        e.reel_id,
        e.session_id,
        max(e.active_seconds) as dwell_seconds,
        max(e.progress) as progress,
        bool_or(e.event_type = 'skip') as skipped,
        max(e.created_at) as last_event_at,
        count(*)::integer as events
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where v_uid is not null and e.user_id = v_uid and e.surface = 'reader'
      group by e.reel_id, e.session_id
    ),
    my_state as (
      select
        s.reel_id,
        count(*)::integer as seen_count,
        -- A quick skip is a skip that never became reading. It is the closest
        -- honest equivalent of the original's explicit QUICK_SKIP event.
        count(*) filter (where s.skipped and s.dwell_seconds < 5)::integer as quick_skip_count,
        coalesce(sum(s.dwell_seconds), 0)::numeric as total_dwell_seconds,
        coalesce(max(s.progress), 0)::numeric as max_progress,
        coalesce(sum(s.events), 0)::integer as event_count,
        max(s.last_event_at) as last_event_at
      from my_sessions s
      group by s.reel_id
    ),
    my_completions as (
      select e.reel_id, min(e.created_at) as completed_at
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where v_uid is not null and e.user_id = v_uid and e.event_type = 'complete'
      group by e.reel_id
    )
    select jsonb_agg(jsonb_build_object(
      'id', r.id::text,
      'title', r.title,
      'authorName', r.author_name,
      'authorHandle', r.author_handle,
      'authorUserId', coalesce(r.author_user_id::text, ''),
      'hook', r.hook,
      'body', r.text,
      'genre', r.genre,
      'mood', r.mood,
      'minutes', r.minutes,
      'wordCount', coalesce(r.word_count, 0),
      'readingShape', r.reading_shape,
      'lineBreakCount', coalesce(r.line_break_count, 0),
      'createdAt', r.created_at,
      'impressions', coalesce(er.impressions, 0),
      'starts', coalesce(er.starts, 0),
      'completes', coalesce(er.completes, 0),
      'skips', coalesce(er.skips, 0),
      'likes', coalesce(lr.likes, 0),
      'shares', coalesce(er.shares, 0),
      'comments', coalesce(cr.comments, 0),
      'readSecondsTotal', coalesce(er.read_seconds_total, 0),
      'authorPublishedCount', coalesce(ast.published, 0),
      'authorFollowers', coalesce(ast.followers, 0),
      'followingAuthor', r.author_user_id is not null and exists (
        select 1 from public.author_follows f
        where f.follower_user_id = v_uid and f.author_user_id = r.author_user_id
      ),
      'mine', jsonb_build_object(
        'seenCount', coalesce(ms.seen_count, 0),
        'quickSkipCount', coalesce(ms.quick_skip_count, 0),
        'totalDwellSeconds', round(coalesce(ms.total_dwell_seconds, 0))::integer,
        'maxProgress', round(coalesce(ms.max_progress, 0), 3),
        'eventCount', coalesce(ms.event_count, 0),
        'lastEventAt', ms.last_event_at,
        'completedAt', mc.completed_at,
        'liked', exists (
          select 1 from public.likes l where l.reel_id = r.id and l.user_id = v_uid
        ),
        'commented', exists (
          select 1 from public.comments c where c.reel_id = r.id and c.user_id = v_uid
        )
      )
    ) order by r.created_at desc)
    from recent_reels r
    left join event_rollup er on er.reel_id = r.id
    left join like_rollup lr on lr.reel_id = r.id
    left join comment_rollup cr on cr.reel_id = r.id
    left join author_stats ast on ast.author_user_id = r.author_user_id
    left join my_state ms on ms.reel_id = r.id
    left join my_completions mc on mc.reel_id = r.id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_recommendation_candidates(integer) from public, anon;
grant execute on function public.get_recommendation_candidates(integer) to authenticated;

-- ------------------------------------------------------ slate provenance

-- Which retrieval family produced a slot, and why it was placed there. The
-- original ranker returned per-item explanations; storing them makes a served
-- slate auditable rather than merely reproducible.
alter table public.served_feed_item
  add column if not exists candidate_source text,
  add column if not exists explanations jsonb not null default '[]'::jsonb;

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
    feed_id, reel_id, delivered_rank, score, source_ranker_id, source_rank,
    credited_algorithm_id, candidate_source, explanations
  )
  select
    v_feed_id,
    (item ->> 'reelId')::uuid,
    (item ->> 'deliveredRank')::integer,
    nullif(item ->> 'score', '')::numeric,
    nullif(item ->> 'sourceRankerId', ''),
    nullif(item ->> 'sourceRank', '')::integer,
    nullif(item ->> 'creditedAlgorithmId', ''),
    nullif(item ->> 'candidateSource', ''),
    case
      when jsonb_typeof(item -> 'explanations') = 'array' then item -> 'explanations'
      else '[]'::jsonb
    end
  from jsonb_array_elements(p_items) as item
  where (item ->> 'reelId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict do nothing;

  return v_feed_id;
end;
$$;

revoke all on function public.record_served_feed(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_served_feed(jsonb, jsonb) to authenticated;

-- ------------------------------------------------------------- live split

-- `for_you` becomes the product ranker, so it becomes the control: a
-- challenger has to beat what readers actually get.
--
-- The challenger is `completion_first`, not `recency`. That was measured, not
-- chosen: against a cold reader `for_you` and `recency` share 100% of their top
-- ten on this catalog, and 80% even for a reader with two weeks of history -
-- every seeded boks is the same length and no author has published enough to
-- move the cold-start prior, so freshness is most of what either ranker has to
-- work with. `completion_first` shares 30-40%, which is the only live pairing
-- that can currently resolve anything.
--
-- Only the row that was never touched by an operator is moved. An experiment
-- someone deliberately configured is theirs, not this migration's.
update public.recommendation_experiments
set
  control_algorithm_id = 'for_you',
  arms = '[{"algorithmId":"for_you","weight":50},{"algorithmId":"completion_first","weight":50}]'::jsonb
where key = 'boks-feed-v1'
  and is_active
  and updated_by is null;
