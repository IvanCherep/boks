import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seriesPieces } from "@/components/boks/series/series-catalogue";

describe("share poster artwork", () => {
  it("has a renderer-compatible image for every registered Series cover", () => {
    for (const piece of seriesPieces) {
      const file = piece.cover.replace("/series/", "public/share/art/").replace(/\.webp$/u, ".jpg");
      expect(existsSync(file), `${piece.title}: ${file}`).toBe(true);
    }
  });
});
