import { getD1 } from "@/db";

export const dynamic = "force-dynamic";

type SeedStory = {
  id: string;
  title: string;
  authorName: string;
  authorHandle: string;
  hook: string;
  body: string;
  genre: string;
  mood: string;
  minutes: number;
};

const seedStories: SeedStory[] = [
  {
    id: "seed-after-the-platform",
    title: "After the Platform",
    authorName: "Mira Vale",
    authorHandle: "@miravale",
    hook: "A delayed train, one folded letter, and a stranger who knows the ending.",
    genre: "mystery",
    mood: "tense",
    minutes: 7,
    body:
      "The train stopped between stations, exactly where the city lights thinned into warehouse windows. Lena was the only person who noticed the envelope sliding under the carriage door.\n\nIt was addressed to seat 12A. Her seat.\n\nInside, in handwriting too careful to be casual, someone had written: Do not get off at the next station. The woman in the red coat has already read your apology.\n\nLena looked up. Three rows away, a woman in a red coat folded a newspaper and smiled as if they had just reached the best paragraph.",
  },
  {
    id: "seed-oranges-at-noon",
    title: "Oranges at Noon",
    authorName: "Nikolai Stern",
    authorHandle: "@nstern",
    hook: "A lunch-break story about a small kindness that keeps arriving late.",
    genre: "slice of life",
    mood: "warm",
    minutes: 5,
    body:
      "Every Tuesday, Pavel bought two oranges from the woman outside the office tower. He ate one at his desk and left the other on the empty chair beside him.\n\nNo one asked. People had learned that office grief was easier to respect from a distance.\n\nOn the seventh Tuesday, he found an orange already waiting on the chair, its peel marked with a tiny ink star. Under it was a note: I still prefer apples. But I like that you remembered.",
  },
  {
    id: "seed-archive-of-rain",
    title: "Archive of Rain",
    authorName: "Ena Cross",
    authorHandle: "@enacross",
    hook: "In a city where weather is stored, one apprentice misfiles a storm.",
    genre: "speculative",
    mood: "strange",
    minutes: 9,
    body:
      "The municipal archive kept rain in numbered glass tubes. Drizzles were thin and silver. Thunderstorms were dark enough to hum in their drawers.\n\nIlya's job was to catalogue weather before it could become memory. On his third week, he mislabeled a storm as a lullaby.\n\nBy morning, every child in the eastern district woke from the same dream: a blue field, a door in the sky, and a voice asking politely to be let back in.",
  },
  {
    id: "seed-the-last-page-club",
    title: "The Last Page Club",
    authorName: "June Otero",
    authorHandle: "@jotero",
    hook: "A secret club reads only endings, until an ending reads back.",
    genre: "fantasy",
    mood: "playful",
    minutes: 6,
    body:
      "They met behind the school library, five students sworn never to begin a book properly. First pages were for patient people. They preferred endings: the last kiss, the last duel, the last door closing.\n\nThen Sam found a final page that mentioned all five of them by name.\n\nIt ended with: They should have started earlier.\n\nThe club voted, for the first time in its history, to turn backward.",
  },
];

const eventTypes = new Set([
  "impression",
  "start",
  "complete",
  "like",
  "share",
  "skip",
  "comment",
  "publish",
  "preference",
]);

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table")) {
    return "The prototype database is not ready yet. Run the D1 migration locally or publish the saved version so the platform can apply it.";
  }
  return message;
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function estimateMinutes(body: string) {
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.min(15, Math.ceil(words / 220)));
}

function numberParam(url: URL, key: string, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number(url.searchParams.get(key)) || fallback));
}

function searchPattern(query: string) {
  return `%${query.replaceAll("%", "").replaceAll("_", "").toLowerCase()}%`;
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

function metricRollups() {
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

function storyMetricSelect(includeBody: boolean) {
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
      WHEN COALESCE(er.starts, 0) > 0 THEN ROUND(COALESCE(er.completes, 0) * 100.0 / er.starts)
      ELSE 0
    END AS finishRate`;
}

async function getReaderStories(db: D1Database, limit: number) {
  const result = await db
    .prepare(
      `${metricRollups()}
      SELECT ${storyMetricSelect(true)}
      FROM stories s
      LEFT JOIN event_rollup er ON er.story_id = s.id
      LEFT JOIN comment_rollup cr ON cr.story_id = s.id
      WHERE s.status = 'published'
      ORDER BY
        s.is_seed ASC,
        (
          COALESCE(er.completes, 0) * 7 +
          COALESCE(er.likes, 0) * 5 +
          COALESCE(cr.comments, 0) * 6 +
          COALESCE(er.shares, 0) * 5 +
          CASE WHEN COALESCE(er.starts, 0) < 4 THEN 20 ELSE 0 END +
          ABS(RANDOM() % 9)
        ) DESC,
        s.created_at DESC
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

function adminOrder(sort: string) {
  if (sort === "finish") return "finishRate DESC, starts DESC, s.created_at DESC";
  if (sort === "starts") return "starts DESC, impressions DESC, s.created_at DESC";
  if (sort === "comments") return "commentsCount DESC, starts DESC, s.created_at DESC";
  if (sort === "newest") return "s.created_at DESC";
  if (sort === "title") return "LOWER(s.title) ASC";
  return "signal DESC, starts DESC, s.created_at DESC";
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
    const [stories, totalStories] = await Promise.all([
      getReaderStories(db, limit),
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

    return Response.json({ stories, comments, metrics });
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
          `INSERT INTO events (story_id, visitor_id, session_id, event_type, metadata)
          VALUES (?, ?, ?, 'publish', ?)`
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
          `INSERT INTO events (story_id, visitor_id, session_id, event_type)
          VALUES (?, ?, ?, 'comment')`
        )
        .bind(storyId, visitorId, sessionId)
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
          `INSERT INTO events (story_id, visitor_id, session_id, event_type, value, metadata)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(storyId, visitorId, sessionId, eventType, Math.max(0, Math.round(value)), metadata)
        .run();

      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: routeError(error) }, { status: 500 });
  }
}
