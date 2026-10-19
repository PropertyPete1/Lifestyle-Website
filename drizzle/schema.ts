import { boolean, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * LISTINGS — data-source-agnostic listing model.
 * Phase 1: populated via admin CMS. Phase 2: an IDX feed can write to the same
 * shape (source = "idx") without any frontend changes. Reserved IDX slots:
 * brokerAttribution, mlsDisclaimer, dataUpdatedAt — leave empty in Phase 1.
 */
export const listings = mysqlTable("listings", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 191 }).notNull().unique(),
  address: varchar("address", { length: 255 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 10 }).default("TX").notNull(),
  zip: varchar("zip", { length: 20 }),
  price: int("price").notNull(),
  beds: int("beds").notNull(),
  baths: varchar("baths", { length: 10 }).notNull(),
  sqft: int("sqft").notNull(),
  status: mysqlEnum("status", ["Active", "Pending", "Sold"]).default("Active").notNull(),
  description: text("description"),
  heroImage: text("heroImage"),
  photos: text("photos"), // JSON array of URLs
  agentName: varchar("agentName", { length: 120 }),
  featured: boolean("featured").default(true).notNull(),
  hasPool: boolean("hasPool").default(false).notNull(),
  isNewConstruction: boolean("isNewConstruction").default(false).notNull(),
  /** Floor plan: number of stories. */
  stories: int("stories").default(1).notNull(),
  /** Floor plan: primary bedroom on the first floor. */
  primaryBedDown: boolean("primaryBedDown").default(true).notNull(),
  propertyType: mysqlEnum("propertyType", ["Residential", "Multi-Family", "Townhome/Condo", "Land"]).default("Residential").notNull(),
  /** Coordinates for map view (Phase 2 IDX feeds populate automatically) */
  lat: varchar("lat", { length: 32 }),
  lng: varchar("lng", { length: 32 }),
  source: mysqlEnum("source", ["cms", "idx"]).default("cms").notNull(),
  brokerAttribution: text("brokerAttribution"),
  mlsDisclaimer: text("mlsDisclaimer"),
  dataUpdatedAt: timestamp("dataUpdatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Listing = typeof listings.$inferSelect;
export type InsertListing = typeof listings.$inferInsert;

export const testimonials = mysqlTable("testimonials", {
  id: int("id").autoincrement().primaryKey(),
  quote: text("quote").notNull(),
  author: varchar("author", { length: 120 }).notNull(),
  source: varchar("source", { length: 120 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  published: boolean("published").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Testimonial = typeof testimonials.$inferSelect;

export const teamMembers = mysqlTable("team_members", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  /** TREC: only Steven Van Orden (Designated Broker) may be titled "Broker & Owner"; Peter Allen is "Owner · REALTOR®". */
  title: varchar("title", { length: 120 }).notNull(),
  license: varchar("license", { length: 60 }),
  bio: text("bio"),
  photo: text("photo"),
  phone: varchar("phone", { length: 40 }),
  email: varchar("email", { length: 190 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
});
export type TeamMember = typeof teamMembers.$inferSelect;

export const neighborhoods = mysqlTable("neighborhoods", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 191 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  region: varchar("region", { length: 120 }),
  tagline: varchar("tagline", { length: 255 }),
  description: text("description"),
  heroImage: text("heroImage"),
  medianPrice: varchar("medianPrice", { length: 60 }),
  vibe: text("vibe"),
  isCityPage: boolean("isCityPage").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  published: boolean("published").default(true).notNull(),
});
export type Neighborhood = typeof neighborhoods.$inferSelect;

export const siteStats = mysqlTable("site_stats", {
  id: int("id").autoincrement().primaryKey(),
  label: varchar("label", { length: 120 }).notNull(),
  value: varchar("value", { length: 60 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
});
export type SiteStat = typeof siteStats.$inferSelect;

export const bioLinks = mysqlTable("bio_links", {
  id: int("id").autoincrement().primaryKey(),
  label: varchar("label", { length: 120 }).notNull(),
  url: text("url").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
});
export type BioLink = typeof bioLinks.$inferSelect;

/**
 * Generic admin-editable key/value settings. First use: social profile URLs
 * for the /links page (social_tiktok, social_youtube, social_linkedin) —
 * an empty value means the icon slot stays hidden until the owner pastes a
 * URL in Admin → Bio Links → Social Profiles.
 */
export const siteSettings = mysqlTable("site_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 120 }).notNull().unique(),
  value: text("value").notNull(),
});
export type SiteSetting = typeof siteSettings.$inferSelect;

export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 190 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }),
  message: text("message"),
  sourceTag: varchar("sourceTag", { length: 190 }).notNull(),
  intent: mysqlEnum("intent", ["Hot", "Warm", "Cold", "Unknown"]).default("Unknown").notNull(),
  answers: text("answers"), // JSON of qualifying/quiz answers
  tcpaConsent: boolean("tcpaConsent").default(false).notNull(),
  fubStatus: mysqlEnum("fubStatus", ["synced", "failed", "pending"]).default("pending").notNull(),
  fubId: varchar("fubId", { length: 60 }),
  /** First-party anonymous visitor id — correlates pre-inquiry site activity. */
  visitorId: varchar("visitorId", { length: 40 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * Anonymous first-party visitor activity log. No personal info is stored —
 * only a random visitor id (persisted in the visitor's own localStorage) and
 * what they did on-site (favorites, AI searches, quiz results). This data is
 * only ever forwarded to Follow Up Boss when the same visitor later submits a
 * lead form; if they never do, it stays here and is never sent anywhere.
 */
export const visitorActivity = mysqlTable("visitor_activity", {
  id: int("id").autoincrement().primaryKey(),
  visitorId: varchar("visitorId", { length: 40 }).notNull(),
  /** favorite | unfavorite | ai_search | convince_quiz | city_finder */
  kind: varchar("kind", { length: 40 }).notNull(),
  /** JSON payload — shape depends on kind (listing info, query, quiz answers…) */
  data: text("data").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type VisitorActivity = typeof visitorActivity.$inferSelect;
export type InsertVisitorActivity = typeof visitorActivity.$inferInsert;

/**
 * First-party site analytics — privacy-simple by design.
 * One row per page view or tracked UI event (e.g. Now Hiring banner click).
 * Only stores: normalized path, the same anonymous ldr_visitor_id used by
 * visitor_activity (random localStorage string), event kind, and timestamp.
 * NO IP addresses, NO user agents, NO fingerprinting, NO personal data,
 * NO third-party analytics services.
 */
export const pageEvents = mysqlTable(
  "page_events",
  {
    id: int("id").autoincrement().primaryKey(),
    /** "view" = page view; "banner_click" = Now Hiring banner click; "nc_click" = New Construction Search outbound click */
    kind: varchar("kind", { length: 24 }).notNull().default("view"),
    /** Normalized path, e.g. "/", "/join", "/convince" (no query strings) */
    path: varchar("path", { length: 190 }).notNull(),
    /** Anonymous first-party visitor id ("" when localStorage is blocked) */
    visitorId: varchar("visitorId", { length: 40 }).notNull().default(""),
    /**
     * Traffic source for the session this event belongs to, captured once on
     * entry and reused for the session (sessionStorage): utm_source when
     * present, else the referrer domain ("instagram.com"), else "direct".
     */
    source: varchar("source", { length: 120 }).notNull().default(""),
    utmMedium: varchar("utmMedium", { length: 120 }).notNull().default(""),
    utmCampaign: varchar("utmCampaign", { length: 190 }).notNull().default(""),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_page_events_kind_created").on(t.kind, t.createdAt),
    index("idx_page_events_path").on(t.path),
  ]
);
export type PageEvent = typeof pageEvents.$inferSelect;
export type InsertPageEvent = typeof pageEvents.$inferInsert;

/**
 * Convince Your Partner: cached AI-generated dream-scene pitches.
 * Each row is one generated result tied to a unique shareable slug so the same
 * link always reproduces the identical pitch (consistency + API cost control).
 */
export const partnerPitches = mysqlTable("partner_pitches", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 24 }).notNull().unique(),
  partnerName: varchar("partnerName", { length: 60 }),
  selections: text("selections").notNull(), // JSON array of lifestyle picks
  city: varchar("city", { length: 40 }).notNull(), // matched market
  pitch: text("pitch").notNull(), // AI-generated dream scene (no rates/financial promises)
  stats: text("stats").notNull(), // JSON array of supporting stat strings
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PartnerPitch = typeof partnerPitches.$inferSelect;
export type InsertPartnerPitch = typeof partnerPitches.$inferInsert;

/**
 * City Finder AI results — cached per unique answer combination.
 * Same architecture as partner_pitches: generate once, cache forever, share via slug.
 */
export const cityMatches = mysqlTable("city_matches", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 24 }).notNull().unique(),
  answers: text("answers").notNull(), // JSON object of quiz answers
  rankedCities: text("rankedCities").notNull(), // JSON array of city names (ranked)
  narratives: text("narratives").notNull(), // JSON object { cityName: { cityPitch, ldrPitch } }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CityMatch = typeof cityMatches.$inferSelect;
export type InsertCityMatch = typeof cityMatches.$inferInsert;

/**
 * Builder Deals is intentionally isolated from the public placeholder listings
 * and normal lead pipeline. Private builder identities, source URLs, addresses
 * and plan names never cross its public DTO boundary.
 */
export const dealCommunities = mysqlTable(
  "deal_communities",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Private admin-only identity and source mapping. */
    builder: varchar("builder", { length: 80 }).notNull(),
    privateName: varchar("private_name", { length: 190 }).notNull(),
    sourceUrl: text("source_url").notNull(),
    privateAddress: varchar("private_address", { length: 255 }).notNull(),
    salesPhone: varchar("sales_phone", { length: 40 }),
    /** Public-safe presentation values only. */
    publicLabel: varchar("public_label", { length: 190 }).notNull(),
    areaLabel: varchar("area_label", { length: 120 }).notNull(),
    schoolDistrict: varchar("school_district", { length: 120 }),
    lotSizes: varchar("lot_sizes", { length: 160 }),
    amenities: text("amenities"), // JSON string array after name scrubbing
    fromPrice: int("from_price"),
    reelUrl: text("reel_url"),
    reelCode: varchar("reel_code", { length: 40 }).notNull().unique(),
    /** Private words/phrases scrubbed before any public persistence. */
    scrubList: text("scrub_list").notNull(), // JSON string array
    active: boolean("active").default(true).notNull(),
    paused: boolean("paused").default(false).notNull(),
    manualMode: boolean("manual_mode").default(false).notNull(),
    /** Explicit buyer-visible content time, never an incidental admin edit time. */
    catalogUpdatedAt: timestamp("catalog_updated_at"),
    zipCentroidLat: varchar("zip_centroid_lat", { length: 32 }),
    zipCentroidLng: varchar("zip_centroid_lng", { length: 32 }),
    driveTimeChips: text("drive_time_chips"),
    watermarkRemovalApproved: boolean("watermark_removal_approved").default(false).notNull(),
    watermarkRegion: varchar("watermark_region", { length: 40 }).default("bottom"),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at"),
    lastAttemptAt: timestamp("last_attempt_at"),
    /** Admin summary of both hold kinds below; never the only record of a hold. */
    holdReason: text("hold_reason"),
    /** Load-failure / missing-container hold ("dismissed:<reason>" after Dismiss hold). */
    catalogHoldReason: text("catalog_hold_reason"),
    catalogHoldSeenAt: timestamp("catalog_hold_seen_at"),
    /** Incentive hold reasons awaiting "Accept this update"; separate from catalog holds. */
    incentiveHoldReason: text("incentive_hold_reason"),
    incentiveHoldSeenAt: timestamp("incentive_hold_seen_at"),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_deal_communities_active").on(t.active, t.paused)]
);

export const dealIncentives = mysqlTable(
  "deal_incentives",
  {
    id: int("id").autoincrement().primaryKey(),
    communityId: int("community_id").notNull(),
    /** Exact official wording after private-name scrubbing. */
    normalizedText: text("normalized_text").notNull(),
    publicText: text("public_text").notNull(),
    headlineRate: varchar("headline_rate", { length: 80 }),
    followOnRate: varchar("follow_on_rate", { length: 80 }),
    followOnPeriod: varchar("follow_on_period", { length: 100 }),
    apr: varchar("apr", { length: 80 }),
    loanType: varchar("loan_type", { length: 80 }),
    downPayment: varchar("down_payment", { length: 80 }),
    repaymentTerms: varchar("repayment_terms", { length: 120 }),
    contractBy: timestamp("contract_by"),
    closeBy: timestamp("close_by"),
    /** Sticky admin-entered dates: a scrape never clears or overwrites them for this text. */
    contractByManual: boolean("contract_by_manual").default(false).notNull(),
    closeByManual: boolean("close_by_manual").default(false).notNull(),
    confirmedAt: timestamp("confirmed_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    active: boolean("active").default(true).notNull(),
    held: boolean("held").default(false).notNull(),
    holdReason: text("hold_reason"),
    manual: boolean("manual").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("idx_deal_incentives_community_active").on(t.communityId, t.active)]
);

export const dealHomes = mysqlTable(
  "deal_homes",
  {
    id: int("id").autoincrement().primaryKey(),
    communityId: int("community_id").notNull(),
    /** Private identifiers and source data are never serialized to visitors. */
    sourceKey: varchar("source_key", { length: 255 }).notNull().unique(),
    sourceUrl: text("source_url").notNull(),
    privateAddress: varchar("private_address", { length: 255 }),
    privatePlanName: varchar("private_plan_name", { length: 190 }),
    kind: mysqlEnum("kind", ["quick_move_in", "to_be_built"]).default("quick_move_in").notNull(),
    status: mysqlEnum("status", ["available", "sold", "hidden"]).default("available").notNull(),
    beds: varchar("beds", { length: 30 }),
    baths: varchar("baths", { length: 30 }),
    sqft: int("sqft"),
    price: int("price"),
    previousPrice: int("previous_price"),
    moveInDate: varchar("move_in_date", { length: 100 }),
    lotSize: varchar("lot_size", { length: 100 }),
    garage: varchar("garage", { length: 30 }),
    homesite: varchar("homesite", { length: 100 }),
    readyNow: boolean("ready_now").default(false).notNull(),
    origin: mysqlEnum("origin", ["official", "manual"]).default("official").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_deal_homes_community_status").on(t.communityId, t.status)]
);

export const dealPhotos = mysqlTable(
  "deal_photos",
  {
    id: int("id").autoincrement().primaryKey(),
    homeId: int("home_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    originalStorageKey: text("original_storage_key"),
    processedStorageKey: text("processed_storage_key"),
    sourceHash: varchar("source_hash", { length: 64 }).notNull(),
    /** SHA-256 of deterministic resized, EXIF/XMP-stripped original bytes. */
    originalVersion: varchar("original_version", { length: 64 }),
    automaticHidden: boolean("automatic_hidden").default(false).notNull(),
    adminHidden: boolean("admin_hidden").default(false).notNull(),
    /** Durable photo work queue state. `processing` is a leased in-flight item. */
    processingState: mysqlEnum("processing_state", ["pending", "processing", "processed", "failed"]).default("pending").notNull(),
    processingAttempts: int("processing_attempts").default(0).notNull(),
    nextProcessingAttemptAt: timestamp("next_processing_attempt_at"),
    processingStartedAt: timestamp("processing_started_at"),
    /** Safe machine code only; never a source URL, presigned URL, or response body. */
    lastProcessingError: varchar("last_processing_error", { length: 80 }),
    processedVersion: varchar("processed_version", { length: 64 }),
    processedAt: timestamp("processed_at"),
    ocrMatches: text("ocr_matches"),
    bottomCrop: int("bottom_crop").default(0).notNull(),
    sortOrder: int("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_deal_photos_home").on(t.homeId, t.processingState),
    index("idx_deal_photos_queue").on(t.processingState, t.nextProcessingAttemptAt),
    uniqueIndex("idx_deal_photos_source").on(t.homeId, t.sourceHash),
  ]
);

export const dealLeads = mysqlTable(
  "deal_leads",
  {
    id: int("id").autoincrement().primaryKey(),
    phoneE164: varchar("phone_e164", { length: 20 }).notNull().unique(),
    email: varchar("email", { length: 320 }),
    name: varchar("name", { length: 190 }),
    instagramHandle: varchar("instagram_handle", { length: 31 }),
    sourceCode: varchar("source_code", { length: 40 }).notNull().default("other"),
    timeline: varchar("timeline", { length: 40 }),
    status: mysqlEnum("status", ["verified", "blocked", "expired", "team"]).default("verified").notNull(),
    flags: varchar("flags", { length: 2000 }).notNull().default("[]"),
    consentText: text("consent_text").notNull(),
    consentAt: timestamp("consent_at").defaultNow().notNull(),
    consentIp: varchar("consent_ip", { length: 64 }).notNull(),
    deviceHash: varchar("device_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    fubPersonId: varchar("fub_person_id", { length: 80 }),
    fubStatus: mysqlEnum("fub_status", ["pending", "synced", "failed"]).default("pending").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("idx_deal_leads_expiry").on(t.expiresAt), index("idx_deal_leads_fub").on(t.fubStatus)]
);

export const dealPendingVerifications = mysqlTable(
  "deal_pending_verifications",
  {
    id: int("id").autoincrement().primaryKey(),
    opaqueIdHash: varchar("opaque_id_hash", { length: 64 }).notNull().unique(),
    phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
    choice: mysqlEnum("choice", ["buyer", "has_agent"]).notNull(),
    sourceCode: varchar("source_code", { length: 40 }).notNull().default("other"),
    instagramHandle: varchar("instagram_handle", { length: 31 }),
    deviceHash: varchar("device_hash", { length: 64 }).notNull(),
    clientIp: varchar("client_ip", { length: 64 }).notNull(),
    consentAt: timestamp("consent_at").defaultNow().notNull(),
    flags: varchar("flags", { length: 2000 }).notNull().default("[]"),
    wrongCodes: int("wrong_codes").default(0).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_deal_pending_phone").on(t.phoneE164, t.createdAt)]
);

export const dealAccessTokens = mysqlTable(
  "deal_access_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    leadId: int("lead_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    deviceHash: varchar("device_hash", { length: 64 }).notNull(),
    kind: mysqlEnum("kind", ["exchange", "session"]).default("exchange").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_deal_access_lead").on(t.leadId, t.expiresAt)]
);

export const dealBlocklist = mysqlTable(
  "deal_blocklist",
  {
    id: int("id").autoincrement().primaryKey(),
    phoneE164: varchar("phone_e164", { length: 20 }),
    email: varchar("email", { length: 320 }),
    deviceHash: varchar("device_hash", { length: 64 }),
    searchPhone: varchar("search_phone", { length: 20 }),
    reason: varchar("reason", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_deal_block_phone").on(t.phoneE164), index("idx_deal_block_device").on(t.deviceHash)]
);

export const dealSettings = mysqlTable("deal_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/** Admin-only confirmation records from the official TREC public dataset. */
export const dealTrecVerifications = mysqlTable(
  "deal_trec_verifications",
  {
    id: int("id").autoincrement().primaryKey(),
    teamMemberId: int("team_member_id").notNull(),
    fullName: varchar("full_name", { length: 190 }).notNull(),
    licenseNumber: varchar("license_number", { length: 60 }),
    licenseType: varchar("license_type", { length: 80 }),
    status: varchar("status", { length: 80 }).notNull(),
    verifiedAt: timestamp("verified_at").defaultNow().notNull(),
    sourceUpdatedAt: timestamp("source_updated_at"),
  },
  (t) => [index("idx_deal_trec_member").on(t.teamMemberId, t.verifiedAt)]
);

export const dealEvents = mysqlTable(
  "deal_events",
  {
    id: int("id").autoincrement().primaryKey(),
    leadId: int("lead_id"),
    kind: varchar("kind", { length: 60 }).notNull(),
    sourceCode: varchar("source_code", { length: 40 }),
    deviceHash: varchar("device_hash", { length: 64 }),
    ipPrefix: varchar("ip_prefix", { length: 80 }),
    phoneE164: varchar("phone_e164", { length: 20 }),
    detail: text("detail"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_deal_events_kind_created").on(t.kind, t.createdAt), index("idx_deal_events_phone_kind_created").on(t.phoneE164, t.kind, t.createdAt)]
);

/** Dated observations underpin the rolling 30-day price-drop display. */
export const dealHomePriceHistory = mysqlTable("deal_home_price_history", {
  id: int("id").autoincrement().primaryKey(), homeId: int("home_id").notNull(),
  price: int("price").notNull(), observedAt: timestamp("observed_at").defaultNow().notNull(),
}, (t) => [index("idx_deal_price_home_observed").on(t.homeId, t.observedAt)]);

/** Nightly TREC import metadata and streamed official license rows. */
export const dealTrecImports = mysqlTable("deal_trec_imports", {
  id: int("id").autoincrement().primaryKey(), sourceEtag: varchar("source_etag", { length: 255 }),
  rowCount: int("row_count").default(0).notNull(), current: boolean("current").default(false).notNull(),
  completedAt: timestamp("completed_at"), createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const dealTrecLicenses = mysqlTable("deal_trec_licenses", {
  id: int("id").autoincrement().primaryKey(), importId: int("import_id").notNull(), fullName: varchar("full_name", { length: 190 }).notNull(),
  firstName: varchar("first_name", { length: 100 }), lastName: varchar("last_name", { length: 100 }), licenseNumber: varchar("license_number", { length: 60 }),
  licenseType: varchar("license_type", { length: 80 }), status: varchar("status", { length: 80 }), county: varchar("county", { length: 100 }), sourceUpdated: varchar("source_updated", { length: 80 }),
}, (t) => [
  // The lookup path narrows on both surname and canonical first name before
  // loading rows, so a common surname never causes a large in-process scan.
  index("idx_deal_trec_name_first").on(t.importId, t.lastName, t.firstName),
  index("idx_deal_trec_county").on(t.importId, t.county),
]);
export const dealTrecFakeRows = mysqlTable("deal_trec_fake_rows", { id: int("id").autoincrement().primaryKey(), fullName: varchar("full_name", { length: 190 }).notNull().unique(), createdAt: timestamp("created_at").defaultNow().notNull() });

/** Server-only identity sources used before a verification code is sent. */
export const dealKnownAgents = mysqlTable("deal_known_agents", {
  id: int("id").autoincrement().primaryKey(), name: varchar("name", { length: 190 }), phoneE164: varchar("phone_e164", { length: 20 }), email: varchar("email", { length: 320 }),
  source: mysqlEnum("source", ["csv", "fub_recruit", "manual"]).notNull(), fubPersonId: varchar("fub_person_id", { length: 80 }), fubIdentityKey: varchar("fub_identity_key", { length: 420 }), active: boolean("active").default(true).notNull(), createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_deal_known_phone").on(t.phoneE164), index("idx_deal_known_email").on(t.email), uniqueIndex("idx_deal_known_fub_identity").on(t.fubIdentityKey)]);
export const dealDoNotAutoImport = mysqlTable("deal_do_not_auto_import", { id: int("id").autoincrement().primaryKey(), value: varchar("value", { length: 320 }).notNull().unique(), kind: mysqlEnum("kind", ["phone", "email"]).notNull(), createdAt: timestamp("created_at").defaultNow().notNull() });
export const dealTeamAllowlist = mysqlTable("deal_team_allowlist", { id: int("id").autoincrement().primaryKey(), name: varchar("name", { length: 190 }), phoneE164: varchar("phone_e164", { length: 20 }), email: varchar("email", { length: 320 }), fubUserId: varchar("fub_user_id", { length: 80 }), fubIdentityKey: varchar("fub_identity_key", { length: 420 }), source: mysqlEnum("source", ["fub", "manual", "test"]).notNull(), active: boolean("active").default(true).notNull(), createdAt: timestamp("created_at").defaultNow().notNull() }, (t) => [index("idx_deal_team_phone").on(t.phoneE164), index("idx_deal_team_email").on(t.email), uniqueIndex("idx_deal_team_fub_identity").on(t.fubIdentityKey)]);

/** Idempotent same-lead Chicago-day requests and durable CRM-side-effect work. */
export const dealTourRequests = mysqlTable("deal_tour_requests", {
  id: int("id").autoincrement().primaryKey(), leadId: int("lead_id").notNull(), homeId: int("home_id").notNull(), requestType: mysqlEnum("request_type", ["tour", "ask"]).notNull(),
  preferredAt: timestamp("preferred_at").notNull(), chicagoDay: varchar("chicago_day", { length: 10 }).notNull(), fubTaskId: varchar("fub_task_id", { length: 80 }), fubNoteId: varchar("fub_note_id", { length: 80 }), fubNoteSentAt: timestamp("fub_note_sent_at"), emailSentAt: timestamp("email_sent_at"), createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("idx_deal_tour_lead_home_day").on(t.leadId, t.homeId, t.chicagoDay), index("idx_deal_tour_lead_day").on(t.leadId, t.chicagoDay)]);
/** Every FUB object this system touched, including found contacts, for safe cleanup and auditability. */
export const dealFubRecords = mysqlTable("deal_fub_records", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("lead_id").notNull(),
  kind: mysqlEnum("kind", ["person", "event", "note", "task"]).notNull(),
  fubId: varchar("fub_id", { length: 80 }).notNull(),
  /** A found pre-existing person is recorded as false and must never be deleted by test cleanup. */
  createdByUs: boolean("created_by_us").default(false).notNull(),
  /** Cleanup is resumable: a failed remote deletion is retained with its error rather than forgotten. */
  cleanedAt: timestamp("cleaned_at"),
  lastCleanupError: text("last_cleanup_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("idx_deal_fub_record_kind_id").on(t.kind, t.fubId), index("idx_deal_fub_record_lead").on(t.leadId, t.kind)]);
/** The lease token makes an expired worker unable to complete a job reclaimed by another worker. */
export const dealFubJobs = mysqlTable("deal_fub_jobs", { id: int("id").autoincrement().primaryKey(), leadId: int("lead_id").notNull(), operation: varchar("operation", { length: 80 }).notNull(), payload: text("payload").notNull(), status: mysqlEnum("status", ["pending", "leased", "synced", "failed"]).default("pending").notNull(), attempts: int("attempts").default(0).notNull(), lastError: text("last_error"), nextAttemptAt: timestamp("next_attempt_at"), leaseToken: varchar("lease_token", { length: 80 }), leasedAt: timestamp("leased_at"), completedAt: timestamp("completed_at"), createdAt: timestamp("created_at").defaultNow().notNull() }, (t) => [uniqueIndex("idx_deal_fub_lead_operation").on(t.leadId, t.operation), index("idx_deal_fub_status").on(t.status, t.nextAttemptAt)]);
export const dealCommunityViews = mysqlTable("deal_community_views", { id: int("id").autoincrement().primaryKey(), leadId: int("lead_id").notNull(), communityId: int("community_id").notNull(), viewedAt: timestamp("viewed_at").defaultNow().notNull() }, (t) => [index("idx_deal_view_lead").on(t.leadId, t.viewedAt)]);
export const dealJobRuns = mysqlTable("deal_job_runs", { id: int("id").autoincrement().primaryKey(), jobName: varchar("job_name", { length: 100 }).notNull(), chicagoDay: varchar("chicago_day", { length: 10 }).notNull(), status: mysqlEnum("status", ["running", "ok", "failed", "skipped"]).notNull(), detail: text("detail"), startedAt: timestamp("started_at").defaultNow().notNull(), completedAt: timestamp("completed_at") }, (t) => [uniqueIndex("idx_deal_job_daily").on(t.jobName, t.chicagoDay)]);
export const dealPhotoRenders = mysqlTable("deal_photo_renders", { id: int("id").autoincrement().primaryKey(), photoId: int("photo_id").notNull(), leadId: int("lead_id").notNull(), version: varchar("version", { length: 64 }).notNull(), storageKey: text("storage_key").notNull(), expiresAt: timestamp("expires_at").notNull(), createdAt: timestamp("created_at").defaultNow().notNull() }, (t) => [uniqueIndex("idx_deal_photo_render").on(t.photoId, t.leadId, t.version), index("idx_deal_photo_render_expiry").on(t.expiresAt)]);

/**
 * Durable buyer-funnel notifications. Alert content is server/admin-only; public
 * routes never select this table. A unique dedupe key makes first-unlock and
 * newly-discovered profile-flag alerts safe across retries and concurrent calls.
 */
export const dealAlerts = mysqlTable("deal_alerts", {
  id: int("id").autoincrement().primaryKey(),
  dedupeKey: varchar("dedupe_key", { length: 191 }).notNull().unique(),
  leadId: int("lead_id").notNull(),
  kind: mysqlEnum("kind", ["first_unlock", "profile_flag"]).notNull(),
  deliveryMode: mysqlEnum("delivery_mode", ["immediate", "hourly_digest"]).notNull(),
  recipients: text("recipients").notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  content: text("content").notNull(),
  status: mysqlEnum("status", ["pending", "sending", "sent", "failed"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  deliveryLog: varchar("delivery_log", { length: 255 }),
  lastError: text("last_error"),
  scheduledFor: timestamp("scheduled_for").notNull(),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [index("idx_deal_alerts_delivery").on(t.status, t.scheduledFor), index("idx_deal_alerts_lead").on(t.leadId, t.createdAt)]);

/**
 * Immutable operational audit of every actual email transport attempt. The
 * exact owner-only fallback value is retained so staff can distinguish it from
 * a transactional email sent by Resend without exposing any secret.
 */
export const dealEmailLogs = mysqlTable("deal_email_logs", {
  id: int("id").autoincrement().primaryKey(),
  alertId: int("alert_id"),
  category: varchar("category", { length: 60 }).notNull(),
  recipients: text("recipients").notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  provider: mysqlEnum("provider", ["resend", "owner_notification"]).notNull(),
  deliveryStatus: mysqlEnum("delivery_status", ["sent", "failed", "owner_only_fallback"]).notNull(),
  deliveryLog: varchar("delivery_log", { length: 255 }).notNull(),
  lastError: text("last_error"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_deal_email_logs_alert").on(t.alertId, t.createdAt), index("idx_deal_email_logs_created").on(t.createdAt)]);
