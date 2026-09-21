import { defineStrategy, type ScoredCandidate } from "@/lib/boks/recommendations/strategy";
import {
  buildReaderProfile,
  compactnessBand,
  isFollowingAuthor,
  lengthBucketFor,
  readerBokState,
  type LengthBucket,
  type ReaderProfile,
} from "@/lib/boks/recommendations/reader-profile";
import type {
  ReaderBokState,
  ReaderSignals,
  ReadingShape,
  StoryCandidate,
} from "@/lib/boks/recommendations/signals";

/**
 * `for_you` - the ranking from the original boks backend, ported.
 *
 * The original ran in Kotlin over four retrieval sources and scored each
 * candidate as a sum of explained contributions, then selected the slate
 * greedily so that diversity and exploration were decided against the items
 * already placed rather than against the corpus. Both halves are preserved
 * here; the weights are the originals.
 *
 * Three deliberate differences from the original, all of them losses this
 * codebase cannot yet avoid:
 *
 *  - ~~No SEMANTIC source.~~ **Closed on 2026-09-20.** Every bok carries a
 *    384-dimension vector from Supabase's own `gte-small` model (the `embed`
 *    Edge Function), the database averages what a reader liked or finished
 *    into a taste vector, and `get_recommendation_candidates` returns two
 *    numbers per candidate: similarity to that taste vector, and distance
 *    from what the reader has been reading lately. Both are used below. Two
 *    things about them are worth knowing: a raw cosine from this model sits
 *    around 0.6-0.9 for almost any pair of short literary texts, so what is
 *    scored here is a candidate's **standing within its own candidate set**
 *    (a z-score), never the raw number; and a reader with nothing liked or
 *    finished has no taste vector, so the semantic terms are absent rather
 *    than zero, and the ranker is exactly what it was before them.
 *  - **No explicit negative feedback.** The original had `NOT_INTERESTED` and
 *    `HIDE_AUTHOR` events, worth 3.6 and 4.8 of negative weight. This product
 *    has neither control yet, so the negative side of the profile rests
 *    entirely on implicit evidence - repeated exposure without attention.
 *  - **No retrieval stage at all.** With a corpus of tens, every ranker sees
 *    every item, so `source` classifies a candidate rather than describing
 *    where it came from.
 *
 * Unlike every other strategy here, `for_you` does its own fatigue handling
 * through the skip penalty, so `buildReaderFeed` does not tier it separately.
 */

export type CandidateSource = "resume" | "affinity" | "semantic" | "discovery";

const sourcePriority: Record<CandidateSource, number> = {
  resume: 1,
  affinity: 2,
  semantic: 3,
  discovery: 4,
};

const sourceBoost: Record<CandidateSource, number> = {
  resume: 3.8,
  affinity: 2.4,
  semantic: 1.95,
  discovery: 0.8,
};

const sourceExplanation: Record<CandidateSource, string> = {
  resume: "resume candidate from prior reading",
  affinity: "matched prior author or format affinity",
  semantic: "retrieved from semantic similarity to prior reading",
  discovery: "discovery candidate from fresh, emerging or quality backlog",
};

const compactShapes = new Set<ReadingShape>(["verse", "short_prose"]);

/**
 * Liked-or-finished boks the taste vector must be averaged from before the
 * semantic terms are trusted. One like is a mood, not a taste.
 */
const minimumTasteSamples = 2;

/** Standard deviations above the set's mean similarity to call a piece SEMANTIC. */
const semanticSourceThreshold = 0.75;

type Spread = { mean: number; spread: number };

type SemanticStanding = {
  /** How many liked or finished embedded boks the taste vector came from. */
  samples: number;
  taste: Spread;
  novelty: Spread;
};

/**
 * Where each candidate stands against the rest of the set.
 *
 * Raw cosine similarity from `gte-small` is nearly useless as an absolute
 * number: two unrelated short poems still score around 0.7, so a threshold on
 * the raw value either admits everything or nothing, and it moves with the
 * model. The spread within one candidate set does not, and it is what ranking
 * actually needs - "closer to this reader's taste than the alternatives".
 */
function semanticStanding(candidates: readonly StoryCandidate[]): SemanticStanding {
  return {
    samples: candidates.reduce((most, candidate) => Math.max(most, candidate.tasteSamples ?? 0), 0),
    taste: spreadOf(candidates.map((candidate) => candidate.tasteSimilarity)),
    novelty: spreadOf(candidates.map((candidate) => candidate.noveltyDistance)),
  };
}

function spreadOf(values: readonly (number | null | undefined)[]): Spread {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length < 4) return { mean: 0, spread: 0 };
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length;
  const variance = present.reduce((sum, value) => sum + (value - mean) ** 2, 0) / present.length;
  const spread = Math.sqrt(variance);
  // A set whose similarities are all but identical carries no information, and
  // dividing by that spread would turn rounding noise into a ranking signal.
  return { mean, spread: spread >= 0.004 ? spread : 0 };
}

function standing(value: number | null | undefined, spread: Spread) {
  if (typeof value !== "number" || !Number.isFinite(value) || spread.spread <= 0) return 0;
  return (value - spread.mean) / spread.spread;
}

type Contribution = { value: number; explanation: string };

type Scored = {
  candidate: StoryCandidate;
  source: CandidateSource;
  /** How this candidate's taste similarity stands against the set, in sd. */
  semanticZ: number;
  /** How unlike the reader's recent stretch it is, against the set, in sd. */
  noveltyZ: number;
  state: ReaderBokState;
  following: boolean;
  authorAffinity: number;
  shapeAffinity: number;
  lengthAffinity: number;
  shape: ReadingShape;
  bucket: LengthBucket;
  base: Contribution[];
};

export const forYou = defineStrategy({
  id: "for_you",
  name: "For you",
  description:
    "Ported from the original boks ranker: resume, affinity and discovery sources scored on reader history, author trust and freshness, then a greedy slate that spaces authors, shapes and lengths.",
  family: "personal",
  segment: "all",
  // Declared for display only. This ranker is not a weighted sum of the shared
  // signals; it scores its own contributions and explains each one.
  weights: {},
  score: () => 0,
  rerank: (scored, context) => {
    const candidates = scored.map((entry) => entry.candidate);
    const profile = buildReaderProfile({ reader: context.reader, candidates, now: context.now });
    // Computed once over the whole set: a semantic score only means something
    // next to the other candidates it is competing with.
    const semantic = semanticStanding(candidates);
    const prepared = scored.map((entry) =>
      prepare(entry.candidate, context.reader, profile, context.now, semantic)
    );

    return selectSlate(prepared, scored, context.limit);
  },
});

function prepare(
  candidate: StoryCandidate,
  reader: ReaderSignals,
  profile: ReaderProfile,
  now: Date,
  semantic: SemanticStanding
): Scored {
  const state = readerBokState(reader, candidate.id);
  const following = isFollowingAuthor(reader, candidate);
  const shape = candidate.readingShape ?? "unknown";
  const bucket = lengthBucketFor(candidate.minutes);
  const authorAffinity = candidate.authorUserId
    ? profile.authorAffinity[candidate.authorUserId] ?? 0
    : 0;
  const shapeAffinity = profile.shapeAffinity[shape] ?? 0;
  const lengthAffinity = profile.lengthAffinity[bucket] ?? 0;
  const semanticZ = standing(candidate.tasteSimilarity, semantic.taste);
  const noveltyZ = standing(candidate.noveltyDistance, semantic.novelty);
  const semanticEvidence = semantic.samples >= minimumTasteSamples;
  const source = classify(
    state,
    following,
    authorAffinity,
    shapeAffinity,
    lengthAffinity,
    semanticEvidence ? semanticZ : 0
  );

  return {
    candidate,
    source,
    semanticZ,
    noveltyZ,
    state,
    following,
    authorAffinity,
    shapeAffinity,
    lengthAffinity,
    shape,
    bucket,
    base: baseContributions({
      candidate,
      source,
      state,
      following,
      authorAffinity,
      shapeAffinity,
      lengthAffinity,
      shape,
      profile,
      now,
      semanticZ: semanticEvidence ? semanticZ : null,
      noveltyZ: semantic.novelty.spread > 0 ? noveltyZ : null,
    }),
  };
}

/**
 * Which family this candidate belongs to.
 *
 * In the original this was decided by which query returned the row. Here there
 * is one query, so the same distinction is drawn from the reader's history:
 * something started and not finished is a resume, something connected to a
 * known preference is affinity, everything else is discovery.
 */
function classify(
  state: ReaderBokState,
  following: boolean,
  authorAffinity: number,
  shapeAffinity: number,
  lengthAffinity: number,
  semanticZ: number
): CandidateSource {
  const unfinished = !state.completedAt;
  if (unfinished && (state.maxProgress >= 0.05 || state.totalDwellSeconds >= 10)) return "resume";
  if (following || authorAffinity > 0.05 || shapeAffinity > 0.05 || lengthAffinity > 0.05) {
    return "affinity";
  }
  // Behavioural evidence first, meaning second - which is also the original's
  // ordering of the two sources' boosts. This branch is what makes the fourth
  // source real: a piece by an author the reader has never met, in a form they
  // have no history with, that reads like what they keep finishing.
  if (semanticZ >= semanticSourceThreshold) return "semantic";
  return "discovery";
}

function baseContributions(input: {
  candidate: StoryCandidate;
  source: CandidateSource;
  state: ReaderBokState;
  following: boolean;
  authorAffinity: number;
  shapeAffinity: number;
  lengthAffinity: number;
  shape: ReadingShape;
  profile: ReaderProfile;
  now: Date;
  /** Null when this reader has no taste vector yet: absent, not zero. */
  semanticZ: number | null;
  /** Null when the set's novelty distances carry no spread. */
  noveltyZ: number | null;
}): Contribution[] {
  const { candidate, source, state, profile, now } = input;
  const out: Contribution[] = [];
  const add = (value: number, explanation: string) => {
    if (value > 0) out.push({ value, explanation });
  };
  const subtract = (value: number, explanation: string) => {
    if (value > 0) out.push({ value: -value, explanation });
  };
  const signed = (value: number, positive: string, negative: string) => {
    if (value > 0) out.push({ value, explanation: positive });
    else if (value < 0) out.push({ value, explanation: negative });
  };

  const progressPct = clamp(state.maxProgress, 0, 1) * 100;
  const dwellMs = Math.max(0, state.totalDwellSeconds) * 1000;

  out.push({ value: sourceBoost[source], explanation: sourceExplanation[source] });

  // Progress is evidence for *resuming*, so a boks the reader already finished
  // earns none of it. The original relied on retrieval to keep finished pieces
  // out of the candidate pool; there is no retrieval stage here, so the scorer
  // has to say it. Without this, the best-read boks in the corpus is served
  // back to the reader who just finished it.
  add(
    state.completedAt ? 0 : (Math.min(progressPct, 95) / 100) * 3.4,
    progressPct >= 60
      ? "high prior reading progress"
      : progressPct >= 25
        ? "meaningful prior reading progress"
        : "some prior reading progress"
  );

  if (source === "resume") {
    const [confidence, why] = state.commented
      ? [0.7, "commented on this bok before"]
      : state.liked
        ? [0.6, "liked this bok before"]
        : progressPct >= 60
          ? [0.8, "deep prior progress supports resume"]
          : progressPct >= 30
            ? [0.55, "moderate prior progress supports resume"]
            : dwellMs >= 20_000
              ? [0.35, "strong dwell time supports resume"]
              : [0, ""];
    add(confidence, why);
  }

  const engaged = state.liked || state.commented || progressPct >= 15 || dwellMs >= 12_000;
  add(engaged ? Math.min(0.45, Math.max(0, state.seenCount) * 0.09) : 0, "repeated engaged exposures");
  add(dwellMs < 4000 ? 0 : Math.min(0.8, dwellMs / 60_000), "strong dwell time");
  add(input.following ? 0.7 : 0, "following this author");
  add(state.liked ? 0.55 : 0, "explicit like signal");
  add(state.commented ? 0.75 : 0, "explicit comment signal");

  signed(
    clamp(input.authorAffinity, -1.2, 1.2) * 0.85,
    "positive author affinity",
    "negative author affinity from skips"
  );
  signed(
    clamp(input.lengthAffinity, -1, 1) * 0.9,
    "preferred read length",
    "negative read-length affinity"
  );
  signed(
    clamp(input.shapeAffinity, -0.9, 0.9) * 0.75,
    "preferred reading shape",
    "negative reading-shape affinity"
  );

  // Meaning, as the model reads it. Scaled like the affinity terms above and
  // bounded, so a single strange vector cannot decide a slate. The negative
  // side is deliberately weaker: "unlike what you liked" is weak evidence
  // against a piece, while "like what you liked" is decent evidence for it.
  if (input.semanticZ !== null) {
    const z = clamp(input.semanticZ, -1.6, 1.6);
    signed(
      z > 0 ? z * 1.05 : z * 0.55,
      z >= 1 ? "reads like the boks this reader finishes" : "close, by meaning, to this reader's taste",
      "unlike this reader's taste, by meaning"
    );
  }

  // The way out of a rut. Only on discovery: nudging a resume or an affinity
  // pick towards novelty would be arguing with better evidence.
  if (source === "discovery" && input.noveltyZ !== null) {
    add(clamp(input.noveltyZ, 0, 1.6) * 0.5, "unlike the stretch this reader has just been reading");
  }

  // How far to trust the light content heuristics. A reader with no history
  // gets them at a fifth strength, so a cold start never looks like taste.
  const heuristicWeight =
    profile.personalizationStrength >= 2 ? 1 : profile.personalizationStrength >= 0.75 ? 0.65 : 0.2;

  const quality = qualityPrior(candidate);
  const trust = authorTrust(candidate);
  const fresh = freshnessPrior(candidate, now);
  const cold = coldStartPrior(candidate, now);

  add(
    source === "discovery" ? Math.min(1.35, quality * 0.52) : Math.min(1.2, quality * 0.42),
    "global quality prior"
  );
  add(
    source === "discovery" ? Math.min(0.18, trust * 0.18) : Math.min(0.55, trust * 0.5),
    "author trust prior"
  );
  if (source === "discovery") {
    add(Math.min(1.1, fresh * 0.95), "fresh supply exploration prior");
    const published = candidate.authorPublishedCount ?? 0;
    add(
      Math.min(1.6, cold * 1.05),
      published <= 1
        ? "new author cold-start prior"
        : published <= 3
          ? "emerging author exploration prior"
          : "low-exposure author exploration prior"
    );
  }

  add(
    heuristicWeight *
      (input.shape === "verse"
        ? 0.04
        : input.shape === "short_prose"
          ? 0.02
          : input.shape === "long_prose"
            ? 0.05
            : 0),
    "light format heuristic"
  );
  add(
    heuristicWeight *
      (candidate.minutes <= 0 ? 0 : candidate.minutes <= 1 ? 0.03 : candidate.minutes <= 3 ? 0.04 : 0.05),
    "light read-time heuristic"
  );
  const lineBreaks = candidate.lineBreakCount ?? 0;
  add(
    heuristicWeight *
      (lineBreaks >= 4 && input.shape !== "long_prose" ? 0.02 : lineBreaks >= 2 ? 0.01 : 0),
    "light line-break heuristic"
  );

  const ageHours = hoursSince(candidate.createdAt, now);
  add(ageHours < 24 ? 0.24 : ageHours < 72 ? 0.14 : ageHours < 168 ? 0.03 : 0, "recent publication");

  const touched =
    state.liked || state.commented || progressPct >= 10 || dwellMs >= 4000 || state.seenCount >= 2 || state.quickSkipCount > 0;
  if (touched && state.lastEventAt) {
    const interactionAge = hoursSince(state.lastEventAt, now);
    add(interactionAge <= 24 ? 0.35 : interactionAge <= 168 ? 0.12 : 0, "recent interaction with this bok");
  }

  add(
    heuristicWeight *
      (candidate.wordCount <= 0 ? 0 : candidate.wordCount <= 90 ? 0.01 : candidate.wordCount <= 300 ? 0.008 : 0.005),
    "light short-body heuristic"
  );

  // Already read, and nothing left to resume.
  //
  // Every other strategy in this registry gets this for free from the fatigue
  // tiering in `buildReaderFeed`, which `for_you` opts out of. The original
  // never needed it because its retrieval queries excluded finished pieces; a
  // ranker over the whole corpus has to state it. A liked piece is demoted less
  // - rereading something you loved is a smaller mistake than rereading
  // something you merely got through.
  subtract(
    state.completedAt ? (state.liked ? 1.8 : 3.0) : 0,
    state.liked ? "already finished and liked" : "already finished"
  );
  subtract(Math.max(0, -input.authorAffinity) * 0.7, "author mismatch penalty");
  subtract(Math.max(0, -input.shapeAffinity) * 0.55, "shape mismatch penalty");
  subtract(Math.max(0, -input.lengthAffinity) * 0.65, "length mismatch penalty");
  subtract(skipPenalty(state, progressPct, dwellMs), "skip penalty from low-dwell exposures");

  return out;
}

/**
 * The cost of showing something this reader has already passed over.
 *
 * This is what replaces the shared fatigue tiering for `for_you`: it is graded
 * by how emphatically the reader declined rather than binary, and any explicit
 * positive act cancels it entirely.
 */
function skipPenalty(state: ReaderBokState, progressPct: number, dwellMs: number) {
  if (state.liked || state.commented || progressPct >= 30 || dwellMs >= 20_000) return 0;
  if (state.quickSkipCount >= 3 && progressPct < 10) return 2.2;
  if (state.quickSkipCount >= 2 && progressPct < 12) return 1.45;
  if (state.quickSkipCount >= 1 && state.seenCount === 0 && progressPct <= 5) return 0.95;
  if (state.seenCount >= 3 && progressPct < 10 && dwellMs < 7000) return 2.0;
  if (state.seenCount >= 2 && progressPct < 15 && dwellMs < 10_000) return 1.2;
  if (state.seenCount >= 1 && progressPct === 0 && dwellMs < 4000) return 0.9;
  return 0;
}

/**
 * Greedy slate selection.
 *
 * Each pick is scored against the items already placed, so diversity and the
 * exploration budget are decided in context. Selecting by a fixed score and
 * then shuffling for variety would give a different, worse slate: the point is
 * that the cost of another piece by the same author depends on what precedes it.
 */
function selectSlate(prepared: Scored[], original: ScoredCandidate[], limit: number) {
  const byId = new Map(original.map((entry) => [entry.candidate.id, entry]));
  const remaining = [...prepared];
  const placed: Scored[] = [];
  const out: ScoredCandidate[] = [];
  const wanted = Math.min(limit, remaining.length);

  while (placed.length < wanted && remaining.length) {
    let bestIndex = 0;
    let best: { total: number; explanations: string[] } | null = null;

    for (let index = 0; index < remaining.length; index += 1) {
      const scored = slateScore(remaining[index], placed);
      if (!best || isBetter(remaining[index], scored, remaining[bestIndex], best)) {
        best = scored;
        bestIndex = index;
      }
    }

    const winner = remaining.splice(bestIndex, 1)[0];
    placed.push(winner);
    const entry = byId.get(winner.candidate.id);
    if (entry) {
      out.push({
        ...entry,
        score: round(best?.total ?? 0, 4),
        explanations: best?.explanations ?? [],
        candidateSource: winner.source,
      });
    }
  }

  // Anything beyond the limit keeps a stable, explainable order rather than
  // an arbitrary one: the feed may be extended later from this same slate.
  for (const leftover of remaining) {
    const entry = byId.get(leftover.candidate.id);
    if (entry) {
      out.push({ ...entry, score: 0, explanations: [], candidateSource: leftover.source });
    }
  }

  return out;
}

function isBetter(
  candidate: Scored,
  score: { total: number },
  incumbent: Scored,
  incumbentScore: { total: number }
) {
  if (score.total !== incumbentScore.total) return score.total > incumbentScore.total;
  if (candidate.source !== incumbent.source) {
    return sourcePriority[candidate.source] < sourcePriority[incumbent.source];
  }
  if (candidate.state.maxProgress !== incumbent.state.maxProgress) {
    return candidate.state.maxProgress > incumbent.state.maxProgress;
  }
  const created = Date.parse(candidate.candidate.createdAt) - Date.parse(incumbent.candidate.createdAt);
  if (created) return created > 0;
  // Total order, so the same inputs always produce the same slate.
  return candidate.candidate.id > incumbent.candidate.id;
}

function slateScore(candidate: Scored, placed: Scored[]) {
  const contributions: Contribution[] = [...candidate.base];
  const push = (value: number, explanation: string) => {
    if (value > 0) contributions.push({ value, explanation });
  };

  push(diversityBoost(candidate, placed), "diversity boost to avoid monotony");
  push(discoverySpacingBoost(candidate, placed), "discovery spacing boost");
  push(explorationBudgetBoost(candidate, placed), "exploration budget for unseen authors");
  push(lowHistoryDiscoveryBoost(candidate, placed), "low-history discovery budget");

  const penalty = diversityPenalty(candidate, placed);
  if (penalty > 0) contributions.push({ value: -penalty, explanation: "diversity penalty from recent streaks" });

  const total = contributions.reduce((sum, entry) => sum + entry.value, 0);

  return {
    total,
    explanations: contributions
      .filter((entry) => Math.abs(entry.value) >= 0.18)
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
      .map((entry) => entry.explanation)
      .filter((explanation, index, all) => all.indexOf(explanation) === index)
      .slice(0, 4),
  };
}

function diversityPenalty(candidate: Scored, placed: Scored[]) {
  if (!placed.length) return 0;

  const recent = placed.slice(-4);
  const last = placed[placed.length - 1];
  const reversed = [...recent].reverse();
  const authorStreak = streak(reversed, (entry) => sameAuthor(entry, candidate));
  const shapeStreak = streak(reversed, (entry) => entry.shape === candidate.shape);
  const lengthStreak = streak(reversed, (entry) => entry.bucket === candidate.bucket);
  const authorCount = recent.filter((entry) => sameAuthor(entry, candidate)).length;

  let penalty = 0;
  if (authorStreak >= 2) penalty += 2.8;
  else if (authorStreak === 1) penalty += 0.85;
  if (authorCount >= 2) penalty += 0.45;
  if (shapeStreak >= 2) penalty += 0.45;
  if (lengthStreak >= 2) penalty += 0.25;
  if (compactShapes.has(last.shape) && compactShapes.has(candidate.shape)) penalty += 0.35;
  if (compactnessBand(last.bucket) <= 1 && compactnessBand(candidate.bucket) <= 1) penalty += 0.25;
  return penalty;
}

/** A long piece after a run of short ones is a relief, not a risk. */
function diversityBoost(candidate: Scored, placed: Scored[]) {
  if (!placed.length) return 0;
  const last = placed[placed.length - 1];
  let boost = 0;
  if (compactShapes.has(last.shape) && candidate.shape === "long_prose") boost += 1.2;
  if (compactnessBand(last.bucket) <= 1 && compactnessBand(candidate.bucket) >= 2) boost += 0.8;
  return boost;
}

function discoverySpacingBoost(candidate: Scored, placed: Scored[]) {
  if (candidate.source !== "discovery" || !placed.length) return 0;
  const recent = placed.slice(-3);
  if (!recent.some((entry) => entry.source === "discovery")) return 0.45;
  if (recent[recent.length - 1]?.source !== "discovery") return 0.18;
  return 0;
}

function explorationBudgetBoost(candidate: Scored, placed: Scored[]) {
  if (candidate.source !== "discovery") return 0;
  const deficit = discoveryBudgetDeficit(placed);
  if (deficit <= 0) return 0;

  const position = placed.length + 1;
  let boost = position <= 4 ? 1.45 : position <= 8 ? 1.1 : position <= 12 ? 0.85 : 0.55;
  if (!candidate.following && Math.abs(candidate.authorAffinity) < 0.1) boost += 0.38;
  const cold = coldStartPrior(candidate.candidate, new Date(candidate.candidate.createdAt));
  if (cold > 0) boost += Math.min(0.55, cold * 0.35);
  if (Math.abs(candidate.shapeAffinity) < 0.12 && Math.abs(candidate.lengthAffinity) < 0.12) boost += 0.18;
  return boost * deficit;
}

function lowHistoryDiscoveryBoost(candidate: Scored, placed: Scored[]) {
  if (candidate.source !== "discovery" || discoveryBudgetDeficit(placed) <= 0) return 0;
  let boost = 0;
  if (candidate.state.seenCount === 0 && !candidate.state.lastEventAt) boost += 0.34;
  if (
    candidate.state.quickSkipCount === 0 &&
    candidate.state.maxProgress === 0 &&
    candidate.state.totalDwellSeconds === 0
  ) {
    boost += 0.12;
  }
  return boost;
}

/**
 * How far the slate is behind its exploration target.
 *
 * The first three slots are exploitation - the reader has just opened the app
 * and should meet something good. The budget then grows roughly one discovery
 * per four slots, so a long session keeps meeting new authors.
 */
function discoveryBudgetDeficit(placed: Scored[]) {
  const position = placed.length + 1;
  const target =
    position < 4 ? 0 : position < 8 ? 1 : position < 12 ? 2 : 3 + Math.floor((position - 12) / 4);
  const current = placed.filter((entry) => entry.source === "discovery").length;
  return Math.max(0, target - current);
}

function qualityPrior(candidate: StoryCandidate) {
  // `impressions` stands in for the original's view count: both are exposure.
  const exposure = Math.max(0, candidate.impressions);
  const likes = Math.max(0, candidate.likes);
  const comments = Math.max(0, candidate.comments);
  const followers = Math.max(0, candidate.authorFollowers ?? 0);

  return Math.min(
    2.45,
    Math.log1p(likes) * 0.38 +
      Math.log1p(comments) * 0.58 +
      Math.log1p(exposure) * 0.08 +
      ((likes * 1.6 + comments * 2.4) / Math.max(exposure, 32)) * 3.2 +
      Math.min(0.35, Math.log1p(followers) * 0.1)
  );
}

function authorTrust(candidate: StoryCandidate) {
  return Math.min(1.2, Math.log1p(Math.max(0, candidate.authorFollowers ?? 0)) * 0.24);
}

function freshnessPrior(candidate: StoryCandidate, now: Date) {
  const days = hoursSince(candidate.createdAt, now) / 24;
  if (days <= 2) return 0.95;
  if (days <= 7) return 0.55;
  if (days <= 21) return 0.2;
  return 0;
}

/**
 * How much a piece deserves exposure it has not had yet.
 *
 * A new author with nothing published has no counters for the quality prior to
 * read, so without this they would never be served and never acquire any.
 */
function coldStartPrior(candidate: StoryCandidate, now: Date) {
  const published = candidate.authorPublishedCount ?? 0;
  const followers = Math.max(0, candidate.authorFollowers ?? 0);
  const days = hoursSince(candidate.createdAt, now) / 24;

  if (published <= 1) return 1.15;
  if (published <= 3) return 0.85;
  if (followers <= 12 && candidate.likes <= 2 && candidate.comments <= 1 && candidate.impressions <= 40) {
    return 0.55;
  }
  if (followers <= 30 && days <= 14) return 0.25;
  return 0;
}

/**
 * Author identity for diversity, falling back to the handle.
 *
 * Seeded boks carry no account id. Keying on the boks id instead would make
 * every one of them a distinct author and silently disable author spacing -
 * the single largest term in the diversity penalty.
 */
/**
 * Who wrote it, for the purpose of not serving two in a row.
 *
 * The byline comes first: it is the writer. The account comes second, because
 * an author publishing their own work has no byline and their handle is the
 * only identity there is. Ordering these the other way round makes every
 * piece in a publisher's catalogue look like one author.
 */
function authorKey(entry: Scored) {
  const byline = entry.candidate.authorName?.trim().toLowerCase();
  if (byline) return `byline:${byline}`;
  return entry.candidate.authorUserId || `handle:${entry.candidate.authorHandle ?? ""}` || `bok:${entry.candidate.id}`;
}

function sameAuthor(left: Scored, right: Scored) {
  return authorKey(left) === authorKey(right);
}

function streak(reversed: Scored[], matches: (entry: Scored) => boolean) {
  let count = 0;
  for (const entry of reversed) {
    if (!matches(entry)) break;
    count += 1;
  }
  return count;
}

function hoursSince(timestamp: string, now: Date) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - parsed) / 3_600_000);
}

function clamp(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function round(value: number, digits: number) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
