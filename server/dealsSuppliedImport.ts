import express, { type Request, type RequestHandler, type Response } from "express";
import { eq } from "drizzle-orm";
import { dealCommunities } from "../drizzle/schema";
import { getDb } from "./db";
import { officialHostFor } from "./dealsAdapters";
import { checkSuppliedCommunity, officialSuppliedUrl, suppliedImportSchema, suppliedUrlKey, SUPPLIED_IMPORT_FUTURE_SKEW_MS, type SuppliedImport } from "./dealsAdapters.supplied";
import { authenticateSuppliedImportKey, latestSuppliedImport, recordSuppliedImportCall, storeSuppliedImport } from "./dealsSuppliedStore";
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
  communityUrl: string;
  /** published: live from this import; held: stored, the community holds (last good data stays); skipped: stored, the community is paused, manual or archived; rejected: not stored; stored_not_processed: stored, not refreshed (builder busy). */
  status: "published" | "held" | "skipped" | "rejected" | "stored_not_processed";
  reasons: string[];
  problems: string[];
  homesForSale: number;
  homesSold: number;
  homesShownCount: number;
  /** The community's incentive hold after this import, if any (the offer is judged by the same rules as a read). */
  incentiveHold: string | null;
};

export type SuppliedImportResponse = { ok: boolean; builder: string; capturedAt: string; communities: SuppliedCommunityOutcome[] };

/**
 * Stores each community of a validated payload and refreshes them through the
 * sync, awaited. Unknown communities and pages off the builder's site are
 * reported and never created; an import older than the stored one is refused
 * (no rolling back); a community absent from the payload is not touched.
 */
export async function processSuppliedImport(builder: string, payload: SuppliedImport, options: { now?: Date; leaseWaitMs?: number; pollMs?: number } = {}): Promise<{ processed: boolean; response: SuppliedImportResponse }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = options.now ?? new Date();
  const capturedAt = new Date(payload.capturedAt);
  const rows = await db.select().from(dealCommunities).where(eq(dealCommunities.builder, builder));
  const byKey = new Map(rows.map((row) => [suppliedUrlKey(row.sourceUrl), row]));
  const outcomes: SuppliedCommunityOutcome[] = [];
  const stored: Array<{ outcome: SuppliedCommunityOutcome; communityId: number }> = [];
  for (const community of payload.communities) {
    const forSale = community.homes.filter((home) => home.status !== "sold").length;
    const outcome: SuppliedCommunityOutcome = { communityUrl: community.communityUrl, status: "rejected", reasons: [], problems: [], homesForSale: forSale, homesSold: community.homes.length - forSale, homesShownCount: community.homesShownCount, incentiveHold: null };
    outcomes.push(outcome);
    const url = officialSuppliedUrl(builder, community.communityUrl);
    if (!url) { outcome.reasons.push("unofficial_url"); outcome.problems.push(`communityUrl is not an https page on ${officialHostFor(builder) ?? "the builder's site"}`); continue; }
    const row = byKey.get(suppliedUrlKey(url.toString()));
    if (!row) { outcome.reasons.push("unknown_community"); outcome.problems.push("no community with this page is set up in Admin; it was not created"); continue; }
    const latest = await latestSuppliedImport(row.id);
    if (latest && latest.capturedAt.getTime() > capturedAt.getTime()) { outcome.reasons.push("older_than_stored"); outcome.problems.push(`a newer import (captured ${latest.capturedAt.toISOString()}) is already stored`); continue; }
    // The rules the refresh applies, reported to the agent now (the refresh itself is the authority).
    outcome.problems.push(...checkSuppliedCommunity(builder, { capturedAt, community }, now).problems);
    await storeSuppliedImport({ communityId: row.id, builder, capturedAt, receivedAt: now, community: { ...community, communityUrl: row.sourceUrl } });
    outcome.status = "stored_not_processed";
    stored.push({ outcome, communityId: row.id });
  }
  const refreshed = await refreshSuppliedCommunities(builder, stored.map((entry) => entry.communityId), { now, leaseWaitMs: options.leaseWaitMs, pollMs: options.pollMs });
  if (refreshed.processed) {
    const after = stored.length ? await db.select().from(dealCommunities).where(eq(dealCommunities.builder, builder)) : [];
    for (const { outcome, communityId } of stored) {
      const result: RefreshResult | undefined = refreshed.results.find((entry) => entry.communityId === communityId);
      const row = after.find((entry) => entry.id === communityId);
      outcome.incentiveHold = row?.incentiveHoldReason ?? null;
      if (!result) { outcome.status = "skipped"; outcome.reasons.push("community_not_found"); continue; }
      if (result.skipped) { outcome.status = "skipped"; outcome.reasons.push(result.skipped); outcome.problems.push(result.skipped === "manual_mode" ? "the community is in Manual mode in Admin; switch it back to automatic to use imports" : `the community is ${result.skipped.replace(/_/g, " ")} in Admin`); continue; }
      if (result.ok) { outcome.status = "published"; continue; }
      outcome.status = "held";
      outcome.reasons.push(...(result.reason ?? "").split(",").map((part) => part.trim()).filter(Boolean));
    }
  }
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
    const parsed = suppliedImportSchema.safeParse(json);
    if (!parsed.success) {
      // Paths and messages only, never the submitted values.
      return res.status(400).json({ ok: false, error: "invalid_payload", issues: parsed.error.issues.slice(0, 50).map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    }
    const payload = parsed.data;
    if (payload.builder !== builder) return res.status(403).json({ ok: false, error: "builder_does_not_match_key" });
    const capturedAt = new Date(payload.capturedAt);
    if (capturedAt.getTime() - now.getTime() > SUPPLIED_IMPORT_FUTURE_SKEW_MS) return res.status(400).json({ ok: false, error: "captured_at_in_future" });
    const keys = payload.communities.map((community) => suppliedUrlKey(community.communityUrl));
    if (new Set(keys).size !== keys.length) return res.status(400).json({ ok: false, error: "duplicate_community" });
    const { processed, response } = await processSuppliedImport(builder, payload, { now, leaseWaitMs: options.leaseWaitMs, pollMs: options.pollMs });
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
