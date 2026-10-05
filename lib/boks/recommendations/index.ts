/**
 * Public surface of the recommendation module.
 *
 * Callers should need only this file. Adding an algorithm never changes it -
 * see `lib/boks/recommendations/strategies/index.ts`.
 */

export {
  buildReaderFeed,
  type RankedStory,
  type ReaderFeedRequest,
  type ReaderFeedResult,
} from "@/lib/boks/recommendations/feed";

export {
  assignExperimentArm,
  defaultExperimentConfig,
  inferUserSegment,
  normalizeExperimentConfig,
  type ExperimentArm,
  type RecommendationExperiment,
  type RecommendationExperimentConfig,
} from "@/lib/boks/recommendations/experiments";

export {
  controlAlgorithmId,
  defaultAlgorithmId,
  describeRecommendationStrategies,
  getRecommendationStrategy,
  isRecommendationAlgorithmId,
  listRecommendationStrategies,
  recommendationAlgorithmName,
  type RecommendationAlgorithmId,
} from "@/lib/boks/recommendations/registry";

export {
  kendallTau,
  measureStrategyDivergence,
  type DivergenceReport,
  type DivergenceVerdict,
  type StrategyPairDivergence,
} from "@/lib/boks/recommendations/divergence";

export {
  buildRecommendationLab,
  emptyRecommendationLab,
  findComparison,
  LAB_COMPARISON_METRICS,
  type ArmSummary,
  type LabOptions,
  type RecommendationLabReport,
} from "@/lib/boks/recommendations/metrics";

export {
  LABELING_VERSION,
  RANKING_VERSION,
  SIGNALS_VERSION,
} from "@/lib/boks/recommendations/versions";

export {
  deriveFeedSignals,
  emptyReaderBokState,
  emptyReaderSignals,
  maxBokMinutes,
  storySignalKeys,
  type ReaderBokState,
  type ReaderSignals,
  type ReadingShape,
  type StoryCandidate,
  type StorySignalKey,
  type StorySignals,
} from "@/lib/boks/recommendations/signals";

export {
  defineStrategy,
  type RankingContext,
  type RecommendationStrategy,
  type ScoredCandidate,
  type StrategyFamily,
} from "@/lib/boks/recommendations/strategy";

export {
  buildReaderProfile,
  compactnessBand,
  isFollowingAuthor,
  lengthBucketFor,
  readerBokState,
  type LengthBucket,
  type ReaderProfile,
} from "@/lib/boks/recommendations/reader-profile";

export { forYou, type CandidateSource } from "@/lib/boks/recommendations/strategies/for-you";
