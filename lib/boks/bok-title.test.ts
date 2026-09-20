import { describe, expect, it } from "vitest";
import { bokTitle, titleFromText, maxDerivedTitleLength } from "@/lib/boks/bok-title";

// The same vectors are asserted against `public.boks_title_from_text` in
// scripts/local-supabase/checks.sql. Change one, change both.
describe("titleFromText", () => {
  it("takes the first line that has anything on it", () => {
    expect(titleFromText("\n\n   \nПод вечер\nшёл дождь")).toBe("Под вечер");
  });

  it("collapses runs of spaces and trims", () => {
    expect(titleFromText("  The   quiet    hour  \nand after")).toBe("The quiet hour");
  });

  it("drops the comma or dash a verse line ends on", () => {
    expect(titleFromText("Дорогая, сядем рядом,\nПоглядим в глаза друг другу.")).toBe("Дорогая, сядем рядом");
    expect(titleFromText("It was the last train —\nand nobody ran")).toBe("It was the last train");
  });

  it("keeps a sentence's own full stop, question or exclamation", () => {
    expect(titleFromText("Who knocked?\nNobody.")).toBe("Who knocked?");
  });

  it("cuts a long first line at a word and marks the cut", () => {
    const line =
      "In the charming place in which he found himself there were so many sympathetic faces that he felt more than ever convinced";
    const title = titleFromText(line);
    expect(title).toBe("In the charming place in which he found himself there were so many sympathetic…");
    expect(title.length).toBeLessThanOrEqual(maxDerivedTitleLength + 1);
  });

  it("hard-cuts a first line that is one enormous word", () => {
    const title = titleFromText("x".repeat(200));
    expect(title).toBe(`${"x".repeat(80)}…`);
  });

  it("skips a line of asterisks or dashes, the way an untitled poem opens", () => {
    expect(titleFromText("* * *\nПод вечер шёл дождь")).toBe("Под вечер шёл дождь");
    expect(titleFromText("***\n\n —\nText")).toBe("Text");
  });

  it("drops the dash a line of dialogue opens with", () => {
    expect(titleFromText("— Ой, рыба, — горячо говорит один.")).toBe("Ой, рыба, — горячо говорит один.");
  });

  it("handles Windows line endings", () => {
    expect(titleFromText("First line\r\nSecond line")).toBe("First line");
  });

  it("is empty for empty text", () => {
    expect(titleFromText("")).toBe("");
    expect(titleFromText(" \n \n")).toBe("");
  });
});

describe("bokTitle", () => {
  it("keeps a title the author gave", () => {
    expect(bokTitle("  My title  ", "First line")).toBe("My title");
  });

  it("treats a title with no words in it as empty", () => {
    expect(bokTitle("* * *", "Прощай, немытая Россия,\nСтрана рабов")).toBe("Прощай, немытая Россия");
  });

  it("falls back to the first line when the title is left empty", () => {
    expect(bokTitle("   ", "First line\nsecond")).toBe("First line");
    expect(bokTitle(undefined, "First line")).toBe("First line");
  });
});
