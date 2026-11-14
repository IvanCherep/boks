-- Content cleanup: columns nobody writes, a lost rejection reason, status
-- invariants written down, a view and an index nobody uses.
--
-- Applied before the release that stops reading these, and old tabs keep
-- calling for days, so every RPC keeps its name, arguments and answer fields,
-- and every view keeps its columns (docs/agents/production-changes.md,
-- "Compatibility"):
--
-- 1. `reels.author_handle` is gone. A handle is never stored on the work
--    (20260915100000); it was null on every row. `boks_reels.author_handle`
--    (and so `published_boks.author_handle`) is now the author's identity only.
-- 2. `reels.hook` is gone. Retired on 2026-09-19 and forced empty by a trigger;
--    the views keep a `hook` column that is always '', RPCs that answered
--    'hook' still answer '', and `submit_bok_for_review(p_hook)` and an
--    import row's `hook` are still accepted and ignored.
-- 3. `user_profiles.preferred_genre` / `preferred_mood` are gone: no writer,
--    one value on every row, and no client reads the `preferredGenre` /
--    `preferredMood` keys `get_boks_user_context` used to return.
-- 4. Removing a piece no longer overwrites its `review_note` (the reason an
--    author's piece was refused) with the removal reason; an archived piece
--    shows its `archive_reason` instead, so a refused piece restored by an
--    admin comes back with its own refusal reason. The same goes for the two
--    account deletions, which now also record what each piece was before.
-- 5. Status invariants are CHECK constraints (docs/adr/0017). To keep them,
--    an actioned report refuses only a piece that is waiting, published or
--    refused: one already removed or withdrawn stays so (its rights record is
--    still withdrawn, so it cannot come back unreviewed), and an account
--    deletion leaves an already removed piece's removal as it was.
-- 6. `submit_bok_for_review` and `boks_publish_space_works` no longer compute
--    `minutes`: the `reels_word_count` trigger sets it on every write.
-- 7. The `boks_comments` view is dropped: the app reads `get_bok_comments`.
-- 8. `bok_reports(reel_id)` gets a plain index (report counts per piece, the
--    cascade on delete); `reels_mood_genre_idx` goes: nothing filters on
--    mood or genre by equality.

-- ------------------------------------------------------------------ views

-- Same columns, order, types, owner and grants; only the two dropped columns
-- stop being read.
create or replace view public.boks_reels as
select r.id,
  r.title,
  ''::text as hook,
  r.text,
  r.genre,
  r.mood,
  r.minutes,
  r.status,
  r.is_seed,
  r.created_at,
  r.updated_at,
  r.author_user_id,
  r.submitted_at,
  r.reviewed_at,
  r.reviewed_by,
  r.review_note,
  r.word_count,
  r.reading_shape,
  r.line_break_count,
  r.author_name,
  coalesce(i.handle, ''::text) as author_handle,
  r.language,
  r.summary,
  r.slug
from public.reels r
left join public.boks_public_identity i on i.user_id = r.author_user_id;

-- `published_boks` reads `boks_reels` and needs no change: its `hook` and
-- `author_handle` columns now come from the expressions above.

drop view public.boks_comments;

-- ------------------------------------------------------------------ functions

CREATE OR REPLACE FUNCTION public.boks_set_reel_word_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.word_count := public.boks_word_count(new.text);
  new.minutes := public.boks_reading_minutes(new.text);
  new.reading_shape := public.boks_reading_shape(new.text);
  new.line_break_count := length(coalesce(new.text, '')) - length(replace(coalesce(new.text, ''), E'\n', ''));
  -- An admin may correct a language; a rewrite of the text re-derives it.
  if new.language is null or (tg_op = 'UPDATE' and new.text is distinct from old.text) then
    new.language := public.boks_detect_language(new.text);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.boks_reels_title_and_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if btrim(coalesce(new.title, '')) = ''
     or new.title !~ '[^][:space:]*•·.,;:!?…—–_=~#"''«»()[-]' then
    new.title := public.boks_title_from_text(new.text);
  else
    new.title := btrim(new.title);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_bok_for_review(p_title text DEFAULT ''::text, p_hook text DEFAULT ''::text, p_text text DEFAULT ''::text, p_genre text DEFAULT ''::text, p_mood text DEFAULT ''::text, p_minutes integer DEFAULT 0, p_author_name text DEFAULT ''::text, p_rights_confirmed boolean DEFAULT false, p_rights_note text DEFAULT ''::text, p_bok_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_text text := nullif(trim(coalesce(p_text, '')), '');
  v_title text;
  v_genre text := coalesce(nullif(trim(coalesce(p_genre, '')), ''), 'literary');
  v_mood text := coalesce(nullif(trim(coalesce(p_mood, '')), ''), 'quiet');
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

  if char_length(v_text) > public.boks_max_text_characters() then
    raise exception 'A bok must fit inside 15 minutes. This one is % characters; the limit is %.',
      char_length(v_text), public.boks_max_text_characters() using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile('');

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
        text = v_text,
        genre = left(v_genre, 30),
        mood = left(v_mood, 30),
        status = 'pending_review',
        withdrawn_at = null,
        withdrawn_from_status = null,
        submitted_at = now(),
        updated_at = now()
    where id = p_bok_id and author_user_id = v_uid and status in ('rejected', 'withdrawn')
    returning * into v_bok;

    if v_bok.id is null then
      raise exception 'Only a refused bok of your own can be revised.' using errcode = '42501';
    end if;
  else
    insert into public.reels (
      title, author_name, text, genre, mood,
      status, author_user_id, submitted_at, updated_at
    )
    values (
      v_title, v_author_name, v_text,
      left(v_genre, 30), left(v_mood, 30),
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
$function$;

CREATE OR REPLACE FUNCTION public.boks_publish_space_works(p_space author_spaces, p_items jsonb, p_actor uuid, p_rights_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item jsonb;
  v_work public.author_space_works;
  v_bok public.reels;
  v_byline text;
  v_done jsonb := '[]'::jsonb;
  v_position integer;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200 then
    raise exception 'Choose the works to publish.' using errcode = '22023';
  end if;

  -- The page's name, read now: the caller's copy of the row may predate a save.
  v_byline := coalesce(
    (select s.name from public.author_spaces s where s.id = p_space.id),
    p_space.name,
    (select '@' || p.handle from public.user_profiles p where p.user_id = p_space.owner_user_id)
  );

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_work from public.author_space_works
    where id = (v_item ->> 'workId')::uuid and space_id = p_space.id
    for update;
    if v_work.id is null then
      raise exception 'A chosen work is no longer on this page.' using errcode = '40001';
    end if;
    if v_work.revision <> coalesce((v_item ->> 'revision')::integer, -1) then
      raise exception 'A work changed after you opened the preview. Look at it again before publishing.' using errcode = '40001';
    end if;
    if v_work.status <> 'ready' then
      raise exception '«%» is not ready to publish.', v_work.title using errcode = '22023';
    end if;

    v_position := v_work.position;

    if v_work.bok_id is null then
      -- A new text: the bok is created published, the author's own, with its
      -- rights record. Checked by the team (ready) and confirmed by the owner.
      insert into public.reels (
        title, author_name, text, genre, mood,
        status, author_user_id, submitted_at, reviewed_at, reviewed_by, updated_at
      )
      values (
        v_work.title, left(v_byline, 120), v_work.body, 'literary', 'quiet',
        'published', p_space.owner_user_id, now(), now(), v_work.ready_by, now()
      )
      returning * into v_bok;
      insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
      values (v_bok.id, true, left(concat_ws(' · ', p_rights_note, v_work.rights_note), 1000), p_actor, now(), now())
      on conflict (reel_id) do update
        set confirmed = true, note = excluded.note, confirmed_by = excluded.confirmed_by, confirmed_at = now(), updated_at = now();
      update public.author_space_works set bok_id = v_bok.id where id = v_work.id;
    else
      select * into v_bok from public.reels where id = v_work.bok_id for update;
      if v_bok.id is null or v_bok.status <> 'published' then
        raise exception '«%»: the bok it belongs to is not published.', v_work.title using errcode = '22023';
      end if;
      if p_space.kind = 'author' and v_bok.author_user_id is distinct from p_space.owner_user_id then
        raise exception '«%» belongs to another account.', v_work.title using errcode = '42501';
      end if;
    end if;

    update public.author_space_works
    set status = 'published',
        published_revision = revision,
        series_published = (format = 'series'),
        published_at = now(),
        updated_at = now()
    where id = v_work.id;

    if v_position is not null then
      insert into public.author_space_order (space_id, bok_id, position)
      values (p_space.id, v_bok.id, v_position)
      on conflict (space_id, bok_id) do update set position = excluded.position;
    end if;

    v_done := v_done || jsonb_build_object(
      'workId', v_work.id::text, 'revision', v_work.revision, 'bokId', v_bok.id::text,
      'title', v_work.title, 'format', v_work.format,
      'withSeries', v_work.series_piece is not null
    );
  end loop;

  return v_done;
end;
$function$;

CREATE OR REPLACE FUNCTION public.import_boks_batch(p_publisher_handle text, p_rows jsonb, p_publish boolean DEFAULT true, p_rights_confirmed boolean DEFAULT false, p_rights_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid := (select auth.uid());
  v_handle text := nullif(lower(trim(leading '@' from btrim(coalesce(p_publisher_handle, '')))), '');
  v_publisher uuid;
  v_status text := case when coalesce(p_publish, true) then 'published' else 'pending_review' end;
  v_limit integer := public.boks_max_text_characters();
  v_batch_note text := nullif(btrim(coalesce(p_rights_note, '')), '');
  v_results jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index integer := 0;
  v_key text;
  v_title text;
  v_text text;
  v_author_name text;
  v_note text;
  v_created timestamptz;
  v_id uuid;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_handle is null then
    raise exception 'A publisher nickname is required.' using errcode = '22023';
  end if;

  if coalesce(p_rights_confirmed, false) is not true then
    raise exception 'Confirm the rights for this batch before importing it.' using errcode = '22023';
  end if;

  select user_id into v_publisher
  from public.user_profiles
  where lower(handle) = v_handle and is_publisher;

  if v_publisher is null then
    raise exception '@% is not a publisher account. An admin has to mark it as one first.', v_handle
      using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be a JSON array.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) > 100 then
    raise exception 'Import at most 100 boks per call; this batch has %.', jsonb_array_length(p_rows)
      using errcode = '22023';
  end if;

  -- Indexed rather than `for ... in select`: the position is reported back, so
  -- a rejected row can be found in the file it came from.
  while v_index < jsonb_array_length(p_rows) loop
    v_row := p_rows -> v_index;
    v_index := v_index + 1;
    v_key := nullif(btrim(coalesce(v_row ->> 'importKey', '')), '');
    v_title := nullif(btrim(coalesce(v_row ->> 'title', '')), '');
    v_text := nullif(btrim(coalesce(v_row ->> 'text', '')), '');
    v_author_name := left(nullif(btrim(coalesce(v_row ->> 'authorName', '')), ''), 120);
    v_note := coalesce(nullif(btrim(coalesce(v_row ->> 'rightsNote', '')), ''), v_batch_note);

    if v_key is null then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', null, 'status', 'rejected',
        'reason', 'An import key is required, so the load can be repeated safely.'
      );
      continue;
    end if;

    if v_title is null then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'rejected', 'reason', 'Title is required.'
      );
      continue;
    end if;

    if v_text is null then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'rejected', 'reason', 'Story text is required.'
      );
      continue;
    end if;

    if char_length(v_text) > v_limit then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'rejected',
        'reason', format('A bok must fit inside 15 minutes. This one is %s characters; the limit is %s.',
                         char_length(v_text), v_limit)
      );
      continue;
    end if;

    if exists (
      select 1 from public.reels
      where author_user_id = v_publisher and import_key = v_key
    ) then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'skipped', 'reason', 'Already imported.'
      );
      continue;
    end if;

    begin
      v_created := coalesce((v_row ->> 'createdAt')::timestamptz, now());
    exception when others then
      v_created := now();
    end;

    -- Its own subtransaction: a row that trips a constraint is reported and
    -- the rest of the batch continues.
    begin
      insert into public.reels (
        title, author_name, text, status, author_user_id,
        import_key, is_seed, created_at, submitted_at, reviewed_at, reviewed_by, updated_at
      )
      values (
        v_title, v_author_name, v_text, v_status, v_publisher,
        v_key, false, v_created, v_created,
        case when v_status = 'published' then now() else null end,
        case when v_status = 'published' then v_admin else null end,
        now()
      )
      returning id into v_id;

      insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
      values (v_id, true, v_note, v_admin, now(), now());

      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'imported', 'id', v_id::text
      );
    exception when others then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'rejected', 'reason', sqlerrm
      );
    end;
  end loop;

  return jsonb_build_object(
    'publisher', v_handle,
    'status', v_status,
    'results', v_results,
    'imported', (select count(*) from jsonb_array_elements(v_results) r where r.value ->> 'status' = 'imported'),
    'skipped', (select count(*) from jsonb_array_elements(v_results) r where r.value ->> 'status' = 'skipped'),
    'rejected', (select count(*) from jsonb_array_elements(v_results) r where r.value ->> 'status' = 'rejected')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_bok(p_reel_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  with events as (
    select e.user_id, e.session_id, e.event_type, e.active_seconds, e.created_at
    from public.recommendation_events e
    where e.reel_id = p_reel_id and e.surface = 'reader'
  ),
  session_reading as (
    select session_id, max(active_seconds) as active_seconds from events group by session_id
  ),
  metrics as (
    select
      coalesce((select round(sum(active_seconds) / 60.0)::integer from session_reading), 0) as minutes,
      (select count(distinct user_id)::integer from events) as readers,
      (select count(*)::integer from events where event_type = 'impression') as impressions,
      (select count(*)::integer from events where event_type = 'start') as starts,
      (select count(*)::integer from events where event_type = 'complete') as completes,
      (select count(*)::integer from events where event_type = 'skip') as skips,
      (select count(*)::integer from events where event_type = 'share') as shares,
      (select count(*)::integer from public.likes l where l.reel_id = p_reel_id) as likes,
      (select count(*)::integer from public.comments c where c.reel_id = p_reel_id) as comments,
      (select count(*)::integer from public.bok_reports br where br.reel_id = p_reel_id) as reports,
      (select count(*)::integer from public.bok_reports br where br.reel_id = p_reel_id and br.status = 'open') as open_reports,
      (select max(created_at) from events) as last_read_at
  )
  select jsonb_build_object(
    'id', r.id::text,
    'title', r.title,
    'hook', '',
    'body', r.text,
    'status', r.status,
    'language', r.language,
    'genre', r.genre,
    'mood', r.mood,
    'estimatedMinutes', r.minutes,
    'wordCount', r.word_count,
    'isSeed', r.is_seed,
    'imported', r.import_key is not null,
    'authorName', coalesce(nullif(btrim(r.author_name), ''), 'boks author'),
    'authorHandle', coalesce(i.handle, ''),
    'authorUserId', r.author_user_id::text,
    'authorEmail', author_account.email,
    'createdAt', r.created_at,
    'submittedAt', r.submitted_at,
    'updatedAt', r.updated_at,
    'reviewedAt', r.reviewed_at,
    'reviewedBy', reviewer.handle,
    'reviewNote', r.review_note,
    'archivedAt', r.archived_at,
    'archivedBy', archiver.handle,
    'archiveReason', r.archive_reason,
    'rights', case when rights.reel_id is null then null else jsonb_build_object(
      'confirmed', rights.confirmed,
      'note', rights.note,
      'confirmedAt', rights.confirmed_at
    ) end,
    'metrics', jsonb_build_object(
      'minutes', m.minutes,
      'readers', m.readers,
      'impressions', m.impressions,
      'starts', m.starts,
      'completes', m.completes,
      'skips', m.skips,
      'shares', m.shares,
      'likes', m.likes,
      'comments', m.comments,
      'reports', m.reports,
      'openReports', m.open_reports,
      'finishRate', case when m.starts > 0 then round(m.completes * 100.0 / m.starts)::integer else null end,
      'lastReadAt', m.last_read_at
    ),
    -- The newest hundred. A detail view is for reading them, not an export.
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'createdAt', c.created_at,
        'userId', c.user_id::text,
        'handle', commenter.handle,
        'parentCommentId', c.parent_comment_id,
        'likes', (select count(*)::integer from public.comment_likes cl where cl.comment_id = c.id)
      ) order by c.created_at desc, c.id desc)
      from (
        select * from public.comments
        where reel_id = p_reel_id
        order by created_at desc, id desc
        limit 100
      ) c
      left join public.user_profiles commenter on commenter.user_id = c.user_id
    ), '[]'::jsonb),
    'likers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', l.user_id::text,
        'handle', liker.handle,
        'likedAt', l.created_at
      ) order by l.created_at desc)
      from (
        select * from public.likes
        where reel_id = p_reel_id
        order by created_at desc
        limit 100
      ) l
      left join public.user_profiles liker on liker.user_id = l.user_id
    ), '[]'::jsonb)
  )
  into v_result
  from public.reels r
  cross join metrics m
  left join public.boks_public_identity i on i.user_id = r.author_user_id
  left join auth.users author_account on author_account.id = r.author_user_id
  left join public.user_profiles reviewer on reviewer.user_id = r.reviewed_by
  left join public.user_profiles archiver on archiver.user_id = r.archived_by
  left join public.bok_rights rights on rights.reel_id = r.id
  where r.id = p_reel_id;

  if v_result is null then
    raise exception 'Boks does not exist.' using errcode = '22023';
  end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_boks_content(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_query text DEFAULT ''::text, p_sort text DEFAULT 'minutes'::text, p_status text DEFAULT 'published'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := lower(coalesce(p_query, ''));
  v_sort text := coalesce(nullif(btrim(p_sort), ''), 'minutes');
  v_status text := case when p_status = 'archived' then 'archived' else 'published' end;
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with session_reading as (
      select e.reel_id, e.session_id, max(e.active_seconds) as active_seconds
      from public.recommendation_events e where e.surface = 'reader'
      group by e.reel_id, e.session_id
    ),
    reading as (
      select s.reel_id, round(sum(s.active_seconds) / 60.0)::integer as minutes
      from session_reading s group by s.reel_id
    ),
    outcomes as (
      select e.reel_id,
        count(*) filter (where e.event_type = 'start')::integer as starts,
        count(*) filter (where e.event_type = 'complete')::integer as completes,
        count(*) filter (where e.event_type = 'skip')::integer as skips,
        count(distinct e.user_id)::integer as readers
      from public.recommendation_events e where e.surface = 'reader' group by e.reel_id
    ),
    like_counts as (select l.reel_id, count(*)::integer as likes from public.likes l group by l.reel_id),
    comment_counts as (select c.reel_id, count(*)::integer as comments from public.comments c group by c.reel_id),
    rows as (
      select r.id, r.title,
        coalesce(nullif(btrim(r.author_name), ''), 'boks author') as author_name,
        coalesce(i.handle, '') as author_handle,
        r.genre, r.mood, r.minutes as estimated_minutes, r.word_count, r.created_at,
        r.status, r.archived_at, r.archive_reason, archive_admin.handle as archived_by,
        coalesce(rd.minutes, 0) as minutes, coalesce(o.readers, 0) as readers,
        coalesce(o.starts, 0) as starts, coalesce(o.completes, 0) as completes,
        coalesce(o.skips, 0) as skips, coalesce(l.likes, 0) as likes,
        coalesce(c.comments, 0) as comments,
        case when coalesce(o.starts, 0) > 0
          then round(coalesce(o.completes, 0) * 100.0 / o.starts)::integer else null end as finish_rate
      from public.reels r
      left join public.boks_public_identity i on i.user_id = r.author_user_id
      left join public.user_profiles archive_admin on archive_admin.user_id = r.archived_by
      left join reading rd on rd.reel_id = r.id
      left join outcomes o on o.reel_id = r.id
      left join like_counts l on l.reel_id = r.id
      left join comment_counts c on c.reel_id = r.id
      where r.status = v_status
        and (v_query = '' or lower(r.title) like '%' || v_query || '%'
          or lower(coalesce(r.author_name, '')) like '%' || v_query || '%'
          or lower(coalesce(i.handle, '')) like '%' || v_query || '%'
          or lower(r.genre) like '%' || v_query || '%' or lower(r.mood) like '%' || v_query || '%')
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from rows),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(page) - 'sort_rank' order by page.sort_rank)
        from (
          select id::text as "id", title, author_name as "authorName", author_handle as "authorHandle",
            genre, mood, estimated_minutes as "estimatedMinutes", word_count as "wordCount",
            minutes, readers, starts, completes, skips, likes, comments, finish_rate as "finishRate",
            status, archived_at as "archivedAt", archive_reason as "archiveReason", archived_by as "archivedBy",
            row_number() over (order by
              case when v_status = 'archived' then archived_at end desc nulls last,
              case when v_sort = 'minutes' then minutes end desc nulls last,
              case when v_sort = 'readers' then readers end desc nulls last,
              case when v_sort = 'finish' then finish_rate end desc nulls last,
              case when v_sort = 'newest' then extract(epoch from created_at) end desc nulls last,
              case when v_sort = 'title' then lower(title) end asc nulls last,
              minutes desc, created_at desc) as sort_rank
          from rows
        ) page
        where page.sort_rank > v_offset and page.sort_rank <= v_offset + v_limit
      ), '[]'::jsonb)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_bok_submissions(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'hook', '',
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
      'reviewNote', case when r.status = 'archived' then r.archive_reason else r.review_note end,
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

CREATE OR REPLACE FUNCTION public.get_my_bok_submissions_page(p_status text DEFAULT ''::text, p_query text DEFAULT ''::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'counts', jsonb_build_object('all', 0, 'pending_review', 0, 'published', 0, 'rejected', 0, 'archived', 0, 'withdrawn', 0)
    );
  end if;

  if v_status is not null and v_status not in ('pending_review', 'published', 'rejected', 'archived', 'withdrawn') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;

  return (
    with mine as (
      select r.*
      from public.reels r
      where r.author_user_id = v_uid
        and r.status in ('pending_review', 'published', 'rejected', 'archived', 'withdrawn')
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
          -- Only a piece that can go back into the editor carries its text.
          'body', case when p.status in ('rejected', 'withdrawn') then p.text else '' end,
          'genre', p.genre,
          'mood', p.mood,
          'authorName', coalesce(p.author_name, ''),
          'minutes', p.minutes,
          'wordCount', coalesce(p.word_count, 0),
          'likes', (select count(*)::integer from public.likes l where l.reel_id = p.id and l.user_id <> v_uid),
          'comments', (select count(*)::integer from public.comments c where c.reel_id = p.id),
          'readers', (
            select count(distinct e.user_id)::integer
            from public.recommendation_events e
            where e.reel_id = p.id and e.surface = 'reader' and e.event_type <> 'impression'
              and e.user_id is distinct from v_uid
          ),
          'publishedAt', case when p.status = 'published' then p.reviewed_at else null end,
          'status', p.status,
          'withdrawnFromStatus', p.withdrawn_from_status,
          'withdrawnAt', p.withdrawn_at,
          'submittedAt', p.submitted_at,
          'reviewedAt', p.reviewed_at,
          'reviewNote', case when p.status = 'archived' then p.archive_reason else p.review_note end,
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
        'archived', (select count(*)::integer from mine where status = 'archived'),
        'withdrawn', (select count(*)::integer from mine where status = 'withdrawn')
      )
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_boks_user_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_context jsonb;
begin
  if v_uid is null then
    return jsonb_build_object(
      'userId', null, 'email', null, 'isAnonymous', true, 'role', 'reader',
      'handle', null,
      'termsAcceptedAt', null, 'termsVersion', null,
      'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin' and banned_at is null),
      'views', 0, 'likes', 0, 'readingLanguages', array[]::text[],
      'languageCoverage', public.boks_language_coverage(), 'bannedAt', null, 'banReason', null
    );
  end if;

  select jsonb_build_object(
    'userId', v_uid::text, 'email', u.email, 'isAnonymous', v_is_anonymous,
    'role', coalesce(p.role, 'reader'), 'handle', p.handle,
    'termsAcceptedAt', p.terms_accepted_at, 'termsVersion', p.terms_version,
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin' and banned_at is null),
    'views', (select count(*)::integer from public.views where user_id = v_uid),
    'likes', (select count(*)::integer from public.likes where user_id = v_uid),
    'readingLanguages', coalesce(p.reading_languages, array[]::text[]),
    'languageCoverage', public.boks_language_coverage(),
    'bannedAt', p.banned_at, 'banReason', p.ban_reason
  ) into v_context
  from auth.users u left join public.user_profiles p on p.user_id = u.id
  where u.id = v_uid;

  return coalesce(v_context, jsonb_build_object(
    'userId', v_uid::text, 'email', null, 'isAnonymous', v_is_anonymous,
    'role', 'reader', 'handle', null,
    'termsAcceptedAt', null, 'termsVersion', null, 'hasAnyAdmin', true,
    'views', 0, 'likes', 0, 'readingLanguages', array[]::text[],
    'languageCoverage', public.boks_language_coverage(),
    'bannedAt', case when public.is_boks_user_blocked(v_uid) then now() else null end,
    'banReason', case when public.is_boks_user_blocked(v_uid) then 'This account was deleted.' else null end
  ));
end;
$function$;

CREATE OR REPLACE FUNCTION public.archive_bok(p_reel_id uuid, p_reason text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_reason text := coalesce(nullif(left(btrim(coalesce(p_reason, '')), 500), ''), 'Removed by an administrator.');
  v_title text;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  update public.reels
  set archived_from_status = status,
      status = 'archived',
      archived_at = now(),
      archived_by = v_caller,
      archive_reason = v_reason,
      updated_at = now()
  where id = p_reel_id and status <> 'archived'
  returning title into v_title;

  if v_title is null then
    raise exception 'Boks does not exist or is already deleted.' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'id', p_reel_id::text, 'title', v_title, 'status', 'archived');
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_bok_report(p_report_id uuid, p_decision text, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_report public.bok_reports;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_decision not in ('actioned', 'dismissed') then
    raise exception 'Decision must be actioned or dismissed.' using errcode = '22023';
  end if;

  if v_decision = 'actioned' and v_note is null then
    raise exception 'Say why the bok is being taken down. The author sees it.' using errcode = '22023';
  end if;

  update public.bok_reports
  set status = v_decision,
      reviewed_at = now(),
      reviewed_by = v_caller,
      review_note = left(coalesce(v_note, ''), 1000)
  where id = p_report_id and status = 'open'
  returning * into v_report;

  if v_report.id is null then
    raise exception 'That report is not open.' using errcode = '22023';
  end if;

  if v_decision = 'actioned' then
    update public.reels
    set status = 'rejected',
        review_note = left(v_note, 1000),
        reviewed_at = now(),
        reviewed_by = v_caller,
        updated_at = now()
    where id = v_report.reel_id
      and status in ('pending_review', 'published', 'rejected');

    -- The attestation was wrong, whoever made it. Saying so keeps the piece
    -- in the unattested list if anyone tries to put it back.
    --
    -- Built by joining the parts that exist, so a piece whose author left no
    -- note does not end up with a note that starts with a separator.
    update public.bok_rights
    set confirmed = false,
        note = left(
          array_to_string(
            array_remove(array[nullif(btrim(coalesce(note, '')), ''), 'Withdrawn after a report: ' || v_note], null),
            ' | '
          ),
          2000
        ),
        updated_at = now()
    where reel_id = v_report.reel_id;
  end if;

  return jsonb_build_object(
    'id', v_report.id::text,
    'reelId', v_report.reel_id::text,
    'status', v_report.status,
    'bokStatus', (select status from public.reels where id = v_report.reel_id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_boks_user(p_user_id uuid, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_handle text;
  v_role text;
  v_is_anonymous boolean;
  v_archived integer;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if p_user_id = v_caller then
    raise exception 'Admins cannot delete their own account.' using errcode = '42501';
  end if;

  select coalesce(au.is_anonymous, false), p.role, p.handle
  into v_is_anonymous, v_role, v_handle
  from auth.users au
  left join public.user_profiles p on p.user_id = au.id
  where au.id = p_user_id;

  if v_is_anonymous is null or v_is_anonymous then
    raise exception 'A permanent user account is required.' using errcode = '22023';
  end if;
  if v_role = 'admin' then
    raise exception 'Revoke admin access before deleting this account.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_confirm, '')) <> coalesce(v_handle, p_user_id::text) then
    raise exception 'Type the user nickname exactly to confirm deletion.' using errcode = '22023';
  end if;

  update public.reels
  set archived_from_status = case when status = 'archived' then archived_from_status else status end,
      status = 'archived',
      archived_at = case when status = 'archived' then archived_at else now() end,
      archived_by = case when status = 'archived' then archived_by else v_caller end,
      archive_reason = case when status = 'archived' then archive_reason else 'Author account deleted by an administrator.' end,
      author_user_id = null,
      author_name = 'Deleted author',
      updated_at = now()
  where author_user_id = p_user_id;
  get diagnostics v_archived = row_count;

  perform public.boks_take_down_owned_pages(p_user_id);

  insert into public.deleted_boks_users (user_id, deleted_by)
  values (p_user_id, v_caller)
  on conflict (user_id) do update
  set deleted_at = now(), deleted_by = excluded.deleted_by;

  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'User does not exist.' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'userId', p_user_id::text, 'archivedBoks', v_archived);
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_boks_account(p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_handle text;
  v_role text;
  v_archived integer;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in to delete your account.' using errcode = '42501';
  end if;

  select p.handle, p.role into v_handle, v_role
  from public.user_profiles p
  where p.user_id = v_uid;

  if v_role = 'admin' then
    raise exception 'An admin account cannot delete itself. Remove its admin access first.' using errcode = '42501';
  end if;
  if lower(btrim(ltrim(coalesce(p_confirm, ''), '@'))) <> lower(coalesce(v_handle, '')) then
    raise exception 'Type your nickname exactly to confirm.' using errcode = '22023';
  end if;

  perform set_config('boks.erasing_account', v_uid::text, true);

  update public.reels
  set archived_from_status = case when status = 'archived' then archived_from_status else status end,
      status = 'archived',
      archived_at = case when status = 'archived' then archived_at else now() end,
      archived_by = case when status = 'archived' then archived_by else null end,
      archive_reason = case when status = 'archived' then archive_reason else 'The author deleted their account.' end,
      author_user_id = null,
      author_name = 'Deleted author',
      updated_at = now()
  where author_user_id = v_uid;
  get diagnostics v_archived = row_count;

  perform public.boks_take_down_owned_pages(v_uid);

  insert into public.deleted_boks_users (user_id, deleted_by)
  values (v_uid, v_uid)
  on conflict (user_id) do update set deleted_at = now(), deleted_by = excluded.deleted_by;

  delete from auth.users where id = v_uid;

  perform set_config('boks.erasing_account', '', true);

  return jsonb_build_object('ok', true, 'archivedBoks', v_archived);
end;
$function$;


-- ------------------------------------------------------------------ columns

-- Triggers whose column lists name a dropped column are recreated under the
-- same names, so they still fire in the same (alphabetical) order.
drop trigger reels_word_count on public.reels;
drop trigger boks_reels_title_and_hook on public.reels;

alter table public.reels drop constraint reels_handle_is_never_copied;
alter table public.reels drop column author_handle;
alter table public.reels drop column hook;
alter table public.user_profiles drop column preferred_genre;
alter table public.user_profiles drop column preferred_mood;

create trigger boks_reels_title_and_hook
  before insert or update of title, text on public.reels
  for each row execute function public.boks_reels_title_and_hook();
create trigger reels_word_count
  before insert or update of text on public.reels
  for each row execute function public.boks_set_reel_word_count();

-- ------------------------------------------------------------------ data

-- An archived piece's removal reason lives in `archive_reason`; a copy in
-- `review_note` is dropped. A piece removed while refused keeps the copy: its
-- own refusal reason was already overwritten and the copy is all there is.
update public.reels
set review_note = null
where status = 'archived'
  and review_note is not distinct from archive_reason
  and review_note is not null
  and archived_from_status is distinct from 'rejected';

-- ------------------------------------------------------------------ invariants

alter table public.reels
  add constraint reels_archived_at_matches_status
    check ((status = 'archived') = (archived_at is not null)) not valid,
  add constraint reels_archived_from_status_known
    check (archived_from_status is null
      or archived_from_status in ('draft', 'pending_review', 'published', 'rejected', 'withdrawn')) not valid,
  add constraint reels_withdrawn_from_status_known
    check (withdrawn_from_status is null
      or withdrawn_from_status in ('draft', 'pending_review', 'published', 'rejected')) not valid,
  add constraint reels_withdrawn_at_only_when_withdrawn
    check (withdrawn_at is null
      or status = 'withdrawn'
      or (status = 'archived' and archived_from_status = 'withdrawn')) not valid;

alter table public.reels validate constraint reels_archived_at_matches_status;
alter table public.reels validate constraint reels_archived_from_status_known;
alter table public.reels validate constraint reels_withdrawn_from_status_known;
alter table public.reels validate constraint reels_withdrawn_at_only_when_withdrawn;

-- ------------------------------------------------------------------ indexes

create index if not exists bok_reports_reel_id_idx on public.bok_reports (reel_id);
drop index if exists public.reels_mood_genre_idx;

-- ------------------------------------------------------------------ grants

-- `create or replace` keeps a function's grants; restated so this file says
-- who may call what (docs/adr/0011).
revoke all on function public.boks_set_reel_word_count() from public, anon, authenticated;
revoke all on function public.boks_reels_title_and_hook() from public, anon, authenticated;
revoke all on function public.boks_publish_space_works(public.author_spaces, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.import_boks_batch(text, jsonb, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.submit_bok_for_review(text, text, text, text, text, integer, text, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.get_admin_bok(uuid) from public, anon, authenticated;
revoke all on function public.get_boks_content(integer, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.get_my_bok_submissions(integer) from public, anon, authenticated;
revoke all on function public.get_my_bok_submissions_page(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_boks_user_context() from public, anon, authenticated;
revoke all on function public.archive_bok(uuid, text) from public, anon, authenticated;
revoke all on function public.review_bok_report(uuid, text, text) from public, anon, authenticated;
revoke all on function public.delete_boks_user(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_my_boks_account(text) from public, anon, authenticated;

grant execute on function public.import_boks_batch(text, jsonb, boolean, boolean, text) to authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, integer, text, boolean, text, uuid) to authenticated;
grant execute on function public.get_admin_bok(uuid) to authenticated;
grant execute on function public.get_boks_content(integer, integer, text, text, text) to authenticated;
grant execute on function public.get_my_bok_submissions(integer) to authenticated;
grant execute on function public.get_my_bok_submissions_page(text, text, integer, integer) to authenticated;
grant execute on function public.get_boks_user_context() to anon, authenticated;
grant execute on function public.archive_bok(uuid, text) to authenticated;
grant execute on function public.review_bok_report(uuid, text, text) to authenticated;
grant execute on function public.delete_boks_user(uuid, text) to authenticated;
grant execute on function public.delete_my_boks_account(text) to authenticated;
