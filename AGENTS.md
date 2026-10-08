# boks Agent Guide

boks is a focused reading feed of complete short literature - each **bok** fits a 15-minute break - built so the founder can compare recommendation algorithms by measured reading behaviour. A reader opens the app, gets one algorithmic swipe-first feed, reads with minimal interface, and leaves attributed behavioural signals.

Read in this order, then the focused doc for the task:

1. `CONTEXT.md` - the glossary. Use its terms in code, tests, issues and commits.
2. `docs/project-state.md` - what is live, what is deliberately unfinished, open issues.
3. `docs/README.md` - the index: which doc owns which topic.
4. `docs/architecture.md` - module map and data flows. `docs/adr/` - why things are the way they are.

Before running anything locally, read `docs/local-environment-runbook.md`: which env file reaches which backend is not visible from the code.

## Reader rules

- The feed (`/`) is one algorithmic, swipe-first stream. No picker, categories or reader-chosen algorithm. The series shelf (`/series`) is the single exception and lists only series pieces (`docs/adr/0009-series-shelf-is-the-one-shelf.md`).
- The bok owns the screen while a person reads; controls appear on story change, tap, hover or pause. Reader copy stays minimal; the interface is English, texts keep their own language.
- There is no "finished" button. Read, skip and drop-off are inferred from foreground time, scroll progress and swipe timing.
- Guests see no sign-up controls at first, get gentle notices after 5 and 10 boks, and must sign up after 15. Guests may read comments; liking, commenting and following need an account.
- Sign-in is passwordless: Supabase email OTP - a magic link or the 6-digit code from the same email (`docs/adr/0006-passwordless-email-sign-in.md`). Never add password fields, reset or change-password UI.
- A person is identified only by their unique `@handle`; comments are attributed to it and nobody types a commenter name. A bok's byline is a per-bok pen name chosen when publishing (`docs/adr/0005-handle-is-identity-byline-is-pen-name.md`).
- Navigate between reader, author and admin with plain `<a>` anchors: vinext's `next/link` client navigation silently does nothing in this build.

## Business rules

- Algorithms are compared by attributed behaviour, never opinions.
- Every admin number is a measurement: no invented composite scores, no rate over a constant denominator, one source of truth per concept. Behaviour comes from `recommendation_events`, never from `views` or `likes` (those are product features).
- Reading time means foreground time; a clock running on a locked phone is not a metric.
- A comparison is only worth reading if the arms produce different feeds and each arm has enough readers - measured with `npm run verify:divergence` and the lab's readiness line, not assumed.
- Admin access is `user_profiles.role`, granted from `/admin` and enforced by RLS/RPC. Never by local storage, URL flags or `user_metadata`.
- Authors: 15-minute promise enforced before review, at most 3 submissions per author per UTC day (database-enforced), admin approval before publication.
- Ranking is TypeScript, not SQL. The database returns candidates with counters; `lib/boks/recommendations` orders them. The Worker's `/api/feed` is the canonical ranking path and writes the served feed; the browser ranks only as a labelled fallback (`docs/adr/0001-ranking-executes-in-worker.md`). Adding an algorithm stays a one-file change.
- Supabase is the only data store. Browser storage holds only the visitor id, the Supabase session and lightweight local profile state.

## Hard limits

- Never put a Supabase service-role key, or any secret, in source, frontend code, Wrangler vars, docs, screenshots or console output.
- Never load the whole catalogue into a reader or admin session: bounded batches, server-side search, sorting and pagination.
- Never edit an applied migration. Production has every file in `supabase/migrations/`; change the schema with a new forward migration.
- Never roll the Worker back on its own: the production schema has moved on, and older client code breaks against it. Redeploy from current source.

## Change routing

| Change | Start in | Also |
|---|---|---|
| Reader experience | `components/boks/reader-feed.tsx` | `reader-behavior.ts`, `reader-events.ts`, `app/globals.css` |
| Reading formats (cinema, immersive poem), series shelf | `docs/reading-formats.md` | `components/boks/cinema/`, `poetry/`, `series/` |
| Generating any audio | `docs/media-generation.md` | - |
| Accounts, handles, comments | `components/boks/user-auth-panel.tsx`, `comments-sheet.tsx` | `components/boks/supabase-browser-data.ts`, migrations |
| Author cabinet and limits | `components/boks/author-console.tsx` | `lib/boks/author/submission-quota.ts`, `lib/boks/contracts.ts` |
| Admin console | `components/boks/admin-dashboard.tsx`, `components/boks/admin/` | `docs/admin-metrics.md` before adding a metric |
| Add an algorithm | one file in `lib/boks/recommendations/strategies/` + its `index.ts` | a ranking case in `lib/boks/recommendations/feed.test.ts` |
| Metrics or attribution | `lib/recsys/aggregate/metrics.ts`, `lib/boks/contracts.ts` | `specs/boks-recommendation-experiments.md` |
| Feed serving | `app/api/feed/route.ts`, `lib/boks/feed-service.ts` | `components/boks/worker-feed-breaker.ts` |
| Database | a new file in `supabase/migrations/` | `scripts/local-supabase/checks.sql`, `docs/security.md` |
| Catalogue, rights | `docs/catalogue-import.md`, `docs/copyright.md` | `lib/boks/import/` |
| Hosting, deploy | `docs/hosting.md` | `wrangler.jsonc` |
| Product behaviour | `specs/boks-product-spec.md` first | - |

A database change that adds a table or view the Data API must reach grants it in the same migration (`docs/adr/0011-explicit-data-api-grants.md`). Prefer a `security definer` function with its own checks over a table grant, and never grant a write on a view.

## Validation

```bash
npm run check             # lint + typecheck + offline unit tests (incl. doc-reference check)
npm run verify:schema     # every migration + RLS checks on a throwaway Postgres (Docker)
npm run build
npm run check:deploy-target
```

CI (`.github/workflows/ci.yml`) runs all four on every push and pull request. Renaming or moving a file, or an npm script, fails `npm test` until the standing docs that name it are updated.

With a running stack, also `npm run verify:divergence` and `npm run verify:supabase` (RLS probes against the project in `.env.local`). The full product flow runs against a local stack only: `npx supabase start && npm run test:supabase`. What each layer proves: `docs/testing.md`. Before migrating production: `npx supabase db push --linked --dry-run`. Deploy and post-deploy checks: `docs/hosting.md`.

## Agent skills

### Issue tracker

GitHub Issues on `IvanCherep/boks` (the `github` remote; pass `-R IvanCherep/boks`). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

## Record what you change

- A product rule changes: update `specs/boks-product-spec.md` with the code.
- Something ships: update `docs/project-state.md`; leave a session log in `docs/handover/` if work is left in flight.
- A hard-to-reverse, surprising trade-off: a short ADR in `docs/adr/`.
- A new domain term: `CONTEXT.md`.
