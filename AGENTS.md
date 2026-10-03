# boks Agent Guide

This file is the first stop for AI coding assistants working on boks. After reading it, read `docs/project-state.md` to learn what is live and what is deliberately unfinished, `docs/local-environment-runbook.md` before running anything locally, then `docs/README.md` for the full read order and the focused spec or guide for the task. Keep changes aligned with the product promise: a reader opens the app, receives one algorithmic short literature feed, reads with minimal interface noise, and leaves behavioral signals that help compare recommendation systems.

## Product Philosophy

boks is not a book catalog and not a generic social network. It is a focused reading feed for complete short stories or book fragments that fit inside a 15 minute break.

Reader rules:

- The `/` surface stays swipe-first and algorithmic. Do not add a visible story picker, shelves, categories, or manual algorithm selection for readers.
- Reading focus matters more than interface visibility. Controls may appear on story change, tap, hover, or pause, but the story should own the screen while a person reads.
- There is no explicit finished button. Completion, drop-off, and skip behavior are inferred from elapsed time, scroll progress, and swipe timing.
- Reader-facing language should stay minimal. Do not explain the interface inside the product unless the user must make a decision.
- Guest readers see no sign-up controls at first. They receive gentle notices after 5 and 10 viewed boks and must sign up or sign in after 15 viewed boks.
- User-facing authentication is passwordless. Use Supabase email magic links only; do not add password fields, password reset, or change-password UI.
- Guest readers can read comments, but liking and writing comments require a permanent account.
- Comments must be attributed to the signed-in user's unique `@nickname`; users cannot type an arbitrary commenter name, and no display name is shown beside a comment.
- A bok's byline is derived from the author's profile by the database, not sent by the browser. `display_name` exists only so a byline reads as a name; `@nickname` is the identifier everywhere else.
- Navigate between reader, author and admin with plain anchors. vinext's `next/link` client navigation is broken in this build and silently does nothing.
- `boks` is the product term for one short content unit. `reel` remains the current Supabase table name for compatibility.

Business rules:

- The founder must be able to compare recommendation strategies by attributed behavior, not opinions alone.
- Every number in the admin console must be a measurement. No invented composite scores, no rate whose denominator is a constant, and one source of truth per concept: behaviour comes from `recommendation_events`, never from `views` or `likes`, which are product features.
- Reading time means foreground time. A clock that keeps running while the phone is locked is not a reading metric.
- An experiment is only worth reading if the arms produce different feeds and there are enough readers per arm. Both are measured, not assumed - see `npm run verify:divergence` and the readiness line in the lab.
- Admin access is a Supabase `user_profiles.role` decision. It must be granted from `/admin` and enforced by RLS/RPC checks, never by local storage, URL flags, or `user_metadata`.
- Author submission stays simple, with the 15 minute promise enforced before review, a database-enforced limit of 3 boks per author per UTC day, and admin approval required before publication.
- Recommendation ranking is TypeScript, not SQL. The database returns candidates with counters; `lib/boks/recommendations` decides the order. Adding an algorithm must stay a one-file change.
- Production reader, author, account, moderation, comment, and admin test data belongs in Supabase. Browser storage is only for anonymous local reader identity, Supabase session persistence, and lightweight profile state. D1 remains a compatibility path for the original prototype API and richer event-contract reference.

## Architecture Map

- `app/page.tsx`, `app/author/page.tsx`, `app/admin/page.tsx`: route entrypoints only.
- `app/boks-client.tsx`: route compatibility exports for the three client surfaces.
- `components/boks/reader-feed.tsx`: swipe-first reader experience and reaction controls.
- `components/boks/comments-sheet.tsx`: lazy-loaded comment conversation, one-level replies, comment likes, guest gates, and partial/full-screen sheet state.
- `components/boks/comment-threads.ts`: pure root/reply shaping and ordering rules.
- `components/boks/reader-navigation.ts`: pure direction, edge-tap, and text-boundary navigation rules shared by touch, pointer, wheel, and keyboard behavior.
- `components/boks/author-console.tsx`: author submission cabinet, review status, rejection reason, revision flow, and length guardrail.
- `components/boks/admin-dashboard.tsx`: admin auth, the tab shell, and per-tab data loading.
- `components/boks/admin/overview.tsx`: the weekly page - returning readers, reads-per-reader distribution, reading time decomposed, supply health, catalog headroom, data quality.
- `components/boks/admin/moderation-queue.tsx`, `people.tsx`, `content-operations.tsx`: the remaining tabs.
- `components/boks/admin/admin-inspector.tsx` + `inspector-context.tsx`: the console's one detail surface. Every tab opens a boks or a person with `useAdminInspector().openBok(id)` / `openPerson(userId)`; never build a per-tab detail view.
- `components/boks/admin/bok-inspector.tsx`, `person-inspector.tsx`: the two views (`get_admin_bok`, `get_admin_person`), metrics defined exactly as in the Content and People rows.
- `components/boks/admin/bok-lifecycle-dialog.tsx`: the only hide / restore / erase confirmation, shared by Content, the boks view and the reader's admin Hide button. Authority is the RPC's `is_boks_admin`, never this UI.
- `components/boks/admin/recommendation-lab.tsx`: algorithm comparison, uplift against control, sample readiness, and the live traffic split.
- `components/boks/admin/experiment-editor.tsx`: traffic weights per registered algorithm, control selection, minimum sample.
- `components/boks/admin/metric-bars.tsx`: single-series comparison bars and per-algorithm sparklines.
- `components/boks/client-types.ts`: browser-facing TypeScript contracts.
- `components/boks/constants.ts`: reusable client constants and empty state.
- `components/boks/client-format.ts`: browser formatting, estimates, percentages, and story signal helpers.
- `components/boks/reader-behavior.ts`: anonymous browser id, local reader profile, and word-count-based read/skip inference.
- `components/boks/reader-clock.ts`: foreground-only reading clock. Time on platform must mean time a boks was on screen.
- `components/boks/reader-library.ts`: pure Read/Liked/Commented account-library selection and ordering.
- `components/boks/reader-events.ts`: attributed reader event queue, batching, retry, per-read dedupe, and keepalive flush on tab exit.
- `components/boks/user-auth-panel.tsx`: reader email sign-up/sign-in, settings, the authenticated Read/Liked/Commented library, and admin shortcut.
- `components/boks/supabase-browser-data.ts`: browser-safe Supabase reader, author, account, comment, and admin data access using only the publishable key, RLS, and narrowly scoped RPCs.
- `components/boks/use-boks-data.ts`: Supabase-first reader/admin loading with D1 API fallback, mutation helpers, metrics export, and WebMCP reporting.
- `components/boks/shared-ui.tsx`: small reusable UI primitives for prototype surfaces.
- `app/globals.css`: visual system, reader focus behavior, responsive layout, and Claude-inspired light palette.
- `app/api/boks/route.ts`: HTTP orchestration for reader, author, admin, comments, events, and exports.
- `lib/boks/contracts.ts`: product vocabulary, the attributed `ReaderEvent` contract, and the daily submission limit. Imports nothing.
- `lib/boks/recommendations/`: the recommendation module. Browser-safe - the Supabase reader ranks its own feed.
  - `signals.ts`: normalized 0..1 story signals every strategy scores against.
  - `strategy.ts`: the strategy contract and `defineStrategy`.
  - `strategies/`: one file per algorithm. `strategies/index.ts` is the registry list and the only place to edit when adding one.
  - `registry.ts`: lookup, display, segment filtering.
  - `experiments.ts`: traffic split config, validation, deterministic assignment.
  - `feed.ts`: `buildReaderFeed`, the one seam both backends rank through.
  - `metrics.ts`: raw counters to rates, uplift, and sample readiness.
  - `divergence.ts`: do the algorithms even produce different feeds? Run before trusting any comparison.
- `lib/boks/author/submission-quota.ts`: the daily submission limit mirrored for the UI; the database stays the authority.
- `lib/boks/analytics.ts`: reusable D1 SQL rollups, admin sorting, and algorithm counter queries.
- `lib/boks/request.ts`: request parsing, validation, and API error helpers.
- `lib/boks/http-security.ts`: bounded JSON request parsing and safe HTTP error boundaries.
- `lib/boks/security-headers.ts`: CSP, HSTS, frame, referrer, MIME, and permissions headers applied by `proxy.ts`.
- `lib/boks/seed-stories.ts`: demo story inventory for local and production seeding.
- `lib/boks/supabase-client.ts`: browser Supabase client factory and anonymous auth helper.
- `db/schema.ts` and `drizzle/`: D1 schema and migrations.
- `supabase/config.toml` and `supabase/migrations/`: Supabase Auth config, user profiles, RLS schema, seed reels, moderation, author quota, recommendation experiments/assignments/events, and aggregate admin RPCs.
- `scripts/verify-schema-local.mjs` and `scripts/local-supabase/`: offline migration + behavior checks on a throwaway Postgres container.
- `scripts/run-supabase-flow-test.mjs`: full product flow against a local `supabase start` stack.
- `specs/`: product and experiment contracts.
- `docs/`: operating, architecture, and growth-readiness guidance.
- `docs/project-state.md`: what is live, what is not in production, the state of the recommender and the identity model, and the known open issues. Start here.
- `docs/local-environment-runbook.md`: getting a working local boks, and the traps that are invisible from the code - which env file reaches which backend, the local mailbox, an admin account, and why a passing `verify:schema` does not mean your migration is in the running stack.
- `docs/catalogue-import.md`: loading a catalogue - the publisher-account model, the file format, the admin panel, and how to generate and remove test batches. Read it before putting content on the platform in bulk.
- `docs/copyright.md`: the rights attestation on publishing, the per-bok report menu, and what an admin can do about a complaint. Read it before touching publishing or the reader's bok menu.
- `docs/public-domain-corpus.md`: the 457 real pieces on the platform - where they come from, why they are free to publish, how the splitter works and what it got wrong first.
- `docs/thesis/`: исследовательская часть магистерской работы в формате ВКРС - словарь терминов, вводные с замеренными цифрами, карта литературы, дерево гипотез, карточки отобранных гипотез с дизайном эксперимента, линейка baseline, питч-дек и каркасы отчётов. Начинать с `docs/thesis/README.md`.
- `docs/russian-corpus.md`: the 449 Russian pieces - the source, the copyright bar, the wikitext converter and what it got wrong first.
- `docs/reading-languages.md`: which language a reader is offered - the browser-derived default, the mandatory setting, the filter in retrieval, and why an undetermined language is not a yes.
- `docs/analytics-and-thesis-readiness.md`: what the analytics can and cannot prove, claim by claim against the thesis title, the working loop for a comparison, and the ranked gaps.
- `docs/README.md`: documentation index and read order.
- `docs/ai-agent-guide.md`: fast onboarding, ownership map, spec-driven workflow, and deployment rules for any AI agent.
- `docs/engineering-standards.md`: naming, boundaries, values, and AI-agent workflow.
- `docs/hosting.md`: Cloudflare production deploy and URL operations.
- `docs/testing.md`: user testing, product QA, and technical verification.
- `docs/architecture-review.md`: current architecture risks and next refactor sequence.

## Change Routing

- Reader experience: start in `components/boks/reader-feed.tsx`, `components/boks/reader-behavior.ts`, and `app/globals.css`.
- Author cabinet: start in `components/boks/author-console.tsx`, `components/boks/supabase-browser-data.ts`, and Supabase submission/review RPC migrations.
- Admin metrics and moderation: start in `components/boks/admin-dashboard.tsx`, `components/boks/supabase-browser-data.ts`, Supabase RPC migrations, `lib/boks/analytics.ts`, and `app/api/boks/route.ts`.
- User management: start in `components/boks/user-auth-panel.tsx`, `components/boks/admin-dashboard.tsx`, `components/boks/supabase-browser-data.ts`, `lib/boks/supabase-client.ts`, and Supabase migrations.
- Recommendation algorithms: add one file under `lib/boks/recommendations/strategies/`, list it in that folder's `index.ts`, add a ranking case to `lib/boks/recommendations/feed.test.ts`. Update `specs/boks-recommendation-experiments.md` only if the contract itself changed.
- Recommendation metrics or attribution: `lib/boks/recommendations/metrics.ts`, `lib/boks/contracts.ts`, the Supabase migration, and `specs/boks-recommendation-experiments.md` together.
- Author submission limits: `lib/boks/contracts.ts`, `lib/boks/author/submission-quota.ts`, the Supabase `submit_bok_for_review` / `get_my_bok_quota` migration, and `components/boks/author-console.tsx`.
- Interactive boks (the cinema format: pictures, a recorded voice, scene changes, and places where the story stops and asks something): read `docs/interactive-boks.md` first. It carries the cast list, the image specification and the prompts to hand the user, the twelve existing effects and which frames each one needs, where a moment may and may not be placed, and how to set an audio level by measurement. Start in `components/boks/cinema/`.
- Seed/demo content: update `lib/boks/seed-stories.ts`.
- Supabase persistent data: update `supabase/migrations/` with RLS and indexes, then run `npm run verify:supabase`. A new table or view the Data API must reach needs its own `grant` in the same migration that creates it - Supabase stopped granting new objects in `public` automatically on 30 October 2026, and `scripts/local-supabase/checks.sql` asserts the whole grant matrix. Prefer a security-definer function over a grant, and never grant a write on a view: a view without `security_invoker` runs as its owner and bypasses RLS.
- D1 compatibility data: update `db/schema.ts`, then generate a Drizzle migration.
- Product decisions: update `specs/boks-product-spec.md` before or with implementation.
- Hosting/deployment: update `wrangler.jsonc`, `docs/hosting.md`, and `docs/future-updates-playbook.md` together.
- Testing process: update `docs/testing.md` and `docs/boks-operations.md` together.

## Growth Guardrails

- Never load the full story catalog into the reader or admin browser session. Use bounded batches, server-side search, sorting, and pagination.
- Keep recommendation events attributed with `algorithmId`, `userSegment`, `surface`, `rank`, elapsed time, and useful metadata.
- Add high-volume metrics as indexed structured fields only when the UI or algorithm queries them often. Keep exploratory signals in event metadata.
- Preserve deterministic algorithm assignment until real authentication exists, so a tester does not bounce between variants during one study.
- Never expose a Supabase service role key in source, frontend code, Wrangler vars, docs, screenshots, or browser console output.
- Keep naming literal and domain-specific. Prefer `reader`, `story`, `recommendation`, `experiment`, `event`, `metric`, and `author` over generic names.

## Validation

Run these before publishing changes:

```bash
npm run lint
npm run typecheck
npm test                 # offline unit tests
npm run verify:divergence # do the live arms actually differ? (needs a running stack)
npm run verify:schema    # migrations + RLS behavior on a throwaway Postgres container (needs Docker)
npm run verify:supabase  # RLS checks against the configured Supabase project
npm run build
npm run start
```

Full product flow against a local Supabase stack (creates users; never point it
at a real project):

```bash
npx supabase start
npm run test:supabase
```

With the local server running, check:

- `/`
- `/author`
- `/admin`
- `/api/boks?view=reader&limit=20&visitorId=agent-check`
- `/api/boks?view=admin&limit=20`

If the D1 schema changed, also generate and review a migration:

```bash
npm run db:generate
```

Local D1 does not auto-migrate. Apply a new Drizzle migration to the running
local worker with:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
  d1 execute DB --config dist/server/wrangler.json --local \
  --persist-to .wrangler/state --file drizzle/<migration>.sql
```
