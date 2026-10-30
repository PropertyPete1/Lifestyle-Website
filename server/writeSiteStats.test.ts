import { drizzle } from "drizzle-orm/mysql2";
import { afterEach, describe, expect, it } from "vitest";
import { chicagoDayBounds } from "./siteTelemetry";
import { collectSiteMetrics, dayQueries, queryFailureReason } from "./writeSiteStats";

// A drizzle instance with no real client: enough to build and render SQL,
// never enough to run it.
const db = drizzle({ client: {} as never });

describe("dayQueries — the SQL actually sent", () => {
  const day = "2026-08-11";
  const { start, end } = chicagoDayBounds(day);
  const q = dayQueries(db, day);

  /**
   * Drizzle renders the bound Date as a UTC wall-clock string with nothing on
   * it saying "UTC" — MySQL reads it in the session time zone. collectSiteMetrics
   * pins every connection to +00:00 for exactly this reason; this test nails
   * down the half of the contract that lives in the query, so that if a drizzle
   * upgrade ever changes the rendering, it fails here loudly instead of in
   * production quietly, off by an offset.
   */
  const asUtcLiteral = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

  it("bounds every query by the Chicago day, as half-open [start, end)", () => {
    for (const query of [q.totals, q.topPages, q.leadSubmissions]) {
      const { sql, params } = query.toSQL();
      expect(sql).toContain(">=");
      expect(sql).toContain("<");
      expect(params).toContainEqual(asUtcLiteral(start));
      expect(params).toContainEqual(asUtcLiteral(end));
    }
  });

  it("renders the summer day window as 05:00Z → 05:00Z", () => {
    // Chicago is UTC-5 in August; this is the sanity check a human can read.
    expect(asUtcLiteral(start)).toBe("2026-08-11 05:00:00.000");
    expect(asUtcLiteral(end)).toBe("2026-08-12 05:00:00.000");
  });

  it("reads traffic from page_events and submissions from leads", () => {
    expect(q.totals.toSQL().sql).toContain("`page_events`");
    expect(q.topPages.toSQL().sql).toContain("`page_events`");
    expect(q.leadSubmissions.toSQL().sql).toContain("`leads`");
  });

  it("counts only page views, and only identifiable visitors as unique", () => {
    const { sql } = q.totals.toSQL();
    expect(sql).toContain("= 'view'");
    // The uniques count must exclude the empty visitor id, or every
    // localStorage-blocked visitor collapses into one phantom person.
    expect(sql).toMatch(/COUNT\(DISTINCT CASE WHEN.*<> ''/s);
  });

  it("orders top pages by views and caps the list", () => {
    const { sql } = q.topPages.toSQL();
    expect(sql).toContain("group by");
    expect(sql).toContain("order by");
    expect(sql).toMatch(/limit/i);
  });

  it("does not write anything", () => {
    for (const query of [q.totals, q.topPages, q.leadSubmissions]) {
      const { sql } = query.toSQL();
      expect(sql).toMatch(/^select/i);
      expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
    }
  });
});

describe("collectSiteMetrics without a database", () => {
  const saved = process.env.DATABASE_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  it("refuses to invent numbers when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    // Rejecting is the contract: writeSiteTelemetry turns this into a named
    // `unavailable` entry. Returning zeros here would be the bug.
    await expect(collectSiteMetrics()).rejects.toThrow(/DATABASE_URL is not set/);
  });
});

describe("queryFailureReason — says why a read failed", () => {
  const wrapped = (cause: unknown) =>
    Object.assign(new Error("Failed query: select SUM(`page_events`.`kind` = 'view') from `page_events`\nparams: 2026-10-30 05:00:00"), { cause });

  it("names the driver's code and message, not just Drizzle's wrapper", () => {
    const reason = queryFailureReason(wrapped(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })));
    expect(reason).toMatch(/^query failed: ETIMEDOUT: connect ETIMEDOUT \(in Failed query: select/);
    expect(reason).not.toContain("params:");
  });

  it("masks the user@host pair an access error carries", () => {
    const reason = queryFailureReason(
      wrapped(Object.assign(new Error("Access denied for user 'site_ro'@'10.1.2.3' (using password: YES)"), { code: "ER_ACCESS_DENIED_ERROR" }))
    );
    expect(reason).toContain("ER_ACCESS_DENIED_ERROR: Access denied for user '…'@'…'");
    expect(reason).not.toContain("site_ro");
    expect(reason).not.toContain("10.1.2.3");
  });

  it("falls back to the wrapper message when there is no cause", () => {
    expect(queryFailureReason(new Error("timed out after 45000ms"))).toBe("query failed: timed out after 45000ms");
    expect(queryFailureReason("boom")).toBe("query failed: boom");
  });
});
