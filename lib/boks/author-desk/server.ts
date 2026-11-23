"use client";

import { supabase } from "@/lib/boks/supabase-client";
import { readableBoksError } from "@/lib/boks/errors";
import { deleteOwnDraft, saveOwnBok } from "@/components/boks/author-cabinet/composer-data";
import { chooseTake, deleteTake, loadTakes, takeUrl, uploadTake, withdrawMySentBok } from "@/components/boks/author-cabinet/voice-data";
import { publishMyAuthorSpace, requestSpaceChanges, sendMyMessage } from "@/components/boks/author-spaces/data";
import { isWorkshopClosed, notesProblem } from "./server-rules";

/**
 * The Workshop's server client (`docs/workshop-server.md`): its own three
 * calls and thin wrappers of the cabinet's, all failing with one error type
 * that carries a Russian message for the author.
 */

export class WorkshopError extends Error {
  constructor(
    /** For the author, in Russian (`lib/boks/errors.ts`). */
    message: string,
    /** The database's errcode when there is one (`42501` for a refusal). */
    readonly code: string | null,
    /** Not a verified author: show the way to My page. */
    readonly closed: boolean,
    readonly original: unknown,
  ) {
    super(message);
    this.name = "WorkshopError";
  }
}

const fallback = "Не получилось. Попробуйте ещё раз.";

function asWorkshopError(error: unknown) {
  if (error instanceof WorkshopError) return error;
  const code = (error as { code?: string } | null)?.code ?? null;
  return new WorkshopError(readableBoksError(error, fallback, "ru"), code, isWorkshopClosed(error), error);
}

/** Runs a call, turning any failure into a `WorkshopError`. */
export async function workshopCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw asWorkshopError(error);
  }
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  if (!supabase) throw new WorkshopError("Не удалось связаться с boks.", null, false, null);
  const result = await supabase.rpc(name, args);
  if (result.error) throw asWorkshopError(result.error);
  return result.data as T;
}

// ---------------------------------------------------------------- the contract's JSON (docs/workshop-server.md)

export type ServerVoice = { file: string; durationMs: number; source: "teleprompter" | "upload"; name: string | null; at: string; current: boolean };
export type ServerDecision = { decision: "changes" | "refused"; kind: "recording" | "text" | "law" | "other"; note: string; at: string };
export type ServerSeries = {
  state: "accepted" | "sent" | "published";
  acceptedAt: string | null;
  sentAt: string | null;
  publishedAt: string | null;
  workId: string | null;
  revision: number | null;
  workStatus: string | null;
  /** The link-only token of the Series sent to the author, to watch before publishing; null before it is sent. */
  seriesPiece: string | null;
};
export type ServerPiece = {
  id: string;
  title: string;
  text: string;
  status: string;
  coverRequested: boolean;
  coverVersion: number | null;
  createdAt: string;
  updatedAt: string;
  form: "poem" | "prose";
  shelvedAt: string | null;
  queuePos: number | null;
  notes: Record<string, unknown>;
  voice: ServerVoice | null;
  decision: ServerDecision | null;
  series: ServerSeries | null;
  importedFrom: string | null;
};
export type ServerReady = { workId: string; revision: number; title: string; format: "text" | "series"; bokId: string | null };
export type ServerWorkshop = {
  author: { userId: string; handle: string | null; name: string | null; pageId: string | null; pageStatus: string | null; billing?: "partner" | "paid"; awaitingPayment?: boolean };
  /** perYear: null for our authors (no yearly limit; the team decides the batches). */
  plan: { perYear: number | null; perWeek: number; usedThisYear: number };
  pieces: ServerPiece[];
  ready: ServerReady[];
};

export type WorkshopMeta = { bokId: string; form: "poem" | "prose"; shelvedAt: string | null; queuePos: number | null; notes: Record<string, unknown>; updatedAt: string };
export type MetaPatch = { form?: "poem" | "prose"; shelved?: boolean; notes?: Record<string, unknown> };

/** Everything the Workshop shows (`get_my_workshop`). A non-verified author gets a `WorkshopError` with `closed`. */
export const loadWorkshop = () => rpc<ServerWorkshop>("get_my_workshop");

/** Form, «Отложено» and notes (`save_my_workshop_meta`). Notes over the limits fail here, before the network. */
export async function saveMeta(bokId: string, patch: MetaPatch) {
  if (patch.notes !== undefined) {
    const problem = notesProblem(patch.notes);
    if (problem) throw asWorkshopError({ message: problem, code: "22023" });
  }
  return rpc<WorkshopMeta>("save_my_workshop_meta", { p_bok_id: bokId, p_patch: patch });
}

/**
 * Links to the author's own posts about a published Series (`docs/workshop-server.md`,
 * "Links to the author's posts"): the contract asks for one within 30 days of publishing.
 */
export type ShareLinkSeries = {
  bokId: string;
  slug: string | null;
  title: string;
  publishedAt: string | null;
  links: { url: string; at: string }[];
};
export const shareLinkDays = 30;
export const loadShareLinks = () => rpc<ShareLinkSeries[]>("get_my_share_links");
/** «Отправить в редакцию»; answers every published Series with its links, as `loadShareLinks`. */
export const submitShareLink = (bokId: string, url: string) => rpc<ShareLinkSeries[]>("submit_my_share_link", { p_bok_id: bokId, p_url: url });

/** The author's order among sent pieces (`set_my_queue_order`); answers the queue as it now stands. */
export const setQueueOrder = (ids: string[]) => rpc<{ bokId: string; queuePos: number }[]>("set_my_queue_order", { p_ids: ids });

// ---------------------------------------------------------------- the cabinet's calls, wrapped

/** Text and title (and «Отдать в работу» with `send`), through the composer's `save_my_bok`. */
export const saveBok = (input: { bokId: string; title: string; text: string; send?: boolean }) =>
  workshopCall(() => saveOwnBok({ bokId: input.bokId, title: input.title, text: input.text, publish: Boolean(input.send), cover: null, coverByTeam: Boolean(input.send) }));

export const withdraw = (bokId: string) => workshopCall(() => withdrawMySentBok(bokId));
export const deleteDraft = (bokId: string) => workshopCall(() => deleteOwnDraft(bokId));

export const voice = {
  load: (bokId: string) => workshopCall(() => loadTakes(bokId)),
  upload: (...args: Parameters<typeof uploadTake>) => workshopCall(() => uploadTake(...args)),
  choose: (bokId: string, file: string) => workshopCall(() => chooseTake(bokId, file)),
  remove: (bokId: string, file: string, fingerprint: string) => workshopCall(() => deleteTake(bokId, file, fingerprint)),
  url: (bokId: string, file: string) => workshopCall(() => takeUrl(bokId, file)),
};

/** «Опубликовать» a ready Series (or a team-prepared work), through `publish_my_author_space`. */
export const publishReady = (input: Parameters<typeof publishMyAuthorSpace>[0]) => workshopCall(() => publishMyAuthorSpace(input));
/** «Попросить исправить» a ready Series. */
export const requestChanges = (workId: string, note: string) => workshopCall(() => requestSpaceChanges(workId, note));
/** «Написать редакции». */
export const sendMessage = (body: string, workId: string | null = null) => workshopCall(() => sendMyMessage(body, workId));
