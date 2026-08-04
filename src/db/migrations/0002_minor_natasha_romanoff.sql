CREATE TABLE `run_altitude_samples` (
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`at` text NOT NULL,
	`sensor_timestamp_s` real,
	`pressure_hpa` real NOT NULL,
	`relative_altitude_m` real,
	`epoch` integer NOT NULL,
	`segment_seq` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `run_log` (
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`detail_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `run_points` ADD `altitude_accuracy` real;--> statement-breakpoint
ALTER TABLE `runs` ADD `event_log_json` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `motion_permission` text;