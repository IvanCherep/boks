import { describe, expect, it } from "vitest";
import { authorInitials, splitAuthorName } from "@/components/boks/author-rings";

describe("an author with no photo", () => {
  it("gets the first letters of the first and last word of the name", () => {
    expect(authorInitials("Алексей Прохоров", "prokhorov")).toBe("АП");
    expect(authorInitials("A. E. Housman", "boks")).toBe("AH");
    expect(authorInitials("Emily Dickinson", "")).toBe("ED");
    expect(authorInitials("Гиппиус", "")).toBe("Г");
  });

  it("falls back to the handle when there is no name", () => {
    expect(authorInitials("", "@prokhorov")).toBe("PR");
    expect(authorInitials(null, "boks")).toBe("BO");
  });
});

describe("a name set on two lines", () => {
  it("puts the last word large and the rest above it", () => {
    expect(splitAuthorName("Алексей Прохоров")).toEqual({ given: "Алексей", family: "Прохоров" });
    expect(splitAuthorName("Gerard Manley Hopkins")).toEqual({ given: "Gerard Manley", family: "Hopkins" });
    expect(splitAuthorName("boks")).toEqual({ given: "", family: "boks" });
  });
});
