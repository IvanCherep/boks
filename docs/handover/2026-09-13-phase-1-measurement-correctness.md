# Handover — Phase 1: measurement correctness

Date: 2026-09-13
Plan: `docs/research/recsys-research-implementation-plan.md` §L, Phase 1
Status: **complete**, verified locally. Nothing deployed, nothing committed.

Phase 1 answers one question: *can any number this system produces be trusted?*
It does not touch ranking quality — that is Phase 5, and the plan forbids
starting it until Phases 1–3 are trustworthy.

---

## What was wrong (from the Phase 0 audit)

| # | Defect | Consequence |
|---|---|---|
| V1 | The analysis unit was the impression | 100 impressions from 3 readers was reported as n=100 and labelled "strong signal" |
| V2 | Between-reader experiments are underpowered at this scale | +30% detected 15% of the time at 25 readers per arm, with nothing on screen saying so |
| V3 | No feed provenance | A served feed could not be reconstructed, so no result was reproducible |
| V4 | An invisible data split | A failing Supabase feed silently fell through to D1; those readers vanished from every comparison |
| F1 | Every published boks reports `minutes = 1` | `estimatedSeconds` was a constant, so read/skip inference had no length to judge against |

---

## What changed

### 1. Ranking moved to the Worker (ADR-001)

`app/api/feed/route.ts` is now the canonical feed endpoint. It forwards the
reader's own Supabase access token to PostgREST — it holds no elevated
credential — ranks through the unchanged `buildReaderFeed`, and writes
`served_feed` + `served_feed_item` before returning the slate.

The browser keeps a ranking path, but it is a **labelled degraded mode**
(`serving_backend = 'browser'`), running the *same* `serveReaderFeed` through a
supabase-js transport. The D1 path is labelled `d1_fallback` and is now reached
only when Supabase is not configured at all: a *failing* Supabase reader
surfaces the failure instead of being diverted.

A rejected token produces a 401, not a degraded feed. Serving a recency feed
under an expired session would have hidden a broken sign-in behind a working
page and filed the reader's events under an arm nobody assigned them.

A degraded serve is also kept **out of the experiment**: it is ranked over a
candidate set with no behavioural rollups, which is a different ranker, so it is
recorded with `assignment_source = 'fallback'` rather than credited to the
reader's stored arm.

### 2. The analysis unit is the reader, in one place

`lib/recsys/aggregate/` turns `get_reader_outcomes` rows — one per
(reader, algorithm, day) — into one value per reader. Everything downstream
consumes that, so there is exactly one place where the choice of analysis unit
can be got wrong.

It also removes readers who produced events under **both** algorithms, and
reports how many. Before the assignment table became authoritative a reader could
legitimately appear in two arms; counting them in both would make the arms look
alike for a reason unrelated to the rankers.

### 3. A real statistics core

`lib/recsys/statistics/`:

- `compareIndependent` — Hodges–Lehmann shift, percentile bootstrap CI,
  permutation test on arm labels. The permutation test is exact under the null
  by construction, so unlike a bootstrap interval it cannot quietly undercover
  on a small skewed sample.
- `comparePaired` — paired bootstrap + exact sign test, for interleaving and
  before/after. A test asserts it resolves an effect the unpaired design cannot
  see; that is the entire argument for interleaving at boks' scale.
- `power.ts` — simulation-based, log-normal draws, Welch's t against a **t**
  critical value. Its unit test reproduces the power table measured
  independently in §A.3 of the plan to within 4 percentage points. Using the
  normal critical value instead inflates power by 3–7 points at these sizes and
  fails that test.
- Every estimate is seeded and reproducible. `ComparisonResult` makes it
  impossible to return an effect without its analysis unit, sample size and
  uncertainty.

An interval spanning zero is `inconclusive`. It is never "no difference".

### 4. The lab rebuilt on reader rows

`lib/boks/recommendations/metrics.ts` was rewritten. Deleted outright:
`engagementScore`, `paceIndex`, `avgSecondsToLike`, `avgSecondsToComment`,
`avgStartRank`, `segmentRows`, `timeline`, `proportionConfidence`,
`findLeaders`, and the whole `AlgorithmCounters` path including
`algorithmCountersSql` and the D1 lab report.

The console now shows the effect, its interval, the readers behind it, what this
sample could have detected, and — at 25 readers or fewer per arm — every
per-reader number.

### 5. A data-quality panel

`get_recommendation_data_quality` counts fourteen conditions that were
previously invisible: events without a feed, algorithm mismatches, reads of
things never served, duplicate outcomes, clamped reading time, feeds by backend,
labelling versions in the window. Without this, broken numbers get trusted —
which is exactly what happened.

### 6. Smaller measurement fixes

- `estimatedSeconds` on every event now comes from `expectedReadingSeconds`
  (real word count at a fixed 238 wpm) instead of `max(60, minutes * 60)`, which
  was a constant because every boks reports one minute.
- `catalogSize` in impression metadata is the published catalog as counted by
  the server, not the length of the delivered slate.
- Version stamps (`signals.v1`, `ranking.v1`, `labeling.v1`) are written on every
  served feed and every event, with their changelog in
  `lib/boks/recommendations/versions.ts`.

---

## Two bugs found while building this

1. **`{...defaults, ...options}` let an explicit `undefined` disable the
   minimum-sample guard.** Any caller forwarding an optional field would have
   silently removed the one check standing between a three-reader sample and a
   printed verdict. Fixed with a merge that skips undefined values, plus a
   regression test.
2. **A paired p-value of 1.9e-6 printed as `0`.** Rounding probabilities to four
   decimal places claims a certainty no test can deliver. They now round to
   significant digits.

---

## Verification (all run locally, all green)

```
npm run lint                 clean
npx tsc --noEmit             clean
npx vitest run               121 passed, 9 skipped
npm run verify:schema        16 migrations, 75 schema checks passed
npm run test:supabase        9 passed against the local stack through PostgREST
npm run build                /api/feed registered
```

End-to-end against `npx supabase start`, with an anonymous session:

```
POST /api/feed  →  feedId written, serving_backend=worker, degraded=false,
                   assignment_source=assigned, catalogSize=38,
                   profile_snapshot stored verbatim, 5 items with scores
no Authorization header      → 401
forged/expired token         → 401, not a degraded feed
```

---

## What is deliberately still true

- **The design is still between-reader.** Phase 1 made it measurable, not
  powerful. Interleaving is the only thing that resolves a realistic effect at
  ~50 readers, and it belongs to a later phase.
- **The divergence gate still reports WEAK.** 39 boks, all one minute long, only
  five carrying any behaviour. Nine of the seventeen signals are constants. No
  amount of statistics fixes a catalog, and the gate says so on the page.
- **`boksOpened` is counted per day and summed**, so a reader reopening the same
  boks on two days is counted twice. Fixing it costs a column in the RPC.

---

## Next

Phase 2 (experiment methodology) per §L: experiment lifecycle with a frozen
declaration, a required power estimate before an experiment can reach `ready`,
and the divergence gate as a launch precondition rather than a readout.

Constraints unchanged: local verification only, nothing deployed, nothing
committed, and `.env.local` holds the real Supabase credentials — the local
stack override lives in `.env.production.local`.
