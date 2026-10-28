/**
 * Fragment candidates: every run of whole paragraphs that reads in 1-5
 * minutes, scored for how likely it is to stand on its own.
 *
 * The score adds three things, each roughly on a 0..1 scale so no one of them
 * swamps the others by accident of units:
 *
 * - **Boundaries** (weight 1): the TextTiling depth at the gap where the
 *   candidate starts and at the gap where it ends, each divided by the
 *   strongest boundary in the work and averaged. A fragment cut where the
 *   vocabulary turns over begins and ends with its episode.
 * - **Internal cohesion** (weight 0.5): the mean smoothed similarity across
 *   the gaps inside the candidate. One episode keeps its words; a span that
 *   runs across two topics does not. Half weight because cohesion is high in
 *   any long description and says nothing about the edges, which are what the
 *   raters' two questions are about.
 * - **Cues** at the edges, which the vocabulary cannot see (see `edgeCues`):
 *   a section heading where it starts, a dangling "Он"/"Но"/"However" at the
 *   start, a cut through an exchange of dialogue, an unfinished last sentence.
 *
 * The weights are a first guess, written down so they can be argued with;
 * the study measures whether the result beats same-length windows, which is
 * the claim, not that these weights are optimal.
 */

import { measureCohesion, type Cohesion } from "@/lib/boks/fragments/cohesion";
import {
  endsSentence,
  firstWord,
  readingMinutes,
  splitParagraphs,
  splitSentences,
  type Paragraph,
} from "@/lib/boks/fragments/text";

export type FragmentCue =
  | "starts_at_section"
  | "ends_at_section"
  | "dangling_start"
  | "starts_mid_dialogue"
  | "ends_mid_dialogue"
  | "unfinished_sentence"
  | "starts_mid_paragraph"
  | "ends_mid_paragraph";

export type FragmentCandidate = {
  /** Index of the first and last paragraph, inclusive. */
  firstParagraph: number;
  lastParagraph: number;
  /** Character offsets into the work: the body is `source.slice(start, end)`. */
  start: number;
  end: number;
  words: number;
  minutes: number;
  boundary: number;
  cohesion: number;
  cues: FragmentCue[];
  /**
   * The strongest boundary inside the span, 0..1, when fused boundaries were
   * given: a fragment that runs across a change of scene reads as two halves.
   */
  internalBreak?: number;
  /** Mean scene rating of its paragraphs, 0..1, when the scene stage ran. */
  quality?: number | null;
  score: number;
};

export type CandidateOptions = {
  minMinutes?: number;
  maxMinutes?: number;
  /** How many non-overlapping candidates to return, best first. */
  limit?: number;
  blockTokens?: number;
  /**
   * Boundary strength per gap, 0..1, from the pipeline's fusion of every
   * signal (`pipeline.ts`). When given it replaces the TextTiling depth at the
   * edges and adds a penalty for the strongest boundary inside the span.
   */
  boundaries?: number[];
  /** Per paragraph, 0..1 or null: how well its scene stands alone, as the model rated it. */
  paragraphQuality?: (number | null)[];
  /** False: never start a fragment on a chapter title; start after it. */
  allowHeadingStart?: boolean;
};

const cueWeights: Record<FragmentCue, number> = {
  starts_at_section: 0.25,
  ends_at_section: 0.25,
  dangling_start: -0.5,
  starts_mid_dialogue: -0.25,
  ends_mid_dialogue: -0.5,
  unfinished_sentence: -0.75,
  starts_mid_paragraph: -0.3,
  ends_mid_paragraph: -0.3,
};

/** How much a scene change inside the span costs, against the edges' weight of 1. */
const internalBreakWeight = 0.6;
/** Scene rating's weight, centred so an average scene adds nothing. */
const qualityWeight = 0.4;

/**
 * Opening words that point back at something the reader of a fragment has not
 * seen: a pronoun with no antecedent, or a conjunction continuing a thought.
 * "Он вошёл" opens many chapters and is still a worse start than a name.
 */
const danglingStarts = new Set([
  "он", "она", "оно", "они", "его", "ее", "их", "ему", "ей", "им", "ним", "нему", "ней",
  "но", "и", "а", "однако", "зато", "впрочем", "тогда", "потом", "затем", "поэтому", "тут", "там",
  "это", "этот", "эта", "эти", "тот", "та", "те", "то", "такой", "так", "же", "да",
  "he", "she", "it", "they", "him", "her", "them", "his", "their", "its",
  "but", "and", "or", "however", "then", "so", "yet", "also", "this", "that", "these", "those", "there", "thus",
]);

/** The words-per-candidate cap the import enforces through its 20,000-character body limit. */
const maxBodyCharacters = 20_000;

export function proposeFragments(source: string, options: CandidateOptions = {}) {
  const paragraphs = splitParagraphs(source);
  const cohesion = measureCohesion(source, paragraphs, options.blockTokens);
  const candidates = scoreCandidates(source, paragraphs, cohesion, options);
  return { paragraphs, cohesion, candidates: chooseNonOverlapping(candidates, options.limit ?? 15) };
}

export function scoreCandidates(
  source: string,
  paragraphs: Paragraph[],
  cohesion: Cohesion,
  { minMinutes = 1, maxMinutes = 5, boundaries, paragraphQuality, allowHeadingStart = true }: CandidateOptions = {},
): FragmentCandidate[] {
  const strongest = Math.max(1e-9, cohesion.depth[0]);
  // Prefix sums of similarity over gaps, so the mean inside any span is O(1).
  const prefix = [0];
  for (const value of cohesion.similarity) prefix.push(prefix[prefix.length - 1] + value);
  const interior = cohesion.similarity.slice(1, paragraphs.length);
  const workMean = interior.length ? interior.reduce((sum, v) => sum + v, 0) / interior.length : 0;

  const candidates: FragmentCandidate[] = [];
  // Prefix sums of quality and of how many paragraphs have one.
  const qualitySum = [0];
  const qualityCount = [0];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const value = paragraphQuality?.[index];
    qualitySum.push(qualitySum[index] + (value ?? 0));
    qualityCount.push(qualityCount[index] + (value === null || value === undefined ? 0 : 1));
  }

  for (let first = 0; first < paragraphs.length; first += 1) {
    if (!allowHeadingStart && paragraphs[first].heading) continue;
    let words = 0;
    // The strongest fused boundary strictly inside the span, grown with it.
    let internalBreak = 0;
    for (let last = first; last < paragraphs.length; last += 1) {
      words += paragraphs[last].words;
      if (boundaries && last > first) internalBreak = Math.max(internalBreak, boundaries[last]);
      const minutes = readingMinutes(words);
      if (minutes > maxMinutes) break;
      if (minutes < minMinutes || paragraphs[last].heading) continue;
      const start = paragraphs[first].start;
      const end = paragraphs[last].end;
      if (end - start > maxBodyCharacters) break;

      const boundary = boundaries
        ? (boundaries[first] + boundaries[last + 1]) / 2
        : (cohesion.depth[first] + cohesion.depth[last + 1]) / 2 / strongest;
      // Gaps strictly inside the span are first+1 .. last. A single paragraph
      // has none and is given the work's average: one paragraph is cohesive
      // by construction, but no more than the work is.
      const inside = last - first;
      const meanInside = inside > 0 ? (prefix[last + 1] - prefix[first + 1]) / inside : workMean;
      const cues = edgeCues(source, paragraphs, first, last);
      const rated = qualityCount[last + 1] - qualityCount[first];
      const quality = rated > 0 ? (qualitySum[last + 1] - qualitySum[first]) / rated : null;
      const score =
        boundary +
        0.5 * meanInside +
        cues.reduce((sum, cue) => sum + cueWeights[cue], 0) -
        (boundaries ? internalBreakWeight * internalBreak : 0) +
        (quality === null ? 0 : qualityWeight * (quality - 0.5));
      candidates.push({
        firstParagraph: first,
        lastParagraph: last,
        start,
        end,
        words,
        minutes,
        boundary,
        cohesion: meanInside,
        cues,
        ...(boundaries ? { internalBreak } : {}),
        ...(paragraphQuality ? { quality } : {}),
        score,
      });
    }
  }
  return candidates;
}

/** What the edges of a span look like to a reader who has not read the book. */
export function edgeCues(source: string, paragraphs: Paragraph[], first: number, last: number): FragmentCue[] {
  const cues: FragmentCue[] = [];
  const before = paragraphs[first - 1];
  const after = paragraphs[last + 1];
  // The first paragraph that is text rather than a title.
  const opening = paragraphs.slice(first, last + 1).find((paragraph) => !paragraph.heading) ?? paragraphs[first];
  const closing = paragraphs[last];

  if (paragraphs[first].heading || !before || before.heading) cues.push("starts_at_section");
  if (!after || after.heading) cues.push("ends_at_section");

  const openingSentence = splitSentences(source, opening)[0];
  if (openingSentence && danglingStarts.has(firstWord(source.slice(openingSentence.start, openingSentence.end)))) {
    cues.push("dangling_start");
  }
  const previous = paragraphs[opening.index - 1];
  if (opening.dialogue && previous?.dialogue) cues.push("starts_mid_dialogue");
  if (closing.dialogue && after?.dialogue) cues.push("ends_mid_dialogue");
  if (!endsSentence(source.slice(closing.start, closing.end))) cues.push("unfinished_sentence");
  if (opening.continued) cues.push("starts_mid_paragraph");
  if (after?.continued) cues.push("ends_mid_paragraph");
  return cues;
}

/**
 * Best first, never two sharing a paragraph. Greedy is not the best set by
 * total score, but it is the order the presentation describes - "the first
 * five candidates of the algorithm" - and it never trades the best fragment
 * of a work for two mediocre ones.
 */
export function chooseNonOverlapping(candidates: FragmentCandidate[], limit: number) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.start - b.start);
  const chosen: FragmentCandidate[] = [];
  for (const candidate of sorted) {
    if (chosen.length >= limit) break;
    const overlaps = chosen.some(
      (other) => candidate.firstParagraph <= other.lastParagraph && other.firstParagraph <= candidate.lastParagraph,
    );
    if (!overlaps) chosen.push(candidate);
  }
  return chosen;
}

/**
 * Like `chooseNonOverlapping`, but each pick is penalised by its closeness to
 * those already chosen (maximal marginal relevance, Carbonell & Goldstein
 * 1998, with distance in the text standing in for dissimilarity). Greedy
 * best-first tends to take three fragments from one strong chapter; a reader
 * shown a work's fragments, and a study rating them, both want the work.
 *
 * Closeness decays with the characters between two spans, on the scale of the
 * work divided among the picks: at that distance the penalty is `spread` / e,
 * so neighbours lose and the far end of the book does not.
 */
export function chooseDiverse(candidates: FragmentCandidate[], limit: number, sourceLength: number, spread = 0.3) {
  const scale = Math.max(1, sourceLength / Math.max(1, limit * 2));
  // The best few hundred are enough to choose from and keep this O(limit × pool).
  const pool = [...candidates].sort((a, b) => b.score - a.score || a.start - b.start).slice(0, Math.max(400, limit * 60));
  const chosen: FragmentCandidate[] = [];
  while (chosen.length < limit) {
    let best: FragmentCandidate | null = null;
    let bestValue = -Infinity;
    for (const candidate of pool) {
      if (chosen.some((other) => candidate.firstParagraph <= other.lastParagraph && other.firstParagraph <= candidate.lastParagraph)) continue;
      const nearest = chosen.reduce((max, other) => Math.max(max, Math.exp(-Math.abs(candidate.start - other.start) / scale)), 0);
      const value = candidate.score - spread * nearest;
      if (value > bestValue) {
        bestValue = value;
        best = candidate;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen;
}
