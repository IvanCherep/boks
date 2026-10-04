import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  isPremiere,
  orderSeries,
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

  it("shows only the reader's languages", () => {
    expect(orderSeries([en1, ru1, ru2], ["ru"], new Set()).map((p) => p.storyId)).toEqual(["ru-new", "ru-old"]);
    expect(orderSeries([en1, ru1, ru2], ["en"], new Set()).map((p) => p.storyId)).toEqual(["en-new"]);
  });

  it("treats a bilingual reader as reading everything, newest first", () => {
    expect(orderSeries([ru1, en1, ru2], ["en", "ru"], new Set()).map((p) => p.storyId)).toEqual([
      "en-new",
      "ru-new",
      "ru-old",
    ]);
  });

  it("does not hide everything from a reader whose language is unknown", () => {
    expect(orderSeries([ru1, en1], [], new Set())).toHaveLength(2);
  });

  it("moves what was already heard behind what was not", () => {
    expect(orderSeries([ru1, ru2], ["ru"], new Set(["ru-new"])).map((p) => p.storyId)).toEqual(["ru-old", "ru-new"]);
  });
});

describe("the words on a card", () => {
  it("does not round a poem up to a minute", () => {
    expect(seriesDurationLabel(49)).toBe("49 sec");
    expect(seriesDurationLabel(127)).toBe("2 min");
    expect(seriesDurationLabel(61)).toBe("1 min");
  });

  it("names what the piece is made of, in English, and only what differs", () => {
    expect(seriesFeatures(piece({ scenes: 6, moments: 2 }))).toEqual(["Voice", "6 scenes", "2 interactive moments"]);
    // Every piece on the shelf is a production; a poem is not labelled as one.
    expect(seriesFeatures(piece({ scenes: 4, moments: 0 }))).toEqual(["Voice", "4 scenes"]);
    expect(seriesFeatures(piece({ scenes: 1, moments: 1 }))).toEqual(["Voice", "1 scene", "1 interactive moment"]);
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
