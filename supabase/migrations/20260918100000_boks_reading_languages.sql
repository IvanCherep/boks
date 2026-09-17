-- Reading languages.
--
-- The catalogue will hold Russian and English. Readers fall into three groups
-- and all three have to be comfortable: people who read only English, people
-- who read only Russian, and people who read both. Showing someone a piece in
-- a language they cannot read is not a bad recommendation, it is not a
-- recommendation at all.
--
-- Two mechanisms, deliberately separate:
--
--   * **A hard filter** - which languages are eligible for this reader. "I do
--     not read Russian" is not a preference, it is a capability, and no score
--     may outvote it. So it is applied in retrieval, where the ranker cannot
--     see what it filtered: a ranker that could rank ineligible pieces would
--     also report a catalogue-headroom figure that counts them.
--   * **The ranker's existing affinity** - which of the eligible languages a
--     reader actually finishes. That needs no new machinery.
--
-- The language of a piece is derived from its text and never asked of the
-- author. This is the same principle that removed the genre and mood pickers,
-- applied where it works: an author guesses at genre, but nobody has to guess
-- which script their own prose is in.

-- ------------------------------------------------------------ the derivation

/**
 * The language of a piece, as a primary subtag.
 *
 * Be clear about what this does: it tells **scripts** apart, not languages.
 * Cyrillic against Latin settles Russian from English on prose essentially
 * every time, which is the whole of the catalogue today. It cannot tell
 * Russian from Ukrainian, and to keep it from confidently calling Spanish
 * English it asks for a handful of English function words before it says
 * `en`.
 *
 * Anything it cannot place is `und`, and `und` stays eligible for everyone:
 * hiding a piece because a classifier shrugged is worse than showing it, and
 * the console lists them so they can be corrected. The day the catalogue holds
 * a third language, this function is the one place to improve.
 */
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
    -- Latin script alone would call Spanish English. Common English function
    -- words are cheap evidence and make the classifier admit ignorance
    -- instead of guessing.
    select count(*) into v_english_markers
    from unnest(array[' the ', ' and ', ' of ', ' to ', ' that ', ' was ', ' with ', ' his ', ' her ', ' it ']) marker
    where position(marker in lower(' ' || v_sample || ' ')) > 0;

    if v_english_markers >= 3 then
      return 'en';
    end if;
    return 'und';
  end if;

  return 'und';
end;
$$;

comment on function public.boks_detect_language(text) is
  'Primary language subtag of a boks, derived from its text. Distinguishes scripts rather than languages; returns und when unsure, and und stays eligible for every reader.';

alter table public.reels
  add column if not exists language text;

comment on column public.reels.language is
  'Derived from the text by boks_detect_language. Never asked of the author; correctable by an admin.';

create index if not exists reels_language_status_idx
  on public.reels (language, status)
  where status = 'published';

/** The same trigger that derives length now derives language. */
create or replace function public.boks_set_reel_word_count()
returns trigger
language plpgsql
as $$
begin
  new.word_count := public.boks_word_count(new.text);
  new.minutes := public.boks_reading_minutes(new.word_count);
  new.reading_shape := public.boks_reading_shape(new.text);
  new.line_break_count := length(coalesce(new.text, '')) - length(replace(coalesce(new.text, ''), E'\n', ''));
  -- An admin may correct a language; a rewrite of the text re-derives it.
  if new.language is null or (tg_op = 'UPDATE' and new.text is distinct from old.text) then
    new.language := public.boks_detect_language(new.text);
  end if;
  -- Handles are stored bare; the '@' belongs to the presentation.
  new.author_handle := nullif(ltrim(coalesce(new.author_handle, ''), '@'), '');
  return new;
end;
$$;

update public.reels
set language = public.boks_detect_language(text)
where language is null;

-- --------------------------------------------------------- the reader's side

alter table public.user_profiles
  add column if not exists reading_languages text[];

comment on column public.user_profiles.reading_languages is
  'Languages this reader accepts, as primary subtags. Null or empty means they have not said, and everything is eligible.';

/**
 * The reader states which languages they read.
 *
 * An empty array means "all", not "none": a filter that can silently empty the
 * feed has to be impossible to set by accident. Unknown subtags are dropped
 * rather than stored, so a typo cannot hide the catalogue.
 */
create or replace function public.set_my_reading_languages(p_languages text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_clean text[];
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select array_agg(distinct lang order by lang) into v_clean
  from unnest(coalesce(p_languages, array[]::text[])) raw
  cross join lateral (select lower(btrim(split_part(raw, '-', 1))) as lang) normalised
  where lang in ('en', 'ru');

  perform public.ensure_boks_user_profile('');

  update public.user_profiles
  set reading_languages = coalesce(v_clean, array[]::text[]),
      updated_at = now()
  where user_id = v_uid;

  return jsonb_build_object(
    'readingLanguages', coalesce(v_clean, array[]::text[]),
    'catalogue', public.boks_language_coverage()
  );
end;
$$;

/**
 * How much of the catalogue each language holds.
 *
 * The reader's side needs it to say "there are no Russian boks yet" honestly
 * rather than showing an empty feed, and the console needs it beside the
 * number of readers asking for each language - that gap is the whole
 * content-acquisition signal.
 */
create or replace function public.boks_language_coverage()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(coalesce(language, 'und'), n), '{}'::jsonb)
  from (
    select language, count(*)::integer as n
    from public.reels
    where status = 'published'
    group by language
  ) counts;
$$;

revoke all on function public.set_my_reading_languages(text[]) from public, anon, authenticated;
grant execute on function public.set_my_reading_languages(text[]) to authenticated;
revoke all on function public.boks_language_coverage() from public, anon, authenticated;
grant execute on function public.boks_language_coverage() to anon, authenticated;
revoke all on function public.boks_detect_language(text) from public, anon, authenticated;
grant execute on function public.boks_detect_language(text) to authenticated;

/** Lets an admin correct a language the detector placed wrongly. */
create or replace function public.set_bok_language(p_reel_id uuid, p_language text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_language text := lower(btrim(split_part(coalesce(p_language, ''), '-', 1)));
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_language not in ('en', 'ru', 'und') then
    raise exception 'Language must be en, ru or und.' using errcode = '22023';
  end if;

  update public.reels set language = v_language, updated_at = now() where id = p_reel_id;

  return jsonb_build_object('reelId', p_reel_id::text, 'language', v_language);
end;
$$;

revoke all on function public.set_bok_language(uuid, text) from public, anon, authenticated;
grant execute on function public.set_bok_language(uuid, text) to authenticated;

-- ------------------------------------------------- language reaches the views

-- Language is a property of the text, not of the account, so it belongs in the
-- reader-facing projection alongside reading shape and length.
-- `create or replace view` may only append columns: changing the position of
-- an existing one is a rename as far as Postgres is concerned. So `language`
-- goes last in both, however it reads.
create or replace view public.boks_reels as
select r.id, r.title, r.hook, r.text, r.genre, r.mood, r.minutes, r.status,
       r.is_seed, r.created_at, r.updated_at, r.author_user_id, r.submitted_at,
       r.reviewed_at, r.reviewed_by, r.review_note, r.word_count,
       r.reading_shape, r.line_break_count, r.author_name,
       coalesce(i.handle, r.author_handle, '') as author_handle,
       r.language
from public.reels r
left join public.boks_public_identity i on i.user_id = r.author_user_id;

create or replace view public.published_boks as
select id, title, author_name, author_handle, author_user_id, hook, text,
       genre, mood, minutes, word_count, reading_shape, line_break_count,
       created_at, language
from public.boks_reels b
where status = 'published';

-- ------------------------------------------------ retrieval honours the filter
--
-- Only the declaration and the retrieval CTE change. The body below is
-- otherwise the deployed function verbatim.

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

revoke all on function public.get_recommendation_candidates(integer) from public, anon, authenticated;
revoke all on function public.get_recommendation_candidates(integer, text[]) from public, anon, authenticated;
grant execute on function public.get_recommendation_candidates(integer, text[]) to anon, authenticated;

-- The one-argument shape would be ambiguous against the new default.
drop function if exists public.get_recommendation_candidates(integer);

-- ------------------------------------------- the context carries the filter
--
-- Only the returned object changes; the body below is otherwise the deployed
-- function verbatim.

create or replace function public.get_boks_user_context()
returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_context jsonb;
begin
  if v_uid is null then
    return jsonb_build_object(
      'userId', null,
      'email', null,
      'isAnonymous', true,
      'role', 'reader',
      'displayName', 'Reader',
      'handle', null,
      'preferredGenre', 'literary',
      'preferredMood', 'quiet',
      'termsAcceptedAt', null,
      'termsVersion', null,
      'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
      'views', 0,
      'likes', 0,
      'readingLanguages', array[]::text[],
      'languageCoverage', public.boks_language_coverage()
    );
  end if;

  select jsonb_build_object(
    'userId', v_uid::text,
    'email', au.email,
    'isAnonymous', v_is_anonymous,
    'role', coalesce(up.role, 'reader'),
    'handle', up.handle,
    'preferredGenre', coalesce(up.preferred_genre, 'literary'),
    'preferredMood', coalesce(up.preferred_mood, 'quiet'),
    'termsAcceptedAt', up.terms_accepted_at,
    'termsVersion', up.terms_version,
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
    'views', (select count(*)::integer from public.views where user_id = v_uid),
    'likes', (select count(*)::integer from public.likes where user_id = v_uid),
    -- The reader's language filter and what the catalogue actually holds, so
    -- the app can say "no Russian boks yet" rather than showing an empty feed.
    'readingLanguages', coalesce(up.reading_languages, array[]::text[]),
    'languageCoverage', public.boks_language_coverage()
  )
  into v_context
  from auth.users au
  left join public.user_profiles up on up.user_id = au.id
  where au.id = v_uid;

  return coalesce(v_context, jsonb_build_object(
    'userId', v_uid::text,
    'email', null,
    'isAnonymous', v_is_anonymous,
    'role', 'reader',
    'displayName', 'Reader',
    'handle', null,
    'preferredGenre', 'literary',
    'preferredMood', 'quiet',
    'termsAcceptedAt', null,
    'termsVersion', null,
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
    'views', 0,
    'likes', 0
  ));
end;
$BODY$;

revoke all on function public.get_boks_user_context() from public, anon, authenticated;
grant execute on function public.get_boks_user_context() to anon, authenticated;

-- ---------------------------------------------- what to acquire next

/**
 * Supply against demand, per language.
 *
 * This is the number that decides what content to get next, and neither half
 * means much alone: 0 Russian boks is only a problem if somebody asked for
 * Russian, and 40 readers asking for Russian is only a problem if there is
 * none. `readersOnly` is the sharp end - those readers currently have an empty
 * app, and the console should be able to say how many they are.
 */
create or replace function public.get_boks_language_demand()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'language', l.language,
      'published', coalesce(c.published, 0),
      'readers', coalesce(d.readers, 0),
      'readersOnly', coalesce(d.readers_only, 0)
    ) order by l.language)
    from (select unnest(array['en', 'ru', 'und']) as language) l
    left join (
      select coalesce(language, 'und') as language, count(*)::integer as published
      from public.reels where status = 'published'
      group by coalesce(language, 'und')
    ) c on c.language = l.language
    left join (
      select
        lang as language,
        count(*)::integer as readers,
        count(*) filter (where cardinality(reading_languages) = 1)::integer as readers_only
      from public.user_profiles p
      cross join lateral unnest(p.reading_languages) as lang
      where p.reading_languages is not null and cardinality(p.reading_languages) > 0
      group by lang
    ) d on d.language = l.language
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_boks_language_demand() from public, anon, authenticated;
grant execute on function public.get_boks_language_demand() to authenticated;
