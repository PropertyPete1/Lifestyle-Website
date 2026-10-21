import { desc, gte } from "drizzle-orm";
import { dealJobRuns } from "../drizzle/schema";
import { getDb } from "./db";

export const JOB_RUNS_DAYS = 3;
export const JOB_RUNS_LIMIT = 300;
export const JOB_RUN_DETAIL_MAX = 2_000;

/** How much of an error message is kept: its first line, without values, at most this long. */
export const JOB_ERROR_MAX = 300;

/**
 * An error message safe to store and show: a database error ("Failed query: … params: …", "Duplicate entry
 * '+1210…' for key …") carries the values it was given, which can be phone numbers or e-mails. Only the first line is
 * kept, without "params:" and what follows, with every quoted value ('…' or "…") replaced by '?' (backquoted SQL
 * identifiers are names, not values, and stay), cut to 300 characters.
 */
export function redactJobError(message: string): string {
  const first = (message.split(/\r?\n/)[0] ?? "").replace(/\bparams:.*$/i, "");
  const unquoted = first.replace(/'(?:[^'\\]|\\.)*'?/g, "'?'").replace(/"(?:[^"\\]|\\.)*"?/g, '"?"').replace(/\s+/g, " ").trim();
  return unquoted.length <= JOB_ERROR_MAX ? unquoted : `${unquoted.slice(0, JOB_ERROR_MAX - 1)}…`;
}

/** A stored detail that is (or holds) a raw database error, as rows written before redaction may. */
const DB_ERROR = /Failed query|\bparams:|Duplicate entry|\bER_[A-Z_]+|sqlMessage|errno/i;
export const looksLikeDbError = (text: string) => DB_ERROR.test(text);
/** A claim token (builder lease, discovery run): an internal handle, not information. */
const CLAIM_TOKEN = /^(?:run:)?[0-9a-f-]{20,40}$/i;

function viewDetail(row: { chicagoDay: string; status: string; detail: string | null }): string | null {
  if (row.chicagoDay === "lease") return row.status === "running" ? "builder lease held" : "builder lease released";
  if (row.detail === null) return null;
  if (CLAIM_TOKEN.test(row.detail.trim())) return row.status === "running" ? "run in progress (claim token hidden)" : "claim token hidden";
  if (looksLikeDbError(row.detail)) return redactJobError(row.detail);
  return row.detail.length > JOB_RUN_DETAIL_MAX ? `${row.detail.slice(0, JOB_RUN_DETAIL_MAX - 1)}…` : row.detail;
}

export type DealJobRunView = { jobName: string; chicagoDay: string; status: "running" | "ok" | "failed" | "skipped"; detail: string | null; startedAt: Date; completedAt: Date | null };

/**
 * The last few days of deal_job_runs for the admin, newest first: what each scheduled job, digest slot and
 * "Refresh now" request recorded, so a failure can be diagnosed live. Read-only. Claim tokens (builder leases, the
 * discovery run) are not shown, and a raw database error stored by an older build is redacted (redactJobError).
 */
export async function recentDealJobRuns(now = new Date()) {
  const db = await getDb();
  if (!db) return { available: false as const, since: null, runs: [] as DealJobRunView[] };
  const since = new Date(now.getTime() - JOB_RUNS_DAYS * 86_400_000);
  const rows = await db.select({ jobName: dealJobRuns.jobName, chicagoDay: dealJobRuns.chicagoDay, status: dealJobRuns.status, detail: dealJobRuns.detail, startedAt: dealJobRuns.startedAt, completedAt: dealJobRuns.completedAt })
    .from(dealJobRuns).where(gte(dealJobRuns.startedAt, since)).orderBy(desc(dealJobRuns.startedAt)).limit(JOB_RUNS_LIMIT);
  const runs: DealJobRunView[] = rows.map((row) => ({ ...row, detail: viewDetail(row) }));
  return { available: true as const, since, runs };
}
