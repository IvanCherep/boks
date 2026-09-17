-- boks growth, cohorts and event-sourced people/content
--
-- The console could describe this week. It could not describe a trajectory,
-- which is the first thing anyone from outside asks: are readers arriving, do
-- they come back, and is the catalog keeping up.
--
-- A note on what is and is not safe to plot over time at this scale. Counts and
-- totals - readers, sessions, minutes, boks published - are honest at any sample
-- size. Rates are not: a finish rate computed from a dozen readers moves several
-- points on one person's behaviour, and a line through those points invites
-- reading a trend that is not there. So this returns weekly COUNTS, and leaves
-- rates to the windows where the denominator is stated next to them.
--
-- This also retires the last metric responsibilities of `get_boks_admin_snapshot`.
-- People and content now come from `recommendation_events` like everything else,
-- so `views` and `likes` are finally product features only.

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

-- ------------------------------------------------------------------- people

create or replace function public.get_boks_people(
  p_limit integer default 100,
  p_offset integer default 0,
  p_query text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := lower(coalesce(p_query, ''));
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with session_reading as (
      select user_id, session_id, reel_id, max(active_seconds) as active_seconds, max(created_at) as last_at
      from public.recommendation_events
      where surface = 'reader'
      group by user_id, session_id, reel_id
    ),
    reader_stats as (
      select
        user_id,
        round(sum(active_seconds) / 60.0)::integer as minutes,
        count(distinct reel_id)::integer as boks_opened,
        count(distinct session_id)::integer as sessions,
        max(last_at) as last_read_at
      from session_reading
      group by user_id
    ),
    finished as (
      select user_id, count(*)::integer as boks_finished
      from public.recommendation_events
      where surface = 'reader' and event_type = 'complete'
      group by user_id
    ),
    people as (
      select
        up.user_id,
        coalesce(au.email, '') as email,
        up.handle,
        up.role,
        up.display_name,
        up.created_at,
        coalesce(au.last_sign_in_at, au.created_at) as last_sign_in_at,
        coalesce(rs.minutes, 0) as minutes,
        coalesce(rs.boks_opened, 0) as boks_opened,
        coalesce(rs.sessions, 0) as sessions,
        coalesce(f.boks_finished, 0) as boks_finished,
        rs.last_read_at,
        (select algorithm_id from public.recommendation_assignments ra where ra.user_id = up.user_id limit 1) as algorithm_id
      from public.user_profiles up
      join auth.users au on au.id = up.user_id
      left join reader_stats rs on rs.user_id = up.user_id
      left join finished f on f.user_id = up.user_id
      where coalesce(au.is_anonymous, false) is false
        and (
          v_query = ''
          or lower(coalesce(au.email, '')) like '%' || v_query || '%'
          or lower(coalesce(up.handle, '')) like '%' || v_query || '%'
          or lower(up.display_name) like '%' || v_query || '%'
        )
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from people),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', user_id::text,
          'email', email,
          'handle', handle,
          'role', role,
          'displayName', display_name,
          'joinedAt', created_at,
          'lastSignInAt', last_sign_in_at,
          'lastReadAt', last_read_at,
          'minutes', minutes,
          'boksOpened', boks_opened,
          'boksFinished', boks_finished,
          'sessions', sessions,
          'algorithmId', algorithm_id
        ) order by minutes desc, created_at desc)
        from (select * from people order by minutes desc, created_at desc limit v_limit offset v_offset) page
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_boks_people(integer, integer, text) from public, anon, authenticated;
grant execute on function public.get_boks_people(integer, integer, text) to authenticated;

-- ------------------------------------------------------------------ content

create or replace function public.get_boks_content(
  p_limit integer default 100,
  p_offset integer default 0,
  p_query text default '',
  p_sort text default 'minutes'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := lower(coalesce(p_query, ''));
  v_sort text := coalesce(nullif(btrim(p_sort), ''), 'minutes');
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with session_reading as (
      select reel_id, session_id, max(active_seconds) as active_seconds
      from public.recommendation_events
      where surface = 'reader'
      group by reel_id, session_id
    ),
    reading as (
      select reel_id, round(sum(active_seconds) / 60.0)::integer as minutes
      from session_reading group by reel_id
    ),
    outcomes as (
      select
        reel_id,
        count(*) filter (where event_type = 'start')::integer as starts,
        count(*) filter (where event_type = 'complete')::integer as completes,
        count(*) filter (where event_type = 'skip')::integer as skips,
        count(distinct user_id)::integer as readers
      from public.recommendation_events
      where surface = 'reader'
      group by reel_id
    ),
    likes as (select reel_id, count(*)::integer as likes from public.likes group by reel_id),
    comments as (select reel_id, count(*)::integer as comments from public.comments group by reel_id),
    rows as (
      select
        r.id, r.title, r.author_name, r.author_handle, r.genre, r.mood, r.minutes as estimated_minutes,
        r.word_count, r.created_at,
        coalesce(rd.minutes, 0) as minutes,
        coalesce(o.readers, 0) as readers,
        coalesce(o.starts, 0) as starts,
        coalesce(o.completes, 0) as completes,
        coalesce(o.skips, 0) as skips,
        coalesce(l.likes, 0) as likes,
        coalesce(c.comments, 0) as comments,
        case when coalesce(o.starts, 0) > 0
          then round(coalesce(o.completes, 0) * 100.0 / o.starts)::integer
          else null end as finish_rate
      from public.reels r
      left join reading rd on rd.reel_id = r.id
      left join outcomes o on o.reel_id = r.id
      left join likes l on l.reel_id = r.id
      left join comments c on c.reel_id = r.id
      where r.status = 'published'
        and (
          v_query = ''
          or lower(r.title) like '%' || v_query || '%'
          or lower(r.author_name) like '%' || v_query || '%'
          or lower(r.genre) like '%' || v_query || '%'
          or lower(r.mood) like '%' || v_query || '%'
        )
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from rows),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(page) order by sort_rank)
        from (
          select
            id::text as "id", title, author_name as "authorName", author_handle as "authorHandle",
            genre, mood, estimated_minutes as "estimatedMinutes", word_count as "wordCount",
            minutes, readers, starts, completes, skips, likes, comments,
            finish_rate as "finishRate",
            row_number() over (
              order by
                case when v_sort = 'minutes' then minutes end desc nulls last,
                case when v_sort = 'readers' then readers end desc nulls last,
                case when v_sort = 'finish' then finish_rate end desc nulls last,
                case when v_sort = 'newest' then extract(epoch from created_at) end desc nulls last,
                case when v_sort = 'title' then lower(title) end asc nulls last,
                minutes desc, created_at desc
            ) as sort_rank
          from rows
        ) page
        where sort_rank > v_offset and sort_rank <= v_offset + v_limit
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_boks_content(integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.get_boks_content(integer, integer, text, text) to authenticated;
