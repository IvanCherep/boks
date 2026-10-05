-- Reader events: one bad event no longer costs the batch, and the arm an event
-- is credited to is the reader's, not whatever the browser says.
--
-- 1. One bad event aborted all of up to 100. The ingest cast `storyId`,
--    `feedId`, `value`, `rank` and the time fields straight to uuid/numeric, and
--    `reel_id` is a foreign key: a bok an admin erased while its events sat in
--    a reader's queue (23503), a feed id that is not a uuid, or a value that is
--    not a number (22P02) raised, and the whole batch was lost - then retried
--    by the client, and lost again. Every field is now parsed defensively, an
--    event about a bok that no longer exists is dropped on its own, and a
--    malformed number falls back to its default instead of raising.
--
-- 2. Attribution was the browser's word. `record_recommendation_assignment`
--    stored any algorithm id under any experiment key (first write wins, so a
--    forged arm was permanent), and events stored the `algorithmId` they were
--    sent with. Now:
--      - an assignment is recorded only for the active experiment and only for
--        one of its live arms; anything else is ignored and the caller is told
--        what is stored (nothing, for a new reader), which the feed service
--        already treats as "use the arm I computed";
--      - an event for the active experiment, from a reader whose stored arm is
--        live, is credited to that arm. What the browser claimed is kept in
--        `metadata.claimedAlgorithmId` when it differed, so nothing is erased.
--    A stored arm that is no longer live (readers assigned `completion_first`
--    before it was parked) is deliberately not used for crediting: those
--    readers are served the live arm now, and their events say so.
--
-- 3. The candidate query, which runs on every feed load:
--      - its behaviour rollup scanned every event of 400 boks, heartbeats
--        included, through an index without `created_at`. It now reads only
--        the five event types it counts, through a partial index that has the
--        window column and carries what is summed;
--      - "what this reader has been reading lately" was the last 24 *events*
--        of any type, which heartbeats turn into one or two boks. It is now the
--        24 most recent distinct boks the reader started or finished;
--      - taste and novelty used any stored vector. The model is pinned by
--        `boks_embedding_model()` (`20260920120000`), and a vector from an
--        older model is not comparable, so only current-model vectors count -
--        for the reader's side and for the candidate's.
--    The return shape is unchanged.
--
-- 4. The visit dedupe in `record_boks_journey_event` looks a visit up by
--    session on every guest arrival, with no index on `session_id`.
--
-- 5. `/api/feed`'s only limit (300 served feeds an hour per reader, in
--    `record_served_feed`) was checked after the expensive candidate query had
--    already run, and anonymous sessions are free to mint. The candidate query
--    now checks the same ceiling first and answers an empty set past it.
--
-- 6. `record_served_feed` stored the `algorithmId` it was handed. It is now
--    credited to the reader's stored live arm, like events, unless an admin is
--    previewing a named algorithm; the claim is kept in `profile_snapshot`.

create or replace function public.boks_json_number(p_value text, p_default numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when btrim(coalesce(p_value, '')) ~ '^-?[0-9]{1,15}(\.[0-9]{1,15})?([eE][-+]?[0-9]{1,2})?$'
      then btrim(p_value)::numeric
    else p_default
  end;
$$;

revoke all on function public.boks_json_number(text, numeric) from public, anon, authenticated;

create or replace function public.record_recommendation_events_unchecked(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inserted integer := 0;
  v_active_key text;
  v_live_arms text[];
begin
  if v_uid is null then
    raise exception 'Sign in required to record reader events.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_events, 'null'::jsonb)) <> 'array' then
    raise exception 'Events must be a JSON array.' using errcode = '22023';
  end if;

  select x.key, coalesce(array_agg(arm ->> 'algorithmId') filter (
           where public.boks_json_number(arm ->> 'weight', 0) > 0
         ), array[]::text[])
  into v_active_key, v_live_arms
  from public.recommendation_experiments x
  left join lateral jsonb_array_elements(
    case when jsonb_typeof(x.arms) = 'array' then x.arms else '[]'::jsonb end
  ) arm on true
  where x.is_active
  group by x.key;

  with incoming as (
    select event from jsonb_array_elements(p_events) as event limit 100
  ),
  parsed as (
    -- CASE, not a WHERE conjunct, guards every cast: the planner may evaluate
    -- conjuncts in any order, a CASE it may not.
    select
      i.event,
      case
        when (i.event ->> 'storyId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (i.event ->> 'storyId')::uuid
      end as reel_id,
      case
        when (i.event ->> 'feedId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (i.event ->> 'feedId')::uuid
      end as feed_id,
      left(coalesce(nullif(btrim(i.event ->> 'algorithmId'), ''), 'unassigned'), 60) as claimed_algorithm_id,
      left(coalesce(i.event ->> 'experimentKey', ''), 60) as experiment_key
    from incoming i
    where jsonb_typeof(i.event) = 'object'
  ),
  credited as (
    select
      p.*,
      case
        when p.experiment_key = v_active_key
          and a.algorithm_id = any (v_live_arms)
          then a.algorithm_id
        else p.claimed_algorithm_id
      end as algorithm_id
    from parsed p
    left join public.recommendation_assignments a
      on a.user_id = v_uid and a.experiment_key = p.experiment_key
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
      c.reel_id,
      left(coalesce(c.event ->> 'visitorId', ''), 120),
      left(coalesce(c.event ->> 'sessionId', ''), 120),
      c.event ->> 'eventType',
      least(greatest(public.boks_json_number(c.event ->> 'value', 1), 0), 86400),
      c.algorithm_id,
      c.experiment_key,
      left(coalesce(nullif(btrim(c.event ->> 'userSegment'), ''), 'general'), 40),
      coalesce(nullif(btrim(c.event ->> 'surface'), ''), 'reader'),
      least(greatest(public.boks_json_number(c.event ->> 'rank', 0), 0), 10000)::integer,
      least(greatest(public.boks_json_number(c.event ->> 'clientElapsedSeconds', 0), 0), 86400),
      least(greatest(public.boks_json_number(c.event ->> 'activeSeconds', 0), 0), 86400),
      least(greatest(public.boks_json_number(c.event ->> 'progress', 0), 0), 1),
      least(greatest(public.boks_json_number(c.event ->> 'estimatedSeconds', 0), 0), 86400),
      (
        select f.id from public.served_feed f
        where f.id = c.feed_id and f.user_id = v_uid
      ),
      left(coalesce(nullif(btrim(c.event ->> 'servingBackend'), ''), 'unknown'), 30),
      left(coalesce(nullif(btrim(c.event ->> 'labelingVersion'), ''), 'unknown'), 30),
      left(nullif(btrim(c.event ->> 'creditedAlgorithmId'), ''), 60),
      case
        when jsonb_typeof(c.event -> 'metadata') = 'object' then c.event -> 'metadata'
        else '{}'::jsonb
      end
      || case
        when c.algorithm_id is distinct from c.claimed_algorithm_id
          then jsonb_build_object('claimedAlgorithmId', c.claimed_algorithm_id)
        else '{}'::jsonb
      end
    from credited c
    where c.event ->> 'eventType' = any (public.boks_recommendation_event_types())
      and coalesce(c.event ->> 'surface', 'reader') in ('reader', 'author', 'admin')
      and c.reel_id is not null
      -- A bok erased while this event waited in the reader's queue: drop the
      -- one event, not the batch it travelled in.
      and exists (select 1 from public.reels r where r.id = c.reel_id)
    returning 1
  )
  select count(*)::integer into v_inserted from accepted;

  return v_inserted;
end;
$$;

revoke all on function public.record_recommendation_events_unchecked(jsonb)
  from public, anon, authenticated;

create or replace function public.record_recommendation_assignment(
  p_experiment_key text,
  p_algorithm_id text,
  p_user_segment text,
  p_visitor_id text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.recommendation_assignments;
  v_key text := left(coalesce(nullif(btrim(p_experiment_key), ''), 'boks-feed-v1'), 60);
  v_algorithm text := left(coalesce(nullif(btrim(p_algorithm_id), ''), 'unassigned'), 60);
  v_active_key text;
  v_live boolean := false;
begin
  if v_uid is null then
    return null;
  end if;

  select x.key,
         exists (
           select 1
           from jsonb_array_elements(
             case when jsonb_typeof(x.arms) = 'array' then x.arms else '[]'::jsonb end
           ) arm
           where arm ->> 'algorithmId' = v_algorithm
             and public.boks_json_number(arm ->> 'weight', 0) > 0
         )
  into v_active_key, v_live
  from public.recommendation_experiments x
  where x.is_active
  limit 1;

  -- Only the active experiment, and only one of its live arms. With no active
  -- experiment row at all (a fresh database) there is nothing to check
  -- against, and the old behaviour stands.
  if v_active_key is null or (v_key = v_active_key and v_live) then
    insert into public.recommendation_assignments (user_id, visitor_id, experiment_key, algorithm_id, user_segment)
    values (
      v_uid,
      left(coalesce(p_visitor_id, ''), 120),
      v_key,
      v_algorithm,
      left(coalesce(nullif(btrim(p_user_segment), ''), 'general'), 40)
    )
    on conflict (user_id, experiment_key) do nothing;
  end if;

  select * into v_row
  from public.recommendation_assignments
  where user_id = v_uid and experiment_key = v_key;

  return jsonb_build_object(
    'experimentKey', v_row.experiment_key,
    'algorithmId', v_row.algorithm_id,
    'userSegment', v_row.user_segment,
    'assignedAt', v_row.assigned_at,
    'switchedAt', v_row.switched_at,
    'previousAlgorithmId', v_row.previous_algorithm_id
  );
end;
$$;

revoke all on function public.record_recommendation_assignment(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_recommendation_assignment(text, text, text, text)
  to authenticated;

create index if not exists recommendation_events_reel_rollup_idx
  on public.recommendation_events (reel_id, created_at)
  include (event_type, value)
  where event_type in ('impression', 'start', 'complete', 'skip', 'share');

create index if not exists recommendation_events_user_read_idx
  on public.recommendation_events (user_id, created_at desc)
  include (reel_id)
  where event_type in ('start', 'complete');

create index if not exists boks_journey_events_visit_session_idx
  on public.boks_journey_events (session_id)
  where event = 'visit';

create or replace function public.get_recommendation_candidates(p_limit integer DEFAULT 200, p_languages text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 400);
  -- Half the slate is the newest, half is drawn from everything else.
  v_recent integer := greatest(1, least(greatest(coalesce(p_limit, 200), 1), 400) / 2);
  v_since timestamptz := now() - interval '60 days';
  v_uid uuid := (select auth.uid());
  -- The reader's stored choice wins over whatever the client sends, so a
  -- signed-in reader's setting follows them between devices. `p_languages` is
  -- for guests, who have no profile row to store it in.
  v_languages text[] := coalesce(
    nullif((select p.reading_languages from public.user_profiles p where p.user_id = v_uid), array[]::text[]),
    (
      select array_agg(distinct lang order by lang)
      from unnest(coalesce(p_languages, array[]::text[])) raw
      cross join lateral (select lower(btrim(split_part(raw, '-', 1))) as lang) normalised
      where lang in ('en', 'ru')
    )
  );
begin
  -- The same hourly ceiling `record_served_feed` enforces, checked before the
  -- expensive part rather than after it. A caller past it gets an empty set,
  -- which the feed service serves as an empty slate - nothing a reader at a
  -- human pace will ever meet.
  if v_uid is not null and (
    select count(*)
    from public.served_feed f
    where f.user_id = v_uid and f.served_at > now() - interval '1 hour'
  ) >= 300 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with published as (
      -- The language filter lives here, in retrieval, so the ranker cannot
      -- score a piece the reader could not read - and so the
      -- catalogue-headroom figures count only what was ever eligible.
      --
      -- A reader who named no language sees everything, `und` included. A
      -- reader who narrowed sees only what they named: an undetermined piece
      -- is not evidence that they can read it.
      select r.* from public.boks_reels r
      where r.status = 'published'
        and (
          v_languages is null
          or cardinality(v_languages) = 0
          or coalesce(r.language, 'und') = any (v_languages)
        )
    ),
    newest as (
      select p.* from published p order by p.created_at desc limit v_recent
    ),
    sampled as (
      -- The rest of the catalogue, drawn at random, so that nothing is
      -- permanently out of reach. `order by random()` is affordable here: the
      -- table is thousands of rows and this runs once per feed load.
      select p.* from published p
      where not exists (select 1 from newest n where n.id = p.id)
      order by random()
      limit greatest(0, v_limit - v_recent)
    ),
    recent_reels as (
      select * from newest
      union all
      select * from sampled
    ),
    event_rollup as (
      select
        e.reel_id,
        count(*) filter (where e.event_type = 'impression')::integer as impressions,
        count(*) filter (where e.event_type = 'start')::integer as starts,
        count(*) filter (where e.event_type = 'complete')::integer as completes,
        count(*) filter (where e.event_type = 'skip')::integer as skips,
        count(*) filter (where e.event_type = 'share')::integer as shares,
        coalesce(sum(e.value) filter (where e.event_type = 'complete'), 0)::numeric as read_seconds_total
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where e.created_at >= v_since
        and e.event_type in ('impression', 'start', 'complete', 'skip', 'share')
      group by e.reel_id
    ),
    like_rollup as (
      select l.reel_id, count(*)::integer as likes
      from public.likes l
      join recent_reels rr on rr.id = l.reel_id
      group by l.reel_id
    ),
    comment_rollup as (
      select c.reel_id, count(*)::integer as comments
      from public.comments c
      join recent_reels rr on rr.id = c.reel_id
      group by c.reel_id
    ),
    author_stats as (
      select
        r.author_user_id,
        count(*)::integer as published,
        (
          select count(*)::integer from public.author_follows f
          where f.author_user_id = r.author_user_id
        ) as followers
      from public.boks_reels r
      where r.status = 'published' and r.author_user_id is not null
      group by r.author_user_id
    ),
    -- The reader's own history with each boks, per (session, boks) so a reader
    -- who returns across sessions accumulates exposure rather than overwriting.
    -- The reader's taste vector: the mean embedding of what they liked or
    -- finished, a like counted twice because it is the only thing a reader
    -- says out loud. Null until they have done either to an embedded bok, and
    -- a null similarity contributes nothing rather than guessing.
    my_taste as (
      select avg(sample.embedding) as embedding, count(*)::integer as samples
      from (
        select re.embedding
        from public.likes l
        join public.reels re on re.id = l.reel_id
        where v_uid is not null and l.user_id = v_uid and re.embedding is not null
          and re.embedding_model = public.boks_embedding_model()
        union all
        select re.embedding
        from public.likes l
        join public.reels re on re.id = l.reel_id
        where v_uid is not null and l.user_id = v_uid and re.embedding is not null
          and re.embedding_model = public.boks_embedding_model()
        union all
        select re.embedding
        from public.recommendation_events e
        join public.reels re on re.id = e.reel_id
        where v_uid is not null and e.user_id = v_uid and e.event_type = 'complete'
          and e.created_at >= v_since and re.embedding is not null
          and re.embedding_model = public.boks_embedding_model()
      ) sample
    ),
    -- What this reader has been reading lately, which is what novelty is
    -- measured against. Deliberately short: a rut is recent by definition.
    my_recent as (
      select avg(re.embedding) as embedding
      from (
        -- The 24 most recent distinct boks this reader started or finished.
        -- Counted in events, heartbeats made "the last 24" one or two boks.
        select e.reel_id
        from public.recommendation_events e
        where v_uid is not null and e.user_id = v_uid and e.surface = 'reader'
          and e.event_type in ('start', 'complete')
        group by e.reel_id
        order by max(e.created_at) desc
        limit 24
      ) recent
      join public.reels re on re.id = recent.reel_id
      where re.embedding is not null
        and re.embedding_model = public.boks_embedding_model()
    ),
    my_sessions as (
      select
        e.reel_id,
        e.session_id,
        max(e.active_seconds) as dwell_seconds,
        max(e.progress) as progress,
        bool_or(e.event_type = 'skip') as skipped,
        max(e.created_at) as last_event_at,
        count(*)::integer as events
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where v_uid is not null and e.user_id = v_uid and e.surface = 'reader'
      group by e.reel_id, e.session_id
    ),
    my_state as (
      select
        s.reel_id,
        count(*)::integer as seen_count,
        -- A quick skip is a skip that never became reading. It is the closest
        -- honest equivalent of the original's explicit QUICK_SKIP event.
        count(*) filter (where s.skipped and s.dwell_seconds < 5)::integer as quick_skip_count,
        coalesce(sum(s.dwell_seconds), 0)::numeric as total_dwell_seconds,
        coalesce(max(s.progress), 0)::numeric as max_progress,
        coalesce(sum(s.events), 0)::integer as event_count,
        max(s.last_event_at) as last_event_at
      from my_sessions s
      group by s.reel_id
    ),
    my_completions as (
      select e.reel_id, min(e.created_at) as completed_at
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where v_uid is not null and e.user_id = v_uid and e.event_type = 'complete'
      group by e.reel_id
    )
    select jsonb_agg(jsonb_build_object(
      'id', r.id::text,
      'title', r.title,
      'authorName', r.author_name,
      'authorHandle', r.author_handle,
      'authorUserId', coalesce(r.author_user_id::text, ''),
      'hook', r.hook,
      'body', r.text,
      'genre', r.genre,
      'mood', r.mood,
      'language', coalesce(r.language, 'und'),
      'minutes', r.minutes,
      'wordCount', coalesce(r.word_count, 0),
      'readingShape', r.reading_shape,
      'lineBreakCount', coalesce(r.line_break_count, 0),
      'createdAt', r.created_at,
      'impressions', coalesce(er.impressions, 0),
      'starts', coalesce(er.starts, 0),
      'completes', coalesce(er.completes, 0),
      'skips', coalesce(er.skips, 0),
      'likes', coalesce(lr.likes, 0),
      'shares', coalesce(er.shares, 0),
      'comments', coalesce(cr.comments, 0),
      'readSecondsTotal', coalesce(er.read_seconds_total, 0),
      'authorPublishedCount', coalesce(ast.published, 0),
      'authorFollowers', coalesce(ast.followers, 0),
      'hasEmbedding', (re.embedding is not null and re.embedding_model is not distinct from public.boks_embedding_model()),
      'tasteSamples', coalesce(mt.samples, 0),
      'tasteSimilarity', case
        when re.embedding is not null and re.embedding_model = public.boks_embedding_model()
          and mt.embedding is not null
          then round((1 - (re.embedding <=> mt.embedding))::numeric, 4)
        else null
      end,
      'noveltyDistance', case
        when re.embedding is not null and re.embedding_model = public.boks_embedding_model()
          and mr.embedding is not null
          then round(((re.embedding <=> mr.embedding) / 2)::numeric, 4)
        else null
      end,
      'followingAuthor', r.author_user_id is not null and exists (
        select 1 from public.author_follows f
        where f.follower_user_id = v_uid and f.author_user_id = r.author_user_id
      ),
      'mine', jsonb_build_object(
        'seenCount', coalesce(ms.seen_count, 0),
        'quickSkipCount', coalesce(ms.quick_skip_count, 0),
        'totalDwellSeconds', round(coalesce(ms.total_dwell_seconds, 0))::integer,
        'maxProgress', round(coalesce(ms.max_progress, 0), 3),
        'eventCount', coalesce(ms.event_count, 0),
        'lastEventAt', ms.last_event_at,
        'completedAt', mc.completed_at,
        'liked', exists (
          select 1 from public.likes l where l.reel_id = r.id and l.user_id = v_uid
        ),
        'commented', exists (
          select 1 from public.comments c where c.reel_id = r.id and c.user_id = v_uid
        )
      )
    ) order by r.created_at desc)
    from recent_reels r
    join public.reels re on re.id = r.id
    cross join my_taste mt
    cross join my_recent mr
    left join event_rollup er on er.reel_id = r.id
    left join like_rollup lr on lr.reel_id = r.id
    left join comment_rollup cr on cr.reel_id = r.id
    left join author_stats ast on ast.author_user_id = r.author_user_id
    left join my_state ms on ms.reel_id = r.id
    left join my_completions mc on mc.reel_id = r.id
  ), '[]'::jsonb);
end;
$function$;

-- A served feed is credited to the reader's stored arm, for the same reason
-- events are: the browser's word is not attribution. An admin's preview of a
-- named algorithm is the one honest exception - it ranks with what it names.
create or replace function public.record_served_feed(p_feed jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_stored text;
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

  if not (coalesce(p_feed ->> 'assignmentSource', '') = 'requested' and public.is_boks_admin()) then
    select a.algorithm_id into v_stored
    from public.recommendation_assignments a
    join public.recommendation_experiments x
      on x.key = a.experiment_key and x.is_active
    where a.user_id = v_uid
      and a.experiment_key = coalesce(p_feed ->> 'experimentKey', '')
      and exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(x.arms) = 'array' then x.arms else '[]'::jsonb end
        ) arm
        where arm ->> 'algorithmId' = a.algorithm_id
          and public.boks_json_number(arm ->> 'weight', 0) > 0
      );

    if v_stored is not null and v_stored is distinct from nullif(p_feed ->> 'algorithmId', '') then
      p_feed := jsonb_set(p_feed, '{algorithmId}', to_jsonb(v_stored))
        || jsonb_build_object(
          'profileSnapshot',
          case
            when jsonb_typeof(p_feed -> 'profileSnapshot') = 'object' then p_feed -> 'profileSnapshot'
            else '{}'::jsonb
          end || jsonb_build_object('claimedAlgorithmId', p_feed ->> 'algorithmId')
        );
    end if;
  end if;

  return public.record_served_feed_unchecked(p_feed, p_items);
end;
$$;

revoke all on function public.record_served_feed(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_served_feed(jsonb, jsonb)
  to authenticated;
