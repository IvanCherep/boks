-- A reasoned answer when the editors cannot take a piece (owner, 2026-11-22).
--
-- A piece sent from My page (text and voice, `pending_review` with
-- `cover_requested`) either goes out, or comes back to its author with the
-- editors' reasons: a request for changes («Вернуть на доработку»), or a
-- refusal («Отказать»). Never a silent drop. The author reads it on My page;
-- nothing is mailed or messaged.
--
-- 1. `bok_editor_decisions`: the decision on a piece, its kind (`recording`,
--    `text`, `law`, `other`) and the note the author reads.
-- 2. `studio_decide_bok`: Studio returns a piece (back to `draft`) or refuses
--    it (`rejected`). `studio_reopen_bok`: a refusal becomes a request for
--    changes. `studio_bok_decision`: what Studio decided.
-- 3. `get_my_editor_decisions`: the author's own, for My page and the composer.
-- 4. `save_my_bok`: a refused piece is not sent again; a piece returned for
--    its recording goes again only with a reading made after the note;
--    sending again answers a request for changes. Signature unchanged.

create table if not exists public.bok_editor_decisions (
  bok_id uuid primary key references public.reels (id) on delete cascade,
  decision text not null check (decision in ('changes', 'refused')),
  kind text not null check (kind in ('recording', 'text', 'law', 'other')),
  note text not null check (char_length(btrim(note)) between 2 and 2000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz not null default now()
);

alter table public.bok_editor_decisions enable row level security;
-- Read and written only through the functions below (ADR 0011).
revoke all on table public.bok_editor_decisions from public, anon, authenticated;

create or replace function public.boks_editor_decision_json(d public.bok_editor_decisions, r public.reels)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'bokId', d.bok_id::text,
    'title', r.title,
    'status', r.status,
    'decision', d.decision,
    'kind', d.kind,
    'note', d.note,
    'decidedAt', d.decided_at
  );
$$;
revoke all on function public.boks_editor_decision_json(public.bok_editor_decisions, public.reels) from public, anon, authenticated;

-- Studio returns a piece sent from My page to its author, or refuses it, always with a reason.
create or replace function public.studio_decide_bok(p_bok_id uuid, p_decision text, p_kind text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_bok public.reels;
  v_row public.bok_editor_decisions;
begin
  if v_uid is null or not public.is_boks_admin(v_uid) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if v_decision not in ('changes', 'refused') then
    raise exception 'Return it for changes or refuse it.' using errcode = '22023';
  end if;
  if v_kind not in ('recording', 'text', 'law', 'other') then
    raise exception 'Choose what the reason is about: the recording, the text, the law or other.' using errcode = '22023';
  end if;
  if char_length(v_note) < 2 then
    raise exception 'Write the reason the author will read.' using errcode = '22023';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'The reason is longer than 2000 characters.' using errcode = '22023';
  end if;

  select * into v_bok from public.reels where id = p_bok_id for update;
  if v_bok.id is null or v_bok.author_user_id is null
    or not (v_bok.status = 'pending_review' and v_bok.cover_requested) then
    raise exception 'Only a piece sent from My page and waiting for the editors can be returned or refused here.' using errcode = '22023';
  end if;

  update public.reels
  set status = case when v_decision = 'changes' then 'draft' else 'rejected' end,
      cover_requested = false,
      reviewed_at = now(),
      reviewed_by = v_uid,
      review_note = left(v_note, 1000),
      updated_at = now()
  where id = p_bok_id
  returning * into v_bok;

  insert into public.bok_editor_decisions (bok_id, decision, kind, note, decided_by, decided_at)
  values (p_bok_id, v_decision, v_kind, v_note, v_uid, now())
  on conflict (bok_id) do update
    set decision = excluded.decision, kind = excluded.kind, note = excluded.note,
        decided_by = excluded.decided_by, decided_at = excluded.decided_at
  returning * into v_row;
  return public.boks_editor_decision_json(v_row, v_bok);
end;
$$;

-- Studio changes its mind about a refusal: the piece goes back to its author
-- as a request for changes, with the same reasons, and can be sent again.
create or replace function public.studio_reopen_bok(p_bok_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_bok public.reels;
  v_row public.bok_editor_decisions;
begin
  if v_uid is null or not public.is_boks_admin(v_uid) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  select * into v_row from public.bok_editor_decisions where bok_id = p_bok_id and decision = 'refused' for update;
  if v_row.bok_id is null then
    raise exception 'This piece was not refused here.' using errcode = '22023';
  end if;
  update public.reels set status = 'draft', updated_at = now()
  where id = p_bok_id and status = 'rejected'
  returning * into v_bok;
  if v_bok.id is null then
    raise exception 'This piece was not refused here.' using errcode = '22023';
  end if;
  update public.bok_editor_decisions set decision = 'changes', decided_by = v_uid, decided_at = now()
  where bok_id = p_bok_id
  returning * into v_row;
  return public.boks_editor_decision_json(v_row, v_bok);
end;
$$;

create or replace function public.studio_bok_decision(p_bok_id uuid)
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
    select public.boks_editor_decision_json(d, r)
    from public.bok_editor_decisions d join public.reels r on r.id = d.bok_id
    where d.bok_id = p_bok_id
  );
end;
$$;

-- The author's own: requests for changes on pieces back with them, and refusals.
create or replace function public.get_my_editor_decisions()
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
    select jsonb_agg(public.boks_editor_decision_json(d, r) order by d.decided_at desc)
    from public.bok_editor_decisions d join public.reels r on r.id = d.bok_id
    where r.author_user_id = v_uid
      and ((d.decision = 'changes' and r.status = 'draft') or (d.decision = 'refused' and r.status = 'rejected'))
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.studio_decide_bok(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.studio_reopen_bok(uuid) from public, anon, authenticated;
revoke all on function public.studio_bok_decision(uuid) from public, anon, authenticated;
revoke all on function public.get_my_editor_decisions() from public, anon, authenticated;
grant execute on function public.studio_decide_bok(uuid, text, text, text) to authenticated;
grant execute on function public.studio_reopen_bok(uuid) to authenticated;
grant execute on function public.studio_bok_decision(uuid) to authenticated;
grant execute on function public.get_my_editor_decisions() to authenticated;

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
  -- The editors refused it, with their reasons: it is not sent again as it
  -- is unless they reopen it (`studio_reopen_bok`).
  if not v_new and v_existing.status = 'rejected'
    and exists (select 1 from public.bok_editor_decisions d where d.bok_id = p_bok_id and d.decision = 'refused') then
    raise exception 'The editors cannot publish this piece. If you disagree, write to them in Requests and ideas.' using errcode = '42501';
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

  -- Returned for the recording: only a reading made after the editors' note counts.
  if coalesce(p_cover_by_team, false) and not v_new and exists (
    select 1 from public.bok_editor_decisions d
    where d.bok_id = p_bok_id and d.decision = 'changes' and d.kind = 'recording'
      and not exists (select 1 from public.bok_voices v where v.bok_id = p_bok_id and v.recorded_at > d.decided_at)
  ) then
    raise exception 'The editors asked for a new recording: record or upload the reading again.' using errcode = '22023';
  end if;

  -- Sent to the editors again: their request for changes is answered.
  if v_status = 'pending_review' and coalesce(p_cover_by_team, false) then
    delete from public.bok_editor_decisions where bok_id = v_bok.id and decision = 'changes';
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
