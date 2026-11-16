import { describe, expect, it } from "vitest";
import { attractTarget, layersOf } from "@/lib/boks/poetry/gesture";
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
