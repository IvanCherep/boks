import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The store reads its folder from the environment on every call.
let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "voice-store-"));
  process.env.BOKS_SERIES_DIR = root;
});
afterAll(async () => {
  delete process.env.BOKS_SERIES_DIR;
  await rm(root, { recursive: true, force: true });
});

const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array(28).fill(0)]);
const wav = new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt \0\0\0\0\0\0\0\0");
const anna = { userId: "anna-id", admin: false };
const boris = { userId: "boris-id", admin: false };
const studio = { userId: "studio-id", admin: true };
const fp = "0123456789abcdef";
const later = "fedcba9876543210";
let n = 0;
const bok = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const meta = (over: Record<string, unknown> = {}) => ({ extension: "webm", durationMs: 60000, source: "teleprompter", fingerprint: fp, ...over });

describe("a piece's takes", () => {
  it("take only audio, within 25 MB and 15 minutes, for a named text", async () => {
    const store = await import("@/lib/boks/author/voice/store");
    const id = bok();
    const html = new TextEncoder().encode("<html><body>not a recording at all</body></html>");
    await expect(store.addTake(anna, id, html, meta())).rejects.toMatchObject({ status: 415 });
    await expect(store.addTake(anna, id, webm, meta({ extension: null }))).rejects.toMatchObject({ status: 415 });
    await expect(store.addTake(anna, id, webm, meta({ durationMs: 15 * 60 * 1000 + 1 }))).rejects.toThrow(/15 minutes/);
    await expect(store.addTake(anna, id, webm, meta({ durationMs: 100 }))).rejects.toThrow(/too short/);
    await expect(store.addTake(anna, id, webm, meta({ source: "robot" }))).rejects.toMatchObject({ status: 400 });
    await expect(store.addTake(anna, id, webm, meta({ fingerprint: "nope" }))).rejects.toMatchObject({ status: 400 });
    await expect(store.addTake(anna, id, new Uint8Array(26 * 1024 * 1024), meta())).rejects.toMatchObject({ status: 413 });
    expect((await store.readTakes(anna, id)).takes).toHaveLength(0);
  });

  it("choose the newest take of a new text, keep a chosen take of the same text, and fall back on delete", async () => {
    const store = await import("@/lib/boks/author/voice/store");
    const id = bok();
    let takes = await store.addTake(anna, id, webm, meta());
    expect(takes.chosen).toBe("take-1.webm");
    takes = await store.addTake(anna, id, wav, meta({ extension: "wav", source: "upload", name: "  чтение.wav " }));
    expect(takes.chosen).toBe("take-1.webm"); // the same text: the chosen one stays
    expect(takes.takes[1]).toMatchObject({ file: "take-2.wav", source: "upload", name: "чтение.wav" });
    takes = await store.addTake(anna, id, webm, meta({ fingerprint: later }));
    expect(takes.chosen).toBe("take-3.webm"); // the text changed: the new take is chosen
    takes = await store.chooseTake(anna, id, "take-2.wav");
    expect(takes.chosen).toBe("take-2.wav");
    takes = await store.removeTake(anna, id, "take-2.wav", later);
    expect(takes.chosen).toBe("take-3.webm");
    await expect(store.chooseTake(anna, id, "take-9.webm")).rejects.toMatchObject({ status: 404 });
    expect(store.chosenTake(takes)?.fingerprint).toBe(later);
  });

  it("are their author's: another author is refused, Studio may listen but not change them", async () => {
    const store = await import("@/lib/boks/author/voice/store");
    const id = bok();
    await store.addTake(anna, id, webm, meta());
    await expect(store.readTakes(boris, id)).rejects.toMatchObject({ status: 403 });
    await expect(store.addTake(boris, id, webm, meta())).rejects.toMatchObject({ status: 403 });
    await expect(store.removeTake(boris, id, "take-1.webm")).rejects.toMatchObject({ status: 403 });
    await expect(store.takePath(boris, id, "take-1.webm")).rejects.toMatchObject({ status: 403 });
    expect((await store.readTakes(studio, id)).takes).toHaveLength(1);
    expect(await store.takePath(studio, id, "take-1.webm")).toMatch(/voices\/.*\/take-1\.webm$/);
    await expect(store.chooseTake(studio, id, "take-1.webm")).rejects.toMatchObject({ status: 403 });
    await expect(store.takePath(anna, id, "../draft.json")).rejects.toMatchObject({ status: 404 });
  });

  it("are at most five at a time", async () => {
    const store = await import("@/lib/boks/author/voice/store");
    const id = bok();
    for (let i = 0; i < 5; i += 1) await store.addTake(anna, id, webm, meta());
    await expect(store.addTake(anna, id, webm, meta())).rejects.toThrow(/At most 5 takes/);
    await expect(store.readTakes(anna, "not-a-bok")).rejects.toMatchObject({ status: 404 });
  });
});
