import { describe, expect, it } from "vitest";
import {
  collapseToReaders,
  compareAlgorithms,
  totalsByReaderAndAlgorithm,
  type ReaderOutcomeRow,
} from "@/lib/recsys/aggregate";

function row(overrides: Partial<ReaderOutcomeRow> & { userId: string }): ReaderOutcomeRow {
  return {
    algorithmId: "balanced",
    day: "2026-09-01",
    cohortWeek: "2026-08-31",
    tenureDays: 0,
    impressions: 0,
    starts: 0,
    completes: 0,
    skips: 0,
    likes: 0,
    shares: 0,
    comments: 0,
    boksOpened: 0,
    sessions: 0,
    activeSeconds: 0,
    attributedEvents: 0,
    totalEvents: 0,
    ...overrides,
  };
}

describe("totalsByReaderAndAlgorithm", () => {
  it("sums a reader's days and counts the days themselves", () => {
    const totals = totalsByReaderAndAlgorithm([
      row({ userId: "a", day: "2026-09-01", activeSeconds: 120, starts: 4, sessions: 1 }),
      row({ userId: "a", day: "2026-09-03", activeSeconds: 300, starts: 6, sessions: 2 }),
    ]);

    expect(totals).toHaveLength(1);
    expect(totals[0].activeSeconds).toBe(420);
    expect(totals[0].starts).toBe(10);
    expect(totals[0].sessions).toBe(3);
    expect(totals[0].daysActive).toBe(2);
    expect(totals[0].firstDay).toBe("2026-09-01");
    expect(totals[0].lastDay).toBe("2026-09-03");
  });

  it("keeps a reader's arms apart", () => {
    const totals = totalsByReaderAndAlgorithm([
      row({ userId: "a", algorithmId: "balanced", activeSeconds: 100 }),
      row({ userId: "a", algorithmId: "recency", activeSeconds: 900 }),
    ]);

    expect(totals).toHaveLength(2);
  });

  it("folds likes, shares and comments into one reaction count", () => {
    const totals = totalsByReaderAndAlgorithm([
      row({ userId: "a", likes: 2, shares: 1, comments: 3 }),
    ]);

    expect(totals[0].reactions).toBe(6);
  });
});

describe("collapseToReaders", () => {
  it("makes the reader the analysis unit, whatever the event volume", () => {
    // One enthusiast with 500 impressions is one reader. The implementation
    // this replaces would have reported a sample size of 500.
    const series = collapseToReaders(
      [row({ userId: "a", impressions: 500, starts: 480, activeSeconds: 9000, sessions: 40 })],
      "active_seconds"
    );

    expect(series.valuesByAlgorithm.balanced).toEqual([9000]);
    expect(series.valuesByAlgorithm.balanced).toHaveLength(1);
  });

  it("removes readers who produced events under both algorithms, and names them", () => {
    const series = collapseToReaders(
      [
        row({ userId: "crossed", algorithmId: "balanced", activeSeconds: 100 }),
        row({ userId: "crossed", algorithmId: "recency", activeSeconds: 200 }),
        row({ userId: "clean", algorithmId: "balanced", activeSeconds: 300 }),
      ],
      "active_seconds"
    );

    expect(series.crossedReaders).toEqual(["crossed"]);
    expect(series.valuesByAlgorithm.balanced).toEqual([300]);
    expect(series.valuesByAlgorithm.recency).toBeUndefined();
    expect(series.totalReaders).toBe(2);
  });

  it("excludes a reader whose rate has no denominator worth dividing by", () => {
    const series = collapseToReaders(
      [
        row({ userId: "thin", starts: 2, completes: 1 }),
        row({ userId: "solid", starts: 20, completes: 12 }),
      ],
      "completion_rate"
    );

    expect(series.valuesByAlgorithm.balanced).toEqual([0.6]);
    expect(series.readersWithoutDenominator).toBe(1);
  });

  it("carries the metric's direction so callers cannot invert it", () => {
    expect(collapseToReaders([], "skip_rate").lowerIsBetter).toBe(true);
    expect(collapseToReaders([], "active_seconds").lowerIsBetter).toBe(false);
  });
});

describe("compareAlgorithms", () => {
  const readers = (algorithmId: string, values: number[], prefix: string) =>
    values.map((activeSeconds, index) =>
      row({ userId: `${prefix}-${index}`, algorithmId, activeSeconds, sessions: 2 })
    );

  it("refuses to call a winner off a handful of readers", () => {
    const result = compareAlgorithms(
      [
        ...readers("balanced", [60, 90, 120], "a"),
        ...readers("recency", [400, 500, 600], "b"),
      ],
      { controlAlgorithmId: "balanced", variantAlgorithmId: "recency", metric: "active_seconds" }
    );

    expect(result.status).toBe("insufficient_data");
    expect(result.analysisUnit).toBe("reader");
    expect(result.controlReaders).toBe(3);
  });

  it("reports the readers it had to drop alongside the estimate", () => {
    const rows = [
      ...readers("balanced", Array.from({ length: 12 }, (_, i) => 60 + i * 5), "a"),
      ...readers("recency", Array.from({ length: 12 }, (_, i) => 62 + i * 5), "b"),
      row({ userId: "crossed", algorithmId: "balanced", activeSeconds: 10 }),
      row({ userId: "crossed", algorithmId: "recency", activeSeconds: 900 }),
    ];

    const result = compareAlgorithms(rows, {
      controlAlgorithmId: "balanced",
      variantAlgorithmId: "recency",
      metric: "active_seconds",
    });

    expect(result.crossedReaders).toBe(1);
    expect(result.controlReaders).toBe(12);
    expect(result.variantReaders).toBe(12);
    // Only the 24 analysed readers; the crossed reader's sessions are not
    // attributed to a sample they were excluded from.
    expect(result.sessions).toBe(24 * 2);
    expect(result.controlAlgorithmId).toBe("balanced");
  });

  it("takes the direction of better from the metric, not from the caller", () => {
    const skipRows = (algorithmId: string, skips: number, prefix: string) =>
      Array.from({ length: 12 }, (_, index) =>
        row({ userId: `${prefix}-${index}`, algorithmId, starts: 20, skips: skips + index })
      );

    const result = compareAlgorithms(
      [...skipRows("balanced", 10, "a"), ...skipRows("recency", 1, "b")],
      { controlAlgorithmId: "balanced", variantAlgorithmId: "recency", metric: "skip_rate" }
    );

    // Fewer skips under the variant is a win, even though the effect is negative.
    expect(result.effect).toBeLessThan(0);
    expect(result.status).toBe("positive");
  });

  it("is inconclusive, not equal, when two arms look the same", () => {
    const values = Array.from({ length: 15 }, (_, index) => 40 + index * 11);
    const result = compareAlgorithms(
      [...readers("balanced", values, "a"), ...readers("recency", values, "b")],
      { controlAlgorithmId: "balanced", variantAlgorithmId: "recency", metric: "active_seconds" }
    );

    expect(result.status).toBe("inconclusive");
    expect(result.power?.readersPerArm).toBe(15);
  });
});

describe("resamples", () => {
  it("is forwarded to the estimator rather than quietly ignored", () => {
    const values = Array.from({ length: 14 }, (_, index) => 40 + index * 9);
    const rows = [
      ...values.map((activeSeconds, index) =>
        row({ userId: `a-${index}`, algorithmId: "balanced", activeSeconds })
      ),
      ...values.map((activeSeconds, index) =>
        row({ userId: `b-${index}`, algorithmId: "recency", activeSeconds: activeSeconds * 1.2 })
      ),
    ];

    const base = { controlAlgorithmId: "balanced", variantAlgorithmId: "recency", metric: "active_seconds" } as const;
    const coarse = compareAlgorithms(rows, { ...base, resamples: 50 });
    const fine = compareAlgorithms(rows, { ...base, resamples: 2000 });

    // Different resample counts must produce different intervals; identical
    // ones would mean the option never reached the estimator.
    expect(coarse.ci).not.toEqual(fine.ci);
    // A p-value cannot be finer than the number of permutations behind it.
    expect(coarse.pValue).toBeGreaterThanOrEqual(1 / 51);
  });
});
