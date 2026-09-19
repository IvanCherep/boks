import { describe, expect, it } from "vitest";
import { composeReaderRanking, holdPinnedStory, placeEntryStory, recoverReaderPlace } from "@/components/boks/reader-place";

describe("recoverReaderPlace", () => {
  it("keeps the reader on the boks they acted on when the reload re-ranks it", () => {
    const before = ["a", "b", "c"];
    const after = ["c", "b", "a"];
    const pinned = before[2];

    expect(recoverReaderPlace(after, pinned, 2)).toBe(0);
  });

  it("does not move a reader whose boks kept its rank", () => {
    expect(recoverReaderPlace(["a", "b", "c"], "b", 1)).toBe(1);
  });

  it("holds the index when the pinned boks left the ranking", () => {
    expect(recoverReaderPlace(["a", "b"], "gone", 1)).toBe(1);
  });

  it("does nothing without a pin, so ordinary loads still start at the top", () => {
    expect(recoverReaderPlace(["a", "b"], null, 0)).toBe(0);
  });

  it("holds the index while the feed is empty, so an in-flight reload cannot reset it", () => {
    expect(recoverReaderPlace([], "a", 3)).toBe(3);
  });
});

describe("holdPinnedStory", () => {
  const story = (id: string) => ({ id });
  const ids = (stories: readonly { id: string }[]) => stories.map((entry) => entry.id);

  it("keeps a liked boks under the reader when the reload ranks it out of the slate", () => {
    // A like raises the boks's fatigue, which sends it behind every unseen
    // piece - past the end of an 80-item slate. The reader was on index 1.
    const reranked = [story("x"), story("y"), story("z")];
    const held = holdPinnedStory(reranked, { story: story("liked"), index: 1 });

    expect(ids(held)).toEqual(["x", "liked", "y", "z"]);
    expect(recoverReaderPlace(ids(held), "liked", 1)).toBe(1);
  });

  it("leaves the ranking alone when the boks is still in it", () => {
    const reranked = [story("a"), story("liked"), story("b")];

    expect(ids(holdPinnedStory(reranked, { story: story("liked"), index: 0 }))).toEqual(["a", "liked", "b"]);
  });

  it("appends at the end when the held place is past the new slate", () => {
    expect(ids(holdPinnedStory([story("a")], { story: story("liked"), index: 7 }))).toEqual(["a", "liked"]);
  });

  it("does nothing without a held boks", () => {
    expect(ids(holdPinnedStory([story("a"), story("b")], null))).toEqual(["a", "b"]);
  });

  it("does not hold a boks into a feed that has not loaded", () => {
    expect(holdPinnedStory([], { story: story("liked"), index: 0 })).toEqual([]);
  });
});

describe("placeEntryStory", () => {
  const story = (id: string) => ({ id });
  const ids = (stories: readonly { id: string }[]) => stories.map((entry) => entry.id);

  it("opens a library boks at the current place and continues with recommendations", () => {
    const placed = placeEntryStory(
      [story("recommendation-a"), story("recommendation-b"), story("recommendation-c")],
      { story: story("library-boks"), index: 1 }
    );

    expect(ids(placed)).toEqual([
      "recommendation-a",
      "library-boks",
      "recommendation-b",
      "recommendation-c",
    ]);
    expect(placed[2]?.id).toBe("recommendation-b");
  });

  it("moves a boks already in the slate instead of duplicating it", () => {
    const placed = placeEntryStory(
      [story("a"), story("library-boks"), story("b")],
      { story: story("library-boks"), index: 0 }
    );

    expect(ids(placed)).toEqual(["library-boks", "a", "b"]);
  });

  it("can show a directly opened boks while recommendations are empty", () => {
    expect(ids(placeEntryStory([], { story: story("library-boks"), index: 0 }))).toEqual(["library-boks"]);
  });
});

describe("composeReaderRanking", () => {
  const story = (id: string) => ({ id });
  const ids = (stories: readonly { id: string }[]) => stories.map((entry) => entry.id);
  const feed = [story("a"), story("b"), story("c")];

  it("is the feed when nothing is opened, held or hidden", () => {
    expect(ids(composeReaderRanking(feed, null, null))).toEqual(["a", "b", "c"]);
  });

  it("moves the next boks into the place of one an admin hid", () => {
    // The admin was on index 1 ("b") and hid it: index 1 is now "c".
    const ranked = composeReaderRanking(feed, null, null, new Set(["b"]));
    expect(ids(ranked)).toEqual(["a", "c"]);
    expect(ranked[1].id).toBe("c");
  });

  it("does not let a held boks bring a hidden one back", () => {
    const held = { story: story("hidden"), index: 1 };
    expect(ids(composeReaderRanking(feed, null, held, new Set(["hidden"])))).toEqual(["a", "b", "c"]);
  });

  it("does not let a boks opened from a link bring a hidden one back", () => {
    const entry = { story: story("hidden"), index: 0 };
    expect(ids(composeReaderRanking(feed, entry, null, new Set(["hidden"])))).toEqual(["a", "b", "c"]);
  });

  it("keeps an opened boks and a held boks in their places", () => {
    const entry = { story: story("opened"), index: 1 };
    const held = { story: story("held"), index: 3 };
    expect(ids(composeReaderRanking(feed, entry, held))).toEqual(["a", "opened", "b", "held", "c"]);
  });
});
