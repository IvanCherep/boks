/**
 * Does every stanza fit its picture? (`lib/boks/poetry/stanza-fit.ts`)
 *
 *   npm run check:poems                      every poem in poems.ts and the sandbox
 *   npm run check:poems -- <file|url|token>  one manifest: a file on disk (a
 *                                            scratch folder before upload), a
 *                                            URL, or a link-only token
 *
 * Poems under public/poetry/ are read from disk. A living author's poem lives
 * in link-only storage, not in this repository, so it is fetched from
 * BOKS_POEMS_BASE (https://tryboks.com by default; http://localhost:5173
 * reads the local stack). That is the hole the shipped-poems test cannot see
 * into, and the one twenty-one stanzas fell through (2026-11-14).
 *
 * Exits 1 on any stanza that would run under the player on any of the phones
 * in `fitFrames`. Run before uploading a Series and before releasing one; the
 * release runs it too (`deploy/release.sh`).
 */
import { existsSync, readFileSync } from "node:fs";
import { sandboxPoems } from "@/components/boks/poetry/poems";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";
import { stanzaFitProblems } from "@/lib/boks/poetry/stanza-fit";

const base = (process.env.BOKS_POEMS_BASE ?? "https://tryboks.com").replace(/\/+$/, "");

async function load(source: string): Promise<PoemManifest> {
  if (existsSync(source)) return JSON.parse(readFileSync(source, "utf8"));
  if (source.startsWith("/poetry/") && existsSync(`public${source}`)) return JSON.parse(readFileSync(`public${source}`, "utf8"));
  const url = /^[A-Za-z0-9_-]{22,64}$/.test(source)
    ? `${base}/l/${source}/f/manifest.json`
    : source.startsWith("/")
      ? `${base}${source}`
      : source;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as PoemManifest;
}

const sources = process.argv.slice(2).length ? process.argv.slice(2) : [...new Set(sandboxPoems)];
let failed = 0;
let unread = 0;
for (const source of sources) {
  let manifest: PoemManifest;
  try {
    manifest = await load(source);
  } catch (error) {
    unread += 1;
    console.error(`could not read ${source}: ${(error as Error).message}`);
    continue;
  }
  const problems = stanzaFitProblems(manifest);
  if (problems.length === 0) continue;
  failed += 1;
  console.error(`\n✗ ${manifest.title} — ${manifest.author} (${source})`);
  for (const problem of problems) console.error(`  ${problem}`);
}
const ok = sources.length - failed - unread;
console.log(`\ncheck:poems: ${ok} of ${sources.length} poems fit every phone${failed ? `, ${failed} do not` : ""}${unread ? `, ${unread} could not be read` : ""}.`);
process.exit(failed || unread ? 1 : 0);
