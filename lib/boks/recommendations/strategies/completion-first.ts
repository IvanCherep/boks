import { defineStrategy } from "@/lib/boks/recommendations/strategy";

/** Optimizes the question "do readers finish what they start?". */
export const completionFirst = defineStrategy({
  id: "completion_first",
  name: "Completion first",
  description: "Prioritizes boks people finish after starting, and tolerates longer pieces.",
  family: "quality",
  weights: {
    finishRate: 48,
    readDepth: 22,
    startRate: 8,
    longform: 4,
    exploration: 8,
    reactionRate: 6,
    skipRate: -22,
    jitter: 3,
  },
});
