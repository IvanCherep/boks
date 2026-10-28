import { describe, expect, it } from "vitest";
import { chooseDiverse, proposeFragments } from "@/lib/boks/fragments/candidates";
import { judgeScore, readJudgement } from "@/lib/boks/fragments/judge";
import {
  intIn,
  parseJsonObject,
  readYandexChat,
  withConcurrency,
  withRetries,
  yandexChatBody,
  type LlmCall,
  type LlmTask,
} from "@/lib/boks/fragments/llm";
import { measureTransitions, transitionStrength } from "@/lib/boks/fragments/markers";
import { fuseBoundaries, pipelineImportRows, runFragmentPipeline } from "@/lib/boks/fragments/pipeline";
import { readRefinement } from "@/lib/boks/fragments/refine";
import { mergeScenes, planSceneChunks, readScenes } from "@/lib/boks/fragments/scenes";
import { countWords, splitLongParagraphs, splitParagraphs } from "@/lib/boks/fragments/text";
import { scorePair, swissPairs, tournamentShare } from "@/lib/boks/fragments/tournament";

/** Chapters about one thing each, opened by a heading and a time marker, so the cuts are known. */
const topics = [
  ["море", "волна", "парус", "корабль", "берег", "ветер", "якорь", "матрос"],
  ["лес", "сосна", "тропинка", "грибы", "поляна", "ручей", "мох", "охотник"],
  ["город", "улица", "трамвай", "площадь", "фонарь", "витрина", "мостовая", "прохожий"],
  ["сад", "яблоня", "калитка", "скамейка", "сирень", "садовник", "грядка", "беседка"],
];

function chapterText(topic: string[], chapter: number, paragraphs = 6) {
  const out = [`Глава ${chapter + 1}`];
  for (let p = 0; p < paragraphs; p += 1) {
    const sentences: string[] = [];
    for (let s = 0; s < 6; s += 1) {
      const words = [0, 1, 2, 3, 4, 5].map((k) => topic[(p + s * 3 + k * 5) % topic.length]);
      sentences.push(`Мальчик Петя видел ${words.join(" и ")} рядом.`);
    }
    out.push((p === 0 ? "На другой день " : "") + sentences.join(" "));
  }
  return out.join("\n\n");
}

const book = topics.map((topic, chapter) => chapterText(topic, chapter)).join("\n\n");
const work = { sourceTitle: "Мальчик", sourceAuthor: "Тест", language: "ru", text: book };

describe("transition markers", () => {
  it("reads a time jump at a paragraph's start, and nothing in dialogue", () => {
    expect(transitionStrength("На другой день он уехал.")).toBe(1);
    expect(transitionStrength("Через два часа всё кончилось.")).toBe(1);
    expect(transitionStrength("Между тем в городе шёл дождь.")).toBe(0.7);
    expect(transitionStrength("The next morning she left.")).toBe(1);
    expect(transitionStrength("Он сказал, что на другой день уедет.")).toBe(0);
    const text = "Первый абзац.\n\n— Утром придёшь?\n\nУтром он пришёл.";
    expect(measureTransitions(text, splitParagraphs(text))).toEqual([0, 0, 0.5, 0]);
  });
});

describe("long paragraphs", () => {
  it("are split at sentence ends into pieces marked continued, offsets untouched", () => {
    const sentence = "Это одно длинное предложение из нескольких слов подряд.";
    const text = Array.from({ length: 60 }, () => sentence).join(" ");
    const pieces = splitLongParagraphs(text, splitParagraphs(text), 100, 80);
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces[0].continued).toBe(false);
    expect(pieces.slice(1).every((piece) => piece.continued)).toBe(true);
    expect(pieces.reduce((sum, piece) => sum + piece.words, 0)).toBe(countWords(text));
    for (const piece of pieces) expect(text.slice(piece.start, piece.end)).toMatch(/^Это.*\.$/);
  });
});

describe("boundary fusion", () => {
  it("is a noisy-OR: certain at headings, stronger with two signals than with one", () => {
    const paragraphs = splitParagraphs("Глава 1\n\nА.\n\nБ.\n\nВ.\n\nГ.");
    const depth = [0, 0, 0.5, 0, 0.5, 0];
    const markers = [0, 0, 0, 0, 1, 0];
    const fused = fuseBoundaries(paragraphs, depth, markers);
    expect(fused[0]).toBe(1);
    expect(fused[1]).toBeCloseTo(0.95);
    expect(fused[3]).toBe(0);
    expect(fused[4]).toBeGreaterThan(fused[2]);
    expect(fuseBoundaries(paragraphs, depth, markers, [0, 0, 0, 1, 0, 0])[3]).toBeCloseTo(0.85);
  });
});

describe("diverse selection", () => {
  it("spreads picks across the work instead of crowding the best stretch", () => {
    const { candidates } = proposeFragments(book, { limit: 1000, minMinutes: 0.3, maxMinutes: 1 });
    const picks = chooseDiverse(candidates, 4, book.length, 5);
    const chapters = new Set(picks.map((pick) => Math.floor((pick.start / book.length) * 4)));
    expect(chapters.size).toBeGreaterThanOrEqual(3);
    for (const a of picks) for (const b of picks) if (a !== b) expect(a.lastParagraph < b.firstParagraph || b.lastParagraph < a.firstParagraph).toBe(true);
  });
});

describe("scene stage", () => {
  const paragraphs = splitParagraphs(book);

  it("plans overlapping chunks within the budget", () => {
    const { candidates } = proposeFragments(book, { limit: 10, minMinutes: 0.3, maxMinutes: 1 });
    const chunks = planSceneChunks(paragraphs, candidates, { chunkWords: 200, overlap: 1, maxChunks: 5, padWords: 50 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThanOrEqual(5);
    for (const chunk of chunks) expect(chunk.first).toBeLessThanOrEqual(chunk.last);
  });

  it("cleans the model's scenes and merges them without counting a chunk's own cut", () => {
    const chunk = { first: 0, last: 13 };
    const scenes = readScenes({ scenes: [
      { start: 7, shift: "chapter", title: "Лес", standalone: 5 },
      { start: 99, shift: "strong", title: "вне", standalone: 3 },
      { start: 3, shift: "weak", title: "Море", standalone: "2" },
    ] }, chunk);
    expect(scenes?.map((scene) => [scene.first, scene.last])).toEqual([[0, 2], [3, 6], [7, 13]]);
    const map = mergeScenes(paragraphs.length, [chunk], [scenes]);
    expect(map.boundary[0]).toBe(0);
    expect(map.boundary[7]).toBe(1);
    expect(map.boundary[3]).toBe(0.4);
    expect(map.quality[8]).toBe(1);
    expect(map.covered[13]).toBe(true);
    expect(map.covered[14]).toBe(false);
    expect(readScenes({ nope: 1 }, chunk)).toBeNull();
  });
});

describe("edge refinement", () => {
  const paragraphs = splitParagraphs(book);
  const candidate = { firstParagraph: 8, lastParagraph: 12 } as Parameters<typeof readRefinement>[2];

  it("accepts a span inside the shown range that keeps the length rules", () => {
    expect(readRefinement({ start: 8, end: 13, reason: "до конца главы" }, paragraphs, candidate, { minMinutes: 0.2, maxMinutes: 3 }))
      .toEqual({ first: 8, last: 13, reason: "до конца главы" });
  });

  it("refuses a heading at an edge, a span out of range or out of length", () => {
    expect(readRefinement({ start: 7, end: 12 }, paragraphs, candidate, { minMinutes: 0.2, maxMinutes: 3 })).toBeNull();
    expect(readRefinement({ start: 1, end: 12 }, paragraphs, candidate, { minMinutes: 0.2, maxMinutes: 3 })).toBeNull();
    expect(readRefinement({ start: 12, end: 8 }, paragraphs, candidate, { minMinutes: 0.2, maxMinutes: 3 })).toBeNull();
    expect(readRefinement({ start: 8, end: 9 }, paragraphs, candidate, { minMinutes: 2, maxMinutes: 3 })).toBeNull();
  });
});

const goodJudgement = {
  summary: "Петя идёт в лес.",
  names_who: true,
  clear_setting: true,
  has_event: true,
  self_explanatory: true,
  closes_episode: true,
  no_open_question: true,
  missing_context: [],
  interest: 4,
  standalone_answer: "yes",
  complete_answer: "yes",
  title: "«Лес»",
  reason: "Ясно.",
};

describe("judge", () => {
  it("turns the checklist into scales and one score", () => {
    const judgement = readJudgement(goodJudgement)!;
    expect(judgement.standalone).toBe(5);
    expect(judgement.complete).toBe(5);
    expect(judgement.title).toBe("Лес");
    expect(judgeScore(judgement)).toBeCloseTo(0.9375);
    const weak = readJudgement({ ...goodJudgement, self_explanatory: false, clear_setting: false, standalone_answer: "unsure" })!;
    expect(weak.standalone).toBeCloseTo(1 + 4 * (0.5 / 3));
  });

  it("refuses an answer missing a checklist item", () => {
    const { names_who: _, ...partial } = goodJudgement;
    void _;
    expect(readJudgement(partial)).toBeNull();
  });
});

describe("tournament", () => {
  it("counts a pair only when both orders agree", () => {
    expect(scorePair("A", "B")).toEqual([1, 0]);
    expect(scorePair("B", "A")).toEqual([0, 1]);
    expect(scorePair("B", "B")).toEqual([0.5, 0.5]);
    expect(scorePair(null, "A")).toEqual([0.5, 0.5]);
  });

  it("pairs Swiss-style without repeating a pair and shares the points", () => {
    const first = swissPairs(4, []);
    expect(first).toEqual([[0, 1], [2, 3]]);
    const matches = [{ left: 0, right: 1, points: [1, 0] as [number, number] }, { left: 2, right: 3, points: [1, 0] as [number, number] }];
    expect(swissPairs(4, matches)).toEqual([[0, 2], [1, 3]]);
    expect(tournamentShare(5, matches)).toEqual([1, 0, 1, 0, 0.5]);
  });
});

describe("model transport", () => {
  const task: LlmTask = { stage: "judge", system: "s", user: "u", schema: { type: "object" }, maxTokens: 100 };

  it("builds a Yandex body with the schema and room for a reasoning model", () => {
    const body = yandexChatBody(task, "folder", "aliceai-llm");
    expect(body.model).toBe("gpt://folder/aliceai-llm/latest");
    expect(body.max_tokens).toBe(100);
    expect(body.response_format.json_schema.schema).toEqual({ type: "object" });
    expect(yandexChatBody(task, "folder", "gpt-oss-120b").max_tokens).toBeGreaterThan(1000);
  });

  it("reads JSON only from a finished answer", () => {
    expect(readYandexChat({ choices: [{ finish_reason: "stop", message: { content: "{\"a\":1}" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }))
      .toEqual({ json: { a: 1 }, usage: { promptTokens: 3, completionTokens: 2 } });
    expect(readYandexChat({ choices: [{ finish_reason: "length", message: { content: "{\"a\":" } }] }).json).toBeNull();
    expect(parseJsonObject("```json\n{\"b\":2}\n```")).toEqual({ b: 2 });
    expect(intIn("4", 1, 5)).toBe(4);
    expect(intIn(9, 1, 5)).toBeNull();
  });

  it("retries what a retry can fix, and not a refusal", async () => {
    let calls = 0;
    const flaky: LlmCall = async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("busy"), { status: 429 });
      return { json: {}, usage: null };
    };
    await withRetries(flaky, { sleep: async () => undefined })(task);
    expect(calls).toBe(3);
    calls = 0;
    const forbidden: LlmCall = async () => {
      calls += 1;
      throw Object.assign(new Error("no"), { status: 403 });
    };
    await expect(withRetries(forbidden, { sleep: async () => undefined })(task)).rejects.toThrow("no");
    expect(calls).toBe(1);
  });

  it("keeps calls in flight under the limit", async () => {
    let active = 0;
    let peak = 0;
    const slow: LlmCall = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { json: {}, usage: null };
    };
    const limited = withConcurrency(slow, 2);
    await Promise.all(Array.from({ length: 7 }, () => limited(task)));
    expect(peak).toBe(2);
  });
});

/**
 * A model that answers every stage sensibly and the same way each time: a
 * chapter-start scene per heading, edges left alone, a checklist that likes
 * fragments starting with a chapter's first paragraph, and a tournament that
 * prefers the shorter fragment in either order.
 */
const fakeModel: LlmCall = async (task) => {
  const usage = { promptTokens: 10, completionTokens: 5 };
  if (task.stage === "scenes") {
    const numbers = [...task.user.matchAll(/\[(\d+)\] (### )?/g)].map((match) => ({ index: Number(match[1]), heading: Boolean(match[2]) }));
    const scenes = numbers.filter((entry, position) => position === 0 || entry.heading).map((entry) => ({ start: entry.index, shift: "chapter", title: "Глава", standalone: 4 }));
    return { json: { scenes }, usage };
  }
  if (task.stage === "refine") {
    const [, first, last] = task.user.match(/абзацы с (\d+) по (\d+)/) ?? [];
    return { json: { start: Number(first), end: Number(last), reason: "так лучше" }, usage };
  }
  if (task.stage === "judge") {
    const opensChapter = task.user.includes("<fragment>\nНа другой день");
    return {
      json: opensChapter ? goodJudgement : { ...goodJudgement, self_explanatory: false, clear_setting: false, standalone_answer: "no" },
      usage,
    };
  }
  const a = task.user.match(/<A>\n([\s\S]*?)\n<\/A>/)?.[1] ?? "";
  const b = task.user.match(/<B>\n([\s\S]*?)\n<\/B>/)?.[1] ?? "";
  return { json: { better: a.length <= b.length ? "A" : "B", reason: "короче" }, usage };
};

describe("pipeline", () => {
  it("runs offline and keeps every fragment a verbatim slice", async () => {
    const result = await runFragmentPipeline(work, { perWork: 3, minMinutes: 0.3, maxMinutes: 1.2 });
    expect(result.modelChecked).toBe(false);
    expect(result.fragments.length).toBeGreaterThan(0);
    expect(result.stages.map((stage) => stage.stage)).toEqual(["structure", "lexical", "markers", "candidates", "rank"]);
    for (const fragment of result.fragments) {
      expect(book.slice(fragment.start, fragment.end)).not.toMatch(/^Глава/);
      expect(book.indexOf(book.slice(fragment.start, fragment.end))).toBeGreaterThanOrEqual(0);
    }
    const rows = pipelineImportRows(result);
    expect(rows.filter((row) => row.method === "algorithm").map((row) => row.rank)).toEqual(result.fragments.map((_, index) => index + 1));
    expect(rows.filter((row) => row.method === "window")).toHaveLength(result.windows.length);
  });

  it("runs every model stage and keeps only what the judge lets through", async () => {
    const progress: string[] = [];
    const result = await runFragmentPipeline(work, {
      perWork: 3,
      minMinutes: 0.3,
      maxMinutes: 1.2,
      llm: fakeModel,
      onProgress: ({ stage }) => progress.push(stage),
    });
    expect(result.modelChecked).toBe(true);
    expect(result.stages.map((stage) => stage.stage)).toEqual(["structure", "lexical", "markers", "candidates", "scenes", "refine", "judge", "tournament", "rank"]);
    expect(progress).toContain("tournament");
    expect(result.fragments.length).toBeGreaterThan(0);
    for (const fragment of result.fragments) expect(book.slice(fragment.start, fragment.end)).toMatch(/^На другой день/);
    expect(result.rejected.some((fragment) => fragment.reasons.some((reason) => reason.includes("standalone")))).toBe(true);
    expect(result.usage.calls).toBeGreaterThan(10);
    expect(result.usage.promptTokens).toBe(result.usage.calls * 10);
  });

  it("says why when nothing passes", async () => {
    const rejecting: LlmCall = async (task) =>
      task.stage === "judge" ? { json: { ...goodJudgement, self_explanatory: false, clear_setting: false, standalone_answer: "no" }, usage: null } : fakeModel(task);
    const result = await runFragmentPipeline(work, { perWork: 3, minMinutes: 0.3, maxMinutes: 1.2, llm: rejecting });
    expect(result.status).toBe("none");
    expect(result.fragments).toEqual([]);
    expect(result.windows).toEqual([]);
    expect(result.diagnosis.join(" ")).toMatch(/not understandable/);
  });

  it("does not cut a text shorter than a fragment", async () => {
    const result = await runFragmentPipeline({ ...work, text: "Короткое стихотворение.\n\nВсего две строки." });
    expect(result.status).toBe("none");
    expect(result.diagnosis[0]).toMatch(/under the 1-minute minimum/);
  });

  it("cuts a work pasted as one huge paragraph, at sentence ends", async () => {
    const flat = book.replace(/Глава \d+\n\n/g, "").replace(/\n\n/g, " ");
    const result = await runFragmentPipeline({ ...work, text: flat }, { perWork: 2, minMinutes: 0.3, maxMinutes: 1.2 });
    expect(result.stats.splitParagraphs).toBeGreaterThan(0);
    expect(result.fragments.length).toBeGreaterThan(0);
    for (const fragment of result.fragments) expect(flat.slice(fragment.start, fragment.end)).toMatch(/\.$/);
  });

  it("stops when asked", async () => {
    const controller = new AbortController();
    const stopping: LlmCall = async (task) => {
      controller.abort();
      return fakeModel(task);
    };
    await expect(runFragmentPipeline(work, { minMinutes: 0.3, maxMinutes: 1.2, llm: stopping, signal: controller.signal, concurrency: 1 }))
      .rejects.toThrow(/Abort/);
  });
});
