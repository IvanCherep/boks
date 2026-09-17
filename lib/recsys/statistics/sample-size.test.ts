import { describe, expect, it } from "vitest";
import { buildSampleSizeCurve } from "@/lib/recsys/statistics/sample-size";
import { createRandom } from "@/lib/recsys/statistics/random";

/** Readers in arrival order, log-normal-ish, which is how reading time behaves. */
function readers(count: number, centre: number, spread: number, seed: number) {
  const random = createRandom(seed);
  return Array.from({ length: count }, () => {
    const noise = (random() + random() + random() - 1.5) * spread;
    return Math.max(0, centre * (1 + noise));
  });
}

const options = {
  metric: "active reading minutes",
  minimumReaders: 10,
  bootstrapSamples: 300,
  permutationSamples: 300,
  seed: 7,
};

describe("buildSampleSizeCurve", () => {
  it("says nothing at all when no reader has been measured", () => {
    const curve = buildSampleSizeCurve([], [], options);

    expect(curve.readersPerArmNow).toBe(0);
    expect(curve.observed).toEqual([]);
    // No spread to hold constant means no honest projection either.
    expect(curve.projected).toEqual([]);
    expect(curve.readout).toMatch(/nothing to compare/);
  });

  it("refuses an estimate below the minimum sample, then starts giving one", () => {
    const control = readers(30, 6, 0.5, 1);
    const variant = readers(30, 6, 0.5, 2);

    const curve = buildSampleSizeCurve(control, variant, options);
    const small = curve.observed.find((step) => step.readersPerArm === 5);
    const larger = curve.observed.find((step) => step.readersPerArm === 20);

    expect(small?.status).toBe("insufficient_data");
    expect(small?.effect).toBeNull();
    expect(small?.ci).toBeNull();
    expect(larger?.status).not.toBe("insufficient_data");
    expect(larger?.ci).not.toBeNull();
  });

  it("ends on the sample actually in hand, so the last point is today", () => {
    const curve = buildSampleSizeCurve(readers(37, 6, 0.4, 3), readers(41, 6, 0.4, 4), options);

    expect(curve.readersPerArmNow).toBe(37);
    expect(curve.observed[curve.observed.length - 1].readersPerArm).toBe(37);
  });

  it("gets more precise as readers accumulate", () => {
    const control = readers(200, 6, 0.4, 5);
    const variant = readers(200, 6, 0.4, 6);

    const curve = buildSampleSizeCurve(control, variant, options);
    const measured = curve.observed.filter((step) => step.precision !== null);
    const first = measured[0].precision!;
    const last = measured[measured.length - 1].precision!;

    // The interval is not required to shrink monotonically - it is a random
    // quantity - but over an order of magnitude more readers it must shrink.
    expect(last).toBeLessThan(first);
  });

  it("projects larger samples without claiming an effect", () => {
    const curve = buildSampleSizeCurve(readers(20, 6, 0.5, 7), readers(20, 6, 0.5, 8), options);

    expect(curve.projected.length).toBeGreaterThan(0);
    expect(curve.projected.every((step) => step.readersPerArm > curve.readersPerArmNow)).toBe(true);
    // Power rises with size, which is the only claim a projection may make.
    const powers = curve.projected.map((step) => step.power);
    expect(powers[powers.length - 1]).toBeGreaterThanOrEqual(powers[0]);
  });

  it("needs more readers when the metric is more variable", () => {
    const tight = buildSampleSizeCurve(readers(40, 6, 0.2, 9), readers(40, 6, 0.2, 10), options);
    const noisy = buildSampleSizeCurve(readers(40, 6, 0.9, 11), readers(40, 6, 0.9, 12), options);

    expect(noisy.coefficientOfVariation).toBeGreaterThan(tight.coefficientOfVariation);
    // A noisier metric resolves a *larger* minimum effect at the same size.
    const tightStep = tight.observed[tight.observed.length - 1].minimumDetectableEffect;
    const noisyStep = noisy.observed[noisy.observed.length - 1].minimumDetectableEffect;
    if (tightStep !== null && noisyStep !== null) {
      expect(noisyStep).toBeGreaterThan(tightStep);
    } else {
      // A null means "not even a doubling", which is itself the worse case.
      expect(noisyStep).toBeNull();
    }
  });

  it("states the size in a sentence, including what is not visible", () => {
    const curve = buildSampleSizeCurve(readers(24, 6, 0.6, 13), readers(24, 6, 0.6, 14), options);

    expect(curve.readout).toMatch(/24 readers per arm/);
    expect(curve.readout).toMatch(/visible|unresolved/);
  });
});
