import { describe, expect, it } from "vitest";
import { attractTarget, autoFinger, autoHold, layersOf } from "@/lib/boks/poetry/gesture";
import { interludeAt } from "@/lib/boks/poetry/manifest";

describe("interludeAt", () => {
  const interludes = [
    { startMs: 0, endMs: 22_000, hint: "Wave the smoke away" },
    { startMs: 198_000, endMs: 257_000 },
  ];

  it("finds the music playing alone, and nothing between", () => {
    expect(interludeAt(interludes, 0)).toBe(0);
    expect(interludeAt(interludes, 21_999)).toBe(0);
    expect(interludeAt(interludes, 22_000)).toBe(-1);
    expect(interludeAt(interludes, 200_000)).toBe(1);
    expect(interludeAt(interludes, 257_000)).toBe(-1);
  });

  it("is never one for a poem without interludes", () => {
    expect(interludeAt(undefined, 1000)).toBe(-1);
    expect(interludeAt([], 1000)).toBe(-1);
  });
});

describe("attractTarget", () => {
  const idle = { x: 10, y: 20 };

  it("leaves a particle at its idle place with no finger", () => {
    expect(attractTarget(idle, null, 0, 3, 1.5, 400)).toEqual(idle);
  });

  it("orbits the finger, and the orbit tightens the longer it is held", () => {
    const finger = { x: 200, y: 300 };
    const distance = (held: number) => {
      let total = 0;
      for (let i = 0; i < 40; i += 1) {
        const p = attractTarget(idle, finger, held, i, 2, 400);
        total += Math.hypot(p.x - finger.x, p.y - finger.y);
      }
      return total / 40;
    };
    expect(distance(0)).toBeLessThan(400 * 0.2);
    expect(distance(5000)).toBeLessThan(distance(0) * 0.6);
  });

  it("draws an attract gesture over the picture, not into it", () => {
    expect(layersOf({ gesture: { kind: "attract", effect: "bees", hint: "", count: 40 } })).toEqual({ warp: false, overlay: true });
    expect(layersOf({ ambience: { effect: "snow", count: 60, wind: 0.2 } })).toEqual({ warp: false, overlay: true });
  });
});

describe("self-playing gestures", () => {
  const auto = { periodMs: 10_000, delayMs: 1000 };

  it("breathes a hold in and out on the recording's clock", () => {
    expect(autoHold(undefined, 5000)).toBe(0);
    expect(autoHold(auto, 500)).toBe(0);
    expect(autoHold(auto, 1000 + 5000)).toBeCloseTo(0.85);
    expect(autoHold(auto, 1000 + 10_000)).toBeCloseTo(0);
  });

  it("puts an invisible hand down for most of a cycle, then lifts it", () => {
    const home = { x: 0.5, y: 0.5 };
    expect(autoFinger(undefined, 3000, home)).toBeNull();
    expect(autoFinger(auto, 500, home)).toBeNull();
    const down = autoFinger(auto, 1000 + 2000, home);
    expect(down).not.toBeNull();
    expect(down!.heldMs).toBe(2000);
    expect(Math.abs(down!.x - 0.5)).toBeLessThan(0.07);
    expect(autoFinger(auto, 1000 + 8000, home)).toBeNull();
    expect(autoFinger({ ...auto, at: { x: 0.2, y: 0.3 } }, 1000, home)).toBeNull();
    expect(autoFinger({ ...auto, at: { x: 0.2, y: 0.3 } }, 1100, home)!.y).toBeCloseTo(0.3, 1);
  });
});
