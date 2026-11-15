/**
 * What the facet labelling job asks a language model and how it reads the
 * answer. No I/O: the job (`scripts/facet-labeler.mts`) fetches the boks,
 * calls the model and writes the labels; this file builds the tasks and turns
 * replies into rows, so both are testable without a network.
 */
import type { LlmTask } from "@/lib/boks/fragments/llm";
import { shortText } from "@/lib/boks/fragments/llm";
import { authorGroupRubric, cleanFacetValues, facetDefinition, moodRubric } from "./rubric";

/** Longer texts are cut here: the mood is set by the whole, but a 15-minute bok fits well inside. */
export const maxTextCharacters = 30_000;
export const maxNoteCharacters = 300;

export type BokForLabelling = { id: string; title: string; byline: string; language: string; text: string };

export type FacetAnswer = { values: string[]; note: string };

const moodValues = ["sad", "fun", "think"] as const;

const verdict = {
  type: "object",
  additionalProperties: false,
  required: ["why", "yes"],
  properties: {
    why: { type: "string", description: "Проверка по рубрике для этого значения, одной фразой." },
    yes: { type: "boolean" },
  },
};

/**
 * Each value is judged on its own, reasons first, and only then the main one:
 * asked for a list in one go, Alice AI and YandexGPT added `sad` to most
 * texts (calibration 2026-11-16, docs/reading-facets.md).
 */
const moodSchema = {
  type: "object",
  additionalProperties: false,
  required: [...moodValues, "main", "note"],
  properties: {
    sad: verdict,
    fun: verdict,
    think: verdict,
    main: { type: "string", enum: [...moodValues, "none"], description: "Самое сильное из значений с yes=true, или none." },
    note: { type: "string", description: "Итог одной фразой по-русски, до 160 знаков." },
  },
};

const authorGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["note", "group"],
  properties: {
    note: { type: "string", description: "Кто это, одной фразой по-русски, до 160 знаков." },
    group: { type: "string", enum: [...(facetDefinition("author_group")?.values ?? []), "unknown"] },
  },
};

export function moodTask(bok: BokForLabelling): LlmTask {
  const text = bok.text.length > maxTextCharacters ? `${bok.text.slice(0, maxTextCharacters)}\n[…]` : bok.text;
  return {
    stage: "facets",
    system: `Ты редактор литературного каталога boks. Прочитай текст целиком и определи его настроение строго по рубрике. Не суди по имени автора или названию; финал особенно важен.\n\n${moodRubric}\n\nРеши по каждому значению отдельно: sad, fun, think — сначала why (проверь каждое «НЕ ставить» из рубрики), потом yes. yes=true только при уверенном «да»; по умолчанию no. Затем main — самое сильное из значений с yes=true, или none. Затем note.`,
    user: `Название: ${bok.title}\nАвтор: ${bok.byline}\nЯзык: ${bok.language}\n\n<text>\n${text}\n</text>`,
    schema: moodSchema,
    maxTokens: 600,
  };
}

/**
 * `ownAccount`: the byline is published from an author's own account, not the
 * catalogue's. A hint for an unknown name, never the answer for a known one.
 */
export function authorGroupTask(byline: string, titles: readonly string[], ownAccount: boolean): LlmTask {
  return {
    stage: "facets",
    system: `Ты редактор литературного каталога boks. Определи группу автора строго по рубрике.\n\n${authorGroupRubric}\n\nЕсли по имени нельзя уверенно сказать, кто это, ответь unknown. Ответь JSON: сначала note, потом group.`,
    user: `Автор (byline): ${byline}\nПроизведения в каталоге: ${titles.slice(0, 5).join("; ")}\nПубликует ${ownAccount ? "сам, со своего аккаунта в boks" : "редакция каталога boks"}.`,
    schema: authorGroupSchema,
    maxTokens: 200,
  };
}

/** The labels in a mood reply, main value first, or null when the reply is unusable (it is then retried on the next run). */
export function readMoodAnswer(json: unknown): FacetAnswer | null {
  const body = json as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return null;
  const yes: string[] = [];
  for (const value of moodValues) {
    const judged = body[value] as { yes?: unknown } | undefined;
    if (!judged || typeof judged.yes !== "boolean") return null;
    if (judged.yes) yes.push(value);
  }
  const main = typeof body.main === "string" && yes.includes(body.main) ? [body.main] : [];
  return { values: cleanFacetValues("mood", [...main, ...yes]), note: shortText(body.note, maxNoteCharacters) };
}

/** `unknown` is an answer too: an empty list, so the byline is not asked again until the rubric changes. */
export function readAuthorGroupAnswer(json: unknown): FacetAnswer | null {
  const body = json as { group?: unknown; note?: unknown } | null;
  if (!body || typeof body.group !== "string") return null;
  if (body.group !== "unknown" && !cleanFacetValues("author_group", [body.group]).length) return null;
  return { values: cleanFacetValues("author_group", [body.group]), note: shortText(body.note, maxNoteCharacters) };
}

export type Agreement = { value: string; both: number; onlyReference: number; onlyCandidate: number };

/**
 * Per value: how often a candidate labeller agrees with the reference labels
 * on the same boks. The calibration a new labeller passes before it is trusted.
 */
export function agreement(values: readonly string[], pairs: readonly { reference: string[]; candidate: string[] }[]): Agreement[] {
  return values.map((value) => {
    let both = 0;
    let onlyReference = 0;
    let onlyCandidate = 0;
    for (const { reference, candidate } of pairs) {
      const inReference = reference.includes(value);
      const inCandidate = candidate.includes(value);
      if (inReference && inCandidate) both += 1;
      else if (inReference) onlyReference += 1;
      else if (inCandidate) onlyCandidate += 1;
    }
    return { value, both, onlyReference, onlyCandidate };
  });
}
