# RECSYS RESEARCH IMPLEMENTATION PLAN

Transforming the boks recommendation stack into a scientifically defensible
experimentation platform, and the technical core of a thesis on
**"Cohort-Aware Behavioral Evaluation and Regression Testing of Sequential
Recommender Systems"**.

Status: **plan only — no code changed.** Written after a full audit of the
repository, the 15 migrations, the live database, the event pipeline and the
9 test files. Where code and documentation disagree, the code is reported as
truth and the discrepancy is listed in §A.6.

Audit date: 2026-09-13. Repository state: 15 migrations, 70 offline unit tests,
57 schema assertions, 9 PostgREST flow tests, all green.

---

## A. CURRENT-STATE AUDIT

### A.1 Architecture as it actually is

```
reader browser
  ├── supabase-browser-data.ts       assembles the feed
  │     ├── get_active_recommendation_experiment()   live split
  │     ├── get_recommendation_candidates(400)       candidates + 60d rollups
  │     ├── record_recommendation_assignment(...)    insert-once, returns stored
  │     └── buildReaderFeed(...)                     RANKING RUNS HERE, IN THE BROWSER
  ├── reader-feed.tsx                emits events
  ├── reader-clock.ts                foreground-only time
  └── reader-events.ts               batching, dedupe, keepalive flush
        └── record_recommendation_events(jsonb)      RPC stamps user_id

admin browser
  └── get_recommendation_lab(days)   raw counters -> metrics.ts -> lab UI
```

`lib/boks/recommendations/` — 1897 lines across 12 files. `feed.ts` (121 lines)
is the single ranking seam; `strategies/index.ts` (33 lines) is the registry.

### A.2 Genuine strengths to preserve

These are load-bearing and must survive the rework:

1. **Ranking is pure TypeScript behind one seam** (`buildReaderFeed`). One
   implementation serves the Supabase path, the D1 path and the unit tests.
2. **A registry, not a switch statement.** Adding an algorithm is one file plus
   one array entry; the id union type, admin UI and attribution derive from it.
3. **Normalized 0..1 signals.** A weight means the same thing in every strategy,
   which makes strategies comparable and a signal reusable.
4. **Deterministic assignment** on `stableHash(experimentKey:subjectId:arm)`.
5. **Assignment is insert-once in the database** (`ON CONFLICT DO NOTHING`), so
   an arm cannot be silently rewritten by a later page load.
6. **Events carry algorithm attribution** and a full context contract.
7. **`activeSeconds` is foreground-only and cumulative with `max()` rollups**,
   which makes the whole ingestion path idempotent under retry and duplication.
8. **A divergence gate already exists** and is already wired into CI-style
   verification (`npm run verify:divergence`).
9. **Four verification layers**: offline unit, schema-on-throwaway-Postgres,
   PostgREST end-to-end, and the divergence gate.

The plan below extends all nine rather than replacing any.

### A.3 Validity problems (blocking, in severity order)

**V1 — The analysis unit is the impression, not the reader.**
`metrics.ts:proportionConfidence` gates on 30 *impressions*. Events from one
reader are correlated; 100 impressions from 3 readers is not n=100. This is
textbook pseudo-replication. Confidence labels were pulled from the UI, but the
arithmetic is still computed and still exported.

**V2 — Between-reader experiments are underpowered at this scale.**
Measured by simulation (CV ≈ 0.95 on per-reader reading time, 4000 trials):

| lift | n=12/arm | n=25/arm | n=50/arm | n=100/arm |
|---|---|---|---|---|
| +20% | 6% | 9% | 15% | 25% |
| +30% | 10% | 15% | 26% | 48% |
| +50% | 17% | 33% | 55% | 84% |
| +80% | 32% | 58% | 86% | 99% |

Paired within-reader reaches 77% power at n=25 for +30%. At ~50 active readers,
only a within-reader design can resolve a realistic effect.

**V3 — No feed provenance.** Nothing persists what was actually served. The
ranking runs in the browser; only the resulting events are stored, carrying
`algorithm_id` and `rank`. A served feed cannot be reconstructed, so no result
is reproducible in the sense a thesis requires.

**V4 — An invisible data split.** Added 2026-09-13 in `use-boks-data.ts`: if the
Supabase reader path throws, the reader silently falls back to the legacy
`/api/boks` (D1) endpoint. Their events then land in D1, the arm is recomputed
locally with no stored assignment, and they never appear in the admin
data-quality tile. A visible failure was converted into an invisible one.

**V5 — Segments are a hash, presented as reader types.**
`inferUserSegment` buckets `stableHash(subjectId:segment) % 100`. These are
random labels. They appear in breakdowns and in `strategy.segment` metadata.
They must never be used as cohorts.

**V6 — Personalization lives in `localStorage`.** `tasteMatch` and reading
fatigue come from the browser profile (`profileBump`, weights +3 complete /
+4 like / −2 skip, capped at 120/120/160 ids). The arm is per Supabase account,
the memory is per device. The same reader gets different recommendations on two
devices, and the server cannot reproduce either.

**V7 — Ranking is point-wise with no slate objective.** Each candidate is scored
independently. No diversity control, no MMR, no session-level constraint.

**V8 — Nothing learns.** All weights are hand-written constants. `exploration`
is `1 - impressions/12`, not an exploration policy with any guarantee.

### A.4 Two structural findings from the live catalog

These were measured today and materially change the ordering of work.

**F1 — The catalog has no length variance.** 39 published boks, word counts
68–167, and **`minutes = 1` for every single one**. Therefore `shortness` = 1.0
and `longform` = 0.0 for every candidate. Two of the seventeen signals are
constants, and `completion_first`'s `longform` weight is inert. Any experiment
that turns on text length cannot currently produce a difference.

**F2 — Only 5 of 39 boks carry any behaviour.** 34 have zero impressions. For
those, nine signals (`startRate`, `finishRate`, `reactionRate`, `likeRate`,
`commentRate`, `shareRate`, `skipRate`, `readDepth`, `popularity`) are 0 and
`exploration` is pinned at 1.0. The only signals that vary across the bulk of
the catalog are `freshness`, `jitter`, `tasteMatch` and `novelty`.

This explains today's divergence reading:

```
catalog: 39 published boks
arms:    balanced, recency
overlap of top 10: 70%   tau 0.29   verdict: WEAK
```

`balanced`'s discriminating terms collapse to `freshness`(6) + `jitter`(5),
and `recency` is `freshness`(100). They converge **because there is no data**,
not because the weights are similar. Earlier measurement on an 85-bok catalog
*with* behaviour showed the same pair at 20% overlap.

**Consequence for the design:** the divergence gate currently cannot distinguish
*"these strategies are identical by construction"* from *"there is no signal for
them to differ on"*. Those two diagnoses require opposite remedies — change the
arms, versus collect data / use informative priors. §L Phase 2 extends the gate
to report which case it is observing.

### A.5 Technical debt and data-quality risks

| item | risk |
|---|---|
| `metrics.ts` still computes `engagementScore`, `paceIndex`, `avgSecondsToLike`, `avgSecondsToComment`, `avgStartRank`, `segmentRows`, `timeline` — rendered nowhere | dead code that looks authoritative; `paceIndex` divides a clamped estimate by wall-clock |
| `fatigue` is a declared signal weighted by no strategy | its 0.5/0.8 distinction is collapsed by the tier sort and has no effect |
| `addCounters` merges `visitors` with `Math.max` across days | a lower bound presented as a count |
| candidate set bounded at 400 boks / 60 days, aggregated live per feed load | fine now; the first query to become expensive |
| two of fifteen migrations (the 2026-09-13 catalog expansions) were not applied to the local stack until this audit | environment drift between file state and running database |
| D1 path frozen but still reachable via V4 | two instrumentation regimes, unlabelled |

### A.6 Discrepancies between code and documentation

Required by the operating principles. Code is truth.

| doc claim | reality |
|---|---|
| `specs/boks-recommendation-experiments.md` §Metrics lists `paceIndex`, time-to-like, average start rank as live metrics | computed but removed from the UI; `paceIndex` is uninterpretable |
| the same spec presents the measurement layer as reader-appropriate | `metrics.ts` aggregates events, not readers (V1) |
| the spec lists `fatigue` among the signals strategies score against | no strategy weights it |
| no document mentions the Supabase→D1 fallback | it exists and is silent (V4) |
| `docs/admin-metrics.md` describes segments as a breakdown dimension without qualification in the Experiments table | they are hash buckets; the limitation is stated only in the "Known limits" section |
| `docs/handover/...-metrics-and-experiment-validity.md` states the catalog is the binding constraint at 5 boks | catalog is now 39; the constraint has moved to *behavioural sparsity* and *length homogeneity* (F1, F2) |

All six are corrected in the documentation deliverables of §L.

---

## B. GAP ANALYSIS

Priority: **P0** blocking scientific validity · **P1** required for the thesis ·
**P2** valuable · **P3** deferred. Complexity: S/M/L. Migration risk: how much
existing data or behaviour is disturbed.

| § | Requirement | Current state | Missing | Proposed | Pri | Cx | Risk |
|---|---|---|---|---|---|---|---|
| 4 | Reader-level analysis | event-level only | everything | `get_reader_outcomes` RPC + `lib/recsys/aggregate` | P0 | M | low |
| 5 | Valid statistics | two-proportion z on impressions | bootstrap, permutation, effect sizes, insufficient-data state, power tools | `lib/recsys/statistics` | P0 | M | none |
| 6 | Interleaving | none | team-draft, credit rules, provenance | `interleaving/` + schema | P0 | L | medium |
| 7 | Feed reproducibility | none | served-feed persistence | `served_feed` + `served_feed_item` | P0 | M | low |
| 8 | Fallback corruption | silent D1 split | labelling or elimination | canonical telemetry + `serving_backend` | P0 | S | low |
| 9 | Durable reader profile | localStorage only | server-derived profile | `reader_profile` derived from events | P1 | M | medium |
| 10 | Behavioral cohorts | hash segments | real, versioned, leakage-safe cohorts | `cohorts/` + `reader_cohort` table | P0 | M | low |
| 11 | Offline evaluation | none | temporal splits, config-driven runs, artifacts | `research/` harness | P1 | L | none |
| 12 | Dataset adapters | none | common contract + 2 public datasets | `research/adapters/` | P1 | M | none |
| 13 | Metric taxonomy | partial, one composite | ranking metrics, beyond-accuracy, cohort robustness | `lib/recsys/metrics` | P1 | M | low |
| 14 | Literary-domain metrics | none | graded relevance, item similarity | `research/relevance/` | P2 | M | none |
| 15 | Recommender families | 7 heuristics | smoothing, content-based, collaborative, sequential | staged, §L Phase 5 | P1 | L | low |
| 16 | Two-stage ranking | point-wise only | slate reranker | `rerank/` behind `feed.ts` | P1 | M | low |
| 17 | Cold start | accidental | explicit policies + own cohort | `models/cold-start` | P1 | S | low |
| 18 | Exploration | `1 - impressions/12` | explicit policy, logged, measurable | `policy/exploration` | P2 | M | low |
| 19 | Behavioral regression tests | none | declarative expectations, PASS/FAIL/INCONCLUSIVE | `regression-tests/` | P1 | M | none |
| 20 | Divergence | exists, top-K + tau | exposure/genre divergence, per-cohort, cause attribution | extend `divergence.ts` | P1 | S | none |
| 21 | Experiment lifecycle | config row, mutable | state machine, freeze, versioning | `experiment_version` table | P1 | M | medium |
| 22 | Primary vs secondary metrics | none | declared at launch, frozen | part of experiment version | P1 | S | low |
| 23 | Normalized reading outcome | fixed 238 wpm rule | versioned labelling, sensitivity analysis | `labeling_version` on events | P1 | S | medium |
| 24 | Offline/online separation | conflated in docs | explicit, compared | documentation + report | P1 | S | none |
| 25 | Reproducibility | none | commands + artifacts | `npm run recsys:*` | P1 | M | none |
| 26 | Tests | 70 offline + 57 schema + 9 flow | leakage, splits, interleaving, estimators, invariants | extend all suites | P0 | M | none |
| 27 | Operator UI | partly rebuilt | cohorts, beyond-accuracy, power, divergence sections | rebuild lab | P1 | M | low |
| 28 | Privacy/ethics | implicit | documented policy, pseudonymous exports | `docs/research-ethics.md` | P1 | S | none |
| 29 | Literature review | none | full review + novelty boundary | `docs/thesis/literature-review.md` | P1 | L | none |
| 30 | Experiment matrix | none | Levels A/B/C | `docs/thesis/experiment-plan.md` | P1 | M | none |
| 31 | Ablations | none | 9 named ablations | part of Level A/B | P2 | M | none |
| 34 | Server vs client ranking | browser | decision + ADR | see §L Phase 1, ADR-001 | P0 | M | **high** |
| 35 | Rollups | live aggregation | rebuildable derived tables | deferred, §N | P3 | M | low |

---

## C. TARGET ARCHITECTURE

The thirteen conceptual layers, mapped onto modules. The rule is that no module
spans two layers, and the four research-critical layers are pure functions.

```
                        ┌──────────────────────── shared, pure, no IO ─────────┐
 Instrumentation        │                                                      │
   reader-clock.ts      │  lib/recsys/                                         │
   reader-events.ts     │    metrics/       ranking + behavioural + beyond-acc │
   contracts.ts         │    statistics/    bootstrap, permutation, power      │
        │               │    cohorts/       versioned, leakage-safe definitions│
        ▼               │    aggregate/     event rows -> reader rows          │
 Candidate Generation   │    relevance/     graded / semantic similarity       │
   candidates/          └──────────────────────────────────────────────────────┘
        │                        ▲                              ▲
        ▼                        │ imported by both             │
 Ranking Model                   │                              │
   models/  (Recommender iface)  │                              │
        │                        │                              │
        ▼                        │                              │
 Slate Re-ranking                │                              │
   rerank/  (MMR, constraints)   │                              │
        │                        │                              │
        ▼                        │                              │
 Experiment Policy ──────────────┤                    research/ (Node only,
   experiments/                  │                      not in the Worker bundle)
   interleaving/                 │                        adapters/  boks, ml25m, …
        │                        │                        splits/    temporal
        ▼                        │                        runner/    config -> artifacts
 Feed Delivery                   │                        report/    tables, figures
   Worker /api/feed  ────────────┘
   + provenance write
        │
        ▼
 Interaction Logging     record_recommendation_events
        │
        ▼
 Reader Aggregation      get_reader_outcomes
        │
        ▼
 Cohort Engine           reader_cohort (versioned, computed from history < T)
        │
        ▼
 Metric Engine           lib/recsys/metrics
        │
        ▼
 Statistical Comparison  lib/recsys/statistics
        │
        ▼
 Regression Tests        regression-tests/
        │
        ▼
 Report                  admin lab  +  research/report artifacts
```

Two invariants this diagram encodes:

- **One definition of every metric.** `lib/recsys/metrics` is imported by both
  the production lab and the offline harness. nDCG cannot mean two things.
- **`research/` never enters the Worker bundle.** It is Node-only, may use heavy
  dependencies, and reads exported snapshots rather than the live database.

---

## D. PROPOSED DATABASE SCHEMA CHANGES

All additive. No destructive migration is proposed in Phases 1–3.

### D.1 Feed provenance (Phase 1)

```sql
create table public.served_feed (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  session_id            text not null,
  served_at             timestamptz not null default now(),
  experiment_key        text not null,
  experiment_version    integer not null,
  experiment_mode       text not null check (experiment_mode in ('single','interleaved')),
  algorithm_id          text,            -- single mode
  algorithm_a_id        text,            -- interleaved mode
  algorithm_b_id        text,
  assignment_source     text not null check (assignment_source in ('assigned','requested','fallback')),
  candidate_request_id  uuid not null,   -- identifies the candidate set
  candidate_count       integer not null,
  catalog_size          integer not null,
  serving_backend       text not null check (serving_backend in ('worker','browser','d1_fallback')),
  degraded_mode         boolean not null default false,
  fallback_reason       text,
  signals_version       text not null,
  ranking_version       text not null,
  labeling_version      text not null,
  profile_snapshot      jsonb not null default '{}'::jsonb,  -- reader signals used
  seed                  text not null,
  build_id              text
);

create table public.served_feed_item (
  feed_id             uuid not null references public.served_feed(id) on delete cascade,
  reel_id             uuid not null references public.reels(id) on delete cascade,
  delivered_rank      integer not null,
  score               numeric(12,4),
  source_ranker_id    text,      -- interleaving: which ranker drafted it
  source_rank         integer,   -- its rank in that ranker's own list
  credited_algorithm_id text,    -- who gets credit for outcomes on this slot
  primary key (feed_id, delivered_rank)
);
```

`recommendation_events` gains `feed_id uuid`, `serving_backend text`,
`labeling_version text`, `credited_algorithm_id text`.

Rationale for storing the slate rather than recomputing it: recomputation
requires the exact candidate set *and* the exact reader profile at serve time.
Both are mutable. Storing ~20 rows per feed is cheap at this scale and removes
an entire class of "we think it would have ranked this way" argument.

### D.2 Experiment versioning (Phase 2)

```sql
create table public.experiment_version (
  experiment_key       text not null,
  version              integer not null,
  state                text not null check (state in
                        ('draft','validated','ready','running','paused','completed','analyzed')),
  arms                 jsonb not null,
  control_algorithm_id text not null,
  mode                 text not null,
  primary_metric       text not null,
  secondary_metrics    jsonb not null default '[]'::jsonb,
  guardrail_metrics    jsonb not null default '[]'::jsonb,
  cohort_version       text not null,
  minimum_readers_per_arm integer not null,
  power_analysis       jsonb,
  divergence_report    jsonb,
  config_hash          text not null,
  started_at           timestamptz,
  ended_at             timestamptz,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id),
  primary key (experiment_key, version)
);
```

`recommendation_experiments` keeps pointing at the active `(key, version)`.
A running version is immutable; a change creates a new version.

### D.3 Cohorts (Phase 3)

```sql
create table public.reader_cohort (
  cohort_version  text not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  window_start    timestamptz not null,   -- cohort computed from history < this
  cohort_id       text not null,
  computed_at     timestamptz not null default now(),
  features        jsonb not null default '{}'::jsonb,
  primary key (cohort_version, user_id, window_start, cohort_id)
);
```

Membership is **materialised per window**, not computed at read time. That is
what makes leakage-safety auditable: the row records the window it was derived
from, and a test asserts that no event after `window_start` contributed.

Overlapping cohorts are supported by the composite key (a reader may hold
several `cohort_id`s in one window).

### D.4 Durable reader profile (Phase 5)

```sql
create table public.reader_profile (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  profile_version  text not null,
  derived_at       timestamptz not null,
  genre_affinity   jsonb not null default '{}'::jsonb,
  mood_affinity    jsonb not null default '{}'::jsonb,
  seen_reel_ids    uuid[] not null default '{}',
  completed_reel_ids uuid[] not null default '{}',
  liked_reel_ids   uuid[] not null default '{}',
  skipped_reel_ids uuid[] not null default '{}',
  reads            integer not null default 0,
  completions      integer not null default 0,
  active_seconds   integer not null default 0
);
```

**Derived, never authoritative.** A rebuild job recomputes it from
`recommendation_events`. The browser may cache it for latency; the server never
trusts the cache.

---

## E. EVENT AND PROVENANCE SCHEMA

Additions to `ReaderEvent`:

```ts
feedId: string;                 // ties the event to the exact served slate
servingBackend: "worker" | "browser" | "d1_fallback";
labelingVersion: string;        // which read/skip rule produced this verdict
creditedAlgorithmId?: string;   // interleaving; equals algorithmId in single mode
```

Rules:

1. Every reader event **must** carry a `feedId` that exists in `served_feed`, or
   it is counted as unattributed and excluded from experiment analysis while
   remaining visible in data quality. This is the invariant that makes V3 and V4
   detectable rather than silent.
2. `labelingVersion` is stamped at write time. Changing the read/skip rule mints
   a new version; historical verdicts are never reinterpreted in place.
3. Degraded traffic is **ingested, labelled, and excluded by default** — never
   dropped.

Data-quality checks to implement (§8 of the brief), each as a SQL assertion in
`scripts/local-supabase/checks.sql` and a panel in the admin console:

assignment without events · events without assignment · event
`algorithm_id` disagreeing with its `served_feed` · `delivered_rank` outside the
served slate · event without `feed_id` · duplicate outcome for one
`(session, reel)` · unexpected `serving_backend` · `feed_id` with no items ·
session id changing mid-feed · `created_at` before `served_at` ·
impressions/starts ratio outside plausible bounds · `active_seconds` at the
120 s clamp.

---

## F. PROPOSED RECOMMENDER INTERFACE

The current `RecommendationStrategy` is close but assumes a signal-weighted
scorer and carries no version. The target keeps the existing strategies working
unchanged through an adapter.

```ts
export interface Recommender {
  readonly id: string;
  readonly version: string;          // bumped when behaviour changes
  readonly family: RecommenderFamily;
  readonly requires: RecommenderRequirements;  // profile? embeddings? training?

  rank(context: RankingContext, candidates: StoryCandidate[]): RankedCandidate[];
}

export interface RankingContext {
  subjectId: string;
  now: Date;
  profile: ReaderProfile;            // server-derived, versioned
  limit: number;
  seed: string;
  coldStart: boolean;
}

export interface RankedCandidate {
  candidate: StoryCandidate;
  score: number;
  rank: number;
  explanation?: Record<string, number>;   // signal contributions, for debugging
}
```

All seven existing strategies are wrapped by
`fromSignalStrategy(strategy): Recommender` — no strategy file changes in
Phase 1. Learned models add `artifactUri` and `trainedAt` and are loaded by
version.

`explanation` is optional but strongly recommended: the current system cannot
answer "why was this ranked first", which will be asked at a thesis defence.

---

## G. PROPOSED COHORT MODEL

A cohort is a **behavioural description derived from history strictly before the
evaluation window**. Six to start — deliberately few, because at 50 readers
thirty cohorts would all be empty.

| cohort_id | definition (history before window_start) |
|---|---|
| `cold_start` | fewer than 3 completed boks |
| `low_history` | 3–9 completed |
| `established` | 10–29 completed |
| `heavy_reader` | 30+ completed |
| `high_completion` | completion rate ≥ 0.6 with ≥ 5 starts |
| `frequent_skipper` | completion rate ≤ 0.3 with ≥ 5 starts |
| `explorer` | ≥ 4 distinct genres among completed |
| `specialist` | ≥ 60% of completions in one genre, ≥ 5 completions |

Activity cohorts are mutually exclusive; behaviour and breadth cohorts overlap
with them by design.

Deliberately **not** included yet: popularity orientation and length preference.
Popularity orientation needs a stable item-popularity distribution, which F2 says
does not exist yet. Length preference is impossible — F1 shows every bok is
1 minute, so the dimension has no variance.

Rules:

- `cohortVersion` is a string; definitions are frozen per version.
- Membership is materialised into `reader_cohort` with the `window_start` it was
  derived from.
- A cohort with fewer than `minimumReaders` (default 10) is reported as
  `exploratory` and never used for a PASS/FAIL regression verdict.
- Every cohort reports unique readers, share of population, and metric
  uncertainty.
- **Leakage test**: a property test rebuilds each cohort with all events after
  `window_start` deleted and asserts identical membership.

Data-driven cohort discovery (clustering behavioural vectors) is specified as an
optional Level-B thesis extension, not built in the first pass — with 50 readers
a clustering result would be noise. On benchmark datasets it is meaningful, and
the comparison "handcrafted vs discovered" becomes a genuine RQ2 contribution.

---

## H. PROPOSED OFFLINE EVALUATION PROTOCOL

Config-driven, artifact-producing, no hidden defaults.

```yaml
experiment: cohort-sensitivity-ml25m
dataset:
  adapter: movielens-25m
  snapshot: sha256:...
split:
  type: global_temporal        # | per_user_temporal | rolling
  train_end: "2019-01-01"
  validation_end: "2019-02-01"
  test_end: "2019-03-01"
candidates:
  policy: full_catalog         # | sampled_negatives:100
  filter_seen: true
cohorts:
  version: v1
  window: train_end            # cohorts derived from history before this
  minimum_readers: 30
models:
  - random
  - popularity
  - popularity_smoothed
  - content_knn
  - implicit_mf
  - markov_transition
metrics:
  ranking: [recall@10, ndcg@10, mrr, hitrate@10]
  beyond_accuracy: [coverage, intra_list_diversity, novelty, gini_exposure]
statistics:
  method: bootstrap
  samples: 2000
  paired: true
  confidence: 0.95
seed: 42
```

Protocol rules:

1. **Temporal splitting is the default.** Random interaction splitting is
   available only as an explicitly named ablation, because it leaks future
   information into sequential prediction.
2. **Candidate sampling is declared**, never implicit. Sampled-negative
   evaluation is known to distort model ranking; if used, it is reported as a
   named policy and compared against full-catalog in an ablation.
3. **Cohorts are computed at `split.cohorts.window`**, which must be ≤
   `train_end`. The runner refuses a config where it is not.
4. **Aggregation is per reader first**, then across readers, matching the online
   path. The same `lib/recsys/aggregate` code is used.
5. Every run writes an artifact directory; nothing is reported from a notebook.

```
artifacts/<experiment>/<run-id>/
  config.resolved.yaml      after defaults applied
  environment.json          git commit, package versions, node version, seed
  dataset-summary.json      users, items, interactions, density, date range, hash
  metrics.json              global
  cohort-metrics.json       per cohort, with support and CI
  statistical-tests.json    estimator, effect, CI, n, paired?
  regression-report.json    PASS / FAIL / INCONCLUSIVE per expectation
  figures/
  README.md                 generated summary
```

---

## I. PROPOSED INTERLEAVING PROTOCOL

**Team Draft Interleaving**, chosen over balanced interleaving because credit
assignment is unambiguous and the randomisation is trivially reproducible.

Why interleaving and not crossover: a bok is consumable. A reader cannot unread
a story, so there is no washout period, and the arm that runs first depletes the
best material for the arm that runs second by an amount that cannot be measured.
Interleaving compares both rankers **within the same session, over the same
candidate pool, at the same instant**, so depletion, reader heterogeneity, time
of day and catalog state cancel exactly.

### Algorithm

```
inputs:  rankings A, B over the same candidate set; slate size k;
         seed = hash(feedId)              // reproducible, per-feed
teamA = [], teamB = [], slate = []
while |slate| < k:
    first = coinflip(seed, round)          // which team drafts first this round
    for team in (first, other):
        pick highest-ranked item from that team's list not already in slate
        append to slate with source_ranker_id = team
        append to that team's roster
```

`credited_algorithm_id = source_ranker_id` — credit follows the team that
drafted the slot, which is what makes team-draft unbiased with respect to
position: each team fills alternating positions in expectation.

### Credit rules, defined separately per outcome

| outcome | credited when |
|---|---|
| `start` | reader begins the boks in that slot |
| `meaningful_read` | `activeSeconds ≥ 0.4 × expected` on that slot |
| `complete` | verdict `complete` on that slot |
| `positive_reaction` | like, comment or share on that slot |

These are **not** assumed equivalent and are reported separately. The primary
interleaving outcome for boks is `meaningful_read`, because it is the one that
reflects reading rather than clicking — declared per experiment version, not
hard-coded.

### Analysis

Per reader, per session: `creditA`, `creditB`. The per-reader preference is
`creditA / (creditA + creditB)`, sessions with zero credit excluded. Compared
against 0.5 with a **paired bootstrap over readers** and a sign test as a
distribution-free companion. Reported with reader count, session count, and an
explicit `insufficient_data` state below the configured minimum.

### Constraints

- exactly two rankers per interleaved experiment;
- no duplicate items in a slate;
- an item both rankers would pick goes to whichever drafts first that round, and
  the other team draws its next distinct choice — recorded in `source_rank` so
  the situation is auditable;
- the fatigue tier is applied **once, after interleaving**, so neither ranker is
  advantaged by the product rule;
- if either ranker returns fewer than `k/2` items the feed degrades to single
  mode and is labelled `degraded_mode = true`.

---

## J. PROPOSED STATISTICS

A pure module, `lib/recsys/statistics`, with no IO and full unit coverage.

| estimator | when |
|---|---|
| reader-level bootstrap CI (percentile, BCa where n permits) | independent two-arm comparison |
| **paired** bootstrap over readers | interleaving, before/after |
| permutation test on arm labels | primary p-value-shaped quantity at n < 30, where bootstrap CIs undercover on skewed data |
| sign test / Wilcoxon | interleaving preference, distribution-free companion |
| Hodges–Lehmann shift | robust effect size on skewed reading time |

Every comparison returns a single structure, and the UI cannot render a subset:

```ts
type ComparisonResult = {
  metric: string;
  design: "independent" | "paired" | "interleaved";
  analysisUnit: "reader" | "session";
  estimator: string;
  effect: number;
  effectKind: "absolute" | "relative" | "shift";
  ci: [number, number];
  confidence: number;
  readers: number;
  sessions: number;
  denominator: number;
  status: "positive" | "negative" | "inconclusive" | "insufficient_data";
  minimumReaders: number;
  power?: PowerEstimate;
};
```

Rules encoded in the type and enforced by tests:

- `insufficient_data` when `readers < minimumReaders`. The UI has no branch that
  can hide it.
- `inconclusive` when the CI spans the null. **Never rendered as "no
  difference"** — copy is asserted in a test.
- Rate metrics declare their analysis unit. `total_completes / total_starts`
  and `mean_i(completes_i / starts_i)` are separate metric ids, never silently
  interchanged.

Power analysis (`lib/recsys/statistics/power.ts`) exposes a simulation-based
estimator reusing the measured CV ≈ 0.95, so an operator can ask *"given 40
readers and a 30% target effect, what power do we have?"* before launching. Its
unit test asserts reproduction of the measured power table in §A.3 — there is
ground truth to check against.

---

## K. THESIS EXPERIMENT MATRIX

**Level A — synthetic validation (does the framework detect what it claims?)**

Generate populations with a known planted structure, then verify detection:

| A1 | Model X globally better, worse for one known subgroup | cohort analysis flags the subgroup; global analysis does not |
| A2 | Model X higher nDCG, lower diversity | beyond-accuracy metrics separate them; accuracy alone does not |
| A3 | Model X advantaged only by temporal leakage | random split ranks it first; temporal split does not |
| A4 | Two models differing trivially | divergence gate refuses the experiment |
| A5 | Effect present but sample too small | status is `insufficient_data`, never a winner |

A5 is the one that validates the honesty of the pipeline, and is the easiest to
get wrong.

**Level B — public benchmarks (do cohort conclusions differ from global?)**

Models: random, popularity, popularity-smoothed, content-kNN, implicit MF,
Markov transition, one sequential model. Measured globally, per cohort, and on
beyond-accuracy properties. Primary output: **rank-correlation between global
model ranking and per-cohort model ranking** — the direct answer to RQ1.
Repeated across temporal splits, seeds, catalog subsamples and minimum-support
thresholds for RQ3.

Dataset candidates, **pending licence verification in Phase 4**: MovieLens-25M
(timestamps, sequential, widely used, redistribution restricted — verify),
Goodbooks-10k (reading domain, closest to boks), and one impression-bearing feed
dataset if licensing permits. No conclusion may rest on a single benchmark.

**Level C — boks production case study**

Pairwise interleaving, not multi-arm A/B. Reports real reading outcomes with
honest uncertainty. **An inconclusive result here is a valid thesis result** and
must be presented as one; §32 of the brief forbids manufacturing significance.

---

## L. PHASED IMPLEMENTATION PLAN

Each phase ships independently, keeps all existing gates green, and ends with a
verification report. Phases 1–3 must be trustworthy before Phase 5 begins.

### Phase 0 — Audit (this document)

Done. Findings in §A. Two migrations were found unapplied locally and have been
applied; catalog is 39 boks, divergence verdict WEAK at 70%.

### Phase 1 — Measurement correctness (P0)

**Done, 2026-09-13.** Report: `docs/handover/2026-09-13-phase-1-measurement-correctness.md`.
Exit criteria met: every served feed is reconstructible from `served_feed` +
`served_feed_item`; every comparison is reader-level; `insufficient_data` is
reachable and shown; the §A.3 power table is reproduced by
`lib/recsys/statistics/power.test.ts` to within 4 points. Gates: lint clean,
typecheck clean, 121 unit tests, 75 schema checks over 16 migrations, 9 PostgREST
flow tests, build green, and `/api/feed` exercised end to end against the local
stack (provenance written; a rejected token returns 401 rather than a degraded
feed).

One deviation from the plan as written, recorded in ADR-001: item 1 proposed
shipping behind a flag and running both paths in parallel to assert identical
slates. With no deployed users a shadow run buys nothing, so equivalence is
asserted as a unit test instead — `lib/boks/feed-service.test.ts` requires the
Worker and browser paths to produce an identical slate for identical inputs.
That runs on every commit rather than on sampled traffic.

1. **ADR-001: where ranking executes.** Recommendation: move canonical feed
   assembly to the Worker (`/api/feed`), keep the ranking functions pure and
   shared and unchanged. Rationale: provenance must be written by the server, or
   it is a client claim; it also collapses V4 into one canonical path. Cost: one
   round trip, and the Worker must forward the reader's JWT to Supabase.
   Mitigation: ship behind a flag, run both paths in parallel for a period and
   assert identical slates before switching.
2. `served_feed` + `served_feed_item`; `feed_id` on events; `serving_backend`,
   `degraded_mode`, `fallback_reason`.
3. Eliminate V4: degraded requests are labelled and ingested into the canonical
   store, never silently rerouted into a second instrumentation regime.
4. `get_reader_outcomes(from, to, experiment_key)` — one row per
   (reader, arm, day).
5. `lib/recsys/aggregate` and `lib/recsys/statistics`. Rewrite `metrics.ts` onto
   reader rows; delete `engagementScore`, `paceIndex`, `avgSecondsToLike`,
   `avgSecondsToComment`, `avgStartRank`, `segmentRows`, `timeline`,
   `proportionConfidence`, `findLeaders`.
6. Data-quality checks from §E, in `checks.sql` and the admin console.

Exit: every served feed is reconstructible; every comparison is reader-level;
`insufficient_data` is reachable and visible; power table reproduced by test.

### Phase 2 — Experiment methodology (P0/P1)

`experiment_version` and the state machine; primary/secondary/guardrail metrics
declared and frozen at launch; power analysis required before `ready`; divergence
extended to exposure and genre/mood divergence, per-cohort divergence, and
**cause attribution** (F2: distinguishing "identical strategies" from "no signal
to differ on"); team-draft interleaving end to end with credit rules.

Exit: an experiment cannot reach `running` without passing the divergence gate
and recording a power estimate; interleaving works end to end.

### Phase 3 — Cohort-aware evaluation (P0)

`reader_cohort`, the eight v1 definitions, leakage property test, cohort metrics
with support and CI, worst-cohort and cohort-gap measures, and the declarative
regression-test framework with PASS/FAIL/**INCONCLUSIVE**. Hash segments removed
from all analysis paths (retained only as a legacy field, marked deprecated).

Exit: RQ1 is answerable on boks data, however thin; a regression test can fail a
cohort without failing globally.

### Phase 4 — Offline research framework (P1)

`research/` harness: dataset contract, adapters (boks export + 2 public
datasets after licence verification), temporal splitters, config runner,
artifact writer, figure/table generation. Shares `lib/recsys/*` so metric
definitions cannot drift between offline and online.

Exit: `npm run recsys:benchmark -- --config ...` reproduces a result set from a
clean checkout.

### Phase 5 — Recommender quality (P1)

Beta-Binomial smoothing for item quality (directly addresses F2: with 34 of 39
boks having no data, unsmoothed rates are 0 and the ranking degenerates);
durable `reader_profile` derived from events; content-based recommender with
embeddings; explicit cold-start policy as its own cohort; implicit-MF and
Markov baselines for offline research; sequential model on benchmark data only.

### Phase 6 — Slate and session optimisation (P1)

MMR / constrained greedy reranker behind `feed.ts`; session constraints
(consecutive genre/mood, author repetition); beyond-accuracy metrics wired into
both online and offline paths; λ exposed as an experiment parameter, never
hard-coded.

### Phase 7 — Thesis experiments (P1)

Levels A, B, C; the nine ablations of §31; machine-generated tables and figures;
literature review and novelty boundary; methodology and experiment-plan
documents.

---

## M. FILES AND MODULES EXPECTED TO CHANGE

**New**

```
lib/recsys/{metrics,statistics,cohorts,aggregate,relevance}/
lib/boks/recommendations/{candidates,models,rerank,interleaving,provenance}/
research/{adapters,splits,runner,report,configs}/
regression-tests/
supabase/migrations/  ~6 new migrations
docs/adr/ADR-001..00N
docs/thesis/{literature-review,methodology,experiment-plan,novelty-boundary}.md
docs/{event-taxonomy,recommender-interface,experiment-design,interleaving,
      cohorts,metric-catalog,statistics,offline-evaluation,data-quality,
      research-reproducibility,research-ethics,migration-guide}.md
RECSYS-RESEARCH-IMPLEMENTATION-PLAN.md  (this file)
```

**Modified**

```
lib/boks/recommendations/{feed,experiments,metrics,divergence,registry,strategy}.ts
lib/boks/contracts.ts                    event contract additions
components/boks/supabase-browser-data.ts feed assembly moves to the Worker
components/boks/use-boks-data.ts         remove the silent fallback (V4)
components/boks/reader-behavior.ts       profile becomes a server-derived cache
components/boks/admin/recommendation-lab.tsx  rebuilt around §27
app/api/                                 new /api/feed route
scripts/local-supabase/checks.sql        data-quality and leakage assertions
specs/boks-recommendation-experiments.md corrected per §A.6
docs/admin-metrics.md                    cohort and beyond-accuracy entries
package.json                             recsys:* commands
```

**Deliberately untouched in Phases 1–3**

The seven strategy files, `signals.ts`, `reader-clock.ts`, `reader-events.ts`.
They are correct and load-bearing; changing them during a measurement rework
would confound the very comparison being built.

---

## N. WHAT SHOULD DELIBERATELY NOT BE BUILT YET

| not building | why | revisit when |
|---|---|---|
| Contextual bandit | propensity logging, reward definition and off-policy evaluation must be correct first; a bandit on a 39-bok catalog optimises noise | after Phase 5, if catalog and traffic justify it |
| SASRec / deep sequential in production | training on 39 items and ~50 readers is not scientifically useful; benchmark-only | benchmark now, production never at this scale |
| LLM user simulator | not ground truth; would undermine the honesty the rest of the plan buys | not planned |
| Data-driven cohort discovery on boks | clustering 50 readers yields noise | Level B benchmarks in Phase 7 |
| Materialised metric rollups | live aggregation is bounded at 400 boks / 60 days and is not yet slow | when a lab query exceeds ~1 s |
| Collaborative filtering in production | 34 of 39 boks have no interactions; there is nothing to collaborate on | when item coverage exceeds ~50% |
| Length-preference cohorts and `shortness`/`longform` experiments | F1: every bok is 1 minute, both signals are constants | when the catalog has genuine length variance |
| Popularity-orientation cohorts | F2: no stable popularity distribution exists yet | when most items carry interactions |
| Fairness framing of cohort gaps | "fairness" requires a defined normative criterion; without one this is a subgroup-robustness result | only if a criterion is defined and defended |
| Any novelty claim | forbidden before the literature review | after Phase 7 review vs RecList, Elliot, DaisyRec, RecBole |

---

## Open decisions requiring input

1. **ADR-001, server-side ranking.** Highest-risk change in the plan. It is the
   right call for reproducibility but adds a round trip to every feed load and
   requires JWT forwarding. The alternative — keep browser ranking, persist the
   slate as a client claim, verify server-side by recomputation — is cheaper and
   weaker. Recommendation: move to the Worker, behind a parallel-run flag.
2. **Thesis scope boundary.** The full plan is large. Levels A and B alone can
   carry a thesis; Level C adds a real-world case study but its outcome may
   legitimately be inconclusive at 50 readers. Recommendation: commit to A + B,
   treat C as a case study whose value does not depend on significance.
3. **Public dataset selection** cannot be finalised until licences are checked
   in Phase 4. The plan names candidates and defers the decision rather than
   asserting redistribution rights that have not been verified.
