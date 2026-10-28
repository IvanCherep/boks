import { describe, expect, it } from "vitest";
import {
  countWords,
  cutCandidates,
  finishWork,
  importRows,
  modelCheckRequest,
  rankByVerdict,
  readModelVerdict,
  seedFor,
  shuffledImportRows,
  splitParagraphs,
  splitSentences,
  type FragmentWork,
} from "@/lib/boks/fragments";
import { edgeCues, proposeFragments } from "@/lib/boks/fragments/candidates";
import { measureCohesion } from "@/lib/boks/fragments/cohesion";
import { isHeading } from "@/lib/boks/fragments/text";
import { drawWindows, endAfterWords } from "@/lib/boks/fragments/windows";
import { createRandom } from "@/lib/recsys/statistics/random";

/**
 * A made-up book of chapters, each about one thing with its own vocabulary,
 * so the place where the topic turns is known and the cutter can be asked to
 * find it. Sentences are varied by a counter rather than at random, so the
 * fixture is the same on every run.
 */
const topics = [
  ["море", "волна", "парус", "корабль", "берег", "ветер", "якорь", "матрос"],
  ["лес", "сосна", "тропинка", "грибы", "поляна", "ручей", "мох", "охотник"],
  ["город", "улица", "трамвай", "площадь", "фонарь", "витрина", "мостовая", "прохожий"],
  ["сад", "яблоня", "калитка", "скамейка", "сирень", "садовник", "грядка", "беседка"],
];

function paragraph(topic: string[], seed: number, sentences = 5) {
  const out: string[] = [];
  for (let s = 0; s < sentences; s += 1) {
    const words = [0, 1, 2, 3, 4].map((k) => topic[(seed + s * 3 + k * 5) % topic.length]);
    const sentence = `Мальчик видел ${words.join(" и ")} рядом.`;
    out.push(sentence[0].toUpperCase() + sentence.slice(1));
  }
  return out.join(" ");
}

function book(chapters = 8, paragraphsPerChapter = 9) {
  return Array.from({ length: chapters }, (_, chapter) => topics[chapter % topics.length])
    .map((topic, chapter) => {
      const body = Array.from({ length: paragraphsPerChapter }, (_, p) => paragraph(topic, chapter * 31 + p));
      return [`Глава ${chapter + 1}`, ...body].join("\n");
    })
    .join("\n\n");
}

const work: FragmentWork = { sourceTitle: "Книга", sourceAuthor: "Автор", language: "ru", text: book() };

describe("splitParagraphs", () => {
  it("takes one line as one paragraph when lines are not wrapped, by offsets into the untouched text", () => {
    const source = "  Глава 1\n\nОн вошёл.  \nОна молчала.\n";
    const paragraphs = splitParagraphs(source);
    expect(paragraphs.map((p) => source.slice(p.start, p.end))).toEqual(["Глава 1", "Он вошёл.", "Она молчала."]);
    expect(paragraphs[0].heading).toBe(true);
  });

  it("joins wrapped lines into one paragraph when blank lines separate paragraphs", () => {
    const source = "It was a long\nwrapped line of text.\n\nAnother paragraph that\nwraps as well.\n\nShort.";
    const paragraphs = splitParagraphs(source);
    expect(paragraphs).toHaveLength(3);
    expect(source.slice(paragraphs[0].start, paragraphs[0].end)).toBe("It was a long\nwrapped line of text.");
    expect(paragraphs[0].words).toBe(8);
  });

  it("keeps one paragraph per line when blank lines only set off chapter headings", () => {
    const source = "Глава I\nОн вошёл.\nОна молчала.\n\nГлава II\n— Ну?\nДа.";
    expect(splitParagraphs(source).map((p) => source.slice(p.start, p.end))).toEqual([
      "Глава I", "Он вошёл.", "Она молчала.", "Глава II", "— Ну?", "Да.",
    ]);
  });

  it("marks dialogue lines and headings", () => {
    expect(splitParagraphs("— Ну?\n«Да»\nCHAPTER IV\n* * *")
      .map((p) => [p.dialogue, p.heading])).toEqual([[true, false], [true, false], [false, true], [false, true]]);
    expect(isHeading("II. Господин Бахчеев")).toBe(true);
    expect(isHeading("— Нет.")).toBe(false);
    expect(isHeading("Он вошёл в комнату.")).toBe(false);
  });
});

describe("splitSentences", () => {
  it("splits at final punctuation with closing quotes, by offsets", () => {
    const source = "x Он сказал: «Иди!» Она ушла… И всё";
    const sentences = splitSentences(source, { start: 2, end: source.length });
    expect(sentences.map((s) => source.slice(s.start, s.end))).toEqual(["Он сказал: «Иди!»", "Она ушла…", "И всё"]);
  });
});

describe("measureCohesion", () => {
  it("puts the deepest valley where the vocabulary turns over", () => {
    const paragraphs = splitParagraphs(work.text);
    const { depth } = measureCohesion(work.text, paragraphs, 60);
    const headings = paragraphs.filter((p) => p.heading && p.index > 0).map((p) => p.index);
    const interior = depth.slice(1, paragraphs.length).map((value, k) => ({ gap: k + 1, value }));
    const deepest = interior.sort((a, b) => b.value - a.value).slice(0, headings.length).map((entry) => entry.gap);
    // The turn is at the heading or the gap just after it: the heading itself
    // is one short paragraph whose words belong to neither topic.
    for (const heading of headings) {
      expect(deepest.some((gap) => gap === heading || gap === heading + 1)).toBe(true);
    }
  });
});

describe("proposeFragments", () => {
  const { paragraphs, candidates } = proposeFragments(work.text, { limit: 10 });

  it("returns non-overlapping runs of whole paragraphs that read in one to five minutes, verbatim", () => {
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.minutes).toBeGreaterThanOrEqual(1);
      expect(candidate.minutes).toBeLessThanOrEqual(5);
      expect(candidate.start).toBe(paragraphs[candidate.firstParagraph].start);
      expect(candidate.end).toBe(paragraphs[candidate.lastParagraph].end);
      expect(countWords(work.text.slice(candidate.start, candidate.end))).toBe(candidate.words);
    }
    const sorted = [...candidates].sort((a, b) => a.firstParagraph - b.firstParagraph);
    for (let k = 1; k < sorted.length; k += 1) expect(sorted[k].firstParagraph).toBeGreaterThan(sorted[k - 1].lastParagraph);
  });

  it("ranks a whole chapter first: it starts at a heading and ends where the next one begins", () => {
    const best = candidates[0];
    expect(paragraphs[best.firstParagraph].heading || paragraphs[best.firstParagraph - 1]?.heading).toBe(true);
    expect(best.cues).toContain("ends_at_section");
    expect(best.score).toBeGreaterThanOrEqual(candidates[candidates.length - 1].score);
  });

  it("never ends a fragment on a heading", () => {
    for (const candidate of candidates) expect(paragraphs[candidate.lastParagraph].heading).toBe(false);
  });
});

describe("edgeCues", () => {
  it("names a dangling start, a cut through dialogue and an unfinished sentence", () => {
    const source = "Глава 1\nНо он не пришёл.\n— Где он?\n— Не знаю, и\n— Ладно.";
    const paragraphs = splitParagraphs(source);
    expect(edgeCues(source, paragraphs, 1, 1)).toEqual(expect.arrayContaining(["starts_at_section", "dangling_start"]));
    expect(edgeCues(source, paragraphs, 2, 3)).toEqual(
      expect.arrayContaining(["ends_mid_dialogue", "unfinished_sentence"]),
    );
    expect(edgeCues(source, paragraphs, 3, 4)).toContain("starts_mid_dialogue");
    expect(edgeCues(source, paragraphs, 2, 4)).toContain("ends_at_section");
  });
});

describe("drawWindows", () => {
  it("cuts a window of exactly the fragment's words from a paragraph start, away from the fragments", () => {
    const cut = cutCandidates(work, { perWork: 2 });
    const fragments = cut.pool.slice(0, 2);
    const windows = drawWindows(work.text, cut.paragraphs, fragments, createRandom(7));
    expect(windows).toHaveLength(2);
    const starts = new Set(cut.paragraphs.map((p) => p.start));
    windows.forEach((window, k) => {
      expect(starts.has(window.start)).toBe(true);
      expect(countWords(work.text.slice(window.start, window.end))).toBe(fragments[k].words);
      expect(window.overlapsAlgorithm).toBe(false);
      for (const fragment of fragments) expect(window.end <= fragment.start || window.start >= fragment.end).toBe(true);
    });
    expect(drawWindows(work.text, cut.paragraphs, fragments, createRandom(7))).toEqual(windows);
  });

  it("counts words the way the database does and stops at the end of the work", () => {
    const source = "a  b\nc d";
    expect(endAfterWords(source, 0, 3)).toBe(6);
    expect(endAfterWords(source, 0, 5)).toBeNull();
  });
});

describe("importRows", () => {
  it("gives Studio's import shape: ranked algorithm rows, unranked windows, bodies sliced from the source", () => {
    const result = finishWork(cutCandidates(work, { perWork: 3 }), { perWork: 3, seed: 5 });
    const rows = importRows(result);
    expect(rows.filter((row) => row.method === "algorithm").map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(rows.filter((row) => row.method === "window").every((row) => row.rank === null)).toBe(true);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["body", "language", "method", "rank", "sourceAuthor", "sourceTitle"]);
      expect(work.text.includes(row.body)).toBe(true);
    }
    expect(result.modelChecked).toBe(false);
  });

  it("shuffles the rows of a run deterministically by seed", () => {
    const results = [finishWork(cutCandidates(work, { perWork: 3 }), { perWork: 3, seed: 5 })];
    const first = shuffledImportRows(results, 9);
    expect(shuffledImportRows(results, 9)).toEqual(first);
    expect(first).toHaveLength(importRows(results[0]).length);
    expect(seedFor(1, "a")).not.toBe(seedFor(1, "b"));
  });
});

describe("model check", () => {
  it("asks the raters' two questions about the verbatim body, with a yes/no/unsure schema", () => {
    const request = modelCheckRequest("Текст.", { sourceTitle: "Книга", sourceAuthor: "Автор" });
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.messages[0].content).toContain("From «Книга», Автор");
    expect(request.messages[0].content).toContain("Текст.");
    expect(request.output_config.format.schema.required).toEqual(["standalone", "complete"]);
  });

  it("reads a verdict only from a finished answer", () => {
    const ok = { stop_reason: "end_turn", content: [{ type: "text", text: '{"standalone":"yes","complete":"unsure"}' }] };
    expect(readModelVerdict(ok)).toEqual({ standalone: "yes", complete: "unsure" });
    expect(readModelVerdict({ stop_reason: "refusal", content: [] })).toBeNull();
    expect(readModelVerdict({ stop_reason: "max_tokens", content: ok.content })).toBeNull();
    expect(readModelVerdict({ stop_reason: "end_turn", content: [{ type: "text", text: "yes" }] })).toBeNull();
  });

  it("puts accepted candidates first and keeps unchecked ones behind, by score", () => {
    const pool = cutCandidates(work, { poolSize: 3 }).pool;
    const ranked = rankByVerdict(pool, [
      { standalone: "no", complete: "no" },
      { standalone: "yes", complete: "yes" },
      null,
    ]);
    expect(ranked.map((entry) => entry.candidate)).toEqual([pool[1], pool[0], pool[2]]);
  });
});
