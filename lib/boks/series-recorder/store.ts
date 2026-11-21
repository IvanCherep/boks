import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { linesPerPicture } from "@/lib/boks/series-recorder/scene-plan";
import {
  canRegenerate,
  draftGaps,
  isImageFile,
  isSeriesDraftId,
  isTakeFile,
  poemLines,
  seriesLimits,
  type SeriesArtErrorCode,
  type SeriesArtJob,
  looksLikeAudio,
  type SeriesActor,
  type SeriesArtBudget,
  type SeriesArtStatus,
  type SeriesBuild,
  type SeriesBuildResult,
  type SeriesBuildStep,
  type SeriesDraft,
  type SeriesDraftData,
  type SeriesDraftStatus,
  type SeriesDraftSummary,
  type SeriesImage,
  type SeriesTake,
} from "@/lib/boks/series-recorder/rules";

/**
 * Series recorder drafts, on disk (`docs/series-recorder.md`).
 *
 * One folder a draft under `BOKS_SERIES_DIR`: `draft.json` (owned by the API
 * route), the takes and pictures, and the build's files. A build is a file
 * queue shared with the worker (`scripts/series-worker.mts`), which needs no
 * database: the route writes `job.json`; the worker renames it to
 * `job.processing`, writes `progress.json` as it goes and `result.json` at
 * the end. The beta is for the team only, so a folder is enough; drafts move
 * to the database when authors get the recorder.
 *
 * Pictures are made the same way: `art-job.json` → `art-job.processing` →
 * `art-result.json`, with the worker's pictures as `art-<job>-<k>.jpg`. The
 * worker never writes `draft.json`; the next read here takes the result in
 * (`takeArtResult`), naming the pictures as an upload would be named.
 */

export type SeriesJob = {
  jobId: string;
  token: string;
  /** What the build was made from, to tell a Series built from an older draft. */
  sourceHash: string;
  queuedAt: string;
  title: string;
  author: string;
  text: string;
  take: string;
  images: string[];
};

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A picture job as the worker reads it: what to draw and, for a generation, which lines each picture carries. */
export type SeriesArtTask = SeriesArtJob & { title: string; author: string; text: string; fragments: string[][] };

type ArtResult = {
  jobId: string;
  kind: "generate" | "regenerate";
  ok: boolean;
  file?: string;
  pictures?: { file: string; width: number; height: number; prompt: string }[];
  errorCode?: SeriesArtErrorCode;
};

export const seriesRoot = () => globalThis.process?.env?.BOKS_SERIES_DIR || join(process.cwd(), ".boks-local", "series");

export class SeriesStoreError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const folder = (id: string) => {
  if (!isSeriesDraftId(id)) throw new SeriesStoreError("No such draft.", 404);
  return join(seriesRoot(), id);
};

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Written beside and renamed over, so a reader never sees half a file. */
export async function writeJsonAtomically(path: string, value: unknown) {
  const temporary = `${path}.${randomHex(4)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`);
  await rename(temporary, path);
}

const exists = (path: string) => stat(path).then(() => true, () => false);

export function sourceHash(draft: Pick<SeriesDraftData, "title" | "author" | "text" | "chosenTake" | "images">) {
  return createHash("sha256")
    .update(JSON.stringify([draft.title, draft.author, draft.text, draft.chosenTake, draft.images.map((image) => image.file)]))
    .digest("hex")
    .slice(0, 16);
}

async function statusOf(data: SeriesDraftData): Promise<SeriesDraftStatus> {
  const dir = folder(data.id);
  const queued = await readJson<SeriesJob>(join(dir, "job.json"));
  if (queued) return { state: "queued", jobId: queued.jobId };
  const running = await readJson<SeriesJob>(join(dir, "job.processing"));
  if (running) {
    const progress = await readJson<{ jobId: string; step: SeriesBuildStep }>(join(dir, "progress.json"));
    return { state: "processing", jobId: running.jobId, step: progress?.jobId === running.jobId ? progress.step : null };
  }
  const failure = await readJson<SeriesBuildResult>(join(dir, "build-last.json"));
  const builds = data.builds ?? [];
  if (!builds.length) return failure ? { state: "failed", result: failure } : { state: "draft" };
  const kept = Math.min(data.keptBuild ?? builds.length - 1, builds.length - 1);
  return {
    state: "ready",
    result: builds[kept].result,
    builds,
    kept,
    stale: builds[kept].sourceHash !== sourceHash(data),
    ...(failure ? { failure } : {}),
  };
}

/**
 * A finished build, taken into the draft once (claimed by a rename, like the
 * pictures): a Series that built joins `builds` and is the one kept until
 * another is chosen; a failure is remembered beside them and counts for nothing.
 */
async function takeBuildResult(id: string) {
  const dir = folder(id);
  const claimed = join(dir, `result.${randomHex(4)}.taking`);
  try {
    await rename(join(dir, "result.json"), claimed);
  } catch {
    return;
  }
  const result = await readJson<SeriesBuildResult & { sourceHash?: string }>(claimed);
  await rm(claimed, { force: true });
  if (!result) return;
  if (!result.ok) {
    await writeJsonAtomically(join(dir, "build-last.json"), result);
    // The voice service or the worker failing is ours, not the author's: that attempt is given back.
    if (result.errorCode === "quota" || result.errorCode === "service" || result.errorCode === "unexpected" || !result.errorCode) {
      const data = await readStored(id);
      data.buildAttempts = Math.max(0, (data.buildAttempts ?? 0) - 1);
      await writeJsonAtomically(join(dir, "draft.json"), data);
    }
    return;
  }
  await rm(join(dir, "build-last.json"), { force: true });
  const data = await readStored(id);
  const { sourceHash: hash = "", ...built } = result;
  const builds: SeriesBuild[] = [...(data.builds ?? []).filter((b) => b.token !== built.token), { token: built.token!, result: built, sourceHash: hash }];
  data.builds = builds.slice(-seriesLimits.builds);
  data.keptBuild = data.builds.length - 1;
  data.token = built.token!;
  await writeJsonAtomically(join(dir, "draft.json"), data);
}

async function readStored(id: string) {
  const data = await readJson<SeriesDraftData>(join(folder(id), "draft.json"));
  if (!data) throw new SeriesStoreError("No such draft.", 404);
  return data;
}

async function readData(id: string) {
  await takeArtResult(id);
  await takeBuildResult(id);
  return readStored(id);
}

/** A slot's own name: its first version, which stays however the picture is switched. */
const slotOf = (image: SeriesImage) => image.versions?.[0]?.file ?? image.file;
const versionsOf = (image: SeriesImage) => image.versions ?? [{ file: image.file, width: image.width, height: image.height }];

/**
 * The worker's pictures, taken into the draft once: the result is claimed by
 * a rename, so of two app copies reading at once only one takes it in.
 */
async function takeArtResult(id: string) {
  const dir = folder(id);
  const claimed = join(dir, `art-result.${randomHex(4)}.taking`);
  try {
    await rename(join(dir, "art-result.json"), claimed);
  } catch {
    return;
  }
  const result = await readJson<ArtResult>(claimed);
  await rm(claimed, { force: true });
  if (!result) return;
  if (!result.ok) {
    // Nothing was drawn, so nothing of the allowance is spent.
    await writeJsonAtomically(join(dir, "art-last.json"), { errorCode: result.errorCode ?? "unexpected" });
    return;
  }
  await rm(join(dir, "art-last.json"), { force: true });
  const data = await readStored(id);
  // Every picture drawn is spent, even one there was no room left for.
  data.artUsed = (data.artUsed ?? 0) + (result.pictures?.length ?? 0);
  const taken = [...data.images.flatMap((image) => versionsOf(image).map((v) => v.file))];
  const place = async (picture: NonNullable<ArtResult["pictures"]>[number]) => {
    const file = `image-${nextNumber(taken, "image-")}.jpg`;
    taken.push(file);
    await rename(join(dir, picture.file), join(dir, file));
    return { file, width: picture.width, height: picture.height };
  };
  if (result.kind === "generate") {
    for (const picture of result.pictures ?? []) {
      if (data.images.length >= seriesLimits.images) {
        await rm(join(dir, picture.file), { force: true });
        continue;
      }
      const version = await place(picture);
      data.images.push({ ...version, source: "generated", prompt: picture.prompt, versions: [version] });
    }
  } else {
    const image = data.images.find((candidate) => slotOf(candidate) === result.file);
    const picture = result.pictures?.[0];
    if (image && picture) {
      const version = await place(picture);
      image.versions = [...versionsOf(image), version];
      // The new drawing is shown; the earlier one stays a switch away.
      Object.assign(image, version);
    } else if (picture) await rm(join(dir, picture.file), { force: true });
  }
  data.updatedAt = new Date().toISOString();
  await writeJsonAtomically(join(dir, "draft.json"), data);
}

async function artOf(id: string): Promise<SeriesArtStatus> {
  const dir = folder(id);
  for (const [name, state] of [["art-job.json", "queued"], ["art-job.processing", "drawing"]] as const) {
    const job = await readJson<SeriesArtJob>(join(dir, name));
    if (job) return job.kind === "generate" ? { state, kind: "generate", count: job.count } : { state, kind: "regenerate", file: job.file };
  }
  const last = await readJson<{ errorCode: SeriesArtErrorCode }>(join(dir, "art-last.json"));
  return last ? { state: "idle", error: last.errorCode } : { state: "idle" };
}

/** What a draft has drawn and may still draw, counting the pictures being drawn now. */
async function budgetOf(data: SeriesDraftData, art?: SeriesArtStatus): Promise<SeriesArtBudget> {
  const status = art ?? (await artOf(data.id));
  const drawing = status.state === "idle" ? 0 : status.kind === "generate" ? status.count : 1;
  const limit = data.artAllowance ?? seriesLimits.artBudget;
  const used = (data.artUsed ?? 0) + drawing;
  return { used, limit, left: Math.max(0, limit - used) };
}

/**
 * A draft as its owner or Studio may touch it. Anyone else is told there is
 * no such draft - not that it is someone else's.
 */
async function readOwned(actor: SeriesActor, id: string) {
  const data = await readData(id);
  if (!actor.admin && (data.ownerId ?? null) !== actor.userId) throw new SeriesStoreError("No such draft.", 404);
  return data;
}

export async function readDraft(actor: SeriesActor, id: string): Promise<SeriesDraft> {
  await readOwned(actor, id);
  return view(id);
}

async function view(id: string): Promise<SeriesDraft> {
  const data = await readData(id);
  const art = await artOf(id);
  // The picture prompts stay on the server: the look is the house's, not the author's to edit or read.
  const images = data.images.map((image) => {
    const shown = { ...image };
    delete shown.prompt;
    return shown;
  });
  return { ...data, images, status: await statusOf(data), art, artBudget: await budgetOf(data, art) };
}

/** The caller's drafts; Studio sees everyone's, except in its own cabinet (`mine`). */
export async function listDrafts(actor: SeriesActor, { mine = false } = {}): Promise<SeriesDraftSummary[]> {
  await mkdir(seriesRoot(), { recursive: true });
  const ids = (await readdir(seriesRoot())).filter(isSeriesDraftId);
  const drafts = await Promise.all(ids.map(async (id) => {
    const data = await readOwned(actor, id).catch(() => null);
    if (!data || (mine && (data.ownerId ?? null) !== actor.userId)) return null;
    return view(id).catch(() => null);
  }));
  return drafts
    .filter((draft): draft is SeriesDraft => Boolean(draft))
    .map((draft) => ({
      id: draft.id,
      title: draft.title,
      author: draft.author,
      updatedAt: draft.updatedAt,
      token: draft.token,
      ownerHandle: draft.ownerHandle ?? null,
      takes: draft.takes.length,
      images: draft.images.length,
      status: draft.status.state,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function cleanText(input: unknown, limit: number, what: string) {
  if (typeof input !== "string") throw new SeriesStoreError(`${what} must be text.`, 400);
  if (input.length > limit) throw new SeriesStoreError(`${what} is longer than ${limit} characters.`, 400);
  return input;
}

function checkText(text: string) {
  if (poemLines(text).lines.length > seriesLimits.lines) throw new SeriesStoreError(`A poem of at most ${seriesLimits.lines} lines.`, 400);
  return text;
}

/** A new draft, its owner's. Spending one of the author's Series is the caller's (the API route asks the database). */
export async function createDraft(actor: SeriesActor, input: { title?: unknown; author?: unknown; text?: unknown }) {
  const now = new Date().toISOString();
  const data: SeriesDraftData = {
    id: randomHex(8),
    title: cleanText(input.title ?? "", seriesLimits.titleChars, "The title").trim(),
    // An author's Series is signed with their own name; only Studio writes a
    // byline, and it starts as Studio's own name too: people mostly record
    // their own work. It stays editable.
    author: actor.admin
      ? cleanText(input.author ?? actor.ownName ?? "", seriesLimits.authorChars, "The author").trim()
      : (actor.authorName ?? "").slice(0, seriesLimits.authorChars),
    text: checkText(cleanText(input.text ?? "", seriesLimits.textChars, "The text")),
    takes: [],
    images: [],
    chosenTake: null,
    token: null,
    ownerId: actor.userId,
    ownerHandle: actor.handle ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(folder(data.id), { recursive: true });
  await writeJsonAtomically(join(folder(data.id), "draft.json"), data);
  return view(data.id);
}

/** Title, author, text, the chosen take, and which version of a generated picture is shown. */
export async function updateDraft(actor: SeriesActor, id: string, patch: Record<string, unknown>) {
  const data = await readOwned(actor, id);
  const next: SeriesDraftData = { ...data };
  if ("title" in patch) next.title = cleanText(patch.title, seriesLimits.titleChars, "The title").trim();
  if ("author" in patch && actor.admin) next.author = cleanText(patch.author, seriesLimits.authorChars, "The author").trim();
  if ("text" in patch) next.text = checkText(cleanText(patch.text, seriesLimits.textChars, "The text"));
  if ("chosenTake" in patch) {
    const take = patch.chosenTake;
    if (take !== null && (typeof take !== "string" || !data.takes.some((t) => t.file === take))) throw new SeriesStoreError("No such take.", 400);
    next.chosenTake = take as string | null;
  }
  if ("keepBuild" in patch) {
    const index = Number(patch.keepBuild);
    const build = next.builds?.[index];
    if (!Number.isInteger(index) || !build) throw new SeriesStoreError("No such build.", 400);
    next.keptBuild = index;
    next.token = build.token;
  }
  if ("showImage" in patch) {
    const file = patch.showImage;
    const image = next.images.find((candidate) => versionsOf(candidate).some((version) => version.file === file));
    if (typeof file !== "string" || !image) throw new SeriesStoreError("No such picture.", 400);
    Object.assign(image, versionsOf(image).find((version) => version.file === file)!);
  }
  next.updatedAt = new Date().toISOString();
  await writeJsonAtomically(join(folder(id), "draft.json"), next);
  return view(id);
}

export async function deleteDraft(actor: SeriesActor, id: string) {
  await readOwned(actor, id);
  const dir = folder(id);
  if (await exists(join(dir, "job.processing"))) throw new SeriesStoreError("The draft is being built. Wait for the build to finish.", 409);
  await rm(dir, { recursive: true, force: true });
}

const nextNumber = (files: string[], prefix: string) =>
  files.reduce((top, file) => Math.max(top, Number(file.slice(prefix.length).split(".")[0]) || 0), 0) + 1;

/** A new take or picture. Its name is chosen here; the browser only says what kind it is. */
export async function addFile(
  actor: SeriesActor,
  id: string,
  kind: "take" | "image",
  bytes: Uint8Array,
  meta: { extension?: string; durationMs?: number; width?: number; height?: number },
) {
  const data = await readOwned(actor, id);
  const dir = folder(id);
  if (kind === "take") {
    if (data.takes.length >= seriesLimits.takes) throw new SeriesStoreError(`At most ${seriesLimits.takes} takes. Delete one first.`, 409);
    if (bytes.byteLength > seriesLimits.takeBytes) throw new SeriesStoreError("The take is too large.", 413);
    const durationMs = Math.round(Number(meta.durationMs));
    if (!Number.isFinite(durationMs) || durationMs < 500 || durationMs > seriesLimits.takeMs) throw new SeriesStoreError("The take's length is out of range.", 400);
    if (!actor.admin && (data.takeUploads ?? data.takes.length) >= seriesLimits.takeUploads) {
      throw new SeriesStoreError(`At most ${seriesLimits.takeUploads} takes for one Series. Choose among the ones you have.`, 409);
    }
    const file = `take-${nextNumber(data.takes.map((t) => t.file), "take-")}.${meta.extension}`;
    if (!isTakeFile(file)) throw new SeriesStoreError("This kind of recording is not accepted.", 415);
    if (!looksLikeAudio(bytes, meta.extension ?? "")) throw new SeriesStoreError("This file is not a recording we can read.", 415);
    await writeFile(join(dir, file), bytes);
    const take: SeriesTake = { file, durationMs, bytes: bytes.byteLength, createdAt: new Date().toISOString() };
    const fresh = await readData(id);
    fresh.takes = [...fresh.takes, take];
    fresh.takeUploads = (fresh.takeUploads ?? fresh.takes.length - 1) + 1;
    // The first take is the chosen one until another is chosen.
    fresh.chosenTake = fresh.chosenTake ?? file;
    fresh.updatedAt = take.createdAt;
    await writeJsonAtomically(join(dir, "draft.json"), fresh);
  } else {
    // An author's pictures are drawn here (Generate); uploading one's own is Studio's (owner's decision, 2026-11-21).
    if (!actor.admin) throw new SeriesStoreError("Pictures are drawn by boks: generate them here.", 403);
    if (data.images.length >= seriesLimits.images) throw new SeriesStoreError(`At most ${seriesLimits.images} pictures. Delete one first.`, 409);
    if (bytes.byteLength > seriesLimits.imageBytes) throw new SeriesStoreError("The picture is too large.", 413);
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isJpeg) throw new SeriesStoreError("Pictures arrive as JPEG.", 415);
    const width = Math.round(Number(meta.width));
    const height = Math.round(Number(meta.height));
    if (!(width > 0 && height > 0 && width <= 4096 && height <= 4096)) throw new SeriesStoreError("The picture's size is out of range.", 400);
    const file = `image-${nextNumber(data.images.flatMap((i) => versionsOf(i).map((v) => v.file)), "image-")}.jpg`;
    await writeFile(join(dir, file), bytes);
    const image: SeriesImage = { file, width, height, source: "upload" };
    const fresh = await readData(id);
    fresh.images = [...fresh.images, image];
    fresh.updatedAt = new Date().toISOString();
    await writeJsonAtomically(join(dir, "draft.json"), fresh);
  }
  return view(id);
}

export async function removeFile(actor: SeriesActor, id: string, file: string) {
  if (!isTakeFile(file) && !isImageFile(file)) throw new SeriesStoreError("No such file.", 404);
  const data = await readOwned(actor, id);
  if (await exists(join(folder(id), "job.processing"))) throw new SeriesStoreError("The draft is being built. Wait for the build to finish.", 409);
  const image = data.images.find((candidate) => versionsOf(candidate).some((version) => version.file === file));
  if (image && (await exists(join(folder(id), "art-job.processing")))) {
    const running = await readJson<SeriesArtJob>(join(folder(id), "art-job.processing"));
    if (running?.kind === "regenerate" && running.file === slotOf(image)) throw new SeriesStoreError("This picture is being drawn again. Wait a moment.", 409);
  }
  // A picture goes with every version of it.
  const files = image ? versionsOf(image).map((version) => version.file) : [file];
  data.takes = data.takes.filter((take) => take.file !== file);
  data.images = data.images.filter((candidate) => candidate !== image);
  if (data.chosenTake === file) data.chosenTake = data.takes.at(-1)?.file ?? null;
  data.updatedAt = new Date().toISOString();
  await writeJsonAtomically(join(folder(id), "draft.json"), data);
  await Promise.all(files.map((name) => rm(join(folder(id), name), { force: true })));
  return view(id);
}

export async function filePath(actor: SeriesActor, id: string, file: string) {
  if (!isTakeFile(file) && !isImageFile(file)) throw new SeriesStoreError("No such file.", 404);
  const data = await readOwned(actor, id);
  if (!data.takes.some((take) => take.file === file) && !data.images.some((image) => versionsOf(image).some((version) => version.file === file))) {
    throw new SeriesStoreError("No such file.", 404);
  }
  return join(folder(id), file);
}

/** Put the draft in the worker's queue. Its link stays the same across builds. */
export async function queueBuild(actor: SeriesActor, id: string) {
  const data = await readOwned(actor, id);
  const gaps = draftGaps(data);
  if (gaps.length) throw new SeriesStoreError(`Not ready to build: ${gaps.join(", ")}.`, 409);
  const dir = folder(id);
  if ((await exists(join(dir, "job.json"))) || (await exists(join(dir, "job.processing")))) {
    throw new SeriesStoreError("This draft is already being built.", 409);
  }
  if (await artPending(dir)) throw new SeriesStoreError("Pictures are still being drawn. Build when they are in.", 409);
  await rm(join(dir, "build-last.json"), { force: true });
  const builds = data.builds ?? [];
  if (builds.length >= seriesLimits.builds) throw new SeriesStoreError("This Series has had its rebuild. Choose which version stays.", 409);
  if (!actor.admin && (data.buildAttempts ?? 0) >= seriesLimits.buildAttempts) {
    throw new SeriesStoreError("This Series has used all its builds. Write to us and we will help.", 409);
  }
  data.buildAttempts = (data.buildAttempts ?? 0) + 1;
  await writeJsonAtomically(join(dir, "draft.json"), data);
  // Each build its own link-only folder, so both versions stay to compare;
  // the link-only token is 128 random bits of base64url (`lib/boks/link-only.ts`).
  // A first build that failed reuses the token it was given.
  const token = builds.length === 0 && data.token ? data.token : randomToken();
  if (builds.length === 0 && !data.token) {
    data.token = token;
    await writeJsonAtomically(join(dir, "draft.json"), data);
  }
  const job: SeriesJob = {
    jobId: randomHex(6),
    token,
    sourceHash: sourceHash(data),
    queuedAt: new Date().toISOString(),
    title: data.title,
    author: data.author,
    text: data.text,
    take: data.chosenTake!,
    images: data.images.map((image) => image.file),
  };
  await writeJsonAtomically(join(dir, "job.json"), job);
  return view(id);
}

const artPending = async (dir: string) => (await exists(join(dir, "art-job.json"))) || (await exists(join(dir, "art-job.processing")));

async function queueArt(id: string, data: SeriesDraftData, job: SeriesArtJob, fragments: string[][]) {
  const dir = folder(id);
  if (await artPending(dir)) throw new SeriesStoreError("Pictures are already being drawn.", 409);
  if (await exists(join(dir, "job.processing"))) throw new SeriesStoreError("The draft is being built. Wait for the build to finish.", 409);
  await rm(join(dir, "art-last.json"), { force: true });
  const task: SeriesArtTask = { ...job, title: data.title, author: data.author, text: data.text, fragments };
  await writeJsonAtomically(join(dir, "art-job.json"), task);
  return view(id);
}

/**
 * Draw `count` new pictures, added after the ones there are. Each is drawn
 * from the lines it will carry: the poem is shared between all the pictures
 * it will then have (`linesPerPicture`), and the new ones take the last runs.
 */
export async function generateImages(actor: SeriesActor, id: string, count: unknown) {
  const data = await readOwned(actor, id);
  const room = seriesLimits.images - data.images.length;
  const wanted = Number(count);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > seriesLimits.generate) throw new SeriesStoreError(`From 1 to ${seriesLimits.generate} pictures at a time.`, 400);
  if (wanted > room) throw new SeriesStoreError(`Room for ${room} more ${room === 1 ? "picture" : "pictures"}.`, 409);
  const budget = await budgetOf(data);
  if (wanted > budget.left) throw new SeriesStoreError(`This Series may have ${budget.left} more ${budget.left === 1 ? "picture" : "pictures"} drawn (${budget.limit} in all).`, 409);
  const { lines, stanzas } = poemLines(data.text);
  if (!lines.length) throw new SeriesStoreError("Add the text first: the pictures are drawn from it.", 409);
  const sizes = linesPerPicture(stanzas, data.images.length + wanted);
  const runs: string[][] = [];
  let cursor = 0;
  for (const size of sizes) {
    runs.push(lines.slice(cursor, cursor + size));
    cursor += size;
  }
  const fragments = runs.slice(data.images.length);
  if (!fragments.length) throw new SeriesStoreError("The poem has no lines left for another picture.", 409);
  return queueArt(id, data, { jobId: randomHex(6), kind: "generate", count: fragments.length, prompts: null }, fragments);
}

/** Draw a generated picture once more from the same description; the earlier version is kept. */
export async function regenerateImage(actor: SeriesActor, id: string, file: unknown) {
  const data = await readOwned(actor, id);
  const image = data.images.find((candidate) => versionsOf(candidate).some((version) => version.file === file));
  if (!image) throw new SeriesStoreError("No such picture.", 404);
  if (!canRegenerate(image) || !image.prompt) throw new SeriesStoreError("This picture cannot be drawn again.", 409);
  const budget = await budgetOf(data);
  if (budget.left < 1) throw new SeriesStoreError(`This Series has had all ${budget.limit} of its pictures drawn.`, 409);
  return queueArt(id, data, { jobId: randomHex(6), kind: "regenerate", file: slotOf(image), prompt: image.prompt }, []);
}

/**
 * What goes onto the author's page: the kept build's recording, with the
 * title and text it was built from. A draft changed since that build would
 * put words on the page the recording does not say, so it is refused.
 */
export async function publicationOf(actor: SeriesActor, id: string) {
  const data = await readOwned(actor, id);
  const status = await statusOf(data);
  if (status.state !== "ready") throw new SeriesStoreError("Build the Series first.", 409);
  if (status.stale) throw new SeriesStoreError("The draft changed after this build. Rebuild it, or put it back as it was.", 409);
  const kept = status.builds[status.kept];
  return { title: data.title, text: data.text, author: data.author, token: kept.token, bokId: data.published?.bokId ?? null, handle: data.published?.handle ?? null };
}

export async function markPublished(actor: SeriesActor, id: string, bokId: string, token: string, handle: string | null = null) {
  const data = await readOwned(actor, id);
  data.published = { bokId, token, at: new Date().toISOString(), ...(handle ? { handle } : {}) };
  await writeJsonAtomically(join(folder(id), "draft.json"), data);
  return view(id);
}
