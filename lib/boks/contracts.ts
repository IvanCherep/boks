export const readerEventTypes = [
  "impression",
  "start",
  "complete",
  "like",
  "share",
  "skip",
  "comment",
  "publish",
  "preference",
] as const;

export const eventTypes = new Set<string>(readerEventTypes);

export type RecommendationAlgorithmId =
  | "balanced"
  | "completion_first"
  | "reaction_first"
  | "discovery";

export type UserSegment = "general" | "new_reader" | "quick_reads" | "deep_reads";

export type RecommendationExperiment = {
  algorithmId: RecommendationAlgorithmId;
  algorithmName: string;
  userSegment: UserSegment;
  source: "assigned" | "requested";
};

export type RecommendationAlgorithm = {
  id: RecommendationAlgorithmId;
  name: string;
  description: string;
  userSegment: UserSegment | "all";
  weights: {
    completion: number;
    finishRate: number;
    likes: number;
    comments: number;
    shares: number;
    freshness: number;
    exploration: number;
    shortness: number;
    skips: number;
  };
};

export type AdminPagination = {
  limit: number;
  offset: number;
  sort: string;
  query: string;
};
