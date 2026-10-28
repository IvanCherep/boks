import { createRandom, shuffle } from "@/lib/recsys/statistics/random";
import { buildReaderFeed } from "@/lib/boks/recommendations/feed";
import { defaultAlgorithmId } from "@/lib/boks/recommendations/registry";
import { emptyReaderSignals, type StoryCandidate } from "@/lib/boks/recommendations/signals";
import type { A3Materials } from "@/lib/boks/studies/materials";

/**
 * Study a3: does a profile from the first five rated boks order the next ten
 * better than the same algorithm without it?
 *
 * The participant reads their ordinary feed and rates their interest in each
 * text on leaving it, 1..5. After five ratings the profile is fixed: the
 * interest-weighted direction of those five texts' semantic vectors. Ten new
 * texts by other authors then come one at a time in an order drawn from the
 * seed - never from either version's prediction, so the showing helps neither
 * (Schnabel et al., 2016) - and are rated the same way. Their ratings do not
 * change the profile.
 *
 * Offline, the production ranker orders those ten twice from the same
 * snapshot of counters: once with the profile as its semantic taste and once
 * with no taste at all. Nothing else differs, so the difference in NDCG@5
 * against the participant's own ratings is the profile's.
 */

export type A3Rating = { bokId: string; interest: number };

/** A candidate as the snapshot RPC returns it: counters, and the vector the profile is built from. */
export type A3Candidate = StoryCandidate & { embedding: number[] | null };

/** Interest at the middle of the 1..5 scale says nothing either way and weighs zero. */
const neutralInterest = 3;

/** The interest question's scale. */
export const interestScale = 5;

/**
 * The ten texts after the profile, in the order they are shown: the test pool
 * without what the participant has already rated and without anything by the
 * authors of the profile's texts, shuffled by the seed.
 */
export function planA3Targets(
  materials: A3Materials,
  seed: number,
  rated: readonly { bokId: string; author: string }[],
  authorOf: (bokId: string) => string | null
): string[] {
  const next = createRandom(seed ^ 0x2c1b3c6d);
  const seen = new Set(rated.map((entry) => entry.bokId));
  const authors = new Set(rated.map((entry) => authorKey(entry.author)).filter(Boolean));
  const eligible = materials.targets.filter((id) => {
    if (seen.has(id)) return false;
    const author = authorOf(id);
    return author === null || !authors.has(authorKey(author));
  });
  return shuffle(eligible, next).slice(0, materials.perParticipant);
}

function authorKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function mean(vectors: readonly number[][]): number[] {
  const sum = new Array<number>(vectors[0].length).fill(0);
  for (const vector of vectors) for (let index = 0; index < sum.length; index += 1) sum[index] += vector[index];
  return sum.map((value) => value / vectors.length);
}

function cosine(left: readonly number[], right: readonly number[]): number | null {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

/**
 * The profile: the sum of the rated texts' vectors weighted by interest above
 * or below the middle of the scale, after subtracting the centre of every
 * vector in play. The centring matters with this model: two short literary
 * texts sit at a cosine of 0.85 or so whatever they are about, and without it
 * the shared part would outweigh what the ratings say.
 *
 * Null when the ratings carry no direction - all at the middle, or no vectors.
 */
export function profileVector(profile: readonly { embedding: number[] | null; interest: number }[], centre: readonly number[]): number[] | null {
  const weighted = profile.filter((entry) => entry.embedding && entry.embedding.length === centre.length && entry.interest !== neutralInterest);
  if (weighted.length === 0) return null;
  const sum = new Array<number>(centre.length).fill(0);
  for (const entry of weighted) {
    const weight = entry.interest - neutralInterest;
    for (let index = 0; index < sum.length; index += 1) sum[index] += weight * (entry.embedding![index] - centre[index]);
  }
  return sum.some((value) => value !== 0) ? sum : null;
}

export type A3Ranking = {
  algorithmId: string;
  /** The clock the ranker was given, so the analysis can rank again from the snapshot. */
  rankedAt: string;
  /** Each target's similarity to the profile; null without a profile or a vector. */
  similarity: Record<string, number | null>;
  withProfile: string[];
  withoutProfile: string[];
  /** False when the five ratings carried no direction: both orders are then the same. */
  hasProfile: boolean;
};

/**
 * Both versions' order of the targets. The candidates are the snapshot's;
 * the reader is a stranger in both, so personal history, novelty and the
 * per-reader jitter are identical and only the semantic taste differs.
 */
export function rankA3(input: {
  participantId: string;
  profile: readonly A3Rating[];
  candidates: readonly A3Candidate[];
  targets: readonly string[];
  algorithmId?: string;
  now?: Date;
}): A3Ranking {
  const algorithmId = input.algorithmId ?? defaultAlgorithmId;
  const now = input.now ?? new Date();
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const inPlay = [...input.profile.map((entry) => entry.bokId), ...input.targets]
    .map((id) => byId.get(id)?.embedding)
    .filter((embedding): embedding is number[] => Array.isArray(embedding) && embedding.length > 0);
  const centre = inPlay.length ? mean(inPlay) : [];
  const profile = centre.length
    ? profileVector(input.profile.map((entry) => ({ embedding: byId.get(entry.bokId)?.embedding ?? null, interest: entry.interest })), centre)
    : null;

  const similarity: Record<string, number | null> = {};
  for (const id of input.targets) {
    const embedding = byId.get(id)?.embedding;
    const centred = embedding && embedding.length === centre.length ? embedding.map((value, index) => value - centre[index]) : null;
    const value = profile && centred ? cosine(profile, centred) : null;
    similarity[id] = value === null ? null : Math.round(value * 10000) / 10000;
  }

  const rank = (withProfile: boolean) => {
    const candidates: StoryCandidate[] = input.targets.flatMap((id) => {
      const candidate = byId.get(id);
      if (!candidate) return [];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { embedding, ...rest } = candidate;
      return [{
        ...rest,
        // The ranker reads a candidate's standing within its set, so the
        // cosine's scale does not matter; its order does.
        tasteSimilarity: withProfile ? similarity[id] : null,
        tasteSamples: withProfile && profile ? input.profile.length : 0,
        noveltyDistance: null,
      }];
    });
    return buildReaderFeed({
      visitorId: input.participantId,
      candidates,
      reader: emptyReaderSignals,
      requestedAlgorithmId: algorithmId,
      limit: candidates.length,
      now,
    }).entries.map((entry) => entry.candidate.id);
  };

  return {
    algorithmId,
    rankedAt: now.toISOString(),
    similarity,
    withProfile: rank(true),
    withoutProfile: rank(false),
    hasProfile: profile !== null,
  };
}

/**
 * NDCG@k with the gain the hypothesis states: interest minus one, discounted
 * by log2(place + 1) (Järvelin & Kekäläinen, 2002). The ideal order is the
 * participant's own ratings sorted. Null when every rating is 1: no order is
 * better than another, and the participant says nothing about the profile.
 */
export function ndcgAt(order: readonly string[], interest: Readonly<Record<string, number>>, k = 5): number | null {
  const gain = (id: string) => Math.max(0, (interest[id] ?? 1) - 1);
  const dcg = (gains: number[]) => gains.slice(0, k).reduce((sum, value, index) => sum + value / Math.log2(index + 2), 0);
  const rated = order.filter((id) => interest[id] !== undefined);
  const ideal = dcg(rated.map(gain).sort((a, b) => b - a));
  if (ideal === 0) return null;
  return dcg(rated.map(gain)) / ideal;
}
