import { describe, expect, it } from "vitest";
import { seriesPieces } from "@/components/boks/series/series-catalogue";
import { catalogueBokArtwork } from "@/lib/boks/catalogue-artwork";
import { bokArtworkFocus, bokArtworkStyle, getBokArtwork, getBokPosterArtwork } from "./bok-artwork";

describe("bok artwork", () => {
  it("preserves every existing Series image, reader crop and wordmark contrast", () => {
    for (const piece of seriesPieces) {
      expect(getBokArtwork({ id: piece.storyId }), piece.title).toBe(piece.cover);
      expect(bokArtworkFocus(piece.storyId), piece.title).toBe("50% 50%");
      expect(bokArtworkStyle(piece.storyId)["--bok-art-ink"], piece.title)
        .toBe(piece.coverLogoTone === "dark" ? "#222621" : "#fff8eb");
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

  it("keeps every catalogue crop in bounds with an explicit contrast choice", () => {
    for (const [bokId, artwork] of Object.entries(catalogueBokArtwork)) {
      expect(bokId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
      expect(artwork.coverLogoTone).toMatch(/^(dark|light)$/u);
      expect(artwork.coverFocus).toMatch(/^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/u);
      for (const value of artwork.coverFocus.split(" ")) {
        expect(Number.parseFloat(value)).toBeGreaterThanOrEqual(0);
        expect(Number.parseFloat(value)).toBeLessThanOrEqual(100);
      }
    }
  });
});
