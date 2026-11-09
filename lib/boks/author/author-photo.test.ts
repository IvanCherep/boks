import { describe, expect, it } from "vitest";
import { clampCrop, cropLayout, cropSource, photoProblem } from "@/lib/boks/author/author-photo";

describe("author photo crop", () => {
  it("keeps the centred square of a landscape photo at zoom 1", () => {
    expect(cropSource({ width: 1200, height: 800, zoom: 1, x: 0, y: 0 })).toEqual({ sx: 200, sy: 0, side: 800 });
  });

  it("never moves the square past the photo's edge", () => {
    const crop = clampCrop({ width: 1200, height: 800, zoom: 1, x: 5, y: 5 });
    expect(crop.y).toBe(0);
    const { sx, side } = cropSource(crop);
    expect(sx).toBeCloseTo(0);
    expect(sx + side).toBeLessThanOrEqual(1200);
  });

  it("zooms into a smaller square and keeps the zoom in range", () => {
    expect(cropSource({ width: 1000, height: 1000, zoom: 2, x: 0, y: 0 })).toEqual({ sx: 250, sy: 250, side: 500 });
    expect(clampCrop({ width: 10, height: 10, zoom: 9, x: 0, y: 0 }).zoom).toBe(3);
    expect(clampCrop({ width: 10, height: 10, zoom: Number.NaN, x: 0, y: 0 }).zoom).toBe(1);
  });

  it("lays the photo over the frame so the frame is always covered", () => {
    const layout = cropLayout({ width: 1200, height: 800, zoom: 1, x: -9, y: 0 }, 300);
    expect(layout.left).toBeLessThanOrEqual(0);
    expect(layout.left + layout.width).toBeGreaterThanOrEqual(300);
  });

  it("refuses other formats and files over 10 MB", () => {
    expect(photoProblem({ type: "image/gif", size: 10 })).toBe("badType");
    expect(photoProblem({ type: "image/jpeg", size: 11 * 1024 * 1024 })).toBe("photoTooLarge");
    expect(photoProblem({ type: "image/webp", size: 1000 })).toBeNull();
  });
});
