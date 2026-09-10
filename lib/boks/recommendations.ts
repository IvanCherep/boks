import type {
  RecommendationAlgorithm,
  RecommendationAlgorithmId,
  RecommendationExperiment,
  UserSegment,
} from "@/lib/boks/contracts";

export const defaultAlgorithmId: RecommendationAlgorithmId = "balanced";

export const recommendationAlgorithms: RecommendationAlgorithm[] = [
  {
    id: "balanced",
    name: "Balanced quality",
    description: "Control mix of completion, reactions, comments, freshness, and light exploration.",
    userSegment: "all",
    weights: {
      completion: 7,
      finishRate: 0.22,
      likes: 5,
      comments: 6,
      shares: 5,
      freshness: 0,
      exploration: 20,
      shortness: 1,
      skips: 2,
    },
  },
  {
    id: "completion_first",
    name: "Completion first",
    description: "Prioritizes stories that people actually finish after starting.",
    userSegment: "deep_reads",
    weights: {
      completion: 10,
      finishRate: 0.5,
      likes: 3,
      comments: 3,
      shares: 2,
      freshness: 0,
      exploration: 12,
      shortness: 0.5,
      skips: 3,
    },
  },
  {
    id: "reaction_first",
    name: "Reaction first",
    description: "Prioritizes stories that cause likes, shares, and comments quickly.",
    userSegment: "quick_reads",
    weights: {
      completion: 4,
      finishRate: 0.12,
      likes: 8,
      comments: 9,
      shares: 7,
      freshness: 0,
      exploration: 12,
      shortness: 2,
      skips: 2,
    },
  },
  {
    id: "discovery",
    name: "Discovery",
    description: "Gives newer and under-tested stories more chances without ignoring quality.",
    userSegment: "new_reader",
    weights: {
      completion: 4,
      finishRate: 0.14,
      likes: 3,
      comments: 4,
      shares: 3,
      freshness: 8,
      exploration: 34,
      shortness: 1.5,
      skips: 1,
    },
  },
];

export function isRecommendationAlgorithmId(value: string): value is RecommendationAlgorithmId {
  return recommendationAlgorithms.some((algorithm) => algorithm.id === value);
}

export function getRecommendationAlgorithm(id: RecommendationAlgorithmId) {
  return (
    recommendationAlgorithms.find((algorithm) => algorithm.id === id) ??
    recommendationAlgorithms.find((algorithm) => algorithm.id === defaultAlgorithmId) ??
    recommendationAlgorithms[0]
  );
}

export function resolveRecommendationExperiment(
  visitorId: string,
  requestedAlgorithmId?: string | null
): RecommendationExperiment {
  const userSegment = inferUserSegment(visitorId);

  if (requestedAlgorithmId && isRecommendationAlgorithmId(requestedAlgorithmId)) {
    const algorithm = getRecommendationAlgorithm(requestedAlgorithmId);
    return {
      algorithmId: algorithm.id,
      algorithmName: algorithm.name,
      userSegment,
      source: "requested",
    };
  }

  const candidates = recommendationAlgorithms.filter(
    (algorithm) => algorithm.userSegment === "all" || algorithm.userSegment === userSegment
  );
  const algorithm = candidates[stableHash(`${visitorId}:algorithm`) % candidates.length] ?? getRecommendationAlgorithm(defaultAlgorithmId);

  return {
    algorithmId: algorithm.id,
    algorithmName: algorithm.name,
    userSegment,
    source: "assigned",
  };
}

export function recommendationOrderSql(algorithmId: RecommendationAlgorithmId) {
  const { weights } = getRecommendationAlgorithm(algorithmId);
  return `
    s.is_seed ASC,
    (
      COALESCE(er.completes, 0) * ${weights.completion} +
      COALESCE(er.likes, 0) * ${weights.likes} +
      COALESCE(cr.comments, 0) * ${weights.comments} +
      COALESCE(er.shares, 0) * ${weights.shares} +
      CASE
        WHEN COALESCE(er.starts, 0) > 0
        THEN (COALESCE(er.completes, 0) * 100.0 / er.starts) * ${weights.finishRate}
        ELSE 0
      END +
      CASE WHEN COALESCE(er.starts, 0) < 4 THEN ${weights.exploration} ELSE 0 END +
      MAX(0, 15 - s.minutes) * ${weights.shortness} +
      ${weights.freshness} / (1 + COALESCE(er.starts, 0)) -
      COALESCE(er.skips, 0) * ${weights.skips} +
      ABS(RANDOM() % 9)
    ) DESC,
    s.created_at DESC`;
}

function inferUserSegment(visitorId: string): UserSegment {
  const bucket = stableHash(`${visitorId || "anonymous"}:segment`) % 100;
  if (bucket < 20) return "new_reader";
  if (bucket < 45) return "quick_reads";
  if (bucket < 70) return "deep_reads";
  return "general";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}
