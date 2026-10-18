ALTER TABLE `deal_access_tokens` ADD `kind` enum('exchange','session') DEFAULT 'exchange' NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_events` ADD `phone_e164` varchar(20);--> statement-breakpoint
ALTER TABLE `deal_pending_verifications` ADD `consent_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_deal_events_phone_kind_created` ON `deal_events` (`phone_e164`,`kind`,`created_at`);