# boks Testing Guide

## What We Are Testing

boks is testing a product question, not only a technical build:

Do people enjoy receiving one short literature piece at a time, reading it in a focused feed, and swiping onward without browsing a catalog?

The prototype must collect enough behavior to answer:

- Do readers start stories?
- Do readers stay long enough to finish?
- Do readers react when a story works?
- Which story types perform better?
- Which recommendation strategy performs better?
- Do authors understand and respect the 15 minute constraint?

## Reader Test Script

Use `https://read.tryboks.workers.dev/`.

Ask each tester:

1. Open the link on their normal phone or laptop.
2. Read naturally for 5-10 minutes.
3. Swipe when they want the next story.
4. Like, comment, or share only when they genuinely feel it.
5. Do not search for a specific story.
6. If they reach a sign-up notice, ask whether it feels gentle or disruptive.

Do not explain the algorithm before the session. The product promise is that the reader opens the app and starts reading.

After the session, ask:

- Did you understand what to do without explanation?
- Did any story feel worth finishing?
- Did the interface disappear enough for focused reading?
- Did you miss control, search, or choice?
- Did the sign-up request arrive too early, too late, or at the right moment?
- Would you open this during lunch, commute, or a break?

## Author Test Script

Use `https://read.tryboks.workers.dev/author`.

Ask an author:

1. Sign up or sign in as a normal reader account.
2. Paste or write one short bok.
3. Check whether the estimated reading time is clear.
4. Submit for review.
5. Notice whether the 15 minute limit blocks long text.
6. Check whether the submission appears in the author cabinet with a review status.

After admin review, ask the author to check:

1. Whether published status is understandable.
2. Whether a refused bok shows a clear reason.
3. Whether revision feels natural.

Watch for:

- Confusion around title, hook, genre, mood, or body.
- Confusion around waiting, published, or refused states.
- Whether the author understands that readers cannot manually pick the story.
- Whether the author expects drafts, editing, moderation, or analytics beyond this MVP.

## Admin Test Script

Use `https://read.tryboks.workers.dev/admin`.

Sign in with a permanent account that has `admin` role in Supabase. If this is the first admin, sign up as a reader first, open `/admin`, and use the first-admin claim. After one admin exists, new admins must be granted from the User management panel.

After each small testing batch:

1. Check funnel metrics.
2. Check genre and mood rollups.
3. Check recommendation comparison.
4. Review pending boks and approve or refuse them with reasons.
5. Search and sort the story operations table.
6. Check User management for new permanent users, reads, likes, and roles.
7. Export `boks-metrics.json`.
8. Save the export with a date and cohort label outside the repo.

Recommended export labels:

- `boks-metrics-YYYY-MM-DD-friends-test.json`
- `boks-metrics-YYYY-MM-DD-conference-day-1.json`
- `boks-metrics-YYYY-MM-DD-author-test.json`

## Product Acceptance Checks

Reader:

- `/` opens directly into the reading feed.
- There is no visible story picker, shelf, category browser, or manual algorithm picker.
- Swipe works on phone-sized screens.
- Keyboard arrows work on desktop.
- Interface controls fade during reading.
- Tapping/clicking reveals reactions.
- There is no finished button.
- Text remains readable on small phones and desktop.
- No sign-up controls are visible before the reader opens the boks wordmark or reaches the guest notices.
- Guest notices appear after 5 and 10 distinct viewed boks.
- A guest cannot swipe past 15 distinct viewed boks without sign-up/sign-in.
- Signed-in readers can open settings and recently read boks from the boks wordmark.

Author:

- `/author` submits a valid bok for admin review.
- Pieces above 15 minutes are blocked.
- Required fields are visible and understandable.
- Authors can see waiting, published, and refused statuses.
- Refused boks show the admin reason and can be revised.

Admin:

- Admins can approve or refuse submitted boks from Review queue.
- Refusal requires a reason visible to the author.
- Approved boks become eligible for the reader feed.
- `/admin` does not load all stories at once.
- Search, sort, and pagination remain server-side.
- Export includes the same major metrics shown in the UI.
- Recommendation comparison stays attributed by algorithm where data exists.
- Anonymous users cannot load admin metrics.
- Regular reader accounts cannot load admin metrics.
- Admins can grant and remove admin access from User management.
- Admins cannot remove their own only admin access.

## Technical Validation

Run before every production deploy:

```bash
npm run lint
npm run verify:supabase
npm run build
node /Users/iegorov/.codex/plugins/cache/openai-bundled/sites/0.1.66/scripts/build-site.mjs
```

Run locally:

```bash
npm run start
```

Then check:

- `http://127.0.0.1:8787/`
- `http://127.0.0.1:8787/author`
- `http://127.0.0.1:8787/admin`
- `http://127.0.0.1:8787/api/boks?view=reader&limit=20&visitorId=agent-check`
- `http://127.0.0.1:8787/api/boks?view=admin&limit=20` returns `403`; admin metrics are loaded through Supabase role-checked RPCs from `/admin`.

If the local port differs, use the URL printed by Wrangler.

## Mobile QA

Minimum viewport checks:

- 390 x 844, iPhone-sized portrait.
- 430 x 932, large phone portrait.
- 768 x 1024, tablet portrait.
- 1440 x 900, desktop.

Check:

- No text overlaps.
- Story body line length is comfortable.
- Action buttons do not cover important text while hidden or visible.
- Swipe target is large enough.
- Modals or comment fields fit on small screens.

## Metrics Quality Checks

During a test, verify these signals accumulate:

- impressions
- starts
- inferred completions
- skips or drop-offs
- likes
- shares
- comments
- elapsed seconds
- scroll progress
- feed rank
- algorithm id
- user segment

For Supabase, the current MVP records production reader `views` and `likes`; richer recommendation attribution still lives in the D1 compatibility path. Before making serious algorithm decisions from Supabase traffic, add attributed Supabase events matching `specs/boks-recommendation-experiments.md`.

## When A Test Result Is Useful

A small batch is useful when it has:

- At least 10 real readers.
- At least 3 stories seen per reader.
- At least 30-50 attributed impressions per recommendation variant before comparing algorithms.
- A saved metrics export before any major content or algorithm change.

Do not over-interpret likes alone. A good story or algorithm should improve completion or reaction without creating a large skip-rate increase.
