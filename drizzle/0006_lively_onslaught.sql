CREATE TABLE `page_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` varchar(24) NOT NULL DEFAULT 'view',
	`path` varchar(190) NOT NULL,
	`visitorId` varchar(40) NOT NULL DEFAULT '',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `page_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_page_events_kind_created` ON `page_events` (`kind`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_page_events_path` ON `page_events` (`path`);