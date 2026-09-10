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
        COALESCE(AVG(CASE WHEN event_type = 'complete' THEN value END), 0) AS avgSeconds
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

export function algorithmMetricsSql() {
  return `
    SELECT
      e.algorithm_id AS algorithmId,
      e.user_segment AS userSegment,
      COUNT(DISTINCT e.visitor_id) AS visitors,
      SUM(CASE WHEN e.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
      SUM(CASE WHEN e.event_type = 'start' THEN 1 ELSE 0 END) AS starts,
      SUM(CASE WHEN e.event_type = 'complete' THEN 1 ELSE 0 END) AS completes,
      SUM(CASE WHEN e.event_type = 'like' THEN 1 ELSE 0 END) AS likes,
      SUM(CASE WHEN e.event_type = 'share' THEN 1 ELSE 0 END) AS shares,
      SUM(CASE WHEN e.event_type = 'skip' THEN 1 ELSE 0 END) AS skips,
      SUM(CASE WHEN e.event_type = 'comment' THEN 1 ELSE 0 END) AS comments,
      ROUND(COALESCE(AVG(CASE WHEN e.event_type = 'complete' THEN e.value END), 0)) AS avgReadSeconds,
      ROUND(COALESCE(AVG(CASE WHEN e.event_type = 'like' AND e.client_elapsed_seconds > 0 THEN e.client_elapsed_seconds END), 0)) AS avgSecondsToLike,
      ROUND(COALESCE(AVG(CASE WHEN e.event_type = 'comment' AND e.client_elapsed_seconds > 0 THEN e.client_elapsed_seconds END), 0)) AS avgSecondsToComment,
      ROUND(COALESCE(AVG(CASE WHEN e.event_type = 'start' THEN e.rank END), 0), 1) AS avgStartRank,
      ROUND(COALESCE(AVG(CASE WHEN e.event_type = 'complete' AND e.value > 0 THEN s.minutes * 60.0 / e.value END), 0), 2) AS paceIndex,
      CASE
        WHEN SUM(CASE WHEN e.event_type = 'impression' THEN 1 ELSE 0 END) > 0
        THEN ROUND(SUM(CASE WHEN e.event_type = 'start' THEN 1 ELSE 0 END) * 100.0 / SUM(CASE WHEN e.event_type = 'impression' THEN 1 ELSE 0 END))
        ELSE 0
      END AS startRate,
      CASE
        WHEN SUM(CASE WHEN e.event_type = 'start' THEN 1 ELSE 0 END) > 0
        THEN ROUND(SUM(CASE WHEN e.event_type = 'complete' THEN 1 ELSE 0 END) * 100.0 / SUM(CASE WHEN e.event_type = 'start' THEN 1 ELSE 0 END))
        ELSE 0
      END AS finishRate,
      CASE
        WHEN SUM(CASE WHEN e.event_type = 'complete' THEN 1 ELSE 0 END) > 0
        THEN ROUND((SUM(CASE WHEN e.event_type IN ('like', 'share', 'comment') THEN 1 ELSE 0 END)) * 100.0 / SUM(CASE WHEN e.event_type = 'complete' THEN 1 ELSE 0 END))
        ELSE 0
      END AS reactionRate,
      CASE
        WHEN SUM(CASE WHEN e.event_type IN ('start', 'skip') THEN 1 ELSE 0 END) > 0
        THEN ROUND(SUM(CASE WHEN e.event_type = 'skip' THEN 1 ELSE 0 END) * 100.0 / SUM(CASE WHEN e.event_type IN ('start', 'skip') THEN 1 ELSE 0 END))
        ELSE 0
      END AS skipRate,
      (
        SUM(CASE WHEN e.event_type = 'complete' THEN 7 ELSE 0 END) +
        SUM(CASE WHEN e.event_type = 'like' THEN 5 ELSE 0 END) +
        SUM(CASE WHEN e.event_type = 'share' THEN 5 ELSE 0 END) +
        SUM(CASE WHEN e.event_type = 'comment' THEN 8 ELSE 0 END) -
        SUM(CASE WHEN e.event_type = 'skip' THEN 3 ELSE 0 END)
      ) AS engagementScore
    FROM events e
    LEFT JOIN stories s ON s.id = e.story_id
    WHERE e.algorithm_id != 'unassigned'
    GROUP BY e.algorithm_id, e.user_segment
    ORDER BY engagementScore DESC, visitors DESC
    LIMIT 60`;
}
