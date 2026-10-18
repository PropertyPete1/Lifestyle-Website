import { and, eq, lte } from "drizzle-orm";
import { dealFubJobs, dealLeads } from "../drizzle/schema";
import { getDb } from "./db";
import { sendBuilderDealsLeadToFub, updateBuilderDealsLeadInFub } from "./dealsFub";

export type FubOperation = "first_unlock" | "reverify";

export async function enqueueDealsFubJob(leadId: number, operation: FubOperation, reason?: "re-verified on a second device" | "returned for a new link") {
  const db = await getDb(); if (!db) return;
  await db.insert(dealFubJobs).values({ leadId, operation, payload: JSON.stringify({ reason }), status: "pending", nextAttemptAt: new Date() })
    .onDuplicateKeyUpdate({ set: { status: "pending", nextAttemptAt: new Date() } });
}

/** Re-reads the lead at execution time; revoked/team records never get CRM writes. */
export async function runPendingDealsFubJobs(limit = 25) {
  const db = await getDb(); if (!db) return { sent: 0, failed: 0, skipped: 0 };
  const jobs = await db.select().from(dealFubJobs).where(and(eq(dealFubJobs.status, "pending"), lte(dealFubJobs.nextAttemptAt, new Date()))).limit(limit);
  let sent = 0, failed = 0, skipped = 0;
  for (const job of jobs) {
    const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, job.leadId)).limit(1))[0];
    if (!lead || lead.status === "blocked" || lead.status === "team") {
      await db.update(dealFubJobs).set({ status: "synced", completedAt: new Date(), lastError: "Skipped after safe re-read" }).where(eq(dealFubJobs.id, job.id)); skipped++; continue;
    }
    const flags = (() => { try { const parsed = JSON.parse(lead.flags); return Array.isArray(parsed) ? parsed : parsed.flags ?? []; } catch { return []; } })();
    const payload = { id: lead.id, phone: lead.phoneE164, email: lead.email, name: lead.name, instagramHandle: lead.instagramHandle, sourceCode: lead.sourceCode, consentText: lead.consentText, consentAt: lead.consentAt, consentIp: lead.consentIp, flags, timeline: lead.timeline, isTest: flags.includes("TEST") };
    const metadata = (() => { try { return JSON.parse(job.payload) as { reason?: "re-verified on a second device" | "returned for a new link" }; } catch { return {}; } })();
    const result = job.operation === "first_unlock" ? await sendBuilderDealsLeadToFub(payload) : await updateBuilderDealsLeadInFub(payload, metadata.reason ?? "returned for a new link");
    if (result.ok) { await db.update(dealFubJobs).set({ status: "synced", completedAt: new Date(), attempts: job.attempts + 1 }).where(eq(dealFubJobs.id, job.id)); await db.update(dealLeads).set({ fubStatus: "synced", fubPersonId: result.personId ?? lead.fubPersonId }).where(eq(dealLeads.id, lead.id)); sent++; }
    else { const attempts = job.attempts + 1; await db.update(dealFubJobs).set({ status: "failed", attempts, lastError: result.error, nextAttemptAt: new Date(Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempts, 6))) }).where(eq(dealFubJobs.id, job.id)); await db.update(dealLeads).set({ fubStatus: "failed" }).where(eq(dealLeads.id, lead.id)); failed++; }
  }
  return { sent, failed, skipped };
}

export async function retryDealsFubJob(id: number) { const db = await getDb(); if (!db) throw new Error("Database unavailable"); await db.update(dealFubJobs).set({ status: "pending", nextAttemptAt: new Date(), lastError: null }).where(eq(dealFubJobs.id, id)); }
