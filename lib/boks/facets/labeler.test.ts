import { describe, expect, it } from "vitest";
import { agreement, authorGroupTask, maxTextCharacters, moodTask, readAuthorGroupAnswer, readMoodAnswer } from "./labeler";

const yes = (value: boolean) => ({ why: "", yes: value });

describe("facet labeller", () => {
  it("asks about the whole text, cut only past the limit", () => {
    const bok = { id: "b", title: "Т", byline: "А", language: "ru", text: "x".repeat(maxTextCharacters + 10) };
    const task = moodTask(bok);
    expect(task.stage).toBe("facets");
    expect(task.user).toContain("Название: Т");
    expect(task.user.length).toBeLessThan(maxTextCharacters + 200);
    expect(task.system).toContain("Погрустить");
  });

  it("reads the main value first, then the other yes values", () => {
    const answer = readMoodAnswer({ sad: yes(true), fun: yes(false), think: yes(true), main: "think", note: "  притча " });
    expect(answer).toEqual({ values: ["think", "sad"], note: "притча" });
  });

  it("ignores a main value the model did not say yes to", () => {
    expect(readMoodAnswer({ sad: yes(false), fun: yes(true), think: yes(false), main: "sad", note: "" })?.values).toEqual(["fun"]);
    expect(readMoodAnswer({ sad: yes(false), fun: yes(false), think: yes(false), main: "none", note: "" })?.values).toEqual([]);
  });

  it("refuses a reply without a verdict for every value", () => {
    expect(readMoodAnswer({ sad: yes(true), main: "sad" })).toBeNull();
    expect(readMoodAnswer(null)).toBeNull();
    expect(readMoodAnswer({ sad: { yes: "yes" }, fun: yes(false), think: yes(false) })).toBeNull();
  });

  it("reads an author group, unknown as an empty answer", () => {
    expect(readAuthorGroupAnswer({ group: "classics", note: "Чехов" })).toEqual({ values: ["classics"], note: "Чехов" });
    expect(readAuthorGroupAnswer({ group: "unknown", note: "" })?.values).toEqual([]);
    expect(readAuthorGroupAnswer({ group: "modern" })).toBeNull();
    expect(authorGroupTask("Имя", ["А", "Б"], true).user).toContain("сам, со своего аккаунта");
  });

  it("counts agreement per value", () => {
    const rows = agreement(["sad", "fun"], [
      { reference: ["sad"], candidate: ["sad", "fun"] },
      { reference: ["sad"], candidate: [] },
      { reference: [], candidate: [] },
    ]);
    expect(rows).toEqual([
      { value: "sad", both: 1, onlyReference: 1, onlyCandidate: 0 },
      { value: "fun", both: 0, onlyReference: 0, onlyCandidate: 1 },
    ]);
  });
});
