import { describe, expect, it } from "vitest";
import { lastThirtyDays } from "@/components/boks/admin/inspector-format";

describe("lastThirtyDays", () => {
  const today = new Date("2026-09-19T15:00:00Z");

  it("returns thirty days ending today, oldest first", () => {
    const days = lastThirtyDays([], today);
    expect(days).toHaveLength(30);
    expect(days[0].day).toBe("2026-08-21");
    expect(days[29].day).toBe("2026-09-19");
  });

  it("fills the days without reading with zero", () => {
    const days = lastThirtyDays(
      [
        { day: "2026-09-19", minutes: 12, boks: 3 },
        { day: "2026-09-05", minutes: 4, boks: 1 },
      ],
      today
    );
    expect(days.filter((entry) => entry.minutes > 0).map((entry) => entry.day)).toEqual(["2026-09-05", "2026-09-19"]);
    expect(days.find((entry) => entry.day === "2026-09-06")).toEqual({ day: "2026-09-06", minutes: 0, boks: 0 });
  });

  it("ignores activity older than the window", () => {
    const days = lastThirtyDays([{ day: "2026-07-01", minutes: 99, boks: 9 }], today);
    expect(days.every((entry) => entry.minutes === 0)).toBe(true);
  });
});
