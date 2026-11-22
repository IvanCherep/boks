/**
 * The pure parts of the Workshop's server client (`docs/workshop-server.md`):
 * the notes' limits as the database checks them (`boks_workshop_notes_problem`),
 * the author's queue, and how a refusal is told apart.
 */

export const notesLimits = { bytes: 65536, keys: 20, items: 200, chars: 2000 } as const;

const isScalar = (value: unknown) => value === null || ["string", "number", "boolean"].includes(typeof value);
const tooLong = (value: unknown) => typeof value === "string" && [...value].length > notesLimits.chars;

/**
 * Why the database would refuse these notes, in its own words (translated in
 * `lib/boks/errors.ts`), or null when it would take them.
 */
export function notesProblem(notes: unknown): string | null {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return "Notes must be an object.";
  if (new TextEncoder().encode(JSON.stringify(notes)).length > notesLimits.bytes) return "The notes are longer than 64 KB.";
  const entries = Object.entries(notes);
  if (entries.length > notesLimits.keys) return "The notes have too many parts.";
  for (const [, value] of entries) {
    if (Array.isArray(value)) {
      if (value.length > notesLimits.items) return "A list in the notes holds at most 200 entries.";
      for (const item of value) {
        if (Array.isArray(item)) return "The notes are nested too deep.";
        if (item && typeof item === "object") {
          for (const field of Object.values(item)) {
            if (!isScalar(field)) return "The notes are nested too deep.";
            if (tooLong(field)) return "A note is longer than 2000 characters.";
          }
        } else if (tooLong(item)) return "A note is longer than 2000 characters.";
      }
    } else if (value && typeof value === "object") return "The notes are nested too deep.";
    else if (tooLong(value)) return "A note is longer than 2000 characters.";
  }
  return null;
}

/** The author's queue as the database keeps it: pieces with a place, by place. */
export function queueOf<T extends { id: string; queuePos: number | null }>(pieces: T[]) {
  return pieces.filter((piece) => piece.queuePos !== null).sort((a, b) => a.queuePos! - b.queuePos!).map((piece) => piece.id);
}

/** The queue with one piece moved up (−1) or down (+1); unchanged at either end or for a piece not in it. */
export function moveInQueue(ids: string[], id: string, delta: -1 | 1) {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** The refusal of `get_my_workshop()` for anyone but a verified author: show the way to My page instead. */
export function isWorkshopClosed(error: unknown) {
  const value = error as { code?: string; message?: string; hint?: string } | null;
  return Boolean(value && (value.hint === "workshop_closed" || (value.code === "42501" && /Workshop is open to authors/.test(value.message ?? ""))));
}
