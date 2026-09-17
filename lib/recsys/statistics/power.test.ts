import { describe, expect, it } from "vitest";
import { estimatePower, simulatePower } from "@/lib/recsys/statistics/power";

/**
 * The power table in `RECSYS-RESEARCH-IMPLEMENTATION-PLAN.md` §A.3 was measured
 * before this module existed, by a separate simulation. That makes it ground
 * truth this code can be checked against rather than a restatement of itself.
 *
 * Both sides are Monte Carlo, so the tolerance is 4 percentage points: tight
 * enough that a wrong critical value (normal instead of t, which inflates power
 * by 3-7 points at these sizes) fails, loose enough that resampling noise does
 * not.
 */
const RECORDED_TABLE: { lift: number; byArmSize: Record<number, number> }[] = [
  { lift: 0.2, byArmSize: { 12: 6, 25: 9, 50: 15, 100: 25 } },
  { lift: 0.3, byArmSize: { 12: 10, 25: 15, 50: 26, 100: 48 } },
  { lift: 0.5, byArmSize: { 12: 17, 25: 33, 50: 55, 100: 84 } },
  { lift: 0.8, byArmSize: { 12: 32, 25: 58, 50: 86, 100: 99 } },
];

const MEASURED_CV = 0.95;

describe("simulatePower", () => {
  it("reproduces the power table measured in the plan, within 4 points", () => {
    for (const row of RECORDED_TABLE) {
      for (const [armSize, recorded] of Object.entries(row.byArmSize)) {
        const simulated =
          simulatePower({
            coefficientOfVariation: MEASURED_CV,
            readersPerArm: Number(armSize),
            lift: row.lift,
            trials: 2000,
            seed: 2026,
          }) * 100;

        expect(
          Math.abs(simulated - recorded),
          `lift +${row.lift * 100}% at n=${armSize}: recorded ${recorded}%, simulated ${simulated}%`
        ).toBeLessThanOrEqual(4);
      }
    }
  });

  it("holds the false positive rate at the nominal level when there is no effect", () => {
    const falsePositives = simulatePower({
      coefficientOfVariation: MEASURED_CV,
      readersPerArm: 50,
      lift: 0,
      trials: 2000,
      seed: 11,
    });

    // A test that over-rejects under the null is worse than an underpowered
    // one: it manufactures winners out of noise.
    expect(falsePositives).toBeLessThan(0.07);
  });

  it("increases with sample size and with effect size", () => {
    const at = (readersPerArm: number, lift: number) =>
      simulatePower({ coefficientOfVariation: MEASURED_CV, readersPerArm, lift, trials: 1500, seed: 5 });

    expect(at(100, 0.5)).toBeGreaterThan(at(25, 0.5));
    expect(at(50, 0.8)).toBeGreaterThan(at(50, 0.3));
  });

  it("is reproducible across calls with the same seed", () => {
    const once = simulatePower({ coefficientOfVariation: 0.95, readersPerArm: 30, lift: 0.4, seed: 7 });
    const twice = simulatePower({ coefficientOfVariation: 0.95, readersPerArm: 30, lift: 0.4, seed: 7 });
    expect(once).toBe(twice);
  });

  it("reports no power for an arm too small to compute a spread", () => {
    expect(simulatePower({ coefficientOfVariation: 0.95, readersPerArm: 1, lift: 2 })).toBe(0);
  });
});

describe("estimatePower", () => {
  const spread = (size: number, seed: number) => {
    // Deterministic right-skewed reader values, CV near the measured 0.95.
    const values: number[] = [];
    for (let index = 0; index < size; index += 1) {
      values.push(30 + ((index * seed) % 7) ** 3.1);
    }
    return values;
  };

  it("takes the smaller arm as the planning size, never the total", () => {
    const estimate = estimatePower({
      controlValues: spread(40, 3),
      variantValues: spread(12, 5),
      targetEffect: 0.3,
      trials: 300,
    });

    expect(estimate.readersPerArm).toBe(12);
  });

  it("tells an operator how many readers the target effect would need", () => {
    const estimate = estimatePower({
      controlValues: spread(25, 3),
      variantValues: spread(25, 5),
      targetEffect: 0.3,
      trials: 400,
    });

    // The point of the readout: 25 readers per arm cannot see +30%.
    expect(estimate.powerForTargetEffect).toBeLessThan(0.5);
    expect(estimate.readersNeededForTargetEffect).toBeGreaterThan(25);
  });

  it("returns nulls rather than a fabricated estimate when there is no data", () => {
    const estimate = estimatePower({ controlValues: [], targetEffect: 0.3 });

    expect(estimate.readersPerArm).toBe(0);
    expect(estimate.powerForTargetEffect).toBe(0);
    expect(estimate.minimumDetectableEffect).toBeNull();
    expect(estimate.readersNeededForTargetEffect).toBeNull();
  });
});
