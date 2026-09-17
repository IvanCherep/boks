-- boks overview metrics
--
-- The founder's weekly page. Everything here is sourced from
-- `recommendation_events`, never from `views` or `likes` - those stay product
-- features (reading history, like state) and are not metrics. That is the rule
-- that keeps the console from ever again showing two different numbers for the
-- same word.
--
-- Four questions it answers that nothing previously did:
--
--   * Do readers come back? The only number that predicts whether this survives.
--   * Do they read more than one? The whole product thesis, and a mean hides it,
--     so it is reported as a distribution.
--   * Is there enough to read? A feed starves before it mis-ranks.
--   * Can these numbers be trusted? Measured, not assumed - the previous console
--     was confidently wrong for weeks.

create or replace function public.get_boks_overview(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_now timestamptz := now();
  v_from timestamptz := v_now - make_interval(days => v_days);
  v_previous_from timestamptz := v_now - make_interval(days => v_days * 2);
  v_published integer;
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select count(*)::integer into v_published from public.reels where status = 'published';

  return (
    with reader_events as (
      select * from public.recommendation_events where surface = 'reader'
    ),
    -- Reading time is cumulative per (session, boks), so the true total is a
    -- sum over the maximum of each pair, never a sum over every row.
    session_reading as (
      select user_id, session_id, reel_id, max(active_seconds) as active_seconds, max(created_at) as last_seen
      from reader_events
      where created_at >= v_from
      group by user_id, session_id, reel_id
    ),
    current_readers as (
      select distinct user_id from reader_events where created_at >= v_from
    ),
    previous_readers as (
      select distinct user_id from reader_events
      where created_at >= v_previous_from and created_at < v_from
    ),
    first_seen as (
      select user_id, min(created_at) as first_event from reader_events group by user_id
    ),
    reads_per_reader as (
      select
        user_id,
        count(distinct reel_id) filter (where event_type in ('complete', 'start')) as boks
      from reader_events
      where created_at >= v_from
      group by user_id
    ),
    catalog_seen as (
      select user_id, count(distinct reel_id)::numeric as seen
      from reader_events
      where event_type = 'impression'
      group by user_id
    ),
    outcome_pairs as (
      select
        session_id,
        reel_id,
        bool_or(event_type = 'impression') as had_impression,
        bool_or(event_type in ('complete', 'skip')) as had_outcome
      from reader_events
      where created_at >= v_from
      group by session_id, reel_id
    ),
    review_times as (
      select extract(epoch from (reviewed_at - submitted_at)) / 3600.0 as hours
      from public.reels
      where reviewed_at is not null and submitted_at is not null
    )
    select jsonb_build_object(
      'windowDays', v_days,
      'readers', jsonb_build_object(
        'active', (select count(*)::integer from current_readers),
        'previousActive', (select count(*)::integer from previous_readers),
        'returning', (
          select count(*)::integer from current_readers c
          where exists (select 1 from previous_readers p where p.user_id = c.user_id)
        ),
        'new', (
          select count(*)::integer from first_seen where first_event >= v_from
        )
      ),
      'reading', jsonb_build_object(
        'activeSeconds', (select coalesce(sum(active_seconds), 0)::integer from session_reading),
        'sessions', (select count(distinct session_id)::integer from session_reading),
        'boksCompleted', (
          select count(distinct (session_id, reel_id))::integer
          from reader_events where created_at >= v_from and event_type = 'complete'
        ),
        'boksStarted', (
          select count(distinct (session_id, reel_id))::integer
          from reader_events where created_at >= v_from and event_type = 'start'
        )
      ),
      -- A distribution, not a mean. "Do people read more than one" is the whole
      -- thesis, and an average hides a split between one-and-done and regulars.
      'readsPerReader', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket, 'readers', readers) order by sort_order)
        from (
          select
            case
              when boks <= 1 then '1'
              when boks <= 4 then '2-4'
              when boks <= 9 then '5-9'
              else '10+'
            end as bucket,
            case
              when boks <= 1 then 1
              when boks <= 4 then 2
              when boks <= 9 then 3
              else 4
            end as sort_order,
            count(*)::integer as readers
          from reads_per_reader
          where boks > 0
          group by 1, 2
        ) buckets
      ), '[]'::jsonb),
      'supply', jsonb_build_object(
        'submitted', (select count(*)::integer from public.reels where submitted_at >= v_from),
        'approved', (select count(*)::integer from public.reels where reviewed_at >= v_from and status = 'published'),
        'refused', (select count(*)::integer from public.reels where reviewed_at >= v_from and status = 'rejected'),
        'pending', (select count(*)::integer from public.reels where status = 'pending_review'),
        'activeAuthors', (
          select count(distinct author_user_id)::integer from public.reels
          where author_user_id is not null and submitted_at >= v_now - interval '30 days'
        ),
        'medianReviewHours', coalesce((
          select round(percentile_cont(0.5) within group (order by hours)::numeric, 1) from review_times
        ), 0)
      ),
      'catalog', jsonb_build_object(
        'published', v_published,
        'publishedRecently', (
          select count(*)::integer from public.reels
          where status = 'published' and created_at >= v_now - interval '30 days'
        ),
        -- A reader who has seen most of the catalog has nothing left to be
        -- recommended, which is a churn risk and makes ranking meaningless.
        'readersPastHalf', case
          when v_published = 0 then 0
          else (select count(*)::integer from catalog_seen where seen / v_published > 0.5)
        end,
        'medianSeenShare', case
          when v_published = 0 then 0
          else coalesce((
            select round(percentile_cont(0.5) within group (order by seen / v_published) * 100)
            from catalog_seen
          ), 0)
        end
      ),
      -- Measured, not assumed. The previous console was confidently wrong for
      -- weeks because nothing checked whether its inputs made sense.
      'dataQuality', jsonb_build_object(
        'reads', (select count(*)::integer from outcome_pairs where had_impression),
        'readsWithOutcome', (select count(*)::integer from outcome_pairs where had_impression and had_outcome),
        'sessions', (select count(distinct session_id)::integer from session_reading),
        'sessionsWithoutOutcome', (
          select count(*)::integer from (
            select session_id from outcome_pairs group by session_id having bool_or(had_outcome) is false
          ) quiet_sessions
        ),
        'unattributedEvents', (
          select count(*)::integer from reader_events
          where created_at >= v_from and algorithm_id = 'unassigned'
        ),
        'outcomesWithoutTime', (
          select count(*)::integer from reader_events
          where created_at >= v_from and event_type in ('complete', 'skip') and active_seconds = 0
        )
      )
    )
  );
end;
$$;

revoke all on function public.get_boks_overview(integer) from public, anon, authenticated;
grant execute on function public.get_boks_overview(integer) to authenticated;
