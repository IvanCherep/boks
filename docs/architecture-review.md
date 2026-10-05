# boks Architecture Review

Current risks and the next refactors, in order. Updated 2026-10-05 after a full audit of the code, the schema and the docs. The module map itself is `docs/architecture.md`.

## What Is Strong

- Route files are thin; product surfaces are separated into reader, author, admin, formats and the series shelf.
- Ranking is one pure TypeScript seam (`buildReaderFeed`) run by the Worker and, as a labelled fallback, by the browser; it is unit-tested without a database.
- Algorithms are one file each, with a registry everything else derives from.
- Every served feed is recorded with its inputs and version stamps, so a slate can be replayed.
- Every Data API grant is explicit and asserted by `scripts/local-supabase/checks.sql`, together with RLS behaviour, on a throwaway Postgres before anything reaches production.
- Supabase is the only store; the dead D1 path is gone (`docs/adr/0013-remove-d1-compatibility-path.md`).

## Current Risks

### The reader is one very large component

`components/boks/reader-feed.tsx` owns navigation, gestures, the reading clock, event capture, outcomes, guest gates, identity, the feed sequence, formats and several sheets. Its state is read through many refs and effects, which is where the 2026-10-05 audit found most reader bugs (a first slate ranked with an empty profile, an exit outcome lost on unload, stale closures). Extract by responsibility as edits touch each area:

- `useReaderGestures` - touch, pointer, wheel and keyboard into navigation intents.
- `useReadingSession` - clock, heartbeats, outcomes and the event queue for the bok on screen.
- `useReaderIdentity` - session, account context, guest gates.
- `useReaderSequence` - the slate, appends, held place, library entries.
- `useReadingFormats` - cinema, immersive poems, the series shelf.
- Presentational pieces (menu sheet, feedback sheet, empty-feed screen, action rail) as plain components.

Put them under `components/boks/reader/`.

### Attribution is still partly a client claim

ADR 0001 moved ranking and the served-feed record to the Worker, but the Worker forwards the reader's own JWT, so the RPCs it calls are equally callable by the browser. `record_recommendation_assignment` and the event ingest store the algorithm id the caller sends. A modified client can therefore place itself in an arm, or credit events to one. The fix belongs in SQL: derive the algorithm from the stored assignment or the served-feed item, and refuse an id that is not an arm of the active experiment.

### Metrics have one catalogue, and must keep it

Rates are defined in `lib/recsys/aggregate/metrics.ts`. Ranking *signals* (`lib/boks/recommendations/signals.ts`) are features, not metrics, and may be shaped differently - but a rate shown in `/admin` must come from the catalogue. A second definition of the same rate is a bug even when the numbers agree today.

### Live aggregation

`get_recommendation_lab` and `get_recommendation_candidates` aggregate the raw event stream on every call. Both are bounded (60 days of events, 400 newest published boks), which is comfortable for a pilot and not for a large catalogue. When they drag, add daily rollups (per bok, per algorithm) maintained at ingest - not before.

### Legacy names

The bok table is still `reels` and the browser type is `Story` (`docs/adr/0007-keep-the-reels-table-name.md`). New code uses the `CONTEXT.md` terms; a rename is not planned.

## Extension Points

### Add an algorithm

One file in `lib/boks/recommendations/strategies/`, one entry in its `index.ts`, one ordering case in `lib/boks/recommendations/feed.test.ts`. The id union, the lab, the split editor and attribution derive from the registry. An algorithm with its own `rerank` must declare whether it handles reading fatigue itself; otherwise `feed.ts` applies it.

### Add a reader event

- `lib/boks/contracts.ts`: the event type and the `ReaderEvent` contract.
- A migration that widens the `recommendation_events` CHECK *and* `boks_recommendation_event_types()` - `checks.sql` asserts they are equal, because the two once drifted and a month of aftertaste events was dropped.
- `components/boks/reader-feed.tsx` for where it fires; `reader-events.ts` if it needs different flush behaviour.
- `lib/recsys/aggregate/metrics.ts` if it should affect a metric; `docs/admin-metrics.md` if an operator reads it.

### Change identity or comments

`components/boks/user-auth-panel.tsx`, `comments-sheet.tsx`, `comment-threads.ts`, `components/boks/supabase-browser-data.ts`, the profile/comment RPC migrations, `scripts/verify-supabase-mvp.mjs`, and `specs/boks-product-spec.md`. Read `docs/adr/0005-handle-is-identity-byline-is-pen-name.md` first.

### Add an admin operation on a bok

An admin-checked RPC in a new migration, the tab in `components/boks/admin/`, and the inspector (`useAdminInspector()`), never a per-tab detail view.

### Bulk import

`docs/catalogue-import.md`, `lib/boks/import/`, `scripts/build-catalogue-sql.mjs`.

## Refactor Rules

- Refactor around active change pressure, by domain responsibility, not by technical layer.
- Renaming or moving a file means updating `docs/architecture.md` and every import in the same change.
- Keep route files thin, reader choice out of `/`, admin scale controls server-side, and service-role keys out of browser code.
- Record a hard-to-reverse, surprising trade-off as an ADR in `docs/adr/` (format: `docs/agents/domain.md`).
