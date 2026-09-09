CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`visitor_name` text DEFAULT 'Reader' NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_comments_story_created` ON `comments` (`story_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`event_type` text NOT NULL,
	`value` integer DEFAULT 1 NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_story_type` ON `events` (`story_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `idx_events_created` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_visitor` ON `events` (`visitor_id`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author_name` text NOT NULL,
	`author_handle` text DEFAULT '' NOT NULL,
	`hook` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`genre` text DEFAULT 'literary' NOT NULL,
	`mood` text DEFAULT 'quiet' NOT NULL,
	`minutes` integer DEFAULT 5 NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`is_seed` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stories_status_created` ON `stories` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_stories_mood_genre` ON `stories` (`mood`,`genre`);