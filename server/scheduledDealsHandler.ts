import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, lt, or } from "drizzle-orm";
import { dealJobRuns } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { CATALOG_BATCH_BUDGET_MS, refreshDueCommunitiesBatch, revalidateDealIncentives } from "./dealsSync";
import { importTrecLicenses } from "./dealsTrec";
import { cleanupDealsTestRecords, runBuilderDealsHealthJob, sendBuilderDealsMondayReport, syncKnownAgentsFromFub, syncTeamAllowlistFromFub } from "./dealsMaintenance";
import { enqueueDailyActivityNote, runPendingDealsFubJobs } from "./dealsFubJobs";
import { looksLikeDbError, maskPersonalData, redactJobError } from "./dealsJobRuns";
import { SCHEDULED_PHOTO_RESPOND_MS, pruneDealPhotoRenders, runScheduledDealPhotoDrain } from "./dealsPhotos";

import { chicagoClock, chicagoDay } from "./dealsService";
/**
 * The host's scheduler fires a little early (up to ~30 s), often late (12 minutes on Oct 22), and sometimes
 * not at all: on Oct 22 the 1 AM fires of every nightly job never came, and with one chance a night they
 * all skipped the day. So a daily job is due from a few minutes before its target until the end of that
 * Chicago day, each job is registered with hourly retry fires after its target (registerCron), and once()
 * lets it run at most once per Chicago day: the first fire that lands runs it, the rest answer
 * already_run_today, and a failed run is retried by the next fire.
 */
export const DUE_EARLY_MINUTES = 5;
/** Pure Chicago wall-clock predicate used by the cron callbacks: at or past the target (less the early allowance), same weekday. */
export function isDueAtChicago(now: { hour: number; minute: number; weekday: string }, hour: number, minute: number, weekday?: string) {
  const reached = now.hour * 60 + now.minute >= hour * 60 + minute - DUE_EARLY_MINUTES;
  return reached && (!weekday || now.weekday === weekday);
}
/** A run still "running" this long after it started was cut off (the host recycled the instance mid-run): the next fire takes it over. The longest nightly job, the TREC import, takes about 90 s. */
export const STALE_RUN_MINUTES = 30;
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
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_RUN_MINUTES * 60_000);
  // Each claim carries its own token, so a cut-off run that finishes after a later fire took the row over
  // can only write to its own claim, never record over the run that replaced it.
  const token = `run:${randomUUID()}`;
  const existing = (await db.select().from(dealJobRuns).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day))).limit(1))[0];
  if (existing?.status === "ok") return { skipped: "already_run_today" };
  const stale = existing?.status === "running" && new Date(existing.startedAt).getTime() < staleBefore.getTime();
  if (existing?.status === "running" && !stale) return { skipped: "already_running" };
  if (existing?.status === "failed" || stale) {
    const retry = await db.update(dealJobRuns).set({ status: "running", startedAt: now, completedAt: null, detail: token })
      .where(and(eq(dealJobRuns.id, existing!.id), or(eq(dealJobRuns.status, "failed"), and(eq(dealJobRuns.status, "running"), lt(dealJobRuns.startedAt, staleBefore)))));
    if (!Number((retry as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0)) return { skipped: "already_running" };
  } else {
    try { await db.insert(dealJobRuns).values({ jobName, chicagoDay: day, status: "running", startedAt: now, detail: token }); }
    catch { return { skipped: "already_running" }; }
  }
  const mine = and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day), eq(dealJobRuns.status, "running"), eq(dealJobRuns.detail, token));
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
    await db.update(dealJobRuns).set({ status: "ok", detail: storedResult(result).slice(0, 10_000), completedAt: new Date() }).where(mine);
    return result;
  } catch (error) {
    // A thrown error (a database error quotes the values it was given) is stored redacted: first line, no values.
    await db.update(dealJobRuns).set({ status: "failed", detail: (detail ?? (error instanceof Error ? `threw: ${redactJobError(error.message)}` : "failed")).slice(0, 10_000), completedAt: new Date() }).where(mine);
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

/**
 * The host's scheduler gives up on a scheduled call at 30 s (and the instance
 * may then be throttled or recycled), so the photo and catalog calls answer by
 * this time no matter what; their work keeps going behind the answer, and every
 * write it makes is guarded (photo claims, builder leases) so a cut-off run
 * can only lose work.
 */
export const SCHEDULED_RESPOND_MS = 26_000;
/** A catalog call with at least this much of its budget left spends it on photos. */
export const CATALOG_PHOTO_TOPUP_MIN_MS = 3_000;

/**
 * One catalog call: the builder checks first (4 AM to 10 PM Central); when
 * they are done with budget left (nothing due, or every due builder read),
 * the rest of the call's CATALOG_BATCH_BUDGET_MS drains photos. The batch has
 * returned by then, so page reads and image work never run side by side in
 * this call. Outside catalog hours the whole budget goes to photos.
 */
export async function catalogCall(clock: () => number = Date.now): Promise<unknown> {
  const started = clock();
  const { hour } = chicagoClock();
  const inHours = hour >= CATALOG_FIRST_HOUR && hour < CATALOG_LAST_HOUR;
  const catalog = inHours ? await refreshDueCommunitiesBatch() : { skipped: "outside_catalog_hours_chicago" };
  const left = CATALOG_BATCH_BUDGET_MS - (clock() - started);
  if ((inHours && (catalog as { stoppedForTime?: boolean }).stoppedForTime) || left < CATALOG_PHOTO_TOPUP_MIN_MS) return catalog;
  const photos = await runScheduledDealPhotoDrain({ budgetMs: left, respondWithinMs: Math.max(0, SCHEDULED_PHOTO_RESPOND_MS - (clock() - started)) });
  return { ...catalog, photos };
}
async function answerWithin<T>(work: Promise<T>, partial: () => unknown): Promise<T | unknown> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<{ late: true }>((resolve) => { timer = setTimeout(() => resolve({ late: true }), SCHEDULED_RESPOND_MS); });
  try {
    const outcome = await Promise.race([work, late]);
    if (outcome && typeof outcome === "object" && (outcome as { late?: unknown }).late === true) {
      void work.catch((error) => console.warn(`[deals-cron] work after the answer failed: ${error instanceof Error ? error.message : "unknown"}`));
      return partial();
    }
    return outcome;
  } finally { if (timer) clearTimeout(timer); }
}

/** Cron-only endpoint; definitions register idempotently at production startup. */
export async function scheduledDealsHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req); if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const job = typeof req.body?.job === "string" ? req.body.job : "catalog";
    if (job === "incentive") return res.json({ ok: true, result: await whenDue(dueAt(18, 15), "builder-deals-incentive-revalidate", revalidateDealIncentives) });
    // Every 2 minutes (odd minutes, :00): 20 s of builder checks per call from 4 AM to 10 PM Central (see
    // refreshDueCommunitiesBatch), then photos with whatever budget is left (catalogCall), answered by
    // SCHEDULED_RESPOND_MS; a community still being read finishes after the answer.
    if (job === "catalog") return res.json({ ok: true, result: await answerWithin(catalogCall(), () => ({ partial: true, detail: "answered before the batch finished; communities in flight finish after the answer" })) });
    // Monday 5:00 AM Central: find communities the builders added (new ones stay hidden until their first clean update).
    // The run itself goes to the background (it can take an hour); the once-a-day row only records that it was started.
    if (job === "discovery") {
      const { startCommunityDiscovery } = await import("./dealsDiscovery");
      return res.json({ ok: true, result: await whenDue(dueAt(5, 0, "Mon"), "builder-deals-discovery", async () => startCommunityDiscovery()) });
    }
    // Every five minutes: a discovery run whose server process was retired carries on where it stopped.
    if (job === "discovery-resume") {
      const { resumeStaleCommunityDiscovery } = await import("./dealsDiscovery");
      return res.json({ ok: true, result: await resumeStaleCommunityDiscovery() });
    }
    if (job === "trec") return res.json({ ok: true, result: await whenDue(dueAt(1, 15), "builder-deals-trec-import", importTrecLicenses) });
    if (job === "team") return res.json({ ok: true, result: await whenDue(dueAt(1, 30), "builder-deals-team-sync", syncTeamAllowlistFromFub) });
    if (job === "agents") return res.json({ ok: true, result: await whenDue(dueAt(1, 45), "builder-deals-known-agent-sync", syncKnownAgentsFromFub) });
    if (job === "fub") return res.json({ ok: true, result: await runPendingDealsFubJobs() });
    // Every 2 minutes (even minutes): due pending photos and abandoned claims, in priority order. The
    // drain stops starting photos after 20 s and answers by 24 s with what it did (partial when photos
    // are still in flight); answerWithin is a second guard. Not a once-per-day job, so it is not
    // recorded in deal_job_runs; each call records the photo drain status the health check reads.
    // The catalog runs on the odd minutes, so the two never share a call slot.
    if (job === "photos") return res.json({ ok: true, result: await answerWithin(runScheduledDealPhotoDrain(), () => ({ partial: true, detail: "answered before the drain finished" })) });
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
