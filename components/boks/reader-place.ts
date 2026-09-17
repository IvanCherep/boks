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
