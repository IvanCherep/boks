-- The author's voice on every bok (owner, 2026-11-22).
--
-- A new piece from My page reaches the editors only with its author's
-- reading of it: recorded in the composer with the teleprompter, or a
-- recording of their own attached. The takes are files beside the Series
-- recorder's drafts (`<BOKS_SERIES_DIR>/voices/<bok>/`, written by
-- `app/api/author/voice`); the database keeps only the chosen take, so
-- `save_my_bok` can refuse a piece without one and Studio can find it.
--
-- 1. `bok_voices`: the chosen take of a piece, with a fingerprint of the text
--    it reads (`boks_voice_fingerprint`, mirrored by `voiceFingerprint` in
--    `lib/boks/author/voice/rules.ts`). Keyed by the bok id the composer
--    chooses, so a reading can come before the piece is first saved.
-- 2. `get_my_bok_voice_access`, `set_my_bok_voice`: what the voice route asks
--    with the author's own token. `get_my_bok_voices`: My page's «Ждёт
--    вашего голоса». `studio_bok_voice`: the moderation player.
-- 3. `save_my_bok`: sending to the editors needs a current voice. Signature
--    unchanged, so existing grants and old tabs stand.

create table if not exists public.bok_voices (
  bok_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  file text not null check (file ~ '^take-[1-9][0-9]{0,2}\.(webm|mp4|ogg|m4a|wav|mp3)$'),
  duration_ms integer not null check (duration_ms between 500 and 900000),
  source text not null check (source in ('teleprompter', 'upload')),
  name text check (name is null or char_length(name) <= 200),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$'),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bok_voices_user_idx on public.bok_voices (user_id);

alter table public.bok_voices enable row level security;
-- Read and written only through the functions below (ADR 0011).
revoke all on table public.bok_voices from public, anon, authenticated;

-- A deleted piece takes its voice with it (the takes on disk stay until cleared by hand).
create or replace function public.bok_voices_follow_reel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.bok_voices where bok_id = old.id;
  return old;
end;
$$;
revoke all on function public.bok_voices_follow_reel() from public, anon, authenticated;
drop trigger if exists reels_delete_voice on public.reels;
create trigger reels_delete_voice after delete on public.reels
for each row execute function public.bok_voices_follow_reel();

-- The text as a reading of it is compared: runs of spaces, tabs and line
-- breaks one space, the ends trimmed; the first 16 hex digits of SHA-256.
create or replace function public.boks_voice_fingerprint(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(encode(sha256(convert_to(btrim(regexp_replace(coalesce(p_text, ''), '[ \t\r\n]+', ' ', 'g'), ' '), 'UTF8')), 'hex'), 16);
$$;
revoke all on function public.boks_voice_fingerprint(text) from public, anon, authenticated;

create or replace function public.boks_has_current_voice(p_bok_id uuid, p_user_id uuid, p_text text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bok_voices v
    where v.bok_id = p_bok_id and v.user_id = p_user_id
      and v.fingerprint = public.boks_voice_fingerprint(p_text)
  );
$$;
revoke all on function public.boks_has_current_voice(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.boks_voice_json(v public.bok_voices, p_text text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'bokId', v.bok_id::text,
    'file', v.file,
    'durationMs', v.duration_ms,
    'source', v.source,
    'name', v.name,
    'fingerprint', v.fingerprint,
    'recordedAt', v.recorded_at,
    'current', p_text is not null and v.fingerprint = public.boks_voice_fingerprint(p_text)
  );
$$;
revoke all on function public.boks_voice_json(public.bok_voices, text) from public, anon, authenticated;

-- Who asks about a piece's voice: the account, Studio or not, whether they
-- publish from My page, and whose piece it is (its author, else whoever
-- recorded for it first; null while it is nobody's).
create or replace function public.get_my_bok_voice_access(p_bok_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'userId', v_uid::text,
    'admin', public.is_boks_admin(v_uid),
    'direct', public.boks_publishes_directly(v_uid),
    'ownerId', coalesce(
      (select r.author_user_id::text from public.reels r where r.id = p_bok_id),
      (select v.user_id::text from public.bok_voices v where v.bok_id = p_bok_id)
    )
  );
end;
$$;

-- The chosen take of the author's own piece; null clears it.
create or replace function public.set_my_bok_voice(p_bok_id uuid, p_voice jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_owner uuid;
  v_row public.bok_voices;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_bok_id is null then
    raise exception 'Which piece is this?' using errcode = '22023';
  end if;
  if not public.boks_publishes_directly(v_uid) then
    raise exception 'Publishing straight away is open to verified authors; send the text for review instead.' using errcode = '42501';
  end if;
  select r.author_user_id into v_owner from public.reels r where r.id = p_bok_id;
  if found and v_owner is distinct from v_uid then
    raise exception 'This piece belongs to another account.' using errcode = '42501';
  end if;
  if exists (select 1 from public.bok_voices v where v.bok_id = p_bok_id and v.user_id <> v_uid) then
    raise exception 'This piece belongs to another account.' using errcode = '42501';
  end if;

  if p_voice is null or jsonb_typeof(p_voice) = 'null' then
    delete from public.bok_voices where bok_id = p_bok_id;
    return null;
  end if;
  if jsonb_typeof(p_voice) <> 'object'
    or coalesce(p_voice ->> 'file', '') !~ '^take-[1-9][0-9]{0,2}\.(webm|mp4|ogg|m4a|wav|mp3)$'
    or coalesce(p_voice ->> 'fingerprint', '') !~ '^[0-9a-f]{16}$'
    or coalesce(p_voice ->> 'source', '') not in ('teleprompter', 'upload')
    or coalesce(p_voice ->> 'durationMs', '') !~ '^[0-9]{3,6}$'
    or (p_voice ->> 'durationMs')::integer not between 500 and 900000 then
    raise exception 'That is not a recording of this piece.' using errcode = '22023';
  end if;

  insert into public.bok_voices (bok_id, user_id, file, duration_ms, source, name, fingerprint, recorded_at, updated_at)
  values (
    p_bok_id, v_uid, p_voice ->> 'file', (p_voice ->> 'durationMs')::integer, p_voice ->> 'source',
    left(nullif(btrim(coalesce(p_voice ->> 'name', '')), ''), 200), p_voice ->> 'fingerprint',
    coalesce(public.boks_try_timestamptz(p_voice ->> 'recordedAt'), now()), now()
  )
  on conflict (bok_id) do update
    set file = excluded.file, duration_ms = excluded.duration_ms, source = excluded.source, name = excluded.name,
        fingerprint = excluded.fingerprint, recorded_at = excluded.recorded_at, updated_at = now()
  returning * into v_row;
  return public.boks_voice_json(v_row, (select r.text from public.reels r where r.id = p_bok_id));
end;
$$;

create or replace function public.boks_try_timestamptz(p_value text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;
revoke all on function public.boks_try_timestamptz(text) from public, anon, authenticated;

-- My page: the caller's pieces that have a voice, and whether it reads the text as it is now.
create or replace function public.get_my_bok_voices()
returns jsonb
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
    select jsonb_agg(public.boks_voice_json(v, r.text))
    from public.bok_voices v
    left join public.reels r on r.id = v.bok_id
    where v.user_id = v_uid
  ), '[]'::jsonb);
end;
$$;

-- Studio → Moderation: the author's reading of a piece, to build its Series from.
create or replace function public.studio_bok_voice(p_bok_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  return (
    select public.boks_voice_json(v, r.text)
    from public.bok_voices v
    left join public.reels r on r.id = v.bok_id
    where v.bok_id = p_bok_id
  );
end;
$$;

revoke all on function public.get_my_bok_voice_access(uuid) from public, anon, authenticated;
revoke all on function public.set_my_bok_voice(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.get_my_bok_voices() from public, anon, authenticated;
revoke all on function public.studio_bok_voice(uuid) from public, anon, authenticated;
grant execute on function public.get_my_bok_voice_access(uuid) to authenticated;
grant execute on function public.set_my_bok_voice(uuid, jsonb) to authenticated;
grant execute on function public.get_my_bok_voices() to authenticated;
grant execute on function public.studio_bok_voice(uuid) to authenticated;

create or replace function public.save_my_bok(
  p_bok_id uuid,
  p_title text default '',
  p_text text default '',
  p_publish boolean default false,
  p_cover jsonb default null,
  p_cover_by_team boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_space public.author_spaces;
  v_bok public.reels;
  v_existing public.reels;
  v_byline text;
  v_status text;
  v_new boolean;
  v_top integer;
  v_was_published boolean;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_bok_id is null then
    raise exception 'Which piece is this?' using errcode = '22023';
  end if;
  if not public.boks_publishes_directly(v_uid) then
    raise exception 'Publishing straight away is open to verified authors; send the text for review instead.' using errcode = '42501';
  end if;
  if v_text is null then
    raise exception 'Text is required.' using errcode = '22023';
  end if;
  if coalesce(v_title, public.boks_title_from_text(v_text)) = '' then
    raise exception 'The text needs at least one line with words in it.' using errcode = '22023';
  end if;
  if char_length(v_text) > public.boks_max_text_characters() then
    raise exception 'A bok must fit inside 15 minutes. This one is % characters; the limit is %.',
      char_length(v_text), public.boks_max_text_characters() using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 120 then
    raise exception 'The title is longer than 120 characters.' using errcode = '22023';
  end if;

  -- Covers are the editors': an author's piece without one goes to them.
  if p_cover is not null then
    raise exception 'Covers are made by the boks editors.' using errcode = '42501';
  end if;

  perform public.ensure_boks_user_profile('');
  perform 1 from public.user_profiles where user_id = v_uid for update;

  select * into v_space from public.author_spaces
  where owner_user_id = v_uid and kind = 'author' and status = 'published';

  select * into v_existing from public.reels where id = p_bok_id for update;
  v_new := v_existing.id is null;
  if not v_new and v_existing.author_user_id is distinct from v_uid then
    raise exception 'This piece belongs to another account.' using errcode = '42501';
  end if;
  -- A piece waiting for the team's cover can still be changed.
  if not v_new and v_existing.status not in ('draft', 'published', 'withdrawn')
    and not (v_existing.status = 'pending_review' and v_existing.cover_requested) then
    raise exception 'This piece is with the team; it can be changed from My texts.' using errcode = '22023';
  end if;
  if coalesce(p_cover_by_team, false) and not v_new and v_existing.status in ('published', 'withdrawn') then
    raise exception 'This piece already has its cover; replace it here.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.reels r
    where r.author_user_id = v_uid and r.id <> p_bok_id
      and r.status in ('pending_review', 'published', 'draft') and r.text = v_text
  ) then
    raise exception 'You already have this exact text on your page.' using errcode = '23505';
  end if;

  -- The author's voice (owner, 2026-11-22): a new piece reaches the editors
  -- only with the author's reading of this very text, and a piece already
  -- with them needs a new reading when its words change. Drafts and
  -- published pieces are saved as before.
  if (coalesce(p_cover_by_team, false)
      or (not v_new and v_existing.status = 'pending_review' and v_existing.cover_requested
          and public.boks_voice_fingerprint(v_existing.text) <> public.boks_voice_fingerprint(v_text)))
    and not public.boks_has_current_voice(p_bok_id, v_uid, v_text) then
    raise exception 'Record or attach your reading first: a bok goes out with the author''s voice.' using errcode = '22023';
  end if;

  if coalesce(p_publish, false) and not coalesce(p_cover_by_team, false) and p_cover is null
    and not exists (select 1 from public.bok_covers c where c.bok_id = p_bok_id) then
    raise exception 'A bok goes out with the editors'' cover: send it to the editors.' using errcode = '22023';
  end if;

  -- A hidden piece stays hidden while it is edited; Put back returns it.
  -- The team's cover: the piece waits in the review queue, marked, and
  -- goes out once the team gives it a picture and approves it.
  v_status := case
    when not v_new and v_existing.status = 'withdrawn' then 'withdrawn'
    when coalesce(p_cover_by_team, false) then 'pending_review'
    when coalesce(p_publish, false) then 'published'
    when not v_new and v_existing.status = 'pending_review' then 'pending_review'
    else 'draft'
  end;
  v_was_published := not v_new and v_existing.status in ('published', 'withdrawn');

  v_byline := coalesce(v_space.name, (select '@' || p.handle from public.user_profiles p where p.user_id = v_uid));

  if v_new then
    insert into public.reels (
      id, title, author_name, text, genre, mood,
      status, author_user_id, submitted_at, reviewed_at, updated_at, cover_requested
    )
    values (
      p_bok_id, coalesce(v_title, ''), left(v_byline, 120), v_text, 'literary', 'quiet',
      v_status, v_uid, now(), case when v_status = 'published' then now() end, now(),
      v_status = 'pending_review'
    )
    returning * into v_bok;
  else
    update public.reels
    set title = coalesce(v_title, ''),
        text = v_text,
        status = v_status,
        reviewed_at = case when v_status = 'published' and status <> 'published' then now() else reviewed_at end,
        submitted_at = case when v_status = 'pending_review' and status <> 'pending_review' then now() else submitted_at end,
        cover_requested = case when v_status = 'pending_review' then true when v_status = 'published' then false else cover_requested end,
        updated_at = now()
    where id = p_bok_id
    returning * into v_bok;
  end if;

  insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
  values (v_bok.id, true, 'Published by the author from an open page', v_uid, now(), now())
  on conflict (reel_id) do update
    set confirmed = true, confirmed_by = excluded.confirmed_by, confirmed_at = now(), updated_at = now();

  -- A piece goes first on a page the author has ordered by hand, when it is
  -- first written or first published; a page never ordered shows newest
  -- first anyway.
  if (v_new or (v_status = 'published' and not v_was_published))
    and v_space.id is not null
    and exists (select 1 from public.author_space_order o where o.space_id = v_space.id)
    and not exists (select 1 from public.author_space_order o where o.space_id = v_space.id and o.bok_id = v_bok.id) then
    select min(o.position) - 1 into v_top from public.author_space_order o where o.space_id = v_space.id;
    insert into public.author_space_order (space_id, bok_id, position) values (v_space.id, v_bok.id, v_top)
    on conflict (space_id, bok_id) do nothing;
    update public.author_spaces set order_version = order_version + 1, updated_at = now() where id = v_space.id;
  end if;

  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'coverVersion', v_bok.cover_version,
    'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
    'created', v_new
  );
end;
$$;
