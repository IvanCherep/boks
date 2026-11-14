-- Feed data cleanup: a snapshot nobody reads, a second reading history,
-- metadata nobody reads, indexes another index already covers, and a pruning
-- function for the job log.
--
-- Applied before the release that stops writing these, and old tabs and the
-- old server keep calling for days, so every RPC keeps its name and arguments
-- (docs/agents/production-changes.md, "Compatibility"):
--
-- 1. `served_feed.profile_snapshot` is gone (30 of the table's 38 MB). Nothing
--    read it: the reader half duplicated the `reader` signals the request
--    already carries, and the server half (`bokState`) had one entry per
--    candidate, mostly zeros. The one fact in it anything relied on, the arm
--    the browser claimed when `record_served_feed` credited the stored one
--    instead, moves to `served_feed.claimed_algorithm_id`.
--    `record_served_feed(p_feed, p_items)` still accepts a `profileSnapshot`
--    key - the live server sends one until the next release - and ignores it.
-- 2. The `views` table is gone. It was a second, undeduplicated impression log
--    written from the browser next to `recommendation_events`. The account
--    library's "read" time now comes from the reader's own impression, start
--    and complete events. Views the events do not account for - an impression
--    event that never arrived, or a later re-view - are kept, one row per
--    (reader, bok) with the latest time, in `reader_library_legacy_reads`, a
--    table only the library reads. They are not copied into
--    `recommendation_events`: impressions there are counted by the ranking
--    candidates, the lab and the author stats, and a backfilled impression
--    would be a measurement that never happened.
--    `get_boks_user_context` stops answering `views` (no client reads it);
--    `get_boks_admin_snapshot` stops reporting anything built on views and
--    drops the stale `algorithms` / `algorithmMetrics` keys (docs/adr/0003).
--    A stale tab still inserting into `views` gets an error it swallows.
-- 3. Event metadata `genre`, `mood`, `catalogSize` and `unseenCount` are
--    stripped from stored events and from new ones (stale tabs still send
--    them): no function, admin screen or analysis reads them.
-- 4. Indexes whose every use another index on the same leading columns serves.
-- 5. `boks_prune_old_data()`: removes background job runs older than 90 days.

-- ------------------------------------------------------------------ served_feed

alter table public.served_feed add column if not exists claimed_algorithm_id text;

comment on column public.served_feed.claimed_algorithm_id is
  'The arm the client named when record_served_feed credited the reader''s stored arm instead; null when they agreed.';

update public.served_feed
set claimed_algorithm_id = nullif(profile_snapshot ->> 'claimedAlgorithmId', '')
where profile_snapshot ? 'claimedAlgorithmId';

create or replace function public.record_served_feed(p_feed jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_stored text;
begin
  if v_uid is null then
    raise exception 'Sign in required to record a served feed.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_feed, 'null'::jsonb)) <> 'object'
     or pg_column_size(p_feed) > 65536 then
    raise exception 'Feed metadata is invalid or too large.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_items) > 200
     or pg_column_size(p_items) > 262144 then
    raise exception 'Feed items are invalid or too large.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where jsonb_typeof(item) <> 'object' or pg_column_size(item) > 16384
  ) then
    raise exception 'A feed item is invalid or too large.' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.served_feed f
    where f.user_id = v_uid and f.served_at > now() - interval '1 hour'
  ) >= 300 then
    raise exception 'Feed request limit reached. Try again later.' using errcode = '54023';
  end if;

  -- An older server still sends `profileSnapshot`; it is not stored. A claim
  -- is recorded only by the crediting below, never taken from the caller.
  p_feed := p_feed - 'profileSnapshot' - 'claimedAlgorithmId';

  if not (coalesce(p_feed ->> 'assignmentSource', '') = 'requested' and public.is_boks_admin()) then
    select a.algorithm_id into v_stored
    from public.recommendation_assignments a
    join public.recommendation_experiments x
      on x.key = a.experiment_key and x.is_active
    where a.user_id = v_uid
      and a.experiment_key = coalesce(p_feed ->> 'experimentKey', '')
      and exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(x.arms) = 'array' then x.arms else '[]'::jsonb end
        ) arm
        where arm ->> 'algorithmId' = a.algorithm_id
          and public.boks_json_number(arm ->> 'weight', 0) > 0
      );

    if v_stored is not null and v_stored is distinct from nullif(p_feed ->> 'algorithmId', '') then
      p_feed := jsonb_set(p_feed, '{algorithmId}', to_jsonb(v_stored))
        || jsonb_build_object('claimedAlgorithmId', p_feed ->> 'algorithmId');
    end if;
  end if;

  return public.record_served_feed_unchecked(p_feed, p_items);
end;
$$;

create or replace function public.record_served_feed_unchecked(p_feed jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_feed_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required to record a served feed.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Feed items must be a JSON array.' using errcode = '22023';
  end if;

  insert into public.served_feed (
    user_id, session_id, experiment_key, experiment_version, experiment_mode,
    algorithm_id, algorithm_a_id, algorithm_b_id, assignment_source,
    candidate_request_id, candidate_count, catalog_size,
    serving_backend, degraded_mode, fallback_reason,
    signals_version, ranking_version, labeling_version,
    claimed_algorithm_id, seed, build_id
  )
  values (
    v_uid,
    left(coalesce(p_feed ->> 'sessionId', ''), 120),
    left(coalesce(p_feed ->> 'experimentKey', ''), 60),
    greatest(coalesce((p_feed ->> 'experimentVersion')::integer, 1), 1),
    coalesce(nullif(p_feed ->> 'experimentMode', ''), 'single'),
    nullif(p_feed ->> 'algorithmId', ''),
    nullif(p_feed ->> 'algorithmAId', ''),
    nullif(p_feed ->> 'algorithmBId', ''),
    coalesce(nullif(p_feed ->> 'assignmentSource', ''), 'assigned'),
    coalesce(nullif(p_feed ->> 'candidateRequestId', '')::uuid, extensions.gen_random_uuid()),
    greatest(coalesce((p_feed ->> 'candidateCount')::integer, 0), 0),
    greatest(coalesce((p_feed ->> 'catalogSize')::integer, 0), 0),
    coalesce(nullif(p_feed ->> 'servingBackend', ''), 'worker'),
    coalesce((p_feed ->> 'degradedMode')::boolean, false),
    nullif(p_feed ->> 'fallbackReason', ''),
    coalesce(nullif(p_feed ->> 'signalsVersion', ''), 'unknown'),
    coalesce(nullif(p_feed ->> 'rankingVersion', ''), 'unknown'),
    coalesce(nullif(p_feed ->> 'labelingVersion', ''), 'unknown'),
    left(nullif(p_feed ->> 'claimedAlgorithmId', ''), 120),
    left(coalesce(p_feed ->> 'seed', ''), 120),
    nullif(p_feed ->> 'buildId', '')
  )
  returning id into v_feed_id;

  insert into public.served_feed_item (
    feed_id, reel_id, delivered_rank, score, source_ranker_id, source_rank,
    credited_algorithm_id, candidate_source, explanations
  )
  select
    v_feed_id,
    (item ->> 'reelId')::uuid,
    (item ->> 'deliveredRank')::integer,
    nullif(item ->> 'score', '')::numeric,
    nullif(item ->> 'sourceRankerId', ''),
    nullif(item ->> 'sourceRank', '')::integer,
    nullif(item ->> 'creditedAlgorithmId', ''),
    nullif(item ->> 'candidateSource', ''),
    case
      when jsonb_typeof(item -> 'explanations') = 'array' then item -> 'explanations'
      else '[]'::jsonb
    end
  from jsonb_array_elements(p_items) as item
  where (item ->> 'reelId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict do nothing;

  return v_feed_id;
end;
$$;

-- The space comes back when the rows are rewritten (`vacuum full
-- public.served_feed`, run outside a transaction after this migration).
alter table public.served_feed drop column profile_snapshot;

-- ------------------------------------------------------------------ views

-- No new insert lands between the copy and the drop. (Not `lock table`: the
-- schema check applies a file outside a transaction.) A view lost in that
-- instant still has its impression event.
revoke insert on table public.views from authenticated;

create table public.reader_library_legacy_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  reel_id uuid not null references public.reels(id) on delete cascade,
  read_at timestamptz not null,
  primary key (user_id, reel_id)
);

create index reader_library_legacy_reads_reel_idx
  on public.reader_library_legacy_reads (reel_id);

alter table public.reader_library_legacy_reads enable row level security;
revoke all on table public.reader_library_legacy_reads from public, anon, authenticated;

comment on table public.reader_library_legacy_reads is
  'Reads from the retired views table that recommendation_events do not account for. Read only by get_my_reader_library; never a metric.';

insert into public.reader_library_legacy_reads (user_id, reel_id, read_at)
select v.user_id, v.reel_id, max(v.created_at)
from public.views v
group by v.user_id, v.reel_id
having max(v.created_at) > coalesce((
  select max(e.created_at)
  from public.recommendation_events e
  where e.user_id = v.user_id
    and e.reel_id = v.reel_id
    and e.event_type in ('impression', 'start', 'complete')
    and e.surface = 'reader'
), '-infinity'::timestamptz);

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
      -- A bok counts as read once the reader saw it in the reader: its latest
      -- impression, start or complete.
      select reads.reel_id, max(reads.read_at) as read_at
      from (
        select e.reel_id, e.created_at as read_at
        from public.recommendation_events e
        where e.user_id = v_uid
          and e.event_type in ('impression', 'start', 'complete')
          and e.surface = 'reader'
          and e.reel_id is not null
        union all
        select legacy.reel_id, legacy.read_at
        from public.reader_library_legacy_reads legacy
        where legacy.user_id = v_uid
      ) reads
      group by reads.reel_id
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
      'authorHandle', b.author_handle,
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
      'handle', null,
      'termsAcceptedAt', null, 'termsVersion', null,
      'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin' and banned_at is null),
      'likes', 0, 'readingLanguages', array[]::text[],
      'languageCoverage', public.boks_language_coverage(), 'bannedAt', null, 'banReason', null
    );
  end if;

  select jsonb_build_object(
    'userId', v_uid::text, 'email', u.email, 'isAnonymous', v_is_anonymous,
    'role', coalesce(p.role, 'reader'), 'handle', p.handle,
    'termsAcceptedAt', p.terms_accepted_at, 'termsVersion', p.terms_version,
    'hasAnyAdmin', exists (select 1 from public.user_profiles where role = 'admin' and banned_at is null),
    'likes', (select count(*)::integer from public.likes where user_id = v_uid),
    'readingLanguages', coalesce(p.reading_languages, array[]::text[]),
    'languageCoverage', public.boks_language_coverage(),
    'bannedAt', p.banned_at, 'banReason', p.ban_reason
  ) into v_context
  from auth.users u left join public.user_profiles p on p.user_id = u.id
  where u.id = v_uid;

  return coalesce(v_context, jsonb_build_object(
    'userId', v_uid::text, 'email', null, 'isAnonymous', v_is_anonymous,
    'role', 'reader', 'handle', null,
    'termsAcceptedAt', null, 'termsVersion', null, 'hasAnyAdmin', true,
    'likes', 0, 'readingLanguages', array[]::text[],
    'languageCoverage', public.boks_language_coverage(),
    'bannedAt', case when public.is_boks_user_blocked(v_uid) then now() else null end,
    'banReason', case when public.is_boks_user_blocked(v_uid) then 'This account was deleted.' else null end
  ));
end;
$$;

-- The console reads `funnel` (pendingReview, totalStories, rejectedBoks,
-- approvedAuthorBoks) and `moderationQueue`; the other keys keep their shape
-- minus every number that came from `views`. A sort by 'starts' or 'finish'
-- (a like rate over views) falls back to the default order.
create or replace function public.get_boks_admin_snapshot(
  p_limit integer default 100,
  p_offset integer default 0,
  p_query text default '',
  p_sort text default 'newest'
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
$$;

-- Its indexes (views_reel_id_idx, views_user_id_idx, ...), policies and grants
-- go with it.
drop table public.views;

-- ------------------------------------------------------------------ event metadata

-- Stale tabs keep sending these keys until they reload; they are dropped on
-- the way in, so the cleanup below stays done.
create or replace function public.record_recommendation_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in required to record reader events.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_events, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_events) > 100
     or pg_column_size(p_events) > 262144 then
    raise exception 'Events are invalid or too large.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_events) event
    where jsonb_typeof(event) <> 'object'
       or pg_column_size(event) > 16384
       or pg_column_size(coalesce(event -> 'metadata', '{}'::jsonb)) > 8192
  ) then
    raise exception 'An event is invalid or too large.' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.recommendation_events e
    where e.user_id = v_uid and e.created_at > now() - interval '1 hour'
  ) >= 5000 then
    raise exception 'Event limit reached. Try again later.' using errcode = '54023';
  end if;

  p_events := coalesce((
    select jsonb_agg(
      case
        when jsonb_typeof(event -> 'metadata') = 'object'
          then jsonb_set(event, '{metadata}',
            (event -> 'metadata') - 'genre' - 'mood' - 'catalogSize' - 'unseenCount')
        else event
      end
      order by ord
    )
    from jsonb_array_elements(p_events) with ordinality as e(event, ord)
  ), '[]'::jsonb);

  return public.record_recommendation_events_unchecked(p_events);
end;
$$;

update public.recommendation_events
set metadata = metadata - 'genre' - 'mood' - 'catalogSize' - 'unseenCount'
where metadata ?| array['genre', 'mood', 'catalogSize', 'unseenCount'];

-- ------------------------------------------------------------------ indexes

-- likes (reel_id): likes_reel_created_idx (reel_id, created_at desc) leads
-- with it. likes (user_id): likes_user_reel_unique (user_id, reel_id) and
-- likes_user_created_idx lead with it. comments (user_id, created_at desc):
-- comments_user_reel_created_idx (user_id, reel_id, created_at desc) serves
-- every per-person lookup and the cascade; one person's comments are few, so
-- the time order costs a sort of a handful of rows.
-- recommendation_events_reel_type_idx stays: the rollup index is partial and
-- serves neither other event types nor the cascade from reels.
drop index if exists public.likes_reel_id_idx;
drop index if exists public.likes_user_id_idx;
drop index if exists public.comments_user_created_idx;

-- ------------------------------------------------------------------ retention

-- Called by the server's ops cron, never by a browser. served_feed and
-- recommendation_events are kept whole for now: they are the analysis.
create or replace function public.boks_prune_old_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_runs integer;
begin
  delete from public.background_job_runs
  where started_at < now() - interval '90 days';
  get diagnostics v_job_runs = row_count;

  return jsonb_build_object('backgroundJobRuns', v_job_runs);
end;
$$;

-- ------------------------------------------------------------------ grants

-- `create or replace` keeps a function's grants; restated so this file says
-- who may call what (docs/adr/0011).
revoke all on function public.record_served_feed(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.record_served_feed_unchecked(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.record_recommendation_events(jsonb) from public, anon, authenticated;
revoke all on function public.get_my_reader_library(integer) from public, anon, authenticated;
revoke all on function public.get_boks_user_context() from public, anon, authenticated;
revoke all on function public.get_boks_admin_snapshot(integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.boks_prune_old_data() from public, anon, authenticated;

grant execute on function public.record_served_feed(jsonb, jsonb) to authenticated;
grant execute on function public.record_recommendation_events(jsonb) to authenticated;
grant execute on function public.get_my_reader_library(integer) to authenticated;
grant execute on function public.get_boks_user_context() to anon, authenticated;
grant execute on function public.get_boks_admin_snapshot(integer, integer, text, text) to authenticated;
