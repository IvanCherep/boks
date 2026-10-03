import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  isPremiere,
  orderSeries,
  seriesCopyLanguageFor,
  seriesDurationLabel,
  seriesFeatures,
  seriesFormatOf,
  seriesPieceFor,
  seriesPieces,
  shortAuthor,
  type SeriesPiece,
} from "@/components/boks/series/series-catalogue";
import { poemManifestFor, poemStoryIds } from "@/components/boks/poetry/poems";
import { isBoksSeriesPiece } from "@/components/boks/cinema/series";
import { sceneImagesFor, storiesWithSceneArt } from "@/components/boks/cinema/scene-image";
import { narrationTrackFor } from "@/components/boks/cinema/narration-track";
import { storyMomentsFor } from "@/components/boks/cinema/story-moments";
import type { NarrationAlignment } from "@/components/boks/cinema/narration-track";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";

const publicFile = (url: string) => `public${url}`;

describe("the series shelf and the format registries", () => {
  it("lists every finished piece the formats can open", () => {
    // A piece that opens in a format but is not on the shelf has been made and
    // then hidden. Both registries are walked, so neither can be forgotten.
    const finished = [
      ...poemStoryIds,
      ...storiesWithSceneArt.filter((storyId) => isBoksSeriesPiece(storyId)),
    ];
    for (const storyId of finished) {
      expect(seriesPieceFor(storyId), `${storyId} is finished but not on the shelf`).not.toBeNull();
    }
  });

  it("lists nothing that would open as plain text", () => {
    for (const piece of seriesPieces) {
      expect(seriesFormatOf(piece.storyId), piece.title).toBe(piece.format);
    }
  });

  it("lists each boks once", () => {
    expect(new Set(seriesPieces.map((piece) => piece.storyId)).size).toBe(seriesPieces.length);
  });
});

describe.each(seriesPieces.map((piece) => [piece.title, piece] as const))("%s on the shelf", (_title, piece) => {
  it("has its cover, small enough for a card", () => {
    expect(piece.cover).toMatch(/^\/series\/.+\.webp$/);
    expect(existsSync(publicFile(piece.cover)), piece.cover).toBe(true);
    // Three covers load at once on a phone; a scene frame at full size is
    // half a megabyte. 720 px wide at q80 lands well under this.
    expect(readFileSync(publicFile(piece.cover)).byteLength).toBeLessThan(220_000);
  });

  it("says how long it plays, as its own recording does", () => {
    let seconds: number;
    if (piece.format === "poem") {
      const manifest = JSON.parse(
        readFileSync(publicFile(poemManifestFor(piece.storyId)!), "utf8")
      ) as PoemManifest;
      seconds = manifest.durationMs / 1000;
      expect(manifest.scenes.length, "scenes").toBe(piece.scenes);
      expect(manifest.language.slice(0, 2), "language").toBe(piece.language);
    } else {
      const alignment = JSON.parse(
        readFileSync(publicFile(narrationTrackFor(piece.storyId)!.alignment), "utf8")
      ) as NarrationAlignment;
      seconds = alignment.character_end_times_seconds.at(-1)!;
      expect(sceneImagesFor(piece.storyId).length, "scenes").toBe(piece.scenes);
      expect(storyMomentsFor(piece.storyId).length, "moments").toBe(piece.moments);
    }
    expect(Math.abs(piece.durationSeconds - seconds)).toBeLessThanOrEqual(1);
  });

  it("has a real premiere date", () => {
    expect(piece.premieredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(piece.premieredOn))).toBe(false);
  });
});

const piece = (overrides: Partial<SeriesPiece>): SeriesPiece => ({
  storyId: "x",
  format: "poem",
  language: "ru",
  title: "x",
  author: "x",
  cover: "/series/x.webp",
  coverFocus: "50% 50%",
  durationSeconds: 60,
  scenes: 4,
  moments: 0,
  premieredOn: "2026-10-01",
  ...overrides,
});

describe("the order of the shelf", () => {
  const ru1 = piece({ storyId: "ru-old", language: "ru", premieredOn: "2026-09-01" });
  const ru2 = piece({ storyId: "ru-new", language: "ru", premieredOn: "2026-10-01" });
  const en1 = piece({ storyId: "en-new", language: "en", premieredOn: "2026-10-02" });

  it("puts the reader's languages first and keeps the rest after", () => {
    const { mine, other } = orderSeries([en1, ru1, ru2], ["ru"], new Set());
    expect(mine.map((p) => p.storyId)).toEqual(["ru-new", "ru-old"]);
    expect(other.map((p) => p.storyId)).toEqual(["en-new"]);
  });

  it("treats a bilingual reader as reading everything, newest first", () => {
    const { mine, other } = orderSeries([ru1, en1, ru2], ["en", "ru"], new Set());
    expect(mine.map((p) => p.storyId)).toEqual(["en-new", "ru-new", "ru-old"]);
    expect(other).toEqual([]);
  });

  it("does not hide everything from a reader whose language is unknown", () => {
    expect(orderSeries([ru1, en1], [], new Set()).mine).toHaveLength(2);
  });

  it("moves what was already heard behind what was not", () => {
    const { mine } = orderSeries([ru1, ru2], ["ru"], new Set(["ru-new"]));
    expect(mine.map((p) => p.storyId)).toEqual(["ru-old", "ru-new"]);
  });
});

describe("the words on a card", () => {
  it("does not round a poem up to a minute", () => {
    expect(seriesDurationLabel(49, "ru")).toBe("49 сек");
    expect(seriesDurationLabel(127, "ru")).toBe("2 мин");
    expect(seriesDurationLabel(61, "en")).toBe("1 min");
  });

  it("names what the piece is made of, in Russian plurals", () => {
    expect(seriesFeatures(piece({ scenes: 6, moments: 2 }), "ru")).toEqual(["Голос", "6 сцен", "2 интерактивных момента"]);
    expect(seriesFeatures(piece({ scenes: 4, moments: 0 }), "ru")).toEqual(["Голос", "4 сцены", "живой текст"]);
    expect(seriesFeatures(piece({ scenes: 1, moments: 1 }), "en")).toEqual(["Voice", "1 scene", "1 interactive moment"]);
    expect(seriesFeatures(piece({ scenes: 21, moments: 5 }), "ru")[1]).toBe("21 сцена");
  });

  it("shortens a name to initials", () => {
    expect(shortAuthor("Лев Толстой")).toBe("Л. Толстой");
    expect(shortAuthor("Walt Whitman")).toBe("W. Whitman");
    expect(shortAuthor("Гомер")).toBe("Гомер");
  });

  it("calls a piece a premiere for two weeks", () => {
    const opened = piece({ premieredOn: "2026-10-01" });
    expect(isPremiere(opened, new Date("2026-10-03T12:00:00Z"))).toBe(true);
    expect(isPremiere(opened, new Date("2026-10-20T12:00:00Z"))).toBe(false);
  });
});

describe("the language the shelf speaks", () => {
  it("follows a reader of one language", () => {
    expect(seriesCopyLanguageFor(["ru"], ["en-US"])).toBe("ru");
    expect(seriesCopyLanguageFor(["en"], ["ru-RU"])).toBe("en");
  });

  it("follows the browser for a bilingual reader", () => {
    expect(seriesCopyLanguageFor(["en", "ru"], ["ru-RU", "en-US"])).toBe("ru");
    expect(seriesCopyLanguageFor(["en", "ru"], ["en-GB", "ru"])).toBe("en");
    expect(seriesCopyLanguageFor(["en", "ru"], ["sr-RS"])).toBe("ru");
  });
});
