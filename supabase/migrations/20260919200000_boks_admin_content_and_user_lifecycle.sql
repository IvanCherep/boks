-- Admin lifecycle controls for boks and permanent accounts.
--
-- A boks is archived first and remains available to admins. Physical deletion
-- is a second, explicit action. Accounts can be suspended without destroying
-- their history, or deleted after their authored boks have been anonymised and
-- archived. A UUID-only tombstone blocks a deleted account's already-issued
-- JWT until it expires without retaining email or profile data.

alter table public.reels
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

update public.reels
set archived_at = coalesce(reviewed_at, updated_at, created_at),
    archive_reason = coalesce(nullif(btrim(review_note), ''), 'Removed before archive details were recorded.')
where status = 'archived' and archived_at is null;

create index if not exists reels_archived_at_idx
  on public.reels (archived_at desc)
  where status = 'archived';

alter table public.user_profiles
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by uuid references auth.users(id) on delete set null,
  add column if not exists ban_reason text;

create index if not exists user_profiles_banned_idx
  on public.user_profiles (banned_at desc)
  where banned_at is not null;

create table if not exists public.deleted_boks_users (
  user_id uuid primary key,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references auth.users(id) on delete set null
);

comment on table public.deleted_boks_users is
  'UUID-only account deletion tombstones. They block stale JWTs without retaining email or profile data.';

alter table public.deleted_boks_users enable row level security;
revoke all on table public.deleted_boks_users from public, anon, authenticated;

create or replace function public.is_boks_user_blocked(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.user_id = coalesce(p_user_id, (select auth.uid()))
      and p.banned_at is not null
  ) or exists (
    select 1
    from public.deleted_boks_users d
    where d.user_id = coalesce(p_user_id, (select auth.uid()))
  );
$$;

revoke all on function public.is_boks_user_blocked(uuid) from public, anon, authenticated;
grant execute on function public.is_boks_user_blocked(uuid) to authenticated;

create or replace function public.is_boks_admin(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.user_id = coalesce(p_user_id, (select auth.uid()))
      and p.role = 'admin'
      and p.banned_at is null
  ) and not exists (
    select 1
    from public.deleted_boks_users d
    where d.user_id = coalesce(p_user_id, (select auth.uid()))
  );
$$;

revoke all on function public.is_boks_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_boks_admin(uuid) to authenticated;

create or replace function public.reject_blocked_boks_user_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and public.is_boks_user_blocked((select auth.uid())) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.reject_blocked_boks_user_mutation() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['likes', 'comments', 'comment_likes', 'author_follows', 'bok_reports', 'reels']
  loop
    execute format('drop trigger if exists reject_blocked_boks_user_mutation on public.%I', v_table);
    execute format(
      'create trigger reject_blocked_boks_user_mutation before insert or update or delete on public.%I for each row execute function public.reject_blocked_boks_user_mutation()',
      v_table
    );
  end loop;
end $$;

create or replace function public.set_boks_admin_role(p_user_id uuid, p_is_admin boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_target_is_anonymous boolean;
  v_target_role text;
  v_target_email text;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  lock table public.user_profiles in share row exclusive mode;

  select coalesce(au.is_anonymous, false), p.role, au.email
  into v_target_is_anonymous, v_target_role, v_target_email
  from auth.users au
  left join public.user_profiles p on p.user_id = au.id
  where au.id = p_user_id;

  if v_target_is_anonymous is null then
    raise exception 'User does not exist.' using errcode = '22023';
  end if;
  if v_target_is_anonymous then
    raise exception 'Anonymous users cannot become admins.' using errcode = '42501';
  end if;
  if p_is_admin and public.is_boks_user_blocked(p_user_id) then
    raise exception 'Unban this account before granting admin access.' using errcode = '42501';
  end if;
  if p_user_id = v_caller and not p_is_admin then
    raise exception 'Admins cannot remove their own admin access.' using errcode = '42501';
  end if;
  if not p_is_admin and v_target_role = 'admin'
     and (select count(*) from public.user_profiles where role = 'admin' and banned_at is null) <= 1 then
    raise exception 'At least one active admin must remain.' using errcode = '42501';
  end if;

  insert into public.user_profiles (user_id, role, handle)
  values (
    p_user_id,
    case when p_is_admin then 'admin' else 'reader' end,
    public.generate_boks_handle(public.boks_handle_seed_from_email(v_target_email), p_user_id)
  )
  on conflict (user_id) do update
  set role = excluded.role, updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'userId', p_user_id::text,
    'role', case when p_is_admin then 'admin' else 'reader' end
  );
end;
$$;

revoke all on function public.set_boks_admin_role(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_boks_admin_role(uuid, boolean) to authenticated;

create or replace function public.set_boks_user_ban(
  p_user_id uuid,
  p_banned boolean,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_role text;
  v_is_anonymous boolean;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if p_user_id = v_caller then
    raise exception 'Admins cannot suspend their own account.' using errcode = '42501';
  end if;

  select coalesce(au.is_anonymous, false), p.role
  into v_is_anonymous, v_role
  from auth.users au
  left join public.user_profiles p on p.user_id = au.id
  where au.id = p_user_id;

  if v_is_anonymous is null or v_is_anonymous then
    raise exception 'A permanent user account is required.' using errcode = '22023';
  end if;
  if v_role = 'admin' then
    raise exception 'Revoke admin access before suspending this account.' using errcode = '42501';
  end if;
  if coalesce(p_banned, false) and v_reason is null then
    raise exception 'Give the user a reason for the suspension.' using errcode = '22023';
  end if;

  update public.user_profiles
  set banned_at = case when p_banned then now() else null end,
      banned_by = case when p_banned then v_caller else null end,
      ban_reason = case when p_banned then v_reason else null end,
      updated_at = now()
  where user_id = p_user_id;

  if not found then
    raise exception 'User profile does not exist.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'ok', true,
    'userId', p_user_id::text,
    'banned', coalesce(p_banned, false),
    'reason', case when p_banned then v_reason else null end
  );
end;
$$;

revoke all on function public.set_boks_user_ban(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_boks_user_ban(uuid, boolean, text) to authenticated;

create or replace function public.delete_boks_user(p_user_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_handle text;
  v_role text;
  v_is_anonymous boolean;
  v_archived integer;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if p_user_id = v_caller then
    raise exception 'Admins cannot delete their own account.' using errcode = '42501';
  end if;

  select coalesce(au.is_anonymous, false), p.role, p.handle
  into v_is_anonymous, v_role, v_handle
  from auth.users au
  left join public.user_profiles p on p.user_id = au.id
  where au.id = p_user_id;

  if v_is_anonymous is null or v_is_anonymous then
    raise exception 'A permanent user account is required.' using errcode = '22023';
  end if;
  if v_role = 'admin' then
    raise exception 'Revoke admin access before deleting this account.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_confirm, '')) <> coalesce(v_handle, p_user_id::text) then
    raise exception 'Type the user nickname exactly to confirm deletion.' using errcode = '22023';
  end if;

  update public.reels
  set status = 'archived',
      archived_at = now(),
      archived_by = v_caller,
      archive_reason = 'Author account deleted by an administrator.',
      review_note = 'Author account deleted by an administrator.',
      author_user_id = null,
      author_name = 'Deleted author',
      author_handle = null,
      updated_at = now()
  where author_user_id = p_user_id;
  get diagnostics v_archived = row_count;

  insert into public.deleted_boks_users (user_id, deleted_by)
  values (p_user_id, v_caller)
  on conflict (user_id) do update
  set deleted_at = now(), deleted_by = excluded.deleted_by;

  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'User does not exist.' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'userId', p_user_id::text, 'archivedBoks', v_archived);
end;
$$;

revoke all on function public.delete_boks_user(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_boks_user(uuid, text) to authenticated;

create or replace function public.archive_bok(p_reel_id uuid, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_reason text := coalesce(nullif(left(btrim(coalesce(p_reason, '')), 500), ''), 'Removed by an administrator.');
  v_title text;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  update public.reels
  set status = 'archived',
      archived_at = now(),
      archived_by = v_caller,
      archive_reason = v_reason,
      review_note = v_reason,
      updated_at = now()
  where id = p_reel_id and status <> 'archived'
  returning title into v_title;

  if v_title is null then
    raise exception 'Boks does not exist or is already deleted.' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'id', p_reel_id::text, 'title', v_title, 'status', 'archived');
end;
$$;

revoke all on function public.archive_bok(uuid, text) from public, anon, authenticated;
grant execute on function public.archive_bok(uuid, text) to authenticated;

create or replace function public.restore_archived_bok(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_title text;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  update public.reels
  set status = 'published',
      archived_at = null,
      archived_by = null,
      archive_reason = null,
      review_note = null,
      reviewed_at = now(),
      reviewed_by = v_caller,
      updated_at = now()
  where id = p_reel_id and status = 'archived'
    and exists (
      select 1 from public.bok_rights rights
      where rights.reel_id = p_reel_id and rights.confirmed
    )
  returning title into v_title;

  if v_title is null then
    if exists (select 1 from public.reels where id = p_reel_id and status = 'archived') then
      raise exception 'Confirm publishing rights before restoring this boks.' using errcode = '42501';
    end if;
    raise exception 'Only a deleted boks can be restored.' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'id', p_reel_id::text, 'title', v_title, 'status', 'published');
end;
$$;

revoke all on function public.restore_archived_bok(uuid) from public, anon, authenticated;
grant execute on function public.restore_archived_bok(uuid) to authenticated;

create or replace function public.delete_archived_bok(p_reel_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_title text;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select title into v_title
  from public.reels
  where id = p_reel_id and status = 'archived'
  for update;

  if v_title is null then
    raise exception 'Only a deleted boks can be permanently deleted.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_confirm, '')) <> v_title then
    raise exception 'Type the boks title exactly to confirm permanent deletion.' using errcode = '22023';
  end if;

  delete from public.reels where id = p_reel_id;
  return jsonb_build_object('ok', true, 'id', p_reel_id::text, 'title', v_title, 'permanentlyDeleted', true);
end;
$$;

revoke all on function public.delete_archived_bok(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_archived_bok(uuid, text) to authenticated;

create or replace function public.get_boks_people(
  p_limit integer default 50,
  p_offset integer default 0,
  p_query text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := lower(coalesce(p_query, ''));
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with session_reading as (
      select e.user_id, e.session_id, e.reel_id, max(e.active_seconds) as active_seconds, max(e.created_at) as last_at
      from public.recommendation_events e
      where e.surface = 'reader'
      group by e.user_id, e.session_id, e.reel_id
    ),
    reader_stats as (
      select s.user_id, round(sum(s.active_seconds) / 60.0)::integer as minutes,
        count(distinct s.reel_id)::integer as boks_opened,
        count(distinct s.session_id)::integer as sessions, max(s.last_at) as last_read_at
      from session_reading s group by s.user_id
    ),
    finished as (
      select e.user_id, count(*)::integer as boks_finished
      from public.recommendation_events e
      where e.surface = 'reader' and e.event_type = 'complete'
      group by e.user_id
    ),
    people as (
      select p.user_id, coalesce(u.email, '') as email, p.handle, p.role, p.created_at,
        coalesce(u.last_sign_in_at, u.created_at) as last_sign_in_at,
        coalesce(rs.minutes, 0) as minutes, coalesce(rs.boks_opened, 0) as boks_opened,
        coalesce(rs.sessions, 0) as sessions, coalesce(f.boks_finished, 0) as boks_finished,
        rs.last_read_at, p.banned_at, p.ban_reason,
        (select ra.algorithm_id from public.recommendation_assignments ra where ra.user_id = p.user_id limit 1) as algorithm_id
      from public.user_profiles p
      join auth.users u on u.id = p.user_id
      left join reader_stats rs on rs.user_id = p.user_id
      left join finished f on f.user_id = p.user_id
      where coalesce(u.is_anonymous, false) is false
        and (v_query = '' or lower(coalesce(u.email, '')) like '%' || v_query || '%'
          or lower(coalesce(p.handle, '')) like '%' || v_query || '%')
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from people),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', page.user_id::text, 'email', page.email, 'handle', page.handle,
          'role', page.role, 'displayName', page.handle, 'joinedAt', page.created_at,
          'lastSignInAt', page.last_sign_in_at, 'lastReadAt', page.last_read_at,
          'minutes', page.minutes, 'boksOpened', page.boks_opened,
          'boksFinished', page.boks_finished, 'sessions', page.sessions,
          'algorithmId', page.algorithm_id, 'bannedAt', page.banned_at,
          'banReason', page.ban_reason
        ) order by page.minutes desc, page.created_at desc)
        from (select * from people order by minutes desc, created_at desc limit v_limit offset v_offset) page
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_boks_people(integer, integer, text) from public, anon, authenticated;
grant execute on function public.get_boks_people(integer, integer, text) to authenticated;

-- The fifth argument has a default so existing four-argument callers keep
-- working. Drop the old signature first or Postgres cannot choose an overload.
drop function if exists public.get_boks_content(integer, integer, text, text);

create or replace function public.get_boks_content(
  p_limit integer default 100,
  p_offset integer default 0,
  p_query text default '',
  p_sort text default 'minutes',
  p_status text default 'published'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := lower(coalesce(p_query, ''));
  v_sort text := coalesce(nullif(btrim(p_sort), ''), 'minutes');
  v_status text := case when p_status = 'archived' then 'archived' else 'published' end;
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with session_reading as (
      select e.reel_id, e.session_id, max(e.active_seconds) as active_seconds
      from public.recommendation_events e where e.surface = 'reader'
      group by e.reel_id, e.session_id
    ),
    reading as (
      select s.reel_id, round(sum(s.active_seconds) / 60.0)::integer as minutes
      from session_reading s group by s.reel_id
    ),
    outcomes as (
      select e.reel_id,
        count(*) filter (where e.event_type = 'start')::integer as starts,
        count(*) filter (where e.event_type = 'complete')::integer as completes,
        count(*) filter (where e.event_type = 'skip')::integer as skips,
        count(distinct e.user_id)::integer as readers
      from public.recommendation_events e where e.surface = 'reader' group by e.reel_id
    ),
    like_counts as (select l.reel_id, count(*)::integer as likes from public.likes l group by l.reel_id),
    comment_counts as (select c.reel_id, count(*)::integer as comments from public.comments c group by c.reel_id),
    rows as (
      select r.id, r.title,
        coalesce(nullif(btrim(r.author_name), ''), 'boks author') as author_name,
        coalesce(i.handle, r.author_handle, '') as author_handle,
        r.genre, r.mood, r.minutes as estimated_minutes, r.word_count, r.created_at,
        r.status, r.archived_at, r.archive_reason, archive_admin.handle as archived_by,
        coalesce(rd.minutes, 0) as minutes, coalesce(o.readers, 0) as readers,
        coalesce(o.starts, 0) as starts, coalesce(o.completes, 0) as completes,
        coalesce(o.skips, 0) as skips, coalesce(l.likes, 0) as likes,
        coalesce(c.comments, 0) as comments,
        case when coalesce(o.starts, 0) > 0
          then round(coalesce(o.completes, 0) * 100.0 / o.starts)::integer else null end as finish_rate
      from public.reels r
      left join public.boks_public_identity i on i.user_id = r.author_user_id
      left join public.user_profiles archive_admin on archive_admin.user_id = r.archived_by
      left join reading rd on rd.reel_id = r.id
      left join outcomes o on o.reel_id = r.id
      left join like_counts l on l.reel_id = r.id
      left join comment_counts c on c.reel_id = r.id
      where r.status = v_status
        and (v_query = '' or lower(r.title) like '%' || v_query || '%'
          or lower(coalesce(r.author_name, '')) like '%' || v_query || '%'
          or lower(coalesce(i.handle, r.author_handle, '')) like '%' || v_query || '%'
          or lower(r.genre) like '%' || v_query || '%' or lower(r.mood) like '%' || v_query || '%')
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from rows),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(page) - 'sort_rank' order by page.sort_rank)
        from (
          select id::text as "id", title, author_name as "authorName", author_handle as "authorHandle",
            genre, mood, estimated_minutes as "estimatedMinutes", word_count as "wordCount",
            minutes, readers, starts, completes, skips, likes, comments, finish_rate as "finishRate",
            status, archived_at as "archivedAt", archive_reason as "archiveReason", archived_by as "archivedBy",
            row_number() over (order by
              case when v_status = 'archived' then archived_at end desc nulls last,
              case when v_sort = 'minutes' then minutes end desc nulls last,
              case when v_sort = 'readers' then readers end desc nulls last,
              case when v_sort = 'finish' then finish_rate end desc nulls last,
              case when v_sort = 'newest' then extract(epoch from created_at) end desc nulls last,
              case when v_sort = 'title' then lower(title) end asc nulls last,
              minutes desc, created_at desc) as sort_rank
          from rows
        ) page
        where page.sort_rank > v_offset and page.sort_rank <= v_offset + v_limit
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_boks_content(integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.get_boks_content(integer, integer, text, text, text) to authenticated;

create or replace function public.get_boks_user_context()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_context jsonb;
begin
  if v_uid is null then
    return jsonb_build_object(
      'userId', null, 'email', null, 'isAnonymous', true, 'role', 'reader',
      'handle', null, 'preferredGenre', 'literary', 'preferredMood', 'quiet',
      'termsAcceptedAt', null, 'termsVersion', null,
      'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin' and banned_at is null),
      'views', 0, 'likes', 0, 'readingLanguages', array[]::text[],
      'languageCoverage', public.boks_language_coverage(), 'bannedAt', null, 'banReason', null
    );
  end if;

  select jsonb_build_object(
    'userId', v_uid::text, 'email', u.email, 'isAnonymous', v_is_anonymous,
    'role', coalesce(p.role, 'reader'), 'handle', p.handle,
    'preferredGenre', coalesce(p.preferred_genre, 'literary'),
    'preferredMood', coalesce(p.preferred_mood, 'quiet'),
    'termsAcceptedAt', p.terms_accepted_at, 'termsVersion', p.terms_version,
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin' and banned_at is null),
    'views', (select count(*)::integer from public.views where user_id = v_uid),
    'likes', (select count(*)::integer from public.likes where user_id = v_uid),
    'readingLanguages', coalesce(p.reading_languages, array[]::text[]),
    'languageCoverage', public.boks_language_coverage(),
    'bannedAt', p.banned_at, 'banReason', p.ban_reason
  ) into v_context
  from auth.users u left join public.user_profiles p on p.user_id = u.id
  where u.id = v_uid;

  return coalesce(v_context, jsonb_build_object(
    'userId', v_uid::text, 'email', null, 'isAnonymous', v_is_anonymous,
    'role', 'reader', 'handle', null, 'preferredGenre', 'literary', 'preferredMood', 'quiet',
    'termsAcceptedAt', null, 'termsVersion', null, 'hasAnyAdmin', true,
    'views', 0, 'likes', 0, 'readingLanguages', array[]::text[],
    'languageCoverage', public.boks_language_coverage(),
    'bannedAt', case when public.is_boks_user_blocked(v_uid) then now() else null end,
    'banReason', case when public.is_boks_user_blocked(v_uid) then 'This account was deleted.' else null end
  ));
end;
$$;

revoke all on function public.get_boks_user_context() from public, anon, authenticated;
grant execute on function public.get_boks_user_context() to anon, authenticated;
