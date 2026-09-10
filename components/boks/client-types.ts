export type Story = {
  id: string;
  title: string;
  authorName: string;
  authorHandle: string;
  hook: string;
  body: string;
  genre: string;
  mood: string;
  minutes: number;
  likes: number;
  shares: number;
  starts: number;
  completes: number;
  commentsCount: number;
  avgSeconds: number;
};

export type Comment = {
  id: number;
  storyId: string;
  visitorName: string;
  body: string;
  createdAt: string;
};

export type RecommendationAlgorithm = {
  id: string;
  name: string;
  description: string;
};

export type RecommendationExperiment = {
  algorithmId: string;
  algorithmName: string;
  userSegment: string;
  source: "assigned" | "requested";
};

export type Metrics = {
  funnel: Record<string, number>;
  stories: Array<Record<string, number | string>>;
  recentEvents: Array<Record<string, number | string>>;
  genres?: Array<Record<string, number | string>>;
  moods?: Array<Record<string, number | string>>;
  algorithms?: RecommendationAlgorithm[];
  algorithmMetrics?: Array<Record<string, number | string>>;
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    sort: string;
    query: string;
  };
};

export type ReaderProfile = {
  completed: string[];
  liked: string[];
  skipped: string[];
  genreScore: Record<string, number>;
  moodScore: Record<string, number>;
};

export type LoadOptions = {
  view?: "reader" | "admin";
  limit?: number;
  offset?: number;
  q?: string;
  sort?: string;
  visitorId?: string;
  algorithm?: string;
};

export type ReadOutcome = "complete" | "skip";
