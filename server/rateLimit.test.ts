/**
 * Request budgets on the public, paid, and write endpoints (server/rateLimit.ts).
 *
 * The audit found every AI endpoint and every write endpoint open to an
 * unbounded anonymous loop. These tests pin three things: the counter itself,
 * that the procedures are actually wired through it (a limiter nobody calls
 * is decoration), and that an over-budget caller gets TOO_MANY_REQUESTS with
 * the human message rather than a stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initTRPC } from "@trpc/server";
import { z } from "zod";

vi.mock("./db", () => ({
  createPartnerPitch: vi.fn(async () => undefined),
  createCityMatch: vi.fn(async () => undefined),
  logVisitorActivity: vi.fn(async () => undefined),
  logPageEvent: vi.fn(async () => undefined),
  getAllListings: vi.fn(async () => []),
  createLead: vi.fn(async () => 1),
  updateLead: vi.fn(async () => undefined),
  getVisitorActivity: vi.fn(async () => []),
}));
vi.mock("./partnerPitch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./partnerPitch")>();
  return { ...actual, generatePitch: vi.fn(async () => "A warm scene by the river.") };
});
vi.mock("./aiSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./aiSearch")>();
  return { ...actual, extractCriteria: vi.fn(async () => ({})) };
});
vi.mock("./fub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fub")>();
  return { ...actual, sendToFub: vi.fn(async () => ({ ok: true, fubId: "1" })) };
});
vi.mock("./rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rateLimit")>();
  return { ...actual, checkRateLimit: vi.fn(actual.checkRateLimit) };
});

import {
  checkRateLimit,
  clientKey,
  MAX_TRACKED_KEYS,
  RATE_LIMITS,
  RATE_LIMIT_MESSAGE,
  resetRateLimits,
  trackedBucketCount,
} from "./rateLimit";
import { rateLimitedProcedure, router } from "./_core/trpc";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const checkSpy = vi.mocked(checkRateLimit);

function ctxFrom(ip: string): TrpcContext {
  return {
    user: null,
    req: { headers: { "x-forwarded-for": ip }, protocol: "https" } as unknown as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  resetRateLimits();
  // The spy wraps the real implementation; only call history is cleared, so
  // a `mockReturnValueOnce` in one test never leaks into the next.
  checkSpy.mockClear();
});
afterEach(() => {
  resetRateLimits();
});

describe("checkRateLimit — fixed window counter", () => {
  const rule = { name: "t", limit: 3, windowMs: 1_000 };

  it("allows exactly `limit` requests in a window, then refuses", () => {
    const t0 = 1_000_000;
    expect(checkRateLimit(rule, "a", t0).allowed).toBe(true);
    expect(checkRateLimit(rule, "a", t0 + 1).allowed).toBe(true);
    const third = checkRateLimit(rule, "a", t0 + 2);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = checkRateLimit(rule, "a", t0 + 3);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBe(rule.windowMs - 3);
  });

  it("resets when the window elapses", () => {
    const t0 = 5_000;
    for (let i = 0; i < 3; i++) checkRateLimit(rule, "b", t0);
    expect(checkRateLimit(rule, "b", t0 + 999).allowed).toBe(false);
    expect(checkRateLimit(rule, "b", t0 + 1_000).allowed).toBe(true);
  });

  it("keeps keys and rule names in separate buckets", () => {
    const t0 = 0;
    for (let i = 0; i < 3; i++) checkRateLimit(rule, "c", t0);
    expect(checkRateLimit(rule, "c", t0).allowed).toBe(false);
    expect(checkRateLimit(rule, "d", t0).allowed).toBe(true);
    expect(checkRateLimit({ ...rule, name: "other" }, "c", t0).allowed).toBe(true);
  });

  it("never grows past the tracked-key ceiling (spoofed-XFF flood)", () => {
    const t0 = 0;
    for (let i = 0; i < MAX_TRACKED_KEYS + 500; i++) checkRateLimit(rule, `flood-${i}`, t0);
    expect(trackedBucketCount()).toBeLessThanOrEqual(MAX_TRACKED_KEYS);
    // and still counts correctly afterwards
    expect(checkRateLimit(rule, "after-flood", t0).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("prefers the first X-Forwarded-For hop, then req.ip, then the socket", () => {
    expect(clientKey({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } })).toBe("203.0.113.9");
    expect(clientKey({ headers: {}, ip: "198.51.100.4" })).toBe("198.51.100.4");
    expect(clientKey({ headers: {}, socket: { remoteAddress: "::1" } })).toBe("::1");
  });
  it("never throws on a bare context", () => {
    expect(clientKey(undefined)).toBe("unknown");
    expect(clientKey({} as never)).toBe("unknown");
  });
});

describe("rateLimitedProcedure", () => {
  const t = initTRPC.context<TrpcContext>().create();
  const tiny = router({
    ping: rateLimitedProcedure({ name: "ping", limit: 2, windowMs: 60_000 })
      .input(z.object({}).optional())
      .mutation(() => "pong"),
  });
  void t;

  it("refuses the third call from one connection with TOO_MANY_REQUESTS and the human message", async () => {
    const caller = tiny.createCaller(ctxFrom("203.0.113.1"));
    await expect(caller.ping()).resolves.toBe("pong");
    await expect(caller.ping()).resolves.toBe("pong");
    await expect(caller.ping()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: RATE_LIMIT_MESSAGE,
    });
    // A different connection is unaffected.
    await expect(tiny.createCaller(ctxFrom("203.0.113.2")).ping()).resolves.toBe("pong");
  });
});

describe("the paid and write endpoints are wired through the limiter", () => {
  const cases: [string, (c: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>, string][] = [
    ["partnerPitch.generate", (c) => c.partnerPitch.generate({ selections: ["Space & Land"] }), RATE_LIMITS.aiGenerate.name],
    [
      "cityFinder.generate",
      (c) => c.cityFinder.generate({ answers: { budget: "under-300k" }, rankedCities: ["Austin"] }),
      RATE_LIMITS.aiGenerate.name,
    ],
    ["listings.aiSearch", (c) => c.listings.aiSearch({ query: "pool in Austin" }), RATE_LIMITS.aiSearch.name],
    [
      "leads.submit",
      (c) =>
        c.leads.submit({
          name: "A B",
          email: "a@b.co",
          phone: "5551234567",
          sourceTag: "Website - Contact",
          tcpaConsent: true,
        }),
      RATE_LIMITS.leadSubmit.name,
    ],
    [
      "activity.log",
      (c) => c.activity.log({ visitorId: "v_123456", kind: "favorite", data: { slug: "x" } }),
      RATE_LIMITS.activityLog.name,
    ],
    ["analytics.track", (c) => c.analytics.track({ kind: "view", path: "/" }), RATE_LIMITS.analyticsTrack.name],
  ];

  for (const [name, call, ruleName] of cases) {
    it(`${name} consults the limiter under rule "${ruleName}"`, async () => {
      const caller = appRouter.createCaller(ctxFrom("203.0.113.50"));
      await call(caller);
      const rules = checkSpy.mock.calls.map(([rule]) => rule.name);
      expect(rules).toContain(ruleName);
    });

    it(`${name} refuses when the limiter says no`, async () => {
      checkSpy.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterMs: 1000 });
      const caller = appRouter.createCaller(ctxFrom("203.0.113.51"));
      await expect(call(caller)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });
  }
});
