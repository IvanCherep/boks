import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seriesPieces } from "@/components/boks/series/series-catalogue";
import { catalogueBokArtwork } from "@/lib/boks/catalogue-artwork";
import { getBokArtwork, getBokPosterArtwork } from "@/components/boks/reader/bok-artwork";

describe("share poster artwork", () => {
  it("has a WebP and a renderer-compatible JPEG for every registered cover", () => {
    const bokIds = new Set([...seriesPieces.map(piece => piece.storyId), ...Object.keys(catalogueBokArtwork)]);
    for (const bokId of bokIds) {
      const cover = `public${getBokArtwork({ id: bokId })}`;
      const poster = `public${getBokPosterArtwork(bokId)}`;
      expect(existsSync(cover), cover).toBe(true);
      expect(existsSync(poster), poster).toBe(true);
      expect(readFileSync(cover).subarray(8, 12).toString(), cover).toBe("WEBP");
      expect([...readFileSync(poster).subarray(0, 3)], poster).toEqual([0xff, 0xd8, 0xff]);
    }
  });
});
