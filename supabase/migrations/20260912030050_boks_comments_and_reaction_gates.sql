create table if not exists public.comments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reel_id uuid not null references public.reels(id) on delete cascade,
  visitor_name text not null default 'Reader',
  body text not null,
  created_at timestamptz not null default now(),
  constraint comments_body_length check (char_length(btrim(body)) between 1 and 1200)
);

create index if not exists comments_reel_created_idx on public.comments (reel_id, created_at desc);
create index if not exists comments_user_created_idx on public.comments (user_id, created_at desc);

alter table public.comments enable row level security;

revoke all on table public.comments from anon, authenticated;
grant select on table public.comments to authenticated;

drop policy if exists "Readers can read comments on published reels" on public.comments;
create policy "Readers can read comments on published reels"
on public.comments
for select
to authenticated
using (
  exists (
    select 1
    from public.reels r
    where r.id = comments.reel_id
      and (
        r.status = 'published'
        or public.is_boks_admin()
      )
  )
);

drop policy if exists "Authenticated readers can create their own likes" on public.likes;
create policy "Authenticated readers can create their own likes"
on public.likes
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

drop policy if exists "Authenticated readers can update their own likes" on public.likes;
create policy "Authenticated readers can update their own likes"
on public.likes
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

drop policy if exists "Authenticated readers can delete their own likes" on public.likes;
create policy "Authenticated readers can delete their own likes"
on public.likes
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

create or replace function public.create_bok_comment(
  p_reel_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_name text;
  v_comment public.comments;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign up or sign in to comment.' using errcode = '42501';
  end if;

  if v_body is null then
    raise exception 'Write a comment before sending.' using errcode = '22023';
  end if;

  if char_length(v_body) > 1200 then
    raise exception 'Comments must be 1200 characters or fewer.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.reels
    where id = p_reel_id
      and status = 'published'
  ) then
    raise exception 'This boks is not available for comments.' using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile('');

  select coalesce(nullif(btrim(display_name), ''), 'Reader')
  into v_name
  from public.user_profiles
  where user_id = v_uid;

  insert into public.comments (user_id, reel_id, visitor_name, body)
  values (v_uid, p_reel_id, left(coalesce(v_name, 'Reader'), 120), v_body)
  returning * into v_comment;

  return jsonb_build_object(
    'id', v_comment.id,
    'storyId', v_comment.reel_id::text,
    'visitorName', v_comment.visitor_name,
    'body', v_comment.body,
    'createdAt', v_comment.created_at
  );
end;
$$;

revoke all on function public.create_bok_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.create_bok_comment(uuid, text) to authenticated;

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
      from public.reels r
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
      from public.reels r
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
      from public.reels r
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
$$;

revoke all on function public.get_boks_admin_snapshot(integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.get_boks_admin_snapshot(integer, integer, text, text) to authenticated;
