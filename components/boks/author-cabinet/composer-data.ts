"use client";

import { currentAccessToken } from "@/components/boks/supabase-browser-data";
import { supabase } from "@/lib/boks/supabase-client";
import type { PreparedCover } from "@/lib/boks/author/covers/cover-image";

/**
 * The composer's calls (`20261120100000_boks_author_direct_publishing.sql`):
 * the database decides who publishes directly and counts the pictures; the
 * app's `/api/author/covers` only queues a drawing it has been allowed.
 */

export type CoverDrawings = { perPiece: number; piece: number; perDay: number; today: number };
export type Publishing = { direct: boolean; maxCharacters: number; drawings: CoverDrawings };
export type SavedBok = { id: string; title: string; status: "draft" | "published" | "withdrawn" | "pending_review"; coverVersion: number | null; handle: string | null; created: boolean };
export type OwnDraft = {
  id: string;
  title: string;
  text: string;
  status: string;
  coverRequested: boolean;
  coverVersion: number | null;
  cover: { source: "upload" | "generated"; webp: string } | null;
  drawings: CoverDrawings;
};
export type DrawingState =
  | { state: "queued" | "drawing" }
  | { state: "done"; pictures: string[] }
  | { state: "failed"; errorCode: string }
  | { state: "missing" };

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
}

export const loadPublishing = (bokId: string | null) => call<Publishing>("get_my_publishing", { p_bok_id: bokId });

export const loadOwnDraft = (bokId: string) => call<OwnDraft>("get_my_bok_draft", { p_bok_id: bokId });

export const deleteOwnDraft = (bokId: string) => call<{ ok: true }>("delete_my_draft", { p_bok_id: bokId });

/**
 * `cover` null keeps the picture the piece already has. `coverByTeam`: the
 * piece goes to the team, who find its picture and publish it.
 */
export const saveOwnBok = (input: { bokId: string; title: string; text: string; publish: boolean; cover: PreparedCover | null; coverByTeam?: boolean }) =>
  call<SavedBok>("save_my_bok", {
    p_bok_id: input.bokId,
    p_title: input.title,
    p_text: input.text,
    p_publish: input.publish,
    p_cover: input.cover ? { source: input.cover.source, webp: input.cover.webp, jpeg: input.cover.jpeg } : null,
    p_cover_by_team: Boolean(input.coverByTeam),
  });

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await currentAccessToken();
  if (!token) throw new Error("Sign in again.");
  const response = await fetch(`/api/author/covers${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !(response.status === 404 && path)) throw new Error(payload.error ?? `The request failed (${response.status}).`);
  return payload;
}

export const startDrawing = (bokId: string, title: string, text: string) =>
  api<{ jobId: string; drawings: CoverDrawings }>("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bokId, title, text }),
  });

export const drawingState = (jobId: string) => api<DrawingState>(`/${jobId}`);

export function newBokId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));
}

/** Waits for a drawing: its pictures, or why there are none. */
export async function waitForDrawing(jobId: string): Promise<{ pictures: string[] } | { errorCode: string }> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 10 ? 1500 : 3000));
    const state = await drawingState(jobId);
    if (state.state === "done") return { pictures: state.pictures };
    if (state.state === "failed") return { errorCode: state.errorCode };
    if (state.state === "missing") break;
  }
  return { errorCode: "unavailable" };
}

// ------------------------------------------------------------------ Studio

export type CoverRequest = { bokId: string; coverVersion: number | null };
export const loadCoverRequests = () => call<CoverRequest[]>("studio_cover_requests");
export const loadStudioBokCover = (bokId: string) => call<{ version: number; source: string; webp: string } | null>("studio_bok_cover", { p_bok_id: bokId });
export const setStudioBokCover = (bokId: string, cover: PreparedCover) =>
  call<{ bokId: string; coverVersion: number }>("studio_set_bok_cover", { p_bok_id: bokId, p_cover: { source: cover.source, webp: cover.webp, jpeg: cover.jpeg } });
