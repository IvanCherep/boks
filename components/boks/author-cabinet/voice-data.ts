"use client";

import { currentAccessToken } from "@/components/boks/supabase-browser-data";
import { supabase } from "@/lib/boks/supabase-client";
import type { VoiceSource, VoiceTakes } from "@/lib/boks/author/voice/rules";
import type { DecisionKind, EditorDecision, EditorDecisionKind } from "@/lib/boks/author/editor-decisions";

/**
 * The author's voice on a piece, in the browser: the takes through
 * `app/api/author/voice` with the caller's own token; what the database keeps
 * of them (`20261122120000_boks_author_voice.sql`) through its functions.
 */

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await currentAccessToken();
  if (!token) throw new Error("Sign in required.");
  const response = await fetch(`/api/author/voice/${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `The request failed (${response.status}).`);
  return payload;
}

export const loadTakes = (bokId: string) => request<{ voice: VoiceTakes }>(bokId).then((r) => r.voice);

export const uploadTake = (bokId: string, blob: Blob, meta: { durationMs: number; source: VoiceSource; name?: string | null; fingerprint: string }) => {
  const query = new URLSearchParams({ durationMs: String(Math.round(meta.durationMs)), source: meta.source, fingerprint: meta.fingerprint });
  if (meta.name) query.set("name", meta.name);
  return request<{ voice: VoiceTakes }>(`${bokId}/take?${query}`, { method: "PUT", body: blob, headers: { "Content-Type": blob.type || "audio/webm" } }).then((r) => r.voice);
};

export const chooseTake = (bokId: string, file: string) =>
  request<{ voice: VoiceTakes }>(bokId, { method: "PATCH", body: JSON.stringify({ chosen: file }), headers: { "Content-Type": "application/json" } }).then((r) => r.voice);

export const deleteTake = (bokId: string, file: string, fingerprint: string) =>
  request<{ voice: VoiceTakes }>(`${bokId}/${file}?fingerprint=${fingerprint}`, { method: "DELETE" }).then((r) => r.voice);

/** A take as a local address the page can play (the file itself needs the token). */
export async function takeUrl(bokId: string, file: string) {
  const token = await currentAccessToken();
  if (!token) throw new Error("Sign in required.");
  const response = await fetch(`/api/author/voice/${bokId}/${file}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Could not load ${file}.`);
  return URL.createObjectURL(await response.blob());
}

/** What the database keeps of a piece's voice: the chosen take, and whether it reads the text as saved. */
export type SavedVoice = { bokId: string; file: string; durationMs: number; source: VoiceSource; name: string | null; fingerprint: string; recordedAt: string; current: boolean };

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
}

/** My page: the caller's pieces with a voice. */
export const loadMyVoices = () => call<SavedVoice[]>("get_my_bok_voices");

/** Studio → Moderation: the author's reading of a piece, or null. */
export const loadStudioVoice = (bokId: string) => call<SavedVoice | null>("studio_bok_voice", { p_bok_id: bokId });

// ------------------------------------------------------------ the editors' answer


/** The author's own: requests for changes and refusals (`get_my_editor_decisions`). */
export const loadMyDecisions = () => call<EditorDecision[]>("get_my_editor_decisions");

/** Studio returns a piece for changes or refuses it, with a reason (`studio_decide_bok`). */
export const studioDecide = (bokId: string, decision: EditorDecisionKind, kind: DecisionKind, note: string) =>
  call<EditorDecision>("studio_decide_bok", { p_bok_id: bokId, p_decision: decision, p_kind: kind, p_note: note });
export const studioReopen = (bokId: string) => call<EditorDecision>("studio_reopen_bok", { p_bok_id: bokId });
export const loadStudioDecision = (bokId: string) => call<EditorDecision | null>("studio_bok_decision", { p_bok_id: bokId });
