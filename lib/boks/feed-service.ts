import {
  assignExperimentArm,
  buildReaderFeed,
  defaultExperimentConfig,
  emptyReaderSignals,
  isRecommendationAlgorithmId,
  normalizeExperimentConfig,
  recommendationAlgorithmName,
  type RankedStory,
  type ReaderSignals,
  type RecommendationExperiment,
  type RecommendationExperimentConfig,
} from "@/lib/boks/recommendations";
import {
  LABELING_VERSION,
  RANKING_VERSION,
  SIGNALS_VERSION,
} from "@/lib/boks/recommendations/versions";
import {
  candidatesFromReelRows,
  candidatesFromRollupRows,
  type CandidateSet,
  type SupabaseCandidateRow,
  type SupabaseReelRow,
} from "@/lib/boks/supabase-reels";
import type { UserSegment } from "@/lib/boks/contracts";
import { randomBoksId } from "@/lib/boks/browser-id";

/**
 * Assembling and recording a served feed.
 *
 * This is the module ADR-001 moved to the Worker. It is written against a
 * transport rather than against Supabase directly for two reasons: the browser
 * degraded path must run the *same* assembly so the two cannot drift, and the
 * equivalence the ADR promises is then assertable offline with a fake
 * transport instead of a sampled shadow comparison in production.
 */

export type ServingBackend = "worker" | "browser";

export type FeedTransport = {
  /** Calls a PostgREST RPC as the reader whose feed this is. */
  rpc<Result>(name: string, body?: Record<string, unknown>): Promise<Result>;
  /**
   * Published reels, newest first. Used only when the rollup RPC fails.
   *
   * `languages` is the same retrieval filter the RPC applies: empty means no
   * filter; otherwise only those languages, and an undetermined one is not a
   * yes (`docs/reading-languages.md`).
   */
  publishedReels(limit: number, languages?: readonly string[]): Promise<SupabaseReelRow[]>;
  /** Total published boks, so catalog headroom is a measurement, not a guess. */
  publishedCount(): Promise<number>;
};

export type ServeReaderFeedRequest = {
  userId: string;
  sessionId: string;
  limit: number;
  reader?: ReaderSignals;
  /** Admin preview only. Readers never choose an algorithm. */
  requestedAlgorithmId?: string | null;
  servingBackend: ServingBackend;
  /**
   * The reader profile the ranking saw. Stored verbatim: the profile changes
   * with every read, so without a snapshot no serve can be replayed.
   */
  profileSnapshot?: Record<string, unknown>;
  buildId?: string | null;
  /**
   * Languages the reader accepts, for a reader with no stored preference -
   * a guest. The filter is applied in retrieval rather than in ranking: "I do
   * not read Russian" is a capability, not a preference, and no score may
   * outvote it. A signed-in reader's stored choice wins over this inside the
   * RPC.
   */
  readingLanguages?: readonly string[];
  now?: Date;
};

export type ServedFeed = {
  /** Null when provenance could not be written. The feed is served anyway. */
  feedId: string | null;
  experiment: RecommendationExperiment;
  entries: RankedStory[];
  /** The delivered slate, in delivered order. */
  reels: SupabaseReelRow[];
  servingBackend: ServingBackend;
  degradedMode: boolean;
  fallbackReason: string | null;
  candidateCount: number;
  catalogSize: number;
  candidateRequestId: string;
  signalsVersion: string;
  rankingVersion: string;
  labelingVersion: string;
};

/** The split used while the recommendation migration is missing. */
const recencyOnlyConfig: RecommendationExperimentConfig = {
  key: "boks-feed-unmigrated",
  controlAlgorithmId: "recency",
  arms: [{ algorithmId: "recency", weight: 100 }],
  minimumReadersPerArm: defaultExperimentConfig.minimumReadersPerArm,
};

export async function serveReaderFeed(
  transport: FeedTransport,
  request: ServeReaderFeedRequest
): Promise<ServedFeed> {
  const limit = Math.max(1, request.limit);
  // Independent reads go out together. Sequentially they were five round
  // trips to the database before a reader saw anything, which on a
  // high-latency connection outran the browser's patience for the Worker.
  const [config, candidateSet, publishedCount] = await Promise.all([
    loadExperimentConfig(transport),
    loadCandidates(transport, limit, request.readingLanguages),
    loadPublishedCount(transport),
  ]);
  const activeConfig = candidateSet.degraded ? recencyOnlyConfig : config;

  // The reader is the unit of assignment, so the subject is the Supabase user
  // id: the same person on a second device must land in the same arm, or every
  // per-reader comparison is polluted.
  //
  // A degraded serve is deliberately kept *out* of the experiment. Ranking over
  // a candidate set with no behavioural rollups is a different ranker; crediting
  // it to the reader's stored arm would file feeds under an experiment that did
  // not produce them.
  const experiment = await resolveExperiment(transport, request, activeConfig, candidateSet.degraded);

  // The reader's history with each candidate comes from the server, not from
  // the browser: it decides fatigue, novelty and every personalised signal, and
  // a profile read from local storage made the same person on a second device
  // rank as a stranger.
  const reader: ReaderSignals = {
    ...emptyReaderSignals,
    ...request.reader,
    bokState: candidateSet.readerState,
    followedAuthorIds: candidateSet.followedAuthorIds,
  };

  const feed = buildReaderFeed({
    visitorId: request.userId,
    candidates: candidateSet.candidates,
    reader,
    experimentConfig: activeConfig,
    experiment,
    limit,
    now: request.now,
  });

  // A wrong catalog size would understate how much of it a reader has
  // consumed, so a failed count falls back to what was actually offered.
  const catalogSize = publishedCount ?? candidateSet.candidates.length;
  const candidateRequestId = randomBoksId();

  const feedId = await recordProvenance(transport, {
    sessionId: request.sessionId,
    experiment: feed.experiment,
    entries: feed.entries,
    candidateRequestId,
    candidateCount: candidateSet.candidates.length,
    catalogSize,
    servingBackend: request.servingBackend,
    degradedMode: candidateSet.degraded || request.servingBackend !== "worker",
    fallbackReason: candidateSet.fallbackReason,
    // What the ranking actually saw, not what the client claimed. Replay needs
    // the server-side half or it cannot reconstruct the slate.
    profileSnapshot: {
      ...(request.profileSnapshot ?? {}),
      followedAuthorIds: reader.followedAuthorIds,
      bokState: reader.bokState,
    },
    buildId: request.buildId ?? null,
  });

  return {
    feedId,
    experiment: feed.experiment,
    entries: feed.entries,
    reels: feed.entries
      .map((entry) => candidateSet.reelsById.get(entry.candidate.id))
      .filter((reel): reel is SupabaseReelRow => Boolean(reel)),
    servingBackend: request.servingBackend,
    degradedMode: candidateSet.degraded || request.servingBackend !== "worker",
    fallbackReason: candidateSet.fallbackReason,
    candidateCount: candidateSet.candidates.length,
    catalogSize,
    candidateRequestId,
    signalsVersion: SIGNALS_VERSION,
    rankingVersion: RANKING_VERSION,
    labelingVersion: LABELING_VERSION,
  };
}

async function resolveExperiment(
  transport: FeedTransport,
  request: ServeReaderFeedRequest,
  config: RecommendationExperimentConfig,
  degraded: boolean
): Promise<RecommendationExperiment> {
  if (degraded) {
    return { ...assignExperimentArm(request.userId, config), source: "fallback" };
  }
  if (request.requestedAlgorithmId) {
    return assignExperimentArm(request.userId, config, request.requestedAlgorithmId);
  }
  return resolveStoredExperiment(transport, request.userId, config);
}

async function loadExperimentConfig(transport: FeedTransport) {
  try {
    return normalizeExperimentConfig(
      await transport.rpc<unknown>("get_active_recommendation_experiment")
    );
  } catch {
    return defaultExperimentConfig;
  }
}

type LoadedCandidates = CandidateSet & { degraded: boolean; fallbackReason: string | null };

async function loadCandidates(
  transport: FeedTransport,
  limit: number,
  readingLanguages?: readonly string[]
): Promise<LoadedCandidates> {
  try {
    const rows = await transport.rpc<SupabaseCandidateRow[]>("get_recommendation_candidates", {
      p_limit: Math.max(limit, 200),
      p_languages: readingLanguages ?? [],
    });
    return { ...candidatesFromRollupRows(rows ?? []), degraded: false, fallbackReason: null };
  } catch (error) {
    // A rejected token is not a degraded catalog. Serving a recency feed under
    // an expired session would hide a broken sign-in behind a working page and
    // attribute the reader's events to an arm nobody assigned them.
    if (isAuthFailure(error)) throw error;
    const rows = await transport.publishedReels(Math.max(limit, 200), readingLanguages ?? []);
    return {
      ...candidatesFromReelRows(rows),
      degraded: true,
      fallbackReason: `candidate_rollups_unavailable: ${describeErrorCode(error)}`,
    };
  }
}

async function loadPublishedCount(transport: FeedTransport): Promise<number | null> {
  try {
    return await transport.publishedCount();
  } catch {
    return null;
  }
}

/**
 * The arm this reader is actually on.
 *
 * The proposal is computed locally, then handed to the database, which either
 * stores it or returns the arm it already holds. An assignment is written once
 * and never silently rewritten — that is what makes a cohort or a before/after
 * comparison mean anything later.
 *
 * Recording it must never cost the reader their feed: if the write fails, the
 * locally computed arm still serves and events still carry its id, so
 * attribution survives even when the assignment row does not.
 */
async function resolveStoredExperiment(
  transport: FeedTransport,
  userId: string,
  config: RecommendationExperimentConfig
): Promise<RecommendationExperiment> {
  const proposed = assignExperimentArm(userId, config);

  try {
    const stored = await transport.rpc<{
      experimentKey?: string;
      algorithmId?: string;
      userSegment?: string;
    } | null>("record_recommendation_assignment", {
      p_experiment_key: proposed.experimentKey,
      p_algorithm_id: proposed.algorithmId,
      p_user_segment: proposed.userSegment,
      p_visitor_id: userId,
    });

    if (!stored?.algorithmId) return proposed;

    // A stored arm is honoured only while it is one this build can rank and
    // the active experiment still sends traffic to. Anything else - a removed
    // strategy, a parked arm, the RPC's `unassigned` default - would rank with
    // one strategy and credit the events to another.
    if (!isLiveArm(stored.algorithmId, config)) {
      return { ...proposed, source: "fallback" };
    }

    return {
      experimentKey: stored.experimentKey ?? proposed.experimentKey,
      algorithmId: stored.algorithmId,
      algorithmName: recommendationAlgorithmName(stored.algorithmId),
      userSegment: isUserSegment(stored.userSegment) ? stored.userSegment : proposed.userSegment,
      source: "assigned",
    };
  } catch {
    return proposed;
  }
}

type ProvenanceInput = {
  sessionId: string;
  experiment: RecommendationExperiment;
  entries: RankedStory[];
  candidateRequestId: string;
  candidateCount: number;
  catalogSize: number;
  servingBackend: ServingBackend;
  degradedMode: boolean;
  fallbackReason: string | null;
  profileSnapshot: Record<string, unknown>;
  buildId: string | null;
};

async function recordProvenance(transport: FeedTransport, input: ProvenanceInput) {
  try {
    const feedId = await transport.rpc<string | null>("record_served_feed", {
      p_feed: {
        sessionId: input.sessionId,
        experimentKey: input.experiment.experimentKey,
        experimentMode: "single",
        algorithmId: input.experiment.algorithmId,
        assignmentSource: input.experiment.source,
        candidateRequestId: input.candidateRequestId,
        candidateCount: input.candidateCount,
        catalogSize: input.catalogSize,
        servingBackend: input.servingBackend,
        degradedMode: input.degradedMode,
        fallbackReason: input.fallbackReason,
        signalsVersion: SIGNALS_VERSION,
        rankingVersion: RANKING_VERSION,
        labelingVersion: LABELING_VERSION,
        profileSnapshot: input.profileSnapshot,
        seed: input.experiment.experimentKey,
        buildId: input.buildId,
      },
      p_items: input.entries.map((entry) => ({
        reelId: entry.candidate.id,
        deliveredRank: entry.rank,
        score: entry.score,
        creditedAlgorithmId: input.experiment.algorithmId,
        candidateSource: entry.candidateSource ?? null,
        explanations: entry.explanations ?? [],
      })),
    });

    return typeof feedId === "string" ? feedId : null;
  } catch {
    // Provenance is required for research, not for reading. A feed that could
    // not be recorded is still served, and shows up in the data-quality panel
    // as an event without a feed.
    return null;
  }
}

const userSegments: UserSegment[] = ["general", "new_reader", "quick_reads", "deep_reads"];

function isUserSegment(value: unknown): value is UserSegment {
  return typeof value === "string" && (userSegments as string[]).includes(value);
}

function isLiveArm(algorithmId: string, config: RecommendationExperimentConfig) {
  return (
    isRecommendationAlgorithmId(algorithmId) &&
    config.arms.some((arm) => arm.algorithmId === algorithmId && arm.weight > 0)
  );
}

/** Transports mark a rejected token with `isAuthFailure`; nothing else does. */
function isAuthFailure(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { isAuthFailure?: boolean }).isAuthFailure);
}

/**
 * A short, stable label for why the rollups failed.
 *
 * Only the code: the message is database text, and this string is returned to
 * the browser and stored in `served_feed.fallback_reason`.
 */
export function describeErrorCode(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(code)) return code;
  if (typeof code === "number" && Number.isFinite(code)) return String(code);
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  return "unknown";
}
