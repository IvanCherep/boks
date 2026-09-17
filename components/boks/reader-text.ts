/**
 * Laying out a literary text for reading.
 *
 * Ported from the original boks reader, which had to display work pasted from
 * anywhere: a poem, a hard-wrapped export, a document that repeats its own
 * title on the first line. The reader renders whatever it is handed, so the
 * shaping has to happen before it.
 *
 * The problem this solves: splitting on every newline and making each line a
 * paragraph is right for text written in an editor and wrong for everything
 * else. Hard-wrapped prose becomes one short paragraph per *line*, with a full
 * paragraph gap between them. Verse gets the same gap between every line, which
 * destroys the stanza. Both look broken, and the reader blames the writing.
 */

export type ReaderBlock = {
  /**
   * `verse` keeps its line breaks; `prose` is one reflowed paragraph.
   */
  kind: "verse" | "prose";
  lines: string[];
};

/**
 * Telling a poem from a hard-wrapped paragraph.
 *
 * Line length alone cannot do it: a Teasdale stanza runs to about forty
 * characters a line and so does prose wrapped at sixty. What separates them is
 * the right-hand edge. A wrapping program fills every line to its margin, so
 * wrapped prose is a column of near-identical widths; a poet ends each line
 * where the line ends, so verse is ragged.
 *
 * So: short lines are verse outright, and past that it is the raggedness that
 * decides. The last line is left out of that measurement, because a wrapped
 * paragraph's final line is short by construction and would make every
 * paragraph look ragged.
 *
 * Tuned against the public-domain catalogue and against paragraphs wrapped at
 * 58, 64, 70, 76 and 80 columns: 96% of verse blocks are recognised and no
 * wrapped paragraph is mistaken for a poem. The previous rule - an average of
 * 34 characters, which is the *median* of real verse - reflowed Teasdale,
 * Whitman and half of Dickinson into paragraphs.
 */
const verseMaxAverageLength = 44;
const verseFullLineShare = 0.9;
const verseMaxFilledShare = 0.75;
const verseMinLines = 3;

/** A standalone line short enough to belong with its neighbours. */
const compactLineMaxLength = 82;
const compactLineMaxWords = 12;
const compactSentenceMaxLength = 64;
const compactRunMinimum = 3;

/**
 * Turns a stored body into the blocks the reader should render.
 *
 * `title` is used only to drop a first block that merely repeats it - common in
 * pasted text, and it reads as a mistake directly under the rendered title.
 */
export function formatReaderBody(body: string, title = ""): ReaderBlock[] {
  const normalized = (body ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();

  if (!normalized) return [];

  /**
   * Whether the piece as a whole is verse, decided once from every line.
   *
   * Deciding per block cannot see a couplet. Blok's `Предчувствую Тебя` puts a
   * blank line after every second line, so each block held two lines - below
   * the three-line minimum - and the poem was reflowed into a run of two-line
   * paragraphs. Any poem in couplets breaks the same way in any language; the
   * Russian catalogue is simply where it was noticed.
   *
   * Eleven lines of evidence beat two, so the whole body votes and each block
   * follows, while a block that looks like verse on its own still counts -
   * which is what keeps a poem quoted inside a story rendered as a poem.
   */
  const bodyIsVerse = looksLikeVerse(normalized.split("\n").map((line) => line.trim()).filter(Boolean));

  const blocks = normalized
    .split(/\n{2,}/)
    .map((raw) => toBlock(raw, bodyIsVerse))
    .filter((block): block is ReaderBlock => block !== null);

  const titleKey = comparisonKey(title);
  if (titleKey && blocks.length && comparisonKey(blocks[0].lines.join(" ")) === titleKey) {
    blocks.shift();
  }

  return groupCompactRuns(blocks);
}

function toBlock(raw: string, bodyIsVerse = false): ReaderBlock | null {
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (!lines.length) return null;
  if (lines.length === 1) return { kind: "prose", lines };

  // Several short lines in a row were broken on purpose. Several long ones were
  // broken by whatever wrapped the file, and should be read as one paragraph.
  return bodyIsVerse || looksLikeVerse(lines)
    ? { kind: "verse", lines }
    : { kind: "prose", lines: [lines.join(" ")] };
}

function looksLikeVerse(lines: string[]) {
  if (lines.length < verseMinLines) return false;

  const averageLength = lines.reduce((total, line) => total + line.length, 0) / lines.length;
  if (averageLength <= verseMaxAverageLength) return true;

  const widths = lines.slice(0, -1).map((line) => line.length);
  const longest = Math.max(...widths);
  const filled = widths.filter((width) => width >= longest * verseFullLineShare).length / widths.length;
  return filled < verseMaxFilledShare;
}

/**
 * Three or more short standalone lines become one block.
 *
 * A run of one-line fragments - a list, an exchange of dialogue, the closing
 * beats of a story - is a single passage. Left apart, each one gets a full
 * paragraph gap and the page turns into an unreadable ladder.
 */
function groupCompactRuns(blocks: ReaderBlock[]): ReaderBlock[] {
  const out: ReaderBlock[] = [];
  let run: ReaderBlock[] = [];

  const flush = () => {
    if (!run.length) return;
    if (run.length >= compactRunMinimum) {
      out.push({ kind: "verse", lines: run.map((block) => block.lines[0]) });
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const block of blocks) {
    if (isCompactStandalone(block)) {
      run.push(block);
      continue;
    }
    flush();
    out.push(block);
  }
  flush();

  return out;
}

function isCompactStandalone(block: ReaderBlock) {
  if (block.lines.length !== 1) return false;

  const line = block.lines[0];
  const words = line.split(/\s+/).filter(Boolean).length;
  if (!words) return false;

  // A finished sentence has to be shorter still to count as a fragment: a full
  // short sentence is usually its own paragraph and was meant to stand alone.
  const sentenceLike = /[.!?…]$/.test(line);
  return (
    line.length <= compactLineMaxLength &&
    words <= compactLineMaxWords &&
    (!sentenceLike || line.length <= compactSentenceMaxLength)
  );
}

function comparisonKey(value: string) {
  return (
    value
      .toLowerCase()
      // `ё` and `е` are the same letter for this comparison: Russian editions
      // differ on whether they print the diaeresis, and Wikisource titles an
      // untitled poem by its opening line. So `Кот поёт, глаза прищуря` and
      // `Кот поет, глаза прищуря,` are the same words, and without folding
      // them twenty poems dropped the repeated line while seven kept it.
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}]+/gu, "")
  );
}
