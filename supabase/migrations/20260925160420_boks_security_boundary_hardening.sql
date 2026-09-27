-- Security boundaries added after the September growth audit.
--
-- Browser callers are untrusted even when they hold a valid Supabase JWT.
-- This migration caps the two high-volume ingestion RPCs, requires an active
-- terms-accepted account for social/author writes, removes the public
-- first-admin bootstrap, and makes guest telemetry callable only by an actual
-- Supabase session. Anonymous Supabase users still carry the `authenticated`
-- database role, so the guest product flow is unchanged.

-- ---------------------------------------------------------------- RPC input and rate limits

alter function public.record_served_feed(jsonb, jsonb)
  rename to record_served_feed_unchecked;
revoke all on function public.record_served_feed_unchecked(jsonb, jsonb)
  from public, anon, authenticated;
alter function public.record_served_feed_unchecked(jsonb, jsonb)
  set search_path = '';

create or replace function public.record_served_feed(p_feed jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in required to record a served feed.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_feed, 'null'::jsonb)) <> 'object'
     or pg_column_size(p_feed) > 65536 then
    raise exception 'Feed metadata is invalid or too large.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_items) > 200
     or pg_column_size(p_items) > 262144 then
    raise exception 'Feed items are invalid or too large.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where jsonb_typeof(item) <> 'object' or pg_column_size(item) > 16384
  ) then
    raise exception 'A feed item is invalid or too large.' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.served_feed f
    where f.user_id = v_uid and f.served_at > now() - interval '1 hour'
  ) >= 300 then
    raise exception 'Feed request limit reached. Try again later.' using errcode = '54023';
  end if;

  return public.record_served_feed_unchecked(p_feed, p_items);
end;
$$;

revoke all on function public.record_served_feed(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_served_feed(jsonb, jsonb)
  to authenticated;

alter function public.record_recommendation_events(jsonb)
  rename to record_recommendation_events_unchecked;
revoke all on function public.record_recommendation_events_unchecked(jsonb)
  from public, anon, authenticated;
alter function public.record_recommendation_events_unchecked(jsonb)
  set search_path = '';

create or replace function public.record_recommendation_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in required to record reader events.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_events, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_events) > 100
     or pg_column_size(p_events) > 262144 then
    raise exception 'Events are invalid or too large.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_events) event
    where jsonb_typeof(event) <> 'object'
       or pg_column_size(event) > 16384
       or pg_column_size(coalesce(event -> 'metadata', '{}'::jsonb)) > 8192
  ) then
    raise exception 'An event is invalid or too large.' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.recommendation_events e
    where e.user_id = v_uid and e.created_at > now() - interval '1 hour'
  ) >= 5000 then
    raise exception 'Event limit reached. Try again later.' using errcode = '54023';
  end if;

  return public.record_recommendation_events_unchecked(p_events);
end;
$$;

revoke all on function public.record_recommendation_events(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_recommendation_events(jsonb)
  to authenticated;

-- ----------------------------------------------------------- account write gates

create or replace function public.reject_blocked_boks_user_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  if v_uid is not null and public.is_boks_user_blocked(v_uid) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;

  if v_uid is not null and tg_op <> 'DELETE' and tg_table_name in
    ('likes', 'comments', 'comment_likes', 'author_follows', 'bok_reports', 'reels')
     and (
       v_is_anonymous
       or not exists (
         select 1 from public.user_profiles p
         where p.user_id = v_uid and p.terms_accepted_at is not null
       )
     ) then
    raise exception 'Accept the boks terms before using this feature.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.reject_blocked_boks_user_mutation()
  from public, anon, authenticated;

-- A public first-admin claim is a takeover path on every fresh environment.
-- Bootstrap is now an operator action; all later grants stay in /admin.
revoke all on function public.claim_initial_boks_admin()
  from public, anon, authenticated;
grant execute on function public.claim_initial_boks_admin()
  to service_role;

-- A Supabase anonymous session uses the authenticated role. Bare publishable-
-- key requests no longer bypass account/IP rate limits with a null identity.
revoke execute on function public.submit_boks_feedback(text, text, integer, text)
  from anon;
revoke execute on function public.record_boks_journey_event(text, text, text, text, text, text, text, text, text, text)
  from anon;

-- ---------------------------------------------------------- foreign-key indexes

create index if not exists bok_reports_reporter_user_idx
  on public.bok_reports (reporter_user_id);
create index if not exists bok_reports_reviewed_by_idx
  on public.bok_reports (reviewed_by);
create index if not exists bok_rights_confirmed_by_idx
  on public.bok_rights (confirmed_by);
create index if not exists boks_feedback_user_idx
  on public.boks_feedback (user_id);
create index if not exists boks_journey_events_user_idx
  on public.boks_journey_events (user_id);
create index if not exists boks_team_devices_marked_by_idx
  on public.boks_team_devices (marked_by);
create index if not exists comments_parent_comment_idx
  on public.comments (parent_comment_id);
create index if not exists deleted_boks_users_deleted_by_idx
  on public.deleted_boks_users (deleted_by);
create index if not exists recommendation_experiments_updated_by_idx
  on public.recommendation_experiments (updated_by);
create index if not exists reels_archived_by_idx
  on public.reels (archived_by);
create index if not exists user_profiles_banned_by_idx
  on public.user_profiles (banned_by);
