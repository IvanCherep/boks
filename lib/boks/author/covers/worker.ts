/**
 * The covers worker (`docs/author-publishing.md`): draws the two covers an
 * author or Studio asks for. Each job is two pictures for one piece: YandexGPT
 * writes two scenes from its opening, Alice AI Image draws them
 * (`cover-art.ts`), with YANDEX_API_KEY and YANDEX_FOLDER_ID. A failed job
 * keeps nothing; ALERT lines reach the team's Telegram as the Series worker's
 * do.
 *
 * In production it runs inside the Series worker's process
 * (`scripts/series-worker.mts`), which has the keys, the folder and a restart
 * on every release; locally `npm run covers:worker` runs it alone.
 * BOKS_COVERS_FAKE=1 (local only, without keys): two plain gradients drawn by
 * ffmpeg instead, so the composer can be tried end to end.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ArtServiceError, type YandexKeys } from "@/lib/boks/series-recorder/art";
import { drawCovers } from "./cover-art";
import { coversRoot, isCoverJobId, writeJsonAtomically, type CoverJob, type CoverResult } from "./jobs";

const run = promisify(execFile);
const fake = globalThis.process?.env?.BOKS_COVERS_FAKE === "1";
const yandex: YandexKeys | null = process.env.YANDEX_API_KEY && process.env.YANDEX_FOLDER_ID
  ? { apiKey: process.env.YANDEX_API_KEY, folder: process.env.YANDEX_FOLDER_ID }
  : null;
/** A job nobody picked up in a day, or a finished one a day old, is cleared. */
const keepMs = 24 * 60 * 60 * 1000;

async function fakeCovers(dir: string, count: number) {
  const palettes = [["0x26343f", "0xc9a27e"], ["0x3d2b3d", "0x9fb4c7"]];
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return Promise.all(Array.from({ length: count }, async (_, index) => {
    const out = join(dir, `fake-${index}.jpg`);
    const [a, b] = palettes[index % palettes.length];
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `gradients=s=768x1344:c0=${a}:c1=${b}:x0=0:y0=0:x1=768:y1=1344:d=1`, "-frames:v", "1", "-q:v", "3", out]);
    const jpeg = new Uint8Array(await readFile(out));
    await rm(out, { force: true });
    return { prompt: `fake ${index + 1}`, jpeg };
  }));
}

async function drawOne(): Promise<boolean> {
  const root = coversRoot();
  await mkdir(root, { recursive: true });
  for (const id of await readdir(root)) {
    if (!isCoverJobId(id)) continue;
    const dir = join(root, id);
    const claimed = join(dir, "job.processing");
    try {
      await rename(join(dir, "job.json"), claimed);
    } catch {
      continue;
    }
    const job = JSON.parse(await readFile(claimed, "utf8")) as CoverJob;
    const started = Date.now();
    let result: CoverResult;
    try {
      const drawn = fake
        ? await fakeCovers(dir, job.pictures)
        : yandex
          ? await drawCovers(yandex, job.title, job.text, job.pictures)
          : (() => { throw new ArtServiceError("unavailable", "YANDEX_API_KEY / YANDEX_FOLDER_ID are not set for the covers worker."); })();
      const pictures = await Promise.all(drawn.map(async (picture, index) => {
        const file = `picture-${index + 1}.jpg`;
        await writeFile(join(dir, file), picture.jpeg);
        return { file, prompt: picture.prompt };
      }));
      result = { ok: true, pictures, seconds: Math.round((Date.now() - started) / 100) / 10 };
      console.log(`covers: ${id} drew ${pictures.length} in ${result.seconds}s`);
    } catch (error) {
      const errorCode = error instanceof ArtServiceError ? error.code : "unexpected";
      if (errorCode !== "refused") {
        const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);
        console.error(`covers: ALERT pictures ${errorCode} · ${id}: ${message}`);
      }
      for (const name of await readdir(dir)) if (name.startsWith("picture-")) await rm(join(dir, name), { force: true });
      result = { ok: false, errorCode };
    }
    await writeJsonAtomically(join(dir, "result.json"), result);
    await rm(claimed, { force: true });
    return true;
  }
  return false;
}

async function sweep() {
  const root = coversRoot();
  for (const id of await readdir(root).catch(() => [])) {
    if (!isCoverJobId(id)) continue;
    const dir = join(root, id);
    const job = await readFile(join(dir, "job.json"), "utf8").catch(() => null)
      ?? await readFile(join(dir, "result.json"), "utf8").then(() => "{}", () => null);
    if (job === null) continue;
    const created = (() => { try { return Date.parse((JSON.parse(job) as CoverJob).createdAt); } catch { return NaN; } })();
    const { mtimeMs } = await stat(dir);
    if (Date.now() - (Number.isFinite(created) ? created : mtimeMs) > keepMs) await rm(dir, { recursive: true, force: true });
  }
}

/** Watches the queue for ever, or with `once` until it is empty. Never throws: one bad job does not stop the next. */
export async function runCoverWorker(options: { once?: boolean } = {}) {
  if (!fake && !yandex) console.warn("covers: no YANDEX_API_KEY / YANDEX_FOLDER_ID; every job will fail as unavailable (BOKS_COVERS_FAKE=1 draws stand-ins locally).");
  else console.log(`covers: watching ${coversRoot()}${fake ? " (stand-in pictures)" : ", drawing with Yandex"}`);
  let lastSweep = 0;
  for (;;) {
    let did = false;
    try {
      did = await drawOne();
    } catch (error) {
      console.error("covers: ALERT the covers worker failed a turn", error);
    }
    if (Date.now() - lastSweep > 60 * 60 * 1000) {
      lastSweep = Date.now();
      await sweep().catch((error) => console.error("covers: sweep failed", error));
    }
    if (options.once && !did) return;
    if (!did) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
