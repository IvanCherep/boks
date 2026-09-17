-- boks active reading time
--
-- Time on platform is the metric this product lives or dies by, so it has to
-- mean time a person was actually looking at a boks. Three changes make that
-- measurable:
--
--   1. `active_seconds` - foreground-only reading time, measured by the client.
--      It is CUMULATIVE per (session_id, reel_id) and every rollup must use
--      max(), never sum(). That single rule makes the whole pipeline idempotent:
--      a retried batch, a repeated heartbeat and a lost final event all cost
--      nothing instead of double-counting or losing a read.
--   2. `heartbeat` events - so a reader who lingers and then closes the tab
--      still contributes the time they actually spent.
--   3. `progress` as a typed column instead of a key inside metadata, because
--      read-versus-skip inference queries it.
--
-- `reels.word_count` lands here too. `minutes` is ceil(words/220) clamped to
-- 1..15, so it cannot be inverted - any reading-speed or pace figure derived
-- from it is meaningless. The real count is cheap to store and cheap to keep.

alter table public.recommendation_events
  add column if not exists active_seconds numeric(10, 2) not null default 0
    check (active_seconds >= 0 and active_seconds <= 86400),
  add column if not exists progress numeric(4, 3) not null default 0
    check (progress >= 0 and progress <= 1);

alter table public.recommendation_events
  drop constraint if exists recommendation_events_event_type_check;

alter table public.recommendation_events
  add constraint recommendation_events_event_type_check
  check (event_type in (
    'impression', 'start', 'complete', 'like', 'share', 'skip',
    'comment', 'publish', 'preference', 'heartbeat'
  ));

create index if not exists recommendation_events_session_reel_idx
  on public.recommendation_events (session_id, reel_id, event_type);

-- ------------------------------------------------------------- word count

alter table public.reels
  add column if not exists word_count integer not null default 0 check (word_count >= 0);

update public.reels
set word_count = coalesce(array_length(regexp_split_to_array(btrim(text), '\s+'), 1), 0)
where word_count = 0;

create or replace function public.boks_word_count(p_text text)
returns integer
language sql
immutable
as $$
  select coalesce(array_length(regexp_split_to_array(btrim(coalesce(p_text, '')), '\s+'), 1), 0);
$$;

grant execute on function public.boks_word_count(text) to authenticated;

-- ----------------------------------------------------- assignment integrity

alter table public.recommendation_assignments
  add column if not exists switched_at timestamptz,
  add column if not exists previous_algorithm_id text;

-- Returns the stored assignment now, so the caller can tell the difference
-- between "this is your arm" and "this is what I just computed".
drop function if exists public.record_recommendation_assignment(text, text, text, text);

-- The arm used to be overwritten on every feed load from a value the browser
-- recomputed each time, so the table recorded the last page load rather than
-- what the reader was actually served. Once written, an assignment is fixed;
-- only an explicit admin migration may change it, and that is stamped.
create or replace function public.record_recommendation_assignment(
  p_experiment_key text,
  p_algorithm_id text,
  p_user_segment text,
  p_visitor_id text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.recommendation_assignments;
  v_key text := left(coalesce(nullif(btrim(p_experiment_key), ''), 'boks-feed-v1'), 60);
begin
  if v_uid is null then
    return null;
  end if;

  insert into public.recommendation_assignments (user_id, visitor_id, experiment_key, algorithm_id, user_segment)
  values (
    v_uid,
    left(coalesce(p_visitor_id, ''), 120),
    v_key,
    left(coalesce(nullif(btrim(p_algorithm_id), ''), 'unassigned'), 60),
    left(coalesce(nullif(btrim(p_user_segment), ''), 'general'), 40)
  )
  on conflict (user_id, experiment_key) do nothing;

  select * into v_row
  from public.recommendation_assignments
  where user_id = v_uid and experiment_key = v_key;

  return jsonb_build_object(
    'experimentKey', v_row.experiment_key,
    'algorithmId', v_row.algorithm_id,
    'userSegment', v_row.user_segment,
    'assignedAt', v_row.assigned_at,
    'switchedAt', v_row.switched_at,
    'previousAlgorithmId', v_row.previous_algorithm_id
  );
end;
$$;

revoke all on function public.record_recommendation_assignment(text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_recommendation_assignment(text, text, text, text) to authenticated;

create or replace function public.get_my_recommendation_assignment(p_experiment_key text default 'boks-feed-v1')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.recommendation_assignments;
begin
  select * into v_row
  from public.recommendation_assignments
  where user_id = (select auth.uid())
    and experiment_key = coalesce(nullif(btrim(p_experiment_key), ''), 'boks-feed-v1');

  if v_row.user_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'experimentKey', v_row.experiment_key,
    'algorithmId', v_row.algorithm_id,
    'userSegment', v_row.user_segment,
    'assignedAt', v_row.assigned_at,
    'switchedAt', v_row.switched_at,
    'previousAlgorithmId', v_row.previous_algorithm_id
  );
end;
$$;

revoke all on function public.get_my_recommendation_assignment(text) from public, anon, authenticated;
grant execute on function public.get_my_recommendation_assignment(text) to authenticated;

-- Moving readers between algorithms is an operational need, and recording when
-- it happened is what makes a before/after reading possible at all.
create or replace function public.migrate_recommendation_arm(
  p_experiment_key text,
  p_from_algorithm_id text,
  p_to_algorithm_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_moved integer;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if coalesce(btrim(p_to_algorithm_id), '') = '' then
    raise exception 'A destination algorithm is required.' using errcode = '22023';
  end if;

  with moved as (
    update public.recommendation_assignments
    set
      previous_algorithm_id = algorithm_id,
      algorithm_id = left(btrim(p_to_algorithm_id), 60),
      switched_at = now()
    where experiment_key = coalesce(nullif(btrim(p_experiment_key), ''), 'boks-feed-v1')
      and algorithm_id = btrim(p_from_algorithm_id)
    returning 1
  )
  select count(*)::integer into v_moved from moved;

  return v_moved;
end;
$$;

revoke all on function public.migrate_recommendation_arm(text, text, text) from public, anon, authenticated;
grant execute on function public.migrate_recommendation_arm(text, text, text) to authenticated;

-- --------------------------------------------------------- event ingestion

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
      active_seconds,
      progress,
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
      least(greatest(coalesce((event ->> 'activeSeconds')::numeric, 0), 0), 86400),
      least(greatest(coalesce((event ->> 'progress')::numeric, 0), 0), 1),
      least(greatest(coalesce((event ->> 'estimatedSeconds')::numeric, 0), 0), 86400),
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

-- A trigger rather than a change to `submit_bok_for_review`, so the count stays
-- correct whichever path writes a bok - seeding, submission, or a later edit.
create or replace function public.boks_set_reel_word_count()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.word_count := public.boks_word_count(new.text);
  return new;
end;
$$;

drop trigger if exists reels_word_count on public.reels;
create trigger reels_word_count
before insert or update of text on public.reels
for each row execute function public.boks_set_reel_word_count();

-- Candidates carry the real length so the reader can judge a read against the
-- words actually on the page instead of a clamped minute estimate.
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
    -- Reading time is cumulative per (session, boks), so the per-boks total is
    -- a sum over the max of each session, never a sum over every row.
    session_reading as (
      select e.reel_id, e.session_id, max(e.active_seconds) as active_seconds
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where e.created_at >= v_since
      group by e.reel_id, e.session_id
    ),
    reading_rollup as (
      select reel_id, sum(active_seconds)::numeric as read_seconds_total
      from session_reading
      group by reel_id
    ),
    event_rollup as (
      select
        e.reel_id,
        count(*) filter (where e.event_type = 'impression')::integer as impressions,
        count(*) filter (where e.event_type = 'start')::integer as starts,
        count(*) filter (where e.event_type = 'complete')::integer as completes,
        count(*) filter (where e.event_type = 'skip')::integer as skips,
        count(*) filter (where e.event_type = 'share')::integer as shares
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
      'wordCount', r.word_count,
      'createdAt', r.created_at,
      'impressions', coalesce(er.impressions, 0),
      'starts', coalesce(er.starts, 0),
      'completes', coalesce(er.completes, 0),
      'skips', coalesce(er.skips, 0),
      'shares', coalesce(er.shares, 0),
      'likes', coalesce(lr.likes, 0),
      'comments', coalesce(cr.comments, 0),
      'readSecondsTotal', coalesce(rr2.read_seconds_total, 0)
    ) order by r.created_at desc)
    from recent_reels r
    left join event_rollup er on er.reel_id = r.id
    left join reading_rollup rr2 on rr2.reel_id = r.id
    left join like_rollup lr on lr.reel_id = r.id
    left join comment_rollup cr on cr.reel_id = r.id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_recommendation_candidates(integer) from public, anon, authenticated;
grant execute on function public.get_recommendation_candidates(integer) to authenticated;
