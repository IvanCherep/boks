import { collapseToReaders, sessionsForReaders } from "@/lib/recsys/aggregate/readers";
import { readerMetric } from "@/lib/recsys/aggregate/metrics";
import { compareIndependent } from "@/lib/recsys/statistics/compare";
import type { ReaderMetricId, ReaderOutcomeRow } from "@/lib/recsys/aggregate/types";
import type { ComparisonResult } from "@/lib/recsys/statistics/types";

/**
 * The seam the admin console calls: reader-outcome rows in, a comparison out.
 *
 * Holding aggregation and inference behind one function is deliberate. The two
 * defects this replaces — counting impressions as independent samples, and
 * reading a confidence label off a proportion test — were both possible because
 * callers assembled their own numbers before testing them.
 */

export type AlgorithmComparison = ComparisonResult & {
  /**
   * The metric's id, alongside the human label `metric` carries. Callers look
   * comparisons up by this: matching on a display string means renaming a label
   * silently breaks the lookup.
   */
  metricId: ReaderMetricId;
  controlAlgorithmId: string;
  variantAlgorithmId: string;
  /** Readers dropped for producing events under both algorithms. */
  crossedReaders: number;
  /** Readers dropped for having no denominator for this metric. */
  readersWithoutDenominator: number;
};

export type CompareAlgorithmsOptions = {
  controlAlgorithmId: string;
  variantAlgorithmId: string;
  metric: ReaderMetricId;
  minimumReaders?: number;
  /** Relative lift worth acting on, used for the power readout. */
  targetEffect?: number;
  /** Resamples per estimate. Lower in a console, higher for a thesis run. */
  resamples?: number;
  seed?: number;
};

export function compareAlgorithms(
  rows: ReaderOutcomeRow[],
  options: CompareAlgorithmsOptions
): AlgorithmComparison {
  const definition = readerMetric(options.metric);
  const series = collapseToReaders(rows, options.metric);

  const control = series.valuesByAlgorithm[options.controlAlgorithmId] ?? [];
  const variant = series.valuesByAlgorithm[options.variantAlgorithmId] ?? [];
  const controlIds = series.readersByAlgorithm[options.controlAlgorithmId] ?? [];
  const variantIds = series.readersByAlgorithm[options.variantAlgorithmId] ?? [];

  const result = compareIndependent(control, variant, {
    metric: definition.label,
    lowerIsBetter: definition.lowerIsBetter,
    minimumReaders: options.minimumReaders,
    targetEffect: options.targetEffect,
    bootstrapSamples: options.resamples,
    permutationSamples: options.resamples,
    seed: options.seed,
  });

  return {
    ...result,
    metricId: options.metric,
    sessions:
      sessionsForReaders(rows, options.controlAlgorithmId, controlIds) +
      sessionsForReaders(rows, options.variantAlgorithmId, variantIds),
    controlAlgorithmId: options.controlAlgorithmId,
    variantAlgorithmId: options.variantAlgorithmId,
    crossedReaders: series.crossedReaders.length,
    readersWithoutDenominator: series.readersWithoutDenominator,
  };
}
