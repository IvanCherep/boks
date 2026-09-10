import type { Metrics, ReaderProfile } from "@/components/boks/client-types";

export const moods = ["quiet", "warm", "tense", "strange", "playful"];
export const genres = ["literary", "mystery", "slice of life", "speculative", "fantasy"];

export const initialMetrics: Metrics = { funnel: {}, stories: [], recentEvents: [] };

export const initialProfile: ReaderProfile = {
  completed: [],
  liked: [],
  skipped: [],
  genreScore: {},
  moodScore: {},
};
