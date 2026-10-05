-- Admin numbers that disagreed with their own definitions.
--
-- 1. The recommendation lab counted every assignment and every event, whatever
--    experiment they belonged to. A reader with rows under two keys - or under
--    a key any client could invent before `20261005110000` - was counted
--    twice. Assignments are now read for the active experiment only, and
--    events for it (or for none, which is how events recorded before keys
--    existed look).
--
-- 2. Session-level figures grouped by `(session_id, reel_id)` without the
--    reader. `session_id` defaults to '', so every event recorded without one
--    - from different readers - collapsed into a single "session". The
--    overview's reads, outcomes, completions and sessions, and the slate
--    position dwell, now group by reader as well, and '' is not a session.
--
-- 3. The overview's catalogue share counted all-time impressions of boks that
--    are no longer published against today's published count, so it could
--    pass 100%. Only boks published today count now.
--
-- 4. "Today" for the author limit and the guest funnel was the database
--    session's day: `date_trunc('day', timezone('utc', now()))` compares a
--    timestamp without time zone to a timestamptz, which is UTC only while the
--    server's zone is. Both now cut the day explicitly in UTC, and the quota's
--    `resetsAt` is a timestamptz, so it reaches the browser with its offset
--    instead of being read as local time.
--
-- 5. The guest funnel took `visitor_id is not null` to mean "has a device",
--    but on `recommendation_events` the column is NOT NULL DEFAULT '': every
--    event without a device id was one shared "device". '' is now no device.
--
-- 6. `minimum_impressions_per_arm` has been read as readers per arm by the lab
--    (which hard-coded 10 and ignored the column). The console now uses the
--    column for that, so its value becomes readers: the untouched default of
--    40 impressions becomes 10 readers, and new experiments default to 10 with
--    a floor of 2. The column keeps its name so nothing that reads it breaks.

create or replace function public.get_recommendation_lab(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_key text := (select x.key from public.recommendation_experiments x where x.is_active limit 1);
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
        where v_key is null or experiment_key = v_key
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
          and (v_key is null or e.experiment_key in (v_key, ''))
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
          and (v_key is null or e.experiment_key in (v_key, ''))
        group by e.algorithm_id, r.id, r.title
        having count(*) filter (where e.event_type = 'start') > 0
        order by count(*) filter (where e.event_type = 'complete') desc
        limit 40
      ) story_rows
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.get_boks_overview(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- '' is the column default, not a session: every event recorded without
      -- one would otherwise be a single session shared by all those readers.
      select e.*, nullif(e.session_id, '') as session_key
      from public.recommendation_events e
      where e.surface = 'reader'
    ),
    -- Reading time is cumulative per (session, boks), so the true total is a
    -- sum over the maximum of each pair, never a sum over every row.
    session_reading as (
      select user_id, session_key, reel_id, max(active_seconds) as active_seconds, max(created_at) as last_seen
      from reader_events
      where created_at >= v_from
      group by user_id, session_key, reel_id
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
      -- Only boks that are published now, measured against the number that
      -- are: an all-time count of since-hidden boks could pass 100%.
      select e.user_id, count(distinct e.reel_id)::numeric as seen
      from reader_events e
      join public.reels r on r.id = e.reel_id and r.status = 'published'
      where e.event_type = 'impression'
      group by e.user_id
    ),
    outcome_pairs as (
      select
        user_id,
        session_key,
        reel_id,
        bool_or(event_type = 'impression') as had_impression,
        bool_or(event_type in ('complete', 'skip')) as had_outcome
      from reader_events
      where created_at >= v_from
      group by user_id, session_key, reel_id
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
        'sessions', (select count(distinct (user_id, session_key))::integer from session_reading where session_key is not null),
        'boksCompleted', (
          select count(distinct (user_id, session_key, reel_id))::integer
          from reader_events where created_at >= v_from and event_type = 'complete'
        ),
        'boksStarted', (
          select count(distinct (user_id, session_key, reel_id))::integer
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
        'sessions', (select count(distinct (user_id, session_key))::integer from session_reading where session_key is not null),
        'sessionsWithoutOutcome', (
          select count(*)::integer from (
            select user_id, session_key from outcome_pairs
            where session_key is not null
            group by user_id, session_key having bool_or(had_outcome) is false
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
$function$;

create or replace function public.get_slate_position_effects(p_days integer DEFAULT 30, p_experiment_key text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      select
        e.*,
        case
          when e.rank is null then null
          when e.rank <= 0 then '1'
          when e.rank = 1 then '2'
          when e.rank = 2 then '3'
          when e.rank between 3 and 4 then '4-5'
          when e.rank between 5 and 9 then '6-10'
          else '11+'
        end as position_bucket,
        case
          when e.rank is null then 99
          when e.rank <= 0 then 1
          when e.rank = 1 then 2
          when e.rank = 2 then 3
          when e.rank between 3 and 4 then 4
          when e.rank between 5 and 9 then 5
          else 6
        end as bucket_order
      from public.recommendation_events e
      where e.surface = 'reader'
        and e.created_at >= v_since
        and e.algorithm_id <> 'unassigned'
        and e.rank is not null
        and (v_key = '' or e.experiment_key = v_key)
    ),
    -- Reading time is cumulative per (session, piece), so it is taken with a
    -- maximum before it is summed - the same rule the reader outcomes use.
    dwell as (
      select algorithm_id, position_bucket, bucket_order, user_id, nullif(session_id, '') as session_key, reel_id,
             max(active_seconds) as active_seconds
      from scoped
      group by algorithm_id, position_bucket, bucket_order, user_id, nullif(session_id, ''), reel_id
    ),
    dwell_rollup as (
      select algorithm_id, position_bucket, bucket_order,
             coalesce(sum(active_seconds), 0)::numeric as active_seconds
      from dwell
      group by algorithm_id, position_bucket, bucket_order
    ),
    counts as (
      select
        algorithm_id,
        position_bucket,
        bucket_order,
        count(distinct user_id)::integer as readers,
        count(*) filter (where event_type = 'impression')::integer as impressions,
        count(*) filter (where event_type = 'start')::integer as starts,
        count(*) filter (where event_type = 'complete')::integer as completes,
        count(*) filter (where event_type = 'skip')::integer as skips,
        count(*) filter (where event_type in ('like', 'share', 'comment'))::integer as reactions
      from scoped
      group by algorithm_id, position_bucket, bucket_order
    )
    select jsonb_agg(jsonb_build_object(
      'algorithmId', c.algorithm_id,
      'position', c.position_bucket,
      'readers', c.readers,
      'impressions', c.impressions,
      'starts', c.starts,
      'completes', c.completes,
      'skips', c.skips,
      'reactions', c.reactions,
      'activeSeconds', round(coalesce(d.active_seconds, 0))::integer
    ) order by c.algorithm_id, c.bucket_order)
    from counts c
    left join dwell_rollup d
      on d.algorithm_id = c.algorithm_id and d.bucket_order = c.bucket_order
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.count_my_boks_submitted_today()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::integer
  from public.reels
  where author_user_id = (select auth.uid())
    and submitted_at >= date_trunc('day', now(), 'UTC');
$function$;

create or replace function public.get_my_bok_quota()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_limit integer := public.boks_daily_submission_limit();
  v_used integer := 0;
begin
  if v_uid is not null and v_is_anonymous is false then
    v_used := public.count_my_boks_submitted_today();
  end if;

  return jsonb_build_object(
    'limit', v_limit,
    'usedToday', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'exhausted', v_used >= v_limit,
    'resetsAt', (date_trunc('day', now(), 'UTC') + interval '1 day')
  );
end;
$function$;

create or replace function public.get_guest_funnel(p_days integer DEFAULT 14, p_include_team boolean DEFAULT false, p_hide_countries text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 90);
  v_since timestamptz := date_trunc('day', now(), 'UTC') - make_interval(days => v_days - 1);
  v_hide text[] := (
    select coalesce(array_agg(distinct upper(btrim(code))), array[]::text[])
    from unnest(coalesce(p_hide_countries, array[]::text[])) code
    where btrim(code) <> ''
  );
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with admins as (
      select p.user_id from public.user_profiles p where p.role = 'admin'
    ),
    -- Every device ever used by an admin, over all time rather than the
    -- window: a developer's phone does not stop being theirs after 14 days.
    team as (
      select distinct e.visitor_id
      from public.recommendation_events e
      where nullif(e.visitor_id, '') is not null and e.user_id in (select user_id from admins)
      union
      select distinct j.visitor_id
      from public.boks_journey_events j
      where j.visitor_id is not null and j.user_id in (select user_id from admins)
      union
      select t.visitor_id from public.boks_team_devices t
    ),
    -- The country a device was last seen from.
    device_country as (
      select distinct on (j.visitor_id) j.visitor_id, j.country
      from public.boks_journey_events j
      where j.visitor_id is not null and j.country is not null
      order by j.visitor_id, j.created_at desc
    ),
    excluded as (
      select visitor_id from team where not coalesce(p_include_team, false)
      union
      select visitor_id from device_country where cardinality(v_hide) > 0 and country = any (v_hide)
    ),
    reading as (
      select e.visitor_id, e.user_id, e.session_id, e.reel_id, e.event_type, e.active_seconds, e.created_at,
             coalesce(u.is_anonymous, true) as anonymous
      from public.recommendation_events e
      left join auth.users u on u.id = e.user_id
      where e.surface = 'reader' and nullif(e.visitor_id, '') is not null and e.created_at >= v_since
        and e.visitor_id not in (select visitor_id from excluded)
    ),
    journey as (
      select j.*, coalesce(u.is_anonymous, true) as anonymous
      from public.boks_journey_events j
      left join auth.users u on u.id = j.user_id
      where j.visitor_id is not null and j.created_at >= v_since
        and j.visitor_id not in (select visitor_id from excluded)
    ),
    dwell as (
      select visitor_id, sum(seconds) as seconds
      from (
        select visitor_id, session_id, reel_id, max(coalesce(active_seconds, 0)) as seconds
        from reading group by 1, 2, 3
      ) per_piece
      group by visitor_id
    ),
    devices as (
      select
        d.visitor_id,
        bool_or(d.anonymous) as was_guest,
        bool_or(not d.anonymous) as has_account,
        min(d.created_at) as first_seen,
        count(distinct date_trunc('day', d.created_at, 'UTC')) as days_active
      from (
        select visitor_id, anonymous, created_at from reading
        union all
        select visitor_id, anonymous, created_at from journey
      ) d
      group by d.visitor_id
    ),
    guest_devices as (
      select
        dv.*,
        coalesce((select count(*) filter (where r.event_type = 'start') from reading r where r.visitor_id = dv.visitor_id and r.anonymous), 0) as starts,
        coalesce((select count(*) filter (where r.event_type = 'complete') from reading r where r.visitor_id = dv.visitor_id and r.anonymous), 0) as completes,
        coalesce((select sum(dw.seconds) from dwell dw where dw.visitor_id = dv.visitor_id), 0) as seconds,
        exists (select 1 from journey j where j.visitor_id = dv.visitor_id and j.event = 'signup_prompt') as prompted,
        exists (select 1 from journey j where j.visitor_id = dv.visitor_id and j.event = 'signup_prompt' and j.reason = 'limit') as hit_limit,
        exists (select 1 from journey j where j.visitor_id = dv.visitor_id and j.event = 'signup_request') as requested
      from devices dv
      where dv.was_guest
    ),
    -- Accounts created in the window that are not the team's: not admins, and
    -- never seen on an excluded device.
    new_accounts as (
      select u.id, u.created_at
      from auth.users u
      where not coalesce(u.is_anonymous, false)
        and u.created_at >= v_since
        and u.id not in (select user_id from admins)
        and not exists (
          select 1 from public.recommendation_events e
          where e.user_id = u.id and e.visitor_id in (select visitor_id from excluded)
        )
    ),
    days as (
      select generate_series(v_since, date_trunc('day', now(), 'UTC'), interval '1 day') as day
    )
    select jsonb_build_object(
      'days', v_days,
      'since', v_since,
      'journeySince', (select min(created_at) from public.boks_journey_events),
      'countriesSince', (select min(created_at) from public.boks_journey_events where country is not null),
      'team', jsonb_build_object(
        'devices', (select count(*) from team),
        'marked', (select count(*) from public.boks_team_devices),
        'included', coalesce(p_include_team, false)
      ),
      'hiddenCountries', to_jsonb(v_hide),
      'funnel', jsonb_build_object(
        'guests', (select count(*) from guest_devices),
        'startedReading', (select count(*) from guest_devices where starts > 0),
        'finishedOne', (select count(*) from guest_devices where completes >= 1),
        'finishedThree', (select count(*) from guest_devices where completes >= 3),
        'cameBack', (select count(*) from guest_devices where days_active >= 2),
        'sawSignup', (select count(*) from guest_devices where prompted),
        'requestedLink', (select count(*) from guest_devices where requested),
        'createdAccount', (select count(*) from guest_devices where has_account)
      ),
      'readsPerGuest', jsonb_build_object(
        'none', (select count(*) from guest_devices where completes = 0),
        'oneOrTwo', (select count(*) from guest_devices where completes between 1 and 2),
        'threeToNine', (select count(*) from guest_devices where completes between 3 and 9),
        'tenToFourteen', (select count(*) from guest_devices where completes between 10 and 14),
        'fifteenPlus', (select count(*) from guest_devices where completes >= 15)
      ),
      'medianGuestMinutes', (
        select round((percentile_cont(0.5) within group (order by seconds) / 60)::numeric, 1)
        from guest_devices where starts > 0
      ),
      'limit', jsonb_build_object(
        'hit', (select count(*) from guest_devices where hit_limit),
        'requested', (select count(*) from guest_devices where hit_limit and requested),
        'converted', (select count(*) from guest_devices where hit_limit and has_account)
      ),
      -- Every device in the window, guests and accounts, by where it was last
      -- seen. Devices from before countries were recorded are "unknown".
      'countries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'country', country, 'devices', devices, 'guests', guests, 'readers', readers, 'accounts', accounts
        ) order by devices desc, country)
        from (
          select
            coalesce(dc.country, 'unknown') as country,
            count(*) as devices,
            count(*) filter (where dv.was_guest) as guests,
            count(*) filter (where exists (
              select 1 from reading r where r.visitor_id = dv.visitor_id and r.event_type = 'complete'
            )) as readers,
            count(*) filter (where dv.has_account) as accounts
          from devices dv
          left join device_country dc on dc.visitor_id = dv.visitor_id
          group by 1
        ) by_country
      ), '[]'::jsonb),
      -- Countries the filter could hide, including those currently hidden, so
      -- the console can offer to show them again.
      'knownCountries', coalesce((
        select jsonb_agg(jsonb_build_object('country', country, 'devices', devices) order by devices desc)
        from (
          select dc.country, count(*) as devices
          from device_country dc
          where dc.visitor_id not in (select visitor_id from team where not coalesce(p_include_team, false))
          group by 1
        ) known
      ), '[]'::jsonb),
      'prompts', coalesce((
        select jsonb_agg(jsonb_build_object('reason', reason, 'prompts', prompts, 'requests', requests) order by prompts desc)
        from (
          select coalesce(j.reason, 'unknown') as reason,
                 count(*) filter (where j.event = 'signup_prompt') as prompts,
                 count(*) filter (where j.event = 'signup_request') as requests
          from journey j where j.anonymous and j.event in ('signup_prompt', 'signup_request')
          group by 1
        ) reasons
      ), '[]'::jsonb),
      'sources', jsonb_build_object(
        'landing', coalesce((
          select jsonb_agg(jsonb_build_object('value', value, 'visits', visits) order by visits desc)
          from (select coalesce(landing, 'home') as value, count(*) as visits from journey where event = 'visit' group by 1) l
        ), '[]'::jsonb),
        'referrer', coalesce((
          select jsonb_agg(jsonb_build_object('value', value, 'visits', visits) order by visits desc)
          from (
            select coalesce(referrer_host, 'direct') as value, count(*) as visits
            from journey where event = 'visit' group by 1 order by 2 desc limit 12
          ) r
        ), '[]'::jsonb),
        'campaign', coalesce((
          select jsonb_agg(jsonb_build_object('value', value, 'visits', visits) order by visits desc)
          from (
            select concat_ws(' / ', utm_source, utm_medium, utm_campaign) as value, count(*) as visits
            from journey where event = 'visit' and utm_source is not null group by 1 order by 2 desc limit 12
          ) c
        ), '[]'::jsonb)
      ),
      'daily', coalesce((
        select jsonb_agg(jsonb_build_object(
          'day', to_char(d.day, 'YYYY-MM-DD'),
          'guests', (select count(distinct r.visitor_id) from reading r where r.anonymous and date_trunc('day', r.created_at, 'UTC') = d.day),
          'newGuests', (select count(*) from guest_devices g where date_trunc('day', g.first_seen, 'UTC') = d.day),
          'readers', (select count(distinct r.visitor_id) from reading r where r.event_type = 'complete' and date_trunc('day', r.created_at, 'UTC') = d.day),
          'prompts', (select count(*) from journey j where j.event = 'signup_prompt' and j.anonymous and date_trunc('day', j.created_at, 'UTC') = d.day),
          'requests', (select count(*) from journey j where j.event = 'signup_request' and date_trunc('day', j.created_at, 'UTC') = d.day),
          'newAccounts', (select count(*) from new_accounts a where date_trunc('day', a.created_at, 'UTC') = d.day)
        ) order by d.day desc)
        from days d
      ), '[]'::jsonb)
    )
  );
end;
$function$;

create or replace function public.save_recommendation_experiment(p_key text, p_control_algorithm_id text, p_arms jsonb, p_minimum_impressions_per_arm integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_key text := coalesce(nullif(btrim(p_key), ''), 'boks-feed-v1');
  v_control text := coalesce(nullif(btrim(p_control_algorithm_id), ''), 'balanced');
  v_minimum integer := least(greatest(coalesce(p_minimum_impressions_per_arm, 10), 2), 100000);
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
$function$;

update public.recommendation_experiments
set minimum_impressions_per_arm = 10
where minimum_impressions_per_arm = 40;

alter table public.recommendation_experiments
  alter column minimum_impressions_per_arm set default 10;

comment on column public.recommendation_experiments.minimum_impressions_per_arm is
  'Readers (not impressions) an arm needs before the lab reads it. Name kept for compatibility.';
