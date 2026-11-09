import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { posterPngToJpeg } from "@/lib/boks/poster-jpeg";

describe("a poster as a JPEG", () => {
  it("keeps the size and comes out a JPEG", () => {
    const png = new PNG({ width: 72, height: 90 });
    for (let i = 0; i < png.data.length; i += 4) { png.data[i] = i % 255; png.data[i + 1] = 120; png.data[i + 2] = 60; png.data[i + 3] = 255; }
    const jpegBytes = posterPngToJpeg(PNG.sync.write(png));
    expect([...jpegBytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    // Width and height sit in the SOF0 segment.
    const sof = jpegBytes.findIndex((byte, index) => byte === 0xff && jpegBytes[index + 1] === 0xc0);
    expect((jpegBytes[sof + 5] << 8) | jpegBytes[sof + 6]).toBe(90);
    expect((jpegBytes[sof + 7] << 8) | jpegBytes[sof + 8]).toBe(72);
  });
});
