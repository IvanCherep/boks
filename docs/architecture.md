# boks Architecture

## Goal

boks is a browser prototype for testing a literature-only, swipe-first reading feed. The architecture keeps product behavior, recommendation logic, analytics, and demo content separated so the prototype can grow without turning every change into a full-app rewrite.

For the current architecture assessment, risks, and next extraction points, read `docs/architecture-review.md`. For standards and naming, read `docs/engineering-standards.md`.

## Product Shape

The reader experience is intentionally narrow: open `/`, receive a story, read, react if needed, then swipe. Readers should not browse a catalog or choose algorithms. The product learns from behavior through impressions, starts, inferred completions, skips, likes, shares, comments, elapsed time, and scroll progress.

The founder experience is broader: `/admin` supports experiment comparison, funnel review, moderation review, content operations, search, sorting, pagination, JSON export, user management, and scale monitoring. In the Supabase production MVP it reads aggregate metrics and moderation queues through admin-only browser-safe RPCs rather than exposing raw cross-user rows.

The author experience is constrained: `/author` lets any permanent user submit a bok for review, see whether it is waiting, published, or refused, and revise refused boks. Admin approval is required before a submitted bok reaches the reader feed.

## Module Map

- `app/page.tsx`: reader route entrypoint.
- `app/author/page.tsx`: author route entrypoint.
- `app/admin/page.tsx`: admin route entrypoint.
- `app/boks-client.tsx`: route compatibility exports for the three product surfaces.
- `components/boks/reader-feed.tsx`: swipe-first reader experience, focus mode, inferred reading outcomes, comments, likes, and shares.
- `components/boks/author-console.tsx`: author submission cabinet, status history, rejection reasons, revision flow, and 15 minute length guardrail.
- `components/boks/admin-dashboard.tsx`: founder console, moderation queue, recommendation lab, metrics export, search, sorting, and content pagination.
- `components/boks/client-types.ts`: browser-facing Story, Metrics, Comment, Recommendation, Profile, and load contracts.
- `components/boks/constants.ts`: mood, genre, empty metric, and empty reader profile constants.
- `components/boks/client-format.ts`: word count, time estimate, percentage, numeric, seconds, and story signal helpers.
- `components/boks/reader-behavior.ts`: local browser identity, reader profile persistence, and read-outcome inference.
- `components/boks/user-auth-panel.tsx`: reader account sheet for email sign-up/sign-in, settings, recent read boks, and admin shortcut.
- `components/boks/supabase-browser-data.ts`: browser-safe Supabase reader, author, and admin data access using anonymous auth, the publishable key, RLS, and narrowly scoped RPCs.
- `components/boks/use-boks-data.ts`: Supabase-first reader/admin loading with D1 API fallback, API mutations, exports, and WebMCP metrics exposure.
- `components/boks/shared-ui.tsx`: reusable form, action, metric, and admin comparison UI primitives.
- `app/globals.css`: theme, typography, responsive behavior, focus mode, and reading layout.
- `app/api/boks/route.ts`: request orchestration for reader feed, author publish, comments, events, admin metrics, and exports.
- `lib/boks/contracts.ts`: server product vocabulary, event types, and algorithm ids.
- `lib/boks/recommendations.ts`: algorithm registry, deterministic assignment, and ranking SQL.
- `lib/boks/analytics.ts`: reusable SQL rollups and admin metrics.
- `lib/boks/request.ts`: request parsing, validation, and error response helpers.
- `lib/boks/seed-stories.ts`: demo story content used by database seeding.
- `lib/boks/supabase-client.ts`: browser Supabase client and anonymous auth helper.
- `supabase/config.toml`: Supabase config with anonymous sign-ins, email sign-up, production redirect URL, and manual linking documented.
- `supabase/migrations/`: production MVP tables, user profiles, indexes, RLS policies, seed reels, and admin aggregate functions.
- `db/schema.ts`: Drizzle schema for D1.
- `drizzle/`: generated migrations.
- `specs/`: product and recommendation specifications.
- `docs/`: operating and growth notes.

## Reader Flow

1. `/` creates or reads an anonymous browser id.
2. If Supabase environment variables are configured, `useBoksData` creates or reuses an anonymous Supabase session and reads a bounded batch from `public.reels`.
3. Reader impressions are recorded in `public.views`; signed-in likes are stored in `public.likes` with a unique `(user_id, reel_id)` constraint.
4. Comments are readable on published boks for all reader sessions. Creating a comment goes through `create_bok_comment()`, which rejects anonymous sessions and stores the current unique profile handle plus display name.
5. RLS allows readers to read published reels, record their own views, and manage likes only after they have a permanent account.
6. Guest access is tracked locally by distinct boks shown in the browser: notice at 5, notice at 10, sign-up required at 15.
7. Signed-in readers can open the boks wordmark for settings, unique `@nickname`, and recently read boks; this data is backed by Supabase profile, view, like, and comment rows.
8. Without Supabase config, the original D1 API path resolves deterministic recommendation experiments and records richer prototype events.
9. `reader-behavior.ts` updates local preference state from completed or liked stories.

## Admin Flow

1. `/admin` first resolves `get_boks_user_context()`.
2. Anonymous users must sign in. Permanent readers without admin role see access status but no metrics.
3. If no admin exists, the first permanent user can claim admin from `/admin`. After that, only admins can grant or remove admin roles through `set_boks_admin_role()`.
4. Admin users call `get_boks_admin_snapshot(limit, offset, query, sort)`.
5. The RPC returns global aggregate metrics, genre and mood rollups, recent aggregate event rows, moderation queue rows, recent permanent users, and a paginated story operations table.
6. Admin export uses the same backing metrics so the displayed console and exported JSON stay aligned.

## Author And Moderation Flow

1. `/author` resolves the current Supabase user context.
2. Anonymous readers can view the form but must sign up or sign in before submitting.
3. Permanent users call `submit_bok_for_review()`. The RPC writes a private `reels` row with `status = 'pending_review'`, `author_user_id`, `submitted_at`, and a 15 minute limit.
4. Authors call `get_my_bok_submissions()` to see their own submitted boks, including status and review notes.
5. Admins see pending and recently refused boks in `/admin` through `get_boks_admin_snapshot()`.
6. Admins call `review_bok_submission()` to approve or refuse. Approval changes status to `published`, which makes the bok eligible for the reader feed. Refusal stores `review_note`, visible only to the author and admins.
7. Direct browser table writes cannot publish boks. Publication status changes happen through admin-checked RPCs.

## Recommendation Flow

Recommendation behavior is centralized in `lib/boks/recommendations.ts`. Each algorithm has an id, label, description, user segment, and ranking formula. Event attribution records the selected algorithm so `/admin` can compare variants.

The Supabase direct-browser MVP currently uses `supabase_recent` as a production smoke-test feed. Before running serious algorithm comparisons on Supabase, add an attributed `events` table or typed recommendation assignment table there; keep the older D1 event contract as the reference for the metrics shape.

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
- Keep service role keys server-side only. Browser code must use `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, RLS, and narrowly scoped RPCs.
- Never make admin decisions from `user_metadata`, browser storage, URL flags, or UI state. Use `user_profiles.role` through RLS/RPC checks.

## AI Agent Workflow

Before implementation, read `AGENTS.md`, `docs/README.md`, the relevant spec in `specs/`, and this architecture file. Keep naming domain-specific and route changes to the smallest matching module. If a change crosses reader experience, recommendation logic, and metrics, update code and docs in the same task.

Record major architecture decisions in `docs/decisions/`.
