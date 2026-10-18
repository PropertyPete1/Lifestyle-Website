CREATE TABLE `deal_trec_verifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_member_id` int NOT NULL,
	`full_name` varchar(190) NOT NULL,
	`license_number` varchar(60),
	`license_type` varchar(80),
	`status` varchar(80) NOT NULL,
	`verified_at` timestamp NOT NULL DEFAULT (now()),
	`source_updated_at` timestamp,
	CONSTRAINT `deal_trec_verifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_deal_trec_member` ON `deal_trec_verifications` (`team_member_id`,`verified_at`);