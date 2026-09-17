import type { UserSegment } from "@/lib/boks/contracts";
import {
  controlAlgorithmId,
  defaultAlgorithmId,
  isRecommendationAlgorithmId,
  recommendationAlgorithmName,
} from "@/lib/boks/recommendations/registry";
import { stableHash } from "@/lib/boks/recommendations/signals";

/**
 * An experiment is the traffic split between strategies. It is data, not code,
 * so the founder can change which algorithms are live from `/admin` without a
 * deploy, while assignment stays deterministic for each reader.
 */

export type ExperimentArm = {
  algorithmId: string;
  /** Relative share of traffic. Zero parks an arm without deleting it. */
  weight: number;
};

export type RecommendationExperimentConfig = {
  key: string;
  controlAlgorithmId: string;
  arms: ExperimentArm[];
  /** Impressions an arm needs before the lab calls its numbers readable. */
  minimumImpressionsPerArm: number;
  updatedAt?: string | null;
};

export type RecommendationExperiment = {
  experimentKey: string;
  algorithmId: string;
  algorithmName: string;
  userSegment: UserSegment;
  source: "assigned" | "requested" | "fallback";
};

/**
 * Two arms, and two arms that actually differ.
 *
 * Three decisions are baked in here, all of them measurements rather than
 * opinions (`npm run verify:divergence`, measured 2026-09-14 on 38 boks):
 *
 * 1. Two arms, not four. Splitting a few dozen readers four ways leaves ~12 per
 *    arm, where the power to detect even a doubling of reading time is around
 *    50%. Two arms doubles the sample behind every comparison for free.
 *
 * 2. `for_you` is the control. It is the product ranker - ported from the
 *    original backend, with retrieval families, reader history, author trust
 *    and a greedy diverse slate. Everything else is a challenger to it.
 *
 * 3. The challenger is `completion_first`, and **not** `recency`, which is the
 *    pairing a young product would normally want. It was measured and rejected:
 *    against a cold reader `for_you` and `recency` share 100% of their top ten,
 *    and even against a reader with two weeks of history they share 80%. On
 *    this corpus almost nothing distinguishes them - every seeded boks is the
 *    same length, no author has published enough to move the cold-start prior,
 *    and what remains for both rankers is freshness. `completion_first` shares
 *    30-40%, so it is the only live pairing that can resolve anything at all.
 *
 * Revisit (3) once the catalog carries varied lengths and real authors: at that
 * point `for_you` vs `recency` becomes the question worth asking, because it
 * asks whether ranking is worth anything against showing the newest boks.
 */
export const defaultExperimentConfig: RecommendationExperimentConfig = {
  key: "boks-feed-v1",
  controlAlgorithmId,
  arms: [
    { algorithmId: "for_you", weight: 50 },
    { algorithmId: "completion_first", weight: 50 },
  ],
  minimumImpressionsPerArm: 40,
};

/**
 * Accepts anything the database or an admin form produced and returns a config
 * that is safe to run: known algorithm ids, positive weights, a control that
 * exists. Unknown ids are dropped rather than trusted.
 */
export function normalizeExperimentConfig(raw: unknown): RecommendationExperimentConfig {
  const source = (raw ?? {}) as Partial<RecommendationExperimentConfig>;
  const arms = Array.isArray(source.arms) ? source.arms : [];
  const validArms = arms
    .filter((arm): arm is ExperimentArm => Boolean(arm) && isRecommendationAlgorithmId(arm.algorithmId))
    .map((arm) => ({
      algorithmId: arm.algorithmId,
      weight: Math.max(0, Math.round(Number(arm.weight) || 0)),
    }))
    .filter((arm, index, all) => all.findIndex((other) => other.algorithmId === arm.algorithmId) === index);

  const liveArms = validArms.filter((arm) => arm.weight > 0);
  const control = isRecommendationAlgorithmId(source.controlAlgorithmId)
    ? source.controlAlgorithmId
    : defaultExperimentConfig.controlAlgorithmId;

  return {
    key: typeof source.key === "string" && source.key.trim() ? source.key.trim().slice(0, 60) : defaultExperimentConfig.key,
    controlAlgorithmId: control,
    arms: liveArms.length ? validArms : defaultExperimentConfig.arms,
    minimumImpressionsPerArm: Math.max(
      1,
      Math.round(Number(source.minimumImpressionsPerArm) || defaultExperimentConfig.minimumImpressionsPerArm)
    ),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
  };
}

/**
 * Deterministic assignment. The same visitor always lands in the same arm of the
 * same experiment, so one tester never bounces between variants mid-session.
 */
export function assignExperimentArm(
  visitorId: string,
  config: RecommendationExperimentConfig = defaultExperimentConfig,
  requestedAlgorithmId?: string | null
): RecommendationExperiment {
  const userSegment = inferUserSegment(visitorId);

  if (requestedAlgorithmId && isRecommendationAlgorithmId(requestedAlgorithmId)) {
    return {
      experimentKey: config.key,
      algorithmId: requestedAlgorithmId,
      algorithmName: recommendationAlgorithmName(requestedAlgorithmId),
      userSegment,
      source: "requested",
    };
  }

  const liveArms = config.arms.filter((arm) => arm.weight > 0);
  const totalWeight = liveArms.reduce((total, arm) => total + arm.weight, 0);

  if (!liveArms.length || totalWeight <= 0) {
    return {
      experimentKey: config.key,
      algorithmId: defaultAlgorithmId,
      algorithmName: recommendationAlgorithmName(defaultAlgorithmId),
      userSegment,
      source: "fallback",
    };
  }

  let bucket = stableHash(`${config.key}:${visitorId || "anonymous"}:arm`) % totalWeight;
  for (const arm of liveArms) {
    if (bucket < arm.weight) {
      return {
        experimentKey: config.key,
        algorithmId: arm.algorithmId,
        algorithmName: recommendationAlgorithmName(arm.algorithmId),
        userSegment,
        source: "assigned",
      };
    }
    bucket -= arm.weight;
  }

  const fallbackArm = liveArms[liveArms.length - 1];
  return {
    experimentKey: config.key,
    algorithmId: fallbackArm.algorithmId,
    algorithmName: recommendationAlgorithmName(fallbackArm.algorithmId),
    userSegment,
    source: "assigned",
  };
}

export function inferUserSegment(visitorId: string): UserSegment {
  const bucket = stableHash(`${visitorId || "anonymous"}:segment`) % 100;
  if (bucket < 20) return "new_reader";
  if (bucket < 45) return "quick_reads";
  if (bucket < 70) return "deep_reads";
  return "general";
}
