-- boks: author pages prepared in Studio, handed over by invitation, published
-- by their owner; editorial pages for classics; one order for a page's works
--
-- Until now an author page existed only as a side effect of an account: its
-- @handle (`user_profiles`), the name and photo the author set
-- (`author_pages`, 20261110100000) and whatever the account had published.
-- The team now prepares pages before the author has an account, and runs
-- pages for classics that never will have one (`/@pushkin`). Both need a
-- stable identity of their own, so this migration adds one: an **author
-- space**.
--
--   * `author_spaces` - one page. `kind = 'author'` is a living author's page,
--     prepared by the team and then owned by the author's account
--     (`owner_user_id`, one main page per account). `kind = 'editorial'` is a
--     page the team runs for a classic: it has its own public `handle` and is
--     followed through `author_space_follows`, not through an account.
--   * `author_space_works` - what a page is prepared with: a new text, or a
--     version (text or Series) attached to a bok that already exists. A work
--     carries a `revision` that grows with every edit, so a publication can
--     prove it published exactly what the author previewed.
--   * `author_space_invites` - the handover. Only a SHA-256 of the token is
--     kept; the email is compared with the signed-in account's own address.
--   * `author_space_publications` - the record of every publication: who,
--     which works at which revisions, under which terms version or editorial
--     basis. Its key is the client's request id, so a second press of the
--     same button returns the first answer instead of publishing twice.
--   * `author_space_order` - the page's one order of published boks; drafts
--     keep theirs in `author_space_works.position`.
--
-- Nothing here changes what readers already see. A page stays closed until
-- its owner (or, for a classic, the team) publishes it; a work stays out of
-- every public answer until it is published; existing pages keep their
-- order (newest first) until their author saves another; existing follows
-- (`author_follows`) are untouched. Every table is reached only through the
-- functions below: no Data API grants.
--
-- The static Series productions registered in the app stay as they are. A
-- Series *version* here attaches to a bok whose production is registered;
-- publishing it is what lets the author page show it as Series. Private,
-- runtime-served productions are the next step (`docs/project-state.md`).

-- ------------------------------------------------------------------ tables

create table if not exists public.author_spaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('author', 'editorial')),
  -- draft: closed, visible to the team and the owner. published: public.
  -- unpublished: taken down after being public. merged: an invitation joined
  -- it into the author's existing page; kept as the record of what was sent.
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished', 'merged')),
  -- editorial: the public handle. author: the proposed handle, until the
  -- author accepts; from then on the account's own @handle is the address.
  handle text check (handle is null or handle ~ '^[a-z][a-z0-9_]{2,23}$'),
  name text check (name is null or (char_length(name) between 1 and 60 and name !~ '[<>[:cntrl:]]')),
  photo bytea check (photo is null or (octet_length(photo) between 100 and 700000 and substring(photo from 1 for 3) = '\xffd8ff'::bytea)),
  photo_version integer not null default 0,
  -- The link preview card (1200x630), a file in a link-only folder. Held by
  -- the page, not by its address, so it follows the author through a rename.
  share_card text check (share_card is null or share_card ~ '^/l/[A-Za-z0-9_-]{22,64}/f/[a-z0-9][a-z0-9-]{0,80}-share\.(jpg|webp|gif)$'),
  -- Its moving version (og:video, 960x504 MP4), played by Telegram and a few others.
  share_video text check (share_video is null or share_video ~ '^/l/[A-Za-z0-9_-]{22,64}/f/[a-z0-9][a-z0-9-]{0,80}-share\.mp4$'),
  -- When each side last read the page's messages.
  author_seen_at timestamptz,
  editor_seen_at timestamptz,
  owner_user_id uuid references auth.users (id) on delete set null,
  merged_into uuid references public.author_spaces (id) on delete set null,
  -- editorial pages: why the team may publish it, and where the texts come from.
  rights_basis text check (rights_basis is null or char_length(rights_basis) <= 200),
  rights_source text check (rights_source is null or char_length(rights_source) <= 500),
  version integer not null default 1,
  order_version integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create unique index if not exists author_spaces_handle_idx
  on public.author_spaces (lower(handle))
  where handle is not null and status <> 'merged';
create unique index if not exists author_spaces_owner_idx
  on public.author_spaces (owner_user_id)
  where owner_user_id is not null and status <> 'merged';

create table if not exists public.author_space_works (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.author_spaces (id) on delete cascade,
  position integer,
  title text not null check (char_length(title) between 1 and 200),
  -- A new text. Empty for a version attached to an existing bok.
  body text,
  format text not null check (format in ('text', 'series')),
  -- The bok this work is, once it exists: attached by the team, or created
  -- when a new text is published.
  bok_id uuid references public.reels (id) on delete set null,
  status text not null default 'preparing'
    check (status in ('preparing', 'ready', 'changes_requested', 'published', 'withdrawn')),
  revision integer not null default 1,
  published_revision integer,
  -- A Series version on a published text: whether readers see it as Series.
  series_published boolean not null default false,
  -- A Series made for a new text before it is a bok: the token of its
  -- link-only folder (`docs/link-only-pieces.md`). Shown to the team and the
  -- owner only. Publishing the text does not release it: the team registers
  -- the piece against the new bok and then marks it live (`series_published`).
  series_piece text check (series_piece is null or series_piece ~ '^[A-Za-z0-9_-]{22,64}$'),
  -- The author's request for changes.
  note text check (note is null or char_length(note) <= 1000),
  -- The team's confirmation that text, files and rights were checked.
  rights_note text check (rights_note is null or char_length(rights_note) <= 500),
  ready_by uuid references auth.users (id) on delete set null,
  ready_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint author_space_works_series_needs_bok check (format = 'text' or bok_id is not null),
  constraint author_space_works_text_has_body check (bok_id is not null or nullif(btrim(coalesce(body, '')), '') is not null)
);

create index if not exists author_space_works_space_idx on public.author_space_works (space_id, position);
create unique index if not exists author_space_works_bok_idx
  on public.author_space_works (space_id, bok_id) where bok_id is not null;
create index if not exists author_space_works_bok_lookup_idx
  on public.author_space_works (bok_id) where bok_id is not null;

create table if not exists public.author_space_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.author_spaces (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  token_hash bytea not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  -- Why the last attempt to accept stopped, for the editor ('handle_taken').
  problem text
);

create index if not exists author_space_invites_space_idx on public.author_space_invites (space_id, created_at desc);

create table if not exists public.author_space_publications (
  request_id uuid primary key,
  space_id uuid not null references public.author_spaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  basis text not null check (basis in ('owner_terms', 'editorial')),
  terms_version text,
  rights_basis text,
  rights_source text,
  items jsonb not null default '[]'::jsonb,
  page_published boolean not null default false,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists author_space_publications_space_idx on public.author_space_publications (space_id, created_at desc);

create table if not exists public.author_space_order (
  space_id uuid not null references public.author_spaces (id) on delete cascade,
  bok_id uuid not null references public.reels (id) on delete cascade,
  position integer not null,
  primary key (space_id, bok_id)
);

create table if not exists public.author_space_follows (
  follower_user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references public.author_spaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_user_id, space_id)
);

create index if not exists author_space_follows_space_idx on public.author_space_follows (space_id);

alter table public.author_spaces enable row level security;
alter table public.author_space_works enable row level security;
alter table public.author_space_invites enable row level security;
alter table public.author_space_publications enable row level security;
alter table public.author_space_order enable row level security;
alter table public.author_space_follows enable row level security;
revoke all on public.author_spaces, public.author_space_works, public.author_space_invites,
  public.author_space_publications, public.author_space_order, public.author_space_follows
  from public, anon, authenticated;

comment on table public.author_spaces is
  'An author page with an identity of its own: prepared in Studio before the author has an account (kind author), or run by the team for a classic (kind editorial). Reached only through the author-space functions.';
comment on table public.author_space_invites is
  'Handover of a prepared page to an email address. Only a SHA-256 of the token is stored.';
comment on table public.author_space_publications is
  'Every publication of prepared works: actor, works and revisions, terms version or editorial basis. Keyed by the client request id, so a repeated press is answered, not repeated.';

-- The page's conversation: the author's notes on the design or on a work,
-- and the team's answers, including "the changes are made".
create table if not exists public.author_space_messages (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.author_spaces (id) on delete cascade,
  work_id uuid references public.author_space_works (id) on delete set null,
  from_author boolean not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.author_space_messages enable row level security;
revoke all on public.author_space_messages from public, anon, authenticated;
create index if not exists author_space_messages_space_idx on public.author_space_messages (space_id, created_at);

-- --------------------------------------------- reserved handles stay reserved

-- An editorial page's handle, and the handle proposed for a prepared page,
-- cannot be taken by an account. A handle generated at sign-up steps aside
-- with a number; one a person types in settings is refused.
create or replace function public.boks_handle_reserved_by_space(p_handle text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.author_spaces s
    where s.handle is not null and s.status <> 'merged'
      and lower(s.handle) = lower(btrim(coalesce(p_handle, '')))
  );
$$;
revoke all on function public.boks_handle_reserved_by_space(text) from public, anon, authenticated;

-- An author's earlier addresses. Links already shared keep finding the page
-- after a rename, and nobody else can take one of them; the author may take
-- an old address back.
create table if not exists public.author_handle_moves (
  handle text primary key check (handle = lower(handle)),
  user_id uuid not null references auth.users (id) on delete cascade,
  moved_at timestamptz not null default now()
);
alter table public.author_handle_moves enable row level security;
revoke all on public.author_handle_moves from public, anon, authenticated;
create index if not exists author_handle_moves_user_idx on public.author_handle_moves (user_id);

create or replace function public.boks_handle_moved_from(p_handle text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.author_handle_moves m
    where m.handle = lower(btrim(coalesce(p_handle, ''))) and m.user_id is distinct from p_user_id
  );
$$;
revoke all on function public.boks_handle_moved_from(text, uuid) from public, anon, authenticated;

create or replace function public.boks_guard_reserved_handle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.handle is null or (tg_op = 'UPDATE' and new.handle is not distinct from old.handle) then
    return new;
  end if;
  -- The page's own author taking its handle is the point of reserving it.
  if current_setting('boks.claiming_space_handle', true) = new.handle then
    return new;
  end if;
  if public.boks_handle_reserved_by_space(new.handle) or public.boks_handle_moved_from(new.handle, new.user_id) then
    if tg_op = 'INSERT' then
      new.handle := left(new.handle, 19) || (1000 + floor(random() * 8999))::integer::text;
    else
      raise exception 'That nickname is already taken.' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.boks_guard_reserved_handle() from public, anon, authenticated;

drop trigger if exists user_profiles_reserved_handle on public.user_profiles;
create trigger user_profiles_reserved_handle
  before insert or update of handle on public.user_profiles
  for each row execute function public.boks_guard_reserved_handle();

-- The owner of a page renames: remember where the page was.
create or replace function public.boks_record_handle_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.handle is null or new.handle is null or lower(old.handle) = lower(new.handle) then
    return new;
  end if;
  if not exists (
    select 1 from public.author_spaces s
    where s.owner_user_id = new.user_id and s.status <> 'merged'
  ) then
    return new;
  end if;
  insert into public.author_handle_moves (handle, user_id)
  values (lower(old.handle), new.user_id)
  on conflict (handle) do update set moved_at = now()
    where public.author_handle_moves.user_id = excluded.user_id;
  -- Taking an old address back makes it current again.
  delete from public.author_handle_moves m where m.handle = lower(new.handle) and m.user_id = new.user_id;
  return new;
end;
$$;
revoke all on function public.boks_record_handle_move() from public, anon, authenticated;

drop trigger if exists user_profiles_record_handle_move on public.user_profiles;
create trigger user_profiles_record_handle_move
  after update of handle on public.user_profiles
  for each row execute function public.boks_record_handle_move();

-- Where an earlier address of a published page leads now; null for any
-- address that is current or was never a page's.
create or replace function public.get_boks_author_moved(p_handle text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.handle
  from public.author_handle_moves m
  join public.user_profiles p on p.user_id = m.user_id
  where m.handle = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
    and p.banned_at is null
    and not exists (select 1 from public.user_profiles c where lower(c.handle) = m.handle)
    and exists (
      select 1 from public.author_spaces s
      where s.owner_user_id = m.user_id and s.status = 'published'
    );
$$;

-- ------------------------------------------------------------------ helpers

create or replace function public.boks_space_access(p_space_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- 'editor', 'owner' or null. A guest session is `authenticated` too, so the
  -- owner must also be a permanent account.
  select case
    when (select auth.uid()) is null then null
    when public.is_boks_admin((select auth.uid())) then 'editor'
    when coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then null
    when exists (
      select 1 from public.author_spaces s
      where s.id = p_space_id and s.owner_user_id = (select auth.uid()) and s.status <> 'merged'
    ) and not public.is_boks_user_blocked((select auth.uid())) then 'owner'
    else null
  end;
$$;
revoke all on function public.boks_space_access(uuid) from public, anon, authenticated;

create or replace function public.boks_require_editor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.is_boks_admin(v_uid) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function public.boks_require_editor() from public, anon, authenticated;

-- The handle a space is addressed by: its own (editorial, or proposed), or
-- its owner's @handle once the author has accepted.
create or replace function public.boks_space_handle(p_space public.author_spaces)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.handle from public.user_profiles p where p.user_id = p_space.owner_user_id),
    p_space.handle
  );
$$;
revoke all on function public.boks_space_handle(public.author_spaces) from public, anon, authenticated;

create or replace function public.boks_mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(p_email, 1) || '•••@' || split_part(p_email, '@', 2)
  end;
$$;
revoke all on function public.boks_mask_email(text) from public, anon, authenticated;

create or replace function public.boks_invite_state(p_invite public.author_space_invites)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_invite.accepted_at is not null then 'accepted'
    when p_invite.revoked_at is not null then 'revoked'
    when p_invite.expires_at <= now() then 'expired'
    else 'pending'
  end;
$$;
revoke all on function public.boks_invite_state(public.author_space_invites) from public, anon, authenticated;

-- One work, as both Studio and the cabinet show it.
create or replace function public.boks_space_work_json(p_work public.author_space_works, p_with_body boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_work.id::text,
    'position', p_work.position,
    'title', p_work.title,
    'format', p_work.format,
    'status', p_work.status,
    'revision', p_work.revision,
    'publishedRevision', p_work.published_revision,
    'seriesPublished', p_work.series_published,
    'seriesPiece', p_work.series_piece,
    'note', p_work.note,
    'rightsNote', p_work.rights_note,
    'readyAt', p_work.ready_at,
    'publishedAt', p_work.published_at,
    'updatedAt', p_work.updated_at,
    'bokId', p_work.bok_id::text,
    'bokTitle', r.title,
    'bokStatus', r.status,
    'characters', char_length(coalesce(p_work.body, r.text, '')),
    'body', case when p_with_body then coalesce(p_work.body, r.text) else null end
  )
  from (select 1) one
  left join public.reels r on r.id = p_work.bok_id;
$$;
revoke all on function public.boks_space_work_json(public.author_space_works, boolean) from public, anon, authenticated;

create or replace function public.boks_space_messages_json(p_space_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id::text,
    'fromAuthor', m.from_author,
    'body', m.body,
    'workId', m.work_id::text,
    'workTitle', w.title,
    'createdAt', m.created_at
  ) order by m.created_at, m.id), '[]'::jsonb)
  from public.author_space_messages m
  left join public.author_space_works w on w.id = m.work_id
  where m.space_id = p_space_id;
$$;
revoke all on function public.boks_space_messages_json(uuid) from public, anon, authenticated;

-- A page's published boks in the page's order, as the public author page and
-- the cabinet list them. Sorted here, before any limit, so a long page is
-- paged in its own order.
create or replace function public.boks_space_public_boks(p_space public.author_spaces)
returns table (bok_id uuid, sort_position integer, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, o.position, b.created_at
  from public.published_boks b
  left join public.author_space_order o on o.space_id = p_space.id and o.bok_id = b.id
  where (
      p_space.kind = 'author'
      and p_space.owner_user_id is not null
      and b.author_user_id = p_space.owner_user_id
    ) or (
      p_space.kind = 'editorial'
      and exists (
        select 1 from public.author_space_works w
        where w.space_id = p_space.id and w.bok_id = b.id and w.status = 'published'
      )
    );
$$;
revoke all on function public.boks_space_public_boks(public.author_spaces) from public, anon, authenticated;

-- How a bok shows on its page: Series once a Series version of it is
-- published there; held while one is attached and not yet published.
create or replace function public.boks_space_bok_format(p_space_id uuid, p_bok_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'format', case when bool_or(
        (w.format = 'series' and (w.series_published or w.status = 'published'))
        or (w.series_piece is not null and w.series_published)
      ) then 'series' else 'text' end,
    'seriesHeld', coalesce(bool_or(
        (w.format = 'series' and not w.series_published and w.status <> 'published')
        or (w.series_piece is not null and not w.series_published)
      ), false)
  )
  from public.author_space_works w
  where w.space_id = p_space_id and w.bok_id = p_bok_id and w.status <> 'withdrawn';
$$;
revoke all on function public.boks_space_bok_format(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------- Studio: list

create or replace function public.studio_author_spaces(
  p_query text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.boks_require_editor();

  return (
    with spaces as (
      select s.*, public.boks_space_handle(s) as shown_handle
      from public.author_spaces s
      where s.status <> 'merged'
    ),
    matching as (
      select * from spaces s
      where v_query = ''
        or strpos(lower(coalesce(s.name, '')), v_query) > 0
        or strpos(lower(coalesce(s.shown_handle, '')), ltrim(v_query, '@')) > 0
    ),
    page as (
      select * from matching order by updated_at desc, id limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from matching),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id::text,
          'kind', p.kind,
          'status', p.status,
          'name', p.name,
          'handle', p.shown_handle,
          'owned', p.owner_user_id is not null,
          'photoVersion', case when p.photo is null then null else p.photo_version end,
          'works', (select count(*)::integer from public.author_space_works w where w.space_id = p.id and w.status <> 'withdrawn'),
          'ready', (select count(*)::integer from public.author_space_works w where w.space_id = p.id and w.status = 'ready'),
          'changesRequested', (select count(*)::integer from public.author_space_works w where w.space_id = p.id and w.status = 'changes_requested'),
          'published', (select count(*)::integer from public.author_space_works w where w.space_id = p.id and w.status = 'published'),
          'unread', (select count(*)::integer from public.author_space_messages m
                     where m.space_id = p.id and m.from_author and m.created_at > coalesce(p.editor_seen_at, '-infinity'::timestamptz)),
          'invite', (
            select jsonb_build_object('state', public.boks_invite_state(i), 'expiresAt', i.expires_at, 'problem', i.problem)
            from public.author_space_invites i where i.space_id = p.id
            order by i.created_at desc limit 1
          ),
          'updatedAt', p.updated_at
        ) order by p.updated_at desc, p.id)
        from page p
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ------------------------------------------------------------ Studio: one page

create or replace function public.studio_author_space(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space public.author_spaces;
begin
  perform public.boks_require_editor();
  select * into v_space from public.author_spaces where id = p_space_id;
  if v_space.id is null then
    raise exception 'This page does not exist.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_space.id::text,
    'kind', v_space.kind,
    'status', v_space.status,
    'name', v_space.name,
    'handle', public.boks_space_handle(v_space),
    'proposedHandle', v_space.handle,
    'owned', v_space.owner_user_id is not null,
    'ownerHandle', (select p.handle from public.user_profiles p where p.user_id = v_space.owner_user_id),
    'mergedInto', v_space.merged_into::text,
    'photo', case when v_space.photo is null then null else encode(v_space.photo, 'base64') end,
    'photoVersion', case when v_space.photo is null then null else v_space.photo_version end,
    'rightsBasis', v_space.rights_basis,
    'rightsSource', v_space.rights_source,
    'shareCard', v_space.share_card,
    'shareVideo', v_space.share_video,
    'messages', public.boks_space_messages_json(v_space.id),
    'unread', (select count(*)::integer from public.author_space_messages m
               where m.space_id = v_space.id and m.from_author and m.created_at > coalesce(v_space.editor_seen_at, '-infinity'::timestamptz)),
    'version', v_space.version,
    'orderVersion', v_space.order_version,
    'publishedAt', v_space.published_at,
    'works', coalesce((
      select jsonb_agg(public.boks_space_work_json(w) order by w.position nulls last, w.created_at)
      from public.author_space_works w where w.space_id = v_space.id
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id::text,
        'email', i.email,
        'state', i.state,
        'createdAt', i.created_at,
        'expiresAt', i.expires_at,
        'acceptedAt', i.accepted_at,
        'problem', i.problem
      ) order by i.created_at desc)
      from (
        select inv.*, public.boks_invite_state(inv) as state
        from public.author_space_invites inv
        where inv.space_id = v_space.id
        order by inv.created_at desc
        limit 10
      ) i
    ), '[]'::jsonb),
    'publications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'requestId', x.request_id::text,
        'basis', x.basis,
        'termsVersion', x.terms_version,
        'rightsBasis', x.rights_basis,
        'items', x.items,
        'pagePublished', x.page_published,
        'actorHandle', (select p.handle from public.user_profiles p where p.user_id = x.actor_user_id),
        'createdAt', x.created_at
      ) order by x.created_at desc)
      from (select * from public.author_space_publications where space_id = v_space.id order by created_at desc limit 20) x
    ), '[]'::jsonb)
  );
end;
$$;

-- p_photo: null or 'keep' leaves it, 'remove' takes it off, else base64 JPEG.
create or replace function public.studio_save_author_space(
  p_space_id uuid,
  p_kind text,
  p_name text,
  p_handle text,
  p_photo text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_kind text := lower(btrim(coalesce(p_kind, 'author')));
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_handle text := nullif(lower(btrim(ltrim(btrim(coalesce(p_handle, '')), '@'))), '');
  v_space public.author_spaces;
  v_photo bytea;
begin
  if v_kind not in ('author', 'editorial') then
    raise exception 'Unknown page kind.' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) > 60 or v_name ~ '[<>[:cntrl:]]' then
    raise exception 'The name on the page is required: at most 60 characters, without < or >.' using errcode = '22023';
  end if;

  if p_space_id is not null then
    select * into v_space from public.author_spaces where id = p_space_id for update;
    if v_space.id is null or v_space.status = 'merged' then
      raise exception 'This page does not exist.' using errcode = 'P0002';
    end if;
    if v_space.version <> coalesce(p_version, -1) then
      raise exception 'This page was changed in another tab. Reload to see the latest version.' using errcode = '40001';
    end if;
    v_kind := v_space.kind;
  end if;

  -- Once the author has accepted, the address is their account's @handle;
  -- the team no longer changes it.
  if v_space.owner_user_id is not null then
    v_handle := v_space.handle;
  elsif v_handle is not null then
    if not (v_handle ~ '^[a-z][a-z0-9_]{2,23}$') then
      raise exception 'The page address takes 3 to 24 English letters, digits or _, starting with a letter.' using errcode = '22023';
    end if;
    if exists (select 1 from public.user_profiles p where lower(p.handle) = v_handle)
       or exists (select 1 from public.author_handle_moves m where m.handle = v_handle)
       or exists (
         select 1 from public.author_spaces s
         where lower(s.handle) = v_handle and s.status <> 'merged' and s.id is distinct from v_space.id
       ) then
      raise exception 'The address @% is already taken.', v_handle using errcode = '23505';
    end if;
  elsif v_kind = 'editorial' then
    raise exception 'An editorial page needs its own address.' using errcode = '22023';
  end if;

  if p_photo is null or p_photo = 'keep' then
    v_photo := v_space.photo;
  elsif p_photo = 'remove' then
    v_photo := null;
  else
    begin
      v_photo := decode(p_photo, 'base64');
    exception when others then
      raise exception 'This photo could not be read. Choose another one.' using errcode = '22023';
    end;
    if octet_length(v_photo) > 700000 or substring(v_photo from 1 for 3) <> '\xffd8ff'::bytea then
      raise exception 'This photo could not be read. Choose another one.' using errcode = '22023';
    end if;
  end if;

  if v_space.id is null then
    insert into public.author_spaces (kind, name, handle, photo, photo_version, created_by)
    values (v_kind, v_name, v_handle, v_photo, case when v_photo is null then 0 else 1 end, v_uid)
    returning * into v_space;
  else
    update public.author_spaces
    set name = v_name,
        handle = v_handle,
        photo = v_photo,
        photo_version = case when v_photo is distinct from photo then photo_version + 1 else photo_version end,
        version = version + 1,
        updated_at = now()
    where id = v_space.id
    returning * into v_space;
  end if;

  return public.studio_author_space(v_space.id);
end;
$$;

create or replace function public.studio_save_space_work(
  p_space_id uuid,
  p_work_id uuid,
  p_title text,
  p_body text,
  p_format text,
  p_bok_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_format text := lower(btrim(coalesce(p_format, 'text')));
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_title text := nullif(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_space public.author_spaces;
  v_work public.author_space_works;
  v_bok public.reels;
begin
  select * into v_space from public.author_spaces where id = p_space_id for update;
  if v_space.id is null or v_space.status = 'merged' then
    raise exception 'This page does not exist.' using errcode = 'P0002';
  end if;
  if v_format not in ('text', 'series') then
    raise exception 'A work is a text or a Series.' using errcode = '22023';
  end if;

  if p_bok_id is not null then
    select * into v_bok from public.reels where id = p_bok_id;
    if v_bok.id is null or v_bok.status <> 'published' then
      raise exception 'Only a published bok can be attached.' using errcode = '22023';
    end if;
    -- A living author's page attaches only that author's own boks.
    if v_space.kind = 'author' and v_space.owner_user_id is not null and v_bok.author_user_id is distinct from v_space.owner_user_id then
      raise exception 'This bok belongs to another account.' using errcode = '42501';
    end if;
    v_body := null;
    v_title := coalesce(v_title, v_bok.title);
  elsif v_format = 'series' then
    raise exception 'A Series version is attached to a published bok.' using errcode = '22023';
  elsif v_space.kind = 'editorial' then
    raise exception 'An editorial page shows boks already in the catalogue: attach one.' using errcode = '22023';
  else
    if v_body is null then
      raise exception 'The text is required.' using errcode = '22023';
    end if;
    if char_length(v_body) > public.boks_max_text_characters() then
      raise exception 'A bok must fit inside 15 minutes. This one is % characters; the limit is %.',
        char_length(v_body), public.boks_max_text_characters() using errcode = '22023';
    end if;
    v_title := coalesce(v_title, public.boks_title_from_text(v_body));
  end if;

  if v_title is null or char_length(v_title) > 200 then
    raise exception 'The title is required, at most 200 characters.' using errcode = '22023';
  end if;

  if p_work_id is null then
    insert into public.author_space_works (space_id, position, title, body, format, bok_id)
    values (
      v_space.id,
      coalesce((select max(w.position) from public.author_space_works w where w.space_id = v_space.id), 0) + 1,
      v_title, v_body, v_format, p_bok_id
    )
    returning * into v_work;
  else
    select * into v_work from public.author_space_works where id = p_work_id and space_id = v_space.id for update;
    if v_work.id is null then
      raise exception 'This work does not exist.' using errcode = 'P0002';
    end if;
    if v_work.status = 'published' and (v_work.format <> v_format or v_work.bok_id is distinct from p_bok_id or (v_work.bok_id is null and v_work.body is distinct from v_body)) then
      raise exception 'A published work is changed through its bok; withdraw it first.' using errcode = '22023';
    end if;
    -- Any change is a new revision and needs to be checked again.
    update public.author_space_works
    set title = v_title,
        body = v_body,
        format = v_format,
        bok_id = p_bok_id,
        revision = case when (title, coalesce(body, ''), format, bok_id) is distinct from (v_title, coalesce(v_body, ''), v_format, p_bok_id) then revision + 1 else revision end,
        status = case
          when status = 'published' then status
          when (title, coalesce(body, ''), format, bok_id) is distinct from (v_title, coalesce(v_body, ''), v_format, p_bok_id) then 'preparing'
          else status
        end,
        updated_at = now()
    where id = v_work.id
    returning * into v_work;
  end if;

  update public.author_spaces set updated_at = now() where id = v_space.id;
  return public.studio_author_space(v_space.id);
end;
$$;

create or replace function public.studio_set_space_work_status(
  p_work_id uuid,
  p_status text,
  p_rights_note text default '',
  p_reply text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_work public.author_space_works;
begin
  if v_status not in ('preparing', 'ready') then
    raise exception 'A work is marked ready, or back in preparation.' using errcode = '22023';
  end if;
  select * into v_work from public.author_space_works where id = p_work_id for update;
  if v_work.id is null or v_work.status in ('published', 'withdrawn') then
    raise exception 'This work cannot change state now.' using errcode = '22023';
  end if;
  if v_status = 'ready' and nullif(btrim(coalesce(p_rights_note, '')), '') is null then
    raise exception 'Say what was checked: text, format, files and rights.' using errcode = '22023';
  end if;

  -- The author asked for changes and they are done: tell them, in the page's
  -- conversation, with the team's own words when given.
  if v_status = 'ready' and v_work.status = 'changes_requested' then
    insert into public.author_space_messages (space_id, work_id, from_author, body, created_by)
    values (v_work.space_id, v_work.id, false,
      coalesce(nullif(btrim(coalesce(p_reply, '')), ''), 'Правки внесены. Посмотрите новую версию: если всё так, её можно публиковать.'),
      v_uid);
  end if;

  update public.author_space_works
  set status = v_status,
      rights_note = case when v_status = 'ready' then left(btrim(p_rights_note), 500) else rights_note end,
      ready_by = case when v_status = 'ready' then v_uid else null end,
      ready_at = case when v_status = 'ready' then now() else null end,
      note = case when v_status = 'ready' then null else note end,
      updated_at = now()
  where id = v_work.id;

  return public.studio_author_space(v_work.space_id);
end;
$$;

create or replace function public.studio_remove_space_work(p_work_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.author_space_works;
begin
  perform public.boks_require_editor();
  select * into v_work from public.author_space_works where id = p_work_id for update;
  if v_work.id is null then
    raise exception 'This work does not exist.' using errcode = 'P0002';
  end if;
  if v_work.status = 'published' then
    raise exception 'A published work is withdrawn, not removed.' using errcode = '22023';
  end if;
  delete from public.author_space_works where id = v_work.id;
  return public.studio_author_space(v_work.space_id);
end;
$$;

-- Published boks to attach: a bounded, server-side title / byline search.
create or replace function public.studio_find_boks(p_query text default '', p_space_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_owner uuid;
begin
  perform public.boks_require_editor();
  select s.owner_user_id into v_owner from public.author_spaces s where s.id = p_space_id and s.kind = 'author';
  if char_length(v_query) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id::text, 'title', b.title, 'authorName', b.author_name, 'authorHandle', b.author_handle
    ))
    from (
      select b.* from public.published_boks b
      where (v_owner is null or b.author_user_id = v_owner)
        and (strpos(lower(b.title), v_query) > 0 or strpos(lower(coalesce(b.author_name, '')), v_query) > 0)
      order by (lower(b.title) = v_query) desc, b.created_at desc
      limit 20
    ) b
  ), '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------------- invitations

-- Returns the link's token once; the database keeps only its hash. A new
-- invitation revokes every earlier one for the page.
create or replace function public.studio_issue_author_invite(p_space_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_space public.author_spaces;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_invite public.author_space_invites;
begin
  select * into v_space from public.author_spaces where id = p_space_id for update;
  if v_space.id is null or v_space.status = 'merged' then
    raise exception 'This page does not exist.' using errcode = 'P0002';
  end if;
  if v_space.kind <> 'author' then
    raise exception 'An editorial page is not handed over: the team publishes it.' using errcode = '22023';
  end if;
  if v_space.owner_user_id is not null then
    raise exception 'The author already has this page.' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'Enter the author''s email address.' using errcode = '22023';
  end if;

  update public.author_space_invites
  set revoked_at = now()
  where space_id = v_space.id and accepted_at is null and revoked_at is null;

  insert into public.author_space_invites (space_id, email, token_hash, created_by, expires_at)
  values (v_space.id, v_email, sha256(convert_to(v_token, 'UTF8')), v_uid, now() + interval '14 days')
  returning * into v_invite;

  update public.author_spaces set updated_at = now() where id = v_space.id;

  return jsonb_build_object(
    'token', v_token,
    'invite', jsonb_build_object(
      'id', v_invite.id::text, 'email', v_invite.email, 'state', 'pending',
      'createdAt', v_invite.created_at, 'expiresAt', v_invite.expires_at
    )
  );
end;
$$;

create or replace function public.studio_revoke_author_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.author_space_invites;
begin
  perform public.boks_require_editor();
  update public.author_space_invites
  set revoked_at = coalesce(revoked_at, now())
  where id = p_invite_id and accepted_at is null
  returning * into v_invite;
  if v_invite.id is null then
    raise exception 'This invitation cannot be revoked.' using errcode = '22023';
  end if;
  return public.studio_author_space(v_invite.space_id);
end;
$$;

-- What the invited person may know before accepting. Nothing before they
-- sign in; after, whether it is for this address, and how many works wait.
create or replace function public.peek_author_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_email text;
  v_invite public.author_space_invites;
  v_space public.author_spaces;
  v_state text;
begin
  if v_uid is null or v_is_anonymous then
    return jsonb_build_object('state', 'sign_in');
  end if;
  select * into v_invite from public.author_space_invites
  where token_hash = sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8'));
  if v_invite.id is null then
    return jsonb_build_object('state', 'invalid');
  end if;
  v_state := public.boks_invite_state(v_invite);
  if v_state = 'accepted' then
    return jsonb_build_object('state', case when v_invite.accepted_by = v_uid then 'accepted' else 'used' end);
  end if;
  if v_state <> 'pending' then
    return jsonb_build_object('state', v_state);
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_invite.email then
    return jsonb_build_object('state', 'wrong_email', 'emailHint', public.boks_mask_email(v_invite.email));
  end if;
  select * into v_space from public.author_spaces where id = v_invite.space_id;
  return jsonb_build_object(
    'state', 'pending',
    'existingPage', exists (select 1 from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged')
      or exists (select 1 from public.reels r where r.author_user_id = v_uid and r.status = 'published')
      or exists (select 1 from public.author_pages a where a.user_id = v_uid),
    'works', (select count(*)::integer from public.author_space_works w where w.space_id = v_space.id and w.status <> 'withdrawn'),
    'series', (select count(*)::integer from public.author_space_works w where w.space_id = v_space.id and w.status <> 'withdrawn' and w.series_piece is not null),
    'name', v_space.name,
    -- The address the page will have: the account's own once it has a page,
    -- else the one the team proposed (it becomes the account's @name).
    'handle', coalesce(
      case when exists (select 1 from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged')
             or exists (select 1 from public.reels r where r.author_user_id = v_uid and r.status = 'published')
           then (select p.handle from public.user_profiles p where p.user_id = v_uid) end,
      v_space.handle,
      (select p.handle from public.user_profiles p where p.user_id = v_uid)
    )
  );
end;
$$;

-- Pages waiting for the signed-in address: what the cabinet offers without
-- any link. Only pending invitations to this exact (verified) email.
create or replace function public.get_my_author_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_existing boolean;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    return '[]'::jsonb;
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    return '[]'::jsonb;
  end if;
  v_existing := exists (select 1 from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged')
    or exists (select 1 from public.reels r where r.author_user_id = v_uid and r.status = 'published')
    or exists (select 1 from public.author_pages a where a.user_id = v_uid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'inviteId', i.id::text,
      'state', 'pending',
      'existingPage', v_existing,
      'works', (select count(*)::integer from public.author_space_works w where w.space_id = s.id and w.status <> 'withdrawn'),
      'series', (select count(*)::integer from public.author_space_works w where w.space_id = s.id and w.status <> 'withdrawn' and w.series_piece is not null),
      'name', s.name,
      'handle', case when v_existing then (select p.handle from public.user_profiles p where p.user_id = v_uid) else s.handle end,
      'expiresAt', i.expires_at
    ) order by i.created_at desc)
    from public.author_space_invites i
    join public.author_spaces s on s.id = i.space_id
    where i.email = v_email
      and public.boks_invite_state(i) = 'pending'
      and s.status <> 'merged' and s.owner_user_id is null
  ), '[]'::jsonb);
end;
$$;

-- Accepted by the link's token, or - signed in with the invited address,
-- no link needed - by the invitation's id (`get_my_author_invites`). Either
-- way the address is the check: the page binds only to that email.
create or replace function public.accept_author_invite(p_token text, p_invite_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_email text;
  v_invite public.author_space_invites;
  v_space public.author_spaces;
  v_own public.author_spaces;
  v_state text;
  v_handle text;
  v_base integer;
  v_moved integer := 0;
  v_existing boolean;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in with the invited email first.' using errcode = '42501';
  end if;
  if public.is_boks_user_blocked(v_uid) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;

  if p_invite_id is not null then
    select * into v_invite from public.author_space_invites where id = p_invite_id for update;
  else
    select * into v_invite from public.author_space_invites
    where token_hash = sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8'))
    for update;
  end if;
  if v_invite.id is null then
    return jsonb_build_object('state', 'invalid');
  end if;

  v_state := public.boks_invite_state(v_invite);
  if v_state = 'accepted' then
    if v_invite.accepted_by = v_uid then
      return jsonb_build_object('state', 'accepted', 'repeat', true);
    end if;
    return jsonb_build_object('state', 'used');
  end if;
  if v_state <> 'pending' then
    return jsonb_build_object('state', v_state);
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_invite.email then
    return jsonb_build_object('state', 'wrong_email', 'emailHint', public.boks_mask_email(v_invite.email));
  end if;

  perform public.ensure_boks_user_profile('');
  -- Serialises this account's acceptances.
  perform 1 from public.user_profiles where user_id = v_uid for update;

  select * into v_space from public.author_spaces where id = v_invite.space_id for update;
  if v_space.id is null or v_space.status = 'merged' or v_space.owner_user_id is not null then
    return jsonb_build_object('state', 'used');
  end if;

  select * into v_own from public.author_spaces
  where owner_user_id = v_uid and status <> 'merged' for update;

  v_existing := v_own.id is not null
    or exists (select 1 from public.reels r where r.author_user_id = v_uid and r.status = 'published')
    or exists (select 1 from public.author_pages a where a.user_id = v_uid);

  if v_existing then
    -- The author already has a page: its name, photo, address, order,
    -- followers and published boks stay. The prepared works join it as
    -- drafts, after everything already there.
    if v_own.id is null then
      insert into public.author_spaces (kind, status, owner_user_id, name, created_by, published_at)
      values ('author', 'published', v_uid, null, v_invite.created_by, now())
      returning * into v_own;
    end if;
    -- Fix the order readers see now (newest first) before adding to it, so
    -- the new works land after it rather than above boks never ordered.
    insert into public.author_space_order (space_id, bok_id, position)
    select v_own.id, x.bok_id,
      coalesce((select max(o.position) from public.author_space_order o where o.space_id = v_own.id), 0)
        + row_number() over (order by x.created_at desc, x.bok_id)
    from public.boks_space_public_boks(v_own) x
    where x.sort_position is null
    on conflict (space_id, bok_id) do nothing;

    select coalesce(max(x.position), 0) into v_base
    from (
      select w.position from public.author_space_works w where w.space_id = v_own.id
      union all
      select o.position from public.author_space_order o where o.space_id = v_own.id
    ) x;
    with moving as (
      select w.id, row_number() over (order by w.position nulls last, w.created_at) as n
      from public.author_space_works w
      where w.space_id = v_space.id
        and not exists (select 1 from public.author_space_works d where d.space_id = v_own.id and d.bok_id = w.bok_id)
    )
    update public.author_space_works w
    set space_id = v_own.id, position = v_base + m.n, updated_at = now()
    from moving m where m.id = w.id;
    get diagnostics v_moved = row_count;

    update public.author_spaces
    set status = 'merged', merged_into = v_own.id, handle = null, updated_at = now()
    where id = v_space.id;
    v_space := v_own;
  else
    -- A first page. The address the team proposed becomes the account's
    -- @handle, unless another account has it: then nothing is bound and the
    -- editor is told.
    v_handle := v_space.handle;
    if v_handle is not null and v_handle is distinct from (select p.handle from public.user_profiles p where p.user_id = v_uid) then
      if exists (select 1 from public.user_profiles p where lower(p.handle) = lower(v_handle) and p.user_id <> v_uid) then
        update public.author_space_invites set problem = 'handle_taken' where id = v_invite.id;
        return jsonb_build_object('state', 'conflict');
      end if;
      update public.author_spaces set handle = null where id = v_space.id;
      perform set_config('boks.claiming_space_handle', v_handle, true);
      update public.user_profiles set handle = v_handle, updated_at = now() where user_id = v_uid;
      perform set_config('boks.claiming_space_handle', '', true);
    end if;

    update public.author_spaces
    set owner_user_id = v_uid, handle = null, updated_at = now()
    where id = v_space.id
    returning * into v_space;

    -- The prepared name and photo become the page's, still closed: public
    -- reads skip a page whose space is a draft.
    insert into public.author_pages (user_id, page_name, photo, version, updated_at)
    values (v_uid, v_space.name, v_space.photo, 1, now())
    on conflict (user_id) do nothing;

    select count(*)::integer into v_moved from public.author_space_works w where w.space_id = v_space.id;
  end if;

  update public.author_space_invites
  set accepted_at = now(), accepted_by = v_uid, problem = null
  where id = v_invite.id;

  return jsonb_build_object('state', 'accepted', 'existingPage', v_existing, 'works', v_moved, 'spaceId', v_space.id::text);
end;
$$;

-- ---------------------------------------------------------------- the owner

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
    'name', coalesce((select a.page_name from public.author_pages a where a.user_id = v_uid), v_space.name),
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
        select b.id, b.title, b.created_at, o.position
        from public.published_boks b
        left join public.author_space_order o on o.space_id = v_space.id and o.bok_id = b.id
        where b.author_user_id = v_uid
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
        where not (w.bok_id is not null and exists (select 1 from published p where p.id = w.bok_id))
      )
      select jsonb_agg(r.item order by r.position nulls last, r.created_at desc)
      from rows r
    ), '[]'::jsonb)
  );
end;
$$;

-- The full text and the page's prepared identity, to preview exactly what
-- would be published. The editor and the owner only.
create or replace function public.get_author_space_preview(p_space_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_space public.author_spaces;
  v_access text;
  v_page public.author_pages;
begin
  if p_space_id is null then
    select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged';
  else
    select * into v_space from public.author_spaces where id = p_space_id;
  end if;
  v_access := public.boks_space_access(v_space.id);
  if v_space.id is null or v_access is null then
    raise exception 'This page is not available.' using errcode = '42501';
  end if;

  select * into v_page from public.author_pages where user_id = v_space.owner_user_id;

  return jsonb_build_object(
    'id', v_space.id::text,
    'kind', v_space.kind,
    'status', v_space.status,
    'access', v_access,
    'handle', public.boks_space_handle(v_space),
    -- Once the author owns the page, their own name and photo are the page's.
    'name', coalesce(v_page.page_name, v_space.name),
    'photo', case
      when v_page.user_id is not null then case when v_page.photo is null then null else encode(v_page.photo, 'base64') end
      when v_space.photo is null then null
      else encode(v_space.photo, 'base64')
    end,
    'items', coalesce((
      with published as (
        select x.bok_id, x.sort_position as position, x.created_at from public.boks_space_public_boks(v_space) x
      ),
      rows as (
        select p.position, p.created_at,
          jsonb_build_object(
            'key', 'b:' || b.id::text, 'bokId', b.id::text, 'title', b.title, 'published', true,
            'format', coalesce(public.boks_space_bok_format(v_space.id, b.id) ->> 'format', 'text'),
            'seriesHeld', coalesce((public.boks_space_bok_format(v_space.id, b.id) ->> 'seriesHeld')::boolean, false),
            'body', b.text
          ) as item
        from published p join public.published_boks b on b.id = p.bok_id
        union all
        select w.position, w.created_at,
          jsonb_build_object(
            'key', 'w:' || w.id::text, 'workId', w.id::text, 'bokId', w.bok_id::text, 'title', w.title,
            'published', false, 'format', w.format, 'status', w.status, 'revision', w.revision,
            'seriesPiece', w.series_piece,
            'body', coalesce(w.body, r.text)
          )
        from public.author_space_works w
        left join public.reels r on r.id = w.bok_id
        where w.space_id = v_space.id and w.status not in ('published', 'withdrawn')
          and not (w.bok_id is not null and exists (select 1 from published p where p.bok_id = w.bok_id))
      )
      select jsonb_agg(r.item order by r.position nulls last, r.created_at desc) from rows r
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.request_author_space_changes(p_work_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_work public.author_space_works;
begin
  select * into v_work from public.author_space_works where id = p_work_id for update;
  if v_work.id is null or public.boks_space_access(v_work.space_id) is distinct from 'owner' then
    raise exception 'This work is not available.' using errcode = '42501';
  end if;
  if v_work.status not in ('preparing', 'ready', 'changes_requested') then
    raise exception 'Changes are asked for before a work is published.' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) > 1000 then
    raise exception 'Say briefly what to change (up to 1000 characters).' using errcode = '22023';
  end if;
  update public.author_space_works
  set status = 'changes_requested', note = v_note, updated_at = now()
  where id = v_work.id;
  insert into public.author_space_messages (space_id, work_id, from_author, body, created_by)
  values (v_work.space_id, v_work.id, true, v_note, (select auth.uid()));
  return public.get_my_author_space();
end;
$$;

-- The author writes to the team: about the design, the page, or a work.
create or replace function public.send_author_space_message(p_body text, p_work_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_space public.author_spaces;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged';
  if v_space.id is null then
    raise exception 'There is no page to write about yet.' using errcode = 'P0002';
  end if;
  if v_body is null or char_length(v_body) > 2000 then
    raise exception 'Write your message (up to 2000 characters).' using errcode = '22023';
  end if;
  if p_work_id is not null and not exists (select 1 from public.author_space_works w where w.id = p_work_id and w.space_id = v_space.id) then
    raise exception 'This work is not available.' using errcode = '42501';
  end if;
  insert into public.author_space_messages (space_id, work_id, from_author, body, created_by)
  values (v_space.id, p_work_id, true, v_body, v_uid);
  update public.author_spaces set author_seen_at = clock_timestamp() where id = v_space.id;
  return public.get_my_author_space();
end;
$$;

-- The author has read the team's answers.
create or replace function public.mark_author_space_messages_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  update public.author_spaces set author_seen_at = clock_timestamp()
  where owner_user_id = (select auth.uid()) and status <> 'merged';
end;
$$;

-- The team answers on a page.
create or replace function public.studio_send_author_space_message(p_space_id uuid, p_body text, p_work_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if not exists (select 1 from public.author_spaces where id = p_space_id and status <> 'merged') then
    raise exception 'This page does not exist.' using errcode = 'P0002';
  end if;
  if v_body is null or char_length(v_body) > 2000 then
    raise exception 'Write your message (up to 2000 characters).' using errcode = '22023';
  end if;
  insert into public.author_space_messages (space_id, work_id, from_author, body, created_by)
  values (p_space_id, p_work_id, false, v_body, v_uid);
  update public.author_spaces set editor_seen_at = clock_timestamp() where id = p_space_id;
  return public.studio_author_space(p_space_id);
end;
$$;

-- The team has read the author's messages.
create or replace function public.studio_mark_author_space_seen(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.boks_require_editor();
  update public.author_spaces set editor_seen_at = clock_timestamp() where id = p_space_id;
end;
$$;

-- One order for everything on a page. `p_items` are the keys
-- `get_my_author_space` / `get_author_space_preview` return (`b:<bok>` for a
-- published bok, `w:<work>` for a prepared one), top first. A tab holding an
-- older order is refused rather than undoing the newer one.
create or replace function public.save_author_space_order(
  p_space_id uuid,
  p_items text[],
  p_order_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_space public.author_spaces;
  v_key text;
  v_id uuid;
  v_index integer := 0;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_items, 1), 0) > 1000 then
    raise exception 'Too many works to order at once.' using errcode = '22023';
  end if;

  if p_space_id is null then
    -- An author who never had a prepared page orders their published boks:
    -- the page gets its space now, already public.
    if public.is_boks_user_blocked(v_uid) then
      raise exception 'This boks account is suspended.' using errcode = '42501';
    end if;
    perform 1 from public.user_profiles where user_id = v_uid for update;
    select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged' for update;
    if v_space.id is null then
      insert into public.author_spaces (kind, status, owner_user_id, created_by, published_at)
      values ('author', 'published', v_uid, v_uid, now())
      returning * into v_space;
    end if;
  else
    select * into v_space from public.author_spaces where id = p_space_id for update;
    if v_space.id is null or public.boks_space_access(v_space.id) is null then
      raise exception 'This page is not available.' using errcode = '42501';
    end if;
  end if;

  if v_space.order_version <> coalesce(p_order_version, -1) then
    raise exception 'The order was changed in another tab. Reload to see the latest order.' using errcode = '40001';
  end if;

  foreach v_key in array coalesce(p_items, '{}'::text[]) loop
    v_index := v_index + 1;
    begin
      v_id := substring(v_key from 3)::uuid;
    exception when others then
      raise exception 'Unknown item in the order.' using errcode = '22023';
    end;
    if left(v_key, 2) = 'w:' then
      update public.author_space_works set position = v_index, updated_at = now()
      where id = v_id and space_id = v_space.id;
      if not found then
        raise exception 'Unknown item in the order.' using errcode = '22023';
      end if;
    elsif left(v_key, 2) = 'b:' then
      if not exists (select 1 from public.boks_space_public_boks(v_space) x where x.bok_id = v_id) then
        raise exception 'Unknown item in the order.' using errcode = '22023';
      end if;
      insert into public.author_space_order (space_id, bok_id, position)
      values (v_space.id, v_id, v_index)
      on conflict (space_id, bok_id) do update set position = excluded.position;
      update public.author_space_works set position = v_index where space_id = v_space.id and bok_id = v_id;
    else
      raise exception 'Unknown item in the order.' using errcode = '22023';
    end if;
  end loop;

  update public.author_spaces
  set order_version = order_version + 1, updated_at = now()
  where id = v_space.id;

  return jsonb_build_object('spaceId', v_space.id::text, 'orderVersion', v_space.order_version + 1);
end;
$$;

-- --------------------------------------------------------------- publishing

-- Shared by the owner's and the editor's publication: checks every chosen
-- work against the revision that was previewed, then switches what readers
-- see, all in the caller's transaction.
create or replace function public.boks_publish_space_works(
  p_space public.author_spaces,
  p_items jsonb,
  p_actor uuid,
  p_rights_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  v_byline := coalesce(
    (select a.page_name from public.author_pages a where a.user_id = p_space.owner_user_id),
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
        title, author_name, hook, text, genre, mood, minutes,
        status, author_user_id, submitted_at, reviewed_at, reviewed_by, updated_at
      )
      values (
        v_work.title, left(v_byline, 120), '', v_work.body, 'literary', 'quiet',
        public.boks_reading_minutes(public.boks_word_count(v_work.body)),
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
        note = null,
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
$$;
revoke all on function public.boks_publish_space_works(public.author_spaces, jsonb, uuid, text) from public, anon, authenticated;

-- The author publishes: their page (when it is new) and the works they chose.
-- `p_items` is [{workId, revision}]. `p_request_id` makes a repeat harmless.
create or replace function public.publish_my_author_space(
  p_items jsonb,
  p_publish_page boolean,
  p_terms_version text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_terms text := nullif(btrim(coalesce(p_terms_version, '')), '');
  v_space public.author_spaces;
  v_previous public.author_space_publications;
  v_done jsonb;
  v_page boolean := false;
  v_result jsonb;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if public.is_boks_user_blocked(v_uid) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'A request id is required.' using errcode = '22023';
  end if;

  select * into v_space from public.author_spaces
  where owner_user_id = v_uid and status <> 'merged' and kind = 'author'
  for update;
  if v_space.id is null then
    raise exception 'You have no prepared page.' using errcode = '42501';
  end if;

  select * into v_previous from public.author_space_publications where request_id = p_request_id;
  if v_previous.request_id is not null then
    if v_previous.actor_user_id is distinct from v_uid or v_previous.space_id <> v_space.id then
      raise exception 'This request belongs to another publication.' using errcode = '42501';
    end if;
    return v_previous.result || jsonb_build_object('repeat', true);
  end if;

  if v_terms is null then
    raise exception 'Accept the publication terms first.' using errcode = '22023';
  end if;
  if v_space.status <> 'published' and not coalesce(p_publish_page, false) and jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0 then
    raise exception 'Your page opens together with its first works.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 and (v_space.status = 'published' or not coalesce(p_publish_page, false)) then
    raise exception 'Choose what to publish.' using errcode = '22023';
  end if;

  v_done := public.boks_publish_space_works(v_space, p_items, v_uid, format('Published by the author, terms %s', v_terms));

  if coalesce(p_publish_page, false) and v_space.status <> 'published' then
    update public.author_spaces
    set status = 'published', published_at = now(), updated_at = now()
    where id = v_space.id;
    v_page := true;
  end if;

  v_result := jsonb_build_object(
    'requestId', p_request_id::text,
    'handle', public.boks_space_handle(v_space),
    'pagePublished', v_page,
    'published', v_done
  );

  insert into public.author_space_publications (request_id, space_id, actor_user_id, basis, terms_version, items, page_published, result)
  values (p_request_id, v_space.id, v_uid, 'owner_terms', v_terms, v_done, v_page, v_result);

  return v_result;
end;
$$;

-- The team publishes an editorial page (a classic): the basis of the rights
-- and the source of the texts are recorded with the editor's id.
-- A Series made in a link-only folder, attached to a work of a page. Before
-- the text is published, attaching or replacing it is a new version the author
-- has to look at again (as any edit is). Once the text is published and the
-- piece is registered against its bok, `p_live` marks it as Series on the page.
-- The link preview card of a page: a file in a link-only folder, or none.
create or replace function public.studio_set_author_space_share(p_space_id uuid, p_card text, p_video text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card text := nullif(btrim(coalesce(p_card, '')), '');
  v_video text := nullif(btrim(coalesce(p_video, '')), '');
begin
  perform public.boks_require_editor();
  if v_video is not null then
    v_video := coalesce(substring(v_video from '(/l/[A-Za-z0-9_-]{22,64}/f/[a-z0-9][a-z0-9-]{0,80}-share\.mp4)'), v_video);
    if v_video !~ '^/l/[A-Za-z0-9_-]{22,64}/f/[a-z0-9][a-z0-9-]{0,80}-share\.mp4$' then
      raise exception 'Paste the video''s link: /l/<token>/f/<name>-share.mp4.' using errcode = '22023';
    end if;
  end if;
  if v_card is not null then
    -- A whole link is accepted too: keep the path from /l/ on.
    v_card := coalesce(substring(v_card from '(/l/[A-Za-z0-9_-]{22,64}/f/[a-z0-9][a-z0-9-]{0,80}-share\.(?:jpg|webp|gif))'), v_card);
    if v_card !~ '^/l/[A-Za-z0-9_-]{22,64}/f/[a-z0-9][a-z0-9-]{0,80}-share\.(jpg|webp|gif)$' then
      raise exception 'Paste the card''s link: /l/<token>/f/<name>-share.jpg.' using errcode = '22023';
    end if;
  end if;
  update public.author_spaces set share_card = v_card, share_video = v_video, updated_at = now()
  where id = p_space_id and status <> 'merged';
  if not found then
    raise exception 'This page does not exist.' using errcode = 'P0002';
  end if;
  return public.studio_author_space(p_space_id);
end;
$$;

create or replace function public.studio_set_space_work_series(p_work_id uuid, p_piece text, p_live boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_piece text := nullif(btrim(coalesce(p_piece, '')), '');
  v_work public.author_space_works;
begin
  perform public.boks_require_editor();
  select * into v_work from public.author_space_works where id = p_work_id for update;
  if v_work.id is null then
    raise exception 'This work is not available.' using errcode = '42501';
  end if;
  -- A whole link is accepted as well as the token: `https://…/l/<token>`.
  if v_piece is not null then
    v_piece := coalesce(substring(v_piece from '/l/([A-Za-z0-9_-]{22,64})'), v_piece);
    if v_piece !~ '^[A-Za-z0-9_-]{22,64}$' then
      raise exception 'Paste the Series link: /l/ and its token.' using errcode = '22023';
    end if;
  end if;
  if v_work.format <> 'text' then
    raise exception 'A Series link is attached to a new text.' using errcode = '22023';
  end if;
  if coalesce(p_live, false) and (v_work.status <> 'published' or v_piece is null) then
    raise exception 'A Series goes live after its text is published.' using errcode = '22023';
  end if;
  if v_work.status = 'published' then
    update public.author_space_works
    set series_piece = v_piece, series_published = coalesce(p_live, false) and v_piece is not null, updated_at = now()
    where id = v_work.id;
  elsif v_piece is distinct from v_work.series_piece then
    update public.author_space_works
    set series_piece = v_piece,
        revision = revision + 1,
        status = case when status = 'ready' then 'preparing' else status end,
        ready_at = case when status = 'ready' then null else ready_at end,
        ready_by = case when status = 'ready' then null else ready_by end,
        updated_at = now()
    where id = v_work.id;
  end if;
  return public.studio_author_space(v_work.space_id);
end;
$$;

create or replace function public.studio_publish_editorial_space(
  p_space_id uuid,
  p_items jsonb,
  p_rights_basis text,
  p_rights_source text,
  p_rights_confirmed boolean,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_basis text := nullif(btrim(coalesce(p_rights_basis, '')), '');
  v_source text := nullif(btrim(coalesce(p_rights_source, '')), '');
  v_space public.author_spaces;
  v_previous public.author_space_publications;
  v_done jsonb;
  v_page boolean := false;
  v_result jsonb;
begin
  if p_request_id is null then
    raise exception 'A request id is required.' using errcode = '22023';
  end if;
  select * into v_space from public.author_spaces where id = p_space_id for update;
  if v_space.id is null or v_space.kind <> 'editorial' then
    raise exception 'Only an editorial page is published from Studio.' using errcode = '22023';
  end if;

  select * into v_previous from public.author_space_publications where request_id = p_request_id;
  if v_previous.request_id is not null then
    return v_previous.result || jsonb_build_object('repeat', true);
  end if;

  if v_basis is null or v_source is null or not coalesce(p_rights_confirmed, false) then
    raise exception 'State the basis of the rights and the source of the texts, and confirm the rights to the materials.' using errcode = '22023';
  end if;

  v_done := public.boks_publish_space_works(v_space, p_items, v_uid, format('Editorial basis: %s; source: %s', v_basis, v_source));

  update public.author_spaces
  set rights_basis = left(v_basis, 200),
      rights_source = left(v_source, 500),
      status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  where id = v_space.id;
  v_page := v_space.status <> 'published';

  v_result := jsonb_build_object(
    'requestId', p_request_id::text,
    'handle', v_space.handle,
    'pagePublished', v_page,
    'published', v_done
  );

  insert into public.author_space_publications (request_id, space_id, actor_user_id, basis, rights_basis, rights_source, items, page_published, result)
  values (p_request_id, v_space.id, v_uid, 'editorial', v_basis, v_source, v_done, v_page, v_result);

  return v_result;
end;
$$;

-- Takes one published work off its page. A Series version: the text it was
-- attached to stays published. A new text the author published here: the
-- author's ordinary withdraw (`withdraw_my_bok`) is the way, and is used by
-- the cabinet. On an editorial page: the bok leaves the page, and stays in
-- the catalogue it came from.
create or replace function public.unpublish_space_work(p_work_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.author_space_works;
  v_space public.author_spaces;
begin
  select * into v_work from public.author_space_works where id = p_work_id for update;
  if v_work.id is null or public.boks_space_access(v_work.space_id) is null then
    raise exception 'This work is not available.' using errcode = '42501';
  end if;
  select * into v_space from public.author_spaces where id = v_work.space_id;
  if v_work.status <> 'published' then
    raise exception 'Only a published work is taken down.' using errcode = '22023';
  end if;
  if v_space.kind = 'author' and v_work.format = 'text' then
    raise exception 'Withdraw this text from your texts.' using errcode = '22023';
  end if;

  update public.author_space_works
  set status = 'withdrawn', series_published = false, updated_at = now()
  where id = v_work.id;
  if v_space.kind = 'editorial' then
    delete from public.author_space_order where space_id = v_space.id and bok_id = v_work.bok_id;
  end if;
  return jsonb_build_object('ok', true, 'workId', v_work.id::text);
end;
$$;

create or replace function public.studio_set_editorial_space_status(p_space_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
begin
  perform public.boks_require_editor();
  if v_status not in ('published', 'unpublished') then
    raise exception 'An editorial page is published or taken down.' using errcode = '22023';
  end if;
  update public.author_spaces
  set status = v_status, updated_at = now(),
      published_at = case when v_status = 'published' then coalesce(published_at, now()) else published_at end
  where id = p_space_id and kind = 'editorial'
    and (v_status = 'unpublished' or rights_basis is not null);
  if not found then
    raise exception 'This page cannot change state now.' using errcode = '22023';
  end if;
  return public.studio_author_space(p_space_id);
end;
$$;

-- ---------------------------------------------------- following an editorial page

create or replace function public.set_author_page_follow(p_page_id uuid, p_following boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in to follow an author.' using errcode = '42501';
  end if;
  if public.is_boks_user_blocked(v_uid) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_profiles p where p.user_id = v_uid and p.terms_accepted_at is not null) then
    raise exception 'Accept the boks terms before using this feature.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.author_spaces s where s.id = p_page_id and s.kind = 'editorial' and s.status = 'published') then
    raise exception 'That page is not available.' using errcode = '22023';
  end if;

  if coalesce(p_following, false) then
    insert into public.author_space_follows (follower_user_id, space_id) values (v_uid, p_page_id)
    on conflict do nothing;
  else
    delete from public.author_space_follows where follower_user_id = v_uid and space_id = p_page_id;
  end if;

  return jsonb_build_object(
    'pageId', p_page_id::text,
    'following', exists (select 1 from public.author_space_follows f where f.follower_user_id = v_uid and f.space_id = p_page_id),
    'followers', (select count(*)::integer from public.author_space_follows f where f.space_id = p_page_id)
  );
end;
$$;

-- The editorial pages the reader follows, for You -> Following, beside
-- `get_my_followed_authors` (which stays as it was for older tabs).
create or replace function public.get_my_followed_pages()
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
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'pageId', s.id::text,
      'authorName', coalesce(s.name, '@' || s.handle),
      'authorHandle', s.handle,
      'kind', s.kind,
      'photoVersion', case when s.photo is null then null else s.photo_version end,
      'followedAt', f.created_at,
      'published', (select count(*)::integer from public.boks_space_public_boks(s))
    ) order by f.created_at desc)
    from public.author_space_follows f
    join public.author_spaces s on s.id = f.space_id and s.status = 'published'
    where f.follower_user_id = v_uid
  ), '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------------ what readers see

-- The author page, as before, plus: an editorial page's own handle; the
-- page's own order, applied before the limit; each bok's format on that
-- page; and `pageId` for following an editorial page. Every field an older
-- client reads is unchanged.
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
              'id', b.id::text, 'title', b.title, 'hook', b.hook, 'minutes', b.minutes,
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

revoke all on function public.get_boks_author(text, text, integer) from public, anon, authenticated;
grant execute on function public.get_boks_author(text, text, integer) to anon, authenticated;

-- Name and photo for readers: a page whose space is still a draft has none
-- yet; an editorial page answers by its own handle.
create or replace function public.get_boks_author_page(p_handle text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'name', a.page_name,
        'photoVersion', case when a.photo is null then null else a.version end,
        'shareCard', (
          select s.share_card from public.author_spaces s
          where s.owner_user_id = p.user_id and s.status = 'published'
        ),
        'shareVideo', (
          select s.share_video from public.author_spaces s
          where s.owner_user_id = p.user_id and s.status = 'published'
        )
      )
      from public.user_profiles p
      join public.author_pages a on a.user_id = p.user_id
      where lower(p.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
        and p.banned_at is null
        and not exists (
          select 1 from public.author_spaces s
          where s.owner_user_id = p.user_id and s.status in ('draft', 'unpublished')
        )
    ),
    -- A published page whose author has set no name or photo of their own
    -- still has its card.
    (
      select jsonb_build_object('name', null, 'photoVersion', null, 'shareCard', s.share_card, 'shareVideo', s.share_video)
      from public.user_profiles p
      join public.author_spaces s on s.owner_user_id = p.user_id and s.status = 'published'
      where lower(p.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
        and p.banned_at is null
        and s.share_card is not null
    ),
    (
      select jsonb_build_object(
        'name', s.name,
        'photoVersion', case when s.photo is null then null else s.photo_version end,
        'kind', 'editorial',
        'shareCard', s.share_card,
        'shareVideo', s.share_video
      )
      from public.author_spaces s
      where s.kind = 'editorial' and s.status = 'published'
        and lower(s.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
    )
  );
$$;

create or replace function public.get_boks_author_photo(p_handle text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object('version', a.version, 'jpeg', encode(a.photo, 'base64'))
      from public.user_profiles p
      join public.author_pages a on a.user_id = p.user_id
      where lower(p.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
        and p.banned_at is null
        and a.photo is not null
        and not exists (
          select 1 from public.author_spaces s
          where s.owner_user_id = p.user_id and s.status in ('draft', 'unpublished')
        )
    ),
    (
      select jsonb_build_object('version', s.photo_version, 'jpeg', encode(s.photo, 'base64'))
      from public.author_spaces s
      where s.kind = 'editorial' and s.status = 'published' and s.photo is not null
        and lower(s.handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@')))
    )
  );
$$;

revoke all on function public.get_boks_author_page(text) from public, anon, authenticated;
revoke all on function public.get_boks_author_photo(text) from public, anon, authenticated;
grant execute on function public.get_boks_author_page(text) to anon, authenticated;
grant execute on function public.get_boks_author_photo(text) to anon, authenticated;

-- ------------------------------------------------------------------ grants

revoke all on function public.studio_author_spaces(text, integer, integer) from public, anon, authenticated;
revoke all on function public.studio_author_space(uuid) from public, anon, authenticated;
revoke all on function public.studio_save_author_space(uuid, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.studio_save_space_work(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.studio_set_space_work_status(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.studio_set_space_work_series(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.studio_set_author_space_share(uuid, text, text) from public, anon, authenticated;
revoke all on function public.studio_send_author_space_message(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.studio_mark_author_space_seen(uuid) from public, anon, authenticated;
revoke all on function public.send_author_space_message(text, uuid) from public, anon, authenticated;
revoke all on function public.get_my_author_invites() from public, anon, authenticated;
revoke all on function public.mark_author_space_messages_seen() from public, anon, authenticated;
revoke all on function public.get_boks_author_moved(text) from public, anon, authenticated;
revoke all on function public.studio_remove_space_work(uuid) from public, anon, authenticated;
revoke all on function public.studio_find_boks(text, uuid) from public, anon, authenticated;
revoke all on function public.studio_issue_author_invite(uuid, text) from public, anon, authenticated;
revoke all on function public.studio_revoke_author_invite(uuid) from public, anon, authenticated;
revoke all on function public.studio_publish_editorial_space(uuid, jsonb, text, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.studio_set_editorial_space_status(uuid, text) from public, anon, authenticated;
revoke all on function public.peek_author_invite(text) from public, anon, authenticated;
revoke all on function public.accept_author_invite(text, uuid) from public, anon, authenticated;
revoke all on function public.get_my_author_space() from public, anon, authenticated;
revoke all on function public.get_author_space_preview(uuid) from public, anon, authenticated;
revoke all on function public.request_author_space_changes(uuid, text) from public, anon, authenticated;
revoke all on function public.save_author_space_order(uuid, text[], integer) from public, anon, authenticated;
revoke all on function public.publish_my_author_space(jsonb, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.unpublish_space_work(uuid) from public, anon, authenticated;
revoke all on function public.set_author_page_follow(uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_my_followed_pages() from public, anon, authenticated;

grant execute on function public.studio_author_spaces(text, integer, integer) to authenticated;
grant execute on function public.studio_author_space(uuid) to authenticated;
grant execute on function public.studio_save_author_space(uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.studio_save_space_work(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.studio_set_space_work_status(uuid, text, text, text) to authenticated;
grant execute on function public.studio_remove_space_work(uuid) to authenticated;
grant execute on function public.studio_set_space_work_series(uuid, text, boolean) to authenticated;
grant execute on function public.studio_set_author_space_share(uuid, text, text) to authenticated;
grant execute on function public.studio_send_author_space_message(uuid, text, uuid) to authenticated;
grant execute on function public.studio_mark_author_space_seen(uuid) to authenticated;
grant execute on function public.send_author_space_message(text, uuid) to authenticated;
grant execute on function public.get_my_author_invites() to authenticated;
grant execute on function public.mark_author_space_messages_seen() to authenticated;
grant execute on function public.get_boks_author_moved(text) to anon, authenticated;
grant execute on function public.studio_find_boks(text, uuid) to authenticated;
grant execute on function public.studio_issue_author_invite(uuid, text) to authenticated;
grant execute on function public.studio_revoke_author_invite(uuid) to authenticated;
grant execute on function public.studio_publish_editorial_space(uuid, jsonb, text, text, boolean, uuid) to authenticated;
grant execute on function public.studio_set_editorial_space_status(uuid, text) to authenticated;
grant execute on function public.peek_author_invite(text) to authenticated;
grant execute on function public.accept_author_invite(text, uuid) to authenticated;
grant execute on function public.get_my_author_space() to authenticated;
grant execute on function public.get_author_space_preview(uuid) to authenticated;
grant execute on function public.request_author_space_changes(uuid, text) to authenticated;
grant execute on function public.save_author_space_order(uuid, text[], integer) to authenticated;
grant execute on function public.publish_my_author_space(jsonb, boolean, text, uuid) to authenticated;
grant execute on function public.unpublish_space_work(uuid) to authenticated;
grant execute on function public.set_author_page_follow(uuid, boolean) to authenticated;
grant execute on function public.get_my_followed_pages() to authenticated;
