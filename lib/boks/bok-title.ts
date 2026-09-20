/**
 * A boks's title is optional. Left empty, the first line of the text stands in
 * for it - the way an untitled poem is known by its opening line.
 *
 * The database applies the same rule (`public.boks_title_from_text`, called by
 * a trigger on `reels`), so a title is never empty whichever path wrote the
 * row; this copy lets the author see the title they are about to get. The two
 * are held together by shared test vectors in `bok-title.test.ts` and
 * `scripts/local-supabase/checks.sql`.
 */

/** A first line longer than this is cut at a word, and the cut is marked. */
export const maxDerivedTitleLength = 80;

// Punctuation a line breaks on rather than ends on: a verse line's comma, a
// dash that runs on to the next line. A sentence's own . ! ? … are kept.
const trailingBreak = /[\s,;:—–-]+$/u;
// A dialogue dash or a bullet in front of the words.
const leadingMark = /^[\s*•·—–-]+/u;
// A line with nothing but these on it is a divider, not words: `* * *`, the
// way an untitled poem opens, or a lone dash.
const hasWords = /[^\s*•·.,;:!?…—–_=~#"'«»()[\]-]/u;

export function titleFromText(text: string | null | undefined): string {
  const firstLine = (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => hasWords.test(line));
  if (!firstLine) return "";

  const line = firstLine.replace(leadingMark, "").replace(trailingBreak, "");
  if (line.length <= maxDerivedTitleLength) return line;

  // Up to the last whole word within the limit. One character past it is
  // looked at so a word ending exactly on the limit is kept. A line with no
  // usable word break - one enormous word, or a break in its first half - is
  // simply cut at the limit.
  const head = line.slice(0, maxDerivedTitleLength + 1);
  const atWord = head.replace(/\s+\S*$/u, "");
  const cut =
    atWord.length < head.length && atWord.length >= maxDerivedTitleLength / 2
      ? atWord
      : line.slice(0, maxDerivedTitleLength);
  return `${cut.replace(trailingBreak, "")}…`;
}

/**
 * The title to store: the author's, or the text's first line. A title with no
 * words in it - `* * *` - counts as no title, as it does in the database.
 */
export function bokTitle(title: string | null | undefined, text: string | null | undefined): string {
  const given = (title ?? "").trim();
  return given && hasWords.test(given) ? given : titleFromText(text);
}
