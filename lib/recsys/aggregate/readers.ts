import { readerMetric } from "@/lib/recsys/aggregate/metrics";
import type {
  ReaderMetricId,
  ReaderOutcomeRow,
  ReaderSeries,
  ReaderTotals,
} from "@/lib/recsys/aggregate/types";

/**
 * Event rows become reader rows here, and nowhere else.
 *
 * This is the module that makes the analysis unit the reader. Everything
 * downstream — comparisons, intervals, power — consumes its output, so there is
 * exactly one place where the choice of analysis unit can be got wrong.
 */

export function totalsByReaderAndAlgorithm(rows: ReaderOutcomeRow[]): ReaderTotals[] {
  const byKey = new Map<string, ReaderTotals>();

  for (const row of rows) {
    const key = `${row.userId}::${row.algorithmId}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        userId: row.userId,
        algorithmId: row.algorithmId,
        daysActive: 1,
        firstDay: row.day,
        lastDay: row.day,
        cohortWeek: row.cohortWeek,
        tenureDaysAtFirstRow: row.tenureDays,
        impressions: row.impressions,
        starts: row.starts,
        completes: row.completes,
        skips: row.skips,
        reactions: row.likes + row.shares + row.comments,
        boksOpened: row.boksOpened,
        sessions: row.sessions,
        activeSeconds: row.activeSeconds,
        attributedEvents: row.attributedEvents,
        totalEvents: row.totalEvents,
      });
      continue;
    }

    existing.daysActive += 1;
    existing.firstDay = row.day < existing.firstDay ? row.day : existing.firstDay;
    existing.lastDay = row.day > existing.lastDay ? row.day : existing.lastDay;
    existing.tenureDaysAtFirstRow = Math.min(existing.tenureDaysAtFirstRow, row.tenureDays);
    existing.impressions += row.impressions;
    existing.starts += row.starts;
    existing.completes += row.completes;
    existing.skips += row.skips;
    existing.reactions += row.likes + row.shares + row.comments;
    // Distinct boks are distinct per day, so this over-counts a reader who
    // reopens the same bok on two days. Named rather than hidden: the honest
    // fix is a distinct count in SQL, and it costs a column in the RPC.
    existing.boksOpened += row.boksOpened;
    existing.sessions += row.sessions;
    existing.activeSeconds += row.activeSeconds;
    existing.attributedEvents += row.attributedEvents;
    existing.totalEvents += row.totalEvents;
  }

  return [...byKey.values()];
}

/**
 * One value per reader per algorithm, with readers who appear under more than
 * one algorithm removed from every arm.
 *
 * Crossed readers are not a rare edge: before the assignment table was made
 * authoritative, the arm was recomputed on every page load, so a reader could
 * legitimately have events under two algorithms on the same day. Counting them
 * in both arms would make the arms look alike for a reason that has nothing to
 * do with the rankers.
 */
export function collapseToReaders(
  rows: ReaderOutcomeRow[],
  metric: ReaderMetricId
): ReaderSeries {
  const definition = readerMetric(metric);
  const totals = totalsByReaderAndAlgorithm(rows);

  const algorithmsByReader = new Map<string, Set<string>>();
  for (const entry of totals) {
    const seen = algorithmsByReader.get(entry.userId) ?? new Set<string>();
    seen.add(entry.algorithmId);
    algorithmsByReader.set(entry.userId, seen);
  }

  const crossedReaders = [...algorithmsByReader.entries()]
    .filter(([, algorithms]) => algorithms.size > 1)
    .map(([userId]) => userId)
    .sort();
  const crossed = new Set(crossedReaders);

  const valuesByAlgorithm: Record<string, number[]> = {};
  const readersByAlgorithm: Record<string, string[]> = {};
  let readersWithoutDenominator = 0;

  for (const entry of totals) {
    if (crossed.has(entry.userId)) continue;

    const value = definition.value(entry);
    if (value === null || !Number.isFinite(value)) {
      readersWithoutDenominator += 1;
      continue;
    }

    valuesByAlgorithm[entry.algorithmId] ??= [];
    readersByAlgorithm[entry.algorithmId] ??= [];
    valuesByAlgorithm[entry.algorithmId].push(value);
    readersByAlgorithm[entry.algorithmId].push(entry.userId);
  }

  return {
    metric,
    label: definition.label,
    lowerIsBetter: definition.lowerIsBetter,
    valuesByAlgorithm,
    readersByAlgorithm,
    crossedReaders,
    readersWithoutDenominator,
    totalReaders: algorithmsByReader.size,
  };
}

/**
 * Sessions behind an arm, counted over a named set of readers.
 *
 * The reader set is required rather than optional: reporting sessions from
 * readers the comparison excluded would describe a sample that was never
 * analysed.
 */
export function sessionsForReaders(
  rows: ReaderOutcomeRow[],
  algorithmId: string,
  readerIds: readonly string[]
) {
  const included = new Set(readerIds);
  return rows
    .filter((row) => row.algorithmId === algorithmId && included.has(row.userId))
    .reduce((total, row) => total + row.sessions, 0);
}
