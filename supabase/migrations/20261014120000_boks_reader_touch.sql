-- Whether guests touch a bok at all.
--
-- The Guests tab could say that people arrived and that almost none finished
-- a bok, and nothing in between: `start` is a timer (2.6 s on a bok), not a
-- reader doing anything. Was the page dead to them, or did they tap, scroll
-- and swipe and simply not stay?
--
-- `touch` is the first time a hand meets a bok - a tap, a scroll into the
-- text, a swipe, a key - recorded once per bok and session with that first
-- `kind` in its metadata. Swipes to another bok were already recorded, in the
-- `from` of the outcome of the bok left behind, so that half of the answer
-- reaches back before this migration; taps and scrolls start today.
--
-- The event list and the table's CHECK change together: `checks.sql` asserts
-- they are equal, because the two once drifted and a month of aftertaste
-- events was dropped.

create or replace function public.boks_recommendation_event_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'impression', 'start', 'complete', 'like', 'share', 'skip',
    'comment', 'publish', 'preference', 'heartbeat', 'aftertaste', 'touch'
  ]::text[];
$$;

revoke all on function public.boks_recommendation_event_types() from public, anon, authenticated;

alter table public.recommendation_events
  drop constraint if exists recommendation_events_event_type_check;

alter table public.recommendation_events
  add constraint recommendation_events_event_type_check
  check (event_type in (
    'impression', 'start', 'complete', 'like', 'share', 'skip',
    'comment', 'publish', 'preference', 'heartbeat', 'aftertaste', 'touch'
  ));

-- The guest funnel, as in 20261005112000, with `hands`: of the guest devices
-- that were shown a bok, how many touched one, tapped, scrolled, swiped.
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

