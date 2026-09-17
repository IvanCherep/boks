import {
  assignExperimentArm,
  defaultExperimentConfig,
  type RecommendationExperiment,
  type RecommendationExperimentConfig,
} from "@/lib/boks/recommendations/experiments";
import { getRecommendationStrategy } from "@/lib/boks/recommendations/registry";
import {
  deriveFeedSignals,
  emptyReaderSignals,
  type ReaderSignals,
  type StoryCandidate,
  type StorySignals,
} from "@/lib/boks/recommendations/signals";
import type { ScoredCandidate } from "@/lib/boks/recommendations/strategy";

/**
 * The one seam every backend ranks through. Supabase and the D1 compatibility
 * API both hand this function candidates and get back an attributed feed, so a
 * strategy is written once and behaves identically everywhere.
 */

export type ReaderFeedRequest = {
  visitorId: string;
  candidates: StoryCandidate[];
  reader?: ReaderSignals;
  experimentConfig?: RecommendationExperimentConfig;
  /**
   * An assignment already resolved elsewhere - in practice the one the database
   * has stored for this reader. Supplied, it wins: recomputing the arm on every
   * load is how a reader's recorded history drifts away from what they were
   * actually served.
   */
  experiment?: RecommendationExperiment;
  /** Admin preview only. Readers never choose an algorithm. */
  requestedAlgorithmId?: string | null;
  limit?: number;
  now?: Date;
};

export type RankedStory = {
  candidate: StoryCandidate;
  rank: number;
  score: number;
  signals: StorySignals;
  /** Present when the ranker explains its placements. */
  explanations?: string[];
  candidateSource?: string;
};

export type ReaderFeedResult = {
  experiment: RecommendationExperiment;
  entries: RankedStory[];
};

export function buildReaderFeed(request: ReaderFeedRequest): ReaderFeedResult {
  const config = request.experimentConfig ?? defaultExperimentConfig;
  const experiment =
    request.experiment ?? assignExperimentArm(request.visitorId, config, request.requestedAlgorithmId);
  const strategy = getRecommendationStrategy(experiment.algorithmId);
  const reader = request.reader ?? emptyReaderSignals;
  const now = request.now ?? new Date();
  const limit = Math.max(1, request.limit ?? 80);

  const signalsById = deriveFeedSignals({
    candidates: request.candidates,
    reader,
    visitorId: request.visitorId,
    now,
  });

  const context = {
    visitorId: request.visitorId,
    userSegment: experiment.userSegment,
    reader,
    limit,
    now,
  };

  const scored: ScoredCandidate[] = request.candidates.map((candidate) => {
    const signals = signalsById.get(candidate.id) as StorySignals;
    return {
      candidate,
      signals,
      score: strategy.score(signals, candidate, context),
    };
  });

  const ordered = strategy.rerank
    ? strategy.rerank([...scored], context)
    : [...scored].sort(compareScoredCandidates);

  return {
    experiment,
    entries: ordered.slice(0, limit).map((entry, index) => ({
      candidate: entry.candidate,
      rank: index,
      score: Math.round(entry.score * 1000) / 1000,
      signals: entry.signals,
      explanations: entry.explanations,
      candidateSource: entry.candidateSource,
    })),
  };
}

/**
 * Reading fatigue is a product rule, not a strategy choice: a boks the reader
 * already skipped or finished never outranks one they have not seen, whatever
 * its signals say. Applying it here keeps every strategy honest about it.
 */
function fatigueTier(entry: ScoredCandidate) {
  if (entry.signals.fatigue >= 1) return 2;
  if (entry.signals.fatigue > 0) return 1;
  return 0;
}

/** Fatigue tier first, then score descending, then newest, then id. */
function compareScoredCandidates(left: ScoredCandidate, right: ScoredCandidate) {
  const tierDifference = fatigueTier(left) - fatigueTier(right);
  if (tierDifference !== 0) return tierDifference;
  if (right.score !== left.score) return right.score - left.score;
  const rightCreated = Date.parse(right.candidate.createdAt) || 0;
  const leftCreated = Date.parse(left.candidate.createdAt) || 0;
  if (rightCreated !== leftCreated) return rightCreated - leftCreated;
  return left.candidate.id.localeCompare(right.candidate.id);
}
