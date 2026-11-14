# Analytics, and whether they carry the thesis

The thesis is *Cohort-Aware Behavioral Evaluation and Regression Testing of
Sequential Recommender Systems*. That title makes four claims, and this
document says, for each one, what the system can currently prove, what it
cannot, and what the gap costs to close.

Written to be read by a supervisor, and to be handed to someone who asks what
the product knows and how.

---

## The short answer

**Behavioral evaluation: yes, and it is the strongest part.** The analysis unit
is the reader, the estimator is non-parametric, the console refuses to report
below its minimum sample, and the raw rows export so the result can be
recomputed by someone who distrusts the code.

**Cohort-aware: now possible, not yet demonstrated.** Every outcome row carries
the reader's cohort week and tenure, and the console splits the comparison into
first-week and later readers. At 50 readers each side is underpowered; the
mechanism is in place and the demonstration waits on sample size.

**Sequential: partly.** Slate position is recorded on every event and the
provenance tables reconstruct the exact slate a reader saw. Nothing analyses
position yet, so the sequential dimension is collected and unused.

**Regression testing: no.** This is the real gap. There is a divergence gate
that compares rankers, but it runs as a script and stores nothing, so the
system cannot say whether a code change altered ranking behaviour. A thesis
chapter on regression testing needs a persisted baseline per ranker version.

One more constraint outranks all four: **at 50 readers an A/B comparison of two
rankers resolves almost nothing.** The designed answer - interleaving - was
specified and never built. That is the second real gap, and the one that
decides whether the empirical chapter has a result in it.

---

## What is collected

Every reading event carries, per row:

| Field | Why it exists |
|---|---|
| `event_type` | impression, start, complete, skip, like, share, comment, heartbeat |
| `user_id`, `session_id` | the reader, and the sitting |
| `reel_id` | the piece |
| `active_seconds` | foreground-only, capped per gap at 120s, cumulative per (session, piece), rolled up with `max()` so a repeated heartbeat cannot inflate it |
| `progress` | share of the text reached |
| `rank` | the piece's position in the slate it was served from |
| `algorithm_id`, `experiment_key`, `user_segment` | which arm produced it |
| `feed_id` | the slate, so a serve is reconstructible |
| `labeling_version`, `ranker_version` | the rules in force when the row was written |
| `client_elapsed_seconds` | time from serve to reaction |

And per slate, in `served_feed` / `served_feed_item`: the reader's profile
snapshot at serve time, the candidate source each item came from, its score,
its explanations, and the catalogue size the ranking saw.

The analysis unit, `get_reader_outcomes`, returns one row per **(reader,
algorithm, day)** with impressions, starts, completes, skips, likes, shares,
comments, boks opened, sessions, active seconds, attributed events, total
events, **cohort week and tenure days**.

### What is deliberately not collected

- No third-party analytics, no session recording, no cross-site identifiers.
- No wall-clock reading time. A locked phone reads nothing.
- No per-reader words-per-minute in the read/skip label. It is displayed as a
  reader property but never feeds the measurement: an instrument that
  recalibrates itself as samples accumulate makes finish rate incomparable
  between readers and drifting for the same one.
- `likes` and `comments` remain product features - like state, the thread - and
  are never used as behavioural metrics (the `views` table was dropped on
  2026-11-16; reading history now reads the events). Reader behaviour comes from
  `recommendation_events` only, so there is one source of truth.

---

## Claim by claim

### 1. Behavioral evaluation — supported

The chain is complete and each link is asserted by a test:

1. **Capture.** Foreground-only clock; the read outcome is emitted on session
   end as well as on advance, so the last piece of a session is not lost; the
   event queue de-duplicates on `(session, piece, type)` so a retry cannot
   double-count; the exit flush uses `keepalive` so mobile Safari does not drop
   it.
2. **Unit.** One reader is one observation. Events inside a reader are
   correlated, so a test over events reports significance that is not there -
   this console did exactly that before Phase 1 and called three readers a
   strong signal.
3. **Estimator.** Hodges–Lehmann shift, percentile bootstrap interval,
   permutation test. No means on skewed data, no normal approximation at n=12.
4. **Refusal.** Below the declared minimum the console reports
   `insufficient_data` and prints no estimate, because a number on a screen
   gets quoted and an interval does not.
5. **Power.** Simulated at the spread actually observed, reproducing the
   reference power table to within four percentage points.
6. **Reproducibility.** *Export reader rows* writes the analysis unit as CSV
   with a note stating the unit and the trap, reader ids pseudonymised. The
   intervals can be recomputed in R without touching this codebase.

What is still weak: **`boksOpened` double-counts** a reader who reopens the
same piece on two days, because distinct pieces are counted per day and then
summed. Named in the code rather than hidden; the fix is a distinct count in
SQL and it costs one column.

### 2. Cohort-aware — mechanism in place, demonstration pending

Each outcome row now carries `cohortWeek` (Monday of the week the reader was
first seen, over their whole history) and `tenureDays` (days from that first
sighting to the row's day). The console re-runs the headline comparison for
first-week readers and for everyone older.

This exists because a pooled estimate hides the case the title cares about: an
arm that helps newcomers and hurts regulars averages to nothing and looks
inert. The split can now find that; at this sample size it cannot confirm it,
and the panel says so rather than presenting the subgroup as a finding.

Retention cohorts by join week already exist separately, in Growth.

### 3. Sequential — collected, not analysed

Present: `rank` on every event, the full slate in `served_feed_item` with each
item's score and source, and the reader's profile snapshot at serve time. That
is enough to reconstruct any serve and to measure position effects.

Absent: any analysis of them. Nothing reports whether engagement decays with
slate position, whether an arm wins by ordering better or by retrieving better,
or how a reader's behaviour evolves within a session. For a thesis on
*sequential* recommenders this is the most visible omission relative to what is
already in the database.

Cheap, because nothing new needs collecting: one aggregate over `rank` and a
panel.

### 4. Regression testing — missing

There is `lib/boks/recommendations/divergence.ts` and `npm run
verify:divergence`, which score one candidate set under every registered
strategy and report pairwise overlap@10 and Kendall τ. It answers "do these
rankers differ", which is the go/no-go gate for running an experiment at all.

It does not answer "did this change alter ranking behaviour", because it stores
nothing. There is no baseline, so there is nothing to regress against.

What a regression chapter needs, and does not have:

- a **fixed evaluation set** - a frozen candidate set and reader profiles,
  versioned with the code;
- a **stored fingerprint per ranker version** - the ranking it produces on that
  set, so two versions are comparable;
- a **gate** that fails when a change moves ranking beyond a declared
  tolerance, distinguishing an intended change from an accident;
- **history**, so the thesis can show behaviour over versions rather than at
  one instant.

`ranker_version` is already written on every event, so the labelling side is
ready. What is missing is the baseline and the comparison.

---

## The constraint that decides the empirical chapter

Two arms across 50 active readers is ~25 per arm. Simulated at the spread
reading time actually has, that design detects a **+85% difference** and not
much less. Most real ranking changes are worth a few percent.

So an A/B result at this scale will be "inconclusive", correctly, and the
console will say so. That is honest but it is not a finding.

The designed answer is **interleaving**: both rankers fill one list, each read
credited to whichever proposed that slot, so every comparison is within-reader,
within-session and within-catalogue-state. Reader heterogeneity, catalogue
depletion and period effects cancel exactly, and the paired sign test over
per-reader win fractions resolves differences an independent comparison cannot
see at this size. `comparePaired` and `signTest` are written and tested;
`credited_algorithm_id` is in the contracts. The slate construction is not
built.

Stated limit, which the thesis should state too: interleaving answers *which
ranker picks better items*, not *which makes people come back*. The protocol is
interleaving to screen weekly and pick a challenger, then one long two-arm run
to confirm on time spent.

---

## How the metrics change as readers arrive

Experiments → **How much data do we need?** It answers the question directly,
in two halves:

- **Observed** replays the same estimator on the first *k* readers of each arm,
  for growing *k*, in arrival order. The interval narrowing is shown rather
  than asserted, and an early "result" that later flipped stays visible.
- **Projected** holds the spread measured so far and reports the probability of
  detecting a declared effect at larger samples. A plan, not a forecast, and
  labelled as one.

The panel also states the smallest effect currently visible, and what is
therefore invisible however it looks on screen. This is the screen to open when
someone asks how the product knows anything: it names the sample, the
precision, and the limit.

---

## The working loop

1. **Pick the window.** 7 days for operations, 30 for a comparison.
2. **Check data quality first.** Experiments → Data quality. Any non-zero count
   is a reason to distrust a comparison rather than a number to improve. The
   order matters: a clean-looking effect computed on unattributed events is
   worse than no effect.
3. **Read the refusal.** If the console says `insufficient_data`, the run is
   not ready. Do not read the tiles as a result.
4. **Read the sample-size panel** before the effect, not after.
5. **Export the reader rows** for anything that will be written down. The CSV
   and its note are the reproducible artefact; the JSON export carries the
   conclusions and the configuration beside them.
6. **Record the ranker version.** It is on every event; cite it, because a
   comparison is about a version and not about an idea.

---

## Gaps, ranked

| # | Gap | Cost | Why it matters |
|---|---|---|---|
| 1 | Interleaving not built | Medium: slate construction, credit assignment, a paired panel | Decides whether the empirical chapter has a result at 50 readers |
| 2 | No stored ranker baseline | Medium: a fixed evaluation set, a fingerprint table, a gate | The regression-testing claim in the title is unsupported without it |
| 3 | Position effects not analysed | Low: one aggregate over `rank`, one panel | The sequential dimension is already collected and unused |
| 4 | Genre and mood are constant | Medium: derive both from the text | `tasteMatch` is inert and the arms have little to differ on, which suppresses the effect the experiment is trying to measure |
| 5 | `boksOpened` double-counts across days | Low: a distinct count in SQL | One metric is quietly wrong for returning readers |
| 6 | Reading fatigue is per browser | Low, with a schema change | The same reader on two devices has one arm and two "already read" sets |

Nothing here is a reason not to run the pilot. Items 1 and 2 are the two that
stand between the current system and the thesis as titled.
