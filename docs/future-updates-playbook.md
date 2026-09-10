# boks Future Updates Playbook

Use this guide before changing the app. It keeps updates small, testable, and easy for AI coding assistants to continue.

## Product Rules

- Keep `/` as one algorithmic reading feed. Do not add catalogs, shelves, manual story picking, or reader-facing algorithm controls.
- Keep reading focused. The story should own the screen after the reader starts reading; actions can appear on tap, hover, pause, or story change.
- Do not add a finished button. Infer completion, skip, and drop-off from time, scroll progress, and swipe timing.
- Keep visible reader copy minimal. Explain decisions in docs, not inside the reader surface.
- Do not expose Supabase service role keys anywhere in source, browser code, Wrangler vars, screenshots, or docs.

## Start Every Update

1. Read `AGENTS.md`.
2. Read `docs/README.md`.
3. Read `docs/architecture.md`.
4. Read the relevant spec in `specs/`.
5. Check current changes with `git status --short`.
6. Decide which surface is changing: reader, author, admin, recommendations, data, deployment, or docs.

## Change Routing

Reader experience:

- Start with `components/boks/reader-feed.tsx`.
- Use `components/boks/reader-behavior.ts` for local identity, profile, completion, and skip inference.
- Use `app/globals.css` for reading layout, focus mode, and responsive behavior.
- Use `components/boks/supabase-browser-data.ts` only for browser-safe Supabase reads/writes.

Author cabinet:

- Start with `components/boks/author-console.tsx`.
- Keep the 15 minute guardrail.
- The current author path still uses the D1 compatibility API. Migrate it deliberately when ready; do not mix partial Supabase writes into the existing D1 publish flow without updating docs and specs.

Admin and metrics:

- Start with `components/boks/admin-dashboard.tsx`.
- Supabase aggregate data comes from `get_boks_admin_snapshot` in `supabase/migrations/`.
- D1 compatibility metrics live in `lib/boks/analytics.ts`.
- Admin must use pagination, search, and server-side sorting. Never load the whole catalog into the browser.

Recommendation experiments:

- Update `lib/boks/contracts.ts`, `lib/boks/recommendations.ts`, and `specs/boks-recommendation-experiments.md` together.
- Keep algorithm assignment invisible to readers.
- Compare algorithms using attributed behavior, not only likes.
- Before serious Supabase A/B testing, add Supabase event/assignment tables that include algorithm id, user segment, surface, rank, elapsed time, and metadata.

Supabase data:

- Add new schema changes as a new SQL migration in `supabase/migrations/`.
- Every exposed table needs RLS before it can be used by the browser.
- Use typed/indexed columns for high-volume metrics that are queried often.
- Keep low-volume exploratory data in metadata fields only when it does not drive hot queries.
- Run `npm run verify:supabase` after every Supabase change.

Deployment:

- `wrangler.jsonc` is the Cloudflare Workers + Static Assets production config.
- `.env.local` is required for local build/deploy and must stay ignored.
- `.env.example` documents required public env vars.
- Use `npm run deploy` for Cloudflare production deployment.
- Use `docs/hosting.md` for current URL, Cloudflare dashboard checks, DNS notes, and rollback.

## Validation Checklist

Run these before publishing:

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

Before finishing, also check:

```bash
git diff --check
git status --short
```

For production deploys:

```bash
npm run deploy
curl -I https://read.tryboks.workers.dev/
curl -I https://read.tryboks.workers.dev/admin
```

Then open `/` and `/admin` in a fresh browser tab and confirm there are no console errors.

## Common Update Recipes

Add stories for demos:

- For Supabase production, insert rows into `public.reels` with `status = 'published'`.
- Keep `minutes` between 1 and 15.
- For source-controlled demo content in the D1 path, update `lib/boks/seed-stories.ts`.

Add a reader metric:

- Define what decision the metric supports.
- Add capture logic in `components/boks/reader-feed.tsx` or `components/boks/reader-behavior.ts`.
- Store hot metrics as typed/indexed fields.
- Add admin display only if the metric changes a decision.
- Update `docs/boks-operations.md` if operators need to interpret it.

Add an admin table or chart:

- Put data shaping on the server/RPC side.
- Keep browser payloads bounded.
- Add search, sort, or pagination before the table can grow large.
- Keep export JSON aligned with what the admin sees.

Change the visual system:

- Start in `app/globals.css`.
- Keep the Claude-inspired light reading palette readable.
- Test narrow mobile and desktop.
- Do not add decorative UI that competes with reading.

## Documentation Rules

When behavior changes, update at least one of:

- `specs/boks-product-spec.md` for product scope or user behavior.
- `specs/boks-recommendation-experiments.md` for algorithm and metric rules.
- `docs/architecture.md` for module/data flow changes.
- `docs/boks-operations.md` for how to run tests with users.
- `docs/growth-readiness.md` for scale assumptions and limits.

Keep docs factual and current. Future AI assistants should be able to understand the system by reading `AGENTS.md`, `README.md`, this playbook, and the relevant spec.
