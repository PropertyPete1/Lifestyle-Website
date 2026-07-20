CREATE TABLE `bio_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(120) NOT NULL,
	`url` text NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `bio_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(190) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(40),
	`message` text,
	`sourceTag` varchar(190) NOT NULL,
	`intent` enum('Hot','Warm','Cold','Unknown') NOT NULL DEFAULT 'Unknown',
	`answers` text,
	`tcpaConsent` boolean NOT NULL DEFAULT false,
	`fubStatus` enum('synced','failed','pending') NOT NULL DEFAULT 'pending',
	`fubId` varchar(60),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(191) NOT NULL,
	`address` varchar(255) NOT NULL,
	`city` varchar(100) NOT NULL,
	`state` varchar(10) NOT NULL DEFAULT 'TX',
	`zip` varchar(20),
	`price` int NOT NULL,
	`beds` int NOT NULL,
	`baths` varchar(10) NOT NULL,
	`sqft` int NOT NULL,
	`status` enum('Active','Pending','Sold') NOT NULL DEFAULT 'Active',
	`description` text,
	`heroImage` text,
	`photos` text,
	`agentName` varchar(120),
	`featured` boolean NOT NULL DEFAULT true,
	`hasPool` boolean NOT NULL DEFAULT false,
	`isNewConstruction` boolean NOT NULL DEFAULT false,
	`propertyType` enum('Residential','Multi-Family','Townhome/Condo','Land') NOT NULL DEFAULT 'Residential',
	`source` enum('cms','idx') NOT NULL DEFAULT 'cms',
	`brokerAttribution` text,
	`mlsDisclaimer` text,
	`dataUpdatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`),
	CONSTRAINT `listings_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `neighborhoods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(191) NOT NULL,
	`name` varchar(120) NOT NULL,
	`region` varchar(120),
	`tagline` varchar(255),
	`description` text,
	`heroImage` text,
	`medianPrice` varchar(60),
	`vibe` text,
	`isCityPage` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`published` boolean NOT NULL DEFAULT true,
	CONSTRAINT `neighborhoods_id` PRIMARY KEY(`id`),
	CONSTRAINT `neighborhoods_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `site_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(120) NOT NULL,
	`value` varchar(60) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `site_stats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`title` varchar(120) NOT NULL,
	`license` varchar(60),
	`bio` text,
	`photo` text,
	`phone` varchar(40),
	`email` varchar(190),
	`sortOrder` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `team_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `testimonials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quote` text NOT NULL,
	`author` varchar(120) NOT NULL,
	`source` varchar(120),
	`sortOrder` int NOT NULL DEFAULT 0,
	`published` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `testimonials_id` PRIMARY KEY(`id`)
);
