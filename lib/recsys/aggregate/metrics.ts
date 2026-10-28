import type {
  ReaderMetricDefinition,
  ReaderMetricId,
  ReaderTotals,
} from "@/lib/recsys/aggregate/types";
import type { UiLanguage } from "@/lib/i18n/ui-language";

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

function rate([numerator, denominator]: RateParts) {
  if (denominator < MINIMUM_RATE_DENOMINATOR) return null;
  return numerator / denominator;
}

/** Numerator and denominator of a rate, before any division. */
export type RateParts = readonly [numerator: number, denominator: number];

type RateCounters = Pick<ReaderTotals, "starts" | "completes" | "skips" | "reactions">;

/**
 * The one definition of each behavioural rate.
 *
 * Every rate in the system - a reader's value here, the lab's pooled arm
 * figures, the ranking features in `signals.ts` - divides the same parts, so a
 * number on one screen means what it means on every other. Before 2026-10-05
 * skip rate had four definitions and could exceed 100%.
 *
 * Skips are not a subset of starts: `start` fires a few seconds after a boks
 * arrives, and most skips happen before it does. So skip rate is over every
 * boks that reached a verdict either way, `starts + skips`, and stays a share.
 */
export const RATE_PARTS = {
  completion: (totals: RateCounters): RateParts => [totals.completes, totals.starts],
  skip: (totals: RateCounters): RateParts => [totals.skips, totals.starts + totals.skips],
  reaction: (totals: RateCounters): RateParts => [totals.reactions, totals.starts],
};

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
    value: (totals) => rate(RATE_PARTS.completion(totals)),
  },
  skip_rate: {
    id: "skip_rate",
    label: "Skip rate",
    unit: "rate",
    lowerIsBetter: true,
    value: (totals) => rate(RATE_PARTS.skip(totals)),
  },
  reaction_rate: {
    id: "reaction_rate",
    label: "Reaction rate",
    unit: "rate",
    lowerIsBetter: false,
    value: (totals) => rate(RATE_PARTS.reaction(totals)),
  },
};

/** The labels in Russian, for the admin console. The catalogue above stays English for tests and exports. */
const russianLabels: Record<ReaderMetricId, string> = {
  active_seconds: "Секунды активного чтения",
  seconds_per_session: "Активные секунды за сессию",
  boks_opened: "Открыто разных боков",
  sessions: "Сессии чтения",
  days_active: "Активные дни",
  completion_rate: "Доля дочитываний",
  skip_rate: "Доля пропусков",
  reaction_rate: "Доля реакций",
};

/** Seconds and percentage points in each language. */
const units: Record<UiLanguage, { seconds: string; points: string }> = {
  en: { seconds: "s", points: " pp" },
  ru: { seconds: " с", points: " п.п." },
};

export function readerMetric(id: ReaderMetricId, language: UiLanguage = "en"): ReaderMetricDefinition {
  const definition = READER_METRICS[id];
  if (!definition) throw new Error(`Unknown reader metric: ${id}`);
  return language === "en" ? definition : { ...definition, label: russianLabels[id] };
}

export function formatReaderValue(id: ReaderMetricId, value: number, language: UiLanguage = "en") {
  const definition = readerMetric(id);
  if (definition.unit === "rate") return `${Math.round(value * 1000) / 10}%`;
  if (definition.unit === "seconds") return `${Math.round(value)}${units[language].seconds}`;
  return `${Math.round(value * 100) / 100}`;
}

/**
 * A difference between two arms on this metric, in the metric's own unit.
 *
 * A rate difference is in percentage points, never "%": "+5%" next to a 40%
 * bar reads as a relative change, and it is not one.
 */
export function formatReaderDifference(id: ReaderMetricId, value: number, language: UiLanguage = "en") {
  const definition = readerMetric(id);
  const sign = value > 0 ? "+" : "";
  if (definition.unit === "rate") return `${sign}${Math.round(value * 1000) / 10}${units[language].points}`;
  if (definition.unit === "seconds") return `${sign}${Math.round(value)}${units[language].seconds}`;
  return `${sign}${Math.round(value * 100) / 100}`;
}

export type { ReaderTotals };
