import { describe, expect, it } from "vitest";
import { ownCoverPath } from "@/lib/boks/own-cover";
import { coverCrop } from "./cover-image";
import { coverExcerpt, coverExcerptLimit, coverRequest } from "./cover-art";
import { isCoverJobId, isCoverPicture } from "./jobs";
import { getBokArtwork } from "@/components/boks/reader/bok-artwork";

const id = "8b75e0ae-c7c0-4fbd-8f33-01fe3a134ac2";

describe("a bok's own cover", () => {
  it("has an address only with a version", () => {
    expect(ownCoverPath(id, 3, "webp")).toBe(`/b/${id}/cover.webp?v=3`);
    expect(ownCoverPath(id, 1, "jpg")).toBe(`/b/${id}/cover.jpg?v=1`);
    expect(ownCoverPath(id, null, "webp")).toBeNull();
    expect(ownCoverPath(id, 0, "webp")).toBeNull();
    expect(ownCoverPath("../etc", 1, "webp")).toBeNull();
  });

  it("comes after the registries in the reader", () => {
    expect(getBokArtwork({ id, coverVersion: 2 })).toBe(`/b/${id}/cover.webp?v=2`);
    expect(getBokArtwork({ id })).toBeNull();
    // A registered Series cover always wins.
    expect(getBokArtwork({ id: "cc7e3800-3567-42c1-ba08-8554a345e25c", coverVersion: 5 })).not.toContain("/cover.webp");
  });

  it("is cut to 9:16 around the middle", () => {
    expect(coverCrop(1080, 1920)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    // A landscape photo loses its sides.
    expect(coverCrop(4000, 3000)).toEqual({ x: 1156, y: 0, width: 1688, height: 3000 });
    // A tall strip loses its top and bottom.
    expect(coverCrop(900, 3000)).toEqual({ x: 0, y: 700, width: 900, height: 1600 });
  });
});

describe("drawing a cover", () => {
  it("asks of the opening, in whole lines", () => {
    const text = Array.from({ length: 400 }, (_, index) => `строка номер ${index}`).join("\n");
    const excerpt = coverExcerpt(text);
    expect(excerpt.startsWith("строка номер 0 / строка номер 1")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(coverExcerptLimit + 3);
    expect(excerpt.endsWith(" / ")).toBe(false);
  });

  it("asks for exactly two scenes", () => {
    const request = coverRequest("Тихий снег", "Тихий снег над станцией,\nи поезд ещё не пришёл.");
    expect(request).toContain("Название: Тихий снег");
    expect(request).toContain("Тихий снег над станцией, / и поезд ещё не пришёл.");
    expect(request).toContain("ровно двумя строками");
  });

  it("knows its own files only", () => {
    expect(isCoverJobId("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isCoverJobId("../../etc/passwd")).toBe(false);
    expect(isCoverPicture("picture-1.jpg")).toBe(true);
    expect(isCoverPicture("picture-3.jpg")).toBe(false);
    expect(isCoverPicture("job.json")).toBe(false);
  });
});

import { headingLine } from "@/components/boks/author-cabinet/composer";

describe("a title pasted with the text", () => {
  it("is offered when a short line stands alone above the text", () => {
    expect(headingLine("Окно на север\n\nЯ открываю окно,\nтам ветер.")).toEqual({ line: "Окно на север", rest: "Я открываю окно,\nтам ветер." });
  });
  it("is not offered for a first verse line or a divider", () => {
    expect(headingLine("Я открываю окно,\nтам ветер.")).toBeNull();
    expect(headingLine("Я открываю окно,\n\nтам ветер.")).toBeNull();
    expect(headingLine("* * *\n\nУтро без имени")).toBeNull();
    expect(headingLine("Одна строка")).toBeNull();
  });
});
