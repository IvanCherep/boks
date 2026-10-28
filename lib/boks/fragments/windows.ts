/**
 * The comparison arm of Б3: same-length windows from the same books.
 *
 * For each algorithm fragment, a window with exactly as many words, starting
 * at a paragraph start drawn at random. It is deliberately not snapped to a
 * sentence end: a window that knows where sentences stop is already half an
 * algorithm, and the claim is that the algorithm beats cutting at random.
 * Starting at a paragraph start is the one courtesy, so that a window and a
 * fragment differ in where they were cut, not in whether the first line is
 * half a sentence.
 */

import { randomInt } from "@/lib/recsys/statistics/random";
import type { Paragraph, TextRange } from "@/lib/boks/fragments/text";

export type FragmentWindow = TextRange & {
  words: number;
  /** True when no start could avoid the algorithm's fragments and the window overlaps one. */
  overlapsAlgorithm: boolean;
};

/** How many random starts to try before accepting an overlap. */
const attemptsPerWindow = 500;

export function drawWindows(
  source: string,
  paragraphs: Paragraph[],
  fragments: (TextRange & { words: number })[],
  next: () => number,
): FragmentWindow[] {
  const algorithm = fragments.map(({ start, end }) => ({ start, end }));
  const taken: TextRange[] = [...algorithm];
  const windows: FragmentWindow[] = [];

  for (const fragment of fragments) {
    let fallback: FragmentWindow | null = null;
    let chosen: FragmentWindow | null = null;
    for (let attempt = 0; attempt < attemptsPerWindow && !chosen; attempt += 1) {
      const paragraph = paragraphs[randomInt(next, paragraphs.length)];
      const end = endAfterWords(source, paragraph.start, fragment.words);
      if (end === null) continue;
      const range = { start: paragraph.start, end };
      if (!taken.some((other) => overlaps(range, other))) {
        chosen = { ...range, words: fragment.words, overlapsAlgorithm: false };
      } else if (!fallback && !windows.some((other) => overlaps(range, other))) {
        // Overlapping another window is avoidable more often than overlapping
        // the algorithm; keep the first draw that at least does that.
        fallback = { ...range, words: fragment.words, overlapsAlgorithm: algorithm.some((other) => overlaps(range, other)) };
      }
    }
    const window = chosen ?? fallback;
    if (!window) continue;
    windows.push(window);
    taken.push(window);
  }
  return windows;
}

/**
 * The offset just past the `words`-th word counted from `start`, or null when
 * the work ends first. A word is a run of non-space characters, the same count
 * the database stores, so the window and its fragment report equal lengths.
 */
export function endAfterWords(source: string, start: number, words: number) {
  const pattern = /\S+/g;
  pattern.lastIndex = start;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    count += 1;
    if (count === words) return match.index + match[0].length;
  }
  return null;
}

function overlaps(a: TextRange, b: TextRange) {
  return a.start < b.end && b.start < a.end;
}
