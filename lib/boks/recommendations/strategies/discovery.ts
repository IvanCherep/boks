import { defineStrategy } from "@/lib/boks/recommendations/strategy";

/** Buys information about under-tested boks instead of exploiting known winners. */
export const discovery = defineStrategy({
  id: "discovery",
  name: "Discovery",
  description: "Gives newer and under-tested boks more chances without ignoring quality.",
  family: "exploration",
  segment: "new_reader",
  weights: {
    exploration: 38,
    freshness: 22,
    novelty: 10,
    finishRate: 12,
    reactionRate: 6,
    shortness: 4,
    skipRate: -8,
    jitter: 8,
  },
});
