import { blankWork, textKey, type EditorStep, type Outcome, type OutcomeCategory, type Work } from "./workflow";

/**
 * The Workshop's model from what `get_my_workshop()` returns
 * (`docs/workshop-server.md`). Pure, so every state a piece can be in is
 * tested without a database.
 */

export type ServerVoice = { file: string; durationMs: number; source: "teleprompter" | "upload"; name: string | null; at: string; current: boolean };
export type ServerDecision = { decision: "changes" | "refused"; kind: string; note: string; at: string };
export type ServerSeries = {
  state: "accepted" | "sent" | "published";
  acceptedAt: string | null;
  sentAt: string | null;
  publishedAt: string | null;
  workId: string | null;
  revision: number | null;
  workStatus: string | null;
  /** The link-only token of the Series sent to the author, to watch before publishing. */
  seriesPiece: string | null;
};
export type ServerNotes = {
  about?: string;
  plan?: { id: string; text: string; done: boolean }[];
  thoughts?: { text: string; at: string }[];
  materials?: { id: string; kind: string; text: string; source?: string; pinTo?: string }[];
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
  notes: ServerNotes | null;
  voice: ServerVoice | null;
  decision: ServerDecision | null;
  series: ServerSeries | null;
  importedFrom: string | null;
};
export type ServerReady = { workId: string; revision: number; title: string; format: "text" | "series"; bokId: string | null };
export type ServerWorkshop = {
  author: { userId: string; handle: string | null; name: string | null; pageId: string | null; pageStatus: string | null; billing?: "partner" | "paid" };
  /** perYear: null for our authors (no yearly limit; the team decides the batches). */
  plan: { perYear: number | null; perWeek: number; usedThisYear: number };
  pieces: ServerPiece[];
  ready: ServerReady[];
};

/** Where a piece stands with the editors, from the rows that say so. */
export function editorStepOf(piece: ServerPiece): { step: EditorStep | null; revising: boolean } {
  if (piece.status === "published") return { step: "published", revising: false };
  const series = piece.series;
  if (series) {
    if (series.state === "published") return { step: "published", revising: false };
    if (series.state === "sent") {
      // The author asked the editors to fix the Series they sent.
      if (series.workStatus === "changes_requested") return { step: "production", revising: true };
      return { step: "approval", revising: false };
    }
    if (series.state === "accepted") return { step: "production", revising: false };
  }
  if (piece.status === "pending_review" && piece.coverRequested) return { step: "queued", revising: false };
  return { step: null, revising: false };
}

const categories: Record<string, OutcomeCategory> = { voice: "voice", recording: "voice", text: "text", law: "law", legal: "law", other: "other" };

/** The editors' answer, shown only while the piece is back with the author. */
export function outcomeOf(piece: ServerPiece): Outcome | undefined {
  const decision = piece.decision;
  if (!decision) return undefined;
  if (editorStepOf(piece).step) return undefined;
  return {
    kind: decision.decision === "refused" ? "declined" : "changes",
    category: categories[decision.kind] ?? "other",
    reason: decision.note,
    at: decision.at,
  };
}

const materialKinds = new Set(["fact", "image", "phrase", "source", "note"]);

export function workFromServer(piece: ServerPiece): Work {
  const base = blankWork(piece.title);
  const { step, revising } = editorStepOf(piece);
  const notes = piece.notes ?? {};
  const plan = Array.isArray(notes.plan) ? notes.plan.filter((point) => point && typeof point.text === "string") : [];
  const about = typeof notes.about === "string" ? notes.about : "";
  const voice = piece.voice;
  return {
    ...base,
    id: piece.id,
    title: piece.title ?? "",
    form: piece.form === "prose" ? "prose" : "poem",
    text: piece.text ?? "",
    createdAt: piece.createdAt,
    updatedAt: piece.updatedAt,
    importedFrom: piece.importedFrom ?? undefined,
    shelved: Boolean(piece.shelvedAt) && !step,
    idea: {
      notes: Array.isArray(notes.thoughts) ? notes.thoughts.filter((entry) => entry && typeof entry.text === "string") : [],
      concept: about || plan.length ? { about, approach: "", form: "", plan } : null,
    },
    materials: Array.isArray(notes.materials)
      ? notes.materials
          .filter((item) => item && typeof item.text === "string" && materialKinds.has(item.kind))
          .map((item) => ({ id: item.id, kind: item.kind as Work["materials"][number]["kind"], text: item.text, source: item.source, pinTo: item.pinTo }))
      : [],
    // The list knows only the chosen recording; the Голос step loads them all.
    takes: voice
      ? [{ id: voice.file, seconds: Math.round(voice.durationMs / 1000), at: voice.at, source: voice.source === "upload" ? "file" : "teleprompter", name: voice.name ?? undefined, textKey: voice.current ? textKey(piece.text ?? "") : "older-text" }]
      : [],
    chosenTake: voice ? voice.file : null,
    outcome: outcomeOf(piece),
    editors: {
      step,
      revising,
      notes: piece.decision ? [{ from: "editors", text: piece.decision.note, at: piece.decision.at }] : [],
      publishedAt: step === "published" ? piece.series?.publishedAt ?? piece.updatedAt : undefined,
      fixed: false,
    },
  };
}

/** The author's queue: sent pieces in the author's order, those without a place last by date sent. */
export function queueFromServer(pieces: ServerPiece[]) {
  return pieces
    .filter((piece) => editorStepOf(piece).step === "queued")
    .sort((a, b) => (a.queuePos ?? Number.MAX_SAFE_INTEGER) - (b.queuePos ?? Number.MAX_SAFE_INTEGER) || a.updatedAt.localeCompare(b.updatedAt))
    .map((piece) => piece.id);
}
