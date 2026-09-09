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

type StoryRow = SeedStory & {
  status: string;
  isSeed: number;
  createdAt: string;
  likes: number;
  shares: number;
  starts: number;
  completes: number;
  commentsCount: number;
  avgSeconds: number;
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

async function getStories(db: D1Database, limit: number) {
  const result = await db
    .prepare(
      `SELECT
        s.id,
        s.title,
        s.author_name AS authorName,
        s.author_handle AS authorHandle,
        s.hook,
        s.body,
        s.genre,
        s.mood,
        s.minutes,
        s.status,
        s.is_seed AS isSeed,
        s.created_at AS createdAt,
        SUM(CASE WHEN e.event_type = 'like' THEN 1 ELSE 0 END) AS likes,
        SUM(CASE WHEN e.event_type = 'share' THEN 1 ELSE 0 END) AS shares,
        SUM(CASE WHEN e.event_type = 'start' THEN 1 ELSE 0 END) AS starts,
        SUM(CASE WHEN e.event_type = 'complete' THEN 1 ELSE 0 END) AS completes,
        COALESCE(AVG(CASE WHEN e.event_type = 'complete' THEN e.value END), 0) AS avgSeconds,
        (SELECT COUNT(*) FROM comments c WHERE c.story_id = s.id) AS commentsCount
      FROM stories s
      LEFT JOIN events e ON e.story_id = s.id
      WHERE s.status = 'published'
      GROUP BY s.id
      ORDER BY s.is_seed ASC, s.created_at DESC
      LIMIT ?`
    )
    .bind(limit)
    .all<StoryRow>();

  return result.results ?? [];
}

async function getComments(db: D1Database) {
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
      ORDER BY created_at DESC
      LIMIT 80`
    )
    .all();

  return result.results ?? [];
}

async function getMetrics(db: D1Database, limit: number) {
  const [funnel, storyMetrics, genreMetrics, moodMetrics, recentEvents] = await Promise.all([
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
        `SELECT
          s.id,
          s.title,
          s.genre,
          s.mood,
          s.minutes,
          SUM(CASE WHEN e.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
          SUM(CASE WHEN e.event_type = 'start' THEN 1 ELSE 0 END) AS starts,
          SUM(CASE WHEN e.event_type = 'complete' THEN 1 ELSE 0 END) AS completes,
          SUM(CASE WHEN e.event_type = 'like' THEN 1 ELSE 0 END) AS likes,
          SUM(CASE WHEN e.event_type = 'share' THEN 1 ELSE 0 END) AS shares,
          (SELECT COUNT(*) FROM comments c WHERE c.story_id = s.id) AS comments
        FROM stories s
        LEFT JOIN events e ON e.story_id = s.id
        GROUP BY s.id
        ORDER BY starts DESC, impressions DESC, s.created_at DESC
        LIMIT ?`
      )
      .bind(limit)
      .all(),
    db
      .prepare(
        `SELECT
          s.genre,
          COUNT(DISTINCT s.id) AS stories,
          SUM(CASE WHEN e.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
          SUM(CASE WHEN e.event_type = 'start' THEN 1 ELSE 0 END) AS starts,
          SUM(CASE WHEN e.event_type = 'complete' THEN 1 ELSE 0 END) AS completes,
          SUM(CASE WHEN e.event_type = 'like' THEN 1 ELSE 0 END) AS likes,
          SUM(CASE WHEN e.event_type = 'share' THEN 1 ELSE 0 END) AS shares,
          SUM(CASE WHEN e.event_type = 'skip' THEN 1 ELSE 0 END) AS skips,
          SUM(CASE WHEN e.event_type = 'comment' THEN 1 ELSE 0 END) AS comments
        FROM stories s
        LEFT JOIN events e ON e.story_id = s.id
        WHERE s.status = 'published'
        GROUP BY s.genre
        ORDER BY starts DESC, completes DESC`
      )
      .all(),
    db
      .prepare(
        `SELECT
          s.mood,
          COUNT(DISTINCT s.id) AS stories,
          SUM(CASE WHEN e.event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
          SUM(CASE WHEN e.event_type = 'start' THEN 1 ELSE 0 END) AS starts,
          SUM(CASE WHEN e.event_type = 'complete' THEN 1 ELSE 0 END) AS completes,
          SUM(CASE WHEN e.event_type = 'like' THEN 1 ELSE 0 END) AS likes,
          SUM(CASE WHEN e.event_type = 'share' THEN 1 ELSE 0 END) AS shares,
          SUM(CASE WHEN e.event_type = 'skip' THEN 1 ELSE 0 END) AS skips,
          SUM(CASE WHEN e.event_type = 'comment' THEN 1 ELSE 0 END) AS comments
        FROM stories s
        LEFT JOIN events e ON e.story_id = s.id
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
        LIMIT 24`
      )
      .all(),
  ]);

  return {
    funnel: funnel ?? {},
    stories: storyMetrics.results ?? [],
    genres: genreMetrics.results ?? [],
    moods: moodMetrics.results ?? [],
    recentEvents: recentEvents.results ?? [],
  };
}

export async function GET(request: Request) {
  try {
    const db = getD1();
    const url = new URL(request.url);
    const limit = Math.max(20, Math.min(1000, Number(url.searchParams.get("limit")) || 500));
    await ensureSeedStories(db);
    const [stories, comments, metrics] = await Promise.all([
      getStories(db, limit),
      getComments(db),
      getMetrics(db, limit),
    ]);

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
