import { desc, gte } from "drizzle-orm";
import { dealJobRuns } from "../drizzle/schema";
import { getDb } from "./db";

export const JOB_RUNS_DAYS = 3;
export const JOB_RUNS_LIMIT = 300;
export const JOB_RUN_DETAIL_MAX = 2_000;

export type DealJobRunView = { jobName: string; chicagoDay: string; status: "running" | "ok" | "failed" | "skipped"; detail: string | null; startedAt: Date; completedAt: Date | null };

/**
 * The last few days of deal_job_runs for the admin, newest first: what each scheduled job, digest slot and
 * "Refresh now" request recorded, so a failure can be diagnosed live. Read-only. A builder lease row's detail is its
 * holder's release token, which is not shown (it is an internal handle, not information).
 */
export async function recentDealJobRuns(now = new Date()) {
  const db = await getDb();
  if (!db) return { available: false as const, since: null, runs: [] as DealJobRunView[] };
  const since = new Date(now.getTime() - JOB_RUNS_DAYS * 86_400_000);
  const rows = await db.select({ jobName: dealJobRuns.jobName, chicagoDay: dealJobRuns.chicagoDay, status: dealJobRuns.status, detail: dealJobRuns.detail, startedAt: dealJobRuns.startedAt, completedAt: dealJobRuns.completedAt })
    .from(dealJobRuns).where(gte(dealJobRuns.startedAt, since)).orderBy(desc(dealJobRuns.startedAt)).limit(JOB_RUNS_LIMIT);
  const runs: DealJobRunView[] = rows.map((row) => ({
    ...row,
    detail: row.chicagoDay === "lease" ? (row.status === "running" ? "builder lease held" : "builder lease released") : row.detail === null ? null : row.detail.length > JOB_RUN_DETAIL_MAX ? `${row.detail.slice(0, JOB_RUN_DETAIL_MAX - 1)}…` : row.detail,
  }));
  return { available: true as const, since, runs };
}
