-- Embeddings: the SEMANTIC source the ranker was written around but never had.
--
-- `for_you` is a port of the original backend's ranker, and its own header
-- records the gap: "No SEMANTIC source. The original retrieved by embedding
-- similarity to a reader's positive and negative taste vectors. That needs an
-- embedding provider and a per-user budget." This migration provides it, with
-- no per-user budget and no third party: the vectors are produced by
-- Supabase's own `gte-small` model inside the `embed` Edge Function (384
-- dimensions, normalised), stored in `reels.embedding`, and compared here.
--
-- Two numbers reach the ranker per candidate, and both are computed in the
-- database because the vectors must not travel: 200 candidates times 384
-- floats is half a megabyte per feed request.
--
--  - `tasteSimilarity` - cosine similarity between the candidate and the
--    reader's taste vector (the mean embedding of what they liked or finished,
--    a like counted twice). Exploit.
--  - `noveltyDistance` - cosine distance from the mean of what they have been
--    reading in this stretch. Explore: it is how a reader gets out of a rut of
--    twenty near-identical lyric poems, which behavioural signals cannot see
--    because genre and mood are three words and a guess.
--
-- The taste vector is computed per request rather than stored. At this size
-- (hundreds of boks, tens of readers) the aggregate is trivial, and a stored
-- vector would need invalidation on every like, read and re-embedding - a
-- staleness bug that would be invisible in the ranking it corrupts.

create extension if not exists vector with schema extensions;

alter table public.reels
  add column if not exists embedding extensions.vector(384),
  add column if not exists embedding_model text,
  add column if not exists embedded_at timestamptz;

comment on column public.reels.embedding is
  'Semantic vector of title + opening text, produced by the embed Edge Function (gte-small, 384 dimensions, normalised). Null means not embedded yet; the ranker then falls back to behavioural signals alone.';

-- Cosine, because the model normalises and the ranker asks about direction.
create index if not exists reels_embedding_cosine
  on public.reels using hnsw (embedding extensions.vector_cosine_ops);

-- An edited text is a different text. Without this, a revised bok keeps the
-- vector of the words it no longer contains, and nothing in the ranking looks
-- wrong while it recommends the wrong piece.
create or replace function public.boks_reels_clear_stale_embedding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.text is distinct from old.text then
    new.embedding := null;
    new.embedding_model := null;
    new.embedded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists boks_reels_clear_stale_embedding on public.reels;
create trigger boks_reels_clear_stale_embedding
  before update of text on public.reels
  for each row execute function public.boks_reels_clear_stale_embedding();


-- What the Edge Function reads. Kept as a function so the rule for "needs an
-- embedding" lives in one place: published or waiting for review, has text,
-- and either never embedded or embedded before its last edit.
create or replace function public.get_boks_needing_embedding(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id::text, 'title', t.title, 'text', t.text))
    from (
      select r.id, r.title, r.text
      from public.reels r
      where r.embedding is null
        and r.status in ('published', 'pending_review')
        and coalesce(btrim(r.text), '') <> ''
      order by r.created_at
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_boks_needing_embedding(integer) from public, anon, authenticated;
grant execute on function public.get_boks_needing_embedding(integer) to service_role;


-- Where the Edge Function writes. A plain update would do - the function holds
-- the service role - but the dimension check belongs on the database side of
-- the boundary: a model swapped for one with 768 dimensions must fail loudly
-- here rather than silently store vectors no query can compare.
create or replace function public.set_bok_embedding(
  p_reel_id uuid,
  p_embedding jsonb,
  p_model text default 'gte-small'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dims integer;
  v_model text := coalesce(nullif(btrim(coalesce(p_model, '')), ''), 'gte-small');
begin
  if p_embedding is null or jsonb_typeof(p_embedding) <> 'array' then
    raise exception 'An embedding must be a JSON array of numbers.' using errcode = '22023';
  end if;

  v_dims := jsonb_array_length(p_embedding);
  if v_dims <> 384 then
    raise exception 'An embedding must have 384 dimensions; this one has %.', v_dims using errcode = '22023';
  end if;

  update public.reels
  set embedding = (p_embedding::text)::extensions.vector(384),
      embedding_model = v_model,
      embedded_at = now()
  where id = p_reel_id;

  if not found then
    raise exception 'No bok with id %.', p_reel_id using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', p_reel_id::text, 'model', v_model, 'dimensions', v_dims);
end;
$$;

revoke all on function public.set_bok_embedding(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.set_bok_embedding(uuid, jsonb, text) to service_role;


-- Coverage, for the admin console and for whoever has to answer "is the
-- semantic side actually on?" after a deploy. Counts only; nothing private.
create or replace function public.boks_embedding_coverage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'publishedTotal', count(*) filter (where r.status = 'published'),
    'publishedEmbedded', count(*) filter (where r.status = 'published' and r.embedding is not null),
    'publishedMissing', count(*) filter (where r.status = 'published' and r.embedding is null),
    'pendingMissing', count(*) filter (where r.status = 'pending_review' and r.embedding is null),
    'models', coalesce(jsonb_agg(distinct r.embedding_model) filter (where r.embedding_model is not null), '[]'::jsonb),
    'lastEmbeddedAt', max(r.embedded_at)
  )
  from public.reels r;
$$;

revoke all on function public.boks_embedding_coverage() from public;
grant execute on function public.boks_embedding_coverage() to anon, authenticated, service_role;


-- The candidate set, now carrying the two semantic numbers. Everything else is
-- unchanged from `20260918100000`; the additions are `my_taste`, `my_recent`,
-- the join to `public.reels` (the view predates the column) and three fields
-- per candidate.
create or replace function public.get_recommendation_candidates(
  p_limit integer default 200,
  p_languages text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
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
  return coalesce((
    with published as (
      -- The language filter lives here, in retrieval, so the ranker cannot
      -- score a piece the reader could not read - and so the
      -- catalogue-headroom figures count only what was ever eligible.
      -- `und` stays eligible for everyone: hiding a piece because the
      -- detector shrugged is worse than showing it.
      select r.* from public.boks_reels r
      where r.status = 'published'
        and (
          v_languages is null
          or cardinality(v_languages) = 0
          or coalesce(r.language, 'und') = 'und'
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
        union all
        select re.embedding
        from public.likes l
        join public.reels re on re.id = l.reel_id
        where v_uid is not null and l.user_id = v_uid and re.embedding is not null
        union all
        select re.embedding
        from public.recommendation_events e
        join public.reels re on re.id = e.reel_id
        where v_uid is not null and e.user_id = v_uid and e.event_type = 'complete'
          and e.created_at >= v_since and re.embedding is not null
      ) sample
    ),
    -- What this reader has been reading lately, which is what novelty is
    -- measured against. Deliberately short: a rut is recent by definition.
    my_recent as (
      select avg(sample.embedding) as embedding
      from (
        select re.embedding
        from public.recommendation_events e
        join public.reels re on re.id = e.reel_id
        where v_uid is not null and e.user_id = v_uid and e.surface = 'reader'
          and re.embedding is not null
        order by e.created_at desc
        limit 24
      ) sample
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
      'hasEmbedding', re.embedding is not null,
      'tasteSamples', coalesce(mt.samples, 0),
      'tasteSimilarity', case
        when re.embedding is not null and mt.embedding is not null
          then round((1 - (re.embedding <=> mt.embedding))::numeric, 4)
        else null
      end,
      'noveltyDistance', case
        when re.embedding is not null and mr.embedding is not null
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
$BODY$;

comment on function public.get_recommendation_candidates(integer, text[]) is
  'The candidate set for one reader, with rollups, that reader''s own history, and the two semantic numbers (tasteSimilarity, noveltyDistance) measured against their embedding vectors.';
