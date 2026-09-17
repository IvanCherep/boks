import { defineStrategy } from "@/lib/boks/recommendations/strategy";

/**
 * Deterministic pseudo-random order. Not a product candidate: it is the floor
 * every other strategy has to clear before a result means anything.
 */
export const randomControl = defineStrategy({
  id: "random_control",
  name: "Random baseline",
  description: "Deterministic shuffle. Measures how much ranking is worth at all.",
  family: "baseline",
  segment: "all",
  weights: {
    jitter: 100,
  },
});
