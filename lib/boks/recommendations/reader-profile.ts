import {
  emptyReaderBokState,
  type ReaderBokState,
  type ReaderSignals,
  type ReadingShape,
  type StoryCandidate,
} from "@/lib/boks/recommendations/signals";

/**
 * The reader profile the `for_you` ranker scores against.
 *
 * Ported from the original boks backend, where it was a scheduled SQL refresh
 * into a `for_you_profile` table. It is a pure function here for the same
 * reason the rest of the ranking is: a profile that can be recomputed from its
 * inputs can be replayed, and a serve can be reproduced months later.
 *
 * The shape of the model is unchanged from the original: each (reader, boks)
 * pair contributes a positive and a negative weight, both decayed by recency,
 * and the net is aggregated along three dimensions - author, reading shape and
 * length bucket.
 */

export type LengthBucket = "extra_short" | "short" | "medium" | "long";

export type ReaderProfile = {
  authorAffinity: Record<string, number>;
  shapeAffinity: Partial<Record<ReadingShape, number>>;
  lengthAffinity: Partial<Record<LengthBucket, number>>;
  /**
   * Total positive evidence about this reader. Gates how far personalisation
   * is trusted: a reader with nothing behind them gets heuristics at a fifth
   * strength, which is what stops a cold start from looking like a preference.
   */
  personalizationStrength: number;
  totalNegativeWeight: number;
  /** Median-ish preferred length, or null while there is no evidence. */
  preferredReadMinutes: number | null;
};

export const emptyReaderProfile: ReaderProfile = {
  authorAffinity: {},
  shapeAffinity: {},
  lengthAffinity: {},
  personalizationStrength: 0,
  totalNegativeWeight: 0,
  preferredReadMinutes: null,
};

export function lengthBucketFor(minutes: number): LengthBucket {
  if (minutes <= 1) return "extra_short";
  if (minutes <= 3) return "short";
  if (minutes <= 6) return "medium";
  return "long";
}

/** Ordinal used to tell a compact piece from a demanding one. */
export function compactnessBand(bucket: LengthBucket) {
  if (bucket === "extra_short") return 0;
  if (bucket === "short") return 1;
  if (bucket === "medium") return 2;
  return 3;
}

export function readerBokState(reader: ReaderSignals, storyId: string): ReaderBokState {
  return reader.bokState?.[storyId] ?? emptyReaderBokState;
}

export function isFollowingAuthor(reader: ReaderSignals, candidate: StoryCandidate) {
  if (!candidate.authorUserId) return false;
  return (reader.followedAuthorIds ?? []).includes(candidate.authorUserId);
}

/**
 * Evidence that this reader wanted this boks.
 *
 * Finishing is worth more than liking, and liking more than dwelling: an
 * explicit act is a stronger statement than time, which a distracted reader
 * produces by accident.
 */
export function positiveWeight(state: ReaderBokState, following: boolean) {
  const progressPct = clamp(state.maxProgress, 0, 1) * 100;
  const dwellMs = Math.max(0, state.totalDwellSeconds) * 1000;

  return (
    (state.completedAt ? 2.6 : 0) +
    (state.commented ? 1.9 : 0) +
    (state.liked ? 1.4 : 0) +
    Math.min(1.1, Math.max(progressPct - 15, 0) / 60) +
    Math.min(0.9, Math.max(dwellMs - 4000, 0) / 90_000) +
    (following ? 0.8 : 0)
  );
}

/**
 * Evidence that this reader did not want it.
 *
 * Any explicit positive act cancels the negative entirely: a reader who
 * finished a piece and later scrolled past it is not rejecting it. Repeated
 * exposure without attention is the strongest implicit negative available
 * while explicit "not interested" does not exist in this product yet.
 */
export function negativeWeight(state: ReaderBokState, following: boolean) {
  if (state.completedAt || state.commented || state.liked || following) return 0;

  const progressPct = clamp(state.maxProgress, 0, 1) * 100;
  const dwellMs = Math.max(0, state.totalDwellSeconds) * 1000;

  if (state.quickSkipCount >= 3 && progressPct < 12 && dwellMs < 8000) return 2.0;
  if (state.quickSkipCount >= 2 && progressPct < 15 && dwellMs < 10_000) return 1.35;
  if (state.quickSkipCount >= 1 && state.seenCount === 0 && progressPct <= 5 && dwellMs < 2500) return 0.75;
  if (state.seenCount >= 4 && progressPct < 12 && dwellMs < 12_000) return 2.1;
  if (state.seenCount >= 3 && progressPct < 15 && dwellMs < 15_000) return 1.6;
  if (state.seenCount >= 2 && progressPct < 18 && dwellMs < 10_000) return 1.0;
  if (state.seenCount >= 1 && state.eventCount >= 2 && progressPct <= 5 && dwellMs < 4000) return 0.45;
  return 0;
}

/** Older evidence counts for less, in four steps rather than a curve. */
export function recencyWeight(signalAt: string | null | undefined, now: Date) {
  if (!signalAt) return 0.2;
  const ageDays = (now.getTime() - Date.parse(signalAt)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return 0.2;
  if (ageDays <= 7) return 1.0;
  if (ageDays <= 30) return 0.7;
  if (ageDays <= 90) return 0.45;
  return 0.2;
}

export type ReaderProfileInput = {
  reader: ReaderSignals;
  candidates: StoryCandidate[];
  now?: Date;
};

export function buildReaderProfile(input: ReaderProfileInput): ReaderProfile {
  const now = input.now ?? new Date();
  const byAuthor = new Map<string, { net: number; count: number }>();
  const byShape = new Map<ReadingShape, number>();
  const byLength = new Map<LengthBucket, number>();
  const preferredMinutes: { minutes: number; weight: number }[] = [];

  let personalizationStrength = 0;
  let totalNegativeWeight = 0;

  for (const candidate of input.candidates) {
    const state = readerBokState(input.reader, candidate.id);
    if (!state.eventCount && !state.liked && !state.commented && !state.completedAt) continue;

    const following = isFollowingAuthor(input.reader, candidate);
    const recency = recencyWeight(state.lastEventAt ?? state.completedAt, now);
    const positive = positiveWeight(state, following) * recency;
    const negative = negativeWeight(state, following) * recency;
    const net = positive - negative;

    personalizationStrength += positive;
    totalNegativeWeight += negative;

    if (candidate.authorUserId) {
      const entry = byAuthor.get(candidate.authorUserId) ?? { net: 0, count: 0 };
      entry.net += net;
      entry.count += 1;
      byAuthor.set(candidate.authorUserId, entry);
    }

    const shape = candidate.readingShape ?? "unknown";
    byShape.set(shape, (byShape.get(shape) ?? 0) + net);

    const bucket = lengthBucketFor(candidate.minutes);
    byLength.set(bucket, (byLength.get(bucket) ?? 0) + net);

    if (positive > 0) preferredMinutes.push({ minutes: candidate.minutes, weight: positive });
  }

  const authorAffinity: Record<string, number> = {};
  for (const [authorId, entry] of byAuthor) {
    // Divided by the square root of the count: an author a reader has met ten
    // times should not dominate one they met twice by a factor of five.
    const affinity = entry.net / Math.max(1, Math.sqrt(entry.count));
    if (Math.abs(affinity) > 0.01) authorAffinity[authorId] = round(affinity, 4);
  }

  const shapeAffinity: Partial<Record<ReadingShape, number>> = {};
  for (const [shape, net] of byShape) {
    if (Math.abs(net) > 0.01) shapeAffinity[shape] = round(net, 4);
  }

  const lengthAffinity: Partial<Record<LengthBucket, number>> = {};
  for (const [bucket, net] of byLength) {
    if (Math.abs(net) > 0.01) lengthAffinity[bucket] = round(net, 4);
  }

  const weightTotal = preferredMinutes.reduce((total, entry) => total + entry.weight, 0);

  return {
    authorAffinity,
    shapeAffinity,
    lengthAffinity,
    personalizationStrength: round(personalizationStrength, 4),
    totalNegativeWeight: round(totalNegativeWeight, 4),
    preferredReadMinutes: weightTotal
      ? round(
          preferredMinutes.reduce((total, entry) => total + entry.minutes * entry.weight, 0) / weightTotal,
          2
        )
      : null,
  };
}

function clamp(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function round(value: number, digits: number) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
