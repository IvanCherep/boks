import { describe, expect, it } from "vitest";
import { seriesPieces } from "@/components/boks/series/series-catalogue";
import { catalogueBokArtwork } from "@/lib/boks/catalogue-artwork";
import { bokArtworkFocus, bokArtworkStyle, getBokArtwork, getBokCoverAnimation, getBokPosterArtwork } from "./bok-artwork";

describe("bok artwork", () => {
  it("preserves every registered Series image and reader crop", () => {
    for (const piece of seriesPieces) {
      expect(getBokArtwork({ id: piece.storyId }), piece.title).toBe(piece.cover);
      expect(bokArtworkFocus(piece.storyId), piece.title).toBe("50% 50%");
      expect(bokArtworkStyle(piece.storyId)["--bok-art-focus"], piece.title).toBe("50% 50%");
    }
  });

  it("gives an ordinary bok its illustration by ID even when its title changes", () => {
    const bokId = "c7581395-92e4-4fe6-b3e1-ace3fc9a6ac9";
    expect(getBokArtwork({ id: bokId, title: "A changed title", authorName: "A changed byline" }))
      .toBe(`/covers/${bokId}.webp`);
    expect(bokArtworkFocus(bokId)).toBe("65% 56%");
    expect(getBokPosterArtwork(bokId)).toBe(`/share/art/${bokId}.jpg`);
  });

  it("keeps typography for unregistered IDs and never guesses from a title", () => {
    expect(getBokArtwork({ title: seriesPieces[0].title, authorName: seriesPieces[0].author })).toBeNull();
    for (const id of ["00000000-0000-0000-0000-000000000000", "__proto__", "constructor", "../series/lion"]) {
      expect(getBokArtwork({ id })).toBeNull();
      expect(getBokPosterArtwork(id)).toBeNull();
    }
  });

  it("animates only the two selected covers while retaining their static poster paths", () => {
    const firstSnow = "7a67ce67-bceb-4e41-8f66-191718345880";
    const christmasBoy = "3def4114-623e-4633-968a-52dd0e7cdf9b";
    for (const bokId of new Set([...seriesPieces.map(piece => piece.storyId), ...Object.keys(catalogueBokArtwork)])) {
      expect(getBokCoverAnimation(bokId)).toBe([firstSnow, christmasBoy].includes(bokId) ? `/covers/${bokId}.mp4` : null);
    }
    expect(getBokArtwork({ id: firstSnow })).toBe("/series/perviy-sneg.webp");
    expect(getBokPosterArtwork(firstSnow)).toBe("/share/art/perviy-sneg.jpg");
    expect(getBokArtwork({ id: christmasBoy })).toBe(`/covers/${christmasBoy}.webp`);
    expect(getBokPosterArtwork(christmasBoy)).toBe(`/share/art/${christmasBoy}.jpg`);
    expect(getBokCoverAnimation("../covers/another")).toBeNull();
  });

  it("keeps every catalogue crop in bounds", () => {
    for (const [bokId, artwork] of Object.entries(catalogueBokArtwork)) {
      expect(bokId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
      expect(artwork.coverFocus).toMatch(/^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/u);
      for (const value of artwork.coverFocus.split(" ")) {
        expect(Number.parseFloat(value)).toBeGreaterThanOrEqual(0);
        expect(Number.parseFloat(value)).toBeLessThanOrEqual(100);
      }
    }
  });
});
