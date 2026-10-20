/**
 * Version stamps written onto every served feed.
 *
 * A result is only reproducible if the code that produced it can be named. Each
 * constant below is bumped when the *meaning* of the thing it names changes —
 * never for a refactor that leaves outputs identical, because a spurious bump
 * splits a dataset that should have stayed comparable.
 *
 * Changelog lives here so a query can be written against a version string
 * without reading git history.
 *
 *   signals.v1   17 normalised story signals (2026-09-12)
 *   ranking.v1   weighted-sum strategies + fatigue tiering (2026-09-12)
 *   labeling.v1  read/skip inference at a fixed 238 wpm against word_count:
 *                skip below 25% of expected time, complete at 85% progress and
 *                40% of expected time, or at 70% of expected time without it
 *                (2026-09-12)
 *   ranking.v2   every strategy reads the server-side reader history
 *                (`bokState`) for fatigue and novelty, not only the browser's;
 *                `for_you`'s exploration budget ages a piece against serving
 *                time instead of its own creation time; a stored arm naming a
 *                strategy this build lacks is re-attributed to the one that
 *                actually ranked (2026-10-05)
 *   labeling.v2  skip below 15% of expected time (floor 4 s); complete when
 *                scrolled to 85% at any pace above that, at 30% without
 *                anything to scroll, or at 60% of expected time otherwise
 *                (2026-10-20)
 *   ranking.v3   `for_you` serves everything the reader has never been shown
 *                before anything shown in an earlier visit, and finished pieces
 *                last; part-read pieces are no longer resumed to the top
 *                (2026-10-20)
 */
export const SIGNALS_VERSION = "signals.v1";
export const RANKING_VERSION = "ranking.v3";
export const LABELING_VERSION = "labeling.v2";
