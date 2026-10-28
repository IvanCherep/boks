#!/usr/bin/env -S npx tsx
/**
 * Cuts fragments out of long works with the multi-stage pipeline
 * (`lib/boks/fragments/pipeline.ts`, `docs/fragment-cutter.md`) and writes
 * the JSON array Studio → Studies → Б3 imports: each work's kept fragments
 * and a same-length window for each, shuffled together.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/cut-fragments.mts books/ --out b3.json
 *   YANDEX_API_KEY=… YANDEX_FOLDER_ID=… npx tsx --tsconfig tsconfig.json \
 *     scripts/cut-fragments.mts book.txt --title "Дуэль" --author "Антон Чехов" --llm yandex --out b3.json
 *
 * Input: `.txt` files, or directories of them, in UTF-8. Each work's title,
 * author and language come from a sidecar `<name>.json` beside it
 * (`{ "title": …, "author": …, "language": … }`), then from `--title`,
 * `--author`, `--language` when one file is given, then from the file name
 * and the share of Cyrillic letters. The text itself is never edited, so the
 * file should hold the work and nothing else.
 *
 * Options: `--per-work 5`, `--seed 1`, `--out file.json` (default: stdout),
 * `--llm yandex` (YANDEX_API_KEY, YANDEX_FOLDER_ID; `--model aliceai-llm`,
 * `--tournament-model gpt-oss-120b`) or
 * `--llm anthropic` (ANTHROPIC_API_KEY; `--model claude-haiku-5-5`),
 * `--pool`, `--scene-calls 16`, `--votes 1`, `--rounds 3`,
 * `--strictness lenient|normal|strict`, `--no-scenes`, `--no-refine`,
 * `--no-judge`, `--no-tournament`. A report per work goes to
 * stderr, and as JSON to `<out>.report.json`.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { shuffle, createRandom } from "../lib/recsys/statistics/random";
import { seedFor, type FragmentWork } from "../lib/boks/fragments";
import {
  anthropicBody,
  defaultAnthropicModel,
  defaultStageModels,
  isYandexModel,
  readAnthropic,
  readYandexChat,
  withCache,
  withConcurrency,
  withRetries,
  yandexChatBody,
  yandexChatUrl,
  yandexConcurrency,
  type LlmCall,
  type YandexModel,
} from "../lib/boks/fragments/llm";
import { pipelineImportRows, runFragmentPipeline, type PipelineResult, type Strictness } from "../lib/boks/fragments/pipeline";

/** `import_boks_study_fragments` refuses a larger array; a bigger run is imported in batches. */
const importRowLimit = 500;

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "per-work": { type: "string", default: "5" },
    seed: { type: "string", default: "1" },
    out: { type: "string" },
    llm: { type: "string" },
    model: { type: "string" },
    "tournament-model": { type: "string" },
    pool: { type: "string" },
    "scene-calls": { type: "string", default: "16" },
    votes: { type: "string", default: "1" },
    strictness: { type: "string", default: "normal" },
    rounds: { type: "string", default: "3" },
    "no-scenes": { type: "boolean", default: false },
    "no-refine": { type: "boolean", default: false },
    "no-judge": { type: "boolean", default: false },
    "no-tournament": { type: "boolean", default: false },
    title: { type: "string" },
    author: { type: "string" },
    language: { type: "string" },
  },
});

const perWork = positiveInteger(options["per-work"], "--per-work");
const seed = positiveInteger(options.seed, "--seed");
const llm = modelCall(options.llm);

if (positionals.length === 0) {
  console.error("Usage: cut-fragments.mts <file.txt | directory>... [--out b3.json] [--per-work 5] [--seed 1] [--llm yandex|anthropic]");
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

const results: PipelineResult[] = [];
for (const file of files) {
  const work = await readWork(file);
  const result = await runFragmentPipeline(work, {
    perWork,
    seed,
    llm,
    poolSize: options.pool ? positiveInteger(options.pool, "--pool") : undefined,
    maxSceneCalls: positiveInteger(options["scene-calls"], "--scene-calls"),
    judgeVotes: positiveInteger(options.votes, "--votes"),
    strictness: strictnessOf(options.strictness),
    tournamentRounds: Number(options.rounds),
    stages: { scenes: !options["no-scenes"], refine: !options["no-refine"], judge: !options["no-judge"], tournament: !options["no-tournament"] },
    onProgress: ({ stage, done, total }) => {
      if (total > 1) process.stderr.write(`\r  ${stage} ${done}/${total}   `);
    },
  });
  results.push(result);
  printReport(file, result);
}

// Rows of all works shuffled, so the file's order does not give the method away.
const rows = shuffle(results.flatMap(pipelineImportRows), createRandom(seedFor(seed, "rows")));
const json = `${JSON.stringify(rows, null, 2)}\n`;
if (options.out) {
  await writeFile(options.out, json);
  const reportFile = options.out.replace(/\.json$/i, "") + ".report.json";
  await writeFile(reportFile, `${JSON.stringify(results.map(reportJson), null, 2)}\n`);
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
 * The model the pipeline asks, or undefined to run offline. Keys come from
 * the environment only; a missing one says so and runs offline rather than
 * failing a long batch at its first call.
 */
function modelCall(provider: string | undefined): LlmCall | undefined {
  if (!provider) return undefined;
  if (provider === "yandex") {
    const key = process.env.YANDEX_API_KEY;
    const folder = process.env.YANDEX_FOLDER_ID;
    if (!key || !folder) {
      console.error("--llm yandex needs YANDEX_API_KEY and YANDEX_FOLDER_ID: running offline.");
      return undefined;
    }
    // --model replaces the model of every stage but the tournament, which has its own flag.
    const models = { ...defaultStageModels };
    for (const [flag, stages] of [[options.model, ["scenes", "refine", "judge"]], [options["tournament-model"], ["tournament"]]] as const) {
      if (!flag) continue;
      if (!isYandexModel(flag)) {
        console.error(`Unknown Yandex model ${flag}.`);
        process.exit(2);
      }
      for (const stage of stages) models[stage] = flag as YandexModel;
    }
    return withCache(withConcurrency(withRetries(async (task) => {
      const response = await fetch(yandexChatUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Api-Key ${key}`, "x-folder-id": folder },
        body: JSON.stringify(yandexChatBody(task, folder, models[task.stage])),
      });
      if (!response.ok) throw Object.assign(new Error(`Yandex ${response.status}: ${(await response.text()).slice(0, 300)}`), { status: response.status });
      return readYandexChat(await response.json());
    }), yandexConcurrency));
  }
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      console.error("--llm anthropic needs ANTHROPIC_API_KEY: running offline.");
      return undefined;
    }
    const model = options.model ?? defaultAnthropicModel;
    return withCache(withRetries(async (task) => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(anthropicBody(task, model)),
      });
      if (!response.ok) throw Object.assign(new Error(`Anthropic ${response.status}: ${(await response.text()).slice(0, 300)}`), { status: response.status });
      return readAnthropic(await response.json());
    }));
  }
  console.error(`--llm must be yandex or anthropic, not ${provider}.`);
  process.exit(2);
}

function printReport(file: string, result: PipelineResult) {
  const { work, stats } = result;
  console.error(`\n${work.sourceTitle} — ${work.sourceAuthor || "author unknown"} [${work.language}] (${path.basename(file)})`);
  console.error(`  ${stats.paragraphs} paragraphs, ${stats.words} words, ${stats.candidates} candidate spans; status ${result.status}` +
    (result.modelChecked ? `; ${result.usage.calls} model calls, ${result.usage.promptTokens}+${result.usage.completionTokens} tokens` : "; not model-checked"));
  for (const stage of result.stages) console.error(`  · ${stage.stage}: ${stage.note} (${stage.ms} ms${stage.failed ? `, ${stage.failed} failed` : ""})`);
  for (const line of result.diagnosis) console.error(`  ! ${line}`);
  for (const fragment of result.fragments) {
    const judgement = fragment.judgement;
    const opening = work.text.slice(fragment.start, fragment.start + 90).replace(/\s+/g, " ");
    const closing = work.text.slice(Math.max(fragment.start, fragment.end - 70), fragment.end).replace(/\s+/g, " ");
    console.error(
      `  #${fragment.rank} ${fragment.minutes.toFixed(1)} min ${fragment.words} w, final ${fragment.scores.final.toFixed(2)}` +
        ` (algorithm ${fragment.scores.algorithm.toFixed(2)}${fragment.scores.judge === null ? "" : `, judge ${fragment.scores.judge.toFixed(2)}`}${fragment.scores.tournament === null ? "" : `, pairs ${fragment.scores.tournament.toFixed(2)}`})` +
        `${fragment.candidate.cues.length ? ` [${fragment.candidate.cues.join(", ")}]` : ""}` +
        `${fragment.refinedFrom ? ` moved from ${fragment.refinedFrom.firstParagraph}-${fragment.refinedFrom.lastParagraph}` : ""}` +
        (judgement ? `\n      «${judgement.title}» S${judgement.standalone.toFixed(1)} C${judgement.complete.toFixed(1)} O${judgement.opening.toFixed(1)} I${judgement.interest}: ${judgement.summary}` : "") +
        `\n      “${opening}…” … “…${closing}”`,
    );
  }
  for (const item of result.rejected.slice(0, 6)) {
    console.error(`  ✗ ${item.minutes.toFixed(1)} min at ¶${item.firstParagraph}: ${item.reasons.join("; ")}`);
  }
}

function reportJson(result: PipelineResult) {
  const round = (value: number | null) => (value === null ? null : Number(value.toFixed(3)));
  const fragment = (item: PipelineResult["fragments"][number] | PipelineResult["rejected"][number]) => ({
    start: item.start, end: item.end, firstParagraph: item.firstParagraph, lastParagraph: item.lastParagraph,
    words: item.words, minutes: round(item.minutes), cues: item.candidate.cues,
    scores: { algorithm: round(item.scores.algorithm), judge: round(item.scores.judge), tournament: round(item.scores.tournament), final: round(item.scores.final) },
    refinedFrom: item.refinedFrom, judgement: item.judgement,
  });
  return {
    sourceTitle: result.work.sourceTitle,
    sourceAuthor: result.work.sourceAuthor,
    language: result.work.language,
    status: result.status,
    diagnosis: result.diagnosis,
    modelChecked: result.modelChecked,
    provider: options.llm ?? null,
    model: options.llm === "yandex"
      ? { ...defaultStageModels, ...(options.model ? { scenes: options.model, refine: options.model, judge: options.model } : {}), ...(options["tournament-model"] ? { tournament: options["tournament-model"] } : {}) }
      : options.llm ? options.model ?? defaultAnthropicModel : null,
    stats: result.stats,
    usage: result.usage,
    stages: result.stages,
    scenes: result.scenes?.scenes ?? null,
    fragments: result.fragments.map((item) => ({ rank: item.rank, ...fragment(item) })),
    rejected: result.rejected.map((item) => ({ ...fragment(item), reasons: item.reasons })),
    windows: result.windows,
  };
}

function strictnessOf(value: string | undefined): Strictness {
  if (value === "lenient" || value === "normal" || value === "strict") return value;
  console.error("--strictness must be lenient, normal or strict.");
  process.exit(2);
}

function positiveInteger(value: string | undefined, name: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`${name} must be a positive integer.`);
    process.exit(2);
  }
  return parsed;
}
