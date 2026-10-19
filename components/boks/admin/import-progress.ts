import type { BoksImportRowResult } from "@/components/boks/client-types";
import type { CatalogueRow } from "@/lib/boks/import/parse-catalogue";

/** Unacknowledged batches may have committed: stable import keys make retries safe. */
export function pendingImportRows(rows: CatalogueRow[], results: BoksImportRowResult[]) {
  const settled = results.filter((row) => row.status !== "rejected");
  const settledKeys = new Set(settled.map((row) => row.importKey));
  return {
    settled,
    pending: rows.map((row, index) => ({ row, index: index + 1 })).filter(({ row }) => !settledKeys.has(row.importKey)),
  };
}

export function originalImportIndices(results: BoksImportRowResult[], batch: { index: number }[]) {
  return results.map((row) => ({ ...row, index: batch[row.index - 1]?.index ?? row.index }));
}
