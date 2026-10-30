CREATE TABLE `deal_first_dibs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`area` varchar(120) NOT NULL DEFAULT '',
	`status` enum('active','unsubscribed') NOT NULL DEFAULT 'active',
	`token` varchar(64) NOT NULL,
	`consent_text` text NOT NULL,
	`consent_ip` varchar(64) NOT NULL,
	`fub_person_id` varchar(80),
	`sent_homes` text,
	`last_emailed_at` timestamp,
	`unsubscribed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deal_first_dibs_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_first_dibs_email_unique` UNIQUE(`email`),
	CONSTRAINT `deal_first_dibs_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE INDEX `idx_deal_first_dibs_due` ON `deal_first_dibs` (`status`,`last_emailed_at`);