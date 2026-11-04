-- boks: an author controls their own work
--
-- Until now only an admin could take a bok down. An author who sent the wrong
-- file, changed their mind during review, or wants a published piece off the
-- feed had to write to support. They can now do it themselves:
--
--   * **Withdraw** (`withdraw_my_bok`): a piece waiting for review, refused or
--     published leaves the review queue and every reader surface at once. It
--     gets its own status, `withdrawn`, rather than the admin's `archived`:
--     an admin removal is a decision about the author, and an author's
--     withdrawal is the author's own - neither side may undo the other's.
--     Every reader path already reads `status = 'published'` only, so a
--     withdrawn piece disappears from the feed, profiles, series, libraries
--     and comments with no other change.
--   * **Return** (`restore_my_bok`): back to where it was. A piece that was
--     published goes back up without a second review - nothing in it changed;
--     a piece that was waiting goes back into the queue.
--   * **Edit** a withdrawn piece and resubmit it (`submit_bok_for_review` with
--     its id), which sends it to review again - including one that had been
--     published, since its text is now different.
--   * **Delete for good** (`delete_my_bok`), only once withdrawn and only by
--     typing the title, with its likes, comments and reading history.
--
-- `get_my_bok_stats` gives the author what readers did with one piece - the
-- same definitions as the admin inspector (`get_admin_bok`), minus the
-- author's own reading - and its newest comments.

alter table public.reels drop constraint if exists reels_status_check;
alter table public.reels
  add constraint reels_status_check
  check (status in ('draft', 'pending_review', 'published', 'rejected', 'archived', 'withdrawn'));

alter table public.reels
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_from_status text;

-- ------------------------------------------------------------- withdraw

create or replace function public.withdraw_my_bok(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_bok public.reels;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  update public.reels
  set withdrawn_from_status = status,
      status = 'withdrawn',
      withdrawn_at = now(),
      updated_at = now()
  where id = p_reel_id
    and author_user_id = v_uid
    and status in ('pending_review', 'published', 'rejected')
  returning * into v_bok;

  if v_bok.id is null then
    raise exception 'Only your own text that is waiting, refused or published can be withdrawn.' using errcode = '42501';
  end if;

  return jsonb_build_object('ok', true, 'id', v_bok.id::text, 'title', v_bok.title, 'status', v_bok.status);
end;
$$;

revoke all on function public.withdraw_my_bok(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_my_bok(uuid) to authenticated;

-- --------------------------------------------------------------- return

create or replace function public.restore_my_bok(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_bok public.reels;
  v_back text;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if exists (select 1 from public.user_profiles p where p.user_id = v_uid and p.banned_at is not null) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;

  select * into v_bok from public.reels
  where id = p_reel_id and author_user_id = v_uid and status = 'withdrawn'
  for update;

  if v_bok.id is null then
    raise exception 'Only your own withdrawn text can be returned.' using errcode = '42501';
  end if;

  v_back := case v_bok.withdrawn_from_status
    when 'published' then 'published'
    when 'rejected' then 'rejected'
    else 'pending_review'
  end;

  -- A copyright takedown withdraws the rights record; a piece without one is
  -- not put back in front of readers by its author either.
  if v_back = 'published' and not exists (
    select 1 from public.bok_rights rights where rights.reel_id = p_reel_id and rights.confirmed
  ) then
    v_back := 'pending_review';
  end if;

  update public.reels
  set status = v_back,
      withdrawn_at = null,
      withdrawn_from_status = null,
      submitted_at = case when v_back = 'pending_review' then now() else submitted_at end,
      updated_at = now()
  where id = p_reel_id
  returning * into v_bok;

  return jsonb_build_object('ok', true, 'id', v_bok.id::text, 'title', v_bok.title, 'status', v_bok.status);
end;
$$;

revoke all on function public.restore_my_bok(uuid) from public, anon, authenticated;
grant execute on function public.restore_my_bok(uuid) to authenticated;

-- ------------------------------------------------------- delete for good

create or replace function public.delete_my_bok(p_reel_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_title text;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select title into v_title from public.reels
  where id = p_reel_id and author_user_id = v_uid and status = 'withdrawn'
  for update;

  if v_title is null then
    raise exception 'Withdraw the text first; only a withdrawn text of your own can be deleted.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_confirm, '')) <> btrim(v_title) then
    raise exception 'Type the title exactly to confirm deletion.' using errcode = '22023';
  end if;

  delete from public.reels where id = p_reel_id;
  return jsonb_build_object('ok', true, 'id', p_reel_id::text, 'title', v_title, 'deleted', true);
end;
$$;

revoke all on function public.delete_my_bok(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_my_bok(uuid, text) to authenticated;

-- ---------------------------------------------- one piece, for its author

create or replace function public.get_my_bok_stats(p_reel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_bok public.reels;
  v_result jsonb;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select * into v_bok from public.reels where id = p_reel_id and author_user_id = v_uid;
  if v_bok.id is null then
    raise exception 'That boks is not available.' using errcode = '42501';
  end if;

  -- The definitions of `get_admin_bok`, without the author's own reading:
  -- opening your own piece to check it is not a reader.
  with events as (
    select e.user_id, e.session_id, e.event_type, e.active_seconds, e.created_at
    from public.recommendation_events e
    where e.reel_id = p_reel_id and e.surface = 'reader'
      and e.user_id is distinct from v_uid
  ),
  session_reading as (
    select session_id, max(active_seconds) as active_seconds
    from events where event_type <> 'impression'
    group by session_id
  ),
  metrics as (
    select
      coalesce((select round(sum(active_seconds) / 60.0)::integer from session_reading), 0) as minutes,
      (select count(distinct user_id)::integer from events where event_type <> 'impression') as readers,
      (select count(distinct user_id)::integer from events
        where event_type <> 'impression' and created_at >= now() - interval '7 days') as readers_week,
      (select count(*)::integer from events where event_type = 'impression') as impressions,
      (select count(*)::integer from events where event_type = 'start') as starts,
      (select count(*)::integer from events where event_type = 'complete') as completes,
      (select count(*)::integer from events where event_type = 'share') as shares,
      (select count(*)::integer from public.likes l where l.reel_id = p_reel_id and l.user_id <> v_uid) as likes,
      (select count(*)::integer from public.comments c where c.reel_id = p_reel_id) as comments,
      (select max(created_at) from events where event_type <> 'impression') as last_read_at
  )
  select jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'publishedAt', case when v_bok.status = 'published' then v_bok.reviewed_at else null end,
    'submittedAt', v_bok.submitted_at,
    'withdrawnAt', v_bok.withdrawn_at,
    'withdrawnFromStatus', v_bok.withdrawn_from_status,
    'metrics', jsonb_build_object(
      'readers', m.readers,
      'readersWeek', m.readers_week,
      'impressions', m.impressions,
      'starts', m.starts,
      'completes', m.completes,
      'finishRate', case when m.starts > 0 then round(m.completes * 100.0 / m.starts)::integer else null end,
      'minutes', m.minutes,
      'shares', m.shares,
      'likes', m.likes,
      'comments', m.comments,
      'lastReadAt', m.last_read_at
    ),
    -- The newest fifty, attributed by @handle as everywhere else.
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'createdAt', c.created_at,
        'handle', commenter.handle,
        'isReply', c.parent_comment_id is not null,
        'likes', (select count(*)::integer from public.comment_likes cl where cl.comment_id = c.id)
      ) order by c.created_at desc, c.id desc)
      from (
        select * from public.comments
        where reel_id = p_reel_id
        order by created_at desc, id desc
        limit 50
      ) c
      left join public.user_profiles commenter on commenter.user_id = c.user_id
    ), '[]'::jsonb)
  )
  into v_result
  from metrics m;

  return v_result;
end;
$$;

revoke all on function public.get_my_bok_stats(uuid) from public, anon, authenticated;
grant execute on function public.get_my_bok_stats(uuid) to authenticated;

-- ------------------------------------- an admin restore keeps the author's say

create or replace function public.restore_archived_bok(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_reel public.reels;
  v_back text;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select * into v_reel from public.reels where id = p_reel_id for update;
  if v_reel.id is null or v_reel.status <> 'archived' then
    raise exception 'Only a deleted boks can be restored.' using errcode = '22023';
  end if;

  -- Waiting, refused or withdrawn by its author goes back to that. Anything
  -- else - published, or hidden before the status was recorded - is
  -- published again. An admin restore never publishes what the author took down.
  v_back := case when v_reel.archived_from_status in ('pending_review', 'rejected', 'withdrawn')
    then v_reel.archived_from_status else 'published' end;

  if v_back = 'published' and not exists (
    select 1 from public.bok_rights rights
    where rights.reel_id = p_reel_id and rights.confirmed
  ) then
    raise exception 'Confirm publishing rights before restoring this boks.' using errcode = '42501';
  end if;

  update public.reels
  set status = v_back,
      archived_at = null,
      archived_by = null,
      archive_reason = null,
      archived_from_status = null,
      review_note = case when v_back = 'rejected' then review_note else null end,
      reviewed_at = case when v_back = 'published' then now() else reviewed_at end,
      reviewed_by = case when v_back = 'published' then v_caller else reviewed_by end,
      updated_at = now()
  where id = p_reel_id;

  return jsonb_build_object('ok', true, 'id', p_reel_id::text, 'title', v_reel.title, 'status', v_back);
end;
$$;

revoke all on function public.restore_archived_bok(uuid) from public, anon, authenticated;
grant execute on function public.restore_archived_bok(uuid) to authenticated;

-- --------------------------------------- resubmitting a withdrawn piece

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

-- ------------------------------------------ the history knows `withdrawn`

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
        'archived', (select count(*)::integer from mine where status = 'archived'),
        'withdrawn', (select count(*)::integer from mine where status = 'withdrawn')
      )
    )
  );
end;
$function$;

revoke all on function public.get_my_bok_submissions_page(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_my_bok_submissions_page(text, text, integer, integer) to authenticated;
