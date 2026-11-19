/**
 * The Series recorder's worker: builds the drafts Studio queues
 * (`docs/series-recorder.md`).
 *
 *   npm run series:worker            keep watching the queue
 *   npm run series:worker -- --once  build what is queued, then stop
 *
 * One build at a time, so however many drafts are queued the server gives
 * this a single core for a few seconds each; the rest of a build is waiting
 * for ElevenLabs. Per build:
 *
 *   1. audio: the chosen take brought to the series' -22 LUFS by gain (a
 *      limiter only catches peaks), mono MP3;
 *   2. listening: forced alignment of the exact text and speech to text of
 *      the same file; a take that does not read the text stops here, saying
 *      which words were missed;
 *   3. pictures: each cut to 1080x1920 from its middle, WebP, and the cover;
 *   4. assembling: silence trimmed at both ends, the scene plan, the
 *      manifest (`lib/boks/poetry/build-manifest.mjs`), the stanzas raised
 *      above the player, and the folder swapped into the link-only store.
 *
 * It also draws pictures Studio asks for (`art-job.json`): YandexGPT writes a
 * scene from each picture's lines, Alice AI Image draws it
 * (`lib/boks/series-recorder/art.ts`), with YANDEX_API_KEY and
 * YANDEX_FOLDER_ID (a key with `yc.ai.imageGeneration.execute` and
 * `yc.ai.languageModels.execute`). Pictures go first: they are quick, and
 * someone is waiting at the page for them.
 *
 * Needs ffmpeg and cwebp on the PATH and ELEVENLABS_API_KEY (scopes
 * `speech_to_text`; forced alignment needs no other). Folders:
 * BOKS_SERIES_DIR (drafts, as the API route keeps them) and
 * BOKS_LINK_ONLY_DIR (where `/l/<token>` reads from).
 */
import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildPoemManifest } from "@/lib/boks/poetry/build-manifest.mjs";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";
import { raiseStanzaZones, stanzaFitProblems } from "@/lib/boks/poetry/stanza-fit";
import { characterAlignment, matchTake, shiftAlignment, type ForcedAlignment, type SpeechWord } from "@/lib/boks/series-recorder/alignment";
import { minimumMatch, poemLines, seriesLimits, type SeriesBuildErrorCode, type SeriesBuildResult, type SeriesBuildStep } from "@/lib/boks/series-recorder/rules";
import { planSceneMap } from "@/lib/boks/series-recorder/scene-plan";
import { ArtServiceError, artPrompt, drawPicture, writeScenes, type YandexKeys } from "@/lib/boks/series-recorder/art";
import { seriesRoot, writeJsonAtomically, type SeriesArtTask, type SeriesJob } from "@/lib/boks/series-recorder/store";
import { runCoverWorker } from "@/lib/boks/author/covers/worker";

const run = promisify(execFile);
const linkOnlyRoot = process.env.BOKS_LINK_ONLY_DIR || join(process.cwd(), ".boks-local", "link-only");
const apiKey = process.env.ELEVENLABS_API_KEY;
// ElevenLabs refuses POSTs from Russia, so production goes through the
// Cloudflare relay (`deploy/elevenlabs-relay`) with its key; locally this can
// also be a stand-in answering the same two endpoints.
const apiBase = process.env.ELEVENLABS_API_URL || "https://api.elevenlabs.io";
const relayKey = process.env.ELEVENLABS_RELAY_KEY;
const once = process.argv.includes("--once");
const targetLufs = -22;
/** Silence kept before the first word and after the last. */
const leadInS = 0.8;
const tailS = 1.5;

class BuildError extends Error {
  constructor(readonly code: SeriesBuildErrorCode, message: string, readonly detail: Partial<SeriesBuildResult> = {}) {
    super(message);
  }
}

const exists = (path: string) => stat(path).then(() => true, () => false);

async function ffmpeg(args: string[]) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], { maxBuffer: 32 * 1024 * 1024 });
  return stderr;
}

/**
 * A file's length in seconds. A browser's own recording (MediaRecorder's WebM,
 * Safari's fragmented MP4) carries no duration in its header - ffprobe says
 * N/A - so then the file is read through once and the last timestamp is its
 * length.
 */
async function durationOf(path: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  const said = Number(stdout.trim());
  if (Number.isFinite(said) && said > 0) return said;
  const log = await ffmpeg(["-i", path, "-f", "null", "-"]);
  const times = [...log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = times.at(-1);
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : Number.NaN;
}

/** Integrated loudness, from ffmpeg's loudnorm analysis. */
async function loudness(path: string) {
  const log = await ffmpeg(["-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  const json = log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1);
  const value = Number(JSON.parse(json).input_i);
  if (!Number.isFinite(value) || value < -70) throw new BuildError("silent", "The take is silent.");
  return value;
}

/**
 * One ElevenLabs call. Out of quota (402, or 401 saying `quota_exceeded`) is
 * `quota`: no retry helps, the team has to top it up. 403, 429 and 5xx are
 * retried - 403 there is almost always a rate limit (`docs/media-generation.md`)
 * - and then, like no answer at all, `service`.
 */
async function elevenlabs<T>(path: string, form: FormData): Promise<T> {
  if (!apiKey) throw new BuildError("service", "ELEVENLABS_API_KEY is not set for the worker.");
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, ...(relayKey ? { "X-Boks-Relay": relayKey } : {}) },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
        continue;
      }
      throw new BuildError("service", `No answer from ElevenLabs to ${path}: ${error instanceof Error ? error.message : error}`);
    }
    const detail = await response.text().catch(() => "");
    if (response.ok) {
      // A block page (ElevenLabs from Russia: "Access restricted") comes as 200 HTML.
      try {
        return JSON.parse(detail) as T;
      } catch {
        const title = /<title>([^<]*)<\/title>/i.exec(detail)?.[1]?.trim();
        throw new BuildError("service", `ElevenLabs answered ${path} with ${title ? `a page "${title}"` : "something that is not JSON"}: ${detail.slice(0, 120)}`);
      }
    }
    if (response.status === 402 || (response.status === 401 && /quota|credit|limit/i.test(detail))) {
      throw new BuildError("quota", `ElevenLabs is out of quota (${response.status}) on ${path}.`);
    }
    if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
      continue;
    }
    throw new BuildError("service", `ElevenLabs answered ${response.status} to ${path}: ${detail.slice(0, 200)}`);
  }
}

async function audioForm(path: string, fields: Record<string, string>) {
  const form = new FormData();
  form.set("file", new Blob([await readFile(path)], { type: "audio/mpeg" }), "take.mp3");
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

async function build(dir: string, job: SeriesJob, step: (name: SeriesBuildStep) => Promise<void>): Promise<SeriesBuildResult> {
  const work = join(dir, "work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const { lines, stanzas } = poemLines(job.text);
  if (!lines.length) throw new BuildError("unexpected", "The text is empty.");
  // What is aligned: the lines, one a line, exactly as the manifest will cut them.
  const text = lines.join("\n");
  const language = /[а-яё]/i.test(text) ? "ru" : "en";

  await step("audio");
  const source = join(dir, job.take);
  // The length the browser reported can be anything; the file's own is what ElevenLabs would bill.
  const seconds = await durationOf(source).catch(() => Number.NaN);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new BuildError("unexpected", "The take could not be read as audio.");
  if (seconds * 1000 > seriesLimits.takeMs) throw new BuildError("long", `The take is ${Math.round(seconds)} s long.`);
  const gain = targetLufs - (await loudness(source));
  const levelled = join(work, "levelled.wav");
  await ffmpeg(["-i", source, "-ac", "1", "-ar", "44100", "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.95:level=disabled`, levelled]);
  const listening = join(work, "listening.mp3");
  await ffmpeg(["-i", levelled, "-c:a", "libmp3lame", "-b:a", "96k", listening]);

  await step("listening");
  const [aligned, heard] = await Promise.all([
    elevenlabs<ForcedAlignment>("/v1/forced-alignment", await audioForm(listening, { text })),
    elevenlabs<{ words: SpeechWord[] }>(
      "/v1/speech-to-text",
      await audioForm(listening, { model_id: "scribe_v1", language_code: language === "ru" ? "rus" : "eng", timestamps_granularity: "word" }),
    ),
  ]);
  const match = matchTake(text, heard.words ?? []);
  if (match.match < minimumMatch) {
    throw new BuildError("mismatch", "The take does not read the text closely enough.", { match: match.match, words: match.words, missed: match.missed, extra: match.extra });
  }
  const timed = characterAlignment(text, aligned, heard.words ?? []);

  await step("pictures");
  const out = join(work, "out");
  await mkdir(out, { recursive: true });
  const sceneImages: string[] = [];
  for (const [index, image] of job.images.entries()) {
    const name = `scene-${String(index + 1).padStart(2, "0")}`;
    const png = join(work, `${name}.png`);
    await ffmpeg(["-i", join(dir, image), "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", "-frames:v", "1", png]);
    await run("cwebp", ["-quiet", "-q", "82", "-m", "6", "-sharp_yuv", png, "-o", join(out, `${name}.webp`)]);
    if (index === 0) await run("cwebp", ["-quiet", "-q", "80", "-resize", "720", "0", png, "-o", join(out, "cover.webp")]);
    sceneImages.push(`${name}.webp`);
  }

  await step("assembling");
  const starts = timed.character_start_times_seconds;
  const ends = timed.character_end_times_seconds;
  const firstWord = Math.min(...starts.filter((_, i) => !/\s/.test(text[i])));
  const lastWord = Math.max(...ends);
  const head = Math.max(0, firstWord - leadInS);
  const length = Math.min(await durationOf(levelled), lastWord + tailS) - head;
  await ffmpeg(["-ss", head.toFixed(3), "-t", length.toFixed(3), "-i", levelled, "-af", "afade=t=out:st=" + Math.max(0, length - 0.4).toFixed(3) + ":d=0.4", "-c:a", "libmp3lame", "-b:a", "128k", join(out, "narration.mp3")]);

  const files = (name: string) => `/l/${job.token}/f/${name}`;
  const sceneMap = planSceneMap({ title: job.title, author: job.author, language, lines, stanzas, images: sceneImages });
  const longest = Math.max(...lines.map((line) => line.length));
  const { manifest } = buildPoemManifest({
    slug: job.token,
    alignment: shiftAlignment(timed, head),
    lines,
    sceneMap: longest > 34 ? { ...sceneMap, textScale: 0.82 } : sceneMap,
    files: { audio: files("narration.mp3"), theme: null, image: files },
  });
  const poem = manifest as PoemManifest;
  poem.id = `series-${job.token}`;
  // The recording runs on past the last word: the poem lasts as long as it does.
  poem.durationMs = Math.round(length * 1000);
  poem.lines.at(-1)!.endMs = poem.durationMs;
  const { refusals } = raiseStanzaZones(poem);
  const problems = stanzaFitProblems(poem);
  if (refusals.length || problems.length) throw new BuildError("layout", `A stanza does not fit above the player: ${[...refusals, ...problems][0]}`);
  await writeFile(join(out, "manifest.json"), `${JSON.stringify(poem, null, 1)}\n`);

  // Swap the folder in whole: a reader never gets half of a rebuild.
  await mkdir(linkOnlyRoot, { recursive: true });
  const target = join(linkOnlyRoot, job.token);
  const old = `${target}.old`;
  await rm(old, { recursive: true, force: true });
  // Drafts and link-only are separate mounts on the server, where a rename
  // between them fails (EXDEV): copy in beside the target first, then swap.
  const incoming = `${target}.new`;
  await rm(incoming, { recursive: true, force: true });
  await cp(out, incoming, { recursive: true });
  if (await exists(target)) await rename(target, old);
  await rename(incoming, target);
  await rm(old, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });

  return {
    jobId: job.jobId,
    ok: true,
    finishedAt: new Date().toISOString(),
    token: job.token,
    durationMs: poem.durationMs,
    match: match.match,
    words: match.words,
    missed: match.missed,
    extra: match.extra,
    scenes: poem.scenes.length,
  };
}

/** Takes one queued job, if there is one. True when it did. */
async function takeOne(): Promise<boolean> {
  const root = seriesRoot();
  await mkdir(root, { recursive: true });
  for (const id of await readdir(root)) {
    const dir = join(root, id);
    const queued = join(dir, "job.json");
    const claimed = join(dir, "job.processing");
    try {
      await rename(queued, claimed);
    } catch {
      continue;
    }
    const job = JSON.parse(await readFile(claimed, "utf8")) as SeriesJob;
    const started = Date.now();
    console.log(`series: building ${id} (${job.title})`);
    let result: SeriesBuildResult;
    try {
      result = await build(dir, job, (step) => writeJsonAtomically(join(dir, "progress.json"), { jobId: job.jobId, step }));
      console.log(`series: ${id} ready in ${((Date.now() - started) / 1000).toFixed(1)}s, match ${(result.match! * 100).toFixed(1)}%`);
    } catch (error) {
      const detail = error instanceof BuildError ? error.detail : {};
      result = {
        jobId: job.jobId,
        ok: false,
        finishedAt: new Date().toISOString(),
        errorCode: error instanceof BuildError ? error.code : "unexpected",
        error: error instanceof Error ? error.message : String(error),
        ...detail,
      };
      // ALERT lines go to the team's Telegram (deploy/ops/alerts.sh): these failures are ours, not the author's.
      const code = error instanceof BuildError ? error.code : "unexpected";
      if (code === "quota" || code === "service" || code === "unexpected") {
        const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);
        console.error(`series: ALERT build ${code} · ${id} «${job.title}»: ${message}`);
      }
      console.error(`series: ${id} failed`, error);
    }
    await writeJsonAtomically(join(dir, "result.json"), { ...result, sourceHash: job.sourceHash });
    await rm(join(dir, "progress.json"), { force: true });
    await rm(claimed, { force: true });
    return true;
  }
  return false;
}

const yandex: YandexKeys | null = process.env.YANDEX_API_KEY && process.env.YANDEX_FOLDER_ID
  ? { apiKey: process.env.YANDEX_API_KEY, folder: process.env.YANDEX_FOLDER_ID }
  : null;

/** Pictures for one queued picture job, if there is one. True when it did. */
async function drawOne(): Promise<boolean> {
  const root = seriesRoot();
  await mkdir(root, { recursive: true });
  for (const id of await readdir(root)) {
    const dir = join(root, id);
    const claimed = join(dir, "art-job.processing");
    try {
      await rename(join(dir, "art-job.json"), claimed);
    } catch {
      continue;
    }
    const job = JSON.parse(await readFile(claimed, "utf8")) as SeriesArtTask;
    const started = Date.now();
    let result: Record<string, unknown>;
    try {
      if (!yandex) throw new ArtServiceError("unavailable", "YANDEX_API_KEY / YANDEX_FOLDER_ID are not set for the worker.");
      const scenes = job.kind === "generate" ? await writeScenes(yandex, job.fragments) : [job.prompt];
      const prompts = scenes.map((scene) => (job.kind === "regenerate" ? scene : artPrompt(scene)));
      const pictures = await Promise.all(prompts.map(async (prompt, index) => {
        const file = `art-${job.jobId}-${index + 1}.jpg`;
        await writeFile(join(dir, file), await drawPicture(yandex, prompt));
        const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(dir, file)]);
        const [width, height] = stdout.trim().split(",").map(Number);
        return { file, width, height, prompt };
      }));
      result = { jobId: job.jobId, kind: job.kind, ok: true, file: job.kind === "regenerate" ? job.file : undefined, pictures };
      console.log(`series: ${id} drew ${pictures.length} picture(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (error) {
      // ALERT lines go to the team's Telegram (deploy/ops/alerts.sh): top up or fix the service. A refused prompt is the text's, not ours.
      const artCode = error instanceof ArtServiceError ? error.code : "unexpected";
      if (artCode === "unavailable" || artCode === "unexpected") {
        const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);
        console.error(`series: ALERT pictures ${artCode} · ${id}: ${message}`);
      }
      console.error(`series: ${id} could not draw`, error);
      // Whatever was drawn before the failure goes; the job is all or nothing.
      for (const name of await readdir(dir)) if (name.startsWith(`art-${job.jobId}-`)) await rm(join(dir, name), { force: true });
      result = { jobId: job.jobId, kind: job.kind, ok: false, errorCode: error instanceof ArtServiceError ? error.code : "unexpected" };
    }
    await writeJsonAtomically(join(dir, "art-result.json"), result);
    await rm(claimed, { force: true });
    return true;
  }
  return false;
}

/** A build or a picture job the worker was stopped in the middle of goes back in the queue. */
async function requeueInterrupted() {
  const root = seriesRoot();
  await mkdir(root, { recursive: true });
  for (const id of await readdir(root)) {
    for (const [running, queued] of [["job.processing", "job.json"], ["art-job.processing", "art-job.json"]]) {
      const claimed = join(root, id, running);
      if (await exists(claimed)) await rename(claimed, join(root, id, queued)).catch(() => {});
    }
  }
}

await requeueInterrupted();
if (once) {
  while ((await drawOne()) || (await takeOne()));
} else {
  console.log(`series: watching ${seriesRoot()}, building into ${linkOnlyRoot}${yandex ? ", drawing with Yandex" : ", no Yandex key: pictures cannot be drawn"}`);
  // Authors' covers (docs/author-publishing.md) share this process, its keys and its folder.
  void runCoverWorker();
  for (;;) {
    if (!(await drawOne()) && !(await takeOne())) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
