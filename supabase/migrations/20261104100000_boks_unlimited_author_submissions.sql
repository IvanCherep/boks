-- boks: an author may submit as much as they have
--
-- The three-a-day limit (20260912150000_boks_author_daily_limit.sql) was there
-- to keep the review queue readable while nobody real was publishing. A real
-- author arrives with a body of work - dozens or hundreds of pieces - and the
-- limit turned that into weeks of coming back. It is removed. What stays:
--
--   * the 15-minute promise (`boks_max_text_characters()`), per piece;
--   * the rights attestation, per piece;
--   * admin approval before anything is published.
--
-- Two guards replace what the limit incidentally provided:
--
--   * the same text cannot be sent twice by the same author while the first
--     copy is waiting or published - with many files in a batch, the same one
--     chosen twice is the common mistake, and the admin would review it twice;
--   * the cabinet reads its history a page at a time
--     (`get_my_bok_submissions_page`), with counts per status and a title
--     search, instead of the newest 50 with every full text attached.
--
-- `get_my_bok_quota` stays callable for tabs still running the previous
-- client, and now says there is no limit. `boks_daily_submission_limit()` is
-- left in place but nothing reads it.

-- ------------------------------------------------------------ submission

create or replace function public.submit_bok_for_review(
  p_title text default '',
  p_hook text default '',
  p_text text default '',
  p_genre text default '',
  p_mood text default '',
  p_minutes integer default 0,
  p_author_name text default '',
  p_rights_confirmed boolean default false,
  p_rights_note text default '',
  p_bok_id uuid default null
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

  -- Serialises this author's submissions, so two parallel sends of the same
  -- file cannot both pass the duplicate check below.
  perform 1 from public.user_profiles where user_id = v_uid for update;

  if exists (
    select 1
    from public.reels r
    where r.author_user_id = v_uid
      and r.status in ('pending_review', 'published')
      and r.id is distinct from p_bok_id
      and r.text = v_text
  ) then
    raise exception 'You have already submitted this exact text.' using errcode = '23505';
  end if;

  v_author_name := left(nullif(btrim(coalesce(p_author_name, '')), ''), 120);

  if p_bok_id is not null then
    update public.reels
    set title = v_title,
        author_name = v_author_name,
        hook = '',
        text = v_text,
        genre = left(v_genre, 30),
        mood = left(v_mood, 30),
        minutes = public.boks_reading_minutes(v_words),
        status = 'pending_review',
        submitted_at = now(),
        updated_at = now()
    where id = p_bok_id and author_user_id = v_uid and status = 'rejected'
    returning * into v_bok;

    if v_bok.id is null then
      raise exception 'Only a refused bok of your own can be revised.' using errcode = '42501';
    end if;
  else
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
  end if;

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
    'revised', p_bok_id is not null,
    'quota', public.get_my_bok_quota()
  );
end;
$$;

revoke all on function public.submit_bok_for_review(text, text, text, text, text, integer, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, integer, text, boolean, text, uuid) to authenticated;

-- ------------------------------------------------- the quota, for old tabs

create or replace function public.get_my_bok_quota()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_used integer := 0;
begin
  if v_uid is not null and v_is_anonymous is false then
    v_used := public.count_my_boks_submitted_today();
  end if;

  -- No limit. `limit` and `remaining` are null rather than a large number, so
  -- nothing downstream can mistake them for a real allowance.
  return jsonb_build_object(
    'unlimited', true,
    'limit', null,
    'usedToday', v_used,
    'remaining', null,
    'exhausted', false,
    'resetsAt', null
  );
end;
$function$;

revoke all on function public.get_my_bok_quota() from public, anon, authenticated;
grant execute on function public.get_my_bok_quota() to authenticated;

-- ---------------------------------------------- the history, a page at a time

create index if not exists reels_author_created_idx
  on public.reels (author_user_id, created_at desc)
  where author_user_id is not null;

create or replace function public.get_my_bok_submissions_page(
  p_status text default '',
  p_query text default '',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_uid is null or v_is_anonymous then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'total', 0,
      'counts', jsonb_build_object('all', 0, 'pending_review', 0, 'published', 0, 'rejected', 0, 'archived', 0)
    );
  end if;

  if v_status is not null and v_status not in ('pending_review', 'published', 'rejected', 'archived') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;

  return (
    with mine as (
      select r.*
      from public.reels r
      where r.author_user_id = v_uid
        and r.status in ('pending_review', 'published', 'rejected', 'archived')
    ),
    matching as (
      select m.*
      from mine m
      where (v_status is null or m.status = v_status)
        and (
          v_query = ''
          or strpos(lower(m.title), v_query) > 0
          or strpos(lower(coalesce(m.author_name, '')), v_query) > 0
        )
    ),
    page as (
      select m.*
      from matching m
      order by m.created_at desc, m.id
      limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id::text,
          'title', p.title,
          -- Only a refused piece goes back into the editor, so only its text
          -- is sent; a page of a hundred published texts would be megabytes.
          'body', case when p.status = 'rejected' then p.text else '' end,
          'genre', p.genre,
          'mood', p.mood,
          'authorName', coalesce(p.author_name, ''),
          'minutes', p.minutes,
          'wordCount', coalesce(p.word_count, 0),
          'likes', (select count(*)::integer from public.likes l where l.reel_id = p.id),
          'comments', (select count(*)::integer from public.comments c where c.reel_id = p.id),
          'publishedAt', case when p.status = 'published' then p.reviewed_at else null end,
          'status', p.status,
          'submittedAt', p.submitted_at,
          'reviewedAt', p.reviewed_at,
          'reviewNote', p.review_note,
          'createdAt', p.created_at
        ) order by p.created_at desc, p.id)
        from page p
      ), '[]'::jsonb),
      'total', (select count(*)::integer from matching),
      'counts', jsonb_build_object(
        'all', (select count(*)::integer from mine),
        'pending_review', (select count(*)::integer from mine where status = 'pending_review'),
        'published', (select count(*)::integer from mine where status = 'published'),
        'rejected', (select count(*)::integer from mine where status = 'rejected'),
        'archived', (select count(*)::integer from mine where status = 'archived')
      )
    )
  );
end;
$function$;

revoke all on function public.get_my_bok_submissions_page(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_my_bok_submissions_page(text, text, integer, integer) to authenticated;
