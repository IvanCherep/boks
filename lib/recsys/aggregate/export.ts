import type { ReaderOutcomeRow } from "@/lib/recsys/aggregate/types";

/**
 * The analysis unit, as a file someone else can check.
 *
 * A comparison nobody can recompute from the rows is a claim, not a result.
 * The console's JSON export carries the conclusions; this carries the
 * observations they were computed from, so the same intervals can be produced
 * in R or Python without going through this code at all. That is the whole
 * point: the statistics should be reproducible by someone who distrusts them.
 *
 * Reader ids are replaced by a stable pseudonym. The account id is not needed
 * to re-run a reader-level comparison - only the grouping is - and a file that
 * travels to a supervisor or an appendix should not carry account identifiers.
 * The pseudonym is stable within one export, so the same reader's rows still
 * group together; it is not stable across exports, so two files cannot be
 * joined to re-identify anyone.
 */

const columns = [
  "reader",
  "algorithm",
  "day",
  "cohort_week",
  "tenure_days",
  "impressions",
  "starts",
  "completes",
  "skips",
  "likes",
  "shares",
  "comments",
  "boks_opened",
  "sessions",
  "active_seconds",
  "attributed_events",
  "total_events",
] as const;

function escapeCsv(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * `readerLabel` assigns pseudonyms in the order readers first appear, so the
 * file reads r001, r002 … rather than carrying UUIDs.
 */
export function readerOutcomesToCsv(rows: ReaderOutcomeRow[]) {
  const pseudonyms = new Map<string, string>();
  const readerLabel = (userId: string) => {
    const existing = pseudonyms.get(userId);
    if (existing) return existing;
    const label = `r${String(pseudonyms.size + 1).padStart(3, "0")}`;
    pseudonyms.set(userId, label);
    return label;
  };

  const lines = [columns.join(",")];

  for (const row of rows) {
    lines.push(
      [
        readerLabel(row.userId),
        row.algorithmId,
        row.day,
        row.cohortWeek,
        row.tenureDays,
        row.impressions,
        row.starts,
        row.completes,
        row.skips,
        row.likes,
        row.shares,
        row.comments,
        row.boksOpened,
        row.sessions,
        row.activeSeconds,
        row.attributedEvents,
        row.totalEvents,
      ]
        .map(escapeCsv)
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}

/** What the file is, so it is still interpretable a year later. */
export function readerOutcomesReadme(input: {
  windowDays: number;
  experimentKey: string;
  controlAlgorithmId: string;
  rows: number;
  readers: number;
}) {
  return [
    "boks reader outcomes",
    "",
    `Exported ${new Date().toISOString()}`,
    `Window: the last ${input.windowDays} days`,
    `Experiment: ${input.experimentKey}, control arm ${input.controlAlgorithmId}`,
    `Rows: ${input.rows}, one per (reader, algorithm, day)`,
    `Readers: ${input.readers}, pseudonymised as r001… in order of first appearance`,
    "",
    "The analysis unit is the reader, not the event: events within one reader are",
    "correlated, so a test over events reports significance that is not there.",
    "To reproduce a comparison, total each reader's rows over the window, take one",
    "value per reader, and compare the two arms' reader-level values. Readers with",
    "rows under more than one algorithm must be dropped from an independent",
    "comparison - their behaviour under one arm contaminates the other.",
    "",
    "active_seconds counts only seconds a boks was on screen and in the foreground,",
    "accumulated per (session, boks) and rolled up with max() rather than sum(), so",
    "a repeated heartbeat cannot inflate it.",
    "",
    "tenure_days is the days between the reader's first ever read and the day of the",
    "row. cohort_week is the Monday of the week they were first seen, over their",
    "whole history rather than this window.",
  ].join("\n");
}
