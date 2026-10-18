ALTER TABLE `deal_known_agents` ADD `fub_identity_key` varchar(420);--> statement-breakpoint
ALTER TABLE `deal_team_allowlist` ADD `fub_identity_key` varchar(420);--> statement-breakpoint
ALTER TABLE `deal_known_agents` ADD CONSTRAINT `idx_deal_known_fub_identity` UNIQUE(`fub_identity_key`);--> statement-breakpoint
ALTER TABLE `deal_team_allowlist` ADD CONSTRAINT `idx_deal_team_fub_identity` UNIQUE(`fub_identity_key`);