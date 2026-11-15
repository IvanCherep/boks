-- Studio publishes a Boks Series it recorded onto an author's page
-- (`docs/series-recorder.md`).
--
-- Until now only an author could publish a recording, and only onto their
-- own page (`publish_my_recorded_series`, 20261117170000); a recording made
-- in Studio, say an author's poem read by the team, had nowhere to go. The
-- publishing itself moves into one internal function, run for the author
-- whose page it is: the author's own call checks their grant as before, and
-- Studio's names the author by @handle and is not counted against anyone's
-- grant. The byline is the author's (their page's name, else the name on
-- their boks), never typed by Studio.

create or replace function public.boks_publish_recorded_series(
  p_owner uuid,
  p_actor uuid,
  p_check_grant boolean,
  p_bok_id uuid,
  p_title text,
  p_text text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_text text := btrim(coalesce(p_text, ''));
  v_space public.author_spaces;
  v_bok public.reels;
  v_byline text;
  v_used integer;
  v_recorded integer;
  v_top integer;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    raise exception 'This Series has no recording to publish.' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'Give the Series a title.' using errcode = '22023';
  end if;
  if char_length(v_text) not between 1 and 20000 then
    raise exception 'The Series has no text.' using errcode = '22023';
  end if;

  perform 1 from public.user_profiles where user_id = p_owner for update;
  select * into v_space from public.author_spaces where owner_user_id = p_owner and status <> 'merged' for update;
  if v_space.id is null then
    insert into public.author_spaces (kind, status, owner_user_id, created_by, published_at)
    values ('author', 'published', p_owner, p_actor, now())
    returning * into v_space;
  end if;

  v_byline := coalesce(
    nullif(btrim(coalesce(v_space.name, '')), ''),
    (select r.author_name from public.reels r where r.author_user_id = p_owner and btrim(coalesce(r.author_name, '')) <> '' order by coalesce(r.submitted_at, r.created_at) desc limit 1),
    (select '@' || p.handle from public.user_profiles p where p.user_id = p_owner));

  if p_bok_id is not null then
    -- The same recording again: its kept version replaces the one on the page.
    select * into v_bok from public.reels where id = p_bok_id for update;
    if v_bok.id is null or v_bok.author_user_id is distinct from p_owner
       or not exists (select 1 from public.author_space_works w where w.space_id = v_space.id and w.bok_id = p_bok_id and w.rights_note = 'series-recorder') then
      raise exception 'This Series is not one of yours.' using errcode = '42501';
    end if;
    update public.reels set title = left(v_title, 200), text = v_text, updated_at = now() where id = p_bok_id;
    update public.author_space_works
    set series_piece = p_token, title = left(v_title, 200), status = 'published', series_published = true, updated_at = now()
    where space_id = v_space.id and bok_id = p_bok_id;
    return jsonb_build_object('ok', true, 'bokId', p_bok_id, 'replaced', true);
  end if;

  if p_check_grant then
    select coalesce(c.used, 0) into v_used from public.series_credits c where c.user_id = p_owner;
    -- Only what the author published themselves counts: Studio's are on the house.
    select count(*) into v_recorded from public.author_space_works w
    join public.bok_rights br on br.reel_id = w.bok_id
    where w.space_id = v_space.id and w.rights_note = 'series-recorder' and br.confirmed_by = p_owner;
    if v_recorded >= coalesce(v_used, 0) then
      raise exception 'Every Series you made is already on your page.' using errcode = '54023';
    end if;
  end if;

  insert into public.reels (title, author_name, text, genre, mood, status, author_user_id, submitted_at, reviewed_at, updated_at)
  values (left(v_title, 200), left(v_byline, 120), v_text, 'literary', 'quiet', 'published', p_owner, now(), now(), now())
  returning * into v_bok;
  insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
  values (v_bok.id, true,
    case when p_actor = p_owner then 'Recorded and published by the author with the Series recorder'
         else 'Recorded with the Series recorder and published by the boks team' end,
    p_actor, now(), now())
  on conflict (reel_id) do nothing;
  insert into public.author_space_works (space_id, title, format, bok_id, status, revision, published_revision, series_piece, series_published, rights_note, published_at)
  values (v_space.id, left(v_title, 200), 'text', v_bok.id, 'published', 1, 1, p_token, true, 'series-recorder', now());

  -- First on a page the author has ordered; on one never ordered, newest first already puts it there.
  select min(o.position) into v_top from public.author_space_order o where o.space_id = v_space.id;
  if v_top is not null then
    insert into public.author_space_order (space_id, bok_id, position) values (v_space.id, v_bok.id, v_top - 1);
  end if;
  return jsonb_build_object('ok', true, 'bokId', v_bok.id, 'replaced', false);
end;
$$;
revoke all on function public.boks_publish_recorded_series(uuid, uuid, boolean, uuid, text, text, text) from public, anon, authenticated;

-- The author's own call: as before, from their grant (Studio is not counted).
create or replace function public.publish_my_recorded_series(
  p_bok_id uuid,
  p_title text,
  p_text text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_admin boolean := public.is_boks_admin(v_uid);
begin
  if not v_admin and not exists (select 1 from public.series_credits c where c.user_id = v_uid and c.granted > 0) then
    raise exception 'Boks Series are not open to this account.' using errcode = '42501';
  end if;
  return public.boks_publish_recorded_series(v_uid, v_uid, not v_admin, p_bok_id, p_title, p_text, p_token);
end;
$$;
revoke all on function public.publish_my_recorded_series(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.publish_my_recorded_series(uuid, text, text, text) to authenticated;

-- Studio: onto the page of the author named by @handle.
create or replace function public.studio_publish_recorded_series(
  p_handle text,
  p_bok_id uuid,
  p_title text,
  p_text text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_owner uuid;
  v_handle text := lower(btrim(regexp_replace(coalesce(p_handle, ''), '^@', '')));
  v_done jsonb;
begin
  if not public.is_boks_admin(v_uid) then
    raise exception 'Only Studio can publish onto another author''s page.' using errcode = '42501';
  end if;
  select p.user_id into v_owner from public.user_profiles p where lower(p.handle) = v_handle;
  if v_owner is null then
    raise exception 'There is no account @%.', v_handle using errcode = 'P0002';
  end if;
  v_done := public.boks_publish_recorded_series(v_owner, v_uid, false, p_bok_id, p_title, p_text, p_token);
  return v_done || jsonb_build_object('handle', (select p.handle from public.user_profiles p where p.user_id = v_owner));
end;
$$;
revoke all on function public.studio_publish_recorded_series(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.studio_publish_recorded_series(text, uuid, text, text, text) to authenticated;

-- Studio: whose page a recording most likely belongs on, from the byline
-- typed on it: the account whose page carries that name, else whose boks do.
create or replace function public.studio_series_author_for(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text := lower(btrim(coalesce(p_name, '')));
  v_owner uuid;
begin
  if not public.is_boks_admin(public.boks_require_reader_account()) then
    raise exception 'Studio only.' using errcode = '42501';
  end if;
  if v_name = '' then
    return null;
  end if;
  select s.owner_user_id into v_owner from public.author_spaces s
  where s.owner_user_id is not null and s.status <> 'merged' and lower(btrim(coalesce(s.name, ''))) = v_name
  limit 1;
  if v_owner is null then
    select r.author_user_id into v_owner from public.reels r
    where r.author_user_id is not null and r.status = 'published' and lower(btrim(coalesce(r.author_name, ''))) = v_name
    group by r.author_user_id order by count(*) desc limit 1;
  end if;
  if v_owner is null then
    return null;
  end if;
  return (select jsonb_build_object('handle', p.handle) from public.user_profiles p where p.user_id = v_owner);
end;
$$;
revoke all on function public.studio_series_author_for(text) from public, anon, authenticated;
grant execute on function public.studio_series_author_for(text) to authenticated;
