import { describe, expect, it } from "vitest";
import { blankWork, canQueue, moveInQueue, pinsByPart, plannedWeeks, shiftInQueue, stageOf, weekStart } from "./workflow";

const long = "Слово ".repeat(40);
const day = (iso: string) => new Date(`${iso}T12:00:00`);
const ymd = (date: Date | undefined) =>
  date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";

describe("the author's desk", () => {
  it("puts a work in the furthest room it has reached", () => {
    const work = blankWork("Бородино");
    expect(stageOf(work)).toBe("text");
    work.idea.concept = { about: "a", approach: "b", form: "c", plan: [] };
    expect(stageOf(work)).toBe("text");
    // A single line is a text too: it can be read aloud.
    work.text = "Первая строка";
    expect(stageOf(work)).toBe("voice");
    work.text = long;
    expect(stageOf(work)).toBe("voice");
    work.editors.step = "queued";
    expect(stageOf(work)).toBe("editors");
  });

  it("queues nothing without the author's voice, and never asks for a picture", () => {
    const work = blankWork("Сентябрь");
    work.text = long;
    expect(canQueue(work)).toEqual({ ok: false, missing: ["voice"] });
    work.takes = [{ id: "t1", seconds: 40, at: "", source: "teleprompter" }];
    work.chosenTake = "t1";
    expect(canQueue(work)).toEqual({ ok: true });
  });

  it("refuses a reading past fifteen minutes", () => {
    const work = blankWork();
    work.text = "а".repeat(14 * 60 * 16);
    work.takes = [{ id: "t1", seconds: 40, at: "", source: "file" }];
    work.chosenTake = "t1";
    expect(canQueue(work)).toEqual({ ok: false, missing: ["long"] });
  });

  it("groups pins by the part they must reach", () => {
    const parts = pinsByPart([
      { id: "1", kind: "image", text: "a", pinTo: "Глава 3" },
      { id: "2", kind: "fact", text: "b", pinTo: " Глава 3 " },
      { id: "3", kind: "fact", text: "c" },
    ]);
    expect([...parts.keys()]).toEqual(["Глава 3"]);
    expect(parts.get("Глава 3")?.map((item) => item.id)).toEqual(["1", "2"]);
  });
});

describe("the release queue: one Boks Series a week", () => {
  it("starts a week on Monday", () => {
    expect(ymd(weekStart(day("2026-11-21")))).toBe("2026-11-16");
    expect(ymd(weekStart(day("2026-11-23")))).toBe("2026-11-23");
  });

  it("plans one work a week, from this week when the editors are free", () => {
    const weeks = plannedWeeks({ queue: ["a", "b", "c"], busyThisWeek: 0, today: day("2026-11-21"), usedByYear: {} });
    expect(["a", "b", "c"].map((id) => ymd(weeks.get(id)))).toEqual(["2026-11-16", "2026-11-23", "2026-11-30"]);
  });

  it("starts the week after when this week already holds a Series", () => {
    const weeks = plannedWeeks({ queue: ["a", "b"], busyThisWeek: 1, today: day("2026-11-21"), usedByYear: {} });
    expect(["a", "b"].map((id) => ymd(weeks.get(id)))).toEqual(["2026-11-23", "2026-11-30"]);
  });

  it("moves a work within the queue and leaves the rest in order", () => {
    expect(moveInQueue(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveInQueue(["a", "b", "c"], "a", 9)).toEqual(["b", "c", "a"]);
    expect(moveInQueue(["a", "b"], "x", 0)).toEqual(["a", "b"]);
  });
});

describe("the standard plan and the editors' fixed places", () => {
  it("skips into the next year once twelve are used", () => {
    const weeks = plannedWeeks({ queue: ["a", "b", "c"], busyThisWeek: 0, today: day("2026-11-21"), usedByYear: { 2026: 11 } });
    expect(["a", "b", "c"].map((id) => ymd(weeks.get(id)))).toEqual(["2026-11-16", "2027-01-04", "2027-01-11"]);
  });

  it("lets the author reorder only the free places", () => {
    const fixed = new Set(["b"]);
    expect(moveInQueue(["a", "b", "c", "d"], "d", 0, fixed)).toEqual(["d", "b", "a", "c"]);
    expect(moveInQueue(["a", "b", "c", "d"], "b", 3, fixed)).toEqual(["a", "b", "c", "d"]);
    expect(moveInQueue(["a", "b", "c"], "a", 2, fixed)).toEqual(["c", "b", "a"]);
  });

  it("jumps over a fixed place with the arrows", () => {
    const fixed = new Set(["b"]);
    expect(shiftInQueue(["a", "b", "c"], "c", -1, fixed)).toEqual(["c", "b", "a"]);
    expect(shiftInQueue(["a", "b", "c"], "b", 1, fixed)).toEqual(["a", "b", "c"]);
    expect(shiftInQueue(["a", "b", "c"], "a", -1, fixed)).toEqual(["a", "b", "c"]);
  });
});

describe("a take and the text it reads", () => {
  it("stops a take of an older text from entering the queue", async () => {
    const { textKey, isStale } = await import("./workflow");
    const work = blankWork();
    work.text = long;
    work.takes = [{ id: "t1", seconds: 40, at: "", source: "teleprompter", textKey: textKey(work.text) }];
    work.chosenTake = "t1";
    expect(canQueue(work)).toEqual({ ok: true });
    work.text = `${long} И ещё строка.`;
    expect(isStale(work.takes[0], work.text)).toBe(true);
    expect(canQueue(work)).toEqual({ ok: false, missing: ["stale"] });
    work.text = `${long}   `;
    expect(canQueue(work)).toEqual({ ok: true });
  });
});

describe("lines to read", () => {
  it("keeps verse lines and cuts long prose at sentences", async () => {
    const { readingLines } = await import("./workflow");
    expect(readingLines("Строка один\n\nСтрока два")).toEqual(["Строка один", "", "Строка два"]);
    const prose = "Первое предложение довольно длинное, чтобы проверить. Второе предложение тоже не короткое. Третье.";
    const lines = readingLines(prose, 50);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(prose);
    expect(lines.every((line) => line.length <= 60)).toBe(true);
  });
});

describe("sending a returned piece again", () => {
  it("asks for what the editors asked about", async () => {
    const { resendCheck, textKey } = await import("./workflow");
    const work = blankWork();
    work.text = long;
    work.takes = [{ id: "t1", seconds: 40, at: "2026-11-01T10:00:00Z", source: "teleprompter", textKey: textKey(long) }];
    work.chosenTake = "t1";
    work.outcome = { kind: "changes", category: "voice", reason: "шум", at: "2026-11-02T10:00:00Z", textKey: textKey(long) };
    expect(resendCheck(work)).toEqual({ ok: false, reason: "new-take" });
    work.takes.push({ id: "t2", seconds: 40, at: "2026-11-03T10:00:00Z", source: "file", textKey: textKey(long) });
    work.chosenTake = "t2";
    expect(resendCheck(work)).toEqual({ ok: true });
    work.outcome = { ...work.outcome, category: "text" };
    expect(resendCheck(work)).toEqual({ ok: false, reason: "edit-text" });
    work.outcome = { ...work.outcome, kind: "declined" };
    expect(resendCheck(work)).toEqual({ ok: false, reason: "declined" });
  });
});
