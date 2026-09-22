-- Where visitors are, and which of them are us.
--
-- Two questions the Guests tab could not answer. Where the audience is - which
-- decides which languages boks should read in next. And which visitors are the
-- team: two developers in Serbia test the product every day, and at 1-5 real
-- new visitors a day a developer's private window is indistinguishable from a
-- stranger, so the funnel could be half ourselves without saying so.
--
-- **Country** comes from Cloudflare, which adds `CF-IPCountry` to every request
-- it hands the Worker; `/api/geo` returns the two-letter code and the client
-- attaches it to the visit. The IP address is never read or stored. Verified
-- before building on it: the probe answered `RS` from the developers' network.
--
-- **Team devices** are recognised two ways. Automatically: any device that has
-- ever been used by an admin account is the team's, including everything it did
-- as a guest before the admin signed in on it. And by hand, in
-- `boks_team_devices`, for a device the team uses without ever signing in. What
-- neither can catch - a private window, a cleared browser - is what hiding a
-- country is for.

alter table public.boks_journey_events add column if not exists country text;

-- Replaced rather than overloaded: two functions with the same named
-- parameters would make every existing call ambiguous, and the tabs already
-- open in readers' browsers call it by name without `p_country`.
drop function if exists public.record_boks_journey_event(text, text, text, text, text, text, text, text, text);

create or replace function public.record_boks_journey_event(
  p_event text,
  p_visitor_id text default null,
  p_session_id text default null,
  p_reason text default null,
  p_landing text default null,
  p_referrer_host text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_country text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event text := lower(btrim(coalesce(p_event, '')));
  v_visitor text := left(nullif(btrim(coalesce(p_visitor_id, '')), ''), 120);
  v_session text := left(nullif(btrim(coalesce(p_session_id, '')), ''), 120);
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_recent integer;
begin
  if v_event not in ('visit', 'signup_prompt', 'signup_request') then
    return;
  end if;

  -- Two letters or nothing: a country code this function did not get from
  -- Cloudflare is not worth storing.
  if v_country !~ '^[A-Z]{2}$' or v_country in ('XX', 'T1') then
    v_country := null;
  end if;

  if v_event = 'visit' and v_session is not null and exists (
    select 1 from public.boks_journey_events j
    where j.event = 'visit' and j.session_id = v_session
  ) then
    return;
  end if;

  select count(*) into v_recent
  from public.boks_journey_events j
  where j.created_at > now() - interval '1 hour'
    and ((v_visitor is not null and j.visitor_id = v_visitor) or (v_uid is not null and j.user_id = v_uid));
  if v_recent >= 60 then
    return;
  end if;

  insert into public.boks_journey_events (
    user_id, visitor_id, session_id, event, reason, landing,
    referrer_host, utm_source, utm_medium, utm_campaign, country
  )
  values (
    v_uid,
    v_visitor,
    v_session,
    v_event,
    left(nullif(lower(btrim(coalesce(p_reason, ''))), ''), 40),
    left(nullif(lower(btrim(coalesce(p_landing, ''))), ''), 40),
    left(nullif(lower(btrim(coalesce(p_referrer_host, ''))), ''), 120),
    left(nullif(btrim(coalesce(p_utm_source, '')), ''), 120),
    left(nullif(btrim(coalesce(p_utm_medium, '')), ''), 120),
    left(nullif(btrim(coalesce(p_utm_campaign, '')), ''), 120),
    v_country
  );
end;
$$;

revoke all on function public.record_boks_journey_event(text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.record_boks_journey_event(text, text, text, text, text, text, text, text, text, text) to anon, authenticated;


create table if not exists public.boks_team_devices (
  visitor_id text primary key,
  label text,
  marked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.boks_team_devices is
  'Devices the team marked as its own, kept out of the Guests funnel. Devices ever used by an admin account are excluded without being listed here.';

alter table public.boks_team_devices enable row level security;
revoke all on table public.boks_team_devices from anon, authenticated;

create or replace function public.mark_team_device(p_visitor_id text, p_label text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visitor text := left(nullif(btrim(coalesce(p_visitor_id, '')), ''), 120);
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if v_visitor is null then
    raise exception 'A device id is required.' using errcode = '22023';
  end if;
  insert into public.boks_team_devices (visitor_id, label, marked_by)
  values (v_visitor, left(nullif(btrim(coalesce(p_label, '')), ''), 80), (select auth.uid()))
  on conflict (visitor_id) do update set label = excluded.label;
end;
$$;

create or replace function public.unmark_team_device(p_visitor_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  delete from public.boks_team_devices where visitor_id = p_visitor_id;
end;
$$;

revoke all on function public.mark_team_device(text, text) from public, anon, authenticated;
grant execute on function public.mark_team_device(text, text) to authenticated;
revoke all on function public.unmark_team_device(text) from public, anon, authenticated;
grant execute on function public.unmark_team_device(text) to authenticated;


-- The funnel again, now able to leave the team out and to hide countries.
-- Replaced, not overloaded, for the same reason as above.
drop function if exists public.get_guest_funnel(integer);

create or replace function public.get_guest_funnel(
  p_days integer default 14,
  p_include_team boolean default false,
  p_hide_countries text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 90);
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
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
      where e.visitor_id is not null and e.user_id in (select user_id from admins)
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
      where e.surface = 'reader' and e.visitor_id is not null and e.created_at >= v_since
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
        count(distinct date_trunc('day', d.created_at)) as days_active
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
      select generate_series(v_since, date_trunc('day', now()), interval '1 day') as day
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
          'guests', (select count(distinct r.visitor_id) from reading r where r.anonymous and date_trunc('day', r.created_at) = d.day),
          'newGuests', (select count(*) from guest_devices g where date_trunc('day', g.first_seen) = d.day),
          'readers', (select count(distinct r.visitor_id) from reading r where r.event_type = 'complete' and date_trunc('day', r.created_at) = d.day),
          'prompts', (select count(*) from journey j where j.event = 'signup_prompt' and j.anonymous and date_trunc('day', j.created_at) = d.day),
          'requests', (select count(*) from journey j where j.event = 'signup_request' and date_trunc('day', j.created_at) = d.day),
          'newAccounts', (select count(*) from new_accounts a where date_trunc('day', a.created_at) = d.day)
        ) order by d.day desc)
        from days d
      ), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.get_guest_funnel(integer, boolean, text[]) is
  'Guests, counted by device, with the team left out unless asked and any countries hidden on request. Admin-only.';

revoke all on function public.get_guest_funnel(integer, boolean, text[]) from public, anon, authenticated;
grant execute on function public.get_guest_funnel(integer, boolean, text[]) to authenticated;


-- Team devices, for the console to list and unmark.
create or replace function public.list_team_devices()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('visitorId', visitor_id, 'label', label, 'createdAt', created_at) order by created_at desc)
    from public.boks_team_devices
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_team_devices() from public, anon, authenticated;
grant execute on function public.list_team_devices() to authenticated;
