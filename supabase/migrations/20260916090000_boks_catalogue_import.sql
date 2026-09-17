-- Bulk catalogue import.
--
-- The MVP needs ~500 boks on the platform, and later a publisher's whole
-- catalogue. Two facts about the data model already make that shape natural,
-- and neither was put there for this: a boks is attributed to an *account*
-- (`author_user_id`, which is the thing a reader follows) and carries a
-- separate per-piece byline (`author_name`, optional). So one account can
-- publish many pieces, each credited to a different writer. That is exactly
-- what a publisher is, and it needs no new identity columns.
--
-- What is missing is a safe way in:
--
--   * `submit_bok_for_review` is the author path. It caps an author at three
--     boks a day and files everything as `pending_review` - right for a
--     stranger, wrong for a catalogue.
--   * nothing marks an account as one that boks may be published *into*, so a
--     mistyped handle could pour 500 pieces into a reader's account.
--   * nothing makes a re-run safe. A 500-row load that fails at row 400 must
--     be resumable without leaving 400 duplicates behind.
--
-- This migration adds those three things and nothing else. Ranking, feeds,
-- follows and author pages need no changes: an imported boks is an ordinary
-- published boks.

-- ---------------------------------------------------------------- publishers

alter table public.user_profiles
  add column if not exists is_publisher boolean not null default false;

comment on column public.user_profiles.is_publisher is
  'An account boks may be published into by an admin. A guard, not a role: it does not grant its holder anything.';

create index if not exists user_profiles_publisher_idx
  on public.user_profiles (is_publisher)
  where is_publisher;

/**
 * Names that must not be claimable by whoever signs up first. `boks` is the
 * platform's own publisher account and would be a convincing impersonation in
 * anyone else's hands. An admin can still set them, which is how the official
 * accounts get their names.
 */
create or replace function public.boks_reserved_handles()
returns text[]
language sql
immutable
as $$
  select array['boks', 'admin', 'administrator', 'support', 'help', 'official', 'staff', 'team', 'moderator', 'boks_team'];
$$;

/**
 * Derivation has to respect the reserved list too. It does not go through
 * `update_boks_user_profile`, so without this an address whose local part is
 * `boks` would be handed the platform's own name at sign-up - which is the
 * thing the list exists to prevent. A reserved base is treated as a collision,
 * so it gets a number after it like any other taken name.
 */
create or replace function public.generate_boks_handle(p_seed text, p_user_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_base text := public.normalize_boks_handle(p_seed);
  v_candidate text;
  v_attempt integer := 0;
begin
  if p_user_id is null then
    raise exception 'User id is required for handle generation.' using errcode = '22023';
  end if;

  if v_base is null or char_length(v_base) < 3 then
    v_base := 'reader_' || left(replace(p_user_id::text, '-', ''), 8);
  end if;

  v_base := left(v_base, 24);
  v_candidate := v_base;

  while v_candidate = any (public.boks_reserved_handles())
     or exists (
          select 1 from public.user_profiles
          where lower(handle) = lower(v_candidate) and user_id <> p_user_id
        ) loop
    v_attempt := v_attempt + 1;
    -- Widens after a few collisions so this always terminates.
    v_candidate :=
      left(v_base, 24 - (case when v_attempt < 6 then 5 else 8 end))
      || '_'
      || lpad(floor(random() * (case when v_attempt < 6 then 10000 else 10000000 end))::text,
              case when v_attempt < 6 then 4 else 7 end, '0');
  end loop;

  return v_candidate;
end;
$$;

create or replace function public.update_boks_user_profile(
  p_display_name text default '',
  p_handle text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_requested text := nullif(lower(trim(leading '@' from btrim(coalesce(p_handle, '')))), '');
  v_email text;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Permanent sign in required.' using errcode = '42501';
  end if;

  if v_requested is not null and not public.boks_handle_is_valid(v_requested) then
    if char_length(v_requested) < 3 then
      raise exception 'A nickname needs at least 3 characters.' using errcode = '22023';
    end if;
    if char_length(v_requested) > 24 then
      raise exception 'A nickname can be at most 24 characters.' using errcode = '22023';
    end if;
    if v_requested !~ '^[a-z0-9_]+$' then
      raise exception 'A nickname can only use English letters, numbers and underscores.' using errcode = '22023';
    end if;
    raise exception 'A nickname has to start with a letter.' using errcode = '22023';
  end if;

  -- Reserved names are refused for everyone but an admin, who needs them to
  -- set up the platform's own accounts.
  if v_requested is not null
     and v_requested = any (public.boks_reserved_handles())
     and not public.is_boks_admin() then
    raise exception 'That nickname is reserved.' using errcode = '22023';
  end if;

  if v_requested is not null and exists (
    select 1 from public.user_profiles
    where lower(handle) = v_requested and user_id <> v_uid
  ) then
    raise exception 'That nickname is taken.' using errcode = '23505';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.user_profiles (user_id, handle)
  values (v_uid, coalesce(v_requested, public.generate_boks_handle(public.boks_handle_seed_from_email(v_email), v_uid)))
  on conflict (user_id) do update
  set handle = coalesce(v_requested, public.user_profiles.handle),
      updated_at = now();

  return public.get_boks_user_context();
end;
$$;

/** Marks an account as a publisher, or stops being one. Admin only. */
create or replace function public.set_boks_publisher(p_handle text, p_is_publisher boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := nullif(lower(trim(leading '@' from btrim(coalesce(p_handle, '')))), '');
  v_user_id uuid;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_handle is null then
    raise exception 'A nickname is required.' using errcode = '22023';
  end if;

  update public.user_profiles
  set is_publisher = coalesce(p_is_publisher, true), updated_at = now()
  where lower(handle) = v_handle
  returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'No account holds the nickname @%.', v_handle using errcode = '22023';
  end if;

  return jsonb_build_object(
    'handle', v_handle,
    'userId', v_user_id::text,
    'isPublisher', coalesce(p_is_publisher, true)
  );
end;
$$;

/**
 * The accounts an import may target, with what each already holds, so the
 * console can offer a picker rather than a free-text handle field. Admin only:
 * it is a list of accounts.
 */
create or replace function public.list_boks_publishers()
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
      'handle', p.handle,
      'userId', p.user_id::text,
      'published', (select count(*)::integer from public.reels r
                    where r.author_user_id = p.user_id and r.status = 'published'),
      'imported', (select count(*)::integer from public.reels r
                   where r.author_user_id = p.user_id and r.import_key is not null),
      'followers', (select count(*)::integer from public.author_follows f
                    where f.author_user_id = p.user_id)
    ) order by p.handle)
    from public.user_profiles p
    where p.is_publisher and p.handle is not null
  ), '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------------- the import key

/**
 * The caller's own stable id for a piece - a filename, a publisher's catalogue
 * number. It exists so a load can be repeated: the second run of the same 500
 * rows must import nothing rather than double the catalogue. Unique per
 * account, so two publishers may both use "001".
 */
alter table public.reels
  add column if not exists import_key text;

comment on column public.reels.import_key is
  'The importer''s stable id for this piece, unique per publishing account. Null for anything submitted through the author form.';

create unique index if not exists reels_import_key_unique_idx
  on public.reels (author_user_id, import_key)
  where import_key is not null;

-- ------------------------------------------------------------------- the load

/**
 * Imports a batch of boks into a publisher account.
 *
 * Rows are validated and reported one at a time rather than as a transaction:
 * a 500-row catalogue with one bad row should import 499 and tell you about the
 * one, not refuse the lot. Each row runs in its own subtransaction, so a
 * failure cannot poison its neighbours.
 *
 * `p_rows` is an array of objects:
 *   importKey  required, the caller's stable id for the piece
 *   title      required
 *   text       required, within `boks_max_text_characters()`
 *   hook       optional, one line shown before the piece
 *   authorName optional, the byline; absent means the publisher's @handle alone
 *   createdAt  optional, so a catalogue can keep its own dates
 *
 * Returns one result per row, in order, with `status` one of
 * `imported` / `skipped` / `rejected` and a reason when it is not `imported`.
 */
create or replace function public.import_boks_batch(
  p_publisher_handle text,
  p_rows jsonb,
  p_publish boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := (select auth.uid());
  v_handle text := nullif(lower(trim(leading '@' from btrim(coalesce(p_publisher_handle, '')))), '');
  v_publisher uuid;
  v_status text := case when coalesce(p_publish, true) then 'published' else 'pending_review' end;
  v_limit integer := public.boks_max_text_characters();
  v_results jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index integer := 0;
  v_key text;
  v_title text;
  v_text text;
  v_hook text;
  v_author_name text;
  v_created timestamptz;
  v_id uuid;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_handle is null then
    raise exception 'A publisher nickname is required.' using errcode = '22023';
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
    v_hook := btrim(coalesce(v_row ->> 'hook', ''));
    v_author_name := left(nullif(btrim(coalesce(v_row ->> 'authorName', '')), ''), 120);

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
        title, author_name, hook, text, status, author_user_id,
        import_key, is_seed, created_at, submitted_at, reviewed_at, reviewed_by, updated_at
      )
      values (
        v_title, v_author_name, left(v_hook, 500), v_text, v_status, v_publisher,
        v_key, false, v_created, v_created,
        case when v_status = 'published' then now() else null end,
        case when v_status = 'published' then v_admin else null end,
        now()
      )
      returning id into v_id;

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
$$;

/**
 * Removes an imported batch, matched on an import-key prefix.
 *
 * This is for test data. Deleting a boks cascades to its views, likes,
 * comments and recommendation events, which is correct - measurements about a
 * piece nobody can read any more are noise - and irreversible. `p_confirm`
 * has to name the same prefix, so a prefix cannot be deleted by a stray call.
 */
create or replace function public.delete_boks_import(
  p_publisher_handle text,
  p_import_key_prefix text,
  p_confirm text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := nullif(lower(trim(leading '@' from btrim(coalesce(p_publisher_handle, '')))), '');
  v_prefix text := nullif(btrim(coalesce(p_import_key_prefix, '')), '');
  v_publisher uuid;
  v_matched integer;
  v_deleted integer := 0;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_handle is null or v_prefix is null then
    raise exception 'A publisher nickname and an import-key prefix are required.' using errcode = '22023';
  end if;

  select user_id into v_publisher
  from public.user_profiles
  where lower(handle) = v_handle;

  if v_publisher is null then
    raise exception 'No account holds the nickname @%.', v_handle using errcode = '22023';
  end if;

  select count(*) into v_matched
  from public.reels
  where author_user_id = v_publisher
    and import_key is not null
    and import_key like v_prefix || '%';

  if p_confirm is null or p_confirm <> v_prefix then
    return jsonb_build_object(
      'publisher', v_handle, 'prefix', v_prefix, 'matched', v_matched, 'deleted', 0,
      'note', format('Nothing deleted. Repeat the call with p_confirm = %L to delete these %s boks.', v_prefix, v_matched)
    );
  end if;

  delete from public.reels
  where author_user_id = v_publisher
    and import_key is not null
    and import_key like v_prefix || '%';

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'publisher', v_handle, 'prefix', v_prefix, 'matched', v_matched, 'deleted', v_deleted
  );
end;
$$;

-- ------------------------------------------------------------------- access

revoke all on function public.update_boks_user_profile(text, text) from public, anon, authenticated;
grant execute on function public.update_boks_user_profile(text, text) to authenticated;

revoke all on function public.boks_reserved_handles() from public, anon, authenticated;
grant execute on function public.boks_reserved_handles() to authenticated;

revoke all on function public.generate_boks_handle(text, uuid) from public, anon, authenticated;
grant execute on function public.generate_boks_handle(text, uuid) to authenticated;

revoke all on function public.set_boks_publisher(text, boolean) from public, anon, authenticated;
grant execute on function public.set_boks_publisher(text, boolean) to authenticated;

revoke all on function public.list_boks_publishers() from public, anon, authenticated;
grant execute on function public.list_boks_publishers() to authenticated;

revoke all on function public.import_boks_batch(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_boks_batch(text, jsonb, boolean) to authenticated;

revoke all on function public.delete_boks_import(text, text, text) from public, anon, authenticated;
grant execute on function public.delete_boks_import(text, text, text) to authenticated;
