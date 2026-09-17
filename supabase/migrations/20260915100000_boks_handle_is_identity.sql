-- boks: the @handle is the identity, the byline is a pen name
--
-- Two separate ideas had been collapsed into one column called `display_name`:
-- who a person *is*, and what name they want *on a particular piece of work*.
-- Registration asked for both a name and a nickname, which is two questions
-- where readers expect none.
--
-- After this migration:
--
--   * Signing up asks for an email and nothing else. The @handle is derived
--     from the local part of the address, with a random suffix if it is taken,
--     and can be changed later in settings.
--   * The @handle is the identity, everywhere a *person* appears - comments,
--     the People list, the account panel.
--   * `reels.author_name` is the byline on one boks: a pen name, chosen when
--     publishing, defaulting to whatever the author used last time.
--   * `user_profiles.display_name` is gone. Nothing displayed it and nothing
--     defaulted from it once the byline came from the work itself.
--
-- A note on `reels.author_name`, which the previous migration removed for
-- account-backed rows. It returns, but as a different thing. It was a silent
-- snapshot of the profile that drifted out of step with it; it is now authored
-- input that is *supposed* to differ - a writer may publish one piece under a
-- pen name and the next under another, and neither should follow a later change
-- of nickname. What does not return is `reels.author_handle`: a handle is
-- identity, so it is always joined from the profile and never stored twice.

-- ---------------------------------------------- handles come from the email

-- A random suffix rather than a counter: `ilya_2` tells a stranger that an
-- `ilya_1` exists and that they were second, which is nobody's business.
create or replace function public.generate_boks_handle(p_seed text, p_user_id uuid)
returns text
language plpgsql
volatile
as $$
declare
  v_base text := public.normalize_boks_handle(p_seed);
  v_candidate text;
  v_attempt integer := 0;
begin
  if p_user_id is null then
    raise exception 'User id is required for handle generation.' using errcode = '22023';
  end if;

  if v_base is null or char_length(v_base) < 3 then
    v_base := 'reader_' || left(replace(p_user_id::text, '-', ''), 8);
  end if;

  v_base := left(v_base, 24);
  v_candidate := v_base;

  while exists (
    select 1 from public.user_profiles
    where lower(handle) = lower(v_candidate) and user_id <> p_user_id
  ) loop
    v_attempt := v_attempt + 1;
    -- Widens after a few collisions so this always terminates.
    v_candidate :=
      left(v_base, 24 - (case when v_attempt < 6 then 5 else 8 end))
      || '_'
      || lpad(floor(random() * (case when v_attempt < 6 then 10000 else 10000000 end))::text,
              case when v_attempt < 6 then 4 else 7 end, '0');
  end loop;

  return v_candidate;
end;
$$;

grant execute on function public.generate_boks_handle(text, uuid) to authenticated;

-- The local part of the address, which is what a person recognises as theirs.
create or replace function public.boks_handle_seed_from_email(p_email text)
returns text
language sql
immutable
as $$
  select public.normalize_boks_handle(split_part(coalesce(p_email, ''), '@', 1));
$$;

grant execute on function public.boks_handle_seed_from_email(text) to authenticated;

-- Every profile gets one before the column is made mandatory.
update public.user_profiles p
set handle = public.generate_boks_handle(
  public.boks_handle_seed_from_email((select u.email from auth.users u where u.id = p.user_id)),
  p.user_id
)
where p.handle is null;

alter table public.user_profiles
  alter column handle set not null;

-- ------------------------------------------------- the byline is a pen name

update public.reels
set author_name = coalesce(
  nullif(btrim(author_name), ''),
  (select '@' || i.handle from public.boks_public_identity i where i.user_id = reels.author_user_id),
  'boks author'
);

alter table public.reels
  alter column author_name set not null;

-- A handle is identity and is never stored on the work; a byline is authored
-- input and always is.
alter table public.reels
  drop constraint if exists reels_byline_belongs_to_author,
  add constraint reels_handle_is_never_copied check (author_handle is null or author_user_id is null);

comment on column public.reels.author_name is
  'The byline on this boks - a pen name chosen when publishing. Deliberately independent of the author profile: changing your @nickname does not rewrite work you already published.';

-- ------------------------------------------------ identity loses its second name

drop view if exists public.boks_comments;
drop view if exists public.published_boks;
drop view if exists public.boks_reels;
drop view if exists public.boks_public_identity;

alter table public.user_profiles drop column if exists display_name;

create or replace view public.boks_public_identity as
select p.user_id, p.handle
from public.user_profiles p;

revoke all on public.boks_public_identity from public;
grant select on public.boks_public_identity to anon, authenticated;

comment on view public.boks_public_identity is
  'The only published projection of a person: their @handle. A display name no longer exists - a byline belongs to a boks, not to an account.';

create or replace view public.boks_reels as
select
  r.id, r.title, r.hook, r.text, r.genre, r.mood, r.minutes, r.status,
  r.is_seed, r.created_at, r.updated_at, r.author_user_id, r.submitted_at,
  r.reviewed_at, r.reviewed_by, r.review_note, r.word_count, r.reading_shape,
  r.line_break_count,
  r.author_name,
  -- The handle still comes from the profile, so it follows a rename.
  coalesce(i.handle, r.author_handle, '') as author_handle
from public.reels r
left join public.boks_public_identity i on i.user_id = r.author_user_id;

revoke all on public.boks_reels from public, anon, authenticated;

create or replace view public.published_boks as
select
  b.id, b.title, b.author_name, b.author_handle, b.author_user_id, b.hook,
  b.text, b.genre, b.mood, b.minutes, b.word_count, b.reading_shape,
  b.line_break_count, b.created_at
from public.boks_reels b
where b.status = 'published';

revoke all on public.published_boks from public;
grant select on public.published_boks to anon, authenticated;

create or replace view public.boks_comments as
select
  c.id, c.reel_id, c.user_id, c.body, c.created_at,
  coalesce(i.handle, '') as visitor_handle
from public.comments c
join public.reels r on r.id = c.reel_id and r.status = 'published'
left join public.boks_public_identity i on i.user_id = c.user_id;

revoke all on public.boks_comments from public;
grant select on public.boks_comments to anon, authenticated;

-- -------------------------------------------------------------- functions

-- Signing up asks for an email; the handle follows from it.
create or replace function public.ensure_boks_user_profile(p_display_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_email text;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if v_is_anonymous then
    return public.get_boks_user_context();
  end if;

  select email into v_email from auth.users where id = v_uid;

  -- `p_display_name` is accepted and ignored: the argument survives so an older
  -- client cannot fail against a newer database mid-deploy. Drop it later.
  insert into public.user_profiles (user_id, handle)
  values (v_uid, public.generate_boks_handle(public.boks_handle_seed_from_email(v_email), v_uid))
  on conflict (user_id) do update set updated_at = now();

  return public.get_boks_user_context();
end;
$$;

revoke all on function public.ensure_boks_user_profile(text) from public, anon, authenticated;
grant execute on function public.ensure_boks_user_profile(text) to authenticated;

-- Settings changes one thing: the @nickname.
create or replace function public.update_boks_user_profile(
  p_display_name text default '',
  p_handle text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_requested text := public.normalize_boks_handle(p_handle);
  v_email text;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Permanent sign in required.' using errcode = '42501';
  end if;

  if v_requested is not null and char_length(v_requested) < 3 then
    raise exception 'A nickname needs at least 3 characters.' using errcode = '22023';
  end if;

  if v_requested is not null and exists (
    select 1 from public.user_profiles
    where lower(handle) = lower(v_requested) and user_id <> v_uid
  ) then
    raise exception 'That nickname is taken.' using errcode = '23505';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.user_profiles (user_id, handle)
  values (v_uid, coalesce(v_requested, public.generate_boks_handle(public.boks_handle_seed_from_email(v_email), v_uid)))
  on conflict (user_id) do update
  set handle = coalesce(v_requested, public.user_profiles.handle),
      updated_at = now();

  return public.get_boks_user_context();
end;
$$;

revoke all on function public.update_boks_user_profile(text, text) from public, anon, authenticated;
grant execute on function public.update_boks_user_profile(text, text) to authenticated;

create or replace function public.get_boks_user_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_context jsonb;
begin
  if v_uid is null then
    return jsonb_build_object(
      'userId', null,
      'email', null,
      'isAnonymous', true,
      'role', 'reader',
      'displayName', 'Reader',
      'handle', null,
      'preferredGenre', 'literary',
      'preferredMood', 'quiet',
      'termsAcceptedAt', null,
      'termsVersion', null,
      'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
      'views', 0,
      'likes', 0
    );
  end if;

  select jsonb_build_object(
    'userId', v_uid::text,
    'email', au.email,
    'isAnonymous', v_is_anonymous,
    'role', coalesce(up.role, 'reader'),
    'handle', up.handle,
    'preferredGenre', coalesce(up.preferred_genre, 'literary'),
    'preferredMood', coalesce(up.preferred_mood, 'quiet'),
    'termsAcceptedAt', up.terms_accepted_at,
    'termsVersion', up.terms_version,
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
    'views', (select count(*)::integer from public.views where user_id = v_uid),
    'likes', (select count(*)::integer from public.likes where user_id = v_uid)
  )
  into v_context
  from auth.users au
  left join public.user_profiles up on up.user_id = au.id
  where au.id = v_uid;

  return coalesce(v_context, jsonb_build_object(
    'userId', v_uid::text,
    'email', null,
    'isAnonymous', v_is_anonymous,
    'role', 'reader',
    'displayName', 'Reader',
    'handle', null,
    'preferredGenre', 'literary',
    'preferredMood', 'quiet',
    'termsAcceptedAt', null,
    'termsVersion', null,
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
    'views', 0,
    'likes', 0
  ));
end;
$function$;

revoke all on function public.get_boks_user_context() from public, anon, authenticated;
grant execute on function public.get_boks_user_context() to authenticated;

create or replace function public.get_my_followed_authors()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'authorUserId', f.author_user_id::text,
      'authorName', coalesce(p.handle, ''),
      'authorHandle', coalesce(p.handle, ''),
      'followedAt', f.created_at,
      'published', (
        select count(*)::integer from public.reels r
        where r.author_user_id = f.author_user_id and r.status = 'published'
      )
    ) order by f.created_at desc)
    from public.author_follows f
    left join public.user_profiles p on p.user_id = f.author_user_id
    where f.follower_user_id = v_uid
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_my_followed_authors() from public, anon, authenticated;
grant execute on function public.get_my_followed_authors() to authenticated;

create or replace function public.get_boks_author(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_handle text := lower(btrim(ltrim(coalesce(p_handle, ''), '@')));
  v_author_user_id uuid;
  v_name text;
begin
  if v_handle = '' then
    return null;
  end if;

  -- Account-backed authors first; the seeded catalog has no profile to find.
  select i.user_id, i.handle
  into v_author_user_id, v_name
  from public.boks_public_identity i
  where lower(i.handle) = v_handle;

  if v_author_user_id is null then
    select b.author_name into v_name
    from public.published_boks b
    where lower(b.author_handle) = v_handle
    limit 1;
  end if;

  if v_name is null then
    return null;
  end if;

  return jsonb_build_object(
    'authorUserId', coalesce(v_author_user_id::text, ''),
    'authorName', v_name,
    'authorHandle', v_handle,
    'followers', (
      select count(*)::integer from public.author_follows f
      where v_author_user_id is not null and f.author_user_id = v_author_user_id
    ),
    -- Whether the caller follows them, so the sheet opens in the right state
    -- instead of flickering into it.
    'following', v_author_user_id is not null and exists (
      select 1 from public.author_follows f
      where f.author_user_id = v_author_user_id and f.follower_user_id = v_uid
    ),
    'boks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id::text,
        'title', b.title,
        'hook', b.hook,
        'minutes', b.minutes,
        'readingShape', b.reading_shape,
        'createdAt', b.created_at
      ) order by b.created_at desc)
      from public.published_boks b
      where lower(b.author_handle) = v_handle
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_boks_author(p_handle text) from public, anon, authenticated;
grant execute on function public.get_boks_author(p_handle text) to anon, authenticated;

create or replace function public.claim_initial_boks_admin()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Permanent sign in required.' using errcode = '42501';
  end if;

  lock table public.user_profiles in exclusive mode;

  if exists (select 1 from public.user_profiles where role = 'admin') then
    raise exception 'Initial admin already exists.' using errcode = '42501';
  end if;

  insert into public.user_profiles (user_id, role, handle)
  values (
    v_uid,
    'admin',
    public.generate_boks_handle(
      public.boks_handle_seed_from_email((select email from auth.users where id = v_uid)),
      v_uid
    )
  )
  on conflict (user_id) do update
  set role = 'admin', updated_at = now();

  return public.get_boks_user_context();
end;
$function$;

revoke all on function public.claim_initial_boks_admin() from public, anon, authenticated;
grant execute on function public.claim_initial_boks_admin() to authenticated;

create or replace function public.create_bok_comment(p_reel_id uuid, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_anonymous boolean := coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false);
  v_body text := btrim(coalesce(p_body, ''));
  v_handle text;
  v_row public.comments;
begin
  if v_uid is null or v_anonymous then
    raise exception 'Sign in to comment.' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1200 then
    raise exception 'A comment must be between 1 and 1200 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.reels where id = p_reel_id and status = 'published') then
    raise exception 'That boks is not available.' using errcode = '22023';
  end if;

  -- A commenter is identified by their @handle, so make sure they have one.
  -- It is written to the profile, which is the only place it lives.
  select handle
  into v_handle
  from public.user_profiles
  where user_id = v_uid;

  if v_handle is null then
    raise exception 'Create your reading profile before commenting.' using errcode = '42501';
  end if;

  update public.user_profiles
  set handle = v_handle, updated_at = now()
  where user_id = v_uid and handle is null;

  insert into public.comments (user_id, reel_id, body)
  values (v_uid, p_reel_id, v_body)
  returning * into v_row;

  return (
    select jsonb_build_object(
      'id', v_row.id,
      'storyId', v_row.reel_id::text,
      'visitorName', c.visitor_name,
      'visitorHandle', c.visitor_handle,
      'body', v_row.body,
      'createdAt', v_row.created_at
    )
    from public.boks_comments c
    where c.id = v_row.id
  );
end;
$function$;

revoke all on function public.create_bok_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.create_bok_comment(uuid, text) to authenticated;

create or replace function public.get_boks_people(p_limit integer default 50, p_offset integer default 0, p_query text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
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
      select user_id, session_id, reel_id, max(active_seconds) as active_seconds, max(created_at) as last_at
      from public.recommendation_events
      where surface = 'reader'
      group by user_id, session_id, reel_id
    ),
    reader_stats as (
      select
        user_id,
        round(sum(active_seconds) / 60.0)::integer as minutes,
        count(distinct reel_id)::integer as boks_opened,
        count(distinct session_id)::integer as sessions,
        max(last_at) as last_read_at
      from session_reading
      group by user_id
    ),
    finished as (
      select user_id, count(*)::integer as boks_finished
      from public.recommendation_events
      where surface = 'reader' and event_type = 'complete'
      group by user_id
    ),
    people as (
      select
        up.user_id,
        coalesce(au.email, '') as email,
        up.handle,
        up.role,
        up.created_at,
        coalesce(au.last_sign_in_at, au.created_at) as last_sign_in_at,
        coalesce(rs.minutes, 0) as minutes,
        coalesce(rs.boks_opened, 0) as boks_opened,
        coalesce(rs.sessions, 0) as sessions,
        coalesce(f.boks_finished, 0) as boks_finished,
        rs.last_read_at,
        (select algorithm_id from public.recommendation_assignments ra where ra.user_id = up.user_id limit 1) as algorithm_id
      from public.user_profiles up
      join auth.users au on au.id = up.user_id
      left join reader_stats rs on rs.user_id = up.user_id
      left join finished f on f.user_id = up.user_id
      where coalesce(au.is_anonymous, false) is false
        and (
          v_query = ''
          or lower(coalesce(au.email, '')) like '%' || v_query || '%'
          or lower(coalesce(up.handle, '')) like '%' || v_query || '%'
        )
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from people),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', user_id::text,
          'email', email,
          'handle', handle,
          'role', role,
          'displayName', handle,
          'joinedAt', created_at,
          'lastSignInAt', last_sign_in_at,
          'lastReadAt', last_read_at,
          'minutes', minutes,
          'boksOpened', boks_opened,
          'boksFinished', boks_finished,
          'sessions', sessions,
          'algorithmId', algorithm_id
        ) order by minutes desc, created_at desc)
        from (select * from people order by minutes desc, created_at desc limit v_limit offset v_offset) page
      ), '[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.get_boks_people(integer, integer, text) from public, anon, authenticated;
grant execute on function public.get_boks_people(integer, integer, text) to authenticated;

create or replace function public.get_boks_admin_snapshot(p_limit integer default 100, p_offset integer default 0, p_query text default '', p_sort text default 'newest')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
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
    view_rollup as (
      select reel_id, count(*)::integer as views, count(distinct user_id)::integer as viewers
      from public.views
      group by reel_id
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
        coalesce(v.views, 0) as views,
        coalesce(v.viewers, 0) as viewers,
        coalesce(l.likes, 0) as likes,
        coalesce(c.comments, 0) as comments,
        (coalesce(v.views, 0) + coalesce(l.likes, 0) * 5 + coalesce(c.comments, 0) * 6) as signal,
        case
          when coalesce(v.views, 0) > 0 then round(coalesce(l.likes, 0) * 100.0 / v.views)
          else 0
        end as like_rate
      from public.boks_reels r
      left join view_rollup v on v.reel_id = r.id
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
        case when p.sort_value = 'starts' then views end desc,
        case when p.sort_value = 'finish' then like_rate end desc,
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
        (select count(*)::integer from public.views) as total_views,
        (select count(distinct user_id)::integer from public.views) as total_visitors,
        (select count(*)::integer from public.likes) as total_likes,
        (select count(*)::integer from public.comments) as total_comments
      from public.reels
      where status = 'published'
    ),
    moderation_counts as (
      select
        count(*) filter (where status = 'pending_review')::integer as pending_review,
        count(*) filter (where status = 'rejected')::integer as rejected,
        count(*) filter (where status = 'published' and author_user_id is not null)::integer as approved_author_boks
      from public.reels
    ),
    genre_rows as (
      select
        r.genre,
        count(*)::integer as stories,
        coalesce(sum(v.views), 0)::integer as starts,
        coalesce(sum(l.likes), 0)::integer as likes,
        coalesce(sum(c.comments), 0)::integer as comments,
        (coalesce(sum(v.views), 0) + coalesce(sum(l.likes), 0) * 5 + coalesce(sum(c.comments), 0) * 6)::integer as signal
      from public.boks_reels r
      left join view_rollup v on v.reel_id = r.id
      left join like_rollup l on l.reel_id = r.id
      left join comment_rollup c on c.reel_id = r.id
      where r.status = 'published'
      group by r.genre
      order by starts desc, likes desc, comments desc, stories desc
    ),
    mood_rows as (
      select
        r.mood,
        count(*)::integer as stories,
        coalesce(sum(v.views), 0)::integer as starts,
        coalesce(sum(l.likes), 0)::integer as likes,
        coalesce(sum(c.comments), 0)::integer as comments,
        (coalesce(sum(v.views), 0) + coalesce(sum(l.likes), 0) * 5 + coalesce(sum(c.comments), 0) * 6)::integer as signal
      from public.boks_reels r
      left join view_rollup v on v.reel_id = r.id
      left join like_rollup l on l.reel_id = r.id
      left join comment_rollup c on c.reel_id = r.id
      where r.status = 'published'
      group by r.mood
      order by starts desc, likes desc, comments desc, stories desc
    ),
    recent_events as (
      select 'view' as eventType, reel_id::text as storyId, user_id::text as visitorId, created_at as createdAt
      from public.views
      union all
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
        count(distinct v.id)::integer as views,
        count(distinct l.id)::integer as likes
      from public.user_profiles up
      join auth.users au on au.id = up.user_id
      left join public.views v on v.user_id = up.user_id
      left join public.likes l on l.user_id = up.user_id
      where coalesce(au.is_anonymous, false) is false
      group by up.user_id, au.email, up.handle, up.role, up.created_at, au.last_sign_in_at, au.created_at
      order by up.created_at desc
      limit 200
    )
    select jsonb_build_object(
      'funnel', jsonb_build_object(
        'totalStories', (select total_stories from all_published),
        'visitors', (select total_visitors from all_published),
        'impressions', (select total_views from all_published),
        'starts', (select total_views from all_published),
        'completes', 0,
        'likes', (select total_likes from all_published),
        'shares', 0,
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
          'shares', 0,
          'starts', views,
          'completes', 0,
          'commentsCount', comments,
          'comments', comments,
          'avgSeconds', 0,
          'signal', signal,
          'finishRate', like_rate
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
          'views', views,
          'likes', likes
        ))
        from user_rows
      ), '[]'::jsonb),
      'genres', coalesce((select jsonb_agg(to_jsonb(genre_rows)) from genre_rows), '[]'::jsonb),
      'moods', coalesce((select jsonb_agg(to_jsonb(mood_rows)) from mood_rows), '[]'::jsonb),
      'algorithms', jsonb_build_array(jsonb_build_object(
        'id', 'supabase_recent',
        'name', 'Supabase recent',
        'description', 'Newest published boks from Supabase with anonymous views, signed-in likes, and comments.'
      )),
      'algorithmMetrics', jsonb_build_array(jsonb_build_object(
        'algorithmId', 'supabase_recent',
        'userSegment', 'mixed',
        'visitors', (select total_visitors from all_published),
        'impressions', (select total_views from all_published),
        'starts', (select total_views from all_published),
        'completes', 0,
        'likes', (select total_likes from all_published),
        'shares', 0,
        'skips', 0,
        'comments', (select total_comments from all_published),
        'avgReadSeconds', 0,
        'avgSecondsToLike', 0,
        'avgSecondsToComment', 0,
        'avgStartRank', 0,
        'paceIndex', 0,
        'startRate', case when (select total_views from all_published) > 0 then 100 else 0 end,
        'finishRate', 0,
        'reactionRate', case when (select total_views from all_published) > 0 then round(((select total_likes from all_published) + (select total_comments from all_published)) * 100.0 / (select total_views from all_published)) else 0 end,
        'skipRate', 0,
        'engagementScore', (select total_views + total_likes * 5 + total_comments * 6 from all_published)
      )),
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

revoke all on function public.get_boks_admin_snapshot(integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.get_boks_admin_snapshot(integer, integer, text, text) to authenticated;


-- ------------------------------------------------ the byline when publishing

-- What to put in the byline field before the author touches it: whatever they
-- published under last time, falling back to their @nickname. A first-time
-- author therefore sees something sensible rather than an empty box.
create or replace function public.get_my_default_author_name()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
begin
  if v_uid is null then
    return null;
  end if;

  -- `id` breaks the tie so the answer is deterministic when two boks share a
  -- timestamp, which happens whenever they are written in one transaction.
  select r.author_name into v_name
  from public.reels r
  where r.author_user_id = v_uid and btrim(coalesce(r.author_name, '')) <> ''
  order by coalesce(r.submitted_at, r.created_at) desc, r.id desc
  limit 1;

  if v_name is not null then
    return v_name;
  end if;

  select '@' || handle into v_name from public.user_profiles where user_id = v_uid;
  return coalesce(v_name, 'boks author');
end;
$$;

revoke all on function public.get_my_default_author_name() from public, anon, authenticated;
grant execute on function public.get_my_default_author_name() to authenticated;

drop function if exists public.submit_bok_for_review(text, text, text, text, text, integer);

create or replace function public.submit_bok_for_review(
  p_title text,
  p_hook text,
  p_text text,
  p_genre text,
  p_mood text,
  p_minutes integer,
  p_author_name text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_text text := nullif(trim(coalesce(p_text, '')), '');
  v_hook text := trim(coalesce(p_hook, ''));
  v_genre text := coalesce(nullif(trim(coalesce(p_genre, '')), ''), 'literary');
  v_mood text := coalesce(nullif(trim(coalesce(p_mood, '')), ''), 'quiet');
  v_words integer;
  v_limit integer := public.boks_daily_submission_limit();
  v_used integer;
  v_author_name text;
  v_author_handle text;
  v_bok public.reels;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required to submit a bok.' using errcode = '42501';
  end if;

  if v_title is null then
    raise exception 'Title is required.' using errcode = '22023';
  end if;

  if v_text is null then
    raise exception 'Story text is required.' using errcode = '22023';
  end if;

  v_words := public.boks_word_count(v_text);

  if v_words > 15 * 238 then
    raise exception 'A bok must fit inside 15 minutes. This one is % words, about % minutes.',
      v_words, ceil(v_words / 238.0)::integer using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile('');

  -- Held for the duration so the daily-limit check below is serialised per
  -- author.
  perform 1 from public.user_profiles where user_id = v_uid for update;

  -- The byline for this piece. An author may publish under a pen name, and a
  -- different one next time; what they used last is only the default.
  v_author_name := left(nullif(btrim(coalesce(p_author_name, '')), ''), 120);
  if v_author_name is null then
    v_author_name := public.get_my_default_author_name();
  end if;

  v_used := public.count_my_boks_submitted_today();

  if v_used >= v_limit then
    raise exception 'Daily limit reached. You can submit % boks a day.', v_limit using errcode = '54023';
  end if;

  insert into public.reels (
    title, author_name, hook, text, genre, mood, minutes,
    status, author_user_id, submitted_at, updated_at
  )
  values (
    v_title, v_author_name, left(v_hook, 500), v_text,
    left(v_genre, 30), left(v_mood, 30), public.boks_reading_minutes(v_words),
    'pending_review', v_uid, now(), now()
  )
  returning * into v_bok;

  select author_handle into v_author_handle from public.boks_reels where id = v_bok.id;

  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'authorName', v_author_name,
    'authorHandle', v_author_handle,
    'minutes', v_bok.minutes,
    'wordCount', v_bok.word_count,
    'submittedAt', v_bok.submitted_at,
    'quota', public.get_my_bok_quota()
  );
end;
$function$;

revoke all on function public.submit_bok_for_review(text, text, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, integer, text) to authenticated;


-- The byline a submission was written under, so reworking a rejected piece
-- does not silently republish it under a different name.
create or replace function public.get_my_bok_submissions(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  if v_uid is null or v_is_anonymous then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id::text,
      'title', r.title,
      'hook', r.hook,
      'body', r.text,
      'genre', r.genre,
      'mood', r.mood,
      'authorName', r.author_name,
      'minutes', r.minutes,
      'status', r.status,
      'submittedAt', r.submitted_at,
      'reviewedAt', r.reviewed_at,
      'reviewNote', r.review_note,
      'createdAt', r.created_at
    ) order by r.created_at desc)
    from (
      select *
      from public.reels
      where author_user_id = v_uid
      order by created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) r
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_my_bok_submissions(integer) from public, anon, authenticated;
grant execute on function public.get_my_bok_submissions(integer) to authenticated;
