import { describe, expect, it } from "vitest";
import { authorSeriesRecorderEnabled, seriesRecorderOpenTo } from "@/lib/boks/series-recorder/switch";

describe("the switch for authors' own Boks Series", () => {
  it("is off since 2026-11-22: hidden and closed to authors, open to Studio", () => {
    expect(authorSeriesRecorderEnabled).toBe(false);
    expect(seriesRecorderOpenTo({ admin: false })).toBe(false);
    expect(seriesRecorderOpenTo({ admin: true })).toBe(true);
  });

  it("opens to authors again with one change", () => {
    expect(seriesRecorderOpenTo({ admin: false }, true)).toBe(true);
  });
});
