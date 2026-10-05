import { buildSampleSizeCurve, type SampleSizeCurve } from "@/lib/recsys/statistics/sample-size";
import { controlAlgorithmId, recommendationAlgorithmName } from "@/lib/boks/recommendations/registry";
import {
  compareAlgorithms,
  collapseToReaders,
  RATE_PARTS,
  type RateParts,
  totalsByReaderAndAlgorithm,
  type AlgorithmComparison,
  type ReaderMetricId,
  type ReaderOutcomeRow,
} from "@/lib/recsys/aggregate";
import { median } from "@/lib/recsys/statistics";

/**
 * The recommendation lab report, built from reader rows.
 *
 * The analysis unit is the reader, everywhere and without exception. The
 * implementation this replaces counted impressions: events from one reader are
 * correlated, so a hundred impressions from three readers was reported as a
 * sample of a hundred, and a coarse two-proportion z score turned that into the
 * word "strong". Nothing in this file computes a rate over events and calls it
 * evidence.
 *
 * Also gone, deliberately:
 *
 *  - `engagementScore` — five invented constants that decided what the founder
 *    saw first, and could never be wrong
 *  - `paceIndex` — `minutes` (itself derived, then clamped) over wall-clock time
 *  - `avgSecondsToLike` / `avgSecondsToComment` / `avgStartRank` — never read
 *  - `segmentRows` — segments were a hash of the visitor id, not reader types
 *  - `timeline` — daily rates at a dozen readers per arm
 *  - `proportionConfidence` / `findLeaders` — a verdict from pseudo-replication
 */

/** Metrics the lab compares by default. Time first: it is the north star. */
export const LAB_COMPARISON_METRICS: ReaderMetricId[] = [
  "active_seconds",
  "boks_opened",
  "completion_rate",
  "skip_rate",
];

export type ArmSummary = {
  algorithmId: string;
  algorithmName: string;
  isControl: boolean;
  /** Readers in this arm after crossed readers are removed. */
  readers: number;
  sessions: number;
  activeSeconds: number;
  boksOpened: number;
  /** Median rather than mean: reading time is strongly right-skewed. */
  medianActiveSeconds: number;
  medianBoksOpened: number;
  /**
   * Pooled rates, for description only. They are not the basis of any verdict:
   * a pooled rate weights a reader by how much they read.
   */
  completionRate: number;
  skipRate: number;
  reactionRate: number;
  impressions: number;
  starts: number;
  completes: number;
  skips: number;
  reactions: number;
  readiness: { readers: number; required: number; ready: boolean };
};

export type RecommendationLabReport = {
  controlAlgorithmId: string;
  windowDays: number;
  /** Stated in the report, not implied by the numbers. */
  analysisUnit: "reader";
  minimumReadersPerArm: number;
  totals: {
    readers: number;
    /** Readers excluded for producing events under more than one algorithm. */
    crossedReaders: number;
    sessions: number;
    activeSeconds: number;
    events: number;
    /** Events carrying a served-feed id, i.e. reconstructible ones. */
    attributedEvents: number;
  };
  arms: ArmSummary[];
  /** One comparison per metric, each variant arm against the control. */
  comparisons: AlgorithmComparison[];
  /**
   * How the headline comparison behaved as readers accumulated, and what a
   * larger sample would buy. Null until there is a control and a variant.
   */
  sampleSize: SampleSizeCurve | null;
  /**
   * The headline comparison for readers in their first week and for everyone
   * older. Descriptive - each group holds roughly half the readers.
   */
  cohorts: LabCohort[];
};

export type LabCohort = {
  id: "new" | "returning";
  label: string;
  readers: number;
  comparison: AlgorithmComparison | null;
};

export type LabOptions = {
  controlAlgorithmId: string;
  minimumReadersPerArm: number;
  windowDays: number;
  metrics?: ReaderMetricId[];
  /** Resamples per estimate. Lowered in the console; raised for a thesis run. */
  resamples?: number;
  seed?: number;
};

export function buildRecommendationLab(
  rows: ReaderOutcomeRow[],
  options: LabOptions
): RecommendationLabReport {
  const totals = totalsByReaderAndAlgorithm(rows);
  const readerSeries = collapseToReaders(rows, "active_seconds");
  // Crossed readers are out of every arm, in the summaries as in the
  // comparisons: an arm's sessions and rates describe the readers it counts.
  const crossed = new Set(readerSeries.crossedReaders);
  const armTotals = totals.filter((entry) => !crossed.has(entry.userId));
  const arms = summariseArms(armTotals, readerSeries.valuesByAlgorithm, options);

  const variants = arms.filter((arm) => !arm.isControl).map((arm) => arm.algorithmId);
  const metrics = options.metrics ?? LAB_COMPARISON_METRICS;

  const comparisons = arms.some((arm) => arm.isControl)
    ? variants.flatMap((variantAlgorithmId) =>
        metrics.map((metric) =>
          compareAlgorithms(rows, {
            controlAlgorithmId: options.controlAlgorithmId,
            variantAlgorithmId,
            metric,
            minimumReaders: options.minimumReadersPerArm,
            resamples: options.resamples,
            seed: options.seed,
          })
        )
      )
    : [];

  /**
   * How the headline comparison behaves as readers accumulate, and what a
   * larger sample would buy. Built on the north-star metric only: it replays
   * the estimator over prefixes of the data, which is the expensive part, and
   * doing it for every metric would multiply that by six for no extra
   * decision.
   */
  const headline = comparisons.find((entry) => entry.metricId === "active_seconds");
  const sampleSize =
    headline && variants.length
      ? buildSampleSizeCurve(
          readerSeries.valuesByAlgorithm[options.controlAlgorithmId] ?? [],
          readerSeries.valuesByAlgorithm[variants[0]] ?? [],
          {
            metric: headline.metric,
            lowerIsBetter: false,
            minimumReaders: options.minimumReadersPerArm,
            bootstrapSamples: options.resamples,
            permutationSamples: options.resamples,
            seed: options.seed,
          }
        )
      : null;

  /**
   * The same comparison for readers in their first week and for everyone
   * older. Descriptive: a split halves each arm, so this answers "is the
   * effect plausibly different for new readers" and never "it is".
   */
  const newReaders = readersInFirstWeek(totals);
  const cohorts = variants.length
    ? [
        { id: "new" as const, label: "First week", rows: rows.filter((row) => newReaders.has(row.userId)) },
        {
          id: "returning" as const,
          label: "Beyond a week",
          rows: rows.filter((row) => !newReaders.has(row.userId)),
        },
      ].map((group) => {
        const comparison = arms.some((arm) => arm.isControl)
          ? compareAlgorithms(group.rows, {
              controlAlgorithmId: options.controlAlgorithmId,
              variantAlgorithmId: variants[0],
              metric: "active_seconds",
              minimumReaders: options.minimumReadersPerArm,
              resamples: options.resamples,
              seed: options.seed,
            })
          : null;
        return {
          id: group.id,
          label: group.label,
          readers: new Set(group.rows.map((row) => row.userId)).size,
          comparison,
        };
      })
    : [];

  return {
    controlAlgorithmId: options.controlAlgorithmId,
    windowDays: options.windowDays,
    analysisUnit: "reader",
    minimumReadersPerArm: options.minimumReadersPerArm,
    totals: {
      readers: readerSeries.totalReaders,
      crossedReaders: readerSeries.crossedReaders.length,
      sessions: sumBy(armTotals, (entry) => entry.sessions),
      activeSeconds: sumBy(armTotals, (entry) => entry.activeSeconds),
      events: sumBy(totals, (entry) => entry.totalEvents),
      attributedEvents: sumBy(totals, (entry) => entry.attributedEvents),
    },
    arms,
    comparisons,
    sampleSize,
    cohorts,
  };
}

/**
 * Readers who were in their first week when the window first saw them.
 *
 * A reader is classified once, by their earliest row. Filtering rows by each
 * row's own tenure put a reader active on day 3 and day 10 into both cohorts,
 * each with part of their totals.
 */
function readersInFirstWeek(totals: ReturnType<typeof totalsByReaderAndAlgorithm>) {
  const earliest = new Map<string, number>();
  for (const entry of totals) {
    earliest.set(entry.userId, Math.min(earliest.get(entry.userId) ?? Infinity, entry.tenureDaysAtFirstRow));
  }
  return new Set([...earliest].filter(([, tenure]) => tenure <= 6).map(([userId]) => userId));
}

function summariseArms(
  totals: ReturnType<typeof totalsByReaderAndAlgorithm>,
  valuesByAlgorithm: Record<string, number[]>,
  options: LabOptions
): ArmSummary[] {
  const byAlgorithm = new Map<string, typeof totals>();
  for (const entry of totals) {
    byAlgorithm.set(entry.algorithmId, [...(byAlgorithm.get(entry.algorithmId) ?? []), entry]);
  }

  const arms = [...byAlgorithm.entries()].map(([algorithmId, entries]): ArmSummary => {
    // Readers counted here are the ones a comparison would actually use, so the
    // sample size on screen is the sample size behind the interval.
    const readerValues = valuesByAlgorithm[algorithmId] ?? [];
    const starts = sumBy(entries, (entry) => entry.starts);
    const reactions = sumBy(entries, (entry) => entry.reactions);
    const pooled = {
      starts,
      completes: sumBy(entries, (entry) => entry.completes),
      skips: sumBy(entries, (entry) => entry.skips),
      reactions,
    };

    return {
      algorithmId,
      algorithmName: recommendationAlgorithmName(algorithmId),
      isControl: algorithmId === options.controlAlgorithmId,
      readers: readerValues.length,
      sessions: sumBy(entries, (entry) => entry.sessions),
      activeSeconds: sumBy(entries, (entry) => entry.activeSeconds),
      boksOpened: sumBy(entries, (entry) => entry.boksOpened),
      medianActiveSeconds: round(median(readerValues), 0),
      medianBoksOpened: round(median(entries.map((entry) => entry.boksOpened)), 1),
      completionRate: percent(RATE_PARTS.completion(pooled)),
      skipRate: percent(RATE_PARTS.skip(pooled)),
      reactionRate: percent(RATE_PARTS.reaction(pooled)),
      impressions: sumBy(entries, (entry) => entry.impressions),
      starts,
      completes: pooled.completes,
      skips: pooled.skips,
      reactions,
      readiness: {
        readers: readerValues.length,
        required: options.minimumReadersPerArm,
        ready: readerValues.length >= options.minimumReadersPerArm,
      },
    };
  });

  // Control first, then by reader count. Deliberately not by any score: an
  // invented composite deciding what the founder reads first is how a ranking
  // gets believed without ever being questioned.
  return arms.sort((left, right) => {
    if (left.isControl !== right.isControl) return left.isControl ? -1 : 1;
    return right.readers - left.readers;
  });
}

/** The comparison for one arm on one metric, or undefined if not computed. */
export function findComparison(
  report: RecommendationLabReport,
  variantAlgorithmId: string,
  metric: ReaderMetricId
) {
  return report.comparisons.find(
    (comparison) =>
      comparison.variantAlgorithmId === variantAlgorithmId && comparison.metricId === metric
  );
}

function sumBy<Row>(rows: Row[], value: (row: Row) => number) {
  return rows.reduce((total, row) => total + value(row), 0);
}

function percent([part, whole]: RateParts) {
  if (!whole || whole <= 0) return 0;
  return round((part / whole) * 100, 1);
}

function round(value: number, digits = 0) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const emptyRecommendationLab: RecommendationLabReport = {
  controlAlgorithmId,
  windowDays: 30,
  analysisUnit: "reader",
  minimumReadersPerArm: 10,
  totals: {
    readers: 0,
    crossedReaders: 0,
    sessions: 0,
    activeSeconds: 0,
    events: 0,
    attributedEvents: 0,
  },
  arms: [],
  comparisons: [],
  sampleSize: null,
  cohorts: [],
};
