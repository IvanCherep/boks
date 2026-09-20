-- Fixes found in the pre-launch QA pass, before the first 100 test readers.
-- See docs/handover/2026-09-19-pre-launch-qa.md.

-- ------------------------------------------------------ titles with no words
-- An untitled Russian poem is catalogued as "* * *". The optional-title rule
-- only filled empty titles, so that one was shown as a heading of asterisks.
-- A title with no words in it now counts as empty and becomes the first line.

create or replace function public.boks_reels_title_and_hook()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Retired: see 20260919240000_boks_optional_title_no_hook.sql.
  new.hook := '';
  if btrim(coalesce(new.title, '')) = ''
     or new.title !~ '[^][:space:]*•·.,;:!?…—–_=~#"''«»()[-]' then
    new.title := public.boks_title_from_text(new.text);
  else
    new.title := btrim(new.title);
  end if;
  return new;
end;
$$;

-- Fires the trigger for the rows it applies to.
update public.reels
set title = ''
where title !~ '[^][:space:]*•·.,;:!?…—–_=~#"''«»()[-]';


-- --------------------------------------- hide and restore keep the status
-- Restoring always published. Hiding a boks that was waiting for review, or
-- had been refused, and restoring it put it in the feed without review. The
-- status it had is now remembered and given back; only a boks that was
-- published comes back published, and that still needs confirmed rights.

alter table public.reels
  add column if not exists archived_from_status text;

create or replace function public.archive_bok(p_reel_id uuid, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      review_note = v_reason,
      updated_at = now()
  where id = p_reel_id and status <> 'archived'
  returning title into v_title;

  if v_title is null then
    raise exception 'Boks does not exist or is already deleted.' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'id', p_reel_id::text, 'title', v_title, 'status', 'archived');
end;
$$;

revoke all on function public.archive_bok(uuid, text) from public, anon, authenticated;
grant execute on function public.archive_bok(uuid, text) to authenticated;

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

  -- Waiting or refused goes back to waiting or refused. Anything else -
  -- published, or hidden before the status was recorded - is published again.
  v_back := case when v_reel.archived_from_status in ('pending_review', 'rejected')
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


-- ---------------------------------------------- approval needs the rights
-- Approve accepted any boks waiting, refused or deleted, without looking at
-- the rights. A copyright takedown sets the boks to refused and withdraws the
-- rights record, so one Approve click put a taken-down piece back up, and an
-- archived boks could skip Restore's own rights check. Approve now needs
-- confirmed rights, and a deleted boks is restored, not approved.

create or replace function public.review_bok_submission(
  p_bok_id uuid,
  p_decision text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_bok public.reels;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject.' using errcode = '22023';
  end if;

  if v_decision = 'reject' and v_reason = '' then
    raise exception 'Rejection reason is required.' using errcode = '22023';
  end if;

  if v_decision = 'approve' and not exists (
    select 1 from public.bok_rights rights where rights.reel_id = p_bok_id and rights.confirmed
  ) then
    raise exception 'The publishing rights for this boks are not confirmed. Check them in the Rights tab first.'
      using errcode = '42501';
  end if;

  update public.reels
  set
    status = case when v_decision = 'approve' then 'published' else 'rejected' end,
    reviewed_at = now(),
    reviewed_by = v_caller,
    review_note = case when v_decision = 'approve' then null else left(v_reason, 1000) end,
    updated_at = now()
  where id = p_bok_id
    and status in ('pending_review', 'rejected')
  returning * into v_bok;

  if v_bok.id is null then
    raise exception 'Bok is not available for review.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'reviewedAt', v_bok.reviewed_at,
    'reviewNote', v_bok.review_note
  );
end;
$$;

revoke all on function public.review_bok_submission(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_bok_submission(uuid, text, text) to authenticated;


-- ------------------------------------------------------- deleting comments
-- There was no way to take a comment back: not for the person who wrote it,
-- not for an admin facing an abusive one. The writer may delete their own; an
-- admin may delete any. Replies go with the comment they answer (the foreign
-- key already cascades), which the confirmation says.

create or replace function public.delete_boks_comment(p_comment_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_owner uuid;
  v_reel uuid;
  v_replies integer;
begin
  if v_caller is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select user_id, reel_id into v_owner, v_reel
  from public.comments
  where id = p_comment_id
  for update;

  if v_reel is null then
    raise exception 'That comment no longer exists.' using errcode = '22023';
  end if;

  if v_owner is distinct from v_caller and not public.is_boks_admin(v_caller) then
    raise exception 'You can delete only your own comments.' using errcode = '42501';
  end if;

  select count(*)::integer into v_replies from public.comments where parent_comment_id = p_comment_id;
  delete from public.comments where id = p_comment_id;

  return jsonb_build_object(
    'ok', true,
    'id', p_comment_id,
    'reelId', v_reel::text,
    'repliesRemoved', v_replies
  );
end;
$$;

comment on function public.delete_boks_comment(bigint) is
  'Deletes a comment and its replies. Its writer may delete it; an admin may delete any.';

revoke all on function public.delete_boks_comment(bigint) from public, anon, authenticated;
grant execute on function public.delete_boks_comment(bigint) to authenticated;


-- -------------------------------------------------- revising in place
-- Revising a refused boks inserted a second boks: the original stayed refused
-- with its Revise button, stayed in the review queue where it could still be
-- approved, and the author saw two copies. With `p_bok_id` the refused row is
-- resubmitted itself and goes back to waiting for review.

drop function if exists public.submit_bok_for_review(text, text, text, text, text, integer, text, boolean, text);

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

  v_author_name := left(nullif(btrim(coalesce(p_author_name, '')), ''), 120);

  v_used := public.count_my_boks_submitted_today();

  if v_used >= v_limit then
    raise exception 'Daily limit reached. You can submit % boks a day.', v_limit using errcode = '54023';
  end if;

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


-- ------------------------------------------- the library names the author
-- A boks published without a byline showed "boks author" in the reader's
-- library: the RPC returned the byline and not the @handle every boks has.

create or replace function public.get_my_reader_library(p_limit integer default 120)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 120), 1), 300);
  v_anonymous boolean := coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false);
begin
  if v_uid is null or v_anonymous then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with read_activity as (
      select v.reel_id, max(v.created_at) as read_at
      from public.views v
      where v.user_id = v_uid
      group by v.reel_id
    ),
    liked_activity as (
      select l.reel_id, l.created_at as liked_at
      from public.likes l
      where l.user_id = v_uid
    ),
    commented_activity as (
      select c.reel_id, max(c.created_at) as commented_at
      from public.comments c
      where c.user_id = v_uid
      group by c.reel_id
    ),
    selected_ids as (
      select reel_id from (
        select reel_id from read_activity order by read_at desc limit v_limit
      ) recent_reads
      union
      select reel_id from (
        select reel_id from liked_activity order by liked_at desc limit v_limit
      ) recent_likes
      union
      select reel_id from (
        select reel_id from commented_activity order by commented_at desc limit v_limit
      ) recent_comments
    ),
    activity as (
      select
        selected_ids.reel_id,
        read_activity.read_at,
        liked_activity.liked_at,
        commented_activity.commented_at
      from selected_ids
      left join read_activity using (reel_id)
      left join liked_activity using (reel_id)
      left join commented_activity using (reel_id)
    )
    select jsonb_agg(jsonb_build_object(
      'storyId', b.id::text,
      'title', b.title,
      'authorName', b.author_name,
      'authorHandle', b.author_handle,
      'minutes', b.minutes,
      'readAt', activity.read_at,
      'likedAt', activity.liked_at,
      'commentedAt', activity.commented_at,
      'liked', activity.liked_at is not null,
      'commented', activity.commented_at is not null
    ) order by greatest(
      coalesce(activity.read_at, '-infinity'::timestamptz),
      coalesce(activity.liked_at, '-infinity'::timestamptz),
      coalesce(activity.commented_at, '-infinity'::timestamptz)
    ) desc)
    from activity
    join public.published_boks b on b.id = activity.reel_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_reader_library(integer) from public, anon, authenticated;
grant execute on function public.get_my_reader_library(integer) to authenticated;


-- -------------------------------------------- deleting your own account
-- Only an admin could delete an account. A pilot that collects email
-- addresses and reading behaviour from external testers needs a way for a
-- person to leave on their own. Same effect as an admin deletion: authored
-- boks are anonymised and hidden (not erased), reactions and profile go with
-- the account, and a UUID-only tombstone blocks the old session's JWT.
-- An admin cannot do this to themselves, so the last admin cannot vanish.

create or replace function public.delete_my_boks_account(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  update public.reels
  set archived_from_status = status,
      status = 'archived',
      archived_at = now(),
      archived_by = null,
      archive_reason = 'The author deleted their account.',
      review_note = 'The author deleted their account.',
      author_user_id = null,
      author_name = 'Deleted author',
      author_handle = null,
      updated_at = now()
  where author_user_id = v_uid;
  get diagnostics v_archived = row_count;

  insert into public.deleted_boks_users (user_id, deleted_by)
  values (v_uid, v_uid)
  on conflict (user_id) do update set deleted_at = now(), deleted_by = excluded.deleted_by;

  delete from auth.users where id = v_uid;

  return jsonb_build_object('ok', true, 'archivedBoks', v_archived);
end;
$$;

comment on function public.delete_my_boks_account(text) is
  'A reader deletes their own account after typing their nickname. Authored boks are anonymised and hidden; admins cannot use it.';

revoke all on function public.delete_my_boks_account(text) from public, anon, authenticated;
grant execute on function public.delete_my_boks_account(text) to authenticated;
