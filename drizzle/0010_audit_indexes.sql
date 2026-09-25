CREATE INDEX `idx_leads_created` ON `leads` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_page_events_created` ON `page_events` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_visitor_activity_visitor` ON `visitor_activity` (`visitorId`);