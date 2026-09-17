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

Sign in by email magic link with a permanent account that has `admin` role in Supabase. If this is the first admin, sign up as a reader first, open `/admin`, and use the first-admin claim. After one admin exists, new admins must be granted from the User management panel.

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
- A left-edge tap or movement to the left returns to the previous bok; the right edge/direction advances.
- Downward reading scrolls inside a long bok. A second gesture started at the bottom advances; the corresponding gesture started at the top returns.
- Navigation stops at the first and last loaded bok instead of wrapping around.
- Left/up and right/down keyboard arrows return and advance on desktop; Space advances only when focus is outside a control or text field.
- Interface controls fade during reading.
- Tapping/clicking reveals reactions.
- There is no finished button.
- Text remains readable on small phones and desktop.
- Source Serif 4 renders both Latin and Cyrillic story text without a network font request.
- `Settings -> About -> Open Source Licenses / Лицензии` links to the complete Source Serif 4 SIL OFL 1.1 text.
- No sign-up controls are visible before the reader opens the account/settings button or reaches the guest notices.
- Guest notices appear after 5 and 10 distinct viewed boks. They say `10 more without an account` and `5 more without an account`, state that reading is free, and explain the benefit of saved history and better recommendations. They never imply that only those boks are free.
- The notice has one full-width `Create free account` action plus a 44 x 44 dismiss control. While it is visible, reaction controls stay hidden and the story has enough bottom scroll space to move every line above the notice.
- A guest cannot swipe past 15 distinct viewed boks without sign-up/sign-in.
- At 15 distinct boks, the non-dismissible account form states that reading stays free and fits inside the phone viewport without horizontal scrolling.
- Signed-in readers can open settings and recently read boks from the 44 x 44 account/settings button.
- "Write a bok" in the account panel opens `/author`; "Admin" appears there only for admin accounts.
- The author cabinet shows "Open admin" only for admin accounts.

Author:

- `/author` submits a valid bok for admin review.
- The daily submissions panel shows used/remaining and the reset time.
- The cabinet shows "Submitting as <name> (@handle)" and has no editable author name or handle field.
- A published bok's byline matches the author's profile, not anything typed at submission time.
- The submit button is disabled once 3 boks have been submitted today, and the database refuses a fourth even if the button is bypassed.
- A signed-in reader can reach `/author` from "Write a bok" in the boks wordmark panel.
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
- Recommendation lab lists every registered algorithm, including parked ones.
- Arms below the minimum impression count are dimmed and never named a leader.
- Uplift is shown against the control arm with a confidence label.
- Changing the traffic split and saving assigns new readers with the new weights.
- A reader account cannot open the lab or save a split.
- Anonymous users cannot load admin metrics.
- Regular reader accounts cannot load admin metrics.
- Admins can grant and remove admin access from User management.
- Admins cannot remove their own only admin access.

## Technical Validation

Everything below runs locally. Nothing here deploys.

### 1. Offline checks (no database, no network)

```bash
npm run lint
npm run typecheck
npm test
```

`npm test` covers the parts where a mistake is expensive and invisible:
recommendation ranking per strategy, deterministic experiment assignment,
metric/uplift math, the reader event queue, and the daily submission quota.

### 1b. Can the experiment resolve anything?

```bash
npm run verify:divergence
```

Scores the live arms over the current catalog and reports how much their top ten
overlap. Above ~80% they are serving the same feed and no experiment can tell
them apart, whatever the sample size - the script exits non-zero to say so.

Two failure modes it catches, both invisible in a metrics panel because both
just look like a tie:

- **Too few boks.** With a handful of published boks every algorithm shows the
  same list.
- **Arms that are near-duplicates.** The quality strategies weight the same
  signals and agree on 90-100% of their top ten even on a healthy catalog. Pick
  arms from different families; `balanced` against `recency` shares only ~20%.

### 2. Schema checks (Docker, no Supabase project)

```bash
npm run verify:schema
```

Applies `scripts/local-supabase/shim.sql` plus every migration to a throwaway
`postgres:17-alpine` container and runs `scripts/local-supabase/checks.sql`
against it: the 3-per-day author limit and its daily reset, moderation approve
and refuse, admin-only access to the lab and the traffic split, event batch
validation, candidate rollups, and the RLS rules that keep readers out of the
event stream. Any failing check aborts with the assertion text.

Add `-- --keep` to leave the container up for inspection, `-- --down` to remove it.

### 3. Full product flow (local Supabase stack)

```bash
npx supabase start
npm run test:supabase
```

Runs `lib/boks/supabase-flow.test.ts` through PostgREST exactly as the browser
does: sign-up, the anonymous-to-permanent upgrade, the daily limit, moderation,
ranking real candidates, recording attributed events, reading lab counters, and
changing the traffic split. The runner resets the local database first and
refuses any non-loopback URL, because the suite creates users and content.

### 4. Supabase project checks

```bash
npm run verify:supabase
```

Checks RLS against whatever `.env.local` points at. Recommendation checks report
`"pending"` instead of failing when the project has not applied
`20260912160000_boks_recommendation_experiments.sql` yet.

### 5. The app itself

```bash
npm run build
npm run start
```

Then check:

- `http://127.0.0.1:8787/`
- `http://127.0.0.1:8787/author`
- `http://127.0.0.1:8787/admin`
- `http://127.0.0.1:8787/api/boks?view=reader&limit=20&visitorId=agent-check` - the response carries an `experiment` object; different `visitorId` values should land on different `algorithmId`s.
- `http://127.0.0.1:8787/api/boks?view=admin&limit=20` returns `403`; admin metrics are loaded through Supabase role-checked RPCs from `/admin`.

If the local port differs, use the URL printed by Wrangler.

To point the built client at a local Supabase stack without touching the real
credentials in `.env.local`, create `.env.development.local` (dev mode only, so it
cannot reach a production build; `.env.production.local` would have higher priority in
Vite) with the local URL and publishable key, rebuild, and delete it afterwards.

The local D1 database does not auto-migrate. After `npm run db:generate`, apply
the new file to the running local worker:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
  d1 execute DB --config dist/server/wrangler.json --local \
  --persist-to .wrangler/state --file drizzle/<migration>.sql
```

## Mobile QA

Minimum viewport checks:

- 393 x 852, iPhone Pro-sized portrait.
- 430 x 932, large phone portrait.
- 768 x 1024, tablet portrait.
- 1440 x 900, desktop.

Check:

- No text overlaps.
- Story body line length is comfortable.
- Action buttons do not cover important text while hidden or visible.
- The mobile action bar is content-sized and centered rather than stretched across the viewport.
- Left and right tap/swipe targets are large enough without blocking text selection or controls.
- Next and previous transitions change the title immediately, move in opposite directions, settle without a flash or layout shift, and cannot skip a second bok when two inputs arrive during one transition.
- With `prefers-reduced-motion: reduce`, changing boks is immediate rather than delayed by an invisible animation.
- While the account form, comments, author view, or bok menu is open, Arrow keys, Space, edge taps, swipes, and pointer drags do not change the background bok.
- Reaching the end of a long bok does not advance until a new boundary gesture begins.
- Modals or comment fields fit on small screens.
- The account/settings button remains visible when the reading chrome is shown and has a 44 x 44 target.
- The 5/10-boks notice does not cover reaction controls or permanently hide unread lines; dismissing it restores the normal reading chrome.
- The 15-boks account gate fits at both phone sizes with its email field, Terms control and primary action visible.
- Guest readers can open and read comments without friction.
- Guest readers see the free-account prompt when they try to like or write a comment.
- Signed-in comments show the current unique `@nickname` only, and do not offer a separate name field.

## Reading The Overview Tab

`/admin` opens on Overview, which answers four questions and nothing else:

1. **Do readers come back?** Returning share against the previous window. The
   only number that predicts survival.
2. **Reading time, decomposed.** Never shown alone - minutes alone reward long
   boks and slow readers, so minutes always appear beside boks finished and
   minutes per boks, decomposed as sessions x minutes per session.
3. **Do they read more than one?** A distribution, not a mean. The thesis is
   that people read more than one; an average hides the split between
   one-and-done and regulars.
4. **Is there enough to read, and can these numbers be trusted?** Catalog
   headroom and supply health on one side; on the other, the share of reads with
   a recorded outcome, sessions that ended with nothing, unattributed events and
   outcomes with no reading time. Check the data-quality tile before believing
   anything else on the page.

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

Supabase now records these in `public.recommendation_events` for both guest and
signed-in readers, attributed with algorithm, experiment, segment, feed rank,
elapsed seconds and estimated duration. `public.views`, `likes` and `comments`
remain the reader-facing tables behind reading history and comment identity.

To confirm attribution is flowing during a test session:

```sql
select algorithm_id, event_type, count(*)
from public.recommendation_events
group by 1, 2 order by 1, 2;
```

## When A Test Result Is Useful

A small batch is useful when it has:

- At least 10 real readers.
- At least 3 stories seen per reader.
- At least 30-50 attributed impressions per recommendation variant before comparing algorithms.
- A saved metrics export before any major content or algorithm change.

Do not over-interpret likes alone. A good story or algorithm should improve completion or reaction without creating a large skip-rate increase.
