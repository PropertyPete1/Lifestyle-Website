CREATE TABLE `deal_sync_digest_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`summaries` mediumtext NOT NULL,
	`holds` mediumtext NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`sent_at` timestamp,
	CONSTRAINT `deal_sync_digest_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_deal_sync_digest_sent` ON `deal_sync_digest_entries` (`sent_at`);