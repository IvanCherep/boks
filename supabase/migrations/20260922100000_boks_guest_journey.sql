-- The part of a guest's visit that decides whether they sign up.
--
-- boks already records reading in detail - every impression, start, skip and
-- finish, per device. What it did not record is the path to an account: where
-- a visitor came from, when they were asked to sign up and why, and whether
-- they asked for a link. The founder's question - "we can bring people, and
-- none of them register; why?" - cannot be answered from reading events alone,
-- because the moment that matters is not a reading moment.
--
-- Three events, kept apart from `recommendation_events` because those feed the
-- ranker's rollups and these are about the funnel, not about any bok:
--
--   visit           once per session, with the landing (home, or a shared bok
--                   link) and whatever the URL and referrer say about the source
--   signup_prompt   the account panel opened for a guest, and why - the
--                   15-bok limit, a like, a follow, a comment, the guest
--                   notice, or the reader tapping the account button
--   signup_request  the guest asked for a sign-in link, with the same reason
--
-- An account being created is not an event here: it is already a fact in
-- `auth.users`, and the device id (`visitor_id`, which survives sign-up) is
-- what ties a guest to the account they became. Measured before this
-- migration: every one of 492 reader events carried a visitor id, and two
-- devices already showed a guest turning into an account.

create table if not exists public.boks_journey_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  visitor_id text,
  session_id text,
  event text not null,
  reason text,
  landing text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now(),
  constraint boks_journey_event_kind check (event in ('visit', 'signup_prompt', 'signup_request'))
);

comment on table public.boks_journey_events is
  'How visitors arrive and how they meet the sign-up: visits with their source, sign-up prompts with their reason, link requests. Written only through record_boks_journey_event; read only by admins through get_guest_funnel.';

create index if not exists boks_journey_events_created_at_idx on public.boks_journey_events (created_at desc);
create index if not exists boks_journey_events_visitor_idx on public.boks_journey_events (visitor_id);

alter table public.boks_journey_events enable row level security;
revoke all on table public.boks_journey_events from anon, authenticated;


create or replace function public.record_boks_journey_event(
  p_event text,
  p_visitor_id text default null,
  p_session_id text default null,
  p_reason text default null,
  p_landing text default null,
  p_referrer_host text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null
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
  v_recent integer;
begin
  if v_event not in ('visit', 'signup_prompt', 'signup_request') then
    return;
  end if;

  -- One visit per session: a reload is not a second arrival.
  if v_event = 'visit' and v_session is not null and exists (
    select 1 from public.boks_journey_events j
    where j.event = 'visit' and j.session_id = v_session
  ) then
    return;
  end if;

  -- Cheap insurance against a loop in a client: a person does not open the
  -- sign-up panel sixty times an hour.
  select count(*) into v_recent
  from public.boks_journey_events j
  where j.created_at > now() - interval '1 hour'
    and ((v_visitor is not null and j.visitor_id = v_visitor) or (v_uid is not null and j.user_id = v_uid));
  if v_recent >= 60 then
    return;
  end if;

  insert into public.boks_journey_events (
    user_id, visitor_id, session_id, event, reason, landing,
    referrer_host, utm_source, utm_medium, utm_campaign
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
    left(nullif(btrim(coalesce(p_utm_campaign, '')), ''), 120)
  );
end;
$$;

comment on function public.record_boks_journey_event(text, text, text, text, text, text, text, text, text) is
  'Records one step of a visitor''s path to an account. Open to guests, silent on anything it does not recognise: analytics must never be the reason a page fails.';

revoke all on function public.record_boks_journey_event(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.record_boks_journey_event(text, text, text, text, text, text, text, text, text) to anon, authenticated;


-- The guest funnel, for the admin console.
--
-- The unit is the **device** (`visitor_id`), not the auth user: a guest's
-- anonymous user is left behind when they sign up, while the device id carries
-- across, so a device that has both an anonymous and a real account in its
-- history is a guest who converted. Counting anonymous users instead would
-- count every cleared browser as a new person and never see a conversion.
create or replace function public.get_guest_funnel(p_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 90);
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with reading as (
      select e.visitor_id, e.user_id, e.session_id, e.reel_id, e.event_type, e.active_seconds, e.created_at,
             coalesce(u.is_anonymous, true) as anonymous
      from public.recommendation_events e
      left join auth.users u on u.id = e.user_id
      where e.surface = 'reader' and e.visitor_id is not null and e.created_at >= v_since
    ),
    journey as (
      select j.*, coalesce(u.is_anonymous, true) as anonymous
      from public.boks_journey_events j
      left join auth.users u on u.id = j.user_id
      where j.visitor_id is not null and j.created_at >= v_since
    ),
    -- Reading time per (session, bok) is cumulative, so the maximum is the
    -- time; summing heartbeats would count it several times over.
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
    days as (
      select generate_series(v_since, date_trunc('day', now()), interval '1 day') as day
    )
    select jsonb_build_object(
      'days', v_days,
      'since', v_since,
      -- Before this date nothing about sign-up prompts or requests was
      -- recorded, so those steps of the funnel undercount for earlier days.
      'journeySince', (select min(created_at) from public.boks_journey_events),
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
          'newAccounts', (
            select count(*) from auth.users u
            where not coalesce(u.is_anonymous, false) and date_trunc('day', u.created_at) = d.day
          )
        ) order by d.day desc)
        from days d
      ), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.get_guest_funnel(integer) is
  'Guests, counted by device: how they arrive, how far they read, where they meet the sign-up and whether they cross it. Admin-only.';

revoke all on function public.get_guest_funnel(integer) from public, anon, authenticated;
grant execute on function public.get_guest_funnel(integer) to authenticated;
