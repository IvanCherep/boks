-- boks: one author page, one row (2026-11-16)
--
-- An account's page lived in two places: its name and photo in
-- `author_pages` (20261110100000), everything else in `author_spaces`
-- (20261114100000). Accepting an invitation copied the prepared name and
-- photo across once, and from then on Studio edited a copy readers no longer
-- saw, while the owner's preview and the public page could disagree on the
-- name. Now `author_spaces` is the page:
--
--   * Every `author_pages` row moves onto its account's space: the space the
--     account already owns, or a new published one (an account that had only
--     set a name or photo had a public page, and keeps it). The photo keeps
--     its version, so every `/a/<handle>/photo?v=<version>` already shared
--     stays valid, and the page keeps the version an open cabinet tab holds.
--     Then `author_pages` is dropped.
--   * The author's cabinet (`get_my_author_page`, `save_my_author_page`),
--     the public reads (`get_boks_author_page`, `get_boks_author_photo`), the
--     preview, the invitation and the byline read and write the space. Studio
--     edits the same row, so an edit of an owned page is what readers see.
--     A space that is a draft or unpublished still hides the page.
--   * `author_space_works.note` repeated the author's request for changes,
--     already kept in the page's conversation. The column goes; the work's
--     `note` is now the author's latest message about it while the work waits
--     for changes.
--   * Deleting an account takes its page down (status `unpublished`) and
--     clears its name and photo, as the cascade on `author_pages` used to;
--     until now the page stayed published with no owner.
--
-- Every function keeps its name, arguments and the JSON fields it returns:
-- open tabs and the live client keep working.

-- ------------------------------------------------------- the data moves over

-- The account's own space, when it has one: the author's name and photo are
-- what readers saw, so they win over whatever Studio last left there.
update public.author_spaces s
set name = a.page_name,
    photo = a.photo,
    photo_version = case when a.photo is null then greatest(s.photo_version, a.version) else a.version end,
    version = greatest(s.version, a.version),
    updated_at = now()
from public.author_pages a
where s.owner_user_id = a.user_id and s.status <> 'merged';

-- No space yet: the page was public (no space hid it), so it is published.
insert into public.author_spaces (
  kind, status, owner_user_id, name, photo, photo_version, version,
  created_by, created_at, updated_at, published_at
)
select 'author', 'published', a.user_id, a.page_name, a.photo, a.version, a.version,
  a.user_id, a.updated_at, a.updated_at, a.updated_at
from public.author_pages a
where not exists (
  select 1 from public.author_spaces s where s.owner_user_id = a.user_id and s.status <> 'merged'
);

-- A request for changes the conversation does not carry yet (none expected:
-- `request_author_space_changes` always wrote both).
insert into public.author_space_messages (space_id, work_id, from_author, body, created_by, created_at)
select w.space_id, w.id, true, w.note, null, w.updated_at
from public.author_space_works w
where w.note is not null and w.status = 'changes_requested'
  and not exists (select 1 from public.author_space_messages m where m.work_id = w.id and m.from_author);

drop table public.author_pages;
alter table public.author_space_works drop column note;

-- ------------------------------------------------------------- the author's own

create or replace function public.get_my_author_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_space public.author_spaces;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged';

  return jsonb_build_object(
    'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
    'name', v_space.name,
    'photoVersion', case when v_space.photo is null then null else v_space.photo_version end,
    -- The photo itself, for its owner only: shown whether or not the page is open.
    'photo', case when v_space.photo is null then null else encode(v_space.photo, 'base64') end,
    -- The page's version, shared with Studio: a save from either side makes
    -- the other's open tab stale.
    'version', coalesce(v_space.version, 0)
  );
end;
$$;

-- p_photo: 'keep' leaves the photo as it is, 'remove' takes it off, and
-- anything else is the new photo, base64. An account with no page yet gets
-- one, published, as a name or photo set here always was.
create or replace function public.save_my_author_page(
  p_name text,
  p_photo text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_current public.author_spaces;
  v_photo bytea;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if exists (select 1 from public.user_profiles p where p.user_id = v_uid and p.banned_at is not null) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;

  if v_name is not null and (char_length(v_name) > 60 or v_name ~ '[<>[:cntrl:]]') then
    raise exception 'The name on your page can be at most 60 characters, without < or >.' using errcode = '22023';
  end if;

  select * into v_current from public.author_spaces
  where owner_user_id = v_uid and status <> 'merged'
  for update;

  if coalesce(v_current.version, 0) <> coalesce(p_version, -1) then
    raise exception 'Your page was changed in another tab. Reload to see the latest version.' using errcode = '40001';
  end if;

  if p_photo is null or p_photo = 'keep' then
    v_photo := v_current.photo;
  elsif p_photo = 'remove' then
    v_photo := null;
  else
    begin
      v_photo := decode(p_photo, 'base64');
    exception when others then
      raise exception 'This photo could not be read. Choose another one.' using errcode = '22023';
    end;
    if octet_length(v_photo) > 700000 or substring(v_photo from 1 for 3) <> '\xffd8ff'::bytea then
      raise exception 'This photo could not be read. Choose another one.' using errcode = '22023';
    end if;
  end if;

  if v_current.id is null then
    begin
      insert into public.author_spaces (kind, status, owner_user_id, name, photo, photo_version, version, created_by, published_at)
      values ('author', 'published', v_uid, v_name, v_photo, case when v_photo is null then 0 else 1 end, 1, v_uid, now());
    exception when unique_violation then
      -- Another tab created the page a moment ago.
      raise exception 'Your page was changed in another tab. Reload to see the latest version.' using errcode = '40001';
    end;
  else
    update public.author_spaces
    set name = v_name,
        photo = v_photo,
        -- A new photo is a new address, so no cache holds on to the old one.
        photo_version = case when v_photo is distinct from photo then photo_version + 1 else photo_version end,
        version = version + 1,
        updated_at = now()
    where id = v_current.id;
  end if;

  return public.get_my_author_page();
end;
$$;

-- ------------------------------------------------------------- what readers see

-- Name, photo and card of a page: an account's published page by its
-- @handle, or an editorial page by its own handle. A page whose space is a
-- draft or unpublished has none; an account with no page has none (its page
-- shows the byline and a monogram, as always).
create or replace function public.get_boks_author_page(p_handle text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'name', s.name,
        'photoVersion', case when s.photo is null then null else s.photo_version end,
        'shareCard', s.share_card,
        'shareVideo', s.share_video
      )
      from public.user_profiles p
      join public.author_spaces s on s.owner_user_id = p.user_id and s.status = 'published'
      where lower(p.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
        and p.banned_at is null
    ),
    (
      select jsonb_build_object(
        'name', s.name,
        'photoVersion', case when s.photo is null then null else s.photo_version end,
        'kind', 'editorial',
        'shareCard', s.share_card,
        'shareVideo', s.share_video
      )
      from public.author_spaces s
      where s.kind = 'editorial' and s.status = 'published'
        and lower(s.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
    )
  );
$$;

create or replace function public.get_boks_author_photo(p_handle text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object('version', s.photo_version, 'jpeg', encode(s.photo, 'base64'))
      from public.user_profiles p
      join public.author_spaces s on s.owner_user_id = p.user_id and s.status = 'published'
      where lower(p.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
        and p.banned_at is null
        and s.photo is not null
    ),
    (
      select jsonb_build_object('version', s.photo_version, 'jpeg', encode(s.photo, 'base64'))
      from public.author_spaces s
      where s.kind = 'editorial' and s.status = 'published' and s.photo is not null
        and lower(s.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
    )
  );
$$;

-- ------------------------------------------------------------- works

-- One work, as both Studio and the cabinet show it. `note` is the author's
-- request for changes: their latest message about the work while it waits.
create or replace function public.boks_space_work_json(p_work public.author_space_works, p_with_body boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_work.id::text,
    'position', p_work.position,
    'title', p_work.title,
    'format', p_work.format,
    'status', p_work.status,
    'revision', p_work.revision,
    'publishedRevision', p_work.published_revision,
    'seriesPublished', p_work.series_published,
    'seriesPiece', p_work.series_piece,
    'note', case when p_work.status = 'changes_requested' then (
      select m.body from public.author_space_messages m
      where m.work_id = p_work.id and m.from_author
      order by m.created_at desc, m.id desc
      limit 1
    ) end,
    'rightsNote', p_work.rights_note,
    'readyAt', p_work.ready_at,
    'publishedAt', p_work.published_at,
    'updatedAt', p_work.updated_at,
    'bokId', p_work.bok_id::text,
    'bokTitle', r.title,
    'bokStatus', r.status,
    'characters', char_length(coalesce(p_work.body, r.text, '')),
    'body', case when p_with_body then coalesce(p_work.body, r.text) else null end
  )
  from (select 1) one
  left join public.reels r on r.id = p_work.bok_id;
$$;

create or replace function public.request_author_space_changes(p_work_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_work public.author_space_works;
begin
  select * into v_work from public.author_space_works where id = p_work_id for update;
  if v_work.id is null or public.boks_space_access(v_work.space_id) is distinct from 'owner' then
    raise exception 'This work is not available.' using errcode = '42501';
  end if;
  if v_work.status not in ('preparing', 'ready', 'changes_requested') then
    raise exception 'Changes are asked for before a work is published.' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) > 1000 then
    raise exception 'Say briefly what to change (up to 1000 characters).' using errcode = '22023';
  end if;
  update public.author_space_works
  set status = 'changes_requested', updated_at = now()
  where id = v_work.id;
  insert into public.author_space_messages (space_id, work_id, from_author, body, created_by)
  values (v_work.space_id, v_work.id, true, v_note, (select auth.uid()));
  return public.get_my_author_space();
end;
$$;

create or replace function public.studio_set_space_work_status(
  p_work_id uuid,
  p_status text,
  p_rights_note text default '',
  p_reply text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_work public.author_space_works;
begin
  if v_status not in ('preparing', 'ready') then
    raise exception 'A work is marked ready, or back in preparation.' using errcode = '22023';
  end if;
  select * into v_work from public.author_space_works where id = p_work_id for update;
  if v_work.id is null or v_work.status in ('published', 'withdrawn') then
    raise exception 'This work cannot change state now.' using errcode = '22023';
  end if;
  if v_status = 'ready' and nullif(btrim(coalesce(p_rights_note, '')), '') is null then
    raise exception 'Say what was checked: text, format, files and rights.' using errcode = '22023';
  end if;

  -- The author asked for changes and they are done: tell them, in the page's
  -- conversation, with the team's own words when given.
  if v_status = 'ready' and v_work.status = 'changes_requested' then
    insert into public.author_space_messages (space_id, work_id, from_author, body, created_by)
    values (v_work.space_id, v_work.id, false,
      coalesce(nullif(btrim(coalesce(p_reply, '')), ''), 'Правки внесены. Посмотрите новую версию: если всё так, её можно публиковать.'),
      v_uid);
  end if;

  update public.author_space_works
  set status = v_status,
      rights_note = case when v_status = 'ready' then left(btrim(p_rights_note), 500) else rights_note end,
      ready_by = case when v_status = 'ready' then v_uid else null end,
      ready_at = case when v_status = 'ready' then now() else null end,
      updated_at = now()
  where id = v_work.id;

  return public.studio_author_space(v_work.space_id);
end;
$$;

-- -------------------------------------------------------------- Studio

-- Owned or not, this is the page readers see. An owned page may have no name
-- (the author cleared it: the page shows the handle); one not yet handed over
-- needs one.
-- p_photo: null or 'keep' leaves it, 'remove' takes it off, else base64 JPEG.
create or replace function public.studio_save_author_space(
  p_space_id uuid,
  p_kind text,
  p_name text,
  p_handle text,
  p_photo text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_kind text := lower(btrim(coalesce(p_kind, 'author')));
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_handle text := nullif(lower(btrim(ltrim(btrim(coalesce(p_handle, '')), '@'))), '');
  v_space public.author_spaces;
  v_photo bytea;
begin
  if v_kind not in ('author', 'editorial') then
    raise exception 'Unknown page kind.' using errcode = '22023';
  end if;

  if p_space_id is not null then
    select * into v_space from public.author_spaces where id = p_space_id for update;
    if v_space.id is null or v_space.status = 'merged' then
      raise exception 'This page does not exist.' using errcode = 'P0002';
    end if;
    if v_space.version <> coalesce(p_version, -1) then
      raise exception 'This page was changed in another tab. Reload to see the latest version.' using errcode = '40001';
    end if;
    v_kind := v_space.kind;
  end if;

  if v_name is not null and (char_length(v_name) > 60 or v_name ~ '[<>[:cntrl:]]') then
    raise exception 'The name on the page is required: at most 60 characters, without < or >.' using errcode = '22023';
  end if;
  if v_name is null and v_space.owner_user_id is null then
    raise exception 'The name on the page is required: at most 60 characters, without < or >.' using errcode = '22023';
  end if;

  -- Once the author has accepted, the address is their account's @handle;
  -- the team no longer changes it.
  if v_space.owner_user_id is not null then
    v_handle := v_space.handle;
  elsif v_handle is not null then
    if not (v_handle ~ '^[a-z][a-z0-9_]{2,23}$') then
      raise exception 'The page address takes 3 to 24 English letters, digits or _, starting with a letter.' using errcode = '22023';
    end if;
    if exists (select 1 from public.user_profiles p where lower(p.handle) = v_handle)
       or exists (select 1 from public.author_handle_moves m where m.handle = v_handle)
       or exists (
         select 1 from public.author_spaces s
         where lower(s.handle) = v_handle and s.status <> 'merged' and s.id is distinct from v_space.id
       ) then
      raise exception 'The address @% is already taken.', v_handle using errcode = '23505';
    end if;
  elsif v_kind = 'editorial' then
    raise exception 'An editorial page needs its own address.' using errcode = '22023';
  end if;

  if p_photo is null or p_photo = 'keep' then
    v_photo := v_space.photo;
  elsif p_photo = 'remove' then
    v_photo := null;
  else
    begin
      v_photo := decode(p_photo, 'base64');
    exception when others then
      raise exception 'This photo could not be read. Choose another one.' using errcode = '22023';
    end;
    if octet_length(v_photo) > 700000 or substring(v_photo from 1 for 3) <> '\xffd8ff'::bytea then
      raise exception 'This photo could not be read. Choose another one.' using errcode = '22023';
    end if;
  end if;

  if v_space.id is null then
    insert into public.author_spaces (kind, name, handle, photo, photo_version, created_by)
    values (v_kind, v_name, v_handle, v_photo, case when v_photo is null then 0 else 1 end, v_uid)
    returning * into v_space;
  else
    update public.author_spaces
    set name = v_name,
        handle = v_handle,
        photo = v_photo,
        -- A new photo is a new address (`/a/<handle>/photo?v=`).
        photo_version = case when v_photo is distinct from photo then photo_version + 1 else photo_version end,
        version = version + 1,
        updated_at = now()
    where id = v_space.id
    returning * into v_space;
  end if;

  return public.studio_author_space(v_space.id);
end;
$$;

-- ------------------------------------------------------------- invitations

create or replace function public.peek_author_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_email text;
  v_invite public.author_space_invites;
  v_space public.author_spaces;
  v_state text;
begin
  if v_uid is null or v_is_anonymous then
    return jsonb_build_object('state', 'sign_in');
  end if;
  select * into v_invite from public.author_space_invites
  where token_hash = sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8'));
  if v_invite.id is null then
    return jsonb_build_object('state', 'invalid');
  end if;
  v_state := public.boks_invite_state(v_invite);
  if v_state = 'accepted' then
    return jsonb_build_object('state', case when v_invite.accepted_by = v_uid then 'accepted' else 'used' end);
  end if;
  if v_state <> 'pending' then
    return jsonb_build_object('state', v_state);
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_invite.email then
    return jsonb_build_object('state', 'wrong_email', 'emailHint', public.boks_mask_email(v_invite.email));
  end if;
  select * into v_space from public.author_spaces where id = v_invite.space_id;
  return jsonb_build_object(
    'state', 'pending',
    'existingPage', exists (select 1 from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged')
      or exists (select 1 from public.reels r where r.author_user_id = v_uid and r.status = 'published'),
    'works', (select count(*)::integer from public.author_space_works w where w.space_id = v_space.id and w.status <> 'withdrawn'),
    'series', (select count(*)::integer from public.author_space_works w where w.space_id = v_space.id and w.status <> 'withdrawn' and w.series_piece is not null),
    'name', v_space.name,
    -- The address the page will have: the account's own once it has a page,
    -- else the one the team proposed (it becomes the account's @name).
    'handle', coalesce(
      case when exists (select 1 from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged')
             or exists (select 1 from public.reels r where r.author_user_id = v_uid and r.status = 'published')
           then (select p.handle from public.user_profiles p where p.user_id = v_uid) end,
      v_space.handle,
      (select p.handle from public.user_profiles p where p.user_id = v_uid)
    )
  );
end;
$$;

create or replace function public.get_my_author_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_existing boolean;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    return '[]'::jsonb;
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    return '[]'::jsonb;
  end if;
  v_existing := exists (select 1 from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged')
    or exists (select 1 from public.reels r where r.author_user_id = v_uid and r.status = 'published');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'inviteId', i.id::text,
      'state', 'pending',
      'existingPage', v_existing,
      'works', (select count(*)::integer from public.author_space_works w where w.space_id = s.id and w.status <> 'withdrawn'),
      'series', (select count(*)::integer from public.author_space_works w where w.space_id = s.id and w.status <> 'withdrawn' and w.series_piece is not null),
      'name', s.name,
      'handle', case when v_existing then (select p.handle from public.user_profiles p where p.user_id = v_uid) else s.handle end,
      'expiresAt', i.expires_at
    ) order by i.created_at desc)
    from public.author_space_invites i
    join public.author_spaces s on s.id = i.space_id
    where i.email = v_email
      and public.boks_invite_state(i) = 'pending'
      and s.status <> 'merged' and s.owner_user_id is null
  ), '[]'::jsonb);
end;
$$;

-- A first page: the prepared space becomes the account's, name and photo
-- with it (it is the page). An existing page keeps its own name, photo,
-- address, order, followers and boks; the prepared works join it.
create or replace function public.accept_author_invite(p_token text, p_invite_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_email text;
  v_invite public.author_space_invites;
  v_space public.author_spaces;
  v_own public.author_spaces;
  v_state text;
  v_handle text;
  v_base integer;
  v_moved integer := 0;
  v_existing boolean;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in with the invited email first.' using errcode = '42501';
  end if;
  if public.is_boks_user_blocked(v_uid) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;

  if p_invite_id is not null then
    select * into v_invite from public.author_space_invites where id = p_invite_id for update;
  else
    select * into v_invite from public.author_space_invites
    where token_hash = sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8'))
    for update;
  end if;
  if v_invite.id is null then
    return jsonb_build_object('state', 'invalid');
  end if;

  v_state := public.boks_invite_state(v_invite);
  if v_state = 'accepted' then
    if v_invite.accepted_by = v_uid then
      return jsonb_build_object('state', 'accepted', 'repeat', true);
    end if;
    return jsonb_build_object('state', 'used');
  end if;
  if v_state <> 'pending' then
    return jsonb_build_object('state', v_state);
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_invite.email then
    return jsonb_build_object('state', 'wrong_email', 'emailHint', public.boks_mask_email(v_invite.email));
  end if;

  perform public.ensure_boks_user_profile('');
  -- Serialises this account's acceptances.
  perform 1 from public.user_profiles where user_id = v_uid for update;

  select * into v_space from public.author_spaces where id = v_invite.space_id for update;
  if v_space.id is null or v_space.status = 'merged' or v_space.owner_user_id is not null then
    return jsonb_build_object('state', 'used');
  end if;

  select * into v_own from public.author_spaces
  where owner_user_id = v_uid and status <> 'merged' for update;

  v_existing := v_own.id is not null
    or exists (select 1 from public.reels r where r.author_user_id = v_uid and r.status = 'published');

  if v_existing then
    -- The author already has a page: its name, photo, address, order,
    -- followers and published boks stay. The prepared works join it as
    -- drafts, after everything already there.
    if v_own.id is null then
      insert into public.author_spaces (kind, status, owner_user_id, name, created_by, published_at)
      values ('author', 'published', v_uid, null, v_invite.created_by, now())
      returning * into v_own;
    end if;
    -- Fix the order readers see now (newest first) before adding to it, so
    -- the new works land after it rather than above boks never ordered.
    insert into public.author_space_order (space_id, bok_id, position)
    select v_own.id, x.bok_id,
      coalesce((select max(o.position) from public.author_space_order o where o.space_id = v_own.id), 0)
        + row_number() over (order by x.created_at desc, x.bok_id)
    from public.boks_space_public_boks(v_own) x
    where x.sort_position is null
    on conflict (space_id, bok_id) do nothing;

    select coalesce(max(x.position), 0) into v_base
    from (
      select w.position from public.author_space_works w where w.space_id = v_own.id
      union all
      select o.position from public.author_space_order o where o.space_id = v_own.id
    ) x;
    with moving as (
      select w.id, row_number() over (order by w.position nulls last, w.created_at) as n
      from public.author_space_works w
      where w.space_id = v_space.id
        and not exists (select 1 from public.author_space_works d where d.space_id = v_own.id and d.bok_id = w.bok_id)
    )
    update public.author_space_works w
    set space_id = v_own.id, position = v_base + m.n, updated_at = now()
    from moving m where m.id = w.id;
    get diagnostics v_moved = row_count;

    update public.author_spaces
    set status = 'merged', merged_into = v_own.id, handle = null, updated_at = now()
    where id = v_space.id;
    v_space := v_own;
  else
    -- A first page. The address the team proposed becomes the account's
    -- @handle, unless another account has it: then nothing is bound and the
    -- editor is told.
    v_handle := v_space.handle;
    if v_handle is not null and v_handle is distinct from (select p.handle from public.user_profiles p where p.user_id = v_uid) then
      if exists (select 1 from public.user_profiles p where lower(p.handle) = lower(v_handle) and p.user_id <> v_uid) then
        update public.author_space_invites set problem = 'handle_taken' where id = v_invite.id;
        return jsonb_build_object('state', 'conflict');
      end if;
      update public.author_spaces set handle = null where id = v_space.id;
      perform set_config('boks.claiming_space_handle', v_handle, true);
      update public.user_profiles set handle = v_handle, updated_at = now() where user_id = v_uid;
      perform set_config('boks.claiming_space_handle', '', true);
    end if;

    -- The prepared name and photo are the page's already, still closed:
    -- public reads skip a space that is a draft.
    update public.author_spaces
    set owner_user_id = v_uid, handle = null, updated_at = now()
    where id = v_space.id
    returning * into v_space;

    select count(*)::integer into v_moved from public.author_space_works w where w.space_id = v_space.id;
  end if;

  update public.author_space_invites
  set accepted_at = now(), accepted_by = v_uid, problem = null
  where id = v_invite.id;

  return jsonb_build_object('state', 'accepted', 'existingPage', v_existing, 'works', v_moved, 'spaceId', v_space.id::text);
end;
$$;

-- ---------------------------------------------------------------- the owner

create or replace function public.get_my_author_space()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_space public.author_spaces;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged';

  return jsonb_build_object(
    'space', case when v_space.id is null then null else jsonb_build_object(
      'id', v_space.id::text,
      'status', v_space.status,
      'orderVersion', v_space.order_version,
      'publishedAt', v_space.published_at
    ) end,
    'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
    'name', v_space.name,
    'shareCard', v_space.share_card,
    'shareVideo', v_space.share_video,
    'messages', case when v_space.id is null then '[]'::jsonb else public.boks_space_messages_json(v_space.id) end,
    'unread', case when v_space.id is null then 0 else (
      select count(*)::integer from public.author_space_messages m
      where m.space_id = v_space.id and not m.from_author and m.created_at > coalesce(v_space.author_seen_at, '-infinity'::timestamptz)
    ) end,
    'orderVersion', coalesce(v_space.order_version, 0),
    -- One list: what readers see (published boks) and what is prepared, in
    -- the page's order. Published boks of a page never ordered keep the
    -- order readers know (newest first), after anything placed by hand.
    'items', coalesce((
      with published as (
        select b.id, b.title, b.created_at, o.position
        from public.published_boks b
        left join public.author_space_order o on o.space_id = v_space.id and o.bok_id = b.id
        where b.author_user_id = v_uid
      ),
      -- Works the author took off the site themselves (withdraw_my_bok): kept
      -- on the list, marked hidden, so they can be put back from here.
      hidden as (
        select b.id, b.title, b.created_at, o.position
        from public.reels b
        left join public.author_space_order o on o.space_id = v_space.id and o.bok_id = b.id
        where b.author_user_id = v_uid and b.status = 'withdrawn' and b.withdrawn_from_status = 'published'
      ),
      prepared as (
        select w.* from public.author_space_works w
        where w.space_id = v_space.id and w.status not in ('published', 'withdrawn')
      ),
      rows as (
        select 'b:' || p.id::text as key, p.position, p.created_at, 1 as published_first,
          jsonb_build_object(
            'key', 'b:' || p.id::text,
            'bokId', p.id::text,
            'title', p.title,
            'published', true,
            'format', coalesce(public.boks_space_bok_format(v_space.id, p.id) ->> 'format', 'text'),
            'seriesHeld', coalesce((public.boks_space_bok_format(v_space.id, p.id) ->> 'seriesHeld')::boolean, false),
            'work', (
              select public.boks_space_work_json(w)
              from public.author_space_works w
              where w.space_id = v_space.id and w.bok_id = p.id and w.status <> 'withdrawn'
              order by (w.format = 'series') desc limit 1
            )
          ) as item
        from published p
        union all
        select 'b:' || h.id::text, h.position, h.created_at, 1,
          jsonb_build_object(
            'key', 'b:' || h.id::text,
            'bokId', h.id::text,
            'title', h.title,
            'published', false,
            'hidden', true,
            'format', 'text',
            'work', (
              select public.boks_space_work_json(w)
              from public.author_space_works w
              where w.space_id = v_space.id and w.bok_id = h.id and w.status <> 'withdrawn'
              order by (w.format = 'series') desc limit 1
            )
          )
        from hidden h
        union all
        select 'w:' || w.id::text, w.position, w.created_at, 0,
          jsonb_build_object(
            'key', 'w:' || w.id::text,
            'bokId', w.bok_id::text,
            'title', w.title,
            'published', false,
            'format', w.format,
            'work', public.boks_space_work_json(w)
          )
        from prepared w
        -- A Series version of a published bok shows on that bok's row.
        where not (w.bok_id is not null and (
          exists (select 1 from published p where p.id = w.bok_id)
          or exists (select 1 from hidden h where h.id = w.bok_id)
        ))
      )
      select jsonb_agg(r.item order by r.position nulls last, r.created_at desc)
      from rows r
    ), '[]'::jsonb)
  );
end;
$$;

-- The full text and the page's identity, to preview exactly what would be
-- published - the same name and photo the public page shows. The editor and
-- the owner only.
create or replace function public.get_author_space_preview(p_space_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_space public.author_spaces;
  v_access text;
begin
  if p_space_id is null then
    select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged';
  else
    select * into v_space from public.author_spaces where id = p_space_id;
  end if;
  v_access := public.boks_space_access(v_space.id);
  if v_space.id is null or v_access is null then
    raise exception 'This page is not available.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_space.id::text,
    'kind', v_space.kind,
    'status', v_space.status,
    'access', v_access,
    'handle', public.boks_space_handle(v_space),
    'name', v_space.name,
    'photo', case when v_space.photo is null then null else encode(v_space.photo, 'base64') end,
    'items', coalesce((
      with published as (
        select x.bok_id, x.sort_position as position, x.created_at from public.boks_space_public_boks(v_space) x
      ),
      rows as (
        select p.position, p.created_at,
          jsonb_build_object(
            'key', 'b:' || b.id::text, 'bokId', b.id::text, 'title', b.title, 'published', true,
            'format', coalesce(public.boks_space_bok_format(v_space.id, b.id) ->> 'format', 'text'),
            'seriesHeld', coalesce((public.boks_space_bok_format(v_space.id, b.id) ->> 'seriesHeld')::boolean, false),
            'body', b.text
          ) as item
        from published p join public.published_boks b on b.id = p.bok_id
        union all
        select w.position, w.created_at,
          jsonb_build_object(
            'key', 'w:' || w.id::text, 'workId', w.id::text, 'bokId', w.bok_id::text, 'title', w.title,
            'published', false, 'format', w.format, 'status', w.status, 'revision', w.revision,
            'seriesPiece', w.series_piece,
            'body', coalesce(w.body, r.text)
          )
        from public.author_space_works w
        left join public.reels r on r.id = w.bok_id
        where w.space_id = v_space.id and w.status not in ('published', 'withdrawn')
          and not (w.bok_id is not null and exists (select 1 from published p where p.bok_id = w.bok_id))
      )
      select jsonb_agg(r.item order by r.position nulls last, r.created_at desc) from rows r
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------- publishing

create or replace function public.boks_publish_space_works(
  p_space public.author_spaces,
  p_items jsonb,
  p_actor uuid,
  p_rights_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
        title, author_name, hook, text, genre, mood, minutes,
        status, author_user_id, submitted_at, reviewed_at, reviewed_by, updated_at
      )
      values (
        v_work.title, left(v_byline, 120), '', v_work.body, 'literary', 'quiet',
        public.boks_reading_minutes(public.boks_word_count(v_work.body)),
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
$$;

-- ---------------------------------------------------------- account deletion

-- A deleted account's page comes down, with its name and photo: the cascade
-- on `author_pages` used to erase them, and an ownerless page must not stay
-- published.
create or replace function public.boks_take_down_owned_pages(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.author_spaces
  set status = 'unpublished',
      name = null,
      photo = null,
      photo_version = case when photo is null then photo_version else photo_version + 1 end,
      version = version + 1,
      updated_at = now()
  where owner_user_id = p_user_id and status <> 'merged';
$$;
revoke all on function public.boks_take_down_owned_pages(uuid) from public, anon, authenticated;

create or replace function public.delete_boks_user(p_user_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  set status = 'archived',
      archived_at = now(),
      archived_by = v_caller,
      archive_reason = 'Author account deleted by an administrator.',
      review_note = 'Author account deleted by an administrator.',
      author_user_id = null,
      author_name = 'Deleted author',
      author_handle = null,
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
$$;

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

  perform public.boks_take_down_owned_pages(v_uid);

  insert into public.deleted_boks_users (user_id, deleted_by)
  values (v_uid, v_uid)
  on conflict (user_id) do update set deleted_at = now(), deleted_by = excluded.deleted_by;

  delete from auth.users where id = v_uid;

  perform set_config('boks.erasing_account', '', true);

  return jsonb_build_object('ok', true, 'archivedBoks', v_archived);
end;
$$;

-- Pages of accounts deleted before this migration: an author's page is
-- published only by its owner, so a published one with no owner lost it.
update public.author_spaces s
set status = 'unpublished', updated_at = now()
where s.kind = 'author' and s.owner_user_id is null and s.status = 'published';

-- ------------------------------------------------------------------ grants
-- Unchanged from before; stated again so this file says who may call what.

revoke all on function public.get_my_author_page() from public, anon, authenticated;
revoke all on function public.save_my_author_page(text, text, integer) from public, anon, authenticated;
revoke all on function public.get_boks_author_page(text) from public, anon, authenticated;
revoke all on function public.get_boks_author_photo(text) from public, anon, authenticated;
revoke all on function public.boks_space_work_json(public.author_space_works, boolean) from public, anon, authenticated;
revoke all on function public.request_author_space_changes(uuid, text) from public, anon, authenticated;
revoke all on function public.studio_set_space_work_status(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.studio_save_author_space(uuid, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.peek_author_invite(text) from public, anon, authenticated;
revoke all on function public.get_my_author_invites() from public, anon, authenticated;
revoke all on function public.accept_author_invite(text, uuid) from public, anon, authenticated;
revoke all on function public.get_my_author_space() from public, anon, authenticated;
revoke all on function public.get_author_space_preview(uuid) from public, anon, authenticated;
revoke all on function public.boks_publish_space_works(public.author_spaces, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.delete_boks_user(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_my_boks_account(text) from public, anon, authenticated;

grant execute on function public.get_my_author_page() to authenticated;
grant execute on function public.save_my_author_page(text, text, integer) to authenticated;
grant execute on function public.get_boks_author_page(text) to anon, authenticated;
grant execute on function public.get_boks_author_photo(text) to anon, authenticated;
grant execute on function public.request_author_space_changes(uuid, text) to authenticated;
grant execute on function public.studio_set_space_work_status(uuid, text, text, text) to authenticated;
grant execute on function public.studio_save_author_space(uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.peek_author_invite(text) to authenticated;
grant execute on function public.get_my_author_invites() to authenticated;
grant execute on function public.accept_author_invite(text, uuid) to authenticated;
grant execute on function public.get_my_author_space() to authenticated;
grant execute on function public.get_author_space_preview(uuid) to authenticated;
grant execute on function public.delete_boks_user(uuid, text) to authenticated;
grant execute on function public.delete_my_boks_account(text) to authenticated;
