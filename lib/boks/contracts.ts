/**
 * Product vocabulary shared by every surface and backend. This file must not
 * import anything, so it can be read from browser, worker and test code alike.
 */

export const readerEventTypes = [
  "impression",
  "start",
  "complete",
  "like",
  "share",
  "skip",
  "comment",
  "publish",
  "preference",
  /**
   * Periodic proof of life while a boks is open. Without it, a reader who
   * lingers and then closes the tab contributes no reading time at all.
   */
  "heartbeat",
  /**
   * What a boks left the reader with, in their own words from a short list.
   * Carries `metadata.tags`; see `aftertasteTags`.
   */
  "aftertaste",
] as const;

export type ReaderEventType = (typeof readerEventTypes)[number];

/**
 * The aftertaste vocabulary.
 *
 * Four words, chosen so that none of them is "good" or "bad". A reader who
 * wants to think about a piece has not enjoyed it less than one who smiled,
 * and a rating would flatten that difference into a number which is exactly
 * the thing the recommender should not be learning from here.
 *
 * Several may be picked, and picking none is an answer too - it just is not
 * one anybody has to give.
 */
export const aftertasteTags = ["smiled", "moved", "surprised", "pondering"] as const;

export type AftertasteTag = (typeof aftertasteTags)[number];

const aftertasteTagSet = new Set<string>(aftertasteTags);

export function isAftertasteTag(value: unknown): value is AftertasteTag {
  return typeof value === "string" && aftertasteTagSet.has(value);
}

export const eventTypes = new Set<string>(readerEventTypes);

export function isReaderEventType(value: unknown): value is ReaderEventType {
  return typeof value === "string" && eventTypes.has(value);
}

/**
 * The 15-minute promise, as a character ceiling.
 *
 * 15 minutes at 238 words per minute is about 3,570 words; an English word with
 * its trailing space averages close to 5.7 characters. Characters rather than
 * words because this has to hold at the edge of the system, where a check
 * constraint and a request-size limit enforce it identically every time.
 * `minutes` stays derived from the real word count, which is the better measure
 * of reading time.
 *
 * Must match `boks_max_text_characters()` in the database.
 */
export const maxBokCharacters = 20_000;

export const minHandleLength = 3;
export const maxHandleLength = 24;

/**
 * A nickname is the only public identity boks has: it is what appears under
 * every boks, in every comment and on every author page. So it is restricted
 * to what reads unambiguously as a name - English letters, digits and
 * underscores, starting with a letter.
 *
 * Must match `boks_handle_is_valid()` and the `user_profiles_handle_format`
 * constraint in the database.
 */
export const boksHandlePattern = /^[a-z][a-z0-9_]{2,23}$/;

export function isValidBoksHandle(handle: string) {
  return boksHandlePattern.test(handle);
}

/**
 * One sentence naming the rule the nickname breaks, or null when it is fine.
 * The messages match what `update_boks_user_profile` raises, so a reader is
 * told the same thing whichever side refuses first.
 */
export function describeBoksHandleProblem(handle: string) {
  if (!handle) return "Enter a nickname.";
  if (handle.length < minHandleLength) return `A nickname needs at least ${minHandleLength} characters.`;
  if (handle.length > maxHandleLength) return `A nickname can be at most ${maxHandleLength} characters.`;
  // Alphabet before position: someone who typed Cyrillic did start with a
  // letter, so naming the first character would point at the wrong mistake.
  if (!/^[a-z0-9_]+$/.test(handle)) return "A nickname can only use English letters, numbers and underscores.";
  if (!isValidBoksHandle(handle)) return "A nickname has to start with a letter.";
  return null;
}

export type UserSegment = "general" | "new_reader" | "quick_reads" | "deep_reads";

/**
 * One attributed behavior signal. Every field below is required before a event
 * can be used to compare recommendation algorithms - see
 * `specs/boks-recommendation-experiments.md`.
 */
export type ReaderEvent = {
  eventType: ReaderEventType;
  storyId: string;
  /** Read seconds for `complete`, otherwise 1. */
  value: number;
  /**
   * Foreground-only reading seconds, cumulative for this (session, boks).
   * Cumulative rather than incremental so that a duplicate, a retry or a lost
   * event costs nothing: every rollup takes the maximum, never the sum.
   */
  activeSeconds: number;
  /** How far down the boks the reader got, 0..1. */
  progress: number;
  algorithmId: string;
  experimentKey: string;
  userSegment: string;
  surface: "reader" | "author" | "admin";
  /** Zero-based position of the story in the delivered feed. */
  rank: number;
  clientElapsedSeconds: number;
  sessionId: string;
  visitorId: string;
  /** Expected reading seconds for this boks at a fixed 238 wpm. */
  estimatedSeconds: number;
  /**
   * The served feed this event belongs to (ADR-001).
   *
   * Absent when provenance could not be written, which is a condition the
   * data-quality panel counts rather than one the reader ever notices. The
   * database drops a feed id that does not belong to the caller, so this is a
   * hint, never an authority.
   */
  feedId?: string | null;
  /** Which path served the feed: `worker` or `browser`. */
  servingBackend?: string;
  /** The read/skip inference rules in force when this event was labelled. */
  labelingVersion?: string;
  /** Under interleaving, the ranker that drafted this slot. */
  creditedAlgorithmId?: string | null;
  metadata?: Record<string, unknown>;
};

export type AdminPagination = {
  limit: number;
  offset: number;
  sort: string;
  query: string;
};

/** Boks an author may submit in one calendar day, in the author's own day. */
export const dailyBokSubmissionLimit = 3;
