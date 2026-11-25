import { afterEach, describe, expect, it } from "vitest";
import { liveSeriesManifestFor, liveSeriesPieceFor, readLiveSeries, setLiveSeries } from "./live-series";
import { activeCollections, arrangeSeriesShelf, liveCollections, publishedSeriesShelf, seriesCollections, seriesPieceFor, seriesPieces, seriesShelfOrder, seriesShelfPrints, shelfSections, tokenPrint } from "./series-catalogue";
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
    expect(section.photo).toBe("/a/vodennikov/photo?v=3&s=s");
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

  it("puts Демидов fourth, under Мальо-Субботина, and a new unlisted author after the listed ones", () => {
    const bokC = "33333333-3333-4333-8333-333333333333";
    const bokD = "44444444-4444-4444-8444-444444444444";
    const tokenC = "CCCCCCCCCCCCCCCCCCCCCC";
    const tokenD = "DDDDDDDDDDDDDDDDDDDDDD";
    // The database answers newest first: Демидов published after Воденников.
    const sections = readLiveSeries([
      { handle: "newcomer", name: "Новый", pieces: [{ bokId: bokD, token: tokenD, title: "Новое" }] },
      { handle: "demidov", name: "Евгений Демидов", pieces: [{ bokId: bokC, token: tokenC, title: "Гордыня" }] },
      ...answer,
    ]);
    setLiveSeries(sections);
    const registry = [...seriesPieces, ...sections.flatMap((section) => section.pieces)];
    const catalogue = new Map(registry.map((piece) => [piece.storyId, { title: piece.title, authorName: piece.author }]));
    const shelf = publishedSeriesShelf(catalogue, [], new Set(), registry);
    const arranged = arrangeSeriesShelf(shelf, shelfSections(liveCollections(sections), activeCollections(new Date("2026-11-21T12:00:00Z"))), null);
    expect(arranged.collections.map((collection) => collection.id).slice(0, 5)).toEqual([
      "author-vodennikov", "prokhorov", "malyo-subbotina", "author-demidov", "author-newcomer",
    ]);
    // Without the newcomer Демидов is the fourth section.
    const four = arrangeSeriesShelf(shelf, shelfSections(liveCollections(sections.slice(1)), activeCollections(new Date("2026-11-21T12:00:00Z"))), null);
    expect(four.collections.map((collection) => collection.id).indexOf("author-demidov")).toBe(3);
  });
  it("keeps Комаров and Август after Демидов whoever publishes first, and after a change of @handle", () => {
    const piece = (n: number, title: string) => ({ bokId: `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`, token: String(n).repeat(22), title });
    const demidov = { handle: "demidov", name: "Евгений Демидов", pieces: [piece(3, "Гордыня")] };
    const komarov = { handle: "komarov", name: "Константин Комаров", pieces: [piece(5, "Три звёздочки")] };
    const avgust = { handle: "avgust", name: "Ксения Август", pieces: [piece(6, "Глиняные люди"), piece(7, "Любовь моя")] };
    const prints = {
      "author-vodennikov": [tokenPrint(tokenA), tokenPrint(tokenB)],
      "author-demidov": [tokenPrint("3".repeat(22))],
      "author-komarov": [tokenPrint("5".repeat(22))],
      "author-avgust": [tokenPrint("6".repeat(22)), tokenPrint("7".repeat(22))],
    };
    const today = activeCollections(new Date("2026-11-21T12:00:00Z"));
    // The database answers newest first.
    const order = (rows: unknown[]) => shelfSections(liveCollections(readLiveSeries(rows)), today, undefined, prints).map((c) => c.id);
    const base = ["author-vodennikov", "prokhorov", "malyo-subbotina", "author-demidov"];
    // Август first, Комаров not yet: she follows Демидов.
    expect(order([avgust, demidov, ...answer])).toEqual([...base, "author-avgust"]);
    // Комаров publishes after her: he takes his place between them.
    expect(order([komarov, avgust, demidov, ...answer])).toEqual([...base, "author-komarov", "author-avgust"]);
    // Комаров first, then Август: the same.
    expect(order([avgust, komarov, demidov, ...answer])).toEqual([...base, "author-komarov", "author-avgust"]);
    // New nicknames move nobody, and a hidden piece does not either.
    const renamed = [
      { ...avgust, handle: "ksenia_avgust", pieces: [avgust.pieces[1]] },
      { ...komarov, handle: "kkomarov" },
      { ...demidov, handle: "evgeny" },
      { ...answer[0], handle: "dmitry_v" },
    ];
    expect(order(renamed)).toEqual(["author-dmitry-v", "prokhorov", "malyo-subbotina", "author-evgeny", "author-kkomarov", "author-ksenia-avgust"]);
    // A new author nobody listed goes to the bottom of the authors; two of them, in the order they published.
    const one = { handle: "newcomer", name: "Новый", pieces: [piece(8, "Новое")] };
    const two = { handle: "later", name: "Позже", pieces: [piece(9, "Ещё новее")] };
    expect(order([one, ...renamed]).at(-1)).toBe("author-newcomer");
    expect(order([two, one, ...renamed]).slice(-2)).toEqual(["author-newcomer", "author-later"]);
  });
  it("puts the next listed author after Август, by the shelf's own fingerprints", () => {
    // The real list: a section whose Series folders match an author's prints takes that author's place.
    const sorokin = seriesShelfPrints["author-sorokin"];
    const avgustAt = seriesShelfOrder.indexOf("author-avgust");
    expect(avgustAt).toBeGreaterThanOrEqual(0);
    expect(seriesShelfOrder[avgustAt + 1]).toBe("author-sorokin");
    expect(sorokin).toHaveLength(5);
    expect(new Set(Object.values(seriesShelfPrints).flat()).size).toBe(Object.values(seriesShelfPrints).flat().length);
  });
});
