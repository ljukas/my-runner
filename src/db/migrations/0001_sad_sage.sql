CREATE TABLE `active_run_snapshot` (
	`id` integer PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "active_run_snapshot_singleton" CHECK("active_run_snapshot"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `run_points` (
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`timestamp` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`altitude` real,
	`accuracy` real,
	`speed` real,
	`segment_seq` integer NOT NULL,
	PRIMARY KEY(`run_id`, `seq`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
