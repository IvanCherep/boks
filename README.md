# boks

boks is a swipe-first feed of complete short literature - each **bok** fits inside 15 minutes - where readers read, authors publish from a simple cabinet, and the founder compares recommendation algorithms by measured reading behaviour. Live at https://tryboks.com.

## Two sections: feed and series

The reader has two tabs at the bottom of the screen.

- **feed** (`/`) - the product. One algorithmic, swipe-first stream of short
  literature, ranked per reader. Every bok lives here, including every series
  piece.
- **series** (`/series`) - **boks series**, the shelf of pieces produced in the
  new formats: read aloud by a real voice, over illustrations made for that
  piece, with the words arriving inside the picture in verse and, in some
  stories, moments where the story stops and asks the reader to do something.
  Only part of the catalogue will ever be produced this way, so these get a
  place where they can be found rather than waited for.

**Every series piece is also in the feed.** Nothing is moved out of it. In the
feed a series piece reads like any other bok, and carries a small
"boks series · listen to the production" mark above its title (and the
clapperboard button in the reader's controls) that opens the same production
the shelf opens. Both are available to **every reader**, signed in or not.

The shelf shows only pieces in the reader's chosen reading languages, newest
first, with what they have already heard moved behind what they have not; the
newest piece is marked *Premiere* for two weeks. Today it holds 21 pieces -
11 in English and 10 in Russian, 20 poems and one illustrated story with
interactive moments (Tolstoy's «Лев и собачка»).

The interface is English everywhere; titles, authors and the texts themselves
keep their own language.

How a piece is produced and added - recording, theme, pictures, the manifest,
the shelf entry - is `docs/reading-formats.md`.

## What is included

- Swipe-first reader feed ranked per reader by the Worker (`/api/feed`) with a pluggable recommendation algorithm, and attributed reader events for every reader including guests.
- Two reading formats alongside the feed, chosen by the piece rather than the reader: cinema for prose and immersive poems for verse. Neither changes how an ordinary bok is read.
- The **series** tab (`/series`): every series piece on one shelf, filtered by the reader's languages.
- Guest reading on anonymous Supabase sessions; accounts by passwordless email (a magic link or a 6-digit code); likes, comments with one-level replies and follows attributed to a unique `@handle`.
- An author cabinet with the 15-minute guardrail, a database-enforced limit of 3 submissions per author per UTC day, and admin moderation.
- `/admin`: overview, moderation, rights, content, people, guests, feedback, catalogue import, and a recommendation lab comparing algorithms against control with a live traffic-split editor.

Supabase (Postgres with RLS and RPCs) is the only data store.

## Where to start

- `docs/onboarding.md` - new here? Access, tools, env files and first checks, from a fresh laptop to deploying.
- `AGENTS.md` - rules and the read order for anyone, human or agent, changing the code. `CLAUDE.md` imports it.
- `CONTEXT.md` - the glossary: bok, handle, byline, arm, series piece and the rest.
- `docs/README.md` - which document owns which topic.
- `docs/architecture.md` - the module map and data flows.
- `docs/adr/` - the decisions behind the shape.

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
