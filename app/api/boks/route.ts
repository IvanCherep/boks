import { getD1 } from "@/db";
import { adminOrder, algorithmMetricsSql, metricRollups, storyMetricSelect } from "@/lib/boks/analytics";
import { eventTypes, type RecommendationAlgorithmId } from "@/lib/boks/contracts";
import { recommendationAlgorithms, recommendationOrderSql, resolveRecommendationExperiment } from "@/lib/boks/recommendations";
import { cleanText, estimateMinutes, integerPayload, numberParam, routeError, searchPattern } from "@/lib/boks/request";
import { seedStories } from "@/lib/boks/seed-stories";

export const dynamic = "force-dynamic";

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

async function getReaderStories(db: D1Database, limit: number, algorithmId: RecommendationAlgorithmId) {
  const result = await db
    .prepare(
      `${metricRollups()}
      SELECT ${storyMetricSelect(true)}
      FROM stories s
      LEFT JOIN event_rollup er ON er.story_id = s.id
      LEFT JOIN comment_rollup cr ON cr.story_id = s.id
      WHERE s.status = 'published'
      ORDER BY ${recommendationOrderSql(algorithmId)}
      LIMIT ?`
    )
    .bind(limit)
    .all();

  return result.results ?? [];
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

async function getAdminStoryMetrics(
  db: D1Database,
  limit: number,
  offset: number,
  query: string,
  sort: string
) {
  const pattern = searchPattern(query);
  const where = query
    ? `WHERE s.status = 'published' AND (
        LOWER(s.title) LIKE ? OR
        LOWER(s.author_name) LIKE ? OR
        LOWER(s.genre) LIKE ? OR
        LOWER(s.mood) LIKE ?
      )`
    : "WHERE s.status = 'published'";

  const statement = db.prepare(
    `${metricRollups()}
    SELECT ${storyMetricSelect(false)}
    FROM stories s
    LEFT JOIN event_rollup er ON er.story_id = s.id
    LEFT JOIN comment_rollup cr ON cr.story_id = s.id
    ${where}
    ORDER BY ${adminOrder(sort)}
    LIMIT ? OFFSET ?`
  );

  const result = query
    ? await statement.bind(pattern, pattern, pattern, pattern, limit, offset).all()
    : await statement.bind(limit, offset).all();
  return result.results ?? [];
}

async function getMetrics(
  db: D1Database,
  storyRows: Array<Record<string, unknown>>,
  totalStories: number,
  pagination: { limit: number; offset: number; sort: string; query: string }
) {
  const [funnel, genreMetrics, moodMetrics, recentEvents, algorithmMetrics] = await Promise.all([
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
    db.prepare(algorithmMetricsSql()).all(),
  ]);

  return {
    funnel: { ...(funnel ?? {}), totalStories },
    stories: storyRows,
    genres: genreMetrics.results ?? [],
    moods: moodMetrics.results ?? [],
    recentEvents: recentEvents.results ?? [],
    algorithms: recommendationAlgorithms,
    algorithmMetrics: algorithmMetrics.results ?? [],
    pagination: {
      ...pagination,
      total: totalStories,
      hasMore: pagination.offset + pagination.limit < totalStories,
    },
  };
}

export async function GET(request: Request) {
  try {
    const db = getD1();
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "reader";
    await ensureSeedStories(db);

    if (view === "admin") {
      const limit = numberParam(url, "limit", 100, 20, 250);
      const offset = numberParam(url, "offset", 0, 0, 1_000_000);
      const query = cleanText(url.searchParams.get("q")).slice(0, 80);
      const sort = cleanText(url.searchParams.get("sort"), "signal");
      const [totalStories, storyRows] = await Promise.all([
        getAdminStoryCount(db, query),
        getAdminStoryMetrics(db, limit, offset, query, sort),
      ]);
      const metrics = await getMetrics(db, storyRows, totalStories, {
        limit,
        offset,
        sort,
        query,
      });
      return Response.json({ stories: [], comments: [], metrics });
    }

    const limit = numberParam(url, "limit", 80, 20, 120);
    const visitorId = cleanText(url.searchParams.get("visitorId"), "anonymous").slice(0, 120);
    const experiment = resolveRecommendationExperiment(visitorId, url.searchParams.get("algorithm"));
    const [stories, totalStories] = await Promise.all([
      getReaderStories(db, limit, experiment.algorithmId),
      getAdminStoryCount(db, ""),
    ]);
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

    return Response.json({ stories, comments, metrics, experiment });
  } catch (error) {
    return Response.json({ error: routeError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const db = getD1();
    const payload = (await request.json()) as Record<string, unknown>;
    const action = cleanText(payload.action);
    const visitorId = cleanText(payload.visitorId, "anonymous").slice(0, 120);
    const sessionId = cleanText(payload.sessionId).slice(0, 120);
    const algorithmId = cleanText(payload.algorithmId, "unassigned").slice(0, 60);
    const userSegment = cleanText(payload.userSegment, "general").slice(0, 60);
    const surface = cleanText(payload.surface, "reader").slice(0, 40);
    const rank = integerPayload(payload.rank);
    const clientElapsedSeconds = integerPayload(payload.clientElapsedSeconds);

    if (action === "create-story") {
      const title = cleanText(payload.title).slice(0, 90);
      const authorName = cleanText(payload.authorName, "Guest author").slice(0, 60);
      const authorHandle = cleanText(payload.authorHandle).slice(0, 40);
      const hook = cleanText(payload.hook).slice(0, 180);
      const body = cleanText(payload.body).slice(0, 9000);
      const genre = cleanText(payload.genre, "literary").slice(0, 30);
      const mood = cleanText(payload.mood, "quiet").slice(0, 30);
      const minutes = Number(payload.minutes) || estimateMinutes(body);

      if (!title || !body) {
        return Response.json({ error: "Title and story body are required." }, { status: 400 });
      }

      if (estimateMinutes(body) > 15 || minutes > 15) {
        return Response.json(
          { error: "boks stories must fit inside a 15 minute reading session." },
          { status: 400 }
        );
      }

      const id = `story-${crypto.randomUUID()}`;
      await db
        .prepare(
          `INSERT INTO stories
          (id, title, author_name, author_handle, hook, body, genre, mood, minutes, status, is_seed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 0)`
        )
        .bind(id, title, authorName, authorHandle, hook, body, genre, mood, minutes)
        .run();

      await db
        .prepare(
          `INSERT INTO events
          (story_id, visitor_id, session_id, event_type, metadata, algorithm_id, user_segment, surface)
          VALUES (?, ?, ?, 'publish', ?, 'author_console', 'author', 'author')`
        )
        .bind(id, visitorId, sessionId, JSON.stringify({ genre, mood, minutes }))
        .run();

      return Response.json({ storyId: id }, { status: 201 });
    }

    if (action === "comment") {
      const storyId = cleanText(payload.storyId).slice(0, 120);
      const body = cleanText(payload.body).slice(0, 700);
      const visitorName = cleanText(payload.visitorName, "Reader").slice(0, 50);

      if (!storyId || !body) {
        return Response.json({ error: "Story and comment text are required." }, { status: 400 });
      }

      await db
        .prepare(
          `INSERT INTO comments (story_id, visitor_id, visitor_name, body)
          VALUES (?, ?, ?, ?)`
        )
        .bind(storyId, visitorId, visitorName, body)
        .run();

      await db
        .prepare(
          `INSERT INTO events
          (story_id, visitor_id, session_id, event_type, algorithm_id, user_segment, surface, rank, client_elapsed_seconds)
          VALUES (?, ?, ?, 'comment', ?, ?, ?, ?, ?)`
        )
        .bind(storyId, visitorId, sessionId, algorithmId, userSegment, surface, rank, clientElapsedSeconds)
        .run();

      return Response.json({ ok: true }, { status: 201 });
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
          (story_id, visitor_id, session_id, event_type, value, metadata, algorithm_id, user_segment, surface, rank, client_elapsed_seconds)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          storyId,
          visitorId,
          sessionId,
          eventType,
          Math.max(0, Math.round(value)),
          metadata,
          algorithmId,
          userSegment,
          surface,
          rank,
          clientElapsedSeconds
        )
        .run();

      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: routeError(error) }, { status: 500 });
  }
}
