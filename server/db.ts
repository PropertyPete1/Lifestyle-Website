import { and, asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertLead,
  InsertListing,
  InsertPageEvent,
  InsertPartnerPitch,
  InsertVisitorActivity,
  bioLinks,
  InsertUser,
  leads,
  listings,
  neighborhoods,
  pageEvents,
  partnerPitches,
  siteStats,
  teamMembers,
  testimonials,
  users,
  visitorActivity,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { isAdminEmail } from "../shared/site";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    // ADMIN ALLOWLIST enforcement (shared/site.ts ADMIN_EMAILS): only the two
    // company Google accounts (peter@/steven@lifestyledesignrealty.com) and the
    // project owner may hold admin. Re-evaluated on EVERY sign-in so a stale or
    // tampered role self-heals: allowlisted → admin, everyone else → user.
    if (user.email !== undefined || user.openId === ENV.ownerOpenId) {
      const shouldBeAdmin = isAdminEmail(user.email) || user.openId === ENV.ownerOpenId;
      const role = shouldBeAdmin ? ("admin" as const) : ("user" as const);
      values.role = role;
      updateSet.role = role;
    } else if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/* ---------------- Listings ---------------- */
const statusOrder = sql`CASE ${listings.status} WHEN 'Active' THEN 0 WHEN 'Pending' THEN 1 ELSE 2 END`;

export async function getFeaturedListings() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(listings)
    .where(eq(listings.featured, true))
    .orderBy(statusOrder, desc(listings.createdAt));
}

export async function getAllListings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(listings).orderBy(statusOrder, desc(listings.createdAt));
}

export async function getListingBySlug(slug: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(listings).where(eq(listings.slug, slug)).limit(1);
  return rows[0];
}

export async function createListing(data: InsertListing) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(listings).values(data);
}

export async function updateListing(id: number, data: Partial<InsertListing>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(listings).set(data).where(eq(listings.id, id));
}

export async function deleteListing(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(listings).where(eq(listings.id, id));
}

/* ---------------- Testimonials ---------------- */
export async function getTestimonials(includeUnpublished = false) {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(testimonials);
  if (!includeUnpublished) q.where(eq(testimonials.published, true));
  return q.orderBy(asc(testimonials.sortOrder), asc(testimonials.id));
}

export async function createTestimonial(data: typeof testimonials.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(testimonials).values(data);
}

export async function updateTestimonial(id: number, data: Partial<typeof testimonials.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(testimonials).set(data).where(eq(testimonials.id, id));
}

export async function deleteTestimonial(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(testimonials).where(eq(testimonials.id, id));
}

/* ---------------- Team ---------------- */
export async function getTeamMembers(includeInactive = false) {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(teamMembers);
  if (!includeInactive) q.where(eq(teamMembers.active, true));
  return q.orderBy(asc(teamMembers.sortOrder), asc(teamMembers.id));
}

export async function createTeamMember(data: typeof teamMembers.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(teamMembers).values(data);
}

export async function updateTeamMember(id: number, data: Partial<typeof teamMembers.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(teamMembers).set(data).where(eq(teamMembers.id, id));
}

export async function deleteTeamMember(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(teamMembers).where(eq(teamMembers.id, id));
}

/* ---------------- Neighborhoods ---------------- */
export async function getNeighborhoods(includeUnpublished = false) {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(neighborhoods);
  if (!includeUnpublished) q.where(eq(neighborhoods.published, true));
  return q.orderBy(asc(neighborhoods.sortOrder), asc(neighborhoods.id));
}

export async function getNeighborhoodBySlug(slug: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(neighborhoods)
    .where(and(eq(neighborhoods.slug, slug), eq(neighborhoods.published, true)))
    .limit(1);
  return rows[0];
}

export async function createNeighborhood(data: typeof neighborhoods.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(neighborhoods).values(data);
}

export async function updateNeighborhood(id: number, data: Partial<typeof neighborhoods.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(neighborhoods).set(data).where(eq(neighborhoods.id, id));
}

export async function deleteNeighborhood(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(neighborhoods).where(eq(neighborhoods.id, id));
}

/* ---------------- Site stats ---------------- */
export async function getSiteStats() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(siteStats).orderBy(asc(siteStats.sortOrder), asc(siteStats.id));
}

export async function updateSiteStat(id: number, data: Partial<typeof siteStats.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(siteStats).set(data).where(eq(siteStats.id, id));
}

export async function createSiteStat(data: typeof siteStats.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(siteStats).values(data);
}

/* ---------------- Bio links ---------------- */
export async function getBioLinks(includeInactive = false) {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(bioLinks);
  if (!includeInactive) q.where(eq(bioLinks.active, true));
  return q.orderBy(asc(bioLinks.sortOrder), asc(bioLinks.id));
}

export async function createBioLink(data: typeof bioLinks.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(bioLinks).values(data);
}

export async function updateBioLink(id: number, data: Partial<typeof bioLinks.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(bioLinks).set(data).where(eq(bioLinks.id, id));
}

export async function deleteBioLink(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(bioLinks).where(eq(bioLinks.id, id));
}

/* ---------------- Leads ---------------- */
export async function createLead(data: InsertLead): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(leads).values(data);
  return (result as unknown as [{ insertId: number }])[0].insertId;
}

export async function updateLead(id: number, data: Partial<InsertLead>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(leads).set(data).where(eq(leads.id, id));
}

export async function getLeads() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(leads).orderBy(desc(leads.createdAt));
}

/* ---------------- Partner pitches (Convince Your Partner) ---------------- */
export async function createPartnerPitch(data: InsertPartnerPitch) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(partnerPitches).values(data);
}

export async function getPartnerPitchBySlug(slug: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(partnerPitches).where(eq(partnerPitches.slug, slug)).limit(1);
  return rows[0];
}

/* ---------------- Visitor activity (anonymous, first-party) ---------------- */

const ACTIVITY_KINDS = ["favorite", "unfavorite", "ai_search", "convince_quiz", "city_finder"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export function isActivityKind(k: string): k is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(k);
}

/** Log one anonymous activity event. Caps stored events per visitor at 200. */
export async function logVisitorActivity(data: InsertVisitorActivity) {
  const db = await getDb();
  if (!db) return;
  const countRows = (await db
    .select({ n: sql<number>`count(*)` })
    .from(visitorActivity)
    .where(eq(visitorActivity.visitorId, data.visitorId))) as { n: number }[];
  if (Number(countRows[0]?.n ?? 0) >= 200) return; // abuse guard: stop logging, never error
  await db.insert(visitorActivity).values(data);
}

/** All activity for a visitor, oldest first (chronological story). */
export async function getVisitorActivity(visitorId: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(visitorActivity)
    .where(eq(visitorActivity.visitorId, visitorId))
    .orderBy(asc(visitorActivity.createdAt));
}

/* ---------------- First-party site analytics ---------------- */

/** Record one page view or tracked UI event. Fire-and-forget; never throws. */
export async function logPageEvent(data: InsertPageEvent) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(pageEvents).values(data);
  } catch (err) {
    console.error("[analytics] logPageEvent failed:", err); // never block a page
  }
}

/**
 * Aggregate analytics for the admin dashboard over the last `days` days.
 * Computed in SQL against the indexed page_events table. Privacy-simple:
 * only paths, anonymous visitor ids, kinds, and timestamps exist to query.
 */
export async function getAnalyticsSummary(days = 30) {
  const empty = {
    totals: { views: 0, uniques: 0, bannerClicks: 0, ncClicks: 0 },
    perPage: [] as { path: string; views: number; uniques: number }[],
    daily: [] as { day: string; views: number; uniques: number; bannerClicks: number; ncClicks: number }[],
    funnel: { homeViews: 0, bannerClicks: 0, joinViews: 0, recruitSubmissions: 0 },
    sources: [] as { source: string; medium: string; campaign: string; views: number; uniques: number }[],
    ncByPath: [] as { path: string; clicks: number }[],
  };
  const db = await getDb();
  if (!db) return empty;

  const windowDays = Math.max(1, Math.min(365, Math.floor(days)));
  const since = sql`${pageEvents.createdAt} >= (NOW() - INTERVAL ${sql.raw(String(windowDays))} DAY)`;

  const [totalsRows, perPage, daily, funnelRows, recruitRows, sources, ncByPath] = await Promise.all([
    db
      .select({
        views: sql<number>`SUM(${pageEvents.kind} = 'view')`,
        uniques: sql<number>`COUNT(DISTINCT CASE WHEN ${pageEvents.kind} = 'view' AND ${pageEvents.visitorId} <> '' THEN ${pageEvents.visitorId} END)`,
        bannerClicks: sql<number>`SUM(${pageEvents.kind} = 'banner_click')`,
        ncClicks: sql<number>`SUM(${pageEvents.kind} = 'nc_click')`,
      })
      .from(pageEvents)
      .where(since),
    db
      .select({
        path: pageEvents.path,
        views: sql<number>`COUNT(*)`,
        uniques: sql<number>`COUNT(DISTINCT CASE WHEN ${pageEvents.visitorId} <> '' THEN ${pageEvents.visitorId} END)`,
      })
      .from(pageEvents)
      .where(and(since, eq(pageEvents.kind, "view")))
      .groupBy(pageEvents.path)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(50),
    db
      .select({
        day: sql<string>`DATE_FORMAT(${pageEvents.createdAt}, '%Y-%m-%d')`.as("day"),
        views: sql<number>`SUM(${pageEvents.kind} = 'view')`,
        uniques: sql<number>`COUNT(DISTINCT CASE WHEN ${pageEvents.kind} = 'view' AND ${pageEvents.visitorId} <> '' THEN ${pageEvents.visitorId} END)`,
        bannerClicks: sql<number>`SUM(${pageEvents.kind} = 'banner_click')`,
        ncClicks: sql<number>`SUM(${pageEvents.kind} = 'nc_click')`,
      })
      .from(pageEvents)
      .where(since)
      .groupBy(sql`day`)
      .orderBy(desc(sql`day`)),
    db
      .select({
        homeViews: sql<number>`SUM(${pageEvents.kind} = 'view' AND ${pageEvents.path} = '/')`,
        bannerClicks: sql<number>`SUM(${pageEvents.kind} = 'banner_click')`,
        joinViews: sql<number>`SUM(${pageEvents.kind} = 'view' AND ${pageEvents.path} = '/join')`,
      })
      .from(pageEvents)
      .where(since),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(leads)
      .where(
        and(
          eq(leads.sourceTag, "Recruit - Website"),
          sql`${leads.createdAt} >= (NOW() - INTERVAL ${sql.raw(String(windowDays))} DAY)`
        )
      ),
    db
      .select({
        source: sql<string>`IF(${pageEvents.source} = '', 'direct', ${pageEvents.source})`.as("src"),
        medium: pageEvents.utmMedium,
        campaign: pageEvents.utmCampaign,
        views: sql<number>`COUNT(*)`,
        uniques: sql<number>`COUNT(DISTINCT CASE WHEN ${pageEvents.visitorId} <> '' THEN ${pageEvents.visitorId} END)`,
      })
      .from(pageEvents)
      .where(and(since, eq(pageEvents.kind, "view")))
      .groupBy(sql`src`, pageEvents.utmMedium, pageEvents.utmCampaign)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(50),
    db
      .select({ path: pageEvents.path, clicks: sql<number>`COUNT(*)` })
      .from(pageEvents)
      .where(and(since, eq(pageEvents.kind, "nc_click")))
      .groupBy(pageEvents.path)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(20),
  ]);

  const t = totalsRows[0];
  const f = funnelRows[0];
  return {
    totals: {
      views: Number(t?.views ?? 0),
      uniques: Number(t?.uniques ?? 0),
      bannerClicks: Number(t?.bannerClicks ?? 0),
      ncClicks: Number(t?.ncClicks ?? 0),
    },
    perPage: perPage.map((r) => ({ path: r.path, views: Number(r.views), uniques: Number(r.uniques) })),
    daily: daily.map((r) => ({
      day: r.day,
      views: Number(r.views ?? 0),
      uniques: Number(r.uniques ?? 0),
      bannerClicks: Number(r.bannerClicks ?? 0),
      ncClicks: Number(r.ncClicks ?? 0),
    })),
    funnel: {
      homeViews: Number(f?.homeViews ?? 0),
      bannerClicks: Number(f?.bannerClicks ?? 0),
      joinViews: Number(f?.joinViews ?? 0),
      recruitSubmissions: Number(recruitRows[0]?.n ?? 0),
    },
    sources: sources.map((r) => ({
      source: r.source,
      medium: r.medium,
      campaign: r.campaign,
      views: Number(r.views),
      uniques: Number(r.uniques),
    })),
    ncByPath: ncByPath.map((r) => ({ path: r.path, clicks: Number(r.clicks) })),
  };
}
