-- boks honest length
--
-- `reels.minutes` was whatever the submitter sent. The seeded catalog claims
-- 5-9 minutes for boks of 68-92 words - about twenty seconds of reading. Three
-- things break when the claim and the content disagree:
--
--   * the reader is promised "9 min" and gets twenty seconds, which is the one
--     promise this product makes;
--   * the 15 minute limit is enforced against a number the author chose, so it
--     enforces nothing;
--   * every length-derived figure in the console is describing fiction.
--
-- Length is now derived from the text, on every insert and every edit. It is a
-- measurement, not a declaration.

create or replace function public.boks_reading_minutes(p_words integer)
returns integer
language sql
immutable
as $$
  -- 238 words per minute, the usual figure for adult prose reading.
  select greatest(1, least(15, ceil(greatest(coalesce(p_words, 0), 1) / 238.0)::integer));
$$;

grant execute on function public.boks_reading_minutes(integer) to authenticated;

create or replace function public.boks_set_reel_word_count()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.word_count := public.boks_word_count(new.text);
  new.minutes := public.boks_reading_minutes(new.word_count);
  -- Handles are stored bare; the '@' belongs to the presentation.
  new.author_handle := ltrim(coalesce(new.author_handle, ''), '@');
  return new;
end;
$$;

drop trigger if exists reels_word_count on public.reels;
create trigger reels_word_count
before insert or update of text, author_handle on public.reels
for each row execute function public.boks_set_reel_word_count();

update public.reels
set
  word_count = public.boks_word_count(text),
  minutes = public.boks_reading_minutes(public.boks_word_count(text)),
  author_handle = ltrim(coalesce(author_handle, ''), '@');

-- The submitted minute count is no longer read: the text decides. The 15 minute
-- rule is now checked against the words on the page.
create or replace function public.submit_bok_for_review(
  p_title text,
  p_hook text,
  p_text text,
  p_genre text,
  p_mood text,
  p_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  if v_words > 15 * 238 then
    raise exception 'A bok must fit inside 15 minutes. This one is % words, about % minutes.',
      v_words, ceil(v_words / 238.0)::integer using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile('');

  select
    coalesce(nullif(btrim(display_name), ''), 'boks author'),
    coalesce(handle, '')
  into v_author_name, v_author_handle
  from public.user_profiles
  where user_id = v_uid
  for update;

  v_used := public.count_my_boks_submitted_today();

  if v_used >= v_limit then
    raise exception 'Daily limit reached. You can submit % boks a day.', v_limit using errcode = '54023';
  end if;

  insert into public.reels (
    title, author_name, author_handle, hook, text, genre, mood, minutes,
    status, author_user_id, submitted_at, updated_at
  )
  values (
    v_title, left(v_author_name, 120), left(v_author_handle, 80), left(v_hook, 500), v_text,
    left(v_genre, 30), left(v_mood, 30), public.boks_reading_minutes(v_words),
    'pending_review', v_uid, now(), now()
  )
  returning * into v_bok;

  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'authorName', v_bok.author_name,
    'authorHandle', v_bok.author_handle,
    'minutes', v_bok.minutes,
    'wordCount', v_bok.word_count,
    'submittedAt', v_bok.submitted_at,
    'quota', public.get_my_bok_quota()
  );
end;
$$;

revoke all on function public.submit_bok_for_review(text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, integer) to authenticated;
