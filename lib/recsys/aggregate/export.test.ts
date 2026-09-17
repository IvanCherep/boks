import { describe, expect, it } from "vitest";
import { readerOutcomesToCsv, readerOutcomesReadme } from "@/lib/recsys/aggregate/export";
import type { ReaderOutcomeRow } from "@/lib/recsys/aggregate";

function row(over: Partial<ReaderOutcomeRow> & { userId: string }): ReaderOutcomeRow {
  return {
    algorithmId: "for_you",
    day: "2026-09-16",
    cohortWeek: "2026-09-14",
    tenureDays: 2,
    impressions: 10,
    starts: 8,
    completes: 4,
    skips: 2,
    likes: 1,
    shares: 0,
    comments: 0,
    boksOpened: 6,
    sessions: 2,
    activeSeconds: 240,
    attributedEvents: 10,
    totalEvents: 10,
    ...over,
  };
}

describe("readerOutcomesToCsv", () => {
  it("writes one line per row, with a header", () => {
    const csv = readerOutcomesToCsv([row({ userId: "a" }), row({ userId: "b" })]);
    const lines = csv.trim().split("\n");

    expect(lines[0]).toBe(
      "reader,algorithm,day,cohort_week,tenure_days,impressions,starts,completes,skips,likes,shares,comments,boks_opened,sessions,active_seconds,attributed_events,total_events"
    );
    expect(lines).toHaveLength(3);
  });

  it("replaces account ids with pseudonyms that still group a reader's rows", () => {
    const csv = readerOutcomesToCsv([
      row({ userId: "8f14e45f-ceea-467a-9f8c-4c0e2a1f0001", day: "2026-09-15" }),
      row({ userId: "8f14e45f-ceea-467a-9f8c-4c0e2a1f0001", day: "2026-09-16" }),
      row({ userId: "3c59dc04-8e88-4c1a-9f0a-4c0e2a1f0002" }),
    ]);

    // No account identifier survives into the file.
    expect(csv).not.toContain("8f14e45f");
    expect(csv).not.toContain("3c59dc04");
    // The same reader keeps one label across their rows, so grouping survives.
    const readers = csv.trim().split("\n").slice(1).map((line) => line.split(",")[0]);
    expect(readers).toEqual(["r001", "r001", "r002"]);
  });

  it("quotes a field that would otherwise break the row", () => {
    const csv = readerOutcomesToCsv([row({ userId: "a", algorithmId: 'odd,"name' })]);
    expect(csv).toContain('"odd,""name"');
  });

  it("carries a header even with nothing to export", () => {
    expect(readerOutcomesToCsv([]).trim().split("\n")).toHaveLength(1);
  });
});

describe("readerOutcomesReadme", () => {
  it("states the unit of analysis and the trap it avoids", () => {
    const readme = readerOutcomesReadme({
      windowDays: 30,
      experimentKey: "boks-feed-v1",
      controlAlgorithmId: "for_you",
      rows: 120,
      readers: 40,
    });

    expect(readme).toMatch(/analysis unit is the reader/);
    expect(readme).toMatch(/correlated/);
    expect(readme).toMatch(/more than one algorithm must be dropped/);
    expect(readme).toMatch(/boks-feed-v1/);
  });
});
