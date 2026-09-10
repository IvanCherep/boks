# boks Operations Guide

## Running a Test

1. Open `/` and ask each tester to read at least three stories.
2. Ask them to swipe when they want the next story.
3. Ask for one short comment after a story that strongly works or fails.
4. After five to ten testers, open `/admin` and export `boks-metrics.json`.

During interviews, watch whether readers discover that a tap brings the reaction buttons back. The default reading state intentionally hides most interface elements after the story starts. Completion is inferred when the reader leaves a story after meaningful time or scroll progress.

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
  - `views`: anonymous reader impressions/views.
  - `likes`: one like per anonymous user and reel.
- D1 compatibility path:
  - `stories`: published seed and author stories.
  - `events`: impressions, starts, completions, likes, shares, preferences, and publishes.
  - `comments`: one-sentence qualitative feedback tied to a story.

## Scale Notes

The prototype is designed for a first test with about 40,000 short text stories and 100-400 readers. Reader requests load only a small recommendation batch. Admin requests use server-side pagination, sorting, and search rather than loading the whole catalog into the browser.

For this stage, use `/admin` to review global funnel metrics, genre and mood rollups, recent events, and one page of content operations at a time. Export metrics before each content-mix change so the test remains explainable.

The reader feed assigns recommendation algorithms automatically. Do not tell testers which algorithm they are seeing. Use the Recommendation lab in `/admin` after attributed events accumulate, then export the JSON before changing algorithm weights.

Before moving beyond the first cohort, add bulk import, full-text search, precomputed metric rollups, role-based admin access, moderation, and scheduled exports.

## Prototype URLs

- `/`: swipe-first reader experience.
- `/author`: author publishing cabinet.
- `/admin`: founder/business console for content operations and experiment analysis.

## Maintenance

- Add schema changes through `db/schema.ts`, then generate a new Drizzle migration.
- Keep seed stories in `lib/boks/seed-stories.ts` until there is a real editorial tool or bulk import pipeline.
- Add or tune recommendation algorithms in `lib/boks/recommendations.ts`.
- Keep metric definitions in `lib/boks/analytics.ts` so admin UI and exports stay aligned.
- Use browser storage only for anonymous visitor/session ids, Supabase session persistence, and lightweight profile state. Production reader metrics stay in Supabase.
- Export metrics before resetting or changing the production database.
- Run `npm run verify:supabase` after Supabase config or migration changes.
- For future AI-assisted changes, start with `AGENTS.md`, `docs/architecture.md`, and the relevant spec in `specs/`.
