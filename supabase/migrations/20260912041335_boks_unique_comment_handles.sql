alter table public.user_profiles
  add column if not exists handle text;

alter table public.comments
  add column if not exists visitor_handle text;

create or replace function public.normalize_boks_handle(p_handle text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    left(
      regexp_replace(
        regexp_replace(
          lower(trim(leading '@' from btrim(coalesce(p_handle, '')))),
          '[^a-z0-9_]+',
          '_',
          'g'
        ),
        '^_+|_+$',
        '',
        'g'
      ),
      24
    ),
    ''
  );
$$;

revoke all on function public.normalize_boks_handle(text) from public, anon, authenticated;
grant execute on function public.normalize_boks_handle(text) to authenticated;

create or replace function public.generate_boks_handle(
  p_seed text,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := public.normalize_boks_handle(p_seed);
  v_candidate text;
  v_suffix integer := 0;
begin
  if p_user_id is null then
    raise exception 'User id is required for handle generation.' using errcode = '22023';
  end if;

  if v_base is null or char_length(v_base) < 3 then
    v_base := 'reader_' || left(replace(p_user_id::text, '-', ''), 8);
  end if;

  v_base := left(v_base, 24);
  v_candidate := v_base;

  while exists (
    select 1
    from public.user_profiles
    where lower(handle) = lower(v_candidate)
      and user_id <> p_user_id
  ) loop
    v_suffix := v_suffix + 1;
    v_candidate := left(v_base, greatest(3, 24 - char_length('_' || v_suffix::text))) || '_' || v_suffix::text;
  end loop;

  return v_candidate;
end;
$$;

revoke all on function public.generate_boks_handle(text, uuid) from public, anon, authenticated;
grant execute on function public.generate_boks_handle(text, uuid) to authenticated;

do $$
declare
  v_profile record;
begin
  for v_profile in
    select up.user_id, up.display_name, au.email
    from public.user_profiles up
    left join auth.users au on au.id = up.user_id
    where up.handle is null
    order by up.created_at, up.user_id
  loop
    update public.user_profiles
    set
      handle = public.generate_boks_handle(
        coalesce(nullif(v_profile.display_name, ''), split_part(coalesce(v_profile.email, ''), '@', 1), v_profile.user_id::text),
        v_profile.user_id
      ),
      updated_at = now()
    where user_id = v_profile.user_id;
  end loop;
end $$;

update public.comments c
set visitor_handle = coalesce(up.handle, public.normalize_boks_handle(c.visitor_name), 'reader_' || c.id::text)
from public.user_profiles up
where up.user_id = c.user_id
  and c.visitor_handle is null;

update public.comments
set visitor_handle = coalesce(public.normalize_boks_handle(visitor_name), 'reader_' || id::text)
where visitor_handle is null;

alter table public.user_profiles
  drop constraint if exists user_profiles_handle_format;

alter table public.user_profiles
  add constraint user_profiles_handle_format
  check (handle is null or handle ~ '^[a-z0-9_]{3,24}$');

alter table public.comments
  drop constraint if exists comments_visitor_handle_format;

alter table public.comments
  add constraint comments_visitor_handle_format
  check (visitor_handle is null or visitor_handle ~ '^[a-z0-9_]{3,24}$');

create unique index if not exists user_profiles_handle_unique_idx
on public.user_profiles (lower(handle))
where handle is not null;

create index if not exists comments_reel_handle_created_idx
on public.comments (reel_id, visitor_handle, created_at desc);

create or replace function public.get_boks_user_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_context jsonb;
begin
  if v_uid is null then
    return jsonb_build_object(
      'userId', null,
      'email', null,
      'isAnonymous', true,
      'role', 'reader',
      'displayName', 'Reader',
      'handle', null,
      'preferredGenre', 'literary',
      'preferredMood', 'quiet',
      'termsAcceptedAt', null,
      'termsVersion', null,
      'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
      'views', 0,
      'likes', 0
    );
  end if;

  select jsonb_build_object(
    'userId', v_uid::text,
    'email', au.email,
    'isAnonymous', v_is_anonymous,
    'role', coalesce(up.role, 'reader'),
    'displayName', coalesce(up.display_name, 'Reader'),
    'handle', up.handle,
    'preferredGenre', coalesce(up.preferred_genre, 'literary'),
    'preferredMood', coalesce(up.preferred_mood, 'quiet'),
    'termsAcceptedAt', up.terms_accepted_at,
    'termsVersion', up.terms_version,
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
    'views', (select count(*)::integer from public.views where user_id = v_uid),
    'likes', (select count(*)::integer from public.likes where user_id = v_uid)
  )
  into v_context
  from auth.users au
  left join public.user_profiles up on up.user_id = au.id
  where au.id = v_uid;

  return coalesce(v_context, jsonb_build_object(
    'userId', v_uid::text,
    'email', null,
    'isAnonymous', v_is_anonymous,
    'role', 'reader',
    'displayName', 'Reader',
    'handle', null,
    'preferredGenre', 'literary',
    'preferredMood', 'quiet',
    'termsAcceptedAt', null,
    'termsVersion', null,
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
    'views', 0,
    'likes', 0
  ));
end;
$$;

revoke all on function public.get_boks_user_context() from public, anon, authenticated;
grant execute on function public.get_boks_user_context() to authenticated;

create or replace function public.ensure_boks_user_profile(p_display_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_display_name text := coalesce(nullif(btrim(p_display_name), ''), 'Reader');
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if v_is_anonymous then
    return public.get_boks_user_context();
  end if;

  insert into public.user_profiles (user_id, display_name, handle)
  values (v_uid, v_display_name, public.generate_boks_handle(v_display_name, v_uid))
  on conflict (user_id) do update
  set
    display_name = case
      when btrim(p_display_name) = '' then public.user_profiles.display_name
      else v_display_name
    end,
    handle = coalesce(public.user_profiles.handle, public.generate_boks_handle(v_display_name, v_uid)),
    updated_at = now();

  return public.get_boks_user_context();
end;
$$;

revoke all on function public.ensure_boks_user_profile(text) from public, anon, authenticated;
grant execute on function public.ensure_boks_user_profile(text) to authenticated;

create or replace function public.update_boks_user_profile(
  p_display_name text,
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
  v_display_name text := coalesce(nullif(btrim(p_display_name), ''), 'Reader');
  v_requested_handle text := public.normalize_boks_handle(p_handle);
  v_next_handle text;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required to update your profile.' using errcode = '42501';
  end if;

  if v_requested_handle is not null and char_length(v_requested_handle) < 3 then
    raise exception 'Use at least 3 characters for @nickname.' using errcode = '22023';
  end if;

  if v_requested_handle is not null and exists (
    select 1
    from public.user_profiles
    where lower(handle) = lower(v_requested_handle)
      and user_id <> v_uid
  ) then
    raise exception 'This @nickname is already taken.' using errcode = '23505';
  end if;

  v_next_handle := coalesce(v_requested_handle, public.generate_boks_handle(v_display_name, v_uid));

  insert into public.user_profiles (user_id, display_name, handle)
  values (v_uid, v_display_name, v_next_handle)
  on conflict (user_id) do update
  set
    display_name = v_display_name,
    handle = v_next_handle,
    updated_at = now();

  return public.get_boks_user_context();
end;
$$;

revoke all on function public.update_boks_user_profile(text, text) from public, anon, authenticated;
grant execute on function public.update_boks_user_profile(text, text) to authenticated;

create or replace function public.accept_boks_terms(p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_terms_version text := coalesce(nullif(trim(p_terms_version), ''), '2026-09-11');
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Permanent sign in required.' using errcode = '42501';
  end if;

  insert into public.user_profiles (user_id, handle, terms_accepted_at, terms_version)
  values (v_uid, public.generate_boks_handle('reader', v_uid), now(), v_terms_version)
  on conflict (user_id) do update
  set
    handle = coalesce(public.user_profiles.handle, public.generate_boks_handle('reader', v_uid)),
    terms_accepted_at = now(),
    terms_version = v_terms_version,
    updated_at = now();

  return public.get_boks_user_context();
end;
$$;

revoke all on function public.accept_boks_terms(text) from public, anon, authenticated;
grant execute on function public.accept_boks_terms(text) to authenticated;

create or replace function public.create_bok_comment(
  p_reel_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_name text;
  v_handle text;
  v_comment public.comments;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign up or sign in to comment.' using errcode = '42501';
  end if;

  if v_body is null then
    raise exception 'Write a comment before sending.' using errcode = '22023';
  end if;

  if char_length(v_body) > 1200 then
    raise exception 'Comments must be 1200 characters or fewer.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.reels
    where id = p_reel_id
      and status = 'published'
  ) then
    raise exception 'This boks is not available for comments.' using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile('');

  select
    coalesce(nullif(btrim(display_name), ''), 'Reader'),
    coalesce(handle, public.generate_boks_handle(display_name, v_uid))
  into v_name, v_handle
  from public.user_profiles
  where user_id = v_uid;

  update public.user_profiles
  set handle = v_handle
  where user_id = v_uid
    and handle is null;

  insert into public.comments (user_id, reel_id, visitor_name, visitor_handle, body)
  values (v_uid, p_reel_id, left(coalesce(v_name, 'Reader'), 120), v_handle, v_body)
  returning * into v_comment;

  return jsonb_build_object(
    'id', v_comment.id,
    'storyId', v_comment.reel_id::text,
    'visitorName', v_comment.visitor_name,
    'visitorHandle', v_comment.visitor_handle,
    'body', v_comment.body,
    'createdAt', v_comment.created_at
  );
end;
$$;

revoke all on function public.create_bok_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.create_bok_comment(uuid, text) to authenticated;
