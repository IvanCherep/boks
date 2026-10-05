-- Aftertaste events were being dropped on the way in.
--
-- `20261001090000_boks_aftertaste` widened the table's CHECK constraint, but
-- the function that actually inserts, `record_recommendation_events_unchecked`
-- (renamed behind the hardening wrapper in `20260925160420`), still filtered
-- incoming rows against its own literal list of event types - the one from
-- `20260913200000`, without 'aftertaste'. The filter drops silently and the RPC
-- only returns a smaller count, so every aftertaste since 1 October was lost
-- without an error anywhere.
--
-- The list now lives in one function, `boks_recommendation_event_types()`, and
-- `scripts/local-supabase/checks.sql` asserts that it equals the CHECK
-- constraint, so the two cannot drift apart again. The body is otherwise the
-- one from `20260913200000`, with every reference schema-qualified for the
-- empty search_path the hardening migration set.

create or replace function public.boks_recommendation_event_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'impression', 'start', 'complete', 'like', 'share', 'skip',
    'comment', 'publish', 'preference', 'heartbeat', 'aftertaste'
  ]::text[];
$$;

revoke all on function public.boks_recommendation_event_types() from public, anon, authenticated;

create or replace function public.record_recommendation_events_unchecked(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inserted integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required to record reader events.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_events, 'null'::jsonb)) <> 'array' then
    raise exception 'Events must be a JSON array.' using errcode = '22023';
  end if;

  with incoming as (
    select event from jsonb_array_elements(p_events) as event limit 100
  ),
  accepted as (
    insert into public.recommendation_events (
      user_id, reel_id, visitor_id, session_id, event_type, value,
      algorithm_id, experiment_key, user_segment, surface, rank,
      client_elapsed_seconds, active_seconds, progress, estimated_seconds,
      feed_id, serving_backend, labeling_version, credited_algorithm_id, metadata
    )
    select
      v_uid,
      nullif(event ->> 'storyId', '')::uuid,
      left(coalesce(event ->> 'visitorId', ''), 120),
      left(coalesce(event ->> 'sessionId', ''), 120),
      event ->> 'eventType',
      least(greatest(coalesce((event ->> 'value')::numeric, 1), 0), 86400),
      left(coalesce(nullif(btrim(event ->> 'algorithmId'), ''), 'unassigned'), 60),
      left(coalesce(event ->> 'experimentKey', ''), 60),
      left(coalesce(nullif(btrim(event ->> 'userSegment'), ''), 'general'), 40),
      coalesce(nullif(btrim(event ->> 'surface'), ''), 'reader'),
      least(greatest(coalesce((event ->> 'rank')::integer, 0), 0), 10000),
      least(greatest(coalesce((event ->> 'clientElapsedSeconds')::numeric, 0), 0), 86400),
      least(greatest(coalesce((event ->> 'activeSeconds')::numeric, 0), 0), 86400),
      least(greatest(coalesce((event ->> 'progress')::numeric, 0), 0), 1),
      least(greatest(coalesce((event ->> 'estimatedSeconds')::numeric, 0), 0), 86400),
      (
        select f.id from public.served_feed f
        where f.id = nullif(event ->> 'feedId', '')::uuid and f.user_id = v_uid
      ),
      left(coalesce(nullif(btrim(event ->> 'servingBackend'), ''), 'unknown'), 30),
      left(coalesce(nullif(btrim(event ->> 'labelingVersion'), ''), 'unknown'), 30),
      left(nullif(btrim(event ->> 'creditedAlgorithmId'), ''), 60),
      coalesce(event -> 'metadata', '{}'::jsonb)
    from incoming
    where event ->> 'eventType' = any (public.boks_recommendation_event_types())
      and coalesce(event ->> 'surface', 'reader') in ('reader', 'author', 'admin')
      and (event ->> 'storyId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    returning 1
  )
  select count(*)::integer into v_inserted from accepted;

  return v_inserted;
end;
$$;

revoke all on function public.record_recommendation_events_unchecked(jsonb)
  from public, anon, authenticated;
