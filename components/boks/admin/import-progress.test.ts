import { describe, expect, it } from "vitest";
import { originalImportIndices, pendingImportRows } from "./import-progress";
import type { CatalogueRow } from "@/lib/boks/import/parse-catalogue";

const rows = ["one", "two", "three", "four"].map((importKey) => ({ importKey }) as CatalogueRow);

describe("catalogue import recovery", () => {
  it("keeps acknowledged imports and retries rejected or unacknowledged rows", () => {
    const result = pendingImportRows(rows, [
      { index: 1, importKey: "one", status: "imported" },
      { index: 2, importKey: "two", status: "skipped" },
      { index: 3, importKey: "three", status: "rejected" },
    ]);
    expect(result.settled.map((row) => row.importKey)).toEqual(["one", "two"]);
    expect(result.pending.map(({ row, index }) => [row.importKey, index])).toEqual([["three", 3], ["four", 4]]);
  });

  it("keeps original file indices when a sparse retry batch is answered", () => {
    expect(originalImportIndices([
      { index: 1, importKey: "two", status: "imported" },
      { index: 2, importKey: "four", status: "skipped" },
    ], [{ index: 2 }, { index: 4 }]).map((row) => row.index)).toEqual([2, 4]);
  });

  it("has no remaining writes after every stable ID was acknowledged", () => {
    const result = pendingImportRows(rows, rows.map((row, index) => ({ importKey: row.importKey, index: index + 1, status: "skipped" })));
    expect(result.pending).toEqual([]);
  });
});
