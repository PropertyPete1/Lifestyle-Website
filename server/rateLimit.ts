/**
 * Per-connection request budgets for the public procedures that cost money
 * or write rows.
 *
 * WHY: every AI endpoint on this site (Convince Your Partner, City Finder,
 * AI search) and every write endpoint (lead submit, activity log, page
 * analytics) is public and unauthenticated by design — a visitor should never
 * have to sign in. Before this file, nothing stood between an anonymous
 * caller and an unbounded loop of Claude calls billed to ANTHROPIC_API_KEY, or
 * an unbounded stream of rows into `partner_pitches` / `page_events`. The
 * audit found no rate limiting anywhere.
 *
 * WHAT IT IS NOT: this is an in-memory fixed-window counter, per server
 * process. It resets on restart and is not shared between instances. That is
 * the right size for this site: the goal is to cap abuse at a level that
 * cannot run up a bill, not to meter legitimate traffic precisely.
 *
 * KEYING CAVEAT (read before tightening any limit): the key is the client IP
 * taken from the first hop of `X-Forwarded-For`, falling back to the socket
 * address. If the hosting gateway ever stops forwarding the client address,
 * EVERY visitor collapses onto one key and shares one budget. The limits are
 * therefore set far above anything real aggregate traffic reaches (the site
 * measured ~40 page views/day when this was written) so that even the shared-
 * key failure mode degrades gracefully, while a scripted attacker is still
 * capped at a few dozen paid calls per window.
 */
import type { Request } from "express";

export interface RateLimitRule {
  /** Namespace so different endpoints never share a bucket. */
  name: string;
  /** Requests allowed per window per key. */
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets (0 when allowed with room to spare). */
  retryAfterMs: number;
}

/** Shown to the visitor. Deliberately plain, with the phone as the fallback path. */
export const RATE_LIMIT_MESSAGE =
  "Too many requests from your connection — please wait a minute and try again, or call us at (210) 981-3830.";

export const RATE_LIMITS = {
  /** Claude-backed generation: Convince Your Partner + City Finder (3 calls each). */
  aiGenerate: { name: "ai-generate", limit: 30, windowMs: 10 * 60_000 },
  /** Forge LLM criteria extraction behind /search. */
  aiSearch: { name: "ai-search", limit: 60, windowMs: 60_000 },
  /** Lead + website-inquiry submissions (each creates a FUB contact). */
  leadSubmit: { name: "lead-submit", limit: 30, windowMs: 10 * 60_000 },
  /** Anonymous activity rows. */
  activityLog: { name: "activity-log", limit: 300, windowMs: 60_000 },
  /** Page-view / click events. */
  analyticsTrack: { name: "analytics-track", limit: 600, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Hard ceiling on tracked keys so a spoofed-XFF flood cannot grow memory without bound. */
export const MAX_TRACKED_KEYS = 20_000;

type KeySource = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

/**
 * The client identity a request is budgeted under.
 *
 * First hop of X-Forwarded-For wins (that is the address the gateway saw the
 * client connect from); then Express's own `req.ip`; then the raw socket.
 * A request with none of these — every unit test builds a bare context — is
 * keyed "unknown" rather than throwing, because a limiter that can crash a
 * request is worse than one that occasionally shares a bucket.
 */
export function clientKey(req: KeySource | Request | undefined): string {
  if (!req) return "unknown";
  const xff = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const first = raw?.split(",")[0]?.trim();
  if (first) return first;
  if (typeof req.ip === "string" && req.ip) return req.ip;
  const sock = req.socket?.remoteAddress;
  return sock && sock.length > 0 ? sock : "unknown";
}

function prune(now: number) {
  const expired: string[] = [];
  buckets.forEach((bucket, key) => {
    if (now >= bucket.resetAt) expired.push(key);
  });
  for (const key of expired) buckets.delete(key);
  // Still at the ceiling after dropping expired windows: evict the oldest
  // insertions (Map iterates in insertion order) so the caller's new key
  // fits, rather than refuse to count.
  const room = MAX_TRACKED_KEYS - 1;
  if (buckets.size > room) {
    const excess = buckets.size - room;
    const oldest = Array.from(buckets.keys()).slice(0, excess);
    for (const key of oldest) buckets.delete(key);
  }
}

/** Count one request against `rule` for `key`; says whether it may proceed. */
export function checkRateLimit(
  rule: RateLimitRule,
  key: string,
  now: number = Date.now()
): RateLimitDecision {
  const bucketKey = `${rule.name}:${key}`;
  const existing = buckets.get(bucketKey);
  if (!existing && buckets.size >= MAX_TRACKED_KEYS) prune(now);
  if (!existing || now >= existing.resetAt) {
    buckets.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, remaining: rule.limit - 1, retryAfterMs: 0 };
  }
  if (existing.count >= rule.limit) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, existing.resetAt - now) };
  }
  existing.count += 1;
  return {
    allowed: true,
    remaining: rule.limit - existing.count,
    retryAfterMs: 0,
  };
}

/** Test hook: forget every bucket. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Test hook: how many buckets are live. */
export function trackedBucketCount(): number {
  return buckets.size;
}
