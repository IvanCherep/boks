# boks Recommendation Experiments Spec

## Purpose

The recommendation framework tests which feed strategy creates the strongest
reading behavior. Readers never choose an algorithm manually. The system assigns
them to an experiment arm and records every action with that assignment.

Two things must stay cheap:

1. **Adding an algorithm.** One new file, one line in a list. No SQL, no UI work.
2. **Reading the result.** One screen that answers "which strategy is winning,
   on which measure, and is the sample big enough to believe it".

## Architecture

Ranking is TypeScript, not SQL. The database returns candidates with their
behavior counters; `lib/boks/recommendations` scores and orders them. That is
why one strategy implementation serves both the Supabase production path and the
D1 compatibility path, and why strategies can be unit-tested with no database.

```text
lib/boks/recommendations/
  signals.ts           normalized 0..1 story signals every strategy scores against
  strategy.ts          the strategy contract and defineStrategy()
  strategies/          one file per algorithm + index.ts registry list
  registry.ts          lookup, display, segment filtering
  experiments.ts       traffic split config and deterministic assignment
  feed.ts              buildReaderFeed(): the one seam both backends rank through
  metrics.ts           raw counters -> rates, uplift, confidence, readiness
  index.ts             public surface
```

Callers:

- Supabase reader: `components/boks/supabase-browser-data.ts` calls
  `get_recommendation_candidates`, then `buildReaderFeed`.
- D1 reader: `app/api/boks/route.ts` selects candidates, then `buildReaderFeed`.
- Admin lab: `components/boks/admin/recommendation-lab.tsx` calls
  `get_recommendation_lab`, then `buildRecommendationLab`.

## Story Signals

Every signal is normalized to `0..1`, so a weight means the same thing in every
strategy and strategies stay comparable. Negative weights are penalties.

`startRate`, `finishRate`, `reactionRate`, `likeRate`, `commentRate`,
`shareRate`, `skipRate`, `readDepth`, `popularity`, `freshness`, `exploration`,
`shortness`, `longform`, `tasteMatch`, `novelty`, `fatigue`, `jitter`.

`fatigue` is not a weight. Reading fatigue is a product rule applied in
`feed.ts`: a boks the reader already skipped or finished never outranks one they
have not seen, whatever its signals say.

## Current Algorithms

| id | family | what it optimizes |
|---|---|---|
| `balanced` | quality | control: completion, reactions, freshness, light exploration |
| `completion_first` | quality | boks people finish after starting |
| `reaction_first` | engagement | boks that cause likes, shares and comments quickly |
| `discovery` | exploration | newer and under-tested boks |
| `taste_match` | personal | the reader's behavioral genre and mood affinity |
| `recency` | baseline | newest first, the pre-experiment MVP feed |
| `random_control` | baseline | deterministic shuffle; the floor other arms must clear |

## Experiment Assignment

The traffic split lives in `public.recommendation_experiments` as data, so the
founder changes which algorithms are live from `/admin` without a deploy. Arms
are relative weights; weight `0` parks an arm without deleting it.

Assignment is deterministic on `(experimentKey, visitorId)`, so one tester never
bounces between variants during a study. Assignment is recorded once per reader
in `public.recommendation_assignments`.

Segments (`general`, `new_reader`, `quick_reads`, `deep_reads`) are derived from
the visitor id and used only for breakdowns, never to pick an algorithm.

## Event Contract

Every reader event carries:

- `algorithmId`: assigned recommendation algorithm.
- `experimentKey`: which split produced the assignment.
- `userSegment`: deterministic segment for the visitor.
- `surface`: reader, author, or admin surface.
- `rank`: zero-based story position in the delivered feed.
- `clientElapsedSeconds`: seconds since the current story impression.
- `estimatedSeconds`: estimated reading seconds, needed for the pace index.
- `value`: read seconds for `complete`, otherwise `1`.
- `metadata`: optional JSON for low-volume exploratory fields.

Events are batched in the browser (`components/boks/reader-events.ts`) and
written through `record_recommendation_events`, which stamps `user_id` from the
session. Readers cannot insert or read the event table directly. Guest readers
are real anonymous Supabase users and are measured like everyone else.

## Metrics

Rates are derived in `metrics.ts`, never in SQL, so both backends agree:

- `startRate`: starts / impressions.
- `finishRate`: completions / starts.
- `reactionRate`: (likes + shares + comments) / completions.
- `skipRate`: skips / (starts + skips).
- `avgReadSeconds`, `avgSecondsToLike`, `avgSecondsToComment`, `avgStartRank`.
- `paceIndex`: estimated duration / actual completion seconds. Above `1` means
  faster-than-estimated reading.
- `engagementScore`: weighted completions, reactions and comments minus skips.
- `uplift`: percentage-point and relative change against the control arm, with a
  coarse confidence label from a two-proportion z score (`unclear` below ~1.96).
- `readiness`: impressions collected against `minimumImpressionsPerArm`. An arm
  below its minimum is dimmed in the lab and never named a leader.

## Adding An Algorithm

1. Create `lib/boks/recommendations/strategies/<name>.ts` calling
   `defineStrategy` with an id, name, description, family, segment, and either
   `weights` over the signals above or a custom `score` / `rerank`.
2. Add it to `registeredStrategies` in `strategies/index.ts`.
3. Add a case to `lib/boks/recommendations/feed.test.ts` describing the ordering
   the strategy is supposed to produce.
4. Run `npm test`. Nothing else needs to change: contracts, admin lab, traffic
   split editor and event attribution all read from the registry.
5. Give it traffic in `/admin` -> Recommendation lab -> Traffic split.
6. Let at least `minimumImpressionsPerArm` impressions accumulate before
   comparing it with control.

## Decision Rules

Use `balanced` as control. A new algorithm should beat control on finish rate or
reaction rate without a large skip-rate increase, with a confidence label above
`unclear`. Do not optimize only for likes if average read time collapses or
completion drops. `random_control` exists so "is ranking worth anything" stays a
question with an answer.
