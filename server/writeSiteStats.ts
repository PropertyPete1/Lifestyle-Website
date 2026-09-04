/**
 * writeSiteStats.ts — the CLI entry point behind status/site_stats.json.
 *
 * Run from the scheduled GitHub Actions job (.github/workflows/site-stats.yml):
 *
 *     pnpm stats:site
 *
 * READ-ONLY. Opens its own short-lived pool, runs SELECTs against `page_events`
 * and `leads`, writes the status file, closes the pool. It touches no table the
 * site writes and is not part of the server bundle, so it neither needs nor
 * triggers a redeploy.
 *
 * The honest-data contract — absent means unknown, never zero; unavailable
 * sources named with reasons — lives in siteTelemetry.ts. This file's only job
 * is to turn rows into that shape, and to fail in a way that reports the
 * failure instead of hiding it behind zeros.
 */
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { leads, pageEvents } from "../drizzle/schema";
import {
  chicagoDayBounds,
  describeError,
  previousDay,
  todayInChicago,
  writeSiteTelemetry,
  TOP_PAGES_LIMIT,
  type CollectedMetrics,
  type DayMetrics,
  type UnavailableEntry,
} from "./siteTelemetry";

/** A hung database must not hold a scheduled job open for hours. */
const QUERY_BUDGET_MS = 45_000;
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * MySQL aggregates arrive as strings (SUM returns DECIMAL) and as NULL when no
 * row matched. A NULL from a query that SUCCEEDED means "we looked and there
 * were none" — a counted zero, not an unknown — so it becomes 0 here. Only a
 * query that never ran leaves a metric absent, and that happens upstream.
 */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The drizzle handle, named without its `$client` so both the promise-pool
 * instance used in production and the client-less one used in tests satisfy it.
 */
type Db = MySql2Database<Record<string, never>>;

/**
 * The three SELECTs for one Chicago-local day, built but not run.
 *
 * Split out from the execution so the query shape can be asserted with
 * `.toSQL()` in a test — the day window is the part most likely to be silently
 * wrong, and a bad window produces plausible numbers rather than an error.
 */
export function dayQueries(db: Db, dateStr: string) {
  const { start, end } = chicagoDayBounds(dateStr);
  const inWindow = and(gte(pageEvents.createdAt, start), lt(pageEvents.createdAt, end));

  return {
    totals: db
      .select({
        views: sql`SUM(${pageEvents.kind} = 'view')`,
        uniques: sql`COUNT(DISTINCT CASE WHEN ${pageEvents.kind} = 'view' AND ${pageEvents.visitorId} <> '' THEN ${pageEvents.visitorId} END)`,
        anonViews: sql`SUM(${pageEvents.kind} = 'view' AND ${pageEvents.visitorId} = '')`,
      })
      .from(pageEvents)
      .where(inWindow),
    topPages: db
      .select({
        path: pageEvents.path,
        views: sql`COUNT(*)`,
        uniques: sql`COUNT(DISTINCT CASE WHEN ${pageEvents.visitorId} <> '' THEN ${pageEvents.visitorId} END)`,
      })
      .from(pageEvents)
      .where(and(eq(pageEvents.kind, "view"), inWindow))
      .groupBy(pageEvents.path)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(TOP_PAGES_LIMIT),
    leadSubmissions: db
      .select({ submissions: sql`COUNT(*)` })
      .from(leads)
      .where(and(gte(leads.createdAt, start), lt(leads.createdAt, end))),
  };
}

/** One Chicago-local day's traffic, straight out of the first-party tables. */
async function metricsForDay(db: Db, dateStr: string): Promise<DayMetrics> {
  const q = dayQueries(db, dateStr);
  const [totals, topPages, leadRows] = await Promise.all([
    q.totals,
    q.topPages,
    q.leadSubmissions,
  ]);

  return {
    page_views: num(totals[0]?.views),
    unique_visitors: num(totals[0]?.uniques),
    views_without_visitor_id: num(totals[0]?.anonViews),
    top_pages: topPages.map((row) => ({
      path: String(row.path),
      views: num(row.views),
      unique_visitors: num(row.uniques),
    })),
    lead_submissions: num(leadRows[0]?.submissions),
  };
}

/**
 * Read both days.
 *
 * Each day is read independently: if yesterday's query fails but today's
 * succeeds we publish today and name yesterday in `unavailable`, rather than
 * throwing away a good number because its neighbour was missing.
 */
export async function collectSiteMetrics(
  now = new Date(),
  /** Test seam: a prepared drizzle handle skips the pool (and DATABASE_URL). */
  opts: { db?: Db } = {}
): Promise<CollectedMetrics> {
  if (opts.db) return readBothDays(opts.db, now);
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — the traffic tables live in the site's MySQL database " +
        "and there is nothing to read without it"
    );
  }

  // Our own pool rather than server/db.ts's, for one reason: the session time
  // zone.
  //
  // Drizzle renders a JS Date into a datetime STRING at query-build time
  // (`toISOString()` with the T and Z stripped), so the value MySQL receives is
  // UTC wall-clock text with nothing marking it as UTC. MySQL then interprets
  // that text in the SESSION time zone. On a server set to anything but UTC the
  // day window silently slides by the offset — and a shifted window does not
  // error, it just returns confidently wrong numbers, which is the one failure
  // mode this whole file exists to prevent.
  //
  // So: pin every connection to UTC. `timezone: "Z"` covers the driver side
  // (result parsing); the SET covers the server side (literal interpretation).
  const pool = mysql.createPool({
    uri: url,
    timezone: "Z",
    connectionLimit: 2,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  pool.on("connection", (conn) => {
    // Callback form with an explicit handler: an error here would otherwise
    // surface as an unhandled 'error' event on the query. If the SET fails the
    // windows would be interpreted in the server's zone, so say so out loud
    // rather than quietly returning numbers for the wrong hours.
    conn.query("SET time_zone = '+00:00'", (err: unknown) => {
      if (err) {
        console.error(
          "[site-stats] could not pin the session to UTC — day windows may be offset:",
          err instanceof Error ? err.message : err
        );
      }
    });
  });

  try {
    return await readBothDays(drizzle(pool), now);
  } finally {
    await pool.end().catch(() => {
      /* closing a pool that never opened is not a failure worth reporting */
    });
  }
}

async function readBothDays(db: Db, now: Date): Promise<CollectedMetrics> {
  const today = todayInChicago(now);
  const yesterday = previousDay(today);
  const unavailable: UnavailableEntry[] = [];

  const read = async (dateStr: string, label: string) => {
    try {
      return await metricsForDay(db, dateStr);
    } catch (err) {
      unavailable.push({
        metric: `page_views, unique_visitors, top_pages, lead_submissions (${label} ${dateStr})`,
        reason: `query failed: ${describeError(err)}`,
      });
      return null;
    }
  };

  const [todayMetrics, yesterdayMetrics] = await Promise.all([
    read(today, "today"),
    read(yesterday, "yesterday"),
  ]);

  return { today: todayMetrics, yesterday: yesterdayMetrics, unavailable };
}

/** Reject rather than hang forever on an unreachable database. */
function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Exit codes, so the workflow can tell the three outcomes apart:
 *   0  file written and at least one day was readable
 *   1  no file could be written (disk, permissions) — nothing published
 *   2  file written, but NO day was readable: the snapshot is honest (it
 *      names the failure in `unavailable`) and still gets published, but the
 *      job must go red. For eleven days in Aug–Sep 2026 every run reported
 *      "success" while publishing an empty `days` — an outage nobody saw
 *      because the only signal was inside a file nobody opened.
 */
export const EXIT_OK = 0;
export const EXIT_WRITE_FAILED = 1;
export const EXIT_NO_READABLE_DAY = 2;

export async function run(
  deps: {
    repoRoot?: string;
    collect?: () => Promise<CollectedMetrics>;
    log?: (line: string) => void;
    error?: (line: string) => void;
  } = {}
): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));
  const result = await writeSiteTelemetry({
    repoRoot: deps.repoRoot ?? process.cwd(),
    collect: deps.collect ?? (() => withBudget(collectSiteMetrics(), QUERY_BUDGET_MS)),
  });

  if (!result.ok) {
    // The writer itself failed (disk, permissions). Report it loudly and exit
    // non-zero: unlike a missing metric, this means NO file was written.
    error(`[site-stats] failed to write: ${result.error}`);
    return EXIT_WRITE_FAILED;
  }

  const stats = result.stats!;
  const summary = Object.entries(stats.days)
    .map(([day, m]) => `${day}: ${m.page_views ?? "?"} views, ${m.unique_visitors ?? "?"} visitors`)
    .join(" | ");
  log(`[site-stats] wrote ${result.path}`);
  log(`[site-stats] ${summary || "no day had readable data"}`);
  for (const u of stats.unavailable) {
    log(`[site-stats] unavailable — ${u.metric}: ${u.reason}`);
  }
  if (Object.keys(stats.days).length === 0) {
    error(
      "[site-stats] NO DAY WAS READABLE — the snapshot was published with its reasons, " +
        "but this run must not count as a success."
    );
    return EXIT_NO_READABLE_DAY;
  }
  return EXIT_OK;
}

// Only run when invoked directly, so tests can import the collector.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error("[site-stats] unexpected failure:", err);
      process.exitCode = EXIT_WRITE_FAILED;
    });
}
