# boks Operations Guide

## Running a Test

1. Open `/` and ask each tester to read at least three stories.
2. Ask them to swipe when they want the next story.
3. Ask them to tap the check button only when they finish a story.
4. Ask for one short comment after a story that strongly works or fails.
5. After five to ten testers, open `/admin` and export `boks-metrics.json`.

During interviews, watch whether readers discover that a tap brings the reaction buttons back. The default reading state intentionally hides most interface elements after the story starts.

## What to Watch

- Start rate: starts divided by impressions. Target at this stage: 40% or higher.
- Finish rate: completions divided by starts. Target: 55% or higher.
- Reaction rate: likes, shares, and comments divided by completions. Target: 20% or higher.
- Story signal: completions, likes, shares, and comments, minus skip/drop-off pressure.
- Recommendation lab: compare algorithms by start rate, finish rate, reaction rate, skip rate, read time, like time, pace index, and engagement score.

## Author Testing

Use `/author` during interviews. Ask an author to paste or write a short piece. The cabinet estimates reading time and blocks pieces over the 15 minute promise. Published stories enter the algorithmic feed immediately; readers cannot manually select them.

## Data Model

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
- Keep seed stories in `app/api/boks/route.ts` until there is a real editorial tool.
- Add or tune recommendation algorithms in `lib/boks/recommendations.ts`.
- Keep metric definitions in `lib/boks/analytics.ts` so admin UI and exports stay aligned.
- Use browser storage only for anonymous visitor/session ids. Product data stays in D1.
- Export metrics before resetting or changing the production database.
