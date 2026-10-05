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

Ranking is TypeScript, not SQL (`docs/adr/0001-ranking-executes-in-worker.md`).
The database returns candidates with their behaviour counters;
`lib/boks/recommendations` scores and orders them, so one strategy
implementation serves every serving path and strategies can be unit-tested with
no database.

```text
lib/boks/recommendations/
  signals.ts           normalized 0..1 story signals (ranking features)
  strategy.ts          the strategy contract and defineStrategy()
  strategies/          one file per algorithm + index.ts registry list
  registry.ts          lookup and display
  experiments.ts       traffic split config and deterministic assignment
  feed.ts              buildReaderFeed(): the one seam every serving path ranks through
  metrics.ts           the lab report: arm summaries, comparisons, readiness
  divergence.ts        do the algorithms even produce different feeds?
  index.ts             public surface
lib/recsys/
  aggregate/           event rows -> one row per reader; the metric catalogue
  statistics/          reader-level comparison, bootstrap, permutation, power
```

Callers:

- Reader feed: the Worker route `app/api/feed/route.ts` calls `serveReaderFeed`
  (`lib/boks/feed-service.ts`), which loads candidates through
  `get_recommendation_candidates` and ranks with `buildReaderFeed`. When the
  Worker is unavailable the browser runs the same `serveReaderFeed` over its
  own transport and the served feed is recorded as degraded.
- Admin lab: `components/boks/admin/recommendation-lab.tsx` loads
  `get_recommendation_lab` and `get_reader_outcomes`, then calls
  `buildRecommendationLab`.

## Story Signals

Every signal is normalized to `0..1`, so a weight means the same thing in every
strategy and strategies stay comparable. Negative weights are penalties.

`startRate`, `finishRate`, `reactionRate`, `likeRate`, `commentRate`,
`shareRate`, `skipRate`, `readDepth`, `popularity`, `freshness`, `exploration`,
`shortness`, `longform`, `tasteMatch`, `novelty`, `fatigue`, `jitter`.

Signals are ranking features, not metrics. The rate-shaped ones divide the
same parts as the reader metrics below (`RATE_PARTS`), so a feature and the
number the lab reports for it never disagree about what it means.

`fatigue` is not a weight. Reading fatigue is a product rule applied in
`feed.ts`: a boks the reader already skipped or finished never outranks one they
have not seen, whatever its signals say. It is applied after a strategy's
`rerank` as well; only a strategy that sets `handlesFatigue: true` (today only
`for_you`, which grades fatigue in its own scoring) is exempt. The reader's
history comes from the server (`bokState`), so it follows the reader across
devices; the browser's own lists only add what the server has not seen yet.

## Current Algorithms

| id | family | what it optimizes |
|---|---|---|
| `for_you` | personal | control and the product ranker: resume, affinity and discovery sources over reader history and semantic taste, then a greedy slate that spaces authors, shapes and lengths |
| `balanced` | quality | completion, reactions, freshness, light exploration |
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
the visitor id and recorded on events. They never pick an algorithm.

A stored assignment that names an algorithm this build no longer registers is
re-attributed to the algorithm that actually ranked (`source: "fallback"`), so
events are never filed under an arm that produced none of them.

## Event Contract

Every reader event carries:

- `algorithmId`: assigned recommendation algorithm.
- `experimentKey`: which split produced the assignment.
- `userSegment`: deterministic segment for the visitor.
- `surface`: reader, author, or admin surface.
- `rank`: zero-based story position in the delivered feed.
- `clientElapsedSeconds`: seconds since the current story impression.
- `estimatedSeconds`: estimated reading seconds from the word count.
- `activeSeconds`, `progress`: foreground reading time and scroll depth.
- `feedId`, `servingBackend`, `labelingVersion`: provenance of the served slate.
- `value`: read seconds for `complete`, otherwise `1`.
- `metadata`: optional JSON for low-volume exploratory fields.

Events are batched in the browser (`components/boks/reader-events.ts`) and
written through `record_recommendation_events`, which stamps `user_id` from the
session. Readers cannot insert or read the event table directly. Guest readers
are real anonymous Supabase users and are measured like everyone else.

## Metrics

The analysis unit is the reader. Event rows are collapsed to one value per
reader per algorithm in `lib/recsys/aggregate`, and readers who produced events
under more than one algorithm are removed from every arm - from the
comparisons and from the arm summaries alike.

Each rate has one definition, `RATE_PARTS` in `lib/recsys/aggregate/metrics.ts`:

- completion rate: completions / starts.
- skip rate: skips / (starts + skips). Most skips happen before a `start` is
  recorded, so skips over starts alone could exceed 100%.
- reaction rate: (likes + shares + comments) / starts.

A reader's rate is computed only when its denominator is at least 5. The lab's
per-arm rates are the same parts pooled over the arm's readers; they describe an
arm and are never the basis of a verdict.

Comparisons (`lib/recsys/statistics/compare.ts`) report one estimand, the
difference in reader means (variant minus control): the effect, a percentile
bootstrap interval of it, a permutation test on the same statistic, and power
simulated with Welch's t on means. An interval spanning zero is
`inconclusive`, never "no difference".

Readiness: an arm is compared once it holds `minimumReadersPerArm` readers
(set in the traffic split editor; stored as `minimum_impressions_per_arm` for
compatibility, but counted in readers). Readiness is per metric, because a
rate leaves out readers below its denominator floor.

There are no composite scores. `engagementScore`, `paceIndex` and the
two-proportion uplift label were removed: they could not be wrong, so they
could not be informative.

## Adding An Algorithm

1. Create `lib/boks/recommendations/strategies/<name>.ts` calling
   `defineStrategy` with an id, name, description, family, and either
   `weights` over the signals above or a custom `score` / `rerank`. A custom
   `rerank` still gets the shared fatigue tiering unless it sets
   `handlesFatigue: true` and grades fatigue itself.
2. Add it to `registeredStrategies` in `strategies/index.ts`.
3. Add a case to `lib/boks/recommendations/feed.test.ts` describing the ordering
   the strategy is supposed to produce.
4. Run `npm test`. Nothing else needs to change: contracts, admin lab, traffic
   split editor and event attribution all read from the registry.
5. Give it traffic in `/admin` -> Recommendation lab -> Traffic split.
6. Run `npm run verify:divergence`: an arm that serves the same top ten as the
   control cannot be told apart from it at any sample size.
7. Let at least `minimumReadersPerArm` readers accumulate in each arm before
   reading a comparison.

## Decision Rules

`for_you` is the control. A new algorithm should beat it on active reading
seconds or boks opened per reader without a worse skip rate, with an interval
that excludes zero. Do not optimize only for likes if reading time collapses or
completion drops. `random_control` exists so "is ranking worth anything" stays a
question with an answer. Before trusting any comparison, check divergence and
the lab's data-quality panel.
