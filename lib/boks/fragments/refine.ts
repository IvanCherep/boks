/**
 * Edge refinement: stage five. The model sees a candidate with a few
 * paragraphs on either side and may move its start and end to other
 * paragraph boundaries - take in the line that introduces the speaker, stop
 * before the first sentence of the next scene.
 *
 * It answers with two paragraph numbers and nothing else, so it cannot change
 * a word: the fragment stays `source.slice(start, end)` between paragraph
 * edges. Its choice is checked here against the same rules every candidate
 * obeys (length, no ending on a title) and dropped if it breaks one.
 */

import { intIn, shortText, type LlmTask } from "@/lib/boks/fragments/llm";
import { shortenedParagraph } from "@/lib/boks/fragments/scenes";
import { readingMinutes, type Paragraph } from "@/lib/boks/fragments/text";
import type { FragmentCandidate } from "@/lib/boks/fragments/candidates";
import { readingWordsPerMinute } from "@/components/boks/reader-behavior";

/** Paragraphs of context shown on each side. */
export const refineContext = 3;

export type Refinement = { first: number; last: number; reason: string };

const schema = {
  type: "object",
  properties: {
    start: { type: "integer" },
    end: { type: "integer" },
    reason: { type: "string" },
  },
  required: ["start", "end", "reason"],
};

export function refineTask(
  source: string,
  paragraphs: Paragraph[],
  candidate: FragmentCandidate,
  work: { sourceTitle: string; sourceAuthor: string },
  { minMinutes = 1, maxMinutes = 5 } = {},
): LlmTask {
  const from = Math.max(0, candidate.firstParagraph - refineContext);
  const to = Math.min(paragraphs.length - 1, candidate.lastParagraph + refineContext);
  const lines = paragraphs.slice(from, to + 1).map((paragraph) => {
    const inside = paragraph.index >= candidate.firstParagraph && paragraph.index <= candidate.lastParagraph;
    // The candidate is shown whole; the context only as far as its edges matter.
    const text = inside ? source.slice(paragraph.start, paragraph.end) : shortenedParagraph(source, paragraph, 50, 25);
    return `[${paragraph.index}] ${paragraph.heading ? "### " : ""}${text}`;
  });
  const minWords = Math.ceil(minMinutes * readingWordsPerMinute);
  const maxWords = Math.floor(maxMinutes * readingWordsPerMinute);
  const title = work.sourceAuthor ? `«${work.sourceTitle}», ${work.sourceAuthor}` : `«${work.sourceTitle}»`;
  return {
    stage: "refine",
    system: [
      "Ты литературный редактор. Из длинной книги вырезают фрагмент, который прочтут отдельно от неё,",
      "зная только название и автора. Фрагмент должен начинаться так, чтобы читатель понял, кто и где,",
      "без местоимений и реплик, отсылающих к тому, чего он не видел, и заканчиваться там, где эпизод",
      "или мысль завершены, а не на полуслове и не на середине разговора. Текст менять нельзя:",
      "можно только выбрать, с какого абзаца начать и на каком закончить.",
      `Длина фрагмента - от ${minWords} до ${maxWords} слов. Не начинай и не заканчивай на заголовке (###).`,
      "Если текущие границы уже лучшие, верни их же. reason - одна короткая фраза, почему.",
    ].join(" "),
    user: `${title}\n\nСейчас фрагмент - абзацы с ${candidate.firstParagraph} по ${candidate.lastParagraph}; ` +
      `можно выбрать любые от ${from} до ${to}. Длинные абзацы вне фрагмента сокращены, пропуск отмечен […].\n\n${lines.join("\n\n")}`,
    schema,
    maxTokens: 300,
  };
}

/**
 * The model's span, if it keeps to the rules; otherwise null and the
 * candidate keeps its own edges.
 */
export function readRefinement(
  json: unknown,
  paragraphs: Paragraph[],
  candidate: FragmentCandidate,
  { minMinutes = 1, maxMinutes = 5, maxCharacters = 20_000 } = {},
): Refinement | null {
  const from = Math.max(0, candidate.firstParagraph - refineContext);
  const to = Math.min(paragraphs.length - 1, candidate.lastParagraph + refineContext);
  const first = intIn((json as { start?: unknown })?.start, from, to);
  const last = intIn((json as { end?: unknown })?.end, from, to);
  if (first === null || last === null || first > last) return null;
  if (paragraphs[first].heading || paragraphs[last].heading) return null;
  let words = 0;
  for (let index = first; index <= last; index += 1) words += paragraphs[index].words;
  const minutes = readingMinutes(words);
  if (minutes < minMinutes || minutes > maxMinutes) return null;
  if (paragraphs[last].end - paragraphs[first].start > maxCharacters) return null;
  return { first, last, reason: shortText((json as { reason?: unknown }).reason, 240) };
}
