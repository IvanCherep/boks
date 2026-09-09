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

function storyBody(paragraphs: string[]) {
  return paragraphs.join("\n\n");
}

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
  {
    id: "seed-map-of-small-fires",
    title: "Map of Small Fires",
    authorName: "Leah Voss",
    authorHandle: "@leahvoss",
    hook: "A city cartographer discovers that every quiet argument leaves a mark only she can see.",
    genre: "literary",
    mood: "quiet",
    minutes: 12,
    body: storyBody([
      "Mara's job was to keep the city accurate. Every morning she climbed the five flights to the survey office, unlocked the cabinet with the brass map tubes, and corrected the official drawings of streets that had shifted overnight. Alleys narrowed after bad rain. Courtyards opened when a building finally accepted its age. A bakery near the tram line had moved three meters east during the winter, not enough for anyone to complain, but enough for delivery boys to curse at dawn.",
      "The old surveyors pretended the city was made of stone. Mara knew it was made of habit. A bus stop remained a bus stop because people waited there. A square stayed a square because strangers chose to cross it diagonally. If enough people avoided a doorway, the doorway slowly became less real. By spring it might appear only as a stain on brick, then only as a memory in someone else's directions.",
      "The fires began as pencil smudges. She noticed the first one on a Tuesday, a little orange mark near the municipal pool. It was too neat to be spilled tea and too bright to be a printing flaw. When Mara visited after work, there was no smoke, no alarm, no scorch on the tiles. There was only a man sitting on the curb with wet hair, holding a child's towel in both hands as if it were evidence.",
      "He told her nothing was wrong. People said that when they wanted a stranger to leave, and Mara usually respected it. But the orange mark on her map pulsed in her satchel. She sat beside him anyway. After a while he said his daughter had refused to come out of the changing room because he had forgotten her mother's birthday again. The girl had not shouted. That was the part that frightened him.",
      "The next morning the map showed three more fires: one in a courthouse corridor, one above a florist, one inside a narrow house where the street numbers ran backward. Mara visited them all. None were disasters. Each was a private heat. A sister who had not returned a call. A judge who had signed a paper too quickly. A florist who wrapped funeral lilies with hands steady enough to fool customers.",
      "By Friday the map looked fevered. Small flames crowded the tram routes and market lanes. They gathered around hospitals, schools, offices with glass doors. Mara understood then that the city had always burned this way, quietly, without smoke, and that the official map had simply learned to tell the truth.",
      "Her supervisor, Anton, found her still at the drafting table after midnight. He was a precise man with soft shoes and a talent for not noticing anything unpaid. He looked at the orange marks and asked whether she was preparing a festival overlay. Mara said no. He asked whether the mayor had ordered an emergency plan. Mara said not exactly. Anton took off his glasses and cleaned them with the corner of his tie.",
      "You cannot map feelings, he said. Mara wanted to agree because it would make the work easier. Instead she unrolled the older maps. There were faded dots in the same places, not orange but brown, as if earlier flames had been erased badly. The city had been asking to be read for years.",
      "Mara began adding notes in the margins. Not names, never names. Only temperatures. Warm: argument unresolved. Hot: silence doing damage. Cooling: apology possible. She changed no street lines, but she adjusted routes. A detour around the courthouse corridor. A bench near the municipal pool. A wider path outside the florist, so two people could pass without choosing who would yield.",
      "The changes were so small that no one approved them. Workers followed the revised plans because stamped paper looked like authority. People sat on the new bench. The courthouse corridor gained a window. The florist's doorway stopped jamming. A month later the orange marks thinned.",
      "Then one appeared on Mara's own apartment. She found it at six in the morning, bright and patient over the room where she kept unopened letters from her brother. She stood with the map in her hands while the kettle clicked itself cold. For years she had believed distance was a kind of peace. The map disagreed.",
      "She wrote one sentence before work: I do not know how to come back, but I can start with coffee. She put the letter in the postbox and watched the orange mark fade from the paper, not gone, but less hungry. When she reached the survey office, the city had moved again. This time, for once, it had made room.",
    ]),
  },
  {
    id: "seed-brief-history-of-the-moon-market",
    title: "Brief History of the Moon Market",
    authorName: "Oren Kale",
    authorHandle: "@orenkale",
    hook: "On the night market built only during eclipses, one seller trades memories by weight.",
    genre: "fantasy",
    mood: "strange",
    minutes: 14,
    body: storyBody([
      "The Moon Market opened only when the sky forgot itself. Stalls appeared in the old riverbed as the eclipse began, canvas roofs snapping into place without hands, lanterns filling with blue fire, scales waking on tables that had not been there a breath before. By morning, there would be mud, reeds, and one or two confused coins. By midnight, if the moon was properly covered, you could buy almost anything that had once been impossible.",
      "Tavi went because his grandmother had stopped recognizing doors. She could name every star in winter and every neighbor from forty years ago, but a door confused her. She would stand before the kitchen, polite and lost, waiting for someone to explain why the wall had opened. The physicians said age. The priest said patience. Tavi believed both of them until his grandmother asked whether his mother had come home yet. His mother had been dead for nine years.",
      "At the market, no one shouted prices. Sellers knew that desperate people did not need persuasion. A woman in green sold bottled weather from childhood summers. A boy with silver teeth offered second chances in sealed envelopes, warning that most of them were disappointing. Near the center, under a black awning, an old man weighed memories on a brass scale.",
      "He did not look like a magician. He looked like someone who had spent too long in public rooms and learned to keep his elbows in. His sign read: BUYING, SELLING, REPAIRING. Under it, in smaller script: NO REFUNDS FOR NOSTALGIA.",
      "Tavi asked for memories of doors. The old man nodded as if this were a normal purchase. Hinges? Thresholds? Locks? he asked. Recognition, Tavi said. I need her to know when a room is inviting her in. The old man selected a drawer behind him and removed a packet tied with grey thread.",
      "These came from an architect, he said. Excellent spatial confidence. Some arrogance around staircases, but you can trim that. Tavi did not ask how much. The old man looked at him carefully, then placed the packet on one side of the scale. On the other he put a clean glass marble.",
      "Payment in equal memory, he said. Something with a door in it.",
      "Tavi had expected money. He had brought his savings, his mother's ring, and a silver spoon stolen from his aunt's cabinet. He had not expected to pay with himself. The market hummed around him. Somewhere a musician played a song backward and several people cried before they understood why.",
      "What kind of door? he asked. Any true one. The old man pushed the glass marble toward him. Hold it and remember.",
      "The first memory that came was useless: the pantry door, painted blue, where he had hidden to avoid chores. The marble clouded but did not gain weight. The second was the hospital door on the night his mother died. That one grew heavy at once. Tavi almost dropped it. The old man watched without reaching to help.",
      "Not that, Tavi said.",
      "The old man shrugged. The market does not prefer pain. People do.",
      "Tavi searched again. He found a warmer door: his grandmother's front door when he was six, red then, before the paint faded. He had run there after breaking a neighbor's window. His grandmother had opened it before he knocked, taken one look at his face, and said, Come in before the fear gets comfortable. She had made tea. She had shown him how to apologize without shrinking.",
      "The marble filled with red light. The scale balanced.",
      "If I give this away, will I forget her? Tavi asked.",
      "You will forget entering that room. You may still remember being loved there. Memory is a house with more doors than people think.",
      "Tavi hated him for saying something beautiful while taking payment. He hated that it helped. He traded the red memory and carried the architect's packet home under his coat. The market began folding behind him before the eclipse ended. Stalls vanished from their shadows upward. The boy with silver teeth called after him to buy a second chance at half price. Tavi did not turn around.",
      "His grandmother was awake when he returned, sitting in the hall beside three closed doors. He brewed the packet into tea because the old man had said that was gentler. Steam rose in clean angles. She drank half the cup, made a face, and said it tasted like chalk and rain.",
      "Then she looked at the kitchen door. Oh, she said. There you are.",
      "For two weeks, doors became easy again. She moved through the apartment with new confidence, opening cupboards, bedrooms, the balcony. She still forgot names. She still asked about people who were gone. But she no longer waited before every threshold like a guest in her own life.",
      "Tavi, however, could no longer remember why red doors made him sad. When he saw one, his chest tightened around an empty frame. He knew enough to grieve the missing thing, and not enough to visit it. That was the market's cruelty: it left the shape of payment behind.",
      "At the next eclipse, he returned to the riverbed. The old man was there, weighing a soldier's dream against a jar of birdsong. Tavi waited until the trade was done. I want to buy back a memory, he said.",
      "The old man sighed. Everyone does.",
      "Can I?",
      "Not the same one. A memory sold becomes part of its buyer. But you can buy a neighboring room.",
      "Tavi placed his mother's ring on the table. The old man ignored it. Tavi placed the silver spoon beside it. Nothing. At last he placed the architect's packet, now empty, carefully between them.",
      "I have a memory of helping someone find a door, he said.",
      "The scale trembled. The old man smiled, just once, and opened a drawer lined in red.",
    ]),
  },
  {
    id: "seed-station-where-the-day-repeats",
    title: "Station Where the Day Repeats",
    authorName: "Anya Rook",
    authorHandle: "@anyarook",
    hook: "A commuter trapped in one lunch hour learns which small choices actually change the day.",
    genre: "speculative",
    mood: "warm",
    minutes: 13,
    body: storyBody([
      "Noah first noticed the loop because of the sandwich. At 12:17, the man ahead of him at the station kiosk ordered egg salad, changed his mind to chicken, apologized twice, then paid with exact coins. At 12:23, after Noah missed his train, the station clock flickered. At 12:17 again, the same man ordered egg salad, changed his mind to chicken, apologized twice, and paid with exact coins.",
      "Noah did not panic immediately. He was an operations analyst and believed in broken displays. He checked his phone. It also said 12:17. He called his office. The call connected to the voicemail he had left himself yesterday, which was impossible and deeply irritating. He bought coffee, burned his tongue, and watched a woman in a yellow scarf drop a folder of sheet music near platform three.",
      "At 12:59, the announcement board went white. The station exhaled. 12:17 returned.",
      "By the fifth loop, Noah had a list. The coffee was always too hot. The sandwich man always apologized. A child always asked whether trains got tired. The woman with sheet music always dropped the folder when the eastbound express shook the floor. At 12:41, a courier always ran into the same trash bin. At 12:52, a tired station guard always rubbed his left shoulder and stared at the departures board as if it had personally betrayed him.",
      "Noah tried the obvious fixes. He boarded a train. At 12:59, the carriage lights blinked and he stood again by the kiosk. He left the station. At the top of the stairs the city stretched bright and normal, but the hour folded around him before he reached the crosswalk. He shouted. He begged the clock. He stole the sandwich man's coins just to see whether the universe had a complaints department. The man ordered chicken anyway and looked wounded by the inconvenience.",
      "By the ninth loop, Noah stopped trying to escape and began trying to improve the hour.",
      "He warned the woman about the sheet music. She clutched the folder, startled, and the express passed without scattering a single page. Her name was Celia. She taught piano to children who practiced only when bribed. The music was for a recital she considered canceling because the youngest student had cried during scales. Noah told her the child might just need a song with fewer stairs in it. Celia laughed, and the sound changed the station more than any announcement.",
      "At 12:41, Noah moved the trash bin. The courier missed it, stumbled into an advertisement instead, and thanked him while bleeding slightly from one knuckle. At 12:52, Noah asked the guard about his shoulder. The guard said his daughter had a school play that evening and he had promised to lift scenery after work, but the pain had started before breakfast. Noah showed him a pharmacy near the north exit. The guard bought heat patches in loop eleven and, in loop twelve, remembered to smile.",
      "The station did not release him.",
      "That annoyed Noah more than the fear had. He had made the hour better. He had prevented small disasters. He had been useful in ways his office never measured. Still the clock returned him to 12:17, beside the kiosk, listening to egg salad become chicken.",
      "In loop fifteen, he sat on the floor and did nothing. The sheet music fell. The courier hit the bin. The guard rubbed his shoulder. The child asked whether trains got tired, and his mother said everyone got tired. Noah closed his eyes. At 12:59, the hour reset.",
      "In loop sixteen, the child asked the question again. This time Noah answered before the mother could. Yes, he said, but they keep going because people are waiting. The child considered this. Then who waits for the trains? Noah had no answer.",
      "He followed the child and her mother to platform one. They were visiting a hospital, he learned, carrying a paper bag of mandarins and a paperback with a cracked spine. The mother looked exhausted in a way that had nothing to do with sleep. Noah offered them his seat. It was a tiny gesture. It did not save music, bones, or dignity. It simply made three minutes easier.",
      "At 12:59, the announcement board went white. Noah expected the kiosk. Instead the clock moved to 1:00.",
      "The station did not cheer. The sandwich man ate chicken. Celia gathered her music with both hands. The courier cursed softly at a new obstacle. The guard walked toward the north exit with one shoulder held more carefully than the other. The child waved at a train entering the platform as if greeting an old worker at the end of a shift.",
      "Noah boarded his delayed train and sat by the window. His phone filled with office messages: where are you, need the report, client moved the call. He began typing an apology, then stopped. The city outside slid into motion. For once, nobody in the carriage needed him to optimize anything.",
      "At the next station, an elderly man hesitated before the doors. Noah held them open. The man nodded and stepped through. The day continued, ordinary and impossible, which Noah decided was probably the same thing.",
    ]),
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
