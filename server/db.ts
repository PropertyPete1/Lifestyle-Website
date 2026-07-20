import { and, asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertLead,
  InsertListing,
  InsertPartnerPitch,
  bioLinks,
  InsertUser,
  leads,
  listings,
  neighborhoods,
  partnerPitches,
  siteStats,
  teamMembers,
  testimonials,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';

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
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
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
