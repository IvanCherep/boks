import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "series-from-bok-"));
  process.env.BOKS_SERIES_DIR = root;
});
afterAll(async () => {
  delete process.env.BOKS_SERIES_DIR;
  await rm(root, { recursive: true, force: true });
});

const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array(28).fill(0)]);
const studio = { userId: "studio", admin: true };
const bokId = "00000000-0000-4000-8000-0000000000aa";
const source = { bokId, title: "Серия из голоса", text: "Первая строка.\nВторая строка.", byline: "Анна Тестова", draftId: null, voice: { file: "take-2.webm", durationMs: 61000 } };

describe("a Studio draft made from a piece in work", () => {
  it("carries the title, the text, the author's byline and the author's take", async () => {
    await mkdir(join(root, "voices", bokId), { recursive: true });
    await writeFile(join(root, "voices", bokId, "take-2.webm"), webm);
    const { draftFromBok } = await import("@/lib/boks/series-recorder/from-bok");
    const { draft, created } = await draftFromBok(studio, source);
    expect(created).toBe(true);
    expect(draft).toMatchObject({ title: "Серия из голоса", author: "Анна Тестова", text: source.text });
    expect(draft.takes).toEqual([expect.objectContaining({ file: "take-1.webm", durationMs: 61000 })]);
    expect(draft.chosenTake).toBe("take-1.webm");

    // Made once: the linked draft is opened again, not copied twice.
    const again = await draftFromBok(studio, { ...source, draftId: draft.id });
    expect(again).toMatchObject({ created: false, draft: { id: draft.id } });
  });

  it("is Studio's only, and needs the author's recording on this server", async () => {
    const { draftFromBok } = await import("@/lib/boks/series-recorder/from-bok");
    await expect(draftFromBok({ userId: "anna", admin: false }, source)).rejects.toMatchObject({ status: 403 });
    await expect(draftFromBok(studio, { ...source, voice: null })).rejects.toMatchObject({ status: 409 });
    await expect(draftFromBok(studio, { ...source, bokId: "00000000-0000-4000-8000-0000000000bb" })).rejects.toThrow(/not on this server/);
  });
});
