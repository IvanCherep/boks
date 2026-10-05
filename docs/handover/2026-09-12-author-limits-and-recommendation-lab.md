# Handover: author submission limits and the recommendation lab

Date: 2026-09-12. Written so another agent can pick this up without re-deriving
anything. Read `AGENTS.md` and `docs/README.md` first; this file is the record of
one work session, not a replacement for them.

## What was asked

1. A convenient way for signed-up users to add boks, limited to 3 per day, with
   every submission going through admin verification before publication.
2. An architecture and a UI for testing different recommendation systems:
   easy to add a new algorithm in code, and easy to read per-algorithm
   statistics in the admin console.

Constraint: verify locally, deploy nothing.

## What was already there

Author submission, the moderation queue, approve/refuse with a reason, and the
author status history all existed and worked. The daily limit did not.

The recommendation situation was worse than it looked. There were two
implementations:

- The D1 compatibility path built a SQL `ORDER BY` per algorithm and recorded
  richly attributed events.
- The Supabase production path - what real readers actually use - served
  newest-first and recorded only `views`. The admin "Recommendation lab" showed a
  single hardcoded `supabase_recent` row with `completes: 0` and
  `finishRate: 0`.

So no recommendation comparison was possible in production, and the numbers on
screen were not measurements.

## What was built

### 1. Author daily limit

- `supabase/migrations/20260912150000_boks_author_daily_limit.sql`
  - `boks_daily_submission_limit()` returns 3, in one place.
  - `submit_bok_for_review` now counts the author's submissions since the start
    of the UTC day and refuses past the limit. The count is read after locking
    the author's own `user_profiles` row, so two parallel submissions cannot both
    read a stale count.
  - `get_my_bok_quota()` returns `{limit, usedToday, remaining, exhausted, resetsAt}`.
- `lib/boks/contracts.ts` holds `dailyBokSubmissionLimit`;
  `lib/boks/author/submission-quota.ts` mirrors the rule for the UI. The
  database stays the authority - the UI copy exists so an author sees the limit
  before writing a fourth piece, not to enforce it.
- `components/boks/author-console.tsx` shows a "Daily submissions" panel with
  pips, the remaining count, and the reset time, and disables submission when
  exhausted.
- `components/boks/user-auth-panel.tsx` adds a "Write a bok" link next to the
  existing "Admin" link, so a signed-in reader reaches `/author` from the reader
  surface.

### 2. Recommendation architecture

New module `lib/boks/recommendations/` replacing the old single file:

| file | role |
|---|---|
| `signals.ts` | 17 normalized `0..1` signals derived from a candidate set |
| `strategy.ts` | the strategy contract and `defineStrategy` |
| `strategies/*.ts` | one file per algorithm |
| `strategies/index.ts` | **the registry list - the only file to edit when adding one** |
| `registry.ts` | lookup, display, segment filtering; derives the id union type |
| `experiments.ts` | traffic split config, validation, deterministic assignment |
| `feed.ts` | `buildReaderFeed` - the one seam both backends rank through |
| `metrics.ts` | raw counters to rates, uplift, confidence, sample readiness |

Key decisions, in full in
`docs/adr/0003-typescript-ranking-and-attributed-events.md`:

- **Ranking is TypeScript, not SQL.** SQL returns candidates with counters. Both
  the Supabase reader and the D1 API call `buildReaderFeed`. One implementation,
  and strategies are unit-testable with no database.
- **Strategies weight normalized signals**, so a weight means the same thing
  everywhere and algorithms stay comparable.
- **Reading fatigue is enforced in `feed.ts`, not per strategy.** A boks the
  reader skipped or finished never outranks an unseen one. Strategies cannot
  forget this rule.
- **The registry drives everything else.** The `RecommendationAlgorithmId` union,
  the admin lab and the traffic split editor are all derived from it.

Seven strategies now exist: `balanced` (control), `completion_first`,
`reaction_first`, `discovery`, `taste_match` (behavioral personalization),
`recency` (the old MVP feed, kept as a comparable arm) and `random_control`
(the floor any real strategy must clear).

### 3. Attributed events on Supabase

`supabase/migrations/20260912160000_boks_recommendation_experiments.sql`:

- `recommendation_experiments` - the live traffic split, as data.
- `recommendation_assignments` - which arm each reader is in.
- `recommendation_events` - every behavior signal with `algorithm_id`,
  `experiment_key`, `user_segment`, `surface`, `rank`,
  `client_elapsed_seconds`, `estimated_seconds`, `value`, `metadata`.
- RPCs: `record_recommendation_events` (batch, stamps `user_id` from the
  session), `record_recommendation_assignment`,
  `get_recommendation_candidates`, `get_recommendation_lab`,
  `get_active_recommendation_experiment`, `save_recommendation_experiment`.
- RLS: readers cannot read the event stream or insert into it directly; only
  admins read the lab or change the split. Guest readers are anonymous Supabase
  users and **are** measured.

`components/boks/reader-events.ts` batches events in the browser (immediate
flush for completions and reactions, timed flush otherwise, retry on failure,
flush on `visibilitychange`/`pagehide`) so a reading burst costs one request.

### 4. Admin recommendation lab

`components/boks/admin/recommendation-lab.tsx` replaces the old fake table:

- KPI row, a metric selector (finish / reaction / start / skip / engagement),
  and a single-series comparison bar chart with direct labels.
- A full metrics table with uplift against control in percentage points, a
  coarse confidence label from a two-proportion z score, and a per-algorithm
  sparkline.
- Arms below `minimumImpressionsPerArm` are dimmed, labelled "needs N more" and
  never named a leader.
- A per-segment breakdown.
- `experiment-editor.tsx`: every registered algorithm with a traffic weight,
  control selection and minimum sample, saved through an admin-only RPC. The
  founder changes the live split without a deploy.
- "Export comparison" writes the whole report as JSON.

### 5. Bug found and fixed

Upgrading an anonymous Supabase session to a permanent account left the old
access token in place, and that token still claimed `is_anonymous: true`. Every
`is_anonymous`-gated RPC then refused the account that had just been created, so
**signing up from `/author` and immediately submitting a bok was broken**.
`createOrUpgradeBoksUser` now refreshes the session after an upgrade.
Regression test: `lib/boks/supabase-flow.test.ts` -> "lets a guest reader become
an author without a second sign-in".

## How this was verified locally

Nothing was deployed. Four layers:

```bash
npm run lint && npm run typecheck && npm test   # 39 offline unit tests
npm run verify:schema                           # 8 migrations + 32 schema checks, throwaway Postgres
npx supabase start && npm run test:supabase     # 8 flow tests through real PostgREST
npm run build && npm run start                  # browser pass at 127.0.0.1:8787
```

New verification tooling, all added in this session:

- `scripts/verify-schema-local.mjs` + `scripts/local-supabase/{shim.sql,checks.sql}`:
  applies every migration to a `postgres:17-alpine` container behind a small
  Supabase shim (`auth` schema, `auth.uid()`, `auth.jwt()`, the three roles) and
  asserts behavior: the 3/day limit and its reset, moderation, admin-only lab
  access, event validation, RLS. No Supabase project, no network.
- `scripts/run-supabase-flow-test.mjs` + `lib/boks/supabase-flow.test.ts`: the
  full product flow through PostgREST against a local stack. The runner reads
  `supabase status`, refuses any non-loopback URL, and resets the database first.

Browser pass confirmed: the reader ranks and records attributed events, the
author quota fills to 3/3 and disables submission, the admin approves and
refuses with a reason, the lab renders comparison and readiness, and saving a
traffic split persists. Degradation was also tested by dropping the new RPCs:
the reader falls back to newest-first with no console errors, the lab shows an
actionable notice naming the migration file, and `npm run verify:supabase`
reports `"pending"` rather than failing.

## Things the next agent must know

- **The migrations are not applied to the hosted Supabase project.** Nothing was
  deployed. Until `20260912150000` and `20260912160000` are applied there, the
  hosted app runs the degraded path: newest-first feed, no attributed events, an
  admin notice naming the file, and no daily limit. Everything keeps working.
- **Local D1 does not auto-migrate.** `drizzle/0003_nice_mongoose.sql` adds
  `experiment_key` and `estimated_seconds` to `events`. Apply it to a running
  local worker with `wrangler d1 execute DB --local --persist-to .wrangler/state
  --file drizzle/0003_nice_mongoose.sql` (see `docs/testing.md`).
- **`.env.production.local`** is the way to point a build at a local Supabase
  stack without touching the real credentials in `.env.local`. Vite gives it
  higher priority. Delete it to go back.
- **`npm run test:supabase` needs a database with no admin yet**, because it uses
  the first-admin claim. The runner resets automatically; pass `-- --no-reset`
  only if you know the state.
- **`get_boks_admin_snapshot` still emits stale `algorithms` and
  `algorithmMetrics` keys** describing the removed `supabase_recent` row. Nothing
  reads them. They were left alone rather than re-emitting a 300-line SQL
  function for a cosmetic change; drop them the next time that function is
  rewritten anyway.
- **`npx tsc --noEmit` was already failing before this session** on five errors
  in `reader-feed.tsx`, `supabase-browser-data.ts` and `use-boks-data.ts`. All
  five were fixed in passing because those files were being edited. It is clean
  now, so keep it clean.
- **Two aggregation queries are the next scale trigger.**
  `get_recommendation_lab` and `get_recommendation_candidates` aggregate the raw
  event stream. Both are bounded (60 days, 400 newest boks). When they get slow,
  the answer is precomputed daily rollups, not a bigger query.

## Suggested next steps

1. Apply the two migrations to the hosted Supabase project, then run
   `npm run verify:supabase` and confirm every `"pending"` becomes `true`.
2. Run a real reading cohort until at least one non-control arm passes its
   minimum impression count, then read the lab.
3. Add `story_metric_rollups_daily` and `algorithm_metric_rollups_daily` when
   live aggregation starts to drag.
4. Consider whether `random_control` should carry real traffic during the first
   study. It costs reading quality but it is the only way to know whether ranking
   is worth anything at all.
5. Retire the D1 path, or keep it deliberately. It is now only a different data
   source, not a different implementation, so the decision is cheap either way.

---

## Follow-up session, same day

Three items came back from a UI review.

### 1. "Write a bok" did nothing - and so did "Admin"

Not a markup bug. vinext's `next/link` client navigation throws
`TypeError: e is not a function` in this build and swallows the click, so every
`<Link>` in the app was a dead link, including the "Admin" link that predates
this work. Replaced all of them with plain `<a href>`. A full navigation is the
right behavior here anyway: reader, author and admin are separate surfaces with
separate data loads, and moving between them should reset the surface.

`@next/next/no-html-link-for-pages` is disabled for `app/**` and
`components/boks/**` in `eslint.config.mjs`, with the reason inline. **Re-enable
that rule and switch back to `<Link>` once vinext's Link works** - the anchors
are a workaround, not a preference.

### 2. The admin link was visible to everyone

`components/boks/author-console.tsx` had an ungated `Open admin` link in the
Status panel. Now gated on `role === "admin"`. The account panel's Admin link was
already gated correctly. `/admin` itself was never exposed - RLS refuses
non-admins - so this was UI noise rather than a hole, but it advertised a door
that would not open.

### 3. Display name versus @nickname

Decision: keep `display_name`, but stop letting it stand in for identity.

- Comments show `@nickname` only. The greyed display name beside it is gone -
  the handle already identifies the person.
- `display_name` survives for exactly one job: an author byline should read as a
  name ("Mira Vale"), not a username. That is the only place it appears.
- Sign-up still asks for both, unchanged.

The bigger finding sat next to the question. The author cabinet had **free-text**
"Author name" and "Handle" fields, sent straight to
`submit_bok_for_review(p_author_name, p_author_handle, ...)`. An author could
publish under any byline, including another author's - which contradicts the
product rule that public identity is the signed-in user's unique `@nickname`.

`supabase/migrations/20260912170000_boks_author_identity.sql` drops those two
parameters and derives the byline from `user_profiles` inside the RPC, so the
locked field in the cabinet is a real guarantee rather than a UI convention. The
migration also backfills existing author-submitted boks from their owner's
profile. The cabinet now shows "Submitting as Mira Vale (@mira_vale)".

Handles are stored without a leading `@`, so the reader byline and the admin
moderation queue add it when rendering.

### Verification

`npm run lint`, `npm run typecheck`, `npm test` (39 offline),
`npm run verify:schema` (9 migrations, 33 checks) and `npm run test:supabase`
(9 flow tests, including a new one asserting the byline comes from the profile
and not from the request) all pass. All three fixes were confirmed in the
browser against the local stack.
