DROP INDEX `run_altitude_samples_run_id_idx`;--> statement-breakpoint
CREATE INDEX `run_altitude_samples_run_id_seq_idx` ON `run_altitude_samples` (`run_id`,`seq`);--> statement-breakpoint
DROP INDEX `run_log_run_id_idx`;--> statement-breakpoint
CREATE INDEX `run_log_run_id_seq_idx` ON `run_log` (`run_id`,`seq`);