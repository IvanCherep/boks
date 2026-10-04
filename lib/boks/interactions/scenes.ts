/**
 * Interactive scenes: twelve stories, five mechanics.
 *
 * The point of this file is that a boks contributes pictures and a line of
 * configuration, never code. Twelve bespoke components would each be a place
 * for a bug and none of them would make the thirteenth story cheaper. So the
 * mechanics are a closed set of primitives, and a scene says which one it
 * wants and how far.
 *
 * - `toggle` - a tap flips the state. Optionally it springs back, which is
 *   how a bell rings and water settles.
 * - `hold`   - the state is held only while a finger is down.
 * - `drag`   - distance moved along one axis is the progress.
 * - `mask`   - the reader uncovers the lower picture, either with a light
 *   that follows the finger or with a brush that remembers.
 * - `slider` - the two pictures meet at a seam the reader moves.
 *
 * Everything here is pure and unit-tested. The component that renders it owns
 * pointers, canvas and animation, and owns no story logic at all.
 */

import type { SoundProfile } from "@/lib/boks/interactions/sound";

export type ScenePrimitive = "toggle" | "hold" | "drag" | "mask" | "slider";

/**
 * The shape of the "you can do something here" cue.
 *
 * Derived from the primitive rather than stored, because a scene that said
 * `drag` and drew a tap ring would be a scene lying to the reader, and there
 * is no case where we would want that.
 */
export type Affordance = "tap" | "hold" | "drag" | "seam" | "glow" | "scrub";

export type Axis = "x" | "y";

export type InteractionScene = {
  id: string;
  /** Shown on the sandbox card, and the name we use when talking about it. */
  title: string;
  primitive: ScenePrimitive;
  /** One short imperative. More than one and the interaction has failed. */
  hint: string;
  /** Where the reader is meant to press, as a fraction of the frame. */
  hotspot?: { x: number; y: number };
  /** The sound the action makes. Keyed to the mechanic unless a story needs
      its own - see `lib/boks/interactions/sound.ts`. */
  sound: SoundProfile;
  axis?: Axis;
  /** Up means dragging up increases progress. */
  direction?: "up" | "down";
  /** Travel, in CSS pixels, that takes progress from 0 to 1. */
  distancePx?: number;
  /** Past this, releasing latches to the end instead of falling back. */
  snapThreshold?: number;
  /** Radial reveal: the lit circle and how soft its edge is. */
  radiusPx?: number;
  featherPx?: number;
  /** Brush reveal: the eraser, and how much must be cleared to count. */
  brushRadiusPx?: number;
  completionThreshold?: number;
  /** Springing toggles: out, wait, back. */
  enterMs?: number;
  holdMs?: number;
  exitMs?: number;
  /** Holds: how long before it takes, and the two ramps. */
  activationDelayMs?: number;
  /** Sliders start part-way, so the seam is visible before it is touched. */
  initialProgress?: number;
};

export const interactionScenes: readonly InteractionScene[] = [
  {
    id: "tap-light",
    title: "A lamp in the study",
    primitive: "toggle",
    hint: "Touch the lamp",
    hotspot: { x: 0.4, y: 0.27 },
    sound: "chime",
    enterMs: 450,
    exitMs: 450,
  },
  {
    id: "move-light",
    title: "Light in a foggy lane",
    primitive: "mask",
    hint: "Move the light",
    hotspot: { x: 0.5, y: 0.55 },
    sound: "hum",
    radiusPx: 120,
    featherPx: 36,
  },
  {
    id: "hold-focus",
    title: "The lion and the pup in the crowd",
    primitive: "hold",
    hint: "Hold",
    hotspot: { x: 0.5, y: 0.5 },
    sound: "hum",
    enterMs: 350,
    exitMs: 500,
  },
  {
    id: "wipe-frost",
    title: "Frost on a night-train window",
    primitive: "mask",
    hint: "Wipe the frost",
    hotspot: { x: 0.5, y: 0.45 },
    sound: "scrape",
    brushRadiusPx: 56,
    completionThreshold: 0.55,
  },
  {
    id: "drag-door",
    title: "A door to the candlelit parlour",
    primitive: "drag",
    hint: "Open the door",
    hotspot: { x: 0.59, y: 0.44 },
    sound: "slide",
    axis: "y",
    direction: "down",
    distancePx: 220,
    snapThreshold: 0.55,
  },
  {
    id: "time-slider",
    title: "From the ball to a cold dawn",
    primitive: "slider",
    hint: "Drag to the right",
    sound: "tick",
    axis: "x",
    initialProgress: 0.5,
  },
  {
    id: "tap-bell",
    title: "A bell in the snowy silence",
    primitive: "toggle",
    hint: "Touch the bell",
    hotspot: { x: 0.5, y: 0.34 },
    sound: "bell",
    enterMs: 120,
    holdMs: 320,
    exitMs: 650,
  },
  {
    id: "water-ripples",
    title: "A moonlit pond, golden ripples",
    primitive: "toggle",
    hint: "Touch the water",
    hotspot: { x: 0.5, y: 0.62 },
    sound: "water",
    enterMs: 180,
    holdMs: 650,
    exitMs: 500,
  },
  {
    id: "reveal-ink",
    title: "A line coming alive by candlelight",
    primitive: "drag",
    hint: "Reveal the line",
    hotspot: { x: 0.45, y: 0.5 },
    sound: "paper",
    axis: "x",
    distancePx: 260,
    snapThreshold: 0.7,
  },
  {
    id: "swipe-crowd",
    title: "Sweep the crowd aside",
    primitive: "drag",
    hint: "Part the crowd",
    hotspot: { x: 0.5, y: 0.55 },
    sound: "slide",
    axis: "x",
    distancePx: 180,
    snapThreshold: 0.45,
  },
  {
    id: "hold-moment",
    title: "A vanishing moment",
    primitive: "hold",
    hint: "Don't let go",
    hotspot: { x: 0.5, y: 0.5 },
    sound: "hum",
    activationDelayMs: 250,
    enterMs: 600,
    exitMs: 900,
  },
  {
    id: "pull-bookmark",
    title: "A burgundy bookmark at dawn",
    primitive: "drag",
    hint: "Pull the bookmark",
    hotspot: { x: 0.5, y: 0.71 },
    sound: "paper",
    axis: "y",
    direction: "up",
    distancePx: 220,
    snapThreshold: 0.7,
  },
];

/**
 * Which cue to draw. Every primitive has one: a reader must never have to
 * discover that a picture was touchable by touching it at random.
 */
export function affordanceFor(scene: InteractionScene): Affordance {
  switch (scene.primitive) {
    case "toggle":
      return "tap";
    case "hold":
      return "hold";
    case "drag":
      return "drag";
    case "slider":
      return "seam";
    default:
      return scene.brushRadiusPx === undefined ? "glow" : "scrub";
  }
}

/** The direction a drag cue points, in degrees, 0 being to the right. */
export function dragCueAngle(scene: InteractionScene): number {
  if (scene.axis === "y") return scene.direction === "up" ? -90 : 90;
  return 0;
}

export function sceneById(id: string): InteractionScene | null {
  return interactionScenes.find((scene) => scene.id === id) ?? null;
}

/** Both pictures of a scene, served from our own origin. */
export function sceneAssets(id: string) {
  return {
    before: `/interactions/${id}/before.webp`,
    after: `/interactions/${id}/after.webp`,
  };
}

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * How far a drag has got, as 0 to 1.
 *
 * Movement is measured along one axis only, so a thumb that wanders across
 * the other one does not add progress it did not mean. Screen y grows
 * downwards, which is why "up" is the one that needs the sign flipped: for a
 * bookmark pulled up the finger's y decreases as progress increases.
 */
export function dragProgress(
  start: { x: number; y: number },
  current: { x: number; y: number },
  scene: Pick<InteractionScene, "axis" | "direction" | "distancePx">
): number {
  const distance = scene.distancePx && scene.distancePx > 0 ? scene.distancePx : 200;
  const moved = scene.axis === "y" ? current.y - start.y : current.x - start.x;
  const signed = scene.direction === "up" ? -moved : moved;
  return clamp01(signed / distance);
}

/**
 * Where a release leaves it.
 *
 * Past the threshold it latches open, short of it it falls back - so a reader
 * is never left holding a half-open door, and a half-hearted swipe does not
 * count as having seen the thing.
 */
export function snapTarget(progress: number, snapThreshold = 0.5): 0 | 1 {
  return progress >= snapThreshold ? 1 : 0;
}

/** Where the seam sits when the finger is at `x` across a frame `width` wide. */
export function sliderProgress(x: number, width: number): number {
  if (width <= 0) return 0;
  return clamp01(x / width);
}

/**
 * How much of the frost has been rubbed away.
 *
 * Measured on a coarse grid rather than per pixel: reading a canvas back is
 * the slow part, and the only question being asked is "enough yet?". Cells
 * are marked as the brush passes, so this is a count, not an image.
 */
export function clearedFraction(cells: readonly boolean[]): number {
  if (cells.length === 0) return 0;
  let cleared = 0;
  for (const cell of cells) if (cell) cleared += 1;
  return cleared / cells.length;
}

/** Which grid cells a round brush at (x, y) covers, as indexes into the grid. */
export function brushCells(
  x: number,
  y: number,
  radius: number,
  grid: { columns: number; rows: number; width: number; height: number }
): number[] {
  const { columns, rows, width, height } = grid;
  if (columns <= 0 || rows <= 0 || width <= 0 || height <= 0) return [];
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const first = Math.max(0, Math.floor((x - radius) / cellWidth));
  const last = Math.min(columns - 1, Math.floor((x + radius) / cellWidth));
  const top = Math.max(0, Math.floor((y - radius) / cellHeight));
  const bottom = Math.min(rows - 1, Math.floor((y + radius) / cellHeight));

  const hit: number[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = first; column <= last; column += 1) {
      // The centre of the cell, against the circle rather than its box, so a
      // brush does not claim corners it never touched.
      const cx = (column + 0.5) * cellWidth;
      const cy = (row + 0.5) * cellHeight;
      if ((cx - x) ** 2 + (cy - y) ** 2 <= radius ** 2) hit.push(row * columns + column);
    }
  }
  return hit;
}

/**
 * The state a scene opens in.
 *
 * A slider opens part-way so the seam advertises itself; everything else
 * opens closed, because the whole point is that the reader does the thing.
 */
export function initialProgressFor(scene: InteractionScene): number {
  return scene.primitive === "slider" ? clamp01(scene.initialProgress ?? 0.5) : 0;
}
