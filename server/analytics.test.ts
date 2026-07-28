/**
 * First-party analytics tests:
 * - analytics.track is public, normalizes paths, and never tracks /admin
 * - analytics.summary is admin-gated
 * - getAnalyticsSummary aggregates views/uniques/banner clicks and the funnel
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

function ctxWith(user: { role: "admin" | "user" } | null): TrpcContext {
  return {
    user: user
      ? ({ id: 1, openId: "o1", name: "T", email: "t@t.co", role: user.role } as TrpcContext["user"])
      : null,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("analytics.track", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("logs a normalized view event (strips query, trailing slash)", async () => {
    const spy = vi.spyOn(db, "logPageEvent").mockResolvedValue(undefined);
    const caller = appRouter.createCaller(ctxWith(null)); // public — no auth needed
    const res = await caller.analytics.track({ kind: "view", path: "/join/?utm=x", visitorId: "v_abc123" });
    expect(res.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith({ kind: "view", path: "/join", visitorId: "v_abc123" });
  });

  it("never records admin paths", async () => {
    const spy = vi.spyOn(db, "logPageEvent").mockResolvedValue(undefined);
    const caller = appRouter.createCaller(ctxWith(null));
    const res = await caller.analytics.track({ kind: "view", path: "/admin/leads" });
    expect(res.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("records banner clicks with kind banner_click", async () => {
    const spy = vi.spyOn(db, "logPageEvent").mockResolvedValue(undefined);
    const caller = appRouter.createCaller(ctxWith(null));
    await caller.analytics.track({ kind: "banner_click", path: "/", visitorId: "v_abc123" });
    expect(spy).toHaveBeenCalledWith({ kind: "banner_click", path: "/", visitorId: "v_abc123" });
  });

  it("rejects paths that do not start with /", async () => {
    const caller = appRouter.createCaller(ctxWith(null));
    await expect(
      caller.analytics.track({ kind: "view", path: "join" })
    ).rejects.toThrow();
  });
});

describe("analytics.summary", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("is admin-gated: anonymous and non-admin callers are rejected", async () => {
    const anon = appRouter.createCaller(ctxWith(null));
    await expect(anon.analytics.summary({ days: 30 })).rejects.toThrow();
    const nonAdmin = appRouter.createCaller(ctxWith({ role: "user" }));
    await expect(nonAdmin.analytics.summary({ days: 30 })).rejects.toThrow();
  });

  it("returns the aggregate shape for admins", async () => {
    const fake = {
      totals: { views: 10, uniques: 4, bannerClicks: 2 },
      perPage: [{ path: "/", views: 6, uniques: 3 }],
      daily: [{ day: "2026-07-28", views: 10, uniques: 4, bannerClicks: 2 }],
      funnel: { homeViews: 6, bannerClicks: 2, joinViews: 3, recruitSubmissions: 1 },
    };
    vi.spyOn(db, "getAnalyticsSummary").mockResolvedValue(fake);
    const admin = appRouter.createCaller(ctxWith({ role: "admin" }));
    const res = await admin.analytics.summary({ days: 30 });
    expect(res).toEqual(fake);
  });
});

describe("getAnalyticsSummary (live DB)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("aggregates real events written through logPageEvent", async () => {
    const marker = `/__test-${Date.now()}`;
    const vid = `v_test${Date.now().toString(36)}`;
    await db.logPageEvent({ kind: "view", path: marker, visitorId: vid });
    await db.logPageEvent({ kind: "view", path: marker, visitorId: vid });
    const summary = await db.getAnalyticsSummary(1);
    const row = summary.perPage.find((p) => p.path === marker);
    expect(row?.views).toBe(2);
    expect(row?.uniques).toBe(1);
    expect(summary.totals.views).toBeGreaterThanOrEqual(2);
    // cleanup
    const conn = await db.getDb();
    if (conn) {
      const { sql } = await import("drizzle-orm");
      await conn.execute(sql`DELETE FROM page_events WHERE path = ${marker}`);
    }
  });
});
