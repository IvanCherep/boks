import { adminJsonError, bearerToken } from "@/lib/boks/admin-request";
import { queueCoverJob } from "@/lib/boks/author/covers/jobs";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Draw two covers for a piece (`docs/author-publishing.md`). The database,
 * asked with the author's own token, decides whether they may and counts the
 * pictures (`reserve_my_cover_drawing`); only then is the job queued for the
 * worker, which holds the Yandex key. Answers the job id to poll.
 */
export async function POST(request: Request) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!supabaseUrl || !apiKey) return adminJsonError("Supabase is not configured for this deployment.", 503);
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return adminJsonError("Sign in required.", 401);

  const raw = await request.text();
  if (raw.length > 120_000) return adminJsonError("The request is too large.", 413);
  let body: { bokId?: unknown; title?: unknown; text?: unknown };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return adminJsonError("The request body must be a JSON object.", 400);
  }
  const bokId = typeof body.bokId === "string" && uuid.test(body.bokId) ? body.bokId.toLowerCase() : null;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!bokId) return adminJsonError("Which piece is the picture for?", 400);
  if (!text) return adminJsonError("Paste the text first: the picture is drawn from it.", 400);

  const restBase = globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${supabaseUrl}/rest/v1`;
  let reserved: Response;
  try {
    reserved = await fetch(`${restBase}/rpc/reserve_my_cover_drawing`, {
      method: "POST",
      signal: request.signal,
      headers: { "Content-Type": "application/json", apikey: apiKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ p_bok_id: bokId, p_pictures: 2 }),
    });
  } catch {
    return adminJsonError("Could not reach the database.", 502);
  }
  const answer = (await reserved.json().catch(() => ({}))) as { message?: string };
  if (!reserved.ok) {
    const status = reserved.status === 401 ? 401 : reserved.status === 403 ? 403 : reserved.status >= 500 ? 502 : 409;
    return adminJsonError(answer.message || "Pictures cannot be drawn right now.", status);
  }
  const jobId = await queueCoverJob({ bokId, title, text: text.slice(0, 20_000), pictures: 2 });
  return json({ jobId, drawings: answer }, 202);
}
