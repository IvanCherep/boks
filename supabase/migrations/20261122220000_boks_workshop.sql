-- The Workshop on the server (`docs/workshop-server.md`, owner 2026-11-22).
--
-- The Workshop (`/author/desk`) stops keeping texts in the browser and works on
-- the same rows as the cabinet. What only it needs lives in `bok_workshop`:
-- the form (poem or prose), «Отложено», the author's order among sent pieces
-- and the author's notes. Everything else is the existing rows: `reels`,
-- `bok_voices`, `bok_editor_decisions`, `bok_series_work`, `author_space_works`.
--
-- 1. `bok_workshop`, RLS on, no table grants.
-- 2. `get_my_workshop()`: everything the Workshop shows, in one call.
-- 3. `save_my_workshop_meta(bok, patch)`: form, shelved, notes.
-- 4. `set_my_queue_order(ids)`: the author's order among sent pieces. A piece
--    gets the last place when it is sent and loses it when it leaves the
--    queue (withdrawn, returned, refused, published, accepted into work).
-- 5. Studio sees the order: `queuePos` in the review queue (sorted by it,
--    author by author) and in `studio_series_work_list`.

create table if not exists public.bok_workshop (
  bok_id uuid primary key references public.reels (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  form text not null default 'poem' check (form in ('poem', 'prose')),
  shelved_at timestamptz,
  queue_pos integer check (queue_pos is null or queue_pos between 1 and 10000),
  notes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(notes) = 'object' and octet_length(notes::text) <= 65536),
  updated_at timestamptz not null default now()
);
create index if not exists bok_workshop_author_queue_idx on public.bok_workshop (author_id, queue_pos) where queue_pos is not null;
create index if not exists bok_series_work_author_idx on public.bok_series_work (author_id, accepted_at);
create index if not exists bok_series_work_work_idx on public.bok_series_work (work_id) where work_id is not null;

alter table public.bok_workshop enable row level security;
-- Read and written only through the functions below (ADR 0011).
revoke all on table public.bok_workshop from public, anon, authenticated;

-- The Workshop's refusal for anyone but a verified author, told apart by its errcode (42501) and wording.
create or replace function public.boks_require_workshop_author()
returns uuid
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
  if not public.boks_publishes_directly(v_uid) then
    raise exception 'The Workshop is open to authors the editors invited.' using errcode = '42501', hint = 'workshop_closed';
  end if;
  return v_uid;
end;
$$;
revoke all on function public.boks_require_workshop_author() from public, anon, authenticated;

-- Notes are the author's own and shape-light: an object of at most 20 keys,
-- 64 KB in all; a value is a string of at most 2000 characters, a number,
-- a boolean, null, or an array of at most 200 such values or flat objects of them.
create or replace function public.boks_workshop_notes_problem(p_notes jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_item jsonb;
  v_field jsonb;
begin
  if p_notes is null or jsonb_typeof(p_notes) <> 'object' then
    return 'Notes must be an object.';
  end if;
  if octet_length(p_notes::text) > 65536 then
    return 'The notes are longer than 64 KB.';
  end if;
  if (select count(*) from jsonb_object_keys(p_notes)) > 20 then
    return 'The notes have too many parts.';
  end if;
  for v_key, v_value in select * from jsonb_each(p_notes) loop
    if jsonb_typeof(v_value) = 'array' then
      if jsonb_array_length(v_value) > 200 then
        return 'A list in the notes holds at most 200 entries.';
      end if;
      for v_item in select * from jsonb_array_elements(v_value) loop
        if jsonb_typeof(v_item) = 'object' then
          for v_field in select value from jsonb_each(v_item) loop
            if jsonb_typeof(v_field) in ('object', 'array') then
              return 'The notes are nested too deep.';
            end if;
            if jsonb_typeof(v_field) = 'string' and char_length(v_field #>> '{}') > 2000 then
              return 'A note is longer than 2000 characters.';
            end if;
          end loop;
        elsif jsonb_typeof(v_item) = 'array' then
          return 'The notes are nested too deep.';
        elsif jsonb_typeof(v_item) = 'string' and char_length(v_item #>> '{}') > 2000 then
          return 'A note is longer than 2000 characters.';
        end if;
      end loop;
    elsif jsonb_typeof(v_value) = 'object' then
      return 'The notes are nested too deep.';
    elsif jsonb_typeof(v_value) = 'string' and char_length(v_value #>> '{}') > 2000 then
      return 'A note is longer than 2000 characters.';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.boks_workshop_notes_problem(jsonb) from public, anon, authenticated;

create or replace function public.boks_workshop_meta_json(p_bok_id uuid, w public.bok_workshop)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'bokId', p_bok_id::text,
    'form', coalesce(w.form, 'poem'),
    'shelvedAt', w.shelved_at,
    'queuePos', w.queue_pos,
    'notes', coalesce(w.notes, '{}'::jsonb),
    'updatedAt', w.updated_at
  );
$$;
revoke all on function public.boks_workshop_meta_json(uuid, public.bok_workshop) from public, anon, authenticated;

-- Whether a piece waits in the author's queue: sent from My page and not yet taken into work.
create or replace function public.boks_in_author_queue(p_bok_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reels r
    where r.id = p_bok_id and r.status = 'pending_review' and r.cover_requested
      and not exists (select 1 from public.bok_series_work w where w.bok_id = r.id and w.state in ('accepted', 'sent'))
  );
$$;
revoke all on function public.boks_in_author_queue(uuid) from public, anon, authenticated;

-- A piece sent to the editors takes the last place in its author's queue; one
-- that leaves `pending_review` loses its place.
create or replace function public.boks_workshop_queue_follows_reel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_user_id is null then
    return new;
  end if;
  if new.status = 'pending_review' and new.cover_requested
    and (tg_op = 'INSERT' or old.status is distinct from 'pending_review' or not coalesce(old.cover_requested, false)) then
    perform 1 from public.user_profiles where user_id = new.author_user_id for update;
    insert into public.bok_workshop (bok_id, author_id, queue_pos, updated_at)
    values (new.id, new.author_user_id,
      coalesce((select max(w.queue_pos) from public.bok_workshop w where w.author_id = new.author_user_id and w.queue_pos is not null), 0) + 1,
      now())
    on conflict (bok_id) do update
      set queue_pos = excluded.queue_pos, shelved_at = null, updated_at = now();
  elsif tg_op = 'UPDATE' and old.status = 'pending_review' and new.status <> 'pending_review' then
    update public.bok_workshop set queue_pos = null, updated_at = now() where bok_id = new.id and queue_pos is not null;
  end if;
  return new;
end;
$$;
revoke all on function public.boks_workshop_queue_follows_reel() from public, anon, authenticated;
drop trigger if exists reels_workshop_queue on public.reels;
create trigger reels_workshop_queue
  after insert or update of status, cover_requested on public.reels
  for each row execute function public.boks_workshop_queue_follows_reel();

-- Taken into work, a piece leaves the author's queue.
create or replace function public.boks_workshop_queue_follows_series()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state in ('accepted', 'sent') then
    update public.bok_workshop set queue_pos = null, updated_at = now() where bok_id = new.bok_id and queue_pos is not null;
  end if;
  return new;
end;
$$;
revoke all on function public.boks_workshop_queue_follows_series() from public, anon, authenticated;
drop trigger if exists bok_series_work_workshop_queue on public.bok_series_work;
create trigger bok_series_work_workshop_queue
  after insert or update of state on public.bok_series_work
  for each row execute function public.boks_workshop_queue_follows_series();

-- Pieces already waiting get their places, oldest sent first.
insert into public.bok_workshop (bok_id, author_id, queue_pos)
select r.id, r.author_user_id, row_number() over (partition by r.author_user_id order by r.submitted_at, r.created_at)
from public.reels r
where r.author_user_id is not null and r.status = 'pending_review' and r.cover_requested
  and not exists (select 1 from public.bok_series_work w where w.bok_id = r.id and w.state in ('accepted', 'sent'))
on conflict (bok_id) do update set queue_pos = excluded.queue_pos;

-- Everything the Workshop shows, in one call (`docs/workshop-server.md`).
create or replace function public.get_my_workshop()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_workshop_author();
  v_space public.author_spaces;
  v_handle text;
begin
  select * into v_space from public.author_spaces s
  where s.owner_user_id = v_uid and s.kind = 'author' and s.status in ('draft', 'published', 'unpublished') and s.verified
  order by (s.status = 'published') desc, s.created_at
  limit 1;
  select p.handle into v_handle from public.user_profiles p where p.user_id = v_uid;

  return jsonb_build_object(
    'author', jsonb_build_object(
      'userId', v_uid::text,
      'handle', v_handle,
      'name', coalesce(v_space.name, case when v_handle is not null then '@' || v_handle end),
      'pageId', v_space.id::text,
      'pageStatus', v_space.status
    ),
    'plan', jsonb_build_object(
      'perYear', 50,
      'perWeek', 1,
      'usedThisYear', (
        select count(*)::integer from public.bok_series_work w
        where w.author_id = v_uid and w.state in ('accepted', 'sent', 'published')
          and w.accepted_at >= date_trunc('year', now())
      )
    ),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id::text,
        'title', r.title,
        'text', r.text,
        'status', r.status,
        'coverRequested', r.cover_requested,
        'coverVersion', r.cover_version,
        'createdAt', r.created_at,
        'updatedAt', r.updated_at,
        'form', coalesce(bw.form, 'poem'),
        'shelvedAt', bw.shelved_at,
        'queuePos', bw.queue_pos,
        'notes', coalesce(bw.notes, '{}'::jsonb),
        'voice', case when v.bok_id is null then null else jsonb_build_object(
          'file', v.file, 'durationMs', v.duration_ms, 'source', v.source, 'name', v.name,
          'at', v.recorded_at, 'current', v.fingerprint = public.boks_voice_fingerprint(r.text)
        ) end,
        'decision', case when d.bok_id is null then null else jsonb_build_object(
          'decision', d.decision, 'kind', d.kind, 'note', d.note, 'at', d.decided_at
        ) end,
        'series', case when sw.bok_id is null then null else jsonb_build_object(
          'state', sw.state, 'acceptedAt', sw.accepted_at, 'sentAt', sw.sent_at, 'publishedAt', sw.published_at,
          'workId', sw.work_id::text, 'revision', aw.revision, 'workStatus', aw.status,
          -- The Series sent to the author, to watch before publishing; null before it is sent.
          'seriesPiece', case when sw.state in ('sent', 'published') then coalesce(aw.series_piece, sw.series_piece) end
        ) end,
        'importedFrom', null
      ) order by r.created_at desc, r.id)
      from (
        select * from public.reels
        where author_user_id = v_uid and status <> 'archived'
        order by created_at desc, id
        limit 200
      ) r
      left join public.bok_workshop bw on bw.bok_id = r.id
      left join public.bok_voices v on v.bok_id = r.id and v.user_id = v_uid
      left join public.bok_editor_decisions d on d.bok_id = r.id
        and ((d.decision = 'changes' and r.status = 'draft') or (d.decision = 'refused' and r.status = 'rejected'))
      left join public.bok_series_work sw on sw.bok_id = r.id and sw.state in ('accepted', 'sent', 'published')
      left join public.author_space_works aw on aw.id = sw.work_id
    ), '[]'::jsonb),
    'ready', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workId', w.id::text, 'revision', w.revision, 'title', w.title, 'format', w.format, 'bokId', w.bok_id::text
      ) order by w.position nulls last, w.ready_at)
      from public.author_space_works w
      where v_space.id is not null and w.space_id = v_space.id and w.status = 'ready'
        and not exists (select 1 from public.bok_series_work s where s.work_id = w.id)
    ), '[]'::jsonb)
  );
end;
$$;

-- Form, «Отложено» and notes of the author's own piece.
create or replace function public.save_my_workshop_meta(p_bok_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_workshop_author();
  v_bok public.reels;
  v_row public.bok_workshop;
  v_problem text;
  v_form text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Say what to change.' using errcode = '22023';
  end if;
  select * into v_bok from public.reels where id = p_bok_id;
  if v_bok.id is null or v_bok.author_user_id is distinct from v_uid or v_bok.status = 'archived' then
    raise exception 'This piece is not yours or no longer exists.' using errcode = '42501';
  end if;
  if p_patch ? 'form' then
    v_form := p_patch ->> 'form';
    if v_form is null or v_form not in ('poem', 'prose') then
      raise exception 'A piece is a poem or prose.' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'shelved' and jsonb_typeof(p_patch -> 'shelved') <> 'boolean' then
    raise exception 'Shelved is yes or no.' using errcode = '22023';
  end if;
  if coalesce((p_patch ->> 'shelved')::boolean, false) then
    if public.boks_in_author_queue(p_bok_id) then
      raise exception 'This piece is with the editors: take it back first, then put it aside.' using errcode = '22023';
    end if;
    if exists (select 1 from public.bok_series_work w where w.bok_id = p_bok_id and w.state in ('accepted', 'sent')) then
      raise exception 'The editors are already making the Boks Series for this piece; it cannot be put aside now.' using errcode = '22023';
    end if;
    if v_bok.status in ('published', 'withdrawn') then
      raise exception 'A published bok is not put aside; hide it from My page instead.' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'notes' then
    v_problem := public.boks_workshop_notes_problem(p_patch -> 'notes');
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;

  insert into public.bok_workshop (bok_id, author_id, form, shelved_at, notes, updated_at)
  values (
    p_bok_id, v_uid,
    coalesce(v_form, 'poem'),
    case when coalesce((p_patch ->> 'shelved')::boolean, false) then now() end,
    coalesce(case when p_patch ? 'notes' then p_patch -> 'notes' end, '{}'::jsonb),
    now()
  )
  on conflict (bok_id) do update
    set form = case when p_patch ? 'form' then excluded.form else public.bok_workshop.form end,
        shelved_at = case
          when not (p_patch ? 'shelved') then public.bok_workshop.shelved_at
          when (p_patch ->> 'shelved')::boolean then coalesce(public.bok_workshop.shelved_at, now())
          else null end,
        notes = case when p_patch ? 'notes' then excluded.notes else public.bok_workshop.notes end,
        updated_at = now()
  returning * into v_row;
  return public.boks_workshop_meta_json(p_bok_id, v_row);
end;
$$;

-- The author's order among their sent pieces: the given ones first, 1..n, in
-- that order; pieces in work are skipped; any other sent piece follows in its
-- old order. Two tabs reordering at once are serialised on the author: the
-- last one wins and the places stay 1..n.
create or replace function public.set_my_queue_order(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_workshop_author();
  v_id uuid;
  v_bok public.reels;
  v_ids uuid[] := '{}';
begin
  if p_ids is null then
    raise exception 'Say the order.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 200 then
    raise exception 'At most 200 pieces in the queue.' using errcode = '22023';
  end if;
  if (select count(*) from unnest(p_ids)) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'A piece appears twice in the order.' using errcode = '22023';
  end if;
  perform 1 from public.user_profiles where user_id = v_uid for update;

  foreach v_id in array p_ids loop
    select * into v_bok from public.reels where id = v_id;
    if v_bok.id is null or v_bok.author_user_id is distinct from v_uid then
      raise exception 'This piece is not yours or no longer exists.' using errcode = '42501';
    end if;
    if exists (select 1 from public.bok_series_work w where w.bok_id = v_id and w.state in ('accepted', 'sent')) then
      continue;
    end if;
    if not (v_bok.status = 'pending_review' and v_bok.cover_requested) then
      raise exception 'Only pieces sent to the editors are put in order: «%» is not sent.', v_bok.title using errcode = '22023';
    end if;
    v_ids := v_ids || v_id;
  end loop;

  -- Everything else still waiting keeps its old order after the given ones.
  v_ids := v_ids || coalesce((
    select array_agg(r.id order by bw.queue_pos nulls last, r.submitted_at, r.id)
    from public.reels r
    left join public.bok_workshop bw on bw.bok_id = r.id
    where r.author_user_id = v_uid and r.status = 'pending_review' and r.cover_requested
      and not (r.id = any(v_ids))
      and not exists (select 1 from public.bok_series_work w where w.bok_id = r.id and w.state in ('accepted', 'sent'))
  ), '{}');

  update public.bok_workshop set queue_pos = null, updated_at = now()
  where author_id = v_uid and queue_pos is not null and not (bok_id = any(v_ids));
  insert into public.bok_workshop (bok_id, author_id, queue_pos, updated_at)
  select x.id, v_uid, x.n::integer, now()
  from unnest(v_ids) with ordinality as x(id, n)
  on conflict (bok_id) do update set queue_pos = excluded.queue_pos, updated_at = now();

  return coalesce((
    select jsonb_agg(jsonb_build_object('bokId', x.id::text, 'queuePos', x.n) order by x.n)
    from unnest(v_ids) with ordinality as x(id, n)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_workshop() from public, anon, authenticated;
revoke all on function public.save_my_workshop_meta(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_my_queue_order(uuid[]) from public, anon, authenticated;
grant execute on function public.get_my_workshop() to authenticated;
grant execute on function public.save_my_workshop_meta(uuid, jsonb) to authenticated;
grant execute on function public.set_my_queue_order(uuid[]) to authenticated;

-- get_boks_admin_snapshot: the review queue carries the author's order and sorts by it, author by author.
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
        coalesce(au.email, '') as author_email,
        bw.queue_pos
      from public.boks_reels r
      left join auth.users au on au.id = r.author_user_id
      left join public.bok_workshop bw on bw.bok_id = r.id
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
        -- Voiced pieces in the author's own order (Workshop queue), author by author.
        (bw.queue_pos is null),
        case when bw.queue_pos is not null then r.author_user_id end,
        bw.queue_pos,
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
          'authorEmail', author_email,
          'queuePos', queue_pos
        ) order by case when status = 'pending_review' then 0 else 1 end, (queue_pos is null),
          case when queue_pos is not null then author_user_id end, queue_pos, submitted_at desc nulls last)
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

-- studio_series_work_list: the author's order beside each piece.
CREATE OR REPLACE FUNCTION public.studio_series_work_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'workStatus', sw.status,
      'queuePos', bw.queue_pos
    ) order by case w.state when 'accepted' then 0 when 'sent' then 1 else 2 end, w.accepted_at)
    from public.bok_series_work w
    join public.reels r on r.id = w.bok_id
    left join public.user_profiles p on p.user_id = w.author_id
    left join public.author_space_works sw on sw.id = w.work_id
    left join public.bok_workshop bw on bw.bok_id = w.bok_id
    where w.state in ('accepted', 'sent')
       or (w.state = 'published' and w.published_at > now() - interval '30 days')
  ), '[]'::jsonb);
end;
$function$;
