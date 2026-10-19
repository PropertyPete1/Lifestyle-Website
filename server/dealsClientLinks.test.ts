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
vi.mock("./dealsMap", () => ({ communityAreaMap: () => null }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: vi.fn(async () => ({ ok: true, status: "sent", deliveryLog: "test" })) }));
vi.mock("./dealsFubJobs", () => ({
  enqueueDealsRequestJobs: (...args: unknown[]) => mocks.enqueueDealsRequestJobs(...args),
  runPendingDealsFubJobs: (...args: unknown[]) => mocks.runPendingDealsFubJobs(...args),
  requestTestMode: (...args: unknown[]) => mocks.requestTestMode(...args),
}));

import { agentForLead, agentWorkspace, createClientLink, resolveClientLink, revokeClientLink } from "./dealsClientLinks";
import { classifyDealsAccess } from "./dealsEligibility";
import { createDealsHomeRequest, setDealsHomeSaved } from "./dealsRequests";
import { AGENT_CLIENT_SOURCE, HAS_AGENT_BLOCK_REASON, catalogViewForLead, completeVerification, createPendingVerification, gatedDealsCatalog, hashSecret, savedDealCards } from "./dealsService";

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

type CookieCall = { name: string; value?: string };
function responseRecorder() {
  const cookies: CookieCall[] = [];
  const response = {
    cookie: (name: string, value: string) => { cookies.push({ name, value }); return response; },
    clearCookie: (name: string) => { cookies.push({ name }); return response; },
    setHeader: () => response,
  } as unknown as Response;
  return { response, cookies, cookie: (name: string) => [...cookies].reverse().find((entry) => entry.name === name && entry.value)?.value };
}
function request(cookies: Record<string, string>): Request {
  return { headers: { cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ") }, ip: "203.0.113.9", socket: { remoteAddress: "203.0.113.9" } } as unknown as Request;
}

describe("verification through a client link", () => {
  it("attributes the verified buyer to the agent, gives them the longer access window and records it on the link", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    db.seed(dealSettings, { key: "builder_deals", value: JSON.stringify({ testNumbers: [CLIENT_PHONE], testNumbersSkipChecks: true, skipTwilioForTestNumbers: true, clientLinkExpiryHours: 72, expiryHours: 24 }) });
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");

    const device = "device-secret";
    const start = responseRecorder();
    const pending = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.probe]: "p" }), res: start.response, rawPhone: "(210) 555-0202", choice: "buyer", source: "sl1", clientLinkToken: created.link.token });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.sourceCode).toBe(AGENT_CLIENT_SOURCE);
    expect(pending.clientLink).toBe(true);
    const pendingCookie = start.cookie(DEALS_COOKIE.pending);
    expect(pendingCookie).toBeTruthy();

    const finish = responseRecorder();
    const done = await completeVerification({ req: request({ [DEALS_COOKIE.device]: device, [DEALS_COOKIE.pending]: pendingCookie! }), res: finish.response, code: TEST_OTP });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const buyer = db.rows(dealLeads).find((row) => row.id === done.leadId) as typeof dealLeads.$inferSelect;
    expect(buyer).toMatchObject({ phoneE164: CLIENT_PHONE, status: "verified", sourceCode: AGENT_CLIENT_SOURCE, agentTeamId: teamId, clientLinkId: created.link.id });
    expect(buyer.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * HOUR);
    const link = db.rows(dealClientLinks).find((row) => row.id === created.link.id)!;
    expect(link.leadId).toBe(done.leadId);
    expect(link.verifiedAt).toBeInstanceOf(Date);
    expect(catalogViewForLead(buyer)).toEqual({ view: "full", builderPages: false });
  });

  it("ignores a revoked link: the visitor goes through the ordinary gate unattributed", async () => {
    vi.stubEnv("DEALS_TEST_OTP", TEST_OTP);
    db.seed(dealSettings, { key: "builder_deals", value: JSON.stringify({ testNumbers: [CLIENT_PHONE], testNumbersSkipChecks: true, skipTwilioForTestNumbers: true }) });
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez" });
    if (!created.ok) throw new Error("link not created");
    await revokeClientLink(agent, created.link.id);
    const start = responseRecorder();
    const pending = await createPendingVerification({ req: request({ [DEALS_COOKIE.device]: "dev", [DEALS_COOKIE.probe]: "p" }), res: start.response, rawPhone: CLIENT_PHONE, choice: "buyer", source: "sl1", clientLinkToken: created.link.token });
    expect(pending.ok && pending.sourceCode).toBe("sl1");
    expect(pending.ok && pending.clientLink).toBe(false);
  });
});

describe("the full list versus the scrubbed list", () => {
  it("hides every private field from a reel buyer and shows them to the team (with builder pages) and to an agent's client (without)", async () => {
    const buyer = lead({ phoneE164: CLIENT_PHONE });
    const gated = JSON.stringify(await gatedDealsCatalog(buyer.id, catalogViewForLead(buyer)));
    expect(gated).not.toContain("Fixture Lakes");
    expect(gated).not.toContain("Chesmar");
    expect(gated).not.toContain("details");
    for (const field of DEALS_PRIVATE_FIELDS) expect(gated).not.toContain(`"${field}"`);

    const client = lead({ phoneE164: "+12105550404", agentTeamId: teamId, sourceCode: AGENT_CLIENT_SOURCE });
    const full = await gatedDealsCatalog(client.id, catalogViewForLead(client)) as Array<{ details: Record<string, unknown>; amenities: string[]; homes: Array<{ details: Record<string, unknown> }> }>;
    expect(full[0].details).toEqual({ builderName: "Chesmar", communityName: "Fixture Lakes", address: "100 Fixture Lakes Blvd, San Antonio, TX 78263", salesLine: "+12105550999", builderPage: null });
    // One quick move-in is available, so the To Be Built plan stays off the list (the same rule as the scrubbed list).
    expect(full[0].homes.map((home) => home.details)).toEqual([{ address: "118 Fixture Lakes Blvd", planName: "Brandon", builderPage: null }]);
    for (const field of DEALS_PRIVATE_FIELDS) expect(JSON.stringify(full)).not.toContain(`"${field}"`);

    const team = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const teamList = await gatedDealsCatalog(team.id, catalogViewForLead(team)) as typeof full;
    expect(teamList[0].details.builderPage).toBe("https://www.chesmar.com/fixture-lakes/");
    expect(teamList[0].homes[0].details.builderPage).toBe("https://www.chesmar.com/fixture-lakes/brandon/1/");
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
    expect(empty?.clients[0]).toMatchObject({ clientPhone: "(210) 555-0202", note: "Wants 4 beds", verifiedAt: null, accessExpiresAt: null, saves: [], requests: [] });

    const client = lead({ phoneE164: CLIENT_PHONE, agentTeamId: teamId, clientLinkId: created.link.id, sourceCode: AGENT_CLIENT_SOURCE, expiresAt: new Date(Date.now() + 48 * HOUR) });
    db.rows(dealClientLinks).find((row) => row.id === created.link.id)!.leadId = client.id;
    db.rows(dealClientLinks).find((row) => row.id === created.link.id)!.verifiedAt = new Date();
    db.seed(dealCommunityViews, { leadId: client.id, communityId });
    await setDealsHomeSaved({ leadId: client.id, card: card(homeId), saved: true, sourceCode: AGENT_CLIENT_SOURCE, deviceHash: "d".repeat(64) });
    await createDealsHomeRequest({ leadId: client.id, card: card(planHomeId), requestType: "ask", preferredAt: new Date(Date.now() + 2 * HOUR), sourceCode: AGENT_CLIENT_SOURCE, deviceHash: "d".repeat(64) });

    const workspace = await agentWorkspace(agent);
    expect(workspace?.agent).toMatchObject({ teamId, name: "Tiffany Agent", fubUserId: "77" });
    const [maria] = workspace!.clients;
    expect(maria.verifiedAt).toBeTruthy();
    expect(maria.accessExpiresAt).toBeTruthy();
    expect(maria.lastViewedAt).toBeTruthy();
    expect(maria.saves).toEqual([expect.objectContaining({ card: card(homeId), description: "118 Fixture Lakes Blvd (Brandon)", price: 489_990, communityLabel: "Fixture Lakes (Southeast San Antonio | Half-Acre Lots)" })]);
    expect(maria.requests).toEqual([expect.objectContaining({ kind: "ask", description: "(Evan)" })]);
  });
});
