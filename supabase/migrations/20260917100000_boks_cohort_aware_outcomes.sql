-- Cohort and tenure on the analysis unit.
--
-- The evaluation is reader-level: `get_reader_outcomes` returns one row per
-- (reader, algorithm, day), and every comparison is computed over those rows.
-- What the rows could not say is *which reader* - a reader who joined this week
-- and one who has been reading for a month were the same kind of observation.
--
-- That is the gap between the evaluation we run and the evaluation we claim.
-- A cohort-aware comparison has to be able to ask whether an arm helps new
-- readers and hurts returning ones, or the reverse, which is exactly the case
-- that a single pooled estimate hides: two real effects of opposite sign
-- average to nothing and the arm looks inert.
--
-- Two fields, both derived from events already stored:
--
--   * `cohortWeek` - the Monday of the week the reader was first seen. The
--     cohort is a property of the reader, fixed for life, so it can group rows
--     across days without the grouping drifting.
--   * `tenureDays` - days between that first sighting and the row's own day.
--     Zero on a reader's first day. This is what separates "new reader
--     behaviour" from "this reader is new", and it is what makes a
--     first-session effect distinguishable from a cohort effect.
--
-- Both are descriptive at the sample sizes this product will have for months.
-- A split halves the readers per arm, and the console says so where it offers
-- one; the fields exist so the question is answerable at all, not so that a
-- subgroup difference can be read as a finding.

create or replace function public.get_reader_outcomes(
  p_days integer default 30,
  p_experiment_key text default ''
)
returns jsonb
language plpgsql
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
    -- A reader's first sighting is taken from their whole history, not from
    -- the window: someone who started in March is not a new reader because
    -- the window opens in September.
    first_seen as (
      select user_id, min(created_at) as first_event_at
      from public.recommendation_events
      where surface = 'reader'
      group by user_id
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
      'cohortWeek', to_char(date_trunc('week', f.first_event_at), 'YYYY-MM-DD'),
      'tenureDays', greatest(0, (c.day::date - date_trunc('day', f.first_event_at)::date))::integer,
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
    left join first_seen f on f.user_id = c.user_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_reader_outcomes(integer, text) from public, anon, authenticated;
grant execute on function public.get_reader_outcomes(integer, text) to authenticated;
