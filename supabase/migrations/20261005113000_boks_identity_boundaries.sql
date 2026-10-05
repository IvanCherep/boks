-- Identity boundaries, and a reader who could not leave.
--
-- 1. Deleting your own account failed for anyone who had ever liked,
--    commented or followed. `delete_my_boks_account` writes the tombstone and
--    then deletes the auth user; the cascade deletes their likes, and
--    `reject_blocked_boks_user_mutation` on `likes` saw a caller who is now
--    "deleted" and raised "This boks account is suspended", rolling the whole
--    deletion back. A suspended reader could not delete their account either,
--    because the anonymising UPDATE of their boks hit the same trigger. The
--    function now marks the transaction as erasing this caller's account, and
--    the trigger lets that one transaction through for that one caller.
--
-- 2. `user_profiles` could be INSERTed directly. The policy only checked
--    `user_id = auth.uid()`, so a fresh account could create its own row with
--    a reserved handle, `is_publisher`, a backdated cohort or a terms
--    acceptance it never gave - everything `ensure_boks_user_profile` enforces.
--    The app only ever creates a profile through that RPC.
--
-- 3. `boks_public_identity` listed every account's id and handle to anyone,
--    including people who never posted and suspended accounts. The views that
--    join it (`boks_comments`, `boks_reels`) run as their owner, so they keep
--    working; nothing in the client reads it directly.
--
-- 4. `is_boks_admin(uuid)` and `is_boks_user_blocked(uuid)` answered about any
--    id for any signed-in session - an oracle for who is an admin or banned.
--    They now answer about someone else only for an admin, or for a caller
--    with no JWT (the database owner, scripts, service role). Every call in the
--    schema is about the caller or comes after an admin check.
--
-- 5. `boks_embedding_coverage` is an operator number; guests could read it.

-- ------------------------------------------------------------ 1. self-erasure

create or replace function public.reject_blocked_boks_user_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  -- Set only by `delete_my_boks_account`, transaction-local, and only ever to
  -- the caller's own id: the erasure of one's own account is the one write a
  -- deleted or suspended account must still be able to make.
  if v_uid is not null
     and current_setting('boks.erasing_account', true) = v_uid::text then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_uid is not null and public.is_boks_user_blocked(v_uid) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;

  if v_uid is not null and tg_op <> 'DELETE' and tg_table_name in
    ('likes', 'comments', 'comment_likes', 'author_follows', 'bok_reports', 'reels')
     and (
       v_is_anonymous
       or not exists (
         select 1 from public.user_profiles p
         where p.user_id = v_uid and p.terms_accepted_at is not null
       )
     ) then
    raise exception 'Accept the boks terms before using this feature.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.reject_blocked_boks_user_mutation()
  from public, anon, authenticated;

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

  perform set_config('boks.erasing_account', v_uid::text, true);

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

  perform set_config('boks.erasing_account', '', true);

  return jsonb_build_object('ok', true, 'archivedBoks', v_archived);
end;
$$;

comment on function public.delete_my_boks_account(text) is
  'A reader deletes their own account after typing their handle. Authored boks are anonymised and hidden; admins cannot use it. Works for a suspended account too.';

revoke all on function public.delete_my_boks_account(text) from public, anon, authenticated;
grant execute on function public.delete_my_boks_account(text) to authenticated;

-- ------------------------------------------------- 2. no direct profile insert

drop policy if exists "Permanent readers can create their own profile" on public.user_profiles;
revoke insert on table public.user_profiles from authenticated;

-- ------------------------------------------- 3. no directory of every account

revoke select on public.boks_public_identity from anon, authenticated;

-- ------------------------------------------------- 4. role and ban oracles

create or replace function public.is_boks_admin(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      p_user_id is null
      or (select auth.uid()) is null
      or p_user_id = (select auth.uid())
      or exists (
        select 1 from public.user_profiles c
        where c.user_id = (select auth.uid())
          and c.role = 'admin'
          and c.banned_at is null
          and not exists (select 1 from public.deleted_boks_users d where d.user_id = c.user_id)
      )
    )
    and exists (
      select 1
      from public.user_profiles p
      where p.user_id = coalesce(p_user_id, (select auth.uid()))
        and p.role = 'admin'
        and p.banned_at is null
    )
    and not exists (
      select 1
      from public.deleted_boks_users d
      where d.user_id = coalesce(p_user_id, (select auth.uid()))
    );
$$;

revoke all on function public.is_boks_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_boks_admin(uuid) to authenticated;

create or replace function public.is_boks_user_blocked(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      p_user_id is null
      or (select auth.uid()) is null
      or p_user_id = (select auth.uid())
      or exists (
        select 1 from public.user_profiles c
        where c.user_id = (select auth.uid())
          and c.role = 'admin'
          and c.banned_at is null
          and not exists (select 1 from public.deleted_boks_users d where d.user_id = c.user_id)
      )
    )
    and (
      exists (
        select 1
        from public.user_profiles p
        where p.user_id = coalesce(p_user_id, (select auth.uid()))
          and p.banned_at is not null
      ) or exists (
        select 1
        from public.deleted_boks_users d
        where d.user_id = coalesce(p_user_id, (select auth.uid()))
      )
    );
$$;

revoke all on function public.is_boks_user_blocked(uuid) from public, anon, authenticated;
grant execute on function public.is_boks_user_blocked(uuid) to authenticated;

-- ------------------------------------------------ 5. operator-only coverage

create or replace function public.boks_embedding_coverage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is not null and not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'model', public.boks_embedding_model(),
    'publishedTotal', count(*) filter (where r.status = 'published'),
    'publishedEmbedded', count(*) filter (
      where r.status = 'published' and r.embedding is not null
        and r.embedding_model = public.boks_embedding_model()
    ),
    'publishedMissing', count(*) filter (
      where r.status = 'published'
        and (r.embedding is null or r.embedding_model is distinct from public.boks_embedding_model())
    ),
    'pendingMissing', count(*) filter (
      where r.status = 'pending_review'
        and (r.embedding is null or r.embedding_model is distinct from public.boks_embedding_model())
    ),
    'models', coalesce(jsonb_agg(distinct r.embedding_model) filter (where r.embedding_model is not null), '[]'::jsonb),
    'lastEmbeddedAt', max(r.embedded_at)
  )
  into v_result
  from public.reels r;

  return v_result;
end;
$$;

revoke all on function public.boks_embedding_coverage() from public, anon;
grant execute on function public.boks_embedding_coverage() to authenticated, service_role;
