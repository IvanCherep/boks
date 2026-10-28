/**
 * Lexical cohesion between paragraphs, after TextTiling (Hearst 1997).
 *
 * TextTiling's idea: inside one episode the same content words keep coming
 * back; where the topic changes, the vocabulary before the gap and after it
 * stop overlapping. Compare a block of words before every gap with a block
 * after it, smooth the curve, and a gap that sits in a deep valley of that
 * curve is a boundary. The depth of the valley is how strong the boundary is.
 *
 * Gaps here are only between paragraphs: a fragment must start and end where
 * the author broke the text, so there is no point scoring a gap mid-paragraph.
 * Blocks are measured in tokens rather than paragraphs because paragraphs in
 * fiction range from one line of dialogue to a page of description; Hearst's
 * own default, six pseudo-sentences of twenty tokens, is the 120 below.
 */

import type { Paragraph } from "@/lib/boks/fragments/text";

export type Cohesion = {
  /**
   * Smoothed similarity at each gap. `similarity[i]` is the gap before
   * paragraph `i`; index 0 and index `paragraphs.length` are the edges of the
   * work and hold 0.
   */
  similarity: number[];
  /** Depth score at each gap, same indexing. The two edges of the work hold the largest depth seen. */
  depth: number[];
};

export const defaultBlockTokens = 120;

// Words too common to say anything about the topic. Short on purpose: the
// stemmer below already drops every word under three letters, which removes
// most of the pronouns and particles.
const stopwords = new Set([
  // Russian
  "был", "была", "было", "были", "быть", "есть", "это", "этот", "эта", "эти", "того", "тот", "той", "так",
  "как", "что", "чтобы", "когда", "если", "уже", "ещё", "еще", "только", "даже", "вот", "там", "тут",
  "где", "кто", "его", "её", "нее", "них", "ним", "ему", "она", "они", "оно", "меня", "мне", "себя",
  "себе", "свой", "своей", "свою", "мой", "моя", "ваш", "наш", "вас", "нас", "вам", "нам", "тебя",
  "тебе", "или", "ли", "ни", "но", "при", "для", "без", "под", "над", "про", "через", "после", "перед",
  "очень", "может", "можно", "нет", "весь", "все", "всё", "всех", "всем", "сказал", "сказала", "потом",
  "теперь", "тогда", "опять", "чем", "чего", "кого", "который", "которая", "которое", "которые", "себе",
  // English
  "the", "and", "that", "with", "was", "were", "for", "his", "her", "him", "she", "they", "them", "their",
  "this", "these", "those", "had", "have", "has", "not", "but", "you", "your", "are", "from", "which",
  "would", "could", "should", "there", "then", "than", "what", "when", "who", "been", "into", "upon",
  "said", "all", "one", "out", "very", "will", "its", "our", "some", "any", "more", "only", "about",
]);

/**
 * Content words, crudely stemmed. Russian inflects heavily - "дом", "дома",
 * "домом", "доме" must count as one word or the overlap between blocks is
 * mostly noise - so Cyrillic words are cut to their first five letters. A
 * prefix stem conflates some unrelated words; at the scale of a 120-token
 * block that is a small error next to missing every inflected repeat.
 * English inflects little: strip a few suffixes.
 */
export function contentTokens(text: string) {
  const tokens: string[] = [];
  for (const match of text.toLowerCase().replace(/ё/g, "е").matchAll(/\p{L}+/gu)) {
    const word = match[0];
    if (word.length < 3 || stopwords.has(word)) continue;
    tokens.push(stem(word));
  }
  return tokens;
}

function stem(word: string) {
  if (/[а-я]/.test(word)) return word.slice(0, 5);
  return word.replace(/(ing|ed|es|ly|s)$/, "").slice(0, 7);
}

export function measureCohesion(source: string, paragraphs: Paragraph[], blockTokens = defaultBlockTokens): Cohesion {
  const tokensBy = paragraphs.map((paragraph) => contentTokens(source.slice(paragraph.start, paragraph.end)));
  const flat = tokensBy.flat();
  // Token offset at which each paragraph begins, so a gap is a position in `flat`.
  const gapAt: number[] = [];
  let offset = 0;
  for (const tokens of tokensBy) {
    gapAt.push(offset);
    offset += tokens.length;
  }
  gapAt.push(offset);

  const raw = gapAt.map((position, gap) => {
    if (gap === 0 || gap === paragraphs.length) return 0;
    const left = flat.slice(Math.max(0, position - blockTokens), position);
    const right = flat.slice(position, position + blockTokens);
    return cosine(left, right);
  });

  // Hearst smooths with a short moving average so one odd paragraph does not
  // make a valley of its own.
  const similarity = raw.map((_, gap) => {
    if (gap === 0 || gap === paragraphs.length) return 0;
    const window = [gap - 1, gap, gap + 1].filter((g) => g > 0 && g < paragraphs.length).map((g) => raw[g]);
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  });

  const depth = similarity.map((value, gap) => {
    if (gap === 0 || gap === paragraphs.length) return 0;
    return climb(similarity, gap, -1) - value + (climb(similarity, gap, 1) - value);
  });
  // The beginning and end of the work are boundaries by definition, as strong
  // as the strongest one inside it.
  const strongest = Math.max(0, ...depth);
  depth[0] = strongest;
  depth[paragraphs.length] = strongest;

  return { similarity, depth };
}

/** Walk from a gap while the curve keeps rising, and return the peak reached (Hearst's depth score). */
function climb(values: number[], from: number, step: -1 | 1) {
  let peak = values[from];
  for (let gap = from + step; gap > 0 && gap < values.length - 1; gap += step) {
    if (values[gap] < peak) break;
    peak = values[gap];
  }
  return peak;
}

function cosine(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map<string, [number, number]>();
  for (const token of left) counts.set(token, [(counts.get(token)?.[0] ?? 0) + 1, counts.get(token)?.[1] ?? 0]);
  for (const token of right) counts.set(token, [counts.get(token)?.[0] ?? 0, (counts.get(token)?.[1] ?? 0) + 1]);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [a, b] of counts.values()) {
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}
