import { adminJsonError, bearerToken } from "@/lib/boks/admin-request";
import type { SeriesActor } from "@/lib/boks/series-recorder/rules";

/**
 * Who may use the Series recorder, asked of the database with the caller's
 * own token (`get_my_series_access`): Studio, or an author the team has
 * granted Boks Series to. The route never decides it on its own.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseApiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export type SeriesAccess = SeriesActor & { allowed: boolean; granted: number; used: number; left: number };

async function rpc(token: string, name: string, signal?: AbortSignal) {
  const restBase = globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${supabaseUrl}/rest/v1`;
  return fetch(`${restBase}/rpc/${name}`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", apikey: supabaseApiKey!, Authorization: `Bearer ${token}` },
    body: "{}",
  });
}

/** The caller as the recorder sees them, or the response that turns them away. */
export async function seriesActor(request: Request): Promise<{ actor: SeriesAccess; token: string } | Response> {
  if (!supabaseUrl || !supabaseApiKey) return adminJsonError("Supabase is not configured for this deployment.", 503);
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return adminJsonError("Sign in required.", 401);
  let response: Response;
  try {
    response = await rpc(token, "get_my_series_access", request.signal);
  } catch {
    return adminJsonError("Could not check the session.", 502);
  }
  if (response.status === 401 || response.status === 403) return adminJsonError("Sign in required.", 401);
  if (!response.ok) return adminJsonError("Could not check the session.", 502);
  const actor = (await response.json()) as SeriesAccess;
  if (!actor?.userId || !actor.allowed) return adminJsonError("The Series recorder is open to authors the team has granted Boks Series to.", 403);
  return { actor, token };
}

/**
 * Put a recorded Series on an author's page: the caller's own
 * (`publish_my_recorded_series`), or, for Studio, the page of the author named
 * by `handle` (`studio_publish_recorded_series`). The bok id and whose page,
 * or the refusal.
 */
export async function publishRecordedSeries(token: string, input: { bokId: string | null; title: string; text: string; piece: string; handle?: string | null }): Promise<{ bokId: string; handle: string | null } | Response> {
  const restBase = globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${supabaseUrl}/rest/v1`;
  const own = { p_bok_id: input.bokId, p_title: input.title, p_text: input.text, p_token: input.piece };
  let response: Response;
  try {
    response = await fetch(`${restBase}/rpc/${input.handle ? "studio_publish_recorded_series" : "publish_my_recorded_series"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseApiKey!, Authorization: `Bearer ${token}` },
      body: JSON.stringify(input.handle ? { p_handle: input.handle, ...own } : own),
    });
  } catch {
    return adminJsonError("Could not reach the database.", 502);
  }
  const body = (await response.json().catch(() => ({}))) as { bokId?: string; handle?: string; message?: string };
  if (!response.ok || !body.bokId) return adminJsonError(body.message || "The Series could not be published.", response.status >= 500 ? 502 : 409);
  return { bokId: body.bokId, handle: body.handle ?? null };
}

/** Studio: the @handle a byline most likely belongs to (`studio_series_author_for`), or null. */
export async function seriesAuthorFor(token: string, name: string): Promise<string | null> {
  const restBase = globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${supabaseUrl}/rest/v1`;
  try {
    const response = await fetch(`${restBase}/rpc/studio_series_author_for`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseApiKey!, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ p_name: name }),
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { handle?: string } | null;
    return body?.handle ?? null;
  } catch {
    return null;
  }
}

/** Spend one of the author's Boks Series (Studio spends nothing). Null when spent; otherwise the refusal. */
export async function spendSeriesCredit(token: string): Promise<Response | null> {
  let response: Response;
  try {
    response = await rpc(token, "spend_series_credit");
  } catch {
    return adminJsonError("Could not check the session.", 502);
  }
  if (response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return adminJsonError(body.message || "No Boks Series left to make.", response.status === 400 || response.status >= 500 ? 409 : response.status);
}

/** Studio's RPC with the caller's own token: the parsed answer, or the refusal as a response. */
async function studioRpc<T>(token: string, name: string, body: unknown): Promise<T | Response> {
  const restBase = globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${supabaseUrl}/rest/v1`;
  let response: Response;
  try {
    response = await fetch(`${restBase}/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseApiKey!, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    return adminJsonError("Could not reach the database.", 502);
  }
  const answer = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) return adminJsonError(answer.message || "The database refused.", response.status === 403 ? 403 : response.status >= 500 ? 502 : 409);
  return answer;
}

/** A piece in work for its Boks Series, as a recorder draft is made from it (`studio_series_source`). */
export const seriesSourceFor = (token: string, bokId: string) =>
  studioRpc<import("@/lib/boks/series-recorder/from-bok").SeriesSource>(token, "studio_series_source", { p_bok_id: bokId });

/** Remember which recorder draft is the piece's Series (`studio_link_series_draft`). */
export const linkSeriesDraft = (token: string, bokId: string, draftId: string) =>
  studioRpc<unknown>(token, "studio_link_series_draft", { p_bok_id: bokId, p_draft_id: draftId });
