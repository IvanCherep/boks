# boks Growth Readiness

This note describes how the current prototype supports a test with about 40,000 texts and 100-400 readers, and what must change before larger growth.

## Ready Now

- Reader feed requests load bounded batches rather than the whole catalog.
- Reader events are attributed to recommendation algorithm, segment, surface, feed rank, elapsed seconds, and metadata.
- Admin content operations use server-side pagination, search, and sorting.
- Recommendation algorithms are registered in one server module and compared in the admin Recommendation lab.
- Demo stories are isolated in `lib/boks/seed-stories.ts`, so API behavior can evolve without mixing content and routing code.
- Client helpers are split by concern: formatting, data access, behavior inference, shared UI, constants, and types.

## Current Limits

- Reader, author, and admin surfaces are now separate component files. The next UI growth step should extract smaller subcomponents inside each surface only when repeated behavior appears.
- Analytics are calculated directly from event tables. This is fine for early testing, but larger usage needs precomputed rollups.
- Seed content is bundled in source code. A 40,000 story catalog needs an import pipeline and editorial operations.
- There is no authentication, role separation, or moderation workflow yet.
- Search is simple SQL matching, not full-text search.

## Next Scaling Moves

1. Add a bulk import pipeline for stories with validation for title, author, hook, body, genre, mood, reading minutes, language, rights, and status.
2. Add moderation states before public publishing: draft, submitted, approved, rejected, published, archived.
3. Move high-volume analytics to rollup tables by story, algorithm, segment, and day.
4. Add background jobs for rollup refreshes, export generation, and import processing.
5. Add full-text search for admin operations, not reader choice.
6. Add authentication and roles for founder, admin, author, and tester.
7. Add event deduplication and sessionization, especially for impressions and starts.
8. Add cohort exports so investor updates can compare fixed time windows and experiment groups.

## Recommendation Experiment Rules

- Keep `balanced` as the control variant unless the spec changes.
- Do not compare algorithms before there are enough attributed impressions. For this prototype, wait for at least 30-50 impressions per variant.
- Compare finish rate, reaction rate, skip rate, read time, speed, and engagement score together. Do not optimize only for likes.
- Preserve reader invisibility: users should never manually select the algorithm.
- New algorithm ids must be added to `lib/boks/contracts.ts`, implemented in `lib/boks/recommendations.ts`, and documented in `specs/boks-recommendation-experiments.md`.

## Data Quality Checklist

- Every reader event has `storyId`, `eventType`, `visitorId`, `algorithmId`, `userSegment`, `surface`, and `rank` when available.
- Completion events include read seconds as `value`.
- Likes, shares, comments, skips, and starts include elapsed seconds when available.
- Comments stay tied to story and anonymous visitor.
- Exports are saved before major content or algorithm changes.
