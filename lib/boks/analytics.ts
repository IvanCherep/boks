export function metricRollups() {
  return `
    WITH event_rollup AS (
      SELECT
        story_id,
        SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
        SUM(CASE WHEN event_type = 'like' THEN 1 ELSE 0 END) AS likes,
        SUM(CASE WHEN event_type = 'share' THEN 1 ELSE 0 END) AS shares,
        SUM(CASE WHEN event_type = 'start' THEN 1 ELSE 0 END) AS starts,
        SUM(CASE WHEN event_type = 'complete' THEN 1 ELSE 0 END) AS completes,
        SUM(CASE WHEN event_type = 'skip' THEN 1 ELSE 0 END) AS skips,
        COALESCE(AVG(CASE WHEN event_type = 'complete' THEN value END), 0) AS avgSeconds,
        COALESCE(SUM(CASE WHEN event_type = 'complete' THEN value END), 0) AS readSecondsTotal
      FROM events
      GROUP BY story_id
    ),
    comment_rollup AS (
      SELECT story_id, COUNT(*) AS comments
      FROM comments
      GROUP BY story_id
    )`;
}

export function storyMetricSelect(includeBody: boolean) {
  return `
    s.id,
    s.title,
    s.author_name AS authorName,
    s.author_handle AS authorHandle,
    s.hook,
    ${includeBody ? "s.body," : "'' AS body,"}
    s.genre,
    s.mood,
    s.minutes,
    (LENGTH(TRIM(s.body)) - LENGTH(REPLACE(TRIM(s.body), ' ', '')) + 1) AS wordCount,
    s.status,
    s.is_seed AS isSeed,
    s.created_at AS createdAt,
    COALESCE(er.impressions, 0) AS impressions,
    COALESCE(er.likes, 0) AS likes,
    COALESCE(er.shares, 0) AS shares,
    COALESCE(er.starts, 0) AS starts,
    COALESCE(er.completes, 0) AS completes,
    COALESCE(er.skips, 0) AS skips,
    COALESCE(cr.comments, 0) AS commentsCount,
    COALESCE(cr.comments, 0) AS comments,
    COALESCE(er.avgSeconds, 0) AS avgSeconds,
    (
      COALESCE(er.completes, 0) * 4 +
      COALESCE(er.likes, 0) * 5 +
      COALESCE(er.shares, 0) * 4 +
      COALESCE(cr.comments, 0) * 6 -
      MAX(0, COALESCE(er.starts, 0) - COALESCE(er.completes, 0))
    ) AS signal,
    CASE
      WHEN COALESCE(er.starts, 0) > 0 THEN MIN(100, ROUND(COALESCE(er.completes, 0) * 100.0 / er.starts))
      ELSE 0
    END AS finishRate`;
}

export function adminOrder(sort: string) {
  if (sort === "finish") return "finishRate DESC, starts DESC, s.created_at DESC";
  if (sort === "starts") return "starts DESC, impressions DESC, s.created_at DESC";
  if (sort === "comments") return "commentsCount DESC, starts DESC, s.created_at DESC";
  if (sort === "newest") return "s.created_at DESC";
  if (sort === "title") return "LOWER(s.title) ASC";
  return "signal DESC, starts DESC, s.created_at DESC";
}

/**
 * Candidate rollups for the D1 compatibility feed, in the shape
 * `lib/boks/recommendations` ranks. Ordering and scoring deliberately stay out
 * of SQL so both backends share one strategy implementation.
 */
export function storyCandidateSelect() {
  return `
    s.id,
    s.title,
    s.genre,
    s.mood,
    s.minutes,
    (LENGTH(TRIM(s.body)) - LENGTH(REPLACE(TRIM(s.body), ' ', '')) + 1) AS wordCount,
    s.created_at AS createdAt,
    COALESCE(er.impressions, 0) AS impressions,
    COALESCE(er.starts, 0) AS starts,
    COALESCE(er.completes, 0) AS completes,
    COALESCE(er.skips, 0) AS skips,
    COALESCE(er.likes, 0) AS likes,
    COALESCE(er.shares, 0) AS shares,
    COALESCE(cr.comments, 0) AS comments,
    COALESCE(er.readSecondsTotal, 0) AS readSecondsTotal`;
}

