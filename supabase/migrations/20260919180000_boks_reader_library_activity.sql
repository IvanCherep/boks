-- One account-owned library powers three views: boks read, liked, and
-- commented on. Each activity is bounded independently so an old like is not
-- pushed out merely because the reader has opened many newer boks.

create index if not exists views_user_reel_created_idx
  on public.views (user_id, reel_id, created_at desc);

create index if not exists likes_user_created_idx
  on public.likes (user_id, created_at desc, reel_id);

create index if not exists comments_user_reel_created_idx
  on public.comments (user_id, reel_id, created_at desc);

create or replace function public.get_my_reader_library(p_limit integer default 120)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 120), 1), 300);
  v_anonymous boolean := coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false);
begin
  if v_uid is null or v_anonymous then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with read_activity as (
      select v.reel_id, max(v.created_at) as read_at
      from public.views v
      where v.user_id = v_uid
      group by v.reel_id
    ),
    liked_activity as (
      select l.reel_id, l.created_at as liked_at
      from public.likes l
      where l.user_id = v_uid
    ),
    commented_activity as (
      select c.reel_id, max(c.created_at) as commented_at
      from public.comments c
      where c.user_id = v_uid
      group by c.reel_id
    ),
    selected_ids as (
      select reel_id from (
        select reel_id from read_activity order by read_at desc limit v_limit
      ) recent_reads
      union
      select reel_id from (
        select reel_id from liked_activity order by liked_at desc limit v_limit
      ) recent_likes
      union
      select reel_id from (
        select reel_id from commented_activity order by commented_at desc limit v_limit
      ) recent_comments
    ),
    activity as (
      select
        selected_ids.reel_id,
        read_activity.read_at,
        liked_activity.liked_at,
        commented_activity.commented_at
      from selected_ids
      left join read_activity using (reel_id)
      left join liked_activity using (reel_id)
      left join commented_activity using (reel_id)
    )
    select jsonb_agg(jsonb_build_object(
      'storyId', b.id::text,
      'title', b.title,
      'authorName', b.author_name,
      'minutes', b.minutes,
      'readAt', activity.read_at,
      'likedAt', activity.liked_at,
      'commentedAt', activity.commented_at,
      'liked', activity.liked_at is not null,
      'commented', activity.commented_at is not null
    ) order by greatest(
      coalesce(activity.read_at, '-infinity'::timestamptz),
      coalesce(activity.liked_at, '-infinity'::timestamptz),
      coalesce(activity.commented_at, '-infinity'::timestamptz)
    ) desc)
    from activity
    join public.published_boks b on b.id = activity.reel_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_reader_library(integer) from public, anon, authenticated;
grant execute on function public.get_my_reader_library(integer) to authenticated;
