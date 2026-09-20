-- The opening hook is gone, and a title is optional.
--
-- The hook was a second, shorter text an author wrote to sell the first. It
-- sat between the title and the piece in the reader and read as a stray
-- paragraph; one boks in 907 had one. It is retired: the column stays, always
-- empty, so every view and RPC that selects it keeps working, and a trigger
-- makes sure nothing - the author form, a catalogue import, an old browser tab
-- still sending `p_hook` - can put text back into it.
--
-- A title left empty now becomes the text's first line, the way an untitled
-- poem is known by its opening line. The same trigger applies it, so it holds
-- on every write path, and `lib/boks/bok-title.ts` mirrors the rule so an
-- author sees the title they are about to get. Shared vectors in
-- `lib/boks/bok-title.test.ts` and `scripts/local-supabase/checks.sql` hold
-- the two together.

create or replace function public.boks_title_from_text(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_max constant integer := 80;
  -- A verse line's comma, a dash that runs on: punctuation a line breaks on.
  v_trailing constant text := '[[:space:],;:—–-]+$';
  -- A dialogue dash or a bullet in front of the words.
  v_leading constant text := '^[[:space:]*•·—–-]+';
  -- Anything that is not whitespace or one of these makes a line words rather
  -- than a divider such as `* * *`.
  v_word constant text := '[^][:space:]*•·.,;:!?…—–_=~#"''«»()[-]';
  v_line text;
  v_head text;
  v_at_word text;
begin
  select cleaned
  into v_line
  from (
    select btrim(regexp_replace(raw_line, '[[:space:]]+', ' ', 'g'), ' ') as cleaned, n
    from regexp_split_to_table(
      replace(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E'\r', E'\n'),
      E'\n'
    ) with ordinality as t(raw_line, n)
  ) lines
  where cleaned ~ v_word
  order by n
  limit 1;

  if v_line is null then
    return '';
  end if;

  v_line := regexp_replace(regexp_replace(v_line, v_leading, ''), v_trailing, '');
  if char_length(v_line) <= v_max then
    return v_line;
  end if;

  -- Up to the last whole word within the limit, looking one character past it
  -- so a word ending exactly on the limit is kept; otherwise a hard cut.
  v_head := left(v_line, v_max + 1);
  v_at_word := regexp_replace(v_head, '[[:space:]]+[^[:space:]]*$', '');
  if char_length(v_at_word) < char_length(v_head) and char_length(v_at_word) >= v_max / 2 then
    return regexp_replace(v_at_word, v_trailing, '') || '…';
  end if;
  return regexp_replace(left(v_line, v_max), v_trailing, '') || '…';
end;
$$;

comment on function public.boks_title_from_text(text) is
  'The title a boks gets when its author leaves it empty: the first line with words on it, cut at a word past 80 characters. Mirrored by lib/boks/bok-title.ts.';

create or replace function public.boks_reels_title_and_hook()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Retired: see the header of this migration.
  new.hook := '';
  if btrim(coalesce(new.title, '')) = '' then
    new.title := public.boks_title_from_text(new.text);
  else
    new.title := btrim(new.title);
  end if;
  return new;
end;
$$;

drop trigger if exists boks_reels_title_and_hook on public.reels;
create trigger boks_reels_title_and_hook
  before insert or update of title, hook, text on public.reels
  for each row execute function public.boks_reels_title_and_hook();

-- The hooks already stored are dropped, as agreed: extra data, not content.
update public.reels set hook = '' where hook <> '';


-- Submission: the title is optional and the hook is ignored. The signature is
-- unchanged apart from defaults, so a browser tab loaded before this release,
-- which still sends `p_hook` and a title, keeps working; the current form
-- sends neither when the author leaves them out.
create or replace function public.submit_bok_for_review(
  p_title text default '',
  p_hook text default '',
  p_text text default '',
  p_genre text default '',
  p_mood text default '',
  p_minutes integer default 0,
  p_author_name text default '',
  p_rights_confirmed boolean default false,
  p_rights_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_text text := nullif(trim(coalesce(p_text, '')), '');
  v_title text;
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

  if v_text is null then
    raise exception 'Text is required.' using errcode = '22023';
  end if;

  -- The author's title, or the text's first line.
  v_title := coalesce(nullif(trim(coalesce(p_title, '')), ''), public.boks_title_from_text(v_text));
  if v_title = '' then
    raise exception 'The text needs at least one line with words in it.' using errcode = '22023';
  end if;

  if coalesce(p_rights_confirmed, false) is not true then
    raise exception 'Confirm you hold the rights to publish this bok.' using errcode = '22023';
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

  -- The byline for this piece. Optional: empty means the reader sees only the
  -- @handle, which is the attribution every boks already has.
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
    v_title, v_author_name, '', v_text,
    left(v_genre, 30), left(v_mood, 30), public.boks_reading_minutes(v_words),
    'pending_review', v_uid, now(), now()
  )
  returning * into v_bok;

  insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
  values (v_bok.id, true, nullif(btrim(coalesce(p_rights_note, '')), ''), v_uid, now(), now())
  on conflict (reel_id) do update
  set confirmed = true,
      note = excluded.note,
      confirmed_by = excluded.confirmed_by,
      confirmed_at = now(),
      updated_at = now();

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
$$;

revoke all on function public.submit_bok_for_review(text, text, text, text, text, integer, text, boolean, text) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, integer, text, boolean, text) to authenticated;
