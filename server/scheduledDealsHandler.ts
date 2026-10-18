import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { dealJobRuns } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { refreshOfficialDeals } from "./dealsSync";
import { importTrecLicenses } from "./dealsTrec";
import { builderDealsHealthCheck, cleanupDealsTestRecords, createDealsAlert, syncKnownAgentsFromFub, syncTeamAllowlistFromFub } from "./dealsMaintenance";
import { runPendingDealsFubJobs } from "./dealsFubJobs";

function chicagoDay(now = new Date()) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); const value = (key: string) => parts.find((part) => part.type === key)?.value || "00"; return `${value("year")}-${value("month")}-${value("day")}`; }
function chicagoClock(now = new Date()) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now); const value = (key: string) => parts.find((part) => part.type === key)?.value || ""; return { hour: Number(value("hour")), minute: Number(value("minute")), weekday: value("weekday") }; }
function dueAt(hour: number, minute: number, weekday?: string) { const now = chicagoClock(); return now.hour === hour && now.minute >= minute && now.minute < minute + 10 && (!weekday || now.weekday === weekday); }
async function once(jobName: string, work: () => Promise<unknown>) { const db = await getDb(); if (!db) throw new Error("Database unavailable"); const day = chicagoDay(); const exists = (await db.select().from(dealJobRuns).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day))).limit(1))[0]; if (exists?.status === "ok") return { skipped: "already_run_today" }; await db.insert(dealJobRuns).values({ jobName, chicagoDay: day, status: "running" }).onDuplicateKeyUpdate({ set: { status: "running", startedAt: new Date() } }); try { const result = await work(); if (result && typeof result === "object" && "ok" in result && (result as { ok?: boolean }).ok === false) throw new Error("scheduled operation reported failure"); await db.update(dealJobRuns).set({ status: "ok", detail: JSON.stringify(result).slice(0, 10_000), completedAt: new Date() }).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day))); return result; } catch (error) { await db.update(dealJobRuns).set({ status: "failed", detail: error instanceof Error ? error.message : "failed", completedAt: new Date() }).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day))); throw error; } }
const whenDue = (due: boolean, job: string, work: () => Promise<unknown>) => due ? once(job, work) : Promise.resolve({ skipped: "not_due_chicago" });

/** Cron-only endpoint. Definitions remain deliberately unregistered until review approval. */
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
    if (job === "health") return res.json({ ok: true, result: await whenDue(dueAt(7, 0), "builder-deals-health", async () => { const health = await builderDealsHealthCheck(); if (health.twilioVerify.balance === "unavailable" || health.fub.availability === "unavailable") await createDealsAlert("Builder Deals health check needs attention", `Twilio: ${health.twilioVerify.balance}; Follow Up Boss: ${health.fub.availability}. Review Admin → Builder Deals.`); return health; }) });
    if (job === "weekly") return res.json({ ok: true, result: await whenDue(dueAt(7, 5, "Mon"), "builder-deals-weekly-system-ok", async () => { const health = await builderDealsHealthCheck(); await createDealsAlert("Builder Deals System OK", `To: peter@lifestyledesignrealty.com, steven@lifestyledesignrealty.com\n\nTwilio Verify: ${health.twilioVerify.balance}; Follow Up Boss: ${health.fub.availability}. Review the complete Builder Deals health and 7-day funnel summary in Admin → Builder Deals.`); return health; }) });
    if (job === "maintenance") return res.json({ ok: true, result: await whenDue(dueAt(7, 30, "Mon"), "builder-deals-maintenance", async () => ({ testRecords: await cleanupDealsTestRecords(), fubRetries: await runPendingDealsFubJobs(), cachedRenderCleanup: "requires storage-delete capability; no deletion attempted" })) });
    return res.status(400).json({ error: "unknown_job" });
  } catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "deals-job-failed" }); }
}
