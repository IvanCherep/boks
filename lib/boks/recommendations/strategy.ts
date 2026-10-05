import type { UserSegment } from "@/lib/boks/contracts";
import type { ReaderSignals, StoryCandidate, StorySignalKey, StorySignals } from "@/lib/boks/recommendations/signals";

/**
 * A recommendation strategy is the extension point of the feed. Adding one means
 * writing a single file with a name, a description and either signal weights or
 * a custom score function, then listing it in `strategies/index.ts`.
 */

export type StrategyFamily = "quality" | "engagement" | "exploration" | "personal" | "baseline";

export type RankingContext = {
  visitorId: string;
  userSegment: UserSegment;
  reader: ReaderSignals;
  limit: number;
  now: Date;
};

export type ScoredCandidate = {
  candidate: StoryCandidate;
  signals: StorySignals;
  score: number;
  /**
   * Why this item scored as it did, in the ranker's own words.
   *
   * Optional because most strategies are a weighted sum whose explanation is
   * its weight table. A ranker that composes contributions can say something
   * a weight table cannot, and it is stored with the served slate so a feed is
   * auditable rather than merely reproducible.
   */
  explanations?: string[];
  /** Retrieval family this candidate belongs to, when the ranker has one. */
  candidateSource?: string;
};

export type RecommendationStrategy = {
  id: string;
  name: string;
  /** One sentence an operator can read in the admin lab. */
  description: string;
  family: StrategyFamily;
  /** Declared weights, kept for display even when `score` is custom. */
  weights: Partial<Record<StorySignalKey, number>>;
  score: (signals: StorySignals, candidate: StoryCandidate, context: RankingContext) => number;
  /** Optional second pass for strategies that need set-level shaping. */
  rerank?: (scored: ScoredCandidate[], context: RankingContext) => ScoredCandidate[];
  /**
   * True only for a strategy whose `rerank` grades reading fatigue itself.
   * Every other strategy - including any new one with a `rerank` - gets the
   * shared fatigue tiering applied after it, because a boks the reader already
   * skipped or finished never outranking an unseen one is a product rule.
   */
  handlesFatigue?: boolean;
};

export type StrategyDefinition = {
  id: string;
  name: string;
  description: string;
  family: StrategyFamily;
  weights?: Partial<Record<StorySignalKey, number>>;
  score?: RecommendationStrategy["score"];
  rerank?: RecommendationStrategy["rerank"];
  handlesFatigue?: boolean;
};

/**
 * Declares one strategy. With only `weights` the score is the weighted sum of
 * the named signals, which covers most algorithms. `score` and `rerank` are
 * escape hatches for strategies that are not a linear blend.
 */
export function defineStrategy<const Definition extends StrategyDefinition>(definition: Definition) {
  const weights = definition.weights ?? {};

  return {
    ...definition,
    weights,
    score: definition.score ?? ((signals) => weightedScore(signals, weights)),
  } satisfies RecommendationStrategy & { id: Definition["id"] };
}

function weightedScore(signals: StorySignals, weights: Partial<Record<StorySignalKey, number>>) {
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (typeof weight !== "number") continue;
    total += (signals[key as StorySignalKey] ?? 0) * weight;
  }
  return total;
}
