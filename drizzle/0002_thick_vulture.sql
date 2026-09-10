ALTER TABLE `events` ADD `algorithm_id` text DEFAULT 'unassigned' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `user_segment` text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `surface` text DEFAULT 'reader' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `rank` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `client_elapsed_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_events_algorithm_type_created` ON `events` (`algorithm_id`,`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_algorithm_story` ON `events` (`algorithm_id`,`story_id`);--> statement-breakpoint
CREATE INDEX `idx_events_segment_algorithm` ON `events` (`user_segment`,`algorithm_id`);