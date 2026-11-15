import { describe, expect, it } from "vitest";
import { guestBokLimit, guestReminderFor, monthGrid, ordinal, shiftMonth, weekdayNames } from "./days";

describe("guestReminderFor", () => {
  const none = new Set<number>();
  it("reminds every two boks, each time for a different reason", () => {
    expect([2, 4, 6, 8].map((count) => guestReminderFor(count, none)?.kind)).toEqual(["letter", "game", "progress", "last"]);
  });
  it("is quiet between them, at the limit and after", () => {
    expect([0, 1, 3, 5, 7, 9, guestBokLimit, 12].map((count) => guestReminderFor(count, none))).toEqual(Array(8).fill(null));
  });
  it("never repeats one already shown", () => {
    expect(guestReminderFor(4, new Set([4]))).toBeNull();
  });
});

describe("ordinal", () => {
  it("says the day the way each language does", () => {
    expect(ordinal(3, "ru")).toBe("3-й");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map((n) => ordinal(n, "en"))).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });
});

describe("monthGrid", () => {
  it("starts weeks on Monday and pads the month", () => {
    const weeks = monthGrid("2026-11-01");
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });
  it("moves between months across a year", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01");
  });
  it("names weekdays from Monday", () => {
    expect(weekdayNames("ru")[0]).toBe("пн");
    expect(weekdayNames("en")[6]).toBe("Sun");
  });
});
