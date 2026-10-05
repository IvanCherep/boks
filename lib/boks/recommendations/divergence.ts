import { buildReaderFeed } from "@/lib/boks/recommendations/feed";
import { listRecommendationStrategies, recommendationAlgorithmName } from "@/lib/boks/recommendations/registry";
import { emptyReaderSignals, type ReaderSignals, type StoryCandidate } from "@/lib/boks/recommendations/signals";

/**
 * Do these algorithms actually produce different feeds?
 *
 * This is the question that comes before any statistics. Comparing two rankers
 * over a catalog of tens is comparing two copies of the same list: there is
 * nothing to rank, so no sample size and no test can find a difference. That
 * failure is invisible in a metrics panel - the arms simply tie forever - so it
 * has to be measured directly.
 *
 * Run it before trusting any experiment result, and again whenever an algorithm
 * is added.
 */

export type StrategyPairDivergence = {
  leftAlgorithmId: string;
  rightAlgorithmId: string;
  leftAlgorithmName: string;
  rightAlgorithmName: string;
  /** Share of the top K that both algorithms chose, 0..1. */
  overlap: number;
  /** Rank correlation over the whole candidate set, -1..1. 1 is identical. */
  kendallTau: number;
};

export type DivergenceVerdict = "indistinguishable" | "weak" | "usable";

export type DivergenceReport = {
  candidateCount: number;
  topK: number;
  pairs: StrategyPairDivergence[];
  meanOverlap: number;
  verdict: DivergenceVerdict;
  summary: string;
};

export type DivergenceRequest = {
  candidates: StoryCandidate[];
  algorithmIds?: string[];
  reader?: ReaderSignals;
  visitorId?: string;
  topK?: number;
  now?: Date;
};

/** Above this share of shared top picks, an experiment cannot resolve anything. */
const indistinguishableOverlap = 0.8;
const weakOverlap = 0.6;

export function measureStrategyDivergence(request: DivergenceRequest): DivergenceReport {
  const algorithmIds =
    request.algorithmIds ?? listRecommendationStrategies().map((strategy) => strategy.id);
  const topK = Math.max(1, request.topK ?? 10);
  const candidateCount = request.candidates.length;

  const rankings = new Map<string, string[]>();
  for (const algorithmId of algorithmIds) {
    const feed = buildReaderFeed({
      visitorId: request.visitorId ?? "divergence-probe",
      candidates: request.candidates,
      reader: request.reader ?? emptyReaderSignals,
      experimentConfig: {
        key: "divergence-probe",
        controlAlgorithmId: algorithmId,
        arms: [{ algorithmId, weight: 100 }],
        minimumReadersPerArm: 2,
      },
      limit: Math.max(topK, candidateCount),
      now: request.now,
    });
    rankings.set(algorithmId, feed.entries.map((entry) => entry.candidate.id));
  }

  const pairs: StrategyPairDivergence[] = [];
  for (let left = 0; left < algorithmIds.length; left += 1) {
    for (let right = left + 1; right < algorithmIds.length; right += 1) {
      const leftRanking = rankings.get(algorithmIds[left]) ?? [];
      const rightRanking = rankings.get(algorithmIds[right]) ?? [];
      pairs.push({
        leftAlgorithmId: algorithmIds[left],
        rightAlgorithmId: algorithmIds[right],
        leftAlgorithmName: recommendationAlgorithmName(algorithmIds[left]),
        rightAlgorithmName: recommendationAlgorithmName(algorithmIds[right]),
        overlap: topOverlap(leftRanking, rightRanking, topK),
        kendallTau: kendallTau(leftRanking, rightRanking),
      });
    }
  }

  const meanOverlap = pairs.length
    ? round(pairs.reduce((total, pair) => total + pair.overlap, 0) / pairs.length, 3)
    : 1;

  return {
    candidateCount,
    topK,
    pairs: pairs.sort((left, right) => right.overlap - left.overlap),
    meanOverlap,
    verdict: verdictFor(meanOverlap),
    summary: summaryFor(meanOverlap, candidateCount, topK),
  };
}

function verdictFor(meanOverlap: number): DivergenceVerdict {
  if (meanOverlap >= indistinguishableOverlap) return "indistinguishable";
  if (meanOverlap >= weakOverlap) return "weak";
  return "usable";
}

function summaryFor(meanOverlap: number, candidateCount: number, topK: number) {
  const percent = Math.round(meanOverlap * 100);

  if (meanOverlap >= indistinguishableOverlap) {
    return `The algorithms agree on ${percent}% of their top ${topK} across ${candidateCount} boks. They are serving nearly the same feed, so no experiment can tell them apart. Publish more boks before reading any comparison.`;
  }
  if (meanOverlap >= weakOverlap) {
    return `The algorithms agree on ${percent}% of their top ${topK} across ${candidateCount} boks. There is some room to measure, but a real difference will be small and slow to show.`;
  }
  return `The algorithms agree on only ${percent}% of their top ${topK} across ${candidateCount} boks. They are genuinely different feeds, so a comparison can resolve something.`;
}

/** Share of the first `k` positions that both rankings chose, in any order. */
function topOverlap(left: string[], right: string[], k: number) {
  const leftTop = new Set(left.slice(0, k));
  const rightTop = right.slice(0, k);
  if (!leftTop.size || !rightTop.length) return 1;

  const shared = rightTop.filter((id) => leftTop.has(id)).length;
  return round(shared / Math.min(k, Math.max(leftTop.size, rightTop.length)), 3);
}

/**
 * Kendall tau over the items both rankings contain: how often the two orderings
 * agree about which of a pair comes first. Positions in a ranking are unique,
 * so there are no ties and tau-a and tau-b coincide.
 *
 * Fewer than two shared items carry no ordering information at all, which is
 * 0 (no association), not 1 ("identical").
 */
export function kendallTau(left: string[], right: string[]) {
  const rightPosition = new Map(right.map((id, index) => [id, index]));
  const shared = left.filter((id) => rightPosition.has(id));
  if (shared.length < 2) return 0;

  let concordant = 0;
  let discordant = 0;

  for (let first = 0; first < shared.length; first += 1) {
    for (let second = first + 1; second < shared.length; second += 1) {
      const rightFirst = rightPosition.get(shared[first]) as number;
      const rightSecond = rightPosition.get(shared[second]) as number;
      if (rightFirst === rightSecond) continue;
      if (rightFirst < rightSecond) concordant += 1;
      else discordant += 1;
    }
  }

  const pairs = concordant + discordant;
  if (!pairs) return 1;
  return round((concordant - discordant) / pairs, 3);
}

function round(value: number, digits: number) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
