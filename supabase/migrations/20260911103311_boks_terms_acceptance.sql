alter table public.user_profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

grant update (display_name, preferred_genre, preferred_mood, terms_accepted_at, terms_version, updated_at)
on table public.user_profiles
to authenticated;

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

  insert into public.user_profiles (user_id, terms_accepted_at, terms_version)
  values (v_uid, now(), v_terms_version)
  on conflict (user_id) do update
  set
    terms_accepted_at = now(),
    terms_version = v_terms_version,
    updated_at = now();

  return public.get_boks_user_context();
end;
$$;

revoke all on function public.accept_boks_terms(text) from public, anon, authenticated;
grant execute on function public.accept_boks_terms(text) to authenticated;
