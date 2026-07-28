ALTER TABLE `page_events` ADD `source` varchar(120) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `page_events` ADD `utmMedium` varchar(120) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `page_events` ADD `utmCampaign` varchar(190) DEFAULT '' NOT NULL;