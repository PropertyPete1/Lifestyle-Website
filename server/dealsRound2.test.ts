import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  chicagoDayStart,
  clearDealCookie,
  currentDealSource,
  dealsCsp,
  dealsPublicHeaders,
  getGoogleDealsIdentity,
  normalizeTestNumbers,
  publicNoPrivateNames,
  setDealCookie,
  setGoogleDealsIdentity,
} from "./dealsService";

type CookieCall = { name: string; value?: string; options: Record<string, unknown> };

function responseRecorder(): { response: Response; cookies: CookieCall[]; cleared: CookieCall[]; headers: Headers } {
  const cookies: CookieCall[] = [];
  const cleared: CookieCall[] = [];
  const headers = new Headers();
  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => { cookies.push({ name, value, options }); return response; },
    clearCookie: (name: string, options: Record<string, unknown>) => { cleared.push({ name, options }); return response; },
    setHeader: (name: string, value: string) => { headers.set(name, value); return response; },
  } as unknown as Response;
  return { response, cookies, cleared, headers };
}

function requestWithCookies(cookies: Record<string, string>): Request {
  return { headers: { cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ") } } as Request;
}

describe("Builder Deals Round 2 regression behavior", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("writes root-scoped HTTP-only Deals cookies and retires legacy path-scoped copies", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { response, cookies, cleared } = responseRecorder();

    setDealCookie(response, "ldr_deals_session", "opaque", 120);
    clearDealCookie(response, "ldr_deals_pending");

    expect(cookies).toEqual([{ name: "ldr_deals_session", value: "opaque", options: expect.objectContaining({ path: "/", httpOnly: true, secure: true, sameSite: "lax", maxAge: 120_000 }) }]);
    expect(cleared).toEqual([
      { name: "ldr_deals_session", options: expect.objectContaining({ path: "/deals", maxAge: 0 }) },
      { name: "ldr_deals_pending", options: expect.objectContaining({ path: "/", maxAge: 0 }) },
      { name: "ldr_deals_pending", options: expect.objectContaining({ path: "/deals", maxAge: 0 }) },
    ]);
  });

  it("only accepts an intact, signed Google identity cookie", () => {
    vi.stubEnv("JWT_SECRET", "round-two-test-signing-key");
    const { response, cookies } = responseRecorder();
    setGoogleDealsIdentity(response, { email: "Buyer@Example.test", name: "  Buyer Name  " });
    const signed = cookies[0]?.value;
    expect(signed).toBeTruthy();

    expect(getGoogleDealsIdentity(requestWithCookies({ ldr_deals_google: signed! }))).toEqual({ email: "buyer@example.test", name: "Buyer Name" });
    expect(getGoogleDealsIdentity(requestWithCookies({ ldr_deals_google: `${signed}tampered` }))).toBeNull();
    expect(getGoogleDealsIdentity(requestWithCookies({ ldr_deals_google: `${Buffer.from(JSON.stringify({ email: "not-an-email" })).toString("base64url")}.signature` }))).toBeNull();
  });

  it("normalizes test phones, filters unknown campaign sources, and rejects residual private data", () => {
    expect(normalizeTestNumbers(["(210) 555-0123", "+1 210 555 0123"])).toEqual(["+12105550123"]);
    expect(() => normalizeTestNumbers(["not a phone"])).toThrow("Invalid test number");
    expect(currentDealSource("sl1", { activeReelCodes: ["sl1"] } as any)).toBe("sl1");
    expect(currentDealSource("SL1", { activeReelCodes: ["sl1"] } as any)).toBe("other");
    expect(currentDealSource("unapproved", { activeReelCodes: ["sl1"] } as any)).toBe("other");
    expect(publicNoPrivateNames({ label: "Generic community" }, ["Secret Grove"])).toBe(true);
    expect(publicNoPrivateNames({ label: "Secret Grove" }, ["Secret Grove"])).toBe(false);
  });

  it("sets concrete no-store, noindex, same-origin, and self-only CSP response protections", () => {
    const { response, headers } = responseRecorder();
    dealsPublicHeaders(response);
    dealsCsp(response);

    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("referrer-policy")).toBe("same-origin");
    expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(headers.get("content-security-policy")).toContain("connect-src 'self'");
  });

  it("uses the Central calendar day across both daylight-saving offsets", () => {
    expect(chicagoDayStart(new Date("2026-01-15T05:59:59.000Z")).toISOString()).toBe("2026-01-14T06:00:00.000Z");
    expect(chicagoDayStart(new Date("2026-07-15T05:59:59.000Z")).toISOString()).toBe("2026-07-15T05:00:00.000Z");
  });
});
