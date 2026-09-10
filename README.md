# boks prototype

boks is a browser prototype for testing a short literature feed: readers discover stories that fit inside 15 minutes, authors publish from a simple cabinet, and the founder reviews engagement metrics.

## What is included

- Swipe-first reader feed with behavior-based recommendations.
- Anonymous Supabase reader entry with reels, views, and likes stored behind RLS.
- Like, share, completion, and comment capture in the original D1 API path.
- Author cabinet with a 15 minute reading-time guardrail.
- `/admin` business console with funnel, genre/mood breakdowns, sortable content operations, and JSON export.
- Supabase-backed production reader/admin test path, with D1 retained for the original author/API prototype path.

## Main files

- `AGENTS.md`: product philosophy, architecture routing, growth guardrails, and validation checklist for AI coding assistants.
- `app/boks-client.tsx`: route compatibility exports for reader, author, and admin.
- `components/boks/reader-feed.tsx`: reader experience.
- `components/boks/author-console.tsx`: author cabinet.
- `components/boks/admin-dashboard.tsx`: admin/business console.
- `components/boks/`: browser-facing product helpers, Supabase data access, types, behavior inference, and shared UI primitives.
- `app/api/boks/route.ts`: API orchestration for reader, author, admin, events, and exports.
- `lib/boks/`: recommendation algorithms, analytics SQL, request helpers, Supabase client, contracts, and seed stories.
- `supabase/`: production MVP Auth config, RLS schema, seed reels, and admin aggregate RPC.
- `db/schema.ts`: D1 compatibility schema.
- `docs/architecture.md`: system map and data flows.
- `docs/boks-operations.md`: testing and operating guide.
- `docs/future-updates-playbook.md`: practical guide for future app updates.
- `docs/growth-readiness.md`: scale posture and next growth work.
- `specs/boks-product-spec.md`: product scope and extension points.

## Supabase MVP

Create `.env.local` from `.env.example`, then set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Run `npm run verify:supabase` to confirm anonymous auth, reel reads, view writes, like writes, RLS blocks, and admin metrics. Do not put a Supabase service role key in the frontend, repository, or Wrangler vars.
