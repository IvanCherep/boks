#!/usr/bin/env node
// Embeds every bok that has no current vector, with the multilingual model.
//
//   node scripts/embed-catalogue.mjs            # embed what is missing
//   node scripts/embed-catalogue.mjs --all      # re-embed everything
//
// **Why this exists next to the `embed` Edge Function.** The Edge Function uses
// Supabase's built-in `gte-small`, which is an English model, and this
// catalogue is three quarters Russian. That is not a guess - it was measured on
// this corpus, 4000 random same-language pairs:
//
//   gte-small, Russian: median similarity 0.894, sd 0.020, and pairs by the
//   same author averaged 0.895 against 0.893 for pairs by different authors.
//   A 0.002 gap inside a 0.020 spread is no signal at all; the model puts every
//   Russian text in one tight blob, so "nearest neighbour" was a coin toss
//   dressed up as meaning.
//
//   multilingual-e5-small, same corpus: same-author 0.882 against 0.873, a
//   0.0085 gap - four times wider - and the neighbours read correctly by eye:
//   a pine-forest lyric pulls Fet's and Nikitin's landscape verse, a
//   Mayakovsky poem pulls two more Mayakovsky poems, a satirical sketch pulls
//   Averchenko and Doroshevich.
//
// Same 384 dimensions, so nothing about the column, the index or the ranker
// changes. The model runs here, on CPU, through ONNX - about 12 boks a second,
// so a 400-piece catalogue takes half a minute.
//
// **One model per column.** Vectors from two models are not comparable, and a
// mixed column would silently rank nonsense, so `set_bok_embedding` refuses any
// model other than `boks_embedding_model()`. Changing models means re-embedding
// everything with `--all` in one pass.
//
// Reads and writes through the Supabase CLI (`supabase db query`), so it needs
// no service-role key: the CLI's own credentials are the only ones involved.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const model = "Xenova/multilingual-e5-small";
/** What the database will accept, and what the vectors in it came from. */
const modelName = "multilingual-e5-small";
const dimensions = 384;
/** e5 was trained with this prefix; leaving it off costs accuracy. */
const prefix = "query: ";
/** The model reads 512 tokens. Past that, more text is more time for nothing. */
const maxInputCharacters = 1500;
/** One statement per bok, this many statements per file sent to the database. */
const writeBatch = 50;

function sql(query) {
  const out = execFileSync(
    "npx",
    ["supabase", "db", "query", "--linked", "--output", "json", query],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  const start = out.indexOf("[");
  const end = out.lastIndexOf("]");
  return start >= 0 && end > start ? JSON.parse(out.slice(start, end + 1)) : [];
}

function runSqlFile(file) {
  execFileSync("npx", ["supabase", "db", "query", "--linked", "--file", file], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

const all = process.argv.includes("--all");
const pending = sql(`
  select id::text as id, title, text
  from public.reels
  where status in ('published', 'pending_review')
    and coalesce(btrim(text), '') <> ''
    and ${all ? "true" : `(embedding is null or embedding_model is distinct from '${modelName}')`}
  order by created_at
`);

if (!pending.length) {
  console.log("nothing to embed");
  process.exit(0);
}

console.log(`embedding ${pending.length} boks with ${modelName}`);
const { pipeline } = await import("@huggingface/transformers");
const extractor = await pipeline("feature-extraction", model);

const directory = mkdtempSync(path.join(tmpdir(), "boks-embed-"));
const started = Date.now();
let written = 0;
let statements = [];

async function flush() {
  if (!statements.length) return;
  const file = path.join(directory, `batch-${written}.sql`);
  writeFileSync(file, `begin;\n${statements.join("\n")}\ncommit;\n`);
  runSqlFile(file);
  written += statements.length;
  statements = [];
  const rate = written / ((Date.now() - started) / 1000);
  console.log(`  ${written}/${pending.length} (${rate.toFixed(1)}/s)`);
}

for (const bok of pending) {
  const input = `${prefix}${bok.title}\n\n${String(bok.text).replace(/\s+/g, " ").slice(0, maxInputCharacters)}`;
  const output = await extractor(input, { pooling: "mean", normalize: true });
  const vector = Array.from(output.data);
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`${bok.id}: the model returned ${vector.length} values`);
  }
  // Written as a literal rather than through the RPC: one statement per bok in
  // a batched transaction is an order of magnitude fewer round trips, and the
  // dimension check above is the same one the RPC performs.
  statements.push(
    `update public.reels set embedding = '[${vector.map((value) => value.toFixed(6)).join(",")}]'::extensions.vector(${dimensions}), embedding_model = '${modelName}', embedded_at = now() where id = '${bok.id}';`
  );
  if (statements.length >= writeBatch) await flush();
}
await flush();

const [coverage] = sql("select public.boks_embedding_coverage() as coverage");
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(coverage?.coverage ?? coverage));
