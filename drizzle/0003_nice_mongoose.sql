ALTER TABLE `events` ADD `experiment_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `estimated_seconds` integer DEFAULT 0 NOT NULL;