-- A bok can carry a short summary: one or two sentences saying what it is
-- about and why it is worth the reader's time, shown on its cover.
--
-- Not the retired hook. The hook was a second text an *author* wrote to sell
-- the first, and `boks_reels_title_and_hook` still empties it on every write.
-- A summary is editorial: written for the catalogue, in the language of the
-- text, and set by the catalogue operator. Empty means "none", and the cover
-- shows nothing in its place.

alter table public.reels
  add column if not exists summary text not null default '';

alter table public.reels
  drop constraint if exists reels_summary_length;
alter table public.reels
  add constraint reels_summary_length check (char_length(summary) <= 280);

-- Both views gain the column at the end, which `create or replace view`
-- allows without dropping them or their grants.
create or replace view public.boks_reels as
select r.id, r.title, r.hook, r.text, r.genre, r.mood, r.minutes, r.status,
       r.is_seed, r.created_at, r.updated_at, r.author_user_id, r.submitted_at,
       r.reviewed_at, r.reviewed_by, r.review_note, r.word_count,
       r.reading_shape, r.line_break_count, r.author_name,
       coalesce(i.handle, r.author_handle, '') as author_handle,
       r.language,
       r.summary
from public.reels r
left join public.boks_public_identity i on i.user_id = r.author_user_id;

create or replace view public.published_boks as
select id, title, author_name, author_handle, author_user_id, hook, text,
       genre, mood, minutes, word_count, reading_shape, line_break_count,
       created_at, language, summary
from public.boks_reels b
where status = 'published';

-- Candidates carry the summary so the feed's cover can show it. Only the
-- `'summary'` key is new; the body is otherwise the deployed function
-- verbatim (`20261005110000_boks_event_ingest_and_attribution.sql`).
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
      'summary', re.summary,
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
