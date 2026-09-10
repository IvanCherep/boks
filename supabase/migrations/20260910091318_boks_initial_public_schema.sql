create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
      and p.pronargs = 0
  ) then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author_name text not null default 'boks',
  author_handle text not null default '',
  hook text not null default '',
  text text not null,
  genre text not null default 'literary',
  mood text not null default 'quiet',
  minutes integer not null default 5 check (minutes between 1 and 15),
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  is_seed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.views (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reel_id uuid not null references public.reels(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.likes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reel_id uuid not null references public.reels(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint likes_user_reel_unique unique (user_id, reel_id)
);

create index if not exists reels_status_created_idx on public.reels (status, created_at desc);
create index if not exists reels_mood_genre_idx on public.reels (mood, genre);
create index if not exists views_user_id_idx on public.views (user_id);
create index if not exists views_reel_id_idx on public.views (reel_id);
create index if not exists views_reel_created_idx on public.views (reel_id, created_at desc);
create index if not exists likes_user_id_idx on public.likes (user_id);
create index if not exists likes_reel_id_idx on public.likes (reel_id);
create index if not exists likes_reel_created_idx on public.likes (reel_id, created_at desc);

alter table public.reels enable row level security;
alter table public.views enable row level security;
alter table public.likes enable row level security;

revoke all on table public.reels from anon, authenticated;
revoke all on table public.views from anon, authenticated;
revoke all on table public.likes from anon, authenticated;

grant select on table public.reels to authenticated;
grant insert, select on table public.views to authenticated;
grant insert, select, update, delete on table public.likes to authenticated;

drop policy if exists "Authenticated readers can read published reels" on public.reels;
create policy "Authenticated readers can read published reels"
on public.reels
for select
to authenticated
using (status = 'published');

drop policy if exists "Authenticated readers can create their own views" on public.views;
create policy "Authenticated readers can create their own views"
on public.views
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Authenticated readers can read their own views" on public.views;
create policy "Authenticated readers can read their own views"
on public.views
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Authenticated readers can create their own likes" on public.likes;
create policy "Authenticated readers can create their own likes"
on public.likes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Authenticated readers can read their own likes" on public.likes;
create policy "Authenticated readers can read their own likes"
on public.likes
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Authenticated readers can update their own likes" on public.likes;
create policy "Authenticated readers can update their own likes"
on public.likes
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Authenticated readers can delete their own likes" on public.likes;
create policy "Authenticated readers can delete their own likes"
on public.likes
for delete
to authenticated
using ((select auth.uid()) = user_id);

insert into public.reels (id, title, author_name, author_handle, hook, text, genre, mood, minutes, status, is_seed)
values
  (
    '0f1de0ea-02e6-4dcb-8dff-1e79c7dd8db1',
    'After the Platform',
    'Mira Vale',
    '@miravale',
    'A delayed train, one folded letter, and a stranger who knows the ending.',
    'The train stopped between stations, exactly where the city lights thinned into warehouse windows. Lena was the only person who noticed the envelope sliding under the carriage door.

It was addressed to seat 12A. Her seat.

Inside, in handwriting too careful to be casual, someone had written: Do not get off at the next station. The woman in the red coat has already read your apology.

Lena looked up. Three rows away, a woman in a red coat folded a newspaper and smiled as if they had just reached the best paragraph.',
    'mystery',
    'tense',
    7,
    'published',
    true
  ),
  (
    '9b2c97a4-07a0-4915-a1a4-2f53cf71d9ea',
    'Oranges at Noon',
    'Nikolai Stern',
    '@nstern',
    'A lunch-break story about a small kindness that keeps arriving late.',
    'Every Tuesday, Pavel bought two oranges from the woman outside the office tower. He ate one at his desk and left the other on the empty chair beside him.

No one asked. People had learned that office grief was easier to respect from a distance.

On the seventh Tuesday, he found an orange already waiting on the chair, its peel marked with a tiny ink star. Under it was a note: I still prefer apples. But I like that you remembered.',
    'slice of life',
    'warm',
    5,
    'published',
    true
  ),
  (
    'cf3f9e26-e780-4a3a-83d5-540e8d1de38d',
    'Archive of Rain',
    'Ena Cross',
    '@enacross',
    'In a city where weather is stored, one apprentice misfiles a storm.',
    'The municipal archive kept rain in numbered glass tubes. Drizzles were thin and silver. Thunderstorms were dark enough to hum in their drawers.

Ilya''s job was to catalogue weather before it could become memory. On his third week, he mislabeled a storm as a lullaby.

By morning, every child in the eastern district woke from the same dream: a blue field, a door in the sky, and a voice asking politely to be let back in.',
    'speculative',
    'strange',
    9,
    'published',
    true
  )
on conflict (id) do nothing;

create or replace function public.get_boks_admin_snapshot(
  p_limit integer default 100,
  p_offset integer default 0,
  p_query text default '',
  p_sort text default 'signal'
)
returns jsonb
language sql
security definer
set search_path = public
as $$
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
)
select jsonb_build_object(
  'funnel', jsonb_build_object(
    'totalStories', (select total_stories from all_published),
    'visitors', (select total_visitors from all_published),
    'impressions', (select total_views from all_published),
    'starts', (select total_views from all_published),
    'completes', 0,
    'likes', (select total_likes from all_published),
    'shares', 0
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
  'genres', coalesce((select jsonb_agg(to_jsonb(genre_rows)) from genre_rows), '[]'::jsonb),
  'moods', coalesce((select jsonb_agg(to_jsonb(mood_rows)) from mood_rows), '[]'::jsonb),
  'algorithms', jsonb_build_array(jsonb_build_object(
    'id', 'supabase_recent',
    'name', 'Supabase recent',
    'description', 'Newest published reels from Supabase with anonymous views and likes.'
  )),
  'algorithmMetrics', jsonb_build_array(jsonb_build_object(
    'algorithmId', 'supabase_recent',
    'userSegment', 'anonymous',
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
);
$$;

revoke all on function public.get_boks_admin_snapshot(integer, integer, text, text) from public, anon;
grant execute on function public.get_boks_admin_snapshot(integer, integer, text, text) to authenticated;
