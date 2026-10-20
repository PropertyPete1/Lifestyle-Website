-- Records accepted before accepted_at existed: manual overrides and records with an admin-entered date are marked accepted.
-- (A live record whose stored values answer every reason its text gives is adopted as accepted by the next sync.)
UPDATE `deal_incentives` SET `accepted_at` = `updated_at` WHERE `accepted_at` IS NULL AND `held` = 0 AND (`manual` = 1 OR `contract_by_manual` = 1 OR `close_by_manual` = 1);
