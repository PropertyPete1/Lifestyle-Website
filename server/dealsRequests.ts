import { and, asc, eq } from "drizzle-orm";
import { dealHomes, dealLeads, dealTourRequests } from "../drizzle/schema";
import { getDb } from "./db";
import { chicagoDay, hashSecret, logDealEvent } from "./dealsService";
import { enqueueDealsRequestJobs, runPendingDealsFubJobs } from "./dealsFubJobs";

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
  const same = prior.find((item) => item.homeId === home.id);
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
  // The visitor never waits on CRM or notification networking. Each side effect
  // is persisted with its own idempotency key before this mutation returns.
  await enqueueDealsRequestJobs(lead.id, requestId, day);
  void runPendingDealsFubJobs(3).catch((error) => console.error("[deals] request outbox run failed", error));
  await logDealEvent({ leadId: lead.id, kind: "tour_request", sourceCode: input.sourceCode, deviceHash: input.deviceHash, detail: input.requestType });
  return { ok: true as const, appended: prior.length > 0, duplicate: false };
}
