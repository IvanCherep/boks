-- What position in the slate does to reading.
--
-- Every event already records `rank`, the piece's position in the slate it was
-- served from, and the provenance tables keep the whole slate. So the
-- sequential dimension of the feed - does attention decay down the list, and
-- does an arm win by ordering better or by retrieving better - has been
-- collected since the provenance migration and analysed nowhere.
--
-- This is the aggregate that makes it readable. It is the cheapest gap in
-- `docs/analytics-and-thesis-readiness.md` to close: no new collection, one
-- query.
--
-- Why it is worth a panel rather than a column in an existing one:
--
--   Two arms can produce the same completion rate for opposite reasons. One
--   retrieves better pieces and puts them anywhere; the other retrieves the
--   same pieces and orders them so the reader meets the right one first. Those
--   are different claims about a recommender, and a pooled rate cannot tell
--   them apart. Position is what separates them.
--
-- Buckets rather than raw ranks, because a reader rarely goes past ten and a
-- row per rank would be mostly noise. The first three positions get their own
-- bucket: that is where nearly all reading happens and where an ordering
-- difference shows up first.

create or replace function public.get_slate_position_effects(
  p_days integer default 30,
  p_experiment_key text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_key text := coalesce(nullif(btrim(p_experiment_key), ''), '');
begin
  if (select auth.uid()) is null or not public.is_boks_admin((select auth.uid())) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return coalesce((
    with scoped as (
      select
        e.*,
        case
          when e.rank is null then null
          when e.rank <= 0 then '1'
          when e.rank = 1 then '2'
          when e.rank = 2 then '3'
          when e.rank between 3 and 4 then '4-5'
          when e.rank between 5 and 9 then '6-10'
          else '11+'
        end as position_bucket,
        case
          when e.rank is null then 99
          when e.rank <= 0 then 1
          when e.rank = 1 then 2
          when e.rank = 2 then 3
          when e.rank between 3 and 4 then 4
          when e.rank between 5 and 9 then 5
          else 6
        end as bucket_order
      from public.recommendation_events e
      where e.surface = 'reader'
        and e.created_at >= v_since
        and e.algorithm_id <> 'unassigned'
        and e.rank is not null
        and (v_key = '' or e.experiment_key = v_key)
    ),
    -- Reading time is cumulative per (session, piece), so it is taken with a
    -- maximum before it is summed - the same rule the reader outcomes use.
    dwell as (
      select algorithm_id, position_bucket, bucket_order, session_id, reel_id,
             max(active_seconds) as active_seconds
      from scoped
      group by algorithm_id, position_bucket, bucket_order, session_id, reel_id
    ),
    dwell_rollup as (
      select algorithm_id, position_bucket, bucket_order,
             coalesce(sum(active_seconds), 0)::numeric as active_seconds
      from dwell
      group by algorithm_id, position_bucket, bucket_order
    ),
    counts as (
      select
        algorithm_id,
        position_bucket,
        bucket_order,
        count(distinct user_id)::integer as readers,
        count(*) filter (where event_type = 'impression')::integer as impressions,
        count(*) filter (where event_type = 'start')::integer as starts,
        count(*) filter (where event_type = 'complete')::integer as completes,
        count(*) filter (where event_type = 'skip')::integer as skips,
        count(*) filter (where event_type in ('like', 'share', 'comment'))::integer as reactions
      from scoped
      group by algorithm_id, position_bucket, bucket_order
    )
    select jsonb_agg(jsonb_build_object(
      'algorithmId', c.algorithm_id,
      'position', c.position_bucket,
      'readers', c.readers,
      'impressions', c.impressions,
      'starts', c.starts,
      'completes', c.completes,
      'skips', c.skips,
      'reactions', c.reactions,
      'activeSeconds', round(coalesce(d.active_seconds, 0))::integer
    ) order by c.algorithm_id, c.bucket_order)
    from counts c
    left join dwell_rollup d
      on d.algorithm_id = c.algorithm_id and d.bucket_order = c.bucket_order
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_slate_position_effects(integer, text) from public, anon, authenticated;
grant execute on function public.get_slate_position_effects(integer, text) to authenticated;
