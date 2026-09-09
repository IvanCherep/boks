# boks Operations Guide

## Running a Test

1. Open `/` and ask each tester to read at least three stories.
2. Ask them to swipe when they want the next story.
3. Ask them to tap the check button only when they finish a story.
4. Ask for one short comment after a story that strongly works or fails.
5. After five to ten testers, open `/admin` and export `boks-metrics.json`.

## What to Watch

- Start rate: starts divided by impressions. Target at this stage: 40% or higher.
- Finish rate: completions divided by starts. Target: 55% or higher.
- Reaction rate: likes, shares, and comments divided by completions. Target: 20% or higher.
- Story signal: completions, likes, shares, and comments, minus skip/drop-off pressure.

## Author Testing

Use `/author` during interviews. Ask an author to paste or write a short piece. The cabinet estimates reading time and blocks pieces over the 15 minute promise. Published stories enter the algorithmic feed immediately; readers cannot manually select them.

## Data Model

- `stories`: published seed and author stories.
- `events`: impressions, starts, completions, likes, shares, preferences, and publishes.
- `comments`: one-sentence qualitative feedback tied to a story.

## Prototype URLs

- `/`: swipe-first reader experience.
- `/author`: author publishing cabinet.
- `/admin`: founder/business console for content operations and experiment analysis.

## Maintenance

- Add schema changes through `db/schema.ts`, then generate a new Drizzle migration.
- Keep seed stories in `app/api/boks/route.ts` until there is a real editorial tool.
- Use browser storage only for anonymous visitor/session ids. Product data stays in D1.
- Export metrics before resetting or changing the production database.
