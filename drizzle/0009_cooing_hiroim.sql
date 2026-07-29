CREATE TABLE `city_matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(24) NOT NULL,
	`answers` text NOT NULL,
	`rankedCities` text NOT NULL,
	`narratives` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `city_matches_id` PRIMARY KEY(`id`),
	CONSTRAINT `city_matches_slug_unique` UNIQUE(`slug`)
);
