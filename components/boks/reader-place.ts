import type { Story } from "@/components/boks/client-types";

/**
 * Where a reader is in the feed is an index into a ranking, and every reload
 * re-ranks. So the same index can land on a different boks: liking, sharing or
 * commenting all refresh the feed, and any of them could otherwise move the
 * reader off the piece they were acting on.
 *
 * The reader's place is therefore pinned by boks id across a reload and the
 * index is recovered from it here.
 */
export function recoverReaderPlace(rankedIds: readonly string[], pinnedId: string | null, currentIndex: number) {
  if (!pinnedId || !rankedIds.length) return currentIndex;

  const recovered = rankedIds.indexOf(pinnedId);
  // A boks can leave the ranking - unpublished, or ranked out of the slate.
  // Holding the index is then the least surprising thing left to do.
  return recovered >= 0 ? recovered : currentIndex;
}

/**
 * Recovering the index is not enough when the boks is gone from the new
 * ranking - and after a like it usually is. A like raises the boks's fatigue,
 * fatigue sends it behind every piece the reader has not seen, and with a
 * catalogue several times the size of the slate that is past the slate's end.
 * Holding the index then showed whichever boks now sat there: the reader
 * tapped the heart and was moved to a stranger's piece.
 *
 * So the boks being acted on is carried into the new ranking at the reader's
 * place. Nothing is inserted into an empty ranking - that is a feed still
 * loading, not one that dropped the boks.
 */
export type HeldPlace<T extends { id: string } = Story> = { story: T; index: number };

/**
 * Places one boks opened from history or a shared surface into the current
 * recommendation sequence. It is an entry point, not a second feed: the item
 * after it is the recommendation that was already at this position.
 *
 * Only one entry is accepted so repeatedly opening library items cannot build
 * a hidden history queue after the recommendation slate.
 */
export function placeEntryStory<T extends { id: string }>(
  recommendations: readonly T[],
  entry: HeldPlace<T> | null
): T[] {
  if (!entry) return [...recommendations];

  const withoutEntry = recommendations.filter((story) => story.id !== entry.story.id);
  const at = Math.min(Math.max(entry.index, 0), withoutEntry.length);
  return [...withoutEntry.slice(0, at), entry.story, ...withoutEntry.slice(at)];
}

export function holdPinnedStory<T extends { id: string }>(ranked: readonly T[], held: HeldPlace<T> | null): T[] {
  if (!held || !ranked.length || ranked.some((story) => story.id === held.story.id)) return [...ranked];
  const at = Math.min(Math.max(held.index, 0), ranked.length);
  return [...ranked.slice(0, at), held.story, ...ranked.slice(at)];
}

/**
 * The reader's whole sequence, composed in one place: the ranked feed, the one
 * boks opened from history or a link, the boks carried through a reload - and
 * none of the boks an admin hid during this visit.
 *
 * A hidden boks is gone from the server at once, but the page already holds
 * it: in the feed, possibly as the held boks. Filtering it here, after every
 * insertion, means no path can put it back on screen, and the boks that
 * followed it moves up into its place - the admin lands on the next piece.
 */
export function composeReaderRanking<T extends { id: string }>(
  feed: readonly T[],
  entry: HeldPlace<T> | null,
  held: HeldPlace<T> | null,
  removed: ReadonlySet<string> = new Set()
): T[] {
  const ranked = holdPinnedStory(placeEntryStory(feed, entry), held);
  return removed.size ? ranked.filter((story) => !removed.has(story.id)) : ranked;
}
