# boks Architecture

## Goal

boks is a browser prototype for testing a literature-only, swipe-first reading feed. The architecture keeps product behavior, recommendation logic, analytics, and demo content separated so the prototype can grow without turning every change into a full-app rewrite.

## Product Shape

The reader experience is intentionally narrow: open `/`, receive a story, read, react if needed, then swipe. Readers should not browse a catalog or choose algorithms. The product learns from behavior through impressions, starts, inferred completions, skips, likes, shares, comments, elapsed time, and scroll progress.

The founder experience is broader: `/admin` supports experiment comparison, funnel review, content operations, search, sorting, pagination, JSON export, and scale monitoring.

The author experience is constrained: `/author` lets a writer publish a short story and enforces the 15 minute promise before submission.

## Module Map

- `app/page.tsx`: reader route entrypoint.
- `app/author/page.tsx`: author route entrypoint.
- `app/admin/page.tsx`: admin route entrypoint.
- `app/boks-client.tsx`: route compatibility exports for the three product surfaces.
- `components/boks/reader-feed.tsx`: swipe-first reader experience, focus mode, inferred reading outcomes, comments, likes, and shares.
- `components/boks/author-console.tsx`: author publishing cabinet and 15 minute length guardrail.
- `components/boks/admin-dashboard.tsx`: founder console, recommendation lab, metrics export, search, sorting, and content pagination.
- `components/boks/client-types.ts`: browser-facing Story, Metrics, Comment, Recommendation, Profile, and load contracts.
- `components/boks/constants.ts`: mood, genre, empty metric, and empty reader profile constants.
- `components/boks/client-format.ts`: word count, time estimate, percentage, numeric, seconds, and story signal helpers.
- `components/boks/reader-behavior.ts`: local browser identity, reader profile persistence, and read-outcome inference.
- `components/boks/use-boks-data.ts`: data loading, API mutations, exports, and WebMCP metrics exposure.
- `components/boks/shared-ui.tsx`: reusable form, action, metric, and admin comparison UI primitives.
- `app/globals.css`: theme, typography, responsive behavior, focus mode, and reading layout.
- `app/api/boks/route.ts`: request orchestration for reader feed, author publish, comments, events, admin metrics, and exports.
- `lib/boks/contracts.ts`: server product vocabulary, event types, and algorithm ids.
- `lib/boks/recommendations.ts`: algorithm registry, deterministic assignment, and ranking SQL.
- `lib/boks/analytics.ts`: reusable SQL rollups and admin metrics.
- `lib/boks/request.ts`: request parsing, validation, and error response helpers.
- `lib/boks/seed-stories.ts`: demo story content used by database seeding.
- `db/schema.ts`: Drizzle schema for D1.
- `drizzle/`: generated migrations.
- `specs/`: product and recommendation specifications.
- `docs/`: operating and growth notes.

## Reader Flow

1. `/` creates or reads an anonymous browser id.
2. `useBoksData` requests `/api/boks?view=reader` with bounded `limit` and visitor id.
3. The API resolves a deterministic recommendation experiment for the visitor.
4. The API returns stories ranked by `recommendationOrderSql`.
5. The reader records impression, start, like, share, comment, skip, and inferred completion events.
6. `reader-behavior.ts` updates local preference state from completed or liked stories.

## Admin Flow

1. `/admin` requests `/api/boks?view=admin` with page, limit, search query, and sort.
2. The API uses shared analytics SQL to aggregate global metrics, algorithm metrics, genre and mood breakdowns, recent events, and a paginated story operations table.
3. Admin export uses the same backing metrics so the displayed console and exported JSON stay aligned.

## Recommendation Flow

Recommendation behavior is centralized in `lib/boks/recommendations.ts`. Each algorithm has an id, label, description, user segment, and ranking formula. Event attribution records the selected algorithm so `/admin` can compare variants.

When adding a recommendation strategy:

1. Extend `RecommendationAlgorithmId` in `lib/boks/contracts.ts`.
2. Add the algorithm definition and SQL ordering in `lib/boks/recommendations.ts`.
3. Update `specs/boks-recommendation-experiments.md`.
4. Verify the admin Recommendation lab still shows comparable metrics.

## Scaling Principles

- Reader and admin views must request bounded pages or batches.
- The reader feed must stay algorithmic; catalog exploration belongs in admin tooling, not the main experience.
- SQL metric definitions live in `lib/boks/analytics.ts` so ranking, admin display, and exports can stay consistent.
- Exploratory signals can live in `events.metadata`; frequently queried signals should become typed columns and indexes.
- At larger scale, replace direct event aggregation with rollup tables by story, algorithm, segment, and date.

## AI Agent Workflow

Before implementation, read `AGENTS.md`, the relevant spec in `specs/`, and this architecture file. Keep naming domain-specific and route changes to the smallest matching module. If a change crosses reader experience, recommendation logic, and metrics, update code and docs in the same task.
