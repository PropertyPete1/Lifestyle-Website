CREATE TABLE `deal_access_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lead_id` int NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`device_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`consumed_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_access_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_access_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `deal_blocklist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone_e164` varchar(20),
	`email` varchar(320),
	`device_hash` varchar(64),
	`search_phone` varchar(20),
	`reason` varchar(255) NOT NULL,
	`expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_blocklist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_communities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`builder` varchar(80) NOT NULL,
	`private_name` varchar(190) NOT NULL,
	`source_url` text NOT NULL,
	`private_address` varchar(255) NOT NULL,
	`sales_phone` varchar(40),
	`public_label` varchar(190) NOT NULL,
	`area_label` varchar(120) NOT NULL,
	`school_district` varchar(120),
	`lot_sizes` varchar(160),
	`amenities` text,
	`from_price` int,
	`reel_url` text,
	`reel_code` varchar(40) NOT NULL,
	`scrub_list` text NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`paused` boolean NOT NULL DEFAULT false,
	`manual_mode` boolean NOT NULL DEFAULT false,
	`last_successful_sync_at` timestamp,
	`last_attempt_at` timestamp,
	`hold_reason` text,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_communities_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_communities_reel_code_unique` UNIQUE(`reel_code`)
);
--> statement-breakpoint
CREATE TABLE `deal_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lead_id` int,
	`kind` varchar(60) NOT NULL,
	`source_code` varchar(40),
	`device_hash` varchar(64),
	`ip_prefix` varchar(80),
	`detail` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_homes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int NOT NULL,
	`source_key` varchar(255) NOT NULL,
	`source_url` text NOT NULL,
	`private_address` varchar(255),
	`private_plan_name` varchar(190),
	`kind` enum('quick_move_in','to_be_built') NOT NULL DEFAULT 'quick_move_in',
	`status` enum('available','sold','hidden') NOT NULL DEFAULT 'available',
	`beds` varchar(30),
	`baths` varchar(30),
	`sqft` int,
	`price` int,
	`previous_price` int,
	`move_in_date` varchar(100),
	`lot_size` varchar(100),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_homes_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_homes_source_key_unique` UNIQUE(`source_key`)
);
--> statement-breakpoint
CREATE TABLE `deal_incentives` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int NOT NULL,
	`normalized_text` text NOT NULL,
	`public_text` text NOT NULL,
	`headline_rate` varchar(80),
	`follow_on_rate` varchar(80),
	`follow_on_period` varchar(100),
	`apr` varchar(80),
	`loan_type` varchar(80),
	`down_payment` varchar(80),
	`repayment_terms` varchar(120),
	`contract_by` timestamp,
	`close_by` timestamp,
	`confirmed_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp,
	`active` boolean NOT NULL DEFAULT true,
	`held` boolean NOT NULL DEFAULT false,
	`hold_reason` text,
	`manual` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deal_incentives_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone_e164` varchar(20) NOT NULL,
	`email` varchar(320),
	`name` varchar(190),
	`instagram_handle` varchar(31),
	`source_code` varchar(40) NOT NULL DEFAULT 'other',
	`timeline` varchar(40),
	`status` enum('verified','blocked','expired','team') NOT NULL DEFAULT 'verified',
	`flags` varchar(2000) NOT NULL DEFAULT '[]',
	`consent_text` text NOT NULL,
	`consent_at` timestamp NOT NULL DEFAULT (now()),
	`consent_ip` varchar(64) NOT NULL,
	`device_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	`fub_person_id` varchar(80),
	`fub_status` enum('pending','synced','failed') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deal_leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_leads_phone_e164_unique` UNIQUE(`phone_e164`)
);
--> statement-breakpoint
CREATE TABLE `deal_pending_verifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`opaque_id_hash` varchar(64) NOT NULL,
	`phone_e164` varchar(20) NOT NULL,
	`choice` enum('buyer','has_agent') NOT NULL,
	`source_code` varchar(40) NOT NULL DEFAULT 'other',
	`instagram_handle` varchar(31),
	`device_hash` varchar(64) NOT NULL,
	`client_ip` varchar(64) NOT NULL,
	`flags` varchar(2000) NOT NULL DEFAULT '[]',
	`wrong_codes` int NOT NULL DEFAULT 0,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_pending_verifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_pending_verifications_opaque_id_hash_unique` UNIQUE(`opaque_id_hash`)
);
--> statement-breakpoint
CREATE TABLE `deal_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`home_id` int NOT NULL,
	`source_url` text NOT NULL,
	`original_storage_key` text,
	`processed_storage_key` text,
	`source_hash` varchar(64) NOT NULL,
	`automatic_hidden` boolean NOT NULL DEFAULT false,
	`admin_hidden` boolean NOT NULL DEFAULT false,
	`processing_state` enum('pending','processed','failed') NOT NULL DEFAULT 'pending',
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deal_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_settings` (
	`key` varchar(100) NOT NULL,
	`value` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deal_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE INDEX `idx_deal_access_lead` ON `deal_access_tokens` (`lead_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_block_phone` ON `deal_blocklist` (`phone_e164`);--> statement-breakpoint
CREATE INDEX `idx_deal_block_device` ON `deal_blocklist` (`device_hash`);--> statement-breakpoint
CREATE INDEX `idx_deal_communities_active` ON `deal_communities` (`active`,`paused`);--> statement-breakpoint
CREATE INDEX `idx_deal_events_kind_created` ON `deal_events` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_homes_community_status` ON `deal_homes` (`community_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_deal_incentives_community_active` ON `deal_incentives` (`community_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_deal_leads_expiry` ON `deal_leads` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_leads_fub` ON `deal_leads` (`fub_status`);--> statement-breakpoint
CREATE INDEX `idx_deal_pending_phone` ON `deal_pending_verifications` (`phone_e164`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_photos_home` ON `deal_photos` (`home_id`,`processing_state`);