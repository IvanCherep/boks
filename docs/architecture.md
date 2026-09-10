# boks Architecture

## Goal

boks is a browser prototype for testing a literature-only, swipe-first reading feed. The code is organized so future AI coding assistants can change one product concern at a time.

## Main Areas

- `app/boks-client.tsx`: reader, author, and admin UI state.
- `app/api/boks/route.ts`: request orchestration, D1 reads/writes, response assembly.
- `lib/boks/contracts.ts`: shared product vocabulary and experiment types.
- `lib/boks/recommendations.ts`: recommendation algorithm registry, cohort assignment, SQL ranking formulas.
- `lib/boks/analytics.ts`: reusable SQL for story rollups, admin sorting, and algorithm comparison metrics.
- `lib/boks/request.ts`: request parsing, validation helpers, and API error messages.
- `db/schema.ts`: D1 schema managed through Drizzle migrations.

## Growth Rules

Keep user-facing algorithms named and versioned in `lib/boks/recommendations.ts`. Avoid anonymous ranking logic in the UI, because the admin comparison view depends on knowing which algorithm caused each event.

Store new behavioral signals as structured columns only when they are queried often. Keep rare or exploratory signals in `events.metadata` until they prove useful.

Reader requests should load a bounded feed batch. Admin requests should keep server-side pagination, search, and sorting; do not load the full story catalog into the browser.

## Data Flow

1. The reader opens `/`.
2. The browser sends its anonymous visitor ID to `/api/boks?view=reader`.
3. The API assigns a deterministic recommendation experiment.
4. The API returns stories ordered by the assigned algorithm.
5. The reader tracks impressions, starts, completions, likes, shares, skips, and comments with algorithm context.
6. `/admin` aggregates these events into global funnel metrics and algorithm comparison rows.
