import { createRandom, randomInt, shuffle } from "@/lib/recsys/statistics/random";
import { mean, quantile } from "@/lib/recsys/statistics/descriptive";
import { estimatePower } from "@/lib/recsys/statistics/power";
import type {
  ComparisonOptions,
  ComparisonResult,
  ComparisonStatus,
} from "@/lib/recsys/statistics/types";

/**
 * Reader-level comparison of two arms.
 *
 * The analysis unit is one value per reader. That is the whole point: events
 * from one reader are correlated, so an estimator fed 100 impressions from 3
 * readers is answering a question nobody asked.
 *
 * One estimand throughout: the difference in reader means, variant minus
 * control. The effect, its interval, the p-value and the power readout all
 * describe that same quantity:
 *
 *  - the effect is the observed difference in means;
 *  - a percentile bootstrap interval of that difference, which is informative
 *    but undercovers on strongly skewed data below roughly 30 per arm;
 *  - a permutation test on the arm labels with the same statistic, exact under
 *    the null by construction;
 *  - power simulated with Welch's t on means (`power.ts`).
 *
 * Until 2026-10-05 the effect was a Hodges-Lehmann shift while the interval
 * and the test were on means, so a variant whose whole interval lay above zero
 * could be printed as "negative". A robust estimand is still the right idea
 * for skewed reading time, but only if the interval and the test follow it;
 * bootstrapping an O(n*m) estimator in the admin's browser does not scale, and
 * at small samples every per-reader value is printed anyway.
 */

/**
 * Explicit `undefined` must not override a default.
 *
 * `{...defaults, ...options}` happily writes `undefined` over `minimumReaders`,
 * which disables the insufficient-data guard for any caller that forwards an
 * optional field. That is a silent removal of the one check standing between a
 * three-reader sample and a printed verdict.
 */
function settingsFor(options: ComparisonOptions) {
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged as typeof defaults & ComparisonOptions;
}

const defaults = {
  minimumReaders: 10,
  confidence: 0.95,
  bootstrapSamples: 2000,
  permutationSamples: 2000,
  seed: 42,
  showValuesAtOrBelow: 25,
  targetEffect: 0.3,
  power: "full" as "full" | "detectable-effect" | "none",
};

export function compareIndependent(
  controlValues: number[],
  variantValues: number[],
  options: ComparisonOptions
): ComparisonResult {
  const settings = settingsFor(options);
  const controlReaders = controlValues.length;
  const variantReaders = variantValues.length;
  const readers = controlReaders + variantReaders;

  const base = {
    metric: settings.metric,
    design: "independent" as const,
    analysisUnit: "reader" as const,
    estimator: "difference in means, percentile bootstrap CI, permutation test",
    effectKind: "absolute" as const,
    confidence: settings.confidence,
    controlValue: mean(controlValues),
    variantValue: mean(variantValues),
    readers,
    controlReaders,
    variantReaders,
    sessions: 0,
    denominator: readers,
    minimumReaders: settings.minimumReaders,
  };

  if (controlReaders < settings.minimumReaders || variantReaders < settings.minimumReaders) {
    return {
      ...base,
      effect: 0,
      ci: [0, 0],
      status: "insufficient_data",
      perReaderValues: { control: controlValues, variant: variantValues },
    };
  }

  const effect = mean(variantValues) - mean(controlValues);
  const ci = bootstrapDifferenceCi(controlValues, variantValues, settings);
  const pValue = permutationTest(controlValues, variantValues, settings);

  return {
    ...base,
    effect: round(effect, 4),
    ci,
    status: statusFor(ci, effect, settings.lowerIsBetter ?? false),
    pValue: roundProbability(pValue),
    power:
      settings.power === "none"
        ? undefined
        : estimatePower({
            controlValues,
            variantValues,
            targetEffect: settings.targetEffect,
            confidence: settings.confidence,
            seed: settings.seed,
            trials: settings.powerTrials,
            searchReadersNeeded: settings.power !== "detectable-effect",
          }),
    perReaderValues:
      readers <= settings.showValuesAtOrBelow
        ? { control: controlValues, variant: variantValues }
        : undefined,
  };
}

/**
 * Paired comparison: the same reader contributes both values.
 *
 * Used for interleaving and for before/after on a migrated arm. Removes
 * between-reader variance, which dominates reading time, and is the only design
 * with usable power at a few dozen readers.
 */
export function comparePaired(
  pairs: { control: number; variant: number }[],
  options: ComparisonOptions
): ComparisonResult {
  const settings = settingsFor(options);
  const readers = pairs.length;
  const differences = pairs.map((pair) => pair.variant - pair.control);

  const base = {
    metric: settings.metric,
    design: "paired" as const,
    analysisUnit: "reader" as const,
    estimator: "mean paired difference, paired bootstrap CI, sign test",
    effectKind: "absolute" as const,
    confidence: settings.confidence,
    controlValue: mean(pairs.map((pair) => pair.control)),
    variantValue: mean(pairs.map((pair) => pair.variant)),
    readers,
    controlReaders: readers,
    variantReaders: readers,
    sessions: 0,
    denominator: readers,
    minimumReaders: settings.minimumReaders,
  };

  if (readers < settings.minimumReaders) {
    return {
      ...base,
      effect: 0,
      ci: [0, 0],
      status: "insufficient_data",
      perReaderValues: {
        control: pairs.map((pair) => pair.control),
        variant: pairs.map((pair) => pair.variant),
      },
    };
  }

  const effect = mean(differences);
  const ci = bootstrapPairedCi(differences, settings);

  return {
    ...base,
    effect: round(effect, 4),
    ci,
    status: statusFor(ci, effect, settings.lowerIsBetter ?? false),
    pValue: roundProbability(signTest(differences)),
    perReaderValues:
      readers <= settings.showValuesAtOrBelow
        ? {
            control: pairs.map((pair) => pair.control),
            variant: pairs.map((pair) => pair.variant),
          }
        : undefined,
  };
}

/** Percentile bootstrap over readers, resampling each arm independently. */
function bootstrapDifferenceCi(
  control: number[],
  variant: number[],
  settings: typeof defaults & ComparisonOptions
): [number, number] {
  const next = createRandom(settings.seed);
  const differences: number[] = [];

  for (let sample = 0; sample < settings.bootstrapSamples; sample += 1) {
    differences.push(mean(resample(variant, next)) - mean(resample(control, next)));
  }

  differences.sort((left, right) => left - right);
  const alpha = (1 - settings.confidence) / 2;
  return [
    round(quantile(differences, alpha), 4),
    round(quantile(differences, 1 - alpha), 4),
  ];
}

/** Bootstrap over the per-reader differences, preserving the pairing. */
function bootstrapPairedCi(
  differences: number[],
  settings: typeof defaults & ComparisonOptions
): [number, number] {
  const next = createRandom(settings.seed);
  const means: number[] = [];

  for (let sample = 0; sample < settings.bootstrapSamples; sample += 1) {
    means.push(mean(resample(differences, next)));
  }

  means.sort((left, right) => left - right);
  const alpha = (1 - settings.confidence) / 2;
  return [round(quantile(means, alpha), 4), round(quantile(means, 1 - alpha), 4)];
}

/**
 * Two-sided permutation test on the arm labels. Exact under the null by
 * construction, so unlike a bootstrap interval it cannot quietly undercover on
 * a small skewed sample.
 */
function permutationTest(
  control: number[],
  variant: number[],
  settings: typeof defaults & ComparisonOptions
) {
  const observed = Math.abs(mean(variant) - mean(control));
  const pooled = [...control, ...variant];
  const next = createRandom(settings.seed + 1);
  let atLeastAsExtreme = 0;

  for (let sample = 0; sample < settings.permutationSamples; sample += 1) {
    const shuffled = shuffle([...pooled], next);
    const permutedControl = shuffled.slice(0, control.length);
    const permutedVariant = shuffled.slice(control.length);
    if (Math.abs(mean(permutedVariant) - mean(permutedControl)) >= observed) atLeastAsExtreme += 1;
  }

  // +1 in both places so the estimate can never be exactly zero, which would
  // claim more certainty than a finite number of permutations can support.
  return (atLeastAsExtreme + 1) / (settings.permutationSamples + 1);
}

/** Exact two-sided sign test. Distribution-free companion for paired designs. */
export function signTest(differences: number[]) {
  const positive = differences.filter((value) => value > 0).length;
  const negative = differences.filter((value) => value < 0).length;
  const decided = positive + negative;
  if (!decided) return 1;

  // Summed in log space: `2 ** n` and the binomial coefficients overflow to
  // Infinity above roughly a thousand readers, which turned the p-value NaN.
  const extreme = Math.max(positive, negative);
  let probability = 0;
  for (let k = extreme; k <= decided; k += 1) {
    probability += Math.exp(logBinomial(decided, k) - decided * Math.LN2);
  }
  return Math.min(1, 2 * probability);
}

function logBinomial(n: number, k: number) {
  let result = 0;
  for (let index = 1; index <= k; index += 1) result += Math.log(n - k + index) - Math.log(index);
  return result;
}

function resample(values: number[], next: () => number) {
  const sample: number[] = new Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    sample[index] = values[randomInt(next, values.length)];
  }
  return sample;
}

/**
 * An interval that spans zero is `inconclusive`, never "no difference". The
 * distinction is the whole reason this function exists.
 */
function statusFor(ci: [number, number], effect: number, lowerIsBetter: boolean): ComparisonStatus {
  const spansNull = ci[0] <= 0 && ci[1] >= 0;
  if (spansNull) return "inconclusive";
  const improved = lowerIsBetter ? effect < 0 : effect > 0;
  return improved ? "positive" : "negative";
}

/**
 * Probabilities round to significant digits, not decimal places.
 *
 * A paired sign test over twenty readers returns 1.9e-6; rounding that to four
 * decimals prints `0`, which claims certainty no test can deliver. Reporting a
 * p-value of exactly zero is the same error the permutation test guards against
 * with its +1 correction.
 */
function roundProbability(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const magnitude = Math.floor(Math.log10(value));
  const factor = 10 ** (2 - magnitude);
  return Math.round(value * factor) / factor;
}

function round(value: number, digits: number) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
