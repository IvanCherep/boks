import { adminJsonError } from "@/lib/boks/admin-request";
import { seriesActor, type SeriesAccess } from "@/lib/boks/series-recorder/actor";
import { SeriesStoreError } from "@/lib/boks/series-recorder/store";

/**
 * The Series recorder's API (`docs/series-recorder.md`): Studio, or an author
 * granted Boks Series, each to their own drafts; never cached; store errors
 * as their own status.
 */
export async function seriesRoute(request: Request, handle: (actor: SeriesAccess, token: string) => Promise<Response>) {
  const who = await seriesActor(request);
  if (who instanceof Response) return who;
  try {
    return await handle(who.actor, who.token);
  } catch (error) {
    if (error instanceof SeriesStoreError) return adminJsonError(error.message, error.status);
    console.error("Series recorder request failed.", error);
    return adminJsonError("The Series recorder could not do that.", 500);
  }
}

export const seriesJson = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 64 * 1024) throw new SeriesStoreError("The request is too large.", 413);
  try {
    const body = JSON.parse(text || "{}");
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Falls through to the error below.
  }
  throw new SeriesStoreError("The request body must be a JSON object.", 400);
}
