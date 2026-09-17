import { describe, expect, it } from "vitest";
import { describeBoksHandleProblem, isValidBoksHandle } from "@/lib/boks/contracts";

describe("isValidBoksHandle", () => {
  it("accepts letters, digits and underscores", () => {
    expect(isValidBoksHandle("ivan_ystal")).toBe(true);
    expect(isValidBoksHandle("reader_2026")).toBe(true);
    expect(isValidBoksHandle("a_b")).toBe(true);
  });

  it("accepts an underscore at the end, which is what made one impossible to type", () => {
    expect(isValidBoksHandle("ivan_")).toBe(true);
  });

  it("requires an English letter first", () => {
    expect(isValidBoksHandle("9ivan")).toBe(false);
    expect(isValidBoksHandle("_ivan")).toBe(false);
  });

  it("refuses letters that are not English", () => {
    expect(isValidBoksHandle("иван")).toBe(false);
    expect(isValidBoksHandle("ivan_иван")).toBe(false);
    expect(isValidBoksHandle("ivän")).toBe(false);
  });

  it("refuses punctuation and spaces", () => {
    expect(isValidBoksHandle("ivan.ystal")).toBe(false);
    expect(isValidBoksHandle("ivan ystal")).toBe(false);
    expect(isValidBoksHandle("ivan-ystal")).toBe(false);
    expect(isValidBoksHandle("@ivan")).toBe(false);
  });

  it("holds the length range", () => {
    expect(isValidBoksHandle("ab")).toBe(false);
    expect(isValidBoksHandle("abc")).toBe(true);
    expect(isValidBoksHandle("a".repeat(24))).toBe(true);
    expect(isValidBoksHandle("a".repeat(25))).toBe(false);
  });
});

describe("describeBoksHandleProblem", () => {
  it("says nothing about a valid nickname", () => {
    expect(describeBoksHandleProblem("ivan_ystal")).toBeNull();
  });

  it("names the rule that was broken, not just that something is wrong", () => {
    expect(describeBoksHandleProblem("")).toMatch(/Enter a nickname/);
    expect(describeBoksHandleProblem("ab")).toMatch(/at least 3/);
    expect(describeBoksHandleProblem("a".repeat(25))).toMatch(/at most 24/);
    expect(describeBoksHandleProblem("9ivan")).toMatch(/start with a letter/);
    expect(describeBoksHandleProblem("_ivan")).toMatch(/start with a letter/);
    expect(describeBoksHandleProblem("ivan.ystal")).toMatch(/English letters, numbers and underscores/);
    // Cyrillic does start with a letter, so the alphabet is the thing to name.
    expect(describeBoksHandleProblem("иван_ivan")).toMatch(/English letters, numbers and underscores/);
  });
});
