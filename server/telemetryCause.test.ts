/**
 * The site-stats job must name WHY a read failed, and must go red when it
 * could read nothing.
 *
 * From 2026-08-23 to 2026-09-02 the published snapshot said only
 * "query failed: Failed query: select ..." — the SQL, never the cause — on
 * ~40 consecutive green runs. Both halves are pinned here.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { describeError, STATS_FILENAME, STATUS_DIRNAME } from "./siteTelemetry";
import { collectSiteMetrics, EXIT_NO_READABLE_DAY, EXIT_OK, EXIT_WRITE_FAILED, run } from "./writeSiteStats";

describe("collectSiteMetrics names the driver's reason for a failed day", () => {
  it("puts the driver error before drizzle's 'Failed query' wrapper, for both days", async () => {
    const driver = Object.assign(new Error("Access denied for user 'site'@'10.0.0.9'"), {
      code: "ER_ACCESS_DENIED_ERROR",
    });
    // A drizzle handle over a client whose every query fails like a locked-out
    // MySQL user. drizzle wraps that in a DrizzleQueryError whose message is
    // only the SQL — exactly the shape the live job has been publishing.
    const client = {
      query: () => Promise.reject(driver),
      execute: () => Promise.reject(driver),
    };
    const db = drizzle({ client: client as never });
    const collected = await collectSiteMetrics(new Date("2026-09-02T20:00:00Z"), { db });
    expect(collected.today).toBeNull();
    expect(collected.yesterday).toBeNull();
    expect(collected.unavailable).toHaveLength(2);
    for (const u of collected.unavailable ?? []) {
      expect(u.reason).toMatch(/^query failed: \[ER_ACCESS_DENIED_ERROR\] Access denied/);
      expect(u.reason.indexOf("Access denied")).toBeLessThan(u.reason.indexOf("Failed query"));
    }
  });
});

describe("describeError — root cause first", () => {
  it("walks the cause chain and puts the innermost cause first", () => {
    const driver = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:3306"), { code: "ECONNREFUSED" });
    const wrapped = new Error("Failed query: select SUM(`kind` = 'view') from `page_events`\nparams: 2026-09-02", {
      cause: driver,
    });
    const text = describeError(wrapped);
    expect(text.startsWith("[ECONNREFUSED] connect ECONNREFUSED 10.0.0.5:3306")).toBe(true);
    expect(text).toContain("Failed query");
    expect(text.indexOf("ECONNREFUSED")).toBeLessThan(text.indexOf("Failed query"));
  });

  it("handles a plain error, a non-error, and a cyclic cause without looping", () => {
    expect(describeError(new Error("plain"))).toBe("plain");
    expect(describeError("string failure")).toBe("string failure");
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(describeError(b)).toBe("a ← b");
  });

  it("truncates each level so a 10 KB SQL text cannot swamp the file", () => {
    const err = new Error("x".repeat(10_000), { cause: new Error("root") });
    expect(describeError(err).length).toBeLessThan(400);
  });
});

describe("run() exit codes", () => {
  let root: string;
  const logs: string[] = [];
  const errors: string[] = [];
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "site-stats-run-"));
    logs.length = 0;
    errors.length = 0;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const deps = () => ({ repoRoot: root, log: (l: string) => logs.push(l), error: (l: string) => errors.push(l) });
  const written = () => JSON.parse(readFileSync(join(root, STATUS_DIRNAME, STATS_FILENAME), "utf-8"));

  it("returns 0 when at least one day was readable", async () => {
    const code = await run({
      ...deps(),
      collect: async () => ({ today: { page_views: 3, unique_visitors: 2 }, yesterday: null, unavailable: [] }),
    });
    expect(code).toBe(EXIT_OK);
    expect(Object.keys(written().days)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("returns 2 — file WRITTEN with the reason, but not a success — when no day could be read", async () => {
    const driver = Object.assign(new Error("Access denied for user 'site'@'%'"), { code: "ER_ACCESS_DENIED_ERROR" });
    const code = await run({
      ...deps(),
      collect: async () => {
        throw new Error("Failed query: select ...", { cause: driver });
      },
    });
    expect(code).toBe(EXIT_NO_READABLE_DAY);
    const stats = written();
    expect(stats.days).toEqual({});
    const reason = stats.unavailable.map((u: { reason: string }) => u.reason).join("\n");
    expect(reason).toContain("[ER_ACCESS_DENIED_ERROR] Access denied");
    expect(errors.join("\n")).toMatch(/NO DAY WAS READABLE/);
  });

  it("returns 1 when the file itself cannot be written", async () => {
    const code = await run({
      ...deps(),
      // A file where the status DIRECTORY should be makes mkdir fail.
      repoRoot: (() => {
        const p = join(root, "blocked");
        rmSync(p, { force: true });
        require("node:fs").writeFileSync(join(root, "status"), "not a directory");
        return root;
      })(),
      collect: async () => ({ today: { page_views: 1 }, yesterday: null, unavailable: [] }),
    });
    expect(code).toBe(EXIT_WRITE_FAILED);
    expect(errors.join("\n")).toMatch(/failed to write/);
  });
});
