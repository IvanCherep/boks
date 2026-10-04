# boks

boks is a browser prototype for testing a short literature feed: readers discover stories that fit inside 15 minutes, authors publish from a simple cabinet, and the founder reviews engagement metrics.

## Two sections: feed and series

The reader has two tabs at the bottom of the screen.

- **feed** (`/`) - the product. One algorithmic, swipe-first stream of short
  literature, ranked per reader. Every boks lives here, including every series
  piece.
- **series** (`/series`) - **boks series**, the shelf of pieces produced in the
  new formats: read aloud by a real voice, over illustrations made for that
  piece, with the words arriving inside the picture in verse and, in some
  stories, moments where the story stops and asks the reader to do something.
  Only part of the catalogue will ever be produced this way, so these get a
  place where they can be found rather than waited for.

**Every series piece is also in the feed.** Nothing is moved out of it. In the
feed a series piece reads like any other boks, and carries a small
"boks series · listen to the production" mark above its title (and the
clapperboard button in the reader's controls) that opens the same production
the shelf opens. Both are available to **every reader**, signed in or not.

The shelf shows only pieces in the reader's chosen reading languages, newest
first, with what they have already heard moved behind what they have not; the
newest piece is marked *Premiere* for two weeks. Today it holds 20 pieces -
10 in English and 10 in Russian, 19 poems and one illustrated story with
interactive moments (Tolstoy's «Лев и собачка»).

The interface is English everywhere; titles, authors and the texts themselves
keep their own language.

How a piece is produced and added - recording, theme, pictures, the manifest,
the shelf entry - is `docs/reading-formats.md`.

## What is included

- Swipe-first reader feed ranked by a pluggable recommendation strategy, with attributed behavior events for every reader including guests.
- Two reading formats alongside that feed, opened from the same button and chosen by the piece rather than the reader: a cinema format for prose, and an immersive format for verse. Neither changes how an ordinary boks is read.
- The **series** tab (`/series`): every piece finished in one of those formats, on one shelf, filtered by the reader's languages. The same pieces stay in the feed with a button to open the production, for every reader.
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
- `components/boks/cinema/`: the cinema format - prose read aloud over scenes that change with the story, with places where it stops and asks the reader to do something.
- `components/boks/poetry/`: the immersive poetry format - verse, where each word arrives inside the picture at the moment it is spoken.
- `components/boks/series/`: the series tab - the shelf list (tested against both format registries), the shelf and the feed/series tabs, and the per-device heard marks.
- `app/series/page.tsx`: `/series`, the same reader opened on the shelf.
- `docs/reading-formats.md`: both formats and the series shelf - how a piece is routed to a format, and how to add one.
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
