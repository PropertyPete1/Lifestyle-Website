CREATE TABLE `deal_client_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(64) NOT NULL,
	`agent_team_id` int NOT NULL,
	`agent_lead_id` int NOT NULL,
	`client_name` varchar(190) NOT NULL,
	`client_phone_e164` varchar(20),
	`note` varchar(500),
	`lead_id` int,
	`verified_at` timestamp,
	`opened_at` timestamp,
	`open_count` int NOT NULL DEFAULT 0,
	`expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deal_client_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_client_links_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `deal_tour_requests` MODIFY COLUMN `request_type` enum('tour','ask','save') NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_leads` ADD `agent_team_id` int;--> statement-breakpoint
ALTER TABLE `deal_leads` ADD `client_link_id` int;--> statement-breakpoint
ALTER TABLE `deal_tour_requests` ADD `removed_at` timestamp;--> statement-breakpoint
ALTER TABLE `deal_tour_requests` ADD CONSTRAINT `idx_deal_tour_lead_home_day_type` UNIQUE(`lead_id`,`home_id`,`chicago_day`,`request_type`);--> statement-breakpoint
ALTER TABLE `deal_tour_requests` DROP INDEX `idx_deal_tour_lead_home_day`;--> statement-breakpoint
CREATE INDEX `idx_deal_client_links_agent` ON `deal_client_links` (`agent_team_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_client_links_lead` ON `deal_client_links` (`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_deal_leads_agent` ON `deal_leads` (`agent_team_id`);