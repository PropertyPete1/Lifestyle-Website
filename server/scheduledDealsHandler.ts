import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { dealJobRuns } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { refreshOfficialDeals } from "./dealsSync";
import { importTrecLicenses } from "./dealsTrec";
import { builderDealsHealthCheck, builderDealsMondayReport, cleanupDealsTestRecords, syncKnownAgentsFromFub, syncTeamAllowlistFromFub } from "./dealsMaintenance";
import { runPendingDealsFubJobs } from "./dealsFubJobs";

import { chicagoClock, chicagoDay } from "./dealsService";
function dueAt(hour: number, minute: number, weekday?: string) { const now = chicagoClock(); return now.hour === hour && now.minute >= minute && (!weekday || now.weekday === weekday); }
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
  try { const result = await work(); if (!isSuccessfulResult(result)) throw new Error("scheduled operation reported no successful community"); await db.update(dealJobRuns).set({ status: "ok", detail: JSON.stringify(result).slice(0, 10_000), completedAt: new Date() }).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day), eq(dealJobRuns.status, "running"))); return result; } catch (error) { await db.update(dealJobRuns).set({ status: "failed", detail: error instanceof Error ? error.message : "failed", completedAt: new Date() }).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day), eq(dealJobRuns.status, "running"))); throw error; }
}
const whenDue = (due: boolean, job: string, work: () => Promise<unknown>) => due ? once(job, work) : Promise.resolve({ skipped: "not_due_chicago" });

/** Cron-only endpoint; definitions register idempotently at production startup. */
export async function scheduledDealsHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req); if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const job = typeof req.body?.job === "string" ? req.body.job : "catalog";
    if (job === "incentive") return res.json({ ok: true, result: await whenDue(dueAt(18, 15), "builder-deals-incentive-revalidate", refreshOfficialDeals) });
    if (job === "catalog") return res.json({ ok: true, result: await whenDue(dueAt(18, 45), "builder-deals-catalog-refresh", refreshOfficialDeals) });
    if (job === "trec") return res.json({ ok: true, result: await whenDue(dueAt(1, 15), "builder-deals-trec-import", importTrecLicenses) });
    if (job === "team") return res.json({ ok: true, result: await whenDue(dueAt(1, 30), "builder-deals-team-sync", syncTeamAllowlistFromFub) });
    if (job === "agents") return res.json({ ok: true, result: await whenDue(dueAt(1, 45), "builder-deals-known-agent-sync", syncKnownAgentsFromFub) });
    if (job === "fub") return res.json({ ok: true, result: await runPendingDealsFubJobs() });
    if (job === "alerts") {
      const { dispatchPendingDealAlerts } = await import("./dealsAlerts");
      return res.json({ ok: true, result: await dispatchPendingDealAlerts() });
    }
    // B9 evidence-only runs: once() persists the values for protected review,
    // but neither branch sends an email, owner notification, or alert.
    if (job === "health") return res.json({ ok: true, result: await whenDue(dueAt(7, 0), "builder-deals-health", builderDealsHealthCheck) });
    if (job === "weekly") return res.json({ ok: true, result: await whenDue(dueAt(7, 5, "Mon"), "builder-deals-weekly-report", builderDealsMondayReport) });
    if (job === "maintenance") return res.json({ ok: true, result: await whenDue(dueAt(7, 30, "Mon"), "builder-deals-maintenance", async () => ({ testRecords: await cleanupDealsTestRecords(), fubRetries: await runPendingDealsFubJobs(), cachedRenderCleanup: "requires storage-delete capability; no deletion attempted" })) });
    return res.status(400).json({ error: "unknown_job" });
  } catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "deals-job-failed" }); }
}
