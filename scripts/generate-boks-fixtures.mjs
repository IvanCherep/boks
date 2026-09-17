#!/usr/bin/env node
/**
 * Writes a catalogue of placeholder boks in the import format, so the platform
 * can be filled with a few hundred pieces before any real ones are ready.
 *
 * Deterministic: the same `--seed` produces the same catalogue, ids included.
 * That matters because the import deduplicates on the id - regenerating and
 * re-importing is a no-op rather than a second copy.
 *
 * What this is NOT: a substitute for content. The prose is assembled from a
 * word list, so anything that measures what a piece is about - `tasteMatch`,
 * quality priors, the divergence gate's read of the catalogue - is measuring
 * noise. Use it to exercise the feed, paging, follows and the admin console.
 * Judge the recommender on real boks.
 *
 *   node scripts/generate-boks-fixtures.mjs --count 500 --out content/fixtures
 */

import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { count: 500, out: "content/fixtures", prefix: "fixture-", seed: 20260916, clean: false };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--count") args.count = Number(value);
    else if (flag === "--out") args.out = value;
    else if (flag === "--prefix") args.prefix = value;
    else if (flag === "--seed") args.seed = Number(value);
    else if (flag === "--clean") {
      args.clean = true;
      continue;
    } else continue;
    index += 1;
  }

  if (!Number.isFinite(args.count) || args.count < 1 || args.count > 5000) {
    throw new Error("--count has to be between 1 and 5000.");
  }
  if (!args.prefix || !/^[a-z0-9][a-z0-9-]*$/.test(args.prefix)) {
    throw new Error("--prefix has to be lowercase letters, digits and dashes, so it can be used to remove the batch.");
  }

  return args;
}

/** mulberry32: small, seeded, and good enough for arranging words. */
function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const nouns = "lamp ferry harbour kitchen letter orchard platform signal window archive bridge ledger garden compass tunnel balcony postcard rooftop corridor fountain timetable shoreline lantern doorway".split(" ");
const adjectives = "quiet borrowed unfinished narrow patient distant folded early stubborn ordinary honest brief crowded southern wooden reluctant".split(" ");
const verbs = "waited moved listened counted remembered forgot arrived returned noticed closed opened kept lost carried repeated answered".split(" ");
const connectives = "and then, after that, meanwhile, by evening, in the morning, later, even so, for a while,".split(", ");
const people = "Mara Abel Ines Tomas Ruth Ilya Sena Odile Petra Nikolai Hana Ovid Lise Aurelio Bett Cosmin".split(" ");
const surnames = "Qin Mensah Voss Otero Kale Cross Grey North Sol Vale Rook Innes Weatherly Okonjo Lindqvist Baptiste".split(" ");
const titleShapes = [
  (r, pick) => `The ${pick(adjectives)} ${pick(nouns)}`,
  (r, pick) => `${pick(nouns, true)} at ${1 + Math.floor(r() * 11)} O'Clock`,
  (r, pick) => `What the ${pick(nouns)} ${pick(verbs)}`,
  (r, pick) => `${pick(adjectives, true)} ${pick(nouns, true)}s`,
  (r, pick) => `Notes on a ${pick(adjectives)} ${pick(nouns)}`,
];

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function makeGenerator(seed) {
  const random = randomFrom(seed);
  const pick = (list, caps = false) => {
    const word = list[Math.floor(random() * list.length)];
    return caps ? capitalize(word) : word;
  };

  function sentence() {
    const parts = [
      `The ${pick(adjectives)} ${pick(nouns)} ${pick(verbs)}`,
      random() < 0.5 ? `past the ${pick(nouns)}` : `for ${2 + Math.floor(random() * 30)} ${pick(nouns)}s`,
    ];
    if (random() < 0.45) parts.push(`${pick(connectives)} nobody ${pick(verbs)}`);
    return `${capitalize(parts.join(" "))}.`;
  }

  function paragraph(sentences) {
    return Array.from({ length: sentences }, sentence).join(" ");
  }

  function verse(lines) {
    return Array.from({ length: lines }, () => `${pick(adjectives, true)} ${pick(nouns)}, ${pick(verbs)}`).join("\n");
  }

  /** Paragraphs until the piece is about `targetWords` long. */
  function prose(targetWords) {
    const paragraphs = [];
    let words = 0;
    while (words < targetWords) {
      const block = paragraph(2 + Math.floor(random() * 6));
      paragraphs.push(block);
      words += block.split(/\s+/).length;
    }
    return paragraphs.join("\n\n");
  }

  return { random, pick, sentence, paragraph, verse, prose };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generator = makeGenerator(args.seed);
  const { random, pick, paragraph, verse, prose } = generator;
  const outDir = path.resolve(process.cwd(), args.out);

  await mkdir(outDir, { recursive: true });

  if (args.clean) {
    const existing = await readdir(outDir);
    await Promise.all(
      existing
        .filter((name) => name.startsWith(args.prefix) && name.endsWith(".md"))
        .map((name) => rm(path.join(outDir, name)))
    );
  }

  const width = String(args.count).length;
  let verses = 0;
  let bylines = 0;
  let characters = 0;

  for (let index = 1; index <= args.count; index += 1) {
    const id = `${args.prefix}${String(index).padStart(Math.max(4, width), "0")}`;
    const title = titleShapes[Math.floor(random() * titleShapes.length)](random, pick);
    const isVerse = random() < 0.12;

    // Spread over the whole allowed range, so paging, the reading clock and
    // the fifteen-minute promise all see short and long pieces. Reading time
    // is words / 238, so the tiers land at roughly 1-3, 3-7 and 7-13 minutes.
    const tier = random();
    const targetWords = isVerse
      ? 60 + Math.floor(random() * 220)
      : tier < 0.55
        ? 200 + Math.floor(random() * 500)
        : tier < 0.87
          ? 700 + Math.floor(random() * 900)
          : 1600 + Math.floor(random() * 1500);

    const body = isVerse ? verse(Math.ceil(targetWords / 5)) : prose(targetWords);

    // A byline on most, none on the rest: an absent byline has to be exercised
    // too, because then the publisher's @handle is the whole attribution.
    const hasByline = random() < 0.85;
    const byline = hasByline ? `${pick(people, true)} ${pick(surnames, true)}` : "";
    if (hasByline) bylines += 1;
    if (isVerse) verses += 1;
    characters += body.length;

    // Dates spread over two years so freshness and recency have a gradient.
    const date = new Date(Date.UTC(2024, 0, 1) + Math.floor(random() * 730) * 86400000)
      .toISOString()
      .slice(0, 10);

    const frontMatter = [
      "---",
      `id: ${id}`,
      `title: ${title}`,
      byline ? `author: ${byline}` : null,
      `hook: ${paragraph(1)}`,
      `date: ${date}`,
      // Where the right to publish comes from. Admin-only once imported, and
      // the honest answer for generated prose is that it is generated.
      "rights: Generated placeholder text, no rights attached.",
      "---",
    ]
      .filter(Boolean)
      .join("\n");

    await writeFile(path.join(outDir, `${id}.md`), `${frontMatter}\n${body}\n`, "utf8");
  }

  console.log(
    [
      `Wrote ${args.count} boks to ${path.relative(process.cwd(), outDir)}/`,
      `  ids          ${args.prefix}${"0".repeat(Math.max(4, width) - 1)}1 … (remove the batch with prefix "${args.prefix}")`,
      `  with a byline ${bylines}`,
      `  verse         ${verses}`,
      `  average size  ${Math.round(characters / args.count)} characters`,
      "",
      "Load them in the admin console: Catalogue -> Choose a folder.",
      "The prose is assembled from a word list, so treat anything that measures",
      "what a piece is about as noise until real boks are in.",
    ].join("\n")
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
