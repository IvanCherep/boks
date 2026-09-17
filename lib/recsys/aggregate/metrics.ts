import type {
  ReaderMetricDefinition,
  ReaderMetricId,
  ReaderTotals,
} from "@/lib/recsys/aggregate/types";

/**
 * The reader-level metric catalogue.
 *
 * Every entry answers one question about one reader over one window. There are
 * no composite scores here: the previous implementation had three different
 * invented weighted sums presented as measurements, and none of them could be
 * falsified. A metric that cannot be wrong cannot be informative.
 */

/**
 * A rate needs a denominator worth dividing by. Two starts producing one
 * completion is 50%, and means nothing.
 */
const MINIMUM_RATE_DENOMINATOR = 5;

function rate(numerator: number, denominator: number) {
  if (denominator < MINIMUM_RATE_DENOMINATOR) return null;
  return numerator / denominator;
}

export const READER_METRICS: Record<ReaderMetricId, ReaderMetricDefinition> = {
  active_seconds: {
    id: "active_seconds",
    label: "Active reading seconds",
    unit: "seconds",
    lowerIsBetter: false,
    // The north star. Foreground-only, cumulative, deduplicated by max().
    value: (totals) => totals.activeSeconds,
  },
  seconds_per_session: {
    id: "seconds_per_session",
    label: "Active seconds per session",
    unit: "seconds",
    lowerIsBetter: false,
    value: (totals) => (totals.sessions ? totals.activeSeconds / totals.sessions : null),
  },
  boks_opened: {
    id: "boks_opened",
    label: "Distinct boks opened",
    unit: "count",
    lowerIsBetter: false,
    value: (totals) => totals.boksOpened,
  },
  sessions: {
    id: "sessions",
    label: "Reading sessions",
    unit: "count",
    lowerIsBetter: false,
    value: (totals) => totals.sessions,
  },
  days_active: {
    id: "days_active",
    label: "Days active",
    unit: "count",
    lowerIsBetter: false,
    value: (totals) => totals.daysActive,
  },
  completion_rate: {
    id: "completion_rate",
    label: "Completion rate",
    unit: "rate",
    lowerIsBetter: false,
    value: (totals) => rate(totals.completes, totals.starts),
  },
  skip_rate: {
    id: "skip_rate",
    label: "Skip rate",
    unit: "rate",
    lowerIsBetter: true,
    value: (totals) => rate(totals.skips, totals.starts),
  },
  reaction_rate: {
    id: "reaction_rate",
    label: "Reaction rate",
    unit: "rate",
    lowerIsBetter: false,
    value: (totals) => rate(totals.reactions, totals.starts),
  },
};

export const READER_METRIC_IDS = Object.keys(READER_METRICS) as ReaderMetricId[];

export function readerMetric(id: ReaderMetricId): ReaderMetricDefinition {
  const definition = READER_METRICS[id];
  if (!definition) throw new Error(`Unknown reader metric: ${id}`);
  return definition;
}

export function formatReaderValue(id: ReaderMetricId, value: number) {
  const definition = readerMetric(id);
  if (definition.unit === "rate") return `${Math.round(value * 1000) / 10}%`;
  if (definition.unit === "seconds") return `${Math.round(value)}s`;
  return `${Math.round(value * 100) / 100}`;
}

export type { ReaderTotals };
