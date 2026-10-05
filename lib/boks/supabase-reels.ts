import type { Story } from "@/components/boks/client-types";
import type {
  ReaderBokState,
  ReadingShape,
  StoryCandidate,
} from "@/lib/boks/recommendations";

/**
 * Shared row shapes and pure mappers for reels coming out of Supabase.
 *
 * These live outside `supabase-browser-data.ts` because the Worker feed route
 * and the browser degraded path must map identical rows into identical objects.
 * A second copy of this mapping is a second definition of what a boks is.
 */

/**
 * The columns a reel is read with from `published_boks`.
 *
 * One list: it was spelled out four times, in the Worker transport and three
 * places in the browser, and a column added to one silently missed the rest.
 */
export const publishedReelColumns =
  "id,title,author_name,author_handle,author_user_id,text,genre,mood,minutes,word_count,created_at,language";

export type SupabaseReelRow = {
  id: string;
  title: string;
  author_name: string;
  author_handle: string;
  author_user_id?: string | null;
  text: string;
  genre: string;
  mood: string;
  minutes: number;
  word_count?: number | null;
  created_at: string;
  /** ISO 639-1 code from the database's detector, `und` when undetermined. */
  language?: string | null;
  /**
   * Public totals: how many readers liked it and how many replied. Present
   * when the row came through an aggregate - the feed RPC or
   * `get_bok_reactions` - and absent when read straight from a table, where a
   * reader can see only their own like and so could never count the rest.
   */
  likes_count?: number;
  comments_count?: number;
};

/** The calling reader's own history with one boks, as the RPC returns it. */
export type SupabaseCandidateReaderRow = {
  seenCount: number;
  quickSkipCount: number;
  totalDwellSeconds: number;
  maxProgress: number;
  eventCount: number;
  lastEventAt: string | null;
  completedAt: string | null;
  liked: boolean;
  commented: boolean;
};

/** A row from `get_recommendation_candidates`: a reel plus its rollups. */
export type SupabaseCandidateRow = {
  id: string;
  title: string;
  genre: string;
  mood: string;
  minutes: number;
  wordCount: number;
  createdAt: string;
  body: string;
  authorName: string;
  authorHandle: string;
  impressions: number;
  starts: number;
  completes: number;
  skips: number;
  likes: number;
  shares: number;
  comments: number;
  readSecondsTotal: number;
  /** `und` when the detector could not tell. */
  language?: string;
  /** Retired opening line; the database keeps it empty. */
  hook?: string;
  hasEmbedding?: boolean;
  tasteSimilarity?: number | string | null;
  tasteSamples?: number;
  noveltyDistance?: number | string | null;
  authorUserId?: string;
  readingShape?: string;
  lineBreakCount?: number;
  authorPublishedCount?: number;
  authorFollowers?: number;
  followingAuthor?: boolean;
  mine?: SupabaseCandidateReaderRow;
};

export type CandidateSet = {
  candidates: StoryCandidate[];
  reelsById: Map<string, SupabaseReelRow>;
  /**
   * The reader's history with each candidate, keyed by boks id.
   *
   * Kept apart from the candidates because a candidate describes an item and
   * this describes a relationship. The offline harness replays one candidate
   * set against many readers, which is only possible while the two are
   * separate.
   */
  readerState: Record<string, ReaderBokState>;
  followedAuthorIds: string[];
};

const readingShapes = new Set<ReadingShape>(["verse", "short_prose", "long_prose", "unknown"]);

function toSimilarity(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toReadingShape(value: unknown): ReadingShape {
  return typeof value === "string" && readingShapes.has(value as ReadingShape)
    ? (value as ReadingShape)
    : "unknown";
}

function toReaderBokState(row: SupabaseCandidateReaderRow | undefined): ReaderBokState {
  return {
    seenCount: Number(row?.seenCount) || 0,
    quickSkipCount: Number(row?.quickSkipCount) || 0,
    totalDwellSeconds: Number(row?.totalDwellSeconds) || 0,
    maxProgress: Number(row?.maxProgress) || 0,
    eventCount: Number(row?.eventCount) || 0,
    lastEventAt: row?.lastEventAt ?? null,
    completedAt: row?.completedAt ?? null,
    liked: Boolean(row?.liked),
    commented: Boolean(row?.commented),
  };
}

export function candidatesFromRollupRows(rows: SupabaseCandidateRow[]): CandidateSet {
  const readerState: Record<string, ReaderBokState> = {};
  const followedAuthorIds = new Set<string>();

  for (const row of rows) {
    readerState[String(row.id)] = toReaderBokState(row.mine);
    if (row.followingAuthor && row.authorUserId) followedAuthorIds.add(String(row.authorUserId));
  }

  return {
    readerState,
    followedAuthorIds: [...followedAuthorIds],
    candidates: rows.map(
      (row): StoryCandidate => ({
        id: String(row.id),
        title: row.title,
        genre: row.genre,
        mood: row.mood,
        minutes: Number(row.minutes) || 5,
        wordCount: Number(row.wordCount) || 0,
        createdAt: String(row.createdAt),
        authorUserId: row.authorUserId ? String(row.authorUserId) : "",
        authorHandle: String(row.authorHandle ?? ""),
        // The byline is what author spacing keys on. Left out, a publisher's
        // whole catalogue counts as one author and the spacing does nothing.
        authorName: row.authorName ? String(row.authorName) : "",
        readingShape: toReadingShape(row.readingShape),
        lineBreakCount: Number(row.lineBreakCount) || 0,
        authorPublishedCount: Number(row.authorPublishedCount) || 0,
        authorFollowers: Number(row.authorFollowers) || 0,
        impressions: Number(row.impressions) || 0,
        starts: Number(row.starts) || 0,
        completes: Number(row.completes) || 0,
        skips: Number(row.skips) || 0,
        likes: Number(row.likes) || 0,
        shares: Number(row.shares) || 0,
        comments: Number(row.comments) || 0,
        readSecondsTotal: Number(row.readSecondsTotal) || 0,
        // `numeric` arrives as a string over PostgREST, and null means "no
        // vector on one side of the comparison", which is not the same as 0.
        hasEmbedding: Boolean(row.hasEmbedding),
        tasteSimilarity: toSimilarity(row.tasteSimilarity),
        tasteSamples: Number(row.tasteSamples) || 0,
        noveltyDistance: toSimilarity(row.noveltyDistance),
      })
    ),
    reelsById: new Map(
      rows.map((row) => [
        String(row.id),
        {
          id: String(row.id),
          title: row.title,
          author_name: row.authorName,
          author_handle: row.authorHandle,
          author_user_id: row.authorUserId ?? null,
          text: row.body,
          genre: row.genre,
          mood: row.mood,
          minutes: Number(row.minutes) || 5,
          word_count: Number(row.wordCount) || 0,
          created_at: String(row.createdAt),
          language: row.language ?? null,
          // The feed RPC already returns both totals to every reader. They
          // used to stop here, feeding the ranker only, so the rail could not
          // show a like count at all.
          likes_count: Number(row.likes) || 0,
          comments_count: Number(row.comments) || 0,
        } satisfies SupabaseReelRow,
      ])
    ),
  };
}

/**
 * Candidates built from plain reel rows, with every behavioural signal at zero.
 *
 * Used only when the rollup RPC is unavailable. The zeros are not a neutral
 * default: nine of the seventeen signals become constants, which is why a feed
 * built this way is recorded as degraded rather than treated as a normal serve.
 */
export function candidatesFromReelRows(rows: SupabaseReelRow[]): CandidateSet {
  return {
    readerState: {},
    followedAuthorIds: [],
    candidates: rows.map(
      (reel): StoryCandidate => ({
        id: reel.id,
        title: reel.title,
        genre: reel.genre,
        mood: reel.mood,
        minutes: Number(reel.minutes) || 5,
        wordCount: Number(reel.word_count) || 0,
        createdAt: reel.created_at,
        // The row has both, and without them a degraded feed loses author
        // spacing: every piece looks like a different writer.
        authorUserId: reel.author_user_id ? String(reel.author_user_id) : "",
        authorHandle: reel.author_handle,
        authorName: reel.author_name ?? "",
        readingShape: "unknown",
        lineBreakCount: 0,
        authorPublishedCount: 0,
        authorFollowers: 0,
        impressions: 0,
        starts: 0,
        completes: 0,
        skips: 0,
        likes: 0,
        shares: 0,
        comments: 0,
        readSecondsTotal: 0,
      })
    ),
    reelsById: new Map(rows.map((reel) => [reel.id, reel])),
  };
}

/**
 * A reel as the reader shows it.
 *
 * `likes` is the public total. It used to hold the reader's own like as 0 or
 * 1, which nothing read; whether *this* reader liked it travels separately, in
 * `likedStoryIds`, and `displayedLikeCount` reconciles the two on screen.
 *
 * The comment count prefers the aggregate: counting the comments that happened
 * to load undercounts once a slate carries more than the loader's cap.
 */
export function mapSupabaseReelToStory(
  reel: SupabaseReelRow,
  commentCounts = new Map<string, number>()
): Story {
  return {
    id: reel.id,
    title: reel.title,
    authorName: reel.author_name,
    authorHandle: reel.author_handle,
    authorUserId: reel.author_user_id ?? "",
    body: reel.text,
    genre: reel.genre,
    mood: reel.mood,
    minutes: reel.minutes,
    wordCount: Number(reel.word_count) || 0,
    ...(reel.language ? { language: reel.language } : {}),
    likes: reel.likes_count ?? 0,
    shares: 0,
    starts: 0,
    completes: 0,
    commentsCount: reel.comments_count ?? commentCounts.get(reel.id) ?? 0,
    avgSeconds: 0,
  };
}
