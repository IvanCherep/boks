import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  activeCollection,
  activeCollections,
  arrangeSeriesShelf,
  isPremiere,
  seriesCollections,
  effectiveSeriesFilter,
  initialSeriesFilter,
  isSeriesPath,
  orderSeries,
  seriesLanguages,
  publishedSeriesShelf,
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
    if (piece.format === "poem" && poemManifestFor(piece.storyId)!.startsWith("/l/")) {
      // Held in storage, not in this repository: checked when it is made
      // (`docs/link-only-pieces.md`), not here.
      expect(piece.durationSeconds).toBeGreaterThan(0);
      return;
    }
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

  it("shows only the languages the shelf is filtered to", () => {
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

  it("opens in the interface language until the reader chooses", () => {
    expect(initialSeriesFilter(null, "ru")).toEqual(["ru"]);
    expect(initialSeriesFilter(null, "en")).toEqual(["en"]);
    expect(initialSeriesFilter([], "ru")).toEqual([]);
    expect(initialSeriesFilter(["en", "ru"], "ru")).toEqual(["en", "ru"]);
  });

  it("shows every language when there is no filter", () => {
    expect(orderSeries([ru1, en1], [], new Set())).toHaveLength(2);
  });

  it("moves what was already heard behind what was not", () => {
    expect(orderSeries([ru1, ru2], ["ru"], new Set(["ru-new"])).map((p) => p.storyId)).toEqual(["ru-old", "ru-new"]);
  });

  it("shares only published rows in the visible shelf order, with current catalogue names", () => {
    const catalogue = new Map([
      [ru1.storyId, { title: "Published title", authorName: "Published byline" }],
      [ru2.storyId, { title: "Second title", authorName: "Second byline" }],
    ]);
    const shelf = publishedSeriesShelf(catalogue, ["en", "ru"], new Set([ru2.storyId]), [en1, ru2, ru1]);
    expect(shelf.map(({ storyId }) => storyId)).toEqual([ru1.storyId, ru2.storyId]);
    expect(shelf[0]).toMatchObject({ title: "Published title", author: "Published byline" });
    expect(publishedSeriesShelf(catalogue, ["en"], new Set(), [en1, ru2, ru1])).toEqual([]);
  });

  it("offers no registry ghosts before a published answer is available", () => {
    expect(publishedSeriesShelf(null, ["ru"], new Set(), [ru1, ru2])).toEqual([]);
    expect(publishedSeriesShelf(new Map(), ["ru"], new Set(), [ru1, ru2])).toEqual([]);
  });
});

describe("the language filter", () => {
  it("offers the languages on the shelf, most pieces first, any tag", () => {
    const pieces = [
      piece({ storyId: "a", language: "en" }),
      piece({ storyId: "b", language: "ru" }),
      piece({ storyId: "c", language: "ru" }),
      piece({ storyId: "d", language: "it" }),
    ];
    expect(seriesLanguages(pieces)).toEqual([
      { language: "ru", count: 2 },
      { language: "en", count: 1 },
      { language: "it", count: 1 },
    ]);
  });

  it("never filters to nothing, and every language is no filter", () => {
    expect(effectiveSeriesFilter(["sr"], ["en", "ru"])).toEqual([]);
    expect(effectiveSeriesFilter(["en", "ru"], ["en", "ru"])).toEqual([]);
    expect(effectiveSeriesFilter(["ru", "sr"], ["en", "ru"])).toEqual(["ru"]);
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

  it("speaks Russian with Russian plurals", () => {
    expect(seriesDurationLabel(49, "ru")).toBe("49 сек");
    expect(seriesDurationLabel(127, "ru")).toBe("2 мин");
    expect(seriesFeatures(piece({ scenes: 5, moments: 2 }), "ru")).toEqual(["Голос", "5 сцен", "2 интерактивных момента"]);
    expect(seriesFeatures(piece({ scenes: 1, moments: 1 }), "ru")).toEqual(["Голос", "1 сцена", "1 интерактивный момент"]);
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

describe("seasonal collections", () => {
  const halloween = seriesCollections.find((collection) => collection.id === "halloween")!;
  const shelf = orderSeries(seriesPieces, [], new Set());

  it("names only pieces on the shelf, each once", () => {
    for (const collection of seriesCollections) {
      expect(new Set(collection.storyIds).size).toBe(collection.storyIds.length);
      for (const storyId of collection.storyIds) expect(seriesPieceFor(storyId), storyId).not.toBeNull();
      if (collection.until) expect(collection.from < collection.until).toBe(true);
    }
  });

  it("is up from its first day until the day it ends, in the reader's own calendar", () => {
    expect(activeCollection(new Date(2026, 9, 16, 23, 59))).toBeNull();
    expect(activeCollection(new Date(2026, 9, 17, 0, 1))?.id).toBe("halloween");
    expect(activeCollection(new Date(2026, 9, 31, 22))?.id).toBe("halloween");
    expect(activeCollection(new Date(2026, 10, 3, 0, 1))).toBeNull();
  });

  it("keeps a poet's section up from its first day, with no end", () => {
    const ids = (day: Date) => activeCollections(day).map((collection) => collection.id);
    expect(ids(new Date(2026, 10, 7, 23, 59))).not.toContain("prokhorov");
    expect(ids(new Date(2026, 10, 8, 0, 1))).toEqual(["prokhorov"]);
    expect(ids(new Date(2030, 0, 1))).toEqual(["prokhorov"]);
  });

  it("draws several collections, each piece once, before the rest", () => {
    const prokhorov = seriesCollections.find((collection) => collection.id === "prokhorov")!;
    const arranged = arrangeSeriesShelf(shelf, [halloween, prokhorov]);
    expect(arranged.collections.map((collection) => collection.id)).toEqual(["halloween", "prokhorov"]);
    const drawn = [...halloween.storyIds, ...prokhorov.storyIds];
    expect(arranged.order.slice(0, drawn.length).map((piece) => piece.storyId)).toEqual(drawn);
    expect(new Set(arranged.order.map((piece) => piece.storyId)).size).toBe(arranged.order.length);
    expect(arranged.order).toHaveLength(seriesPieces.length);
    expect(drawn).not.toContain(arranged.lead?.storyId);
  });

  it("comes first, in its own order, and its pieces appear nowhere else", () => {
    const heardPoe = new Set([halloween.storyIds[0]]);
    const arranged = arrangeSeriesShelf(orderSeries(seriesPieces, [], heardPoe), halloween);
    expect(arranged.collection?.pieces.map((piece) => piece.storyId)).toEqual(halloween.storyIds);
    expect(arranged.order.slice(0, 3).map((piece) => piece.storyId)).toEqual(halloween.storyIds);
    expect(new Set(arranged.order.map((piece) => piece.storyId)).size).toBe(arranged.order.length);
    expect(arranged.order).toHaveLength(seriesPieces.length);
    expect(halloween.storyIds).not.toContain(arranged.lead?.storyId);
  });

  it("leaves the shelf as it was when no collection is up", () => {
    const arranged = arrangeSeriesShelf(shelf, null);
    expect(arranged.collection).toBeNull();
    expect(arranged.order).toEqual(shelf);
    expect(arranged.lead).toBe(shelf[0]);
  });

  it("puts a section opened by its own address first, in every language", () => {
    const prokhorov = seriesCollections.find((collection) => collection.id === "prokhorov")!;
    const english = orderSeries(seriesPieces, ["en"], new Set());
    const everything = orderSeries(seriesPieces, [], new Set());
    expect(arrangeSeriesShelf(english, [prokhorov]).collections).toEqual([]);
    const arranged = arrangeSeriesShelf(english, [halloween, prokhorov], { id: "prokhorov", shelf: everything });
    expect(arranged.collections[0]?.id).toBe("prokhorov");
    expect(arranged.collections[0]?.pieces.map((piece) => piece.storyId)).toEqual(prokhorov.storyIds);
    expect(new Set(arranged.order.map((piece) => piece.storyId)).size).toBe(arranged.order.length);
    // The rest of the shelf keeps the reader's languages.
    expect(arranged.order.slice(prokhorov.storyIds.length).every((piece) => piece.language === "en")).toBe(true);
  });

  it("knows the shelf at a section's own address", () => {
    for (const path of ["/series", "/series/", "/series/prokhorov"]) expect(isSeriesPath(path), path).toBe(true);
    for (const path of ["/", "/seriesx", "/series/a/b", "/b/series"]) expect(isSeriesPath(path), path).toBe(false);
  });

  it("shows a book's cover from link-only storage, never from this public repository", () => {
    for (const collection of seriesCollections) {
      if (collection.book) expect(collection.book.cover).toMatch(/^\/l\/[A-Za-z0-9_-]{22,}\/f\/[a-z0-9-]+\.webp$/);
    }
  });

  it("is not a collection with fewer than two of its pieces in the reader's languages", () => {
    const russian = orderSeries(seriesPieces, ["ru"], new Set());
    const arranged = arrangeSeriesShelf(russian, halloween);
    expect(arranged.collection).toBeNull();
    expect(arranged.order).toEqual(russian);
  });
});
