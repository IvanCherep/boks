# boks

boks is a browser prototype for testing a short literature feed: readers discover stories that fit inside 15 minutes, authors publish from a simple cabinet, and the founder reviews engagement metrics.

## What is included

- Swipe-first reader feed ranked by a pluggable recommendation strategy, with attributed behavior events for every reader including guests.
- Anonymous Supabase reader entry with reels, views, signed-in likes, profile-owned comments, and unique `@nickname` handles stored behind RLS/RPCs.
- D1 compatibility path for the original prototype API and richer event contract reference.
- Supabase author cabinet with a 15 minute reading-time guardrail, a database-enforced limit of 3 boks per author per day, and an admin moderation workflow.
- `/admin` business console with funnel, genre/mood breakdowns, sortable content operations, JSON export, and a recommendation lab that compares algorithms with uplift against control and a live traffic split editor.
- Supabase-backed production reader/admin test path, with D1 retained for the original author/API prototype path.

## Main files

- `AGENTS.md`: product philosophy, architecture routing, growth guardrails, and validation checklist for AI coding assistants.
- `docs/README.md`: documentation index and recommended read order.
- `docs/ai-agent-guide.md`: fast project onboarding, ownership map, spec-driven workflow, and validation rules for any AI agent.
- `app/boks-client.tsx`: route compatibility exports for reader, author, and admin.
- `components/boks/reader-feed.tsx`: reader experience.
- `components/boks/author-console.tsx`: author cabinet.
- `components/boks/admin-dashboard.tsx`: admin/business console.
- `components/boks/`: browser-facing product helpers, Supabase data access, types, behavior inference, and shared UI primitives.
- `app/api/boks/route.ts`: API orchestration for reader, author, admin, events, and exports.
- `lib/boks/recommendations/`: story signals, the strategy contract, one file per algorithm, the registry, experiment assignment, feed ranking, and metric derivation.
- `lib/boks/`: analytics SQL, request helpers, Supabase client, contracts, author quota, and seed stories.
- `supabase/`: production MVP Auth config, RLS schema, seed reels, and admin aggregate RPC.
- `db/schema.ts`: D1 compatibility schema.
- `docs/architecture.md`: system map and data flows.
- `docs/architecture-review.md`: architecture assessment, current risks, and next extraction points.
- `docs/engineering-standards.md`: product values, naming, boundaries, and AI-agent workflow.
- `docs/hosting.md`: Cloudflare hosting, deployment, URL, and production verification guide.
- `docs/testing.md`: reader, author, admin, product QA, and technical validation guide.
- `docs/boks-operations.md`: testing and operating guide.
- `docs/future-updates-playbook.md`: practical guide for future app updates.
- `docs/growth-readiness.md`: scale posture and next growth work.
- `specs/boks-product-spec.md`: product scope and extension points.
- `specs/boks-recommendation-experiments.md`: the recommendation architecture, signals, metrics, and how to add an algorithm.
- `docs/handover/`: per-session work records for agents picking up in-flight work.

## Supabase MVP

Create `.env.local` from `.env.example`, then set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Run `npm run verify:supabase` to confirm anonymous auth, reel reads, view writes, anonymous write blocks, comment reads, admin blocks, author/moderation/recommendation RPCs, and profile safety. Do not put a Supabase service role key in the frontend, repository, or Wrangler vars.

## Local verification

Nothing below deploys.

```bash
npm run lint && npm run typecheck && npm test   # offline
npm run verify:schema                           # migrations + RLS on a throwaway Postgres container (Docker)
npx supabase start && npm run test:supabase     # full product flow against a local Supabase stack
npm run build && npm run start                  # the app at http://127.0.0.1:8787
```

See `docs/testing.md` for what each layer covers.
