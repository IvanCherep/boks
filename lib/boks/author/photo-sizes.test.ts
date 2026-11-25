import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { authorPhotoPath, photoSizeOf } from "./photo-path";
import { resizeAuthorPhoto, sizedAuthorPhoto } from "./photo-sizes";

function photo(width: number, height: number) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const at = (y * width + x) * 4;
    data[at] = (x * 255) / width; data[at + 1] = 120; data[at + 2] = (y * 255) / height; data[at + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 92).data;
}

describe("author photo sizes", () => {
  it("names a size in the address, and only a known one", () => {
    expect(authorPhotoPath("esenin", 2, "s")).toBe("/a/esenin/photo?v=2&s=s");
    expect(authorPhotoPath("esenin", 2)).toBe("/a/esenin/photo?v=2");
    expect(authorPhotoPath("esenin", 0, "l")).toBeNull();
    expect(photoSizeOf("l")).toBe("l");
    expect(photoSizeOf("xl")).toBeNull();
  });

  it("makes a grayscale square no larger than the size", () => {
    const small = jpeg.decode(resizeAuthorPhoto(photo(1254, 1254), "s"), { useTArray: true });
    expect([small.width, small.height]).toEqual([192, 192]);
    const at = (96 * 192 + 96) * 4;
    expect(Math.abs(small.data[at] - small.data[at + 2])).toBeLessThanOrEqual(2);
    const wide = jpeg.decode(resizeAuthorPhoto(photo(900, 600), "l"), { useTArray: true });
    expect([wide.width, wide.height]).toEqual([600, 600]);
  });

  it("makes each size once per photo version", () => {
    const original = photo(400, 400);
    expect(sizedAuthorPhoto("a\u00001", original, "s")).toBe(sizedAuthorPhoto("a\u00001", original, "s"));
  });
});
