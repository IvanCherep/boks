-- From a voiced piece to its Boks Series on the author's page (owner, 2026-11-22).
--
-- 1. The author sends a piece with their voice (`save_my_bok`) and, while the
--    editors have not taken it, may take it back (`withdraw_my_sent_bok`).
-- 2. The editors accept it into work (`studio_accept_bok`): the piece is
--    locked for its author and leaves the review queue for «Boks Series в
--    работе» (`studio_series_work_list`). It stays `pending_review`.
-- 3. Studio builds its Series from the author's take (a recorder draft,
--    `studio_link_series_draft`, `studio_series_source`) and sends the result
--    to the author (`studio_send_series_to_author`): a `ready` Series work on
--    the author's page for this very bok. The editors' cover is required.
-- 4. The author publishes it from My page as any ready work
--    (`publish_my_author_space` → `boks_publish_space_works`, which now lets
--    a sent piece go out with its series).
-- 5. The editors may return it with a reason at any point before (decisions,
--    `studio_decide_bok`), which unlocks it.
--
-- A piece sent from My page is never published straight from moderation any
-- more: trigger `reels_series_publish_guard`.

create table if not exists public.bok_series_work (
  bok_id uuid primary key references public.reels (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  state text not null check (state in ('accepted', 'sent', 'published', 'returned')),
  accepted_at timestamptz not null default now(),
  accepted_by uuid references auth.users (id) on delete set null,
  draft_id text check (draft_id is null or draft_id ~ '^[0-9a-f]{16}$'),
  work_id uuid references public.author_space_works (id) on delete set null,
  series_piece text check (series_piece is null or series_piece ~ '^[A-Za-z0-9_-]{22,64}$'),
  sent_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists bok_series_work_state_idx on public.bok_series_work (state);

alter table public.bok_series_work enable row level security;
-- Read and written only through the functions below (ADR 0011).
revoke all on table public.bok_series_work from public, anon, authenticated;

-- A piece sent from My page goes out only with its Boks Series, through the
-- author's own publish of the series the editors sent them; never straight
-- from moderation (`review_bok_submission`) or the composer.
create or replace function public.reels_series_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status = 'pending_review' and coalesce(old.cover_requested, false)
    and coalesce(current_setting('boks.series_publish', true), '') <> 'on'
    and (select auth.uid()) is not null then
    raise exception 'A piece sent from My page goes out with its Boks Series: accept it into work, make the series and send it to the author to publish.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.reels_series_publish_guard() from public, anon, authenticated;
drop trigger if exists reels_series_publish_guard on public.reels;
create trigger reels_series_publish_guard
  before update of status on public.reels
  for each row execute function public.reels_series_publish_guard();

create or replace function public.boks_series_work_json(w public.bok_series_work)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'bokId', w.bok_id::text,
    'state', w.state,
    'acceptedAt', w.accepted_at,
    'draftId', w.draft_id,
    'workId', w.work_id::text,
    'seriesPiece', w.series_piece,
    'sentAt', w.sent_at,
    'publishedAt', w.published_at
  );
$$;
revoke all on function public.boks_series_work_json(public.bok_series_work) from public, anon, authenticated;

-- The author takes a sent piece back while the editors have not taken it into work.
create or replace function public.withdraw_my_sent_bok(p_bok_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_bok public.reels;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select * into v_bok from public.reels where id = p_bok_id for update;
  if v_bok.id is null or v_bok.author_user_id is distinct from v_uid then
    raise exception 'This piece is not yours or no longer exists.' using errcode = '42501';
  end if;
  if exists (select 1 from public.bok_series_work w where w.bok_id = p_bok_id and w.state in ('accepted', 'sent')) then
    raise exception 'The editors are already making the Boks Series for this piece, so it cannot be taken back. Write to them in Requests and ideas.' using errcode = '42501';
  end if;
  if not (v_bok.status = 'pending_review' and v_bok.cover_requested) then
    raise exception 'Only a piece waiting for the editors can be taken back.' using errcode = '22023';
  end if;
  update public.reels
  set status = 'draft', cover_requested = false, updated_at = now()
  where id = p_bok_id
  returning * into v_bok;
  delete from public.bok_editor_decisions where bok_id = p_bok_id and decision = 'changes';
  return jsonb_build_object('id', v_bok.id::text, 'status', v_bok.status);
end;
$$;

-- My page and the composer: the editors' work on the author's own pieces.
create or replace function public.get_my_series_work()
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
    select jsonb_agg(public.boks_series_work_json(w))
    from public.bok_series_work w
    where w.author_id = v_uid and w.state in ('accepted', 'sent', 'published')
  ), '[]'::jsonb);
end;
$$;

-- Studio takes a voiced piece sent from My page into work for its Boks Series.
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
  insert into public.bok_series_work (bok_id, author_id, state, accepted_at, accepted_by, updated_at)
  values (p_bok_id, v_bok.author_user_id, 'accepted', now(), v_uid, now())
  on conflict (bok_id) do update
    set state = 'accepted', author_id = excluded.author_id, accepted_at = now(), accepted_by = v_uid,
        sent_at = null, sent_by = null, published_at = null, updated_at = now()
  returning * into v_row;
  return public.boks_series_work_json(v_row);
end;
$$;

-- Studio → «Boks Series в работе»: every piece in work, sent or published lately.
create or replace function public.studio_series_work_list()
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
  return coalesce((
    select jsonb_agg(public.boks_series_work_json(w) || jsonb_build_object(
      'title', r.title,
      'text', r.text,
      'byline', r.author_name,
      'authorHandle', p.handle,
      'coverVersion', r.cover_version,
      'hasCover', exists (select 1 from public.bok_covers c where c.bok_id = r.id),
      'bokStatus', r.status,
      'workStatus', sw.status
    ) order by case w.state when 'accepted' then 0 when 'sent' then 1 else 2 end, w.accepted_at)
    from public.bok_series_work w
    join public.reels r on r.id = w.bok_id
    left join public.user_profiles p on p.user_id = w.author_id
    left join public.author_space_works sw on sw.id = w.work_id
    where w.state in ('accepted', 'sent')
       or (w.state = 'published' and w.published_at > now() - interval '30 days')
  ), '[]'::jsonb);
end;
$$;

-- What a Studio recorder draft is made from: the piece and the author's chosen take.
create or replace function public.studio_series_source(p_bok_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bok public.reels;
  v_voice public.bok_voices;
begin
  if not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  select * into v_bok from public.reels where id = p_bok_id;
  if v_bok.id is null or not exists (select 1 from public.bok_series_work w where w.bok_id = p_bok_id and w.state in ('accepted', 'sent')) then
    raise exception 'This piece is not in work for its Boks Series.' using errcode = '22023';
  end if;
  select * into v_voice from public.bok_voices where bok_id = p_bok_id;
  return jsonb_build_object(
    'bokId', v_bok.id::text,
    'title', v_bok.title,
    'text', v_bok.text,
    'byline', v_bok.author_name,
    'draftId', (select w.draft_id from public.bok_series_work w where w.bok_id = p_bok_id),
    'voice', case when v_voice.bok_id is null then null else public.boks_voice_json(v_voice, v_bok.text) end
  );
end;
$$;

create or replace function public.studio_link_series_draft(p_bok_id uuid, p_draft_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bok_series_work;
begin
  if not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if p_draft_id is not null and p_draft_id !~ '^[0-9a-f]{16}$' then
    raise exception 'That is not a recorder draft.' using errcode = '22023';
  end if;
  update public.bok_series_work set draft_id = p_draft_id, updated_at = now()
  where bok_id = p_bok_id and state in ('accepted', 'sent')
  returning * into v_row;
  if v_row.bok_id is null then
    raise exception 'This piece is not in work for its Boks Series.' using errcode = '22023';
  end if;
  return public.boks_series_work_json(v_row);
end;
$$;

-- Studio sends the finished Series to the author: a ready Series work on the
-- author's page for this very bok, which the author publishes from My page.
create or replace function public.studio_send_series_to_author(p_bok_id uuid, p_series_piece text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_piece text := btrim(coalesce(p_series_piece, ''));
  v_row public.bok_series_work;
  v_bok public.reels;
  v_space public.author_spaces;
  v_work public.author_space_works;
begin
  if v_uid is null or not public.is_boks_admin(v_uid) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if v_piece !~ '^[A-Za-z0-9_-]{22,64}$' then
    raise exception 'Paste the link-only token of the finished Series.' using errcode = '22023';
  end if;
  select * into v_row from public.bok_series_work where bok_id = p_bok_id for update;
  if v_row.bok_id is null or v_row.state not in ('accepted', 'sent') then
    raise exception 'This piece is not in work for its Boks Series.' using errcode = '22023';
  end if;
  select * into v_bok from public.reels where id = p_bok_id for update;
  if v_bok.status <> 'pending_review' then
    raise exception 'This piece is not in work for its Boks Series.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.bok_covers c where c.bok_id = p_bok_id) then
    raise exception 'Add the cover first: the bok goes out with the editors'' cover.' using errcode = '22023';
  end if;
  select * into v_space from public.author_spaces
  where owner_user_id = v_row.author_id and kind = 'author' and status <> 'merged'
  order by created_at limit 1;
  if v_space.id is null then
    raise exception 'The author has no page to send the series to.' using errcode = '22023';
  end if;

  if v_row.work_id is not null then
    select * into v_work from public.author_space_works where id = v_row.work_id and space_id = v_space.id for update;
  end if;
  if v_work.id is not null and v_work.status <> 'published' then
    update public.author_space_works
    set title = left(coalesce(nullif(v_bok.title, ''), 'Boks Series'), 200), body = null, series_piece = v_piece,
        status = 'ready', revision = revision + 1, ready_by = v_uid, ready_at = now(), updated_at = now()
    where id = v_work.id
    returning * into v_work;
  else
    insert into public.author_space_works (space_id, title, body, format, bok_id, status, series_piece, rights_note, ready_by, ready_at)
    values (v_space.id, left(coalesce(nullif(v_bok.title, ''), 'Boks Series'), 200), null, 'series', p_bok_id, 'ready', v_piece,
            'Boks Series made by the boks editors from the author''s reading', v_uid, now())
    returning * into v_work;
  end if;

  update public.bok_series_work
  set state = 'sent', work_id = v_work.id, series_piece = v_piece, sent_at = now(), sent_by = v_uid, updated_at = now()
  where bok_id = p_bok_id
  returning * into v_row;
  return public.boks_series_work_json(v_row);
end;
$$;

revoke all on function public.withdraw_my_sent_bok(uuid) from public, anon, authenticated;
revoke all on function public.get_my_series_work() from public, anon, authenticated;
revoke all on function public.studio_accept_bok(uuid) from public, anon, authenticated;
revoke all on function public.studio_series_work_list() from public, anon, authenticated;
revoke all on function public.studio_series_source(uuid) from public, anon, authenticated;
revoke all on function public.studio_link_series_draft(uuid, text) from public, anon, authenticated;
revoke all on function public.studio_send_series_to_author(uuid, text) from public, anon, authenticated;
grant execute on function public.withdraw_my_sent_bok(uuid) to authenticated;
grant execute on function public.get_my_series_work() to authenticated;
grant execute on function public.studio_accept_bok(uuid) to authenticated;
grant execute on function public.studio_series_work_list() to authenticated;
grant execute on function public.studio_series_source(uuid) to authenticated;
grant execute on function public.studio_link_series_draft(uuid, text) to authenticated;
grant execute on function public.studio_send_series_to_author(uuid, text) to authenticated;

-- save_my_bok: a piece in work for its Boks Series is not changed by its author.
CREATE OR REPLACE FUNCTION public.save_my_bok(p_bok_id uuid, p_title text DEFAULT ''::text, p_text text DEFAULT ''::text, p_publish boolean DEFAULT false, p_cover jsonb DEFAULT NULL::jsonb, p_cover_by_team boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- The editors took it into work for its Boks Series: it is theirs until
  -- they send the series back or return the piece.
  if not v_new and exists (select 1 from public.bok_series_work w where w.bok_id = p_bok_id and w.state in ('accepted', 'sent')) then
    raise exception 'The editors are already making the Boks Series for this piece; it cannot be changed now.' using errcode = '42501';
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
$function$;

-- studio_decide_bok: returning or refusing a piece in work unlocks it and takes back a sent series.
CREATE OR REPLACE FUNCTION public.studio_decide_bok(p_bok_id uuid, p_decision text, p_kind text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- A piece in work for its Boks Series comes back to its author unlocked;
  -- a series already sent to them is taken back.
  update public.author_space_works sw set status = 'withdrawn', updated_at = now()
  from public.bok_series_work w
  where w.bok_id = p_bok_id and w.work_id = sw.id and sw.status in ('preparing', 'ready', 'changes_requested');
  update public.bok_series_work set state = 'returned', updated_at = now()
  where bok_id = p_bok_id and state in ('accepted', 'sent');
  return public.boks_editor_decision_json(v_row, v_bok);
end;
$function$;

-- boks_publish_space_works: a sent piece goes out with its series.
CREATE OR REPLACE FUNCTION public.boks_publish_space_works(p_space author_spaces, p_items jsonb, p_actor uuid, p_rights_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        title, author_name, text, genre, mood,
        status, author_user_id, submitted_at, reviewed_at, reviewed_by, updated_at
      )
      values (
        v_work.title, left(v_byline, 120), v_work.body, 'literary', 'quiet',
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
      -- The author's own piece the editors made a Boks Series for and sent
      -- back (`studio_send_series_to_author`): it goes out now, with the series.
      if v_bok.id is not null and v_bok.status = 'pending_review' and exists (
        select 1 from public.bok_series_work sw where sw.bok_id = v_bok.id and sw.work_id = v_work.id and sw.state = 'sent'
      ) then
        if not exists (select 1 from public.bok_covers c where c.bok_id = v_bok.id) then
          raise exception '«%» has no cover yet: the editors add it before sending the series.', v_work.title using errcode = '22023';
        end if;
        perform set_config('boks.series_publish', 'on', true);
        update public.reels
        set status = 'published', cover_requested = false, reviewed_at = now(),
            reviewed_by = coalesce(v_work.ready_by, reviewed_by), updated_at = now()
        where id = v_bok.id
        returning * into v_bok;
        perform set_config('boks.series_publish', 'off', true);
        update public.bok_series_work set state = 'published', published_at = now(), updated_at = now() where bok_id = v_bok.id;
      end if;
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
$function$;

-- get_boks_admin_snapshot: pieces in work for their Boks Series leave the review queue.
CREATE OR REPLACE FUNCTION public.get_boks_admin_snapshot(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_query text DEFAULT ''::text, p_sort text DEFAULT 'newest'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with params as (
      select
        least(greatest(coalesce(p_limit, 100), 1), 500) as limit_value,
        greatest(coalesce(p_offset, 0), 0) as offset_value,
        lower(coalesce(p_query, '')) as query_value,
        coalesce(p_sort, 'signal') as sort_value
    ),
    like_rollup as (
      select reel_id, count(*)::integer as likes
      from public.likes
      group by reel_id
    ),
    comment_rollup as (
      select reel_id, count(*)::integer as comments
      from public.comments
      group by reel_id
    ),
    story_rows as (
      select
        r.id,
        r.title,
        r.author_name,
        r.author_handle,
        r.hook,
        r.genre,
        r.mood,
        r.minutes,
        r.created_at,
        coalesce(l.likes, 0) as likes,
        coalesce(c.comments, 0) as comments,
        (coalesce(l.likes, 0) * 5 + coalesce(c.comments, 0) * 6) as signal
      from public.boks_reels r
      left join like_rollup l on l.reel_id = r.id
      left join comment_rollup c on c.reel_id = r.id
      cross join params p
      where r.status = 'published'
        and (
          p.query_value = ''
          or lower(r.title) like '%' || p.query_value || '%'
          or lower(r.author_name) like '%' || p.query_value || '%'
          or lower(r.genre) like '%' || p.query_value || '%'
          or lower(r.mood) like '%' || p.query_value || '%'
        )
    ),
    ordered_stories as (
      select *
      from story_rows
      cross join params p
      order by
        case when p.sort_value = 'title' then lower(title) end asc,
        case when p.sort_value = 'newest' then extract(epoch from created_at) end desc,
        case when p.sort_value = 'comments' then comments end desc,
        case when p.sort_value = 'signal' then signal end desc,
        signal desc,
        created_at desc
      limit (select limit_value from params)
      offset (select offset_value from params)
    ),
    moderation_rows as (
      select
        r.id,
        r.title,
        r.author_name,
        r.author_handle,
        r.hook,
        r.text,
        r.genre,
        r.mood,
        r.minutes,
        r.status,
        r.submitted_at,
        r.reviewed_at,
        r.review_note,
        r.author_user_id,
        coalesce(au.email, '') as author_email
      from public.boks_reels r
      left join auth.users au on au.id = r.author_user_id
      cross join params p
      where r.status in ('pending_review', 'rejected')
        -- A piece the editors took into work for its Boks Series is in «Boks Series в работе», not here.
        and not exists (select 1 from public.bok_series_work sw where sw.bok_id = r.id and sw.state in ('accepted', 'sent'))
        and (
          p.query_value = ''
          or lower(r.title) like '%' || p.query_value || '%'
          or lower(r.author_name) like '%' || p.query_value || '%'
          or lower(coalesce(au.email, '')) like '%' || p.query_value || '%'
        )
      order by
        case when r.status = 'pending_review' then 0 else 1 end,
        r.submitted_at desc nulls last,
        r.created_at desc
      limit 50
    ),
    all_published as (
      select
        count(*)::integer as total_stories,
        (select count(*)::integer from public.likes) as total_likes,
        (select count(*)::integer from public.comments) as total_comments
      from public.reels
      where status = 'published'
    ),
    moderation_counts as (
      select
        count(*) filter (where status = 'pending_review'
          and not exists (select 1 from public.bok_series_work sw where sw.bok_id = reels.id and sw.state in ('accepted', 'sent')))::integer as pending_review,
        count(*) filter (where status = 'rejected')::integer as rejected,
        count(*) filter (where status = 'published' and author_user_id is not null)::integer as approved_author_boks
      from public.reels
    ),
    genre_rows as (
      select
        r.genre,
        count(*)::integer as stories,
        coalesce(sum(l.likes), 0)::integer as likes,
        coalesce(sum(c.comments), 0)::integer as comments,
        (coalesce(sum(l.likes), 0) * 5 + coalesce(sum(c.comments), 0) * 6)::integer as signal
      from public.boks_reels r
      left join like_rollup l on l.reel_id = r.id
      left join comment_rollup c on c.reel_id = r.id
      where r.status = 'published'
      group by r.genre
      order by likes desc, comments desc, stories desc
    ),
    mood_rows as (
      select
        r.mood,
        count(*)::integer as stories,
        coalesce(sum(l.likes), 0)::integer as likes,
        coalesce(sum(c.comments), 0)::integer as comments,
        (coalesce(sum(l.likes), 0) * 5 + coalesce(sum(c.comments), 0) * 6)::integer as signal
      from public.boks_reels r
      left join like_rollup l on l.reel_id = r.id
      left join comment_rollup c on c.reel_id = r.id
      where r.status = 'published'
      group by r.mood
      order by likes desc, comments desc, stories desc
    ),
    recent_events as (
      select 'like' as eventType, reel_id::text as storyId, user_id::text as visitorId, created_at as createdAt
      from public.likes
      union all
      select 'comment' as eventType, reel_id::text as storyId, user_id::text as visitorId, created_at as createdAt
      from public.comments
      order by createdAt desc
      limit 50
    ),
    user_rows as (
      select
        up.user_id,
        coalesce(au.email, '') as email,
        up.handle,
        up.role,
        up.created_at,
        coalesce(au.last_sign_in_at, au.created_at) as last_sign_in_at,
        (select count(*)::integer from public.likes l where l.user_id = up.user_id) as likes
      from public.user_profiles up
      join auth.users au on au.id = up.user_id
      where coalesce(au.is_anonymous, false) is false
      order by up.created_at desc
      limit 200
    )
    select jsonb_build_object(
      'funnel', jsonb_build_object(
        'totalStories', (select total_stories from all_published),
        'likes', (select total_likes from all_published),
        'comments', (select total_comments from all_published),
        'users', (select count(*)::integer from public.user_profiles),
        'admins', (select count(*)::integer from public.user_profiles where role = 'admin'),
        'pendingReview', (select pending_review from moderation_counts),
        'rejectedBoks', (select rejected from moderation_counts),
        'approvedAuthorBoks', (select approved_author_boks from moderation_counts)
      ),
      'stories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id::text,
          'title', title,
          'authorName', author_name,
          'authorHandle', author_handle,
          'hook', hook,
          'body', '',
          'genre', genre,
          'mood', mood,
          'minutes', minutes,
          'likes', likes,
          'commentsCount', comments,
          'comments', comments,
          'signal', signal
        ))
        from ordered_stories
      ), '[]'::jsonb),
      'moderationQueue', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id::text,
          'title', title,
          'authorName', author_name,
          'authorHandle', author_handle,
          'hook', hook,
          'body', text,
          'genre', genre,
          'mood', mood,
          'minutes', minutes,
          'status', status,
          'submittedAt', submitted_at,
          'reviewedAt', reviewed_at,
          'reviewNote', review_note,
          'authorUserId', author_user_id::text,
          'authorEmail', author_email
        ))
        from moderation_rows
      ), '[]'::jsonb),
      'recentEvents', coalesce((select jsonb_agg(to_jsonb(recent_events)) from recent_events), '[]'::jsonb),
      'users', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', user_id::text,
          'email', email,
          'role', role,
          'displayName', handle,
          'createdAt', created_at,
          'lastSignInAt', last_sign_in_at,
          'likes', likes
        ))
        from user_rows
      ), '[]'::jsonb),
      'genres', coalesce((select jsonb_agg(to_jsonb(genre_rows)) from genre_rows), '[]'::jsonb),
      'moods', coalesce((select jsonb_agg(to_jsonb(mood_rows)) from mood_rows), '[]'::jsonb),
      'pagination', jsonb_build_object(
        'limit', (select limit_value from params),
        'offset', (select offset_value from params),
        'total', (select count(*)::integer from story_rows),
        'hasMore', ((select offset_value + limit_value from params) < (select count(*) from story_rows)),
        'sort', (select sort_value from params),
        'query', coalesce(p_query, '')
      )
    )
  );
end;
$function$;
