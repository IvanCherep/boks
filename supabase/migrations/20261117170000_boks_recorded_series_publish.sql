-- A Boks Series an author recorded goes onto their page at once
-- (`docs/series-recorder.md`).
--
-- The team decided whom to trust when it granted them Boks Series
-- (`series_credits`, 20261117160000), so a Series made with the recorder is
-- not reviewed again: it is published as the author's bok, and the page plays
-- it from its link-only folder (`boks_space_bok_format` reads `series_piece`
-- of a published work, 20261115100000). An author without a page gets one,
-- public, as ordering their works always did (`save_author_space_order`).
--
-- A recorded work is marked by its rights note, `series-recorder`. The author
-- may publish at most as many as they have made (`series_credits.used`), so a
-- direct call cannot publish more than the recorder could; publishing the
-- same recording again (a rebuild kept instead) replaces its Series and text
-- in place.

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
  v_title text := btrim(coalesce(p_title, ''));
  v_text text := btrim(coalesce(p_text, ''));
  v_space public.author_spaces;
  v_bok public.reels;
  v_byline text;
  v_used integer;
  v_recorded integer;
  v_top integer;
begin
  if not v_admin and not exists (select 1 from public.series_credits c where c.user_id = v_uid and c.granted > 0) then
    raise exception 'Boks Series are not open to this account.' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    raise exception 'This Series has no recording to publish.' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'Give the Series a title.' using errcode = '22023';
  end if;
  if char_length(v_text) not between 1 and 20000 then
    raise exception 'The Series has no text.' using errcode = '22023';
  end if;

  perform 1 from public.user_profiles where user_id = v_uid for update;
  select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged' for update;
  if v_space.id is null then
    insert into public.author_spaces (kind, status, owner_user_id, created_by, published_at)
    values ('author', 'published', v_uid, v_uid, now())
    returning * into v_space;
  end if;

  v_byline := coalesce(
    nullif(btrim(coalesce(v_space.name, '')), ''),
    (select r.author_name from public.reels r where r.author_user_id = v_uid and btrim(coalesce(r.author_name, '')) <> '' order by coalesce(r.submitted_at, r.created_at) desc limit 1),
    (select '@' || p.handle from public.user_profiles p where p.user_id = v_uid));

  if p_bok_id is not null then
    -- The same recording again: its kept version replaces the one on the page.
    select * into v_bok from public.reels where id = p_bok_id for update;
    if v_bok.id is null or v_bok.author_user_id is distinct from v_uid
       or not exists (select 1 from public.author_space_works w where w.space_id = v_space.id and w.bok_id = p_bok_id and w.rights_note = 'series-recorder') then
      raise exception 'This Series is not one of yours.' using errcode = '42501';
    end if;
    update public.reels set title = left(v_title, 200), text = v_text, updated_at = now() where id = p_bok_id;
    update public.author_space_works
    set series_piece = p_token, title = left(v_title, 200), status = 'published', series_published = true, updated_at = now()
    where space_id = v_space.id and bok_id = p_bok_id;
    return jsonb_build_object('ok', true, 'bokId', p_bok_id, 'replaced', true);
  end if;

  if not v_admin then
    select coalesce(c.used, 0) into v_used from public.series_credits c where c.user_id = v_uid;
    select count(*) into v_recorded from public.author_space_works w where w.space_id = v_space.id and w.rights_note = 'series-recorder';
    if v_recorded >= coalesce(v_used, 0) then
      raise exception 'Every Series you made is already on your page.' using errcode = '54023';
    end if;
  end if;

  insert into public.reels (title, author_name, text, genre, mood, status, author_user_id, submitted_at, reviewed_at, updated_at)
  values (left(v_title, 200), left(v_byline, 120), v_text, 'literary', 'quiet', 'published', v_uid, now(), now(), now())
  returning * into v_bok;
  insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
  values (v_bok.id, true, 'Recorded and published by the author with the Series recorder', v_uid, now(), now())
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
revoke all on function public.publish_my_recorded_series(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.publish_my_recorded_series(uuid, text, text, text) to authenticated;
