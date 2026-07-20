import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  propertyType: mysqlEnum("propertyType", ["Residential", "Multi-Family", "Townhome/Condo", "Land"]).default("Residential").notNull(),
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
  /** TREC: only Peter Allen may be titled "Broker/Owner"; others REALTOR® etc. */
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;
