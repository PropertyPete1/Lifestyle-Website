CREATE TABLE `visitor_activity` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visitorId` varchar(40) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`data` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `visitor_activity_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `visitorId` varchar(40);