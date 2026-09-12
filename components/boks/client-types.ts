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
  visitorHandle?: string | null;
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
  moderationQueue?: AdminModerationItem[];
  users?: AdminUserRow[];
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

export type BoksUserRole = "reader" | "admin";

export type BoksUserContext = {
  userId: string | null;
  email: string | null;
  isAnonymous: boolean;
  role: BoksUserRole;
  displayName: string;
  handle: string | null;
  preferredGenre: string;
  preferredMood: string;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  hasAnyAdmin: boolean;
  views: number;
  likes: number;
};

export type ReaderLibraryItem = {
  storyId: string;
  title: string;
  authorName: string;
  minutes: number;
  readAt: string;
  liked: boolean;
};

export type BokReviewStatus = "draft" | "pending_review" | "published" | "rejected" | "archived";

export type AuthorBokSubmission = {
  id: string;
  title: string;
  hook: string;
  body: string;
  genre: string;
  mood: string;
  minutes: number;
  status: BokReviewStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export type AdminModerationItem = AuthorBokSubmission & {
  authorName: string;
  authorHandle: string;
  body: string;
  authorUserId: string | null;
  authorEmail: string;
};

export type AdminUserRow = {
  userId: string;
  email: string;
  role: BoksUserRole;
  displayName: string;
  createdAt: string;
  lastSignInAt: string;
  views: number;
  likes: number;
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
