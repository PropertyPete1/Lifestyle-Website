import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { dealJobRuns } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { catalogBatchPending, refreshDueCommunitiesBatch, revalidateDealIncentives } from "./dealsSync";
import { importTrecLicenses } from "./dealsTrec";
import { cleanupDealsTestRecords, runBuilderDealsHealthJob, sendBuilderDealsMondayReport, syncKnownAgentsFromFub, syncTeamAllowlistFromFub } from "./dealsMaintenance";
import { enqueueDailyActivityNote, runPendingDealsFubJobs } from "./dealsFubJobs";
import { looksLikeDbError, maskPersonalData, redactJobError } from "./dealsJobRuns";
import { PHOTO_DRAIN_BUDGET_MS, processPendingDealPhotos, pruneDealPhotoRenders } from "./dealsPhotos";

import { chicagoClock, chicagoDay } from "./dealsService";
/** Pure Chicago wall-clock predicate used by the DST candidate cron callbacks. */
export function isDueAtChicago(now: { hour: number; minute: number; weekday: string }, hour: number, minute: number, weekday?: string) {
  return now.hour === hour && now.minute >= minute && (!weekday || now.weekday === weekday);
}
import { CATALOG_FIRST_HOUR, CATALOG_LAST_HOUR } from "./dealsSchedule";
export { CATALOG_FIRST_HOUR, CATALOG_LAST_HOUR };
function dueAt(hour: number, minute: number, weekday?: string) { return isDueAtChicago(chicagoClock(), hour, minute, weekday); }
function isSuccessfulResult(result: unknown) {
  if (Array.isArray(result)) return result.some((item) => item && typeof item === "object" && (item as { ok?: unknown }).ok === true);
  return !result || typeof result !== "object" || !("ok" in result) || (result as { ok?: boolean }).ok !== false;
}
async function once(jobName: string, work: () => Promise<unknown>) {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  const day = chicagoDay();
  const existing = (await db.select().from(dealJobRuns).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day))).limit(1))[0];
  if (existing?.status === "ok") return { skipped: "already_run_today" };
  if (existing?.status === "running") return { skipped: "already_running" };
  if (existing?.status === "failed") {
    const retry = await db.update(dealJobRuns).set({ status: "running", startedAt: new Date(), completedAt: null }).where(and(eq(dealJobRuns.id, existing.id), eq(dealJobRuns.status, "failed")));
    if (!Number((retry as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0)) return { skipped: "already_running" };
  } else {
    try { await db.insert(dealJobRuns).values({ jobName, chicagoDay: day, status: "running" }); }
    catch { return { skipped: "already_running" }; }
  }
  let detail: string | null = null;
  try {
    const result = await work();
    if (!isSuccessfulResult(result)) {
      // The job's own reason (and its result, which carries counts and reason codes, never a credential) is what
      // deals.admin.jobRuns shows, so a failure can be diagnosed without server logs.
      const reason = redactJobError(jobFailureReason(result));
      detail = `${reason}\n${storedResult(result).slice(0, 8_000)}`;
      throw new Error(reason);
    }
    await db.update(dealJobRuns).set({ status: "ok", detail: storedResult(result).slice(0, 10_000), completedAt: new Date() }).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day), eq(dealJobRuns.status, "running")));
    return result;
  } catch (error) {
    // A thrown error (a database error quotes the values it was given) is stored redacted: first line, no values.
    await db.update(dealJobRuns).set({ status: "failed", detail: (detail ?? (error instanceof Error ? `threw: ${redactJobError(error.message)}` : "failed")).slice(0, 10_000), completedAt: new Date() }).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day), eq(dealJobRuns.status, "running")));
    throw error;
  }
}

/** A job result as stored in deal_job_runs.detail: every string redacted (a database error) or masked (e-mail, phone, long number). */
function storedResult(result: unknown): string {
  return JSON.stringify(result, (_key, value: unknown) => (typeof value === "string" ? (looksLikeDbError(value) ? redactJobError(value) : maskPersonalData(value)) : value)) ?? "null";
}

/** One line naming why a job reported failure: its own reason code and detail, an email error, or the per-community reasons. */
export function jobFailureReason(result: unknown): string {
  if (Array.isArray(result)) {
    const reasons = Array.from(new Set(result.map((item) => item && typeof item === "object" ? ((item as { reason?: unknown; skipped?: unknown }).reason ?? (item as { skipped?: unknown }).skipped) : null).filter((value): value is string => typeof value === "string")));
    return `no successful community (${result.length} tried${reasons.length ? `: ${reasons.join(", ").slice(0, 300)}` : ""})`;
  }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
    const parts = [text(record.reason), text(record.detail), text(record.emailError) && `email: ${text(record.emailError)}`, text(record.error)].filter((value): value is string => Boolean(value));
    if (parts.length) return `reported ok:false: ${Array.from(new Set(parts)).join("; ")}`;
  }
  return "reported ok:false without a reason";
}
const whenDue = (due: boolean, job: string, work: () => Promise<unknown>) => due ? once(job, work) : Promise.resolve({ skipped: "not_due_chicago" });

/** Cron-only endpoint; definitions register idempotently at production startup. */
export async function scheduledDealsHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req); if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const job = typeof req.body?.job === "string" ? req.body.job : "catalog";
    if (job === "incentive") return res.json({ ok: true, result: await whenDue(dueAt(18, 15), "builder-deals-incentive-revalidate", revalidateDealIncentives) });
    // Every 10 minutes from 4 AM to 10 PM Central: a few minutes of builder checks per call (see refreshDueCommunitiesBatch).
    if (job === "catalog") {
      const { hour } = chicagoClock();
      if (hour < CATALOG_FIRST_HOUR || hour >= CATALOG_LAST_HOUR) return res.json({ ok: true, result: { skipped: "outside_catalog_hours_chicago" } });
      return res.json({ ok: true, result: await refreshDueCommunitiesBatch() });
    }
    // Monday 5:00 AM Central: find communities the builders added (new ones stay hidden until their first clean update).
    // The run itself goes to the background (it can take an hour); the once-a-day row only records that it was started.
    if (job === "discovery") {
      const { startCommunityDiscovery } = await import("./dealsDiscovery");
      return res.json({ ok: true, result: await whenDue(dueAt(5, 0, "Mon"), "builder-deals-discovery", async () => startCommunityDiscovery()) });
    }
    if (job === "trec") return res.json({ ok: true, result: await whenDue(dueAt(1, 15), "builder-deals-trec-import", importTrecLicenses) });
    if (job === "team") return res.json({ ok: true, result: await whenDue(dueAt(1, 30), "builder-deals-team-sync", syncTeamAllowlistFromFub) });
    if (job === "agents") return res.json({ ok: true, result: await whenDue(dueAt(1, 45), "builder-deals-known-agent-sync", syncKnownAgentsFromFub) });
    if (job === "fub") return res.json({ ok: true, result: await runPendingDealsFubJobs() });
    // Every 5 minutes: due pending photos and abandoned processing leases, in
    // priority order, for up to PHOTO_DRAIN_BUDGET_MS (2.5 min, plus at most PHOTO_TIMEOUT_MS for the photos in flight) per call rather
    // than a fixed count (40 per 10 minutes left a 30,000-photo backlog five days
    // deep). Not a once-per-day job, so it is not recorded in deal_job_runs.
    // The catalog runs at :00, :10, ... for up to 4 minutes: while it still has
    // builders to read, the photo call in its slot (minute 0-4 of each ten) steps
    // aside, so heavy image work and page reads never share the instance.
    if (job === "photos") {
      const { hour, minute } = chicagoClock();
      const catalogSlot = hour >= CATALOG_FIRST_HOUR && hour < CATALOG_LAST_HOUR && minute % 10 < 5;
      if (catalogSlot && await catalogBatchPending().catch(() => true)) return res.json({ ok: true, result: { skipped: "catalog_slot" } });
      return res.json({ ok: true, result: await processPendingDealPhotos({ budgetMs: PHOTO_DRAIN_BUDGET_MS }) });
    }
    // 1:30 AM Chicago: one FUB activity note per lead for the previous day's views and tour requests.
    if (job === "activity") return res.json({ ok: true, result: await whenDue(dueAt(1, 30), "builder-deals-activity-note", () => enqueueDailyActivityNote()) });
    if (job === "alerts") {
      const { dispatchPendingDealAlerts } = await import("./dealsAlerts");
      return res.json({ ok: true, result: await dispatchPendingDealAlerts() });
    }
    // 7:00 AM Chicago: the health check emails the alert recipients only when a check needs attention;
    // 7:05 AM Monday: the System OK report is sent unconditionally (its absence is the alarm).
    if (job === "health") return res.json({ ok: true, result: await whenDue(dueAt(7, 0), "builder-deals-health", runBuilderDealsHealthJob) });
    if (job === "weekly") return res.json({ ok: true, result: await whenDue(dueAt(7, 5, "Mon"), "builder-deals-weekly-report", sendBuilderDealsMondayReport) });
    if (job === "maintenance") return res.json({ ok: true, result: await whenDue(dueAt(7, 30, "Mon"), "builder-deals-maintenance", async () => ({ testRecords: await cleanupDealsTestRecords(), fubRetries: await runPendingDealsFubJobs(), cachedRenderCleanup: await pruneDealPhotoRenders() })) });
    return res.status(400).json({ error: "unknown_job" });
  } catch (error) {
    // Never the raw error text: a database error quotes personal values. The redacted first line is enough for the cron log.
    return res.status(500).json({ error: error instanceof Error ? redactJobError(error.message) || "deals-job-failed" : "deals-job-failed" });
  }
}
