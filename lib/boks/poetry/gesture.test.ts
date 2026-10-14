import { describe, expect, it } from "vitest";
import {
  approach,
  coverTransform,
  dragLean,
  flameLean,
  flingFrom,
  gestureSceneAt,
  imageToScreen,
  isGestureNotTap,
  isWarpGesture,
  lightNear,
  needsLayer,
  swipeStep,
  type PoemGesture,
} from "@/lib/boks/poetry/gesture";

describe("coverTransform", () => {
  it("crops a 9:16 picture on a taller phone the way object-fit: cover does", () => {
    // 390 x 844 shows the full height and loses the sides equally.
    const t = coverTransform({ width: 390, height: 844 }, { width: 941, height: 1672 }, { x: 0.5, y: 0.5 });
    expect(t.scaleY).toBeCloseTo(1, 6);
    expect(t.offsetY).toBeCloseTo(0, 6);
    expect(t.scaleX).toBeLessThan(1);
    // The middle of the screen is the middle of the picture...
    expect(0.5 * t.scaleX + t.offsetX).toBeCloseTo(0.5, 6);
    // ...and the two edges are cropped by the same amount.
    expect(t.offsetX).toBeCloseTo(1 - (t.scaleX + t.offsetX), 6);
  });

  it("follows object-position: a focal point at the left keeps the left edge", () => {
    const t = coverTransform({ width: 390, height: 844 }, { width: 941, height: 1672 }, { x: 0, y: 0.5 });
    expect(t.offsetX).toBeCloseTo(0, 6);
  });

  it("crops top and bottom on a wide screen", () => {
    const t = coverTransform({ width: 1600, height: 900 }, { width: 941, height: 1672 }, { x: 0.5, y: 0.5 });
    expect(t.scaleX).toBeCloseTo(1, 6);
    expect(t.scaleY).toBeLessThan(1);
    expect(0.5 * t.scaleY + t.offsetY).toBeCloseTo(0.5, 6);
  });
});

describe("approach", () => {
  it("moves towards the target without passing it, at any frame rate", () => {
    let fast = 0;
    for (let i = 0; i < 120; i += 1) fast = approach(fast, 1, 1000 / 120, 500);
    let slow = 0;
    for (let i = 0; i < 30; i += 1) slow = approach(slow, 1, 1000 / 30, 500);
    expect(fast).toBeLessThanOrEqual(1);
    expect(fast).toBeCloseTo(slow, 6);
    expect(fast).toBeGreaterThan(0.8);
  });

  it("lands exactly, so a released hold really is back at rest", () => {
    let value = 1;
    for (let i = 0; i < 600; i += 1) value = approach(value, 0, 16, 400);
    expect(value).toBe(0);
  });

  it("does nothing when no time has passed", () => {
    expect(approach(0.3, 1, 0, 400)).toBe(0.3);
  });
});

describe("dragLean", () => {
  it("reaches either extreme at two fifths of the width and no further", () => {
    expect(dragLean(156, 390)).toBeCloseTo(1, 6);
    expect(dragLean(-156, 390)).toBeCloseTo(-1, 6);
    expect(dragLean(1000, 390)).toBe(1);
    expect(dragLean(-1000, 390)).toBe(-1);
    expect(dragLean(0, 390)).toBe(0);
  });

  it("is still for a screen with no width", () => {
    expect(dragLean(50, 0)).toBe(0);
  });
});

describe("gestureSceneAt", () => {
  const hold: PoemGesture = {
    kind: "hold",
    effect: "converge-reflections",
    hint: "Hold the screen",
    waterline: 0.5,
    pull: 0.07,
    ripple: 0.006,
  };
  const scenes = [{}, { gesture: hold }, {}];

  it("is the picture on screen when it has one", () => {
    expect(gestureSceneAt(scenes, { from: 1, to: -1, progress: 0 })).toBe(1);
    expect(gestureSceneAt(scenes, { from: 0, to: -1, progress: 0 })).toBe(-1);
  });

  it("passes to the arriving picture only once it is more than half in", () => {
    expect(gestureSceneAt(scenes, { from: 0, to: 1, progress: 0.4 })).toBe(-1);
    expect(gestureSceneAt(scenes, { from: 0, to: 1, progress: 0.6 })).toBe(1);
  });

  it("lets go of a picture that is leaving", () => {
    expect(gestureSceneAt(scenes, { from: 1, to: 2, progress: 0.6 })).toBe(-1);
  });
});

describe("isGestureNotTap", () => {
  it("leaves a quick tap to play and pause", () => {
    expect(isGestureNotTap(120, 2)).toBe(false);
  });

  it("takes a press or a movement as the gesture", () => {
    expect(isGestureNotTap(400, 0)).toBe(true);
    expect(isGestureNotTap(100, 30)).toBe(true);
  });
});

describe("imageToScreen", () => {
  it("undoes coverTransform", () => {
    const t = coverTransform({ width: 390, height: 844 }, { width: 941, height: 1672 }, { x: 0.5, y: 0.5 });
    const screen = imageToScreen({ x: 0.36, y: 0.53 }, t);
    expect(screen.x * t.scaleX + t.offsetX).toBeCloseTo(0.36, 6);
    expect(screen.y * t.scaleY + t.offsetY).toBeCloseTo(0.53, 6);
  });
});

describe("flingFrom", () => {
  it("shoots the opposite way to the pull", () => {
    const shot = flingFrom({ x: 100, y: 100 }, { x: 40, y: 180 }, 200)!;
    expect(shot.x).toBeGreaterThan(0);
    expect(shot.y).toBeLessThan(0);
    expect(Math.hypot(shot.x, shot.y)).toBeCloseTo(1, 6);
    expect(shot.power).toBeCloseTo(0.5, 6);
  });

  it("launches nothing from a hesitant touch, and caps a long draw", () => {
    expect(flingFrom({ x: 0, y: 0 }, { x: 10, y: 10 }, 200)).toBeNull();
    expect(flingFrom({ x: 0, y: 0 }, { x: -900, y: 0 }, 200)!.power).toBe(1);
  });
});

describe("lightNear", () => {
  const lights = [{ x: 100, y: 100 }, { x: 300, y: 100 }];
  it("finds the nearest light in reach and none out of it", () => {
    expect(lightNear({ x: 290, y: 110 }, lights, 40)).toBe(1);
    expect(lightNear({ x: 200, y: 300 }, lights, 40)).toBe(-1);
  });
});

describe("swipeStep", () => {
  it("turns forward on a leftward swipe and back on a rightward one", () => {
    expect(swipeStep(-120, 10, 390)).toBe(1);
    expect(swipeStep(120, -10, 390)).toBe(-1);
  });

  it("ignores a short or mostly vertical movement", () => {
    expect(swipeStep(-40, 0, 390)).toBe(0);
    expect(swipeStep(-100, 200, 390)).toBe(0);
  });
});

describe("flameLean", () => {
  it("stands upright when sheltered and always leans when not, without lying flat", () => {
    for (let t = 0; t < 30; t += 0.25) {
      expect(flameLean(t, 1)).toBe(0);
      const lean = flameLean(t, 0);
      expect(lean).toBeGreaterThanOrEqual(0.2);
      expect(lean).toBeLessThanOrEqual(0.72);
    }
  });
});

describe("needsLayer and isWarpGesture", () => {
  it("draws a canvas for everything but a swipe, and warps only the two picture effects", () => {
    expect(needsLayer({ gesture: { kind: "swipe", effect: "turn-page", hint: "Swipe" } })).toBe(false);
    expect(needsLayer({ ambience: { effect: "rain", intensity: 0.5, wind: 0.3 } })).toBe(true);
    expect(needsLayer({})).toBe(false);
    expect(isWarpGesture({ kind: "fling", effect: "arrow", hint: "", origin: { x: 0, y: 0 } })).toBe(false);
  });
});
