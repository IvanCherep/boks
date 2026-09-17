import { describe, expect, it } from "vitest";
import { buildRecommendationLab, findComparison } from "@/lib/boks/recommendations/metrics";
import type { ReaderOutcomeRow } from "@/lib/recsys/aggregate";

function row(overrides: Partial<ReaderOutcomeRow> & { userId: string }): ReaderOutcomeRow {
  return {
    algorithmId: "balanced",
    day: "2026-09-01",
    cohortWeek: "2026-08-31",
    tenureDays: 0,
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
    ...overrides,
  };
}

function arm(algorithmId: string, count: number, seconds: (index: number) => number, prefix: string) {
  return Array.from({ length: count }, (_, index) =>
    row({ userId: `${prefix}-${index}`, algorithmId, activeSeconds: seconds(index) })
  );
}

const options = {
  controlAlgorithmId: "balanced",
  minimumReadersPerArm: 10,
  windowDays: 30,
};

describe("buildRecommendationLab", () => {
  it("states its analysis unit in the report", () => {
    const report = buildRecommendationLab([], options);
    expect(report.analysisUnit).toBe("reader");
  });

  it("counts readers, never impressions, as the sample size", () => {
    // One reader, two hundred impressions. The implementation this replaces
    // would have called that a sample of two hundred and printed a verdict.
    const report = buildRecommendationLab(
      [row({ userId: "solo", impressions: 200, starts: 180, completes: 90 })],
      options
    );

    expect(report.arms[0].readers).toBe(1);
    expect(report.arms[0].impressions).toBe(200);
    expect(report.arms[0].readiness.ready).toBe(false);
  });

  it("puts the control first and the rest by reader count", () => {
    const report = buildRecommendationLab(
      [
        ...arm("recency", 4, () => 100, "r"),
        ...arm("balanced", 2, () => 100, "b"),
        ...arm("discovery", 6, () => 100, "d"),
      ],
      options
    );

    expect(report.arms.map((entry) => entry.algorithmId)).toEqual([
      "balanced",
      "discovery",
      "recency",
    ]);
  });

  it("reports the median reading time, not the mean", () => {
    // One reader with a marathon session must not become the arm's summary.
    const report = buildRecommendationLab(
      [
        ...arm("balanced", 10, (index) => (index === 9 ? 100000 : 60), "b"),
      ],
      options
    );

    expect(report.arms[0].medianActiveSeconds).toBe(60);
  });

  it("declines to compare arms that are too small", () => {
    const report = buildRecommendationLab(
      [...arm("balanced", 4, () => 60, "b"), ...arm("recency", 4, () => 600, "r")],
      options
    );

    const comparison = findComparison(report, "recency", "active_seconds");
    expect(comparison?.status).toBe("insufficient_data");
    expect(comparison?.effect).toBe(0);
  });

  it("compares every variant arm against the control, on every lab metric", () => {
    const report = buildRecommendationLab(
      [...arm("balanced", 12, (index) => 60 + index, "b"), ...arm("recency", 12, (index) => 62 + index, "r")],
      options
    );

    expect(report.comparisons).toHaveLength(4);
    expect(new Set(report.comparisons.map((entry) => entry.variantAlgorithmId))).toEqual(
      new Set(["recency"])
    );
    for (const comparison of report.comparisons) {
      expect(comparison.analysisUnit).toBe("reader");
      expect(comparison.controlAlgorithmId).toBe("balanced");
    }
  });

  it("never reports a comparison when no control arm has readers", () => {
    const report = buildRecommendationLab(arm("recency", 12, () => 100, "r"), options);
    expect(report.comparisons).toEqual([]);
  });

  it("excludes readers who appear under both arms, and says how many", () => {
    const report = buildRecommendationLab(
      [
        ...arm("balanced", 11, () => 60, "b"),
        ...arm("recency", 11, () => 60, "r"),
        row({ userId: "crossed", algorithmId: "balanced" }),
        row({ userId: "crossed", algorithmId: "recency" }),
      ],
      options
    );

    expect(report.totals.crossedReaders).toBe(1);
    expect(report.arms.every((entry) => entry.readers === 11)).toBe(true);
  });

  it("reports how many events are reconstructible", () => {
    const report = buildRecommendationLab(
      [
        row({ userId: "a", totalEvents: 10, attributedEvents: 10 }),
        row({ userId: "b", totalEvents: 10, attributedEvents: 0 }),
      ],
      options
    );

    expect(report.totals.events).toBe(20);
    expect(report.totals.attributedEvents).toBe(10);
  });

  it("labels pooled rates as arm descriptions, computed over the arm's events", () => {
    const report = buildRecommendationLab(
      [row({ userId: "a", starts: 10, completes: 5, skips: 2, likes: 1, shares: 1, comments: 0 })],
      options
    );

    expect(report.arms[0].completionRate).toBe(50);
    expect(report.arms[0].skipRate).toBe(20);
    expect(report.arms[0].reactionRate).toBe(20);
  });
});

describe("findComparison", () => {
  it("looks comparisons up by metric id, not by display label", () => {
    const report = buildRecommendationLab(
      [...arm("balanced", 12, (index) => 60 + index, "b"), ...arm("recency", 12, (index) => 62 + index, "r")],
      options
    );

    expect(findComparison(report, "recency", "skip_rate")?.metricId).toBe("skip_rate");
    expect(findComparison(report, "recency", "seconds_per_session")).toBeUndefined();
    expect(findComparison(report, "balanced", "active_seconds")).toBeUndefined();
  });
});
