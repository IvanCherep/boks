-- boks: an author's own page has a name and a photo the author sets
--
-- An author page (`/@handle`) showed the @handle and a monogram, or a photo
-- the team registered by hand (`components/boks/author-portraits.ts`). Many
-- authors are coming, and each now sets their own, from the cabinet:
--
--   * **Name on the page**: optional, at most 60 characters. It titles the
--     author page and its link preview, nothing else. The handle stays the
--     account's identity (ADR 0005): comments keep the @handle, and every
--     published bok keeps the byline it was published under.
--   * **Photo**: a square JPEG the browser has already cropped and
--     re-encoded (which also drops the camera's metadata). It is small - the
--     cabinet sends 640x640 - so it lives here, in the database, with no
--     separate file store to run, back up or secure. `/a/<handle>/photo`
--     serves it (`app/a/[handle]/photo/route.ts`).
--
-- Name and photo are saved together, in one call, so a page never shows a
-- new name with an old photo. `version` grows with every save: the cabinet
-- sends the version it opened, and a save from a tab that has been
-- overtaken by another is refused rather than silently undoing it. The photo
-- address carries the version, so a new photo is a new address and no cache
-- holds on to the old one.
--
-- The table has no Data API grants: the functions below are the only way in.

create table if not exists public.author_pages (
  user_id uuid primary key references auth.users (id) on delete cascade,
  page_name text
    check (page_name is null or (char_length(page_name) between 1 and 60 and page_name !~ '[<>[:cntrl:]]')),
  photo bytea
    -- A JPEG, by its first bytes; the cabinet sends ~60-150 KB.
    check (photo is null or (octet_length(photo) between 100 and 700000 and substring(photo from 1 for 3) = '\xffd8ff'::bytea)),
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.author_pages enable row level security;
revoke all on public.author_pages from public, anon, authenticated;

comment on table public.author_pages is
  'The name and photo an author set for their own page (/@handle). Read through get_boks_author_page / get_boks_author_photo, written through save_my_author_page.';

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
  v_page public.author_pages;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select * into v_page from public.author_pages where user_id = v_uid;

  return jsonb_build_object(
    'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
    'name', v_page.page_name,
    'photoVersion', case when v_page.photo is null then null else v_page.version end,
    'version', coalesce(v_page.version, 0)
  );
end;
$$;

-- p_photo: 'keep' leaves the photo as it is, 'remove' takes it off, and
-- anything else is the new photo, base64.
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
  v_current public.author_pages;
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

  select * into v_current from public.author_pages where user_id = v_uid for update;

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

  insert into public.author_pages as a (user_id, page_name, photo, version, updated_at)
  values (v_uid, v_name, v_photo, 1, now())
  on conflict (user_id) do update
    set page_name = excluded.page_name,
        photo = excluded.photo,
        version = a.version + 1,
        updated_at = now();

  return public.get_my_author_page();
end;
$$;

-- ------------------------------------------------------------- what readers see

create or replace function public.get_boks_author_page(p_handle text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', a.page_name,
    'photoVersion', case when a.photo is null then null else a.version end
  )
  from public.user_profiles p
  join public.author_pages a on a.user_id = p.user_id
  where lower(p.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
    and p.banned_at is null;
$$;

create or replace function public.get_boks_author_photo(p_handle text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('version', a.version, 'jpeg', encode(a.photo, 'base64'))
  from public.user_profiles p
  join public.author_pages a on a.user_id = p.user_id
  where lower(p.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
    and p.banned_at is null
    and a.photo is not null;
$$;

revoke all on function public.get_my_author_page() from public, anon, authenticated;
revoke all on function public.save_my_author_page(text, text, integer) from public, anon, authenticated;
revoke all on function public.get_boks_author_page(text) from public, anon, authenticated;
revoke all on function public.get_boks_author_photo(text) from public, anon, authenticated;
grant execute on function public.get_my_author_page() to authenticated;
grant execute on function public.save_my_author_page(text, text, integer) to authenticated;
grant execute on function public.get_boks_author_page(text) to anon, authenticated;
grant execute on function public.get_boks_author_photo(text) to anon, authenticated;
