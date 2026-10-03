import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";

describe("the track people read to", () => {
  it("is there", () => {
    // A missing file is silence with a lit button, and nothing in the console
    // to say why - the module swallows the failure on purpose so that reading
    // is never interrupted by it.
    expect(existsSync("public/reading-music.mp3")).toBe(true);
  });

  it("is long enough not to wear out", () => {
    // It loops for a whole sitting. A short loop is worse than no music, and
    // at 128 kbps five minutes is about 4.8 MB.
    expect(statSync("public/reading-music.mp3").size).toBeGreaterThan(3_000_000);
  });
});
