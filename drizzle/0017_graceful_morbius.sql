ALTER TABLE `deal_communities` ADD `catalog_hold_reason` text;--> statement-breakpoint
ALTER TABLE `deal_communities` ADD `catalog_hold_seen_at` timestamp;--> statement-breakpoint
ALTER TABLE `deal_communities` ADD `incentive_hold_reason` text;--> statement-breakpoint
ALTER TABLE `deal_communities` ADD `incentive_hold_seen_at` timestamp;--> statement-breakpoint
ALTER TABLE `deal_incentives` ADD `contract_by_manual` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_incentives` ADD `close_by_manual` boolean DEFAULT false NOT NULL;