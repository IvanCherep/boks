import { defineStrategy } from "@/lib/boks/recommendations/strategy";

/**
 * Newest first. This is what the Supabase MVP feed did before attributed
 * events existed, kept as a comparable arm rather than a hidden default.
 */
export const recency = defineStrategy({
  id: "recency",
  name: "Newest first",
  description: "Chronological feed. The pre-experiment baseline the MVP shipped with.",
  family: "baseline",
  weights: {
    freshness: 100,
  },
});
