import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The store reads its folder from the environment on every call.
let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "series-store-"));
  process.env.BOKS_SERIES_DIR = root;
});
afterAll(async () => {
  delete process.env.BOKS_SERIES_DIR;
  await rm(root, { recursive: true, force: true });
});

const poem = Array.from({ length: 16 }, (_, i) => `строка ${i + 1}`).join("\n");
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
/** The first bytes of a WebM file, which is what the recorder makes in Chrome. */
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array(28).fill(0)]);
const studio = { userId: "studio", admin: true };
const anna = { userId: "anna-id", admin: false, handle: "anna", authorName: "Анна Ахматова" };
const boris = { userId: "boris-id", admin: false, handle: "boris" };

/** What the worker leaves behind: pictures as art-<job>-<k>.jpg and the result beside them. */
async function finishArt(id: string, ok: boolean, count: number, file?: string) {
  const dir = join(root, id);
  const job = (await readdir(dir)).includes("art-job.json") ? "art-job.json" : "art-job.processing";
  const { jobId, kind } = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, job), "utf8"));
  const pictures = [];
  for (let k = 1; ok && k <= count; k += 1) {
    await writeFile(join(dir, `art-${jobId}-${k}.jpg`), jpeg);
    pictures.push({ file: `art-${jobId}-${k}.jpg`, width: 768, height: 1344, prompt: `сцена ${k}` });
  }
  await rm(join(dir, job));
  await writeFile(join(dir, "art-result.json"), JSON.stringify(ok ? { jobId, kind, ok, file, pictures } : { jobId, kind, ok, errorCode: "unavailable" }));
}

describe("the picture allowance of a Series", () => {
  it("counts every picture drawn, redraws too, and stops at eight", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const draft = await store.createDraft(studio, { title: "Т", text: poem });
    expect(draft.artBudget).toEqual({ used: 0, limit: 8, left: 8 });

    await store.generateImages(studio, draft.id, 4);
    expect((await store.readDraft(studio, draft.id)).artBudget.used).toBe(4); // being drawn counts already
    await finishArt(draft.id, true, 4);
    let read = await store.readDraft(studio, draft.id);
    expect(read.images).toHaveLength(4);
    expect(read.artBudget).toEqual({ used: 4, limit: 8, left: 4 });

    // Each of the four drawn again: eight in all.
    for (const image of read.images) {
      await store.regenerateImage(studio, draft.id, image.file);
      await finishArt(draft.id, true, 1, image.file);
    }
    read = await store.readDraft(studio, draft.id);
    expect(read.artBudget.left).toBe(0);
    expect(read.images.every((image) => image.versions?.length === 2)).toBe(true);

    // Deleting gives nothing back, and nothing more may be drawn.
    await store.removeFile(studio, draft.id, read.images[0].file);
    await expect(store.generateImages(studio, draft.id, 1)).rejects.toThrow(/0 more/);
  });

  it("spends nothing when the drawing fails", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const draft = await store.createDraft(studio, { title: "Т", text: poem });
    await store.generateImages(studio, draft.id, 3);
    await finishArt(draft.id, false, 3);
    const read = await store.readDraft(studio, draft.id);
    expect(read.artBudget.used).toBe(0);
    expect(read.art).toEqual({ state: "idle", error: "unavailable" });
  });

  it("refuses more than four at a time, or more than the allowance left", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const draft = await store.createDraft(studio, { title: "Т", text: poem });
    await expect(store.generateImages(studio, draft.id, 5)).rejects.toThrow(/1 to 4/);
  });
});

describe("the builds of a Series", () => {
  /** What the worker leaves behind for a build: result.json, the job gone. */
  async function finishBuild(id: string, ok: boolean) {
    const { readFile } = await import("node:fs/promises");
    const dir = join(root, id);
    const job = JSON.parse(await readFile(join(dir, "job.json"), "utf8"));
    await rm(join(dir, "job.json"));
    await writeFile(join(dir, "result.json"), JSON.stringify(ok
      ? { jobId: job.jobId, ok, finishedAt: new Date().toISOString(), token: job.token, durationMs: 60000, scenes: 1, sourceHash: job.sourceHash }
      : { jobId: job.jobId, ok, finishedAt: new Date().toISOString(), errorCode: "quota" }));
    return job.token as string;
  }

  async function readyDraft() {
    const store = await import("@/lib/boks/series-recorder/store");
    const draft = await store.createDraft(studio, { title: "Т", text: poem });
    await store.addFile(studio, draft.id, "take", webm, { extension: "webm", durationMs: 60000 });
    await store.addFile(studio, draft.id, "image", jpeg, { width: 768, height: 1344 });
    return { store, id: draft.id };
  }

  it("keeps two versions, each with its own link, and lets one be chosen", async () => {
    const { store, id } = await readyDraft();
    await store.queueBuild(studio, id);
    const first = await finishBuild(id, true);
    await store.queueBuild(studio, id);
    const second = await finishBuild(id, true);
    expect(first).not.toBe(second);

    let read = await store.readDraft(studio, id);
    if (read.status.state !== "ready") throw new Error("not ready");
    expect(read.status.builds.map((b) => b.token)).toEqual([first, second]);
    expect(read.token).toBe(second); // the newest stays until another is chosen

    await expect(store.queueBuild(studio, id)).rejects.toThrow(/rebuild/);
    read = await store.updateDraft(studio, id, { keepBuild: 0 });
    expect(read.token).toBe(first);
  });

  it("does not count a build that failed", async () => {
    const { store, id } = await readyDraft();
    await store.queueBuild(studio, id);
    await finishBuild(id, false);
    const failed = await store.readDraft(studio, id);
    expect(failed.status.state).toBe("failed");
    await store.queueBuild(studio, id);
    await finishBuild(id, true);
    await store.queueBuild(studio, id); // the rebuild is still there
    await finishBuild(id, true);
    const read = await store.readDraft(studio, id);
    expect(read.status.state === "ready" && read.status.builds.length).toBe(2);
  });

  it("never hands the picture prompts to the page", async () => {
    const { store, id } = await readyDraft();
    await store.generateImages(studio, id, 1);
    await finishArt(id, true, 1);
    const read = await store.readDraft(studio, id);
    expect(read.images.some((image) => "prompt" in image)).toBe(false);
  });
});

describe("Studio's new drafts", () => {
  it("start signed with the recorder's own name, still editable", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const kurnosov = { ...studio, userId: "kurnosov", ownName: "Андрей Курносов", authorName: "Андрей Курносов" };
    const draft = await store.createDraft(kurnosov, { title: "Т", text: poem });
    expect(draft.author).toBe("Андрей Курносов");
    expect((await store.updateDraft(kurnosov, draft.id, { author: "Другой автор" })).author).toBe("Другой автор");
    expect((await store.createDraft(kurnosov, { title: "Т", author: "Названный", text: poem })).author).toBe("Названный");
  });

  it("start empty for an account with no name of its own (the catalogue's borrowed bylines are not one)", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const catalogue = { ...studio, userId: "boks", ownName: null, authorName: "Thomas Hardy" };
    expect((await store.createDraft(catalogue, { title: "Т", text: poem })).author).toBe("");
  });
});

describe("an author's own drafts", () => {
  it("are signed with the author's own name, whatever is sent", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const draft = await store.createDraft(anna, { title: "Т", author: "Кто-то другой", text: poem });
    expect(draft.author).toBe("Анна Ахматова");
    expect((await store.updateDraft(anna, draft.id, { author: "Подмена" })).author).toBe("Анна Ахматова");
    expect((await store.updateDraft(studio, draft.id, { author: "Редакция" })).author).toBe("Редакция"); // Studio may sign as it likes
  });

  it("are theirs alone: another author is told there is no such draft", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const draft = await store.createDraft(anna, { title: "Её", text: poem });
    expect(draft.ownerHandle).toBe("anna");
    await expect(store.readDraft(boris, draft.id)).rejects.toThrow(/No such draft/);
    await expect(store.updateDraft(boris, draft.id, { title: "Чужое" })).rejects.toThrow(/No such draft/);
    await expect(store.deleteDraft(boris, draft.id)).rejects.toThrow(/No such draft/);
    await expect(store.generateImages(boris, draft.id, 1)).rejects.toThrow(/No such draft/);
    expect((await store.listDrafts(boris)).some((d) => d.id === draft.id)).toBe(false);
    expect((await store.listDrafts(anna)).some((d) => d.id === draft.id)).toBe(true);
    expect((await store.readDraft(studio, draft.id)).title).toBe("Её"); // Studio sees every draft
  });

  it("take only audio, and only so many of it", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const draft = await store.createDraft(anna, { title: "Т", text: poem });
    const html = new TextEncoder().encode("<html><body>not a recording at all</body></html>");
    await expect(store.addFile(anna, draft.id, "take", html, { extension: "webm", durationMs: 60000 })).rejects.toThrow(/not a recording/);
    const { seriesLimits } = await import("@/lib/boks/series-recorder/rules");
    let read = await store.readDraft(anna, draft.id);
    for (let i = 0; i < seriesLimits.takeUploads; i += 1) {
      read = await store.addFile(anna, draft.id, "take", webm, { extension: "webm", durationMs: 60000 });
      if (read.takes.length >= seriesLimits.takes) read = await store.removeFile(anna, draft.id, read.takes[0].file);
    }
    await expect(store.addFile(anna, draft.id, "take", webm, { extension: "webm", durationMs: 60000 })).rejects.toThrow(/At most 20 takes/);
  });

  it("build only so many times, a failure of the voice service given back", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const { readFile } = await import("node:fs/promises");
    const draft = await store.createDraft(anna, { title: "Т", text: poem });
    await store.addFile(anna, draft.id, "take", webm, { extension: "webm", durationMs: 60000 });
    await store.generateImages(anna, draft.id, 1); // an author's pictures are drawn, not uploaded
    await finishArt(draft.id, true, 1);
    const fail = async (errorCode: string) => {
      const dir = join(root, draft.id);
      const job = JSON.parse(await readFile(join(dir, "job.json"), "utf8"));
      await rm(join(dir, "job.json"));
      await writeFile(join(dir, "result.json"), JSON.stringify({ jobId: job.jobId, ok: false, finishedAt: new Date().toISOString(), errorCode }));
      await store.readDraft(anna, draft.id);
    };
    await store.queueBuild(anna, draft.id);
    await fail("quota"); // ours: not counted
    for (let i = 0; i < 6; i += 1) {
      await store.queueBuild(anna, draft.id);
      await fail("mismatch");
    }
    await expect(store.queueBuild(anna, draft.id)).rejects.toThrow(/used all its builds/);
    await store.queueBuild(studio, draft.id); // Studio has no ceiling
  });

  it("draw their pictures and may not upload their own; Studio may", async () => {
    const store = await import("@/lib/boks/series-recorder/store");
    const draft = await store.createDraft(anna, { title: "Т", text: poem });
    await expect(store.addFile(anna, draft.id, "image", jpeg, { width: 768, height: 1344 }))
      .rejects.toMatchObject({ status: 403, message: expect.stringMatching(/generate them here/) });
    expect((await store.readDraft(anna, draft.id)).images).toHaveLength(0);

    // Everything else about pictures and builds stays the author's.
    await store.generateImages(anna, draft.id, 2);
    await finishArt(draft.id, true, 2);
    let read = await store.readDraft(anna, draft.id);
    await store.regenerateImage(anna, draft.id, read.images[0].file);
    await finishArt(draft.id, true, 1, read.images[0].file);
    read = await store.readDraft(anna, draft.id);
    read = await store.updateDraft(anna, draft.id, { showImage: read.images[0].versions![0].file });
    read = await store.removeFile(anna, draft.id, read.images[1].file);
    expect(read.images).toHaveLength(1);

    read = await store.addFile(studio, draft.id, "image", jpeg, { width: 768, height: 1344 });
    expect(read.images.map((image) => image.source)).toEqual(["generated", "upload"]);
  });
});
