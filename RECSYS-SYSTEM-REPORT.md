# The boks recommender: system, methodology, and current results

**A technical report for academic review.**

Project: boks — a reading application for short literary pieces
Date: 2026-09-13
Status of the system: pre-launch. No public users yet; the measurement stack is
complete and verified, the corpus is not.
Related thesis topic: *Cohort-Aware Behavioral Evaluation and Regression Testing
of Sequential Recommender Systems*

This document is self-contained. It describes what the system does, how every
number is produced, which methodological problems were found, how each was
solved, what the system currently measures, and what we believe is still wrong.
It is written to be criticised.

---

## Table of contents

1. [The product and why its recommender problem is unusual](#1-the-product-and-why-its-recommender-problem-is-unusual)
2. [System architecture](#2-system-architecture)
3. [Candidate generation](#3-candidate-generation)
4. [The signal layer](#4-the-signal-layer)
5. [The strategy layer](#5-the-strategy-layer)
6. [Feed assembly](#6-feed-assembly)
7. [Experiment assignment](#7-experiment-assignment)
8. [Instrumentation: how behaviour becomes data](#8-instrumentation-how-behaviour-becomes-data)
9. [Feed provenance](#9-feed-provenance)
10. [Reader-level aggregation](#10-reader-level-aggregation)
11. [Statistical inference](#11-statistical-inference)
12. [Power analysis](#12-power-analysis)
13. [The divergence gate: validity before statistics](#13-the-divergence-gate-validity-before-statistics)
14. [Data quality monitoring](#14-data-quality-monitoring)
15. [Methodological problems found, and how each was solved](#15-methodological-problems-found-and-how-each-was-solved)
16. [Current empirical state](#16-current-empirical-state)
17. [Reproducibility and verification apparatus](#17-reproducibility-and-verification-apparatus)
18. [Known limitations](#18-known-limitations)
19. [Open questions we would like advice on](#19-open-questions-we-would-like-advice-on)
20. [Appendix: file map and glossary](#20-appendix-file-map-and-glossary)

---

## 1. The product and why its recommender problem is unusual

boks serves short literary pieces — a "bok" is one piece meant to fit a
15-minute break. The product thesis is a substitution: move a reader's attention
from short-form video to short-form literature. The interface is a vertical feed
with no search, no catalogue browsing, and no genre or mood controls. The reader
opens the app and reads; the ranking decides what comes next.

Four properties make this a different problem from the standard
recommender-systems setting, and all four shape the methodology below.

**(a) Items are consumable and non-repeatable.** A reader finishes a story once.
There is no equivalent of re-watching or re-listening, and no meaningful
long-tail of repeat consumption. This eliminates whole classes of design:
in particular, a **crossover design** (serve algorithm A in period 1 and B in
period 2 to the same reader) is invalid here, because there is no washout period
— you cannot un-read a story. Worse, the arm that wins period 1 depletes the
catalogue most, penalising period 2 by an amount that cannot be estimated.

**(b) The catalogue is tiny and human-produced.** 38 published boks today, grown
by author submissions under a 3-per-author-per-day limit and admin review. This
is three orders of magnitude smaller than the corpora most recommender research
assumes, and it creates a validity problem that precedes any statistics: with
few items, different rankers produce nearly the same list. See §13.

**(c) The success metric is time, not clicks.** The product is judged on
*attention actually given to literature*. A click-through proxy would be
actively misleading — a reader who opens twelve boks and finishes none is a
failure the CTR would record as success. The primary metric is foreground
reading seconds per reader, which has a heavy right tail (§12) and demands
robust estimators.

**(d) The population is small and will stay small for months.** The realistic
near-term scale is ~100–200 signups and ~50 active readers. Much of the standard
A/B apparatus assumes thousands. At 50 readers split two ways, the power to
detect even large effects is poor, and the honest engineering response is to
*say so on the screen* rather than print a verdict (§12).

---

## 2. System architecture

The pipeline, from a published piece to a statistical conclusion:

```
  Author submits  ──►  Admin review  ──►  published reel (corpus)
                                              │
                                              ▼
 ┌────────────────────── Cloudflare Worker: POST /api/feed ─────────────────────┐
 │  1. load active experiment config     (Postgres RPC)                          │
 │  2. load candidates + behaviour rollups (Postgres RPC)                        │
 │  3. resolve the reader's assigned arm  (Postgres RPC, write-once)             │
 │  4. derive 17 normalised signals per candidate     ── pure TypeScript ──      │
 │  5. score with the arm's strategy, sort, tier by fatigue                      │
 │  6. WRITE PROVENANCE: served_feed + served_feed_item                          │
 │  7. return the slate                                                          │
 └───────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                        Browser: renders the slate, measures behaviour
                        foreground-only clock, event queue, exit flush
                                              │
                                              ▼
                     record_recommendation_events  (attributed to feed_id)
                                              │
                                              ▼
        get_reader_outcomes → one row per (reader, algorithm, day)   ◄── analysis unit
                                              │
                                              ▼
             reader-level aggregation → bootstrap / permutation / power
                                              │
                                              ▼
                        admin console: effect, interval, power, data quality
```

Three architectural commitments are worth naming.

**Ranking executes in TypeScript, never in SQL.** The database returns counts;
every rate, weight and ordering is computed in application code. This makes the
ranking a pure function that can be unit-tested offline, replayed on historical
inputs, and shared unchanged between the production Worker and the research
harness. Adding an algorithm is one file.

**Ranking executes on the server, not in the browser.** This was changed during
this work (see §15, problem V3). The Worker holds no elevated credential: it
forwards the reader's own access token to PostgREST, so row-level security
applies exactly as it would in the browser. The point of moving it was
provenance — the party that did the ranking is the party that records what it
served. A client-reported `algorithm_id` cannot distinguish a client bug from
reality.

**Every degraded path is labelled, never silent.** If the Worker is unreachable
the browser ranks locally through the *same* function, and the resulting feed is
recorded with `serving_backend = 'browser'`. A legacy path over a different
database is recorded as `'d1_fallback'`. Degraded serves are also filed *outside*
the experiment (`assignment_source = 'fallback'`), because ranking over a
candidate set with no behavioural rollups is a materially different ranker.

---

## 3. Candidate generation

There is currently **no candidate generation stage in the research sense**. The
retrieval step is: *all published boks*, up to a limit of 200, with their
behaviour rollups attached, newest first. At 38 items this is the entire
corpus, so recall is trivially 1.0 and every ranker sees every item.

This is stated plainly because it matters for interpretation: **the system today
is a pure re-ranking problem over a complete candidate set.** Results about
ranking quality here say nothing about retrieval quality, and will not transfer
unchanged to a regime where retrieval binds.

Each candidate carries: `id, title, genre, mood, minutes, wordCount, createdAt`
and the rollups `impressions, starts, completes, skips, likes, shares, comments,
readSecondsTotal`.

---

## 4. The signal layer

Every strategy scores against a shared vocabulary of **17 signals**, each
normalised to [0, 1]. Normalisation is what makes a weight mean the same thing
in every strategy, and what makes two strategies comparable at all. A strategy
never touches a raw counter.

Signals are derived for the whole candidate set at once, because some of them
(`popularity`) are only meaningful relative to the rest of the set.

| # | Signal | Definition | Kind |
|---|---|---|---|
| 1 | `startRate` | starts / impressions | item quality |
| 2 | `finishRate` | completes / starts | item quality |
| 3 | `reactionRate` | (likes+shares+comments) / max(completes, starts) | item quality |
| 4 | `likeRate` | likes / max(completes, starts) | item quality |
| 5 | `commentRate` | comments / max(completes, starts) | item quality |
| 6 | `shareRate` | shares / max(completes, starts) | item quality |
| 7 | `skipRate` | skips / (starts + skips) | item quality (penalty) |
| 8 | `readDepth` | mean read seconds / expected seconds | item quality |
| 9 | `popularity` | starts / max(starts over the set) | set-relative |
| 10 | `freshness` | 0.5 ^ (age_hours / 72) — 72-hour half-life | recency |
| 11 | `exploration` | clamp(1 − impressions / 12) | uncertainty |
| 12 | `shortness` | (15 − minutes) / 14 | length |
| 13 | `longform` | (minutes − 1) / 14 | length |
| 14 | `tasteMatch` | (genre affinity + mood affinity) / (2 · max affinity) | personal |
| 15 | `novelty` | 0 if already completed or skipped, else 1 | personal |
| 16 | `fatigue` | 1 if skipped; 0.8 if completed; 0.5 if completed+liked; else 0 | personal |
| 17 | `jitter` | deterministic hash of (visitorId, itemId) → [0,1] | tie-breaking |

Two design notes.

`jitter` is **deterministic**, not random: the same reader always gets the same
perturbation for the same item. This gives ranking diversity without making a
served feed irreproducible, which a live `Math.random()` would.

`exploration` is a crude uncertainty proxy — it decays linearly to zero at 12
impressions. It is *not* an upper confidence bound and makes no claim to be. A
principled UCB or Thompson-sampling arm is one of the open questions in §19.

**Reader affinity** (`genreAffinity`, `moodAffinity`) is built only from
behaviour: +3 on completion, +4 on like, −2 on skip, accumulated per genre and
per mood. The reader is never asked to configure preferences, and the reading
surface displays no genre, mood or length metadata at all — those are inputs to
the ranking, never labels shown to the reader.

---

## 5. The strategy layer

A strategy is a named vector of signal weights plus optional custom scoring. The
default score is a weighted sum; negative weights are penalties. Seven are
registered.

| id | family | intent | weights |
|---|---|---|---|
| `for_you` | personal | **control arm and the product ranker.** Ported from the original boks backend — see §5.1. Not a weighted sum | composed contributions, not weights |
| `balanced` | quality | Mixed quality with light exploration | finishRate 30, reactionRate 18, exploration 12, readDepth 10, popularity 6, freshness 6, shortness 4, jitter 5, **skipRate −14** |
| `completion_first` | quality | "do readers finish what they start?" | finishRate 48, readDepth 22, startRate 8, exploration 8, reactionRate 6, longform 4, jitter 3, **skipRate −22** |
| `reaction_first` | engagement | "which pieces make people respond?" | commentRate 24, likeRate 22, shareRate 18, reactionRate 12, finishRate 10, shortness 8, exploration 8, jitter 4, **skipRate −12** |
| `discovery` | exploration | buy information about under-tested items | exploration 38, freshness 22, novelty 10, finishRate 12, jitter 8, reactionRate 6, shortness 4, **skipRate −8** |
| `taste_match` | personal | content-based personalisation | tasteMatch 40, finishRate 18, exploration 10, reactionRate 10, novelty 8, freshness 4, jitter 4, **skipRate −12** |
| `recency` | baseline | newest first — what the MVP shipped | freshness 100 |
| `random_control` | baseline | deterministic shuffle — the floor any ranker must clear | jitter 100 |

### 5.1 `for_you` — the ported ranker

`for_you` is not a weighted sum of the shared signals. It is a port of the
ranking from the original boks backend (Kotlin/Spring, `ForYouFeedSupport.kt`),
and it has a different shape from everything else in the registry:

**Retrieval families.** Each candidate is classified `resume`, `affinity` or
`discovery`, and the family carries a large base score (3.8 / 2.4 / 0.8). The
original's fourth family, `semantic` — retrieval by embedding similarity to a
reader's positive *and negative* taste vectors — is **not ported**: it needs an
embedding provider and a per-user budget. The family is declared in the type so
the gap is visible rather than silently absent.

**A reader profile with its own model.** Each (reader, boks) pair contributes a
positive weight (completion 2.6, comment 1.9, like 1.4, plus capped progress and
dwell terms, plus 0.8 for following the author) and a negative weight (graded by
repeated exposure without attention, up to 2.1), both decayed by recency in four
steps. The net is aggregated along three dimensions — author, reading shape and
length bucket — with author affinity divided by √(times met) so a prolific
author cannot own the feed.

**Personalisation strength gates the heuristics.** A reader with no evidence
gets the light content heuristics at a fifth strength, so a cold start never
looks like taste.

**Priors that let new work be found.** Quality, author trust, freshness and a
cold-start prior, the last of which is what allows an author with nothing
published to be served at all — without it they would never be served and never
acquire the counters the quality prior reads.

**A greedy slate, not a sorted list.** Each pick is scored against the items
already placed: author streaks cost up to 2.8, shape and length streaks less, a
long piece after compact ones is *rewarded* 1.2, and a discovery budget grows
roughly one slot per four so a long session keeps meeting new authors. Selecting
by a fixed score and then shuffling for variety would produce a different, worse
slate — the cost of another piece by the same author depends on what precedes it.

**It explains itself.** Every placement carries up to four human-readable
reasons ("new author cold-start prior", "diversity penalty from recent
streaks"), stored per slot in `served_feed_item.explanations`. A served slate is
therefore auditable, not merely reproducible.

Two things the port had to add because this codebase has no retrieval stage:
progress no longer boosts a boks the reader already finished, and a finished
boks is explicitly demoted. The original never needed either, because its
candidate queries excluded finished pieces; a ranker over the whole corpus has
to say it. Without them, the best-read boks in the corpus is served straight
back to the reader who just finished it.

Also absent for the same reason as `semantic`: the original's explicit
`NOT_INTERESTED` and `HIDE_AUTHOR` signals, worth 3.6 and 4.8 of negative
weight. This product has neither control, so the negative half of the profile
rests entirely on implicit evidence.

The two baselines exist for methodological reasons, not product reasons.
`recency` is the pre-experiment status quo, kept as a *comparable arm* rather
than a hidden default, so "is ranking worth anything at all?" is an answerable
question. `random_control` establishes the floor.

**These are hand-set weights, not learned parameters.** No model is trained. The
weights encode editorial hypotheses about what makes a short literary piece
worth serving. We consider this a defensible starting point at 38 items and ~10²
interactions — there is nothing to train on — but it is a limitation, and §19
asks about the transition to a learned ranker.

---

## 6. Feed assembly

One function, `buildReaderFeed`, is the single seam through which every backend
ranks. Given candidates, a reader profile, an experiment config and a limit it
returns an ordered, attributed slate.

Ordering is: **fatigue tier first, then score descending, then newest, then id.**

The fatigue tiering is applied *outside* the strategy, deliberately. A boks the
reader already skipped or finished never outranks one they have not seen,
whatever its signals say. Encoding this as a product rule rather than as another
weight means every strategy is held to it identically and no strategy can win by
recycling material the reader has already consumed.

The final tie-break on `id` makes the ordering **total and deterministic**: the
same inputs always produce the same slate, byte for byte. This is what makes
replay and regression testing possible.

---

## 7. Experiment assignment

Assignment is deterministic hashing, not randomisation at request time:

```
bucket = FNV-1a("{experimentKey}:{readerId}:arm") mod Σ weights
```

walking the weighted arms in order. The subject is the **Supabase user id**, not
a per-browser id, so the same person on a second device lands in the same arm.

The proposal is computed locally, then handed to the database, which either
stores it or returns the arm it already holds (`on conflict … do nothing`
followed by a read-back). **An assignment is therefore written once and never
rewritten.** This is a fix, not a design flourish — see §15, problem A1.

Live configuration today: `boks-feed-v1`, two arms, `for_you` 50% vs
`completion_first` 50%, control `for_you`.

The challenger is **not** `recency`, which is the pairing a young product would
normally want ("is ranking worth anything against newest-first?"). It was
measured and rejected: against a cold reader `for_you` and `recency` share 100%
of their top ten, and 80% even for a reader with two weeks of history. On this
corpus almost nothing distinguishes them — every seeded boks is the same length
and no author has published enough to move the cold-start prior, so freshness is
most of what either ranker has to work with. `completion_first` shares 30–40%,
which is the only live pairing that can currently resolve anything.

**A warning about `user_segment`.** The code derives a "segment"
(`new_reader`, `quick_reads`, `deep_reads`, `general`) by hashing the visitor id
modulo 100. **These are random labels with no behavioural content whatsoever.**
They are recorded on events and were previously displayed as a breakdown in the
admin console, which invited the reader of that screen to interpret noise as
reader types. The breakdown has been removed. The field is retained only because
historical events carry it, and it must never be used as a cohort. Real,
leakage-safe behavioural cohorts are planned work (§19).

---

## 8. Instrumentation: how behaviour becomes data

This is where most of the methodological effort went, on the principle that a
sophisticated estimator over corrupt measurements is worse than useless — it
launders the corruption into a confidence interval.

### 8.1 The reading clock

Time-on-platform is the primary metric, so it must mean "time a person was
actually looking at a piece". A naive `Date.now()` delta does not: lock the phone
for ten minutes and that is ten minutes of "reading".

`components/boks/reader-clock.ts` implements a foreground-only accumulator:

- Time accrues only while `document.visibilityState === 'visible'`.
- The trigger is **visibility, not focus**. On iOS the comment keyboard fires
  `blur` while the reader is *most* engaged; a focus-based clock would stop at
  exactly the wrong moment.
- Every accrual is bounded by **`maxGapSeconds = 120`**. A laptop can suspend
  without firing `visibilitychange`, and one bad wake-up would otherwise book a
  six-hour read that silently owns the week's numbers. The clock is marked every
  5 seconds while visible, so ordinary reading never approaches the bound and
  only a genuine suspension is clipped.
- `pageshow` with `persisted = true` (back/forward cache) **rebases** rather than
  accruing, because a restored page's last timestamp is arbitrarily old.
- The module is DOM-free and separately unit-tested; `attachReaderClock` does the
  browser wiring.

### 8.2 The event contract

Ten event types: `impression, start, complete, skip, like, share, comment,
heartbeat, publish, preference`. Every event carries the algorithm, experiment
key, segment, feed rank, session id, cumulative active seconds, scroll progress,
the expected reading time for that piece, the served-feed id, the serving
backend, and the labelling version.

Three properties of the transport matter for data integrity:

- **`active_seconds` is cumulative per (session, item), and every rollup uses
  `max()`, never `sum()`.** This makes duplicates free: a retried batch, a
  repeated heartbeat, or a lost event all cost nothing. Idempotence was judged
  worth more than granularity.
- **The queue deduplicates on `(sessionId, itemId, eventType)`**, except
  heartbeats which may legitimately repeat. The feed wraps around a small
  catalogue, so a reader can lap it; counting the second lap as a second
  impression while the outcome is recorded once would make finish rate fall
  mechanically the longer someone reads.
- **Exit flush uses `fetch(..., { keepalive: true })`.** Safari cancels in-flight
  requests on `pagehide`, and `sendBeacon` cannot carry the headers PostgREST
  requires. `keepalive` is the only option that does both.

A heartbeat fires every 60 seconds of *active* time, carrying the cumulative
value, so a reader who lingers and then closes the tab still contributes their
reading time.

### 8.3 Read / skip labelling

Whether a piece was *read* is inferred, not asked. The rule is deliberately
fixed and versioned (`labeling.v1`):

```
expected  = max(20, wordCount / 238 * 60)          # 238 wpm, adult prose
skip      if active < max(5, 0.25 · expected)
complete  if progress ≥ 0.85 and active ≥ 0.40 · expected
complete  if active ≥ 0.70 · expected              # short pieces never scroll
skip      otherwise
```

**Why a fixed global constant instead of each reader's measured speed.** We
considered per-reader words-per-minute and rejected it for the label. If
"completed" depended on a speed estimate that shifts as samples accumulate, then
finish rate would stop being comparable between readers *and* would drift for
the same reader over time — moving the instrument while measuring with it. There
is also a self-reinforcing failure: the high-scroll samples used to calibrate
speed are contaminated by fast flicks, which bias the estimate upward, which
loosens the threshold, which admits more flicks. The rule adopted is
**personalise the product, standardise the instrument.** Per-reader speed is
computed and displayed as a property of the reader, and is free to influence
ranking later, but never feeds back into the measurement.

The labelling version is stamped on every event, so a window containing two
versions is detectable and those events are known to be non-comparable.

---

## 9. Feed provenance

Every served feed is persisted before it is returned:

`served_feed` — reader, session, timestamp, experiment key/version/mode,
algorithm (or the two algorithms under interleaving), assignment source,
candidate request id, candidate count, catalogue size, serving backend, degraded
flag, fallback reason, `signals_version`, `ranking_version`, `labeling_version`,
**`profile_snapshot` (jsonb)**, seed, build id.

`served_feed_item` — one row per delivered slot: item, delivered rank, score,
source ranker, source rank, credited algorithm.

The `profile_snapshot` is the non-obvious part. The reader profile changes with
every read, so without capturing it at serve time a ranking can never be
replayed — the inputs are gone. Storing it makes each serve a reproducible
triple of (candidates, profile, config).

Events reference `feed_id`, but **the database treats a client-supplied feed id
as a hint, never an authority**: a feed id that does not belong to the calling
user is dropped to `NULL` rather than trusted. This is asserted by a schema test.

---

## 10. Reader-level aggregation

`get_reader_outcomes(days, experiment_key)` returns **one row per (reader,
algorithm, day)**. The database counts; it never divides and never infers.

`lib/recsys/aggregate/` collapses those rows into one value per reader, and this
is the only place in the system where the choice of analysis unit exists. Two
rules are enforced here:

**Crossed readers are excluded from every arm, and counted.** A reader with
events under more than one algorithm cannot be counted in either arm of an
independent comparison: their behaviour under one contaminates the other.
Before the assignment table became authoritative this was not a rare edge case —
the arm was recomputed on every page load, so a reader could legitimately appear
in two arms on the same day. The count is displayed; a rising number means
assignment is leaking.

**Rate metrics require a denominator worth dividing by.** A reader with fewer
than 5 starts contributes no completion rate; a rate over two starts is noise
wearing a percentage sign. Excluded readers are counted and reported.

Eight reader-level metrics are defined: `active_seconds`, `seconds_per_session`,
`boks_opened`, `sessions`, `days_active`, `completion_rate`, `skip_rate`,
`reaction_rate`. Each declares its own direction (`lowerIsBetter`), so a caller
cannot invert the verdict by accident.

---

## 11. Statistical inference

`lib/recsys/statistics/` is a pure module with no I/O. Its result type makes it
*impossible to construct a comparison that omits its analysis unit, its sample
size, or its uncertainty*.

### Independent two-arm comparison

- **Point estimate: Hodges–Lehmann shift** — the median of all pairwise
  differences between arms. Chosen over a difference of means because per-reader
  reading time is strongly right-skewed; at a dozen readers per arm, one
  enthusiast otherwise decides the answer.
- **Interval: percentile bootstrap over readers**, resampling each arm
  independently, 1200–2000 resamples. Reported as approximate; bootstrap
  intervals undercover on skewed data below roughly 30 per arm.
- **Test: two-sided permutation test on the arm labels.** This is the primary
  inference. It is exact under the null by construction, so unlike a bootstrap
  interval it cannot quietly undercover on a small skewed sample. The p-value is
  computed as `(extreme + 1) / (permutations + 1)` so it can never be exactly
  zero — a finite number of permutations cannot support a stronger claim.

### Paired comparison

For interleaving and before/after designs: mean paired difference, paired
bootstrap over the per-reader differences, and an **exact binomial sign test**.
Pairing removes between-reader variance, which dominates reading time. A unit
test demonstrates the consequence directly: on the same data, a +15% within-reader
effect across 20 readers is resolved by the paired design and is *inconclusive*
under the unpaired one. This is the entire argument for interleaving at our scale.

### Reporting discipline

- An interval spanning zero is reported as **`inconclusive`**, never as "no
  difference". Absence of evidence is displayed as absence of evidence.
- Below a minimum of 10 readers per arm the status is **`insufficient_data`** and
  *no estimate is produced at all* — not a wide interval, nothing.
- At 25 readers per arm or fewer, **every per-reader value is printed**. At that
  scale a person reads twelve numbers better than one interval.
- Every estimate is seeded (mulberry32) and therefore exactly reproducible.
  `Math.random` would make a thesis table impossible to regenerate.

---

## 12. Power analysis

Before an experiment is launched, the system answers: *given the readers we have
and the spread we observe, what could we detect?*

`simulatePower` draws log-normal samples with a requested coefficient of
variation and compares arms with Welch's t against a **t critical value**, not
1.96. At 12 readers per arm the normal approximation over-rejects by 3–7
percentage points, which would make the tool report power the design does not
have — precisely the failure it exists to prevent.

Measured at CV ≈ 0.95, the coefficient of variation of per-reader reading time
(4000 trials, independently simulated before this module was written):

| true lift | n=12/arm | n=25/arm | n=50/arm | n=100/arm |
|---|---|---|---|---|
| +20% | 6% | 9% | 15% | 25% |
| +30% | 10% | 15% | 26% | 48% |
| +50% | 17% | 33% | 55% | 84% |
| +80% | 32% | 58% | 86% | 99% |

The implementation is required by unit test to reproduce this table to within 4
percentage points. Both sides are Monte Carlo, so the tolerance is the noise
floor; it is tight enough that the wrong critical value fails.

**The consequence, stated bluntly:** at ~50 active readers split two ways, a
+30% improvement in reading time — a large effect for a recommender — would be
detected about 15% of the time. Four arms would make this 10%. This is why the
default configuration was cut from four arms to two, and why the console prints
a refusal ("nothing below +X% is visible at this size") rather than a verdict.

A paired within-reader design reaches ~77% power at n=25 for the same +30%.

---

## 13. The divergence gate: validity before statistics

This is the part we consider most transferable, and the part we would most like
scrutinised.

**The question that precedes every statistical question is whether the arms are
serving different feeds at all.** Two rankers over a catalogue of tens produce
nearly the same list — there is nothing to rank. No sample size and no test can
find a difference that does not exist in the treatment. And this failure is
*invisible in a metrics panel*: the arms simply tie forever, which looks
identical to a true null.

So it is measured directly. `measureStrategyDivergence` scores one candidate set
under every registered strategy and reports, pairwise:

- **overlap@K** — the share of the top K that both rankers chose (K = 10)
- **Kendall's τ-b** — rank correlation over the items both rankings contain

with a verdict: `indistinguishable` (mean overlap ≥ 0.80), `weak` (≥ 0.60), or
`usable`. It runs as a CLI gate (`npm run verify:divergence`) and renders at the
top of the experiment console, above every result.

Its unit tests include the trap itself: **a 10-item candidate set forces high
overlap whatever the strategies are.** That test documents the failure mode so it
cannot be forgotten.

This gate has already changed a decision. It showed that the quality-family
strategies are near-duplicates — `balanced` vs `completion_first` overlap
**100%** (τ = 0.94) on the live catalogue — because they weight the same signals
and therefore converge. The experiment that was running (`balanced` vs
`reaction_first`) could not have resolved anything at any sample size. The live
configuration was changed to `balanced` vs `recency`, which share **20%**
(τ = −0.26).

**An important limitation we have not solved.** The gate currently cannot
distinguish two different causes of high overlap:

1. the strategies are near-identical *by construction* (they weight the same
   signals), versus
2. there is *no signal to differ on* (the corpus makes the distinguishing
   signals constant).

These demand opposite responses — redesign the strategies, or grow the corpus —
and the gate reports the same number for both. Cause attribution is planned
work. §16 shows the diagnostic that currently substitutes for it.

---

## 14. Data quality monitoring

`get_recommendation_data_quality(days)` counts fourteen conditions, each of
which was previously invisible, and invisible is how broken numbers get trusted:

events with no served feed · events attributed to no algorithm · degraded feeds ·
empty feeds · **algorithm mismatch** (the event and the feed it belongs to
disagree about the arm) · **item not in its feed** (a read of something that feed
never served) · events timestamped before their own feed · duplicate outcomes ·
reading time that hit the 24-hour clamp · outcomes with zero reading time ·
assignments with no events · readers with events but no assignment · feeds broken
down by serving backend · labelling versions present in the window.

These render as a panel in the console, described as *"anything above zero is a
reason to distrust a comparison, not a number to optimise."*

---

## 15. Methodological problems found, and how each was solved

This is the substance of the work. Each row is a defect that was present in a
running system, found by audit, and fixed.

### V1 — Pseudo-replication: the analysis unit was the impression

**The defect.** Significance was computed with a two-proportion z-test over
*event counts*, gated at 30 impressions. Events from one reader are strongly
correlated, so 100 impressions from 3 readers was treated as n = 100 and
labelled "strong signal".

**Why it matters.** This is textbook pseudo-replication. The effective sample
size was the number of readers — about three — while the reported precision
implied a hundred. Every confidence claim the system had ever made was wrong by
roughly a factor of √(impressions per reader) in the standard error.

**The solution.** The analysis unit is now the reader, enforced structurally: a
single module converts event rows into reader rows, and the result type of every
comparison carries `analysisUnit: "reader"`, the per-arm reader counts, and the
interval. The two-proportion z-test and its confidence labels were deleted. A
regression test asserts that one reader with 200 impressions is a sample of one.

### V2 — Underpowered by design, with no indication of it

**The defect.** Four arms across ~50 readers is ~12 per arm. Simulated power to
detect even a doubling of reading time was ~50%. The console displayed
comparisons with no statement of what they could detect.

**The solution.** Arms cut from four to two (a free doubling of per-arm sample).
A simulation-based power estimator, validated against an independently produced
power table, reports the minimum detectable effect next to every comparison and
phrases it as a refusal when appropriate. `insufficient_data` is a first-class
state that produces no estimate at all.

### V3 — No feed provenance: results were not reproducible

**The defect.** Ranking ran in the browser. Nothing persisted what was served —
only the resulting events, carrying a client-reported `algorithm_id`. The
candidate set, the reader profile and the config were all mutable, and two of
them existed only in the browser. A served feed could not be reconstructed, so
no result was reproducible in the sense a thesis requires. Attribution was a
client assertion: a client bug was indistinguishable from reality.

**The solution.** Canonical feed assembly moved to the server (recorded as
ADR-001, with four alternatives weighed). The Worker ranks and writes
`served_feed` + `served_feed_item` including the profile snapshot, versions and
seed, before returning the slate. The browser path is retained as a labelled
degraded mode running the same code.

**Note on the migration method.** The conventional mitigation for moving a
ranker is a shadow run: serve both paths in parallel and compare. With no
deployed users that buys nothing. Because the ranking is a pure function,
equivalence is instead asserted as a unit test — identical inputs must produce an
identical slate through both call sites. That is a stronger guarantee than a
sampled comparison, and it runs on every commit.

### V4 — An invisible data split

**The defect.** If the primary reader path threw an exception, the client
silently fell back to a legacy endpoint backed by a *different database*. Those
readers' events landed in the other store, under a locally recomputed arm, with
no stored assignment — and they appeared in no comparison and no data-quality
report. A visible failure had been converted into an invisible one.

**The solution.** The fallback is removed for the case that caused it. A failing
primary path now surfaces the failure. The legacy path is reachable only when the
primary database is not configured at all, and is labelled `d1_fallback`. A
rejected authentication token returns 401 rather than a degraded feed — serving a
recency feed under an expired session would hide a broken sign-in behind a
working page *and* file the reader's events under an arm nobody assigned them.

### A1 — Assignment was rewritten on every page load

**The defect.** The assignment RPC performed `on conflict … do update set
algorithm_id = excluded.algorithm_id`, and it fired from every feed load with an
arm recomputed client-side from a browser-local id. The assignment table
therefore recorded *the last page load*, not what happened. Any cohort analysis
or before/after reading was reading rewritten history.

**The solution.** `on conflict … do nothing` followed by a read-back: written
once, never rewritten, database-authoritative. The subject is the account id, not
a browser id, so one person on two devices is one subject.

### M1 — Reading time was wall-clock

**The defect.** A plain `Date.now()` delta with no visibility handling. A locked
phone accumulated reading time. The primary metric of the product was measuring
tab lifetime.

**The solution.** The foreground-only clamped clock described in §8.1.

### M2 — Every session's last read was never recorded

**The defect.** The outcome was emitted from exactly one call site — advancing to
the next story. A reader who finished a piece and closed the tab produced no
`complete` and no `skip`. This biases *against* any algorithm that serves a
compelling last story, which is a bias correlated with the treatment.

**The solution.** Outcomes are emitted on `pagehide`, unmount and story change,
with a keepalive transport, and a 60-second heartbeat carries cumulative reading
time in the interim.

### M3 — Length metadata was self-reported and false

**The defect.** `minutes` was supplied by the submitting author. Pieces of 68–92
words claimed 5–9 minutes. Since `estimatedSeconds` derived from it, the read/skip
label was judging a 20-second piece against a 9-minute expectation.

**The solution.** A database trigger derives length from the actual text and
enforces the 15-minute rule against real word count. The event's expected reading
time is computed from `wordCount` at a fixed 238 wpm, not from `minutes`.

### M4 — Retries double-counted

**The defect.** A failed batch was re-queued whole. If the write succeeded but
the response was lost, reading seconds were counted twice.

**The solution.** Cumulative `active_seconds` with `max()` rollups, plus queue
deduplication on `(session, item, type)`. A duplicate is now free.

### Q1 — Fabricated metrics in the operator console

Audited against the live database rather than the source, the console showed:
`Impressions` and `Starts` computed from *the identical subquery* (always equal);
`Completes` hardcoded to `0`; a funnel whose "start rate" was `pct(x, x)` = 100%
and whose "finish after start" divided by that hardcoded zero; a field named
`finishRate` that actually returned `likes / views`; and **three separate
invented weighted composites** presented as metrics, one of which
(`engagementScore = completes·7 + likes·5 + shares·5 + comments·8 − skips·3`) was
the default sort order, so five invented constants decided what the founder read
first.

Two sources of truth also disagreed under the same word on the same screen:
`views` = 406 versus impression events = 766, both labelled "Impressions".

**The solution.** All of it deleted. One source per concept: reader behaviour
comes from the event table; `views`/`likes` remain product features (reading
history, like state) and are never metrics. Composite scores are gone entirely —
*a metric that cannot be wrong cannot be informative*. Schema-level assertions now
make the original defects unrepeatable.

### Two bugs found while building the replacement

Reported for completeness, because both are the same class of error as the ones
being fixed:

1. **`{...defaults, ...options}` let an explicit `undefined` disable the
   minimum-sample guard.** Any caller forwarding an optional field would silently
   remove the one check standing between a three-reader sample and a printed
   verdict. Fixed with a merge that skips undefined, plus a regression test.
2. **A paired p-value of 1.9 × 10⁻⁶ printed as `0`**, because probabilities were
   rounded to four decimal places. Reporting p = 0 claims a certainty no test can
   deliver. Probabilities now round to significant digits.

---

## 16. Current empirical state

Measured today against the local stack. **These are development and seed data,
not a user study.** They are included because they characterise the regime the
methodology has to survive.

### Corpus

| | |
|---|---|
| Published boks (this local database) | **38** |
| Published boks (production, measured 2026-09-15) | **37** |
| Word count | min 12, max 167, mean 117 |
| Distinct values of `minutes` | **1** (every piece rounds to 1 minute) |
| Distinct reading shapes | **1** (`short_prose`; 12–167 words, none long enough or broken enough to differ) |
| Boks with an author account | **1 of 38** (the rest are seeded, so author priors are constants) |
| Boks carrying any reader behaviour | **13 of 38** |
| Reader events | 74 |
| Distinct readers | 3 |
| Distinct sessions | 6 |

### Signal informativeness

Spread of each signal across the 38-item corpus, for a cold-start reader:

| Signal | min | max | sd | |
|---|---|---|---|---|
| `startRate` | 0.000 | 1.000 | 0.303 | informative |
| `skipRate` | 0.000 | 1.000 | 0.380 | informative |
| `freshness` | 0.000 | 0.991 | 0.325 | informative |
| `jitter` | 0.032 | 0.955 | 0.285 | informative (by construction) |
| `popularity` | 0.000 | 1.000 | 0.208 | informative |
| `readDepth` | 0.000 | 0.567 | 0.113 | weak |
| `exploration` | 0.500 | 1.000 | 0.098 | weak |
| `finishRate` | 0.000 | 0.333 | 0.066 | weak |
| `reactionRate` | 0.000 | 0.000 | 0.000 | **constant — no reactions in corpus** |
| `likeRate` | 0.000 | 0.000 | 0.000 | **constant — no reactions in corpus** |
| `commentRate` | 0.000 | 0.000 | 0.000 | **constant — no reactions in corpus** |
| `shareRate` | 0.000 | 0.000 | 0.000 | **constant — no reactions in corpus** |
| `shortness` | 1.000 | 1.000 | 0.000 | **constant — every piece is 1 minute** |
| `longform` | 0.000 | 0.000 | 0.000 | **constant — every piece is 1 minute** |
| `tasteMatch` | 0.000 | 0.000 | 0.000 | constant *for a cold reader* (expected) |
| `novelty` | 1.000 | 1.000 | 0.000 | constant *for a cold reader* (expected) |
| `fatigue` | 0.000 | 0.000 | 0.000 | constant *for a cold reader* (expected) |

**Reading of this table.** Six of seventeen signals carry no information for
*any* reader on the current corpus: the four reaction signals (nobody has reacted
yet) and the two length signals (every piece is the same length). Three more are
constant for a cold-start reader, which is expected behaviour rather than a
defect. That leaves eight signals doing all the work, of which three are strong.

This is the diagnostic that partially substitutes for the missing cause
attribution in §13. `reaction_first` places **76 of its 106 points of positive
weight on the four signals that are identically zero**, and a further 8 on
`shortness`, which is a constant 1 and therefore only a uniform offset. Barely a
fifth of its declared weight discriminates between items at all: in effect it is
not the strategy it declares. `completion_first`'s `longform` weight is inert for
the same reason.

### Divergence between arms

| pair | overlap@10 | Kendall τ | verdict |
|---|---|---|---|
| `balanced` vs `recency` **(live experiment)** | **20%** | −0.26 | usable |
| `balanced` vs `random_control` | 50% | 0.31 | usable |
| `balanced` vs `taste_match` | 90% | 0.92 | **indistinguishable** |
| `balanced` vs `completion_first` | 100% | 0.94 | **indistinguishable** |
| `balanced` vs `reaction_first` | 80% | 0.80 | indistinguishable |
| `completion_first` vs `reaction_first` | 80% | 0.85 | indistinguishable |
| `balanced` vs `discovery` | 60% | 0.55 | weak |
| `reaction_first` vs `discovery` | 50% | 0.41 | usable |
| all seven strategies, mean | 55% | — | usable |
| four quality/engagement arms, mean | **72%** | — | **weak** |

The live pairing is the most separated one available, which is why it was
chosen. Note that `balanced` vs `taste_match` at 90% overlap is a *cold-reader*
measurement — `tasteMatch` is constant with no profile, so that pair would
separate for a reader with history. This is exactly the cause-attribution
ambiguity described in §13.

### Statistical state

No experiment has produced a readable result, and the system says so. With 3
readers, every comparison returns `insufficient_data` and no estimate. This is
the correct output, and the flow test asserts it.

---

## 17. Reproducibility and verification apparatus

Everything below runs locally with no external service.

| Layer | Command | What it proves | Current |
|---|---|---|---|
| Static | `npm run lint`, `npm run typecheck` | — | clean |
| Unit | `npm test` (vitest) | ranking purity, clock behaviour, queue idempotence, estimators, power-table reproduction, aggregation, feed-service equivalence | **121 passed** |
| Schema | `npm run verify:schema` | migrations apply to a throwaway Postgres; 75 behavioural assertions incl. RLS, provenance, `max()` rollups, foreign-feed rejection | **75 checks over 16 migrations** |
| Integration | `npm run test:supabase` | full flows through PostgREST against a real local stack | **9 passed** |
| Validity | `npm run verify:divergence` | can the live arms resolve anything at all | **WEAK (72%)** |
| Build | `npm run build` | Worker bundle compiles | green |

Determinism guarantees that support replay:

- ranking is a total order with a tie-break on id — identical inputs give an
  identical slate, byte for byte
- assignment is a pure hash of `(experimentKey, readerId)`
- `jitter` is a hash, not a random draw
- every estimator takes an explicit seed
- `signals_version`, `ranking_version` and `labeling_version` are stamped on
  every served feed and every event, with a changelog in source

---

## 18. Known limitations

Stated as limitations, not hidden as caveats.

1. **No user study has been run.** Everything above is verified machinery over
   development data. The power analysis is a statement about what *would* be
   detectable, not a result.
2. **The corpus binds everything.** 38 items, all one minute long, 13 with any
   behaviour. Six of seventeen signals are constants. No statistical method fixes
   this; only publishing more and more varied pieces does.
3. **The design is between-reader, which is the weak design at our scale.**
   Interleaving is implemented in the schema (per-slot `source_ranker_id` and
   `credited_algorithm_id`) but not yet in the serving path.
4. **Weights are hand-set, not learned.** There is no model, no training, no
   offline/online consistency question yet.
5. **No candidate generation.** Pure re-ranking over the complete corpus (§3).
6. **`exploration` is not a principled uncertainty estimate.** It is a linear
   decay, not a confidence bound.
7. **Cohorts do not exist yet.** The `user_segment` field is a hash and must
   never be used as one (§7).
8. **The divergence gate cannot attribute cause** (§13).
9. **`boks_opened` is counted per day and summed**, so a reader who reopens the
   same piece on two days is counted twice. A known, bounded bias; fixing it
   costs a column.
10. **Reading fatigue is stored per browser, not per account**, so the same
    reader on two devices shares an arm but not an "already read" set.
11. **A vestigial config field.** `minimumImpressionsPerArm` remains editable in
    the experiment editor and stored in the database, but nothing reads it for a
    decision any more — the reader-level minimum replaced it. It should be
    removed when the experiment declaration is formalised.
12. **Guest readers are measured**, which is correct for behaviour but means a
    "reader" is an account-or-anonymous-session identity, and an anonymous reader
    who later signs up is two subjects unless the upgrade path preserves the id.

---

## 19. Open questions we would like advice on

These are the points where we are least confident and would most value
supervision.

**On experimental design.**

1. Given ~50 readers and a consumable, non-repeatable catalogue, is **team-draft
   interleaving** the right primary instrument? Our reasoning: crossover is
   invalid (no washout), between-reader is underpowered, and interleaving is
   within-reader, within-session and within-catalogue-state, so reader
   heterogeneity, depletion and period effects cancel exactly. The known cost is
   that interleaving answers "which ranker picks better items", not "which ranker
   makes people come back". Is the two-instrument protocol we propose —
   interleaving screens weekly and nominates a challenger, then a single long
   two-arm run confirms on retention and time — methodologically sound, or does
   the screening step invalidate the confirmatory test through selection?

2. We rejected difference-in-differences on join-week cohorts because parallel
   trends is unverifiable over two months of history and because it requires
   permanently reserving a control arm for new readers, halving per-arm n. Is
   that the right call, or is there a design that recovers the cohort comparison
   cheaply?

**On validity.**

3. Is overlap@K plus Kendall τ an adequate operationalisation of "can this
   experiment resolve anything"? Is there established literature on
   *pre-experiment treatment-separation gates* that we should be building on
   rather than inventing? We have not found it, which makes us suspect we are
   using the wrong search terms.

4. How would you attribute the cause of high overlap — strategies identical by
   construction versus a corpus with no variance in the distinguishing signals?
   Our current idea is to measure divergence on a synthetic corpus with forced
   variance in each signal, and compare against divergence on the real one, but
   we are unsure this isolates the effect cleanly.

**On measurement.**

5. Is the "personalise the product, standardise the instrument" rule (§8.3) the
   right resolution of the per-reader reading-speed question, or does a fixed
   238 wpm introduce a bias correlated with reader type that a drifting estimate
   would not?

6. Reading time is our primary metric and is heavily right-skewed. We use
   Hodges–Lehmann shift plus a permutation test rather than log-transformed
   means. Is there a preferred convention in the engagement-metrics literature we
   should match for comparability with published results?

**On the research programme.**

7. The thesis direction is cohort-aware behavioural evaluation and **regression
   testing** of sequential recommenders — treating "did this change make the
   recommender worse for a specific behavioural cohort?" as a test suite with
   PASS/FAIL/INCONCLUSIVE outcomes rather than as a dashboard. Is the
   contribution there defensible, and what is the nearest existing work we should
   be positioning against?

8. At what corpus size and interaction count does it become reasonable to move
   from hand-set weights to a learned ranker, given that we will have ~10³–10⁴
   interactions rather than ~10⁷?

---

## 20. Appendix: file map and glossary

### Where each concept lives

| Concept | Location |
|---|---|
| Signal definitions (17) | `lib/boks/recommendations/signals.ts` |
| Strategy contract | `lib/boks/recommendations/strategy.ts` |
| Strategies (7) | `lib/boks/recommendations/strategies/` |
| Registry | `lib/boks/recommendations/registry.ts` |
| Feed assembly (the one seam) | `lib/boks/recommendations/feed.ts` |
| Experiment assignment | `lib/boks/recommendations/experiments.ts` |
| Divergence gate | `lib/boks/recommendations/divergence.ts` |
| Version stamps + changelog | `lib/boks/recommendations/versions.ts` |
| Serving + provenance | `lib/boks/feed-service.ts`, `app/api/feed/route.ts` |
| Reading clock | `components/boks/reader-clock.ts` |
| Event queue | `components/boks/reader-events.ts` |
| Read/skip labelling | `components/boks/reader-behavior.ts` |
| Reader aggregation | `lib/recsys/aggregate/` |
| Estimators | `lib/recsys/statistics/compare.ts` |
| Power | `lib/recsys/statistics/power.ts` |
| Lab report | `lib/boks/recommendations/metrics.ts` |
| Schema + RPCs | `supabase/migrations/` |
| Schema assertions | `scripts/local-supabase/checks.sql` |

### Companion documents

| Document | Contents |
|---|---|
| `RECSYS-RESEARCH-IMPLEMENTATION-PLAN.md` | The full research plan, sections A–N: audit findings, target architecture, phase order, definitions of done |
| `docs/adr/ADR-001-where-ranking-executes.md` | The server-vs-browser ranking decision, with four options weighed and consequences |
| `docs/handover/2026-09-13-phase-1-measurement-correctness.md` | Verification report for the measurement-correctness phase |
| `docs/admin-metrics.md` | Every field in the operator console, what it is computed from, and which decision it supports |

### Glossary

**bok** — one short literary piece, the item being recommended.
**arm** — one algorithm in a running experiment.
**analysis unit** — the entity treated as an independent sample. Here: the reader.
**crossed reader** — a reader with events under more than one arm; excluded from comparisons.
**divergence** — the degree to which two rankers produce different orderings of the same candidates.
**overlap@K** — share of the top K chosen by both rankers.
**provenance** — the persisted record of what was served, to whom, by which ranker, over which inputs.
**pseudo-replication** — treating correlated observations as independent samples.
**serving backend** — which code path produced a feed: `worker` (canonical), `browser` or `d1_fallback` (both degraded).
**labelling version** — the identifier of the read/skip inference rules in force when an event was written.
