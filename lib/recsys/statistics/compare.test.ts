import { describe, expect, it } from "vitest";
import { compareIndependent, comparePaired, signTest } from "@/lib/recsys/statistics/compare";
import { quantile } from "@/lib/recsys/statistics/descriptive";

/** Reader-level reading seconds: heavily skewed, a handful of enthusiasts. */
const SKEWED_READERS = [
  18, 22, 25, 31, 33, 40, 44, 51, 58, 62, 70, 88, 96, 120, 140, 190, 260, 410, 640, 980,
];

describe("compareIndependent", () => {
  it("refuses to estimate below the declared minimum, rather than guessing", () => {
    const result = compareIndependent([10, 20, 30], [40, 50, 60], { metric: "active_seconds" });

    expect(result.status).toBe("insufficient_data");
    expect(result.effect).toBe(0);
    expect(result.ci).toEqual([0, 0]);
    // The raw numbers are still handed over: three readers is not a result,
    // but it is data the operator is entitled to look at.
    expect(result.perReaderValues?.control).toHaveLength(3);
  });

  it("keeps the minimum-sample guard when a caller forwards an unset option", () => {
    // `{...defaults, ...options}` would write this `undefined` over the
    // default and quietly disable the guard.
    const result = compareIndependent([10, 20, 30], [400, 500, 600], {
      metric: "active_seconds",
      minimumReaders: undefined,
      seed: undefined,
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.minimumReaders).toBe(10);
  });

  it("calls two identical arms inconclusive, never equivalent", () => {
    const result = compareIndependent(SKEWED_READERS, [...SKEWED_READERS], {
      metric: "active_seconds",
    });

    expect(result.status).toBe("inconclusive");
    expect(result.ci[0]).toBeLessThanOrEqual(0);
    expect(result.ci[1]).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeGreaterThan(0.5);
  });

  it("detects a separation large enough to be real", () => {
    const control = SKEWED_READERS.map((value) => value);
    const variant = SKEWED_READERS.map((value) => value * 4 + 200);

    const result = compareIndependent(control, variant, { metric: "active_seconds" });

    expect(result.status).toBe("positive");
    expect(result.ci[0]).toBeGreaterThan(0);
    expect(result.effect).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("reads the direction of the effect from the metric, not its sign", () => {
    const control = [40, 42, 45, 48, 50, 52, 55, 58, 60, 62, 65, 68];
    const variant = control.map((value) => value - 25);

    const higherIsBetter = compareIndependent(control, variant, { metric: "active_seconds" });
    const lowerIsBetter = compareIndependent(control, variant, {
      metric: "skip_rate",
      lowerIsBetter: true,
    });

    expect(higherIsBetter.status).toBe("negative");
    expect(lowerIsBetter.status).toBe("positive");
  });

  it("never reports a p-value of exactly zero", () => {
    // 2000 permutations cannot support a claim stronger than 1/2001.
    const result = compareIndependent(
      SKEWED_READERS,
      SKEWED_READERS.map((value) => value * 50),
      { metric: "active_seconds" }
    );

    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(0.001);
  });

  it("is reproducible: the same data and seed give the same interval", () => {
    const args = [SKEWED_READERS, SKEWED_READERS.map((value) => value * 1.4)] as const;
    const once = compareIndependent(args[0], args[1], { metric: "active_seconds", seed: 99 });
    const twice = compareIndependent(args[0], args[1], { metric: "active_seconds", seed: 99 });

    expect(once.ci).toEqual(twice.ci);
    expect(once.pValue).toBe(twice.pValue);
  });

  it("carries its analysis unit and sample sizes in the result", () => {
    const result = compareIndependent(SKEWED_READERS, [...SKEWED_READERS], {
      metric: "active_seconds",
    });

    expect(result.analysisUnit).toBe("reader");
    expect(result.design).toBe("independent");
    expect(result.controlReaders).toBe(20);
    expect(result.variantReaders).toBe(20);
    expect(result.readers).toBe(40);
  });

  it("reports one estimand: the effect, interval and p-value never disagree", () => {
    // Under the old Hodges-Lehmann effect this printed "-4, interval [20, 195],
    // negative": a variant whose whole interval lay above zero, called worse.
    const control = Array.from({ length: 12 }, (_, index) => 100 + index);
    const variant = [95, 96, 97, 98, 99, 100, 101, 102, 400, 420, 450, 480];
    const result = compareIndependent(control, variant, { metric: "active_seconds" });

    expect(result.effect).toBeCloseTo(
      variant.reduce((a, b) => a + b, 0) / 12 - control.reduce((a, b) => a + b, 0) / 12,
      4
    );
    expect(result.effect).toBeGreaterThanOrEqual(result.ci[0]);
    expect(result.effect).toBeLessThanOrEqual(result.ci[1]);
    if (result.status === "positive") expect(result.ci[0]).toBeGreaterThan(0);
    if (result.status === "negative") expect(result.ci[1]).toBeLessThan(0);
    expect(result.status).not.toBe("negative");
  });

  it("stops printing every reader once the sample is too large to read", () => {
    const many = Array.from({ length: 60 }, (_, index) => 20 + index * 3);
    const result = compareIndependent(many, [...many], { metric: "active_seconds" });

    expect(result.perReaderValues).toBeUndefined();
  });
});

describe("comparePaired", () => {
  /**
   * The same readers, each spending 15% longer under the variant. Between-reader
   * spread is enormous; the within-reader effect is consistent.
   */
  const pairs = SKEWED_READERS.map((value) => ({ control: value, variant: value * 1.15 }));

  it("resolves an effect that the unpaired design cannot see", () => {
    const paired = comparePaired(pairs, { metric: "active_seconds" });
    const unpaired = compareIndependent(
      pairs.map((pair) => pair.control),
      pairs.map((pair) => pair.variant),
      { metric: "active_seconds" }
    );

    // This is the entire argument for interleaving at boks' scale.
    expect(paired.status).toBe("positive");
    expect(unpaired.status).toBe("inconclusive");
  });

  it("uses an exact sign test, so no distribution is assumed", () => {
    const result = comparePaired(pairs, { metric: "active_seconds" });

    expect(result.design).toBe("paired");
    // Twenty readers all moving the same way: 1.9e-6, reported as such rather
    // than rounded down to a zero the test cannot support.
    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeCloseTo(signTest(pairs.map((p) => p.variant - p.control)), 7);
  });

  it("is inconclusive when the within-reader differences cancel", () => {
    const noisy = SKEWED_READERS.map((value, index) => ({
      control: value,
      variant: index % 2 ? value * 1.3 : value * 0.7,
    }));

    expect(comparePaired(noisy, { metric: "active_seconds" }).status).toBe("inconclusive");
  });

  it("refuses to estimate below the declared minimum", () => {
    expect(comparePaired(pairs.slice(0, 4), { metric: "active_seconds" }).status).toBe(
      "insufficient_data"
    );
  });
});

describe("signTest", () => {
  it("stays a probability for a sample far beyond a thousand readers", () => {
    const differences = Array.from({ length: 2000 }, (_, index) => (index % 2 ? 1 : -1));
    const p = signTest(differences);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThan(0.9);
  });

  it("matches the exact binomial tail", () => {
    // 10 of 10 in one direction: 2 x (1/1024).
    expect(signTest([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBeCloseTo(2 / 1024, 10);
    // 9 of 10: 2 x (10 + 1)/1024.
    expect(signTest([1, 1, 1, 1, 1, 1, 1, 1, 1, -1])).toBeCloseTo((2 * 11) / 1024, 10);
  });

  it("treats ties as carrying no information", () => {
    expect(signTest([0, 0, 0])).toBe(1);
    expect(signTest([1, 1, 1, 0, 0])).toBeCloseTo(signTest([1, 1, 1]), 10);
  });
});

describe("quantile", () => {
  it("interpolates between the surrounding order statistics", () => {
    expect(quantile([0, 10, 20, 30], 0.5)).toBe(15);
    expect(quantile([0, 10, 20, 30], 0)).toBe(0);
    expect(quantile([0, 10, 20, 30], 1)).toBe(30);
  });
});
