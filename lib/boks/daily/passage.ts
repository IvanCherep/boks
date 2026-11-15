/**
 * Line of the day: the rules a selected line follows on its way from the
 * reader's text to a letter, shared by the browser and its tests. The
 * database repeats the comparison (`boks_passage_key`) and is the authority.
 */

/** Longest line that can be sent or saved; the database refuses longer. */
export const maxPassageLength = 280;
export const minPassageLength = 2;

/** The form two passages are compared in, as `boks_passage_key` does: ё reads as е. */
export function passageKey(text: string) {
  return foldCase(text.replace(/\s+/g, " ").trim());
}

function foldCase(text: string) {
  return text.toLowerCase().replace(/ё/g, "е");
}

/**
 * What a selection becomes before it is sent: the words as the reader sees
 * them, line breaks kept, runs of blank lines folded, no space at the ends.
 */
export function tidyPassage(selected: string) {
  return selected
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type PassageProblem = "empty" | "too-long" | "not-in-text";

/** Why a selection cannot be sent, or null when it can. */
export function passageProblem(passage: string, bokText: string): PassageProblem | null {
  const tidy = tidyPassage(passage);
  if (tidy.length < minPassageLength || !/[\p{L}\p{N}]/u.test(tidy)) return "empty";
  if (tidy.length > maxPassageLength) return "too-long";
  if (!passageKey(bokText).includes(passageKey(tidy))) return "not-in-text";
  return null;
}

export type PassageRange = { block: number; start: number; end: number };

/**
 * Where a passage sits in a bok as the reader renders it: one range per block
 * (paragraph or stanza) it touches, offsets into that block's displayed text
 * (`lines.join("\n")`). White space is matched loosely, so a stanza break in
 * the selection still finds its place. Null when the words are not there.
 */
export function locatePassage(blocks: readonly string[], passage: string): PassageRange[] | null {
  const wanted = passageKey(passage);
  if (!wanted) return null;
  // The whole text as one string, collapsed the same way, remembering for
  // every collapsed character where it came from.
  let collapsed = "";
  const origin: { block: number; offset: number }[] = [];
  let pendingSpace = false;
  blocks.forEach((text, block) => {
    for (let offset = 0; offset < text.length; offset += 1) {
      const char = text[offset];
      if (/\s/.test(char)) {
        pendingSpace = collapsed.length > 0;
        continue;
      }
      if (pendingSpace) {
        collapsed += " ";
        origin.push({ block, offset });
        pendingSpace = false;
      }
      // One source character can fold to more than one (İ): each keeps its origin.
      for (const folded of foldCase(char)) {
        collapsed += folded;
        origin.push({ block, offset });
      }
    }
    pendingSpace = collapsed.length > 0;
  });
  const at = collapsed.indexOf(wanted);
  if (at < 0) return null;
  const first = origin[at];
  const last = origin[at + wanted.length - 1];
  const ranges: PassageRange[] = [];
  for (let block = first.block; block <= last.block; block += 1) {
    const start = block === first.block ? first.offset : 0;
    const end = block === last.block ? last.offset + 1 : blocks[block].length;
    if (end > start) ranges.push({ block, start, end });
  }
  return ranges;
}

/**
 * How the three names of a question are shown: surnames, as a reader says
 * them ("Тютчев"), unless two share one, then the full names.
 */
export function optionLabels(names: readonly string[]) {
  const surnames = names.map((name) => name.trim().split(/\s+/).at(-1) ?? name);
  const clash = new Set(surnames.map((name) => name.toLowerCase())).size < surnames.length;
  return clash ? names.map((name) => name.trim()) : surnames;
}

/** Fewer confirmed answers than this and the shares are not shown. */
export const minAnswersForShares = 10;

/**
 * Whole percentages that add up to 100 (largest remainder), so three bars
 * never read 33 + 33 + 33.
 */
export function wholeShares(counts: readonly number[]) {
  const total = counts.reduce((sum, count) => sum + Math.max(0, count), 0);
  if (!total) return counts.map(() => 0);
  const exact = counts.map((count) => (Math.max(0, count) / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

/** The device's time zone, which the server keeps for the account. */
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
