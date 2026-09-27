export type ReaderNavigationDirection = "previous" | "next";

type ScrollBoundary = {
  atTop: boolean;
  atBottom: boolean;
};

export type VerticalBoundaryPull = {
  direction: ReaderNavigationDirection;
  progress: number;
};

export function getScrollBoundary(element: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">): ScrollBoundary {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return {
    atTop: element.scrollTop <= 2,
    atBottom: remaining <= 2,
  };
}

/**
 * Which way a sideways gesture turns the page, in drag coordinates: how far
 * the finger or pointer travelled, negative to the left.
 *
 * Right to left brings the next bok in from the right, as in every paged
 * reader and story feed - and as the transition here already animates it. The
 * mapping used to be the reverse, under a comment calling it deliberate and
 * shared by touch, mouse and trackpad. It could not be both: a wheel's delta
 * is the opposite sign of a finger's (see `horizontalWheelIntent`), so the one
 * rule was right for the trackpad and backwards on every phone.
 */
export function horizontalNavigationIntent(
  deltaX: number,
  deltaY: number,
  threshold = 64
): ReaderNavigationDirection | null {
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY)) return null;
  return deltaX < 0 ? "next" : "previous";
}

/**
 * The same for a trackpad or a sideways wheel.
 *
 * A wheel reports how far the *content* should scroll, which under natural
 * scrolling is the opposite sign of the fingers' travel: two fingers moving
 * right to left report a positive deltaX. So it is negated into drag
 * coordinates before the shared rule sees it - exactly what the vertical pull
 * has always done with deltaY. The larger threshold stays: while scrolling a
 * text, momentum produces a little sideways travel all the time.
 */
export function horizontalWheelIntent(
  deltaX: number,
  deltaY: number,
  threshold = 120
): ReaderNavigationDirection | null {
  return horizontalNavigationIntent(-deltaX, -deltaY, threshold);
}

/**
 * Progress for the deliberate second pull that changes boks at a text edge.
 * `deltaY` follows touch-drag coordinates: up is negative, down is positive.
 *
 * `deadZone` is travel that counts for nothing. Without it a short poem - which
 * fits on one screen and so is at its end the moment it opens - started the
 * pull on every ordinary attempt to scroll it, and a normal flick finished it.
 */
export function verticalBoundaryPull(
  deltaY: number,
  boundary: ScrollBoundary,
  threshold = 104,
  deadZone = 0
): VerticalBoundaryPull | null {
  const travel = Math.abs(deltaY) - deadZone;
  if (travel <= 0) return null;
  const progress = Math.min(1, travel / threshold);
  if (deltaY < 0 && boundary.atBottom) return { direction: "next", progress };
  if (deltaY > 0 && boundary.atTop) return { direction: "previous", progress };
  return null;
}

/** A vertical transition is allowed only after the edge pull is complete. */
export function verticalBoundaryIntent(
  deltaY: number,
  boundary: ScrollBoundary,
  threshold = 104,
  deadZone = 0
): ReaderNavigationDirection | null {
  const pull = verticalBoundaryPull(deltaY, boundary, threshold, deadZone);
  return pull?.progress === 1 ? pull.direction : null;
}

/** Movement beyond this is a scroll or a drag, not a tap. */
const tapSlop = 10;
/** Held longer than this, a touch is a long press - how a line gets selected. */
const longPressMs = 450;
/**
 * A touch this soon after the page last scrolled is the one that stops a
 * flick. It is about the scroll, not about the controls.
 */
const scrollSettleMs = 150;

export type ReaderTapInput = {
  dx: number;
  dy: number;
  durationMs: number;
  msSinceScroll: number;
};

export type ReaderTapAction = "toggle-chrome";

/**
 * What a tap on the reading surface is asking for: the controls. Only ever the
 * controls, on any pointer, wherever it lands.
 *
 * The interface is hidden while someone reads, and a tap is the only thing
 * that brings it back: never a new boks arriving, never a scroll. So the one
 * rule that matters is that a tap *is* recognised - on a phone it was not, at
 * all.
 *
 * A click in the outer quarter of the page used to turn it instead, for a
 * mouse. Nobody asked a page to turn by clicking beside the words they were
 * reading, and it fired on the click that dismissed something or put the
 * cursor down - https://github.com/IvanCherep/boks/issues/4. A mouse turns the
 * page with the two buttons or the arrow keys; a finger swipes or pulls. That
 * leaves the tap free to mean one thing.
 */
export function readerTapAction(input: ReaderTapInput): ReaderTapAction | null {
  if (Math.hypot(input.dx, input.dy) > tapSlop) return null;
  if (input.durationMs > longPressMs) return null;
  if (input.msSinceScroll < scrollSettleMs) return null;
  return "toggle-chrome";
}

export type ReaderKeyAction = "scroll-down" | "scroll-up" | ReaderNavigationDirection;

/**
 * What a key does while reading.
 *
 * Space and the down arrow are how people page through a long text, and they
 * used to change bok outright - the first press threw a reader out of the
 * story they were in. Now they scroll while there is text left, and change bok
 * only from the end of it, the same rule the pull follows on a phone. The side
 * arrows change bok from anywhere: nothing in a reader scrolls sideways.
 */
export function readerKeyAction(
  key: string,
  shiftKey: boolean,
  boundary: ScrollBoundary
): ReaderKeyAction | null {
  const down = key === "ArrowDown" || key === "PageDown" || (key === " " && !shiftKey);
  const up = key === "ArrowUp" || key === "PageUp" || (key === " " && shiftKey);
  if (down) return boundary.atBottom ? "next" : "scroll-down";
  if (up) return boundary.atTop ? "previous" : "scroll-up";
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return "previous";
  return null;
}
