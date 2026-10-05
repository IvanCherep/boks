import { defineStrategy } from "@/lib/boks/recommendations/strategy";

/** Control variant. Every other strategy is judged against this one. */
export const balanced = defineStrategy({
  id: "balanced",
  name: "Balanced quality",
  description: "Control mix of completion, reactions, freshness and light exploration.",
  family: "quality",
  weights: {
    finishRate: 30,
    reactionRate: 18,
    readDepth: 10,
    popularity: 6,
    freshness: 6,
    exploration: 12,
    shortness: 4,
    skipRate: -14,
    jitter: 5,
  },
});
