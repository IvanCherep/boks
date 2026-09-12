# boks Recommendation Experiments Spec

## Purpose

The recommendation framework tests which feed strategy creates the strongest reading behavior. Readers never choose an algorithm manually. The system assigns them to an experiment and records every action with that assignment.

## Current Algorithms

- `balanced`: control variant that mixes completion, reactions, comments, shares, freshness, and exploration.
- `completion_first`: favors stories people finish after starting.
- `reaction_first`: favors stories that create likes, shares, or comments quickly.
- `discovery`: gives newer and under-tested stories more chances.
- `supabase_recent`: temporary Supabase production MVP feed that serves newest published reels and records views, signed-in likes, and profile-owned comments. Use it for deployment validation, not as the final experiment framework.

## Event Contract

Every reader event should include:

- `algorithmId`: assigned recommendation algorithm.
- `userSegment`: deterministic segment for the anonymous visitor.
- `surface`: reader, author, or admin surface.
- `rank`: zero-based story position in the delivered feed.
- `clientElapsedSeconds`: seconds since the current story impression.
- `value`: event-specific numeric value. Completion uses read seconds; most other events use `1`.
- `metadata`: optional JSON for low-volume exploratory fields.

The current Supabase MVP stores production `views`, signed-in `likes`, and profile-owned `comments`, but it does not yet store full algorithm assignment and elapsed-time attribution for every behavior. Before comparing algorithms seriously on Supabase, add an attributed event table that matches this contract.

## Metrics

- `startRate`: starts divided by impressions.
- `finishRate`: completions divided by starts.
- `reactionRate`: likes, shares, and comments divided by completions.
- `skipRate`: skips divided by starts plus skips.
- `avgReadSeconds`: average completion read time.
- `avgSecondsToLike`: average time between story impression and like.
- `avgSecondsToComment`: average time between story impression and comment.
- `avgStartRank`: average feed rank where users start reading.
- `paceIndex`: estimated story duration divided by actual completion seconds. Values above `1` mean faster-than-estimated reading.
- `engagementScore`: weighted score for completions, reactions, comments, and skips.

## Adding an Algorithm

1. Add a new `RecommendationAlgorithmId` in `lib/boks/contracts.ts`.
2. Add a registry entry in `lib/boks/recommendations.ts` with a clear name, description, segment, and weights.
3. Keep the ranking expression based on existing rollup fields unless a migration adds a new indexed signal.
4. Run lint, build, and a reader API check.
5. Let at least 30-50 attributed impressions accumulate before comparing the variant.

## Decision Rules

Use `balanced` as the control. A new algorithm should beat control on finish rate or reaction rate without a large skip-rate increase. Do not optimize only for likes if average read time collapses or completion drops.
