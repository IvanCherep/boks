import { describe, expect, it } from "vitest";
import { applyStartingPreferences, parseStartingPreferences, startingWeight } from "./starting-preferences";
import type { RankedStory } from "@/lib/boks/recommendations/feed";

const entry = (id: string, authorName: string, rank: number) => ({ candidate: { id, authorName }, rank, score: 1, signals: {} }) as unknown as RankedStory;
const feed = [
  entry("a", "Leah Voss", 0), entry("b", "Антон Чехов", 1), entry("c", "Ena Cross", 2), entry("d", "Nikolai Stern", 3),
  entry("e", "Mira Holt", 4), entry("f", "Александр Пушкин", 5), entry("g", "Ivo Lane", 6), entry("h", "Sara Pine", 7), entry("i", "Fyodor Mint", 8),
];
const poetry = new Set(["c", "f"]);
const formOf = (e: RankedStory) => (poetry.has(e.candidate.id) ? "poetry" as const : "prose" as const);

describe("starting preferences", () => {
  it("lift a chosen classic and the chosen form, without removing anything", () => {
    const prefs = parseStartingPreferences({ status: "completed", form: "poetry", classicNames: ["Александр Пушкин"] })!;
    const out = applyStartingPreferences(feed, prefs, { readerEvents: 0, formOf });
    expect(out.map((e) => e.candidate.id)).toHaveLength(feed.length);
    expect(out[0].candidate.id).toBe("f");
    expect(out[0].explanations).toEqual(["starting:classic", "starting:form-poetry"]);
    expect(out.map((e) => e.rank)).toEqual(out.map((_, i) => i));
    expect(out.findIndex((e) => e.candidate.id === "c")).toBeLessThan(2);
  });
  it("matches a byline with ё written as е", () => {
    const prefs = parseStartingPreferences({ status: "completed", form: "any", classicNames: ["Фёдор Mint"] })!;
    const out = applyStartingPreferences([entry("x", "Федор Mint", 0), ...feed], prefs, { readerEvents: 0, formOf });
    expect(out[0].candidate.id).toBe("x");
  });
  it("fades out as the reader's own history grows, and does nothing when skipped", () => {
    expect(startingWeight(0)).toBe(1);
    expect(startingWeight(20)).toBe(0.5);
    expect(startingWeight(80)).toBe(0);
    const prefs = parseStartingPreferences({ status: "completed", form: "poetry", classicNames: ["Александр Пушкин"] })!;
    expect(applyStartingPreferences(feed, prefs, { readerEvents: 200, formOf }).map((e) => e.candidate.id)).toEqual(feed.map((e) => e.candidate.id));
    const skipped = parseStartingPreferences({ status: "skipped", form: "poetry", classicNames: ["Александр Пушкин"] });
    expect(applyStartingPreferences(feed, skipped, { readerEvents: 0, formOf }).map((e) => e.candidate.id)).toEqual(feed.map((e) => e.candidate.id));
  });
  it("reads only well-formed answers", () => {
    expect(parseStartingPreferences(null)).toBeNull();
    expect(parseStartingPreferences({ status: "maybe" })).toBeNull();
    expect(parseStartingPreferences({ status: "completed", form: "drama", classicNames: [1, "Блок"] })).toEqual({ version: 1, status: "completed", form: "any", classicNames: ["Блок"] });
  });
});
