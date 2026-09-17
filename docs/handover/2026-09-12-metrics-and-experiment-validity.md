# Handover: admin metrics rework and experiment validity

Date: 2026-09-12, third session of the day. Read
`docs/handover/2026-09-12-author-limits-and-recommendation-lab.md` first - this
one corrects work done there.

Approved plan: `~/.claude/plans/vivid-cuddling-kahn.md`.

## What was asked

Audit the admin console for redundant or missing metrics, and make algorithm
comparison scientifically valid at the project's real scale: ~100-200 signups,
~50 active readers in the first couple of months.

## The audit

Verified against the running database (`pg_proc.prosrc`), not just the source.
The console was reporting numbers that were not measurements:

| Shown as | Actually was |
|---|---|
| `Impressions` and `Starts` | the same subquery over `views` - always equal |
| `Completes` | hardcoded `0`, so "Start rate" read 100% and "Finish" read 0% |
| story field `finishRate` | `likes/views`. Mislabelled, and never rendered |
| `Signal` | `views + likes*5 + comments*6`, an invented composite |
| `storySignal()` | a **second**, different invented formula; dead code |
| `algorithmMetrics` in the snapshot | a **third** copy of the funnel; dead payload |

Two sources of truth disagreed on the same words on one screen: `views` = 406
rows, impression events = 766.

All of it is removed. The rule that replaces it: **behaviour comes from
`recommendation_events`; `views` and `likes` are product features (reading
history, like state) and are never metrics.**

## Three defects that were corrupting the data itself

1. **Every session's last read recorded nothing.** `recordReadingOutcome` had
   one call site, inside `nextStory`. A reader who stopped and closed the tab
   produced no completion and no skip - biasing against exactly the algorithm
   that serves a compelling last story.
2. **Reading time was wall-clock.** No visibility handling at all, so a locked
   phone counted as reading.
3. **Assignment was rewritten on every feed load.** `on conflict ... do update
   set algorithm_id = excluded.algorithm_id`, fired from every feed load with a
   client-recomputed value. The table recorded the last page load, not what the
   reader was served, so any cohort or before/after analysis would have been
   reading overwritten history.

Also fixed, found while verifying the fix for (1): backgrounding for three
seconds permanently locked that read as a "skip", because a boks gets one
verdict per session. Backgrounding now emits a heartbeat and leaves the verdict
open.

## The statistics were invalid, and the experiment was unrunnable

Two separate problems.

**The test counted events, not readers.** `proportionConfidence` gated on 30
*impressions*, which four arms clear in an afternoon. Events within one reader
are correlated, so it would print "strong signal" off three readers. The lab
table was also sorted by `engagementScore` - five invented constants deciding
what the founder reads first.

**Four arms cannot work at 50 readers.** Simulated power on per-reader reading
time (CV ~0.95):

| lift | n=12/arm | n=25/arm | n=50/arm |
|---|---|---|---|
| +30% | 10% | 15% | 26% |
| +80% | 32% | 58% | 86% |
| +120% | 51% | 82% | 98% |

Cut to two arms. That is free, and it doubles the sample behind every
comparison.

**And the two arms that were running could never have worked.** The new
`npm run verify:divergence` scores every strategy over the real catalog:

```
catalog: 5 published boks
The algorithms agree on 100% of their top 10.
verdict: INDISTINGUISHABLE
```

Testing the same pipeline against an 85-bok catalog showed the sharper finding:

| pair | overlap of top 10 |
|---|---|
| balanced vs reaction_first | 100% |
| balanced vs completion_first | 90% |
| balanced vs discovery | 70% |
| balanced vs **recency** | **20%** |
| completion_first vs random_control | 0% |

The quality strategies weight the same signals and converge. An experiment
between two of them cannot resolve anything **at any sample size, on any
catalog**. The default arms are now `balanced` vs `recency`, which shares ~20%
and asks the question a young product should answer first: is ranking worth
anything against simply showing the newest?

## What shipped

### Measurement

- `components/boks/reader-clock.ts` - foreground-only clock. Accrues only while
  visible; `pageshow` rebases after back/forward cache; every un-observed
  interval is bounded so a suspended laptop cannot book six hours. The periodic
  mark is a **flush, not a count** - iOS throttles timers, so the value added is
  always the real elapsed delta.
- Outcome recorded at real teardown (`pagehide`, unmount, story change), not on
  every `visibilitychange`.
- `keepalive: true` on the exit flush. Safari cancels ordinary fetches on
  `pagehide`, and `sendBeacon` cannot carry the PostgREST auth headers.
- One impression per (session, boks): the feed wraps a small catalog, and
  counting lap two as a new impression while the outcome is recorded once made
  finish rate fall mechanically the longer someone read.

### Schema (`20260912180000`, `20260912190000`)

- `recommendation_events.active_seconds` and `.progress` as typed columns;
  `heartbeat` event type; heartbeat every 60s of foreground time.
- **`active_seconds` is cumulative per (session, boks) and every rollup uses
  `max()`, never `sum()`.** This one rule makes the pipeline idempotent: a
  retried batch, a repeated heartbeat, or a lost final event all cost nothing.
- `reels.word_count`, backfilled and maintained by a trigger. `minutes` is
  `ceil(words/220)` clamped to 1-15 and cannot be inverted, so anything derived
  from it (the old `paceIndex`) was meaningless.
- Assignment: `on conflict do nothing`, plus `get_my_recommendation_assignment`
  and `migrate_recommendation_arm` (stamping `switched_at` and
  `previous_algorithm_id`). Assignment is keyed on the Supabase user id, not a
  per-browser id.
- `get_boks_overview(p_days)` - the whole weekly page, event-sourced.

### Read/skip inference

Now based on real word count against a **fixed** 238 wpm, not per-reader speed.
Per-reader speed was requested and was deliberately not used for the label: if
"completed" depends on a speed that shifts as samples accumulate, finish rate
stops being comparable between readers and drifts for the same reader - moving
the instrument while measuring with it. Personalise the product, standardise the
instrument. Per-reader speed can still be *displayed*; it just must not feed the
label.

### Console

Five tabs: Overview / Moderation / Experiments / Content / People. Each loads
only its own data. Overview answers four questions and nothing else: do readers
come back, reading time decomposed (never minutes alone - that would reward long
boks), do they read more than one (a distribution, not a mean), and is there
enough to read plus can these numbers be trusted.

## State and what is next

Stages 1-3 of the plan are done, plus the supply-side half of stage 6. **Stages
4 and 5 were deliberately not built**: the divergence gate says the catalog is
the binding constraint, so a per-reader statistics engine and interleaving would
be machinery that cannot return a verdict yet. The user chose to do the supply
side first.

When the catalog grows and `npm run verify:divergence` returns `usable`:

1. **Stage 4** - replace `metrics.ts` with per-reader aggregation, a permutation
   test (not bootstrap: it undercovers badly at n<30 on skewed data), and an MDE
   readout phrased as a refusal. New RPC returning one row per (user, algorithm,
   day). Assert the MDE function against the simulated power table above - there
   is ground truth.
2. **Stage 5** - interleaving. Team-draft two strategies over one candidate set,
   credit each read to whichever proposed the slot, compare per-reader win
   fractions. Within-reader, within-session, within catalog state, so reader
   variance and depletion cancel exactly.

Do not build a crossover (A then B on the same reader): there is no washout,
because you cannot un-read a story, and the arm that wins the first period
depletes the catalog most.

## Things the next agent must know

- **Nothing is deployed.** Migrations `20260912150000` onward have never been
  applied to the hosted project. Until they are, the live app runs degraded
  paths that were all tested: newest-first feed, no attributed events, an
  actionable notice in the lab, and `"pending"` from `npm run verify:supabase`.
- **These migrations are still unreleased, so seed literals in them were edited
  in place** (the default arms). Once applied anywhere real, go back to
  append-only.
- **`verify:schema` had two flakes, both fixed**: a container-name race after
  cleanup, and `pg_isready` answering during initdb before the real server
  starts. It now waits on an actual query.
- **`engagementScore`, `paceIndex`, `avgSecondsToLike`, `avgStartRank`,
  `segmentRows`, `timeline` still exist in `metrics.ts`** but nothing renders
  them. Stage 4 rewrites that file; delete them then.
- **Reading fatigue lives in localStorage** while assignment is now per Supabase
  user, so the same reader on two devices shares an arm but not an "already
  read" set. Known, not fixed.

---

## Follow-up: field-by-field review for production

The brief changed: the console is going to be read by first users' worth of real
data and by an outside reviewer, so every field has to justify itself, and
trends over time were explicitly wanted.

Full field-by-field reference, including what was removed and why:
**`docs/admin-metrics.md`**. Read that before adding a metric.

### The distinction that resolved "more metrics" vs "fewer metrics"

Both are right about different things:

- **Counts and totals over time are honest at any sample size.** New readers per
  week, minutes read per week, boks published per week. These were missing
  entirely and are now the Growth tab.
- **Rates at small n are not.** A finish rate off a dozen readers moves several
  points when one person changes their mind. So rates appear only beside their
  denominator, per-boks finish rate is withheld below ten starts, and no rate is
  ever plotted as a weekly trend line.

### Added

- **Growth tab** - new readers, accounts, minutes, sessions, active readers,
  boks finished and boks published, all weekly; a **retention triangle** with
  cohort size printed beside every row; activation (of readers who arrived in 30
  days, how many finished one boks, three, or created an account); daily/weekly/
  monthly readers.
- **`get_boks_growth`**, **`get_boks_people`**, **`get_boks_content`** - three
  RPCs that finish the migration off the old snapshot. People and content are
  now event-sourced like everything else; `get_boks_admin_snapshot` serves only
  the moderation queue.
- Content is ranked by **reading minutes**, shows real word counts, and shows
  finish rate only above ten starts.
- People shows minutes, finished-of-opened, sessions, assigned arm and last
  read - replacing counts taken from the `views` table, which disagreed with the
  rest of the console.

### A production bug found during the review

**`reels.minutes` was whatever the submitter sent.** The seeded catalog claimed
5-9 minutes for boks of 68-92 words - roughly twenty seconds of reading. So the
reader was promised "9 min" and got twenty seconds, the 15 minute limit was
enforced against a number the author chose, and every length-derived figure
described fiction.

Length is now derived from the text by trigger on every insert and edit, and
`submit_bok_for_review` checks the 15 minute rule against the words on the page.
Author handles are also stored bare, so `@` is never doubled when rendered.

### Tabs

`This week` / `Growth` / `Moderation` / `Content` / `People` / `Experiments`.
Each loads only its own data. Moderation carries a count badge because it is the
only tab with a daily job attached.
