CREATE INDEX `idx_comments_created` ON `comments` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_type_created` ON `events` (`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_stories_status_title` ON `stories` (`status`,`title`);--> statement-breakpoint
CREATE INDEX `idx_stories_status_author` ON `stories` (`status`,`author_name`);