CREATE TABLE `deal_community_views` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lead_id` int NOT NULL,
	`community_id` int NOT NULL,
	`viewed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_community_views_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_do_not_auto_import` (
	`id` int AUTO_INCREMENT NOT NULL,
	`value` varchar(320) NOT NULL,
	`kind` enum('phone','email') NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_do_not_auto_import_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_do_not_auto_import_value_unique` UNIQUE(`value`)
);
--> statement-breakpoint
CREATE TABLE `deal_fub_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lead_id` int NOT NULL,
	`operation` varchar(80) NOT NULL,
	`payload` text NOT NULL,
	`status` enum('pending','leased','synced','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`next_attempt_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_fub_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_deal_fub_lead_operation` UNIQUE(`lead_id`,`operation`)
);
--> statement-breakpoint
CREATE TABLE `deal_home_price_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`home_id` int NOT NULL,
	`price` int NOT NULL,
	`observed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_home_price_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_job_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`job_name` varchar(100) NOT NULL,
	`chicago_day` varchar(10) NOT NULL,
	`status` enum('running','ok','failed','skipped') NOT NULL,
	`detail` text,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `deal_job_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_deal_job_daily` UNIQUE(`job_name`,`chicago_day`)
);
--> statement-breakpoint
CREATE TABLE `deal_known_agents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(190),
	`phone_e164` varchar(20),
	`email` varchar(320),
	`source` enum('csv','fub_recruit','manual') NOT NULL,
	`fub_person_id` varchar(80),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_known_agents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_photo_renders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`photo_id` int NOT NULL,
	`lead_id` int NOT NULL,
	`version` varchar(64) NOT NULL,
	`storage_key` text NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_photo_renders_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_deal_photo_render` UNIQUE(`photo_id`,`lead_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `deal_team_allowlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(190),
	`phone_e164` varchar(20),
	`email` varchar(320),
	`fub_user_id` varchar(80),
	`source` enum('fub','manual','test') NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_team_allowlist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_tour_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lead_id` int NOT NULL,
	`home_id` int NOT NULL,
	`request_type` enum('tour','ask') NOT NULL,
	`preferred_at` timestamp NOT NULL,
	`chicago_day` varchar(10) NOT NULL,
	`fub_task_id` varchar(80),
	`email_sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_tour_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_deal_tour_lead_home_day` UNIQUE(`lead_id`,`home_id`,`chicago_day`)
);
--> statement-breakpoint
CREATE TABLE `deal_trec_fake_rows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`full_name` varchar(190) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_trec_fake_rows_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_trec_fake_rows_full_name_unique` UNIQUE(`full_name`)
);
--> statement-breakpoint
CREATE TABLE `deal_trec_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_etag` varchar(255),
	`row_count` int NOT NULL DEFAULT 0,
	`current` boolean NOT NULL DEFAULT false,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_trec_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_trec_licenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`import_id` int NOT NULL,
	`full_name` varchar(190) NOT NULL,
	`first_name` varchar(100),
	`last_name` varchar(100),
	`license_number` varchar(60),
	`license_type` varchar(80),
	`status` varchar(80),
	`county` varchar(100),
	`source_updated` varchar(80),
	CONSTRAINT `deal_trec_licenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `deal_communities` ADD `catalog_updated_at` timestamp;--> statement-breakpoint
ALTER TABLE `deal_communities` ADD `zip_centroid_lat` varchar(32);--> statement-breakpoint
ALTER TABLE `deal_communities` ADD `zip_centroid_lng` varchar(32);--> statement-breakpoint
ALTER TABLE `deal_communities` ADD `drive_time_chips` text;--> statement-breakpoint
ALTER TABLE `deal_communities` ADD `watermark_removal_approved` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_communities` ADD `watermark_region` varchar(40) DEFAULT 'bottom';--> statement-breakpoint
ALTER TABLE `deal_homes` ADD `garage` varchar(30);--> statement-breakpoint
ALTER TABLE `deal_homes` ADD `homesite` varchar(100);--> statement-breakpoint
ALTER TABLE `deal_homes` ADD `ready_now` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_homes` ADD `origin` enum('official','manual') DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_photos` ADD `processed_version` varchar(64);--> statement-breakpoint
ALTER TABLE `deal_photos` ADD `ocr_matches` text;--> statement-breakpoint
ALTER TABLE `deal_photos` ADD `bottom_crop` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_photos` ADD CONSTRAINT `idx_deal_photos_source` UNIQUE(`home_id`,`source_hash`);--> statement-breakpoint
CREATE INDEX `idx_deal_view_lead` ON `deal_community_views` (`lead_id`,`viewed_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_fub_status` ON `deal_fub_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_price_home_observed` ON `deal_home_price_history` (`home_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_known_phone` ON `deal_known_agents` (`phone_e164`);--> statement-breakpoint
CREATE INDEX `idx_deal_known_email` ON `deal_known_agents` (`email`);--> statement-breakpoint
CREATE INDEX `idx_deal_photo_render_expiry` ON `deal_photo_renders` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_team_phone` ON `deal_team_allowlist` (`phone_e164`);--> statement-breakpoint
CREATE INDEX `idx_deal_team_email` ON `deal_team_allowlist` (`email`);--> statement-breakpoint
CREATE INDEX `idx_deal_tour_lead_day` ON `deal_tour_requests` (`lead_id`,`chicago_day`);--> statement-breakpoint
CREATE INDEX `idx_deal_trec_name` ON `deal_trec_licenses` (`import_id`,`last_name`);--> statement-breakpoint
CREATE INDEX `idx_deal_trec_county` ON `deal_trec_licenses` (`import_id`,`county`);