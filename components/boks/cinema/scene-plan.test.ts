import { describe, expect, it } from "vitest";
import {
  estimateNarrationSeconds,
  formatClock,
  lineAtCharacter,
  looksLikeVerse,
  planScenes,
  sceneAtLine,
  seedFrom,
} from "@/components/boks/cinema/scene-plan";

const prose = [
  "Море — огромное, лениво вздыхающее у берега, — уснуло и неподвижно в дали, облитой голубым сиянием луны.",
  "Мягкое и серебристое, оно слилось там с синим южным небом и крепко спит.",
  "Горы, поросшие деревьями, уродливо изогнутыми норд-остом, резкими взмахами подняли свои вершины в синюю пустыню над ними.",
].join(" ");

const verse = ["Встану я помолясь,", "Пойду перекрестясь,", "Из дверей в двери,", "Из ворот в ворота —", "Во чисто поле"].join("\n");

describe("cutting a boks into scenes", () => {
  it("cuts prose at sentence ends", () => {
    const plan = planScenes({ id: "a", text: prose });
    expect(plan.lines.length).toBeGreaterThanOrEqual(3);
    // The middle sentence is short enough to stay whole, so it is one card.
    expect(plan.lines.map((line) => line.text)).toContain(
      "Мягкое и серебристое, оно слилось там с синим южным небом и крепко спит."
    );
  });

  it("keeps a line short enough to be read off a card", () => {
    const plan = planScenes({ id: "a", text: prose });
    // Broken at a space, never mid-word.
    for (const line of plan.lines) expect(line.text.length).toBeLessThanOrEqual(96);
    expect(plan.lines.map((line) => line.text).join(" ")).toContain("облитой голубым сиянием луны.");
  });

  it("splits a long sentence into even halves rather than a card and an orphan", () => {
    // Filling to the brim left "сиянием луны." alone on screen for a second
    // and a half, which reads as a fault rather than as a line.
    const long = "Море — огромное, лениво вздыхающее у берега, — уснуло и неподвижно в дали, облитой голубым сиянием луны.";
    const lines = planScenes({ id: "a", text: long }).lines;
    expect(lines).toHaveLength(2);
    const shortest = Math.min(...lines.map((line) => line.text.length));
    const longest = Math.max(...lines.map((line) => line.text.length));
    expect(shortest).toBeGreaterThan(longest / 2);
  });

  it("keeps the line breaks of verse", () => {
    expect(looksLikeVerse(verse)).toBe(true);
    expect(looksLikeVerse(prose)).toBe(false);
    const plan = planScenes({ id: "b", text: verse });
    // Verse lines are paired onto a card rather than flashing one at a time.
    expect(plan.lines.some((line) => line.text.includes("\n"))).toBe(true);
  });

  it("offsets run end to end, so speech progress can be matched to a line", () => {
    const plan = planScenes({ id: "a", text: prose });
    expect(plan.lines[0].start).toBe(0);
    for (let index = 1; index < plan.lines.length; index += 1) {
      expect(plan.lines[index].start).toBe(plan.lines[index - 1].end);
    }
    expect(plan.lines[plan.lines.length - 1].end).toBeGreaterThanOrEqual(plan.spoken.length);
  });

  it("gives every boks at least one scene and never more than six", () => {
    for (const text of [prose, verse, "Одна строка."]) {
      const plan = planScenes({ id: "c", text });
      expect(plan.sceneStarts.length).toBeGreaterThanOrEqual(1);
      expect(plan.sceneStarts.length).toBeLessThanOrEqual(6);
      expect(plan.sceneStarts[0]).toBe(0);
    }
  });

  it("draws the same boks the same way every time", () => {
    // The whole point of seeding: a prototype that repaints itself on every
    // open cannot be demonstrated twice.
    expect(seedFrom("bok-1")).toBe(seedFrom("bok-1"));
    expect(seedFrom("bok-1")).not.toBe(seedFrom("bok-2"));
    expect(planScenes({ id: "x", text: prose }).seed).toBe(planScenes({ id: "x", text: prose }).seed);
  });
});

describe("following the voice", () => {
  const plan = planScenes({ id: "a", text: prose });

  it("finds the line being spoken from how far the voice has read", () => {
    expect(lineAtCharacter(plan.lines, 0)).toBe(0);
    expect(lineAtCharacter(plan.lines, plan.lines[1].start)).toBe(1);
    expect(lineAtCharacter(plan.lines, plan.lines[1].end - 1)).toBe(1);
    // Past the end stays on the last line rather than running off it.
    expect(lineAtCharacter(plan.lines, 10_000)).toBe(plan.lines.length - 1);
  });

  it("finds the scene a line belongs to", () => {
    expect(sceneAtLine([0, 3, 6], 0)).toBe(0);
    expect(sceneAtLine([0, 3, 6], 2)).toBe(0);
    expect(sceneAtLine([0, 3, 6], 3)).toBe(1);
    expect(sceneAtLine([0, 3, 6], 99)).toBe(2);
  });

  it("has a total before a word has been said", () => {
    // The player needs a length from the first frame, and the speech API will
    // not give one, so it is estimated from the text.
    expect(estimateNarrationSeconds("a".repeat(1320), "ru")).toBe(100);
    expect(estimateNarrationSeconds("short", "en")).toBe(20);
  });

  it("prints a clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(62)).toBe("01:02");
    expect(formatClock(188)).toBe("03:08");
    expect(formatClock(-5)).toBe("00:00");
  });
});
