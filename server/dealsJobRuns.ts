import { desc, gte } from "drizzle-orm";
import { dealJobRuns } from "../drizzle/schema";
import { getDb } from "./db";

export const JOB_RUNS_DAYS = 3;
export const JOB_RUNS_LIMIT = 300;
export const JOB_RUN_DETAIL_MAX = 2_000;

/** How much of an error message is kept: its first line, without values, at most this long. */
export const JOB_ERROR_MAX = 300;

/** An e-mail address; the local part may hold an apostrophe (o'neil@…), so a quote cannot hide one. */
const EMAIL_SHAPE = /[^\s@"<>(),;:]+@[^\s@'"<>(),;:]+\.[A-Za-z]{2,}/g;
/** North American phone shapes ("2105550123", "(210) 555-0123", "+1 210.555.0123"), as the note extractor reads them. */
const PHONE_SHAPE = /(?<!\d)(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/g;
const LONG_DIGITS = /\d{7,}/g;

/**
 * Masks anything shaped like personal data, wherever it appears in a stored or shown detail: e-mail addresses,
 * phone numbers and long digit runs (account numbers). Counts, dates and ids under seven digits stay readable.
 */
export function maskPersonalData(text: string): string {
  return text.replace(EMAIL_SHAPE, "[email]").replace(PHONE_SHAPE, "[phone]").replace(LONG_DIGITS, "[number]");
}

/**
 * An error message safe to store and show: a database error ("Failed query: … params: …", "Duplicate entry
 * 'O'Brien-+1210…' for key …") carries the values it was given, which can be names, phone numbers or e-mails. Only
 * the first line is kept, without "params:" and what follows. The value of MySQL's value-bearing messages is replaced
 * as a whole, greedily, so a value with its own apostrophe cannot end the match early ("Duplicate entry '…' for key",
 * "… '…' for column … at row"); every other quoted value ('…' or "…") becomes '?' (backquoted SQL identifiers are
 * names, not values, and stay); anything still shaped like an e-mail, phone or long number is masked. Cut to 300.
 */
/**
 * Oct 27, 2026: a database error from drizzle reads "Failed query: <whole SQL>" with the real cause (the MySQL
 * message) attached as `cause`; the first line alone said nothing. The cause leads, the query's first words follow.
 */
export function jobErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "failed";
  const cause = error.cause instanceof Error ? error.cause.message : typeof error.cause === "string" ? error.cause : null;
  const first = error.message.split(/\r?\n/)[0] ?? "";
  return cause ? `${cause.split(/\r?\n/)[0]} (during: ${first.slice(0, 60)})` : error.message;
}

export function redactJobError(message: string): string {
  const first = (message.split(/\r?\n/)[0] ?? "").replace(/\bparams:.*$/i, "");
  // The value-bearing messages first (greedy, on the raw text), then personal shapes are masked before the generic
  // quote rule too, so an apostrophe inside a value cannot split an e-mail or a phone number.
  const valued = maskPersonalData(first
    .replace(/Duplicate entry '.*' for key '.*'/gi, "Duplicate entry '?' for key '?'")
    .replace(/Duplicate entry '.*' for key/gi, "Duplicate entry '?' for key")
    .replace(/'.*' for column '([^']*)'/gi, "'?' for column '$1'"));
  const unquoted = maskPersonalData(valued.replace(/'(?:[^'\\]|\\.)*'?/g, "'?'").replace(/"(?:[^"\\]|\\.)*"?/g, '"?"')).replace(/\s+/g, " ").trim();
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
  // Every detail is masked as shown, whatever wrote it (older rows included).
  const masked = maskPersonalData(row.detail);
  return masked.length > JOB_RUN_DETAIL_MAX ? `${masked.slice(0, JOB_RUN_DETAIL_MAX - 1)}…` : masked;
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
