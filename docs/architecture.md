# boks Architecture

## Goal

boks is a browser prototype for testing a literature-only, swipe-first reading feed. The architecture keeps product behavior, recommendation logic, analytics, and demo content separated so the prototype can grow without turning every change into a full-app rewrite.

For fast agent onboarding, read `docs/ai-agent-guide.md`. For the current architecture assessment, risks, and next extraction points, read `docs/architecture-review.md`. For standards and naming, read `docs/engineering-standards.md`.

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
- `components/boks/admin-dashboard.tsx`: founder console, moderation queue, user management, metrics export, search, sorting, and content pagination.
- `components/boks/admin/recommendation-lab.tsx`: algorithm comparison, uplift against control, sample readiness, segment breakdown, and comparison export.
- `components/boks/admin/experiment-editor.tsx`: the live traffic split across every registered algorithm.
- `components/boks/admin/metric-bars.tsx`: single-series comparison bars and per-algorithm sparklines.
- `components/boks/client-types.ts`: browser-facing Story, Metrics, Comment, Recommendation, Profile, and load contracts.
- `components/boks/constants.ts`: mood, genre, empty metric, and empty reader profile constants.
- `components/boks/client-format.ts`: word count, time estimate, percentage, numeric, seconds, and story signal helpers.
- `components/boks/reader-behavior.ts`: local browser identity, reader profile persistence, and read-outcome inference.
- `components/boks/reader-events.ts`: attributed reader event queue with batching, retry and flush on tab exit.
- `components/boks/user-auth-panel.tsx`: reader account sheet for email sign-up/sign-in, settings, the authenticated Read/Liked/Commented library, and admin shortcut.
- `components/boks/reader-library.ts`: pure account-library filtering and per-action ordering.
- `components/boks/supabase-browser-data.ts`: browser-safe Supabase reader, author, account, comment, and admin data access using anonymous auth, the publishable key, RLS, and narrowly scoped RPCs.
- `components/boks/use-boks-data.ts`: Supabase-first reader/admin loading with D1 API fallback, API mutations, exports, and WebMCP metrics exposure.
- `components/boks/shared-ui.tsx`: reusable form, action, metric, and admin comparison UI primitives.
- `app/globals.css`: theme, typography, responsive behavior, focus mode, and reading layout.
- `app/api/boks/route.ts`: legacy D1 reader and bounded telemetry compatibility;
  it is not an author, comment, or admin write surface.
- `app/api/feed/route.ts`: canonical authenticated feed orchestration. The
  Worker assigns the experiment arm and records the served slate.
- `lib/boks/http-security.ts`: bounded request-body parsing and public API
  error types.
- `lib/boks/security-headers.ts`: browser security headers applied by
  `proxy.ts`.
- `lib/boks/contracts.ts`: product vocabulary, event types, the attributed `ReaderEvent` contract, and the daily submission limit. Imports nothing, so it is safe in browser, worker and test code.
- `lib/boks/recommendations/`: signals, strategy contract, strategy files, registry, experiment assignment, feed ranking, and metric derivation. Browser-safe.
- `lib/boks/author/submission-quota.ts`: the daily author limit mirrored for the UI.
- `lib/boks/analytics.ts`: reusable D1 SQL rollups, candidate selection and algorithm counters.
- `lib/boks/request.ts`: request parsing, validation, and error response helpers.
- `lib/boks/seed-stories.ts`: demo story content used by database seeding.
- `lib/boks/supabase-client.ts`: browser Supabase client and anonymous auth helper.
- `supabase/config.toml`: Supabase config with anonymous sign-ins, confirmed
  email magic links, production redirect URL, and manual linking disabled.
- `supabase/migrations/`: production MVP tables, user profiles, indexes, RLS policies, seed reels, moderation, author quota, recommendation experiments/assignments/events, and admin aggregate functions.
- `scripts/local-supabase/`: the Supabase platform shim and behavior checks used by `npm run verify:schema`.
- `db/schema.ts`: Drizzle schema for D1.
- `drizzle/`: generated migrations.
- `specs/`: product and recommendation specifications.
- `docs/`: operating and growth notes.
- `docs/ai-agent-guide.md`: fast onboarding and spec-driven development workflow for AI agents.

## Reader Flow

1. `/` creates or reads an anonymous browser id.
2. If Supabase environment variables are configured, `useBoksData` creates or reuses an anonymous Supabase session and reads a bounded batch from `public.reels`.
3. Reader impressions are recorded in `public.views`; signed-in likes are stored in `public.likes` with a unique `(user_id, reel_id)` constraint.
4. Comments are readable on published boks for all reader sessions. Creating a comment goes through `create_bok_comment()`, which rejects anonymous sessions and stores the current unique profile handle plus display name.
5. RLS allows readers to read published reels, record their own views, and manage likes only after they have a permanent account.
6. Guest access is tracked locally by distinct boks shown in the browser: notice at 5, notice at 10, sign-up required at 15.
7. Signed-in readers can open the boks wordmark for settings, unique `@nickname`, and recently read boks; this data is backed by Supabase profile, view, like, and comment rows.
8. The feed itself is ranked by `buildReaderFeed`: `get_recommendation_candidates` returns published boks with their behavior counters, and the assigned strategy orders them in the browser. Without the recommendation migration the loader falls back to newest-first and reports the `recency` baseline instead of failing.
9. Every behavior signal goes through `components/boks/reader-events.ts` into `record_recommendation_events`, attributed with algorithm, experiment, segment, feed rank, elapsed seconds and estimated duration.
10. Without Supabase config, the D1 API path ranks through the same `buildReaderFeed` and records the same attributed events in the D1 `events` table.
11. `reader-behavior.ts` updates local preference state from completed or liked stories. That state becomes the `ReaderSignals` input for personalized strategies.

## Account And Comment Flow

1. Guest readers use anonymous Supabase sessions and can read published boks and comments.
2. Likes and comment writes require a permanent account. UI gates these actions gently, and Supabase RLS/RPCs enforce the same rule.
3. Permanent profiles live in `public.user_profiles` with `display_name`, unique `handle`, role, terms fields, and account settings.
4. The reader account sheet writes profile changes through `update_boks_user_profile()`, which normalizes handles and rejects duplicates.
5. Comments are created through `create_bok_comment()`. The RPC stores both display name and unique `visitor_handle`; the reader UI shows `@nickname` only, because the handle already identifies the commenter. The stored display name remains available for admin and moderation context.
5a. A bok's byline is the author's profile identity. `submit_bok_for_review()` reads `display_name` and `handle` from `user_profiles` and ignores anything the browser might send, so a bok cannot be published under another author's name.
6. Keyboard shortcuts must ignore focus inside buttons, links, inputs, textareas, selects, and editable content so writing comments never advances the feed.

## Admin Flow

1. `/admin` first resolves `get_boks_user_context()`.
2. Anonymous users must sign in. Permanent readers without admin role see access status but no metrics.
3. If no admin exists, the first permanent user can claim admin from `/admin`. After that, only admins can grant or remove admin roles through `set_boks_admin_role()`.
4. People is a bounded `get_boks_people()` projection. Role changes, suspension, restoration, and account deletion use separate admin-only RPCs; no browser writes role or ban columns directly.
5. `Content -> Published` and `Content -> Deleted` are bounded views of `get_boks_content()`. `archive_bok()` is reversible, `restore_archived_bok()` requires a confirmed rights record, and `delete_archived_bok()` accepts only an already archived boks plus its exact title.
6. Deleting an account archives and anonymises its authored boks before deleting `auth.users`. `deleted_boks_users` retains only the UUID and deletion audit fields so a stale JWT remains blocked until expiry.
7. Admin users call `get_boks_admin_snapshot(limit, offset, query, sort)` only for the moderation queue; the remaining tabs have focused RPCs.
8. Admin export uses the same backing metrics so the displayed console and exported JSON stay aligned.

## Author And Moderation Flow

1. `/author` resolves the current Supabase user context.
2. Anonymous readers can view the form but must sign up or sign in before submitting.
3. Permanent users call `submit_bok_for_review()`. The RPC writes a private `reels` row with `status = 'pending_review'`, `author_user_id`, `submitted_at`, a 15 minute limit, and a limit of 3 submissions per UTC day. The day counter is read under a lock on the author's own profile row, so two parallel submissions cannot both slip past the limit.
3a. `get_my_bok_quota()` reports used, remaining and reset time. The author cabinet shows it and disables submission when exhausted; the database refuses a fourth submission regardless of what the UI does.
4. Authors call `get_my_bok_submissions()` to see their own submitted boks, including status and review notes.
5. Admins see pending and recently refused boks in `/admin` through `get_boks_admin_snapshot()`.
6. Admins call `review_bok_submission()` to approve or refuse. Approval changes status to `published`, which makes the bok eligible for the reader feed. Refusal stores `review_note`, visible only to the author and admins.
7. Direct browser table writes cannot publish boks. Publication status changes happen through admin-checked RPCs.

## Recommendation Flow

Ranking is TypeScript, not SQL. The database returns candidates with behavior
counters; `lib/boks/recommendations` scores and orders them. One strategy
implementation therefore serves the Supabase production path, the D1
compatibility path and the unit tests.

```text
candidates + reader signals ──▶ deriveFeedSignals ──▶ strategy.score
                                                         │
       experiment config ──▶ assignExperimentArm ────────▶ buildReaderFeed ──▶ ranked feed + experiment
```

1. `get_active_recommendation_experiment()` returns the live traffic split.
2. `assignExperimentArm` picks a deterministic arm for the visitor, so one tester
   never bounces between variants. The assignment is recorded once in
   `public.recommendation_assignments`.
3. `deriveFeedSignals` normalizes every candidate's counters into `0..1` signals.
4. The assigned strategy scores each candidate. Reading fatigue is applied in
   `feed.ts`, not by strategies, so an already-skipped boks never outranks an
   unseen one whatever the weights say.
5. Reader behavior flows back through `record_recommendation_events`.
6. `get_recommendation_lab()` returns raw per-algorithm, per-segment, per-day
   counters. `buildRecommendationLab` derives rates, uplift against control, a
   coarse confidence label and sample readiness in the browser.

When adding a recommendation strategy:

1. Create one file in `lib/boks/recommendations/strategies/`.
2. List it in that folder's `index.ts`.
3. Add a ranking case to `lib/boks/recommendations/feed.test.ts`.
4. Run `npm test`, then give it traffic in `/admin`.

Nothing else changes: the algorithm id union, the admin lab, the traffic split
editor and event attribution are all derived from the registry.

## Scaling Principles

- Reader and admin views must request bounded pages or batches.
- The reader feed must stay algorithmic; catalog exploration belongs in admin tooling, not the main experience.
- SQL returns counters; rates, uplift and confidence are derived once in `lib/boks/recommendations/metrics.ts`, so the Supabase and D1 backends cannot drift apart on what a metric means.
- D1 SQL rollups live in `lib/boks/analytics.ts`.
- Exploratory signals can live in `events.metadata`; frequently queried signals should become typed columns and indexes.
- At larger scale, replace direct event aggregation with rollup tables by story, algorithm, segment, and date. `get_recommendation_lab` and `get_recommendation_candidates` aggregate the raw event stream today and are the first two queries that will need it; both are already bounded (60 days of events, 400 newest published boks).
- Keep service role keys server-side only. Browser code must use `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, RLS, and narrowly scoped RPCs.
- Never make admin decisions from `user_metadata`, browser storage, URL flags, or UI state. Use `user_profiles.role` through RLS/RPC checks.

## AI Agent Workflow

Before implementation, read `AGENTS.md`, `docs/README.md`, the relevant spec in `specs/`, and this architecture file. Keep naming domain-specific and route changes to the smallest matching module. If a change crosses reader experience, recommendation logic, and metrics, update code and docs in the same task.

Record major architecture decisions in `docs/decisions/`.
