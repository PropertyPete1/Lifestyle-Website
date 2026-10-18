CREATE TABLE `deal_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dedupe_key` varchar(191) NOT NULL,
	`lead_id` int NOT NULL,
	`kind` enum('first_unlock','profile_flag') NOT NULL,
	`delivery_mode` enum('immediate','hourly_digest') NOT NULL,
	`recipients` text NOT NULL,
	`subject` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`status` enum('pending','sending','sent','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`delivery_log` varchar(255),
	`last_error` text,
	`scheduled_for` timestamp NOT NULL,
	`delivered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deal_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_alerts_dedupe_key_unique` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `deal_email_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alert_id` int,
	`category` varchar(60) NOT NULL,
	`recipients` text NOT NULL,
	`subject` varchar(255) NOT NULL,
	`provider` enum('resend','owner_notification') NOT NULL,
	`delivery_status` enum('sent','failed','owner_only_fallback') NOT NULL,
	`delivery_log` varchar(255) NOT NULL,
	`last_error` text,
	`delivered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_email_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
DROP INDEX `idx_deal_trec_name` ON `deal_trec_licenses`;--> statement-breakpoint
CREATE INDEX `idx_deal_alerts_delivery` ON `deal_alerts` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `idx_deal_alerts_lead` ON `deal_alerts` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_email_logs_alert` ON `deal_email_logs` (`alert_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_email_logs_created` ON `deal_email_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_trec_name_first` ON `deal_trec_licenses` (`import_id`,`last_name`,`first_name`);