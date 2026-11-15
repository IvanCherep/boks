-- "Что почитать", the feed side: a reader's request reaches retrieval.
--
-- A reading request is three answers for the current pause: a mood, a form
-- and author groups (docs/reading-facets.md). Form and author group are
-- strict - a bok outside them is never a candidate. The mood is soft: it
-- never empties the feed; matching boks are drawn first and the TypeScript
-- ranking puts them first (lib/boks/facets/request.ts). Ranking stays in
-- TypeScript; SQL only decides what is eligible.
--
-- 1. `get_recommendation_candidates` gains three optional arguments:
--    p_facets (strict), p_prefer (soft), p_exclude (the bok on screen). Called
--    with the old two arguments - the live server and old tabs' browser
--    fallback - it answers exactly as before, plus a `facets` key per
--    candidate. Body otherwise verbatim from 20261020120000.
-- 2. `count_reading_request_matches`: whether a request has anything at all,
--    so the panel can disable Apply instead of serving an empty feed. Never
--    shown as a number (the panel spec forbids counts).
-- 3. `served_feed.reading_request`: the request a feed was served under, so a
--    filtered feed is never mistaken for the arm's own choice in analysis.

-- A request's facets, checked: an object of registered facet keys, each an
-- array of short strings. Empty arrays are dropped; nothing left is null.
-- An unknown key is an error rather than a silently looser feed.
create or replace function public.boks_reading_request_facets(p_request jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_clean jsonb;
  v_key text;
begin
  if p_request is null or p_request = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_request) <> 'object' or pg_column_size(p_request) > 2048 then
    raise exception 'A reading request must be a small JSON object.' using errcode = '22023';
  end if;
  select key into v_key
  from jsonb_each(p_request)
  where not exists (select 1 from public.reading_facets f where f.key = jsonb_each.key)
     or jsonb_typeof(value) <> 'array'
     or jsonb_array_length(value) > 10
     or exists (select 1 from jsonb_array_elements(value) v where jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 40)
  limit 1;
  if v_key is not null then
    raise exception 'The reading request facet % is not valid.', v_key using errcode = '22023';
  end if;
  select jsonb_object_agg(key, value) into v_clean
  from jsonb_each(p_request)
  where jsonb_array_length(value) > 0;
  return v_clean;
end;
$$;

-- True when, for every facet in the request, the bok's labels share a value
-- with it. A null request matches everything; an unlabelled facet matches
-- nothing (unknown is not yes).
create or replace function public.boks_bok_matches_facets(p_bok_id uuid, p_facets jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_facets is null or not exists (
    select 1
    from jsonb_each(p_facets) req
    where not coalesce(
      (select bf.facets -> req.key from public.bok_reading_facets bf where bf.bok_id = p_bok_id)
        ?| array(select jsonb_array_elements_text(req.value)),
      false
    )
  );
$$;

revoke all on function public.boks_reading_request_facets(jsonb) from public, anon, authenticated;
revoke all on function public.boks_bok_matches_facets(uuid, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ candidates

-- A new signature replaces the old one: two overloads would make PostgREST's
-- choice for a two-argument call ambiguous. The new one has defaults for every
-- new argument, so a two-argument call is answered by it.
drop function if exists public.get_recommendation_candidates(integer, text[]);

create function public.get_recommendation_candidates(
  p_limit integer DEFAULT 200,
  p_languages text[] DEFAULT NULL::text[],
  p_facets jsonb DEFAULT NULL::jsonb,
  p_prefer jsonb DEFAULT NULL::jsonb,
  p_exclude uuid DEFAULT NULL::uuid
)
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
  -- What the reader asked for this pause ("Что почитать"): checked facets.
  v_facets jsonb := public.boks_reading_request_facets(p_facets);
  v_prefer jsonb := public.boks_reading_request_facets(p_prefer);
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
        -- The reader's strict conditions (form, author group) are retrieval
        -- too: filtering after the limit would answer "nothing" while matches
        -- sit further down the catalogue. The bok on screen is left out, so
        -- applying a request always moves on to another one.
        and (p_exclude is null or r.id <> p_exclude)
        and public.boks_bok_matches_facets(r.id, v_facets)
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
      -- A preferred facet (the mood) is soft: it never removes a bok, but
      -- matching ones are drawn first, so the ranker has them to put first.
      order by (v_prefer is not null and public.boks_bok_matches_facets(p.id, v_prefer)) desc, random()
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
      'summary', re.summary,
      'facets', coalesce(bf.facets, '{}'::jsonb),
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
    left join public.bok_reading_facets bf on bf.bok_id = r.id
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_recommendation_candidates(integer, text[], jsonb, jsonb, uuid) from public;
grant execute on function public.get_recommendation_candidates(integer, text[], jsonb, jsonb, uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------------ availability

-- Whether anything published fits a request: the reader's languages (their
-- stored choice wins, as in the feed), the strict facets, minus the bok on
-- screen. Capped, because only "none" and "some" matter.
create or replace function public.count_reading_request_matches(
  p_languages text[] default null,
  p_facets jsonb default null,
  p_exclude uuid default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_facets jsonb := public.boks_reading_request_facets(p_facets);
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
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  return (
    select count(*)::integer from (
      select 1
      from public.reels r
      where r.status = 'published'
        and (v_languages is null or cardinality(v_languages) = 0 or coalesce(r.language, 'und') = any (v_languages))
        and (p_exclude is null or r.id <> p_exclude)
        and public.boks_bok_matches_facets(r.id, v_facets)
      limit 20
    ) found
  );
end;
$$;

revoke all on function public.count_reading_request_matches(text[], jsonb, uuid) from public;
grant execute on function public.count_reading_request_matches(text[], jsonb, uuid) to anon, authenticated;

-- ------------------------------------------------------------------ attribution

alter table public.served_feed add column if not exists reading_request jsonb;

comment on column public.served_feed.reading_request is
  'The reader''s "What to read" request this feed was served under (mood, format, authorGroups); null for an ordinary feed. A filtered feed is the arm ranking within the reader''s conditions, not its free choice.';

-- Verbatim from 20261116120000 plus `reading_request`.
create or replace function public.record_served_feed_unchecked(p_feed jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_feed_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required to record a served feed.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Feed items must be a JSON array.' using errcode = '22023';
  end if;

  insert into public.served_feed (
    user_id, session_id, experiment_key, experiment_version, experiment_mode,
    algorithm_id, algorithm_a_id, algorithm_b_id, assignment_source,
    candidate_request_id, candidate_count, catalog_size,
    serving_backend, degraded_mode, fallback_reason,
    signals_version, ranking_version, labeling_version,
    claimed_algorithm_id, seed, build_id, reading_request
  )
  values (
    v_uid,
    left(coalesce(p_feed ->> 'sessionId', ''), 120),
    left(coalesce(p_feed ->> 'experimentKey', ''), 60),
    greatest(coalesce((p_feed ->> 'experimentVersion')::integer, 1), 1),
    coalesce(nullif(p_feed ->> 'experimentMode', ''), 'single'),
    nullif(p_feed ->> 'algorithmId', ''),
    nullif(p_feed ->> 'algorithmAId', ''),
    nullif(p_feed ->> 'algorithmBId', ''),
    coalesce(nullif(p_feed ->> 'assignmentSource', ''), 'assigned'),
    coalesce(nullif(p_feed ->> 'candidateRequestId', '')::uuid, extensions.gen_random_uuid()),
    greatest(coalesce((p_feed ->> 'candidateCount')::integer, 0), 0),
    greatest(coalesce((p_feed ->> 'catalogSize')::integer, 0), 0),
    coalesce(nullif(p_feed ->> 'servingBackend', ''), 'worker'),
    coalesce((p_feed ->> 'degradedMode')::boolean, false),
    nullif(p_feed ->> 'fallbackReason', ''),
    coalesce(nullif(p_feed ->> 'signalsVersion', ''), 'unknown'),
    coalesce(nullif(p_feed ->> 'rankingVersion', ''), 'unknown'),
    coalesce(nullif(p_feed ->> 'labelingVersion', ''), 'unknown'),
    left(nullif(p_feed ->> 'claimedAlgorithmId', ''), 120),
    left(coalesce(p_feed ->> 'seed', ''), 120),
    nullif(p_feed ->> 'buildId', ''),
    -- Kept only when it is an object of a sane size; anything else is no request.
    case
      when jsonb_typeof(p_feed -> 'readingRequest') = 'object' and pg_column_size(p_feed -> 'readingRequest') <= 2048
        then p_feed -> 'readingRequest'
    end
  )
  returning id into v_feed_id;

  insert into public.served_feed_item (
    feed_id, reel_id, delivered_rank, score, source_ranker_id, source_rank,
    credited_algorithm_id, candidate_source, explanations
  )
  select
    v_feed_id,
    (item ->> 'reelId')::uuid,
    (item ->> 'deliveredRank')::integer,
    nullif(item ->> 'score', '')::numeric,
    nullif(item ->> 'sourceRankerId', ''),
    nullif(item ->> 'sourceRank', '')::integer,
    nullif(item ->> 'creditedAlgorithmId', ''),
    nullif(item ->> 'candidateSource', ''),
    case
      when jsonb_typeof(item -> 'explanations') = 'array' then item -> 'explanations'
      else '[]'::jsonb
    end
  from jsonb_array_elements(p_items) as item
  where (item ->> 'reelId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict do nothing;

  return v_feed_id;
end;
$$;
