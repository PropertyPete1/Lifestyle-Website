import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealAccessTokens, dealLeads, dealTeamAllowlist } from "../drizzle/schema";
import { DEALS_COOKIE } from "../shared/deals";
import { safeReturnTo, decodeOAuthState, encodeOAuthState } from "../shared/const";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/** Oct 27, 2026: an agent signed in to the site with their Lifestyle e-mail gets a Builder Deals team session without a text. */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsMap", () => ({ communityAreaMap: () => null, areaMapGeometry: () => null, areaMapRadius: () => 5 }));

import { teamEmailKnown, teamSessionFromSiteLogin } from "./dealsTeamSignIn";
import { TEAM_ACCESS_HOURS, isLiveDealSession } from "./dealsService";

const HOUR = 3_600_000;
let db: FakeDealsDb;
type CookieCall = { name: string; value?: string; options?: { maxAge?: number } };
function responseRecorder() {
  const cookies: CookieCall[] = [];
  const response = { cookie: (name: string, value: string, options?: { maxAge?: number }) => { cookies.push({ name, value, options }); return response; }, clearCookie: (name: string) => { cookies.push({ name }); return response; }, setHeader: () => response } as unknown as Response;
  return { response, cookies, cookie: (name: string) => [...cookies].reverse().find((entry) => entry.name === name && entry.value)?.value };
}
const request = (cookies: Record<string, string>): Request => ({ headers: { cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ") }, ip: "203.0.113.9", socket: { remoteAddress: "203.0.113.9" } } as unknown as Request);
const browser = { [DEALS_COOKIE.device]: "agent-mac", [DEALS_COOKIE.probe]: "p" };

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  db.seed(dealTeamAllowlist, { name: "Tiffany Agent", phoneE164: "+12105550101", email: "Tiffany@LifestyleDesignRealty.com", source: "fub", active: true });
  db.seed(dealTeamAllowlist, { name: "Gone Agent", phoneE164: "+12105550102", email: "gone@lifestyledesignrealty.com", source: "fub", active: false });
  db.seed(dealTeamAllowlist, { name: "No Phone", phoneE164: null, email: "nophone@lifestyledesignrealty.com", source: "manual", active: true });
});
afterEach(() => vi.clearAllMocks());

describe("team session from the site login", () => {
  it("signs an active team e-mail in for 90 days on this browser, creating the lead when there is none", async () => {
    const res = responseRecorder();
    const authenticate = async () => ({ email: "tiffany@lifestyledesignrealty.com", name: "Tiffany" });
    expect(await teamSessionFromSiteLogin(request(browser), res.response, { authenticate })).toBe("ok");
    const lead = db.rows(dealLeads).find((row) => row.phoneE164 === "+12105550101")!;
    expect(lead).toMatchObject({ status: "team", email: "tiffany@lifestyledesignrealty.com", name: "Tiffany Agent", sourceCode: "team" });
    expect(lead.expiresAt.getTime() - Date.now()).toBeGreaterThan((TEAM_ACCESS_HOURS - 1) * HOUR);
    const session = res.cookie(DEALS_COOKIE.session)!;
    expect(session).toBeTruthy();
    expect(db.rows(dealAccessTokens)).toHaveLength(1);
    const live = await isLiveDealSession(request({ ...browser, [DEALS_COOKIE.session]: session }));
    expect(live?.lead.status).toBe("team");
    // Again from the same browser: the same lead, a second session, still 90 days.
    const again = responseRecorder();
    expect(await teamSessionFromSiteLogin(request(browser), again.response, { authenticate })).toBe("ok");
    expect(db.rows(dealLeads).filter((row) => row.phoneE164 === "+12105550101")).toHaveLength(1);
  });

  it("refuses everyone else: no login, an e-mail off the team, a removed agent, a row without a phone, a browser without cookies, a turned-off lead", async () => {
    expect(await teamSessionFromSiteLogin(request(browser), responseRecorder().response, { authenticate: async () => null })).toBe("no_login");
    expect(await teamSessionFromSiteLogin(request(browser), responseRecorder().response, { authenticate: async () => ({ email: "maria@kw.com" }) })).toBe("not_team");
    expect(await teamSessionFromSiteLogin(request(browser), responseRecorder().response, { authenticate: async () => ({ email: "gone@lifestyledesignrealty.com" }) })).toBe("not_team");
    expect(await teamSessionFromSiteLogin(request(browser), responseRecorder().response, { authenticate: async () => ({ email: "nophone@lifestyledesignrealty.com" }) })).toBe("no_phone");
    expect(await teamSessionFromSiteLogin(request({}), responseRecorder().response, { authenticate: async () => ({ email: "tiffany@lifestyledesignrealty.com" }) })).toBe("cookie_blocked");
    db.seed(dealLeads, { phoneE164: "+12105550101", status: "team", expiresAt: new Date(Date.now() + HOUR), deviceHash: "d".repeat(64), consentText: "c", consentIp: "1.1.1.1", flags: "[]", sourceCode: "team", revokedAt: new Date() });
    expect(await teamSessionFromSiteLogin(request(browser), responseRecorder().response, { authenticate: async () => ({ email: "tiffany@lifestyledesignrealty.com" }) })).toBe("turned_off");
    expect(db.rows(dealAccessTokens)).toHaveLength(0);
    expect(await teamEmailKnown("TIFFANY@lifestyledesignrealty.com")).toBe(true);
    expect(await teamEmailKnown("gone@lifestyledesignrealty.com")).toBe(false);
  });

  it("the login callback may only return to a same-origin path", () => {
    expect(safeReturnTo("/deals/team")).toBe("/deals/team");
    expect(safeReturnTo("/deals?gate=1&team=1")).toBe("/deals?gate=1&team=1");
    expect(safeReturnTo("//evil.example/x")).toBeNull();
    expect(safeReturnTo("https://evil.example")).toBeNull();
    expect(safeReturnTo("/deals/<script>")).toBeNull();
    expect(decodeOAuthState(encodeOAuthState({ redirectUri: "https://x/cb", nonce: "n", returnTo: "/deals/team" }))).toEqual({ redirectUri: "https://x/cb", nonce: "n", returnTo: "/deals/team" });
  });
});
