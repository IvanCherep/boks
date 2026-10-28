/**
 * The judge: stage seven. The model reads each refined candidate exactly as a
 * reader of the feed would - the text, under "«title», author", nothing else.
 *
 * It first retells the fragment in one sentence: a model that cannot say what
 * happens has not understood it either, and writing the summary first makes
 * the answers after it about the text rather than about the book's fame.
 * Then a checklist of yes/no questions, each about one thing a reader of an
 * excerpt stumbles on, and one 1..5 scale for interest. Binary checklists
 * are steadier than a 1..5 scale per criterion (Lee et al., 2024, CheckEval;
 * Cook et al., 2024, TICK): in the first run Alice AI gave every candidate of
 * «Дуэль» 3 on every scale, which ranks nothing.
 *
 * From the checklist come the four 1..5 scales the rest of the pipeline and
 * the admin page show:
 * - standalone: understood without the rest of the book (the first Б3 question);
 * - complete: a thought or an episode closes at the end (the second);
 * - opening: the first lines tell the reader who and where;
 * - interest: as the model rated it.
 * The two Б3 questions are also asked in the raters' own yes / no / unsure
 * form, so the result slots into the study's model-check order
 * (`model-check.ts`). Several runs can be averaged (`votes`).
 */

import { intIn, shortText, type LlmTask } from "@/lib/boks/fragments/llm";
import type { ModelAnswer, ModelVerdict } from "@/lib/boks/fragments/model-check";

/** The yes/no questions, as the model sees their keys; `true` is always the good answer. */
export const checklist = {
  names_who: "В первых двух предложениях действующее лицо названо по имени или описано, а не только «он», «она», «они».",
  clear_setting: "Из первого абзаца-двух понятно, где или в какой обстановке происходит действие.",
  has_event: "Во фрагменте что-то происходит или меняется: событие, разговор с поворотом, решение; не только описание.",
  self_explanatory: "Смысл того, что происходит, понятен без событий, которые во фрагменте не показаны (имена без предыстории не мешают).",
  closes_episode: "Последний абзац завершает эпизод, разговор или мысль, а не обрывает их.",
  no_open_question: "Фрагмент не кончается репликой или вопросом, на которые сразу должен последовать ответ.",
} as const;

export type ChecklistKey = keyof typeof checklist;

export type Judgement = {
  summary: string;
  checks: Record<ChecklistKey, boolean>;
  standalone: number;
  complete: number;
  opening: number;
  interest: number;
  missingContext: string[];
  verdict: ModelVerdict;
  title: string;
  reason: string;
};

const answer = { type: "string", enum: ["yes", "no", "unsure"] };

const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    ...Object.fromEntries(Object.keys(checklist).map((key) => [key, { type: "boolean" }])),
    missing_context: { type: "array", items: { type: "string" }, maxItems: 3 },
    interest: { type: "integer", minimum: 1, maximum: 5 },
    standalone_answer: answer,
    complete_answer: answer,
    title: { type: "string" },
    reason: { type: "string" },
  },
  required: ["summary", ...Object.keys(checklist), "missing_context", "interest", "standalone_answer", "complete_answer", "title", "reason"],
};

const system = [
  "Ты редактор ленты коротких литературных текстов. Тебе дают фрагмент, вырезанный из книги;",
  "читатель увидит только его, название книги и автора, как отрывок в хрестоматии, и книгу он не читал.",
  "У любого отрывка есть предыстория: герои, названные по имени без рассказа о них, - это нормально.",
  "Сначала в summary перескажи одной фразой, что происходит во фрагменте.",
  "Затем ответь true или false на каждый вопрос:",
  ...Object.entries(checklist).map(([key, question]) => `${key}: ${question}`),
  "missing_context - до трёх коротких пунктов: чего именно читателю не хватит, чтобы понять сцену; пустой список, если хватает всего.",
  "interest - от 1 до 5, захочет ли читатель ленты дочитать до конца: 1 - скучно, 3 - читается ровно, 5 - не оторваться.",
  "standalone_answer и complete_answer - ответ такого читателя yes, no или unsure на вопросы",
  "«Понятен ли фрагмент без остальной книги?» и «Завершилась ли в конце мысль или эпизод?».",
  "title - название для фрагмента, до шести слов, без кавычек. reason - одна фраза: главное достоинство и главный недостаток.",
].join(" ");

export function judgeTask(body: string, work: { sourceTitle: string; sourceAuthor: string }): LlmTask {
  const from = work.sourceAuthor ? `Из «${work.sourceTitle}», ${work.sourceAuthor}` : `Из «${work.sourceTitle}»`;
  return { stage: "judge", system, user: `${from}\n\n<fragment>\n${body}\n</fragment>`, schema, maxTokens: 800 };
}

const answerValue = (value: ModelAnswer) => (value === "yes" ? 1 : value === "unsure" ? 0.5 : 0);
const scaleOf = (parts: number[]) => 1 + (4 * parts.reduce((sum, part) => sum + part, 0)) / parts.length;

export function readJudgement(json: unknown): Judgement | null {
  const value = json as Record<string, unknown> | null;
  if (!value) return null;
  const interest = intIn(value.interest, 1, 5);
  if (interest === null) return null;
  const checks = {} as Record<ChecklistKey, boolean>;
  for (const key of Object.keys(checklist) as ChecklistKey[]) {
    const raw = value[key];
    if (typeof raw !== "boolean" && raw !== "true" && raw !== "false") return null;
    checks[key] = raw === true || raw === "true";
  }
  const verdict = { standalone: asAnswer(value.standalone_answer), complete: asAnswer(value.complete_answer) };
  const missingContext = Array.isArray(value.missing_context)
    ? value.missing_context.map((entry) => shortText(entry, 160).replace(/\*\*/g, "")).filter(Boolean).slice(0, 3)
    : [];
  const bit = (key: ChecklistKey) => (checks[key] ? 1 : 0);
  return {
    summary: shortText(value.summary, 300),
    checks,
    standalone: scaleOf([bit("self_explanatory"), bit("clear_setting"), answerValue(verdict.standalone)]),
    complete: scaleOf([bit("closes_episode"), bit("no_open_question"), answerValue(verdict.complete)]),
    opening: scaleOf([bit("names_who"), bit("clear_setting")]),
    interest,
    missingContext,
    verdict,
    title: shortText(value.title, 80).replace(/^[«"“]|[»"”]$/g, ""),
    reason: shortText(value.reason, 400),
  };
}

function asAnswer(value: unknown): ModelAnswer {
  return value === "yes" || value === "no" ? value : "unsure";
}

/** Several judgements of one fragment as one: scales averaged, the first's words kept. */
export function combineJudgements(judgements: Judgement[]): Judgement | null {
  if (judgements.length === 0) return null;
  if (judgements.length === 1) return judgements[0];
  const mean = (pick: (judgement: Judgement) => number) => judgements.reduce((sum, judgement) => sum + pick(judgement), 0) / judgements.length;
  const majority = (pick: (judgement: Judgement) => ModelAnswer): ModelAnswer => {
    const counts = new Map<ModelAnswer, number>();
    for (const judgement of judgements) counts.set(pick(judgement), (counts.get(pick(judgement)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  return {
    ...judgements[0],
    standalone: mean((judgement) => judgement.standalone),
    complete: mean((judgement) => judgement.complete),
    opening: mean((judgement) => judgement.opening),
    interest: mean((judgement) => judgement.interest),
    missingContext: [...new Set(judgements.flatMap((judgement) => judgement.missingContext))].slice(0, 5),
    verdict: { standalone: majority((judgement) => judgement.verdict.standalone), complete: majority((judgement) => judgement.verdict.complete) },
  };
}

/**
 * The rubric as one number, 0..1. Standalone and complete carry most of the
 * weight because they are the hypothesis; interest decides between fragments
 * that pass. Missing context is not counted again: it is what
 * `self_explanatory` already asks.
 */
export function judgeScore(judgement: Judgement) {
  const unit = (value: number) => (value - 1) / 4;
  return 0.3 * unit(judgement.standalone) + 0.3 * unit(judgement.complete) + 0.15 * unit(judgement.opening) + 0.25 * unit(judgement.interest);
}
