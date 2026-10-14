import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expectedReadingSeconds,
  getBrowserId,
  inferReadOutcome,
  readerSignalsFromProfile,
  readingWordsPerMinute,
  recordAnonymousBoksRead,
  saveAnonymousNoticeState,
  saveProfile,
  touchKind,
} from "@/components/boks/reader-behavior";
import { initialProfile } from "@/components/boks/constants";
import type { Story } from "@/components/boks/client-types";

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "s1",
    title: "A boks",
    authorName: "Mira Vale",
    authorHandle: "mira_vale",
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
    // Twelve, not twenty: twenty was longer than most of this catalogue takes
    // to read, and it made a quatrain impossible to finish.
    expect(expectedReadingSeconds(story({ wordCount: 3 }))).toBe(12);
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

  it("counts a quatrain that fits the screen and was read as read", () => {
    // The production case that started this: 37 skips to 4 completes in a day,
    // and the skips averaged nine seconds of foreground attention. A poem with
    // nothing to scroll can never reach the progress branch, so before this it
    // needed fourteen seconds - longer than reading it twice.
    const quatrain = story({ wordCount: 30, minutes: 1 });
    expect(inferReadOutcome(quatrain, 9, 0, { scrollable: false })).toBe("complete");
    expect(inferReadOutcome(quatrain, 5, 0, { scrollable: false })).toBe("complete");
  });

  it("still calls a flick past a short poem a flick", () => {
    const quatrain = story({ wordCount: 30, minutes: 1 });
    expect(inferReadOutcome(quatrain, 3, 0, { scrollable: false })).toBe("skip");
    expect(inferReadOutcome(quatrain, 1, 0, { scrollable: false })).toBe("skip");
  });

  it("does not credit a long piece just because it was not scrolled", () => {
    // `scrollable: false` is a fact about the layout, not a discount: a 3000
    // word piece that somehow reports no scrolling still needs the time.
    const long = story({ wordCount: 3000, minutes: 14 });
    expect(inferReadOutcome(long, 60, 0, { scrollable: false })).toBe("skip");
    expect(inferReadOutcome(long, 400, 0, { scrollable: false })).toBe("complete");
  });

  it("judges a scrollable piece exactly as it did before", () => {
    expect(inferReadOutcome(story(), 280, 0.95, { scrollable: true })).toBe("complete");
    expect(inferReadOutcome(story(), 4, 1, { scrollable: true })).toBe("skip");
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

describe("browser storage that refuses", () => {
  afterEach(() => vi.unstubAllGlobals());

  function refuseStorage() {
    const refuse = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.stubGlobal("window", {
      localStorage: { getItem: refuse, setItem: refuse, removeItem: refuse },
    });
  }

  it("never throws while the reader boots or records a read", () => {
    refuseStorage();
    expect(() => saveProfile(initialProfile)).not.toThrow();
    expect(() => recordAnonymousBoksRead("s1")).not.toThrow();
    expect(() => saveAnonymousNoticeState({ first: true })).not.toThrow();
  });

  it("still issues one stable browser id for the page", () => {
    refuseStorage();
    const first = getBrowserId("boks-test-reader");
    expect(first).toMatch(/^boks-test-reader-/);
    expect(getBrowserId("boks-test-reader")).toBe(first);
  });
});

describe("readerSignalsFromProfile", () => {
  it("hands the ranker exactly what the profile holds", () => {
    const signals = readerSignalsFromProfile({
      ...initialProfile,
      completed: ["a"],
      liked: ["b"],
      skipped: ["c"],
      genreScore: { literary: 3 },
      moodScore: { quiet: 1 },
    });
    expect(signals).toEqual({
      genreAffinity: { literary: 3 },
      moodAffinity: { quiet: 1 },
      completedStoryIds: ["a"],
      likedStoryIds: ["b"],
      skippedStoryIds: ["c"],
    });
  });
});

describe("touchKind", () => {
  it("calls a press that barely moved a tap, and anything further a swipe", () => {
    expect(touchKind(0, 0)).toBe("tap");
    expect(touchKind(6, -5)).toBe("tap");
    expect(touchKind(-40, 3)).toBe("swipe");
    expect(touchKind(0, 120)).toBe("swipe");
  });
});
