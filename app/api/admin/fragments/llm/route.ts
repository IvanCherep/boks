import { env } from "cloudflare:workers";
import { HttpRequestError, readBoundedJsonObject } from "@/lib/boks/http-security";
import {
  isYandexModel,
  readYandexChat,
  taskLimits,
  yandexChatBody,
  yandexChatUrl,
  type LlmTask,
} from "@/lib/boks/fragments/llm";

export const dynamic = "force-dynamic";

/**
 * The fragment cutter's way to a language model (`docs/fragment-cutter.md`).
 *
 * The cutter runs in the admin's browser - a novel's offline stages are too
 * much CPU for a Worker request, and the browser can show progress - but the
 * Yandex key must not reach the browser. So each model call comes here as a
 * task, one call per request: the caller must be a boks admin (checked by
 * the database, with the caller's own token), the task is bounded in size,
 * the model is one of a fixed list, and the reply is the model's JSON and
 * token counts, nothing else.
 *
 * The key and folder are Worker secrets (`YANDEX_API_KEY`, `YANDEX_FOLDER_ID`),
 * never in the source or the build.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseApiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** A scene chunk with a slow model can take a minute; past this the browser retries. */
const modelTimeoutMs = 110_000;

const stages = new Set<LlmTask["stage"]>(["scenes", "refine", "judge", "tournament"]);

export async function POST(request: Request) {
  const { YANDEX_API_KEY: apiKey, YANDEX_FOLDER_ID: folderId } = env;
  if (!apiKey || !folderId) return jsonError("The language model is not configured for this deployment.", 503);
  if (!supabaseUrl || !supabaseApiKey) return jsonError("Supabase is not configured for this deployment.", 503);

  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return jsonError("Sign in required.", 401);
  const admin = await isAdmin(token, request.signal);
  if (admin === null) return jsonError("Could not check the session.", 502);
  if (!admin) return jsonError("Only admins may use the fragment cutter.", 403);

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonObject(request);
  } catch (error) {
    if (error instanceof HttpRequestError) return jsonError(error.message, error.status);
    return jsonError("The request body must be JSON.", 400);
  }

  const model = body.model;
  const task = readTask(body.task);
  if (!isYandexModel(model)) return jsonError("Unknown model.", 400);
  if (!task) return jsonError("The task is malformed or too large.", 400);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), modelTimeoutMs);
  request.signal.addEventListener("abort", () => controller.abort());
  try {
    const response = await fetch(yandexChatUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Api-Key ${apiKey}`, "x-folder-id": folderId },
      body: JSON.stringify(yandexChatBody(task, folderId, model)),
    });
    if (!response.ok) {
      // 429 is the folder's concurrency quota and worth retrying; pass it on as such.
      const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
      console.error("Yandex refused a fragment task.", { status: response.status, stage: task.stage });
      return jsonError(`The model answered ${response.status}.`, status);
    }
    return Response.json(readYandexChat(await response.json()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return jsonError(timedOut ? "The model took too long." : "Could not reach the model.", timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}

function readTask(value: unknown): LlmTask | null {
  const task = value as Partial<LlmTask> | null;
  if (!task || typeof task !== "object") return null;
  if (!stages.has(task.stage as LlmTask["stage"])) return null;
  if (typeof task.system !== "string" || task.system.length > taskLimits.systemChars) return null;
  if (typeof task.user !== "string" || task.user.length > taskLimits.userChars) return null;
  if (!task.schema || typeof task.schema !== "object" || Array.isArray(task.schema)) return null;
  const maxTokens = Number(task.maxTokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > taskLimits.maxTokens) return null;
  return { stage: task.stage as LlmTask["stage"], system: task.system, user: task.user, schema: task.schema, maxTokens };
}

/** Asks the database, as the caller, whether the caller is an admin. Null when it could not say. */
async function isAdmin(token: string, signal: AbortSignal) {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/is_boks_admin`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", apikey: supabaseApiKey!, Authorization: `Bearer ${token}` },
      body: "{}",
    });
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) return null;
    return (await response.json()) === true;
  } catch {
    return null;
  }
}

function bearerToken(header: string | null) {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (!match || match[1].length > 16_384) return null;
  return match[1];
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}
