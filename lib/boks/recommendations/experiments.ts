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
  /**
   * Readers an arm needs before the lab compares it. The analysis unit is the
   * reader, so this is counted in readers.
   *
   * Stored as `minimum_impressions_per_arm` (and read back as the JSON key
   * `minimumImpressionsPerArm`) for compatibility with the original schema,
   * which counted impressions; that key is accepted on the way in.
   */
  minimumReadersPerArm: number;
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
 * One arm, for the launch.
 *
 * Until 2026-09-20 this was a 50/50 split between `for_you` and
 * `completion_first`, and the reasoning for two arms is still sound and still
 * written down below - it is simply not what the first weeks are for.
 *
 * The decision, taken with the founder before opening the platform to real
 * readers: **everyone gets `for_you`**, the strongest ranker in the registry,
 * now that it has the semantic source it was designed around (embeddings from
 * `multilingual-e5-small`, see `strategies/for-you.ts`). Nothing is measured by
 * splitting traffic at this size anyway - at 30 readers, an arm holds 15, and
 * the power to detect even a large difference in reading time is near nothing
 * - so a split would cost half the audience a worse feed and return no answer.
 * The other strategies stay registered and parked at weight 0, which is one
 * number away from being live again.
 *
 * When to reopen the split: once the catalogue and the audience are steady and
 * there are enough readers that an arm is a sample rather than an anecdote.
 * The pairing to run then is what the divergence check measured
 * (`npm run verify:divergence`): `for_you` against `completion_first`, because
 * `recency` shares 80-100% of `for_you`'s top ten on this corpus and cannot
 * resolve anything. Retired reasoning, kept because it will be needed again:
 *
 *  - Two arms, not four. Splitting a few dozen readers four ways leaves ~12
 *    per arm, where the power to detect even a doubling of reading time is
 *    around 50%.
 *  - `for_you` is the control: it is the product ranker, so everything else is
 *    a challenger to it.
 *  - `completion_first` is the challenger that diverges (30-40% overlap),
 *    which `recency` does not.
 */
export const defaultExperimentConfig: RecommendationExperimentConfig = {
  key: "boks-feed-v1",
  controlAlgorithmId,
  arms: [
    { algorithmId: "for_you", weight: 100 },
    // Parked, not deleted: raising a weight here is the whole change needed to
    // start comparing again.
    { algorithmId: "completion_first", weight: 0 },
  ],
  minimumReadersPerArm: 10,
};

/**
 * Accepts anything the database or an admin form produced and returns a config
 * that is safe to run: known algorithm ids, positive weights, a control that
 * exists. Unknown ids are dropped rather than trusted.
 */
export function normalizeExperimentConfig(raw: unknown): RecommendationExperimentConfig {
  const source = (raw ?? {}) as Partial<RecommendationExperimentConfig>;
  const legacy = (raw ?? {}) as { minimumImpressionsPerArm?: unknown };
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
    // Two is the least any interval can be computed from.
    minimumReadersPerArm: Math.max(
      2,
      Math.round(
        Number(source.minimumReadersPerArm ?? legacy.minimumImpressionsPerArm) ||
          defaultExperimentConfig.minimumReadersPerArm
      )
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
