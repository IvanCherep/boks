import { describe, expect, it } from "vitest";
import { recoverReaderPlace } from "@/components/boks/reader-place";

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
