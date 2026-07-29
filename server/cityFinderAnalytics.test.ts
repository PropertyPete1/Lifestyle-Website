/**
 * The city_finder_generate event: one row per real AI report generation, so the
 * admin can see how often the signature tool actually runs (and what it costs
 * in AI calls). Must never be logged for a cached /city-finder/:slug read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

function publicCtx(): TrpcContext {
  return {
    user: null,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function adminCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "o1",
      name: "T",
      email: "peter@lifestyledesignrealty.com",
      role: "admin",
    } as TrpcContext["user"],
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("analytics.track — city_finder_generate", () => {
  it("accepts the event and persists it with traffic attribution", async () => {
    const spy = vi.spyOn(db, "logPageEvent").mockResolvedValue(undefined);
    const caller = appRouter.createCaller(publicCtx());

    const res = await caller.analytics.track({
      kind: "city_finder_generate",
      path: "/city-finder",
      visitorId: "v_abc123",
      source: "Instagram",
      utmMedium: "Bio",
      utmCampaign: "july-reel",
    });

    expect(res.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      kind: "city_finder_generate",
      path: "/city-finder",
      visitorId: "v_abc123",
      source: "instagram",
      utmMedium: "bio",
      utmCampaign: "july-reel",
    });
  });

  it("works without a visitor id (localStorage blocked)", async () => {
    const spy = vi.spyOn(db, "logPageEvent").mockResolvedValue(undefined);
    const caller = appRouter.createCaller(publicCtx());
    await caller.analytics.track({ kind: "city_finder_generate", path: "/city-finder" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "city_finder_generate", path: "/city-finder" })
    );
  });

  it("rejects an unknown event kind (guards typos from silently no-oping)", async () => {
    const caller = appRouter.createCaller(publicCtx());
    await expect(
      caller.analytics.track({
        kind: "city_finder_generated" as never,
        path: "/city-finder",
      })
    ).rejects.toThrow();
  });

  it("is still excluded on /admin like every other event", async () => {
    const spy = vi.spyOn(db, "logPageEvent").mockResolvedValue(undefined);
    const caller = appRouter.createCaller(publicCtx());
    await caller.analytics.track({ kind: "city_finder_generate", path: "/admin/analytics" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("analytics.summary — cityFinderGenerates total", () => {
  it("surfaces the count to the admin dashboard", async () => {
    const fake = {
      totals: {
        views: 10,
        uniques: 4,
        bannerClicks: 2,
        ncClicks: 3,
        leaseClicks: 1,
        linksForms: 2,
        cityFinderGenerates: 7,
      },
      perPage: [],
      daily: [],
      funnel: { homeViews: 6, bannerClicks: 2, joinViews: 3, recruitSubmissions: 1 },
      sources: [],
      ncByPath: [],
    };
    vi.spyOn(db, "getAnalyticsSummary").mockResolvedValue(fake as never);
    const res = await appRouter.createCaller(adminCtx()).analytics.summary({ days: 30 });
    expect(res.totals.cityFinderGenerates).toBe(7);
  });
});
