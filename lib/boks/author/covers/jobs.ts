/**
 * The queue of cover drawings: one folder per job under `BOKS_COVERS_DIR`,
 * as the Series recorder keeps its drafts. The app's route writes `job.json`
 * after the database has counted the pictures (`reserve_my_cover_drawing`);
 * the worker (`npm run covers:worker`) renames it to `job.processing`, writes
 * `picture-<n>.jpg` and `result.json`. The job id is 128 random bits and is
 * known only to the author who asked, which is what lets them read the result.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Beside the Series drafts when there is no folder of its own: production
 * shares `series-drafts` between the app copies and the Series worker, which
 * runs this queue too. Its jobs are one level deeper than a draft's, so the
 * Series queue never mistakes one for its own.
 */
export const coversRoot = () => {
  const env = globalThis.process?.env;
  if (env?.BOKS_COVERS_DIR) return env.BOKS_COVERS_DIR;
  if (env?.BOKS_SERIES_DIR) return join(env.BOKS_SERIES_DIR, "covers");
  return join(process.cwd(), ".boks-local", "covers");
};

export type CoverJob = { jobId: string; bokId: string; title: string; text: string; pictures: number; createdAt: string };
export type CoverResult =
  | { ok: true; pictures: { file: string; prompt: string }[]; seconds: number }
  | { ok: false; errorCode: "unavailable" | "refused" | "unexpected" };

export type CoverJobState =
  | { state: "queued" | "drawing" }
  | { state: "done"; pictures: string[] }
  | { state: "failed"; errorCode: string }
  | { state: "missing" };

const jobShape = /^[0-9a-f]{32}$/;
export const isCoverJobId = (id: string) => jobShape.test(id);
const pictureShape = /^picture-[12]\.jpg$/;
export const isCoverPicture = (name: string) => pictureShape.test(name);

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function writeJsonAtomically(path: string, value: unknown) {
  const temporary = `${path}.${randomHex(4)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`);
  await rename(temporary, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function queueCoverJob(input: Omit<CoverJob, "jobId" | "createdAt">): Promise<string> {
  const jobId = randomHex(16);
  const dir = join(coversRoot(), jobId);
  await mkdir(dir, { recursive: true });
  await writeJsonAtomically(join(dir, "job.json"), { ...input, jobId, createdAt: new Date().toISOString() } satisfies CoverJob);
  return jobId;
}

export async function coverJobState(jobId: string): Promise<CoverJobState> {
  if (!isCoverJobId(jobId)) return { state: "missing" };
  const dir = join(coversRoot(), jobId);
  const result = await readJson<CoverResult>(join(dir, "result.json"));
  if (result) {
    return result.ok
      ? { state: "done", pictures: result.pictures.map((picture) => `/api/author/covers/${jobId}/${picture.file}`) }
      : { state: "failed", errorCode: result.errorCode };
  }
  if (await readJson(join(dir, "job.processing"))) return { state: "drawing" };
  if (await readJson(join(dir, "job.json"))) return { state: "queued" };
  return { state: "missing" };
}

export async function readCoverPicture(jobId: string, name: string): Promise<Uint8Array | null> {
  if (!isCoverJobId(jobId) || !isCoverPicture(name)) return null;
  try {
    return new Uint8Array(await readFile(join(coversRoot(), jobId, name)));
  } catch {
    return null;
  }
}
