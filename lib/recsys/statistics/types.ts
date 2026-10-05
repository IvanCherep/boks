/**
 * The shape every comparison in the system must return.
 *
 * It is deliberately impossible to construct a result that omits its analysis
 * unit, its sample size or its uncertainty. The previous implementation
 * returned a bare number and a confidence label computed over impressions,
 * which is how three readers came to look like a significant result.
 */

export type ComparisonDesign = "independent" | "paired" | "interleaved";

export type AnalysisUnit = "reader" | "session";

export type ComparisonStatus =
  /** The interval excludes the null and the effect is in the good direction. */
  | "positive"
  /** The interval excludes the null and the effect is in the bad direction. */
  | "negative"
  /** The interval spans the null. NOT the same as "no difference". */
  | "inconclusive"
  /** Below the minimum sample the comparison declared. No estimate is offered. */
  | "insufficient_data";

export type EffectKind = "absolute" | "relative";

export type PowerEstimate = {
  /** Spread the estimate was computed from, as sd / mean over readers. */
  coefficientOfVariation: number;
  /** Readers per arm the estimate assumes — the smaller arm, not the total. */
  readersPerArm: number;
  /** Relative lift the operator declared worth acting on. */
  targetEffect: number;
  /** Probability this design detects `targetEffect` if it is real. */
  powerForTargetEffect: number;
  desiredPower: number;
  /**
   * Smallest lift detectable at `desiredPower` with the readers in hand.
   * `null` means not even a tripling would be reliably detected.
   */
  minimumDetectableEffect: number | null;
  /**
   * Readers per arm needed to detect `targetEffect` at `desiredPower`.
   * `null` means more than the largest size searched (1600 per arm).
   */
  readersNeededForTargetEffect: number | null;
};

export type ComparisonResult = {
  metric: string;
  design: ComparisonDesign;
  analysisUnit: AnalysisUnit;
  estimator: string;

  effect: number;
  effectKind: EffectKind;
  ci: [number, number];
  confidence: number;

  /** Control and variant central values, for reporting alongside the effect. */
  controlValue: number;
  variantValue: number;

  readers: number;
  controlReaders: number;
  variantReaders: number;
  sessions: number;
  /** Raw denominator behind the metric, for readers who want the counts. */
  denominator: number;

  status: ComparisonStatus;
  minimumReaders: number;
  /** Present only when a p-value-shaped quantity was computed. */
  pValue?: number;
  power?: PowerEstimate;
  /** Every per-reader value, so a small sample can simply be read. */
  perReaderValues?: { control: number[]; variant: number[] };
};

export type ComparisonOptions = {
  metric: string;
  /** Below this, the result is `insufficient_data` and carries no estimate. */
  minimumReaders?: number;
  confidence?: number;
  bootstrapSamples?: number;
  permutationSamples?: number;
  /** True when a lower value is the better outcome, e.g. skip rate. */
  lowerIsBetter?: boolean;
  /** Deterministic seed. Every estimate in this system is reproducible. */
  seed?: number;
  /** Print every per-reader value at or below this sample size. */
  showValuesAtOrBelow?: number;
  /** Relative lift worth acting on, used for the power readout. */
  targetEffect?: number;
  /**
   * How much of the power readout to simulate. `full` is the default;
   * `detectable-effect` skips the arm-size search (the expensive part) and is
   * what a replay over many prefixes uses; `none` skips simulation entirely.
   */
  power?: "full" | "detectable-effect" | "none";
  /** Simulation trials per power estimate. */
  powerTrials?: number;
};
