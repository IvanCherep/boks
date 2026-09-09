# boks Operations Guide

## Running a Test

1. Open the prototype and ask each tester to read at least three stories.
2. Ask them to set a mood and time limit before reading.
3. Ask them to press Start reading, finish honestly, and leave one short comment.
4. After five to ten testers, open Metrics and export `boks-metrics.json`.

## What to Watch

- Start rate: starts divided by impressions. Target at this stage: 40% or higher.
- Finish rate: completions divided by starts. Target: 55% or higher.
- Reaction rate: likes, shares, and comments divided by completions. Target: 20% or higher.
- Story signal: completions plus likes plus shares plus double-weighted comments.

## Author Testing

Use the Author tab during interviews. Ask an author to paste or write a short piece. The cabinet estimates reading time and blocks pieces over the 15 minute promise. Published stories appear in the reader feed immediately.

## Data Model

- `stories`: published seed and author stories.
- `events`: impressions, starts, completions, likes, shares, preferences, and publishes.
- `comments`: one-sentence qualitative feedback tied to a story.

## Maintenance

- Add schema changes through `db/schema.ts`, then generate a new Drizzle migration.
- Keep seed stories in `app/api/boks/route.ts` until there is a real editorial tool.
- Use browser storage only for anonymous visitor/session ids. Product data stays in D1.
- Export metrics before resetting or changing the production database.
