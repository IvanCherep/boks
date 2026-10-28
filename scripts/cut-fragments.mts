#!/usr/bin/env -S npx tsx
/**
 * Cuts Б3 fragments out of long works and writes the JSON array Studio →
 * Studies → Б3 imports: the algorithm's first fragments of every work, and a
 * same-length window for each, shuffled together. See `docs/fragment-cutter.md`.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/cut-fragments.mts books/ --out b3.json
 *   npx tsx --tsconfig tsconfig.json scripts/cut-fragments.mts book.txt \
 *     --title "Село Степанчиково" --author "Ф. М. Достоевский" --language ru --out b3.json
 *
 * Input: `.txt` files, or directories of them, in UTF-8. Each work's title,
 * author and language come from a sidecar `<name>.json` beside it
 * (`{ "title": …, "author": …, "language": … }`), then from `--title`,
 * `--author`, `--language` when one file is given, then from the file name
 * and the share of Cyrillic letters. The text itself is never edited, so the
 * file should hold the work and nothing else: strip a Gutenberg header and
 * licence by hand before running.
 *
 * Options: `--per-work 5`, `--seed 1`, `--out file.json` (default: stdout),
 * `--llm` to ask Claude about each candidate (needs `ANTHROPIC_API_KEY`;
 * `--model`, `--pool` to change the model and how many candidates it sees).
 * A report per work goes to stderr, and as JSON to `<out>.report.json`: it
 * says whether the order was model-checked, which the import rows do not.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  cutCandidates,
  defaultCheckModel,
  finishWork,
  modelCheckRequest,
  readModelVerdict,
  shuffledImportRows,
  type CutWork,
  type FragmentWork,
  type ModelVerdict,
  type WorkResult,
} from "../lib/boks/fragments";

/** `import_boks_study_fragments` refuses a larger array; a bigger run is imported in batches. */
const importRowLimit = 500;

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "per-work": { type: "string", default: "5" },
    seed: { type: "string", default: "1" },
    out: { type: "string" },
    llm: { type: "boolean", default: false },
    model: { type: "string", default: defaultCheckModel },
    pool: { type: "string" },
    title: { type: "string" },
    author: { type: "string" },
    language: { type: "string" },
  },
});

const perWork = positiveInteger(options["per-work"], "--per-work");
const seed = positiveInteger(options.seed, "--seed");
const apiKey = process.env.ANTHROPIC_API_KEY;
const useModel = options.llm && Boolean(apiKey);
if (options.llm && !apiKey) console.error("--llm given but ANTHROPIC_API_KEY is not set: running offline, not model-checked.");
// With a check the model needs candidates to choose between; without one only the first `perWork` are used.
const poolSize = options.pool ? positiveInteger(options.pool, "--pool") : useModel ? perWork * 3 : perWork;

if (positionals.length === 0) {
  console.error("Usage: cut-fragments.mts <file.txt | directory>... [--out b3.json] [--per-work 5] [--seed 1] [--llm]");
  process.exit(2);
}

const files = (await Promise.all(positionals.map(textFiles))).flat().sort();
if (files.length === 0) {
  console.error("No .txt files found.");
  process.exit(2);
}
if (files.length > 1 && (options.title || options.author)) {
  console.error("--title and --author apply to a single file; use a sidecar .json per work instead.");
  process.exit(2);
}

const results: WorkResult[] = [];
for (const file of files) {
  const work = await readWork(file);
  const cut = cutCandidates(work, { perWork, poolSize });
  const verdicts = useModel ? await checkWithModel(cut) : undefined;
  const result = finishWork(cut, { perWork, seed }, verdicts);
  results.push(result);
  printReport(file, cut, result);
}

const rows = shuffledImportRows(results, seed);
const json = `${JSON.stringify(rows, null, 2)}\n`;
if (options.out) {
  await writeFile(options.out, json);
  const reportFile = options.out.replace(/\.json$/i, "") + ".report.json";
  await writeFile(reportFile, `${JSON.stringify(reportJson(results), null, 2)}\n`);
  console.error(`\n${rows.length} rows written to ${options.out}; report in ${reportFile}.`);
} else {
  process.stdout.write(json);
}
if (rows.length > importRowLimit) {
  console.error(`Studio imports at most ${importRowLimit} rows at a time: split the file into batches.`);
}

async function textFiles(entry: string): Promise<string[]> {
  const info = await stat(entry);
  if (info.isFile()) return [entry];
  const names = await readdir(entry);
  return names.filter((name) => name.toLowerCase().endsWith(".txt")).map((name) => path.join(entry, name));
}

async function readWork(file: string): Promise<FragmentWork> {
  const text = await readFile(file, "utf8");
  const sidecar = await readFile(file.replace(/\.txt$/i, ".json"), "utf8")
    .then((raw) => JSON.parse(raw) as { title?: string; author?: string; language?: string })
    .catch(() => ({}) as { title?: string; author?: string; language?: string });
  const cyrillic = (text.slice(0, 20_000).match(/[а-яё]/giu) ?? []).length;
  const latin = (text.slice(0, 20_000).match(/[a-z]/gi) ?? []).length;
  return {
    sourceTitle: sidecar.title ?? options.title ?? path.basename(file, path.extname(file)),
    sourceAuthor: sidecar.author ?? options.author ?? "",
    language: sidecar.language ?? options.language ?? (cyrillic >= latin ? "ru" : "en"),
    text,
  };
}

/**
 * One request per candidate, four at a time. A failed or refused request
 * leaves that candidate without a verdict rather than stopping the run: it
 * then keeps its place by the algorithm's score alone.
 */
async function checkWithModel(cut: CutWork): Promise<(ModelVerdict | null)[]> {
  const verdicts: (ModelVerdict | null)[] = new Array(cut.pool.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < cut.pool.length) {
      const index = next++;
      const candidate = cut.pool[index];
      const body = cut.work.text.slice(candidate.start, candidate.end);
      verdicts[index] = await askModel(modelCheckRequest(body, cut.work, options.model));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return verdicts;
}

async function askModel(request: ReturnType<typeof modelCheckRequest>, attempt = 0): Promise<ModelVerdict | null> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey ?? "",
      "anthropic-version": "2026-10-21",
    },
    body: JSON.stringify(request),
  }).catch(() => null);

  // 429 and 5xx are worth waiting for; anything else (a bad request, a bad
  // key) would fail the same way again.
  const retryable = !response || response.status === 429 || response.status >= 500;
  if (response?.ok) return readModelVerdict(await response.json());
  if (retryable && attempt < 4) {
    const after = Number(response?.headers.get("retry-after"));
    await new Promise((resolve) => setTimeout(resolve, (after > 0 ? after : 2 ** attempt) * 1000));
    return askModel(request, attempt + 1);
  }
  console.error(`  model check failed: ${response ? `${response.status} ${await response.text()}` : "network error"}`);
  return null;
}

function printReport(file: string, cut: CutWork, result: WorkResult) {
  const words = cut.paragraphs.reduce((sum, paragraph) => sum + paragraph.words, 0);
  console.error(`\n${result.work.sourceTitle} — ${result.work.sourceAuthor || "author unknown"} [${result.work.language}] (${path.basename(file)})`);
  console.error(`  ${cut.paragraphs.length} paragraphs, ${words} words; ${result.modelChecked ? `model-checked by ${options.model}` : "not model-checked"}`);
  for (const fragment of result.fragments) {
    const verdict = fragment.verdict ? ` model ${fragment.verdict.standalone}/${fragment.verdict.complete}` : "";
    const opening = result.work.text.slice(fragment.start, fragment.start + 70).replace(/\s+/g, " ");
    console.error(
      `  #${fragment.rank} ${fragment.minutes.toFixed(1)} min ${fragment.words} w, score ${fragment.score.toFixed(2)}` +
        ` (boundary ${fragment.boundary.toFixed(2)}, cohesion ${fragment.cohesion.toFixed(2)})` +
        `${fragment.cues.length ? ` [${fragment.cues.join(", ")}]` : ""}${verdict}\n      “${opening}…”`,
    );
  }
  const overlapping = result.windows.filter((window) => window.overlapsAlgorithm).length;
  console.error(
    `  windows: ${result.windows.length} of ${result.fragments.length}` +
      `${overlapping ? `, ${overlapping} overlapping an algorithm fragment (work too short to avoid it)` : ""}`,
  );
}

function reportJson(all: WorkResult[]) {
  return all.map((result) => ({
    sourceTitle: result.work.sourceTitle,
    sourceAuthor: result.work.sourceAuthor,
    language: result.work.language,
    modelChecked: result.modelChecked,
    model: result.modelChecked ? options.model : null,
    fragments: result.fragments.map(({ rank, start, end, words, minutes, score, boundary, cohesion, cues, verdict }) => ({
      rank, start, end, words, minutes: Number(minutes.toFixed(2)), score: Number(score.toFixed(3)),
      boundary: Number(boundary.toFixed(3)), cohesion: Number(cohesion.toFixed(3)), cues, verdict,
    })),
    windows: result.windows,
  }));
}

function positiveInteger(value: string | undefined, name: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`${name} must be a positive integer.`);
    process.exit(2);
  }
  return parsed;
}
