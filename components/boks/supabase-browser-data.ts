"use client";

import { initialMetrics } from "@/components/boks/constants";
import type { FeedbackSurface } from "@/components/boks/feedback";
import type {
  BoksFeedbackPage,
  GuestFunnel,
  LinkAttribution,
  AdminBokDetail,
  AdminPersonDetail,
  AuthorBokQuota,
  BoksContentRow,
  BoksGrowth,
  BoksOverview,
  BoksPersonRow,
  AuthorBokSubmission,
  AuthorProfile,
  BoksUserContext,
  Comment,
  CommentLikeState,
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
import {
  markWorkerFeedHealthy,
  markWorkerFeedUnavailable,
  opensWorkerFeedBreaker,
  shouldTryWorkerFeed,
  WorkerFeedError,
  workerFeedTimeoutMs,
} from "@/components/boks/worker-feed-breaker";
import type { CatalogueRow } from "@/lib/boks/import/parse-catalogue";
import { serveReaderFeed, type FeedTransport } from "@/lib/boks/feed-service";
import {
  candidatesFromReelRows,
  candidatesFromRollupRows,
  mapSupabaseReelToStory,
  publishedReelColumns,
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
  /** The guest's language filter; a signed-in reader's stored one wins. */
  readingLanguages?: readonly string[];
};

type WorkerFeedResponse = {
  feedId: string | null;
  experiment: RecommendationExperiment;
  entries: { reelId: string; rank: number; score: number }[];
  reels: SupabaseReelRow[];
  servingBackend: "worker" | "browser";
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

  // A Worker that just failed is not asked again for a while - see
  // `worker-feed-breaker.ts`. Otherwise every load and every reload after a
  // like paid for its 503 before ranking here anyway.
  if (!shouldTryWorkerFeed()) {
    return loadBrowserReaderFeed(userId, request, "worker_feed_cooling_down");
  }

  try {
    const payload = await loadWorkerFeedRefreshingOnce(userId, request);
    markWorkerFeedHealthy();
    return payload;
  } catch (error) {
    // Only an unreachable or failing Worker opens the breaker. A 4xx is about
    // this request, not about the Worker, and cooling down for two minutes on
    // it labelled every feed in that window degraded for no reason.
    if (opensWorkerFeedBreaker(error)) markWorkerFeedUnavailable();
    console.warn("Worker feed unavailable; ranking in the browser (degraded).", error);
    return loadBrowserReaderFeed(userId, request, describeFeedError(error));
  }
}

/**
 * A tab back from the background can hold an access token that expired while
 * it slept. The Worker answers 401; the session is refreshed and the request
 * made once more before anything is treated as a failure.
 */
async function loadWorkerFeedRefreshingOnce(userId: string, request: SupabaseFeedRequest) {
  try {
    return await loadWorkerReaderFeed(userId, request);
  } catch (error) {
    if (!(error instanceof WorkerFeedError) || error.status !== 401 || !supabase) throw error;
    const refreshed = await supabase.auth.refreshSession();
    const token = refreshed.data.session?.access_token;
    if (!token) throw error;
    return loadWorkerReaderFeed(userId, request, token);
  }
}

async function loadWorkerReaderFeed(
  userId: string,
  request: SupabaseFeedRequest,
  accessToken?: string
): Promise<SupabaseReaderPayload> {
  const token = accessToken ?? (await currentAccessToken());
  if (!token) throw new WorkerFeedError("No Supabase session to authorise the feed request.", 401);

  // Bounded: a Worker stuck waiting on a slow database must not hold the
  // reader on "Loading" when the browser can rank the same feed itself.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), workerFeedTimeoutMs);
  let response: Response;
  let payload: WorkerFeedResponse;
  try {
    response = await fetch("/api/feed", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        limit: request.limit,
        sessionId: request.sessionId,
        reader: request.reader,
        profileSnapshot: request.profileSnapshot ?? {},
        // The language filter. It was sent only on the browser fallback path,
        // so the normal Worker feed was unfiltered and the mix of languages
        // changed depending on which path served it.
        readingLanguages: request.readingLanguages ?? [],
      }),
    });
    // Cloudflare answers a Worker over its limits with an HTML page, not JSON.
    const text = await response.text();
    try {
      payload = JSON.parse(text) as WorkerFeedResponse;
    } catch {
      throw new WorkerFeedError(`Feed request failed (${response.status}, not JSON).`, response.status);
    }
  } catch (error) {
    if (error instanceof WorkerFeedError) throw error;
    // Aborted by the timeout, or no answer at all.
    throw new WorkerFeedError(error instanceof Error ? error.message : "Feed request failed.", 0);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new WorkerFeedError(payload.error || `Feed request failed (${response.status}).`, response.status);
  }

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

/** Reader-specific reactions for a slate that has already been ranked and recorded. */
async function decorateServedFeed(input: {
  userId: string;
  reels: SupabaseReelRow[];
  experiment: RecommendationExperiment;
  provenance: FeedProvenance;
}): Promise<SupabaseReaderPayload> {
  const rankedIds = input.reels.map((reel) => reel.id);
  const likedStoryIds = await loadLikedStoryIds(input.userId, rankedIds);
  // Bodies are intentionally not fetched for every boks in the slate. The
  // candidate rows already contain aggregate counts; the conversation itself
  // is loaded only when its sheet opens.
  const stories = input.reels.map((reel) => mapSupabaseReelToStory(reel));

  return {
    stories,
    comments: [],
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

/** Stored in `served_feed.fallback_reason`, so a status, never free text. */
function describeFeedError(error: unknown) {
  if (error instanceof WorkerFeedError) {
    return error.status ? `worker_feed_unavailable: http_${error.status}` : "worker_feed_unavailable: no_response";
  }
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

    async publishedReels(limit: number, languages?: readonly string[]) {
      if (!supabase) throw new Error("Supabase is not configured.");
      // Published-only by definition; the view has no `status` to filter on.
      let query = supabase.from("published_boks").select(publishedReelColumns);
      // The same rule as the candidates RPC: nothing named, no filter;
      // otherwise only what was named, so undetermined is not a yes.
      const codes = normalizeReadingLanguages(languages);
      if (codes.length) query = query.in("language", codes);
      const result = await query.order("created_at", { ascending: false }).limit(limit);
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
 * PostgREST codes that mean "this session's token was refused".
 *
 * PGRST301 is a token that does not verify, PGRST303 one that has expired,
 * 42501 a role without the privilege. The Worker's REST transport decides the
 * same question by HTTP status (401/403); these are what supabase-js reports
 * for the same answers.
 */
const authFailureCodes = new Set(["PGRST301", "PGRST302", "PGRST303", "42501"]);

/**
 * A rejected token must be distinguishable from a missing table, or an expired
 * session silently becomes a recency feed attributed to an arm nobody assigned.
 */
export function asTransportError(error: { code?: string; message?: string }) {
  const failure = new Error(error.message ?? "Supabase request failed.") as Error & {
    isAuthFailure?: boolean;
    code?: string;
  };
  failure.code = error.code;
  failure.isAuthFailure = authFailureCodes.has(error.code ?? "");
  return failure;
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
  options: {
    limit?: number;
    offset?: number;
    query?: string;
    sort?: string;
    status?: "published" | "archived";
  } = {}
) {
  if (!supabase) return { total: 0, rows: [] as BoksContentRow[] };

  const result = await supabase.rpc("get_boks_content", {
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
    p_query: options.query ?? "",
    p_sort: options.sort ?? "minutes",
    p_status: options.status ?? "published",
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
    // The RPC's default was 40, while the sheet's heading states the full
    // count - so a writer with 50 boks showed "50 boks" over a list of 40,
    // and ten of them could not be reached from their own page. 200 is the
    // RPC's ceiling; past it the sheet says how many it shows.
    p_limit: 200,
  });
  if (result.error) {
    if (isMissingDatabaseObject(result.error)) return null;
    throw result.error;
  }
  return (result.data ?? null) as AuthorProfile | null;
}

/**
 * The candidate set the admin lab's divergence check ranks.
 *
 * Through the same transport and mapper the feed uses, so the check sees what
 * a reader's ranker sees. One caveat it cannot escape: the RPC answers as the
 * caller, so the set reflects the admin's own stored languages, and each
 * candidate's `mine` history is the admin's.
 */
export async function loadRecommendationCandidates(limit = 400): Promise<StoryCandidate[]> {
  const transport = createBrowserFeedTransport();
  try {
    const rows = await transport.rpc<SupabaseCandidateRow[]>("get_recommendation_candidates", {
      p_limit: Math.max(limit, 200),
      p_languages: [],
    });
    return candidatesFromRollupRows(rows ?? []).candidates;
  } catch (error) {
    if (!isMissingDatabaseObject(error as { code?: string; message?: string })) throw error;
    return candidatesFromReelRows(await transport.publishedReels(Math.max(limit, 200))).candidates;
  }
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
    // The column predates readers as the unit; it holds readers now.
    p_minimum_impressions_per_arm: safeConfig.minimumReadersPerArm,
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

  // Keepalive needs the reader's token up front: the RPC refuses a call
  // without a user, so sending the publishable key in its place could never
  // succeed. Without a cached token the batch goes through supabase-js, which
  // can still find the session, and a cancelled request costs no more than a
  // refused one did.
  const keepaliveToken = delivery.keepalive ? getCachedAccessToken() : null;
  if (keepaliveToken && supabaseRestUrl && supabasePublishableApiKey) {
    const token = keepaliveToken;
    const response = await fetch(`${supabaseRestUrl}/rpc/record_recommendation_events`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: supabasePublishableApiKey,
        Authorization: `Bearer ${token}`,
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
      minimumReadersPerArm: experiment.minimumReadersPerArm,
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
  /** Optional: left empty, the database titles the boks by its first line. */
  title: string;
  body: string;
  /** Sent for compatibility; the database derives length from the text. */
  minutes: number;
  /** The byline for this piece. Empty means "whatever I used last time". */
  authorName?: string;
  /** The author's statement that they may publish this. Required. */
  rightsConfirmed: boolean;
  /** Why they may, in their own words. Admin-only, and optional. */
  rightsNote?: string;
  /** A refused boks of this author's being revised: resubmitted in place. */
  bokId?: string | null;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("submit_bok_for_review", {
    p_title: input.title,
    p_text: input.body,
    p_author_name: input.authorName ?? "",
    // Genre and mood are no longer asked of the author; the database defaults
    // them. They remain ranking inputs, not questions.
    p_genre: "",
    p_mood: "",
    p_minutes: input.minutes,
    p_rights_confirmed: input.rightsConfirmed,
    p_rights_note: input.rightsNote ?? "",
    p_bok_id: input.bokId ?? null,
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

/**
 * One published boks by id - a shared link, or a piece reopened from history.
 *
 * Open to guests: a shared link is mostly followed by someone without an
 * account, and every column here is already public in the view. It used to
 * return null for them, and for everyone else it failed outright - it filtered
 * on `status`, which `published_boks` does not expose (it is published-only by
 * definition), so PostgREST answered 42703 and the link opened the ordinary
 * feed instead of the boks.
 */
/**
 * Title and author for the series shelf - a handful of known ids, never
 * the catalogue. A piece missing from the answer is not published any more (an
 * admin hid it), and the shelf drops it. Null when there is no Supabase at all,
 * so the shelf keeps the titles it was built with.
 */
export async function loadSeriesBoks(
  storyIds: readonly string[]
): Promise<Map<string, { title: string; authorName: string }> | null> {
  if (!supabase || storyIds.length === 0) return null;

  const result = await supabase
    .from("published_boks")
    .select("id,title,author_name")
    .in("id", [...storyIds]);
  if (result.error) throw result.error;

  const rows = (result.data ?? []) as { id: string; title: string | null; author_name: string | null }[];
  return new Map(
    rows.map((row) => [
      String(row.id),
      {
        title: row.title ?? "",
        authorName: row.author_name ?? "",
      },
    ])
  );
}

export async function loadSupabaseStory(storyId: string): Promise<{ story: Story; likedByMe: boolean } | null> {
  if (!supabase) return null;

  const reelResult = await supabase
    .from("published_boks")
    .select(publishedReelColumns)
    .eq("id", storyId)
    .maybeSingle();

  if (reelResult.error) throw reelResult.error;
  if (!reelResult.data) return null;

  // Read straight from the table this row has no counts, and a reader can see
  // only their own like, so the totals come from the aggregate - the same
  // numbers the feed shows for this boks.
  const reactions = await loadBokReactions([storyId]);
  const counts = reactions.get(storyId);

  // A boks outside the slate is not covered by the feed's `likedStoryIds`, so
  // this reader's own like is looked up here and handed back separately. The
  // total is returned without it - the reader's like lives in local state and
  // `displayedLikeCount` adds it back - the same convention as a boks held
  // across a reload, so the number is right before and after a tap.
  const user = await getCurrentSupabaseUser();
  const likedByMe =
    user && !user.is_anonymous ? (await loadLikedStoryIds(user.id, [storyId])).includes(storyId) : false;

  return {
    story: mapSupabaseReelToStory({
      ...(reelResult.data as SupabaseReelRow),
      likes_count: Math.max(0, (counts?.likes ?? 0) - (likedByMe ? 1 : 0)),
      comments_count: counts?.comments ?? 0,
    }),
    likedByMe,
  };
}

export async function setBoksAdminRole(userId: string, isAdmin: boolean) {
  if (!supabase) return;

  const result = await supabase.rpc("set_boks_admin_role", {
    p_user_id: userId,
    p_is_admin: isAdmin,
  });
  if (result.error) throw result.error;
  return result.data as { ok: true; userId: string; role: "reader" | "admin" };
}

export async function setBoksUserBan(userId: string, banned: boolean, reason = "") {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("set_boks_user_ban", {
    p_user_id: userId,
    p_banned: banned,
    p_reason: reason,
  });
  if (result.error) throw result.error;
  return result.data as { ok: true; userId: string; banned: boolean; reason: string | null };
}

export async function deleteBoksUser(userId: string, confirmation: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("delete_boks_user", {
    p_user_id: userId,
    p_confirm: confirmation,
  });
  if (result.error) throw result.error;
  return result.data as { ok: true; userId: string; archivedBoks: number };
}

/**
 * One note from a reader.
 *
 * Works without an account: a guest already holds an anonymous Supabase
 * session, which the RPC accepts (bare publishable-key calls are refused since
 * `20260925160420`), and the visitor id is what groups a guest's notes. Everything the note needs to be read in
 * context - where the box was opened, how many boks they had read - travels
 * with it, because none of it can be reconstructed afterwards.
 */
export async function sendBoksFeedback(input: {
  message: string;
  surface: FeedbackSurface;
  boksRead?: number;
  visitorId?: string;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("submit_boks_feedback", {
    p_message: input.message,
    p_surface: input.surface,
    p_boks_read: input.boksRead ?? null,
    p_visitor_id: input.visitorId ?? null,
  });
  if (result.error) throw result.error;
  return result.data as { ok: true; id: number };
}

/** Guests, counted by device, and how they meet the sign-up. Admin-only on the server. */
export async function loadGuestFunnel(
  days = 14,
  options: { includeTeam?: boolean; hideCountries?: string[] } = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("get_guest_funnel", {
    p_days: days,
    p_include_team: options.includeTeam ?? false,
    p_hide_countries: options.hideCountries?.length ? options.hideCountries : null,
  });
  if (result.error) throw result.error;
  return result.data as GuestFunnel;
}

/** What each tracked link and each landed bok brought. Admin-only on the server. */
export async function loadLinkAttribution(
  days = 30,
  options: { includeTeam?: boolean; hideCountries?: string[] } = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("get_link_attribution", {
    p_days: days,
    p_include_team: options.includeTeam ?? false,
    p_hide_countries: options.hideCountries?.length ? options.hideCountries : null,
  });
  if (result.error) throw result.error;
  return result.data as LinkAttribution;
}

/** Makes a tracked link. The code is generated when not given. Admin-only on the server. */
export async function createTrackedLink(input: { label: string; bokId?: string | null; code?: string | null }) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("create_tracked_link", {
    p_label: input.label,
    p_bok_id: input.bokId ?? null,
    p_code: input.code ?? null,
  });
  if (result.error) throw result.error;
  return result.data as { code: string; label: string; bokId: string | null; bokTitle: string | null };
}

/** Archives or restores a tracked link; an archived one still counts visits. Admin-only on the server. */
export async function setTrackedLinkArchived(code: string, archived: boolean) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc("set_tracked_link_archived", { p_code: code, p_archived: archived });
  if (result.error) throw result.error;
}

/** Keeps this browser out of the guest numbers. Admin-only on the server. */
export async function markTeamDevice(visitorId: string, label?: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc("mark_team_device", { p_visitor_id: visitorId, p_label: label ?? null });
  if (result.error) throw result.error;
}

export async function unmarkTeamDevice(visitorId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc("unmark_team_device", { p_visitor_id: visitorId });
  if (result.error) throw result.error;
}

export async function listTeamDevices() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc("list_team_devices");
  if (result.error) throw result.error;
  return (result.data ?? []) as { visitorId: string; label: string | null; createdAt: string }[];
}

/** The feedback inbox. Admin-only on the server. */
export async function loadBoksFeedback(options: { limit?: number; offset?: number } = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("get_boks_feedback", {
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
  });
  if (result.error) throw result.error;
  return result.data as BoksFeedbackPage;
}

/**
 * How much of the catalogue carries a current semantic vector.
 *
 * Worth a line in the console because nothing else says whether the semantic
 * half of the ranking is switched on: a boks with no vector is ranked on
 * behaviour alone, silently and correctly, so a catalogue that quietly stopped
 * being embedded looks exactly like one that never was.
 */
export async function loadEmbeddingCoverage() {
  if (!supabase) return null;
  const result = await supabase.rpc("boks_embedding_coverage");
  if (result.error) throw result.error;
  return result.data as {
    model: string;
    publishedTotal: number;
    publishedEmbedded: number;
    publishedMissing: number;
    pendingMissing: number;
    lastEmbeddedAt: string | null;
  };
}

/** One boks in any status, for the admin inspector. Admin-only on the server. */
export async function loadAdminBok(reelId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("get_admin_bok", { p_reel_id: reelId });
  if (result.error) throw result.error;
  return result.data as AdminBokDetail;
}

/** One account with its metrics and activity, for the admin inspector. Admin-only on the server. */
export async function loadAdminPerson(userId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("get_admin_person", { p_user_id: userId });
  if (result.error) throw result.error;
  return result.data as AdminPersonDetail;
}

/** The signed-in reader deletes their own account. Admin accounts cannot. */
export async function deleteMyBoksAccount(confirmation: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("delete_my_boks_account", { p_confirm: confirmation });
  if (result.error) throw result.error;
  return result.data as { ok: true; archivedBoks: number };
}

export async function archiveBok(reelId: string, reason: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("archive_bok", { p_reel_id: reelId, p_reason: reason });
  if (result.error) throw result.error;
  return result.data as { ok: true; id: string; title: string; status: "archived" };
}

export async function restoreArchivedBok(reelId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("restore_archived_bok", { p_reel_id: reelId });
  if (result.error) throw result.error;
  return result.data as { ok: true; id: string; title: string; status: "published" };
}

export async function permanentlyDeleteArchivedBok(reelId: string, confirmation: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("delete_archived_bok", {
    p_reel_id: reelId,
    p_confirm: confirmation,
  });
  if (result.error) throw result.error;
  return result.data as { ok: true; id: string; title: string; permanentlyDeleted: true };
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

/** Public like and comment totals, by boks id. Counts only - never who. */
async function loadBokReactions(reelIds: string[]) {
  const counts = new Map<string, { likes: number; comments: number }>();
  if (!supabase || !reelIds.length) return counts;
  const result = await supabase.rpc("get_bok_reactions", { p_reel_ids: reelIds });
  if (result.error) throw result.error;
  for (const row of (result.data ?? []) as { id: string; likes: number; comments: number }[]) {
    counts.set(row.id, { likes: Number(row.likes) || 0, comments: Number(row.comments) || 0 });
  }
  return counts;
}

export async function loadSupabaseComments(storyId: string): Promise<Comment[]> {
  if (!supabase) return [];

  const result = await supabase.rpc("get_bok_comments", { p_reel_id: storyId });
  if (result.error) throw result.error;
  return (result.data ?? []) as Comment[];
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

export async function submitSupabaseComment(
  storyId: string,
  body: string,
  parentCommentId: number | null = null
): Promise<Comment> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const user = await getCurrentSupabaseUser();
  if (!user || user.is_anonymous) throw new Error("Create a free account to comment.");

  const result = await supabase.rpc("create_bok_comment", {
    p_reel_id: storyId,
    p_body: body,
    p_parent_comment_id: parentCommentId,
  });

  if (result.error) throw result.error;

  return result.data as Comment;
}

/** Deletes a comment and its replies. The writer may; an admin may delete any. */
export async function deleteSupabaseComment(commentId: number) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const result = await supabase.rpc("delete_boks_comment", { p_comment_id: commentId });
  if (result.error) throw result.error;
  return result.data as { ok: true; id: number; reelId: string; repliesRemoved: number };
}

export async function setSupabaseCommentLike(
  commentId: number,
  liked: boolean
): Promise<CommentLikeState> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const user = await getCurrentSupabaseUser();
  if (!user || user.is_anonymous) throw new Error("Create a free account to like comments.");

  const result = await supabase.rpc("set_bok_comment_like", {
    p_comment_id: commentId,
    p_liked: liked,
  });
  if (result.error) throw result.error;
  return result.data as CommentLikeState;
}
