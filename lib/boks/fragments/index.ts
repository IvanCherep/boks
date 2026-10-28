/**
 * The fragment prototype for hypothesis Б3, end to end: one work in, ranked
 * algorithm fragments and same-length windows out, as the rows Studio →
 * Studies → Б3 imports. See `docs/fragment-cutter.md`.
 *
 * Every body is `source.slice(start, end)` of the work as given. Nothing in
 * this module, and nothing the language model says, changes a character.
 */

import { createRandom, shuffle } from "@/lib/recsys/statistics/random";
import { proposeFragments, type FragmentCandidate } from "@/lib/boks/fragments/candidates";
import { drawWindows, type FragmentWindow } from "@/lib/boks/fragments/windows";
import { rankByVerdict, type ModelVerdict } from "@/lib/boks/fragments/model-check";
import type { Paragraph } from "@/lib/boks/fragments/text";

export { proposeFragments, type FragmentCandidate } from "@/lib/boks/fragments/candidates";
export { drawWindows, type FragmentWindow } from "@/lib/boks/fragments/windows";
export * from "@/lib/boks/fragments/model-check";
export { countWords, splitParagraphs, splitSentences } from "@/lib/boks/fragments/text";

export type FragmentWork = {
  sourceTitle: string;
  sourceAuthor: string;
  /** Short language code, e.g. "ru" or "en". */
  language: string;
  text: string;
};

/** One row of the JSON array `import_boks_study_fragments` accepts. */
export type FragmentImportRow = {
  method: "algorithm" | "window";
  sourceTitle: string;
  sourceAuthor: string;
  language: string;
  body: string;
  /** 1..N in the algorithm's order; null for a window. */
  rank: number | null;
};

export type CutOptions = {
  /** Fragments per work: Б3 rates the first five of each. */
  perWork?: number;
  /**
   * Candidates kept for the model check. Without a check only the first
   * `perWork` matter; with one, a wider pool gives the re-ranking something
   * to choose from.
   */
  poolSize?: number;
  seed?: number;
};

export type CutWork = {
  work: FragmentWork;
  paragraphs: Paragraph[];
  pool: FragmentCandidate[];
};

/** Step one: the work's best non-overlapping candidates, by the algorithm alone. */
export function cutCandidates(work: FragmentWork, { perWork = 5, poolSize }: CutOptions = {}): CutWork {
  const { paragraphs, candidates } = proposeFragments(work.text, { limit: poolSize ?? perWork });
  return { work, paragraphs, pool: candidates };
}

export type ChosenFragment = FragmentCandidate & { rank: number; verdict: ModelVerdict | null };

export type WorkResult = {
  work: FragmentWork;
  fragments: ChosenFragment[];
  windows: FragmentWindow[];
  /** False when no model was asked, so a reader of the report never takes the order for a checked one. */
  modelChecked: boolean;
};

/**
 * Step two: the first `perWork` fragments (re-ranked by the model's verdicts
 * when there are any) and a same-length window for each. `verdicts` is
 * parallel to `cut.pool`.
 */
export function finishWork(cut: CutWork, { perWork = 5, seed = 1 }: CutOptions = {}, verdicts?: (ModelVerdict | null)[]): WorkResult {
  const ranked = verdicts
    ? rankByVerdict(cut.pool, verdicts)
    : cut.pool.map((candidate) => ({ candidate, verdict: null }));
  const fragments = ranked.slice(0, perWork).map(({ candidate, verdict }, index) => ({ ...candidate, rank: index + 1, verdict }));
  // A seed per work, so adding a book to the run does not move another book's windows.
  const windows = drawWindows(cut.work.text, cut.paragraphs, fragments, createRandom(seedFor(seed, cut.work.sourceTitle)));
  return { work: cut.work, fragments, windows, modelChecked: Boolean(verdicts) };
}

/** Rows for Studio, algorithm and window together. */
export function importRows(result: WorkResult): FragmentImportRow[] {
  const { sourceTitle, sourceAuthor, language, text } = result.work;
  const base = { sourceTitle, sourceAuthor, language };
  return [
    ...result.fragments.map((fragment) => ({
      ...base,
      method: "algorithm" as const,
      body: text.slice(fragment.start, fragment.end),
      rank: fragment.rank,
    })),
    ...result.windows.map((window) => ({
      ...base,
      method: "window" as const,
      body: text.slice(window.start, window.end),
      rank: null,
    })),
  ];
}

/**
 * Rows of every work, shuffled with the run's seed. Raters never see the
 * method, and neither should anyone reading the file in order: algorithm
 * rows first would make the batch's order a key to the arms.
 */
export function shuffledImportRows(results: WorkResult[], seed = 1) {
  return shuffle(results.flatMap(importRows), createRandom(seedFor(seed, "rows")));
}

/** FNV-1a of the label, mixed with the seed. */
export function seedFor(seed: number, label: string) {
  let hash = 0x811c9dc5 ^ (seed >>> 0);
  for (const char of label) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
