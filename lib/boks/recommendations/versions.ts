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
 */
export const SIGNALS_VERSION = "signals.v1";
export const RANKING_VERSION = "ranking.v1";
export const LABELING_VERSION = "labeling.v1";
