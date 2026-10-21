CREATE TABLE `deal_supplied_import_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`builder` varchar(80) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_supplied_import_calls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_supplied_import_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`builder` varchar(80) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_supplied_import_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `deal_supplied_import_keys_builder_unique` UNIQUE(`builder`)
);
--> statement-breakpoint
CREATE TABLE `deal_supplied_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int NOT NULL,
	`builder` varchar(80) NOT NULL,
	`payload` mediumtext NOT NULL,
	`captured_at` timestamp NOT NULL,
	`received_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_supplied_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_deal_supplied_import_calls` ON `deal_supplied_import_calls` (`builder`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deal_supplied_imports_community` ON `deal_supplied_imports` (`community_id`,`captured_at`);