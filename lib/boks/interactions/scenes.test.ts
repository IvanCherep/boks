import { describe, expect, it } from "vitest";
import {
  affordanceFor,
  brushCells,
  dragCueAngle,
  clearedFraction,
  dragProgress,
  initialProgressFor,
  interactionScenes,
  sceneAssets,
  sceneById,
  sliderProgress,
  snapTarget,
} from "@/lib/boks/interactions/scenes";
import { shouldRepeat } from "@/lib/boks/interactions/sound";

describe("the scene manifest", () => {
  it("has twelve scenes with unique ids", () => {
    expect(interactionScenes).toHaveLength(12);
    expect(new Set(interactionScenes.map((s) => s.id)).size).toBe(12);
  });

  it("gives every scene the parameters its primitive needs", () => {
    // A scene missing its distance would still run - at the default - and the
    // mistake would show up as "that one feels wrong" rather than as a fault.
    for (const scene of interactionScenes) {
      expect(scene.hint.length).toBeGreaterThan(0);
      if (scene.primitive === "drag") {
        expect(scene.axis).toBeDefined();
        expect(scene.distancePx).toBeGreaterThan(0);
        expect(scene.snapThreshold).toBeGreaterThan(0);
      }
      if (scene.primitive === "toggle") expect(scene.enterMs).toBeGreaterThan(0);
      if (scene.primitive === "hold") expect(scene.exitMs).toBeGreaterThan(0);
    }
  });

  it("points at two pictures per scene, on our own origin", () => {
    for (const scene of interactionScenes) {
      const assets = sceneAssets(scene.id);
      expect(assets.before).toBe(`/interactions/${scene.id}/before.webp`);
      expect(assets.after).toBe(`/interactions/${scene.id}/after.webp`);
    }
    expect(sceneById("no-such-scene")).toBeNull();
  });

  it("opens a slider part-way and everything else closed", () => {
    expect(initialProgressFor(sceneById("time-slider")!)).toBe(0.5);
    expect(initialProgressFor(sceneById("tap-light")!)).toBe(0);
    expect(initialProgressFor(sceneById("pull-bookmark")!)).toBe(0);
  });
});

describe("drag progress", () => {
  const door = sceneById("drag-door")!; // y, down, 220px
  const bookmark = sceneById("pull-bookmark")!; // y, up, 220px
  const ink = sceneById("reveal-ink")!; // x, 260px

  it("measures along its own axis and ignores the other", () => {
    expect(dragProgress({ x: 0, y: 0 }, { x: 0, y: 110 }, door)).toBeCloseTo(0.5);
    // A thumb that slides sideways on a vertical drag adds nothing.
    expect(dragProgress({ x: 0, y: 0 }, { x: 999, y: 110 }, door)).toBeCloseTo(0.5);
    expect(dragProgress({ x: 0, y: 0 }, { x: 130, y: 999 }, ink)).toBeCloseTo(0.5);
  });

  it("flips the sign for a pull upwards", () => {
    // Screen y decreases as the finger goes up.
    expect(dragProgress({ x: 0, y: 500 }, { x: 0, y: 390 }, bookmark)).toBeCloseTo(0.5);
    // Dragging the wrong way is zero, never negative.
    expect(dragProgress({ x: 0, y: 500 }, { x: 0, y: 610 }, bookmark)).toBe(0);
  });

  it("clamps at both ends", () => {
    expect(dragProgress({ x: 0, y: 0 }, { x: 0, y: -50 }, door)).toBe(0);
    expect(dragProgress({ x: 0, y: 0 }, { x: 0, y: 9999 }, door)).toBe(1);
  });
});

describe("where a release leaves it", () => {
  it("latches past the threshold and falls back short of it", () => {
    expect(snapTarget(0.56, 0.55)).toBe(1);
    expect(snapTarget(0.54, 0.55)).toBe(0);
    // Exactly on the line counts as made, so a reader on the boundary is not
    // punished for stopping precisely there.
    expect(snapTarget(0.55, 0.55)).toBe(1);
  });
});

describe("the slider seam", () => {
  it("follows the finger across the frame", () => {
    expect(sliderProgress(0, 400)).toBe(0);
    expect(sliderProgress(200, 400)).toBe(0.5);
    expect(sliderProgress(400, 400)).toBe(1);
  });

  it("survives a frame with no width and a finger off the edge", () => {
    expect(sliderProgress(100, 0)).toBe(0);
    expect(sliderProgress(-40, 400)).toBe(0);
    expect(sliderProgress(900, 400)).toBe(1);
  });
});

describe("rubbing the frost away", () => {
  const grid = { columns: 10, rows: 10, width: 100, height: 100 };

  it("marks only the cells the circle actually covers", () => {
    const hit = brushCells(50, 50, 10, grid);
    expect(hit.length).toBeGreaterThan(0);
    // A radius of 10 on a 10px grid cannot reach the far corner.
    expect(hit).not.toContain(0);
    for (const index of hit) {
      const column = index % 10;
      const row = Math.floor(index / 10);
      const cx = (column + 0.5) * 10;
      const cy = (row + 0.5) * 10;
      expect((cx - 50) ** 2 + (cy - 50) ** 2).toBeLessThanOrEqual(100);
    }
  });

  it("stays inside the grid when the brush runs off the edge", () => {
    for (const point of [[0, 0], [100, 100], [-30, 50], [130, 50]] as const) {
      for (const index of brushCells(point[0], point[1], 40, grid)) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(100);
      }
    }
  });

  it("counts how much is clear", () => {
    expect(clearedFraction([])).toBe(0);
    expect(clearedFraction([false, false, false, false])).toBe(0);
    expect(clearedFraction([true, false, true, false])).toBe(0.5);
    expect(clearedFraction([true, true])).toBe(1);
  });

  it("reaches the completion threshold only once most of it is gone", () => {
    const scene = sceneById("wipe-frost")!;
    const cells = new Array(100).fill(false) as boolean[];
    for (let i = 0; i < 54; i += 1) cells[i] = true;
    expect(clearedFraction(cells)).toBeLessThan(scene.completionThreshold!);
    cells[54] = true;
    expect(clearedFraction(cells)).toBeGreaterThanOrEqual(scene.completionThreshold!);
  });
});

describe("telling the reader there is something to do", () => {
  it("gives every scene a cue and somewhere to put it", () => {
    // A scene with no hotspot draws no ring, and then the only way to find
    // the interaction is to poke the picture at random. The slider is the one
    // exception: its handle sits on the seam and is the cue.
    for (const scene of interactionScenes) {
      if (scene.primitive === "slider") continue;
      expect(scene.hotspot, scene.id).toBeDefined();
      expect(scene.hotspot!.x).toBeGreaterThanOrEqual(0);
      expect(scene.hotspot!.x).toBeLessThanOrEqual(1);
      expect(scene.hotspot!.y).toBeGreaterThanOrEqual(0);
      expect(scene.hotspot!.y).toBeLessThanOrEqual(1);
    }
  });

  it("draws the cue that matches the mechanic", () => {
    expect(affordanceFor(sceneById("tap-light")!)).toBe("tap");
    expect(affordanceFor(sceneById("hold-moment")!)).toBe("hold");
    expect(affordanceFor(sceneById("pull-bookmark")!)).toBe("drag");
    expect(affordanceFor(sceneById("time-slider")!)).toBe("seam");
    // Both are masks; only one of them remembers what it uncovered.
    expect(affordanceFor(sceneById("move-light")!)).toBe("glow");
    expect(affordanceFor(sceneById("wipe-frost")!)).toBe("scrub");
  });

  it("points the drag cue the way the finger should go", () => {
    expect(dragCueAngle(sceneById("reveal-ink")!)).toBe(0);
    // Screen y grows downwards, so a pull upwards points at -90.
    expect(dragCueAngle(sceneById("pull-bookmark")!)).toBe(-90);
    expect(dragCueAngle(sceneById("drag-door")!)).toBe(90);
  });
});

describe("the sound of an interaction", () => {
  it("gives every scene a voice, keyed to the mechanic where it can be", () => {
    for (const scene of interactionScenes) {
      expect(scene.sound, scene.id).toBeDefined();
    }
    // Shared by mechanic: both drags of something heavy sound the same, which
    // is the whole reason a thirteenth story is cheap.
    expect(sceneById("drag-door")!.sound).toBe(sceneById("swipe-crowd")!.sound);
    expect(sceneById("hold-focus")!.sound).toBe(sceneById("hold-moment")!.sound);
    // And the ones a story owns rather than a mechanic.
    expect(sceneById("tap-bell")!.sound).toBe("bell");
    expect(sceneById("water-ripples")!.sound).toBe("water");
  });

  it("spaces out a repeating sound instead of firing per event", () => {
    // A good screen sends well over a hundred pointer events a second, and one
    // grain each would be a buzz, not a scrape.
    expect(shouldRepeat(1000, 1050, 110)).toBe(false);
    expect(shouldRepeat(1000, 1110, 110)).toBe(true);
    expect(shouldRepeat(0, 0, 110)).toBe(false);
  });
});
