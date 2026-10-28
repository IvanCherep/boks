/**
 * The source text, cut into paragraphs and sentences by character offsets.
 *
 * Hypothesis Б3 promises that a fragment keeps the source text verbatim, so
 * nothing here rewrites a character: a paragraph is a pair of offsets into the
 * work, and every fragment body is later `source.slice(start, end)`. Trimming,
 * dehyphenation or quote normalisation would make the rated text differ from
 * the book, and then the rating would be of an edited text.
 */

import { readingWordsPerMinute } from "@/components/boks/reader-behavior";

export type Paragraph = {
  /** Position in the work, from 0. */
  index: number;
  /** Offset of the first non-space character. */
  start: number;
  /** Offset just past the last non-space character. */
  end: number;
  words: number;
  /** A chapter or section title, or a scene break such as `* * *`. */
  heading: boolean;
  /** A line of dialogue: opens with a dash or a quotation mark. */
  dialogue: boolean;
  /**
   * A piece of an author's paragraph that was too long to cut around, split
   * at a sentence end (`splitLongParagraphs`). A fragment may start or end
   * here, but the reader then begins or stops mid-paragraph.
   */
  continued?: boolean;
};

export type TextRange = { start: number; end: number };

/**
 * Words the way the database counts them: runs of non-space characters.
 * `import_boks_study_fragments` stores `word_count` by splitting on `\s+`, so
 * the window baseline has to be "the same length" by this count and no other.
 */
export function countWords(text: string) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Minutes at the feed's fixed reading speed - the same constant the reader uses. */
export function readingMinutes(words: number) {
  return words / readingWordsPerMinute;
}

/**
 * Paragraphs, found by either of the two layouts plain-text books come in.
 *
 * Gutenberg wraps lines at about 70 characters and separates paragraphs with
 * a blank line; most Russian sources put one paragraph on one line and use
 * blank lines, if at all, around headings. Splitting the first kind on single
 * newlines turns every printed line into a paragraph, and splitting the second
 * kind on blank lines turns a whole chapter into one. The layout is chosen by
 * looking: if most blank-line blocks hold more than one line, the lines are
 * wrapped and the blank line is the paragraph break.
 */
export function splitParagraphs(source: string): Paragraph[] {
  const blocks = rangesBetween(source, /\n[ \t\r\f\v]*\n\s*/g);
  const ranges = isHardWrapped(source, blocks) ? blocks : rangesBetween(source, /\n\s*/g);

  return ranges.map((range, index) => {
    const text = source.slice(range.start, range.end);
    return {
      index,
      start: range.start,
      end: range.end,
      words: countWords(text),
      heading: isHeading(text),
      dialogue: /^[—–\-«"“„']/.test(text),
    };
  });
}

/**
 * Paragraphs longer than `maxWords`, split into runs of whole sentences of
 * about `targetWords`. Without this a work pasted with no line breaks, or one
 * whose author writes pages-long paragraphs, has nowhere to cut at all. The
 * pieces are still offsets into the source, so the text is untouched; each
 * piece after the first is marked `continued`.
 */
export function splitLongParagraphs(source: string, paragraphs: Paragraph[], maxWords: number, targetWords = 150): Paragraph[] {
  const out: Paragraph[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.words <= maxWords || paragraph.heading) {
      out.push({ ...paragraph, index: out.length });
      continue;
    }
    const sentences = splitSentences(source, paragraph);
    let from = 0;
    while (from < sentences.length) {
      let to = from;
      let words = countWords(source.slice(sentences[from].start, sentences[from].end));
      while (to + 1 < sentences.length && words < targetWords) {
        to += 1;
        words += countWords(source.slice(sentences[to].start, sentences[to].end));
      }
      // A short tail joins the piece before it rather than standing alone.
      if (to + 1 < sentences.length) {
        const rest = countWords(source.slice(sentences[to + 1].start, paragraph.end));
        if (rest < targetWords / 3) to = sentences.length - 1;
      }
      const start = sentences[from].start;
      const end = sentences[to].end;
      out.push({
        index: out.length,
        start,
        end,
        words: countWords(source.slice(start, end)),
        heading: false,
        dialogue: from === 0 && paragraph.dialogue,
        continued: from > 0,
      });
      from = to + 1;
    }
  }
  return out;
}

/**
 * Wrapped text breaks lines wherever the width runs out, so most lines that
 * continue onto the next one stop mid-sentence. One-paragraph-per-line text
 * breaks only where a paragraph ends, so nearly every such line ends with
 * punctuation. Counting which happens is steadier than looking at line
 * lengths, which dialogue makes short in either layout.
 */
function isHardWrapped(source: string, blocks: TextRange[]) {
  if (blocks.length < 2) return false;
  let joins = 0;
  let finished = 0;
  for (const block of blocks) {
    const lines = source.slice(block.start, block.end).split("\n");
    for (const line of lines.slice(0, -1)) {
      // "Глава XII" on the line above its first paragraph is a heading, not
      // a wrapped line, and says nothing about the layout.
      if (isHeading(line)) continue;
      joins += 1;
      if (/[.!?…:;»"”')\]]\s*$/.test(line)) finished += 1;
    }
  }
  // Wrapped prose has a join in most blocks; a few stray ones are not a layout.
  return joins * 2 >= blocks.length && finished * 2 < joins;
}

/** Non-empty stretches between separators, trimmed to their first and last visible character. */
function rangesBetween(source: string, separator: RegExp): TextRange[] {
  const ranges: TextRange[] = [];
  let cursor = 0;
  const push = (from: number, to: number) => {
    const text = source.slice(from, to);
    const lead = text.length - text.trimStart().length;
    const trail = text.length - text.trimEnd().length;
    if (lead < text.length) ranges.push({ start: from + lead, end: to - trail });
  };
  for (const match of source.matchAll(separator)) {
    push(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  push(cursor, source.length);
  return ranges;
}

// Not `\b`: in JavaScript it only knows ASCII letters, and "Глава" has none.
const headingWords = /^(глава|часть|книга|том|эпилог|пролог|chapter|part|book|volume|epilogue|prologue)(?=[\s.:]|$)/iu;

/**
 * A heading is short and does not read as a sentence: "Глава III", "II.
 * Господин Бахчеев", "CHAPTER 4", "* * *". The test is deliberately loose -
 * a heading missed costs one cue in the score, while a short line of dialogue
 * taken for a heading would forbid a fragment from ending on it.
 */
export function isHeading(text: string) {
  const line = text.trim();
  if (/^[*•·\s]+$/.test(line) && line.includes("*")) return true;
  if (line.includes("\n") || countWords(line) > 10) return false;
  if (/^[—–\-«"“„]/.test(line)) return false;
  if (headingWords.test(line)) return true;
  if (/^[IVXLC]+\.?(\s|$)/.test(line)) return true;
  if (/^\d{1,3}\.?$/.test(line)) return true;
  return !/[.!?…:;,»"”)]$/.test(line) && line === line.toUpperCase() && /\p{L}/u.test(line);
}

/**
 * Sentences inside a range, by offsets. A sentence ends at `.`, `!`, `?` or
 * `…` (with any closing quotes or brackets) followed by space. Abbreviations
 * such as "т. е." will split a sentence in two; that is acceptable here,
 * because sentences are only read for their first word and for whether the
 * last one is finished.
 */
export function splitSentences(source: string, range: TextRange): TextRange[] {
  const text = source.slice(range.start, range.end);
  const sentences: TextRange[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/[.!?…]+[»"”')\]]*(?=\s|$)/gu)) {
    const end = match.index + match[0].length;
    pushTrimmed(sentences, text, cursor, end, range.start);
    cursor = end;
  }
  pushTrimmed(sentences, text, cursor, text.length, range.start);
  return sentences;
}

function pushTrimmed(into: TextRange[], text: string, from: number, to: number, offset: number) {
  const part = text.slice(from, to);
  const lead = part.length - part.trimStart().length;
  const trail = part.length - part.trimEnd().length;
  if (lead < part.length) into.push({ start: offset + from + lead, end: offset + to - trail });
}

/** Does the text stop where a sentence stops (allowing closing quotes and brackets)? */
export function endsSentence(text: string) {
  return /[.!?…][»"”')\]]*$/u.test(text.trimEnd());
}

/** The first word, lowercased, without leading dashes or quotes. */
export function firstWord(text: string) {
  const match = text.match(/\p{L}[\p{L}'’-]*/u);
  return match ? match[0].toLowerCase().replace(/ё/g, "е") : "";
}
