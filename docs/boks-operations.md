# boks Operations Guide

Use `docs/testing.md` for structured reader, author, admin, and technical test scripts. Use `docs/hosting.md` for Cloudflare deployment and production URL checks.

## Running a Test

1. Open `/` and ask each tester to read at least three stories.
2. Ask them to swipe when they want the next story.
3. Ask for one short comment after a story that strongly works or fails.
4. After five to ten testers, open `/admin` and export `boks-metrics.json`.

During interviews, watch whether readers discover that a tap brings the reaction buttons back. The default reading state intentionally hides most interface elements after the story starts. Completion is inferred when the reader leaves a story after meaningful time or scroll progress.

Guest readers can read immediately. The product shows a gentle notice after 5 viewed boks, repeats after 10, and requires sign-up or sign-in after 15. The account button opens settings; permanent accounts also get searchable Read, Liked, and Comments views. Opening one of those boks returns to the recommendation sequence on the next navigation gesture.

## What to Watch

- Start rate: starts divided by impressions. Target at this stage: 40% or higher.
- Finish rate: completions divided by starts. Target: 55% or higher.
- Reaction rate: likes, shares, and comments divided by completions. Target: 20% or higher.
- Story signal: completions, likes, shares, and comments, minus skip/drop-off pressure.
- Recommendation lab: compare algorithms by start rate, finish rate, reaction rate, skip rate, read time, like time, pace index, and engagement score.

## Author Testing

Use `/author` during interviews. Ask an author to paste or write a short piece. The cabinet estimates reading time and blocks pieces over the 15 minute promise. Published stories enter the algorithmic feed immediately; readers cannot manually select them.

## Data Model

Supabase is the only store. The tables an operator meets:

- `reels`: every bok - published, pending review, refused or archived (the table keeps its legacy name).
- `recommendation_events`: every attributed reader event; the source of all behaviour metrics.
- `served_feed`, `served_feed_item`: what each slate contained and why.
- `recommendation_experiments`, `recommendation_assignments`: the live split and each reader's arm.
- `likes`, `comments`, `comment_likes`, `author_follows`: product features, not metrics.
- `user_profiles`: account settings, the unique `@handle`, and the `reader` or `admin` role.
- `boks_feedback`, `boks_journey_events`, `bok_rights`, `bok_reports`: feedback notes, guest journey, rights records, reader reports.

## Scale Notes

The prototype is designed for a first test with about 40,000 short text stories and 100-400 readers. Reader requests load only a small recommendation batch. Admin requests use server-side pagination, sorting, and search rather than loading the whole catalog into the browser.

For this stage, use `/admin` to review global funnel metrics, genre and mood rollups, recent events, and one page of content operations at a time. Export metrics before each content-mix change so the test remains explainable.

The reader feed assigns recommendation algorithms automatically. Do not tell testers which algorithm they are seeing. Use the Recommendation lab in `/admin` after attributed events accumulate, then export the JSON before changing algorithm weights.

Before moving beyond the first cohort, add bulk import, full-text search, precomputed metric rollups, stronger moderation operations, and scheduled exports.

## Admin Access

Open `/admin` and sign in with a permanent account. If no admin exists yet, the first permanent account can claim admin inside `/admin`. After that, admin access is granted or removed only from the User management panel.

Rules:

- Anonymous users cannot become admins.
- Regular readers cannot see metrics.
- Admins cannot remove their own only admin access.
- Do not edit `user_profiles.role` manually except for emergency recovery.

## Prototype URLs

- `https://tryboks.com/`: swipe-first reader experience.
- `https://tryboks.com/author`: author submission cabinet.
- `https://tryboks.com/admin`: founder/business console for moderation, content operations, and experiment analysis.

## Maintenance

- Add Supabase production schema changes through `supabase/migrations/`, then run `npm run verify:supabase`.
- Keep Supabase custom SMTP active before inviting external testers. Email sign-in depends on email delivery, and Supabase's default sender is too limited for a real pilot.
- Auth mail is sent through Resend from `hello@tryboks.com` (the verified `tryboks.com` domain; `supabase/config.toml`). Replies to it bounce until `hello@` gets an Email Routing rule or the sender moves to `support@tryboks.com` - see `docs/project-state.md`.
- Load catalogue content through the import pipeline (`docs/catalogue-import.md`), not by hand.
- Add a recommendation algorithm with one file in `lib/boks/recommendations/strategies/` plus a list entry in that folder's `index.ts`, then give it traffic in `/admin` -> Recommendation lab -> Traffic split.
- Change the live split between existing algorithms from `/admin` alone; that needs no deploy.
- Keep metric definitions in `lib/recsys/aggregate/metrics.ts` so the admin UI and exports stay aligned.
- Use browser storage only for anonymous visitor/session ids, Supabase session persistence, and lightweight profile state. Production reader metrics stay in Supabase.
- Export metrics before resetting or changing the production database.
- Run `npm run verify:supabase` after Supabase config or migration changes.
- After auth config changes, check the production redirect URL, Confirm email,
  leaked-password protection, and that manual linking remains off. Run
  `supabase config diff` first; config push leaves undeclared remote properties
  unchanged but can still overwrite declared rate limits.
- For AI-assisted changes, start with `AGENTS.md`.
