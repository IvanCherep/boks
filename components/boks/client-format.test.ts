import { describe, expect, it } from "vitest";
import { estimateMinutes, groupDigits, shortTimeAgo } from "@/components/boks/client-format";

const now = Date.parse("2026-09-14T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("shortTimeAgo", () => {
  it("says now for anything inside a minute", () => {
    expect(shortTimeAgo(ago(0), now)).toBe("now");
    expect(shortTimeAgo(ago(45_000), now)).toBe("now");
  });

  it("steps up through the units a reader thinks in", () => {
    expect(shortTimeAgo(ago(5 * 60_000), now)).toBe("5m");
    expect(shortTimeAgo(ago(3 * 3_600_000), now)).toBe("3h");
    expect(shortTimeAgo(ago(2 * 86_400_000), now)).toBe("2d");
    expect(shortTimeAgo(ago(14 * 86_400_000), now)).toBe("2w");
    expect(shortTimeAgo(ago(90 * 86_400_000), now)).toBe("3mo");
    expect(shortTimeAgo(ago(800 * 86_400_000), now)).toBe("2y");
  });

  it("never shows a negative age for a clock that runs ahead", () => {
    expect(shortTimeAgo(new Date(now + 60_000).toISOString(), now)).toBe("now");
  });

  it("returns nothing it cannot parse", () => {
    expect(shortTimeAgo("not a date", now)).toBe("");
  });
});

describe("estimateMinutes", () => {
  it("is zero for an empty story, not one", () => {
    expect(estimateMinutes("")).toBe(0);
    expect(estimateMinutes("   \n  ")).toBe(0);
  });

  it("uses the same 238 words a minute the database does", () => {
    expect(estimateMinutes("word ".repeat(238))).toBe(1);
    expect(estimateMinutes("word ".repeat(239))).toBe(2);
  });

  it("never claims more than the fifteen minutes boks promises", () => {
    expect(estimateMinutes("word ".repeat(100_000))).toBe(15);
  });
});

describe("groupDigits", () => {
  it("groups without asking the runtime for a locale", () => {
    expect(groupDigits(20000)).toBe("20,000");
    expect(groupDigits(999)).toBe("999");
    expect(groupDigits(1234567)).toBe("1,234,567");
    expect(groupDigits(-4500)).toBe("-4,500");
    expect(groupDigits(Number.NaN)).toBe("0");
  });
});
