-- Tracked links: which link brought a reader, onto which bok, and what they
-- did next.
--
-- The founder is about to send boks to universities - not the home page, but
-- one bok per place, usually a series piece that fits the department. The
-- Guests tab can already say "a shared bok link, from t.me", and that is not
-- the question. The question is "the link we sent to the philology faculty:
-- did anyone open it, did they read the bok, did they stay for a second one,
-- did they come back". Two things were missing to answer it:
--
-- 1. **Which bok a visit landed on.** `landing = 'shared_bok'` was recorded,
--    the bok itself was not. `landing_reel_id` now is.
-- 2. **Which link it was.** A utm tag is free text anyone can mistype, and two
--    links to the same bok cannot be told apart by the bok. A **tracked link**
--    is a short code an admin creates in the console with a label ("MSU,
--    philology") and, usually, a bok; the link is `/b/<id>?link=<code>` (or
--    `/?link=<code>` for the home page), and the visit carries the code.
--    Only codes that exist are stored, so a hand-typed `?link=` cannot fill
--    the table with noise. An archived link keeps counting: people still tap
--    old links, and their visits are still that link's.
--
-- Outcomes are read from `recommendation_events`, the one source of reader
-- behaviour, for the arriving device from the moment of its first visit
-- through that link. The visit row is written after the identity settles and
-- the country answers, so it can land a second or two *after* the start of the
-- bok it opened; events from the arriving session count whatever their
-- timestamp.

alter table public.boks_journey_events
  add column if not exists landing_reel_id uuid references public.reels(id) on delete set null,
  add column if not exists link_code text;

create index if not exists boks_journey_events_link_visit_idx
  on public.boks_journey_events (link_code, created_at)
  where event = 'visit' and link_code is not null;
create index if not exists boks_journey_events_landing_reel_idx
  on public.boks_journey_events (landing_reel_id)
  where landing_reel_id is not null;

-- What a device did after arriving is looked up by device. Nothing indexed
-- `visitor_id` on the events table; the guest funnel's team lookup benefits too.
create index if not exists recommendation_events_visitor_created_idx
  on public.recommendation_events (visitor_id, created_at);


create table if not exists public.boks_tracked_links (
  code text primary key,
  label text not null,
  reel_id uuid references public.reels(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint boks_tracked_link_code_shape check (code ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  constraint boks_tracked_link_label_present check (btrim(label) <> '' and char_length(label) <= 120)
);

comment on table public.boks_tracked_links is
  'Links an admin made to bring readers to boks, each with a label and usually a bok. Visits through one carry its code in boks_journey_events.link_code. Admin-only through RPCs.';

create index if not exists boks_tracked_links_reel_idx on public.boks_tracked_links (reel_id);
create index if not exists boks_tracked_links_created_by_idx on public.boks_tracked_links (created_by);

alter table public.boks_tracked_links enable row level security;
revoke all on table public.boks_tracked_links from public, anon, authenticated;


-- The recorder again, with the landed bok and the link code. Replaced rather
-- than overloaded, as in `20260922120000`: an overload with the same named
-- parameters makes every call ambiguous. Tabs already open call it without the
-- two new arguments, and the defaults keep them working.
drop function if exists public.record_boks_journey_event(text, text, text, text, text, text, text, text, text, text);

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
  p_country text default null,
  p_landing_bok text default null,
  p_link_code text default null
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
  v_bok_text text := lower(btrim(coalesce(p_landing_bok, '')));
  v_link text := lower(btrim(coalesce(p_link_code, '')));
  v_bok uuid;
  v_recent integer;
begin
  if v_event not in ('visit', 'signup_prompt', 'signup_request') then
    return;
  end if;

  if v_country !~ '^[A-Z]{2}$' or v_country in ('XX', 'T1') then
    v_country := null;
  end if;

  -- Text, not uuid, so a damaged id is dropped here instead of failing the
  -- call: analytics must never be the reason a page fails. Only a bok that
  -- exists is kept.
  if v_event = 'visit' and v_bok_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select r.id into v_bok from public.reels r where r.id = v_bok_text::uuid;
  end if;

  -- Only a code an admin created; anything else is a hand-typed parameter.
  if v_event <> 'visit' or not exists (select 1 from public.boks_tracked_links l where l.code = v_link) then
    v_link := null;
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
    referrer_host, utm_source, utm_medium, utm_campaign, country,
    landing_reel_id, link_code
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
    v_country,
    v_bok,
    v_link
  );
end;
$$;

comment on function public.record_boks_journey_event(text, text, text, text, text, text, text, text, text, text, text, text) is
  'Records one step of a visitor''s path to an account; a visit also carries the bok it landed on and the tracked link it came through. Open to Supabase sessions, silent on anything it does not recognise.';

-- Sessions only, as since `20260925160420`: a bare publishable-key request
-- would write telemetry with no identity behind it.
revoke all on function public.record_boks_journey_event(text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.record_boks_journey_event(text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;


-- Devices left out of visitor numbers: the team, unless asked for, and any
-- hidden country. The same rule the guest funnel applies, in one place for
-- the link report; not callable from the Data API.
create or replace function public.boks_excluded_visitor_devices(
  p_include_team boolean default false,
  p_hide_countries text[] default null
)
returns table (visitor_id text)
language sql
stable
security definer
set search_path = ''
as $$
  with hide as (
    select coalesce(array_agg(distinct upper(btrim(code))), array[]::text[]) as codes
    from unnest(coalesce(p_hide_countries, array[]::text[])) code
    where btrim(code) <> ''
  ),
  admins as (
    select p.user_id from public.user_profiles p where p.role = 'admin'
  ),
  team as (
    select e.visitor_id
    from public.recommendation_events e
    where nullif(e.visitor_id, '') is not null and e.user_id in (select user_id from admins)
    union
    select j.visitor_id
    from public.boks_journey_events j
    where j.visitor_id is not null and j.user_id in (select user_id from admins)
    union
    select t.visitor_id from public.boks_team_devices t
  ),
  device_country as (
    select distinct on (j.visitor_id) j.visitor_id, j.country
    from public.boks_journey_events j
    where j.visitor_id is not null and j.country is not null
    order by j.visitor_id, j.created_at desc
  )
  select t.visitor_id from team t where not coalesce(p_include_team, false)
  union
  select dc.visitor_id from device_country dc, hide h
  where cardinality(h.codes) > 0 and dc.country = any (h.codes)
$$;

revoke all on function public.boks_excluded_visitor_devices(boolean, text[]) from public, anon, authenticated;


-- Making and retiring links, for admins.
create or replace function public.create_tracked_link(
  p_label text,
  p_bok_id text default null,
  p_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_bok_text text := lower(btrim(coalesce(p_bok_id, '')));
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_bok uuid;
  v_title text;
  v_attempt integer := 0;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_label = '' then
    raise exception 'Give the link a name - who it is for.' using errcode = '22023';
  end if;
  if char_length(v_label) > 120 then
    raise exception 'Keep the name under 120 characters.' using errcode = '22023';
  end if;

  if v_bok_text <> '' then
    if v_bok_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'That is not a bok id or a bok link.' using errcode = '22023';
    end if;
    select r.id, r.title into v_bok, v_title
    from public.reels r
    where r.id = v_bok_text::uuid and r.status = 'published';
    if v_bok is null then
      raise exception 'No published bok has that id.' using errcode = '22023';
    end if;
  end if;

  if v_code <> '' then
    if v_code !~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' then
      raise exception 'A code is 1-40 lowercase latin letters, digits and dashes, not starting or ending with a dash.' using errcode = '22023';
    end if;
    if exists (select 1 from public.boks_tracked_links l where l.code = v_code) then
      raise exception 'The code "%" is taken.', v_code using errcode = '23505';
    end if;
  else
    -- Six characters is a short link and a 2-billion space; a collision is
    -- retried rather than assumed impossible.
    loop
      v_attempt := v_attempt + 1;
      v_code := substr(md5(gen_random_uuid()::text), 1, 6);
      exit when not exists (select 1 from public.boks_tracked_links l where l.code = v_code);
      if v_attempt >= 10 then
        raise exception 'Could not find a free code; try again.';
      end if;
    end loop;
  end if;

  insert into public.boks_tracked_links (code, label, reel_id, created_by)
  values (v_code, v_label, v_bok, (select auth.uid()));

  return jsonb_build_object('code', v_code, 'label', v_label, 'bokId', v_bok, 'bokTitle', v_title);
end;
$$;

comment on function public.create_tracked_link(text, text, text) is
  'Creates a tracked link with a label, an optional published bok and an optional code (generated when absent). Admin-only.';

revoke all on function public.create_tracked_link(text, text, text) from public, anon, authenticated;
grant execute on function public.create_tracked_link(text, text, text) to authenticated;


create or replace function public.set_tracked_link_archived(p_code text, p_archived boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  update public.boks_tracked_links
  set archived_at = case when coalesce(p_archived, true) then coalesce(archived_at, now()) else null end
  where code = lower(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'No link has that code.' using errcode = '22023';
  end if;
end;
$$;

comment on function public.set_tracked_link_archived(text, boolean) is
  'Archives or restores a tracked link. An archived link still records visits; it only leaves the console''s main list. Admin-only.';

revoke all on function public.set_tracked_link_archived(text, boolean) from public, anon, authenticated;
grant execute on function public.set_tracked_link_archived(text, boolean) to authenticated;


-- What each link and each landed bok brought, for the console.
--
-- The unit is the arriving **device**, as in the guest funnel. A device is
-- counted once per link, from its first visit through that link in the window;
-- one that arrives through two links is counted under both. Outcomes run from
-- that arrival to now - the window bounds arrivals, not what happened after.
create or replace function public.get_link_attribution(
  p_days integer default 30,
  p_include_team boolean default false,
  p_hide_countries text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := date_trunc('day', now(), 'UTC') - make_interval(days => v_days - 1);
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with excluded as (
      select x.visitor_id from public.boks_excluded_visitor_devices(p_include_team, p_hide_countries) x
    ),
    visits as (
      select j.*, coalesce(u.is_anonymous, true) as anonymous
      from public.boks_journey_events j
      left join auth.users u on u.id = j.user_id
      where j.event = 'visit' and j.visitor_id is not null and j.created_at >= v_since
        and j.visitor_id not in (select visitor_id from excluded)
    ),
    -- One arrival per (key, device): the first. `kind` says what the key is.
    arrivals as (
      select distinct on (kind, key, visitor_id) kind, key, visitor_id, session_id, created_at, anonymous, landing_reel_id
      from (
        select 'link' as kind, v.link_code as key, v.visitor_id, v.session_id, v.created_at, v.anonymous, v.landing_reel_id
        from visits v where v.link_code is not null
        union all
        select 'bok', v.landing_reel_id::text, v.visitor_id, v.session_id, v.created_at, v.anonymous, v.landing_reel_id
        from visits v where v.landing_reel_id is not null
      ) a
      order by kind, key, visitor_id, created_at
    ),
    devices as (
      select visitor_id, min(created_at) as earliest from arrivals group by 1
    ),
    -- Reading by the arriving devices, from their earliest arrival on, with
    -- the slack the arriving session needs (see the header).
    reading as (
      select e.visitor_id, e.user_id, e.session_id, e.reel_id, e.event_type, e.active_seconds, e.created_at,
             e.metadata ->> 'format' as format,
             coalesce(u.is_anonymous, true) as anonymous,
             u.created_at as user_created_at
      from public.recommendation_events e
      join devices d on d.visitor_id = e.visitor_id
      left join auth.users u on u.id = e.user_id
      where e.surface = 'reader' and e.created_at >= d.earliest - interval '1 hour'
    ),
    per_arrival as (
      select
        a.kind, a.key, a.visitor_id, a.anonymous,
        bool_or(r.reel_id = a.landing_reel_id and r.event_type = 'start') as started_landed,
        bool_or(r.reel_id = a.landing_reel_id and r.event_type = 'complete') as finished_landed,
        bool_or(r.reel_id = a.landing_reel_id and r.format is not null) as opened_format,
        count(distinct r.reel_id) filter (
          where r.event_type = 'complete' and r.reel_id is distinct from a.landing_reel_id
        ) as other_finished,
        count(distinct r.reel_id) filter (where r.event_type = 'complete') as finished,
        bool_or(date_trunc('day', r.created_at, 'UTC') > date_trunc('day', a.created_at, 'UTC')) as came_back,
        -- A guest at arrival, later reading on this device as an account that
        -- did not exist yet when they arrived. Signing in to an older account
        -- is not a sign-up.
        bool_or(a.anonymous and not r.anonymous and r.user_created_at >= a.created_at) as created_account
      from arrivals a
      left join reading r
        on r.visitor_id = a.visitor_id
       and (r.session_id = a.session_id or r.created_at >= a.created_at)
      group by a.kind, a.key, a.visitor_id, a.anonymous
    ),
    -- Reading time per (session, bok) is cumulative; the maximum is the time.
    minutes as (
      select a.kind, a.key, a.visitor_id, sum(m.seconds) / 60.0 as minutes
      from arrivals a
      join (
        select visitor_id, session_id, reel_id, max(coalesce(active_seconds, 0)) as seconds, min(created_at) as first_at
        from reading group by 1, 2, 3
      ) m on m.visitor_id = a.visitor_id and (m.session_id = a.session_id or m.first_at >= a.created_at)
      group by 1, 2, 3
    ),
    summary as (
      select
        p.kind, p.key,
        count(*) as devices,
        count(*) filter (where p.anonymous) as guests,
        count(*) filter (where p.started_landed) as started_bok,
        count(*) filter (where p.finished_landed) as finished_bok,
        count(*) filter (where p.opened_format) as opened_format,
        count(*) filter (where p.other_finished >= 1) as read_another,
        count(*) filter (where p.finished >= 3) as finished_three,
        count(*) filter (where p.came_back) as came_back,
        count(*) filter (where p.created_account) as created_account,
        round(coalesce(sum(m.minutes), 0)::numeric, 1) as minutes,
        round((percentile_cont(0.5) within group (order by coalesce(m.minutes, 0)))::numeric, 1) as median_minutes
      from per_arrival p
      left join minutes m on m.kind = p.kind and m.key = p.key and m.visitor_id = p.visitor_id
      group by p.kind, p.key
    ),
    visit_counts as (
      select 'link' as kind, v.link_code as key, count(*) as visits, min(v.created_at) as first_visit, max(v.created_at) as last_visit
      from visits v where v.link_code is not null group by 2
      union all
      select 'bok', v.landing_reel_id::text, count(*), min(v.created_at), max(v.created_at)
      from visits v where v.landing_reel_id is not null group by 2
    ),
    -- Where a link's visits came from, so "sent to the faculty chat" can be
    -- told from "forwarded on to Telegram".
    link_referrers as (
      select link_code as key, jsonb_agg(jsonb_build_object('value', value, 'visits', visits) order by visits desc) as referrers
      from (
        select v.link_code, coalesce(v.referrer_host, 'direct') as value, count(*) as visits
        from visits v where v.link_code is not null group by 1, 2
      ) r
      group by 1
    ),
    stats_json as (
      select s.kind, s.key, jsonb_build_object(
        'visits', coalesce(vc.visits, 0),
        'devices', s.devices,
        'guests', s.guests,
        'startedBok', s.started_bok,
        'finishedBok', s.finished_bok,
        'openedFormat', s.opened_format,
        'readAnother', s.read_another,
        'finishedThree', s.finished_three,
        'cameBack', s.came_back,
        'createdAccount', s.created_account,
        'minutes', s.minutes,
        'medianMinutes', s.median_minutes,
        'firstVisit', vc.first_visit,
        'lastVisit', vc.last_visit
      ) as stats
      from summary s
      left join visit_counts vc on vc.kind = s.kind and vc.key = s.key
    )
    select jsonb_build_object(
      'days', v_days,
      'since', v_since,
      -- Before this date visits did not carry the bok or the link.
      'trackedSince', (
        select min(created_at) from public.boks_journey_events
        where landing_reel_id is not null or link_code is not null
      ),
      'links', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', l.code,
          'label', l.label,
          'bokId', l.reel_id,
          'bokTitle', r.title,
          'bokAuthor', r.author_name,
          'createdAt', l.created_at,
          'archived', l.archived_at is not null,
          'referrers', coalesce(lr.referrers, '[]'::jsonb),
          -- A link nobody has used yet answers in the same shape, with zeros.
          'stats', coalesce(sj.stats, jsonb_build_object(
            'visits', 0, 'devices', 0, 'guests', 0, 'startedBok', 0, 'finishedBok', 0,
            'openedFormat', 0, 'readAnother', 0, 'finishedThree', 0, 'cameBack', 0,
            'createdAccount', 0, 'minutes', 0, 'medianMinutes', null, 'firstVisit', null, 'lastVisit', null
          ))
        ) order by (l.archived_at is not null), coalesce((sj.stats ->> 'devices')::integer, 0) desc, l.created_at desc)
        from public.boks_tracked_links l
        left join public.reels r on r.id = l.reel_id
        left join stats_json sj on sj.kind = 'link' and sj.key = l.code
        left join link_referrers lr on lr.key = l.code
      ), '[]'::jsonb),
      'boks', coalesce((
        select jsonb_agg(row_json order by devices desc, title)
        from (
          select
            (sj.stats ->> 'devices')::integer as devices,
            r.title,
            jsonb_build_object(
              'bokId', r.id,
              'bokTitle', r.title,
              'bokAuthor', r.author_name,
              -- How many of the arriving devices came through a tracked link
              -- rather than a link a reader shared.
              'throughLinks', (
                select count(distinct a.visitor_id) from arrivals a
                where a.kind = 'link' and a.landing_reel_id = r.id
              ),
              'stats', sj.stats
            ) as row_json
          from stats_json sj
          join public.reels r on r.id::text = sj.key
          where sj.kind = 'bok'
          order by 1 desc, 2
          limit 50
        ) b
      ), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.get_link_attribution(integer, boolean, text[]) is
  'Per tracked link and per landed bok: visits, arriving devices and what they read afterwards, counted by device with the team left out unless asked. Admin-only.';

revoke all on function public.get_link_attribution(integer, boolean, text[]) from public, anon, authenticated;
grant execute on function public.get_link_attribution(integer, boolean, text[]) to authenticated;
