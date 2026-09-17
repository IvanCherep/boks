import { describe, expect, it } from "vitest";
import { expectedReadingSeconds, inferReadOutcome, readingWordsPerMinute } from "@/components/boks/reader-behavior";
import type { Story } from "@/components/boks/client-types";

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "s1",
    title: "A boks",
    authorName: "Mira Vale",
    authorHandle: "mira_vale",
    hook: "",
    body: "",
    genre: "literary",
    mood: "quiet",
    minutes: 5,
    wordCount: 1190, // five minutes at the assumed pace
    likes: 0,
    shares: 0,
    starts: 0,
    completes: 0,
    commentsCount: 0,
    avgSeconds: 0,
    ...overrides,
  };
}

describe("expectedReadingSeconds", () => {
  it("uses the real word count", () => {
    expect(expectedReadingSeconds(story({ wordCount: readingWordsPerMinute }))).toBe(60);
  });

  it("falls back to the minute estimate when no word count is stored", () => {
    expect(expectedReadingSeconds(story({ wordCount: 0, minutes: 4 }))).toBe(222);
  });

  it("never expects less than a few seconds, so a one-line boks stays judgeable", () => {
    expect(expectedReadingSeconds(story({ wordCount: 3 }))).toBe(20);
  });
});

describe("inferReadOutcome", () => {
  it("counts a full read as a completion", () => {
    expect(inferReadOutcome(story(), 280, 0.95)).toBe("complete");
  });

  it("counts a glance as a skip even when the reader flicked to the bottom", () => {
    // Scrolled to the end in four seconds: that is a flick, not a read.
    expect(inferReadOutcome(story(), 4, 1)).toBe("skip");
  });

  it("counts a long boks left after a few seconds as a skip", () => {
    expect(inferReadOutcome(story({ wordCount: 3000 }), 20, 0.1)).toBe("skip");
  });

  it("accepts a short boks that never scrolled, if the reader stayed", () => {
    // A short piece fits on one screen, so progress stays 0 however carefully
    // it is read. Time is the only evidence available.
    const short = story({ wordCount: 200, minutes: 1 });
    expect(inferReadOutcome(short, 45, 0)).toBe("complete");
  });

  it("scales with length rather than using one fixed threshold", () => {
    const shortBok = story({ wordCount: 240, minutes: 1 });
    const longBok = story({ wordCount: 3200, minutes: 15 });

    // The same 70 seconds means very different things for these two.
    expect(inferReadOutcome(shortBok, 70, 0.9)).toBe("complete");
    expect(inferReadOutcome(longBok, 70, 0.9)).toBe("skip");
  });

  it("judges the same reader and the same boks identically over time", () => {
    // The threshold must not drift: a finish rate is only comparable if the
    // instrument stays fixed.
    const outcomes = Array.from({ length: 5 }, () => inferReadOutcome(story(), 200, 0.9));
    expect(new Set(outcomes).size).toBe(1);
  });
});
