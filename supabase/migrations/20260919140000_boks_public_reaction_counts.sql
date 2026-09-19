-- Like and comment counts, for a boks opened outside the feed.
--
-- The rail now shows how many people liked a boks and how many replied, next
-- to each icon and always, including zero. Until now it showed a count only
-- for comments, and a like as a state with no number, on the reasoning that a
-- like is private: the `likes` row-level policy lets a reader see only their
-- own rows, so a client-side count would be the reader's own 0 or 1.
--
-- The aggregate was never private, though. `get_recommendation_candidates` is
-- security definer and already returns every candidate's total `likes` and
-- `comments` to every reader, guests included - the feed simply dropped the
-- number on the way to the screen. So the feed path needs no new function; it
-- carries the totals it already has.
--
-- This is for the other path: a boks opened from the reader's library or from
-- a shared link that is not in the current slate. That path reads
-- `published_boks` directly, which has no counts, and could only ever have
-- shown the reader's own like. It returns the same aggregate the feed does -
-- counts only, never who - for published boks only.
--
-- Capped at 200 ids per call, the size of a feed, so it cannot be asked for
-- the whole catalogue in one request.

create or replace function public.get_bok_reactions(p_reel_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id::text,
    -- The same counts `get_recommendation_candidates` returns, so the rail
    -- shows one number whichever way the boks was reached. A schema check
    -- asserts the two agree.
    'likes', (select count(*)::integer from public.likes l where l.reel_id = r.id),
    'comments', (select count(*)::integer from public.comments c where c.reel_id = r.id)
  )), '[]'::jsonb)
  from public.reels r
  where r.id = any ((coalesce(p_reel_ids, array[]::uuid[]))[1:200])
    and r.status = 'published';
$$;

comment on function public.get_bok_reactions(uuid[]) is
  'Public like and comment counts for up to 200 published boks. Aggregates only - never who liked or commented.';

revoke all on function public.get_bok_reactions(uuid[]) from public, anon, authenticated;
grant execute on function public.get_bok_reactions(uuid[]) to anon, authenticated;
