export { compareIndependent, comparePaired, signTest } from "@/lib/recsys/statistics/compare";
export { estimatePower, type PowerRequest } from "@/lib/recsys/statistics/power";
export {
  coefficientOfVariation,
  mean,
  median,
  quantile,
  standardDeviation,
} from "@/lib/recsys/statistics/descriptive";
export { createRandom, shuffle } from "@/lib/recsys/statistics/random";
export type {
  AnalysisUnit,
  ComparisonDesign,
  ComparisonOptions,
  ComparisonResult,
  ComparisonStatus,
  EffectKind,
  PowerEstimate,
} from "@/lib/recsys/statistics/types";
