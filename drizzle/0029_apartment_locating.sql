CREATE TABLE `apt_client_lists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(64) NOT NULL,
	`agent_team_id` int NOT NULL,
	`client_id` int NOT NULL,
	`property_ids` text NOT NULL,
	`note` varchar(500),
	`pick_notes` text,
	`liked` text,
	`opened_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apt_client_lists_id` PRIMARY KEY(`id`),
	CONSTRAINT `apt_client_lists_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `apt_clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agent_team_id` int NOT NULL,
	`name` varchar(190) NOT NULL,
	`phone` varchar(40),
	`email` varchar(320),
	`move_date` varchar(10),
	`beds` int,
	`budget_max` int,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apt_clients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `apt_floorplans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property_id` int NOT NULL,
	`name` varchar(120),
	`beds` int NOT NULL,
	`baths_tenths` int,
	`sqft` int,
	`rent_min` int,
	`rent_max` int,
	`available_count` int,
	`available_on` varchar(10),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apt_floorplans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `apt_guest_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`client_id` int NOT NULL,
	`property_id` int NOT NULL,
	`agent_team_id` int NOT NULL,
	`method` enum('send','escort') NOT NULL,
	`visit_on` varchar(10),
	`sent_on` varchar(10),
	`confirmed_on` varchar(10),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apt_guest_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_apt_guest_card` UNIQUE(`client_id`,`property_id`)
);
--> statement-breakpoint
CREATE TABLE `apt_leases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`client_id` int NOT NULL,
	`property_id` int NOT NULL,
	`agent_team_id` int NOT NULL,
	`unit` varchar(40),
	`rent` int NOT NULL,
	`term_months` int NOT NULL,
	`lease_start_on` varchar(10) NOT NULL,
	`lease_signed_on` varchar(10) NOT NULL,
	`method` enum('send','escort') NOT NULL,
	`expected_amount` int NOT NULL,
	`status` enum('reported','verification_sent','verified','invoiced','paid') NOT NULL DEFAULT 'reported',
	`verification_sent_on` varchar(10),
	`verified_on` varchar(10),
	`verified_amount` int,
	`invoice_number` varchar(40),
	`invoiced_on` varchar(10),
	`due_on` varchar(10),
	`paid_on` varchar(10),
	`paid_amount` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apt_leases_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_apt_lease_client_property` UNIQUE(`client_id`,`property_id`)
);
--> statement-breakpoint
CREATE TABLE `apt_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property_id` int NOT NULL,
	`source_url` varchar(2048) NOT NULL,
	`stored_url` text,
	`caption` varchar(190),
	`sort_order` int NOT NULL DEFAULT 0,
	`failed_reason` varchar(60),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apt_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `apt_properties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_key` varchar(255) NOT NULL,
	`name` varchar(190) NOT NULL,
	`management_company` varchar(190),
	`address` varchar(255) NOT NULL,
	`city` varchar(120) NOT NULL,
	`zip` varchar(10),
	`area_label` varchar(120) NOT NULL,
	`lat` varchar(32),
	`lng` varchar(32),
	`phone` varchar(40),
	`leasing_email` varchar(320),
	`website` text,
	`year_built` int,
	`unit_count` int,
	`send_percent` int,
	`escort_percent` int,
	`flat_fee` int,
	`min_lease_months` int,
	`bonus_amount` int,
	`bonus_note` varchar(255),
	`bonus_expires_on` varchar(10),
	`commission_note` text,
	`commission_verified_on` varchar(10),
	`registration_required` boolean NOT NULL DEFAULT true,
	`invoice_email` varchar(320),
	`special_text` text,
	`special_expires_on` varchar(10),
	`broken_lease` enum('yes','no','case_by_case','unknown') NOT NULL DEFAULT 'unknown',
	`eviction` enum('yes','no','case_by_case','unknown') NOT NULL DEFAULT 'unknown',
	`felony` enum('yes','no','case_by_case','unknown') NOT NULL DEFAULT 'unknown',
	`misdemeanor` enum('yes','no','case_by_case','unknown') NOT NULL DEFAULT 'unknown',
	`min_credit_score` int,
	`income_multiple_tenths` int,
	`income_restricted` boolean NOT NULL DEFAULT false,
	`pet_policy` varchar(255),
	`amenities` text,
	`active` boolean NOT NULL DEFAULT true,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apt_properties_id` PRIMARY KEY(`id`),
	CONSTRAINT `apt_properties_source_key_unique` UNIQUE(`source_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_apt_client_lists_client` ON `apt_client_lists` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_apt_clients_agent` ON `apt_clients` (`agent_team_id`);--> statement-breakpoint
CREATE INDEX `idx_apt_floorplans_property` ON `apt_floorplans` (`property_id`);--> statement-breakpoint
CREATE INDEX `idx_apt_guest_card_agent` ON `apt_guest_cards` (`agent_team_id`);--> statement-breakpoint
CREATE INDEX `idx_apt_lease_agent_status` ON `apt_leases` (`agent_team_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_apt_photos_property` ON `apt_photos` (`property_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_apt_properties_city` ON `apt_properties` (`city`,`active`);