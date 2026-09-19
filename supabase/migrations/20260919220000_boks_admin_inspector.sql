-- One boks, one person: the admin console's inspector.
--
-- The console lists boks in three places (Moderation, Rights, Content) and
-- people in one. Each list now opens the same two detail views instead of
-- growing its own. These are the reads behind them.
--
-- Both are admin-only security-definer functions, like every other console
-- read: `is_boks_admin` takes the role from `user_profiles`, not from the JWT,
-- and refuses a suspended or deleted account. Nothing here writes.
--
-- Metrics use the same definitions as the list RPCs, so a number in a detail
-- view never disagrees with the row it was opened from - the schema checks
-- assert that:
--   reading minutes  sum over (session, boks) of max(active_seconds), / 60
--   readers          distinct users with a reader event on the boks
--   starts/finishes  counts of `start` / `complete` reader events
--   finish rate      completes / starts, only when there are starts

create or replace function public.get_admin_bok(p_reel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  with events as (
    select e.user_id, e.session_id, e.event_type, e.active_seconds, e.created_at
    from public.recommendation_events e
    where e.reel_id = p_reel_id and e.surface = 'reader'
  ),
  session_reading as (
    select session_id, max(active_seconds) as active_seconds from events group by session_id
  ),
  metrics as (
    select
      coalesce((select round(sum(active_seconds) / 60.0)::integer from session_reading), 0) as minutes,
      (select count(distinct user_id)::integer from events) as readers,
      (select count(*)::integer from events where event_type = 'impression') as impressions,
      (select count(*)::integer from events where event_type = 'start') as starts,
      (select count(*)::integer from events where event_type = 'complete') as completes,
      (select count(*)::integer from events where event_type = 'skip') as skips,
      (select count(*)::integer from events where event_type = 'share') as shares,
      (select count(*)::integer from public.likes l where l.reel_id = p_reel_id) as likes,
      (select count(*)::integer from public.comments c where c.reel_id = p_reel_id) as comments,
      (select count(*)::integer from public.bok_reports br where br.reel_id = p_reel_id) as reports,
      (select count(*)::integer from public.bok_reports br where br.reel_id = p_reel_id and br.status = 'open') as open_reports,
      (select max(created_at) from events) as last_read_at
  )
  select jsonb_build_object(
    'id', r.id::text,
    'title', r.title,
    'hook', r.hook,
    'body', r.text,
    'status', r.status,
    'language', r.language,
    'genre', r.genre,
    'mood', r.mood,
    'estimatedMinutes', r.minutes,
    'wordCount', r.word_count,
    'isSeed', r.is_seed,
    'imported', r.import_key is not null,
    'authorName', coalesce(nullif(btrim(r.author_name), ''), 'boks author'),
    'authorHandle', coalesce(i.handle, r.author_handle, ''),
    'authorUserId', r.author_user_id::text,
    'authorEmail', author_account.email,
    'createdAt', r.created_at,
    'submittedAt', r.submitted_at,
    'updatedAt', r.updated_at,
    'reviewedAt', r.reviewed_at,
    'reviewedBy', reviewer.handle,
    'reviewNote', r.review_note,
    'archivedAt', r.archived_at,
    'archivedBy', archiver.handle,
    'archiveReason', r.archive_reason,
    'rights', case when rights.reel_id is null then null else jsonb_build_object(
      'confirmed', rights.confirmed,
      'note', rights.note,
      'confirmedAt', rights.confirmed_at
    ) end,
    'metrics', jsonb_build_object(
      'minutes', m.minutes,
      'readers', m.readers,
      'impressions', m.impressions,
      'starts', m.starts,
      'completes', m.completes,
      'skips', m.skips,
      'shares', m.shares,
      'likes', m.likes,
      'comments', m.comments,
      'reports', m.reports,
      'openReports', m.open_reports,
      'finishRate', case when m.starts > 0 then round(m.completes * 100.0 / m.starts)::integer else null end,
      'lastReadAt', m.last_read_at
    ),
    -- The newest hundred. A detail view is for reading them, not an export.
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'createdAt', c.created_at,
        'userId', c.user_id::text,
        'handle', commenter.handle,
        'parentCommentId', c.parent_comment_id,
        'likes', (select count(*)::integer from public.comment_likes cl where cl.comment_id = c.id)
      ) order by c.created_at desc, c.id desc)
      from (
        select * from public.comments
        where reel_id = p_reel_id
        order by created_at desc, id desc
        limit 100
      ) c
      left join public.user_profiles commenter on commenter.user_id = c.user_id
    ), '[]'::jsonb),
    'likers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', l.user_id::text,
        'handle', liker.handle,
        'likedAt', l.created_at
      ) order by l.created_at desc)
      from (
        select * from public.likes
        where reel_id = p_reel_id
        order by created_at desc
        limit 100
      ) l
      left join public.user_profiles liker on liker.user_id = l.user_id
    ), '[]'::jsonb)
  )
  into v_result
  from public.reels r
  cross join metrics m
  left join public.boks_public_identity i on i.user_id = r.author_user_id
  left join auth.users author_account on author_account.id = r.author_user_id
  left join public.user_profiles reviewer on reviewer.user_id = r.reviewed_by
  left join public.user_profiles archiver on archiver.user_id = r.archived_by
  left join public.bok_rights rights on rights.reel_id = r.id
  where r.id = p_reel_id;

  if v_result is null then
    raise exception 'Boks does not exist.' using errcode = '22023';
  end if;
  return v_result;
end;
$$;

comment on function public.get_admin_bok(uuid) is
  'Admin-only detail of one boks in any status: text, review and archive history, rights, metrics, newest comments and likers.';

revoke all on function public.get_admin_bok(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_bok(uuid) to authenticated;


create or replace function public.get_admin_person(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  with events as (
    select e.reel_id, e.session_id, e.event_type, e.active_seconds, e.created_at
    from public.recommendation_events e
    where e.user_id = p_user_id and e.surface = 'reader'
  ),
  -- The same unit `get_boks_people` sums: one (session, boks) pair, credited
  -- with the most active time it reported.
  session_reading as (
    select session_id, reel_id, max(active_seconds) as active_seconds, max(created_at) as last_at
    from events
    group by session_id, reel_id
  ),
  authored as (
    select r.* from public.reels r where r.author_user_id = p_user_id
  ),
  metrics as (
    select
      coalesce((select round(sum(active_seconds) / 60.0)::integer from session_reading), 0) as minutes,
      coalesce((select round(sum(active_seconds) / 60.0)::integer from session_reading
                where last_at >= now() - interval '7 days'), 0) as minutes_7d,
      coalesce((select round(sum(active_seconds) / 60.0)::integer from session_reading
                where last_at >= now() - interval '30 days'), 0) as minutes_30d,
      (select count(distinct session_id)::integer from session_reading) as sessions,
      (select count(distinct reel_id)::integer from session_reading) as boks_opened,
      (select count(*)::integer from events where event_type = 'complete') as boks_finished,
      (select count(*)::integer from events where event_type = 'skip') as skips,
      (select count(distinct (created_at at time zone 'utc')::date)::integer from events) as active_days,
      (select min(created_at) from events) as first_read_at,
      (select max(created_at) from events) as last_read_at,
      (select count(*)::integer from public.likes l where l.user_id = p_user_id) as likes_given,
      (select count(*)::integer from public.comments c where c.user_id = p_user_id) as comments_written,
      (select count(*)::integer from authored) as authored_total,
      (select count(*)::integer from authored where status = 'published') as authored_published,
      (select count(*)::integer from authored where status = 'pending_review') as authored_pending,
      (select count(*)::integer from authored where status = 'rejected') as authored_rejected,
      (select count(*)::integer from authored where status = 'archived') as authored_archived,
      (select count(*)::integer from public.likes l join authored a on a.id = l.reel_id) as likes_received,
      (select count(*)::integer from public.comments c join authored a on a.id = c.reel_id
        where c.user_id <> p_user_id) as comments_received,
      (select count(distinct e.user_id)::integer from public.recommendation_events e
        join authored a on a.id = e.reel_id
        where e.surface = 'reader' and e.user_id <> p_user_id) as readers_reached,
      (select count(*)::integer from public.author_follows f where f.author_user_id = p_user_id) as followers,
      (select count(*)::integer from public.author_follows f where f.follower_user_id = p_user_id) as following
  )
  select jsonb_build_object(
    'userId', u.id::text,
    'email', coalesce(u.email, ''),
    'isAnonymous', coalesce(u.is_anonymous, false),
    'handle', p.handle,
    'role', coalesce(p.role, 'reader'),
    'joinedAt', coalesce(p.created_at, u.created_at),
    'lastSignInAt', coalesce(u.last_sign_in_at, u.created_at),
    'termsAcceptedAt', p.terms_accepted_at,
    'readingLanguages', coalesce(to_jsonb(p.reading_languages), '[]'::jsonb),
    'bannedAt', p.banned_at,
    'banReason', p.ban_reason,
    'bannedBy', banner.handle,
    'algorithmId', (
      select ra.algorithm_id from public.recommendation_assignments ra
      where ra.user_id = u.id order by ra.assigned_at desc limit 1
    ),
    'metrics', jsonb_build_object(
      'minutes', m.minutes,
      'minutesLast7Days', m.minutes_7d,
      'minutesLast30Days', m.minutes_30d,
      'sessions', m.sessions,
      'boksOpened', m.boks_opened,
      'boksFinished', m.boks_finished,
      'skips', m.skips,
      'activeDays', m.active_days,
      'firstReadAt', m.first_read_at,
      'lastReadAt', m.last_read_at,
      'likesGiven', m.likes_given,
      'commentsWritten', m.comments_written,
      'authored', jsonb_build_object(
        'total', m.authored_total,
        'published', m.authored_published,
        'pending', m.authored_pending,
        'rejected', m.authored_rejected,
        'archived', m.authored_archived
      ),
      'likesReceived', m.likes_received,
      'commentsReceived', m.comments_received,
      'readersReached', m.readers_reached,
      'followers', m.followers,
      'following', m.following
    ),
    -- Days with reading in the last 30. Empty days are left out; the client
    -- lays them on a calendar.
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'minutes', d.minutes, 'boks', d.boks) order by d.day)
      from (
        select (s.last_at at time zone 'utc')::date as day,
          round(sum(s.active_seconds) / 60.0)::integer as minutes,
          count(distinct s.reel_id)::integer as boks
        from session_reading s
        where s.last_at >= now() - interval '30 days'
        group by 1
      ) d
    ), '[]'::jsonb),
    'authoredBoks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id::text,
        'title', a.title,
        'status', a.status,
        'createdAt', a.created_at,
        'likes', (select count(*)::integer from public.likes l where l.reel_id = a.id),
        'comments', (select count(*)::integer from public.comments c where c.reel_id = a.id),
        'readers', (select count(distinct e.user_id)::integer from public.recommendation_events e
                    where e.reel_id = a.id and e.surface = 'reader')
      ) order by a.created_at desc)
      from (select * from authored order by created_at desc limit 200) a
    ), '[]'::jsonb),
    'likedBoks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id::text,
        'title', r.title,
        'status', r.status,
        'authorName', coalesce(nullif(btrim(r.author_name), ''), 'boks author'),
        'at', l.created_at
      ) order by l.created_at desc)
      from (
        select * from public.likes where user_id = p_user_id order by created_at desc limit 200
      ) l
      join public.reels r on r.id = l.reel_id
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'at', c.created_at,
        'isReply', c.parent_comment_id is not null,
        'reelId', r.id::text,
        'title', r.title,
        'status', r.status
      ) order by c.created_at desc, c.id desc)
      from (
        select * from public.comments where user_id = p_user_id order by created_at desc, id desc limit 200
      ) c
      join public.reels r on r.id = c.reel_id
    ), '[]'::jsonb),
    'readBoks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id::text,
        'title', r.title,
        'status', r.status,
        'authorName', coalesce(nullif(btrim(r.author_name), ''), 'boks author'),
        'at', reads.last_at,
        'activeSeconds', reads.active_seconds,
        'finished', reads.finished
      ) order by reads.last_at desc)
      from (
        select s.reel_id,
          max(s.last_at) as last_at,
          round(sum(coalesce(s.active_seconds, 0)))::integer as active_seconds,
          exists (
            select 1 from events f where f.reel_id = s.reel_id and f.event_type = 'complete'
          ) as finished
        from session_reading s
        where s.reel_id is not null
        group by s.reel_id
        order by max(s.last_at) desc
        limit 100
      ) reads
      join public.reels r on r.id = reads.reel_id
    ), '[]'::jsonb)
  )
  into v_result
  from auth.users u
  cross join metrics m
  left join public.user_profiles p on p.user_id = u.id
  left join public.user_profiles banner on banner.user_id = p.banned_by
  where u.id = p_user_id;

  if v_result is null then
    raise exception 'User does not exist.' using errcode = '22023';
  end if;
  return v_result;
end;
$$;

comment on function public.get_admin_person(uuid) is
  'Admin-only detail of one account: profile, reading and authoring metrics, 30-day activity, and the boks they wrote, liked, commented on and read.';

revoke all on function public.get_admin_person(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_person(uuid) to authenticated;
