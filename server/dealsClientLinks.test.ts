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
vi.mock("./dealsMap", () => ({ communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: vi.fn(async () => ({ ok: true, status: "sent", deliveryLog: "test" })) }));
vi.mock("./dealsFubJobs", () => ({
  enqueueDealsRequestJobs: (...args: unknown[]) => mocks.enqueueDealsRequestJobs(...args),
  runPendingDealsFubJobs: (...args: unknown[]) => mocks.runPendingDealsFubJobs(...args),
  requestTestMode: (...args: unknown[]) => mocks.requestTestMode(...args),
}));

import { agentDisplayPhone, agentForLead, agentForTeamId, agentRowsForLead, agentWorkspace, attachLeadToClientLink, attachLiveSessionToClientLink, clientLinkForPhone, clientLinkTokenForLead, connectOfferFor, createClientLink, liveAgentForClient, presentClientLink, reassignTeamRowBeforeRemoval, resolveClientLink, revokeClientLink } from "./dealsClientLinks";
import { dealEvents } from "../drizzle/schema";
import { classifyDealsAccess, revokeNonTeamMatchingDealLinks } from "./dealsEligibility";
import { createDealsHomeRequest, setDealsHomeSaved } from "./dealsRequests";
import { AGENT_CLIENT_SOURCE, HAS_AGENT_BLOCK_REASON, builderPageFor, catalogViewForSession, completeVerification, createPendingVerification, exchangeAccessToken, gatedDealsCatalog, getActiveBlock, hashSecret, issueAccessToken, savedDealCards } from "./dealsService";

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

const card = (id: number) => hashSecret(`deals-card:${db.rows(dealHomes).find((row) => row.id === id)!.sourceKey}`).slice(0, 20);

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
