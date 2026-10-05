import { describe, expect, it } from "vitest";
import { atHandle, bareHandle } from "@/components/boks/reader/handles";

describe("handles", () => {
  it("strips any number of leading @", () => {
    expect(bareHandle("@@mira")).toBe("mira");
    expect(bareHandle("mira")).toBe("mira");
    expect(bareHandle(null)).toBe("");
  });

  it("labels with exactly one @, and nothing for nothing", () => {
    expect(atHandle("mira")).toBe("@mira");
    expect(atHandle("@@mira")).toBe("@mira");
    expect(atHandle("")).toBe("");
    expect(atHandle(undefined)).toBe("");
  });
});
