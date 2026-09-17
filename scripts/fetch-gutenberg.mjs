#!/usr/bin/env node
/**
 * Downloads Project Gutenberg plain-text books by id, once, with a delay
 * between requests, and reports what each file actually is.
 *
 * Reading the Title/Author header back is the point: a guessed id silently
 * gives you the wrong book, and a corpus built on that is worse than no
 * corpus.
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "gutenberg");
const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);

const agent = "boks-corpus-builder/1.0 (one-off public-domain corpus for a reading app)";

async function cached(id) {
  const file = path.join(dir, `${id}.txt`);
  try {
    await access(file);
    return file;
  } catch {
    return null;
  }
}

async function fetchBook(id) {
  const file = path.join(dir, `${id}.txt`);
  const urls = [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`,
  ];

  for (const url of urls) {
    const response = await fetch(url, { headers: { "User-Agent": agent } });
    if (!response.ok) continue;
    const text = await response.text();
    if (text.length < 2000) continue;
    await writeFile(file, text, "utf8");
    return file;
  }
  return null;
}

function describe(text) {
  const field = (name) => text.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
  return {
    title: field("Title"),
    author: field("Author"),
    translator: field("Translator"),
    language: field("Language"),
    characters: text.length,
  };
}

await mkdir(dir, { recursive: true });

for (const id of ids) {
  let file = await cached(id);
  const wasCached = Boolean(file);
  if (!file) {
    try {
      file = await fetchBook(id);
    } catch (error) {
      console.log(`${id}\tFETCH FAILED\t${error.message}`);
      continue;
    }
    // Polite: one book every couple of seconds, and never twice.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!file) {
    console.log(`${id}\tNOT FOUND`);
    continue;
  }

  const info = describe(await readFile(file, "utf8"));
  console.log(
    [
      id,
      wasCached ? "cached" : "fetched",
      info.language,
      `${Math.round(info.characters / 1000)}k`,
      info.author || "(no author)",
      info.translator ? `tr. ${info.translator}` : "",
      info.title,
    ].join("\t")
  );
}
