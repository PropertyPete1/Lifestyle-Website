CREATE TABLE `deal_fub_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lead_id` int NOT NULL,
	`kind` enum('person','event','note','task') NOT NULL,
	`fub_id` varchar(80) NOT NULL,
	`created_by_us` boolean NOT NULL DEFAULT false,
	`cleaned_at` timestamp,
	`last_cleanup_error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_fub_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_deal_fub_record_kind_id` UNIQUE(`kind`,`fub_id`)
);
--> statement-breakpoint
ALTER TABLE `deal_fub_jobs` ADD `lease_token` varchar(80);--> statement-breakpoint
ALTER TABLE `deal_fub_jobs` ADD `leased_at` timestamp;--> statement-breakpoint
ALTER TABLE `deal_tour_requests` ADD `fub_note_id` varchar(80);--> statement-breakpoint
ALTER TABLE `deal_tour_requests` ADD `fub_note_sent_at` timestamp;--> statement-breakpoint
CREATE INDEX `idx_deal_fub_record_lead` ON `deal_fub_records` (`lead_id`,`kind`);
--> statement-breakpoint
ALTER TABLE `deal_photos` ADD `original_version` varchar(64);--> statement-breakpoint
ALTER TABLE `deal_photos` MODIFY `processing_state` enum('pending','processing','processed','failed') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_photos` ADD `processing_attempts` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_photos` ADD `next_processing_attempt_at` timestamp;--> statement-breakpoint
ALTER TABLE `deal_photos` ADD `processing_started_at` timestamp;--> statement-breakpoint
ALTER TABLE `deal_photos` ADD `last_processing_error` varchar(80);--> statement-breakpoint
ALTER TABLE `deal_photos` ADD `processed_at` timestamp;--> statement-breakpoint
CREATE INDEX `idx_deal_photos_queue` ON `deal_photos` (`processing_state`,`next_processing_attempt_at`);
