-- Covers of text boks are made only by the boks editors (owner, 2026-11-21).
--
-- Verified authors no longer upload or draw a cover for a piece they publish
-- from My page. A new piece without a cover goes to the editors
-- (`p_cover_by_team`, the review queue marked "Needs a cover"); Studio draws
-- or uploads its cover (`studio_set_bok_cover`, unchanged) and approves it.
-- A piece that already has a cover keeps it and can still be edited.
--
-- 1. `reserve_my_cover_drawing`: only Studio may reserve a drawing.
-- 2. `save_my_bok`: refuses any cover from the author.
-- Signatures are unchanged, so existing grants stand.

create or replace function public.reserve_my_cover_drawing(p_bok_id uuid, p_pictures integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_counts jsonb;
  v_pictures integer := least(greatest(coalesce(p_pictures, 2), 1), 2);
  v_owner uuid;
  v_admin boolean;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_bok_id is null then
    raise exception 'Which piece is the picture for?' using errcode = '22023';
  end if;
  -- Studio draws for a piece whose author asked the team for its cover.
  v_admin := public.is_boks_admin(v_uid);
  if not v_admin then
    raise exception 'Covers are made by the boks editors.' using errcode = '42501';
  end if;
  select r.author_user_id into v_owner from public.reels r where r.id = p_bok_id;
  if found and v_owner is distinct from v_uid and not v_admin then
    raise exception 'This piece belongs to another account.' using errcode = '42501';
  end if;

  -- One author at a time: two presses cannot both pass the count.
  perform 1 from public.user_profiles where user_id = v_uid for update;

  v_counts := public.boks_cover_drawings_json(v_uid, p_bok_id);
  if v_admin then
    insert into public.bok_cover_drawings (user_id, bok_id, pictures) values (v_uid, p_bok_id, v_pictures);
    return public.boks_cover_drawings_json(v_uid, p_bok_id);
  end if;
  if (v_counts ->> 'piece')::integer + v_pictures > public.boks_cover_pictures_per_piece() then
    raise exception 'Both pictures for this piece are already drawn. Upload your own to replace them.' using errcode = 'P0001';
  end if;
  if (v_counts ->> 'today')::integer + v_pictures > public.boks_cover_pictures_per_day() then
    raise exception 'That is all the pictures for today. Tomorrow there will be more; your own can be uploaded now.' using errcode = 'P0001';
  end if;

  insert into public.bok_cover_drawings (user_id, bok_id, pictures) values (v_uid, p_bok_id, v_pictures);
  return public.boks_cover_drawings_json(v_uid, p_bok_id);
end;
$$;

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
