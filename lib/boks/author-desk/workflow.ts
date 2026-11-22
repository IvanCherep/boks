/**
 * The author's workshop (prototype, `/author/desk`, docs/author-desk.md).
 *
 * Three steps, the same everywhere: **Текст → Голос → Серия**.
 *
 *  1. **Текст** - write or paste it. Notes (what it is about, what it must
 *     hold, thoughts, materials) live inside this step and are optional:
 *     many authors arrive with finished texts.
 *  2. **Голос** - every bok goes out with the author's voice, recorded on the
 *     teleprompter or uploaded as a file.
 *  3. **Серия** - the editors draw the pictures and make the Series, up to
 *     50 a year and about one a week, in the author's order; the author
 *     watches it and publishes it.
 *
 * No AI anywhere: the workshop only keeps things in order.
 */

export const stages = ["text", "voice", "editors"] as const;
export type Stage = (typeof stages)[number];

export type Entry = { text: string; at: string };

export type Concept = {
  about: string;
  approach: string;
  form: string;
  /** Beats the work must hold, in the author's words, ticked by the author. */
  plan: { id: string; text: string; done: boolean }[];
};

export const materialKinds = ["fact", "image", "phrase", "source", "note"] as const;
export type MaterialKind = (typeof materialKinds)[number];

export type Material = {
  id: string;
  kind: MaterialKind;
  text: string;
  source?: string;
  /** A part of the work this must reach ("Глава 3", a plan beat). */
  pinTo?: string;
};

export type Take = {
  id: string;
  seconds: number;
  at: string;
  source: "teleprompter" | "file";
  name?: string;
  /** The text this take reads (`textKey`): a take of an older text no longer matches the page. */
  textKey?: string;
};

/** A short fingerprint of a text, ignoring spacing, to tell whether a take still reads it. */
export function textKey(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  let hash = 5381;
  for (let index = 0; index < flat.length; index += 1) hash = ((hash << 5) + hash + flat.charCodeAt(index)) | 0;
  return `${flat.length}-${(hash >>> 0).toString(36)}`;
}

/** A take recorded before the text last changed. Takes from before keys existed count as current. */
export function isStale(take: Take, text: string) {
  return Boolean(take.textKey) && take.textKey !== textKey(text);
}

/**
 * A work with the editors: waiting in the author's queue, being made this
 * week, waiting for the author's approval, out.
 */
export const editorSteps = ["queued", "production", "approval", "published"] as const;
export type EditorStep = (typeof editorSteps)[number];

export type EditorNote = { from: "author" | "editors"; text: string; at: string };

/**
 * When the editors cannot take a piece as it is: back for changes, or a
 * refusal. Always with a reason the author reads; never a silent drop.
 */
export const outcomeCategories = ["voice", "text", "law", "other"] as const;
export type OutcomeCategory = (typeof outcomeCategories)[number];
export type Outcome = {
  kind: "changes" | "declined";
  category: OutcomeCategory;
  reason: string;
  at: string;
  /** The text as it was when the editors answered (`textKey`), to see whether it has changed since. */
  textKey?: string;
};

/** One thing that happened to a work on its way to a Series, seen alike by the author and the editors. */
export type HistoryEntry = { who: "author" | "editors"; what: string; at: string };

export type Work = {
  id: string;
  title: string;
  form: "poem" | "prose";
  /** Where it came from when the team moved it from another platform. */
  importedFrom?: string;
  createdAt: string;
  updatedAt: string;
  idea: { notes: Entry[]; concept: Concept | null };
  materials: Material[];
  text: string;
  takes: Take[];
  chosenTake: string | null;
  /** The editors' last answer when they returned or refused it; cleared when the author sends it again. */
  outcome?: Outcome;
  /** Put aside by the author for later: kept, not asking for a voice, not in «Ждёт вас». */
  shelved?: boolean;
  /** What happened on the way to the Series: queued, moved, taken, handed back, published. */
  history?: HistoryEntry[];
  editors: {
    step: EditorStep | null;
    notes: EditorNote[];
    publishedAt?: string;
    /** The editors fixed this place in the queue (say, the Series is made in advance); the author cannot move it. */
    fixed?: boolean;
    /** Back with the editors for the author's corrections, which take up to a week. */
    revising?: boolean;
  };
};

/** The room a work is in: the furthest it has honestly reached. */
export function stageOf(work: Work): Stage {
  if (work.editors.step) return "editors";
  if (work.text.trim().length >= textMinimum) return "voice";
  return "text";
}

/** Shorter than this is a note, not a text worth voicing. */
/** Any text can be read aloud: a quatrain, a single line. */
export const textMinimum = 1;

/** Reading aloud at an unhurried pace: about 14 characters a second for Russian prose, 11 for verse. */
export function readingSeconds(text: string, form: Work["form"]) {
  const chars = text.replace(/\s+/g, " ").trim().length;
  return Math.max(10, Math.round(chars / (form === "poem" ? 11 : 14)));
}

/** The 15-minute promise holds for the reading as well as the text. */
export const maxReadingSeconds = 15 * 60;

export type QueueCheck = { ok: true } | { ok: false; missing: ("text" | "voice" | "long" | "stale")[] };

/** What stands between a work and the queue. A picture is never one of them. */
export function canQueue(work: Work): QueueCheck {
  const missing: ("text" | "voice" | "long" | "stale")[] = [];
  if (work.text.trim().length < textMinimum) missing.push("text");
  const chosen = work.takes.find((take) => take.id === work.chosenTake);
  if (!chosen) missing.push("voice");
  else if (isStale(chosen, work.text)) missing.push("stale");
  if (readingSeconds(work.text, work.form) > maxReadingSeconds) missing.push("long");
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Pins grouped by the part they must reach, for the writing room's margin. */
export function pinsByPart(materials: Material[]) {
  const parts = new Map<string, Material[]>();
  for (const item of materials) {
    if (!item.pinTo?.trim()) continue;
    const key = item.pinTo.trim();
    parts.set(key, [...(parts.get(key) ?? []), item]);
  }
  return parts;
}

/* The release queue ------------------------------------------------- */

/** The standard plan: at most one Boks Series a week, at most fifty a year. */
export const plan = { perWeek: 1, perYear: 50 } as const;

/** Corrections after the author has watched a Series take up to this many days. */
export const revisionDays = 7;

/** Monday 00:00 local time of the week `date` falls in. */
export function weekStart(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export type QueuePlanInput = {
  queue: string[];
  /** A Series already being made this week fills this week. */
  busyThisWeek: number;
  today: Date;
  /** Series already counted against each year's allowance (published, being made, ready). */
  usedByYear: Record<number, number>;
  perYear?: number;
};

/**
 * The week each queued work is planned for: one a week from the first free
 * week, and a week whose year has used its allowance is skipped, so the work
 * moves into the next year. A week's year is the year its Monday falls in.
 */
export function plannedWeeks({ queue, busyThisWeek, today, usedByYear, perYear = plan.perYear }: QueuePlanInput) {
  const used = { ...usedByYear };
  const cursor = weekStart(today);
  cursor.setDate(cursor.getDate() + 7 * busyThisWeek);
  const planned = new Map<string, Date>();
  for (const id of queue) {
    while ((used[cursor.getFullYear()] ?? 0) >= perYear) cursor.setDate(cursor.getDate() + 7);
    planned.set(id, new Date(cursor));
    used[cursor.getFullYear()] = (used[cursor.getFullYear()] ?? 0) + 1;
    cursor.setDate(cursor.getDate() + 7);
  }
  return planned;
}

/**
 * Moves `id` to `index` in the queue. Places the editors fixed do not move
 * and cannot be taken: the author reorders only the free places among
 * themselves. A fixed work itself does not move.
 */
export function moveInQueue(queue: string[], id: string, index: number, fixed: ReadonlySet<string> = new Set()) {
  if (!queue.includes(id) || fixed.has(id)) return queue;
  const free = queue.filter((item) => !fixed.has(item));
  const target = Math.max(0, Math.min(index, queue.length - 1));
  // The free place nearest to `target`, counted among free places.
  let slot = queue.slice(0, target + 1).filter((item) => !fixed.has(item)).length - 1;
  if (fixed.has(queue[target]) && queue.indexOf(id) > target) slot += 1;
  const rest = free.filter((item) => item !== id);
  const at = Math.max(0, Math.min(slot, rest.length));
  const order = [...rest.slice(0, at), id, ...rest.slice(at)];
  return queue.map((item) => (fixed.has(item) ? item : order.shift()!));
}

/** One step earlier or later, jumping over fixed places. */
export function shiftInQueue(queue: string[], id: string, step: -1 | 1, fixed: ReadonlySet<string> = new Set()) {
  const from = queue.indexOf(id);
  if (from < 0 || fixed.has(id)) return queue;
  let to = from + step;
  while (to >= 0 && to < queue.length && fixed.has(queue[to])) to += step;
  if (to < 0 || to >= queue.length) return queue;
  const next = [...queue];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function withHistory(work: Work, who: HistoryEntry["who"], what: string): Work {
  return { ...work, history: [...(work.history ?? []), { who, what, at: new Date().toISOString() }] };
}

export function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function blankWork(title = ""): Work {
  const now = new Date().toISOString();
  return {
    id: newId("w"),
    title,
    form: "prose",
    createdAt: now,
    updatedAt: now,
    idea: { notes: [], concept: null },
    materials: [],
    text: "",
    takes: [],
    chosenTake: null,
    editors: { step: null, notes: [] },
  };
}

/**
 * Lines to read: verse line by line, prose cut at sentences (then commas)
 * into pieces of about 70 characters. Empty lines stay, as pauses between
 * stanzas and paragraphs. The teleprompter lights one line at a time and the
 * Series shows the same lines.
 */
export function readingLines(text: string, width = 70) {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length <= width) {
      out.push(line);
      continue;
    }
    let piece = "";
    for (const part of line.split(/(?<=[.!?…:;,])\s+/)) {
      if (piece && `${piece} ${part}`.length > width) {
        out.push(piece);
        piece = part;
      } else piece = piece ? `${piece} ${part}` : part;
    }
    if (piece) out.push(piece);
  }
  return out;
}

/**
 * Whether a piece returned for changes can go back: whatever the editors
 * asked about must have changed. A recording asks for a newer recording, a
 * text for a changed text; «Другое» only for what the queue always needs.
 */
export function resendCheck(work: Work): { ok: true } | { ok: false; reason: "declined" | "new-take" | "edit-text" | "queue" } {
  const outcome = work.outcome;
  if (outcome?.kind === "declined") return { ok: false, reason: "declined" };
  if (!canQueue(work).ok) return { ok: false, reason: "queue" };
  if (!outcome) return { ok: true };
  const chosen = work.takes.find((take) => take.id === work.chosenTake);
  if (outcome.category === "voice" && !(chosen && chosen.at > outcome.at)) return { ok: false, reason: "new-take" };
  if (outcome.category === "text" && outcome.textKey && textKey(work.text) === outcome.textKey) return { ok: false, reason: "edit-text" };
  return { ok: true };
}
