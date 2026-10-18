import crypto from "node:crypto";
import { and, asc, eq, lte, lt, or, sql } from "drizzle-orm";
import { dealFubJobs, dealFubRecords, dealHomes, dealLeads, dealTourRequests } from "../drizzle/schema";
import { getDb } from "./db";
import {
  appendBuilderDealsRequestNote,
  appendBuilderDealsTourTask,
  createBuilderDealsTourTask,
  formatChicagoDateTime,
  sendBuilderDealsLeadToFub,
  type FubDeliveryResult,
  updateBuilderDealsLeadInFub,
} from "./dealsFub";
import { sendBuilderDealsEmail } from "./dealsEmail";
import { getDealSettings } from "./dealsService";

export type FubOperation =
  | "first_unlock"
  | "reverify"
  | `request_task:${number}`
  | `request_note:${number}`
  | `request_email:${number}`;

type LeadJobMetadata = { reason?: "re-verified on a second device" | "returned for a new link"; occurrenceId?: string };
type RequestJobMetadata = { requestId: number };
type JobMetadata = LeadJobMetadata | RequestJobMetadata;

const LEASE_MS = 5 * 60_000;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 60 * 60_000;

function retryAt(attempts: number) {
  return new Date(Date.now() + Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(attempts, 6)));
}
function parseMetadata(value: string): JobMetadata {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as JobMetadata : {};
  } catch { return {}; }
}
function requestIdFromOperation(operation: string): number | null {
  const value = Number(operation.split(":")[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * The unique (lead, operation) key is an outbox idempotency key. On repeat we
 * intentionally update the payload/retry time so a reverify preserves its most
 * recent reason. A currently-held lease retains its state/token, so enqueue
 * cannot cause a concurrent worker to execute the row twice.
 */
export async function enqueueDealsFubJob(
  leadId: number,
  operation: FubOperation,
  metadata: JobMetadata | "re-verified on a second device" | "returned for a new link" = {},
) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const payload = {
    ...(typeof metadata === "string" ? { reason: metadata } : metadata),
    ...(operation === "reverify" ? { occurrenceId: new Date().toISOString() } : {}),
  };
  await db.insert(dealFubJobs).values({ leadId, operation, payload: JSON.stringify(payload), status: "pending", nextAttemptAt: now })
    .onDuplicateKeyUpdate({ set: {
      payload: JSON.stringify(payload),
      // A worker that has already won the compare-and-swap keeps its lease. It
      // re-reads payload after claiming, so it still uses this fresh metadata.
      status: sql`IF(${dealFubJobs.status} = 'leased', 'leased', 'pending')`,
      nextAttemptAt: now,
      lastError: sql`IF(${dealFubJobs.status} = 'leased', ${dealFubJobs.lastError}, NULL)`,
      completedAt: sql`IF(${dealFubJobs.status} = 'leased', ${dealFubJobs.completedAt}, NULL)`,
      leaseToken: sql`IF(${dealFubJobs.status} = 'leased', ${dealFubJobs.leaseToken}, NULL)`,
      leasedAt: sql`IF(${dealFubJobs.status} = 'leased', ${dealFubJobs.leasedAt}, NULL)`,
    } });
}

export async function enqueueDealsRequestJobs(leadId: number, requestId: number) {
  const metadata: RequestJobMetadata = { requestId };
  await Promise.all([
    enqueueDealsFubJob(leadId, `request_task:${requestId}`, metadata),
    enqueueDealsFubJob(leadId, `request_note:${requestId}`, metadata),
    enqueueDealsFubJob(leadId, `request_email:${requestId}`, metadata),
  ]);
}

async function recordFubDelivery(leadId: number, result: Extract<FubDeliveryResult, { ok: true }>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  for (const record of result.records) {
    await db.insert(dealFubRecords).values({ leadId, ...record })
      .onDuplicateKeyUpdate({ set: {
        leadId,
        // A later lookup of an object we originally created must not turn it
        // into an externally owned object and make cleanup leak it forever.
        createdByUs: sql`IF(${dealFubRecords.createdByUs}, true, VALUES(created_by_us))`,
      } });
  }
}

/** Atomically claims one due or abandoned job and verifies its opaque lease token. */
async function leaseDueJob(job: typeof dealFubJobs.$inferSelect) {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const token = crypto.randomUUID();
  const due = or(
    and(eq(dealFubJobs.status, "pending"), lte(dealFubJobs.nextAttemptAt, now)),
    and(eq(dealFubJobs.status, "failed"), lte(dealFubJobs.nextAttemptAt, now)),
    and(eq(dealFubJobs.status, "leased"), lt(dealFubJobs.leasedAt, new Date(now.getTime() - LEASE_MS))),
  );
  // The WHERE is the compare-and-swap. Competing workers may see the same
  // candidate but only one moves it to leased; token re-read proves ownership.
  await db.update(dealFubJobs).set({ status: "leased", leaseToken: token, leasedAt: now, lastError: null })
    .where(and(eq(dealFubJobs.id, job.id), due));
  const claimed = (await db.select().from(dealFubJobs)
    .where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, token))).limit(1))[0];
  return claimed ?? null;
}

async function loadRequestJob(job: typeof dealFubJobs.$inferSelect) {
  const db = await getDb();
  if (!db) return null;
  const metadata = parseMetadata(job.payload) as RequestJobMetadata;
  const requestId = metadata.requestId ?? requestIdFromOperation(job.operation);
  if (!requestId) return null;
  const request = (await db.select().from(dealTourRequests).where(eq(dealTourRequests.id, requestId)).limit(1))[0];
  if (!request || request.leadId !== job.leadId) return null;
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, job.leadId)).limit(1))[0];
  const home = (await db.select().from(dealHomes).where(eq(dealHomes.id, request.homeId)).limit(1))[0];
  if (!lead || !home || lead.status === "blocked" || lead.status === "team") return null;
  return { request, lead, home, privateDescription: `${home.privateAddress ?? "Requested home"}${home.privatePlanName ? ` (${home.privatePlanName})` : ""}` };
}

async function executeRequestTask(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  const db = await getDb();
  const loaded = await loadRequestJob(job);
  if (!db) return { ok: false, error: "Database unavailable" };
  if (!loaded) return { ok: true, records: [] };
  const dayRequests = await db.select().from(dealTourRequests)
    .where(and(eq(dealTourRequests.leadId, loaded.lead.id), eq(dealTourRequests.chicagoDay, loaded.request.chicagoDay)))
    .orderBy(asc(dealTourRequests.createdAt));
  const dayTaskId = dayRequests.find((request) => request.fubTaskId)?.fubTaskId;
  const result = dayTaskId
    ? await appendBuilderDealsTourTask({ lead: loaded.lead, request: loaded.request, taskId: dayTaskId, privateDescription: loaded.privateDescription })
    : await createBuilderDealsTourTask({ lead: loaded.lead, request: loaded.request, privateDescription: loaded.privateDescription });
  if (result.ok && result.taskId) {
    // All requests on the same Chicago request day show the same task in admin.
    await db.update(dealTourRequests).set({ fubTaskId: result.taskId }).where(and(eq(dealTourRequests.leadId, loaded.lead.id), eq(dealTourRequests.chicagoDay, loaded.request.chicagoDay)));
  }
  return result;
}

async function executeRequestNote(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  const db = await getDb();
  const loaded = await loadRequestJob(job);
  if (!db) return { ok: false, error: "Database unavailable" };
  if (!loaded || loaded.request.fubNoteSentAt) return { ok: true, records: [] };
  const result = await appendBuilderDealsRequestNote({ lead: loaded.lead, request: loaded.request, privateDescription: loaded.privateDescription });
  if (result.ok) {
    const noteId = result.records.find((record) => record.kind === "note")?.fubId;
    await db.update(dealTourRequests).set({ fubNoteSentAt: new Date(), fubNoteId: noteId ?? undefined }).where(eq(dealTourRequests.id, loaded.request.id));
  }
  return result;
}

async function executeRequestEmail(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  const db = await getDb();
  const loaded = await loadRequestJob(job);
  if (!db) return { ok: false, error: "Database unavailable" };
  if (!loaded || loaded.request.emailSentAt) return { ok: true, records: [] };
  const settings = await getDealSettings();
  const sent = await sendBuilderDealsEmail({
    category: "tour_request",
    recipients: settings.alertRecipients,
    subject: loaded.request.requestType === "tour" ? "Builder Deals tour request" : "Builder Deals question",
    content: `Builder Deals lead ${loaded.lead.id} requested ${loaded.privateDescription}.\nPreferred: ${formatChicagoDateTime(loaded.request.preferredAt)}\nReview the protected request in Admin → Builder Deals.`,
  });
  if (!sent.ok) return { ok: false, error: sent.error ?? "Builder Deals email was not accepted" };
  await db.update(dealTourRequests).set({ emailSentAt: new Date() }).where(eq(dealTourRequests.id, loaded.request.id));
  return { ok: true, records: [] };
}

async function executeLeasedJob(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  if (job.operation === "first_unlock" || job.operation === "reverify") {
    const db = await getDb();
    if (!db) return { ok: false, error: "Database unavailable" };
    const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, job.leadId)).limit(1))[0];
    if (!lead || lead.status === "blocked" || lead.status === "team") return { ok: true, records: [] };
    const flags = (() => { try { const parsed = JSON.parse(lead.flags); return Array.isArray(parsed) ? parsed : parsed.flags ?? []; } catch { return []; } })();
    // The test marker follows test-number membership, not an optional screening
    // flag. The value is captured only in the job runner and never browser-side.
    const { getDealSettings } = await import("./dealsService");
    const settings = await getDealSettings();
    const payload = { id: lead.id, phone: lead.phoneE164, email: lead.email, name: lead.name, instagramHandle: lead.instagramHandle, sourceCode: lead.sourceCode, consentText: lead.consentText, consentAt: lead.consentAt, consentIp: lead.consentIp, flags, timeline: lead.timeline, isTest: settings.testNumbers.includes(lead.phoneE164) };
    const metadata = parseMetadata(job.payload) as LeadJobMetadata;
    return job.operation === "first_unlock"
      ? sendBuilderDealsLeadToFub(payload)
      : updateBuilderDealsLeadInFub(payload, metadata.reason ?? "returned for a new link", metadata.occurrenceId);
  }
  if (job.operation.startsWith("request_task:")) return executeRequestTask(job);
  if (job.operation.startsWith("request_note:")) return executeRequestNote(job);
  if (job.operation.startsWith("request_email:")) return executeRequestEmail(job);
  return { ok: false, error: "Unknown Builder Deals FUB job operation" };
}

/**
 * Re-reads every record after a database compare-and-swap lease. Failed rows
 * are selected again after nextAttemptAt, and stale leases can be recovered
 * after a process crash. No worker completes a row unless its token still owns
 * it, so concurrent web requests and cron runs cannot double-send it.
 */
export async function runPendingDealsFubJobs(limit = 25) {
  const db = await getDb();
  if (!db) return { sent: 0, failed: 0, skipped: 0, leased: 0 };
  const now = new Date();
  const due = or(
    and(eq(dealFubJobs.status, "pending"), lte(dealFubJobs.nextAttemptAt, now)),
    and(eq(dealFubJobs.status, "failed"), lte(dealFubJobs.nextAttemptAt, now)),
    and(eq(dealFubJobs.status, "leased"), lt(dealFubJobs.leasedAt, new Date(now.getTime() - LEASE_MS))),
  );
  const candidates = await db.select().from(dealFubJobs).where(due).orderBy(asc(dealFubJobs.nextAttemptAt), asc(dealFubJobs.id)).limit(limit);
  let sent = 0; let failed = 0; let skipped = 0; let leased = 0;
  for (const candidate of candidates) {
    const job = await leaseDueJob(candidate);
    if (!job) continue;
    // leaseDueJob always writes a token. Keep it as a non-null local value so
    // every subsequent mutation compares against the exact winning lease.
    const leaseToken = job.leaseToken;
    if (!leaseToken) continue;
    leased += 1;
    try {
      // An enqueue can update the only per-operation outbox row while this
      // worker holds it. Re-read after claiming so the newest reason wins.
      const current = (await db.select().from(dealFubJobs).where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken))).limit(1))[0];
      if (!current) continue;
      if (current.payload !== job.payload) {
        await db.update(dealFubJobs).set({ status: "pending", nextAttemptAt: new Date(), leaseToken: null, leasedAt: null }).where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.leaseToken, leaseToken)));
        continue;
      }
      const result = await executeLeasedJob(current);
      const afterDelivery = (await db.select({ payload: dealFubJobs.payload }).from(dealFubJobs).where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken))).limit(1))[0];
      if (afterDelivery && afterDelivery.payload !== current.payload) {
        await db.update(dealFubJobs).set({ status: "pending", nextAttemptAt: new Date(), leaseToken: null, leasedAt: null }).where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.leaseToken, leaseToken)));
        continue;
      }
      if (result.ok) {
        await recordFubDelivery(job.leadId, result);
        await db.update(dealFubJobs).set({ status: "synced", completedAt: new Date(), attempts: job.attempts + 1, leaseToken: null, leasedAt: null, lastError: result.warning ?? null })
          .where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken)));
        if (job.operation === "first_unlock" || job.operation === "reverify") {
          await db.update(dealLeads).set({ fubStatus: "synced", fubPersonId: result.personId ?? undefined }).where(eq(dealLeads.id, job.leadId));
        }
        if (result.records.length === 0) skipped += 1; else sent += 1;
      } else {
        const attempts = job.attempts + 1;
        await db.update(dealFubJobs).set({ status: "failed", attempts, lastError: result.error, nextAttemptAt: retryAt(attempts), leaseToken: null, leasedAt: null })
          .where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken)));
        if (job.operation === "first_unlock" || job.operation === "reverify") await db.update(dealLeads).set({ fubStatus: "failed" }).where(eq(dealLeads.id, job.leadId));
        failed += 1;
      }
    } catch (error) {
      const attempts = job.attempts + 1;
      await db.update(dealFubJobs).set({ status: "failed", attempts, lastError: error instanceof Error ? error.message.slice(0, 10_000) : "FUB job failed", nextAttemptAt: retryAt(attempts), leaseToken: null, leasedAt: null })
        .where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken)));
      failed += 1;
    }
  }
  return { sent, failed, skipped, leased };
}

export async function retryDealsFubJob(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(dealFubJobs).set({ status: "pending", nextAttemptAt: new Date(), lastError: null, leaseToken: null, leasedAt: null }).where(eq(dealFubJobs.id, id));
}
