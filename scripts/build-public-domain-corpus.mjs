#!/usr/bin/env node
/**
 * Turns Project Gutenberg collections into individual boks.
 *
 * A Gutenberg book is a whole collection - "The Four Million", "Dubliners",
 * 450 Dickinson poems in one file. A bok is one piece. So the work here is
 * splitting, and the splitting has to be trustworthy: 400 files of subtly
 * truncated stories is worse than no corpus, because nobody notices until a
 * reader reaches the end of a piece that stops mid-sentence.
 *
 * How it splits, in order of preference:
 *
 *   1. **The book's own table of contents.** Gutenberg texts list their pieces
 *      under CONTENTS. Those are the real titles, so matching them as
 *      standalone lines in the body gives exact boundaries. Used wherever a
 *      usable table exists.
 *   2. **Roman numerals.** Sonnet sequences and Dickinson's editors numbered
 *      pieces rather than naming them. The numeral line is the boundary and
 *      the title is the ALL-CAPS line after it, or the first line of the poem
 *      - which is how such poems are cited anyway.
 *
 * Everything is then filtered on length and shape, and anything that fails is
 * reported rather than silently dropped, so a bad source shows up as a number
 * instead of as a gap.
 *
 * Copyright: the catalogue row for every source is checked for an author (and
 * translator) who died long enough ago to be public domain in life+70
 * countries as well as in the US. That check is in `sources.json` next to each
 * entry, not in this file, so it can be read without reading code.
 *
 *   node scripts/build-public-domain-corpus.mjs --cache <dir> --out <dir>
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// ------------------------------------------------------------------ arguments

function parseArgs(argv) {
  const args = { cache: "", out: "", limitPerSource: 0, only: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--cache") args.cache = value;
    else if (flag === "--out") args.out = value;
    else if (flag === "--limit-per-source") args.limitPerSource = Number(value);
    else if (flag === "--only") args.only = value;
    else continue;
    index += 1;
  }
  if (!args.cache || !args.out) {
    throw new Error("Usage: --cache <downloaded .txt dir> --out <corpus dir> [--limit-per-source N] [--only id]");
  }
  return args;
}

// ------------------------------------------------------------------- cleaning

/** Gutenberg wraps every text in a licence header and footer. */
export function stripGutenbergWrapper(raw) {
  let text = raw.replace(/\r\n/g, "\n");

  const start = text.match(/^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*\s*$/m);
  if (start) text = text.slice(start.index + start[0].length);

  const end = text.match(/^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*\s*$/m);
  if (end) text = text.slice(0, end.index);

  // A transcriber's note is about the edition, not the literature.
  text = text.replace(/^\s*(TRANSCRIBER'S NOTE|Transcriber's Note)[\s\S]*?(?=\n\n\n)/m, "");

  return text;
}

/** Marks that describe the printed page, not the piece. */
function stripEditionMarks(text) {
  return text
    .replace(/\[Illustration[^\]]*\]/g, "")
    .replace(/\[Picture[^\]]*\]/g, "")
    .replace(/\[Footnote[^\]]*\]/g, "")
    .replace(/^\s*\[\d+\]\s*$/gm, "")
    // Printer's rules and ornaments between pieces.
    .replace(/^\s*[-–—_=]{4,}\s*$/gm, "")
    .replace(/^\s*(\*\s*){3,}\*?\s*$/gm, "")
    .replace(/_/g, "")
    .replace(/[ \t]+$/gm, "");
}

/**
 * A slice runs to the start of the next piece, so it ends with that piece's
 * furniture: the printer's rule, a bare numeral, the next title. The story
 * itself is complete - this only removes what belongs to the neighbour.
 */
function trimTrailingFurniture(text) {
  const lines = text.split("\n");

  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (!last) {
      lines.pop();
      continue;
    }
    const isFurniture =
      /^[-–—_=*\s]{2,}$/.test(last) ||
      /^(?:the\s+end|finis|l'envoi)\.?$/i.test(last) ||
      isRoman(last) ||
      /^(?:by|BY)\s/.test(last) ||
      (last.length <= 60 && last.split(/\s+/).length <= 9 && !/[.!?,;:”"]$/.test(last) && looksLikeHeading(last)) ||
      (last.length <= 60 && last.split(/\s+/).length <= 9 && !/[.!?,;:”"’]$/.test(last) && isTitleCase(last));
    if (!isFurniture) break;
    lines.pop();
  }

  return lines.join("\n");
}

const romanLine = /^\s*([IVXLCDM]{1,7})\.?\s*$/;

function isRoman(line) {
  return romanLine.test(line) && line.trim().length <= 8;
}

const romanDigits = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanValue(value) {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    const digit = romanDigits[value[index]] ?? 0;
    const next = romanDigits[value[index + 1]] ?? 0;
    total += digit < next ? -digit : digit;
  }
  return total;
}

/**
 * Title case, as a printer would set a title: every word of substance
 * capitalised. This is the whole discriminator between a heading and a line of
 * narration, and getting it wrong is not subtle - allowing any line that did
 * not end in a full stop split Saki's stories on their dialogue, producing a
 * hundred "pieces" that were one paragraph torn out of the middle of a story,
 * titled with whatever the narrator happened to be saying.
 */
function isTitleCase(value) {
  // Quotes and brackets go; an apostrophe inside a word stays, or
  // "Cat'rinette" splits into a capitalised half and a lowercase one.
  const words = value
    .replace(/[“”"(),.:;!?—]/g, " ")
    .replace(/(^|\s)['’]|['’](\s|$)/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word.replace(/['’]/g, "").length >= 4);
  if (words.length < 1) return false;
  const capitalised = words.filter((word) => /^[A-Z]/.test(word)).length;
  return capitalised / words.length >= 0.8;
}

function looksLikeHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 70) return false;
  if (/[.!?]$/.test(trimmed) && !/^[IVXLCDM]+\.$/.test(trimmed)) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  return letters === letters.toUpperCase();
}

// --------------------------------------------------------------------- shape

/**
 * Verse keeps its line breaks; prose is unwrapped, because Gutenberg hard-wraps
 * at about seventy characters and those breaks are the printer's, not the
 * author's. Getting this wrong is visible: unwrapped verse reads as a
 * paragraph, and wrapped prose reads as a ragged column.
 */
export function classifyShape(text) {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 4) return "prose";

  const words = lines.map((line) => line.trim().split(/\s+/).length);
  const average = words.reduce((sum, count) => sum + count, 0) / words.length;
  const shortShare = words.filter((count) => count <= 9).length / words.length;
  if (average <= 9 && shortShare >= 0.65) return "verse";

  /**
   * Long-line free verse. Counting words per line calls Whitman prose - his
   * lines run to twenty words - and unwrapping him destroys the poem, which is
   * what the reader showed on the first try.
   *
   * What separates the two is not line length but its regularity. A wrapping
   * program fills every line to its margin, so wrapped prose is a column of
   * near-identical widths. A poet breaks lines where the line ends, so verse
   * has a ragged edge.
   */
  const widths = lines.map((line) => line.trim().length);
  const filled = widths.filter((width) => width >= 58).length / widths.length;
  return filled < 0.5 ? "verse" : "prose";
}

export function unwrapProse(text) {
  return text
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
    )
    .filter(Boolean)
    .join("\n\n");
}

function tidyVerse(text) {
  return text
    .split(/\n{3,}/)
    .map((stanza) =>
      stanza
        .split("\n")
        .map((line) => line.replace(/^\s+/, "").replace(/\s+$/, ""))
        .filter((line, index, all) => line || (index > 0 && index < all.length - 1))
        .join("\n")
    )
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// -------------------------------------------------------------------- titles

function titleCase(value) {
  const small = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "nor", "up"]);
  return value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part, index) => {
      if (/^\s+$/.test(part) || part === "-") return part;
      if (index > 0 && small.has(part)) return part;
      // The first *letter*, not the first character: a word opening with a
      // quotation mark would otherwise stay lowercase - “what You Want”.
      return part.replace(/[a-z]/, (letter) => letter.toUpperCase());
    })
    .join("")
    .replace(/\bI\b/g, "I");
}

/** ALL CAPS reads as shouting in a reader; printed titles were set in caps. */
function normalizeTitle(value) {
  const cleaned = value
    .replace(/_/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]*(?:[IVXLCDM]+\.)?\s*/, "")
    .replace(/\s*[.]*\s*$/, "")
    .trim();
  // A numeral carries no title. Word-casing it produced "Iii".
  if (!cleaned || romanLine.test(cleaned) || /^\d+$/.test(cleaned)) return "";
  const letters = cleaned.replace(/[^A-Za-z]/g, "");
  if (letters && letters === letters.toUpperCase() && letters.length > 2) return titleCase(cleaned);
  return cleaned;
}

/** A poem with no title is cited by its first line. */
function titleFromFirstLine(body) {
  const first = body.split("\n").find((line) => line.trim());
  if (!first) return "";
  const words = first.trim().replace(/[,;:.\-—]+$/, "");
  return words.length <= 60 ? words : `${words.slice(0, 57).trimEnd()}…`;
}

// ------------------------------------------------------------------ splitting

/**
 * The book's own table of contents, and where it ends.
 *
 * Both halves matter. The titles are the real boundaries; the end offset is
 * what keeps the splitter out of the table itself. Without it, a volume whose
 * table lists every poem's first line under its title gets "split" into
 * fragments of the table - which is what happened to Millay, and the pieces
 * looked plausible enough to pass every length check.
 *
 * Tables that list a title and its opening line are told apart by indentation:
 * the titles sit at the shallowest indent in the block.
 */
function findContents(text) {
  const heading = text.match(/^[ \t]*(CONTENTS|Contents)[ \t.:]*$/m);
  if (!heading) return { titles: [], endIndex: 0 };

  const startIndex = heading.index + heading[0].length;
  const lines = text.slice(startIndex).split("\n");

  const entries = [];
  let consumed = 0;
  let blankRun = 0;

  for (const line of lines) {
    consumed += line.length + 1;
    if (!line.trim()) {
      blankRun += 1;
      // A long gap ends the table.
      if (blankRun >= 4 && entries.length) break;
      continue;
    }
    blankRun = 0;

    const cleaned = line
      .replace(/\.{2,}\s*\d*\s*$/, "")
      .replace(/\s{2,}\d+\s*$/, "")
      .trimEnd();
    const trimmed = cleaned.trim();

    // Prose ends the table: a long line that finishes a sentence.
    if (trimmed.length > 70 || (/[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length > 9)) break;
    if (!/[A-Za-z]/.test(trimmed)) continue;

    entries.push({ indent: cleaned.length - cleaned.trimStart().length, title: trimmed });
  }

  if (!entries.length) return { titles: [], endIndex: startIndex };

  const shallowest = Math.min(...entries.map((entry) => entry.indent));
  const titles = entries
    .filter((entry) => entry.indent === shallowest)
    .map((entry) => entry.title.replace(/^(?:[IVXLCDM]+|\d+)[.)]?\s+/, "").trim())
    .filter((title) => title.length > 1 && title.length <= 70);

  return { titles: [...new Set(titles)], endIndex: startIndex + consumed };
}

function splitByContents(body, titles) {
  const anchors = [];
  const lines = body.split("\n");

  const blank = (index) => index < 0 || index >= lines.length || !lines[index].trim();

  titles.forEach((title) => {
    const wanted = title.replace(/\s+/g, " ").toLowerCase().replace(/[.]*$/, "");
    const matches = [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].replace(/\s+/g, " ").trim().replace(/[.]*$/, "").toLowerCase();
      if (line === wanted) matches.push(index);
    }
    if (!matches.length) return;

    // A heading stands alone. Without this, a title that also occurs as a line
    // of prose steals the anchor: "beyond the bayou." ends one Chopin story
    // and names another, and the later match silently truncated the first.
    const heading = matches.find((index) => blank(index - 1) && blank(index + 1));
    anchors.push({ line: heading ?? matches[0], title });
  });

  anchors.sort((a, b) => a.line - b.line);

  return anchors.map((anchor, index) => ({
    title: anchor.title,
    body: lines.slice(anchor.line + 1, anchors[index + 1]?.line ?? lines.length).join("\n"),
  }));
}

/**
 * Titles set as standalone lines, for a book with no table of contents at all
 * - Saki's collections, most single-poet volumes. A heading here is a short
 * line in capitals, or in title case, with blank lines on both sides.
 *
 * The risk is a false positive splitting a story in half, so the bar is
 * deliberately high: surrounded by blank lines, no sentence punctuation, and
 * the pieces it produces still have to pass the length and shape filters.
 */
function splitByHeadings(body) {
  const lines = body.split("\n");
  const blank = (index) => index < 0 || index >= lines.length || !lines[index].trim();

  const marks = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 60) return;
    if (!blank(index - 1) || !blank(index + 1)) return;
    if (/[,;:]$/.test(trimmed)) return;

    const letters = trimmed.replace(/[^A-Za-z]/g, "");
    if (letters.length < 3) return;

    // "by Rupert Brooke" under the volume title is a credit, not a piece.
    if (/^(?:by|BY)\b/.test(trimmed)) return;

    /**
     * Speech is never a title. A short line of dialogue set off by blank lines
     * is in title case as often as not - "Strike!", "Mrs. Lamper?" - and
     * taking it for a heading tore five Saki stories and five of Wharton's
     * into fragments, each titled with whatever someone had just said.
     */
    if (/^[“"'‘]/.test(trimmed)) return;
    if (/^\(/.test(trimmed)) return;

    const caps = letters === letters.toUpperCase();
    if (!caps && !isTitleCase(trimmed)) return;

    // A heading is never a full sentence.
    if (trimmed.split(/\s+/).length > 9) return;
    marks.push(index);
  });

  if (marks.length < 4) return [];

  return marks.map((mark, index) => ({
    title: lines[mark],
    body: lines.slice(mark + 1, marks[index + 1] ?? lines.length).join("\n"),
  }));
}

function splitByRomanNumerals(body) {
  const lines = body.split("\n");
  const marks = [];
  lines.forEach((line, index) => {
    if (isRoman(line)) marks.push(index);
  });
  if (marks.length < 8) return [];

  // The numerals have to behave like a sequence. A book that merely mentions
  // "IV." in a chapter heading produces a handful of scattered marks whose
  // last "piece" swallows the rest of the volume.
  const values = marks.map((mark) => romanValue(lines[mark].trim().replace(/\.$/, "")));
  // A restart counts: a three-series collection numbers each series from I.
  const sequential = values.filter(
    (value, index) => index === 0 || value === values[index - 1] + 1 || value === 1
  ).length;
  if (values[0] !== 1 || sequential < marks.length * 0.8) return [];

  return marks.map((mark, index) => {
    const slice = lines.slice(mark + 1, marks[index + 1] ?? lines.length);
    // An ALL-CAPS line right after the numeral is the editors' title.
    let title = "";
    const firstContent = slice.findIndex((line) => line.trim());
    if (firstContent >= 0 && looksLikeHeading(slice[firstContent])) {
      title = slice[firstContent];
      slice.splice(firstContent, 1);
    }
    return { title, body: slice.join("\n"), ordinal: lines[mark].trim().replace(/\.$/, "") };
  });
}

// ------------------------------------------------------------------- assembly

function buildPiece(raw, source, fallbackTitle, ordinal) {
  let body = trimTrailingFurniture(stripEditionMarks(raw).trim()).trim();
  if (!body) return null;

  /**
   * A poetry collection is declared, not guessed. Whitman's free verse runs to
   * lines as long as a wrapped paragraph, so no measure of the text can tell
   * his line breaks from a printer's - and unwrapping him turns the poem into
   * a block of prose. We know which books are poetry; saying so is cheaper and
   * more honest than a heuristic that cannot work.
   */
  const shape = source.kind === "poetry" ? "verse" : classifyShape(body);
  body = shape === "verse" ? tidyVerse(body) : unwrapProse(body);
  if (!body) return null;

  // A sequence the poet numbered rather than named - the sonnets - is cited by
  // its number. Everything else falls back to its first line, which is how an
  // untitled poem is cited.
  const numbered = source.ordinalTitle && ordinal ? `${source.ordinalTitle} ${romanValue(ordinal)}` : "";
  const title = normalizeTitle(fallbackTitle || "") || numbered || titleFromFirstLine(body);
  if (!title) return null;

  return { title, body, shape };
}

/**
 * Sections that are not literature by the author, and must never become boks.
 *
 * This list is a copyright control, not housekeeping. A Gutenberg edition can
 * carry a modern editorial introduction whose own author is still in
 * copyright - Winesburg, Ohio ships with one by Irving Howe, who died in 1993.
 * The volume being public domain says nothing about an essay bound into it
 * seventy years later.
 */
const notLiterature =
  /^(?:the\s+)?(?:introduction|introductory\s+note|preface|foreword|afterword|prologue\s+by|contents|index|notes?|editor'?s?\s+note|publisher'?s?\s+note|transcriber'?s?\s+note|author'?s?\s+note|dedication|acknowledge?ments?|appendix|glossary|bibliography|biography|biographical\s+note|chronology|errata|advertisement|title\s+page|frontispiece|illustrations?|list\s+of\s+illustrations|copyright|colophon|sonnets|poems|stories|tales)$/i;

function pieceProblem(piece, source) {
  const characters = piece.body.length;
  const words = piece.body.split(/\s+/).filter(Boolean).length;

  if (characters < (source.minCharacters ?? 500)) return `too short (${characters} chars)`;
  if (characters > 19_500) return `too long for fifteen minutes (${characters} chars)`;
  if (piece.shape === "verse" && piece.body.split("\n").filter((l) => l.trim()).length < 4) {
    return "verse with fewer than four lines";
  }
  if (piece.shape === "prose" && words < 120) return `prose with only ${words} words`;
  // A piece that still carries the book's front matter was mis-split.
  if (/project gutenberg/i.test(piece.body)) return "still contains Gutenberg boilerplate";
  if (/^\s*contents\s*$/im.test(piece.body)) return "still contains a table of contents";
  // The volume's own title page is not one of its pieces.
  const asTitle = piece.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (asTitle && source.title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(asTitle)) {
    return "looks like the volume's title page";
  }
  if (asTitle === source.author.toLowerCase().replace(/[^a-z0-9]/g, "")) return "is the author credit";
  if (notLiterature.test(piece.title.trim())) return `editorial section, not literature by the author`;

  // A right-aligned number is a page reference: this is a slice of an index,
  // never a line of literature.
  const pageNumbers = piece.body.split("\n").filter((line) => /\S\s{3,}\d{1,4}\s*$/.test(line)).length;
  if (pageNumbers >= 1) return `looks like a slice of an index (${pageNumbers} page reference)`;

  // A copyright page carries dates and assignees, and belongs to the edition.
  if (/copyright\s+(?:©\s*)?1[89]\d\d/i.test(piece.body)) return "contains a copyright page";

  // A credit line for someone other than the author is a warning that this is
  // an editorial section the title did not name.
  const credit = piece.body.match(/^\s*by\s+([A-Z][^\n]{2,40})$/m);
  if (credit && !credit[1].toLowerCase().includes(source.author.split(" ").pop().toLowerCase())) {
    return `credited to ${credit[1].trim()}, not to ${source.author}`;
  }
  return null;
}

async function buildSource(source, cacheDir, limitPerSource) {
  const raw = await readFile(path.join(cacheDir, `${source.id}.txt`), "utf8");
  const text = stripGutenbergWrapper(raw);

  // Front matter - preface, dedication, the table itself - sits before the
  // first piece. The table's end is the reliable marker; `bodyStartsAt`
  // overrides it for a book that has no table.
  const contents = findContents(text);
  const startMatch = source.bodyStartsAt ? text.match(new RegExp(source.bodyStartsAt, "m")) : null;
  const bodyStart = startMatch ? startMatch.index : contents.endIndex;
  const body = text.slice(bodyStart);

  // Tried in order of how much the book tells us about itself: its own table
  // of contents, then its headings, then bare numerals.
  const strategies = source.strategy ? [source.strategy] : ["contents", "headings", "roman"];
  let raws = [];
  let strategy = "none";

  for (const candidate of strategies) {
    const attempt =
      candidate === "contents"
        ? splitByContents(body, contents.titles.filter((title) => !(source.dropTitles ?? []).includes(title)))
        : candidate === "headings"
          ? splitByHeadings(body)
          : splitByRomanNumerals(body);

    if (attempt.length >= 4) {
      raws = attempt;
      strategy = candidate;
      break;
    }
  }

  const pieces = [];
  const problems = [];

  raws.forEach((candidate) => {
    const piece = buildPiece(candidate.body, source, candidate.title, candidate.ordinal);
    if (!piece) {
      problems.push({ title: candidate.title || candidate.ordinal || "(untitled)", problem: "empty after cleaning" });
      return;
    }
    const problem = pieceProblem(piece, source);
    if (problem) {
      problems.push({ title: piece.title, problem });
      return;
    }
    pieces.push(piece);
  });

  const kept = limitPerSource > 0 ? pieces.slice(0, limitPerSource) : pieces;
  return { strategy, kept, problems, considered: raws.length };
}

function frontMatter(fields) {
  return ["---", ...fields.filter(Boolean), "---"].join("\n");
}

function slug(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const here = path.dirname(new URL(import.meta.url).pathname);
  const sources = JSON.parse(await readFile(path.join(here, "public-domain-sources.json"), "utf8"));
  const cacheDir = path.resolve(process.cwd(), args.cache);
  const outDir = path.resolve(process.cwd(), args.out);

  await mkdir(outDir, { recursive: true });
  for (const name of await readdir(outDir)) {
    if (name.endsWith(".md")) await rm(path.join(outDir, name));
  }

  const selected = args.only
    ? sources.filter((source) => String(source.id) === args.only)
    : sources;

  let written = 0;
  const usedKeys = new Set();
  const usedTitles = new Set();
  const report = [];

  for (const source of selected) {
    let result;
    try {
      result = await buildSource(source, cacheDir, args.limitPerSource || source.take || 0);
    } catch (error) {
      report.push({ source: source.id, error: error.message });
      continue;
    }

    let sourceWritten = 0;
    for (const piece of result.kept) {
      // Anthologies overlap: the same story appears in two collections. The
      // first one in wins, so a reader never meets the same piece twice.
      const titleKey = `${source.author}|${piece.title.toLowerCase()}`;
      if (usedTitles.has(titleKey)) continue;
      usedTitles.add(titleKey);

      let key = `pg${source.id}-${slug(piece.title)}`;
      if (usedKeys.has(key)) key = `${key}-${sourceWritten + 1}`;
      usedKeys.add(key);

      const file = frontMatter([
        `id: ${key}`,
        `title: ${piece.title.replace(/\n/g, " ")}`,
        `author: ${source.author}`,
        source.hook ? `hook: ${source.hook}` : null,
        // The volume's publication date. Without it every imported piece
        // shares one timestamp, which leaves the ranker's freshness signal
        // with nothing to read and makes "newest" arbitrary.
        source.published ? `date: ${source.published}` : null,
        `rights: ${source.rights}`,
      ]);

      await writeFile(path.join(outDir, `${key}.md`), `${file}\n${piece.body}\n`, "utf8");
      sourceWritten += 1;
      written += 1;
    }

    report.push({
      source: source.id,
      author: source.author,
      title: source.title,
      strategy: result.strategy,
      considered: result.considered,
      kept: sourceWritten,
      dropped: result.problems.length,
      problems: result.problems.slice(0, 4),
    });
  }

  console.log(`\nWrote ${written} boks to ${path.relative(process.cwd(), outDir)}/\n`);
  report.forEach((entry) => {
    if (entry.error) {
      console.log(`  ${entry.source}  ERROR  ${entry.error}`);
      return;
    }
    console.log(
      `  ${String(entry.source).padStart(6)}  ${String(entry.kept).padStart(3)} kept  ` +
        `${String(entry.dropped).padStart(3)} dropped  ${entry.strategy.padEnd(8)}  ${entry.author} — ${entry.title}`
    );
    entry.problems.forEach((problem) => console.log(`            · ${problem.title}: ${problem.problem}`));
  });
}

if (process.argv[1] && process.argv[1].endsWith("build-public-domain-corpus.mjs")) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
