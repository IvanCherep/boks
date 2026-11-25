import { describe, expect, it } from "vitest";
import { searchPortraitFor } from "./search-portraits";

describe("search portraits", () => {
  it("gives an author the photo of their own page, by its version", () => {
    expect(searchPortraitFor({ kind: "account", handle: "demidov", photoVersion: 3 })).toBe("/a/demidov/photo?v=3&s=s");
    expect(searchPortraitFor({ kind: "account", handle: "demidov", photoVersion: null })).toBeNull();
  });

  it("gives nobody else a face", () => {
    expect(searchPortraitFor({ kind: "byline", handle: "boks", photoVersion: 2 })).toBeNull();
  });
});
