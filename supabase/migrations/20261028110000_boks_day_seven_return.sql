-- Return on day 7.
--
-- The presentation's value proposition and Lean Canvas name it as a key
-- metric beside session satisfaction: of the readers who first read on a given
-- UTC day, how many read again exactly seven days later. The weekly cohort
-- triangle answered a neighbouring question ("in the week after arrival"); this
-- is the number itself, with its denominator. `get_boks_growth` is otherwise
-- unchanged.

create or replace function public.get_boks_growth(p_weeks integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weeks integer := least(greatest(coalesce(p_weeks, 12), 2), 52);
  v_now timestamptz := now();
  v_first_week timestamptz := date_trunc('week', v_now) - make_interval(weeks => v_weeks - 1);
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with reader_events as (
      select user_id, session_id, reel_id, event_type, active_seconds, created_at
      from public.recommendation_events
      where surface = 'reader'
    ),
    -- Reading time is cumulative per (session, boks); the honest total sums the
    -- maximum of each, never every row.
    session_reading as (
      select
        user_id,
        session_id,
        reel_id,
        max(active_seconds) as active_seconds,
        date_trunc('week', min(created_at)) as week_start
      from reader_events
      group by user_id, session_id, reel_id
    ),
    first_seen as (
      select user_id, date_trunc('week', min(created_at)) as cohort_week, min(created_at) as first_at
      from reader_events
      group by user_id
    ),
    weekly_activity as (
      select distinct user_id, date_trunc('week', created_at) as week_start
      from reader_events
    ),
    week_series as (
      select generate_series(v_first_week, date_trunc('week', v_now), interval '1 week') as week_start
    ),
    weekly as (
      select
        w.week_start,
        (select count(*)::integer from weekly_activity a where a.week_start = w.week_start) as active_readers,
        (select count(*)::integer from first_seen f where f.cohort_week = w.week_start) as new_readers,
        (select count(*)::integer from public.user_profiles up where date_trunc('week', up.created_at) = w.week_start) as signups,
        (select count(distinct s.session_id)::integer from session_reading s where s.week_start = w.week_start) as sessions,
        (select coalesce(round(sum(s.active_seconds) / 60.0), 0)::integer from session_reading s where s.week_start = w.week_start) as minutes,
        (select count(*)::integer from reader_events e
          where e.event_type = 'complete' and date_trunc('week', e.created_at) = w.week_start) as boks_finished,
        (select count(*)::integer from public.reels r
          where r.status = 'published' and date_trunc('week', r.created_at) = w.week_start) as boks_published
      from week_series w
    ),
    -- The retention triangle: of the readers who arrived in a given week, how
    -- many were still reading N weeks later.
    cohorts as (
      select cohort_week, count(*)::integer as size
      from first_seen
      where cohort_week >= v_first_week
      group by cohort_week
    ),
    cohort_retention as (
      select
        c.cohort_week,
        c.size,
        (extract(epoch from (a.week_start - c.cohort_week)) / 604800)::integer as week_offset,
        count(distinct a.user_id)::integer as retained
      from cohorts c
      join first_seen f on f.cohort_week = c.cohort_week
      join weekly_activity a on a.user_id = f.user_id and a.week_start >= c.cohort_week
      group by c.cohort_week, c.size, week_offset
    ),
    -- Return on day 7, the presentation's retention metric: of the readers whose
    -- first reading day is at least seven UTC days behind and within the last
    -- 90 days, how many read again on exactly the seventh day after it.
    -- Readers too new to have had a day 7 are not in the denominator.
    first_days as (
      select user_id, (min(created_at) at time zone 'utc')::date as first_day
      from reader_events
      group by user_id
    ),
    day_seven as (
      select
        count(*)::integer as eligible,
        count(*) filter (where exists (
          select 1 from reader_events e
          where e.user_id = d.user_id
            and (e.created_at at time zone 'utc')::date = d.first_day + 7
        ))::integer as returned
      from first_days d
      where d.first_day <= (v_now at time zone 'utc')::date - 7
        and d.first_day > (v_now at time zone 'utc')::date - 90
    ),
    -- Did a new reader get far enough to have an opinion about boks?
    activation as (
      select
        count(*)::integer as new_readers,
        count(*) filter (where finished >= 1)::integer as finished_one,
        count(*) filter (where finished >= 3)::integer as finished_three,
        count(*) filter (where has_account)::integer as signed_up
      from (
        select
          f.user_id,
          (select count(*) from reader_events e where e.user_id = f.user_id and e.event_type = 'complete') as finished,
          exists (select 1 from public.user_profiles up where up.user_id = f.user_id) as has_account
        from first_seen f
        where f.first_at >= v_now - interval '30 days'
      ) new_cohort
    )
    select jsonb_build_object(
      'weeks', v_weeks,
      'weekly', coalesce((
        select jsonb_agg(jsonb_build_object(
          'week', to_char(week_start, 'YYYY-MM-DD'),
          'activeReaders', active_readers,
          'newReaders', new_readers,
          'signups', signups,
          'sessions', sessions,
          'minutes', minutes,
          'boksFinished', boks_finished,
          'boksPublished', boks_published
        ) order by week_start)
        from weekly
      ), '[]'::jsonb),
      'cohorts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'week', to_char(cohort_week, 'YYYY-MM-DD'),
          'size', size,
          'retained', retained_by_offset
        ) order by cohort_week desc)
        from (
          select
            cohort_week,
            max(size) as size,
            jsonb_agg(jsonb_build_object('offset', week_offset, 'readers', retained) order by week_offset) as retained_by_offset
          from cohort_retention
          group by cohort_week
        ) grouped
      ), '[]'::jsonb),
      'daySeven', (select jsonb_build_object('eligible', eligible, 'returned', returned) from day_seven),
      'activation', (
        select jsonb_build_object(
          'newReaders', new_readers,
          'finishedOne', finished_one,
          'finishedThree', finished_three,
          'signedUp', signed_up
        ) from activation
      ),
      -- How often does a reader come back? The ratio of daily to monthly is the
      -- usual shorthand for habit.
      'stickiness', jsonb_build_object(
        'daily', (select count(distinct user_id)::integer from reader_events where created_at >= v_now - interval '1 day'),
        'weekly', (select count(distinct user_id)::integer from reader_events where created_at >= v_now - interval '7 days'),
        'monthly', (select count(distinct user_id)::integer from reader_events where created_at >= v_now - interval '30 days')
      ),
      'totals', jsonb_build_object(
        'readers', (select count(*)::integer from first_seen),
        'accounts', (select count(*)::integer from public.user_profiles),
        'minutes', (select coalesce(round(sum(active_seconds) / 60.0), 0)::integer from session_reading),
        'boksFinished', (select count(*)::integer from reader_events where event_type = 'complete'),
        'publishedBoks', (select count(*)::integer from public.reels where status = 'published')
      )
    )
  );
end;
$$;

revoke all on function public.get_boks_growth(integer) from public, anon, authenticated;
grant execute on function public.get_boks_growth(integer) to authenticated;
