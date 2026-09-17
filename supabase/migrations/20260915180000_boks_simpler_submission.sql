-- boks: a simpler submission
--
-- Writing a bok asked four questions that the writer should not have to answer:
-- a genre, a mood, and a byline they had already given once as their @nickname.
--
-- After this migration:
--
--   * `reels.author_name` is optional. Every boks is attributed by its author's
--     @handle, which is joined from the profile; a byline is an *addition* a
--     writer may want, not something the form demands.
--   * genre and mood are no longer asked for. The columns stay because the
--     ranking reads them, and they take a neutral default.
--   * the 15-minute promise is enforced as a character ceiling, in the database
--     rather than only in the form.
--
-- A consequence worth stating rather than discovering: `tasteMatch` in the
-- ranker is built from a reader's genre and mood affinity. With every new boks
-- carrying the same default, that signal has one bucket to learn from and goes
-- flat, which makes the `taste_match` strategy inert for anything published
-- from now on. It was already constant for a cold reader. The fix is to derive
-- genre and mood from the text the way `reading_shape` already is - not to put
-- the pickers back.

-- --------------------------------------------------- the 15 minute ceiling

-- 15 minutes at 238 words per minute is about 3,570 words. An English word
-- with its trailing space averages close to 5.7 characters, which puts the
-- promise near 20,000. Characters rather than words because this has to hold at
-- the edge of the system, where a check constraint and a request-size limit can
-- enforce it cheaply and identically every time; `minutes` continues to be
-- derived from the real word count, which is the better measure of reading time.
create or replace function public.boks_max_text_characters()
returns integer
language sql
immutable
as $$
  select 20000;
$$;

grant execute on function public.boks_max_text_characters() to anon, authenticated;

alter table public.reels
  drop constraint if exists reels_text_within_fifteen_minutes,
  add constraint reels_text_within_fifteen_minutes
    check (char_length(text) <= 20000);

comment on constraint reels_text_within_fifteen_minutes on public.reels is
  'The 15-minute promise, enforced at the edge. 20000 characters is 15 minutes at 238 words per minute; see boks_max_text_characters().';

-- -------------------------------------------------- the byline is optional

alter table public.reels
  alter column author_name drop not null;

-- A byline that was only ever the author's own @nickname is not a byline; it is
-- the attribution the reader already gets. Clear those so the form starts empty
-- for authors who never chose a name.
update public.reels r
set author_name = null
where r.author_user_id is not null
  and r.author_name = '@' || (
    select i.handle from public.boks_public_identity i where i.user_id = r.author_user_id
  );

comment on column public.reels.author_name is
  'Optional byline for this boks - a pen name the author chose for this piece. Null means the reader sees only the @handle, which is always joined from the profile. Deliberately independent of the account: changing your @nickname never rewrites work you already published.';

-- Seeded boks have no account, so their byline is the only attribution they
-- have and must stay.
alter table public.reels
  drop constraint if exists reels_authorless_boks_has_a_byline,
  add constraint reels_authorless_boks_has_a_byline
    check (author_user_id is not null or author_name is not null);

-- ------------------------------------------------------- published view

drop view if exists public.published_boks;
drop view if exists public.boks_reels;

create or replace view public.boks_reels as
select
  r.id, r.title, r.hook, r.text, r.genre, r.mood, r.minutes, r.status,
  r.is_seed, r.created_at, r.updated_at, r.author_user_id, r.submitted_at,
  r.reviewed_at, r.reviewed_by, r.review_note, r.word_count, r.reading_shape,
  r.line_break_count,
  -- Null when the author never chose one. The reader renders the @handle
  -- either way, so the caller decides whether to show a name at all.
  r.author_name,
  coalesce(i.handle, r.author_handle, '') as author_handle
from public.reels r
left join public.boks_public_identity i on i.user_id = r.author_user_id;

revoke all on public.boks_reels from public, anon, authenticated;

create or replace view public.published_boks as
select
  b.id, b.title, b.author_name, b.author_handle, b.author_user_id, b.hook,
  b.text, b.genre, b.mood, b.minutes, b.word_count, b.reading_shape,
  b.line_break_count, b.created_at
from public.boks_reels b
where b.status = 'published';

revoke all on public.published_boks from public;
grant select on public.published_boks to anon, authenticated;

-- ------------------------------------------------ what the form starts with

-- Empty for a first-time author, because the field is optional now. Only a
-- byline the author actually chose before is worth pre-filling.
create or replace function public.get_my_default_author_name()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
begin
  if v_uid is null then
    return '';
  end if;

  select r.author_name into v_name
  from public.reels r
  where r.author_user_id = v_uid and btrim(coalesce(r.author_name, '')) <> ''
  order by coalesce(r.submitted_at, r.created_at) desc, r.id desc
  limit 1;

  return coalesce(v_name, '');
end;
$$;

revoke all on function public.get_my_default_author_name() from public, anon, authenticated;
grant execute on function public.get_my_default_author_name() to authenticated;


-- ----------------------------------------------------------- submission

drop function if exists public.submit_bok_for_review(text, text, text, text, text, integer, text);

create or replace function public.submit_bok_for_review(
  p_title text,
  p_hook text,
  p_text text,
  p_genre text default '',
  p_mood text default '',
  p_minutes integer default 0,
  p_author_name text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_text text := nullif(trim(coalesce(p_text, '')), '');
  v_hook text := trim(coalesce(p_hook, ''));
  v_genre text := coalesce(nullif(trim(coalesce(p_genre, '')), ''), 'literary');
  v_mood text := coalesce(nullif(trim(coalesce(p_mood, '')), ''), 'quiet');
  v_words integer;
  v_limit integer := public.boks_daily_submission_limit();
  v_used integer;
  v_author_name text;
  v_author_handle text;
  v_bok public.reels;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required to submit a bok.' using errcode = '42501';
  end if;

  if v_title is null then
    raise exception 'Title is required.' using errcode = '22023';
  end if;

  if v_text is null then
    raise exception 'Story text is required.' using errcode = '22023';
  end if;

  v_words := public.boks_word_count(v_text);

  if char_length(v_text) > public.boks_max_text_characters() then
    raise exception 'A bok must fit inside 15 minutes. This one is % characters; the limit is %.',
      char_length(v_text), public.boks_max_text_characters() using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile('');

  -- Held for the duration so the daily-limit check below is serialised per
  -- author.
  perform 1 from public.user_profiles where user_id = v_uid for update;

  -- The byline for this piece. An author may publish under a pen name, and a
  -- different one next time; what they used last is only the default.
  -- Optional. Empty means the reader sees only the @handle, which is the
  -- attribution every boks already has.
  v_author_name := left(nullif(btrim(coalesce(p_author_name, '')), ''), 120);

  v_used := public.count_my_boks_submitted_today();

  if v_used >= v_limit then
    raise exception 'Daily limit reached. You can submit % boks a day.', v_limit using errcode = '54023';
  end if;

  insert into public.reels (
    title, author_name, hook, text, genre, mood, minutes,
    status, author_user_id, submitted_at, updated_at
  )
  values (
    v_title, v_author_name, left(v_hook, 500), v_text,
    left(v_genre, 30), left(v_mood, 30), public.boks_reading_minutes(v_words),
    'pending_review', v_uid, now(), now()
  )
  returning * into v_bok;

  select author_handle into v_author_handle from public.boks_reels where id = v_bok.id;

  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'authorName', v_author_name,
    'authorHandle', v_author_handle,
    'minutes', v_bok.minutes,
    'wordCount', v_bok.word_count,
    'submittedAt', v_bok.submitted_at,
    'quota', public.get_my_bok_quota()
  );
end;
$function$;

revoke all on function public.submit_bok_for_review(text, text, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, integer, text) to authenticated;


-- --------------------------------------------------------- your own boks

-- Adds the two numbers an author actually wants: who liked it and who replied.
create or replace function public.get_my_bok_submissions(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  if v_uid is null or v_is_anonymous then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id::text,
      'title', r.title,
      'hook', r.hook,
      'body', r.text,
      'genre', r.genre,
      'mood', r.mood,
      'authorName', coalesce(r.author_name, ''),
      'minutes', r.minutes,
      'wordCount', coalesce(r.word_count, 0),
      -- How the piece is doing, so an author does not have to open the reader
      -- and find their own boks to learn whether anyone responded.
      'likes', (select count(*)::integer from public.likes l where l.reel_id = r.id),
      'comments', (select count(*)::integer from public.comments c where c.reel_id = r.id),
      'publishedAt', case when r.status = 'published' then r.reviewed_at else null end,
      'status', r.status,
      'submittedAt', r.submitted_at,
      'reviewedAt', r.reviewed_at,
      'reviewNote', r.review_note,
      'createdAt', r.created_at
    ) order by r.created_at desc)
    from (
      select *
      from public.reels
      where author_user_id = v_uid
      order by created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) r
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_my_bok_submissions(integer) from public, anon, authenticated;
grant execute on function public.get_my_bok_submissions(integer) to authenticated;
