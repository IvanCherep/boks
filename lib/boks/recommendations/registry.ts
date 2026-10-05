import type { RecommendationStrategy } from "@/lib/boks/recommendations/strategy";
import {
  type RecommendationAlgorithmId,
  registeredStrategies,
  strategyList,
} from "@/lib/boks/recommendations/strategies";

export type { RecommendationAlgorithmId };

export const defaultAlgorithmId: RecommendationAlgorithmId = "for_you";

/**
 * Control arm for every comparison in the admin lab.
 *
 * `for_you` is the product ranker, so it is what a challenger has to beat.
 */
export const controlAlgorithmId: RecommendationAlgorithmId = "for_you";

const strategiesById = new Map(strategyList.map((strategy) => [strategy.id, strategy]));

export function listRecommendationStrategies(): readonly RecommendationStrategy[] {
  return strategyList;
}

export function isRecommendationAlgorithmId(value: unknown): value is RecommendationAlgorithmId {
  return typeof value === "string" && strategiesById.has(value);
}

export function getRecommendationStrategy(id: string): RecommendationStrategy {
  return strategiesById.get(id) ?? strategiesById.get(defaultAlgorithmId) ?? registeredStrategies[0];
}

export function recommendationAlgorithmName(id: string) {
  return strategiesById.get(id)?.name ?? id;
}

/**
 * Browser- and admin-facing description of the registry. The admin lab renders
 * this so operators can see every algorithm the build knows about, including
 * ones that are not currently receiving traffic.
 */
export function describeRecommendationStrategies() {
  return strategyList.map((strategy) => ({
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    family: strategy.family,
    weights: strategy.weights,
  }));
}
