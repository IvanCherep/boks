# boks Product Spec

## Purpose

boks tests whether readers want a dedicated literature feed for complete short stories or book fragments that fit inside a 15 minute break. The prototype must support three jobs:

- readers discover, read, react, comment, share, and optionally keep a personal reading profile;
- authors submit a bok and track its review status;
- the founder reviews behavioral metrics from real test sessions, controls admin access, and moderates submitted boks.

## Current Prototype Scope

- Mobile-first responsive web app for MacBook, iPhone, and Android browsers.
- Dedicated routes: `/` for the swipe-first reader, `/author` for publishing, `/admin` for business analysis.
- Reader focus mode: the full interface appears briefly on a new story, then fades during reading so the story owns the screen. Tapping/clicking the reading surface reveals reactions and comments. There is no manual finished button; completion is inferred from time and scroll progress when the reader leaves a story.
- In product language, a `boks` is one short literature unit, similar to one reel in Instagram. In Supabase storage, the current table is still named `reels`.
- Supabase production MVP for anonymous reader entry, email sign-up/sign-in, permanent reader profiles with unique `@nickname`, public reels, views, signed-in likes, profile-owned comments, and admin aggregate metrics.
- Every permanent user can submit boks from `/author`. New submissions are private with `pending_review` status until an admin approves them. Rejected boks stay visible to the author with a refusal reason and can be revised into a new submission.
- Guest readers start immediately with no visible sign-up wall. After 5 viewed boks they see a gentle notice, after 10 they see a second notice, and after 15 they must sign up or sign in to continue.
- Guest readers can open and read comments by unique `@nickname`, with display name as secondary context, but liking and writing comments require a free account. The sign-up copy should explain that accounts improve recommendations and keep comments tied to the reader's profile.
- Sign-up and sign-in must use browser-standard form semantics: named fields, email autocomplete, current/new password autocomplete, confirm-password checks, submit buttons, clear status text, and a forgot-password path.
- New accounts must accept the current Terms before creation. The profile stores the accepted terms version and timestamp. The Terms include the author content license needed for boks to host, recommend, distribute, promote, demo, and advertise submitted works while authors retain ownership.
- Signed-in readers can open the boks wordmark to manage identity settings, search recent read boks, reopen a read boks inside the feed, and change their password.
- Reader accounts must not expose genre, mood, category, or algorithm preference controls. The feed learns from behavior instead of asking the reader to configure what they want.
- Admin access is a database-backed role on `user_profiles`. Admins can grant or remove admin status only from `/admin`; the only exception is first-admin bootstrap when no admin exists yet.
- Admins review recently submitted boks in `/admin`, approve suitable boks into the reader feed, or refuse them with a clear reason shown in the author cabinet.
- D1 compatibility backend for the original prototype API, local/demo fallback, and richer analytics event contract reference. Production author moderation and comments are Supabase-backed.
- Seed stories for immediate demos plus admin-approved user-created boks.
- Server-side recommendation ranking with deterministic anonymous experiment assignment in the D1 prototype path; `supabase_recent` is the current Supabase smoke-test feed until attributed Supabase events are added.
- Algorithm comparison metrics for start rate, finish rate, reaction rate, skip rate, read time, like timing, comment timing, feed rank, pace, and engagement score.
- JSON metric export for analysis or investor updates.
- Browser code uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; service role keys are never used in frontend code.

## Validation Questions

- Do readers start stories when the promise is under 15 minutes?
- Do they complete after starting?
- Do they react or comment after completion?
- Which story attributes correlate with starts, completions, rereads, and reactions?
- Do authors understand the 15 minute constraint and submit suitable pieces?
- Do authors understand review status, rejection reasons, and how to revise a refused bok?
- Does hiding manual choice improve story starts compared with chooser-based browsing?

## MVP Extension Points

- Authentication: keep Supabase permanent users as the identity source, improve account recovery if needed, and add magic-link/passkey options only if email-password creates friction.
- Authorization: keep admin role mutation behind Supabase RPC checks; never trust browser metadata or local storage for admin decisions.
- Recommendation: extend the algorithm registry, add precomputed rollups, then introduce reader history and story embeddings.
- Content safety: add moderation before public publishing.
- Growth loops: add public story detail pages and richer share previews.
- Monetization: add author subscriptions, paid collections, or sponsor-supported free reading.
- Operations: add pagination, moderation queues, cohort exports, and author-level reporting once inventory reaches thousands of texts.
- Supabase analytics: add attributed event and assignment tables before using Supabase for serious recommendation A/B testing.
