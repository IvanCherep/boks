-- Who made the music of a piece (owner, 2026-11-25).
--
-- Optional, one line of free text as the author writes it: one composer, a
-- list, or «Л. Булдыгин при содействии В. Рвачева и Н. Станиславчик». Readers
-- see it under the author's name on the feed's cover and on the Series
-- ending, as «Музыка: …».
--
-- The author fills it in the Workshop, with the text or when publishing the
-- Series; the editors may fill or correct it from Studio. It lives beside the
-- piece, not in `reels`, so the Workshop can keep it before the piece's first
-- save, and so the feed reads it with one small call
-- (`get_bok_music_credits`) instead of through the ranking function.

create table if not exists public.bok_music_credits (
  bok_id uuid primary key,
  music_by text not null check (char_length(music_by) between 1 and 200),
  set_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.bok_music_credits enable row level security;
-- Read and written only through the functions below (ADR 0011).
revoke all on table public.bok_music_credits from public, anon, authenticated;

create or replace function public.boks_clean_music_credit(p_music text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(p_music, ''), '\s+', ' ', 'g')), '');
$$;

-- The author's own piece: theirs in `reels`, or not saved yet and either
-- unclaimed or already credited by them.
create or replace function public.set_my_bok_music(p_bok_id uuid, p_music text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_music text := public.boks_clean_music_credit(p_music);
  v_owner uuid;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_bok_id is null then
    raise exception 'Which piece is this?' using errcode = '22023';
  end if;
  if not public.boks_publishes_directly(v_uid) then
    raise exception 'Only the piece''s author can name its music.' using errcode = '42501';
  end if;
  if v_music is not null and char_length(v_music) > 200 then
    raise exception 'Keep the music credit under 200 characters.' using errcode = '22023';
  end if;

  select r.author_user_id into v_owner from public.reels r where r.id = p_bok_id;
  if found then
    if v_owner is distinct from v_uid then
      raise exception 'This piece belongs to another account.' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.bok_music_credits c where c.bok_id = p_bok_id and c.set_by is distinct from v_uid) then
    raise exception 'This piece belongs to another account.' using errcode = '42501';
  end if;

  if v_music is null then
    delete from public.bok_music_credits where bok_id = p_bok_id;
  else
    insert into public.bok_music_credits (bok_id, music_by, set_by, updated_at)
    values (p_bok_id, v_music, v_uid, now())
    on conflict (bok_id) do update set music_by = excluded.music_by, set_by = excluded.set_by, updated_at = now();
  end if;
  return jsonb_build_object('bokId', p_bok_id, 'musicBy', coalesce(v_music, ''));
end;
$$;

create or replace function public.get_my_bok_music(p_bok_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  return coalesce((
    select c.music_by from public.bok_music_credits c
    left join public.reels r on r.id = c.bok_id
    where c.bok_id = p_bok_id
      and (r.author_user_id = v_uid or (r.id is null and c.set_by = v_uid) or public.is_boks_admin(v_uid))
  ), '');
end;
$$;

create or replace function public.studio_set_bok_music(p_bok_id uuid, p_music text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_music text := public.boks_clean_music_credit(p_music);
begin
  if not public.is_boks_admin(v_uid) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reels r where r.id = p_bok_id) then
    raise exception 'No such bok.' using errcode = '22023';
  end if;
  if v_music is not null and char_length(v_music) > 200 then
    raise exception 'Keep the music credit under 200 characters.' using errcode = '22023';
  end if;
  if v_music is null then
    delete from public.bok_music_credits where bok_id = p_bok_id;
  else
    insert into public.bok_music_credits (bok_id, music_by, set_by, updated_at)
    values (p_bok_id, v_music, v_uid, now())
    on conflict (bok_id) do update set music_by = excluded.music_by, set_by = excluded.set_by, updated_at = now();
  end if;
  return jsonb_build_object('bokId', p_bok_id, 'musicBy', coalesce(v_music, ''));
end;
$$;

-- Every published piece's credit, for the feed: a handful of rows.
create or replace function public.get_bok_music_credits()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(c.bok_id::text, c.music_by), '{}'::jsonb)
  from public.bok_music_credits c
  join public.reels r on r.id = c.bok_id and r.status = 'published';
$$;

revoke all on function public.boks_clean_music_credit(text) from public, anon, authenticated;
revoke all on function public.set_my_bok_music(uuid, text) from public, anon, authenticated;
revoke all on function public.get_my_bok_music(uuid) from public, anon, authenticated;
revoke all on function public.studio_set_bok_music(uuid, text) from public, anon, authenticated;
revoke all on function public.get_bok_music_credits() from public, anon, authenticated;
grant execute on function public.set_my_bok_music(uuid, text) to authenticated;
grant execute on function public.get_my_bok_music(uuid) to authenticated;
grant execute on function public.studio_set_bok_music(uuid, text) to authenticated;
grant execute on function public.get_bok_music_credits() to anon, authenticated, service_role;
