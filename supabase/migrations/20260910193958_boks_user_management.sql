create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Reader',
  role text not null default 'reader' check (role in ('reader', 'admin')),
  preferred_genre text not null default 'literary',
  preferred_mood text not null default 'quiet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_role_created_idx on public.user_profiles (role, created_at desc);
create index if not exists user_profiles_created_idx on public.user_profiles (created_at desc);

alter table public.user_profiles enable row level security;

revoke all on table public.user_profiles from anon, authenticated;
grant select, insert on table public.user_profiles to authenticated;
grant update (display_name, preferred_genre, preferred_mood, updated_at) on table public.user_profiles to authenticated;

create or replace function public.is_boks_admin(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = coalesce(p_user_id, (select auth.uid()))
      and role = 'admin'
  );
$$;

revoke all on function public.is_boks_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_boks_admin(uuid) to authenticated;

drop policy if exists "Readers can read own profile and admins can read profiles" on public.user_profiles;
create policy "Readers can read own profile and admins can read profiles"
on public.user_profiles
for select
to authenticated
using ((select auth.uid()) = user_id or public.is_boks_admin());

drop policy if exists "Permanent readers can create their own profile" on public.user_profiles;
create policy "Permanent readers can create their own profile"
on public.user_profiles
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  and role = 'reader'
);

drop policy if exists "Permanent readers can update their own profile settings" on public.user_profiles;
create policy "Permanent readers can update their own profile settings"
on public.user_profiles
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
)
with check (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

create or replace function public.get_boks_user_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
      'preferredGenre', 'literary',
      'preferredMood', 'quiet',
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
    'displayName', coalesce(up.display_name, 'Reader'),
    'preferredGenre', coalesce(up.preferred_genre, 'literary'),
    'preferredMood', coalesce(up.preferred_mood, 'quiet'),
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
    'preferredGenre', 'literary',
    'preferredMood', 'quiet',
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin'),
    'views', 0,
    'likes', 0
  ));
end;
$$;

revoke all on function public.get_boks_user_context() from public, anon, authenticated;
grant execute on function public.get_boks_user_context() to authenticated;

create or replace function public.ensure_boks_user_profile(p_display_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if v_is_anonymous then
    return public.get_boks_user_context();
  end if;

  insert into public.user_profiles (user_id, display_name)
  values (v_uid, coalesce(nullif(trim(p_display_name), ''), 'Reader'))
  on conflict (user_id) do update
  set
    display_name = case
      when trim(p_display_name) = '' then public.user_profiles.display_name
      else trim(p_display_name)
    end,
    updated_at = now();

  return public.get_boks_user_context();
end;
$$;

revoke all on function public.ensure_boks_user_profile(text) from public, anon, authenticated;
grant execute on function public.ensure_boks_user_profile(text) to authenticated;

create or replace function public.claim_initial_boks_admin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  insert into public.user_profiles (user_id, display_name, role)
  values (v_uid, 'Admin', 'admin')
  on conflict (user_id) do update
  set role = 'admin', updated_at = now();

  return public.get_boks_user_context();
end;
$$;

revoke all on function public.claim_initial_boks_admin() from public, anon, authenticated;
grant execute on function public.claim_initial_boks_admin() to authenticated;

create or replace function public.set_boks_admin_role(p_user_id uuid, p_is_admin boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_target_is_anonymous boolean;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if p_user_id = v_caller and p_is_admin is false then
    raise exception 'Admins cannot remove their own admin access.' using errcode = '42501';
  end if;

  select coalesce(is_anonymous, false)
  into v_target_is_anonymous
  from auth.users
  where id = p_user_id;

  if v_target_is_anonymous is null then
    raise exception 'User does not exist.' using errcode = '22023';
  end if;

  if v_target_is_anonymous then
    raise exception 'Anonymous users cannot become admins.' using errcode = '42501';
  end if;

  if p_is_admin is false and (select count(*) from public.user_profiles where role = 'admin') <= 1 then
    raise exception 'At least one admin must remain.' using errcode = '42501';
  end if;

  insert into public.user_profiles (user_id, role)
  values (p_user_id, case when p_is_admin then 'admin' else 'reader' end)
  on conflict (user_id) do update
  set role = excluded.role, updated_at = now();

  return jsonb_build_object('ok', true, 'userId', p_user_id::text, 'role', case when p_is_admin then 'admin' else 'reader' end);
end;
$$;

revoke all on function public.set_boks_admin_role(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_boks_admin_role(uuid, boolean) to authenticated;

create or replace function public.get_boks_admin_snapshot(
  p_limit integer default 100,
  p_offset integer default 0,
  p_query text default '',
  p_sort text default 'signal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
        (coalesce(v.views, 0) + coalesce(l.likes, 0) * 5) as signal,
        case
          when coalesce(v.views, 0) > 0 then round(coalesce(l.likes, 0) * 100.0 / v.views)
          else 0
        end as like_rate
      from public.reels r
      left join view_rollup v on v.reel_id = r.id
      left join like_rollup l on l.reel_id = r.id
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
        case when p.sort_value = 'signal' then signal end desc,
        signal desc,
        created_at desc
      limit (select limit_value from params)
      offset (select offset_value from params)
    ),
    all_published as (
      select
        count(*)::integer as total_stories,
        (select count(*)::integer from public.views) as total_views,
        (select count(distinct user_id)::integer from public.views) as total_visitors,
        (select count(*)::integer from public.likes) as total_likes
      from public.reels
      where status = 'published'
    ),
    genre_rows as (
      select
        r.genre,
        count(*)::integer as stories,
        coalesce(sum(v.views), 0)::integer as starts,
        coalesce(sum(l.likes), 0)::integer as likes,
        (coalesce(sum(v.views), 0) + coalesce(sum(l.likes), 0) * 5)::integer as signal
      from public.reels r
      left join view_rollup v on v.reel_id = r.id
      left join like_rollup l on l.reel_id = r.id
      where r.status = 'published'
      group by r.genre
      order by starts desc, likes desc, stories desc
    ),
    mood_rows as (
      select
        r.mood,
        count(*)::integer as stories,
        coalesce(sum(v.views), 0)::integer as starts,
        coalesce(sum(l.likes), 0)::integer as likes,
        (coalesce(sum(v.views), 0) + coalesce(sum(l.likes), 0) * 5)::integer as signal
      from public.reels r
      left join view_rollup v on v.reel_id = r.id
      left join like_rollup l on l.reel_id = r.id
      where r.status = 'published'
      group by r.mood
      order by starts desc, likes desc, stories desc
    ),
    recent_events as (
      select 'view' as eventType, reel_id::text as storyId, user_id::text as visitorId, created_at as createdAt
      from public.views
      union all
      select 'like' as eventType, reel_id::text as storyId, user_id::text as visitorId, created_at as createdAt
      from public.likes
      order by createdAt desc
      limit 50
    ),
    user_rows as (
      select
        up.user_id,
        coalesce(au.email, '') as email,
        up.role,
        up.display_name,
        up.created_at,
        coalesce(au.last_sign_in_at, au.created_at) as last_sign_in_at,
        count(distinct v.id)::integer as views,
        count(distinct l.id)::integer as likes
      from public.user_profiles up
      join auth.users au on au.id = up.user_id
      left join public.views v on v.user_id = up.user_id
      left join public.likes l on l.user_id = up.user_id
      where coalesce(au.is_anonymous, false) is false
      group by up.user_id, au.email, up.role, up.display_name, up.created_at, au.last_sign_in_at, au.created_at
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
        'users', (select count(*)::integer from public.user_profiles),
        'admins', (select count(*)::integer from public.user_profiles where role = 'admin')
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
          'commentsCount', 0,
          'comments', 0,
          'avgSeconds', 0,
          'signal', signal,
          'finishRate', like_rate
        ))
        from ordered_stories
      ), '[]'::jsonb),
      'recentEvents', coalesce((select jsonb_agg(to_jsonb(recent_events)) from recent_events), '[]'::jsonb),
      'users', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', user_id::text,
          'email', email,
          'role', role,
          'displayName', display_name,
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
        'description', 'Newest published reels from Supabase with anonymous views and likes.'
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
        'comments', 0,
        'avgReadSeconds', 0,
        'avgSecondsToLike', 0,
        'avgSecondsToComment', 0,
        'avgStartRank', 0,
        'paceIndex', 0,
        'startRate', case when (select total_views from all_published) > 0 then 100 else 0 end,
        'finishRate', 0,
        'reactionRate', case when (select total_views from all_published) > 0 then round((select total_likes from all_published) * 100.0 / (select total_views from all_published)) else 0 end,
        'skipRate', 0,
        'engagementScore', (select total_views + total_likes * 5 from all_published)
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
$$;

revoke all on function public.get_boks_admin_snapshot(integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.get_boks_admin_snapshot(integer, integer, text, text) to authenticated;
