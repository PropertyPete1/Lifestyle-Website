import { and, inArray, isNull, ne } from "drizzle-orm";
import { dealCommunityViews, dealEvents, dealTourRequests } from "../drizzle/schema";
import type { getDb } from "./db";

export type LeadActivity = { saves: number; tours: number; views: number; lastSeen: Date | null };

/**
 * What each of these buyers did on Builder Deals: homes still saved, tour or question asks still standing,
 * distinct communities opened, and the time of their latest event. Three reads for the whole set.
 */
export async function leadActivity(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, leadIds: readonly number[]): Promise<Map<number, LeadActivity>> {
  const out = new Map<number, LeadActivity>();
  if (!leadIds.length) return out;
  const get = (id: number) => { let a = out.get(id); if (!a) { a = { saves: 0, tours: 0, views: 0, lastSeen: null }; out.set(id, a); } return a; };
  const [requests, views, events] = await Promise.all([
    db.select({ leadId: dealTourRequests.leadId, requestType: dealTourRequests.requestType }).from(dealTourRequests).where(and(inArray(dealTourRequests.leadId, leadIds as number[]), isNull(dealTourRequests.removedAt))),
    db.select({ leadId: dealCommunityViews.leadId, communityId: dealCommunityViews.communityId }).from(dealCommunityViews).where(inArray(dealCommunityViews.leadId, leadIds as number[])),
    db.select({ leadId: dealEvents.leadId, createdAt: dealEvents.createdAt }).from(dealEvents).where(and(inArray(dealEvents.leadId, leadIds as number[]), ne(dealEvents.kind, "admin_turned_off"))),
  ]);
  for (const row of requests) { const a = get(row.leadId); if (row.requestType === "save") a.saves += 1; else a.tours += 1; }
  const seen = new Map<number, Set<number>>();
  for (const row of views) { const set = seen.get(row.leadId) ?? new Set<number>(); set.add(row.communityId); seen.set(row.leadId, set); }
  for (const [leadId, set] of Array.from(seen.entries())) get(leadId).views = set.size;
  for (const row of events) { if (row.leadId === null || row.leadId === undefined) continue; const a = get(row.leadId); if (!a.lastSeen || row.createdAt > a.lastSeen) a.lastSeen = row.createdAt; }
  return out;
}
