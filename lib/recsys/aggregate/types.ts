/**
 * One row per (reader, algorithm, day), exactly as `get_reader_outcomes`
 * returns it. The database counts; it never divides and it never infers.
 */
export type ReaderOutcomeRow = {
  userId: string;
  algorithmId: string;
  /** ISO date, `YYYY-MM-DD`. */
  day: string;
  /**
   * Monday of the week this reader was first seen, over their whole history
   * rather than the window. A property of the reader, so it groups rows across
   * days without the grouping drifting.
   */
  cohortWeek: string;
  /** Days between that first sighting and this row's day. Zero on day one. */
  tenureDays: number;
  impressions: number;
  starts: number;
  completes: number;
  skips: number;
  likes: number;
  shares: number;
  comments: number;
  boksOpened: number;
  sessions: number;
  activeSeconds: number;
  attributedEvents: number;
  totalEvents: number;
};

/** Everything one reader did under one algorithm, over the whole window. */
export type ReaderTotals = {
  userId: string;
  algorithmId: string;
  daysActive: number;
  firstDay: string;
  lastDay: string;
  cohortWeek: string;
  /** Smallest tenure among this reader's rows: how new they were when measured. */
  tenureDaysAtFirstRow: number;
  impressions: number;
  starts: number;
  completes: number;
  skips: number;
  reactions: number;
  boksOpened: number;
  sessions: number;
  activeSeconds: number;
  attributedEvents: number;
  totalEvents: number;
};

export type ReaderMetricId =
  | "active_seconds"
  | "seconds_per_session"
  | "boks_opened"
  | "sessions"
  | "days_active"
  | "completion_rate"
  | "skip_rate"
  | "reaction_rate";

export type ReaderMetricDefinition = {
  id: ReaderMetricId;
  label: string;
  unit: "seconds" | "count" | "rate";
  /** True when a smaller number is the better outcome. */
  lowerIsBetter: boolean;
  /**
   * The reader's value for this metric, or `null` when the reader has no
   * denominator for it. A rate over two starts is noise wearing a percentage
   * sign; excluding it is more honest than averaging it in.
   */
  value: (totals: ReaderTotals) => number | null;
};

/**
 * Reader-level values for one metric, grouped by algorithm.
 *
 * `crossedReaders` is the part that matters scientifically: a reader who
 * produced events under two algorithms cannot be counted in either arm of an
 * independent comparison, because their behaviour under one contaminates the
 * other. They are removed and named, never silently folded in.
 */
export type ReaderSeries = {
  metric: ReaderMetricId;
  label: string;
  lowerIsBetter: boolean;
  valuesByAlgorithm: Record<string, number[]>;
  readersByAlgorithm: Record<string, string[]>;
  crossedReaders: string[];
  /** Readers dropped for having no denominator for this metric. */
  readersWithoutDenominator: number;
  totalReaders: number;
};
