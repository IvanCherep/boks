import { adminJsonError, bearerToken } from "@/lib/boks/admin-request";
import type { VoiceTake } from "@/lib/boks/author/voice/rules";

/**
 * Who is asking about a piece's voice, asked of the database with the
 * caller's own token (`get_my_bok_voice_access`), never decided by the route:
 * the account, whether it is Studio, whether it publishes from My page, and
 * whose piece it is (null while nobody has saved or recorded it).
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseApiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export type VoiceAccess = { userId: string; admin: boolean; direct: boolean; ownerId: string | null };

const restBase = () => globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${supabaseUrl}/rest/v1`;

async function rpc(token: string, name: string, body: unknown, signal?: AbortSignal) {
  return fetch(`${restBase()}/rpc/${name}`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", apikey: supabaseApiKey!, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/**
 * The caller and what they may do with this piece's voice, or the response
 * that turns them away: its author writes (a verified author, the piece
 * theirs or nobody's yet); Studio may also listen.
 */
export async function voiceCaller(request: Request, bokId: string, { write }: { write: boolean }): Promise<{ access: VoiceAccess; token: string } | Response> {
  if (!supabaseUrl || !supabaseApiKey) return adminJsonError("Supabase is not configured for this deployment.", 503);
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return adminJsonError("Sign in required.", 401);
  let response: Response;
  try {
    response = await rpc(token, "get_my_bok_voice_access", { p_bok_id: bokId }, request.signal);
  } catch {
    return adminJsonError("Could not check the session.", 502);
  }
  if (response.status === 401 || response.status === 403) return adminJsonError("Sign in required.", 401);
  if (!response.ok) return adminJsonError("Could not check the session.", 502);
  const access = (await response.json()) as VoiceAccess;
  if (!access?.userId) return adminJsonError("Sign in required.", 401);
  const own = access.ownerId === null || access.ownerId === access.userId;
  if (write ? !(own && access.direct) : !(own || access.admin)) return adminJsonError("This piece belongs to another account.", 403);
  return { access, token };
}

/** The chosen take into the database (`set_my_bok_voice`), or null to clear it; the refusal as a response. */
export async function recordChosenVoice(token: string, bokId: string, take: VoiceTake | null): Promise<Response | null> {
  let response: Response;
  try {
    response = await rpc(token, "set_my_bok_voice", {
      p_bok_id: bokId,
      p_voice: take ? { file: take.file, durationMs: take.durationMs, source: take.source, name: take.name, fingerprint: take.fingerprint, recordedAt: take.createdAt } : null,
    });
  } catch {
    return adminJsonError("Could not reach the database.", 502);
  }
  if (response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return adminJsonError(body.message || "The voice could not be saved.", response.status === 403 ? 403 : response.status >= 500 ? 502 : 409);
}
