-- boks identity consistency
--
-- A byline was stored twice: once in `user_profiles`, and again as a copy on
-- every boks and every comment the person ever wrote. Nothing kept the copies
-- in step, so changing your display name or your @handle silently left every
-- past row showing the old one. Measured on a development database with four
-- comments and six authored boks: two boks and one comment had already drifted.
--
-- The copies were not laziness. Row-level security on `user_profiles` lets a
-- reader read only their own profile, so a copy was the only way an author's
-- name could reach the reader rendering their work. The fix is therefore not
-- "delete the copies" but "give identity a sanctioned public projection", and
-- then delete the copies.
--
-- After this migration:
--
--   * `boks_public_identity` is the one place a display name and @handle are
--     published. Both are already printed on every boks and every comment, so
--     nothing becomes visible that was not visible before; the difference is
--     that it is now one definition instead of a copy per row.
--   * `comments` has no identity columns at all. Every comment has an account,
--     so there was never a case that needed them.
--   * `reels` keeps a byline only for rows with no account behind them - the
--     seeded demo catalog. A CHECK makes the two mutually exclusive, so a boks
--     with an author *cannot* carry a stale copy. Drift is now impossible by
--     construction rather than by convention.

-- --------------------------------------------------- public identity

-- A security-definer view: it reads `user_profiles` with the owner's rights and
-- exposes only the two fields that are public anyway. Everything else on the
-- profile - role, terms, preferences - stays behind row-level security.
create or replace view public.boks_public_identity as
select
  p.user_id,
  coalesce(nullif(btrim(p.display_name), ''), 'boks author') as display_name,
  p.handle
from public.user_profiles p;

revoke all on public.boks_public_identity from public;
grant select on public.boks_public_identity to anon, authenticated;

comment on view public.boks_public_identity is
  'The only published projection of a reader identity: display name and @handle. Join here for a byline; never copy these values into another table.';

-- ------------------------------------------------- reels: one byline

-- The copy is now only meaningful when nobody owns the row.
-- The defaults are what made the copy appear even when nothing wrote it: an
-- insert that named no byline still got 'boks' put in the column.
alter table public.reels
  alter column author_name drop not null,
  alter column author_name drop default,
  alter column author_handle drop not null,
  alter column author_handle drop default;

update public.reels
set author_name = null, author_handle = null
where author_user_id is not null;

-- Seeded rows keep their byline; authored rows may not carry one at all.
alter table public.reels
  drop constraint if exists reels_byline_belongs_to_author,
  add constraint reels_byline_belongs_to_author check (
    author_user_id is null or (author_name is null and author_handle is null)
  );

comment on column public.reels.author_name is
  'Byline for a boks with no account behind it - the seeded catalog. Null whenever author_user_id is set; the name then comes from boks_public_identity.';

-- Length is derived from the text; the handle rule now only applies to the
-- seeded rows that still carry one.
create or replace function public.boks_set_reel_word_count()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.word_count := public.boks_word_count(new.text);
  new.minutes := public.boks_reading_minutes(new.word_count);
  new.reading_shape := public.boks_reading_shape(new.text);
  new.line_break_count := length(coalesce(new.text, '')) - length(replace(coalesce(new.text, ''), E'\n', ''));
  -- Handles are stored bare; the '@' belongs to the presentation.
  new.author_handle := nullif(ltrim(coalesce(new.author_handle, ''), '@'), '');
  return new;
end;
$$;

-- ----------------------------------------- comments: no identity columns

alter table public.comments
  drop column if exists visitor_name,
  drop column if exists visitor_handle;

-- ------------------------------------------------- resolved projections

-- Every boks with its byline already resolved. Used inside security-definer
-- RPCs, which read every status; not granted to readers.
create or replace view public.boks_reels as
select
  r.id, r.title, r.hook, r.text, r.genre, r.mood, r.minutes, r.status,
  r.is_seed, r.created_at, r.updated_at, r.author_user_id, r.submitted_at,
  r.reviewed_at, r.reviewed_by, r.review_note, r.word_count, r.reading_shape,
  r.line_break_count,
  coalesce(i.display_name, r.author_name, 'boks author') as author_name,
  coalesce(i.handle, r.author_handle, '') as author_handle
from public.reels r
left join public.boks_public_identity i on i.user_id = r.author_user_id;

revoke all on public.boks_reels from public, anon, authenticated;

-- What a reader may read directly: published boks, byline resolved.
create or replace view public.published_boks as
select
  b.id, b.title, b.author_name, b.author_handle, b.author_user_id, b.hook,
  b.text, b.genre, b.mood, b.minutes, b.word_count, b.reading_shape,
  b.line_break_count, b.created_at
from public.boks_reels b
where b.status = 'published';

revoke all on public.published_boks from public;
grant select on public.published_boks to anon, authenticated;

-- Comments carry no identity of their own; it is joined at read time.
create or replace view public.boks_comments as
select
  c.id, c.reel_id, c.user_id, c.body, c.created_at,
  i.display_name as visitor_name,
  coalesce(i.handle, '') as visitor_handle
from public.comments c
join public.reels r on r.id = c.reel_id and r.status = 'published'
left join public.boks_public_identity i on i.user_id = c.user_id;

revoke all on public.boks_comments from public;
grant select on public.boks_comments to anon, authenticated;

-- ------------------------------------------------------------- writers

create or replace function public.create_bok_comment(p_reel_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  select coalesce(handle, public.generate_boks_handle(display_name, v_uid))
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
$$;

revoke all on function public.create_bok_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.create_bok_comment(uuid, text) to authenticated;

-- The byline is no longer written onto the row it describes.

create or replace function public.submit_bok_for_review(
  p_title text,
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
  -- author. The byline is no longer read here: it belongs to the profile and
  -- is joined at read time.
  perform 1 from public.user_profiles where user_id = v_uid for update;

  v_used := public.count_my_boks_submitted_today();

  if v_used >= v_limit then
    raise exception 'Daily limit reached. You can submit % boks a day.', v_limit using errcode = '54023';
  end if;

  insert into public.reels (
    title, hook, text, genre, mood, minutes,
    status, author_user_id, submitted_at, updated_at
  )
  values (
    v_title, left(v_hook, 500), v_text,
    left(v_genre, 30), left(v_mood, 30), public.boks_reading_minutes(v_words),
    'pending_review', v_uid, now(), now()
  )
  returning * into v_bok;

  select author_name, author_handle into v_author_name, v_author_handle
  from public.boks_reels where id = v_bok.id;

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

revoke all on function public.submit_bok_for_review(text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, integer) to authenticated;

-- ------------------------------------------- readers of the byline
-- These three read a byline, so they read it from the resolved view. The
-- swap is the whole change: `public.reels` -> `public.boks_reels`.

create or replace function public.get_boks_content(p_limit integer default 60, p_offset integer default 0, p_query text default '', p_sort text default 'newest')
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
  v_sort text := coalesce(nullif(btrim(p_sort), ''), 'minutes');
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return (
    with session_reading as (
      select reel_id, session_id, max(active_seconds) as active_seconds
      from public.recommendation_events
      where surface = 'reader'
      group by reel_id, session_id
    ),
    reading as (
      select reel_id, round(sum(active_seconds) / 60.0)::integer as minutes
      from session_reading group by reel_id
    ),
    outcomes as (
      select
        reel_id,
        count(*) filter (where event_type = 'start')::integer as starts,
        count(*) filter (where event_type = 'complete')::integer as completes,
        count(*) filter (where event_type = 'skip')::integer as skips,
        count(distinct user_id)::integer as readers
      from public.recommendation_events
      where surface = 'reader'
      group by reel_id
    ),
    likes as (select reel_id, count(*)::integer as likes from public.likes group by reel_id),
    comments as (select reel_id, count(*)::integer as comments from public.comments group by reel_id),
    rows as (
      select
        r.id, r.title, r.author_name, r.author_handle, r.genre, r.mood, r.minutes as estimated_minutes,
        r.word_count, r.created_at,
        coalesce(rd.minutes, 0) as minutes,
        coalesce(o.readers, 0) as readers,
        coalesce(o.starts, 0) as starts,
        coalesce(o.completes, 0) as completes,
        coalesce(o.skips, 0) as skips,
        coalesce(l.likes, 0) as likes,
        coalesce(c.comments, 0) as comments,
        case when coalesce(o.starts, 0) > 0
          then round(coalesce(o.completes, 0) * 100.0 / o.starts)::integer
          else null end as finish_rate
      from public.boks_reels r
      left join reading rd on rd.reel_id = r.id
      left join outcomes o on o.reel_id = r.id
      left join likes l on l.reel_id = r.id
      left join comments c on c.reel_id = r.id
      where r.status = 'published'
        and (
          v_query = ''
          or lower(r.title) like '%' || v_query || '%'
          or lower(r.author_name) like '%' || v_query || '%'
          or lower(r.genre) like '%' || v_query || '%'
          or lower(r.mood) like '%' || v_query || '%'
        )
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from rows),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(page) order by sort_rank)
        from (
          select
            id::text as "id", title, author_name as "authorName", author_handle as "authorHandle",
            genre, mood, estimated_minutes as "estimatedMinutes", word_count as "wordCount",
            minutes, readers, starts, completes, skips, likes, comments,
            finish_rate as "finishRate",
            row_number() over (
              order by
                case when v_sort = 'minutes' then minutes end desc nulls last,
                case when v_sort = 'readers' then readers end desc nulls last,
                case when v_sort = 'finish' then finish_rate end desc nulls last,
                case when v_sort = 'newest' then extract(epoch from created_at) end desc nulls last,
                case when v_sort = 'title' then lower(title) end asc nulls last,
                minutes desc, created_at desc
            ) as sort_rank
          from rows
        ) page
        where sort_rank > v_offset and sort_rank <= v_offset + v_limit
      ), '[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.get_boks_content(p_limit integer, p_offset integer, p_query text, p_sort text) from public, anon, authenticated;
grant execute on function public.get_boks_content(p_limit integer, p_offset integer, p_query text, p_sort text) to authenticated;

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
$function$;

revoke all on function public.get_boks_admin_snapshot(p_limit integer, p_offset integer, p_query text, p_sort text) from public, anon, authenticated;
grant execute on function public.get_boks_admin_snapshot(p_limit integer, p_offset integer, p_query text, p_sort text) to authenticated;

create or replace function public.get_recommendation_candidates(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 400);
  v_since timestamptz := now() - interval '60 days';
  v_uid uuid := (select auth.uid());
begin
  return coalesce((
    with recent_reels as (
      select r.*
      from public.boks_reels r
      where r.status = 'published'
      order by r.created_at desc
      limit v_limit
    ),
    event_rollup as (
      select
        e.reel_id,
        count(*) filter (where e.event_type = 'impression')::integer as impressions,
        count(*) filter (where e.event_type = 'start')::integer as starts,
        count(*) filter (where e.event_type = 'complete')::integer as completes,
        count(*) filter (where e.event_type = 'skip')::integer as skips,
        count(*) filter (where e.event_type = 'share')::integer as shares,
        coalesce(sum(e.value) filter (where e.event_type = 'complete'), 0)::numeric as read_seconds_total
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where e.created_at >= v_since
      group by e.reel_id
    ),
    like_rollup as (
      select l.reel_id, count(*)::integer as likes
      from public.likes l
      join recent_reels rr on rr.id = l.reel_id
      group by l.reel_id
    ),
    comment_rollup as (
      select c.reel_id, count(*)::integer as comments
      from public.comments c
      join recent_reels rr on rr.id = c.reel_id
      group by c.reel_id
    ),
    author_stats as (
      select
        r.author_user_id,
        count(*)::integer as published,
        (
          select count(*)::integer from public.author_follows f
          where f.author_user_id = r.author_user_id
        ) as followers
      from public.boks_reels r
      where r.status = 'published' and r.author_user_id is not null
      group by r.author_user_id
    ),
    -- The reader's own history with each boks, per (session, boks) so a reader
    -- who returns across sessions accumulates exposure rather than overwriting.
    my_sessions as (
      select
        e.reel_id,
        e.session_id,
        max(e.active_seconds) as dwell_seconds,
        max(e.progress) as progress,
        bool_or(e.event_type = 'skip') as skipped,
        max(e.created_at) as last_event_at,
        count(*)::integer as events
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where v_uid is not null and e.user_id = v_uid and e.surface = 'reader'
      group by e.reel_id, e.session_id
    ),
    my_state as (
      select
        s.reel_id,
        count(*)::integer as seen_count,
        -- A quick skip is a skip that never became reading. It is the closest
        -- honest equivalent of the original's explicit QUICK_SKIP event.
        count(*) filter (where s.skipped and s.dwell_seconds < 5)::integer as quick_skip_count,
        coalesce(sum(s.dwell_seconds), 0)::numeric as total_dwell_seconds,
        coalesce(max(s.progress), 0)::numeric as max_progress,
        coalesce(sum(s.events), 0)::integer as event_count,
        max(s.last_event_at) as last_event_at
      from my_sessions s
      group by s.reel_id
    ),
    my_completions as (
      select e.reel_id, min(e.created_at) as completed_at
      from public.recommendation_events e
      join recent_reels rr on rr.id = e.reel_id
      where v_uid is not null and e.user_id = v_uid and e.event_type = 'complete'
      group by e.reel_id
    )
    select jsonb_agg(jsonb_build_object(
      'id', r.id::text,
      'title', r.title,
      'authorName', r.author_name,
      'authorHandle', r.author_handle,
      'authorUserId', coalesce(r.author_user_id::text, ''),
      'hook', r.hook,
      'body', r.text,
      'genre', r.genre,
      'mood', r.mood,
      'minutes', r.minutes,
      'wordCount', coalesce(r.word_count, 0),
      'readingShape', r.reading_shape,
      'lineBreakCount', coalesce(r.line_break_count, 0),
      'createdAt', r.created_at,
      'impressions', coalesce(er.impressions, 0),
      'starts', coalesce(er.starts, 0),
      'completes', coalesce(er.completes, 0),
      'skips', coalesce(er.skips, 0),
      'likes', coalesce(lr.likes, 0),
      'shares', coalesce(er.shares, 0),
      'comments', coalesce(cr.comments, 0),
      'readSecondsTotal', coalesce(er.read_seconds_total, 0),
      'authorPublishedCount', coalesce(ast.published, 0),
      'authorFollowers', coalesce(ast.followers, 0),
      'followingAuthor', r.author_user_id is not null and exists (
        select 1 from public.author_follows f
        where f.follower_user_id = v_uid and f.author_user_id = r.author_user_id
      ),
      'mine', jsonb_build_object(
        'seenCount', coalesce(ms.seen_count, 0),
        'quickSkipCount', coalesce(ms.quick_skip_count, 0),
        'totalDwellSeconds', round(coalesce(ms.total_dwell_seconds, 0))::integer,
        'maxProgress', round(coalesce(ms.max_progress, 0), 3),
        'eventCount', coalesce(ms.event_count, 0),
        'lastEventAt', ms.last_event_at,
        'completedAt', mc.completed_at,
        'liked', exists (
          select 1 from public.likes l where l.reel_id = r.id and l.user_id = v_uid
        ),
        'commented', exists (
          select 1 from public.comments c where c.reel_id = r.id and c.user_id = v_uid
        )
      )
    ) order by r.created_at desc)
    from recent_reels r
    left join event_rollup er on er.reel_id = r.id
    left join like_rollup lr on lr.reel_id = r.id
    left join comment_rollup cr on cr.reel_id = r.id
    left join author_stats ast on ast.author_user_id = r.author_user_id
    left join my_state ms on ms.reel_id = r.id
    left join my_completions mc on mc.reel_id = r.id
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_recommendation_candidates(p_limit integer) from public, anon, authenticated;
grant execute on function public.get_recommendation_candidates(p_limit integer) to authenticated;

-- ------------------------------------------------------ reading history

-- The library used to embed `reels` and read its byline column directly. With
-- the byline resolved at read time an embed cannot see it, and a join belongs
-- in the database anyway.
create or replace function public.get_my_reader_library(p_limit integer default 120)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
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
    with last_read as (
      select v.reel_id, max(v.created_at) as read_at
      from public.views v
      where v.user_id = v_uid
      group by v.reel_id
      order by max(v.created_at) desc
      limit v_limit
    )
    select jsonb_agg(jsonb_build_object(
      'storyId', b.id::text,
      'title', b.title,
      'authorName', b.author_name,
      'minutes', b.minutes,
      'readAt', lr.read_at,
      'liked', exists (select 1 from public.likes l where l.reel_id = b.id and l.user_id = v_uid)
    ) order by lr.read_at desc)
    from last_read lr
    join public.published_boks b on b.id = lr.reel_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_reader_library(integer) from public, anon, authenticated;
grant execute on function public.get_my_reader_library(integer) to authenticated;

-- --------------------------------------------------- account deletion

-- Stated rather than solved, because the product has no delete-account flow to
-- test against. `reels.author_user_id` is `on delete set null`, so if an author
-- were removed their published boks would keep existing with no account and no
-- stored byline, and would render under the neutral fallback. That is a
-- defensible privacy outcome, but it is a decision nobody has made yet.
--
-- A deliberate non-constraint: `check (author_user_id is not null or author_name
-- is not null)` would express "every boks has a byline" exactly, and would also
-- make deleting an account fail with a constraint violation. The invariant is
-- asserted in `scripts/local-supabase/checks.sql` instead, where it reports the
-- problem without blocking the delete.
comment on constraint reels_byline_belongs_to_author on public.reels is
  'A boks with an account behind it stores no byline; the name is joined from boks_public_identity. Only authorless rows - the seeded catalog - carry one.';
