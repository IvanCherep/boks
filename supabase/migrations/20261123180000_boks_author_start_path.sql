-- The paid author's way in, as the letter to new authors describes it
-- (docs/author-agreements.md, "The way in"):
--
-- 1. Texts from the team. The author sends the first works (and recordings,
--    when there are some) in reply to the letter; the team puts them on the
--    page in Studio before the invitation. They wait there as «тексты для
--    кабинета» and become the author's drafts in the Workshop the moment the
--    invitation is accepted (or at once, when the page already has its
--    author). A recording the team attached comes with its text, as the
--    author's own upload.
-- 2. The page the invitation lands on is verified. An account that already
--    had a page of its own (made by reordering, never by the team) keeps it
--    and the team's page joins it; that page now opens the Workshop too.
-- 3. No Series work before the payment: Studio cannot accept a piece into
--    work while its author's contract waits for the money.

-- ------------------------------------------------------------------ texts from the team

create table if not exists public.author_space_seeds (
  -- The id the author's draft (`reels.id`) takes when it is handed over, so
  -- a recording attached before that (`voices/<id>/`) is already in place.
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.author_spaces (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  text text not null check (char_length(btrim(text)) between 1 and 20000),
  form text not null default 'poem' check (form in ('poem', 'prose')),
  -- The chosen recording, as `bok_voices` keeps it: { file, durationMs, source, name, fingerprint, recordedAt }.
  voice jsonb check (voice is null or jsonb_typeof(voice) = 'object'),
  position integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handed_at timestamptz,
  handed_to uuid references auth.users (id) on delete set null
);
create index if not exists author_space_seeds_space_idx on public.author_space_seeds (space_id, position);

alter table public.author_space_seeds enable row level security;
-- Read and written only through the functions below (ADR 0011).
revoke all on table public.author_space_seeds from public, anon, authenticated;

create or replace function public.boks_seed_json(s public.author_space_seeds)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id::text,
    'spaceId', s.space_id::text,
    'title', s.title,
    'text', s.text,
    'form', s.form,
    'voice', s.voice,
    'voiceCurrent', s.voice is not null and s.voice ->> 'fingerprint' = public.boks_voice_fingerprint(s.text),
    'position', s.position,
    'createdAt', s.created_at,
    'handedAt', s.handed_at,
    -- Once handed over the text is the author's: what they did with it.
    'bokStatus', (select r.status from public.reels r where r.id = s.id),
    'bokVoice', exists (select 1 from public.bok_voices v where v.bok_id = s.id)
  );
$$;
revoke all on function public.boks_seed_json(public.author_space_seeds) from public, anon, authenticated;

-- Hands the page's waiting texts to an account: each becomes a draft in the
-- Workshop with its form and, when the team attached one, its recording.
create or replace function public.boks_hand_space_seeds(p_space_id uuid, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed public.author_space_seeds;
  v_byline text;
  v_count integer := 0;
begin
  if p_space_id is null or p_user_id is null then
    return 0;
  end if;
  -- Drafts are the account's own writes, which wait for the site's terms
  -- (`reject_blocked_boks_user_mutation`): until then the texts stay with the
  -- page, and the terms trigger below hands them over.
  if not exists (select 1 from public.user_profiles p where p.user_id = p_user_id and p.terms_accepted_at is not null) then
    return 0;
  end if;
  select coalesce(
    (select s.name from public.author_spaces s where s.owner_user_id = p_user_id and s.status <> 'merged' and s.name is not null limit 1),
    (select s.name from public.author_spaces s where s.id = p_space_id),
    (select '@' || p.handle from public.user_profiles p where p.user_id = p_user_id)
  ) into v_byline;

  for v_seed in
    select * from public.author_space_seeds
    where space_id = p_space_id and handed_at is null
    order by position, created_at
    for update
  loop
    if exists (select 1 from public.reels r where r.id = v_seed.id) then
      continue;
    end if;
    insert into public.reels (
      id, title, author_name, text, genre, mood, status, author_user_id, submitted_at, updated_at, cover_requested
    )
    values (
      v_seed.id, v_seed.title, left(coalesce(v_byline, ''), 120), v_seed.text, 'literary', 'quiet',
      'draft', p_user_id, now(), now(), false
    );
    insert into public.bok_workshop (bok_id, author_id, form, updated_at)
    values (v_seed.id, p_user_id, v_seed.form, now())
    on conflict (bok_id) do update set form = excluded.form, author_id = excluded.author_id, updated_at = now();
    if v_seed.voice is not null then
      insert into public.bok_voices (bok_id, user_id, file, duration_ms, source, name, fingerprint, recorded_at, updated_at)
      values (
        v_seed.id, p_user_id, v_seed.voice ->> 'file', (v_seed.voice ->> 'durationMs')::integer, 'upload',
        left(nullif(btrim(coalesce(v_seed.voice ->> 'name', '')), ''), 200), v_seed.voice ->> 'fingerprint',
        coalesce(public.boks_try_timestamptz(v_seed.voice ->> 'recordedAt'), now()), now()
      )
      on conflict (bok_id) do nothing;
    end if;
    update public.author_space_seeds set handed_at = now(), handed_to = p_user_id, updated_at = now() where id = v_seed.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.boks_hand_space_seeds(uuid, uuid) from public, anon, authenticated;

-- An accepted invitation: the page it landed on opens the Workshop, and the
-- team's texts go to the author. Works for the bare call and for the contract.
create or replace function public.boks_after_invite_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.accepted_at is null or old.accepted_at is not null or new.accepted_by is null then
    return new;
  end if;
  update public.author_spaces
  set verified = true, updated_at = now()
  where owner_user_id = new.accepted_by and kind = 'author' and status <> 'merged' and not verified;
  perform public.boks_hand_space_seeds(new.space_id, new.accepted_by);
  return new;
end;
$$;
revoke all on function public.boks_after_invite_accepted() from public, anon, authenticated;

drop trigger if exists author_space_invites_accepted on public.author_space_invites;
create trigger author_space_invites_accepted
  after update of accepted_at on public.author_space_invites
  for each row execute function public.boks_after_invite_accepted();

-- An author who accepted the invitation before the site's terms gets the
-- texts the moment they accept the terms.
create or replace function public.boks_hand_seeds_after_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
begin
  if new.terms_accepted_at is null or old.terms_accepted_at is not null then
    return new;
  end if;
  for v_space in
    select distinct i.space_id from public.author_space_invites i
    where i.accepted_by = new.user_id
      and exists (select 1 from public.author_space_seeds s where s.space_id = i.space_id and s.handed_at is null)
  loop
    perform public.boks_hand_space_seeds(v_space, new.user_id);
  end loop;
  return new;
end;
$$;
revoke all on function public.boks_hand_seeds_after_terms() from public, anon, authenticated;

drop trigger if exists user_profiles_hand_seeds_after_terms on public.user_profiles;
create trigger user_profiles_hand_seeds_after_terms
  after update of terms_accepted_at on public.user_profiles
  for each row execute function public.boks_hand_seeds_after_terms();

-- Studio: the page's texts for the cabinet, waiting and handed over.
create or replace function public.studio_space_seeds(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.boks_require_editor();
  return coalesce((
    select jsonb_agg(public.boks_seed_json(s) order by s.position, s.created_at)
    from public.author_space_seeds s where s.space_id = p_space_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.studio_space_seeds(uuid) from public, anon, authenticated;
grant execute on function public.studio_space_seeds(uuid) to authenticated;

-- One text: what the voice route needs to check a recording against it.
create or replace function public.studio_space_seed(p_seed_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seed public.author_space_seeds;
begin
  perform public.boks_require_editor();
  select * into v_seed from public.author_space_seeds where id = p_seed_id;
  if v_seed.id is null then
    raise exception 'This text does not exist.' using errcode = 'P0002';
  end if;
  return public.boks_seed_json(v_seed) || jsonb_build_object(
    'ownerId', (select r.author_user_id::text from public.reels r where r.id = v_seed.id)
  );
end;
$$;
revoke all on function public.studio_space_seed(uuid) from public, anon, authenticated;
grant execute on function public.studio_space_seed(uuid) to authenticated;

-- Add or change a text. Once the author has it, it is theirs to change.
create or replace function public.studio_save_space_seed(
  p_space_id uuid,
  p_seed_id uuid default null,
  p_title text default '',
  p_text text default '',
  p_form text default 'poem'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_space public.author_spaces;
  v_seed public.author_space_seeds;
  v_title text := left(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'), 121);
  v_text text := btrim(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E' \n\t');
begin
  select * into v_space from public.author_spaces where id = p_space_id for update;
  if v_space.id is null or v_space.status = 'merged' then
    raise exception 'This page does not exist.' using errcode = 'P0002';
  end if;
  if v_space.kind <> 'author' then
    raise exception 'Texts for the cabinet are for an author''s page.' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'The title is longer than 120 characters.' using errcode = '22023';
  end if;
  if char_length(v_text) = 0 then
    raise exception 'Paste the text.' using errcode = '22023';
  end if;
  if char_length(v_text) > 20000 then
    raise exception 'The text is longer than 20 000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_form, '') not in ('poem', 'prose') then
    raise exception 'Poem or prose?' using errcode = '22023';
  end if;

  if p_seed_id is null then
    insert into public.author_space_seeds (space_id, title, text, form, position, created_by)
    values (
      v_space.id, v_title, v_text, p_form,
      coalesce((select max(s.position) from public.author_space_seeds s where s.space_id = v_space.id), 0) + 1,
      v_uid
    )
    returning * into v_seed;
  else
    select * into v_seed from public.author_space_seeds where id = p_seed_id and space_id = v_space.id for update;
    if v_seed.id is null then
      raise exception 'This text does not exist.' using errcode = 'P0002';
    end if;
    if v_seed.handed_at is not null then
      raise exception 'The author has this text already: they change it in the cabinet.' using errcode = '22023', hint = 'seed_handed';
    end if;
    update public.author_space_seeds
    set title = v_title, text = v_text, form = p_form, updated_at = now()
    where id = v_seed.id
    returning * into v_seed;
  end if;

  -- The page has its author already: the text goes to them now.
  if v_space.owner_user_id is not null then
    perform public.boks_hand_space_seeds(v_space.id, v_space.owner_user_id);
    select * into v_seed from public.author_space_seeds where id = v_seed.id;
  end if;
  return public.boks_seed_json(v_seed);
end;
$$;
revoke all on function public.studio_save_space_seed(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.studio_save_space_seed(uuid, uuid, text, text, text) to authenticated;

create or replace function public.studio_remove_space_seed(p_seed_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed public.author_space_seeds;
begin
  perform public.boks_require_editor();
  select * into v_seed from public.author_space_seeds where id = p_seed_id for update;
  if v_seed.id is null then
    return;
  end if;
  if v_seed.handed_at is not null then
    raise exception 'The author has this text already: they change it in the cabinet.' using errcode = '22023', hint = 'seed_handed';
  end if;
  delete from public.author_space_seeds where id = v_seed.id;
end;
$$;
revoke all on function public.studio_remove_space_seed(uuid) from public, anon, authenticated;
grant execute on function public.studio_remove_space_seed(uuid) to authenticated;

-- The recording the route stored for a text (`/api/admin/author-seeds/<id>/voice`).
-- Before the hand-over it waits on the text; after it, it becomes the
-- author's chosen recording while the piece is still a draft.
create or replace function public.studio_set_space_seed_voice(p_seed_id uuid, p_voice jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed public.author_space_seeds;
  v_bok public.reels;
begin
  perform public.boks_require_editor();
  select * into v_seed from public.author_space_seeds where id = p_seed_id for update;
  if v_seed.id is null then
    raise exception 'This text does not exist.' using errcode = 'P0002';
  end if;
  if p_voice is null or jsonb_typeof(p_voice) <> 'object'
    or coalesce(p_voice ->> 'file', '') !~ '^take-[1-9][0-9]{0,2}\.(webm|mp4|ogg|m4a|wav|mp3)$'
    or coalesce(p_voice ->> 'fingerprint', '') !~ '^[0-9a-f]{16}$'
    or coalesce(p_voice ->> 'durationMs', '') !~ '^[0-9]{3,6}$'
    or (p_voice ->> 'durationMs')::integer not between 500 and 900000 then
    raise exception 'That is not a recording of this piece.' using errcode = '22023';
  end if;

  if v_seed.handed_at is not null then
    select * into v_bok from public.reels where id = v_seed.id for update;
    if v_bok.id is null or v_bok.status <> 'draft' then
      raise exception 'The author has sent this piece on: the recording is theirs to change now.' using errcode = '22023', hint = 'seed_handed';
    end if;
    insert into public.bok_voices (bok_id, user_id, file, duration_ms, source, name, fingerprint, recorded_at, updated_at)
    values (
      v_bok.id, v_bok.author_user_id, p_voice ->> 'file', (p_voice ->> 'durationMs')::integer, 'upload',
      left(nullif(btrim(coalesce(p_voice ->> 'name', '')), ''), 200), p_voice ->> 'fingerprint',
      coalesce(public.boks_try_timestamptz(p_voice ->> 'recordedAt'), now()), now()
    )
    on conflict (bok_id) do update
      set file = excluded.file, duration_ms = excluded.duration_ms, source = 'upload', name = excluded.name,
          fingerprint = excluded.fingerprint, recorded_at = excluded.recorded_at, updated_at = now();
  end if;

  update public.author_space_seeds
  set voice = jsonb_build_object(
        'file', p_voice ->> 'file', 'durationMs', (p_voice ->> 'durationMs')::integer, 'source', 'upload',
        'name', left(nullif(btrim(coalesce(p_voice ->> 'name', '')), ''), 200),
        'fingerprint', p_voice ->> 'fingerprint', 'recordedAt', coalesce(p_voice ->> 'recordedAt', now()::text)
      ),
      updated_at = now()
  where id = v_seed.id
  returning * into v_seed;
  return public.boks_seed_json(v_seed);
end;
$$;
revoke all on function public.studio_set_space_seed_voice(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.studio_set_space_seed_voice(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------ no Series work before the payment

create or replace function public.studio_accept_bok(p_bok_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_bok public.reels;
  v_row public.bok_series_work;
begin
  if v_uid is null or not public.is_boks_admin(v_uid) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  select * into v_bok from public.reels where id = p_bok_id for update;
  if v_bok.id is null or v_bok.author_user_id is null or not (v_bok.status = 'pending_review' and v_bok.cover_requested) then
    raise exception 'Only a piece sent from My page and waiting for the editors can be accepted into work.' using errcode = '22023';
  end if;
  if not public.boks_has_current_voice(p_bok_id, v_bok.author_user_id, v_bok.text) then
    raise exception 'This piece has no reading of its text by the author: return it for a recording.' using errcode = '22023';
  end if;
  if public.boks_author_unpaid(v_bok.author_user_id) then
    raise exception 'The author has not paid yet: Series work starts after the payment is marked in «Договоры авторов».' using errcode = '22023', hint = 'payment_required';
  end if;
  insert into public.bok_series_work (bok_id, author_id, state, accepted_at, accepted_by, updated_at)
  values (p_bok_id, v_bok.author_user_id, 'accepted', now(), v_uid, now())
  on conflict (bok_id) do update
    set state = 'accepted', author_id = excluded.author_id, accepted_at = now(), accepted_by = v_uid,
        sent_at = null, sent_by = null, published_at = null, updated_at = now()
  returning * into v_row;
  return public.boks_series_work_json(v_row);
end;
$$;

-- Which authors of the review queue still wait for their payment, for
-- Moderation's «ждёт оплаты» beside their pieces.
create or replace function public.studio_unpaid_authors()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.boks_require_editor();
  return coalesce((
    select jsonb_agg(jsonb_build_object('userId', a.user_id::text, 'number', a.number, 'payState', a.pay_state, 'payDue', a.pay_due))
    from public.author_agreements a where a.pay_state in ('awaiting', 'reported')
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.studio_unpaid_authors() from public, anon, authenticated;
grant execute on function public.studio_unpaid_authors() to authenticated;
