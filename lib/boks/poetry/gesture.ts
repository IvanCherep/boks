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

/** A place in the picture, as fractions of the image's width and height. */
export type ImagePoint = { x: number; y: number };

export type HoldGesture = WaterHold | FlameHold | GloryHold;

export type WaterHold = {
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

/** Held, the flame stands upright against the wind; released, it bends and never goes out. */
export type FlameHold = {
  kind: "hold";
  effect: "shelter-flame";
  hint: string;
  /** The middle of the painted flame. */
  flame: ImagePoint;
  /** Its height, in image heights. */
  size: number;
};

/**
 * A memory painted into the clouds. At rest it is storm - drained to the grey
 * of the sky around it; held, its gold comes back and the rest of the picture
 * dims a little; released, it sinks into the cloud again.
 */
export type GloryHold = {
  kind: "hold";
  effect: "recall-glory";
  hint: string;
  /** The middle of the painted vision. */
  vision: ImagePoint;
  /** Its half-width and half-height, in image fractions; the edge is soft. */
  radius: { x: number; y: number };
};

/**
 * Draw back and let go, as with a bow: something leaves `origin` in the
 * direction opposite to the pull and is lost in the distance. An arrow, or the
 * same gesture made a song - a golden wave.
 */
export type FlingGesture = {
  kind: "fling";
  effect: "arrow" | "song";
  hint: string;
  origin: ImagePoint;
};

/**
 * Threads drawn from `anchor` to the lights; one let go on a light holds.
 * Once `bridgeAfter` hold - counted across the whole poem - the lights join
 * into a luminous bridge.
 */
export type ThreadGesture = {
  kind: "threads";
  effect: "filaments";
  hint: string;
  anchor: ImagePoint;
  lights: ImagePoint[];
  bridgeAfter: number;
};

/** A swipe turns the page: to the next picture, or back to the one before. */
export type SwipeGesture = {
  kind: "swipe";
  effect: "turn-page";
  hint: string;
};

/**
 * Something a picture does on its own, with no hand: rain that thins as a
 * storm passes, or the song coming back from the distance into a heart.
 */
export type SceneAmbience =
  | { effect: "rain"; intensity: number; wind: number }
  | { effect: "returning-song"; from: ImagePoint; to: ImagePoint };

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

export type PoemGesture = HoldGesture | DragGesture | FlingGesture | ThreadGesture | SwipeGesture;

/** The gestures drawn by redrawing the picture itself, in WebGL. */
export type WarpGesture = WaterHold | GloryHold | DragGesture;

export function isWarpGesture(gesture?: PoemGesture): gesture is WarpGesture {
  return (
    gesture?.effect === "converge-reflections" ||
    gesture?.effect === "recall-glory" ||
    gesture?.effect === "lean-between"
  );
}

/** Whether a scene needs a canvas over its picture at all. A swipe draws nothing. */
export function needsLayer(scene: { gesture?: PoemGesture; ambience?: SceneAmbience }) {
  return Boolean(scene.ambience) || (Boolean(scene.gesture) && scene.gesture?.kind !== "swipe");
}

/**
 * Where a point of the picture is on the screen, as fractions of the screen -
 * the inverse of `coverTransform`.
 */
export function imageToScreen(point: ImagePoint, transform: ReturnType<typeof coverTransform>) {
  return {
    x: (point.x - transform.offsetX) / transform.scaleX,
    y: (point.y - transform.offsetY) / transform.scaleY,
  };
}

/**
 * A pull, read as a bow is: the shot goes the opposite way to the hand, as
 * hard as the hand drew back. Too short a pull is no shot, so a hesitant touch
 * launches nothing. `reach` is how far a full draw is, in pixels.
 */
export function flingFrom(
  start: { x: number; y: number },
  end: { x: number; y: number },
  reach: number,
  minimum = 24
) {
  const dx = start.x - end.x;
  const dy = start.y - end.y;
  const length = Math.hypot(dx, dy);
  if (length < minimum || reach <= 0) return null;
  return { x: dx / length, y: dy / length, power: Math.min(1, length / reach) };
}

/** The nearest light within `radius` of a point, or -1. */
export function lightNear(
  point: { x: number; y: number },
  lights: readonly { x: number; y: number }[],
  radius: number
) {
  let best = -1;
  let bestDistance = radius;
  lights.forEach((light, index) => {
    const distance = Math.hypot(light.x - point.x, light.y - point.y);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * A page turned by a swipe: 1 forward (the finger moved left), -1 back, 0 for
 * anything that was not clearly sideways or not far enough - a sixth of the
 * screen, and more across than down.
 */
export function swipeStep(dx: number, dy: number, width: number): -1 | 0 | 1 {
  if (width <= 0 || Math.abs(dx) < width / 6 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * How far the flame leans, in radians, away from the wind.
 *
 * Gusting, never still, and never flat: at its worst it lies over by about
 * forty degrees and comes back. Sheltered (`hold` 1) it stands upright.
 */
export function flameLean(seconds: number, hold: number) {
  const gust = 0.5 + 0.14 * Math.sin(seconds * 1.7) + 0.08 * Math.sin(seconds * 4.3 + 1);
  return (1 - hold) * Math.min(0.72, Math.max(0.2, gust));
}

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
