/**
 * The author's voice on a bok (`docs/author-publishing.md`, "The author's
 * voice"): a new piece reaches the editors only with the author's reading of
 * it. This file is the shape of a piece's takes and their limits, shared by
 * the composer, the API route that keeps takes on disk and the tests. The
 * database keeps only the chosen take (`bok_voices`,
 * `20261122120000_boks_author_voice.sql`).
 */

export const voiceLimits = {
  /** Takes kept for one piece at a time. */
  takes: 5,
  /** Takes recorded or attached for one piece in all, deleted ones included. */
  takeUploads: 30,
  takeBytes: 25 * 1024 * 1024,
  takeMs: 15 * 60 * 1000,
  minTakeMs: 500,
  nameChars: 200,
} as const;

export type VoiceSource = "teleprompter" | "upload";

export type VoiceTake = {
  /** `take-<n>.<ext>`, the file in the piece's folder. */
  file: string;
  durationMs: number;
  bytes: number;
  source: VoiceSource;
  /** An attached file's own name, to recognise it by. */
  name: string | null;
  /** The text the take reads (`voiceFingerprint`), to tell a take of an older text. */
  fingerprint: string;
  createdAt: string;
};

/** A piece's takes as the route keeps them (`voice.json`) and answers them. */
export type VoiceTakes = {
  ownerId: string;
  takes: VoiceTake[];
  chosen: string | null;
  /** Takes added in all (`voiceLimits.takeUploads`). */
  uploads: number;
};

export const isVoiceSource = (value: unknown): value is VoiceSource => value === "teleprompter" || value === "upload";
export const isFingerprint = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
export const isBokId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

/**
 * The text as a reading of it is compared: runs of spaces, tabs and line
 * breaks made one space, the ends trimmed. The database does the same
 * (`boks_voice_fingerprint`), so a change of line breaks alone keeps a take
 * current and any change of words makes it old.
 */
export function voiceText(text: string) {
  return text.replace(/[ \t\r\n]+/g, " ").replace(/^ +| +$/g, "");
}

/** The first 16 hex digits of SHA-256 of `voiceText`: `boks_voice_fingerprint` in SQL. */
export async function voiceFingerprint(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(voiceText(text)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Whether the take reads another text than the one there is now. */
export const isStaleTake = (take: Pick<VoiceTake, "fingerprint">, fingerprint: string) => take.fingerprint !== fingerprint;

/** The chosen take, if it reads the current text: the one thing a piece needs to go to the editors. */
export function currentVoice(takes: Pick<VoiceTakes, "takes" | "chosen"> | null, fingerprint: string) {
  const chosen = takes?.takes.find((take) => take.file === takes.chosen) ?? null;
  return chosen && !isStaleTake(chosen, fingerprint) ? chosen : null;
}

/**
 * Which take is chosen after a new one comes in: the new one, unless the
 * chosen one still reads the same text as the new one.
 */
export function chosenAfterAdding(current: Pick<VoiceTakes, "takes" | "chosen">, added: VoiceTake) {
  const chosen = current.takes.find((take) => take.file === current.chosen);
  return chosen && chosen.fingerprint === added.fingerprint ? chosen.file : added.file;
}

/** After a take is deleted: the chosen one stays, else the newest that reads the current text, else the newest. */
export function chosenAfterRemoving(takes: VoiceTake[], chosen: string | null, removed: string, fingerprint?: string) {
  if (chosen && chosen !== removed && takes.some((take) => take.file === chosen)) return chosen;
  const left = takes.filter((take) => take.file !== removed);
  return (fingerprint ? left.filter((take) => take.fingerprint === fingerprint).at(-1) : undefined)?.file ?? left.at(-1)?.file ?? null;
}

/** A line the teleprompter shows at most about this long; prose is cut at sentences, then commas, then words. */
const promptLineChars = 64;

/**
 * The text as the teleprompter shows it: stanzas of lines. A blank line
 * starts a stanza (a paragraph of prose); a line break is a line; a long
 * line, as prose has, is cut after its sentences, then after commas and
 * dashes, then between words, so no line runs past about 64 characters.
 */
export function promptStanzas(text: string): string[][] {
  const stanzas: string[][] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/)) {
    const lines = block.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean).flatMap(cutLine);
    if (lines.length) stanzas.push(lines);
  }
  return stanzas;
}

function cutLine(line: string): string[] {
  if (line.length <= promptLineChars) return [line];
  const sentences = line.split(/(?<=[.!?…»"”)]) +(?=\S)/).flatMap((sentence) => (sentence.length <= promptLineChars ? [sentence] : cutPhrase(sentence)));
  return packWords(sentences);
}

/** A long sentence cut after commas, semicolons, colons and dashes, then between words. */
function cutPhrase(sentence: string): string[] {
  const parts = sentence.split(/(?<=[,;:]) +|(?<=\S) (?=[—–] )/);
  return parts.flatMap((part) => (part.length <= promptLineChars ? [part] : cutWords(part)));
}

function cutWords(part: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of part.split(" ")) {
    if (line && line.length + 1 + word.length > promptLineChars) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** Short pieces joined back while they fit, so a sentence of three words is not a line of its own after a long one. */
function packWords(pieces: string[]): string[] {
  const out: string[] = [];
  for (const piece of pieces) {
    const last = out.at(-1);
    if (last !== undefined && last.length + 1 + piece.length <= promptLineChars && piece.length < 24) out[out.length - 1] = `${last} ${piece}`;
    else out.push(piece);
  }
  return out;
}
