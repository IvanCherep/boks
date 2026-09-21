/**
 * Story signals are the shared vocabulary every recommendation strategy scores
 * against. A strategy never touches raw counters; it weights normalized signals.
 * That keeps a new algorithm to one small file and keeps algorithms comparable.
 *
 * Every signal is normalized to 0..1 so a weight means the same thing in every
 * strategy. Negative weights express penalties.
 */

/**
 * The form of a piece, derived from its text rather than declared by its author.
 *
 * Verse reads at a different pace from prose, so a single words-per-minute
 * constant mislabels a poem as skipped almost every time.
 */
export type ReadingShape = "verse" | "short_prose" | "long_prose" | "unknown";

export type StoryCandidate = {
  id: string;
  title: string;
  genre: string;
  mood: string;
  minutes: number;
  /** Real word count. `minutes` is a clamped estimate and cannot be inverted. */
  wordCount: number;
  createdAt: string;
  /** Account that published it. Empty for seeded demo boks. */
  authorUserId?: string;
  /**
   * Bare handle of the author. The identity of last resort for diversity:
   * seeded boks carry no account, and without this every one of them looks
   * like a different author, which disables author spacing entirely.
   */
  authorHandle?: string;
  /**
   * The byline printed on this piece, when it has one.
   *
   * It is what "who wrote it" means for diversity. An account can publish many
   * writers - a publisher's catalogue does exactly that - and once it does,
   * `authorUserId` is the same for every piece and author spacing silently
   * stops working: 463 boks under one publisher made the penalty apply to
   * every candidate equally, which is the same as applying it to none. The
   * feed then served five poems by one poet in a row.
   */
  authorName?: string;
  readingShape?: ReadingShape;
  lineBreakCount?: number;
  /** How much this author has published, for cold-start priors. */
  authorPublishedCount?: number;
  authorFollowers?: number;
  impressions: number;
  starts: number;
  completes: number;
  skips: number;
  likes: number;
  shares: number;
  comments: number;
  readSecondsTotal: number;
  /**
   * Whether this boks has a semantic vector at all. A catalogue mid-embedding
   * has both kinds, and a ranker must not read "no vector" as "no match".
   */
  hasEmbedding?: boolean;
  /**
   * Cosine similarity between this boks and the reader's taste vector, from
   * `get_recommendation_candidates`. Null when either side has no vector: the
   * reader has liked or finished nothing embedded, or this piece is not
   * embedded yet. Roughly 0..1 for this model, which normalises.
   */
  tasteSimilarity?: number | null;
  /** How many liked or finished boks the taste vector was averaged from. */
  tasteSamples?: number;
  /**
   * Cosine distance from the mean of what the reader has been reading lately,
   * halved into 0..1. High means unlike the current stretch - the way out of a
   * rut of twenty near-identical lyric poems, which genre and mood cannot see.
   */
  noveltyDistance?: number | null;
};

/**
 * What one reader has already done with one boks.
 *
 * Server-derived from the event stream, not read from browser storage: the
 * profile decides `fatigue`, `novelty` and every personalised signal, so a
 * reader on a second device was previously ranked as a stranger.
 */
export type ReaderBokState = {
  /** Sessions in which this boks was on screen. */
  seenCount: number;
  /** Skips that never became reading - under five seconds of attention. */
  quickSkipCount: number;
  totalDwellSeconds: number;
  /** Furthest scroll depth reached, 0..1. */
  maxProgress: number;
  eventCount: number;
  lastEventAt?: string | null;
  completedAt?: string | null;
  liked: boolean;
  commented: boolean;
};

export const emptyReaderBokState: ReaderBokState = {
  seenCount: 0,
  quickSkipCount: 0,
  totalDwellSeconds: 0,
  maxProgress: 0,
  eventCount: 0,
  lastEventAt: null,
  completedAt: null,
  liked: false,
  commented: false,
};

export type ReaderSignals = {
  genreAffinity: Record<string, number>;
  moodAffinity: Record<string, number>;
  completedStoryIds: string[];
  likedStoryIds: string[];
  skippedStoryIds: string[];
  /** Authors this reader follows, by account id. */
  followedAuthorIds?: string[];
  /** Per-boks history, keyed by boks id. Absent means never encountered. */
  bokState?: Record<string, ReaderBokState>;
};

export const emptyReaderSignals: ReaderSignals = {
  genreAffinity: {},
  moodAffinity: {},
  completedStoryIds: [],
  likedStoryIds: [],
  skippedStoryIds: [],
  followedAuthorIds: [],
  bokState: {},
};

export const storySignalKeys = [
  "startRate",
  "finishRate",
  "reactionRate",
  "likeRate",
  "commentRate",
  "shareRate",
  "skipRate",
  "readDepth",
  "popularity",
  "freshness",
  "exploration",
  "shortness",
  "longform",
  "tasteMatch",
  "semanticTaste",
  "semanticNovelty",
  "novelty",
  "fatigue",
  "jitter",
] as const;

export type StorySignalKey = (typeof storySignalKeys)[number];

export type StorySignals = Record<StorySignalKey, number>;

export const maxBokMinutes = 15;

/** Half-life in hours used by the `freshness` signal. */
export const freshnessHalfLifeHours = 72;

/** Impressions after which a story is no longer treated as under-tested. */
export const explorationImpressionTarget = 12;

export type FeedSignalInput = {
  candidates: StoryCandidate[];
  reader?: ReaderSignals;
  visitorId?: string;
  now?: Date;
};

/**
 * Derives normalized signals for a whole candidate set at once, because a few
 * signals (popularity) only mean something relative to the rest of the set.
 */
export function deriveFeedSignals(input: FeedSignalInput): Map<string, StorySignals> {
  const reader = input.reader ?? emptyReaderSignals;
  const visitorId = input.visitorId ?? "anonymous";
  const now = input.now ?? new Date();
  const maxStarts = Math.max(1, ...input.candidates.map((candidate) => candidate.starts));
  const affinityScale = maxAffinity(reader);
  const completed = new Set(reader.completedStoryIds);
  const skipped = new Set(reader.skippedStoryIds);
  const liked = new Set(reader.likedStoryIds);

  return new Map(
    input.candidates.map((candidate) => {
      const starts = Math.max(0, candidate.starts);
      const impressions = Math.max(starts, Math.max(0, candidate.impressions));
      const completes = Math.min(starts, Math.max(0, candidate.completes));
      const reactions = Math.max(0, candidate.likes) + Math.max(0, candidate.shares) + Math.max(0, candidate.comments);
      const estimatedSeconds = Math.max(60, candidate.minutes * 60);
      const avgReadSeconds = completes > 0 ? candidate.readSecondsTotal / completes : 0;
      const ageHours = Math.max(0, (now.getTime() - new Date(candidate.createdAt).getTime()) / 3_600_000);
      const tasteMatch = affinityScale
        ? clamp01(
            (positive(reader.genreAffinity[candidate.genre]) + positive(reader.moodAffinity[candidate.mood])) /
              (affinityScale * 2)
          )
        : 0;

      const signals: StorySignals = {
        startRate: ratio(starts, impressions),
        finishRate: ratio(completes, starts),
        reactionRate: ratio(reactions, Math.max(completes, starts)),
        likeRate: ratio(candidate.likes, Math.max(completes, starts)),
        commentRate: ratio(candidate.comments, Math.max(completes, starts)),
        shareRate: ratio(candidate.shares, Math.max(completes, starts)),
        skipRate: ratio(candidate.skips, starts + Math.max(0, candidate.skips)),
        readDepth: clamp01(avgReadSeconds / estimatedSeconds),
        popularity: clamp01(starts / maxStarts),
        freshness: Math.pow(0.5, ageHours / freshnessHalfLifeHours),
        exploration: clamp01(1 - impressions / explorationImpressionTarget),
        shortness: clamp01((maxBokMinutes - candidate.minutes) / (maxBokMinutes - 1)),
        longform: clamp01((candidate.minutes - 1) / (maxBokMinutes - 1)),
        tasteMatch,
        // Measured in the database against the reader's own vectors, so a
        // missing vector is 0 - the weighted sum then loses the term for every
        // candidate equally, which leaves the order of the others untouched.
        semanticTaste: clamp01(candidate.tasteSimilarity ?? 0),
        semanticNovelty: clamp01(candidate.noveltyDistance ?? 0),
        novelty: completed.has(candidate.id) || skipped.has(candidate.id) ? 0 : 1,
        fatigue: fatigueScore(candidate.id, completed, skipped, liked),
        jitter: deterministicUnit(`${visitorId}:${candidate.id}`),
      };

      return [candidate.id, signals] as const;
    })
  );
}

function fatigueScore(storyId: string, completed: Set<string>, skipped: Set<string>, liked: Set<string>) {
  if (skipped.has(storyId)) return 1;
  if (completed.has(storyId)) return liked.has(storyId) ? 0.5 : 0.8;
  return 0;
}

function maxAffinity(reader: ReaderSignals) {
  const scores = [...Object.values(reader.genreAffinity), ...Object.values(reader.moodAffinity)].map(positive);
  return Math.max(0, ...scores);
}

function positive(value: number | undefined) {
  return typeof value === "number" && value > 0 ? value : 0;
}

function ratio(part: number, whole: number) {
  if (!whole || whole <= 0) return 0;
  return clamp01(part / whole);
}

export function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Stable 0..1 value for a string. Same input always produces the same output. */
export function deterministicUnit(value: string) {
  return (stableHash(value) % 10_000) / 10_000;
}

export function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}
