/**
 * The language-model check of fragment candidates: "Языковая модель проверяет
 * кандидатов".
 *
 * The model is asked the raters' own two questions, worded as the rater screen
 * words them (`study-copy.ts`, b3Standalone and b3Complete), about the text
 * the rater would see, under the same "From «title», author" line. It answers
 * yes / no / unsure to each and nothing else: structured output, so there is
 * no prose to parse and no place for it to hand back an edited fragment. The
 * body sent is the candidate's verbatim text and the body imported is the
 * same slice of the source; the model only reorders candidates.
 *
 * This file builds the request and reads the response. The call itself is in
 * `scripts/cut-fragments.mts`, so this module stays pure and runs offline.
 */

import type { FragmentCandidate } from "@/lib/boks/fragments/candidates";

export type ModelAnswer = "yes" | "no" | "unsure";
export type ModelVerdict = { standalone: ModelAnswer; complete: ModelAnswer };

/** The current Haiku: two three-way answers do not need a larger model. */
export const defaultCheckModel = "claude-haiku-5-5";

const answer = { type: "string", enum: ["yes", "no", "unsure"] };

const system = [
  "You help prepare a reading study. Readers will see one fragment cut from a long book,",
  "with only its title and author, and answer two questions about it. Answer them as a careful",
  "reader who has not read the book would.",
  "standalone: Is the fragment understandable without the rest of the book?",
  "complete: At the end, did a thought or an episode come to a close?",
  "Answer yes, no or unsure to each.",
].join(" ");

export function modelCheckRequest(
  body: string,
  work: { sourceTitle: string; sourceAuthor: string },
  model = defaultCheckModel,
) {
  const from = work.sourceAuthor ? `From «${work.sourceTitle}», ${work.sourceAuthor}` : `From «${work.sourceTitle}»`;
  return {
    model,
    // Room for adaptive thinking plus a two-field JSON answer.
    max_tokens: 2048,
    system,
    // Two three-way judgements on a few pages of text: low effort is enough,
    // and it keeps a run over 20 works x 15 candidates cheap.
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { standalone: answer, complete: answer },
          required: ["standalone", "complete"],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: "user", content: `${from}\n\n<fragment>\n${body}\n</fragment>` }],
  };
}

/**
 * The verdict from a Messages API response body, or null when there is none
 * to read: a refusal (checked before the content, which may be empty), a
 * truncated answer, or JSON that is not the two answers.
 */
export function readModelVerdict(response: unknown): ModelVerdict | null {
  const message = response as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (message?.stop_reason !== "end_turn") return null;
  const text = message.content?.find((block) => block.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ModelVerdict>;
    if (isAnswer(parsed.standalone) && isAnswer(parsed.complete)) {
      return { standalone: parsed.standalone, complete: parsed.complete };
    }
  } catch {
    // Not JSON: treated as no verdict below.
  }
  return null;
}

function isAnswer(value: unknown): value is ModelAnswer {
  return value === "yes" || value === "no" || value === "unsure";
}

/** 1 per "yes", half per "unsure": the order in which the model would accept a candidate. */
export function verdictScore(verdict: ModelVerdict) {
  const one = (value: ModelAnswer) => (value === "yes" ? 1 : value === "unsure" ? 0.5 : 0);
  return one(verdict.standalone) + one(verdict.complete);
}

/**
 * Re-rank checked candidates: those the model accepts on both questions
 * first, then by how close they came (`verdictScore`), the algorithm's own
 * score breaking ties. Nothing is dropped - a work whose candidates all fail
 * still yields its first five, because Б3 rates the first five of every work,
 * not a filtered sample - the rejected ones just go to the back.
 * Candidates the model gave no verdict for keep their place behind the
 * checked ones, judged by score alone.
 */
export function rankByVerdict(candidates: FragmentCandidate[], verdicts: (ModelVerdict | null)[]) {
  return candidates
    .map((candidate, index) => ({ candidate, verdict: verdicts[index] ?? null }))
    .sort((a, b) => {
      const rank = (entry: { verdict: ModelVerdict | null }) => (entry.verdict ? verdictScore(entry.verdict) : -1);
      return rank(b) - rank(a) || b.candidate.score - a.candidate.score;
    });
}
