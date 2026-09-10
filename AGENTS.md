# boks Agent Guide

This file is the first stop for AI coding assistants working on boks. After reading it, read `docs/README.md` and the focused spec or guide for the task. Keep changes aligned with the product promise: a reader opens the app, receives one algorithmic short literature feed, reads with minimal interface noise, and leaves behavioral signals that help compare recommendation systems.

## Product Philosophy

boks is not a book catalog and not a generic social network. It is a focused reading feed for complete short stories or book fragments that fit inside a 15 minute break.

Reader rules:

- The `/` surface stays swipe-first and algorithmic. Do not add a visible story picker, shelves, categories, or manual algorithm selection for readers.
- Reading focus matters more than interface visibility. Controls may appear on story change, tap, hover, or pause, but the story should own the screen while a person reads.
- There is no explicit finished button. Completion, drop-off, and skip behavior are inferred from elapsed time, scroll progress, and swipe timing.
- Reader-facing language should stay minimal. Do not explain the interface inside the product unless the user must make a decision.
- Guest readers see no sign-up controls at first. They receive gentle notices after 5 and 10 viewed boks and must sign up or sign in after 15 viewed boks.
- `boks` is the product term for one short content unit. `reel` remains the current Supabase table name for compatibility.

Business rules:

- The founder must be able to compare recommendation strategies by attributed behavior, not opinions alone.
- Admin access is a Supabase `user_profiles.role` decision. It must be granted from `/admin` and enforced by RLS/RPC checks, never by local storage, URL flags, or `user_metadata`.
- Author publishing stays simple, with the 15 minute promise enforced before publication.
- Production reader test data belongs in Supabase. Browser storage is only for anonymous local reader identity, Supabase session persistence, and lightweight profile state. D1 remains the compatibility backend for the original author/API prototype until that surface is migrated.

## Architecture Map

- `app/page.tsx`, `app/author/page.tsx`, `app/admin/page.tsx`: route entrypoints only.
- `app/boks-client.tsx`: route compatibility exports for the three client surfaces.
- `components/boks/reader-feed.tsx`: swipe-first reader experience and reaction controls.
- `components/boks/author-console.tsx`: author publishing cabinet and length guardrail.
- `components/boks/admin-dashboard.tsx`: founder/admin metrics, recommendation lab, export, and content operations.
- `components/boks/client-types.ts`: browser-facing TypeScript contracts.
- `components/boks/constants.ts`: reusable client constants and empty state.
- `components/boks/client-format.ts`: browser formatting, estimates, percentages, and story signal helpers.
- `components/boks/reader-behavior.ts`: anonymous browser id, local reader profile, and completion/skip inference.
- `components/boks/user-auth-panel.tsx`: reader email sign-up/sign-in, settings, recent read boks, and admin shortcut.
- `components/boks/supabase-browser-data.ts`: browser-safe Supabase reader/admin data access using only the publishable key and RLS.
- `components/boks/use-boks-data.ts`: Supabase-first reader/admin loading with D1 API fallback, mutation helpers, metrics export, and WebMCP reporting.
- `components/boks/shared-ui.tsx`: small reusable UI primitives for prototype surfaces.
- `app/globals.css`: visual system, reader focus behavior, responsive layout, and Claude-inspired light palette.
- `app/api/boks/route.ts`: HTTP orchestration for reader, author, admin, comments, events, and exports.
- `lib/boks/contracts.ts`: server-side product vocabulary and recommendation experiment ids.
- `lib/boks/recommendations.ts`: recommendation registry, deterministic assignment, and SQL ordering formulas.
- `lib/boks/analytics.ts`: reusable SQL rollups, admin sorting, and algorithm comparison metrics.
- `lib/boks/request.ts`: request parsing, validation, and API error helpers.
- `lib/boks/seed-stories.ts`: demo story inventory for local and production seeding.
- `lib/boks/supabase-client.ts`: browser Supabase client factory and anonymous auth helper.
- `db/schema.ts` and `drizzle/`: D1 schema and migrations.
- `supabase/config.toml` and `supabase/migrations/`: Supabase Auth config, user profiles, RLS schema, seed reels, and aggregate admin RPC.
- `specs/`: product and experiment contracts.
- `docs/`: operating, architecture, and growth-readiness guidance.
- `docs/README.md`: documentation index and read order.
- `docs/engineering-standards.md`: naming, boundaries, values, and AI-agent workflow.
- `docs/hosting.md`: Cloudflare production deploy and URL operations.
- `docs/testing.md`: user testing, product QA, and technical verification.
- `docs/architecture-review.md`: current architecture risks and next refactor sequence.

## Change Routing

- Reader experience: start in `components/boks/reader-feed.tsx`, `components/boks/reader-behavior.ts`, and `app/globals.css`.
- Author cabinet: start in `components/boks/author-console.tsx` and shared validation in `app/api/boks/route.ts`.
- Admin metrics: start in `components/boks/admin-dashboard.tsx`, `components/boks/supabase-browser-data.ts`, Supabase RPC migrations, `lib/boks/analytics.ts`, and `app/api/boks/route.ts`.
- User management: start in `components/boks/user-auth-panel.tsx`, `components/boks/admin-dashboard.tsx`, `components/boks/supabase-browser-data.ts`, `lib/boks/supabase-client.ts`, and Supabase migrations.
- Recommendation algorithms: update `lib/boks/contracts.ts`, `lib/boks/recommendations.ts`, and `specs/boks-recommendation-experiments.md` together.
- Seed/demo content: update `lib/boks/seed-stories.ts`.
- Supabase persistent data: update `supabase/migrations/` with RLS and indexes, then run `npm run verify:supabase`.
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
npm run verify:supabase
node /Users/iegorov/.codex/plugins/cache/openai-bundled/sites/0.1.66/scripts/build-site.mjs
npm run start
```

With the local server running, check:

- `/`
- `/author`
- `/admin`
- `/api/boks?view=reader&limit=20&visitorId=agent-check`
- `/api/boks?view=admin&limit=20`

If schema changed, also generate and review a migration:

```bash
npm run db:generate
```
