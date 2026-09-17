export type ReaderNavigationDirection = "previous" | "next";

type ScrollBoundary = {
  atTop: boolean;
  atBottom: boolean;
};

export function getScrollBoundary(element: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">): ScrollBoundary {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return {
    atTop: element.scrollTop <= 2,
    atBottom: remaining <= 2,
  };
}

/**
 * boks deliberately maps movement toward the left to the previous bok and
 * movement toward the right to the next one. The same mapping is used for
 * touch, mouse drags and trackpads.
 */
export function horizontalNavigationIntent(
  deltaX: number,
  deltaY: number,
  threshold = 64
): ReaderNavigationDirection | null {
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY)) return null;
  return deltaX < 0 ? "previous" : "next";
}

/** A vertical transition is allowed only when the gesture starts at an edge. */
export function verticalBoundaryIntent(
  deltaY: number,
  boundary: ScrollBoundary,
  threshold = 72
): ReaderNavigationDirection | null {
  if (deltaY <= -threshold && boundary.atBottom) return "next";
  if (deltaY >= threshold && boundary.atTop) return "previous";
  return null;
}

/** Taps in the outer quarters navigate; the middle keeps its focus-mode role. */
export function edgeTapIntent(
  clientX: number,
  left: number,
  width: number,
  edgeRatio = 0.24
): ReaderNavigationDirection | null {
  if (width <= 0) return null;
  const position = (clientX - left) / width;
  if (position <= edgeRatio) return "previous";
  if (position >= 1 - edgeRatio) return "next";
  return null;
}
