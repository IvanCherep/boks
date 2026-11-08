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
import { HttpRequestError, readBoundedJsonObject } from "@/lib/boks/http-security";

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
  buildId?: string | null;
  /** The reader's language filter; empty means no filter. */
  readingLanguages?: unknown;
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
    body = (await readBoundedJsonObject(request)) as FeedRequestBody;
  } catch (error) {
    if (error instanceof HttpRequestError) return jsonError(error.message, error.status);
    return jsonError("Feed request body must be JSON.", 400);
  }

  const transport = createSupabaseRestTransport({
    // Self-hosted: talk to PostgREST over the private network instead of looping
    // out through the public domain (BOKS_INTERNAL_REST_URL, e.g. http://rest:3000).
    restUrl: process.env.BOKS_INTERNAL_REST_URL || `${supabaseUrl}/rest/v1`,
    apiKey: supabaseApiKey,
    accessToken,
    // A reader who has gone away needs no feed; stop asking the database.
    signal: request.signal,
  });

  const serveRequest: ServeReaderFeedRequest = {
    userId,
    sessionId: String(body.sessionId ?? "").slice(0, 120),
    limit: clampLimit(body.limit),
    reader: body.reader,
    profileSnapshot: body.profileSnapshot,
    servingBackend: "worker",
    buildId: body.buildId ?? null,
    readingLanguages: languagesFrom(body.readingLanguages),
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
      // The browser refreshes its session and retries once on a 401
      // (`loadSupabaseReaderFeed`).
      return jsonError("Supabase rejected the reader session.", 401);
    }
    console.error("Could not build a reader feed.", safeErrorDetails(error));
    return jsonError("Could not build a feed. Please try again.", 502);
  }
}

function bearerToken(header: string | null) {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (!match || match[1].length > 16_384) return null;
  return match[1];
}

/** At most a handful of short language codes; anything else is dropped. */
function languagesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && /^[a-z]{2,3}$/.test(entry))
    .slice(0, 10);
}

function clampLimit(value: unknown) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return 80;
  return Math.min(200, Math.max(1, Math.round(limit)));
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function safeErrorDetails(error: unknown) {
  if (error instanceof SupabaseRestError) {
    return { name: error.name, status: error.status, code: error.code };
  }
  return { name: error instanceof Error ? error.name : "UnknownError" };
}
