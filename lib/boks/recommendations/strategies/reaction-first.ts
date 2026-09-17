import { defineStrategy } from "@/lib/boks/recommendations/strategy";

/** Optimizes the question "which boks make people respond?". */
export const reactionFirst = defineStrategy({
  id: "reaction_first",
  name: "Reaction first",
  description: "Prioritizes boks that produce likes, shares and comments quickly.",
  family: "engagement",
  segment: "quick_reads",
  weights: {
    likeRate: 22,
    commentRate: 24,
    shareRate: 18,
    reactionRate: 12,
    finishRate: 10,
    shortness: 8,
    exploration: 8,
    skipRate: -12,
    jitter: 4,
  },
});
