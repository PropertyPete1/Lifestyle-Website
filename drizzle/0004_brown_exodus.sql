CREATE TABLE `partner_pitches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(24) NOT NULL,
	`partnerName` varchar(60),
	`selections` text NOT NULL,
	`city` varchar(40) NOT NULL,
	`pitch` text NOT NULL,
	`stats` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partner_pitches_id` PRIMARY KEY(`id`),
	CONSTRAINT `partner_pitches_slug_unique` UNIQUE(`slug`)
);
