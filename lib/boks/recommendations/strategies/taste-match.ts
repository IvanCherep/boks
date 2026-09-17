import { defineStrategy } from "@/lib/boks/recommendations/strategy";

/**
 * Content-based personalization. Uses the genre and mood affinity the reader
 * built through behavior, never a preference the reader was asked to configure.
 */
export const tasteMatch = defineStrategy({
  id: "taste_match",
  name: "Taste match",
  description: "Ranks by the genre and mood affinity a reader built through completions and likes.",
  family: "personal",
  segment: "all",
  weights: {
    tasteMatch: 40,
    finishRate: 18,
    reactionRate: 10,
    novelty: 8,
    exploration: 10,
    freshness: 4,
    skipRate: -12,
    jitter: 4,
  },
});
