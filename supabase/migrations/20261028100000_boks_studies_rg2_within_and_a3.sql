-- Studies brought in line with the presentation of 21 October 2026.
--
-- rg2 becomes a within-participant comparison: everyone has ten minutes in the
-- personal feed and ten in the catalogue, in an order assigned at random, with
-- different texts in each; the primary outcome is «Насколько вы довольны этим
-- сеансом выбора и чтения?», 1-7, after both. The condition is now which
-- interface comes first. No one had enrolled in rg2 when this was written, so
-- no assignment changes meaning.
--
-- a3 is new: a profile from the first five boks a reader rates, 1-5, against
-- the same ranker without it, by NDCG@5 on the ten new texts that follow.
-- Its participants read across several visits, so `get_boks_study` now returns
-- the answers of a3's own steps, and `get_boks_study_a3_candidates` returns the
-- counters and semantic vectors the offline ranking is computed from.

alter table public.boks_studies drop constraint if exists boks_study_key_known;
alter table public.boks_studies add constraint boks_study_key_known
  check (key in ('rg1', 'rg2', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3'));

insert into public.boks_studies (key) values ('a3') on conflict (key) do nothing;


-- The conditions each study assigns. One list, read by enrolment and asserted
-- against `lib/boks/studies/protocol.ts` by the unit tests reading this file.
create or replace function public.boks_study_conditions(p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'rg1' then array['series', 'text']
    when 'rg2' then array['feed_first', 'catalogue_first']
    when 'a1' then array['whole_first', 'fragment_first']
    when 'a2' then array['inline_a', 'inline_b', 'cards_a', 'cards_b']
    when 'a3' then array['profile']
    when 'b1' then array['yoked']
    when 'b2' then array['series', 'text']
    when 'b3' then array['rater']
    else array[]::text[]
  end;
$$;

revoke all on function public.boks_study_conditions(text) from public, anon, authenticated;


create or replace function public.get_boks_study(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_study public.boks_studies%rowtype;
  v_participant public.boks_study_participants%rowtype;
begin
  if v_uid is null then
    raise exception 'A boks session is required.' using errcode = '42501';
  end if;

  select * into v_study from public.boks_studies s where s.key = lower(btrim(coalesce(p_key, '')));
  if not found then
    return null;
  end if;

  select * into v_participant from public.boks_study_participants p
  where p.study_key = v_study.key and p.user_id = v_uid;

  return jsonb_build_object(
    'key', v_study.key,
    'enabled', v_study.enabled,
    'materials', case when v_study.enabled or public.is_boks_admin(v_uid) then v_study.materials else '{}'::jsonb end,
    'participant', case when v_participant.id is null then null else jsonb_build_object(
      'id', v_participant.id,
      'condition', v_participant.condition,
      'seed', v_participant.seed,
      'createdAt', v_participant.created_at,
      'completedAt', v_participant.completed_at,
      'steps', coalesce((
        select jsonb_agg(jsonb_build_object(
          'step', r.step,
          'reelId', r.reel_id,
          'fragmentId', r.fragment_id,
          'condition', r.condition,
          -- a3 is read in several visits and resumes from its own answers.
          'answers', case when r.step in ('interest', 'ranking') then r.answers else null end
        ) order by r.id)
        from public.boks_study_responses r
        where r.participant_id = v_participant.id and r.step <> 'trace'
      ), '[]'::jsonb)
    ) end
  );
end;
$$;

revoke all on function public.get_boks_study(text) from public, anon;
grant execute on function public.get_boks_study(text) to authenticated;


create or replace function public.list_boks_studies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', s.key,
      'enabled', s.enabled,
      'materials', s.materials,
      'updatedAt', s.updated_at,
      'participants', (select count(*) from public.boks_study_participants p where p.study_key = s.key),
      'completed', (select count(*) from public.boks_study_participants p where p.study_key = s.key and p.completed_at is not null),
      'byCondition', coalesce((
        select jsonb_object_agg(c.condition, c.n)
        from (
          select p.condition, count(*) as n from public.boks_study_participants p
          where p.study_key = s.key group by p.condition
        ) c
      ), '{}'::jsonb),
      'responses', (select count(*) from public.boks_study_responses r where r.study_key = s.key),
      'lastResponseAt', (select max(r.created_at) from public.boks_study_responses r where r.study_key = s.key),
      'fragments', case when s.key = 'b3' then (select count(*) from public.boks_study_fragments) else null end
    ) order by array_position(array['rg1', 'rg2', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3'], s.key))
    from public.boks_studies s
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_boks_studies() from public, anon;
grant execute on function public.list_boks_studies() to authenticated;


-- a3's snapshot. When a participant's profile is fixed, the client ranks the
-- ten targets twice - with the profile and without - with the production
-- ranker in TypeScript; this returns what that ranker reads for each bok
-- asked for: the same 60-day counters `get_recommendation_candidates` gives,
-- and the semantic vector the profile is built from. Only for a participant
-- of a running a3 (or an admin previewing), at most 20 published boks.
create or replace function public.get_boks_study_a3_candidates(p_participant_id uuid, p_reel_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_since timestamptz := now() - interval '60 days';
begin
  if v_uid is null then
    raise exception 'A boks session is required.' using errcode = '42501';
  end if;

  if p_participant_id is null then
    if not public.is_boks_admin(v_uid) then
      raise exception 'Admin access required.' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1 from public.boks_study_participants p
      where p.id = p_participant_id and p.user_id = v_uid and p.study_key = 'a3'
    ) then
      raise exception 'Not a participant of this study.' using errcode = '42501';
    end if;
    if not (select s.enabled from public.boks_studies s where s.key = 'a3') then
      raise exception 'This study is not running.' using errcode = '55000';
    end if;
  end if;

  if coalesce(cardinality(p_reel_ids), 0) > 20 then
    raise exception 'At most 20 boks.' using errcode = '22023';
  end if;

  return coalesce((
    with asked as (
      select r.* from public.boks_reels r
      where r.status = 'published' and r.id = any (p_reel_ids)
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
      join asked a on a.id = e.reel_id
      where e.created_at >= v_since
        and e.event_type in ('impression', 'start', 'complete', 'skip', 'share')
      group by e.reel_id
    ),
    like_rollup as (
      select l.reel_id, count(*)::integer as likes
      from public.likes l join asked a on a.id = l.reel_id
      group by l.reel_id
    ),
    comment_rollup as (
      select c.reel_id, count(*)::integer as comments
      from public.comments c join asked a on a.id = c.reel_id
      group by c.reel_id
    ),
    author_stats as (
      select
        r.author_user_id,
        count(*)::integer as published,
        (select count(*)::integer from public.author_follows f where f.author_user_id = r.author_user_id) as followers
      from public.boks_reels r
      where r.status = 'published' and r.author_user_id in (select a.author_user_id from asked a)
      group by r.author_user_id
    )
    select jsonb_agg(jsonb_build_object(
      'id', r.id::text,
      'title', r.title,
      'authorName', r.author_name,
      'authorHandle', r.author_handle,
      'authorUserId', coalesce(r.author_user_id::text, ''),
      'genre', r.genre,
      'mood', r.mood,
      'language', coalesce(r.language, 'und'),
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
      'hasEmbedding', (re.embedding is not null and re.embedding_model is not distinct from public.boks_embedding_model()),
      'embedding', case
        when re.embedding is not null and re.embedding_model = public.boks_embedding_model()
          then re.embedding::text::jsonb
        else null
      end
    ))
    from asked r
    join public.reels re on re.id = r.id
    left join event_rollup er on er.reel_id = r.id
    left join like_rollup lr on lr.reel_id = r.id
    left join comment_rollup cr on cr.reel_id = r.id
    left join author_stats ast on ast.author_user_id = r.author_user_id
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_boks_study_a3_candidates(uuid, uuid[]) is
  'Study a3: ranking counters and the semantic vector of up to 20 published boks, for a participant of the running study or an admin preview.';

revoke all on function public.get_boks_study_a3_candidates(uuid, uuid[]) from public, anon;
grant execute on function public.get_boks_study_a3_candidates(uuid, uuid[]) to authenticated;
