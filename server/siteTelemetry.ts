/**
 * siteTelemetry.ts — the website reporting its own traffic, for LIFESTYLE.
 *
 * Writes one file at the REPO ROOT so the brain has real visitor numbers
 * instead of a blank panel:
 *
 *     status/site_stats.json   today + yesterday, a whole snapshot every run
 *
 * READ-ONLY BY CONSTRUCTION. Every number here comes from SELECTs against
 * tables the live site already writes (`page_events`, `leads`). This module
 * never inserts, updates or deletes, and it is not imported by the server
 * bundle — a bug in it can make a dashboard wrong, never the site.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE: NEVER INVENT A NUMBER
 *
 * A key that is PRESENT is a counted fact. A key that is ABSENT is "we do not
 * know". Zero means we looked and counted zero. Those three states are not
 * interchangeable. A panel that confidently prints "0 visitors" on a day the
 * database was unreachable is worse than one that prints nothing, because the
 * first one looks like a marketing problem and the second looks like what it
 * is — a broken pipe.
 *
 * So: when a source cannot be read, its metrics are OMITTED and the source is
 * named in `unavailable` with the reason. They are never zeroed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SITE CAN AND CANNOT MEASURE
 *
 * MEASURABLE, from the first-party `page_events` table (no third-party
 * trackers, no IPs, no user agents, no fingerprinting):
 *
 *   page_views              rows with kind='view'
 *   unique_visitors         DISTINCT visitorId — see the caveat below
 *   top_pages               views grouped by normalized path
 *   lead_submissions        rows in `leads` (the authoritative record)
 *
 * NOT MEASURABLE, and reported as unavailable rather than approximated:
 *
 *   sessions                `page_events` stores no session identifier. The
 *                           client captures a traffic source once per session
 *                           in sessionStorage, but the session itself is never
 *                           given an id, so a session count could only come
 *                           from an invented inactivity-timeout heuristic. A
 *                           guess dressed as a count is exactly what this file
 *                           exists to prevent.
 *
 * THE UNIQUES CAVEAT, stated as a number rather than as prose: `visitorId` is a
 * random string kept in the visitor's own localStorage, and it is written as ""
 * when localStorage is blocked. Those rows cannot be attributed to anyone, so
 * they are excluded from `unique_visitors` — which therefore is a LOWER BOUND,
 * not a count. `views_without_visitor_id` reports the size of that blind spot
 * on the same day, so a reader can see how much the floor might be off by.
 *
 * TODAY IS PARTIAL. Today's row is a day still in progress; yesterday's is
 * settled. Each day carries `complete` so nobody reads a half-day against a
 * whole one and calls it a decline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Days are America/Chicago days — the market this site serves — computed as
 * exact UTC instants so DST never shifts a boundary. The file is written
 * temp-then-rename: a reader that catches a half-written file must get invalid
 * JSON, not a partial number.
 */
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const STATUS_DIRNAME = "status";
export const STATS_FILENAME = "site_stats.json";

/** The market this site serves; the day boundary everything here is counted on. */
export const SITE_TIMEZONE = "America/Chicago";

/** Top pages kept per day. Enough to see the shape of traffic, not a data dump. */
export const TOP_PAGES_LIMIT = 10;

const WRITE_ATTEMPTS = 3;
const WRITE_RETRY_MS = 120;

/** One day's counted facts. Every field is optional: absent means unknown. */
export interface DayMetrics {
  page_views?: number;
  unique_visitors?: number;
  /** Views whose visitor could not be identified (localStorage blocked). */
  views_without_visitor_id?: number;
  top_pages?: { path: string; views: number; unique_visitors: number }[];
  lead_submissions?: number;
}

/** A metric we could not read, and why. Never rendered as a zero. */
export interface UnavailableEntry {
  metric: string;
  reason: string;
}

export interface SiteStats {
  date: string;
  generated_at: string;
  timezone: string;
  days: Record<string, DayMetrics & { complete: boolean }>;
  unavailable: UnavailableEntry[];
}

/* ── time ──────────────────────────────────────────────────────────────────── */

/** Chicago-local YYYY-MM-DD. */
export function todayInChicago(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** UTC ISO 8601 with a Z suffix and no milliseconds — the shape the brain parses. */
export function isoZ(value: Date | string | number = new Date()): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The UTC offset, in minutes, in force at `instant` in Chicago. */
function chicagoOffsetMinutes(instant: Date): number {
  // Format the instant as Chicago wall-clock, read it back as if it were UTC:
  // the difference between the two is the offset.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

/**
 * The exact UTC instants bounding a Chicago-local day: [start, end).
 *
 * Computed by guessing with a fixed offset then re-reading the offset actually
 * in force at the guess, which lands correctly on both DST transition days —
 * the spring-forward day is 23 hours long and the fall-back day is 25, and a
 * hardcoded -05:00/-06:00 would silently miscount both.
 */
export function chicagoDayBounds(dateStr: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const boundary = (year: number, month: number, day: number) => {
    const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
    // First pass with the offset at the naive instant, then settle with the
    // offset actually in force at that result.
    const first = naive + chicagoOffsetMinutes(new Date(naive)) * -60000;
    const settled = naive + chicagoOffsetMinutes(new Date(first)) * -60000;
    return new Date(settled);
  };
  const start = boundary(y, m, d);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const end = boundary(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate()
  );
  return { start, end };
}

/** Chicago-local YYYY-MM-DD for the day before `dateStr`. */
export function previousDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
}

/* ── assembling the payload ────────────────────────────────────────────────── */

/**
 * Sessions are structurally unmeasurable here, and that is a standing fact
 * about the schema rather than a failure of any one run — so every snapshot
 * carries it.
 */
export const SESSIONS_UNAVAILABLE: UnavailableEntry = {
  metric: "sessions",
  reason:
    "page_events stores no session identifier — only anonymous per-visitor rows. " +
    "A session count would have to come from an invented inactivity-timeout " +
    "heuristic, which would be an estimate, not a measurement.",
};

/**
 * Keep only the keys that are real counts.
 *
 * A metric that came back null/undefined from a partially-failed read is
 * dropped rather than coerced, so "we did not learn this" cannot arrive at the
 * brain wearing a number's clothes. A genuine 0 survives: we looked, and the
 * answer was none.
 */
export function compactDay(metrics: DayMetrics): DayMetrics {
  const out: DayMetrics = {};
  if (Number.isFinite(metrics.page_views)) out.page_views = metrics.page_views;
  if (Number.isFinite(metrics.unique_visitors)) out.unique_visitors = metrics.unique_visitors;
  if (Number.isFinite(metrics.views_without_visitor_id)) {
    out.views_without_visitor_id = metrics.views_without_visitor_id;
  }
  if (Array.isArray(metrics.top_pages)) out.top_pages = metrics.top_pages;
  if (Number.isFinite(metrics.lead_submissions)) out.lead_submissions = metrics.lead_submissions;
  return out;
}

/**
 * Build the snapshot.
 *
 * `days` carries an entry per day we learned ANYTHING about. A day we learned
 * nothing about is omitted entirely rather than written as an empty husk of
 * zeros — and whatever stopped us is named in `unavailable`.
 */
export function buildSiteStats({
  now = new Date(),
  today,
  yesterday,
  unavailable = [],
}: {
  now?: Date;
  today?: DayMetrics | null;
  yesterday?: DayMetrics | null;
  unavailable?: UnavailableEntry[];
}): SiteStats {
  const date = todayInChicago(now);
  const prev = previousDay(date);

  const days: SiteStats["days"] = {};
  const todayFacts = today ? compactDay(today) : {};
  if (Object.keys(todayFacts).length > 0) {
    // Today is still running: its counts are a day-so-far, not a day.
    days[date] = { ...todayFacts, complete: false };
  }
  const yesterdayFacts = yesterday ? compactDay(yesterday) : {};
  if (Object.keys(yesterdayFacts).length > 0) {
    days[prev] = { ...yesterdayFacts, complete: true };
  }

  // Sessions are unmeasurable by the shape of the schema, not by anything this
  // run did, so the entry is added here rather than by the caller — every
  // snapshot says so, including ones built by a future second caller that never
  // thought about it. Deduped by metric so passing it in explicitly is harmless.
  const seen = new Set<string>();
  const allUnavailable = [SESSIONS_UNAVAILABLE, ...unavailable]
    .map((u) => ({ metric: String(u.metric), reason: String(u.reason) }))
    .filter((u) => (seen.has(u.metric) ? false : (seen.add(u.metric), true)));

  return {
    date,
    generated_at: isoZ(now),
    timezone: SITE_TIMEZONE,
    days,
    unavailable: allUnavailable,
  };
}

/* ── reading and writing ───────────────────────────────────────────────────── */

/** Whatever is on disk. Unreadable or wrong-shaped is treated as absent. */
export function readJsonOr<T>(path: string, fallback: T): T {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Temp file in the destination directory, then rename.
 *
 * Same directory so the rename is same-filesystem and therefore atomic; fsync
 * before it so a killed runner cannot leave a renamed-but-empty file. Retried,
 * because the transient failures here (a full or briefly-locked filesystem on a
 * shared runner) are exactly the kind that succeed on the next attempt.
 */
export async function atomicWriteJson(
  path: string,
  payload: unknown,
  attempts = WRITE_ATTEMPTS
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const tmp = `${path}.${process.pid}.${Date.now()}.${attempt}.tmp`;
    try {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", {
        encoding: "utf-8",
        mode: 0o644,
      });
      const fd = openSync(tmp, "r+");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      chmodSync(tmp, 0o644);
      renameSync(tmp, path);
      return;
    } catch (err) {
      lastError = err;
      try {
        unlinkSync(tmp);
      } catch {
        /* the temp file may never have existed */
      }
      if (attempt < attempts) await sleep(WRITE_RETRY_MS * attempt);
    }
  }
  throw lastError;
}

export interface CollectedMetrics {
  today?: DayMetrics | null;
  yesterday?: DayMetrics | null;
  unavailable?: UnavailableEntry[];
}

/**
 * Write status/site_stats.json. Returns what was written, for logging and tests.
 *
 * NEVER THROWS. This runs in a scheduled job alongside work that matters more
 * than a dashboard number; a telemetry bug must not turn that job red, and it
 * must not be able to stop a later step from running. A failure is reported in
 * the return value and the previous file is left alone — stale honest numbers
 * beat fresh invented ones.
 */
export async function writeSiteTelemetry({
  repoRoot,
  collect,
  now = new Date(),
}: {
  repoRoot: string;
  collect: () => Promise<CollectedMetrics>;
  now?: Date;
}): Promise<{ ok: boolean; stats?: SiteStats; path?: string; error?: string }> {
  try {
    let collected: CollectedMetrics;
    try {
      collected = await collect();
    } catch (err) {
      // The source failed wholesale. That is a fact about the source, not a
      // day with no traffic — so it is named, and no day is written.
      collected = {
        today: null,
        yesterday: null,
        unavailable: [
          {
            metric: "page_views, unique_visitors, top_pages, lead_submissions",
            reason: `could not read the site database: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      };
    }

    const stats = buildSiteStats({
      now,
      today: collected.today,
      yesterday: collected.yesterday,
      unavailable: collected.unavailable ?? [],
    });

    const path = join(repoRoot, STATUS_DIRNAME, STATS_FILENAME);
    await atomicWriteJson(path, stats);
    return { ok: true, stats, path };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
