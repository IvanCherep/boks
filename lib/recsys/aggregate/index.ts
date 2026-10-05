export {
  collapseToReaders,
  sessionsForReaders,
  totalsByReaderAndAlgorithm,
} from "@/lib/recsys/aggregate/readers";
export {
  compareAlgorithms,
  type AlgorithmComparison,
  type CompareAlgorithmsOptions,
} from "@/lib/recsys/aggregate/compare-algorithms";
export {
  READER_METRICS,
  RATE_PARTS,
  formatReaderDifference,
  formatReaderValue,
  readerMetric,
  type RateParts,
} from "@/lib/recsys/aggregate/metrics";
export type {
  ReaderMetricDefinition,
  ReaderMetricId,
  ReaderOutcomeRow,
  ReaderSeries,
  ReaderTotals,
} from "@/lib/recsys/aggregate/types";

export { readerOutcomesToCsv, readerOutcomesReadme } from "@/lib/recsys/aggregate/export";
