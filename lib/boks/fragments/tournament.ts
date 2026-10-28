/**
 * The tournament: stage eight. The judge scores one fragment at a time, and
 * a model's absolute scores drift together - in the first runs Alice AI rated
 * nearly every fragment of «Дуэль» the same. Asked which of two fragments
 * reads better on its own, the same model separates them: comparison is the
 * easier judgement for raters and models alike (pairwise ranking prompting,
 * Qin et al., 2024).
 *
 * Every pair is asked in both orders, because a model tends to prefer
 * whichever it read first or last (Zheng et al., 2023); a pair it answers
 * inconsistently is a draw. Pairs are drawn Swiss-style: each round matches
 * fragments with similar records, so a few rounds sort the pool without
 * asking all n(n-1)/2 pairs. The result per fragment is its share of points.
 */

import { type LlmTask } from "@/lib/boks/fragments/llm";

export type Match = { left: number; right: number; points: [number, number] };

const schema = {
  type: "object",
  properties: {
    better: { type: "string", enum: ["A", "B"] },
    reason: { type: "string" },
  },
  required: ["better", "reason"],
};

const system = [
  "Ты редактор ленты коротких литературных текстов. Из одной книги вырезали два фрагмента, A и B.",
  "Читатель увидит один из них отдельно от книги, зная только название и автора.",
  "Какой из двух лучше читается сам по себе: понятно, что происходит, начало вводит в сцену,",
  "конец завершает эпизод, и хочется дочитать? Длина не важна. Ответь A или B и одной фразой почему.",
].join(" ");

export function pairTask(first: string, second: string, work: { sourceTitle: string; sourceAuthor: string }): LlmTask {
  const from = work.sourceAuthor ? `«${work.sourceTitle}», ${work.sourceAuthor}` : `«${work.sourceTitle}»`;
  return {
    stage: "tournament",
    system,
    user: `${from}\n\n<A>\n${first}\n</A>\n\n<B>\n${second}\n</B>`,
    schema,
    maxTokens: 200,
  };
}

export function readPair(json: unknown): "A" | "B" | null {
  const better = (json as { better?: unknown })?.better;
  return better === "A" || better === "B" ? better : null;
}

/**
 * Pairs for the next round: entrants sorted by points so far (ties by their
 * seed order), then paired down the list, skipping pairs already played.
 * With an odd count the last one sits out.
 */
export function swissPairs(count: number, matches: Match[]): [number, number][] {
  const points = new Array<number>(count).fill(0);
  const played = new Set<string>();
  for (const match of matches) {
    points[match.left] += match.points[0];
    points[match.right] += match.points[1];
    played.add(pairKey(match.left, match.right));
  }
  const order = [...points.keys()].sort((a, b) => points[b] - points[a] || a - b);
  const pairs: [number, number][] = [];
  const taken = new Set<number>();
  for (const left of order) {
    if (taken.has(left)) continue;
    const right = order.find((other) => other !== left && !taken.has(other) && !played.has(pairKey(left, other)));
    if (right === undefined) continue;
    taken.add(left);
    taken.add(right);
    pairs.push([left, right]);
  }
  return pairs;
}

/**
 * The points of one pair from its two orders. `forward` is the answer with
 * `left` shown as A, `backward` with `right` as A. Agreement gives the winner
 * a point; disagreement or a missing answer gives each half.
 */
export function scorePair(forward: "A" | "B" | null, backward: "A" | "B" | null): [number, number] {
  const leftWins = forward === "A" && backward === "B";
  const rightWins = forward === "B" && backward === "A";
  if (leftWins) return [1, 0];
  if (rightWins) return [0, 1];
  return [0.5, 0.5];
}

/** Each entrant's share of the points it could have won, 0.5 when it played no match. */
export function tournamentShare(count: number, matches: Match[]) {
  const won = new Array<number>(count).fill(0);
  const played = new Array<number>(count).fill(0);
  for (const match of matches) {
    won[match.left] += match.points[0];
    won[match.right] += match.points[1];
    played[match.left] += 1;
    played[match.right] += 1;
  }
  return won.map((value, index) => (played[index] ? value / played[index] : 0.5));
}

function pairKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
