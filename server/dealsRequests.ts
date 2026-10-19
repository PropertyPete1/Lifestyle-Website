import { and, asc, eq } from "drizzle-orm";
import { dealHomes, dealLeads, dealTourRequests } from "../drizzle/schema";
import { getDb } from "./db";
import { chicagoDay, hashSecret, logDealEvent } from "./dealsService";
import { enqueueDealsRequestJobs, requestTestMode, runPendingDealsFubJobs } from "./dealsFubJobs";

function isDuplicateRequestError(error: unknown): boolean {
  const record = error && typeof error === "object" ? error as { code?: unknown; errno?: unknown; message?: unknown } : {};
  if (record.code === "ER_DUP_ENTRY" || record.errno === 1062 || (typeof record.message === "string" && /duplicate entry|unique constraint/i.test(record.message))) return true;
  return "cause" in record && isDuplicateRequestError((record as { cause?: unknown }).cause);
}

/** The opaque card is resolved only after session authentication; no private mapping enters the browser. */
export async function createDealsHomeRequest(input: { leadId: number; card: string; requestType: "tour" | "ask"; preferredAt: Date; sourceCode: string; deviceHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (input.preferredAt.getTime() < Date.now() + 30 * 60_000) throw new Error("Choose a time at least 30 minutes from now");
  const homes = await db.select().from(dealHomes).where(eq(dealHomes.status, "available")).orderBy(asc(dealHomes.id));
  const home = homes.find((item) => hashSecret(`deals-card:${item.sourceKey}`).slice(0, 20) === input.card);
  if (!home) throw new Error("That home is no longer available");
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, input.leadId)).limit(1))[0];
  if (!lead) throw new Error("Access expired");
  // Dedupe and FUB task aggregation follow the Chicago date on which the
  // visitor made the request, never a later preferred-tour date.
  const day = chicagoDay(new Date());
  const prior = await db.select().from(dealTourRequests).where(and(eq(dealTourRequests.leadId, lead.id), eq(dealTourRequests.chicagoDay, day))).orderBy(asc(dealTourRequests.createdAt));
  // A save on the same home never swallows the tour request that follows it.
  const same = prior.find((item) => item.homeId === home.id && item.requestType === input.requestType);
  if (same) return { ok: true as const, appended: true, duplicate: true };
  let inserted: unknown;
  try {
    inserted = await db.insert(dealTourRequests).values({ leadId: lead.id, homeId: home.id, requestType: input.requestType, preferredAt: input.preferredAt, chicagoDay: day });
  } catch (error) {
    // The unique key is authoritative when two rapid taps race this preflight read.
    if (isDuplicateRequestError(error)) return { ok: true as const, appended: true, duplicate: true };
    throw error;
  }
  const requestId = Number((inserted as unknown as [{ insertId?: number }])[0]?.insertId);
  if (!Number.isSafeInteger(requestId) || requestId < 1) throw new Error("Could not queue this request");
  // Toggle (c): a test number with the full pipeline off keeps its request row
  // for admin, but queues no FUB task, no FUB note and no team email.
  const testMode = await requestTestMode(lead.phoneE164);
  if (!testMode.quiet) {
    // The visitor never waits on CRM or notification networking. Each side effect
    // is persisted with its own idempotency key before this mutation returns.
    await enqueueDealsRequestJobs(lead.id, requestId, day);
    void runPendingDealsFubJobs(3).catch((error) => console.error("[deals] request outbox run failed", error));
  }
  await logDealEvent({ leadId: lead.id, kind: "tour_request", sourceCode: input.sourceCode, deviceHash: input.deviceHash, detail: input.requestType });
  return { ok: true as const, appended: prior.length > 0, duplicate: false, quietTest: testMode.quiet };
}

/**
 * The buyer's save mark on a home. The first save of a home creates the
 * request row that notifies the team (and the buyer's agent, when there is
 * one) through the same task, note and email jobs as a tour request; an
 * unsave only records `removedAt`, and saving the same home again just clears
 * it, so nobody is notified twice for one home.
 */
export async function setDealsHomeSaved(input: { leadId: number; card: string; saved: boolean; sourceCode: string; deviceHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const homes = await db.select().from(dealHomes).where(eq(dealHomes.status, "available")).orderBy(asc(dealHomes.id));
  const home = homes.find((item) => hashSecret(`deals-card:${item.sourceKey}`).slice(0, 20) === input.card);
  if (!home) throw new Error("That home is no longer available");
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, input.leadId)).limit(1))[0];
  if (!lead) throw new Error("Access expired");
  const existing = await db.select().from(dealTourRequests).where(and(eq(dealTourRequests.leadId, lead.id), eq(dealTourRequests.homeId, home.id), eq(dealTourRequests.requestType, "save"))).orderBy(asc(dealTourRequests.createdAt));
  const active = existing.find((row) => !row.removedAt);
  if (!input.saved) {
    if (active) await db.update(dealTourRequests).set({ removedAt: new Date() }).where(and(eq(dealTourRequests.leadId, lead.id), eq(dealTourRequests.homeId, home.id), eq(dealTourRequests.requestType, "save")));
    if (active) await logDealEvent({ leadId: lead.id, kind: "home_unsaved", sourceCode: input.sourceCode, deviceHash: input.deviceHash });
    return { ok: true as const, saved: false, notified: false };
  }
  if (active) return { ok: true as const, saved: true, notified: false };
  if (existing.length) {
    // Saved before and removed: restore the mark without a second notification.
    await db.update(dealTourRequests).set({ removedAt: null }).where(eq(dealTourRequests.id, existing[existing.length - 1]!.id));
    await logDealEvent({ leadId: lead.id, kind: "home_saved", sourceCode: input.sourceCode, deviceHash: input.deviceHash, detail: "restored" });
    return { ok: true as const, saved: true, notified: false };
  }
  const day = chicagoDay(new Date());
  let inserted: unknown;
  try {
    inserted = await db.insert(dealTourRequests).values({ leadId: lead.id, homeId: home.id, requestType: "save", preferredAt: new Date(), chicagoDay: day });
  } catch (error) {
    if (isDuplicateRequestError(error)) return { ok: true as const, saved: true, notified: false };
    throw error;
  }
  const requestId = Number((inserted as unknown as [{ insertId?: number }])[0]?.insertId);
  if (!Number.isSafeInteger(requestId) || requestId < 1) throw new Error("Could not save this home");
  // A team member's own saves are bookmarks: nobody is notified and nothing is written to FUB.
  const testMode = await requestTestMode(lead.phoneE164);
  const notify = !testMode.quiet && lead.status !== "team";
  if (notify) {
    await enqueueDealsRequestJobs(lead.id, requestId, day, "save");
    void runPendingDealsFubJobs(3).catch((error) => console.error("[deals] save outbox run failed", error));
  }
  await logDealEvent({ leadId: lead.id, kind: "home_saved", sourceCode: input.sourceCode, deviceHash: input.deviceHash });
  return { ok: true as const, saved: true, notified: notify };
}
