import { describe, expect, it } from "vitest";
import { calendarDate, gameDayLead, gameDayStatus } from "./game-day";

const three = [1, 2, 3].map((position) => ({ position, available: true }));
const day = { publishedAt: null, publishedPosition: null, chosenPosition: null, available: 3, candidates: three };

describe("gameDayStatus", () => {
  it("is automatic without a choice", () => expect(gameDayStatus(day)).toBe("auto"));
  it("is manual with a valid choice", () => expect(gameDayStatus({ ...day, chosenPosition: 2 })).toBe("manual"));
  it("falls back to automatic when the chosen text is gone", () => {
    expect(gameDayStatus({ ...day, chosenPosition: 2, candidates: three.map((c) => ({ ...c, available: c.position !== 2 })) })).toBe("auto");
  });
  it("needs stock with nothing available", () => expect(gameDayStatus({ ...day, available: 0 })).toBe("restock"));
  it("is published once published", () => expect(gameDayStatus({ ...day, publishedAt: "2026-11-17T00:00:01Z", publishedPosition: 1 })).toBe("published"));
});

describe("gameDayLead", () => {
  it("is the first candidate when nobody chose", () => expect(gameDayLead(day)).toBe(1));
  it("is the chosen one", () => expect(gameDayLead({ ...day, chosenPosition: 2 })).toBe(2));
  it("skips a candidate taken down", () => {
    expect(gameDayLead({ ...day, candidates: three.map((c) => ({ ...c, available: c.position !== 1 })) })).toBe(2);
  });
  it("is what was published", () => expect(gameDayLead({ ...day, publishedAt: "x", publishedPosition: 3 })).toBe(3));
  it("is nothing with nothing available", () => expect(gameDayLead({ ...day, available: 0, candidates: three.map((c) => ({ ...c, available: false })) })).toBeNull());
});

describe("calendarDate", () => {
  it("names the calendar day in either language", () => {
    expect(calendarDate("2026-11-17", "ru")).toBe("17 ноября");
    expect(calendarDate("2026-11-17", "en")).toBe("17 November");
  });
});
