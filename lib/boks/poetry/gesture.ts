/**
 * A picture that answers the reader's hand, as data and pure maths.
 *
 * Two poems asked for one gesture each, inside one picture: Brennan's pair of
 * reflections drawn together while the reader holds the screen, O'Dowd's
 * landscape leaning towards Eden or towards Mammon as the reader moves
 * sideways. Neither stops the reading - the voice goes on, and the gesture is
 * something the picture does while it is on screen, not a story moment that
 * waits for the reader.
 *
 * A scene opts in with a `gesture` in its scene map. The renderer draws it
 * through `components/boks/poetry/gesture-layer.ts`; everything that can be
 * computed without a screen is here, and tested.
 */

export type HoldGesture = {
  kind: "hold";
  /** The two reflections come together and the water stills. */
  effect: "converge-reflections";
  /** Shown once at the scene's start until the reader has tried it. */
  hint: string;
  /** Where the water begins, as a fraction of the image's height. */
  waterline: number;
  /** How far each reflection travels towards the middle, in image widths. */
  pull: number;
  /** Ripple amplitude at rest, in image widths. Zero while held. */
  ripple: number;
};

export type DragGesture = {
  kind: "drag-x";
  /** One picture holding two worlds side by side; moving leans into one. */
  effect: "lean-between";
  hint: string;
  /** Where the camera settles at full left and full right, in image fractions. */
  leftFocus: { x: number; y: number };
  rightFocus: { x: number; y: number };
  /** How far in the camera pushes at either extreme. 0.2 is a fifth closer. */
  zoom: number;
};

export type PoemGesture = HoldGesture | DragGesture;

/**
 * How a screen position maps into the picture under `object-fit: cover`.
 *
 * The gesture is drawn over the same picture the `<img>` shows, so it has to
 * crop exactly as the browser does - same scale, same `object-position` - or
 * the frame jumps by the crop the moment the layer takes over.
 * `image = screen * scale + offset`, per axis, both in 0..1.
 */
export function coverTransform(
  view: { width: number; height: number },
  image: { width: number; height: number },
  focal: { x: number; y: number }
) {
  const scale = Math.max(view.width / image.width, view.height / image.height);
  const shownWidth = image.width * scale;
  const shownHeight = image.height * scale;
  const left = (view.width - shownWidth) * focal.x;
  const top = (view.height - shownHeight) * focal.y;
  return {
    scaleX: view.width / shownWidth,
    scaleY: view.height / shownHeight,
    offsetX: -left / shownWidth,
    offsetY: -top / shownHeight,
  };
}

/**
 * A value easing towards where the hand wants it.
 *
 * Exponential, by elapsed time rather than by frame, so a phone dropping to
 * thirty frames a second eases at the same speed as one at a hundred and
 * twenty. Never overshoots, which is the point: still water must not wobble
 * on its way to still.
 */
export function approach(current: number, target: number, elapsedMs: number, timeConstantMs: number) {
  if (timeConstantMs <= 0 || elapsedMs <= 0) return elapsedMs > 0 ? target : current;
  const next = target + (current - target) * Math.exp(-elapsedMs / timeConstantMs);
  return Math.abs(next - target) < 0.001 ? target : next;
}

/**
 * How far a horizontal movement leans the picture, from -1 to 1.
 *
 * Measured from where the finger went down, not from the middle of the
 * screen, so a reader who touches near an edge still has the whole range.
 * Two fifths of the screen's width reaches either extreme.
 */
export function dragLean(dx: number, width: number, reach = 0.4) {
  if (width <= 0) return 0;
  return Math.max(-1, Math.min(1, dx / (width * reach)));
}

/**
 * Which picture's gesture the hand is driving, given the backdrop.
 *
 * The one on screen: the settled picture, or the arriving one once it is more
 * than half way in. Never one that is leaving - a finger put down as the
 * reflections dissolve away would otherwise work a picture already gone.
 */
export function gestureSceneAt(
  scenes: readonly { gesture?: PoemGesture }[],
  backdrop: { from: number; to: number; progress: number }
): number {
  const index = backdrop.to >= 0 && backdrop.progress >= 0.5 ? backdrop.to : backdrop.from;
  return scenes[index]?.gesture ? index : -1;
}

/** A press this long, or a finger moved this far, is a gesture rather than a tap. */
export const gestureTapMs = 280;
export const gestureTapPx = 10;

export function isGestureNotTap(heldMs: number, movedPx: number) {
  return heldMs >= gestureTapMs || movedPx >= gestureTapPx;
}
