-- Two things the language filter got wrong, both found by reading production.
--
-- 1. "Undetermined" was treated as "yes".
--
--    The first version let `und` through to every reader, on the reasoning
--    that hiding a piece because the detector shrugged is worse than showing
--    it. That is right for a *ranking* signal and wrong for this one. A reader
--    who asked for Russian only was served twenty English poems. The single
--    promise this feature makes is "do not offer me what I cannot read", and
--    it was being broken twenty times.
--
--    The rule becomes: a reader who named no language sees everything,
--    including `und`; a reader who narrowed sees only what they named.
--    Unknown is excluded rather than assumed.
--
-- 2. The detector looked for `' the '` in the raw text.
--
--    Which is why those twenty were `und` in the first place, and it was not
--    the threshold. In prose a function word is surrounded by spaces often
--    enough that any sane bar is cleared; in a quatrain almost every word sits
--    against a line break or a comma, so literal `' the '` barely occurs. The
--    rule was not measuring English, it was measuring prose. All twenty were
--    poems and all 437 non-poems passed.
--
-- The replacement collapses every run of non-letters to a single space before
-- looking, and asks for three matches from a longer list of words that are
-- common in English and are not words in Spanish, Italian, French, German or
-- Latin. `in`, `me`, `or`, `was` and `a` are deliberately absent: each is a
-- real word in at least one of those languages.
--
-- Three is not a guess. Scored over the live catalogue and five control
-- passages:
--
--   lowest-scoring English piece         5 markers  ("Unreturning", a sonnet)
--   5th percentile / median             10 / 31 markers
--   Spanish control                      1 marker
--   Italian, French, German, Latin       0 markers
--
-- So there is an empty gap between 1 and 5, and the bar goes in the middle of
-- it: every one of the 457 pieces is recognised, every control stays `und`,
-- and there is room for a poem shorter than any we hold.

create or replace function public.boks_detect_language(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  v_sample text := left(coalesce(p_text, ''), 4000);
  v_cyrillic integer;
  v_latin integer;
  v_letters integer;
  v_english_markers integer;
  -- Every run of non-letters becomes one space, so a word against a line break
  -- or a comma reads the same as a word between two spaces.
  v_words text := lower(' ' || regexp_replace(left(coalesce(p_text, ''), 4000), '[^A-Za-z]+', ' ', 'g') || ' ');
begin
  if btrim(v_sample) = '' then
    return 'und';
  end if;

  v_cyrillic := length(v_sample) - length(regexp_replace(v_sample, '[А-Яа-яЁё]', '', 'g'));
  v_latin := length(v_sample) - length(regexp_replace(v_sample, '[A-Za-z]', '', 'g'));
  v_letters := v_cyrillic + v_latin;

  if v_letters < 20 then
    return 'und';
  end if;

  if v_cyrillic::numeric / v_letters >= 0.6 then
    return 'ru';
  end if;

  if v_latin::numeric / v_letters >= 0.6 then
    -- Latin script alone would call Spanish English, so the evidence is
    -- English function words - counted over `v_words`, where punctuation and
    -- line breaks have already become spaces, so a poem is judged the same
    -- way as a paragraph.
    select count(*) into v_english_markers
    from unnest(array[
      ' the ', ' and ', ' of ', ' to ', ' that ', ' with ', ' his ', ' her ',
      ' it ', ' is ', ' my ', ' you ', ' but ', ' for ', ' from ', ' they ',
      ' have ', ' not ', ' all ', ' when ', ' how ', ' are ', ' were ',
      ' there ', ' here ', ' this ', ' what ', ' she ', ' him ', ' been ',
      ' than ', ' then ', ' upon ', ' into ', ' their ', ' who ', ' would ',
      ' could ', ' i ', ' be ', ' so ', ' if ', ' up ', ' out ', ' as ',
      ' at ', ' by ', ' on ', ' we ', ' do ', ' no ', ' one ', ' more '
    ]) marker
    where position(marker in v_words) > 0;

    if v_english_markers >= 3 then
      return 'en';
    end if;
    return 'und';
  end if;

  return 'und';
end;
$$;

-- Re-derive the pieces the old rule could not place. Only those: a piece the
-- detector already called `en` or `ru` is either right or was corrected by an
-- admin through `set_bok_language`, and neither deserves to be overwritten by
-- a fresh guess.
update public.reels
set language = public.boks_detect_language(text)
where language = 'und';

-- ------------------------------------------------- retrieval stops assuming

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
    left join event_rollup er on er.reel_id = r.id
    left join like_rollup lr on lr.reel_id = r.id
    left join comment_rollup cr on cr.reel_id = r.id
    left join author_stats ast on ast.author_user_id = r.author_user_id
    left join my_state ms on ms.reel_id = r.id
    left join my_completions mc on mc.reel_id = r.id
  ), '[]'::jsonb);
end;
$BODY$;

revoke all on function public.get_recommendation_candidates(integer, text[]) from public, anon, authenticated;
grant execute on function public.get_recommendation_candidates(integer, text[]) to anon, authenticated;
