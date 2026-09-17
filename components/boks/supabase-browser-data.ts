"use client";

import { initialMetrics } from "@/components/boks/constants";
import type {
  AuthorBokQuota,
  BoksContentRow,
  BoksGrowth,
  BoksOverview,
  BoksPersonRow,
  AuthorBokSubmission,
  AuthorProfile,
  BoksUserContext,
  Comment,
  FeedProvenance,
  Metrics,
  ReaderLibraryItem,
  RecommendationExperiment,
  RecommendationLabPayload,
  Story,
  BoksPublisher,
  BoksImportReport,
  BoksRightsReview,
  SlatePositionRow,
  LanguageDemandRow,
} from "@/components/boks/client-types";
import { normalizeBokSubmissionQuota } from "@/lib/boks/author/submission-quota";
import { normalizeReadingLanguages } from "@/components/boks/reading-languages";
import type { CatalogueRow } from "@/lib/boks/import/parse-catalogue";
import { serveReaderFeed, type FeedTransport } from "@/lib/boks/feed-service";
import {
  candidatesFromReelRows,
  candidatesFromRollupRows,
  mapSupabaseReelToStory,
  type SupabaseCandidateRow,
  type SupabaseReelRow,
} from "@/lib/boks/supabase-reels";
import type { ReaderEvent } from "@/lib/boks/contracts";
import type { ReaderOutcomeRow } from "@/lib/recsys/aggregate";
import {
  buildRecommendationLab,
  defaultExperimentConfig,
  emptyRecommendationLab,
  normalizeExperimentConfig,
  type ReaderSignals,
  type RecommendationExperimentConfig,
  type StoryCandidate,
} from "@/lib/boks/recommendations";
import {
  getAnonymousSupabaseUserId,
  getCachedAccessToken,
  getCurrentBoksUserContext,
  getCurrentSupabaseUser,
  isSupabaseConfigured,
  supabase,
  supabasePublishableApiKey,
  supabaseRestUrl,
} from "@/lib/boks/supabase-client";

/**
 * PostgREST reports a missing function this way. The recommendation migration
 * may not have reached a given Supabase project yet, and a reader must keep
 * reading when it has not, so every new RPC call degrades instead of throwing.
 */
function isMissingDatabaseObject(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    error.code === "42883" ||
    /(function|relation) .* does not exist/i.test(error.message ?? "")
  );
}

type SupabaseLikeRow = {
  reel_id: string;
};

type SupabaseCommentRow = {
  id: number;
  reel_id: string;
  visitor_handle: string | null;
  body: string;
  created_at: string;
};




export type SupabaseReaderPayload = {
  stories: Story[];
  comments: Comment[];
  metrics: Metrics;
  experiment: RecommendationExperiment;
  likedStoryIds: string[];
  supabaseUserId: string | null;
  provenance: FeedProvenance;
};

export function canUseSupabaseBrowserData() {
  return isSupabaseConfigured && Boolean(supabase);
}

export type SupabaseFeedRequest = {
  limit: number;
  visitorId: string;
  sessionId: string;
  reader?: ReaderSignals;
  profileSnapshot?: Record<string, unknown>;
  /** Admin preview only. The reader surface never sets this. */
  requestedAlgorithmId?: string | null;
  /** The guest's language filter; a signed-in reader's stored one wins. */
  readingLanguages?: readonly string[];
};

type WorkerFeedResponse = {
  feedId: string | null;
  experiment: RecommendationExperiment;
  entries: { reelId: string; rank: number; score: number }[];
  reels: SupabaseReelRow[];
  servingBackend: "worker" | "browser" | "d1_fallback";
  degradedMode: boolean;
  fallbackReason: string | null;
  candidateCount: number;
  catalogSize: number;
  labelingVersion: string;
  error?: string;
};

/**
 * Loads the ranked reader feed.
 *
 * Ranking is the Worker's job (ADR-001): it holds the candidate set, records
 * what it served, and returns the slate. The browser only decorates that slate
 * with likes and comments, which need the reader's session anyway.
 *
 * If the Worker cannot be reached the browser ranks locally through the *same*
 * `serveReaderFeed`, and the resulting feed is recorded as
 * `serving_backend = 'browser'`. That is the difference this phase is about: a
 * degraded serve is a labelled, countable condition, not a silent second
 * instrumentation regime.
 */
export async function loadSupabaseReaderFeed(request: SupabaseFeedRequest): Promise<SupabaseReaderPayload> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const userId = await getAnonymousSupabaseUserId();
  if (!userId) throw new Error("Could not create anonymous Supabase user.");

  try {
    return await loadWorkerReaderFeed(userId, request);
  } catch (error) {
    console.warn("Worker feed unavailable; ranking in the browser (degraded).", error);
    return loadBrowserReaderFeed(userId, request, describeFeedError(error));
  }
}

async function loadWorkerReaderFeed(
  userId: string,
  request: SupabaseFeedRequest
): Promise<SupabaseReaderPayload> {
  const token = await currentAccessToken();
  if (!token) throw new Error("No Supabase session to authorise the feed request.");

  const response = await fetch("/api/feed", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      limit: request.limit,
      sessionId: request.sessionId,
      reader: request.reader,
      profileSnapshot: request.profileSnapshot ?? {},
      requestedAlgorithmId: request.requestedAlgorithmId ?? null,
    }),
  });

  const payload = (await response.json()) as WorkerFeedResponse;
  if (!response.ok) throw new Error(payload.error || `Feed request failed (${response.status}).`);

  return decorateServedFeed({
    userId,
    reels: payload.reels,
    experiment: payload.experiment,
    provenance: {
      feedId: payload.feedId,
      servingBackend: payload.servingBackend,
      degradedMode: payload.degradedMode,
      fallbackReason: payload.fallbackReason,
      labelingVersion: payload.labelingVersion,
      catalogSize: payload.catalogSize,
      candidateCount: payload.candidateCount,
    },
  });
}

async function loadBrowserReaderFeed(
  userId: string,
  request: SupabaseFeedRequest,
  fallbackReason: string
): Promise<SupabaseReaderPayload> {
  const served = await serveReaderFeed(createBrowserFeedTransport(), {
    userId,
    sessionId: request.sessionId,
    limit: request.limit,
    reader: request.reader,
    profileSnapshot: request.profileSnapshot ?? {},
    requestedAlgorithmId: request.requestedAlgorithmId ?? null,
    readingLanguages: request.readingLanguages,
    servingBackend: "browser",
  });

  return decorateServedFeed({
    userId,
    reels: served.reels,
    experiment: served.experiment,
    provenance: {
      feedId: served.feedId,
      servingBackend: "browser",
      degradedMode: true,
      fallbackReason: served.fallbackReason ?? fallbackReason,
      labelingVersion: served.labelingVersion,
      catalogSize: served.catalogSize,
      candidateCount: served.candidateCount,
    },
  });
}

/** Likes and comments for a slate that has already been ranked and recorded. */
async function decorateServedFeed(input: {
  userId: string;
  reels: SupabaseReelRow[];
  experiment: RecommendationExperiment;
  provenance: FeedProvenance;
}): Promise<SupabaseReaderPayload> {
  const rankedIds = input.reels.map((reel) => reel.id);
  const likedStoryIds = await loadLikedStoryIds(input.userId, rankedIds);
  const likedSet = new Set(likedStoryIds);
  const comments = await loadSupabaseCommentsForReels(rankedIds);
  const commentCounts = comments.reduce((counts, comment) => {
    counts.set(comment.storyId, (counts.get(comment.storyId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  const stories = input.reels.map((reel) => mapSupabaseReelToStory(reel, likedSet, commentCounts));

  return {
    stories,
    comments,
    metrics: { ...initialMetrics, funnel: { totalStories: stories.length }, stories },
    experiment: input.experiment,
    likedStoryIds,
    supabaseUserId: input.userId,
    provenance: input.provenance,
  };
}

async function currentAccessToken() {
  const cached = getCachedAccessToken();
  if (cached) return cached;
  if (!supabase) return null;
  const session = await supabase.auth.getSession();
  return session.data.session?.access_token ?? null;
}

function describeFeedError(error: unknown) {
  if (error instanceof Error) return `worker_feed_unavailable: ${error.message.slice(0, 160)}`;
  return "worker_feed_unavailable";
}

/**
 * The same transport contract the Worker uses, backed by supabase-js.
 *
 * Sharing the contract is what keeps the degraded path honest: it runs the
 * identical assembly, writes the identical provenance, and differs only in the
 * `serving_backend` label it carries.
 */
export function createBrowserFeedTransport(): FeedTransport {
  return {
    async rpc<Result>(name: string, body: Record<string, unknown> = {}) {
      if (!supabase) throw new Error("Supabase is not configured.");
      const result = await supabase.rpc(name, body);
      if (result.error) throw asTransportError(result.error);
      return result.data as Result;
    },

    async publishedReels(limit: number) {
      if (!supabase) throw new Error("Supabase is not configured.");
      const result = await supabase
        .from("published_boks")
        .select("id,title,author_name,author_handle,author_user_id,hook,text,genre,mood,minutes,word_count,created_at")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (result.error) throw asTransportError(result.error);
      return (result.data ?? []) as SupabaseReelRow[];
    },

    async publishedCount() {
      if (!supabase) throw new Error("Supabase is not configured.");
      const result = await supabase
        .from("published_boks")
        .select("id", { count: "exact", head: true });
      if (result.error) throw asTransportError(result.error);
      if (result.count === null) throw new Error("Supabase did not return a catalog count.");
      return result.count;
    },
  };
}

/**
 * A rejected token must be distinguishable from a missing table, or an expired
 * session silently becomes a recency feed attributed to an arm nobody assigned.
 */
function asTransportError(error: { code?: string; message?: string }) {
  const failure = new Error(error.message ?? "Supabase request failed.") as Error & {
    isAuthFailure?: boolean;
    code?: string;
  };
  failure.code = error.code;
  failure.isAuthFailure = error.code === "PGRST301" || error.code === "42501";
  return failure;
}

async function loadFeedCandidates(limit: number, languages?: readonly string[]) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const candidatesResult = await supabase.rpc("get_recommendation_candidates", {
    p_limit: Math.max(limit, 200),
    // Sent for guests, who have no profile row to store a choice in. A
    // signed-in reader's stored languages win over this inside the RPC, which
    // is what makes the setting follow them between devices.
    p_languages: normalizeReadingLanguages(languages),
  });

  if (!candidatesResult.error) {
    const rows = (candidatesResult.data ?? []) as unknown as SupabaseCandidateRow[];
    return { ...candidatesFromRollupRows(rows), degraded: false };
  }

  if (!isMissingDatabaseObject(candidatesResult.error)) throw candidatesResult.error;

  const reelsResult = await supabase
    .from("published_boks")
    .select("id,title,author_name,author_handle,author_user_id,hook,text,genre,mood,minutes,word_count,created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(Math.max(limit, 200));

  if (reelsResult.error) throw reelsResult.error;

  return { ...candidatesFromReelRows((reelsResult.data ?? []) as SupabaseReelRow[]), degraded: true };
}

export async function loadBoksOverview(days = 7): Promise<BoksOverview | null> {
  if (!supabase) return null;

  const result = await supabase.rpc("get_boks_overview", { p_days: days });
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return null;
    throw result.error;
  }

  return result.data as BoksOverview;
}

export async function loadBoksGrowth(weeks = 12): Promise<BoksGrowth | null> {
  if (!supabase) return null;

  const result = await supabase.rpc("get_boks_growth", { p_weeks: weeks });
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return null;
    throw result.error;
  }
  return result.data as BoksGrowth;
}

export async function loadBoksPeople(options: { limit?: number; offset?: number; query?: string } = {}) {
  if (!supabase) return { total: 0, rows: [] as BoksPersonRow[] };

  const result = await supabase.rpc("get_boks_people", {
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
    p_query: options.query ?? "",
  });
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return { total: 0, rows: [] as BoksPersonRow[] };
    throw result.error;
  }
  return result.data as { total: number; rows: BoksPersonRow[] };
}

export async function loadBoksContent(
  options: { limit?: number; offset?: number; query?: string; sort?: string } = {}
) {
  if (!supabase) return { total: 0, rows: [] as BoksContentRow[] };

  const result = await supabase.rpc("get_boks_content", {
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
    p_query: options.query ?? "",
    p_sort: options.sort ?? "minutes",
  });
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return { total: 0, rows: [] as BoksContentRow[] };
    throw result.error;
  }
  return result.data as { total: number; rows: BoksContentRow[] };
}

/**
 * Follow or unfollow an author.
 *
 * Anonymous readers are refused by the database: a follow is a durable
 * relationship and an anonymous session is not a durable identity.
 */
export async function setAuthorFollow(authorUserId: string, following: boolean) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("set_author_follow", {
    p_author_user_id: authorUserId,
    p_following: following,
  });
  if (result.error) throw result.error;

  return (result.data ?? { authorUserId, following, followers: 0 }) as {
    authorUserId: string;
    following: boolean;
    followers: number;
  };
}

export type FollowedAuthor = {
  authorUserId: string;
  authorName: string;
  authorHandle: string;
  followedAt: string;
  published: number;
};

export async function loadFollowedAuthors(): Promise<FollowedAuthor[]> {
  if (!supabase) return [];

  const result = await supabase.rpc("get_my_followed_authors");
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return [];
    throw result.error;
  }
  return (result.data ?? []) as FollowedAuthor[];
}

/**
 * One author, or one writer inside a publishing account.
 *
 * Keyed by @handle rather than account id, because that is the identity the
 * product uses and the only one the seeded catalog has. Pass `authorName` to
 * narrow it to one writer: an account can publish many, and "more by this
 * writer" is the question a reader actually asks.
 */
export async function loadBoksAuthor(handle: string, authorName?: string): Promise<AuthorProfile | null> {
  if (!supabase) return null;

  const result = await supabase.rpc("get_boks_author", {
    p_handle: handle,
    p_author_name: authorName ?? null,
  });
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return null;
    throw result.error;
  }
  return (result.data ?? null) as AuthorProfile | null;
}

export async function loadRecommendationCandidates(limit = 400): Promise<StoryCandidate[]> {
  const { candidates } = await loadFeedCandidates(limit);
  return candidates;
}

export async function loadActiveExperimentConfig(): Promise<RecommendationExperimentConfig> {
  if (!supabase) return defaultExperimentConfig;

  const result = await supabase.rpc("get_active_recommendation_experiment");
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return defaultExperimentConfig;
    throw result.error;
  }

  return normalizeExperimentConfig(result.data);
}

export async function saveActiveExperimentConfig(
  config: RecommendationExperimentConfig
): Promise<RecommendationExperimentConfig> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const safeConfig = normalizeExperimentConfig(config);
  const result = await supabase.rpc("save_recommendation_experiment", {
    p_key: safeConfig.key,
    p_control_algorithm_id: safeConfig.controlAlgorithmId,
    p_arms: safeConfig.arms,
    p_minimum_impressions_per_arm: safeConfig.minimumImpressionsPerArm,
  });

  if (result.error) throw result.error;
  return normalizeExperimentConfig(result.data);
}


/**
 * Batch write used by the reader event queue. Silent when unmigrated.
 *
 * When the page is going away the RPC is issued as a keepalive request instead
 * of going through supabase-js: Safari cancels in-flight fetches on `pagehide`,
 * and `sendBeacon` cannot carry the `apikey` and `Authorization` headers
 * PostgREST requires. `keepalive` is the one option that does both.
 */
export async function recordSupabaseReaderEvents(
  events: ReaderEvent[],
  delivery: { keepalive: boolean } = { keepalive: false }
) {
  if (!supabase || !events.length) return;

  if (delivery.keepalive && supabaseRestUrl && supabasePublishableApiKey) {
    const token = getCachedAccessToken();
    const response = await fetch(`${supabaseRestUrl}/rpc/record_recommendation_events`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: supabasePublishableApiKey,
        Authorization: `Bearer ${token ?? supabasePublishableApiKey}`,
      },
      body: JSON.stringify({ p_events: events }),
    });

    // A missing function means the migration has not landed here yet, which is
    // not an error the reader should ever see.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Could not record reader events (${response.status}).`);
    }
    return;
  }

  const result = await supabase.rpc("record_recommendation_events", { p_events: events });
  if (result.error && !isMissingDatabaseObject(result.error)) throw result.error;
}

/**
 * The lab report, built from reader outcomes.
 *
 * Two RPCs, deliberately: `get_reader_outcomes` returns one row per
 * (reader, algorithm, day) — the analysis unit — while `get_recommendation_lab`
 * still supplies the live config, the assignment counts and the top boks. Its
 * event counters are no longer read: a rate over impressions is not evidence
 * about readers, and keeping both would give the console two answers to the
 * same question.
 */
export async function loadSlatePositionEffects(
  days = 30,
  experimentKey = ""
): Promise<SlatePositionRow[]> {
  if (!supabase) return [];

  const result = await supabase.rpc("get_slate_position_effects", {
    p_days: days,
    p_experiment_key: experimentKey,
  });
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return [];
    throw result.error;
  }

  return (result.data as SlatePositionRow[]) ?? [];
}

export async function loadRecommendationLab(days = 30): Promise<RecommendationLabPayload> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("get_recommendation_lab", { p_days: days });

  if (result.error) {
    if (!isMissingDatabaseObject(result.error)) throw result.error;
    return {
      experiment: defaultExperimentConfig,
      report: emptyRecommendationLab,
      outcomes: [],
      assignments: [],
      topStories: [],
      dataQuality: null,
      available: false,
      notice:
        "Attributed recommendation events are not in this Supabase project yet. Apply the migrations in supabase/migrations, then reload.",
    };
  }

  const payload = (result.data ?? {}) as {
    experiment?: unknown;
    assignments?: RecommendationLabPayload["assignments"];
    topStories?: RecommendationLabPayload["topStories"];
  };
  const experiment = normalizeExperimentConfig(payload.experiment);

  const outcomes = await supabase.rpc("get_reader_outcomes", {
    p_days: days,
    p_experiment_key: experiment.key,
  });
  if (outcomes.error && !isMissingDatabaseObject(outcomes.error)) throw outcomes.error;

  const quality = await supabase.rpc("get_recommendation_data_quality", { p_days: days });
  if (quality.error && !isMissingDatabaseObject(quality.error)) throw quality.error;

  const rows = normalizeReaderOutcomes(outcomes.data);

  return {
    experiment,
    outcomes: rows,
    report: buildRecommendationLab(rows, {
      controlAlgorithmId: experiment.controlAlgorithmId,
      minimumReadersPerArm: minimumReadersPerArm,
      windowDays: days,
      // Fewer resamples than a thesis run: this is a console, and the interval
      // moves by well under a second of reading time between the two.
      resamples: 1200,
    }),
    assignments: payload.assignments ?? [],
    topStories: payload.topStories ?? [],
    dataQuality: (quality.data as RecommendationLabPayload["dataQuality"]) ?? null,
    available: true,
    notice: "",
  };
}

/**
 * Readers per arm before a comparison is attempted.
 *
 * Ten is not a power calculation - the report carries one of those. It is the
 * floor below which an interval is so wide that printing it invites the reader
 * to see a winner in noise.
 */
const minimumReadersPerArm = 10;

/** Postgres returns numeric columns as strings over PostgREST. */
function normalizeReaderOutcomes(data: unknown): ReaderOutcomeRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as Record<string, unknown>;
    const value = (key: string) => Number(row[key]) || 0;
    return {
      userId: String(row.userId ?? ""),
      algorithmId: String(row.algorithmId ?? "unassigned"),
      day: String(row.day ?? ""),
      // Older databases predate the cohort fields; an empty cohort and a
      // tenure of zero read as "unknown, treat as new" rather than crashing.
      cohortWeek: String(row.cohortWeek ?? ""),
      tenureDays: value("tenureDays"),
      impressions: value("impressions"),
      starts: value("starts"),
      completes: value("completes"),
      skips: value("skips"),
      likes: value("likes"),
      shares: value("shares"),
      comments: value("comments"),
      boksOpened: value("boksOpened"),
      sessions: value("sessions"),
      activeSeconds: value("activeSeconds"),
      attributedEvents: value("attributedEvents"),
      totalEvents: value("totalEvents"),
    };
  });
}

export async function loadMyBokQuota(): Promise<AuthorBokQuota> {
  if (!supabase) return normalizeBokSubmissionQuota(null);

  const result = await supabase.rpc("get_my_bok_quota");
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return normalizeBokSubmissionQuota(null);
    throw result.error;
  }

  return normalizeBokSubmissionQuota(result.data);
}

export async function loadSupabaseAdminMetrics(options: {
  limit?: number;
  offset?: number;
  q?: string;
  sort?: string;
}): Promise<Metrics> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const user = await getCurrentSupabaseUser();
  if (!user || user.is_anonymous) throw new Error("Sign in with an admin account to open business metrics.");

  const result = await supabase.rpc("get_boks_admin_snapshot", {
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
    p_query: options.q ?? "",
    p_sort: options.sort ?? "signal",
  });

  if (result.error) throw result.error;

  return (result.data ?? initialMetrics) as Metrics;
}

export async function loadBoksUserContext(): Promise<BoksUserContext | null> {
  if (!supabase) return null;

  return getCurrentBoksUserContext();
}

export async function updateBoksProfile(input: { handle?: string }): Promise<BoksUserContext | null> {
  if (!supabase) return null;

  const result = await supabase.rpc("update_boks_user_profile", {
    p_display_name: "",
    p_handle: input.handle ?? "",
  });
  if (result.error) throw result.error;

  return result.data as BoksUserContext;
}

export async function acceptBoksTerms(termsVersion: string): Promise<BoksUserContext | null> {
  if (!supabase) return null;

  const result = await supabase.rpc("accept_boks_terms", {
    p_terms_version: termsVersion,
  });
  if (result.error) throw result.error;

  return result.data as BoksUserContext;
}

/**
 * The byline is not an input. `submit_bok_for_review` reads the author's
 * display name and @nickname from their profile, so a bok can never be
 * published under someone else's name.
 */
export async function submitBokForReview(input: {
  title: string;
  hook: string;
  body: string;
  /** Sent for compatibility; the database derives length from the text. */
  minutes: number;
  /** The byline for this piece. Empty means "whatever I used last time". */
  authorName?: string;
  /** The author's statement that they may publish this. Required. */
  rightsConfirmed: boolean;
  /** Why they may, in their own words. Admin-only, and optional. */
  rightsNote?: string;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("submit_bok_for_review", {
    p_title: input.title,
    p_hook: input.hook,
    p_text: input.body,
    p_author_name: input.authorName ?? "",
    // Genre and mood are no longer asked of the author; the database defaults
    // them. They remain ranking inputs, not questions.
    p_genre: "",
    p_mood: "",
    p_minutes: input.minutes,
    p_rights_confirmed: input.rightsConfirmed,
    p_rights_note: input.rightsNote ?? "",
  });

  if (result.error) throw result.error;

  return result.data as {
    id: string;
    title: string;
    status: string;
    authorName: string;
    authorHandle: string;
    submittedAt: string;
  };
}

/**
 * The byline to put in the compose form before the author touches it: whatever
 * they published under last time, falling back to their @nickname.
 */
export async function loadMyDefaultAuthorName(): Promise<string> {
  if (!supabase) return "";

  const result = await supabase.rpc("get_my_default_author_name");
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return "";
    throw result.error;
  }
  return (result.data as string | null) ?? "";
}

export async function loadMyBokSubmissions(limit = 50): Promise<AuthorBokSubmission[]> {
  if (!supabase) return [];

  const result = await supabase.rpc("get_my_bok_submissions", {
    p_limit: limit,
  });

  if (result.error) throw result.error;

  return (result.data ?? []) as AuthorBokSubmission[];
}

export async function reviewBokSubmission(input: {
  bokId: string;
  decision: "approve" | "reject";
  reason?: string;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("review_bok_submission", {
    p_bok_id: input.bokId,
    p_decision: input.decision,
    p_reason: input.reason ?? "",
  });

  if (result.error) throw result.error;

  return result.data as { id: string; title: string; status: string; reviewedAt: string; reviewNote: string | null };
}

/**
 * The accounts an import may publish into. Empty until an admin marks one:
 * that is the guard that keeps a mistyped handle from pouring a catalogue into
 * a reader's account.
 */
export async function loadBoksPublishers(): Promise<BoksPublisher[]> {
  if (!supabase) return [];

  const result = await supabase.rpc("list_boks_publishers");
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return [];
    throw result.error;
  }

  return (result.data as BoksPublisher[]) ?? [];
}

/** The reader's language filter. Empty means all, never none. */
export async function setMyReadingLanguages(languages: readonly string[]) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("set_my_reading_languages", {
    p_languages: normalizeReadingLanguages(languages),
  });
  if (result.error) throw result.error;

  return result.data as { readingLanguages: string[]; catalogue: Record<string, number> };
}

export async function loadBoksLanguageDemand(): Promise<LanguageDemandRow[]> {
  if (!supabase) return [];

  const result = await supabase.rpc("get_boks_language_demand");
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return [];
    throw result.error;
  }

  return (result.data as LanguageDemandRow[]) ?? [];
}

export async function setBoksPublisher(handle: string, isPublisher = true) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("set_boks_publisher", {
    p_handle: handle,
    p_is_publisher: isPublisher,
  });
  if (result.error) throw result.error;

  return result.data as { handle: string; userId: string; isPublisher: boolean };
}

/**
 * One batch. The caller splits a catalogue into batches and reports progress;
 * the database caps a call at 100 rows, because a request that takes minutes
 * is one a phone or a proxy will drop halfway with nothing to show for it.
 */
export async function importBoksBatch(input: {
  publisherHandle: string;
  rows: CatalogueRow[];
  publish?: boolean;
  /** The admin attests for the batch; a row may still carry its own note. */
  rightsConfirmed: boolean;
  rightsNote?: string;
}): Promise<BoksImportReport> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("import_boks_batch", {
    p_publisher_handle: input.publisherHandle,
    p_rows: input.rows,
    p_publish: input.publish ?? true,
    p_rights_confirmed: input.rightsConfirmed,
    p_rights_note: input.rightsNote ?? "",
  });
  if (result.error) throw result.error;

  return result.data as BoksImportReport;
}

/**
 * Removes an imported batch by import-key prefix. Called once without
 * `confirm` to learn how many would go, then again with it.
 */
export async function deleteBoksImport(input: {
  publisherHandle: string;
  prefix: string;
  confirm?: boolean;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("delete_boks_import", {
    p_publisher_handle: input.publisherHandle,
    p_import_key_prefix: input.prefix,
    p_confirm: input.confirm ? input.prefix : null,
  });
  if (result.error) throw result.error;

  return result.data as { publisher: string; prefix: string; matched: number; deleted: number; note?: string };
}

/**
 * A reader reports a boks. Open to guests as well as accounts: the person
 * whose work was taken need not have signed up here first.
 */
export async function reportBok(input: { reelId: string; reason: string; kind?: "copyright" | "other" }) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("report_bok", {
    p_reel_id: input.reelId,
    p_reason: input.reason,
    p_kind: input.kind ?? "copyright",
  });
  if (result.error) throw result.error;

  return result.data as { status: "received" | "already"; id: string };
}

export async function loadBoksRightsReview(status: "open" | "all" = "open", limit = 50) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("get_boks_rights_review", { p_status: status, p_limit: limit });
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) {
      return { openReports: 0, unattested: 0, reports: [], unattestedBoks: [] } as BoksRightsReview;
    }
    throw result.error;
  }

  return result.data as BoksRightsReview;
}

export async function reviewBokReport(input: {
  reportId: string;
  decision: "actioned" | "dismissed";
  note?: string;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("review_bok_report", {
    p_report_id: input.reportId,
    p_decision: input.decision,
    p_note: input.note ?? "",
  });
  if (result.error) throw result.error;

  return result.data as { id: string; reelId: string; status: string; bokStatus: string };
}

/**
 * Removes the seeded demo catalogue. Reports first: called without `confirm`
 * it only counts, because the deletion cascades to everything readers did with
 * those boks.
 */
export async function deleteSeedBoks(confirm = false) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("delete_seed_boks", {
    p_confirm: confirm ? "delete the demo catalogue" : null,
  });
  if (result.error) throw result.error;

  return result.data as { seeds: number; authored: number; deleted: number; note?: string };
}

export async function setBokRights(input: { reelId: string; confirmed: boolean; note?: string }) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("set_bok_rights", {
    p_reel_id: input.reelId,
    p_confirmed: input.confirmed,
    p_note: input.note ?? "",
  });
  if (result.error) throw result.error;

  return result.data as { reelId: string; confirmed: boolean };
}

export async function loadReaderLibrary(limit = 120): Promise<ReaderLibraryItem[]> {
  if (!supabase) return [];

  const result = await supabase.rpc("get_my_reader_library", { p_limit: limit });
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return [];
    throw result.error;
  }

  return (result.data ?? []) as ReaderLibraryItem[];
}

export async function loadSupabaseStory(storyId: string): Promise<Story | null> {
  if (!supabase) return null;

  const user = await getCurrentSupabaseUser();
  if (!user || user.is_anonymous) return null;

  const reelResult = await supabase
    .from("published_boks")
    .select("id,title,author_name,author_handle,author_user_id,hook,text,genre,mood,minutes,word_count,created_at")
    .eq("id", storyId)
    .eq("status", "published")
    .maybeSingle();

  if (reelResult.error) throw reelResult.error;
  if (!reelResult.data) return null;

  const likedStoryIds = await loadLikedStoryIds(user.id, [storyId]);
  return mapSupabaseReelToStory(reelResult.data as SupabaseReelRow, new Set(likedStoryIds));
}

export async function claimInitialBoksAdmin(): Promise<BoksUserContext | null> {
  if (!supabase) return null;

  const result = await supabase.rpc("claim_initial_boks_admin");
  if (result.error) throw result.error;

  return result.data as BoksUserContext;
}

export async function setBoksAdminRole(userId: string, isAdmin: boolean) {
  if (!supabase) return;

  const result = await supabase.rpc("set_boks_admin_role", {
    p_user_id: userId,
    p_is_admin: isAdmin,
  });
  if (result.error) throw result.error;
}

async function loadLikedStoryIds(userId: string, reelIds: string[]) {
  if (!supabase || !reelIds.length) return [];

  const likesResult = await supabase
    .from("likes")
    .select("reel_id")
    .eq("user_id", userId)
    .in("reel_id", reelIds);

  if (likesResult.error) throw likesResult.error;

  return ((likesResult.data ?? []) as SupabaseLikeRow[]).map((like) => like.reel_id);
}

async function loadSupabaseCommentsForReels(reelIds: string[]): Promise<Comment[]> {
  if (!supabase || !reelIds.length) return [];

  const commentsResult = await supabase
    .from("boks_comments")
    .select("id,reel_id,visitor_handle,body,created_at")
    .in("reel_id", reelIds)
    .order("created_at", { ascending: true })
    .limit(1000);

  if (commentsResult.error) throw commentsResult.error;

  return ((commentsResult.data ?? []) as SupabaseCommentRow[]).map((comment) => ({
    id: comment.id,
    storyId: comment.reel_id,
    visitorName: comment.visitor_handle || "reader",
    visitorHandle: comment.visitor_handle,
    body: comment.body,
    createdAt: comment.created_at,
  }));
}

export async function recordSupabaseView(userId: string | null, storyId: string) {
  if (!supabase || !userId) return;

  const result = await supabase.from("views").insert({
    user_id: userId,
    reel_id: storyId,
  });

  if (result.error) throw result.error;
}

export async function setSupabaseLike(userId: string | null, storyId: string, liked: boolean) {
  if (!supabase || !userId) return;
  const user = await getCurrentSupabaseUser();
  if (!user || user.is_anonymous) throw new Error("Create a free account to like boks.");

  const result = liked
    ? await supabase.from("likes").upsert(
        {
          user_id: user.id,
          reel_id: storyId,
        },
        { onConflict: "user_id,reel_id" }
      )
    : await supabase.from("likes").delete().eq("user_id", user.id).eq("reel_id", storyId);

  if (result.error) throw result.error;
}

export async function submitSupabaseComment(storyId: string, body: string): Promise<Comment> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const user = await getCurrentSupabaseUser();
  if (!user || user.is_anonymous) throw new Error("Create a free account to comment.");

  const result = await supabase.rpc("create_bok_comment", {
    p_reel_id: storyId,
    p_body: body,
  });

  if (result.error) throw result.error;

  return result.data as Comment;
}
