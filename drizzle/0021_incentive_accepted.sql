ALTER TABLE `deal_incentives` ADD `accepted_at` timestamp;--> statement-breakpoint
UPDATE `deal_incentives` SET `accepted_at` = `updated_at` WHERE `accepted_at` IS NULL AND `held` = 0 AND (`manual` = 1 OR `contract_by_manual` = 1 OR `close_by_manual` = 1);
