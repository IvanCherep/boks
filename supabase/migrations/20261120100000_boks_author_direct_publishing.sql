-- An author with an open page publishes straight away, with a cover
-- (docs/author-publishing.md).
--
-- 1. `boks_publishes_directly(uid)`: the owner of a published author page the
--    team has verified (`author_spaces.verified`) - the authors behind the
--    curtain. The team chose them when it made the page; their new boks are
--    not reviewed again, as their recorded Series already are not. A page the
--    database made for an ordinary author when they first ordered their works
--    (`save_author_space_order`) is not verified: they still send for review.
-- 2. `bok_covers`: a bok's own picture, uploaded by its author or drawn for
--    it, as a WebP for the reader and a JPEG for link previews. Only RPCs read
--    or write it. `reels.cover_version` says a bok has one and which, so the
--    feed, the author page and the share image know without reading bytes.
-- 3. `bok_cover_drawings`: every picture drawn for a piece. At most two per
--    piece and twelve a day per author: they cost money, an upload does not.
-- 4. `save_my_bok`: one call writes the text, the title (empty means the
--    first line), the cover and the state - a draft, or published - for an
--    author who publishes directly. A published piece needs a cover. A new
--    piece goes to the top of the page's order when the page has one.
-- 5. `get_my_author_space` lists drafts with everything else, marked, and
--    gives every row its cover version.
-- 6. `get_recommendation_candidates`, `boks_reels` and `published_boks` carry
--    `cover_version`; nothing else in them changes.

-- ------------------------------------------------------------------ tables

alter table public.reels add column if not exists cover_version integer
  check (cover_version is null or cover_version > 0);

-- The author asked the team to find the picture: the piece waits in the
-- review queue until it has one (`boks_bok_goes_out_with_a_cover`).
alter table public.reels add column if not exists cover_requested boolean not null default false;

create table if not exists public.bok_covers (
  bok_id uuid primary key references public.reels (id) on delete cascade,
  -- 1080x1920 for the reader (WebP, or JPEG from a browser that writes no
  -- WebP); `jpeg` is the same picture for link previews and the curtain
  -- loop, whose renderers do not read WebP.
  webp bytea not null check (octet_length(webp) between 1000 and 1500000),
  jpeg bytea not null check (octet_length(jpeg) between 1000 and 2000000),
  source text not null check (source in ('upload', 'generated')),
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.bok_cover_drawings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The bok's id: the composer chooses it before the piece is first saved,
  -- so a piece's drawings count from its first press.
  bok_id uuid not null,
  pictures integer not null check (pictures between 1 and 2),
  created_at timestamptz not null default now()
);

create index if not exists bok_cover_drawings_piece_idx on public.bok_cover_drawings (user_id, bok_id);
create index if not exists bok_cover_drawings_day_idx on public.bok_cover_drawings (user_id, created_at desc);

alter table public.bok_covers enable row level security;
alter table public.bok_cover_drawings enable row level security;
revoke all on table public.bok_covers, public.bok_cover_drawings from public, anon, authenticated;

-- ------------------------------------------------------------------ verified

-- The team's mark. Pages the team made (their creator is not their owner),
-- pages on the Series shelf and the pages of authors granted Boks Series are
-- verified now; a page the team makes from here on is verified as it is made;
-- Studio → Authors switches it either way (`studio_set_space_verified`).
alter table public.author_spaces add column if not exists verified boolean not null default false;

update public.author_spaces s
set verified = true
where s.kind = 'author'
  and s.status <> 'merged'
  and (
    s.created_by is distinct from s.owner_user_id
    or s.series_shelf
    or exists (select 1 from public.series_credits c where c.user_id = s.owner_user_id and c.granted > 0)
  );

create or replace function public.boks_space_verified_by_team()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'author' and new.created_by is distinct from new.owner_user_id and new.created_by is not null then
    new.verified := true;
  end if;
  return new;
end;
$$;

drop trigger if exists author_spaces_verified_by_team on public.author_spaces;
create trigger author_spaces_verified_by_team
  before insert on public.author_spaces
  for each row execute function public.boks_space_verified_by_team();

create or replace function public.studio_space_verified(p_space_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  return (select s.verified from public.author_spaces s where s.id = p_space_id);
end;
$$;

create or replace function public.studio_set_space_verified(p_space_id uuid, p_verified boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_verified boolean;
begin
  if not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  update public.author_spaces set verified = coalesce(p_verified, false), updated_at = now()
  where id = p_space_id and kind = 'author'
  returning verified into v_verified;
  if v_verified is null then
    raise exception 'No such author page.' using errcode = '22023';
  end if;
  return v_verified;
end;
$$;

-- ------------------------------------------------------------------ rules

create or replace function public.boks_cover_pictures_per_piece() returns integer
language sql immutable set search_path = '' as $$ select 2 $$;

create or replace function public.boks_cover_pictures_per_day() returns integer
language sql immutable set search_path = '' as $$ select 12 $$;

create or replace function public.boks_publishes_directly(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and not exists (select 1 from public.user_profiles p where p.user_id = p_user_id and p.banned_at is not null)
    and exists (
      select 1 from public.author_spaces s
      where s.owner_user_id = p_user_id and s.kind = 'author' and s.status = 'published' and s.verified
    );
$$;

create or replace function public.boks_cover_drawings_json(p_user_id uuid, p_bok_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'perPiece', public.boks_cover_pictures_per_piece(),
    'piece', coalesce((select sum(d.pictures)::integer from public.bok_cover_drawings d
      where d.user_id = p_user_id and d.bok_id = p_bok_id), 0),
    'perDay', public.boks_cover_pictures_per_day(),
    'today', coalesce((select sum(d.pictures)::integer from public.bok_cover_drawings d
      where d.user_id = p_user_id and d.created_at > now() - interval '24 hours'), 0)
  );
$$;

-- What the composer needs to know before anything is written.
create or replace function public.get_my_publishing(p_bok_id uuid default null)
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
    'direct', public.boks_publishes_directly(v_uid),
    'maxCharacters', public.boks_max_text_characters(),
    'drawings', public.boks_cover_drawings_json(v_uid, p_bok_id)
  );
end;
$$;

-- Called by the app's cover route with the author's own token, before it
-- queues the drawing: the count is the database's, never the route's.
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
  if not v_admin and not public.boks_publishes_directly(v_uid) then
    raise exception 'Pictures are drawn for verified authors.' using errcode = '42501';
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

-- --------------------------------------------------------------- save

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
  v_webp bytea;
  v_jpeg bytea;
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

  if p_cover is not null then
    if p_cover ->> 'source' not in ('upload', 'generated') then
      raise exception 'Where does the picture come from?' using errcode = '22023';
    end if;
    begin
      v_webp := decode(p_cover ->> 'webp', 'base64');
      v_jpeg := decode(p_cover ->> 'jpeg', 'base64');
    exception when others then
      raise exception 'The picture could not be read.' using errcode = '22023';
    end;
    -- RIFF....WEBP or FF D8 FF for the reader's picture (Safari's canvas
    -- writes no WebP, so a JPEG stands in), FF D8 FF for the preview one.
    if v_webp is null or v_jpeg is null
      or not ((substring(v_webp from 1 for 4) = '\x52494646'::bytea and substring(v_webp from 9 for 4) = '\x57454250'::bytea)
        or substring(v_webp from 1 for 3) = '\xffd8ff'::bytea)
      or substring(v_jpeg from 1 for 3) <> '\xffd8ff'::bytea then
      raise exception 'The picture could not be read.' using errcode = '22023';
    end if;
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
  -- A piece waiting for the team's cover can still be changed, or published
  -- with the author's own cover after all.
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
    raise exception 'A bok goes out with a picture: draw one or upload your own.' using errcode = '22023';
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

  if p_cover is not null then
    insert into public.bok_covers (bok_id, webp, jpeg, source, version, created_by, updated_at)
    values (v_bok.id, v_webp, v_jpeg, p_cover ->> 'source', 1, v_uid, now())
    on conflict (bok_id) do update
      set webp = excluded.webp, jpeg = excluded.jpeg, source = excluded.source,
          version = public.bok_covers.version + 1, created_by = excluded.created_by, updated_at = now();
    update public.reels set cover_version = (select c.version from public.bok_covers c where c.bok_id = v_bok.id)
    where id = v_bok.id
    returning * into v_bok;
  end if;

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

-- The author's own piece, as the composer opens it again.
create or replace function public.get_my_bok_draft(p_bok_id uuid)
returns jsonb
language plpgsql
stable
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
  select * into v_bok from public.reels where id = p_bok_id and author_user_id = v_uid;
  if v_bok.id is null then
    raise exception 'This piece is not yours or no longer exists.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'text', v_bok.text,
    'status', v_bok.status,
    'coverRequested', v_bok.cover_requested,
    'coverVersion', v_bok.cover_version,
    'cover', (select jsonb_build_object('source', c.source, 'webp', encode(c.webp, 'base64'))
      from public.bok_covers c where c.bok_id = v_bok.id),
    'drawings', public.boks_cover_drawings_json(v_uid, v_bok.id)
  );
end;
$$;

-- A draft nobody has read goes at once, cover and all.
create or replace function public.delete_my_draft(p_bok_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  delete from public.reels where id = p_bok_id and author_user_id = v_uid and status = 'draft';
  if not found then
    raise exception 'Only your own draft can be deleted here.' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'id', p_bok_id::text);
end;
$$;

-- The picture of a published bok, for `/b/<id>/cover.webp` and `.jpg`.
create or replace function public.get_boks_cover(p_bok_id uuid, p_format text default 'webp')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', c.version,
    'bytes', encode(case when p_format = 'jpeg' then c.jpeg else c.webp end, 'base64')
  )
  from public.bok_covers c
  join public.reels r on r.id = c.bok_id
  where c.bok_id = p_bok_id and r.status = 'published';
$$;


-- --------------------------------------------------------------- the team's cover

-- Whatever publishes it - the author, Studio's review, a restore - a piece
-- whose author asked the team for its picture goes out only with one.
create or replace function public.boks_bok_goes_out_with_a_cover()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' and new.cover_requested
    and not exists (select 1 from public.bok_covers c where c.bok_id = new.id) then
    raise exception 'The author asked the team for this bok''s cover: add one before publishing.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists reels_cover_before_publish on public.reels;
create trigger reels_cover_before_publish
  before update of status on public.reels
  for each row execute function public.boks_bok_goes_out_with_a_cover();

-- The review queue's marks: which waiting pieces asked for a cover, and
-- which already have one.
create or replace function public.studio_cover_requests()
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
    select jsonb_agg(jsonb_build_object('bokId', r.id::text, 'coverVersion', r.cover_version) order by r.submitted_at)
    from public.reels r
    where r.status = 'pending_review' and r.cover_requested
  ), '[]'::jsonb);
end;
$$;

create or replace function public.studio_bok_cover(p_bok_id uuid)
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
    select jsonb_build_object('version', c.version, 'source', c.source, 'webp', encode(c.webp, 'base64'))
    from public.bok_covers c where c.bok_id = p_bok_id
  );
end;
$$;

-- Studio gives a waiting piece its picture; approving it is still the review's.
create or replace function public.studio_set_bok_cover(p_bok_id uuid, p_cover jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_webp bytea;
  v_jpeg bytea;
  v_version integer;
begin
  if not public.is_boks_admin(v_uid) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reels r where r.id = p_bok_id) then
    raise exception 'No such bok.' using errcode = '22023';
  end if;
  if p_cover ->> 'source' not in ('upload', 'generated') then
    raise exception 'Where does the picture come from?' using errcode = '22023';
  end if;
  begin
    v_webp := decode(p_cover ->> 'webp', 'base64');
    v_jpeg := decode(p_cover ->> 'jpeg', 'base64');
  exception when others then
    raise exception 'The picture could not be read.' using errcode = '22023';
  end;
  if v_webp is null or v_jpeg is null
    or not ((substring(v_webp from 1 for 4) = '\x52494646'::bytea and substring(v_webp from 9 for 4) = '\x57454250'::bytea)
      or substring(v_webp from 1 for 3) = '\xffd8ff'::bytea)
    or substring(v_jpeg from 1 for 3) <> '\xffd8ff'::bytea then
    raise exception 'The picture could not be read.' using errcode = '22023';
  end if;
  insert into public.bok_covers (bok_id, webp, jpeg, source, version, created_by, updated_at)
  values (p_bok_id, v_webp, v_jpeg, p_cover ->> 'source', 1, v_uid, now())
  on conflict (bok_id) do update
    set webp = excluded.webp, jpeg = excluded.jpeg, source = excluded.source,
        version = public.bok_covers.version + 1, created_by = excluded.created_by, updated_at = now()
  returning version into v_version;
  update public.reels set cover_version = v_version, updated_at = now() where id = p_bok_id;
  return jsonb_build_object('bokId', p_bok_id::text, 'coverVersion', v_version);
end;
$$;

-- ------------------------------------------------------------------ views

-- Same columns in the same order, with `cover_version` added at the end.
create or replace view public.boks_reels as
select r.id,
  r.title,
  ''::text as hook,
  r.text,
  r.genre,
  r.mood,
  r.minutes,
  r.status,
  r.is_seed,
  r.created_at,
  r.updated_at,
  r.author_user_id,
  r.submitted_at,
  r.reviewed_at,
  r.reviewed_by,
  r.review_note,
  r.word_count,
  r.reading_shape,
  r.line_break_count,
  r.author_name,
  coalesce(i.handle, ''::text) as author_handle,
  r.language,
  r.summary,
  r.slug,
  r.cover_version
from public.reels r
left join public.boks_public_identity i on i.user_id = r.author_user_id;

create or replace view public.published_boks as
select id, title, author_name, author_handle, author_user_id, hook, text,
       genre, mood, minutes, word_count, reading_shape, line_break_count,
       created_at, language, summary, slug, cover_version
from public.boks_reels b
where status = 'published';


-- ------------------------------------------------------------------ the page

create or replace function public.get_my_author_space()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_space public.author_spaces;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged';

  return jsonb_build_object(
    'space', case when v_space.id is null then null else jsonb_build_object(
      'id', v_space.id::text,
      'status', v_space.status,
      'orderVersion', v_space.order_version,
      'publishedAt', v_space.published_at
    ) end,
    'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
    'name', v_space.name,
    'shareCard', v_space.share_card,
    'shareVideo', v_space.share_video,
    'messages', case when v_space.id is null then '[]'::jsonb else public.boks_space_messages_json(v_space.id) end,
    'unread', case when v_space.id is null then 0 else (
      select count(*)::integer from public.author_space_messages m
      where m.space_id = v_space.id and not m.from_author and m.created_at > coalesce(v_space.author_seen_at, '-infinity'::timestamptz)
    ) end,
    'orderVersion', coalesce(v_space.order_version, 0),
    -- One list: what readers see (published boks) and what is prepared, in
    -- the page's order. Published boks of a page never ordered keep the
    -- order readers know (newest first), after anything placed by hand.
    'items', coalesce((
      with published as (
        select b.id, b.title, b.created_at, o.position, b.cover_version
        from public.published_boks b
        left join public.author_space_order o on o.space_id = v_space.id and o.bok_id = b.id
        where b.author_user_id = v_uid
      ),
      -- Works the author took off the site themselves (withdraw_my_bok): kept
      -- on the list, marked hidden, so they can be put back from here.
      hidden as (
        select b.id, b.title, b.created_at, o.position, b.cover_version
        from public.reels b
        left join public.author_space_order o on o.space_id = v_space.id and o.bok_id = b.id
        where b.author_user_id = v_uid and b.status = 'withdrawn' and b.withdrawn_from_status = 'published'
      ),
      -- Pieces the author wrote here and has not published yet.
      drafts as (
        select b.id, b.title, b.created_at, o.position, b.cover_version, b.status
        from public.reels b
        left join public.author_space_order o on o.space_id = v_space.id and o.bok_id = b.id
        where b.author_user_id = v_uid
          and (b.status = 'draft' or (b.status = 'pending_review' and b.cover_requested))
      ),
      prepared as (
        select w.* from public.author_space_works w
        where w.space_id = v_space.id and w.status not in ('published', 'withdrawn')
      ),
      rows as (
        select 'b:' || p.id::text as key, p.position, p.created_at, 1 as published_first,
          jsonb_build_object(
            'key', 'b:' || p.id::text,
            'bokId', p.id::text,
            'title', p.title,
            'published', true,
            'coverVersion', p.cover_version,
            'format', coalesce(public.boks_space_bok_format(v_space.id, p.id) ->> 'format', 'text'),
            'seriesHeld', coalesce((public.boks_space_bok_format(v_space.id, p.id) ->> 'seriesHeld')::boolean, false),
            'work', (
              select public.boks_space_work_json(w)
              from public.author_space_works w
              where w.space_id = v_space.id and w.bok_id = p.id and w.status <> 'withdrawn'
              order by (w.format = 'series') desc limit 1
            )
          ) as item
        from published p
        union all
        select 'b:' || h.id::text, h.position, h.created_at, 1,
          jsonb_build_object(
            'key', 'b:' || h.id::text,
            'bokId', h.id::text,
            'title', h.title,
            'published', false,
            'hidden', true,
            'coverVersion', h.cover_version,
            'format', 'text',
            'work', (
              select public.boks_space_work_json(w)
              from public.author_space_works w
              where w.space_id = v_space.id and w.bok_id = h.id and w.status <> 'withdrawn'
              order by (w.format = 'series') desc limit 1
            )
          )
        from hidden h
        union all
        select 'b:' || d.id::text, d.position, d.created_at, 1,
          jsonb_build_object(
            'key', 'b:' || d.id::text,
            'bokId', d.id::text,
            'title', d.title,
            'published', false,
            'draft', d.status = 'draft',
            'coverWaiting', d.status = 'pending_review',
            'coverVersion', d.cover_version,
            'format', 'text',
            'work', null
          )
        from drafts d
        union all
        select 'w:' || w.id::text, w.position, w.created_at, 0,
          jsonb_build_object(
            'key', 'w:' || w.id::text,
            'bokId', w.bok_id::text,
            'title', w.title,
            'published', false,
            'format', w.format,
            'work', public.boks_space_work_json(w)
          )
        from prepared w
        -- A Series version of a published bok shows on that bok's row.
        where not (w.bok_id is not null and (
          exists (select 1 from published p where p.id = w.bok_id)
          or exists (select 1 from hidden h where h.id = w.bok_id)
        ))
      )
      select jsonb_agg(r.item order by r.position nulls last, r.created_at desc)
      from rows r
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------------ the feed

-- As in 20261118130000_boks_reading_request.sql, with the cover version.
create or replace function public.get_recommendation_candidates(
  p_limit integer DEFAULT 200,
  p_languages text[] DEFAULT NULL::text[],
  p_facets jsonb DEFAULT NULL::jsonb,
  p_prefer jsonb DEFAULT NULL::jsonb,
  p_exclude uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 400);
  -- Half the slate is the newest, half is drawn from everything else.
  v_recent integer := greatest(1, least(greatest(coalesce(p_limit, 200), 1), 400) / 2);
  v_since timestamptz := now() - interval '60 days';
  v_uid uuid := (select auth.uid());
  -- The reader's stored choice wins over whatever the client sends, so a
  -- signed-in reader's setting follows them between devices. `p_languages` is
  -- for guests, who have no profile row to store it in.
  v_languages text[] := coalesce(
    nullif((select p.reading_languages from public.user_profiles p where p.user_id = v_uid), array[]::text[]),
    (
      select array_agg(distinct lang order by lang)
      from unnest(coalesce(p_languages, array[]::text[])) raw
      cross join lateral (select lower(btrim(split_part(raw, '-', 1))) as lang) normalised
      where lang in ('en', 'ru')
    )
  );
  -- What the reader asked for this pause ("Что почитать"): checked facets.
  v_facets jsonb := public.boks_reading_request_facets(p_facets);
  v_prefer jsonb := public.boks_reading_request_facets(p_prefer);
begin
  -- The same hourly ceiling `record_served_feed` enforces, checked before the
  -- expensive part rather than after it. A caller past it gets an empty set,
  -- which the feed service serves as an empty slate - nothing a reader at a
  -- human pace will ever meet.
  if v_uid is not null and (
    select count(*)
    from public.served_feed f
    where f.user_id = v_uid and f.served_at > now() - interval '1 hour'
  ) >= 300 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with published as (
      -- The language filter lives here, in retrieval, so the ranker cannot
      -- score a piece the reader could not read - and so the
      -- catalogue-headroom figures count only what was ever eligible.
      --
      -- A reader who named no language sees everything, `und` included. A
      -- reader who narrowed sees only what they named: an undetermined piece
      -- is not evidence that they can read it.
      select r.* from public.boks_reels r
      where r.status = 'published'
        and (
          v_languages is null
          or cardinality(v_languages) = 0
          or coalesce(r.language, 'und') = any (v_languages)
        )
        -- The reader's strict conditions (form, author group) are retrieval
        -- too: filtering after the limit would answer "nothing" while matches
        -- sit further down the catalogue. The bok on screen is left out, so
        -- applying a request always moves on to another one.
        and (p_exclude is null or r.id <> p_exclude)
        and public.boks_bok_matches_facets(r.id, v_facets)
    ),
    newest as (
      select p.* from published p order by p.created_at desc limit v_recent
    ),
    sampled as (
      -- The rest of the catalogue, drawn at random, so that nothing is
      -- permanently out of reach. `order by random()` is affordable here: the
      -- table is thousands of rows and this runs once per feed load.
      select p.* from published p
      where not exists (select 1 from newest n where n.id = p.id)
      -- A preferred facet (the mood) is soft: it never removes a bok, but
      -- matching ones are drawn first, so the ranker has them to put first.
      order by (v_prefer is not null and public.boks_bok_matches_facets(p.id, v_prefer)) desc, random()
      limit greatest(0, v_limit - v_recent)
    ),
    recent_reels as (
      select * from newest
      union all
      select * from sampled
    ),
    event_rollup as (
      select
        e.reel_id,
        count(*) filter (where e.event_type = 'impression')::integer as impressions,
        count(*) filter (where e.event_type = 'start')::integer as starts,
        count(*) filter (where e.event_type = 'complete')::integer as completes,
        count(*) filter (where e.event_type = 'skip')::integer as skips,
        count(*) filter (where e.event_type = 'share')::integer as shares,
        coalesce(sum(e.value) filter (where e.event_type = 'complete'), 0)::numeric as read_seconds_total
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where e.created_at >= v_since
        and e.event_type in ('impression', 'start', 'complete', 'skip', 'share')
      group by e.reel_id
    ),
    like_rollup as (
      select l.reel_id, count(*)::integer as likes
      from public.likes l
      join recent_reels rr on rr.id = l.reel_id
      group by l.reel_id
    ),
    comment_rollup as (
      select c.reel_id, count(*)::integer as comments
      from public.comments c
      join recent_reels rr on rr.id = c.reel_id
      group by c.reel_id
    ),
    author_stats as (
      select
        r.author_user_id,
        count(*)::integer as published,
        (
          select count(*)::integer from public.author_follows f
          where f.author_user_id = r.author_user_id
        ) as followers
      from public.boks_reels r
      where r.status = 'published' and r.author_user_id is not null
      group by r.author_user_id
    ),
    -- The reader's own history with each boks, per (session, boks) so a reader
    -- who returns across sessions accumulates exposure rather than overwriting.
    -- The reader's taste vector: the mean embedding of what they liked or
    -- finished, a like counted twice because it is the only thing a reader
    -- says out loud. Null until they have done either to an embedded bok, and
    -- a null similarity contributes nothing rather than guessing.
    my_taste as (
      select avg(sample.embedding) as embedding, count(*)::integer as samples
      from (
        select re.embedding
        from public.likes l
        join public.reels re on re.id = l.reel_id
        where v_uid is not null and l.user_id = v_uid and re.embedding is not null
          and re.embedding_model = public.boks_embedding_model()
        union all
        select re.embedding
        from public.likes l
        join public.reels re on re.id = l.reel_id
        where v_uid is not null and l.user_id = v_uid and re.embedding is not null
          and re.embedding_model = public.boks_embedding_model()
        union all
        select re.embedding
        from public.recommendation_events e
        join public.reels re on re.id = e.reel_id
        where v_uid is not null and e.user_id = v_uid and e.event_type = 'complete'
          and e.created_at >= v_since and re.embedding is not null
          and re.embedding_model = public.boks_embedding_model()
      ) sample
    ),
    -- What this reader has been reading lately, which is what novelty is
    -- measured against. Deliberately short: a rut is recent by definition.
    my_recent as (
      select avg(re.embedding) as embedding
      from (
        -- The 24 most recent distinct boks this reader started or finished.
        -- Counted in events, heartbeats made "the last 24" one or two boks.
        select e.reel_id
        from public.recommendation_events e
        where v_uid is not null and e.user_id = v_uid and e.surface = 'reader'
          and e.event_type in ('start', 'complete')
        group by e.reel_id
        order by max(e.created_at) desc
        limit 24
      ) recent
      join public.reels re on re.id = recent.reel_id
      where re.embedding is not null
        and re.embedding_model = public.boks_embedding_model()
    ),
    my_sessions as (
      select
        e.reel_id,
        e.session_id,
        max(e.active_seconds) as dwell_seconds,
        max(e.progress) as progress,
        bool_or(e.event_type = 'skip') as skipped,
        max(e.created_at) as last_event_at,
        count(*)::integer as events
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where v_uid is not null and e.user_id = v_uid and e.surface = 'reader'
      group by e.reel_id, e.session_id
    ),
    my_state as (
      select
        s.reel_id,
        count(*)::integer as seen_count,
        -- A quick skip is a skip that never became reading. It is the closest
        -- honest equivalent of the original's explicit QUICK_SKIP event.
        count(*) filter (where s.skipped and s.dwell_seconds < 5)::integer as quick_skip_count,
        coalesce(sum(s.dwell_seconds), 0)::numeric as total_dwell_seconds,
        coalesce(max(s.progress), 0)::numeric as max_progress,
        coalesce(sum(s.events), 0)::integer as event_count,
        max(s.last_event_at) as last_event_at
      from my_sessions s
      group by s.reel_id
    ),
    my_completions as (
      select e.reel_id, min(e.created_at) as completed_at
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where v_uid is not null and e.user_id = v_uid and e.event_type = 'complete'
      group by e.reel_id
    )
    select jsonb_agg(jsonb_build_object(
      'id', r.id::text,
      'title', r.title,
      'authorName', r.author_name,
      'authorHandle', r.author_handle,
      'authorUserId', coalesce(r.author_user_id::text, ''),
      'hook', r.hook,
      'summary', re.summary,
      'coverVersion', re.cover_version,
      'facets', coalesce(bf.facets, '{}'::jsonb),
      'body', r.text,
      'genre', r.genre,
      'mood', r.mood,
      'language', coalesce(r.language, 'und'),
      'minutes', r.minutes,
      'wordCount', coalesce(r.word_count, 0),
      'readingShape', r.reading_shape,
      'lineBreakCount', coalesce(r.line_break_count, 0),
      'createdAt', r.created_at,
      'impressions', coalesce(er.impressions, 0),
      'starts', coalesce(er.starts, 0),
      'completes', coalesce(er.completes, 0),
      'skips', coalesce(er.skips, 0),
      'likes', coalesce(lr.likes, 0),
      'shares', coalesce(er.shares, 0),
      'comments', coalesce(cr.comments, 0),
      'readSecondsTotal', coalesce(er.read_seconds_total, 0),
      'authorPublishedCount', coalesce(ast.published, 0),
      'authorFollowers', coalesce(ast.followers, 0),
      'hasEmbedding', (re.embedding is not null and re.embedding_model is not distinct from public.boks_embedding_model()),
      'tasteSamples', coalesce(mt.samples, 0),
      'tasteSimilarity', case
        when re.embedding is not null and re.embedding_model = public.boks_embedding_model()
          and mt.embedding is not null
          then round((1 - (re.embedding <=> mt.embedding))::numeric, 4)
        else null
      end,
      'noveltyDistance', case
        when re.embedding is not null and re.embedding_model = public.boks_embedding_model()
          and mr.embedding is not null
          then round(((re.embedding <=> mr.embedding) / 2)::numeric, 4)
        else null
      end,
      'followingAuthor', r.author_user_id is not null and exists (
        select 1 from public.author_follows f
        where f.follower_user_id = v_uid and f.author_user_id = r.author_user_id
      ),
      'mine', jsonb_build_object(
        'seenCount', coalesce(ms.seen_count, 0),
        'quickSkipCount', coalesce(ms.quick_skip_count, 0),
        'totalDwellSeconds', round(coalesce(ms.total_dwell_seconds, 0))::integer,
        'maxProgress', round(coalesce(ms.max_progress, 0), 3),
        'eventCount', coalesce(ms.event_count, 0),
        'lastEventAt', ms.last_event_at,
        'completedAt', mc.completed_at,
        'liked', exists (
          select 1 from public.likes l where l.reel_id = r.id and l.user_id = v_uid
        ),
        'commented', exists (
          select 1 from public.comments c where c.reel_id = r.id and c.user_id = v_uid
        )
      )
    ) order by r.created_at desc)
    from recent_reels r
    join public.reels re on re.id = r.id
    cross join my_taste mt
    cross join my_recent mr
    left join event_rollup er on er.reel_id = r.id
    left join like_rollup lr on lr.reel_id = r.id
    left join comment_rollup cr on cr.reel_id = r.id
    left join author_stats ast on ast.author_user_id = r.author_user_id
    left join my_state ms on ms.reel_id = r.id
    left join my_completions mc on mc.reel_id = r.id
    left join public.bok_reading_facets bf on bf.bok_id = r.id
  ), '[]'::jsonb);
end;
$function$;

-- ------------------------------------------------------------------ the author's public page

-- As in 20261114100000_boks_author_spaces.sql, with each bok's cover version.
create or replace function public.get_boks_author(
  p_handle text,
  p_author_name text default null,
  p_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_handle text := lower(btrim(ltrim(coalesce(p_handle, ''), '@')));
  v_byline text := nullif(btrim(coalesce(p_author_name, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_author_user_id uuid;
  v_handle_name text;
  v_total integer;
  v_space public.author_spaces;
begin
  if v_handle = '' then
    return null;
  end if;

  select i.user_id, i.handle
  into v_author_user_id, v_handle_name
  from public.boks_public_identity i
  where lower(i.handle) = v_handle;

  -- A classic's page the team runs: its own handle, its own followers.
  if v_author_user_id is null and v_byline is null then
    select * into v_space from public.author_spaces s
    where s.kind = 'editorial' and s.status = 'published' and lower(s.handle) = v_handle;
    if v_space.id is not null then
      return (
        with listed as (
          select x.bok_id, x.sort_position as position, x.created_at from public.boks_space_public_boks(v_space) x
        ),
        page as (
          select b.*, l.position from listed l join public.published_boks b on b.id = l.bok_id
          order by l.position nulls last, l.created_at desc, b.id
          limit v_limit
        )
        select jsonb_build_object(
          'authorUserId', '',
          'pageId', v_space.id::text,
          'pageKind', 'editorial',
          'authorName', coalesce(v_space.name, v_space.handle),
          'authorHandle', v_space.handle,
          'byline', null,
          'totalBoks', (select count(*)::integer from listed),
          'followers', (select count(*)::integer from public.author_space_follows f where f.space_id = v_space.id),
          'following', exists (select 1 from public.author_space_follows f where f.space_id = v_space.id and f.follower_user_id = v_uid),
          'writers', '[]'::jsonb,
          'boks', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', b.id::text, 'title', b.title, 'coverVersion', b.cover_version, 'hook', b.hook, 'minutes', b.minutes,
              'readingShape', b.reading_shape, 'authorName', b.author_name, 'createdAt', b.created_at
            ) || coalesce(public.boks_space_bok_format(v_space.id, b.id), '{}'::jsonb)
            order by b.position nulls last, b.created_at desc, b.id)
            from page b
          ), '[]'::jsonb)
        )
      );
    end if;
  end if;

  if v_author_user_id is null then
    select b.author_name into v_handle_name
    from public.published_boks b
    where lower(b.author_handle) = v_handle
    limit 1;
  end if;

  if v_handle_name is null then
    return null;
  end if;

  if v_author_user_id is not null then
    select * into v_space from public.author_spaces s
    where s.owner_user_id = v_author_user_id and s.status <> 'merged';
  end if;

  select count(*) into v_total
  from public.published_boks b
  where lower(b.author_handle) = v_handle
    and (v_byline is null or b.author_name = v_byline);

  if v_byline is not null and v_total = 0 then
    return null;
  end if;

  return jsonb_build_object(
    'authorUserId', coalesce(v_author_user_id::text, ''),
    'authorName', coalesce(v_byline, v_handle_name),
    'authorHandle', v_handle,
    'byline', v_byline,
    'totalBoks', v_total,
    'followers', (
      select count(*)::integer from public.author_follows f
      where v_author_user_id is not null and f.author_user_id = v_author_user_id
    ),
    'following', v_author_user_id is not null and exists (
      select 1 from public.author_follows f
      where f.author_user_id = v_author_user_id and f.follower_user_id = v_uid
    ),
    'writers', case
      when v_byline is not null then '[]'::jsonb
      else coalesce((
        select jsonb_agg(w order by w ->> 'name')
        from (
          select jsonb_build_object('name', b.author_name, 'boks', count(*)::integer) as w
          from public.published_boks b
          where lower(b.author_handle) = v_handle and b.author_name is not null
          group by b.author_name
          having count(*) > 0
        ) writers
      ), '[]'::jsonb)
    end,
    'boks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id::text,
        'title', b.title,
        'coverVersion', b.cover_version,
        'hook', b.hook,
        'minutes', b.minutes,
        'readingShape', b.reading_shape,
        'authorName', b.author_name,
        'createdAt', b.created_at
      ) || case when v_space.id is null then '{}'::jsonb else coalesce(public.boks_space_bok_format(v_space.id, b.id), '{}'::jsonb) end
      order by b.position nulls last, b.created_at desc, b.id)
      from (
        select b.*, o.position
        from public.published_boks b
        left join public.author_space_order o on o.space_id = v_space.id and o.bok_id = b.id
        where lower(b.author_handle) = v_handle
          and (v_byline is null or b.author_name = v_byline)
        order by o.position nulls last, b.created_at desc, b.id
        limit v_limit
      ) b
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------------ grants

revoke all on function public.boks_cover_pictures_per_piece() from public, anon, authenticated;
revoke all on function public.boks_cover_pictures_per_day() from public, anon, authenticated;
revoke all on function public.boks_publishes_directly(uuid) from public, anon, authenticated;
revoke all on function public.boks_cover_drawings_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_my_publishing(uuid) from public, anon, authenticated;
revoke all on function public.boks_space_verified_by_team() from public, anon, authenticated;
revoke all on function public.studio_space_verified(uuid) from public, anon, authenticated;
revoke all on function public.studio_set_space_verified(uuid, boolean) from public, anon, authenticated;
revoke all on function public.boks_bok_goes_out_with_a_cover() from public, anon, authenticated;
revoke all on function public.studio_cover_requests() from public, anon, authenticated;
revoke all on function public.studio_bok_cover(uuid) from public, anon, authenticated;
revoke all on function public.studio_set_bok_cover(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_my_cover_drawing(uuid, integer) from public, anon, authenticated;
revoke all on function public.save_my_bok(uuid, text, text, boolean, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.get_my_bok_draft(uuid) from public, anon, authenticated;
revoke all on function public.delete_my_draft(uuid) from public, anon, authenticated;
revoke all on function public.get_boks_cover(uuid, text) from public, anon, authenticated;
revoke all on function public.get_my_author_space() from public, anon, authenticated;
revoke all on function public.get_recommendation_candidates(integer, text[], jsonb, jsonb, uuid) from public;

grant execute on function public.get_my_publishing(uuid) to authenticated;
grant execute on function public.studio_space_verified(uuid) to authenticated;
grant execute on function public.studio_set_space_verified(uuid, boolean) to authenticated;
grant execute on function public.studio_cover_requests() to authenticated;
grant execute on function public.studio_bok_cover(uuid) to authenticated;
grant execute on function public.studio_set_bok_cover(uuid, jsonb) to authenticated;
grant execute on function public.reserve_my_cover_drawing(uuid, integer) to authenticated;
grant execute on function public.save_my_bok(uuid, text, text, boolean, jsonb, boolean) to authenticated;
grant execute on function public.get_my_bok_draft(uuid) to authenticated;
grant execute on function public.delete_my_draft(uuid) to authenticated;
grant execute on function public.get_boks_cover(uuid, text) to anon, authenticated;
grant execute on function public.get_my_author_space() to authenticated;
grant execute on function public.get_recommendation_candidates(integer, text[], jsonb, jsonb, uuid) to anon, authenticated, service_role;
