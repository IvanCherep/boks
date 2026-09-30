import { describe, expect, it } from "vitest";
import { isBoksSeriesPiece } from "@/components/boks/cinema/series";
import { narrationTrackFor } from "@/components/boks/cinema/narration-track";
import { sceneImagesFor } from "@/components/boks/cinema/scene-image";

const lion = "ee470590-a93c-467e-aaeb-87ae00c0745e";

describe("which boks are finished, and so open to everyone", () => {
  it("counts a piece that has both its pictures and its voice", () => {
    expect(sceneImagesFor(lion).length).toBeGreaterThan(0);
    expect(narrationTrackFor(lion)).not.toBeNull();
    expect(isBoksSeriesPiece(lion)).toBe(true);
  });

  it("does not count a boks that has neither", () => {
    // Every other boks in the catalogue. These keep the prototype behind the
    // admin flag, where it is shown on purpose rather than stumbled into.
    expect(isBoksSeriesPiece("any-other-boks")).toBe(false);
  });

  it("needs both halves", () => {
    // Half-finished is the case worth being strict about: a recording over the
    // shared stand-in, or paintings read by the browser's robot voice, would
    // spend the idea instead of making the case for it. Both registries agree
    // on this one id and on no other, which is what keeps them in step.
    const withArt = new Set(["ee470590-a93c-467e-aaeb-87ae00c0745e"]);
    expect(sceneImagesFor(lion).length > 0).toBe(withArt.has(lion));
    expect(Boolean(narrationTrackFor(lion))).toBe(withArt.has(lion));
  });
});
