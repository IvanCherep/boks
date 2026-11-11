import { afterEach, describe, expect, it, vi } from "vitest";
import { positionFrom, ribbonCardForAuthor, ribbonCardForBok, ribbonFileUrl, ribbonJobCard } from "./ribbon";

describe("ribbon card", () => {
  const rozy = { id: "4eb182a0-770e-4b95-9059-07a31b229d78", title: "розы  Сарагосы", authorName: "Алексей Прохоров" };
  afterEach(() => vi.unstubAllEnvs());

  it("takes the bok's cover and the curtain's hand-set window", () => {
    const card = ribbonCardForBok(rozy);
    expect(card).toMatchObject({ kind: "work", ref: rozy.id, title: "розы Сарагосы", byline: "Алексей Прохоров", art: "/share/art/prokhorov-rozy-saragosy.jpg", position: { x: 0.5, y: 0.42 } });
    expect(card.key).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes its key with anything drawn", () => {
    const key = ribbonCardForBok(rozy).key;
    expect(ribbonCardForBok({ ...rozy, title: "розы" }).key).not.toBe(key);
    expect(ribbonCardForBok({ ...rozy, authorName: "А. П." }).key).not.toBe(key);
    expect(ribbonCardForBok(rozy).key).toBe(key);
  });

  it("gives a bok without a cover the plain ground and an empty byline", () => {
    const card = ribbonCardForBok({ id: "00000000-0000-4000-8000-000000000000", title: "Без обложки", authorName: null });
    expect(card.art).toBeNull();
    expect(card.byline).toBe("");
  });

  it("gives an author a registered picture, else their photo, else nothing", () => {
    expect(ribbonCardForAuthor({ handle: "prokhorov", name: "Алексей Прохоров" })).toMatchObject({ kind: "author", title: "Алексей Прохоров", byline: "@prokhorov", art: expect.stringMatching(/^\/l\/.+-ribbon-art\.jpg$/) });
    expect(ribbonCardForAuthor({ handle: "someone", name: "Кто-то", photoVersion: 3 })?.art).toBe("/a/someone/photo?v=3");
    expect(ribbonCardForAuthor({ handle: "someone", name: "Кто-то" })).toBeNull();
  });

  it("reads object-position, falling back to the centre", () => {
    expect(positionFrom("50% 82%")).toEqual({ x: 0.5, y: 0.82 });
    expect(positionFrom("center")).toEqual({ x: 0.5, y: 0.5 });
  });

  it("names its stored files after kind, ref and key, and tells the job the name", () => {
    vi.stubEnv("BOKS_LINK_ONLY_BASE_URL", "http://caddy:8082/");
    const card = ribbonCardForBok(rozy);
    expect(ribbonFileUrl(card, "mp4")).toBe(`http://caddy:8082/ribbon/b-${rozy.id}-${card.key}.mp4`);
    expect(ribbonJobCard(card).name).toBe(`b-${rozy.id}-${card.key}`);
    expect(ribbonFileUrl({ ...card, ref: "../x" }, "jpg")).toBeNull();
  });
});
