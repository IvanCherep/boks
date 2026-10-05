import { createRandom } from "@/lib/recsys/statistics/random";
import {
  coefficientOfVariation,
  mean,
  standardDeviation,
} from "@/lib/recsys/statistics/descriptive";
import type { PowerEstimate } from "@/lib/recsys/statistics/types";

/**
 * Simulation-based power for a two-arm reader-level comparison.
 *
 * This exists so an operator can be told, before spending readers, that the
 * experiment cannot answer the question. Per-reader reading time on boks has a
 * coefficient of variation around 0.95; at that spread 25 readers per arm
 * detect a +30% lift roughly 15% of the time. A launch decision made without
 * that number is a coin toss with extra steps.
 *
 * Simulated rather than solved in closed form because the closed forms assume
 * normality, and engagement time is strongly right-skewed. Draws are
 * log-normal with the requested coefficient of variation, compared with Welch's
 * t — which is what a reader-level comparison of means actually is.
 */

const SEARCHED_LIFTS = [
  0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3,
];
const SEARCHED_ARM_SIZES = [10, 15, 25, 40, 60, 100, 150, 250, 400, 800, 1600];

export type PowerRequest = {
  /** One value per reader in the control arm. */
  controlValues: number[];
  /** One value per reader in the variant arm, when an arm exists yet. */
  variantValues?: number[];
  /** Relative lift considered worth acting on, e.g. 0.3 for +30%. */
  targetEffect: number;
  confidence?: number;
  /** Power the operator is willing to plan for. */
  desiredPower?: number;
  trials?: number;
  seed?: number;
  /**
   * Also search for the readers needed to detect `targetEffect`. The most
   * expensive of the three searches (arm sizes up to 1600), and only the
   * headline needs it, so a per-prefix readout can skip it.
   */
  searchReadersNeeded?: boolean;
};

export type SimulationRequest = {
  /** Spread of the outcome, as sd / mean. Reading time sits near 0.95. */
  coefficientOfVariation: number;
  readersPerArm: number;
  /** True relative difference between the arms. */
  lift: number;
  confidence?: number;
  trials?: number;
  seed?: number;
};

export function estimatePower(request: PowerRequest): PowerEstimate {
  const confidence = request.confidence ?? 0.95;
  const desiredPower = request.desiredPower ?? 0.8;
  const trials = request.trials ?? 800;
  const seed = request.seed ?? 42;

  const pooled = [...request.controlValues, ...(request.variantValues ?? [])];
  const cv = coefficientOfVariation(pooled);
  const readersPerArm = request.variantValues?.length
    ? Math.min(request.controlValues.length, request.variantValues.length)
    : request.controlValues.length;

  if (!cv || !readersPerArm) {
    return {
      coefficientOfVariation: 0,
      readersPerArm,
      targetEffect: request.targetEffect,
      powerForTargetEffect: 0,
      desiredPower,
      minimumDetectableEffect: null,
      readersNeededForTargetEffect: null,
    };
  }

  const shared = { coefficientOfVariation: cv, confidence, trials, seed };

  const minimumDetectableEffect =
    SEARCHED_LIFTS.find(
      (lift) => simulatePower({ ...shared, readersPerArm, lift }) >= desiredPower
    ) ?? null;

  const readersNeededForTargetEffect =
    request.searchReadersNeeded === false
      ? null
      : SEARCHED_ARM_SIZES.find(
      (arm) =>
        simulatePower({ ...shared, readersPerArm: arm, lift: request.targetEffect }) >=
        desiredPower
      ) ?? null;

  return {
    coefficientOfVariation: round(cv, 2),
    readersPerArm,
    targetEffect: request.targetEffect,
    powerForTargetEffect: round(
      simulatePower({ ...shared, readersPerArm, lift: request.targetEffect }),
      2
    ),
    desiredPower,
    minimumDetectableEffect,
    readersNeededForTargetEffect,
  };
}

/**
 * Probability that a two-arm comparison of this size and spread rejects the
 * null when the true lift is `lift`.
 *
 * Exported so the estimate can be checked against the power table recorded in
 * `docs/research/recsys-research-implementation-plan.md` §A.3, which was measured
 * independently of this code.
 */
export function simulatePower(request: SimulationRequest) {
  const trials = request.trials ?? 800;
  const confidence = request.confidence ?? 0.95;
  const next = createRandom(request.seed ?? 42);

  // sigma of the underlying normal that yields the requested spread.
  const cv = Math.min(3, Math.max(0, request.coefficientOfVariation));
  const sigma = Math.sqrt(Math.log(1 + cv * cv));
  if (!sigma || request.readersPerArm < 2) return 0;

  let detected = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const control = draw(request.readersPerArm, 1, sigma, next);
    const variant = draw(request.readersPerArm, 1 + request.lift, sigma, next);
    if (rejectsNull(control, variant, confidence)) detected += 1;
  }

  return detected / trials;
}

function draw(size: number, medianValue: number, sigma: number, next: () => number) {
  const sample: number[] = new Array(size);
  for (let index = 0; index < size; index += 1) {
    sample[index] = medianValue * Math.exp(sigma * gaussian(next));
  }
  return sample;
}

function gaussian(next: () => number) {
  // Box-Muller against a seeded generator, so every estimate is reproducible.
  const u = Math.max(next(), Number.EPSILON);
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Welch's t against a t critical value, not 1.96.
 *
 * At 12 readers per arm the normal approximation over-rejects by several
 * percentage points, which would make this tool report power the design does
 * not have — the exact failure it is meant to prevent.
 */
function rejectsNull(control: number[], variant: number[], confidence: number) {
  const controlError = standardDeviation(control) ** 2 / control.length;
  const variantError = standardDeviation(variant) ** 2 / variant.length;
  const standardError = Math.sqrt(controlError + variantError);
  if (!standardError) return false;

  const statistic = Math.abs(mean(variant) - mean(control)) / standardError;
  const degreesOfFreedom =
    (controlError + variantError) ** 2 /
    (controlError ** 2 / (control.length - 1) + variantError ** 2 / (variant.length - 1));

  return statistic > tCritical(degreesOfFreedom, confidence);
}

/**
 * Two-sided t critical value via the Cornish-Fisher expansion of the normal
 * quantile. Within 0.002 of the exact value above 10 degrees of freedom, which
 * is far inside the Monte Carlo error of the surrounding simulation.
 */
function tCritical(degreesOfFreedom: number, confidence: number) {
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const df = Math.max(1, degreesOfFreedom);
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
  );
}

/** Acklam's inverse normal CDF. Accurate to about 1e-9 across the range. */
function normalQuantile(probability: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969,
    138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887,
    66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;

  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (probability > 1 - low) return -normalQuantile(1 - probability);

  const q = probability - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
