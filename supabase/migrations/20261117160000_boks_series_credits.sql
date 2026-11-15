-- Boks Series an author may make with the recorder (`docs/series-recorder.md`).
--
-- The team grants an author a number of Series in Studio → Authors; each new
-- recording spends one, whatever becomes of it, so a draft deleted after its
-- pictures were drawn gives nothing back. What one recording may cost is
-- bounded on its own (pictures, builds, takes: `lib/boks/series-recorder/rules.ts`),
-- so a grant of N bounds everything an author can spend. Studio itself needs
-- no grant.

create table public.series_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted integer not null default 0,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint series_credits_granted check (granted between 0 and 200),
  constraint series_credits_used check (used >= 0 and used <= granted)
);
alter table public.series_credits enable row level security;
revoke all on public.series_credits from public, anon, authenticated;

-- The caller's own: whether they may use the recorder, and how many Series are left.
create or replace function public.get_my_series_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_admin boolean := public.is_boks_admin(v_uid);
  v_granted integer := 0;
  v_used integer := 0;
begin
  select c.granted, c.used into v_granted, v_used from public.series_credits c where c.user_id = v_uid;
  return jsonb_build_object(
    'userId', v_uid,
    'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
    -- The name a Series is signed with: the author's page, else the byline of
    -- their latest work, else their @name. An author does not choose it per Series.
    'authorName', coalesce(
      (select s.name from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged' and btrim(coalesce(s.name, '')) <> '' order by s.created_at limit 1),
      (select r.author_name from public.reels r where r.author_user_id = v_uid and btrim(coalesce(r.author_name, '')) <> '' order by coalesce(r.submitted_at, r.created_at) desc limit 1),
      (select '@' || p.handle from public.user_profiles p where p.user_id = v_uid)),
    'admin', v_admin,
    'granted', coalesce(v_granted, 0),
    'used', coalesce(v_used, 0),
    'left', greatest(0, coalesce(v_granted, 0) - coalesce(v_used, 0)),
    'allowed', v_admin or coalesce(v_granted, 0) > 0
  );
end;
$$;
revoke all on function public.get_my_series_access() from public, anon, authenticated;
grant execute on function public.get_my_series_access() to authenticated;

-- Spend one, or refuse: a single guarded update, so two tabs at once cannot both spend the last.
create or replace function public.spend_series_credit()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_left integer;
begin
  if public.is_boks_admin(v_uid) then
    return jsonb_build_object('ok', true, 'left', null);
  end if;
  update public.series_credits c
  set used = c.used + 1, updated_at = now()
  where c.user_id = v_uid and c.used < c.granted
  returning c.granted - c.used into v_left;
  if not found then
    raise exception 'No Boks Series left to make. Write to us for more.' using errcode = '54023';
  end if;
  return jsonb_build_object('ok', true, 'left', v_left);
end;
$$;
revoke all on function public.spend_series_credit() from public, anon, authenticated;
grant execute on function public.spend_series_credit() to authenticated;

-- Studio → Authors: everyone holding a grant, and the authors who could be given one.
create or replace function public.list_series_credits()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.granted desc, x.published desc, x.handle)
    from (
      select p.handle, p.user_id as "userId",
             coalesce(c.granted, 0) as granted, coalesce(c.used, 0) as used,
             (select count(*) from public.reels r where r.author_user_id = p.user_id and r.status = 'published')::integer as published,
             c.updated_at as "updatedAt"
      from public.user_profiles p
      left join public.series_credits c on c.user_id = p.user_id
      where p.banned_at is null
        and not public.is_boks_admin(p.user_id)
        and (c.user_id is not null
          or exists (select 1 from public.reels r where r.author_user_id = p.user_id and r.status = 'published')
          or exists (select 1 from public.author_spaces s where s.owner_user_id = p.user_id and s.status <> 'merged'))
      limit 500
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_series_credits() from public, anon, authenticated;
grant execute on function public.list_series_credits() to authenticated;

-- How many an author is granted in all. Never below what they have already made.
create or replace function public.set_series_credits(p_handle text, p_granted integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_user uuid;
  v_used integer;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  select p.user_id into v_user from public.user_profiles p where lower(p.handle) = lower(ltrim(btrim(coalesce(p_handle, '')), '@'));
  if v_user is null then
    raise exception 'No account with that @name.' using errcode = '22023';
  end if;
  if p_granted is null or p_granted < 0 or p_granted > 200 then
    raise exception 'From 0 to 200 Boks Series.' using errcode = '22023';
  end if;
  select coalesce(c.used, 0) into v_used from public.series_credits c where c.user_id = v_user;
  if p_granted < coalesce(v_used, 0) then
    raise exception 'They have already made more than that.' using errcode = '22023';
  end if;
  insert into public.series_credits (user_id, granted, updated_by)
  values (v_user, p_granted, v_admin)
  on conflict (user_id) do update set granted = excluded.granted, updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'granted', p_granted, 'used', coalesce(v_used, 0));
end;
$$;
revoke all on function public.set_series_credits(text, integer) from public, anon, authenticated;
grant execute on function public.set_series_credits(text, integer) to authenticated;
