import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealBlocklist, dealClientLinks, dealCommunities, dealCommunityViews, dealHomes, dealKnownAgents, dealLeads, dealSettings, dealTeamAllowlist, dealTourRequests } from "../drizzle/schema";
import { DEALS_COOKIE, DEALS_PRIVATE_FIELDS } from "../shared/deals";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Agent client links end to end on the in-memory database: the link lifecycle,
 * the gate that skips the agent question for a vouched-for buyer, the
 * attribution written at verification, the full-detail list that only the team
 * and agent-sent buyers receive, the save mark, and the agent's own workspace.
 */
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  enqueueDealsRequestJobs: vi.fn(),
  runPendingDealsFubJobs: vi.fn(),
  requestTestMode: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsMap", () => ({ communityAreaMap: () => null, areaMapGeometry: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: vi.fn(async () => ({ ok: true, status: "sent", deliveryLog: "test" })) }));
vi.mock("./dealsFubJobs", () => ({
  enqueueDealsRequestJobs: (...args: unknown[]) => mocks.enqueueDealsRequestJobs(...args),
  runPendingDealsFubJobs: (...args: unknown[]) => mocks.runPendingDealsFubJobs(...args),
  requestTestMode: (...args: unknown[]) => mocks.requestTestMode(...args),
}));

import { agentDisplayPhone, agentForLead, agentForTeamId, agentRowsForLead, agentWorkspace, attachLeadToClientLink, attachLiveSessionToClientLink, clientLinkForPhone, clientLinkPicksForLead, clientLinkTextMessage, clientLinkTokenForLead, connectOfferFor, createClientLink, liveAgentForClient, parsePicks, presentClientLink, reassignTeamRowBeforeRemoval, removeClientLink, resolveClientLink, resolvePickCards, restoreClientLink, revokeClientLink, setClientLinkPicks } from "./dealsClientLinks";
import { dealEvents } from "../drizzle/schema";
import { resetFubAssignmentCache } from "./dealsFub";
import { AGENT_PAGE_SOURCE, agentForPageSlug, agentNameSlug, agentPageEntries, agentPageForLead, resetAgentPageCache } from "./dealsAgentPages";
import { classifyDealsAccess, revokeNonTeamMatchingDealLinks } from "./dealsEligibility";
import { createDealsHomeRequest, setDealsHomeSaved } from "./dealsRequests";
import { AGENT_CLIENT_SOURCE, HAS_AGENT_BLOCK_REASON, builderPageFor, catalogViewForSession, completeVerification, createPendingVerification, dealsCardHandle, exchangeAccessToken, gatedDealsCatalog, getActiveBlock, hashSecret, issueAccessToken, savedDealCards } from "./dealsService";

const HOUR = 3_600_000;
const AGENT_PHONE = "+12105550101";
const CLIENT_PHONE = "+12105550202";
const TEST_OTP = "424242";

let db: FakeDealsDb;
let teamId: number;
let communityId: number;
let homeId: number;
let planHomeId: number;

function lead(overrides: Partial<typeof dealLeads.$inferInsert> & { phoneE164: string }) {
  const id = db.seed(dealLeads, { status: "verified", expiresAt: new Date(Date.now() + HOUR), deviceHash: "d".repeat(64), consentText: "c", consentIp: "127.0.0.1", flags: "[]", sourceCode: "sl1", ...overrides });
  return db.rows(dealLeads).find((row) => row.id === id) as typeof dealLeads.$inferSelect;
}

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.requestTestMode.mockResolvedValue({ isTest: false, quiet: false });
  mocks.runPendingDealsFubJobs.mockResolvedValue({ sent: 0, failed: 0, skipped: 0, leased: 0 });
  teamId = db.seed(dealTeamAllowlist, { name: "Tiffany Agent", phoneE164: AGENT_PHONE, email: "tiffany@example.com", fubUserId: "77", fubIdentityKey: "fub:77:+12105550101", source: "fub", active: true });
  communityId = db.seed(dealCommunities, {
    builder: "Chesmar", privateName: "Fixture Lakes", sourceUrl: "https://www.chesmar.com/fixture-lakes/", privateAddress: "100 Fixture Lakes Blvd, San Antonio, TX 78263", salesPhone: "+12105550999",
    publicLabel: "Southeast San Antonio | Half-Acre Lots", areaLabel: "Southeast San Antonio", schoolDistrict: "Fixture ISD", amenities: JSON.stringify(["Lakes"]),
    reelCode: "sl1", scrubList: JSON.stringify({ community: ["Fixture Lakes"], street: ["Fixture Lakes Blvd"], plan: ["Brandon"] }), active: true, paused: false, manualMode: false,
  });
  homeId = db.seed(dealHomes, { communityId, sourceKey: "https://www.chesmar.com/fixture-lakes/brandon/1/", sourceUrl: "https://www.chesmar.com/fixture-lakes/brandon/1/", privateAddress: "118 Fixture Lakes Blvd", privatePlanName: "Brandon", kind: "quick_move_in", status: "available", origin: "official", price: 489_990, beds: "4", baths: "3" });
  planHomeId = db.seed(dealHomes, { communityId, sourceKey: "https://www.chesmar.com/fixture-lakes/evan/", sourceUrl: "https://www.chesmar.com/fixture-lakes/evan/", privatePlanName: "Evan", kind: "to_be_built", status: "available", origin: "official", price: 429_990 });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

const card = (id: number) => dealsCardHandle(`${db.rows(dealHomes).find((row) => row.id === id)!.sourceKey}`);

describe("client link lifecycle", () => {
  it("creates a link for a team session, resolves it, and refuses buyers and bad phones", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "  Maria   Lopez ", clientPhone: "(210) 555-0202", note: "Pre-approved" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.link.token).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect(created.path).toBe(`/deals?c=${created.link.token}`);
    expect(created.link.clientName).toBe("Maria Lopez");
    expect(created.link.clientPhoneE164).toBe(CLIENT_PHONE);
    expect(created.link.agentTeamId).toBe(teamId);
    // Default validity is 30 days.
    expect(created.link.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * HOUR);
    const resolved = await resolveClientLink(created.link.token);
    expect(resolved?.agent).toMatchObject({ teamId, name: "Tiffany Agent", email: "tiffany@example.com", fubUserId: "77" });
    expect(await resolveClientLink("short")).toBeNull();
    expect(await resolveClientLink("x".repeat(32))).toBeNull();

    expect(await createClientLink({ agentLead: lead({ phoneE164: CLIENT_PHONE }), clientName: "Someone" })).toEqual({ ok: false, kind: "not_team" });
    expect(await createClientLink({ agentLead: agent, clientName: "Maria", clientPhone: "12" })).toEqual({ ok: false, kind: "invalid_phone" });
    expect(await createClientLink({ agentLead: agent, clientName: "M" })).toEqual({ ok: false, kind: "invalid_name" });
    // A team session whose number is not on the allowlist (a test-team number) has no agent identity.
    expect(await agentForLead({ phoneE164: "+12105550999", email: null })).toBeNull();
  });

  it("stops resolving a revoked, expired or agent-less link, and only the owning agent can revoke", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const other = lead({ phoneE164: "+12105550303", status: "team" });
    db.seed(dealTeamAllowlist, { name: "Other Agent", phoneE164: "+12105550303", source: "manual", active: true });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    expect(await revokeClientLink(other, created.link.id)).toBe(false);
    expect(await resolveClientLink(created.link.token)).not.toBeNull();
    expect(await revokeClientLink(agent, created.link.id)).toBe(true);
    expect(await resolveClientLink(created.link.token)).toBeNull();

    const expired = await createClientLink({ agentLead: agent, clientName: "Old Link" });
    if (!expired.ok) throw new Error("link not created");
    db.rows(dealClientLinks).find((row) => row.id === expired.link.id)!.expiresAt = new Date(Date.now() - 1);
    expect(await resolveClientLink(expired.link.token)).toBeNull();

    const orphan = await createClientLink({ agentLead: agent, clientName: "Orphan" });
    if (!orphan.ok) throw new Error("link not created");
    db.rows(dealTeamAllowlist).find((row) => row.id === teamId)!.active = false;
    expect(await resolveClientLink(orphan.link.token)).toBeNull();
  });
});

describe("eligibility for an agent's client", () => {
  const base = { deviceHash: "e".repeat(64), isTest: false, testSkipChecks: false, brokerageDomains: ["kw.com"], fubRealtorTags: [], fubRealtorSources: [] };

  it("skips the has-agent answer, the has-agent device block and the realtor screening, but keeps an explicit admin block", async () => {
    db.seed(dealBlocklist, { deviceHash: base.deviceHash, searchPhone: CLIENT_PHONE, reason: HAS_AGENT_BLOCK_REASON, expiresAt: new Date(Date.now() + HOUR) });
    db.seed(dealKnownAgents, { phoneE164: CLIENT_PHONE, source: "csv", active: true });
    const vouched = await classifyDealsAccess({ ...base, phone: CLIENT_PHONE, email: "maria@kw.com", clientLink: true });
    expect(vouched).toEqual({ allowed: true, team: false, flags: ["agent_client"] });
    const ordinary = await classifyDealsAccess({ ...base, phone: CLIENT_PHONE, email: "maria@kw.com", choice: "buyer" });
    expect(ordinary.allowed).toBe(false);
    db.seed(dealBlocklist, { phoneE164: CLIENT_PHONE, reason: "Abusive messages" });
    const blocked = await classifyDealsAccess({ ...base, phone: CLIENT_PHONE, clientLink: true });
    expect(blocked).toMatchObject({ allowed: false, blockedBy: "blocklist", matchOn: "phone" });
    // Team members stay team even through a client link.
    expect(await classifyDealsAccess({ ...base, phone: AGENT_PHONE, clientLink: true })).toEqual({ allowed: true, team: true, flags: ["team"] });
  });
});

type CookieCall = { name: string; value?: string; options?: { maxAge?: number } };
function responseRecorder() {
  const cookies: CookieCall[] = [];
  const response = {
    cookie: (name: string, value: string, options?: { maxAge?: number }) => { cookies.push({ name, value, options }); return response; },
    clearCookie: (name: string) => { cookies.push({ name }); return response; },
    setHeader: () => response,
  } as unknown as Response;
  return { response, cookies, cookie: (name: string) => [...cookies].reverse().find((entry) => entry.name === name && entry.value)?.value };
}
function request(cookies: Record<string, string>): Request {
  return { headers: { cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ") }, ip: "203.0.113.9", socket: { remoteAddress: "203.0.113.9" } } as unknown as Request;
}

/** Starts and completes a test-number verification through `token` from a fresh browser. */
async function verifyThrough(token: string | null, rawPhone: string, device = `device-${Math.random()}`) {
  const start = responseRecorder();
  const pending = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), res: start.response, rawPhone, choice: "buyer", source: "sl1", clientLinkToken: token });
  if (!pending.ok) return { pending, done: null };
  const finish = responseRecorder();
  const done = await completeVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.pending]: start.cookie(DEALS_COOKIE.pending)! }), res: finish.response, code: TEST_OTP });
  return { pending, done };
}
const OTHER_PHONE = "+12105550606";
function testSettings(extra: Record<string, unknown> = {}) {
  db.seed(dealSettings, { key: "builder_deals", value: JSON.stringify({ testNumbers: [CLIENT_PHONE, OTHER_PHONE, "+12105550404"], testNumbersSkipChecks: true, skipTwilioForTestNumbers: true, clientLinkExpiryHours: 72, expiryHours: 24, ...extra }) });
}

describe("verification through a client link", () => {
  it("attributes the verified buyer to the agent, gives them the longer access window, binds the link and opens the full list", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    const { pending, done } = await verifyThrough(created.link.token, "(210) 555-0202");
    expect(pending).toMatchObject({ ok: true, sourceCode: AGENT_CLIENT_SOURCE, clientLink: true });
    expect(done?.ok).toBe(true);
    if (!done?.ok) return;
    const buyer = db.rows(dealLeads).find((row) => row.id === done.leadId) as typeof dealLeads.$inferSelect;
    expect(buyer).toMatchObject({ phoneE164: CLIENT_PHONE, status: "verified", sourceCode: AGENT_CLIENT_SOURCE, agentTeamId: teamId, clientLinkId: created.link.id });
    expect(buyer.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * HOUR);
    const link = db.rows(dealClientLinks).find((row) => row.id === created.link.id)!;
    expect(link).toMatchObject({ leadId: done.leadId });
    expect(link.verifiedAt).toBeInstanceOf(Date);
    expect(done.clientLinkAttached).toBeNull();
    expect((await catalogViewForSession(buyer)).view).toEqual({ view: "full", builderPages: false });
  });

  it("refuses a forwarded link for any other number, with the agent's name and no realtor question", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    await verifyThrough(created.link.token, CLIENT_PHONE);
    const stranger = await verifyThrough(created.link.token, OTHER_PHONE);
    expect(stranger.pending).toEqual({ ok: false, kind: "link_other_phone", agentName: "Tiffany Agent" });
    expect(db.rows(dealLeads).some((row) => row.phoneE164 === OTHER_PHONE)).toBe(false);
    // The bound client can come back through the same link.
    expect((await verifyThrough(created.link.token, CLIENT_PHONE)).done?.ok).toBe(true);
    // A link made for a typed number only ever opens for that number, even before anyone used it.
    const typed = await createClientLink({ agentLead: agent, clientName: "Sam Reyes", clientPhone: "(210) 555-0404" });
    if (!typed.ok) throw new Error("link not created");
    expect((await verifyThrough(typed.link.token, OTHER_PHONE)).pending).toMatchObject({ ok: false, kind: "link_other_phone" });
    expect((await verifyThrough(typed.link.token, "+12105550404")).done?.ok).toBe(true);
    // The agent can still preview their own link: team members pass.
    expect(await clientLinkForPhone(created.link.token, AGENT_PHONE)).toEqual({ ok: false, kind: "other_phone", agentName: "Tiffany Agent" });
  });

  it("turns a turned-off link back on for its own agent only, giving the client the full list again (Oct 29)", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const other = lead({ phoneE164: "+12105550303", status: "team" });
    db.seed(dealTeamAllowlist, { name: "Other Agent", phoneE164: "+12105550303", source: "manual", active: true });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    const { done } = await verifyThrough(created.link.token, CLIENT_PHONE);
    if (!done?.ok) throw new Error("not verified");
    const buyer = () => db.rows(dealLeads).find((row) => row.id === done.leadId) as typeof dealLeads.$inferSelect;
    await revokeClientLink(agent, created.link.id);
    expect((await catalogViewForSession(buyer())).view).toEqual({ view: "gated" });
    expect(await restoreClientLink(other, created.link.id)).toBe("not_found");
    expect(await restoreClientLink(agent, created.link.id)).toBe("ok");
    expect(db.rows(dealClientLinks).find((row) => row.id === created.link.id)!.revokedAt).toBeNull();
    expect(await resolveClientLink(created.link.token)).not.toBeNull();
    expect((await catalogViewForSession(buyer())).view).toEqual({ view: "full", builderPages: false });
    // Already on: nothing changes.
    expect(await restoreClientLink(agent, created.link.id)).toBe("ok");

    // An unused link turned off after its date gets a fresh window.
    const old = await createClientLink({ agentLead: agent, clientName: "Old Link" });
    if (!old.ok) throw new Error("link not created");
    await revokeClientLink(agent, old.link.id);
    db.rows(dealClientLinks).find((row) => row.id === old.link.id)!.expiresAt = new Date(Date.now() - HOUR);
    expect(await restoreClientLink(agent, old.link.id)).toBe("ok");
    expect(db.rows(dealClientLinks).find((row) => row.id === old.link.id)!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 24 * HOUR);
    expect(await resolveClientLink(old.link.token)).not.toBeNull();
  });

  it("removes a dead link from the agent's list, never a live one, and lets go of a client only while it is still theirs (Oct 29)", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const other = lead({ phoneE164: "+12105550303", status: "team" });
    db.seed(dealTeamAllowlist, { name: "Other Agent", phoneE164: "+12105550303", source: "manual", active: true });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    const { done } = await verifyThrough(created.link.token, CLIENT_PHONE);
    if (!done?.ok) throw new Error("not verified");
    const buyer = () => db.rows(dealLeads).find((row) => row.id === done.leadId) as typeof dealLeads.$inferSelect;
    expect(await removeClientLink(agent, created.link.id)).toBe("live");
    expect(await removeClientLink(other, created.link.id)).toBe("not_found");
    await revokeClientLink(agent, created.link.id);
    expect(await removeClientLink(agent, created.link.id)).toBe("ok");
    expect(db.rows(dealClientLinks).some((row) => row.id === created.link.id)).toBe(false);
    expect(buyer()).toMatchObject({ clientLinkId: null, agentTeamId: null, status: "verified" });
    expect((await catalogViewForSession(buyer())).view).toEqual({ view: "gated" });
    expect((await agentWorkspace(agent))!.clients.map((client) => client.clientName)).not.toContain("Maria Lopez");

    // An unused link past its date is dead too, and can go without being turned off.
    const lapsed = await createClientLink({ agentLead: agent, clientName: "Old Link" });
    if (!lapsed.ok) throw new Error("link not created");
    db.rows(dealClientLinks).find((row) => row.id === lapsed.link.id)!.expiresAt = new Date(Date.now() - HOUR);
    expect(await removeClientLink(agent, lapsed.link.id)).toBe("ok");

    // A client who moved to another agent's link keeps that link and agent when the old one is removed.
    const first = await createClientLink({ agentLead: agent, clientName: "Sam Reyes" });
    const second = await createClientLink({ agentLead: other, clientName: "Sam Reyes" });
    if (!first.ok || !second.ok) throw new Error("link not created");
    const sam = await verifyThrough(first.link.token, OTHER_PHONE);
    if (!sam.done?.ok) throw new Error("not verified");
    const samId = sam.done.leadId;
    const moved = db.rows(dealLeads).find((row) => row.id === samId)!;
    moved.clientLinkId = second.link.id;
    moved.agentTeamId = second.link.agentTeamId;
    expect(await restoreClientLink(agent, first.link.id)).toBe("moved_away");
    expect(await removeClientLink(agent, first.link.id)).toBe("ok");
    expect(db.rows(dealLeads).find((row) => row.id === samId)).toMatchObject({ clientLinkId: second.link.id, agentTeamId: second.link.agentTeamId });
  });

  it("tells a visitor on a turned-off link to ask the agent, instead of falling to the reel gate", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    await revokeClientLink(agent, created.link.id);
    expect((await verifyThrough(created.link.token, CLIENT_PHONE)).pending).toEqual({ ok: false, kind: "link_dead", agentName: "Tiffany Agent" });
    expect(await presentClientLink(created.link.token)).toEqual({ state: "dead", agentName: "Tiffany Agent" });
    expect(await presentClientLink("Z".repeat(32))).toEqual({ state: "dead", agentName: null });
    expect(await presentClientLink("short")).toBeNull();
  });

  it("re-checks the link when the code is approved: turned off during the code step attaches nothing", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    const device = "dev-race";
    const start = responseRecorder();
    const pending = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), res: start.response, rawPhone: CLIENT_PHONE, choice: "buyer", clientLinkToken: created.link.token });
    expect(pending.ok).toBe(true);
    await revokeClientLink(agent, created.link.id);
    const done = await completeVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.pending]: start.cookie(DEALS_COOKIE.pending)! }), res: responseRecorder().response, code: TEST_OTP });
    expect(done.ok).toBe(true);
    const buyer = db.rows(dealLeads).find((row) => row.phoneE164 === CLIENT_PHONE)!;
    expect(buyer.agentTeamId).toBeNull();
    expect(buyer.expiresAt.getTime() - Date.now()).toBeLessThan(25 * HOUR);
  });

  it("reports a returning buyer newly attached to a link so the agent is told", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    await verifyThrough(null, CLIENT_PHONE);
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez", clientPhone: CLIENT_PHONE });
    if (!created.ok) throw new Error("link not created");
    const { done } = await verifyThrough(created.link.token, CLIENT_PHONE);
    expect(done).toMatchObject({ ok: true, firstUnlock: false, clientLinkAttached: created.link.id });
    // The same link again is not news.
    expect((await verifyThrough(created.link.token, CLIENT_PHONE)).done).toMatchObject({ ok: true, clientLinkAttached: null });
  });

  it("keeps the expired page on the agent's link for a client whose list lapsed", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    const client = lead({ phoneE164: CLIENT_PHONE, agentTeamId: teamId, clientLinkId: created.link.id, expiresAt: new Date(Date.now() - HOUR) });
    db.rows(dealClientLinks)[0].leadId = client.id;
    expect(await clientLinkTokenForLead(client.id)).toBe(created.link.token);
    expect(await clientLinkTokenForLead(lead({ phoneE164: OTHER_PHONE }).id)).toBeNull();
  });
});

describe("the full list versus the scrubbed list", () => {
  it("hides every private value from a reel buyer and shows them to the team (with builder pages and sales line) and to a live agent client (without)", async () => {
    const buyer = lead({ phoneE164: CLIENT_PHONE });
    const gated = JSON.stringify(await gatedDealsCatalog(buyer.id, (await catalogViewForSession(buyer)).view));
    // Values, not just key names: none of the private strings may travel under any key.
    for (const value of ["Fixture Lakes", "Chesmar", "chesmar.com", "Fixture Lakes Blvd", "Brandon", "555-0999", "details"]) expect(gated).not.toContain(value);
    for (const field of DEALS_PRIVATE_FIELDS) expect(gated).not.toContain(`"${field}"`);

    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Client" });
    if (!created.ok) throw new Error("link not created");
    const client = lead({ phoneE164: "+12105550404", agentTeamId: teamId, clientLinkId: created.link.id, sourceCode: AGENT_CLIENT_SOURCE });
    db.rows(dealClientLinks)[0].leadId = client.id;
    const full = await gatedDealsCatalog(client.id, (await catalogViewForSession(client)).view) as Array<{ details: Record<string, unknown>; amenities: string[]; homes: Array<{ details: Record<string, unknown> }> }>;
    // The builder's sales line stays with the team: a client calling the builder directly can cost the agent the registration.
    expect(full[0].details).toEqual({ builderName: "Chesmar", communityName: "Fixture Lakes", address: "100 Fixture Lakes Blvd, San Antonio, TX 78263", salesLine: null, builderPage: null });
    expect(full[0].homes.map((home) => home.details)).toEqual([{ address: "118 Fixture Lakes Blvd", planName: "Brandon", builderPage: null }]);
    expect(JSON.stringify(full)).not.toContain("chesmar.com");
    expect(JSON.stringify(full)).not.toContain("555-0999");

    const teamList = await gatedDealsCatalog(agent.id, (await catalogViewForSession(agent)).view) as typeof full;
    expect(teamList[0].details).toMatchObject({ salesLine: "+12105550999", builderPage: "https://www.chesmar.com/fixture-lakes/" });
    expect(teamList[0].homes[0].details.builderPage).toBe("https://www.chesmar.com/fixture-lakes/brandon/1/");
    // A home keyed under a path the builder's site does not serve (Starlight's street keys) links the team to the community page.
    expect(builderPageFor("https://www.starlighthomes.com/san-antonio/fixture-trails/available-homes/1412-fixture-street")).toBe("https://www.starlighthomes.com/san-antonio/fixture-trails");
    expect(builderPageFor("https://www.chesmar.com/fixture-lakes/brandon/1/")).toBe("https://www.chesmar.com/fixture-lakes/brandon/1/");
    // Davidson's home pages live under "/available-homes/" for real: the link stays.
    expect(builderPageFor("https://www.davidsonhomes.com/states/texas/san-antonio-market-area/san-antonio/fixture-ranch/available-homes/9513-fixture-hollow/")).toBe("https://www.davidsonhomes.com/states/texas/san-antonio-market-area/san-antonio/fixture-ranch/available-homes/9513-fixture-hollow/");
  });

  it("drops a client back to the scrubbed list when the link is turned off, the agent leaves, or the link belongs to someone else", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Client" });
    if (!created.ok) throw new Error("link not created");
    const client = lead({ phoneE164: CLIENT_PHONE, agentTeamId: teamId, clientLinkId: created.link.id });
    const linkRow = db.rows(dealClientLinks)[0];
    // Not bound to this lead: no full list.
    expect(await liveAgentForClient(client)).toBeNull();
    linkRow.leadId = client.id;
    expect((await liveAgentForClient(client))?.teamId).toBe(teamId);
    // An unused-link expiry does not matter once the client is bound.
    linkRow.expiresAt = new Date(Date.now() - HOUR);
    expect((await catalogViewForSession(client)).view).toEqual({ view: "full", builderPages: false });
    // The agent leaves the team.
    db.rows(dealTeamAllowlist).find((row) => row.id === teamId)!.active = false;
    expect((await catalogViewForSession(client)).view).toEqual({ view: "gated" });
    db.rows(dealTeamAllowlist).find((row) => row.id === teamId)!.active = true;
    await revokeClientLink(agent, created.link.id);
    expect((await catalogViewForSession(client)).view).toEqual({ view: "gated" });
  });

  it("keeps an agent's links alive when FUB changes their phone (old mirror row inactive, new row active)", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Client" });
    if (!created.ok) throw new Error("link not created");
    db.rows(dealTeamAllowlist).find((row) => row.id === teamId)!.active = false;
    db.seed(dealTeamAllowlist, { name: "Tiffany Agent", phoneE164: "+12105550707", email: "tiffany@example.com", fubUserId: "77", fubIdentityKey: "fub:77:+12105550707", source: "fub", active: true });
    expect((await resolveClientLink(created.link.token))?.agent).toMatchObject({ teamId, active: true, fubUserId: "77" });
    // From the new phone, the agent still sees and can turn off the link made under the old one.
    const newSession = lead({ phoneE164: "+12105550707", status: "team" });
    expect((await agentWorkspace(newSession))?.clients.map((client) => client.clientName)).toEqual(["Client"]);
    expect(await revokeClientLink(newSession, created.link.id)).toBe(true);
  });
});

describe("saving a home", () => {
  it("notifies once per home, tracks unsave and restore, and never swallows a same-day tour request", async () => {
    const client = lead({ phoneE164: CLIENT_PHONE, agentTeamId: teamId, sourceCode: AGENT_CLIENT_SOURCE });
    const input = { leadId: client.id, card: card(homeId), sourceCode: AGENT_CLIENT_SOURCE, deviceHash: "d".repeat(64) };
    expect(await setDealsHomeSaved({ ...input, saved: true })).toEqual({ ok: true, saved: true, notified: true });
    expect(mocks.enqueueDealsRequestJobs).toHaveBeenCalledTimes(1);
    expect(await savedDealCards(client.id)).toEqual([card(homeId)]);
    expect(await setDealsHomeSaved({ ...input, saved: true })).toEqual({ ok: true, saved: true, notified: false });
    expect(await setDealsHomeSaved({ ...input, saved: false })).toEqual({ ok: true, saved: false, notified: false });
    expect(await savedDealCards(client.id)).toEqual([]);
    expect(db.rows(dealTourRequests)[0].removedAt).toBeInstanceOf(Date);
    expect(await setDealsHomeSaved({ ...input, saved: true })).toEqual({ ok: true, saved: true, notified: false });
    expect(db.rows(dealTourRequests)[0].removedAt).toBeNull();
    expect(mocks.enqueueDealsRequestJobs).toHaveBeenCalledTimes(1);
    expect(db.rows(dealTourRequests)).toHaveLength(1);

    const tour = await createDealsHomeRequest({ leadId: client.id, card: card(homeId), requestType: "tour", preferredAt: new Date(Date.now() + 2 * HOUR), sourceCode: AGENT_CLIENT_SOURCE, deviceHash: "d".repeat(64) });
    expect(tour).toMatchObject({ ok: true, duplicate: false });
    expect(db.rows(dealTourRequests).map((row) => row.requestType)).toEqual(["save", "tour"]);
    expect(await setDealsHomeSaved({ ...input, card: card(planHomeId), saved: true })).toEqual({ ok: true, saved: true, notified: true });
    expect(mocks.enqueueDealsRequestJobs).toHaveBeenCalledTimes(3);
    expect(mocks.enqueueDealsRequestJobs).toHaveBeenNthCalledWith(1, client.id, expect.any(Number), expect.any(String), "save");
    // A team member's saves are bookmarks: no task, note or email.
    const team = lead({ phoneE164: AGENT_PHONE, status: "team" });
    expect(await setDealsHomeSaved({ ...input, leadId: team.id, saved: true })).toEqual({ ok: true, saved: true, notified: false });
    expect(mocks.enqueueDealsRequestJobs).toHaveBeenCalledTimes(3);
  });
});

describe("the agent's workspace", () => {
  it("adds the buyers Follow Up Boss assigns to the agent now, from any link or reel, with what they saved (Oct 28, 2026)", async () => {
    resetFubAssignmentCache();
    vi.stubEnv("FUB_API_KEY", "test-key");
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const otherTeam = db.seed(dealTeamAllowlist, { name: "Other Agent", phoneE164: "+12105550303", fubUserId: "12", source: "manual", active: true });
    const reel = lead({ phoneE164: "+12105550404", name: "Reel Buyer", fubPersonId: "501" });
    const viaOther = lead({ phoneE164: "+12105550505", name: "Linked Buyer", fubPersonId: "502", agentTeamId: otherTeam });
    const noFub = lead({ phoneE164: "+12105550606", name: "Not In FUB" });
    for (const buyer of [reel, viaOther, noFub]) await setDealsHomeSaved({ leadId: buyer.id, card: card(homeId), saved: true, sourceCode: "sl1", deviceHash: "d".repeat(64) });
    await createDealsHomeRequest({ leadId: viaOther.id, card: card(planHomeId), requestType: "tour", preferredAt: new Date(Date.now() + 2 * HOUR), sourceCode: "sl1", deviceHash: "d".repeat(64) });
    let assignments: Record<string, number> = { "501": 77, "502": 12 };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname !== "/v1/people") return new Response("{}", { status: 404 });
      const asked = url.searchParams.get("id")!.split(",");
      return new Response(JSON.stringify({ people: asked.map((id) => ({ id: Number(id), assignedUserId: assignments[id] ?? 0 })) }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
      const workspace = await agentWorkspace(agent);
      expect(workspace?.clients).toEqual([]);
      expect(workspace?.assigned).toEqual([expect.objectContaining({ leadId: reel.id, name: "Reel Buyer", phone: "(210) 555-0404", phoneDigits: "2105550404", fubUrl: "https://app.followupboss.com/2/people/view/501", viaAgent: null, saves: [expect.objectContaining({ description: "118 Fixture Lakes Blvd (Brandon)", price: 489_990, communityLabel: "Fixture Lakes (Southeast San Antonio | Half-Acre Lots)" })], requests: [] })]);
      expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get("id")!.split(",").sort()).toEqual(["501", "502"]);
      // Peter moves the other agent's buyer to Tiffany in FUB: their saves and tour follow; the reel buyer moves away.
      resetFubAssignmentCache();
      assignments = { "501": 12, "502": 77 };
      const moved = await agentWorkspace(agent);
      expect(moved?.assigned.map((client) => client.leadId)).toEqual([viaOther.id]);
      expect(moved?.assigned[0]).toMatchObject({ viaAgent: "Other Agent", saves: [expect.objectContaining({ price: 489_990 })], requests: [expect.objectContaining({ kind: "tour" })] });
      // An unsaved home leaves the list; FUB down leaves the list empty, never an error.
      await setDealsHomeSaved({ leadId: viaOther.id, card: card(homeId), saved: false, sourceCode: "sl1", deviceHash: "d".repeat(64) });
      expect((await agentWorkspace(agent))?.assigned[0]?.saves).toEqual([]);
      resetFubAssignmentCache();
      fetchMock.mockRejectedValue(new Error("FUB down"));
      expect((await agentWorkspace(agent))?.assigned).toEqual([]);
    } finally {
      fetchMock.mockRestore();
      resetFubAssignmentCache();
    }
  });


  it("lists only the agent's own clients with their verification, saves and requests", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez", clientPhone: CLIENT_PHONE, note: "Wants 4 beds" });
    if (!created.ok) throw new Error("link not created");
    const otherTeam = db.seed(dealTeamAllowlist, { name: "Other Agent", phoneE164: "+12105550303", source: "manual", active: true });
    db.seed(dealClientLinks, { token: "o".repeat(32), agentTeamId: otherTeam, agentLeadId: 999, clientName: "Not Mine", expiresAt: new Date(Date.now() + HOUR) });
    const empty = await agentWorkspace(agent);
    expect(empty?.clients.map((client) => client.clientName)).toEqual(["Maria Lopez"]);
    expect(empty?.clients[0]).toMatchObject({ clientPhone: "(210) 555-0202", clientPhoneDigits: "2105550202", note: "Wants 4 beds", verifiedAt: null, accessExpiresAt: null, saves: [], requests: [] });

    const client = lead({ phoneE164: CLIENT_PHONE, agentTeamId: teamId, clientLinkId: created.link.id, sourceCode: AGENT_CLIENT_SOURCE, expiresAt: new Date(Date.now() + 48 * HOUR) });
    db.rows(dealClientLinks).find((row) => row.id === created.link.id)!.leadId = client.id;
    db.rows(dealClientLinks).find((row) => row.id === created.link.id)!.verifiedAt = new Date();
    db.seed(dealCommunityViews, { leadId: client.id, communityId });
    await setDealsHomeSaved({ leadId: client.id, card: card(homeId), saved: true, sourceCode: AGENT_CLIENT_SOURCE, deviceHash: "d".repeat(64) });
    await createDealsHomeRequest({ leadId: client.id, card: card(planHomeId), requestType: "ask", preferredAt: new Date(Date.now() + 2 * HOUR), sourceCode: AGENT_CLIENT_SOURCE, deviceHash: "d".repeat(64) });

    const workspace = await agentWorkspace(agent);
    expect(workspace?.agent).toMatchObject({ teamId, name: "Tiffany Agent", fubUserId: "77" });
    // Once the client is attached to another link, this agent no longer sees their activity.
    db.rows(dealLeads).find((row) => row.id === client.id)!.clientLinkId = 999;
    expect((await agentWorkspace(agent))?.clients[0]).toMatchObject({ movedAway: true, saves: [], requests: [], accessExpiresAt: null });
    db.rows(dealLeads).find((row) => row.id === client.id)!.clientLinkId = created.link.id;
    const [maria] = workspace!.clients;
    expect(maria.verifiedAt).toBeTruthy();
    expect(maria.accessExpiresAt).toBeTruthy();
    expect(maria.lastViewedAt).toBeTruthy();
    expect(maria.saves).toEqual([expect.objectContaining({ card: card(homeId), description: "118 Fixture Lakes Blvd (Brandon)", price: 489_990, communityLabel: "Fixture Lakes (Southeast San Antonio | Half-Acre Lots)" })]);
    expect(maria.requests).toEqual([expect.objectContaining({ kind: "ask", description: "(Evan)" })]);
  });
});

describe("attaching a live session to a client link", () => {
  it("attributes an already-verified buyer without a code, extends their window, records the link and the event", async () => {
    db.seed(dealSettings, { key: "builder_deals", value: JSON.stringify({ clientLinkExpiryHours: 72 }) });
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    const buyer = lead({ phoneE164: CLIENT_PHONE, expiresAt: new Date(Date.now() + 2 * HOUR) });
    const result = await attachLiveSessionToClientLink({ lead: buyer, token: created.link.token, expiryHours: 72 });
    expect(result).toMatchObject({ ok: true, attached: true, linkId: created.link.id, agent: expect.objectContaining({ teamId }) });
    const stored = db.rows(dealLeads).find((row) => row.id === buyer.id)!;
    expect(stored).toMatchObject({ agentTeamId: teamId, clientLinkId: created.link.id });
    expect((stored.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(71 * HOUR);
    expect(db.rows(dealClientLinks).find((row) => row.id === created.link.id)).toMatchObject({ leadId: buyer.id });
    expect(db.rows(dealEvents).some((row) => row.kind === "client_link_attached" && row.leadId === buyer.id)).toBe(true);
    // Idempotent: the same link again changes nothing.
    expect(await attachLiveSessionToClientLink({ lead: { ...buyer, ...stored } as typeof buyer, token: created.link.token, expiryHours: 72 })).toEqual({ ok: true, attached: false, reason: "already_attached" });
    // A longer existing window is kept.
    const longBuyer = lead({ phoneE164: "+12105550505", expiresAt: new Date(Date.now() + 200 * HOUR) });
    await attachLiveSessionToClientLink({ lead: longBuyer, token: created.link.token, expiryHours: 72 });
    expect((db.rows(dealLeads).find((row) => row.id === longBuyer.id)!.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(199 * HOUR);
  });

  it("never attaches a team session and refuses a dead link", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    expect(await attachLiveSessionToClientLink({ lead: agent, token: created.link.token, expiryHours: 72 })).toEqual({ ok: true, attached: false, reason: "team" });
    await revokeClientLink(agent, created.link.id);
    expect(await attachLiveSessionToClientLink({ lead: lead({ phoneE164: CLIENT_PHONE }), token: created.link.token, expiryHours: 72 })).toEqual({ ok: false, kind: "invalid_link" });
  });
});

describe("agent identity details", () => {
  it("formats the agent's number for the client and reports an inactive team row", async () => {
    expect(agentDisplayPhone({ phoneE164: AGENT_PHONE })).toBe("(210) 555-0101");
    expect(agentDisplayPhone({ phoneE164: null })).toBeNull();
    expect((await agentForTeamId(teamId))?.active).toBe(true);
    db.rows(dealTeamAllowlist).find((row) => row.id === teamId)!.active = false;
    const gone = await agentForTeamId(teamId);
    expect(gone).toMatchObject({ name: "Tiffany Agent", active: false });
  });
});

describe("round 3: what a returning client, the nightly screening and team changes do", () => {
  it("keeps the agent's view of a client's activity when the client renews access through the same link", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    const { done } = await verifyThrough(created.link.token, CLIENT_PHONE);
    if (!done?.ok) throw new Error("not verified");
    const link = db.rows(dealClientLinks).find((row) => row.id === created.link.id)!;
    const connectedAt = new Date(Date.now() - 3 * HOUR);
    link.verifiedAt = connectedAt;
    await setDealsHomeSaved({ leadId: done.leadId, card: card(homeId), saved: true, sourceCode: AGENT_CLIENT_SOURCE, deviceHash: "d".repeat(64) });
    db.rows(dealTourRequests)[0].createdAt = new Date(Date.now() - 2 * HOUR);
    // Access lapses; the client comes back through the same link on another device.
    db.rows(dealLeads).find((row) => row.id === done.leadId)!.expiresAt = new Date(Date.now() - HOUR);
    expect((await verifyThrough(created.link.token, CLIENT_PHONE)).done?.ok).toBe(true);
    expect(link.verifiedAt).toEqual(connectedAt);
    expect((await agentWorkspace(agent))?.clients[0]?.saves).toHaveLength(1);
    // A client who moved to another link and came back connects again from now.
    await attachLeadToClientLink(db, created.link.id, done.leadId, 999);
    expect(link.verifiedAt!.getTime()).toBeGreaterThan(connectedAt.getTime());
  });

  it("leaves a vouched-for client alone when the nightly realtor import matches them, until the link is turned off", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    const client = lead({ phoneE164: CLIENT_PHONE, agentTeamId: teamId, clientLinkId: created.link.id });
    db.rows(dealClientLinks)[0].leadId = client.id;
    const reel = lead({ phoneE164: OTHER_PHONE });
    expect(await revokeNonTeamMatchingDealLinks(db, { phoneE164: CLIENT_PHONE })).toBe(0);
    expect(db.rows(dealLeads).find((row) => row.id === client.id)?.status).toBe("verified");
    expect(await revokeNonTeamMatchingDealLinks(db, { phoneE164: OTHER_PHONE })).toBe(1);
    expect(db.rows(dealLeads).find((row) => row.id === reel.id)?.status).toBe("blocked");
    await revokeClientLink(agent, created.link.id);
    expect(await revokeNonTeamMatchingDealLinks(db, { phoneE164: CLIENT_PHONE })).toBe(1);
  });

  it("does not let a pile of has-agent blocks hide an admin block from an agent's client", async () => {
    const device = "f".repeat(64);
    for (let index = 0; index < 25; index++) db.seed(dealBlocklist, { deviceHash: device, reason: index % 2 ? HAS_AGENT_BLOCK_REASON : "known_agent device cooldown", expiresAt: new Date(Date.now() + HOUR) });
    expect(await getActiveBlock({ deviceHash: device, ignoreHasAgent: true })).toBeUndefined();
    db.seed(dealBlocklist, { deviceHash: device, reason: "Admin block" });
    expect(await getActiveBlock({ deviceHash: device, ignoreHasAgent: true })).toMatchObject({ reason: "Admin block" });
  });

  it("lets the block that decides the screen win when one browser has several: agent, then turned off, then the rest", async () => {
    const device = "e".repeat(64);
    db.seed(dealBlocklist, { deviceHash: device, reason: HAS_AGENT_BLOCK_REASON, expiresAt: new Date(Date.now() + HOUR) });
    db.seed(dealBlocklist, { deviceHash: device, reason: "Turned off by admin" });
    expect(await getActiveBlock({ deviceHash: device })).toMatchObject({ reason: "Turned off by admin" });
    db.seed(dealBlocklist, { deviceHash: device, reason: "Said they are a realtor" });
    expect(await getActiveBlock({ deviceHash: device })).toMatchObject({ reason: "Said they are a realtor" });
  });

  it("asks a buyer with a live list to connect only to a new link that is theirs", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const open = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    const typed = await createClientLink({ agentLead: agent, clientName: "Sam Reyes", clientPhone: OTHER_PHONE });
    if (!open.ok || !typed.ok) throw new Error("links not created");
    const buyer = lead({ phoneE164: CLIENT_PHONE });
    expect(await connectOfferFor(buyer, open.link.token)).toBe("ask");
    expect(await connectOfferFor(buyer, typed.link.token)).toBe("not_theirs");
    const attached = await attachLiveSessionToClientLink({ lead: buyer, token: open.link.token, expiryHours: 72 });
    expect(attached).toMatchObject({ ok: true, attached: true });
    const after = db.rows(dealLeads).find((row) => row.id === buyer.id) as typeof dealLeads.$inferSelect;
    expect(await connectOfferFor(after, open.link.token)).toBe("connected");
    await revokeClientLink(agent, open.link.id);
    expect(await connectOfferFor(after, open.link.token)).toBeNull();
  });

  it("shows clients the agent's current number after FUB changes it", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Client" });
    if (!created.ok) throw new Error("link not created");
    db.rows(dealTeamAllowlist).find((row) => row.id === teamId)!.active = false;
    db.seed(dealTeamAllowlist, { name: "Tiffany Agent", phoneE164: "+12105550707", email: "tiffany@example.com", fubUserId: "77", fubIdentityKey: "fub:77:+12105550707", source: "fub", active: true });
    expect(await agentForTeamId(teamId)).toMatchObject({ teamId, active: true, phoneE164: "+12105550707", fubUserId: "77" });
  });

  it("carries a hand-added agent's links over to their FUB user, and never merges two agents over a shared office line", async () => {
    const NEW_AGENT = "+12105550808";
    const manualId = db.seed(dealTeamAllowlist, { name: "New Agent", phoneE164: NEW_AGENT, source: "manual", active: true });
    const session = lead({ phoneE164: NEW_AGENT, status: "team" });
    const created = await createClientLink({ agentLead: session, clientName: "Early Client" });
    if (!created.ok) throw new Error("link not created");
    expect(created.link.agentTeamId).toBe(manualId);
    expect((await agentForTeamId(manualId))?.fubUserId).toBeNull();
    // The FUB mirror adds the same person under their new FUB user: tasks now go to them.
    const fubRow = db.seed(dealTeamAllowlist, { name: "New Agent", phoneE164: NEW_AGENT, email: "new@example.com", fubUserId: "88", fubIdentityKey: "fub:88:+12105550808", source: "fub", active: true });
    expect(await agentForTeamId(manualId)).toMatchObject({ fubUserId: "88", email: "new@example.com", active: true });
    // Admin removes the now redundant hand-added row: the link and its client move to the FUB row.
    const client = lead({ phoneE164: CLIENT_PHONE, agentTeamId: manualId, clientLinkId: created.link.id });
    expect(await reassignTeamRowBeforeRemoval(manualId)).toBe(fubRow);
    db.rows(dealTeamAllowlist).splice(db.rows(dealTeamAllowlist).findIndex((row) => row.id === manualId), 1);
    expect(db.rows(dealClientLinks).find((row) => row.id === created.link.id)?.agentTeamId).toBe(fubRow);
    expect(db.rows(dealLeads).find((row) => row.id === client.id)?.agentTeamId).toBe(fubRow);
    expect((await resolveClientLink(created.link.token))?.agent).toMatchObject({ fubUserId: "88", active: true });
    expect((await agentWorkspace(session))?.clients.map((row) => row.clientName)).toEqual(["Early Client"]);
    // A shared office number on two agents' FUB profiles does not let one see the other's links.
    const OFFICE = "+12105550900";
    db.seed(dealTeamAllowlist, { name: "Tiffany Agent", phoneE164: OFFICE, fubUserId: "77", fubIdentityKey: "fub:77:office", source: "fub", active: true });
    db.seed(dealTeamAllowlist, { name: "New Agent", phoneE164: OFFICE, fubUserId: "88", fubIdentityKey: "fub:88:office", source: "fub", active: true });
    const tiffany = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const hers = await createClientLink({ agentLead: tiffany, clientName: "Tiffany's Client" });
    if (!hers.ok) throw new Error("link not created");
    expect((await agentWorkspace(session))?.clients.map((row) => row.clientName)).toEqual(["Early Client"]);
    expect((await agentWorkspace(tiffany))?.clients.map((row) => row.clientName)).toEqual(["Tiffany's Client"]);
    // A hand-added row on that shared line belongs to neither agent's FUB user: its clients stay with Peter, not a guess.
    const frontDesk = db.seed(dealTeamAllowlist, { name: "Front Desk", phoneE164: OFFICE, source: "manual", active: true });
    expect(await agentForTeamId(frontDesk)).toMatchObject({ name: "Front Desk", fubUserId: null });
    // Signed in with the shared office line itself: no agent identity, no one's clients, no links made or turned off.
    const office = lead({ phoneE164: OFFICE, status: "team" });
    expect(await agentRowsForLead(office)).toEqual({ kind: "shared" });
    expect(await agentForLead(office)).toBeNull();
    expect(await agentWorkspace(office)).toBeNull();
    expect(await createClientLink({ agentLead: office, clientName: "Walk-in" })).toEqual({ ok: false, kind: "shared_number" });
    expect(await revokeClientLink(office, hers.link.id)).toBe(false);
    expect(db.rows(dealClientLinks).find((row) => row.id === hers.link.id)?.revokedAt).toBeNull();
    // Two hand-added rows with different names on one number are just as ambiguous.
    const SHARED = "+12105550901";
    db.seed(dealTeamAllowlist, { name: "Agent One", phoneE164: SHARED, source: "manual", active: true });
    db.seed(dealTeamAllowlist, { name: "Agent Two", phoneE164: SHARED, source: "manual", active: true });
    expect(await agentRowsForLead(lead({ phoneE164: SHARED, status: "team" }))).toEqual({ kind: "shared" });
  });

  it("keeps a buyer's session cookie past their access so a lapsed visit finds their link or the expired screen; a team session ends with access", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    const sessionCookieDays = async (token: string | null, phone: string) => {
      const device = `device-${phone}`;
      const { done } = await verifyThrough(token, phone, device);
      if (!done?.ok) throw new Error("not verified");
      const exchange = responseRecorder();
      expect(await exchangeAccessToken(request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), exchange.response, done.token)).toBe("ok");
      const maxAge = exchange.cookies.find((entry) => entry.name === DEALS_COOKIE.session && entry.value)?.options?.maxAge ?? 0;
      return maxAge / (24 * HOUR);
    };
    expect(await sessionCookieDays(created.link.token, CLIENT_PHONE)).toBeGreaterThan(32);
    expect(await sessionCookieDays(null, OTHER_PHONE)).toBeGreaterThan(30);
    const teamDevice = "device-team";
    const exchangeToken = await issueAccessToken(agent.id, hashSecret(teamDevice), agent.expiresAt);
    const teamExchange = responseRecorder();
    expect(await exchangeAccessToken(request({ [DEALS_COOKIE.device]: teamDevice, [DEALS_COOKIE.probe]: "p" }), teamExchange.response, exchangeToken)).toBe("ok_team");
    const teamMaxAge = teamExchange.cookies.find((entry) => entry.name === DEALS_COOKIE.session && entry.value)?.options?.maxAge ?? 0;
    expect(teamMaxAge / (24 * HOUR)).toBeLessThan(1.01);
  });
});

describe("a realtor at the gate (Oct 24: realtors go to recruiting and stay off Builder Deals)", () => {
  it("blocks the number and the browser for good, answers realtor, and keeps sending that browser to recruiting until they join the team", async () => {
    testSettings();
    const { SELF_DECLARED_REALTOR_REASON, browserIsRealtorBlocked } = await import("./dealsService");
    const REALTOR = "+12105550777";
    const device = "realtor-device";
    const start = responseRecorder();
    const result = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), res: start.response, rawPhone: REALTOR, choice: "realtor", source: "sl1" });
    expect(result).toEqual({ ok: false, kind: "realtor" });
    const blocks = db.rows(dealBlocklist).filter((row) => row.reason === SELF_DECLARED_REALTOR_REASON);
    expect(blocks.map((row) => [row.phoneE164, Boolean(row.deviceHash), row.expiresAt ?? null])).toEqual([[REALTOR, false, null], [null, true, null]]);
    expect(await browserIsRealtorBlocked(request({ [DEALS_COOKIE.device]: device }))).toBe(true);
    expect(await browserIsRealtorBlocked(request({ [DEALS_COOKIE.device]: "someone-else" }))).toBe(false);
    // Coming back as a "buyer", from this browser or another one with the same number: recruiting again.
    const again = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), res: responseRecorder().response, rawPhone: "+12105550888", choice: "buyer" });
    expect(again).toEqual({ ok: false, kind: "realtor" });
    const otherBrowser = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: "fresh-browser", [DEALS_COOKIE.probe]: "p" }), res: responseRecorder().response, rawPhone: REALTOR, choice: "buyer" });
    expect(otherBrowser).toEqual({ ok: false, kind: "realtor" });
    // Once they join the team, the team check comes first: in.
    db.seed(dealTeamAllowlist, { name: "New Agent", phoneE164: REALTOR, source: "manual", active: true });
    expect(await classifyDealsAccess({ phone: REALTOR, deviceHash: hashSecret(device), isTest: false, testSkipChecks: false, brokerageDomains: [], fubRealtorTags: [], fubRealtorSources: [] })).toEqual({ allowed: true, team: true, flags: ["team"] });
    // A buyer who says they have an agent is not sent to recruiting.
    const hasAgent = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: "buyer-device", [DEALS_COOKIE.probe]: "p" }), res: responseRecorder().response, rawPhone: "+12105550999", choice: "has_agent" });
    expect(hasAgent).toEqual({ ok: false, kind: "has_agent" });
  });
});

describe("an agent's own page link (Oct 28, Peter: agents put it on their Instagram profile)", () => {
  async function verifyThroughPage(slug: string | null, rawPhone: string, device = `device-${Math.random()}`) {
    const start = responseRecorder();
    const pending = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), res: start.response, rawPhone, choice: "buyer", name: "Jordan Ellis", email: "jordan@example.com", agentPageSlug: slug });
    if (!pending.ok) return { pending, done: null };
    const done = await completeVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.pending]: start.cookie(DEALS_COOKIE.pending)! }), res: responseRecorder().response, code: TEST_OTP });
    return { pending, done };
  }

  it("names each agent's page after them, makes the sign-up that agent's lead on the buyer list, and shows it in their tools", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    resetAgentPageCache();
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    expect(await agentPageForLead(agent)).toEqual({ slug: "tiffany-agent", path: "/deals/u/tiffany-agent" });
    expect((await agentForPageSlug("tiffany-agent"))?.teamId).toBe(teamId);
    // The name with the agent's row number on the end always works too (a link made before a rename stays good).
    expect((await agentForPageSlug(`tiffany-agent-${teamId}`))?.teamId).toBe(teamId);
    expect(await agentForPageSlug(`tiffany-agent-${teamId + 999}`)).toBeNull();
    expect(await agentForPageSlug("nobody-here")).toBeNull();
    expect(await agentForPageSlug("../admin")).toBeNull();

    const { pending, done } = await verifyThroughPage("tiffany-agent", CLIENT_PHONE);
    expect(pending).toMatchObject({ ok: true, sourceCode: AGENT_PAGE_SOURCE });
    expect(done).toMatchObject({ ok: true, firstUnlock: true });
    const buyer = db.rows(dealLeads).find((row) => row.phoneE164 === CLIENT_PHONE)!;
    expect(buyer).toMatchObject({ agentTeamId: teamId, clientLinkId: null, sourceCode: AGENT_PAGE_SOURCE, name: "Jordan Ellis" });
    // The agent-client window (72 h in these settings), not the reel buyer's 24 h.
    expect(buyer.expiresAt.getTime() - Date.now()).toBeGreaterThan(70 * HOUR);
    // A public link: the buyer list without addresses, with their agent named on it.
    const view = await catalogViewForSession(buyer);
    expect(view.view).toEqual({ view: "gated" });
    expect(view.agent).toMatchObject({ teamId, name: "Tiffany Agent" });
    // The agent sees them right away (no saves yet, not in FUB yet), marked as their link's sign-up.
    const workspace = await agentWorkspace(agent);
    expect(workspace?.assigned).toEqual([expect.objectContaining({ leadId: buyer.id, name: "Jordan Ellis", viaPage: true, viaAgent: null, fubUrl: null, saves: [] })]);
    resetAgentPageCache();
  });

  it("never takes over a buyer another agent already has, and a page that is not on the team attributes nobody", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    resetAgentPageCache();
    const otherTeam = db.seed(dealTeamAllowlist, { name: "Other Agent", phoneE164: "+12105550303", fubUserId: "12", source: "fub", active: true });
    lead({ phoneE164: OTHER_PHONE, agentTeamId: otherTeam, sourceCode: AGENT_PAGE_SOURCE, expiresAt: new Date(Date.now() - HOUR) });
    await verifyThroughPage("tiffany-agent", OTHER_PHONE);
    expect(db.rows(dealLeads).find((row) => row.phoneE164 === OTHER_PHONE)?.agentTeamId).toBe(otherTeam);
    const { pending } = await verifyThroughPage("someone-else", "+12105550404");
    expect(pending.ok && pending.sourceCode).not.toBe(AGENT_PAGE_SOURCE);
    expect(pending.ok).toBe(true);
    expect(db.rows(dealLeads).find((row) => row.phoneE164 === "+12105550404")?.agentTeamId ?? null).toBeNull();
    resetAgentPageCache();
  });

  it("gives two agents with the same name each their own link, and drops inactive and nameless rows", () => {
    const row = (id: number, name: string | null, fubUserId: string | null, active = true) => ({ id, name, fubUserId, active, phoneE164: null, email: null, source: "fub", fubIdentityKey: null, createdAt: new Date() }) as never;
    expect(agentNameSlug("  Zoë  O'Neil-Brown ")).toBe("zoe-o-neil-brown");
    const entries = agentPageEntries([row(1, "Sam Lee", "5"), row(2, "Sam Lee", "5"), row(3, "Sam Lee", "9"), row(4, "Ana Ruiz", null), row(5, "Gone Agent", "7", false), row(6, null, "8")]);
    expect(entries).toEqual([
      { slug: "sam-lee", teamId: 1, rowIds: [1, 2], base: "sam-lee" },
      { slug: "sam-lee-3", teamId: 3, rowIds: [3], base: "sam-lee" },
      { slug: "ana-ruiz", teamId: 4, rowIds: [4], base: "ana-ruiz" },
    ]);
    // Live, Oct 28: Peter has a hand-added row and his FUB row; they are one person with one plain link.
    expect(agentPageEntries([row(30001, "Peter Allen", null), row(10, "Peter Allen", "2")])).toEqual([{ slug: "peter-allen", teamId: 10, rowIds: [30001, 10], base: "peter-allen" }]);
    // A hand-added row whose name matches two different FUB users stays its own.
    expect(agentPageEntries([row(40, "Sam Lee", null), row(1, "Sam Lee", "5"), row(3, "Sam Lee", "9")]).map((entry) => entry.slug)).toEqual(["sam-lee-40", "sam-lee", "sam-lee-3"]);
  });
});

describe("the name and email typed on the gate (Oct 24, Peter: we want their name and email)", () => {
  it("lands on the verified lead, cleaned; a junk email is dropped", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings();
    const device = "typed-device";
    const start = responseRecorder();
    const pending = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), res: start.response, rawPhone: CLIENT_PHONE, choice: "buyer", name: "  Maria   Lopez ", email: " Maria@Example.com " });
    expect(pending.ok).toBe(true);
    const finish = responseRecorder();
    const done = await completeVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.pending]: start.cookie(DEALS_COOKIE.pending)! }), res: finish.response, code: TEST_OTP });
    expect(done).toMatchObject({ ok: true });
    expect(db.rows(dealLeads).find((row) => row.phoneE164 === CLIENT_PHONE)).toMatchObject({ name: "Maria Lopez", email: "maria@example.com" });
    const { typedIdentity } = await import("./dealsService");
    expect(typedIdentity("M", "not-an-email")).toEqual({ name: null, email: null });
  });
});

describe("agents stay off for good; the team is exempt (Oct 25, Peter)", () => {
  it("keeps a screened agent's browser blocked with no end date, and clears a team member's browser when they use the gate", async () => {
    testSettings({ testNumbersSkipChecks: false });
    const AGENT = "+12105550717";
    db.seed(dealKnownAgents, { phoneE164: AGENT, source: "csv", active: true });
    const device = "agent-browser";
    const first = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), res: responseRecorder().response, rawPhone: AGENT, choice: "buyer" });
    expect(first).toEqual({ ok: false, kind: "realtor" });
    const deviceBlock = db.rows(dealBlocklist).find((row) => row.deviceHash === hashSecret(device));
    expect(deviceBlock).toMatchObject({ reason: "known_agent device cooldown" });
    expect(deviceBlock?.expiresAt ?? null).toBeNull();
    // The same browser used by a team member: the agent block is cleared and the team member goes on.
    const team = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), res: responseRecorder().response, rawPhone: AGENT_PHONE, choice: "buyer" });
    expect(team.ok).toBe(true);
    expect(db.rows(dealBlocklist).filter((row) => row.deviceHash === hashSecret(device))).toEqual([]);
  });
});

describe("turning a buyer off from Admin (Oct 25, Peter: turn the website off on a buyer who ghosts us)", () => {
  it("ends their session now, keeps their phone, email and browsers off with a neutral paused answer, and turns back on", async () => {
    testSettings({ testNumbersSkipChecks: false });
    const { ADMIN_TURN_OFF_REASON, browserIsAdminPaused, isLiveDealSession, turnOffBuyerAccess, turnOnBuyerAccess, adminTurnedOffLeadIds } = await import("./dealsService");
    const { dealAccessTokens } = await import("../drizzle/schema");
    const BUYER = "+12105550606";
    const laptop = "buyer-laptop";
    const phone = "buyer-phone";
    const buyer = lead({ phoneE164: BUYER, email: "ghost@example.com", deviceHash: hashSecret(laptop) });
    db.seed(dealAccessTokens, { leadId: buyer.id, tokenHash: hashSecret("session-1"), deviceHash: hashSecret(phone), kind: "session", expiresAt: new Date(Date.now() + HOUR) });
    const onPhone = request({ [DEALS_COOKIE.device]: phone, [DEALS_COOKIE.session]: "session-1" });
    expect(await isLiveDealSession(onPhone)).toMatchObject({ leadId: buyer.id });

    expect(await turnOffBuyerAccess({ leadId: buyer.id, by: "Peter", note: "ghosted" })).toEqual({ ok: true, devices: 2 });
    expect(await isLiveDealSession(onPhone)).toBeNull();
    expect(db.rows(dealLeads).find((row) => row.id === buyer.id)).toMatchObject({ status: "blocked" });
    const rows = db.rows(dealBlocklist);
    expect(rows.every((row) => row.reason === `${ADMIN_TURN_OFF_REASON}: ghosted` && (row.expiresAt ?? null) === null)).toBe(true);
    expect(rows.map((row) => row.phoneE164 ?? row.deviceHash)).toEqual([BUYER, hashSecret(laptop), hashSecret(phone)]);
    expect(rows[0]).toMatchObject({ email: "ghost@example.com" });
    expect(db.rows(dealEvents).find((row) => row.kind === "admin_turned_off")).toMatchObject({ leadId: buyer.id, detail: expect.stringContaining("\"by\":\"Peter\"") });
    expect(await adminTurnedOffLeadIds(db.rows(dealLeads) as Array<typeof dealLeads.$inferSelect>)).toEqual([buyer.id]);

    // Both browsers see the paused screen; the gate says paused for their number on a new browser and for a new number on their browser.
    expect(await browserIsAdminPaused(request({ [DEALS_COOKIE.device]: phone }))).toBe(true);
    expect(await browserIsAdminPaused(request({ [DEALS_COOKIE.device]: laptop }))).toBe(true);
    expect(await browserIsAdminPaused(request({ [DEALS_COOKIE.device]: "stranger" }))).toBe(false);
    expect(await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: "library-pc", [DEALS_COOKIE.probe]: "p" }), res: responseRecorder().response, rawPhone: BUYER, choice: "buyer" })).toEqual({ ok: false, kind: "paused" });
    expect(await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: phone, [DEALS_COOKIE.probe]: "p" }), res: responseRecorder().response, rawPhone: "+12105550616", choice: "buyer" })).toEqual({ ok: false, kind: "paused" });

    // Turned back on: the rows the turn-off wrote are gone and the number can start again (a fresh code).
    expect(await turnOnBuyerAccess({ leadId: buyer.id, by: "Peter" })).toEqual({ ok: true, removed: 3 });
    expect(db.rows(dealBlocklist)).toEqual([]);
    expect(db.rows(dealLeads).find((row) => row.id === buyer.id)).toMatchObject({ status: "expired" });
    expect(await browserIsAdminPaused(request({ [DEALS_COOKIE.device]: phone }))).toBe(false);
    expect(await getActiveBlock({ phone: BUYER })).toBeUndefined();
  });

  it("never turns off a team member, and leaves other blocks alone when turning a buyer back on", async () => {
    testSettings({ testNumbersSkipChecks: false });
    const { turnOffBuyerAccess, turnOnBuyerAccess } = await import("./dealsService");
    const agent = lead({ phoneE164: AGENT_PHONE, status: "verified", deviceHash: "a".repeat(64) });
    expect(await turnOffBuyerAccess({ leadId: agent.id, by: "Peter" })).toEqual({ ok: false, kind: "team" });
    expect(db.rows(dealBlocklist)).toEqual([]);
    expect(db.rows(dealLeads).find((row) => row.id === agent.id)).toMatchObject({ status: "verified" });
    expect(await turnOffBuyerAccess({ leadId: 9_999, by: "Peter" })).toEqual({ ok: false, kind: "not_found" });

    const buyer = lead({ phoneE164: "+12105550626", deviceHash: "b".repeat(64) });
    db.seed(dealBlocklist, { phoneE164: "+12105550626", reason: "known_agent" });
    await turnOffBuyerAccess({ leadId: buyer.id, by: "Peter" });
    await turnOnBuyerAccess({ leadId: buyer.id, by: "Peter" });
    expect(db.rows(dealBlocklist).map((row) => row.reason)).toEqual(["known_agent"]);
  });
});

describe("Oct 26, 2026: the homes an agent picks for a client", () => {
  it("stores only live homes' cards, in the agent's order, and shows them in the workspace", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const sold = db.seed(dealHomes, { communityId, sourceKey: "https://www.chesmar.com/fixture-lakes/gone/", sourceUrl: "https://www.chesmar.com/fixture-lakes/gone/", privatePlanName: "Gone", kind: "quick_move_in", status: "sold", origin: "official", price: 1 });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez", clientPhone: CLIENT_PHONE, picks: [card(planHomeId), "not-a-card", card(sold), card(homeId), card(planHomeId)] });
    if (!created.ok) throw new Error("link not created");
    expect(parsePicks(created.link.picks)).toEqual([card(planHomeId), card(homeId)]);
    const workspace = await agentWorkspace(agent);
    expect(workspace?.clients[0]?.picks).toEqual([
      expect.objectContaining({ card: card(planHomeId), description: "(Evan)", price: 429_990, communityLabel: "Fixture Lakes (Southeast San Antonio | Half-Acre Lots)" }),
      expect.objectContaining({ card: card(homeId), description: "118 Fixture Lakes Blvd (Brandon)", price: 489_990 }),
    ]);
    // The text says how many homes were picked, with the link still in it.
    const message = clientLinkTextMessage({ clientName: "Maria Lopez", agentFirstName: "Tiffany", url: "https://x.test/deals?c=abc", pickCount: 2 });
    expect(message).toBe("Hi Maria, I picked 2 new-build homes for you at Lifestyle Design Realty. Photos, prices and this week's incentives: https://x.test/deals?c=abc. Text me with questions.");
    expect(message.length).toBeLessThan(320);
    expect(clientLinkTextMessage({ clientName: "Maria Lopez", agentFirstName: "Tiffany", url: "u", pickCount: 0 })).toContain("here's your private list");
  });

  it("puts picks on an existing link, takes them off with an empty list, and refuses another agent's link", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    expect(await setClientLinkPicks(agent, { linkId: created.link.id, picks: [card(homeId)] })).toEqual({ ok: true, picks: [card(homeId)] });
    expect(parsePicks(db.rows(dealClientLinks).find((row) => row.id === created.link.id)!.picks)).toEqual([card(homeId)]);
    expect(await setClientLinkPicks(agent, { linkId: created.link.id, picks: [] })).toEqual({ ok: true, picks: [] });
    expect(db.rows(dealClientLinks).find((row) => row.id === created.link.id)!.picks).toBeNull();
    const otherTeam = db.seed(dealTeamAllowlist, { name: "Other Agent", phoneE164: "+12105550303", source: "manual", active: true });
    const foreign = db.seed(dealClientLinks, { token: "o".repeat(32), agentTeamId: otherTeam, agentLeadId: 999, clientName: "Not Mine", expiresAt: new Date(Date.now() + HOUR) });
    expect(await setClientLinkPicks(agent, { linkId: foreign, picks: [card(homeId)] })).toEqual({ ok: false, kind: "not_found" });
    expect(await resolvePickCards(["zz"])).toEqual([]);
  });

  it("gives the client their own link's picks and nobody else's", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez", picks: [card(homeId)] });
    if (!created.ok) throw new Error("link not created");
    const client = lead({ phoneE164: CLIENT_PHONE, agentTeamId: teamId, clientLinkId: created.link.id, sourceCode: AGENT_CLIENT_SOURCE });
    // Not attached yet (the link's leadId is someone else or empty): no picks.
    expect(await clientLinkPicksForLead(client)).toEqual([]);
    db.rows(dealClientLinks).find((row) => row.id === created.link.id)!.leadId = client.id;
    expect(await clientLinkPicksForLead(client)).toEqual([card(homeId)]);
    db.rows(dealClientLinks).find((row) => row.id === created.link.id)!.revokedAt = new Date();
    expect(await clientLinkPicksForLead(client)).toEqual([]);
    expect(await clientLinkPicksForLead({ id: 5, clientLinkId: null })).toEqual([]);
  });
});

describe("Oct 26, 2026: a team member whose cell is a test number with skip-checks on is still the team", () => {
  it("answers team before the test switches (Peter's own number sent him to recruiting)", async () => {
    const base = { deviceHash: hashSecret("peters-mac"), isTest: true, testSkipChecks: true, brokerageDomains: [], fubRealtorTags: [], fubRealtorSources: [] };
    expect(await classifyDealsAccess({ ...base, phone: AGENT_PHONE })).toEqual({ allowed: true, team: true, flags: ["TEST", "team"] });
    // A test number that is not on the team still skips the checks as a buyer.
    expect(await classifyDealsAccess({ ...base, phone: "+12105550444" })).toEqual({ allowed: true, team: false, flags: ["TEST"] });
  });
});

describe("Oct 27, 2026: agents get in and stay in", () => {
  it("a team member's session lasts 90 days, and a returning one is extended to that, while a buyer keeps the day", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    testSettings({ testNumbers: [AGENT_PHONE, CLIENT_PHONE] });
    const { TEAM_ACCESS_HOURS, isTeamPhone } = await import("./dealsService");
    expect(TEAM_ACCESS_HOURS).toBe(90 * 24);
    const { done } = await verifyThrough(null, AGENT_PHONE);
    expect(done?.ok && done.isTeam).toBe(true);
    const agent = db.rows(dealLeads).find((row) => row.phoneE164 === AGENT_PHONE)!;
    expect(agent.status).toBe("team");
    expect(agent.expiresAt.getTime() - Date.now()).toBeGreaterThan(89 * 24 * HOUR);
    // Returning with a short window left (a session from before): extended to the full 90 days.
    agent.expiresAt = new Date(Date.now() + 2 * HOUR);
    await verifyThrough(null, AGENT_PHONE, "another-device");
    expect(db.rows(dealLeads).find((row) => row.phoneE164 === AGENT_PHONE)!.expiresAt.getTime() - Date.now()).toBeGreaterThan(89 * 24 * HOUR);
    const buyer = await verifyThrough(null, CLIENT_PHONE);
    expect(buyer.done?.ok).toBe(true);
    expect(db.rows(dealLeads).find((row) => row.phoneE164 === CLIENT_PHONE)!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * HOUR);
    // A team member's number is never a "skip the text" test number.
    expect(await isTeamPhone(AGENT_PHONE)).toBe(true);
    expect(await isTeamPhone(CLIENT_PHONE)).toBe(false);
  });
});
