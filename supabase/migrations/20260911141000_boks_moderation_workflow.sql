alter table public.reels
  add column if not exists author_user_id uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists review_note text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.reels
  drop constraint if exists reels_status_check;

alter table public.reels
  add constraint reels_status_check
  check (status in ('draft', 'pending_review', 'published', 'rejected', 'archived'));

update public.reels
set
  submitted_at = coalesce(submitted_at, created_at),
  updated_at = coalesce(updated_at, created_at)
where status = 'published';

create index if not exists reels_author_created_idx on public.reels (author_user_id, created_at desc);
create index if not exists reels_status_submitted_idx on public.reels (status, submitted_at desc);
create index if not exists reels_reviewed_by_idx on public.reels (reviewed_by);

drop policy if exists "Authenticated readers can read published reels" on public.reels;
create policy "Authenticated readers can read published reels"
on public.reels
for select
to authenticated
using (
  status = 'published'
  or (
    author_user_id = (select auth.uid())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  )
  or public.is_boks_admin()
);

create or replace function public.submit_bok_for_review(
  p_title text,
  p_author_name text,
  p_author_handle text,
  p_hook text,
  p_text text,
  p_genre text,
  p_mood text,
  p_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_text text := nullif(trim(coalesce(p_text, '')), '');
  v_author_name text := coalesce(nullif(trim(coalesce(p_author_name, '')), ''), 'boks author');
  v_author_handle text := trim(coalesce(p_author_handle, ''));
  v_hook text := trim(coalesce(p_hook, ''));
  v_genre text := coalesce(nullif(trim(coalesce(p_genre, '')), ''), 'literary');
  v_mood text := coalesce(nullif(trim(coalesce(p_mood, '')), ''), 'quiet');
  v_minutes integer := coalesce(p_minutes, 5);
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

  if v_minutes < 1 or v_minutes > 15 then
    raise exception 'A bok must fit inside 15 minutes.' using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile(v_author_name);

  insert into public.reels (
    title,
    author_name,
    author_handle,
    hook,
    text,
    genre,
    mood,
    minutes,
    status,
    author_user_id,
    submitted_at,
    updated_at
  )
  values (
    v_title,
    left(v_author_name, 120),
    left(v_author_handle, 80),
    left(v_hook, 500),
    v_text,
    left(v_genre, 30),
    left(v_mood, 30),
    v_minutes,
    'pending_review',
    v_uid,
    now(),
    now()
  )
  returning * into v_bok;

  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'submittedAt', v_bok.submitted_at
  );
end;
$$;

revoke all on function public.submit_bok_for_review(text, text, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, text, text, integer) to authenticated;

create or replace function public.get_my_bok_submissions(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.get_my_bok_submissions(integer) from public, anon, authenticated;
grant execute on function public.get_my_bok_submissions(integer) to authenticated;

create or replace function public.review_bok_submission(
  p_bok_id uuid,
  p_decision text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_bok public.reels;
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject.' using errcode = '22023';
  end if;

  if v_decision = 'reject' and v_reason = '' then
    raise exception 'Rejection reason is required.' using errcode = '22023';
  end if;

  update public.reels
  set
    status = case when v_decision = 'approve' then 'published' else 'rejected' end,
    reviewed_at = now(),
    reviewed_by = v_caller,
    review_note = case when v_decision = 'approve' then null else left(v_reason, 1000) end,
    updated_at = now()
  where id = p_bok_id
    and status in ('pending_review', 'rejected', 'archived')
  returning * into v_bok;

  if v_bok.id is null then
    raise exception 'Bok is not available for review.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'reviewedAt', v_bok.reviewed_at,
    'reviewNote', v_bok.review_note
  );
end;
$$;

revoke all on function public.review_bok_submission(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_bok_submission(uuid, text, text) to authenticated;

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
      from public.reels r
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
        (select count(*)::integer from public.likes) as total_likes
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
          'commentsCount', 0,
          'comments', 0,
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
