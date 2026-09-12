# boks Operations Guide

Use `docs/testing.md` for structured reader, author, admin, and technical test scripts. Use `docs/hosting.md` for Cloudflare deployment and production URL checks.

## Running a Test

1. Open `/` and ask each tester to read at least three stories.
2. Ask them to swipe when they want the next story.
3. Ask for one short comment after a story that strongly works or fails.
4. After five to ten testers, open `/admin` and export `boks-metrics.json`.

During interviews, watch whether readers discover that a tap brings the reaction buttons back. The default reading state intentionally hides most interface elements after the story starts. Completion is inferred when the reader leaves a story after meaningful time or scroll progress.

Guest readers can read immediately. The product shows a gentle notice after 5 viewed boks, repeats after 10, and requires sign-up or sign-in after 15. The boks wordmark opens the optional account panel for settings and recently read boks.

## What to Watch

- Start rate: starts divided by impressions. Target at this stage: 40% or higher.
- Finish rate: completions divided by starts. Target: 55% or higher.
- Reaction rate: likes, shares, and comments divided by completions. Target: 20% or higher.
- Story signal: completions, likes, shares, and comments, minus skip/drop-off pressure.
- Recommendation lab: compare algorithms by start rate, finish rate, reaction rate, skip rate, read time, like time, pace index, and engagement score.

## Author Testing

Use `/author` during interviews. Ask an author to paste or write a short piece. The cabinet estimates reading time and blocks pieces over the 15 minute promise. Published stories enter the algorithmic feed immediately; readers cannot manually select them.

## Data Model

- Supabase production MVP:
  - `reels`: published story inventory for the public reader.
  - `views`: reader impressions/views for anonymous and permanent Supabase users.
  - `likes`: one like per permanent user and reel.
  - `comments`: profile-owned responses visible to all readers on published boks.
  - `user_profiles`: permanent reader settings and the `reader` or `admin` role.
- D1 compatibility path:
  - `stories`: published seed and author stories.
  - `events`: impressions, starts, completions, likes, shares, preferences, and publishes.
  - `comments`: one-sentence qualitative feedback tied to a story.

## Scale Notes

The prototype is designed for a first test with about 40,000 short text stories and 100-400 readers. Reader requests load only a small recommendation batch. Admin requests use server-side pagination, sorting, and search rather than loading the whole catalog into the browser.

For this stage, use `/admin` to review global funnel metrics, genre and mood rollups, recent events, and one page of content operations at a time. Export metrics before each content-mix change so the test remains explainable.

The reader feed assigns recommendation algorithms automatically. Do not tell testers which algorithm they are seeing. Use the Recommendation lab in `/admin` after attributed events accumulate, then export the JSON before changing algorithm weights.

Before moving beyond the first cohort, add bulk import, full-text search, precomputed metric rollups, moderation, password reset, and scheduled exports.

## Admin Access

Open `/admin` and sign in with a permanent account. If no admin exists yet, the first permanent account can claim admin inside `/admin`. After that, admin access is granted or removed only from the User management panel.

Rules:

- Anonymous users cannot become admins.
- Regular readers cannot see metrics.
- Admins cannot remove their own only admin access.
- Do not edit `user_profiles.role` manually except for emergency recovery.

## Prototype URLs

- `https://read.tryboks.workers.dev/`: swipe-first reader experience.
- `https://read.tryboks.workers.dev/author`: author submission cabinet.
- `https://read.tryboks.workers.dev/admin`: founder/business console for moderation, content operations, and experiment analysis.

## Maintenance

- Add Supabase production schema changes through `supabase/migrations/`, then run `npm run verify:supabase`.
- Add D1 compatibility schema changes through `db/schema.ts`, then generate a new Drizzle migration.
- Keep seed stories in `lib/boks/seed-stories.ts` until there is a real editorial tool or bulk import pipeline.
- Add or tune recommendation algorithms in `lib/boks/recommendations.ts`.
- Keep metric definitions in `lib/boks/analytics.ts` so admin UI and exports stay aligned.
- Use browser storage only for anonymous visitor/session ids, Supabase session persistence, and lightweight profile state. Production reader metrics stay in Supabase.
- Export metrics before resetting or changing the production database.
- Run `npm run verify:supabase` after Supabase config or migration changes.
- After auth config changes, check Supabase dashboard settings for production redirect URL and manual anonymous-user linking. Avoid `supabase config push` when it would overwrite unrelated remote settings.
- For future AI-assisted changes, start with `AGENTS.md`, `docs/architecture.md`, and the relevant spec in `specs/`.
