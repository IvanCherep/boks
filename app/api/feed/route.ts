import {
  serveReaderFeed,
  type ServeReaderFeedRequest,
} from "@/lib/boks/feed-service";
import {
  createSupabaseRestTransport,
  readerIdFromAccessToken,
  SupabaseRestError,
} from "@/lib/boks/supabase-rest";
import type { ReaderSignals } from "@/lib/boks/recommendations";

export const dynamic = "force-dynamic";

/**
 * The canonical feed endpoint (ADR-001).
 *
 * The Worker ranks and records what it served; the browser renders the slate it
 * is given. Provenance is therefore written by the party that did the ranking,
 * which is the whole point: a client-reported `algorithm_id` cannot distinguish
 * a client bug from reality.
 *
 * No elevated credential lives here. The reader's own access token is forwarded
 * to PostgREST, so row-level security applies exactly as it does in the browser.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseApiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

type FeedRequestBody = {
  limit?: number;
  sessionId?: string;
  reader?: ReaderSignals;
  profileSnapshot?: Record<string, unknown>;
  requestedAlgorithmId?: string | null;
  buildId?: string | null;
};

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseApiKey) {
    return jsonError("Supabase is not configured for this deployment.", 503);
  }

  const accessToken = bearerToken(request.headers.get("authorization"));
  if (!accessToken) return jsonError("Sign in required to load a feed.", 401);

  const userId = readerIdFromAccessToken(accessToken);
  if (!userId) return jsonError("Access token carries no reader id.", 401);

  let body: FeedRequestBody;
  try {
    body = ((await request.json()) ?? {}) as FeedRequestBody;
  } catch {
    return jsonError("Feed request body must be JSON.", 400);
  }

  const transport = createSupabaseRestTransport({
    restUrl: `${supabaseUrl}/rest/v1`,
    apiKey: supabaseApiKey,
    accessToken,
  });

  const serveRequest: ServeReaderFeedRequest = {
    userId,
    sessionId: String(body.sessionId ?? "").slice(0, 120),
    limit: clampLimit(body.limit),
    reader: body.reader,
    profileSnapshot: body.profileSnapshot,
    // A reader may not pick their own arm; only an admin preview may, and that
    // request is authorised by the RPCs it goes on to call.
    requestedAlgorithmId: body.requestedAlgorithmId ?? null,
    servingBackend: "worker",
    buildId: body.buildId ?? null,
  };

  try {
    const served = await serveReaderFeed(transport, serveRequest);

    return Response.json({
      feedId: served.feedId,
      experiment: served.experiment,
      entries: served.entries.map((entry) => ({
        reelId: entry.candidate.id,
        rank: entry.rank,
        score: entry.score,
      })),
      reels: served.reels,
      servingBackend: served.servingBackend,
      degradedMode: served.degradedMode,
      fallbackReason: served.fallbackReason,
      candidateCount: served.candidateCount,
      catalogSize: served.catalogSize,
      signalsVersion: served.signalsVersion,
      rankingVersion: served.rankingVersion,
      labelingVersion: served.labelingVersion,
    });
  } catch (error) {
    if (error instanceof SupabaseRestError && error.isAuthFailure) {
      // The client refreshes its session and retries once on a 401.
      return jsonError("Supabase rejected the reader session.", 401);
    }
    return jsonError(describeError(error), 502);
  }
}

function bearerToken(header: string | null) {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
}

function clampLimit(value: unknown) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return 80;
  return Math.min(200, Math.max(1, Math.round(limit)));
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Could not build a feed.";
}
