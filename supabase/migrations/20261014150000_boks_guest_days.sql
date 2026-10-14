-- The Guests tab, day by day, and one day opened up.
--
-- The day-by-day table said how many guest devices came and how many finished
-- a bok - and on most days that is "17, 0", which says nothing about why. Each
-- day now also says how many were shown a bok, touched one, moved on to
-- another, how long the middle one read, and which countries they were in.
--
-- `get_guest_day` opens one day: every device seen that day, where it arrived
-- from, and each bok it was shown - for how long, whether a hand touched it,
-- and how it ended. A device with no country is one the Worker never saw -
-- in practice the local dev server, which writes to the same tables.

-- The guest funnel, as in 20261014120000, with a fuller `daily`.
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
      select e.visitor_id, e.user_id, e.session_id, e.reel_id, e.event_type, e.active_seconds, e.created_at, e.metadata,
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
        exists (select 1 from journey j where j.visitor_id = dv.visitor_id and j.event = 'signup_request') as requested,
        -- What the hand did. A touch is recorded once per bok and session, with
        -- the kind of the first one; leaving a bok by swipe, button or key is
        -- in the outcome's `from`, and has been since long before touches.
        coalesce((select count(distinct (r.session_id, r.reel_id)) from reading r where r.visitor_id = dv.visitor_id and r.anonymous and r.event_type = 'touch'), 0) as boks_touched,
        exists (select 1 from reading r where r.visitor_id = dv.visitor_id and r.anonymous and r.event_type = 'touch' and r.metadata ->> 'kind' = 'tap') as tapped,
        exists (select 1 from reading r where r.visitor_id = dv.visitor_id and r.anonymous and r.event_type = 'touch' and r.metadata ->> 'kind' = 'scroll') as scrolled,
        coalesce((select count(*) from reading r where r.visitor_id = dv.visitor_id and r.anonymous
          and r.event_type in ('complete', 'skip') and r.metadata ->> 'from' in ('swipe', 'button', 'keyboard')), 0) as moves,
        coalesce((select count(distinct (r.session_id, r.reel_id)) from reading r where r.visitor_id = dv.visitor_id and r.anonymous and r.event_type = 'impression'), 0) as boks_shown
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
      'hands', jsonb_build_object(
        'since', (select min(created_at) from public.recommendation_events where event_type = 'touch'),
        'shown', (select count(*) from guest_devices where boks_shown > 0),
        'touched', (select count(*) from guest_devices where boks_touched > 0 or moves > 0),
        'tapped', (select count(*) from guest_devices where tapped),
        'scrolled', (select count(*) from guest_devices where scrolled),
        'swiped', (select count(*) from guest_devices where moves > 0),
        'swipes', (select coalesce(sum(moves), 0) from guest_devices),
        'boksShown', (select coalesce(sum(boks_shown), 0) from guest_devices),
        'boksTouched', (select coalesce(sum(boks_touched), 0) from guest_devices)
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
      -- Per day, every guest device seen that day: was it shown a bok, did it
      -- touch one, did it leave one for another, how long did it read, and
      -- where it was from - the answer to "17 devices and nobody finished",
      -- which is otherwise a single sad number.
      'daily', coalesce((
        select jsonb_agg(jsonb_build_object(
          'day', to_char(d.day, 'YYYY-MM-DD'),
          'guests', (select count(distinct r.visitor_id) from reading r where r.anonymous and date_trunc('day', r.created_at, 'UTC') = d.day),
          'newGuests', (select count(*) from guest_devices g where date_trunc('day', g.first_seen, 'UTC') = d.day),
          'shown', (select count(distinct r.visitor_id) from reading r where r.anonymous and r.event_type = 'impression' and date_trunc('day', r.created_at, 'UTC') = d.day),
          'touched', (select count(distinct r.visitor_id) from reading r where r.anonymous and date_trunc('day', r.created_at, 'UTC') = d.day
            and (r.event_type = 'touch' or (r.event_type in ('complete', 'skip') and r.metadata ->> 'from' in ('swipe', 'button', 'keyboard')))),
          'swiped', (select count(distinct r.visitor_id) from reading r where r.anonymous and date_trunc('day', r.created_at, 'UTC') = d.day
            and r.event_type in ('complete', 'skip') and r.metadata ->> 'from' in ('swipe', 'button', 'keyboard')),
          'readers', (select count(distinct r.visitor_id) from reading r where r.event_type = 'complete' and date_trunc('day', r.created_at, 'UTC') = d.day),
          'medianSeconds', (
            select round(percentile_cont(0.5) within group (order by seconds)::numeric)
            from (
              select visitor_id, sum(seconds) as seconds
              from (
                select r.visitor_id, r.session_id, r.reel_id, max(coalesce(r.active_seconds, 0)) as seconds
                from reading r where r.anonymous and date_trunc('day', r.created_at, 'UTC') = d.day
                group by 1, 2, 3
              ) per_bok
              group by 1
            ) per_device
          ),
          'countries', coalesce((
            select jsonb_agg(jsonb_build_object('country', country, 'devices', devices) order by devices desc, country)
            from (
              select coalesce(dc.country, 'none') as country, count(*) as devices
              from (select distinct r.visitor_id from reading r where r.anonymous and date_trunc('day', r.created_at, 'UTC') = d.day) seen
              left join device_country dc on dc.visitor_id = seen.visitor_id
              group by 1
            ) by_country
          ), '[]'::jsonb),
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



-- One day, device by device. Every device seen that day that is not left out
-- (the team, hidden countries), guests and accounts alike, in the order they
-- first appeared. Capped at 300 devices and 60 boks each: a day bigger than
-- that is a day for a different tool.
create or replace function public.get_guest_day(
  p_day date,
  p_include_team boolean default false,
  p_hide_countries text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := (coalesce(p_day, (now() at time zone 'UTC')::date))::timestamp at time zone 'UTC';
  v_to timestamptz := v_from + interval '1 day';
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with excluded as (
      select x.visitor_id from public.boks_excluded_visitor_devices(p_include_team, p_hide_countries) x
    ),
    reading as (
      select e.visitor_id, e.session_id, e.reel_id, e.event_type, e.active_seconds, e.created_at, e.metadata,
             coalesce(u.is_anonymous, true) as anonymous
      from public.recommendation_events e
      left join auth.users u on u.id = e.user_id
      where e.surface = 'reader' and nullif(e.visitor_id, '') is not null
        and e.created_at >= v_from and e.created_at < v_to
        and e.visitor_id not in (select visitor_id from excluded)
    ),
    journey as (
      select j.*, coalesce(u.is_anonymous, true) as anonymous
      from public.boks_journey_events j
      left join auth.users u on u.id = j.user_id
      where j.visitor_id is not null and j.created_at >= v_from and j.created_at < v_to
        and j.visitor_id not in (select visitor_id from excluded)
    ),
    seen as (
      select visitor_id, min(created_at) as first_at, max(created_at) as last_at,
             bool_or(anonymous) as guest, bool_or(not anonymous) as account
      from (
        select visitor_id, created_at, anonymous from reading
        union all
        select visitor_id, created_at, anonymous from journey
      ) s
      group by 1
      order by 2
      limit 300
    ),
    -- Seen on any earlier day, in either table: a returning device.
    earlier as (
      select s.visitor_id
      from seen s
      where exists (select 1 from public.recommendation_events e where e.visitor_id = s.visitor_id and e.created_at < v_from)
         or exists (select 1 from public.boks_journey_events j where j.visitor_id = s.visitor_id and j.created_at < v_from)
    ),
    country as (
      select distinct on (j.visitor_id) j.visitor_id, j.country
      from public.boks_journey_events j
      where j.visitor_id in (select visitor_id from seen) and j.country is not null and j.created_at < v_to
      order by j.visitor_id, j.created_at desc
    ),
    -- Each bok each device was shown, per session: when, for how long, the
    -- first touch, and how it ended.
    boks as (
      select
        r.visitor_id, r.session_id, r.reel_id,
        min(r.created_at) as at,
        max(coalesce(r.active_seconds, 0)) as seconds,
        (array_agg(r.metadata ->> 'kind' order by r.created_at) filter (where r.event_type = 'touch'))[1] as touch,
        bool_or(r.event_type = 'complete') as finished,
        (array_agg(r.metadata ->> 'from' order by r.created_at) filter (where r.event_type in ('complete', 'skip')))[1] as left_by,
        bool_or(r.event_type = 'like') as liked,
        bool_or(r.event_type = 'share') as shared
      from reading r
      where r.reel_id is not null and r.visitor_id in (select visitor_id from seen)
      group by 1, 2, 3
    )
    select jsonb_build_object(
      'day', to_char(v_from at time zone 'UTC', 'YYYY-MM-DD'),
      'devices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'device', right(s.visitor_id, 6),
          'country', c.country,
          'guest', s.guest,
          'account', s.account,
          'returning', exists (select 1 from earlier x where x.visitor_id = s.visitor_id),
          'firstAt', s.first_at,
          'lastAt', s.last_at,
          'visits', coalesce((
            select jsonb_agg(jsonb_build_object(
              'at', j.created_at,
              'landing', coalesce(j.landing, 'home'),
              'referrer', j.referrer_host,
              'campaign', nullif(concat_ws(' / ', j.utm_source, j.utm_medium, j.utm_campaign), ''),
              'link', coalesce(l.label, j.link_code),
              'bok', lr.title
            ) order by j.created_at)
            from journey j
            left join public.boks_tracked_links l on l.code = j.link_code
            left join public.reels lr on lr.id = j.landing_reel_id
            where j.visitor_id = s.visitor_id and j.event = 'visit'
          ), '[]'::jsonb),
          'prompts', coalesce((
            select jsonb_agg(coalesce(j.reason, 'unknown') order by j.created_at)
            from journey j where j.visitor_id = s.visitor_id and j.event = 'signup_prompt'
          ), '[]'::jsonb),
          'requested', exists (select 1 from journey j where j.visitor_id = s.visitor_id and j.event = 'signup_request'),
          'boks', coalesce((
            select jsonb_agg(jsonb_build_object(
              'title', coalesce(rl.title, 'A removed bok'),
              'at', b.at,
              'seconds', round(b.seconds),
              'touch', b.touch,
              'finished', b.finished,
              'leftBy', b.left_by,
              'liked', b.liked,
              'shared', b.shared
            ) order by b.at)
            from (select * from boks where visitor_id = s.visitor_id order by at limit 60) b
            left join public.reels rl on rl.id = b.reel_id
          ), '[]'::jsonb)
        ) order by s.first_at)
        from seen s
        left join country c on c.visitor_id = s.visitor_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_guest_day(date, boolean, text[]) from public, anon, authenticated;
grant execute on function public.get_guest_day(date, boolean, text[]) to authenticated;
