import { getD1 } from "@/db";
import { metricRollups, storyCandidateSelect, storyMetricSelect } from "@/lib/boks/analytics";
import { eventTypes } from "@/lib/boks/contracts";
import {
  buildReaderFeed,
  describeRecommendationStrategies,
  type StoryCandidate,
} from "@/lib/boks/recommendations";
import { cleanText, integerPayload, numberParam, searchPattern } from "@/lib/boks/request";
import { HttpRequestError, readBoundedJsonObject } from "@/lib/boks/http-security";
import { seedStories } from "@/lib/boks/seed-stories";

export const dynamic = "force-dynamic";

/** Demo inventory as ranking candidates, used when no D1 binding exists. */
function seedStoryCandidates(limit: number): StoryCandidate[] {
  return seedStories.slice(0, limit).map((story) => ({
    id: story.id,
    title: story.title,
    genre: story.genre,
    mood: story.mood,
    minutes: story.minutes,
    wordCount: story.body.split(/\s+/).filter(Boolean).length,
    createdAt: new Date().toISOString(),
    impressions: 0,
    starts: 0,
    completes: 0,
    skips: 0,
    likes: 0,
    shares: 0,
    comments: 0,
    readSecondsTotal: 0,
  }));
}

function seedStoryRows(limit: number, rankedIds: string[] = []) {
  const order = new Map(rankedIds.map((id, index) => [id, index]));
  return seedStories
    .slice(0, limit)
    .sort((left, right) => (order.get(left.id) ?? limit) - (order.get(right.id) ?? limit))
    .map((story) => ({
      id: story.id,
      title: story.title,
      authorName: story.authorName,
      authorHandle: story.authorHandle,
      hook: story.hook,
      body: story.body,
      genre: story.genre,
      mood: story.mood,
      minutes: story.minutes,
      wordCount: story.body.split(/\s+/).filter(Boolean).length,
      likes: 0,
      shares: 0,
      starts: 0,
      completes: 0,
      commentsCount: 0,
      avgSeconds: 0,
    }));
}

async function ensureSeedStories(db: D1Database) {
  await db.batch(
    seedStories.map((story) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO stories
          (id, title, author_name, author_handle, hook, body, genre, mood, minutes, status, is_seed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1)`
        )
        .bind(
          story.id,
          story.title,
          story.authorName,
          story.authorHandle,
          story.hook,
          story.body,
          story.genre,
          story.mood,
          story.minutes
        )
    )
  );
}

/**
 * Fetches candidates with their rollups. Ordering is not SQL's job here: the
 * feed is ranked by `buildReaderFeed` so the D1 compatibility path and the
 * Supabase production path run the identical strategy code.
 */
async function getStoryCandidates(db: D1Database, limit: number): Promise<StoryCandidate[]> {
  const result = await db
    .prepare(
      `${metricRollups()}
      SELECT ${storyCandidateSelect()}
      FROM stories s
      LEFT JOIN event_rollup er ON er.story_id = s.id
      LEFT JOIN comment_rollup cr ON cr.story_id = s.id
      WHERE s.status = 'published'
      ORDER BY s.created_at DESC
      LIMIT ?`
    )
    .bind(limit)
    .all();

  return (result.results ?? []).map((row) => {
    const candidate = row as Record<string, unknown>;
    return {
      id: String(candidate.id),
      title: String(candidate.title ?? ""),
      genre: String(candidate.genre ?? "literary"),
      mood: String(candidate.mood ?? "quiet"),
      minutes: Number(candidate.minutes) || 5,
      wordCount: Number(candidate.wordCount) || 0,
      createdAt: String(candidate.createdAt ?? new Date().toISOString()),
      impressions: Number(candidate.impressions) || 0,
      starts: Number(candidate.starts) || 0,
      completes: Number(candidate.completes) || 0,
      skips: Number(candidate.skips) || 0,
      likes: Number(candidate.likes) || 0,
      shares: Number(candidate.shares) || 0,
      comments: Number(candidate.comments) || 0,
      readSecondsTotal: Number(candidate.readSecondsTotal) || 0,
    } satisfies StoryCandidate;
  });
}

/** Full story rows for the ids the ranking chose, in ranked order. */
async function getStoriesByRankedIds(db: D1Database, rankedIds: string[]) {
  if (!rankedIds.length) return [];
  const placeholders = rankedIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `${metricRollups()}
      SELECT ${storyMetricSelect(true)}
      FROM stories s
      LEFT JOIN event_rollup er ON er.story_id = s.id
      LEFT JOIN comment_rollup cr ON cr.story_id = s.id
      WHERE s.id IN (${placeholders})`
    )
    .bind(...rankedIds)
    .all();

  const byId = new Map((result.results ?? []).map((row) => [String((row as { id: unknown }).id), row]));
  return rankedIds.map((id) => byId.get(id)).filter(Boolean) as Array<Record<string, unknown>>;
}

async function getComments(db: D1Database, storyIds: string[]) {
  if (!storyIds.length) return [];
  const placeholders = storyIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT
        id,
        story_id AS storyId,
        visitor_id AS visitorId,
        visitor_name AS visitorName,
        body,
        created_at AS createdAt
      FROM comments
      WHERE story_id IN (${placeholders})
      ORDER BY created_at DESC
      LIMIT 120`
    )
    .bind(...storyIds)
    .all();

  return result.results ?? [];
}

async function getAdminStoryCount(db: D1Database, query: string) {
  const pattern = searchPattern(query);
  const where = query
    ? `WHERE s.status = 'published' AND (
        LOWER(s.title) LIKE ? OR
        LOWER(s.author_name) LIKE ? OR
        LOWER(s.genre) LIKE ? OR
        LOWER(s.mood) LIKE ?
      )`
    : "WHERE s.status = 'published'";
  const statement = db.prepare(`SELECT COUNT(*) AS total FROM stories s ${where}`);
  const row = query
    ? await statement.bind(pattern, pattern, pattern, pattern).first<{ total: number }>()
    : await statement.first<{ total: number }>();
  return row?.total ?? 0;
}

async function getMetrics(
  db: D1Database,
  storyRows: Array<Record<string, unknown>>,
  totalStories: number,
  pagination: { limit: number; offset: number; sort: string; query: string }
) {
  const [funnel, genreMetrics, moodMetrics, recentEvents] = await Promise.all([
    db
      .prepare(
        `SELECT
          COUNT(DISTINCT visitor_id) AS visitors,
          SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
          SUM(CASE WHEN event_type = 'start' THEN 1 ELSE 0 END) AS starts,
          SUM(CASE WHEN event_type = 'complete' THEN 1 ELSE 0 END) AS completes,
          SUM(CASE WHEN event_type = 'like' THEN 1 ELSE 0 END) AS likes,
          SUM(CASE WHEN event_type = 'share' THEN 1 ELSE 0 END) AS shares,
          SUM(CASE WHEN event_type = 'skip' THEN 1 ELSE 0 END) AS skips,
          SUM(CASE WHEN event_type = 'comment' THEN 1 ELSE 0 END) AS comments,
          COALESCE(AVG(CASE WHEN event_type = 'complete' THEN value END), 0) AS avgReadSeconds
        FROM events`
      )
      .first(),
    db
      .prepare(
        `${metricRollups()}
        SELECT
          s.genre,
          COUNT(DISTINCT s.id) AS stories,
          COALESCE(SUM(er.starts), 0) AS starts,
          COALESCE(SUM(er.completes), 0) AS completes,
          COALESCE(SUM(er.likes), 0) AS likes,
          COALESCE(SUM(er.shares), 0) AS shares,
          COALESCE(SUM(er.skips), 0) AS skips,
          COALESCE(SUM(cr.comments), 0) AS comments
        FROM stories s
        LEFT JOIN event_rollup er ON er.story_id = s.id
        LEFT JOIN comment_rollup cr ON cr.story_id = s.id
        WHERE s.status = 'published'
        GROUP BY s.genre
        ORDER BY starts DESC, completes DESC`
      )
      .all(),
    db
      .prepare(
        `${metricRollups()}
        SELECT
          s.mood,
          COUNT(DISTINCT s.id) AS stories,
          COALESCE(SUM(er.starts), 0) AS starts,
          COALESCE(SUM(er.completes), 0) AS completes,
          COALESCE(SUM(er.likes), 0) AS likes,
          COALESCE(SUM(er.shares), 0) AS shares,
          COALESCE(SUM(er.skips), 0) AS skips,
          COALESCE(SUM(cr.comments), 0) AS comments
        FROM stories s
        LEFT JOIN event_rollup er ON er.story_id = s.id
        LEFT JOIN comment_rollup cr ON cr.story_id = s.id
        WHERE s.status = 'published'
        GROUP BY s.mood
        ORDER BY starts DESC, completes DESC`
      )
      .all(),
    db
      .prepare(
        `SELECT story_id AS storyId, event_type AS eventType, value, created_at AS createdAt
        FROM events
        ORDER BY created_at DESC
        LIMIT 40`
      )
      .all(),
  ]);

  return {
    funnel: { ...(funnel ?? {}), totalStories },
    stories: storyRows,
    genres: genreMetrics.results ?? [],
    moods: moodMetrics.results ?? [],
    recentEvents: recentEvents.results ?? [],
    algorithms: describeRecommendationStrategies(),
    // No lab report from D1. The lab's analysis unit is the reader, and reader
    // outcomes live in Supabase; building a second report from a second store
    // is what gave the console two sources of truth for the same words.
    pagination: {
      ...pagination,
      total: totalStories,
      hasMore: pagination.offset + pagination.limit < totalStories,
    },
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "reader";

    if (view === "admin") {
      return Response.json(
        { error: "Admin metrics require the Supabase admin role through /admin." },
        { status: 403 }
      );
    }

    const limit = numberParam(url, "limit", 80, 20, 120);
    const visitorId = cleanText(url.searchParams.get("visitorId"), "anonymous").slice(0, 120);
    let db: D1Database;

    try {
      db = getD1();
    } catch {
      const fallback = buildReaderFeed({
        visitorId,
        candidates: seedStoryCandidates(limit),
        limit,
      });
      const rankedIds = fallback.entries.map((entry) => entry.candidate.id);
      return Response.json({
        stories: seedStoryRows(limit, rankedIds),
        comments: [],
        metrics: {
          funnel: { totalStories: rankedIds.length },
          stories: [],
          recentEvents: [],
        },
        experiment: fallback.experiment,
      });
    }

    await ensureSeedStories(db);
    const [candidates, totalStories] = await Promise.all([
      getStoryCandidates(db, Math.max(limit, 200)),
      getAdminStoryCount(db, ""),
    ]);

    const feed = buildReaderFeed({ visitorId, candidates, limit });
    const stories = await getStoriesByRankedIds(db, feed.entries.map((entry) => entry.candidate.id));
    const comments = await getComments(
      db,
      stories.map((story) => String(story.id))
    );
    const metrics = await getMetrics(db, [], totalStories, {
      limit,
      offset: 0,
      sort: "reader",
      query: "",
    });

    return Response.json({ stories, comments, metrics, experiment: feed.experiment });
  } catch (error) {
    console.error("Could not load the D1 compatibility feed.", safeErrorDetails(error));
    return Response.json({ error: "Could not load boks. Please try again." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readBoundedJsonObject(request);
    const action = cleanText(payload.action);
    if (action !== "events" && action !== "event") {
      return Response.json({ error: "Unsupported action." }, { status: 400 });
    }

    const db = getD1();
    const visitorId = cleanText(payload.visitorId, "anonymous").slice(0, 120);
    const sessionId = cleanText(payload.sessionId).slice(0, 120);
    const algorithmId = cleanText(payload.algorithmId, "unassigned").slice(0, 60);
    const experimentKey = cleanText(payload.experimentKey).slice(0, 60);
    const userSegment = cleanText(payload.userSegment, "general").slice(0, 60);
    const surface = cleanText(payload.surface, "reader").slice(0, 40);
    const rank = integerPayload(payload.rank);
    const clientElapsedSeconds = integerPayload(payload.clientElapsedSeconds);
    const estimatedSeconds = integerPayload(payload.estimatedSeconds);

    // Batch write used by the reader event queue. One request per reading burst
    // instead of one per signal; the same contract as the Supabase RPC.
    if (action === "events") {
      const incoming = Array.isArray(payload.events) ? payload.events.slice(0, 100) : [];
      const rows = incoming
        .map((item) => item as Record<string, unknown>)
        .filter((item) => eventTypes.has(cleanText(item.eventType)) && cleanText(item.storyId));

      if (!rows.length) return Response.json({ recorded: 0 });

      await db.batch(
        rows.map((item) =>
          db
            .prepare(
              `INSERT INTO events
              (story_id, visitor_id, session_id, event_type, value, metadata, algorithm_id, experiment_key, user_segment, surface, rank, client_elapsed_seconds, estimated_seconds)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              cleanText(item.storyId).slice(0, 120),
              cleanText(item.visitorId, visitorId).slice(0, 120),
              cleanText(item.sessionId, sessionId).slice(0, 120),
              cleanText(item.eventType),
              integerPayload(item.value, 1),
              item.metadata ? JSON.stringify(item.metadata).slice(0, 1000) : "{}",
              cleanText(item.algorithmId, "unassigned").slice(0, 60),
              cleanText(item.experimentKey).slice(0, 60),
              cleanText(item.userSegment, "general").slice(0, 60),
              cleanText(item.surface, "reader").slice(0, 40),
              integerPayload(item.rank),
              integerPayload(item.clientElapsedSeconds),
              integerPayload(item.estimatedSeconds)
            )
        )
      );

      return Response.json({ recorded: rows.length });
    }

    if (action === "event") {
      const storyId = cleanText(payload.storyId).slice(0, 120);
      const eventType = cleanText(payload.eventType);
      const value = Number.isFinite(Number(payload.value)) ? Number(payload.value) : 1;
      const metadata = payload.metadata ? JSON.stringify(payload.metadata).slice(0, 1000) : "{}";

      if (!eventTypes.has(eventType)) {
        return Response.json({ error: "Unsupported event type." }, { status: 400 });
      }

      await db
        .prepare(
          `INSERT INTO events
          (story_id, visitor_id, session_id, event_type, value, metadata, algorithm_id, experiment_key, user_segment, surface, rank, client_elapsed_seconds, estimated_seconds)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          storyId,
          visitorId,
          sessionId,
          eventType,
          Math.max(0, Math.round(value)),
          metadata,
          algorithmId,
          experimentKey,
          userSegment,
          surface,
          rank,
          clientElapsedSeconds,
          estimatedSeconds
        )
        .run();

      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    if (error instanceof HttpRequestError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Could not record a D1 compatibility event.", safeErrorDetails(error));
    return Response.json({ error: "Could not record the event. Please try again." }, { status: 500 });
  }
}

function safeErrorDetails(error: unknown) {
  return { name: error instanceof Error ? error.name : "UnknownError" };
}
