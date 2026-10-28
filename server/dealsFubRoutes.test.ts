import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  teamSessionFromSiteLogin: vi.fn(async () => "no_login"),
  completeVerification: vi.fn(),
  isLiveDealSession: vi.fn(),
  getDealSettings: vi.fn(),
  enqueueDealsFubJob: vi.fn(),
  runPendingDealsFubJobs: vi.fn(),
  queueFirstUnlockAlert: vi.fn(),
  queueProfileFlagAlert: vi.fn(),
  notifyClientLinkAttached: vi.fn(),
  staleSessionLeadId: vi.fn(),
  clientLinkTokenForLead: vi.fn(),
  agentForPageSlug: vi.fn(),
}));
vi.mock("./dealsTeamSignIn", () => ({ teamSessionFromSiteLogin: (...args: unknown[]) => mocks.teamSessionFromSiteLogin(...args) }));
vi.mock("./dealsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsService")>()),
  completeVerification: (...args: unknown[]) => mocks.completeVerification(...args),
  isLiveDealSession: (...args: unknown[]) => mocks.isLiveDealSession(...args),
  getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args),
  staleSessionLeadId: (...args: unknown[]) => mocks.staleSessionLeadId(...args),
}));
vi.mock("./dealsClientLinks", () => ({ clientLinkTokenForLead: (...args: unknown[]) => mocks.clientLinkTokenForLead(...args) }));
vi.mock("./dealsAgentPages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsAgentPages")>()),
  agentForPageSlug: (...args: unknown[]) => mocks.agentForPageSlug(...args),
}));
vi.mock("./dealsFubJobs", () => ({
  enqueueDealsFubJob: (...args: unknown[]) => mocks.enqueueDealsFubJob(...args),
  runPendingDealsFubJobs: (...args: unknown[]) => mocks.runPendingDealsFubJobs(...args),
}));
vi.mock("./dealsAlerts", () => ({
  queueFirstUnlockAlert: (...args: unknown[]) => mocks.queueFirstUnlockAlert(...args),
  queueProfileFlagAlert: (...args: unknown[]) => mocks.queueProfileFlagAlert(...args),
  notifyClientLinkAttached: (...args: unknown[]) => mocks.notifyClientLinkAttached(...args),
}));

import { registerDealsRoutes } from "./dealsRoutes";
import { DEALS_COOKIE } from "../shared/deals";

const settings = { testModeFullPipeline: false, activeReelCodes: ["sl1"] };
const completed = { ok: true as const, token: "t".repeat(40), leadId: 31, expiresAt: new Date(Date.now() + 3_600_000), firstUnlock: true, reverifiedActive: false, isTeam: false, isTest: false, fubCheckDeferred: false, duplicate: false, clientLinkAttached: null as number | null };
const LINK = "Lnk_".repeat(8);

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerDealsRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.close(); await once(server, "close"); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isLiveDealSession.mockResolvedValue(null);
  mocks.getDealSettings.mockResolvedValue(settings);
  mocks.enqueueDealsFubJob.mockResolvedValue(undefined);
  mocks.runPendingDealsFubJobs.mockResolvedValue({ sent: 0, failed: 0, skipped: 0, leased: 0 });
  mocks.staleSessionLeadId.mockResolvedValue(null);
  mocks.clientLinkTokenForLead.mockResolvedValue(null);
  mocks.notifyClientLinkAttached.mockResolvedValue({ queued: true });
});

async function verify() {
  const response = await fetch(`${baseUrl}/deals/verify`, { method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "123456" }) });
  // The route hands off to a void promise; let it settle before asserting.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return response;
}

describe("an agent's own page link (Oct 28: /deals/u/<name> for their Instagram bio)", () => {
  it("opens the home search with the agent remembered for 30 days; an unknown or malformed name opens the plain page", async () => {
    mocks.agentForPageSlug.mockImplementation(async (slug: string) => slug === "tiffany-agent" ? { teamId: 5, name: "Tiffany Agent", active: true } : null);
    const known = await fetch(`${baseUrl}/deals/u/tiffany-agent`, { redirect: "manual" });
    expect(known.status).toBe(302);
    expect(known.headers.get("location")).toBe("/deals?a=tiffany-agent");
    const cookie = known.headers.getSetCookie().find((value) => value.startsWith("ldr_deals_agent="));
    expect(cookie).toContain("ldr_deals_agent=tiffany-agent");
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).toMatch(/HttpOnly/);
    for (const path of ["/deals/u/nobody", "/deals/u/Bad_Name!"]) {
      const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
      expect(response.headers.get("location")).toBe("/deals");
      expect(response.headers.getSetCookie().some((value) => value.startsWith("ldr_deals_agent="))).toBe(false);
    }
  });
});

describe("Builder Deals verify route side effects", () => {
  it("hands the deferred FUB check to the outbox job and leaves the unlock alert to the job runner", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, fubCheckDeferred: true });
    const response = await verify();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/deals/v/${completed.token}`);
    expect(mocks.enqueueDealsFubJob).toHaveBeenCalledWith(31, "first_unlock", { reason: "returned for a new link", deferredCheck: true });
    expect(mocks.runPendingDealsFubJobs).toHaveBeenCalledWith(1);
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
    expect(mocks.queueProfileFlagAlert).not.toHaveBeenCalled();
  });

  it("marks a second-device reverify with its reason", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, firstUnlock: false, reverifiedActive: true });
    await verify();
    expect(mocks.enqueueDealsFubJob).toHaveBeenCalledWith(31, "reverify", { reason: "re-verified on a second device", deferredCheck: false });
  });

  it("creates no FUB job (and therefore no alert) for a team member", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, isTeam: true });
    const response = await verify();
    expect(response.headers.get("location")).toBe(`/deals/v/${completed.token}`);
    expect(mocks.enqueueDealsFubJob).not.toHaveBeenCalled();
  });

  it("skips the spurious second-device note when a double-submitted verify returns the duplicate receipt", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, firstUnlock: false, reverifiedActive: true, duplicate: true });
    const response = await verify();
    expect(response.headers.get("location")).toBe(`/deals/v/${completed.token}`);
    expect(mocks.enqueueDealsFubJob).not.toHaveBeenCalled();
  });

  it("keeps test numbers out of FUB unless full-pipeline test mode is on", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, isTest: true });
    await verify();
    expect(mocks.enqueueDealsFubJob).not.toHaveBeenCalled();
    mocks.getDealSettings.mockResolvedValue({ ...settings, testModeFullPipeline: true });
    await verify();
    expect(mocks.enqueueDealsFubJob).toHaveBeenCalledTimes(1);
  });

  it("still redirects the buyer when the outbox enqueue throws", async () => {
    mocks.completeVerification.mockResolvedValue(completed);
    mocks.enqueueDealsFubJob.mockRejectedValue(new Error("database down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await verify();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/deals/v/${completed.token}`);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("Builder Deals expiry redirect contract", () => {
  it("sends an expired 10-minute code session to the gate as ?codeError=expired, not to the expired-link page", async () => {
    mocks.completeVerification.mockResolvedValue({ ok: false, kind: "expired" });
    const response = await verify();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/deals?codeError=expired");
    expect(mocks.enqueueDealsFubJob).not.toHaveBeenCalled();
  });

  it("keeps the other verify outcomes on their own flags", async () => {
    mocks.completeVerification.mockResolvedValue({ ok: false, kind: "invalid_code" });
    expect((await verify()).headers.get("location")).toBe("/deals?codeError=invalid_code");
    mocks.completeVerification.mockResolvedValue({ ok: false, kind: "blocked" });
    expect((await verify()).headers.get("location")).toBe("/deals?gate=1&blocked=1");
  });

  it("sends a dead session cookie on /deals/mine to the expired page and a browser without one to the gate", async () => {
    const dead = await fetch(`${baseUrl}/deals/mine`, { redirect: "manual", headers: { cookie: `${DEALS_COOKIE.session}=stale-token; ${DEALS_COOKIE.device}=device` } });
    expect(dead.status).toBe(302);
    expect(dead.headers.get("location")).toBe("/deals?expired=1");
    const fresh = await fetch(`${baseUrl}/deals/mine`, { redirect: "manual" });
    expect(fresh.status).toBe(302);
    expect(fresh.headers.get("location")).toBe("/deals?gate=1");
    expect(mocks.isLiveDealSession).toHaveBeenCalledTimes(2);
  });

  it("lets a live session through to the page", async () => {
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 31, lead: {}, deviceHash: "d" });
    const response = await fetch(`${baseUrl}/deals/mine`, { redirect: "manual", headers: { cookie: `${DEALS_COOKIE.session}=live` } });
    // No static handler is registered in this harness, so Express answers 404 after the check passes.
    expect(response.status).toBe(404);
  });

  it("guards the agent tools: no session goes to the gate or the expired page, a buyer to their list, the team through", async () => {
    const fresh = await fetch(`${baseUrl}/deals/team`, { redirect: "manual" });
    // Oct 26, 2026: ?team=1 opens the sheet as the agent sign-in.
    expect(fresh.headers.get("location")).toBe("/deals?gate=1&team=1");
    const dead = await fetch(`${baseUrl}/deals/team`, { redirect: "manual", headers: { cookie: `${DEALS_COOKIE.session}=stale` } });
    expect(dead.headers.get("location")).toBe("/deals?expired=1&team=1");
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 31, lead: { status: "verified" }, deviceHash: "d" });
    const buyer = await fetch(`${baseUrl}/deals/team`, { redirect: "manual", headers: { cookie: `${DEALS_COOKIE.session}=live` } });
    expect(buyer.status).toBe(302);
    expect(buyer.headers.get("location")).toBe("/deals/mine");
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 9, lead: { status: "team" }, deviceHash: "d" });
    const team = await fetch(`${baseUrl}/deals/team`, { redirect: "manual", headers: { cookie: `${DEALS_COOKIE.session}=live` } });
    expect(team.status).toBe(404);
  });

  it("opens the agent tools straight from a site login, and names a login that is not the team's on the sign-in sheet (Oct 27)", async () => {
    mocks.isLiveDealSession.mockResolvedValue(null);
    mocks.teamSessionFromSiteLogin.mockResolvedValueOnce("ok");
    // The new session cookie rides on the response, so the page is served now, not after a second round trip through the gate.
    expect((await fetch(`${baseUrl}/deals/team`, { redirect: "manual" })).status).toBe(404);
    mocks.teamSessionFromSiteLogin.mockResolvedValueOnce("not_team");
    expect((await fetch(`${baseUrl}/deals/team`, { redirect: "manual" })).headers.get("location")).toBe("/deals?gate=1&team=1&login=not_team");
    mocks.teamSessionFromSiteLogin.mockResolvedValueOnce("no_phone");
    expect((await fetch(`${baseUrl}/deals/team`, { redirect: "manual", headers: { cookie: `${DEALS_COOKIE.session}=stale` } })).headers.get("location")).toBe("/deals?expired=1&team=1&login=no_phone");
    mocks.teamSessionFromSiteLogin.mockResolvedValueOnce("unavailable");
    expect((await fetch(`${baseUrl}/deals/team`, { redirect: "manual" })).headers.get("location")).toBe("/deals?gate=1&team=1");
  });
});

describe("agent client links through the Express routes", () => {
  it("keeps the client-link token on every verify redirect so the visitor stays on the agent's gate", async () => {
    const post = (body: Record<string, string>) => fetch(`${baseUrl}/deals/verify`, { method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ code: "12", c: LINK })).headers.get("location")).toBe(`/deals?codeError=1&c=${LINK}`);
    mocks.completeVerification.mockResolvedValue({ ok: false, kind: "invalid_code" });
    expect((await post({ code: "123456", c: LINK })).headers.get("location")).toBe(`/deals?codeError=invalid_code&c=${LINK}`);
    mocks.completeVerification.mockResolvedValue({ ok: false, kind: "blocked" });
    expect((await post({ code: "123456", c: LINK })).headers.get("location")).toBe(`/deals?gate=1&blocked=1&c=${LINK}`);
    // A malformed token is dropped rather than echoed.
    expect((await post({ code: "123456", c: "<script>" })).headers.get("location")).toBe("/deals?gate=1&blocked=1");
  });

  it("notes the agent and alerts them when a returning buyer verifies through their link", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, firstUnlock: false, reverifiedActive: true, clientLinkAttached: 7 });
    await verify();
    expect(mocks.enqueueDealsFubJob).toHaveBeenCalledWith(31, "reverify", expect.objectContaining({ reason: "attached to an agent's client link" }));
    expect(mocks.notifyClientLinkAttached).toHaveBeenCalledWith(31, 7);
    // A first unlock already tells the agent through the unlock alert.
    mocks.notifyClientLinkAttached.mockClear();
    mocks.completeVerification.mockResolvedValue({ ...completed, clientLinkAttached: 7 });
    await verify();
    expect(mocks.notifyClientLinkAttached).not.toHaveBeenCalled();
  });

  it("sends a lapsed agent client to the expired page of their own link", async () => {
    mocks.staleSessionLeadId.mockResolvedValue(31);
    mocks.clientLinkTokenForLead.mockResolvedValue(LINK);
    const dead = await fetch(`${baseUrl}/deals/mine`, { redirect: "manual", headers: { cookie: `${DEALS_COOKIE.session}=stale` } });
    expect(dead.headers.get("location")).toBe(`/deals?expired=1&c=${LINK}`);
  });
});
