import { afterEach, describe, expect, it } from "vitest";
import { liveSeriesManifestFor, liveSeriesPieceFor, readLiveSeries, setLiveSeries } from "./live-series";
import { arrangeSeriesShelf, liveCollections, publishedSeriesShelf, seriesCollections, seriesPieceFor, seriesPieces } from "./series-catalogue";
import { poemManifestFor } from "@/components/boks/poetry/poems";

const bokA = "11111111-1111-4111-8111-111111111111";
const bokB = "22222222-2222-4222-8222-222222222222";
const tokenA = "AAAAAAAAAAAAAAAAAAAAAA";
const tokenB = "BBBBBBBBBBBBBBBBBBBBBB";

const answer = [
  {
    handle: "vodennikov",
    name: "Дмитрий Воденников",
    photoVersion: 3,
    pieces: [
      { bokId: bokB, title: "Второе", author: "Дмитрий Воденников", language: "ru", token: tokenB, publishedOn: "2026-11-18", card: { seconds: 161, scenes: 14, moments: 2, focus: "50% 30%" } },
      { bokId: bokA, title: "Первое", author: "Дмитрий Воденников", language: "ru", token: tokenA, publishedOn: "2026-11-18", card: {} },
    ],
  },
];

afterEach(() => setLiveSeries([]));

describe("live Series sections", () => {
  it("reads the answer, keeping the author's order and dropping anything malformed", () => {
    const sections = readLiveSeries([
      ...answer,
      { handle: "x y", name: "bad handle", pieces: [{ bokId: bokA, token: tokenA }] },
      { handle: "nobody", name: "no pieces", pieces: [{ bokId: "not-an-id", token: tokenA }, { bokId: bokA, token: "../../etc" }] },
    ]);
    expect(sections).toHaveLength(1);
    const [section] = sections;
    expect(section.id).toBe("author-vodennikov");
    expect(section.photo).toBe("/a/vodennikov/photo?v=3");
    expect(section.pieces.map((piece) => piece.title)).toEqual(["Второе", "Первое"]);
    expect(section.pieces[0]).toMatchObject({ cover: `/l/${tokenB}/f/cover.webp`, durationSeconds: 161, scenes: 14, coverFocus: "50% 30%" });
    // A card the team has not filled leaves the numbers out rather than guessing.
    expect(section.pieces[1]).toMatchObject({ durationSeconds: 0, scenes: 0, coverFocus: "50% 40%" });
    expect(readLiveSeries(null)).toEqual([]);
  });

  it("opens a live piece as its Series once known, and only then", () => {
    expect(poemManifestFor(bokA)).toBeNull();
    expect(seriesPieceFor(bokA)).toBeNull();
    setLiveSeries(readLiveSeries(answer));
    expect(poemManifestFor(bokA)).toBe(`/l/${tokenA}/f/manifest.json`);
    expect(liveSeriesManifestFor(bokB)).toBe(`/l/${tokenB}/f/manifest.json`);
    expect(seriesPieceFor(bokB)?.title).toBe("Второе");
    expect(liveSeriesPieceFor(bokB)?.token).toBe(tokenB);
  });

  it("never overrides a piece registered in code", () => {
    const registered = seriesPieces[0];
    setLiveSeries(readLiveSeries([{ handle: "someone", name: "S", pieces: [{ bokId: registered.storyId, token: tokenA, title: "Other" }] }]));
    expect(seriesPieceFor(registered.storyId)?.title).toBe(registered.title);
    expect(poemManifestFor(registered.storyId)).not.toBe(`/l/${tokenA}/f/manifest.json`);
  });

  it("draws the author's section first on the shelf, above the sections in code", () => {
    const sections = readLiveSeries(answer);
    setLiveSeries(sections);
    const registry = [...seriesPieces, ...sections.flatMap((section) => section.pieces)];
    const catalogue = new Map(registry.map((piece) => [piece.storyId, { title: piece.title, authorName: piece.author }]));
    const shelf = publishedSeriesShelf(catalogue, [], new Set(), registry);
    const live = liveCollections(sections);
    const arranged = arrangeSeriesShelf(shelf, [...live, ...seriesCollections.filter((collection) => !collection.until)], null);
    expect(arranged.collections[0].id).toBe("author-vodennikov");
    expect(arranged.collections[0].pieces.map((piece) => piece.storyId)).toEqual([bokB, bokA]);
    expect(arranged.collections[0].collection.author?.name).toBe("Дмитрий Воденников");
    expect(arranged.collections.map((collection) => collection.id)).toContain("prokhorov");
  });

  it("keeps an author's own section with a single published piece", () => {
    const sections = readLiveSeries([{ ...answer[0], pieces: [answer[0].pieces[0]] }]);
    setLiveSeries(sections);
    const registry = [...seriesPieces, ...sections[0].pieces];
    const catalogue = new Map(registry.map((piece) => [piece.storyId, { title: piece.title, authorName: piece.author }]));
    const arranged = arrangeSeriesShelf(publishedSeriesShelf(catalogue, [], new Set(), registry), liveCollections(sections), null);
    expect(arranged.collections[0]?.id).toBe("author-vodennikov");
    expect(arranged.collections[0]?.pieces).toHaveLength(1);
  });

  it("leaves an author with a section in code to that section", () => {
    const sections = readLiveSeries([{ handle: "prokhorov", name: "Алексей Прохоров", pieces: answer[0].pieces }]);
    expect(liveCollections(sections)).toEqual([]);
  });
});
