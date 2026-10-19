import { describe, expect, it } from "vitest";
import { textReadingState } from "./text-reading-state";
import { createReaderClock } from "../reader-clock";
import { inferReadOutcome } from "../reader-behavior";

describe("v44 text measurement", () => {
  it("excludes the full cover and final controls from text distance", () => {
    expect(textReadingState({ top: 800, height: 1800, viewport: 800 })).toEqual({ phase: "cover", progress: 0, scrollable: true });
    expect(textReadingState({ top: -460, height: 1800, viewport: 800 }).progress).toBe(0.5);
    expect(textReadingState({ top: -1720, height: 1800, viewport: 800 }).phase).toBe("finale");
  });
  it("treats a short poem as non-scrollable even inside a cover and finale", () => {
    expect(textReadingState({ top: 100, height: 300, viewport: 800 })).toEqual({ phase: "reading", progress: 0, scrollable: false });
  });
  it("cannot earn a read by waiting on a cover then jumping to the ending", () => {
    let now = 0;
    const clock = createReaderClock({ now: () => now });
    clock.hold(); now += 600_000; clock.resume();
    expect(clock.activeSeconds()).toBe(0);
    const bok = { id: "short", title: "Short bok", authorName: "Author", authorHandle: "author", body: "word ".repeat(200), genre: "literary", mood: "quiet", wordCount: 200, minutes: 1, likes: 0, shares: 0, starts: 0, completes: 0, commentsCount: 0, avgSeconds: 0 };
    expect(inferReadOutcome(bok, clock.activeSeconds(), 1, { scrollable: true })).toBe("skip");
  });
});
