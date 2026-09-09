import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const stories = sqliteTable(
  "stories",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    authorName: text("author_name").notNull(),
    authorHandle: text("author_handle").notNull().default(""),
    hook: text("hook").notNull().default(""),
    body: text("body").notNull(),
    genre: text("genre").notNull().default("literary"),
    mood: text("mood").notNull().default("quiet"),
    minutes: integer("minutes").notNull().default(5),
    status: text("status").notNull().default("published"),
    isSeed: integer("is_seed").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_stories_status_created").on(table.status, table.createdAt),
    index("idx_stories_status_title").on(table.status, table.title),
    index("idx_stories_status_author").on(table.status, table.authorName),
    index("idx_stories_mood_genre").on(table.mood, table.genre),
  ]
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storyId: text("story_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    sessionId: text("session_id").notNull().default(""),
    eventType: text("event_type").notNull(),
    value: integer("value").notNull().default(1),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_events_story_type").on(table.storyId, table.eventType),
    index("idx_events_type_created").on(table.eventType, table.createdAt),
    index("idx_events_created").on(table.createdAt),
    index("idx_events_visitor").on(table.visitorId),
  ]
);

export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storyId: text("story_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    visitorName: text("visitor_name").notNull().default("Reader"),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_comments_story_created").on(table.storyId, table.createdAt),
    index("idx_comments_created").on(table.createdAt),
  ]
);
