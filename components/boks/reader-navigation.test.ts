import { describe, expect, it } from "vitest";
import {
  getScrollBoundary,
  horizontalNavigationIntent,
  horizontalWheelIntent,
  readerKeyAction,
  readerTapAction,
  verticalBoundaryIntent,
  verticalBoundaryPull,
} from "@/components/boks/reader-navigation";

describe("reader navigation", () => {
  it("turns to the next bok when the finger moves right to left", () => {
    // Reported on a phone: swiping right to left brought up the previous bok.
    // This test used to assert exactly that - `-90` was "previous" - so the
    // bug was written down as the specification. Every paged reader and story
    // feed brings the next page in from the right, and the transition here
    // already slides the next bok in from the right, so the old mapping sent
    // the page the opposite way to the finger.
    expect(horizontalNavigationIntent(-90, 8)).toBe("next");
    expect(horizontalNavigationIntent(90, 8)).toBe("previous");
    expect(horizontalNavigationIntent(30, 4)).toBeNull();
    expect(horizontalNavigationIntent(90, 110)).toBeNull();
  });

  it("gives a trackpad the same result as a finger moving the same way", () => {
    // A wheel reports how far the content should scroll, which under natural
    // scrolling is the opposite sign of the fingers' travel. Two fingers moving
    // right to left report a positive deltaX. Feeding that straight into the
    // touch rule is what made one of the two backwards: whichever sign the
    // rule picked, touch and trackpad disagreed.
    expect(horizontalWheelIntent(150, 4)).toBe("next");
    expect(horizontalWheelIntent(-150, 4)).toBe("previous");
    // The wheel keeps its larger threshold: momentum makes small sideways
    // travel common while scrolling a text.
    expect(horizontalWheelIntent(100, 4)).toBeNull();
    expect(horizontalWheelIntent(150, 200)).toBeNull();
  });

  it("only changes boks when a vertical gesture starts at the text boundary", () => {
    expect(verticalBoundaryIntent(-120, { atTop: false, atBottom: true })).toBe("next");
    expect(verticalBoundaryIntent(120, { atTop: true, atBottom: false })).toBe("previous");
    expect(verticalBoundaryIntent(-120, { atTop: false, atBottom: false })).toBeNull();
    expect(verticalBoundaryIntent(120, { atTop: false, atBottom: true })).toBeNull();
  });

  it("reports edge-pull progress before committing to another bok", () => {
    expect(verticalBoundaryPull(-52, { atTop: false, atBottom: true })).toEqual({
      direction: "next",
      progress: 0.5,
    });
    expect(verticalBoundaryPull(-104, { atTop: false, atBottom: true })).toEqual({
      direction: "next",
      progress: 1,
    });
    expect(verticalBoundaryPull(26, { atTop: true, atBottom: false })).toEqual({
      direction: "previous",
      progress: 0.25,
    });
    expect(verticalBoundaryPull(-52, { atTop: true, atBottom: false })).toBeNull();
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

describe("what a tap means", () => {
  const tap = {
    dx: 2,
    dy: 3,
    durationMs: 120,
    msSinceScroll: 5_000,
  };

  it("asks for the controls, and never for another boks", () => {
    // On touch a tap used to do nothing at all: the touch handler only looked
    // for swipes and the pointer handler returned early for touch. So the one
    // way a reader could ask for the controls did not exist on a phone.
    //
    // A click in the outer quarter used to turn the page for a mouse, which
    // nobody asked for beside the words they were reading (issue #4). There is
    // no position in the input any more, so there is nothing left to get wrong:
    // a tap that passes the checks below means the controls, wherever it fell.
    expect(readerTapAction(tap)).toBe("toggle-chrome");
  });

  it("does not treat a scroll, a drag or a long press as a request for the interface", () => {
    expect(readerTapAction({ ...tap, dy: 24 })).toBeNull();
    expect(readerTapAction({ ...tap, dx: 30 })).toBeNull();
    // Long press is how a reader selects a line to copy it.
    expect(readerTapAction({ ...tap, durationMs: 700 })).toBeNull();
  });

  it("ignores the tap that stops a scroll", () => {
    // Touching a page still gliding from a flick stops it. That touch is about
    // the scroll, not about the controls, and toggling on it would make the
    // interface flicker in and out while someone is simply reading.
    expect(readerTapAction({ ...tap, msSinceScroll: 60 })).toBeNull();
  });
});

describe("the pull that changes bok", () => {
  const atBottom = { atTop: false, atBottom: true };

  it("ignores the first stretch of a pull, so reading never trips it", () => {
    // A short poem fits on one screen, so it is at its end the moment it
    // opens, and every ordinary attempt to scroll it used to start the pull.
    expect(verticalBoundaryPull(-10, atBottom, 150, 18)).toBeNull();
  });

  it("measures progress from where the dead zone ends", () => {
    expect(verticalBoundaryPull(-(18 + 75), atBottom, 150, 18)).toEqual({
      direction: "next",
      progress: 0.5,
    });
    expect(verticalBoundaryPull(-(18 + 150), atBottom, 150, 18)?.progress).toBe(1);
  });

  it("commits only once the whole pull is made", () => {
    expect(verticalBoundaryIntent(-(18 + 149), atBottom, 150, 18)).toBeNull();
    expect(verticalBoundaryIntent(-(18 + 150), atBottom, 150, 18)).toBe("next");
  });
});

describe("keys while reading", () => {
  const middle = { atTop: false, atBottom: false };
  const end = { atTop: false, atBottom: true };
  const start = { atTop: true, atBottom: false };

  it("scrolls the text while there is text left to read", () => {
    // Space and the down arrow used to change bok outright, so someone paging
    // through a long story with Space was thrown out of it on the first press.
    expect(readerKeyAction(" ", false, middle)).toBe("scroll-down");
    expect(readerKeyAction("ArrowDown", false, middle)).toBe("scroll-down");
    expect(readerKeyAction("PageDown", false, middle)).toBe("scroll-down");
    expect(readerKeyAction(" ", true, middle)).toBe("scroll-up");
    expect(readerKeyAction("ArrowUp", false, middle)).toBe("scroll-up");
  });

  it("changes bok only from the end of the text in that direction", () => {
    expect(readerKeyAction(" ", false, end)).toBe("next");
    expect(readerKeyAction("ArrowDown", false, end)).toBe("next");
    expect(readerKeyAction("ArrowUp", false, start)).toBe("previous");
  });

  it("uses the side arrows to change bok from anywhere", () => {
    expect(readerKeyAction("ArrowRight", false, middle)).toBe("next");
    expect(readerKeyAction("ArrowLeft", false, middle)).toBe("previous");
  });

  it("leaves every other key alone", () => {
    expect(readerKeyAction("a", false, middle)).toBeNull();
    expect(readerKeyAction("Enter", false, middle)).toBeNull();
  });
});
