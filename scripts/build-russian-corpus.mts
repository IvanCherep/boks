#!/usr/bin/env -S npx tsx
/**
 * Turns the Wikisource cache into a reviewable corpus of Russian boks.
 *
 *   node scripts/fetch-wikisource.mjs                        # once
 *   npx tsx scripts/build-russian-corpus.mts --out work/ru   # as often as needed
 *
 * `--out` is a directory of Markdown files on purpose: the corpus is read by a
 * person before anything reaches production. That is how every bug in the
 * English build was found, and how four bugs in this one were.
 *
 * The conversion itself lives in `lib/boks/import/wikitext.ts`, where it has
 * tests. This script is the part that cannot be unit tested: which pages to
 * consider, how many to take from each author, and what to record about why
 * each one is publishable.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { maxBokCharacters } from "../lib/boks/contracts";
import { rejectPiece, wikitextToPiece } from "../lib/boks/import/wikitext";

type Source = {
  author: string;
  categories: string[];
  died: number;
  kind: "verse" | "prose";
  take: number;
  rights: string;
};

type CachedPage = {
  title: string;
  missing?: boolean;
  wikitext: string;
  categories: string[];
  author: string;
  viaHub?: boolean;
};

/**
 * The US term comes from publication, not from death, so it is checked per
 * piece. Wikisource records the year as a category, which makes this a lookup
 * rather than a promise.
 */
const publicDomainBefore = 1929;

/** Shortest piece worth serving. Below this it is a fragment, not a work. */
const minCharacters = 220;

const root = path.resolve(import.meta.dirname, "..");
const cacheDir = path.join(root, "scripts", "wikisource");

function arg(name: string, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

/**
 * A transliterated slug, because the import key becomes part of a URL and of
 * every log line about this piece. Cyrillic survives both, but unreadably.
 */
const translit: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

function slug(value: string) {
  return [...value.toLowerCase()]
    .map((char) => translit[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** The work's own title, with Wikisource's disambiguation removed. */
function readableTitle(pageTitle: string) {
  return pageTitle
    .replace(/\/.*$/u, "")
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/…$/u, "…")
    .trim();
}

/** The publication year, from the category Wikisource files the page under. */
function publicationYear(categories: readonly string[]) {
  const years = categories
    .map((category) => category.match(/^(?:Литература|Поэзия|Проза)\s+(\d{4})\s+года$/u)?.[1])
    .filter(Boolean)
    .map(Number);
  return years.length ? Math.min(...years) : null;
}

async function main() {
  const outDir = path.resolve(arg("out", "work/russian-corpus"));
  const sources: Source[] = JSON.parse(
    await readFile(path.join(root, "scripts", "wikisource-sources.json"), "utf8")
  );

  const files = (await readdir(cacheDir)).filter((name) => name.endsWith(".json"));
  const pages: CachedPage[] = [];
  for (const file of files) {
    pages.push(JSON.parse(await readFile(path.join(cacheDir, file), "utf8")));
  }
  console.log(`${pages.length} cached pages, ${sources.length} authors\n`);

  await mkdir(outDir, { recursive: true });

  const rejections = new Map<string, number>();
  const note = (reason: string) => rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
  const usedKeys = new Set<string>();
  const firstLines: { key: string; first: string; rest: number }[] = [];
  const jsonl: string[] = [];
  const report: string[] = [];
  let written = 0;
  const lengths: number[] = [];
  const shapes = { verse: 0, prose: 0 };

  for (const source of sources) {
    const mine = pages.filter((page) => page.author === source.author);
    // A work reached through an edition list is the same work as its hub, and
    // the hub itself never carries text. Prefer the printing.
    const hubTitles = new Set(
      mine.filter((page) => page.viaHub).map((page) => page.title.replace(/\/[^/]*$/u, ""))
    );

    const kept: { title: string; text: string; year: number; shape: string }[] = [];
    const seenTitles = new Set<string>();

    for (const page of mine) {
      if (kept.length >= source.take) break;
      if (page.missing || !page.wikitext.trim()) {
        note("page does not exist");
        continue;
      }
      if (!page.viaHub && hubTitles.has(page.title)) {
        note("edition list, superseded by its printing");
        continue;
      }

      const year = publicationYear(page.categories);
      if (year === null) {
        // No year means no way to show the US term is expired. The English
        // corpus took the volume's date on trust; here it is per piece, and a
        // piece that cannot prove it is not published.
        note("no publication year on the page");
        continue;
      }
      if (year >= publicDomainBefore) {
        note(`published ${year}, not yet public domain in the US`);
        continue;
      }

      const piece = wikitextToPiece(page.wikitext, page.title);
      if (!piece) {
        note("no text on the page");
        continue;
      }

      const bad = rejectPiece(piece, { minCharacters, maxCharacters: maxBokCharacters });
      if (bad) {
        note(bad.reason);
        continue;
      }
      if (piece.shape !== source.kind) {
        // The source list says which shape this author was chosen for. A
        // "poem" that converted as prose means the verse container was missed,
        // and publishing it would reflow the poem into a paragraph.
        note(`converted as ${piece.shape}, expected ${source.kind}`);
        continue;
      }

      const title = readableTitle(page.title);
      if (!title || title.length > 120) {
        note("no usable title");
        continue;
      }
      const titleKey = title.toLowerCase();
      if (seenTitles.has(titleKey)) {
        note("same title twice for one author");
        continue;
      }
      seenTitles.add(titleKey);

      kept.push({ title, text: piece.text, year, shape: piece.shape });
    }

    for (const piece of kept) {
      let key = `ws-${slug(source.author)}-${slug(piece.title)}`;
      if (usedKeys.has(key)) key = `${key}-${written}`;
      usedKeys.add(key);

      const frontMatter = [
        "---",
        `id: ${key}`,
        `title: ${piece.title.replace(/\n/g, " ")}`,
        `author: ${source.author}`,
        // The real publication year, per piece. Without a spread of dates the
        // ranker's freshness signal has nothing to read and "newest" is
        // arbitrary - which is what one shared timestamp did to the English
        // import.
        `date: ${piece.year}-01-01`,
        `rights: ${source.rights}, опубликовано ${piece.year}`,
        "---",
      ].join("\n");

      await writeFile(path.join(outDir, `${key}.md`), `${frontMatter}\n\n${piece.text}\n`, "utf8");
      // The same rows as one file, because the console reads a whole catalogue
      // through a single file picker and 449 separate files do not go through
      // one.
      jsonl.push(
        JSON.stringify({
          importKey: key,
          title: piece.title.replace(/\n/g, " "),
          authorName: source.author,
          text: piece.text,
          createdAt: `${piece.year}-01-01`,
          rightsNote: `${source.rights}, опубликовано ${piece.year}`,
        })
      );
      const [firstLine, ...body] = piece.text.split("\n");
      firstLines.push({ key, first: firstLine, rest: body.join("\n").length });
      written += 1;
      lengths.push(piece.text.length);
      shapes[piece.shape as "verse" | "prose"] += 1;
    }

    report.push(
      `  ${String(kept.length).padStart(3)}/${String(source.take).padEnd(3)} ${source.kind.padEnd(5)}  ` +
        `${source.author} (ум. ${source.died}), из ${mine.length} страниц`
    );
  }

  const jsonlPath = path.join(outDir, "russian-corpus.jsonl");
  await writeFile(jsonlPath, jsonl.join("\n") + "\n", "utf8");

  lengths.sort((a, b) => a - b);

  /**
   * Lines that might be a heading rather than literature.
   *
   * Both remaining bugs in this build were a heading that reached the text:
   * Krylov's bold `XVII. Мартышка и очки` and Tolstoy's shouted `ПОСЛЕ БАЛА`.
   * Neither broke a rule, and both were found by reading random files, which
   * is luck. This turns the luck into a list: a short opening line with no
   * terminal punctuation above a much longer body. Most entries are innocent -
   * a poem's first line often looks exactly like that - so it is a reading
   * list, not a rejection.
   */
  const suspicious = firstLines
    .filter(({ first, rest }) => first.length < 60 && !/[.…!?:,;—]$/u.test(first) && rest > 600)
    .slice(0, 20);

  console.log(
    `Wrote ${written} boks to ${path.relative(process.cwd(), outDir)}/ ` +
      `and all of them to ${path.relative(process.cwd(), jsonlPath)}\n`
  );
  console.log(report.join("\n"));
  console.log(
    `\n  shape: ${shapes.verse} verse, ${shapes.prose} prose` +
      `\n  length: ${lengths[0]}–${lengths[lengths.length - 1]} characters, median ${lengths[Math.floor(lengths.length / 2)]}`
  );
  if (suspicious.length) {
    console.log(`\nopening lines worth reading (${suspicious.length}):`);
    for (const { key, first } of suspicious) console.log(`  ${first.slice(0, 56).padEnd(58)} ${key}`);
  }

  console.log("\nrejected:");
  for (const [reason, count] of [...rejections].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${reason}`);
  }
}

await main();
