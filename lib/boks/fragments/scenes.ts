/**
 * Scene segmentation by the language model: stage three of the pipeline.
 *
 * Lexical cohesion finds where the vocabulary turns over; a reader finds
 * where the episode does - a new place, a later hour, other people in the
 * room. The model is shown a stretch of the book as numbered paragraphs and
 * asked where each scene begins, how sharp that change is, and how well the
 * scene would read on its own. Its answers become a third boundary signal
 * (fused with the others in `pipeline.ts`) and a per-paragraph rating.
 *
 * A novel is too long, and too expensive, to show whole. The model reads
 * regions instead: the neighbourhoods of the best candidates the offline
 * stages found, spread across the work, each widened by some context and cut
 * into overlapping chunks. A short story is covered entirely by its regions.
 * Long paragraphs are shown shortened - a scene change is visible in how a
 * paragraph opens and closes, not in its middle.
 */

import { intIn, shortText, type LlmTask } from "@/lib/boks/fragments/llm";
import type { FragmentCandidate } from "@/lib/boks/fragments/candidates";
import type { Paragraph } from "@/lib/boks/fragments/text";

export type SceneShift = "chapter" | "strong" | "weak";

export type Scene = {
  first: number;
  last: number;
  shift: SceneShift;
  title: string;
  /** 1..5: how well the scene reads apart from the book, by the model. */
  standalone: number;
};

/** A run of paragraphs shown to the model in one call, inclusive. */
export type SceneChunk = { first: number; last: number };

export type SceneMap = {
  /** Per gap (indexed as `Cohesion.similarity`): the strongest scene change the model saw there, 0..1. */
  boundary: number[];
  /** Per gap: whether some chunk saw both sides of it, so a 0 in `boundary` means "no change", not "not looked at". */
  covered: boolean[];
  /** Per paragraph: its scene's rating mapped to 0..1, averaged over the chunks that saw it; null when unseen. */
  quality: (number | null)[];
  scenes: Scene[];
  chunks: SceneChunk[];
  /** Chunks whose answer could not be used. */
  failed: number;
};

export const shiftStrength: Record<SceneShift, number> = { chapter: 1, strong: 0.8, weak: 0.4 };

export type RegionOptions = {
  /** Words of context added on each side of a candidate. */
  padWords?: number;
  /** Most words in one chunk, counted on the shortened view. */
  chunkWords?: number;
  /** Paragraphs repeated between neighbouring chunks, so no gap sits at a chunk's edge only. */
  overlap?: number;
  maxChunks?: number;
};

/** Words shown for a long paragraph: its opening and its close. */
const shownHead = 45;
const shownTail = 20;

/** The paragraph as the model sees it in a scene chunk. */
export function shortenedParagraph(source: string, paragraph: Paragraph, head = shownHead, tail = shownTail) {
  const text = source.slice(paragraph.start, paragraph.end).replace(/\s+/g, " ");
  const words = text.split(" ");
  if (words.length <= head + tail + 10) return text;
  return `${words.slice(0, head).join(" ")} […] ${words.slice(-tail).join(" ")}`;
}

function shownWords(paragraph: Paragraph) {
  return Math.min(paragraph.words, shownHead + shownTail + 10);
}

/**
 * Regions around the candidates, merged where they touch, cut into chunks of
 * at most `chunkWords` shown words with `overlap` paragraphs in common. When
 * there are more chunks than `maxChunks`, the regions of the weakest
 * candidates are dropped first: `candidates` comes best first.
 */
export function planSceneChunks(
  paragraphs: Paragraph[],
  candidates: FragmentCandidate[],
  { padWords = 500, chunkWords = 1800, overlap = 3, maxChunks = 16 }: RegionOptions = {},
): SceneChunk[] {
  const widen = (candidate: FragmentCandidate): SceneChunk => {
    let first = candidate.firstParagraph;
    let words = 0;
    while (first > 0 && words < padWords) words += paragraphs[--first].words;
    let last = candidate.lastParagraph;
    words = 0;
    while (last < paragraphs.length - 1 && words < padWords) words += paragraphs[++last].words;
    return { first, last };
  };

  // Take regions best candidate first until the chunks they need run out.
  const regions: SceneChunk[] = [];
  let chunks: SceneChunk[] = [];
  for (const candidate of candidates) {
    const trial = mergeRegions([...regions, widen(candidate)]);
    const trialChunks = trial.flatMap((region) => chunkRegion(paragraphs, region, chunkWords, overlap));
    if (trialChunks.length > maxChunks) break;
    regions.splice(0, regions.length, ...trial);
    chunks = trialChunks;
  }
  return chunks;
}

function mergeRegions(regions: SceneChunk[]) {
  const sorted = [...regions].sort((a, b) => a.first - b.first);
  const merged: SceneChunk[] = [];
  for (const region of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && region.first <= previous.last + 1) previous.last = Math.max(previous.last, region.last);
    else merged.push({ ...region });
  }
  return merged;
}

function chunkRegion(paragraphs: Paragraph[], region: SceneChunk, chunkWords: number, overlap: number) {
  const chunks: SceneChunk[] = [];
  let first = region.first;
  while (first <= region.last) {
    let last = first;
    let words = shownWords(paragraphs[first]);
    while (last < region.last && words + shownWords(paragraphs[last + 1]) <= chunkWords) words += shownWords(paragraphs[++last]);
    chunks.push({ first, last });
    if (last >= region.last) break;
    // Step back by the overlap, but always move forward.
    first = Math.max(first + 1, last + 1 - overlap);
  }
  return chunks;
}

const system = [
  "Ты литературный редактор. Тебе показывают часть книги, разбитую на пронумерованные абзацы;",
  "длинные абзацы сокращены, пропуск отмечен […], заголовки глав отмечены ###.",
  "Раздели эту часть на сцены. Сцена - непрерывный эпизод: одно место, одно время, один состав действующих лиц,",
  "или одно законченное рассуждение рассказчика. Реплики одного разговора - одна сцена.",
  "Для каждой сцены укажи:",
  "start - номер абзаца, с которого она начинается (первая сцена начинается с первого показанного абзаца);",
  "shift - насколько резок переход в её начале: chapter - начало главы или части,",
  "strong - явная смена времени, места или действия, weak - смена темы или собеседника внутри того же эпизода;",
  "title - название сцены, не больше шести слов;",
  "standalone - от 1 до 5, насколько сцена понятна и интересна читателю, который не читал книгу:",
  "1 - без остальной книги непонятна, 3 - понятна, но держится на предыдущем, 5 - читается как отдельный рассказ.",
].join(" ");

const schema = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "integer" },
          shift: { type: "string", enum: ["chapter", "strong", "weak"] },
          title: { type: "string" },
          standalone: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["start", "shift", "title", "standalone"],
      },
    },
  },
  required: ["scenes"],
};

export function sceneTask(source: string, paragraphs: Paragraph[], chunk: SceneChunk, work: { sourceTitle: string; sourceAuthor: string }): LlmTask {
  const lines = paragraphs.slice(chunk.first, chunk.last + 1).map((paragraph) =>
    `[${paragraph.index}] ${paragraph.heading ? "### " : ""}${shortenedParagraph(source, paragraph)}`,
  );
  const from = work.sourceAuthor ? `«${work.sourceTitle}», ${work.sourceAuthor}` : `«${work.sourceTitle}»`;
  return {
    stage: "scenes",
    system,
    user: `${from}. Абзацы ${chunk.first}–${chunk.last}.\n\n${lines.join("\n\n")}`,
    schema,
    maxTokens: 2500,
  };
}

/** Scenes of one chunk from the model's answer, cleaned: in range, in order, one per start. */
export function readScenes(json: unknown, chunk: SceneChunk): Scene[] | null {
  const raw = (json as { scenes?: unknown })?.scenes;
  if (!Array.isArray(raw)) return null;
  const byStart = new Map<number, Omit<Scene, "last">>();
  for (const entry of raw) {
    const start = intIn((entry as { start?: unknown }).start, chunk.first, chunk.last);
    const standalone = intIn((entry as { standalone?: unknown }).standalone, 1, 5);
    const shift = (entry as { shift?: unknown }).shift;
    if (start === null || standalone === null || (shift !== "chapter" && shift !== "strong" && shift !== "weak")) continue;
    if (!byStart.has(start)) byStart.set(start, { first: start, shift, title: shortText((entry as { title?: unknown }).title, 80), standalone });
  }
  // The chunk's first paragraph always opens a scene, whatever the model said.
  if (!byStart.has(chunk.first)) byStart.set(chunk.first, { first: chunk.first, shift: "weak", title: "", standalone: 3 });
  const starts = [...byStart.values()].sort((a, b) => a.first - b.first);
  return starts.map((scene, index) => ({ ...scene, last: (starts[index + 1]?.first ?? chunk.last + 1) - 1 }));
}

/**
 * The chunks' scenes combined. A chunk's first paragraph is where the chunk
 * was cut, not where the model saw a change, so it adds no boundary; the
 * overlap makes sure some other chunk saw that gap from both sides.
 */
export function mergeScenes(paragraphCount: number, chunks: SceneChunk[], answers: (Scene[] | null)[]): SceneMap {
  const boundary = new Array<number>(paragraphCount + 1).fill(0);
  const covered = new Array<boolean>(paragraphCount + 1).fill(false);
  const qualitySum = new Array<number>(paragraphCount).fill(0);
  const qualityCount = new Array<number>(paragraphCount).fill(0);
  const scenes = new Map<number, Scene>();
  let failed = 0;

  chunks.forEach((chunk, index) => {
    const answer = answers[index];
    if (!answer) {
      failed += 1;
      return;
    }
    for (let gap = chunk.first + 1; gap <= chunk.last; gap += 1) covered[gap] = true;
    for (const scene of answer) {
      if (scene.first > chunk.first) boundary[scene.first] = Math.max(boundary[scene.first], shiftStrength[scene.shift]);
      for (let paragraph = scene.first; paragraph <= scene.last; paragraph += 1) {
        qualitySum[paragraph] += (scene.standalone - 1) / 4;
        qualityCount[paragraph] += 1;
      }
      // For display: the first chunk to report a scene at a start names it,
      // unless that was only the chunk's own cut.
      if (scene.first > chunk.first || !scenes.has(scene.first)) scenes.set(scene.first, scene);
    }
  });

  const quality = qualitySum.map((sum, index) => (qualityCount[index] ? sum / qualityCount[index] : null));
  return { boundary, covered, quality, scenes: [...scenes.values()].sort((a, b) => a.first - b.first), chunks, failed };
}
