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
  | "unfinished_sentence";

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
  score: number;
};

export type CandidateOptions = {
  minMinutes?: number;
  maxMinutes?: number;
  /** How many non-overlapping candidates to return, best first. */
  limit?: number;
  blockTokens?: number;
};

const cueWeights: Record<FragmentCue, number> = {
  starts_at_section: 0.25,
  ends_at_section: 0.25,
  dangling_start: -0.5,
  starts_mid_dialogue: -0.25,
  ends_mid_dialogue: -0.5,
  unfinished_sentence: -0.75,
};

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
  { minMinutes = 1, maxMinutes = 5 }: CandidateOptions = {},
): FragmentCandidate[] {
  const strongest = Math.max(1e-9, cohesion.depth[0]);
  // Prefix sums of similarity over gaps, so the mean inside any span is O(1).
  const prefix = [0];
  for (const value of cohesion.similarity) prefix.push(prefix[prefix.length - 1] + value);
  const interior = cohesion.similarity.slice(1, paragraphs.length);
  const workMean = interior.length ? interior.reduce((sum, v) => sum + v, 0) / interior.length : 0;

  const candidates: FragmentCandidate[] = [];
  for (let first = 0; first < paragraphs.length; first += 1) {
    let words = 0;
    for (let last = first; last < paragraphs.length; last += 1) {
      words += paragraphs[last].words;
      const minutes = readingMinutes(words);
      if (minutes > maxMinutes) break;
      if (minutes < minMinutes || paragraphs[last].heading) continue;
      const start = paragraphs[first].start;
      const end = paragraphs[last].end;
      if (end - start > maxBodyCharacters) break;

      const boundary = (cohesion.depth[first] + cohesion.depth[last + 1]) / 2 / strongest;
      // Gaps strictly inside the span are first+1 .. last. A single paragraph
      // has none and is given the work's average: one paragraph is cohesive
      // by construction, but no more than the work is.
      const inside = last - first;
      const meanInside = inside > 0 ? (prefix[last + 1] - prefix[first + 1]) / inside : workMean;
      const cues = edgeCues(source, paragraphs, first, last);
      const score = boundary + 0.5 * meanInside + cues.reduce((sum, cue) => sum + cueWeights[cue], 0);
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
