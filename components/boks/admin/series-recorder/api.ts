import { currentAccessToken } from "@/components/boks/supabase-browser-data";
import type { SeriesDraft, SeriesDraftSummary } from "@/lib/boks/series-recorder/rules";

/**
 * Studio → Series recorder, in the browser: the drafts through
 * `app/api/admin/series`, with the admin's own token on every request.
 */

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await currentAccessToken();
  if (!token) throw new Error("Sign in again.");
  const response = await fetch(`/api/series${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `The request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

/** How many Boks Series the caller may still make; Studio makes as many as it likes. */
export type SeriesAllowance = { admin: boolean; granted: number; used: number; left: number };
/** `mine`: only the caller's own, as the cabinet shows them even to Studio. */
export const listSeriesDrafts = (mine = false) => request<{ drafts: SeriesDraftSummary[]; access: SeriesAllowance }>(mine ? "?mine" : "");
export const createSeriesDraft = () => request<{ draft: SeriesDraft }>("", { method: "POST", ...json({}) }).then((r) => r.draft);
export const loadSeriesDraft = (id: string) => request<{ draft: SeriesDraft }>(`/${id}`).then((r) => r.draft);
export const updateSeriesDraft = (id: string, patch: Record<string, unknown>) =>
  request<{ draft: SeriesDraft }>(`/${id}`, { method: "PATCH", ...json(patch) }).then((r) => r.draft);
export const deleteSeriesDraft = (id: string) => request<{ deleted: true }>(`/${id}`, { method: "DELETE" });
export const buildSeriesDraft = (id: string) => request<{ draft: SeriesDraft }>(`/${id}`, { method: "POST", ...json({ action: "build" }) }).then((r) => r.draft);
export const generateSeriesImages = (id: string, count: number) =>
  request<{ draft: SeriesDraft }>(`/${id}`, { method: "POST", ...json({ action: "generate", count }) }).then((r) => r.draft);
export const regenerateSeriesImage = (id: string, file: string) =>
  request<{ draft: SeriesDraft }>(`/${id}`, { method: "POST", ...json({ action: "regenerate", file }) }).then((r) => r.draft);
/** Onto the caller's own page, or, for Studio, the page of the author `handle` names. */
export const publishSeriesDraft = (id: string, handle?: string) =>
  request<{ draft: SeriesDraft }>(`/${id}`, { method: "POST", ...json({ action: "publish", ...(handle ? { handle } : {}) }) }).then((r) => r.draft);
/** Studio: the author's @handle the draft's byline most likely belongs to. */
export const suggestSeriesAuthor = (id: string) =>
  request<{ handle: string | null }>(`/${id}`, { method: "POST", ...json({ action: "author" }) }).then((r) => r.handle);
export const deleteSeriesFile = (id: string, file: string) =>
  request<{ draft: SeriesDraft }>(`/${id}/${file}`, { method: "DELETE" }).then((r) => r.draft);

export const uploadSeriesTake = (id: string, take: Blob, durationMs: number) =>
  request<{ draft: SeriesDraft }>(`/${id}/take?durationMs=${Math.round(durationMs)}`, {
    method: "PUT",
    body: take,
    headers: { "Content-Type": take.type || "audio/webm" },
  }).then((r) => r.draft);

/**
 * A picture, made a JPEG at most 2160 px on its long side here, in the
 * browser: the upload stays small, and a phone's HEIC arrives as something
 * the worker reads.
 */
export async function uploadSeriesImage(id: string, file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2160 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the picture."))), "image/jpeg", 0.9));
    return await request<{ draft: SeriesDraft }>(`/${id}/image?width=${width}&height=${height}`, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": "image/jpeg" },
    }).then((r) => r.draft);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A take or picture as a local address the page can play or show (the file itself needs the token). */
export async function seriesFileUrl(id: string, file: string) {
  const token = await currentAccessToken();
  if (!token) throw new Error("Sign in again.");
  const response = await fetch(`/api/series/${id}/${file}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Could not load ${file}.`);
  return URL.createObjectURL(await response.blob());
}

/**
 * Studio: a recorder draft for a piece the editors took into work, made from
 * its text, its byline and the author's chosen take (or the one already made).
 */
export const createSeriesDraftFromBok = (bokId: string) =>
  request<{ draft: SeriesDraft }>("", { method: "POST", ...json({ fromBok: bokId }) }).then((r) => r.draft);
