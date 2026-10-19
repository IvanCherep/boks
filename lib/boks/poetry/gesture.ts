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

export type HoldGesture = WaterHold | FlameHold | GloryHold | SpiritsHold;

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
 * A candle held among the dead. At rest the flame gutters, the light it
 * throws trembles and a drifting fog veils the figures around it; held, the
 * flame steadies, the fog thins and moves aside, and the spirits painted in
 * the mist come forward. Released, the fog closes over them again.
 */
export type SpiritsHold = {
  kind: "hold";
  effect: "summon-spirits";
  hint: string;
  /** The painted flame. */
  candle: ImagePoint;
  /** The one who holds it, kept clear of the fog: a soft ellipse, half-sizes in image fractions. */
  figure: ImagePoint;
  radius: { x: number; y: number };
};

/**
 * Condensation on a glass, wiped away by a finger. What is cleared stays
 * cleared; the reflection behind it settles a little further back the more of
 * it is seen.
 */
export type WipeGesture = {
  kind: "wipe";
  effect: "clear-condensation";
  hint: string;
  /** The glass, in image fractions: its top-left corner and size. */
  glass: { x: number; y: number; width: number; height: number };
  /** The finger's width, as a fraction of the glass's width. */
  brush: number;
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
  | { effect: "returning-song"; from: ImagePoint; to: ImagePoint }
  | LeavesAmbience
  | CandleAmbience
  | ShadowAmbience;

/** Leaves coming down through the frame, and a low sun that slowly shifts. */
export type LeavesAmbience = { effect: "falling-leaves"; count: number; sun?: ImagePoint };

/** The light a painted candle throws, never quite still. */
export type CandleAmbience = { effect: "candle-glow"; at: ImagePoint; radius: number };

/**
 * A shadow that comes out of moving branches. Branch shadows sway across the
 * picture; inside `shadow` the sun at first fills the painted figure in, and
 * from `afterMs` into the scene - by the recording's clock - it gives way, so
 * the shape is found among the leaves rather than switched on.
 */
export type ShadowAmbience = {
  effect: "emerge-shadow";
  shadow: ImagePoint;
  radius: { x: number; y: number };
  afterMs: number;
};

export type DragGesture = LeanDrag | TurnDrag;

/**
 * The one who would not turn round. A sideways drag starts him turning - the
 * view swings towards `apparition` - and the further it goes the more of her
 * fades into light. Let go short of the end and she is there again; carried
 * all the way round, she is gone for as long as the picture is up.
 */
export type TurnDrag = {
  kind: "drag-x";
  effect: "turn-away";
  hint: string;
  /** The figure that is not there to be seen, a soft ellipse in image fractions. */
  apparition: ImagePoint;
  radius: { x: number; y: number };
};

export type LeanDrag = {
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

export type PoemGesture = HoldGesture | DragGesture | FlingGesture | ThreadGesture | SwipeGesture | WipeGesture;

/** The gestures drawn by redrawing the picture itself, in WebGL. */
export type WarpGesture = WaterHold | GloryHold | SpiritsHold | DragGesture | WipeGesture;

export function isWarpGesture(gesture?: PoemGesture): gesture is WarpGesture {
  return (
    gesture?.effect === "converge-reflections" ||
    gesture?.effect === "recall-glory" ||
    gesture?.effect === "summon-spirits" ||
    gesture?.effect === "lean-between" ||
    gesture?.effect === "turn-away" ||
    gesture?.effect === "clear-condensation"
  );
}

/** The ambiences drawn by redrawing the picture itself, in WebGL. */
export function isWarpAmbience(ambience?: SceneAmbience): ambience is ShadowAmbience {
  return ambience?.effect === "emerge-shadow";
}

type LayeredScene = { gesture?: PoemGesture; ambience?: SceneAmbience };

/**
 * What a scene draws, and where. The picture itself is redrawn in WebGL for a
 * warp; anything drawn over it goes on a 2D canvas. A scene may have both - a
 * warp under the hand and leaves falling over it - and then has two canvases.
 * A picture can only be warped by one thing, so a warp gesture never shares a
 * scene with a warp ambience.
 */
export function layersOf(scene: LayeredScene) {
  const warp = isWarpGesture(scene.gesture) || isWarpAmbience(scene.ambience);
  const overlay =
    (Boolean(scene.ambience) && !isWarpAmbience(scene.ambience)) ||
    (Boolean(scene.gesture) && scene.gesture?.kind !== "swipe" && !isWarpGesture(scene.gesture));
  return { warp, overlay };
}

/** Whether a scene needs a canvas over its picture at all. A swipe draws nothing. */
export function needsLayer(scene: LayeredScene) {
  const { warp, overlay } = layersOf(scene);
  return warp || overlay;
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
 * How far round a turn has come, 0 to 1, whichever way the hand went.
 * At `done` and beyond the turn is complete: there is nothing behind him.
 */
export function turnAmount(lean: number) {
  return Math.min(1, Math.abs(lean));
}
export const turnDone = 0.97;

/**
 * A finger's path across the glass, as points to stamp: one every `spacing`,
 * so a fast stroke leaves a line rather than a row of dots. Both ends are in
 * the same units as `spacing`; the start is not repeated.
 */
export function wipeStamps(from: { x: number; y: number } | null, to: { x: number; y: number }, spacing: number) {
  if (!from || spacing <= 0) return [to];
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(length / spacing));
  return Array.from({ length: steps }, (_, index) => {
    const u = (index + 1) / steps;
    return { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };
  });
}

/** A screen position, in fractions of the screen, as a place on the picture. */
export function screenToImage(point: ImagePoint, transform: ReturnType<typeof coverTransform>) {
  return { x: point.x * transform.scaleX + transform.offsetX, y: point.y * transform.scaleY + transform.offsetY };
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
