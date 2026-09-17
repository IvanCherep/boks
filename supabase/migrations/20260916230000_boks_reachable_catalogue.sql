-- Every published boks has to be reachable.
--
-- Candidate retrieval was `order by created_at desc limit 200`. That was fine
-- while the catalogue was 37 demo pieces, and invisible while it was; with 457
-- published boks it means **257 of them can never be served to anyone**, no
-- matter what the ranker does, because they never enter the candidate set. The
-- ranking is honest about the candidates it is given - it cannot rank what it
-- never sees.
--
-- Measured before this change, on the real catalogue: a fresh reader's slate
-- of 80 contained pieces of one and two minutes only. Every short story in the
-- catalogue - O. Henry, Chekhov, Joyce, Mansfield, Saki, 220 pieces - was
-- unreachable, and the app looked like a poetry app.
--
-- The fix keeps the recency slice, which is what a returning reader wants, and
-- adds a random sample of everything else, which is what makes the back
-- catalogue reachable at all. Sampling per request rather than paging is
-- deliberate: this is a recommender, not a list, so it does not need a stable
-- window - it needs a fair chance for every piece. The provenance tables
-- record which candidates each serve saw, so a serve is still replayable.
--
-- Only the retrieval CTE changes. The body below is otherwise the deployed
-- function verbatim.

create or replace function public.get_recommendation_candidates(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 400);
  -- Half the slate is the newest, half is drawn from everything else.
  v_recent integer := greatest(1, least(greatest(coalesce(p_limit, 200), 1), 400) / 2);
  v_since timestamptz := now() - interval '60 days';
  v_uid uuid := (select auth.uid());
begin
  return coalesce((
    with published as (
      select r.* from public.boks_reels r where r.status = 'published'
    ),
    newest as (
      select p.* from published p order by p.created_at desc limit v_recent
    ),
    sampled as (
      -- The rest of the catalogue, drawn at random, so that nothing is
      -- permanently out of reach. `order by random()` is affordable here: the
      -- table is thousands of rows and this runs once per feed load.
      select p.* from published p
      where not exists (select 1 from newest n where n.id = p.id)
      order by random()
      limit greatest(0, v_limit - v_recent)
    ),
    recent_reels as (
      select * from newest
      union all
      select * from sampled
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
$BODY$;

revoke all on function public.get_recommendation_candidates(integer) from public, anon, authenticated;
grant execute on function public.get_recommendation_candidates(integer) to anon, authenticated;

-- ------------------------------------------------------- reading a writer

/**
 * A boks carries an account and, on top of it, a byline. Both are things a
 * reader taps, and they mean different things:
 *
 *   * the **@handle** is the publisher - `@boks`, or an author publishing
 *     their own work. It is what a reader can follow.
 *   * the **byline** is the writer. Tapping "Katherine Mansfield" has to show
 *     Katherine Mansfield, not the 457 pieces the account has published.
 *
 * Before this, both taps led to the account, so the commonest thing a reader
 * wants - "more by this writer" - returned an alphabetical dump of the whole
 * catalogue. `p_author_name` narrows the view to one writer, and the publisher
 * view gains the list of writers it publishes, which is the useful index of a
 * catalogue that size.
 */
create or replace function public.get_boks_author(
  p_handle text,
  p_author_name text default null,
  p_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_handle text := lower(btrim(ltrim(coalesce(p_handle, ''), '@')));
  v_byline text := nullif(btrim(coalesce(p_author_name, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_author_user_id uuid;
  v_handle_name text;
  v_total integer;
begin
  if v_handle = '' then
    return null;
  end if;

  select i.user_id, i.handle
  into v_author_user_id, v_handle_name
  from public.boks_public_identity i
  where lower(i.handle) = v_handle;

  if v_author_user_id is null then
    select b.author_name into v_handle_name
    from public.published_boks b
    where lower(b.author_handle) = v_handle
    limit 1;
  end if;

  if v_handle_name is null then
    return null;
  end if;

  select count(*) into v_total
  from public.published_boks b
  where lower(b.author_handle) = v_handle
    and (v_byline is null or b.author_name = v_byline);

  -- A byline that matches nothing is a stale link, not an empty writer.
  if v_byline is not null and v_total = 0 then
    return null;
  end if;

  return jsonb_build_object(
    'authorUserId', coalesce(v_author_user_id::text, ''),
    -- What the sheet is titled: the writer when one is asked for, the account
    -- otherwise.
    'authorName', coalesce(v_byline, v_handle_name),
    'authorHandle', v_handle,
    -- Set when the view is one writer inside a publisher's catalogue, so the
    -- sheet can say who published them and attach Follow to that.
    'byline', v_byline,
    'totalBoks', v_total,
    'followers', (
      select count(*)::integer from public.author_follows f
      where v_author_user_id is not null and f.author_user_id = v_author_user_id
    ),
    'following', v_author_user_id is not null and exists (
      select 1 from public.author_follows f
      where f.author_user_id = v_author_user_id and f.follower_user_id = v_uid
    ),
    -- The writers this account publishes. Only meaningful for a publisher, so
    -- it is empty for an author publishing their own work.
    'writers', case
      when v_byline is not null then '[]'::jsonb
      else coalesce((
        select jsonb_agg(w order by w ->> 'name')
        from (
          select jsonb_build_object('name', b.author_name, 'boks', count(*)::integer) as w
          from public.published_boks b
          where lower(b.author_handle) = v_handle and b.author_name is not null
          group by b.author_name
          having count(*) > 0
        ) writers
      ), '[]'::jsonb)
    end,
    'boks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id::text,
        'title', b.title,
        'hook', b.hook,
        'minutes', b.minutes,
        'readingShape', b.reading_shape,
        'authorName', b.author_name,
        'createdAt', b.created_at
      ) order by b.created_at desc)
      from (
        select * from public.published_boks b
        where lower(b.author_handle) = v_handle
          and (v_byline is null or b.author_name = v_byline)
        order by b.created_at desc
        limit v_limit
      ) b
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_boks_author(text) from public, anon, authenticated;
revoke all on function public.get_boks_author(text, text, integer) from public, anon, authenticated;
grant execute on function public.get_boks_author(text, text, integer) to anon, authenticated;

-- The one-argument shape would be ambiguous against the new defaults.
drop function if exists public.get_boks_author(text);
