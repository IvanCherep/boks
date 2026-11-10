import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { curtainArtBox, curtainCardFor, curtainTitleLayout, jpegSize } from "./curtain";
import { curtainLoopUrl, storedCurtainPoster } from "./curtain-loop";

describe("curtain card", () => {
  const kosa = { id: "cc7e3800-3567-42c1-ba08-8554a345e25c", title: "коса", authorName: "Алексей Прохоров" };

  it("takes a registered cover and its hand-set window", () => {
    const card = curtainCardFor(kosa);
    expect(card.art).toBe("/share/art/prokhorov-kosa.jpg");
    expect(card.position).toBe("50% 82%");
    expect(card.key).toMatch(/^[0-9a-f]{8}$/);
  });

  it("has a plain ground and no byline line when there is neither", () => {
    const card = curtainCardFor({ id: "00000000-0000-4000-8000-000000000000", title: "Untitled", authorName: "  " });
    expect(card.art).toBeNull();
    expect(card.byline).toBeNull();
  });

  it("changes its key with anything drawn", () => {
    const key = curtainCardFor(kosa).key;
    expect(curtainCardFor({ ...kosa, title: "коса!" }).key).not.toBe(key);
    expect(curtainCardFor({ ...kosa, authorName: "А. Прохоров" }).key).not.toBe(key);
    expect(curtainCardFor({ ...kosa, title: "  коса " }).key).toBe(key);
  });

  it("fits a title on one line, else two, else cuts it", () => {
    expect(curtainTitleLayout("коса")).toEqual({ size: 106, lines: 1, text: "коса" });
    expect(curtainTitleLayout("из возвращения в побег").lines).toBe(1);
    const long = curtainTitleLayout("A very long title for a story that can wrap across two lines without losing the last word, and then some more words");
    expect(long.lines).toBe(2);
    expect(long.text.endsWith("…")).toBe(true);
    expect(curtainTitleLayout("Слишкомдлинноесловобезпробеловдляпроверкибезопасногопереносаещёдлиннее").text.endsWith("…")).toBe(true);
  });

  it("reads a cover's size and covers the window without empty edges", () => {
    expect(jpegSize(readFileSync("public/share/art/prokhorov-kosa.jpg"))).toEqual({ width: 720, height: 1280 });
    const box = curtainArtBox({ width: 720, height: 1280 }, { width: 980, height: 630 }, "50% 82%");
    expect(box.width).toBeGreaterThanOrEqual(980);
    expect(box.height + box.top).toBeGreaterThanOrEqual(630);
    expect(box.left + 0).toBe(0);
    expect(box.top).toBeLessThan(0);
  });

  it("takes a stored poster only when it is a whole JPEG", async () => {
    process.env.BOKS_LINK_ONLY_BASE_URL = "http://caddy:8082";
    const real = globalThis.fetch;
    const jpeg = new Uint8Array(2000);
    jpeg.set([0xff, 0xd8]);
    jpeg.set([0xff, 0xd9], 1998);
    try {
      let asked = "";
      globalThis.fetch = (async (url: string) => ((asked = String(url)), new Response(jpeg))) as typeof fetch;
      expect((await storedCurtainPoster(curtainCardFor(kosa)))?.length).toBe(2000);
      expect(asked).toMatch(/\/curtain\/cc7e3800-3567-42c1-ba08-8554a345e25c-[0-9a-f]{8}\.jpg$/);
      globalThis.fetch = (async () => new Response(jpeg.slice(0, 1500))) as typeof fetch;
      expect(await storedCurtainPoster(curtainCardFor(kosa))).toBeNull();
      globalThis.fetch = (async () => new Response("no", { status: 404 })) as typeof fetch;
      expect(await storedCurtainPoster(curtainCardFor(kosa))).toBeNull();
    } finally {
      globalThis.fetch = real;
      delete process.env.BOKS_LINK_ONLY_BASE_URL;
    }
  });

  it("names a stored loop only for a real id and key", () => {
    process.env.BOKS_LINK_ONLY_BASE_URL = "http://caddy:8082/";
    expect(curtainLoopUrl(curtainCardFor(kosa))).toMatch(/^http:\/\/caddy:8082\/curtain\/cc7e3800-3567-42c1-ba08-8554a345e25c-[0-9a-f]{8}\.mp4$/);
    expect(curtainLoopUrl({ id: "../x", key: "00000000" })).toBeNull();
    delete process.env.BOKS_LINK_ONLY_BASE_URL;
  });
});
