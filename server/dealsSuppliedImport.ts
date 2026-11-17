import express, { type Request, type RequestHandler, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { dealCommunities, dealHomes } from "../drizzle/schema";
import { getDb } from "./db";
import { officialHostFor } from "./dealsAdapters";
import { checkSuppliedCommunity, officialSuppliedUrl, suppliedCommunitySchema, suppliedEnvelopeSchema, suppliedForSaleCount, suppliedUrlKey, SUPPLIED_IMPORT_FUTURE_SKEW_MS, SUPPLIED_ZERO_CONFIRM_GAP_MS, type SuppliedCommunity, type SuppliedImport } from "./dealsAdapters.supplied";
import { authenticateSuppliedImportKey, latestSuppliedImport, recordSuppliedImportCall, recordSuppliedImportFailures, storeSuppliedImport, suppliedSourceFor, type SuppliedImportFailure } from "./dealsSuppliedStore";
import { refreshSuppliedCommunities, type RefreshResult } from "./dealsSync";

/**
 * POST /api/deals/import: the receiving side of the supplied source
 * (docs/builder-deals-supplied-import.md). The owner's browser agent posts what
 * it saw on the builder's public pages; each known community's import is stored
 * and refreshed through the normal sync before the response, which reports per
 * community what was published or held and why. The key and the payload are
 * never logged.
 */

export const SUPPLIED_IMPORT_PATH = "/api/deals/import";
export const SUPPLIED_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const SUPPLIED_IMPORT_CALLS_PER_HOUR = 30;
/** Failed key checks allowed per client address per hour before it gets 429 (kept in memory). */
export const SUPPLIED_IMPORT_AUTH_FAILURES_PER_HOUR = 20;

const authFailures = new Map<string, number[]>();

function authFailureCount(ip: string, now: number): number {
  const recent = (authFailures.get(ip) ?? []).filter((at) => now - at < 60 * 60_000);
  if (recent.length) authFailures.set(ip, recent); else authFailures.delete(ip);
  return recent.length;
}

function noteAuthFailure(ip: string, now: number) {
  if (authFailures.size > 10_000) authFailures.clear();
  authFailures.set(ip, [...(authFailures.get(ip) ?? []), now]);
}

/** Test hook: forget the in-memory failed-key counts. */
export function resetSuppliedImportAuthFailures() { authFailures.clear(); }

/**
 * The body parser for this path only, mounted BEFORE the app-wide 50 MB JSON
 * parser: it reads at most 2 MB as raw bytes (a larger body is refused with 413
 * before it is buffered whole) and marks the body as read, so the app-wide parser
 * leaves it alone.
 */
export function suppliedImportBodyLimit(): RequestHandler {
  const raw = express.raw({ type: () => true, limit: SUPPLIED_IMPORT_MAX_BYTES });
  return (req, res, next) => {
    if (req.method !== "POST") return next();
    raw(req, res, (error?: unknown) => {
      if (!error) return next();
      const status = (error as { status?: number; type?: string }).type === "entity.too.large" ? 413 : 400;
      res.status(status).json({ ok: false, error: status === 413 ? "body_too_large" : "unreadable_body", ...(status === 413 ? { limitBytes: SUPPLIED_IMPORT_MAX_BYTES } : {}) });
    });
  };
}

export type SuppliedCommunityOutcome = {
  /** The community's page as sent; "" when the entry had no readable link (see `index`). */
  communityUrl: string;
  /** The entry's position in the payload's `communities` list. */
  index: number;
  /** published: live from this import; held: stored, the community holds (last good data stays); skipped: stored, the community is paused, manual or archived; rejected: not stored; stored_not_processed: stored, not refreshed (builder busy). */
  status: "published" | "held" | "skipped" | "rejected" | "stored_not_processed";
  reasons: string[];
  problems: string[];
  homesForSale: number;
  homesSold: number;
  homesShownCount: number | null;
  /** The community's incentive hold after this import, if any (the offer is judged by the same rules as a read). */
  incentiveHold: string | null;
  /** True when reading this community's page again and sending it alone can fix it (an unread or partial entry, a busy builder). False when it published or needs a person. */
  retry: boolean;
  /** What is on the site for this community after this call, read back from the database: null when the page is not a known community. */
  live: { homesAvailable: number; lastPublishedAt: string | null } | null;
};

export type SuppliedImportResponse = { ok: boolean; builder: string; capturedAt: string; communities: SuppliedCommunityOutcome[] };

/** A community entry of a payload that did not pass the schema: never stored, reported back by position. */
export type UnreadSuppliedCommunity = { index: number; communityUrl: string | null; problems: string[] };

const RETRY_HOLDS = new Set(["supplied_import_incomplete", "supplied_import_out_of_bounds", "supplied_import_invalid_home", "supplied_import_duplicate_home"]);

/**
 * Stores each valid community of a payload and refreshes them through the sync, awaited. Each community stands on
 * its own: one that could not be read (`unread`), is unknown, off the builder's site or older than the stored import
 * is reported and leaves the others, and its own last good listings, untouched. A community absent from the payload
 * is not touched. The same capture sent again is not stored twice. Every community that was not published is written
 * to the failure trail with its reason, and the response says what is live after the call.
 */
export async function processSuppliedImport(builder: string, payload: SuppliedImport, options: { now?: Date; leaseWaitMs?: number; pollMs?: number; unread?: readonly UnreadSuppliedCommunity[]; indexes?: readonly number[] } = {}): Promise<{ processed: boolean; response: SuppliedImportResponse }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = options.now ?? new Date();
  const capturedAt = new Date(payload.capturedAt);
  const rows = await db.select().from(dealCommunities).where(eq(dealCommunities.builder, builder));
  const byKey = new Map(rows.map((row) => [suppliedUrlKey(row.sourceUrl), row]));
  const known = (value: string | null) => { const url = value ? officialSuppliedUrl(builder, value) : null; return url ? byKey.get(suppliedUrlKey(url.toString())) ?? null : null; };
  const outcomes: SuppliedCommunityOutcome[] = [];
  const ids = new Map<SuppliedCommunityOutcome, number>();
  const stored: Array<{ outcome: SuppliedCommunityOutcome; communityId: number }> = [];
  for (const entry of options.unread ?? []) {
    const outcome: SuppliedCommunityOutcome = { communityUrl: entry.communityUrl ?? "", index: entry.index, status: "rejected", reasons: ["invalid_payload"], problems: [...entry.problems], homesForSale: 0, homesSold: 0, homesShownCount: null, incentiveHold: null, retry: true, live: null };
    outcomes.push(outcome);
    const row = known(entry.communityUrl);
    if (row) ids.set(outcome, row.id);
  }
  for (let position = 0; position < payload.communities.length; position++) {
    const community = payload.communities[position]!;
    const forSale = community.homes.filter((home) => home.status !== "sold").length;
    const outcome: SuppliedCommunityOutcome = { communityUrl: community.communityUrl, index: options.indexes?.[position] ?? position, status: "rejected", reasons: [], problems: [], homesForSale: forSale, homesSold: community.homes.length - forSale, homesShownCount: community.homesShownCount, incentiveHold: null, retry: false, live: null };
    outcomes.push(outcome);
    const url = officialSuppliedUrl(builder, community.communityUrl);
    if (!url) { outcome.reasons.push("unofficial_url"); outcome.problems.push(`communityUrl is not an https page on ${officialHostFor(builder) ?? "the builder's site"}`); continue; }
    const row = byKey.get(suppliedUrlKey(url.toString()));
    if (!row) { outcome.reasons.push("unknown_community"); outcome.problems.push("no community with this page is set up in Admin; it was not created"); continue; }
    ids.set(outcome, row.id);
    const latest = await latestSuppliedImport(row.id);
    if (latest && latest.capturedAt.getTime() > capturedAt.getTime()) { outcome.reasons.push("older_than_stored"); outcome.problems.push(`a newer import (captured ${latest.capturedAt.toISOString()}) is already stored`); continue; }
    // The rules the refresh applies, reported to the agent now (the refresh itself is the authority).
    outcome.problems.push(...checkSuppliedCommunity(builder, { capturedAt, community }, now).problems);
    await storeSuppliedImport({ communityId: row.id, builder, capturedAt, receivedAt: now, community: { ...community, communityUrl: row.sourceUrl } });
    outcome.status = "stored_not_processed";
    outcome.retry = true;
    stored.push({ outcome, communityId: row.id });
  }
  outcomes.sort((a, b) => a.index - b.index);
  const refreshed = await refreshSuppliedCommunities(builder, stored.map((entry) => entry.communityId), { now, leaseWaitMs: options.leaseWaitMs, pollMs: options.pollMs });
  const after = ids.size ? await db.select().from(dealCommunities).where(eq(dealCommunities.builder, builder)) : [];
  if (refreshed.processed) {
    for (const { outcome, communityId } of stored) {
      const result: RefreshResult | undefined = refreshed.results.find((entry) => entry.communityId === communityId);
      const row = after.find((entry) => entry.id === communityId);
      outcome.incentiveHold = row?.incentiveHoldReason ?? null;
      outcome.retry = false;
      if (!result) { outcome.status = "skipped"; outcome.reasons.push("community_not_found"); continue; }
      if (result.skipped) { outcome.status = "skipped"; outcome.reasons.push(result.skipped); outcome.problems.push(result.skipped === "manual_mode" ? "the community is in Manual mode in Admin; switch it back to automatic to use imports" : `the community is ${result.skipped.replace(/_/g, " ")} in Admin`); continue; }
      if (result.ok) { outcome.status = "published"; continue; }
      outcome.status = "held";
      outcome.reasons.push(...(result.reason ?? "").split(",").map((part) => part.trim()).filter(Boolean));
      // "No homes for sale" from a complete page is not a fault to retry: it waits for a second, separate visit to agree.
      const source = await suppliedSourceFor(builder, communityId);
      const unconfirmedZero = source?.latest && !outcome.problems.length && suppliedForSaleCount(source.latest.community) === 0;
      if (unconfirmedZero) outcome.problems.push(`no homes for sale: taken only when a second visit at least ${SUPPLIED_ZERO_CONFIRM_GAP_MS / 3_600_000} hours later also finds none (tomorrow's run confirms it); the listings stay as they were until then`);
      else outcome.retry = outcome.reasons.some((reason) => RETRY_HOLDS.has(reason));
    }
  }
  // What actually landed, read back: the homes for sale on the site and the last publish time of each known community.
  const liveIds = Array.from(new Set(ids.values()));
  const counts = new Map<number, number>();
  if (liveIds.length) for (const home of await db.select({ communityId: dealHomes.communityId, status: dealHomes.status }).from(dealHomes).where(inArray(dealHomes.communityId, liveIds))) if (home.status === "available") counts.set(home.communityId, (counts.get(home.communityId) ?? 0) + 1);
  const failures: SuppliedImportFailure[] = [];
  for (const outcome of outcomes) {
    const id = ids.get(outcome);
    if (id === undefined) continue;
    const row = after.find((entry) => entry.id === id);
    outcome.live = { homesAvailable: counts.get(id) ?? 0, lastPublishedAt: row?.lastSuccessfulSyncAt?.toISOString() ?? null };
    if (outcome.status !== "published" && outcome.status !== "skipped") failures.push({ communityId: id, status: outcome.status, reasons: outcome.reasons.length ? outcome.reasons : [outcome.status], capturedAt: capturedAt.toISOString() });
  }
  await recordSuppliedImportFailures(failures, now);
  return { processed: refreshed.processed, response: { ok: refreshed.processed && outcomes.every((outcome) => outcome.status === "published"), builder, capturedAt: capturedAt.toISOString(), communities: outcomes } };
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer ([^\s]+)$/.exec(header.trim());
  return match ? match[1]! : null;
}

/** The route handler (options are for tests); mount suppliedImportBodyLimit() on the path before the app-wide JSON parser. */
export function createSuppliedImportHandler(options: { leaseWaitMs?: number; pollMs?: number; now?: () => Date } = {}) {
  return (req: Request, res: Response) => handleSuppliedImport(req, res, options);
}

export const suppliedImportHandler = createSuppliedImportHandler();

async function handleSuppliedImport(req: Request, res: Response, options: { leaseWaitMs?: number; pollMs?: number; now?: () => Date }) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const now = options.now?.() ?? new Date();
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (authFailureCount(ip, now.getTime()) >= SUPPLIED_IMPORT_AUTH_FAILURES_PER_HOUR) {
      res.setHeader("Retry-After", "3600");
      return res.status(429).json({ ok: false, error: "too_many_failed_keys" });
    }
    const token = bearerToken(req);
    const builder = token ? await authenticateSuppliedImportKey(token) : null;
    if (!builder) {
      noteAuthFailure(ip, now.getTime());
      res.setHeader("WWW-Authenticate", "Bearer");
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    // Counted before the body is judged, so a looping agent cannot spend unlimited work.
    const calls = await recordSuppliedImportCall(builder, now);
    if (calls > SUPPLIED_IMPORT_CALLS_PER_HOUR) {
      res.setHeader("Retry-After", "3600");
      return res.status(429).json({ ok: false, error: "rate_limited", limitPerHour: SUPPLIED_IMPORT_CALLS_PER_HOUR });
    }
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return res.status(415).json({ ok: false, error: "content_type_must_be_application_json" });
    // Only the raw body from suppliedImportBodyLimit is trusted (it is what enforces the 2 MB cap). A body some other
    // parser already read is a wiring fault; a request with no body at all is the agent's.
    const readByOtherParser = !Buffer.isBuffer(req.body) && (req as Request & { _body?: boolean })._body === true;
    if (readByOtherParser) return res.status(500).json({ ok: false, error: "server_misconfigured" });
    const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    let json: unknown;
    try { json = JSON.parse(body); } catch { return res.status(400).json({ ok: false, error: "invalid_json" }); }
    const issueLines = (issues: readonly { path: PropertyKey[]; message: string }[], prefix = "") => issues.slice(0, 50).map((issue) => ({ path: `${prefix}${issue.path.map(String).join(".")}`, message: issue.message }));
    const envelope = suppliedEnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      // Paths and messages only, never the submitted values.
      return res.status(400).json({ ok: false, error: "invalid_payload", issues: issueLines(envelope.error.issues) });
    }
    if (envelope.data.builder !== builder) return res.status(403).json({ ok: false, error: "builder_does_not_match_key" });
    const capturedAt = new Date(envelope.data.capturedAt);
    if (capturedAt.getTime() - now.getTime() > SUPPLIED_IMPORT_FUTURE_SKEW_MS) return res.status(400).json({ ok: false, error: "captured_at_in_future" });
    // Each community is judged on its own: one the agent could not read never costs the others their update.
    const valid: SuppliedCommunity[] = [];
    const indexes: number[] = [];
    const unread: UnreadSuppliedCommunity[] = [];
    const issues: Array<{ path: string; message: string }> = [];
    envelope.data.communities.forEach((entry, index) => {
      const parsed = suppliedCommunitySchema.safeParse(entry);
      if (parsed.success) { valid.push(parsed.data); indexes.push(index); return; }
      const lines = issueLines(parsed.error.issues, `communities.${index}.`).map((line) => ({ ...line, path: line.path.replace(/\.$/, "") }));
      issues.push(...lines);
      const link = (entry as { communityUrl?: unknown } | null)?.communityUrl;
      unread.push({ index, communityUrl: typeof link === "string" && link.trim() && link.length <= 2048 ? link.trim() : null, problems: lines.slice(0, 20).map((line) => `${line.path}: ${line.message}`) });
    });
    const keys = [...valid.map((community) => community.communityUrl), ...unread.flatMap((entry) => entry.communityUrl ? [entry.communityUrl] : [])].map((link) => suppliedUrlKey(link));
    if (new Set(keys).size !== keys.length) return res.status(400).json({ ok: false, error: "duplicate_community" });
    const payload: SuppliedImport = { builder: envelope.data.builder, capturedAt: envelope.data.capturedAt, communities: valid };
    const { processed, response } = await processSuppliedImport(builder, payload, { now, leaseWaitMs: options.leaseWaitMs, pollMs: options.pollMs, unread, indexes });
    // Nothing in the payload could be read: the old answer (400 with the paths), now with each community's line and its failure on record.
    if (!valid.length) {
      console.info(`[deals-import] ${unread.length} communities: none readable`);
      return res.status(400).json({ ok: false, error: "invalid_payload", issues: issues.slice(0, 50), communities: response.communities });
    }
    const count = (status: SuppliedCommunityOutcome["status"]) => response.communities.filter((community) => community.status === status).length;
    // Counts only: no key, builder text, link or address reaches the log.
    console.info(`[deals-import] ${response.communities.length} communities: ${count("published")} published, ${count("held")} held, ${count("skipped")} skipped, ${count("rejected")} rejected${processed ? "" : ", not processed (builder busy)"}`);
    if (!processed) {
      res.setHeader("Retry-After", "120");
      return res.status(503).json({ ...response, error: "builder_busy_retry" });
    }
    return res.status(200).json(response);
  } catch (error) {
    // The error's code or name only: a database message can quote the values it was given.
    console.error("[deals-import] failed", (error as { code?: unknown })?.code ?? (error instanceof Error ? error.name : "unknown"));
    return res.status(500).json({ ok: false, error: "import_failed" });
  }
}
