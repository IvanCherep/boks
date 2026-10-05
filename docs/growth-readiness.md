# boks Growth Readiness

How the current build supports a pilot of a few hundred readers and a catalogue in the thousands, and what must change before larger growth.

## Ready Now

- Reader feed requests load bounded batches rather than the whole catalog.
- Reader events are attributed to algorithm, experiment, segment, surface, feed rank, feed id, foreground seconds and progress, and every served slate is recorded.
- Admin content operations use server-side pagination, search, and sorting.
- Recommendation algorithms are registered in one module (`lib/boks/recommendations/`), ranked in the Worker, and compared in the admin Recommendation lab.
- The catalogue is loaded by an idempotent import pipeline (`docs/catalogue-import.md`), not bundled in source.
- Client helpers are split by concern: formatting, data access, behavior inference, shared UI, constants, and types.
- Supabase reader/admin/author MVP uses bounded queries, indexed `reels`, `views`, `likes`, `comments`, `user_profiles`, and aggregate RPCs for the business console.

## Current Limits

- Reader, author, and admin surfaces are now separate component files. The next UI growth step should extract smaller subcomponents inside each surface only when repeated behavior appears.
- Behaviour metrics aggregate the raw `recommendation_events` stream on every request. Fine for a pilot; larger usage needs precomputed daily rollups.
- Reader access uses anonymous Supabase Auth. Permanent accounts, unique `@handle`, admin role management, author submission, and moderation are present, but still MVP-level.
- Search is simple SQL matching, not full-text search.

## Next Scaling Moves

1. Move high-volume analytics to daily rollup tables by bok, algorithm and day, maintained at ingest.
2. Derive event attribution on the server from the stored assignment or the served-feed item instead of the algorithm id the client sends.
3. Add background jobs for rollup refreshes, export generation and import processing.
4. Add full-text search for admin operations, never for reader choice.
5. Add cohort exports so investor updates can compare fixed time windows and experiment groups.

## Recommendation Experiment Rules

- `for_you` is the control and, while the audience is small, the only live arm (`docs/adr/0008-for-you-is-control-single-live-arm.md`).
- Compare by readers, not events: a comparison is readable only when each arm has the minimum readers the lab asks for and `npm run verify:divergence` shows the arms produce different feeds.
- Compare finish rate, skip rate, reaction rate and reading time together, each as defined in `lib/recsys/aggregate/metrics.ts`. Never optimise for likes alone, and never combine them into a composite score.
- Readers never select an algorithm.
- A new algorithm is one file in `lib/boks/recommendations/strategies/` plus a list entry in that folder's `index.ts`.
- `get_recommendation_candidates` ranks a bounded set (400 newest published boks, 60 days of events). Past that, add precomputed daily rollups rather than raising the bound.

## Data Quality Checklist

- Every reader event has `storyId`, `eventType`, `visitorId`, `algorithmId`, `userSegment`, `surface`, and `rank` when available.
- Completion events include read seconds as `value`.
- Likes, shares, comments, skips, and starts include elapsed seconds when available.
- Comments stay tied to the bok, the permanent user id and the unique `@handle`.
- Exports are saved before major content or algorithm changes.
- Supabase RLS checks pass with `npm run verify:supabase` before every public deploy.
