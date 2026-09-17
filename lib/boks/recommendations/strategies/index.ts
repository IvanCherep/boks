import type { RecommendationStrategy } from "@/lib/boks/recommendations/strategy";
import { balanced } from "@/lib/boks/recommendations/strategies/balanced";
import { completionFirst } from "@/lib/boks/recommendations/strategies/completion-first";
import { discovery } from "@/lib/boks/recommendations/strategies/discovery";
import { forYou } from "@/lib/boks/recommendations/strategies/for-you";
import { randomControl } from "@/lib/boks/recommendations/strategies/random-control";
import { reactionFirst } from "@/lib/boks/recommendations/strategies/reaction-first";
import { recency } from "@/lib/boks/recommendations/strategies/recency";
import { tasteMatch } from "@/lib/boks/recommendations/strategies/taste-match";

/**
 * The registered strategies, in display order.
 *
 * To add a recommendation algorithm: create one file in this folder that calls
 * `defineStrategy`, then add it to this list. Nothing else in the app needs to
 * change - contracts, admin lab, experiment config and event attribution all
 * read from here.
 */
export const registeredStrategies = [
  forYou,
  balanced,
  completionFirst,
  reactionFirst,
  discovery,
  tasteMatch,
  recency,
  randomControl,
] as const;

export type RegisteredStrategy = (typeof registeredStrategies)[number];

/** Union of every registered algorithm id, derived from the list above. */
export type RecommendationAlgorithmId = RegisteredStrategy["id"];

export const strategyList: readonly RecommendationStrategy[] = registeredStrategies;
