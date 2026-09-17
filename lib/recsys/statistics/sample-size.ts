import { compareIndependent } from "@/lib/recsys/statistics/compare";
import { coefficientOfVariation, mean } from "@/lib/recsys/statistics/descriptive";
import { estimatePower, simulatePower } from "@/lib/recsys/statistics/power";
import type { ComparisonOptions, ComparisonStatus } from "@/lib/recsys/statistics/types";

/**
 * How a comparison behaves as readers accumulate.
 *
 * The question this answers is not "what is the effect" but "when will we be
 * able to tell". Those are different questions and only the second one can be
 * answered before the data exists, which is why it is the one an operator
 * needs at 20 readers and an investor needs before there are any.
 *
 * Two modes, and the difference matters:
 *
 *   * **Observed** - replay the comparison on the first `k` readers of each
 *     arm, for growing `k`. This is what actually happened: the same estimator
 *     on real prefixes of the real data. It shows the interval narrowing, and
 *     it shows honestly that an early "result" can flip.
 *   * **Projected** - hold the spread observed so far and ask what sample size
 *     would be needed to resolve a given effect. This is a plan, not a
 *     measurement, and is labelled as such.
 *
 * Neither is a forecast of the effect. A curve that wanders and then settles is
 * the normal shape of a small experiment, not a trend to extrapolate.
 */

export type SampleSizeStep = {
  /** Readers per arm at this step: the smaller arm, not the total. */
  readersPerArm: number;
  readers: number;
  status: ComparisonStatus;
  /** Hodges-Lehmann shift on the prefix, or null when below the minimum. */
  effect: number | null;
  ci: [number, number] | null;
  /** Half the interval width: how precise the answer is at this size. */
  precision: number | null;
  /** Smallest relative lift this many readers could resolve. */
  minimumDetectableEffect: number | null;
};

export type SampleSizeProjection = {
  readersPerArm: number;
  /** Probability of detecting `targetEffect` at this size. */
  power: number;
};

export type SampleSizeCurve = {
  metric: string;
  /** Spread of the metric across readers, which drives every projection. */
  coefficientOfVariation: number;
  readersPerArmNow: number;
  /** What actually happened, on prefixes of the data in hand. */
  observed: SampleSizeStep[];
  /** What a given size would buy, holding the observed spread. */
  projected: SampleSizeProjection[];
  /** Readers per arm needed for `targetEffect`, or null if beyond the search. */
  readersNeededForTargetEffect: number | null;
  targetEffect: number;
  /**
   * One sentence an operator can act on, or hand to someone who will ask what
   * the chart means.
   */
  readout: string;
};

const defaultSteps = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 800, 1200];

function stepsUpTo(readersPerArm: number) {
  const steps = defaultSteps.filter((step) => step <= readersPerArm);
  // Always finish at what is actually in hand, so the last point is today.
  if (readersPerArm > 0 && steps[steps.length - 1] !== readersPerArm) steps.push(readersPerArm);
  return steps;
}

function projectionSteps(readersPerArm: number) {
  return defaultSteps.filter((step) => step > readersPerArm).slice(0, 6);
}

function roundTo(value: number, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * `controlValues` and `variantValues` must be in the order the readers arrived,
 * so a prefix is "the first k readers" rather than an arbitrary subset. The
 * caller owns that ordering, because only it knows when each reader joined.
 */
export function buildSampleSizeCurve(
  controlValues: number[],
  variantValues: number[],
  options: ComparisonOptions & { targetEffect?: number; desiredPower?: number }
): SampleSizeCurve {
  const readersPerArmNow = Math.min(controlValues.length, variantValues.length);
  const targetEffect = options.targetEffect ?? 0.3;
  const desiredPower = options.desiredPower ?? 0.8;
  const pooled = [...controlValues, ...variantValues];
  const spread = coefficientOfVariation(pooled);

  const observed: SampleSizeStep[] = stepsUpTo(readersPerArmNow).map((step) => {
    const control = controlValues.slice(0, step);
    const variant = variantValues.slice(0, step);
    const result = compareIndependent(control, variant, options);
    const ci = result.status === "insufficient_data" ? null : result.ci;

    return {
      readersPerArm: step,
      readers: control.length + variant.length,
      status: result.status,
      effect: result.status === "insufficient_data" ? null : roundTo(result.effect),
      ci: ci ? [roundTo(ci[0]), roundTo(ci[1])] : null,
      precision: ci ? roundTo((ci[1] - ci[0]) / 2) : null,
      minimumDetectableEffect: result.power?.minimumDetectableEffect ?? null,
    };
  });

  // Projections need a spread to work from. With no data there is nothing to
  // hold constant, and inventing one would be a forecast dressed as a plan.
  // Simulated at the spread actually observed, so the plan is anchored to this
  // metric on this product rather than to a textbook variance.
  const projected: SampleSizeProjection[] = pooled.length
    ? projectionSteps(readersPerArmNow).map((step) => ({
        readersPerArm: step,
        power: roundTo(
          simulatePower({
            coefficientOfVariation: spread,
            readersPerArm: step,
            lift: targetEffect,
            confidence: options.confidence,
            seed: options.seed,
          }),
          3
        ),
      }))
    : [];

  const now = pooled.length
    ? estimatePower({
        controlValues,
        variantValues,
        targetEffect,
        desiredPower,
        confidence: options.confidence,
        seed: options.seed,
      })
    : null;

  return {
    metric: options.metric,
    coefficientOfVariation: roundTo(spread, 3),
    readersPerArmNow,
    observed,
    projected,
    readersNeededForTargetEffect: now?.readersNeededForTargetEffect ?? null,
    targetEffect,
    readout: describeCurve({
      metric: options.metric,
      readersPerArmNow,
      mde: now?.minimumDetectableEffect ?? null,
      needed: now?.readersNeededForTargetEffect ?? null,
      targetEffect,
      mean: mean(pooled),
    }),
  };
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function describeCurve(input: {
  metric: string;
  readersPerArmNow: number;
  mde: number | null;
  needed: number | null;
  targetEffect: number;
  mean: number;
}) {
  if (!input.readersPerArmNow) {
    return `No reader has been measured on ${input.metric} yet, so there is nothing to compare and nothing to project.`;
  }

  const size = `${input.readersPerArmNow} reader${input.readersPerArmNow === 1 ? "" : "s"} per arm`;

  if (input.mde === null) {
    return (
      `${size}. At this spread nothing short of a doubling would be reliably visible on ${input.metric}, ` +
      `so treat any difference on this screen as unresolved. ` +
      (input.needed
        ? `Detecting ${percent(input.targetEffect)} would take about ${input.needed} per arm.`
        : `Detecting ${percent(input.targetEffect)} would take more readers than this tool searches for.`)
    );
  }

  return (
    `${size}. Differences of about ${percent(input.mde)} or larger on ${input.metric} are visible at this size; ` +
    `anything smaller is not, however it looks. ` +
    (input.needed
      ? `Resolving ${percent(input.targetEffect)} needs about ${input.needed} per arm.`
      : `Resolving ${percent(input.targetEffect)} is beyond the sizes this tool searches.`)
  );
}
