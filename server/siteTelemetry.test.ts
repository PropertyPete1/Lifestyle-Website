import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  atomicWriteJson,
  buildSiteStats,
  chicagoDayBounds,
  compactDay,
  previousDay,
  readJsonOr,
  SESSIONS_UNAVAILABLE,
  STATS_FILENAME,
  STATUS_DIRNAME,
  todayInChicago,
  writeSiteTelemetry,
  type SiteStats,
} from "./siteTelemetry";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "site-telemetry-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const statsPath = () => join(root, STATUS_DIRNAME, STATS_FILENAME);
const readStats = (): SiteStats => JSON.parse(readFileSync(statsPath(), "utf-8"));

const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

describe("chicagoDayBounds", () => {
  it("bounds an ordinary summer day at 05:00 UTC (CDT)", () => {
    const { start, end } = chicagoDayBounds("2026-08-11");
    expect(start.toISOString()).toBe("2026-08-11T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-12T05:00:00.000Z");
    expect(hours(start, end)).toBe(24);
  });

  it("bounds an ordinary winter day at 06:00 UTC (CST)", () => {
    const { start, end } = chicagoDayBounds("2026-01-15");
    expect(start.toISOString()).toBe("2026-01-15T06:00:00.000Z");
    expect(hours(start, end)).toBe(24);
  });

  it("makes the spring-forward day 23 hours long", () => {
    // 2026-03-08: clocks jump 02:00 CST → 03:00 CDT.
    const { start, end } = chicagoDayBounds("2026-03-08");
    expect(start.toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T05:00:00.000Z");
    expect(hours(start, end)).toBe(23);
  });

  it("makes the fall-back day 25 hours long", () => {
    // 2026-11-01: clocks fall 02:00 CDT → 01:00 CST.
    const { start, end } = chicagoDayBounds("2026-11-01");
    expect(start.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(hours(start, end)).toBe(25);
  });

  it("rolls across month and year boundaries", () => {
    expect(chicagoDayBounds("2026-12-31").end.toISOString()).toBe("2027-01-01T06:00:00.000Z");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
  });
});

describe("todayInChicago", () => {
  it("uses the Chicago day, not the UTC day", () => {
    // 03:30 UTC on the 12th is still 22:30 on the 11th in Chicago.
    expect(todayInChicago(new Date("2026-08-12T03:30:00Z"))).toBe("2026-08-11");
    expect(todayInChicago(new Date("2026-08-12T06:30:00Z"))).toBe("2026-08-12");
  });
});

describe("compactDay — absent is not zero", () => {
  it("keeps a counted zero", () => {
    expect(compactDay({ page_views: 0 })).toEqual({ page_views: 0 });
  });

  it("drops metrics that were never learned", () => {
    expect(compactDay({ page_views: undefined, unique_visitors: 4 })).toEqual({
      unique_visitors: 4,
    });
  });

  it("drops a NaN rather than publishing it", () => {
    expect(compactDay({ page_views: Number.NaN })).toEqual({});
  });
});

describe("buildSiteStats", () => {
  const now = new Date("2026-08-11T14:00:00Z");

  it("marks today partial and yesterday complete", () => {
    const stats = buildSiteStats({
      now,
      today: { page_views: 10, unique_visitors: 4 },
      yesterday: { page_views: 90, unique_visitors: 41 },
    });
    expect(stats.date).toBe("2026-08-11");
    expect(stats.days["2026-08-11"].complete).toBe(false);
    expect(stats.days["2026-08-10"].complete).toBe(true);
    expect(stats.days["2026-08-10"].page_views).toBe(90);
  });

  it("always reports sessions as unavailable, with a reason", () => {
    const stats = buildSiteStats({ now, today: { page_views: 1 } });
    const sessions = stats.unavailable.find((u) => u.metric === "sessions");
    expect(sessions).toBeDefined();
    expect(sessions!.reason).toMatch(/no session identifier/i);
  });

  it("omits a day it learned nothing about instead of zeroing it", () => {
    const stats = buildSiteStats({ now, today: { page_views: 3 }, yesterday: null });
    expect(stats.days["2026-08-11"]).toBeDefined();
    expect(stats.days["2026-08-10"]).toBeUndefined();
    expect(JSON.stringify(stats.days)).not.toContain("2026-08-10");
  });

  it("carries a counted zero day through as real data", () => {
    const stats = buildSiteStats({ now, today: { page_views: 0, unique_visitors: 0 } });
    expect(stats.days["2026-08-11"].page_views).toBe(0);
  });
});

describe("atomicWriteJson", () => {
  it("creates the directory and writes parseable JSON", async () => {
    const path = join(root, "status", "nested", "x.json");
    await atomicWriteJson(path, { a: 1 });
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ a: 1 });
  });

  it("leaves no temp files behind", async () => {
    const dir = join(root, STATUS_DIRNAME);
    await atomicWriteJson(join(dir, STATS_FILENAME), { a: 1 });
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("replaces the previous file wholesale rather than merging into it", async () => {
    const path = join(root, "x.json");
    await atomicWriteJson(path, { a: 1, stale: true });
    await atomicWriteJson(path, { a: 2 });
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ a: 2 });
  });

  it("gives up after its retries and throws, leaving no temp files", async () => {
    // A path whose parent is a FILE can never be made into a directory.
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "not a directory");
    await expect(atomicWriteJson(join(blocker, "x.json"), { a: 1 }, 2)).rejects.toThrow();
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("readJsonOr", () => {
  it("falls back when the file is missing or corrupt", () => {
    expect(readJsonOr(join(root, "nope.json"), { fallback: true })).toEqual({ fallback: true });
    const corrupt = join(root, "corrupt.json");
    writeFileSync(corrupt, "{ half-writ");
    expect(readJsonOr(corrupt, { fallback: true })).toEqual({ fallback: true });
  });
});

describe("writeSiteTelemetry", () => {
  const now = new Date("2026-08-11T14:00:00Z");

  it("writes real numbers when the source can be read", async () => {
    const result = await writeSiteTelemetry({
      repoRoot: root,
      now,
      collect: async () => ({
        today: { page_views: 120, unique_visitors: 44, views_without_visitor_id: 3 },
        yesterday: { page_views: 310, unique_visitors: 101, lead_submissions: 2 },
      }),
    });

    expect(result.ok).toBe(true);
    const stats = readStats();
    expect(stats.days["2026-08-11"].page_views).toBe(120);
    expect(stats.days["2026-08-11"].views_without_visitor_id).toBe(3);
    expect(stats.days["2026-08-10"].lead_submissions).toBe(2);
    expect(stats.timezone).toBe("America/Chicago");
  });

  it("never zeroes a metric when the database is unreachable", async () => {
    const result = await writeSiteTelemetry({
      repoRoot: root,
      now,
      collect: async () => {
        throw new Error("ECONNREFUSED 10.0.0.1:3306");
      },
    });

    expect(result.ok).toBe(true); // the writer succeeded; the source did not
    const stats = readStats();
    expect(stats.days).toEqual({});
    expect(JSON.stringify(stats.days)).not.toContain("0");

    const named = stats.unavailable.find((u) => u.reason.includes("ECONNREFUSED"));
    expect(named).toBeDefined();
    expect(named!.metric).toContain("page_views");
  });

  it("publishes the day it could read and names the day it could not", async () => {
    await writeSiteTelemetry({
      repoRoot: root,
      now,
      collect: async () => ({
        today: { page_views: 12 },
        yesterday: null,
        unavailable: [{ metric: "page_views (yesterday 2026-08-10)", reason: "query failed: lock wait timeout" }],
      }),
    });

    const stats = readStats();
    expect(stats.days["2026-08-11"].page_views).toBe(12);
    expect(stats.days["2026-08-10"]).toBeUndefined();
    expect(stats.unavailable.some((u) => u.reason.includes("lock wait timeout"))).toBe(true);
  });

  it("does not throw when the destination cannot be written", async () => {
    const blocked = join(root, "blocked");
    writeFileSync(blocked, "not a directory");

    const result = await writeSiteTelemetry({
      repoRoot: blocked,
      now,
      collect: async () => ({ today: { page_views: 5 } }),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("leaves the previous file intact when the run cannot read anything new", async () => {
    const good = await writeSiteTelemetry({
      repoRoot: root,
      now,
      collect: async () => ({ today: { page_views: 500 } }),
    });
    expect(good.ok).toBe(true);

    await writeSiteTelemetry({
      repoRoot: root,
      now: new Date("2026-08-11T15:00:00Z"),
      collect: async () => {
        throw new Error("database went away");
      },
    });

    // The file is still valid JSON and still honest: no fabricated zeros.
    const stats = readStats();
    expect(existsSync(statsPath())).toBe(true);
    expect(stats.days).toEqual({});
    expect(stats.unavailable.map((u) => u.metric)).toContain(SESSIONS_UNAVAILABLE.metric);
  });
});
