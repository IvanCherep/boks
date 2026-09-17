import { describe, expect, it } from "vitest";
import {
  edgeTapIntent,
  getScrollBoundary,
  horizontalNavigationIntent,
  verticalBoundaryIntent,
} from "@/components/boks/reader-navigation";

describe("reader navigation", () => {
  it("maps left to previous and right to next", () => {
    expect(horizontalNavigationIntent(-90, 8)).toBe("previous");
    expect(horizontalNavigationIntent(90, 8)).toBe("next");
    expect(horizontalNavigationIntent(30, 4)).toBeNull();
    expect(horizontalNavigationIntent(90, 110)).toBeNull();
  });

  it("only changes boks when a vertical gesture starts at the text boundary", () => {
    expect(verticalBoundaryIntent(-90, { atTop: false, atBottom: true })).toBe("next");
    expect(verticalBoundaryIntent(90, { atTop: true, atBottom: false })).toBe("previous");
    expect(verticalBoundaryIntent(-90, { atTop: false, atBottom: false })).toBeNull();
    expect(verticalBoundaryIntent(90, { atTop: false, atBottom: true })).toBeNull();
  });

  it("reserves the center of the page for revealing controls", () => {
    expect(edgeTapIntent(10, 0, 400)).toBe("previous");
    expect(edgeTapIntent(390, 0, 400)).toBe("next");
    expect(edgeTapIntent(200, 0, 400)).toBeNull();
  });

  it("recognizes the top and bottom of a scroll container", () => {
    expect(getScrollBoundary({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 })).toEqual({
      atTop: true,
      atBottom: false,
    });
    expect(getScrollBoundary({ scrollTop: 500, scrollHeight: 1000, clientHeight: 500 })).toEqual({
      atTop: false,
      atBottom: true,
    });
  });
});
