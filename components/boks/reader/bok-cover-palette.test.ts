import { describe, expect, it } from "vitest";
import { bokCoverPalette, bokCoverPalettes } from "./bok-cover-palette";

function luminance(hex: string) {
  const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

describe("typographic bok jackets", () => {
  it("keeps small bylines and cover controls readable in every palette", () => {
    for (const palette of bokCoverPalettes) {
      const [light, dark] = [luminance(palette.paper), luminance(palette.ink)].sort((a, b) => b - a);
      expect((light + .05) / (dark + .05), palette.name).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps the same bok's colour across entry points and offers varied jackets", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `bok-${i}`);
    const first = ids.map(bokCoverPalette);
    expect(ids.toReversed().map(bokCoverPalette).toReversed()).toEqual(first);
    expect(new Set(first.map(palette => palette.name)).size).toBe(bokCoverPalettes.length);
  });
});
