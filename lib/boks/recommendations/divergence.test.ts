import { describe, expect, it } from "vitest";
import { kendallTau, measureStrategyDivergence } from "@/lib/boks/recommendations/divergence";
import { listRecommendationStrategies } from "@/lib/boks/recommendations/registry";
import type { StoryCandidate } from "@/lib/boks/recommendations/signals";

const now = new Date("2026-09-12T12:00:00.000Z");

/**
 * A catalog with genuine spread: some boks are finished, some provoke
 * reactions, some are new and untested. If the algorithms cannot be told apart
 * on this, they cannot be told apart anywhere.
 */
function catalog(size: number): StoryCandidate[] {
  return Array.from({ length: size }, (_, index) => {
    const starts = (index * 7) % 140;
    return {
      id: `bok-${index}`,
      title: `Bok ${index}`,
      genre: ["literary", "mystery", "slice of life", "speculative"][index % 4],
      mood: ["quiet", "warm", "tense", "strange"][index % 4],
      minutes: (index % 14) + 1,
      wordCount: ((index % 14) + 1) * 240,
      createdAt: new Date(now.getTime() - index * 36e5).toISOString(),
      impressions: starts * 2,
      starts,
      completes: Math.round(starts * ((index % 9) / 10)),
      skips: Math.round(starts * ((index % 5) / 12)),
      likes: (index * 3) % 40,
      shares: index % 6,
      comments: index % 11,
      readSecondsTotal: starts * 120,
    };
  });
}

describe("measureStrategyDivergence", () => {
  it("reports no divergence between an algorithm and itself", () => {
    const report = measureStrategyDivergence({
      candidates: catalog(60),
      algorithmIds: ["balanced", "balanced"],
      now,
    });

    expect(report.pairs[0].overlap).toBe(1);
    expect(report.pairs[0].kendallTau).toBe(1);
  });

  it("separates a random baseline from a quality ranker on a real catalog", () => {
    const report = measureStrategyDivergence({
      candidates: catalog(60),
      algorithmIds: ["completion_first", "random_control"],
      now,
    });

    expect(report.pairs[0].overlap).toBeLessThan(0.6);
    expect(report.verdict).toBe("usable");
  });

  /**
   * The trap this whole diagnostic exists for. With a handful of boks every
   * algorithm shows nearly the same list, so an experiment between them cannot
   * resolve anything however long it runs and however many readers it has.
   */
  it("reports that a tiny catalog makes the algorithms indistinguishable", () => {
    const report = measureStrategyDivergence({
      candidates: catalog(5),
      algorithmIds: ["balanced", "completion_first", "reaction_first", "discovery"],
      topK: 10,
      now,
    });

    expect(report.meanOverlap).toBe(1);
    expect(report.verdict).toBe("indistinguishable");
    expect(report.summary).toContain("Publish more boks");
  });

  it("gives every registered algorithm a pairwise reading by default", () => {
    const report = measureStrategyDivergence({ candidates: catalog(60), now });
    // Derived from the registry rather than hard-coded, so registering a
    // strategy does not silently change what this test is checking.
    const strategies = listRecommendationStrategies().length;
    expect(report.pairs).toHaveLength((strategies * (strategies - 1)) / 2);
    expect(report.candidateCount).toBe(60);
  });

  it("orders pairs so the most alike algorithms are seen first", () => {
    const report = measureStrategyDivergence({ candidates: catalog(60), now });
    const overlaps = report.pairs.map((pair) => pair.overlap);
    expect([...overlaps].sort((a, b) => b - a)).toEqual(overlaps);
  });
});

describe("kendallTau", () => {
  it("is 1 for identical orderings", () => {
    expect(kendallTau(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
  });

  it("is -1 for exactly reversed orderings", () => {
    expect(kendallTau(["a", "b", "c"], ["c", "b", "a"])).toBe(-1);
  });

  it("is near zero for an ordering that shares no structure", () => {
    expect(Math.abs(kendallTau(["a", "b", "c", "d"], ["b", "a", "d", "c"]))).toBeLessThan(0.5);
  });

  it("treats a single shared item as agreement rather than dividing by zero", () => {
    expect(kendallTau(["a"], ["a", "b"])).toBe(1);
  });
});
