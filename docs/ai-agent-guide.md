# boks AI Agent Guide

This guide is for any AI coding assistant working on boks: Codex, Claude, Cursor, Copilot-style agents, or a human engineer using an agent. It explains how to understand the project quickly, choose the right files, make spec-driven changes, verify them, and deploy safely.

## Five Minute Context

boks is a browser MVP for testing a literature-only feed. A reader opens the app, receives one short bok, reads with minimal interface, reacts only if needed, then swipes onward. The reader does not browse a catalog, choose genres, pick moods, or select recommendation algorithms.

Product terms:

- `boks`: one short literature unit in product language.
- `story`: browser-facing content object in TypeScript.
- `reel`: current Supabase table name for boks content.
- `reader`: person reading.
- `author`: person submitting boks.
- `admin`: founder/operator role managed in Supabase `user_profiles.role`.
- `@nickname`: unique permanent user handle shown on comments.

Current production:

- URL: `https://tryboks.com`
- Hosting: Cloudflare Workers with Static Assets.
- Production data/auth: Supabase with RLS and RPCs.
- Compatibility path: D1 API remains for older prototype events, local/demo fallback, and richer event-shape reference.

## Required Read Order

For any non-trivial change, read:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/ai-agent-guide.md`
4. Relevant spec:
   - product behavior: `specs/boks-product-spec.md`
   - recommendation behavior: `specs/boks-recommendation-experiments.md`
5. Relevant focused guide:
   - architecture: `docs/architecture.md`
   - standards: `docs/engineering-standards.md`
   - testing: `docs/testing.md`
   - deploy: `docs/hosting.md`
   - local agent infrastructure and service access: `docs/local-agent-infrastructure.md`
   - future changes: `docs/future-updates-playbook.md`

Always run:

```bash
git status --short
```

before editing. The worktree may contain user changes. Do not revert unrelated changes.

## Product Invariants

Never break these unless the user explicitly changes the product strategy and the spec is updated.

- `/` is one swipe-first algorithmic feed.
- No visible story picker, shelves, genre picker, mood picker, or manual algorithm picker for readers.
- Reading focus matters more than interface visibility.
- No explicit finished button. Completion is inferred from time, scroll, and swipe behavior.
- Guest readers start without a visible sign-up wall.
- Guest readers get notices after 5 and 10 viewed boks and must sign up or sign in after 15.
- User-facing authentication is passwordless. Use Supabase email magic links only; do not add password, reset-password, or change-password UI.
- Guests can read comments and one-level reply threads. Guests cannot write, reply, or like comments.
- Comments and comment likes are written only by permanent users; comments display the profile's unique `@nickname`.
- Every permanent user can submit boks for admin review.
- Admin approval is required before user-submitted boks are published.
- Admin access is a database role enforced by RLS/RPC, not browser state.
- Service role keys never enter frontend source, docs, screenshots, Wrangler vars, or browser logs.

## Architecture Ownership Map

Use this map before opening files.

| Change area | Start here | Also check |
| --- | --- | --- |
| Reader feed, swipe, focus mode | `components/boks/reader-feed.tsx` | `components/boks/reader-behavior.ts`, `app/globals.css`, `docs/testing.md` |
| Like/comment/share UX | `components/boks/comments-sheet.tsx`, `components/boks/reader-feed.tsx` | `components/boks/comment-threads.ts`, `components/boks/supabase-browser-data.ts`, Supabase migrations |
| User sign-up/sign-in/profile | `components/boks/user-auth-panel.tsx` | `lib/boks/supabase-client.ts`, `components/boks/supabase-browser-data.ts`, Supabase migrations |
| Unique `@nickname` and comments | `components/boks/user-auth-panel.tsx` | `components/boks/comments-sheet.tsx`, `supabase/migrations/`, `scripts/local-supabase/checks.sql` |
| Author submission/review status | `components/boks/author-console.tsx` | `components/boks/supabase-browser-data.ts`, review RPC migrations |
| Admin metrics/moderation/users | `components/boks/admin-dashboard.tsx` | `components/boks/supabase-browser-data.ts`, `get_boks_admin_snapshot` migrations |
| Add a recommendation algorithm | `lib/boks/recommendations/strategies/<name>.ts` + that folder's `index.ts` | `lib/boks/recommendations/feed.test.ts` |
| Recommendation contract or metrics | `lib/boks/contracts.ts`, `lib/boks/recommendations/metrics.ts` | Supabase event/lab migration, `specs/boks-recommendation-experiments.md`, `components/boks/admin/recommendation-lab.tsx` |
| Author submission limits | `lib/boks/author/submission-quota.ts`, Supabase `submit_bok_for_review` / `get_my_bok_quota` | `components/boks/author-console.tsx`, `lib/boks/contracts.ts` |
| D1 compatibility API | `app/api/boks/route.ts` | `lib/boks/analytics.ts`, `lib/boks/request.ts`, `db/schema.ts` |
| Supabase data/RLS/RPC | `supabase/migrations/` | `scripts/verify-supabase-mvp.mjs`, Supabase skills/docs |
| Visual system | `app/globals.css` | reader screenshots/mobile QA |
| Hosting/deploy | `wrangler.jsonc`, `docs/hosting.md` | `.env.example`, `.openai/hosting.json` |
| Product behavior/docs | `specs/` | `docs/architecture.md`, `docs/testing.md`, `docs/boks-operations.md` |

## Spec Driven Development Workflow

### 1. Frame the change

Answer before editing:

- Which product rule changes?
- Which user role is affected: guest reader, signed-in reader, author, admin?
- Which data boundary changes: local browser state, Supabase, D1 compatibility, Cloudflare config?
- Which metrics or validation should prove this works?

If product behavior changes, update `specs/boks-product-spec.md` before or with implementation.

Adding an algorithm does not change the recommendation contract, so it does not need a spec edit - only a new strategy file, a registry entry and a ranking test. Update `specs/boks-recommendation-experiments.md` when the contract, the signals or a metric definition changes.

To pick up work another agent left in flight, read the newest file in `docs/handover/` first.

### 2. Pick the smallest owner

Do not start by refactoring. Change the smallest product surface that owns the behavior. Extract files only when a repeated editing pattern makes ownership unclear.

Good examples:

- A keyboard shortcut bug belongs in `reader-feed.tsx`.
- Unique handles belong in Supabase migration plus `user-auth-panel.tsx`.
- Admin comparison metrics belong in the admin RPC plus `admin-dashboard.tsx`.

### 3. Update the contract

For browser data shapes, update `components/boks/client-types.ts`.

For Supabase changes:

- Create a new migration with `npx supabase migration new <name>`.
- Enable or preserve RLS for exposed tables.
- Use indexed typed columns for high-volume queried data.
- Use RPCs for privileged or normalized writes.
- Update `scripts/verify-supabase-mvp.mjs`.

For D1 changes:

- Update `db/schema.ts`.
- Generate a Drizzle migration with `npm run db:generate`.
- Keep D1 compatibility bounded and documented.

### 4. Verify locally

Minimum validation before deploy:

```bash
npm run lint
npm run verify:supabase
node /Users/iegorov/.codex/plugins/cache/openai-bundled/sites/0.1.66/scripts/build-site.mjs
npm run start
```

With local server running, check:

- `/`
- `/author`
- `/admin`
- `/api/boks?view=reader&limit=20&visitorId=agent-check`
- `/api/boks?view=admin&limit=20`

For UI work, verify the exact interaction. Example: if changing comment keyboard behavior, type spaces in the comment textarea and verify the feed does not advance.

### 5. Deploy only after validation

Production deploy:

```bash
npm run deploy
```

Then verify:

```bash
curl -I https://tryboks.com/
curl -I https://tryboks.com/admin
curl -I https://tryboks.com/author
curl 'https://tryboks.com/api/boks?view=reader&limit=3&visitorId=agent-live-check'
```

Record the Cloudflare Worker version in the final response.

## Supabase Rules

Supabase is the production MVP backend for:

- anonymous reader entry;
- email accounts;
- profiles and unique `@nickname`;
- views;
- signed-in likes;
- profile-owned comments, one-level replies, and private comment-like rows exposed only as aggregate counts;
- author submissions and moderation;
- admin users and aggregate snapshots.

Security rules:

- Browser code uses only publishable Supabase key.
- Anonymous Supabase users still have the Postgres `authenticated` role, so policies/RPCs must check `auth.jwt()->>'is_anonymous'` when permanent sign-in is required.
- Admin checks must use `user_profiles.role` through RLS/RPC.
- Do not use `user_metadata` for authorization.
- Revoke and grant function execution explicitly after creating security-definer functions.

After every Supabase change:

```bash
npm run verify:supabase
npx supabase migration list --linked
```

Use `npx supabase db push --linked --dry-run --yes` before applying migrations.

## Documentation Update Rules

Every behavior change should update at least one of:

- `specs/boks-product-spec.md`
- `specs/boks-recommendation-experiments.md`
- `docs/architecture.md`
- `docs/testing.md`
- `docs/boks-operations.md`
- `docs/future-updates-playbook.md`
- `docs/architecture-review.md`

Update `AGENTS.md` when routing, invariants, or validation commands change.

Add an ADR in `docs/decisions/` when the decision affects future rewrites, such as moving event storage, changing recommendation assignment, adding a real domain, or replacing D1 compatibility.

## Known Operational Notes

- `git push origin main` may fail in this environment if credentials for `git.chatgpt-team.site` are unavailable. If it fails, report it; do not invent a pushed SHA.
- `.env.local` is required for local Supabase verification and deploy. It must stay ignored.
- Sites metadata exists in `.openai/hosting.json`, but Cloudflare Worker deployment is the production path for `tryboks.com`.
- Local agents that need to deploy or manage connected services should read `docs/local-agent-infrastructure.md` before touching Cloudflare, Supabase, or Resend configuration.
- Old Worker names may exist as rollback references. Do not delete them without an explicit cleanup request.

## Definition Of Done For Agents

A task is complete only when:

- The requested behavior is implemented.
- Specs/docs reflect the behavior.
- Validation commands pass, or failures are explicitly explained.
- Supabase migrations are applied when needed.
- Production deploy is verified when the request affects the live app.
- The final response names changed behavior, validation, deployment status, and any blockers.
