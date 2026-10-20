import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealAccessTokens, dealBlocklist, dealClientLinks, dealCommunities, dealDoNotAutoImport, dealHomes, dealKnownAgents, dealLeads, dealTeamAllowlist, dealTourRequests } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import type { TrpcContext } from "./_core/context";

/**
 * tRPC caller tests for the Builder Deals router. Every service module is
 * mocked at its boundary (vi.mock); the database is the in-memory drizzle
 * stand-in so the saveCommunity / unblock / team writes are asserted on rows.
 */
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDealSettings: vi.fn(),
  ensureDealsCookies: vi.fn(),
  reserveGateSubmit: vi.fn(),
  createPendingVerification: vi.fn(),
  reserveVerificationAttempt: vi.fn(),
  recordTwilioVerifyFailure: vi.fn(),
  recordTwilioVerifyOutcome: vi.fn(),
  removePending: vi.fn(),
  logDealEvent: vi.fn(),
  currentPending: vi.fn(),
  isLiveDealSession: vi.fn(),
  saveDealSettings: vi.fn(),
  sendTwilioVerify: vi.fn(),
  handleDealsProfileUpdate: vi.fn(),
  profileRealtorFlags: vi.fn(),
  makeMatchingLeadsTeam: vi.fn(),
  findBuilderDealsFubPersonId: vi.fn(),
  requeueDealPhoto: vi.fn(),
  processPendingDealPhotos: vi.fn(),
  refreshCommunityInBackground: vi.fn(),
  testCommunitySource: vi.fn(),
  saveIncentiveForCommunity: vi.fn(),
  acceptIncentiveHold: vi.fn(),
  dismissIncentiveHold: vi.fn(),
  dismissCatalogHold: vi.fn(),
  listCommunityDiagnostics: vi.fn(),
  refreshCommunityGeography: vi.fn(),
  getBuilderPhotoSettingsForAdmin: vi.fn(),
  saveBuilderPhotoSettings: vi.fn(),
  listBuilderPhotoSamples: vi.fn(),
  getDealPhotoPreview: vi.fn(),
  uploadManualHomePhoto: vi.fn(),
  reprocessBuilderPhotos: vi.fn(),
  builderDealsHealthCheck: vi.fn(),
  builderDealsMondayReport: vi.fn(),
  enqueueDealsFubJob: vi.fn(async () => undefined),
  queueClientLinkAttachedAlert: vi.fn(async () => ({ queued: true })),
}));

vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsService")>()),
  getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args),
  ensureDealsCookies: (...args: unknown[]) => mocks.ensureDealsCookies(...args),
  reserveGateSubmit: (...args: unknown[]) => mocks.reserveGateSubmit(...args),
  createPendingVerification: (...args: unknown[]) => mocks.createPendingVerification(...args),
  reserveVerificationAttempt: (...args: unknown[]) => mocks.reserveVerificationAttempt(...args),
  recordTwilioVerifyFailure: (...args: unknown[]) => mocks.recordTwilioVerifyFailure(...args),
  recordTwilioVerifyOutcome: (...args: unknown[]) => mocks.recordTwilioVerifyOutcome(...args),
  removePending: (...args: unknown[]) => mocks.removePending(...args),
  logDealEvent: (...args: unknown[]) => mocks.logDealEvent(...args),
  currentPending: (...args: unknown[]) => mocks.currentPending(...args),
  isLiveDealSession: (...args: unknown[]) => mocks.isLiveDealSession(...args),
  saveDealSettings: (...args: unknown[]) => mocks.saveDealSettings(...args),
  dealsPublicHeaders: () => undefined,
}));
vi.mock("./dealsVerification", () => ({ sendTwilioVerify: (...args: unknown[]) => mocks.sendTwilioVerify(...args), checkTwilioVerify: vi.fn() }));
vi.mock("./dealsAlerts", () => ({ queueClientLinkAttachedAlert: (...args: unknown[]) => mocks.queueClientLinkAttachedAlert(...args) }));
vi.mock("./dealsFubJobs", () => ({ handleDealsProfileUpdate: (...args: unknown[]) => mocks.handleDealsProfileUpdate(...args), enqueueDealsFubJob: (...args: unknown[]) => mocks.enqueueDealsFubJob(...args), enqueueDealsRequestJobs: vi.fn(async () => undefined), runPendingDealsFubJobs: vi.fn(async () => ({ sent: 0, failed: 0, skipped: 0, leased: 0 })), requestTestMode: vi.fn(async () => ({ isTest: false, quiet: false })) }));
vi.mock("./dealsMap", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsMap")>()), communityAreaMap: () => null }));
vi.mock("./dealsEligibility", () => ({
  profileRealtorFlags: (...args: unknown[]) => mocks.profileRealtorFlags(...args),
  makeMatchingLeadsTeam: (...args: unknown[]) => mocks.makeMatchingLeadsTeam(...args),
  revokeOrphanedTeamPreviewLinks: vi.fn(async () => 0),
}));
vi.mock("./dealsFub", () => ({ findBuilderDealsFubPersonId: (...args: unknown[]) => mocks.findBuilderDealsFubPersonId(...args), cleanupBuilderDealsFubRecord: vi.fn(async () => ({ ok: true })) }));
vi.mock("./dealsPhotos", () => ({ requeueDealPhoto: (...args: unknown[]) => mocks.requeueDealPhoto(...args), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));
vi.mock("./dealsSyncAdmin", async (importOriginal) => ({
  // storedScrubListForCommunity stays real: the categorised storage is the behaviour under test.
  ...(await importOriginal<typeof import("./dealsSyncAdmin")>()),
  refreshCommunityInBackground: (...args: unknown[]) => mocks.refreshCommunityInBackground(...args),
  testCommunitySource: (...args: unknown[]) => mocks.testCommunitySource(...args),
  saveIncentiveForCommunity: (...args: unknown[]) => mocks.saveIncentiveForCommunity(...args),
  acceptIncentiveHold: (...args: unknown[]) => mocks.acceptIncentiveHold(...args),
  dismissIncentiveHold: (...args: unknown[]) => mocks.dismissIncentiveHold(...args),
  dismissCatalogHold: (...args: unknown[]) => mocks.dismissCatalogHold(...args),
  listCommunityDiagnostics: (...args: unknown[]) => mocks.listCommunityDiagnostics(...args),
  refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args),
}));
vi.mock("./dealsPhotosAdmin", () => {
  class PhotoAdminError extends Error { constructor(readonly code: string, message: string) { super(message); } }
  return {
    PhotoAdminError,
    getBuilderPhotoSettingsForAdmin: (...args: unknown[]) => mocks.getBuilderPhotoSettingsForAdmin(...args),
    saveBuilderPhotoSettings: (...args: unknown[]) => mocks.saveBuilderPhotoSettings(...args),
    listBuilderPhotoSamples: (...args: unknown[]) => mocks.listBuilderPhotoSamples(...args),
    getDealPhotoPreview: (...args: unknown[]) => mocks.getDealPhotoPreview(...args),
    uploadManualHomePhoto: (...args: unknown[]) => mocks.uploadManualHomePhoto(...args),
    reprocessBuilderPhotos: (...args: unknown[]) => mocks.reprocessBuilderPhotos(...args),
  };
});

vi.mock("./dealsMaintenance", () => ({
  builderDealsHealthCheck: (...args: unknown[]) => mocks.builderDealsHealthCheck(...args),
  builderDealsMondayReport: (...args: unknown[]) => mocks.builderDealsMondayReport(...args),
}));

import { dealsRouter } from "./dealsRouter";
import { DealsAdminError } from "./dealsSyncAdmin";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(role: "admin" | "user" | null, email = "peter@lifestyledesignrealty.com"): TrpcContext {
  const user: AuthenticatedUser | null = role
    ? { id: 7, openId: "owner", email, name: "Peter", loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }
    : null;
  const headers = new Map<string, string>();
  return {
    user,
    req: { protocol: "https", headers: {}, ip: "203.0.113.9", socket: { remoteAddress: "203.0.113.9" } } as unknown as TrpcContext["req"],
    res: { setHeader: (name: string, value: string) => headers.set(name, value), clearCookie: () => undefined, cookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

const admin = () => dealsRouter.createCaller(makeCtx("admin")).admin;
const visitor = () => dealsRouter.createCaller(makeCtx(null));

const settings = {
  allowCanada: false, commentKeyword: "HOME", textLine: "(512) 542-1477", expiryHours: 24, hasAgentBlockDays: 60, incentiveLapseDays: 14, dailyVerificationCap: 1500,
  phoneLimitPerHour: 3, ipLimitPerHour: 100, testPhoneLimitPerHour: 10, skipTwilioForTestNumbers: false, testNumbersSkipChecks: true, testModeFullPipeline: false,
  testNumbers: [], testTeamNumbers: [], activeReelCodes: ["sl1", "vg1"], brokerageDomains: [], fubRealtorTags: [], fubRealtorSources: [], handleKeywords: ["realtor", "realty"], trecCounties: ["Bexar"],
  alertRecipients: ["peter@lifestyledesignrealty.com"], alertMode: "immediate" as const, syncEmailRecipients: ["peter@lifestyledesignrealty.com"], driveDestinations: ["downtown San Antonio"],
  clientLinkExpiryHours: 168, clientLinkDays: 30,
  paymentMarketRate: 7.4, paymentDownPercent: 5, featuredExcludedBuilders: ["Lennar"],
};

const pendingResult = {
  ok: true as const, phone: "+12105550123", displayPhone: "(210) 555-0123", sourceCode: "sl1", deviceHash: "d".repeat(64), ip: "203.0.113.9", isTest: false, settings,
};

let db: FakeDealsDb;

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.getDealSettings.mockResolvedValue(settings);
  mocks.ensureDealsCookies.mockReturnValue({ deviceHash: "d".repeat(64), hasProbe: true });
  mocks.reserveGateSubmit.mockResolvedValue(true);
  mocks.createPendingVerification.mockResolvedValue(pendingResult);
  mocks.reserveVerificationAttempt.mockResolvedValue({ ok: true });
  mocks.recordTwilioVerifyFailure.mockResolvedValue(undefined);
  mocks.recordTwilioVerifyOutcome.mockResolvedValue(undefined);
  mocks.removePending.mockResolvedValue(undefined);
  mocks.logDealEvent.mockResolvedValue(undefined);
  mocks.handleDealsProfileUpdate.mockResolvedValue({ queued: true, alerted: false });
  mocks.profileRealtorFlags.mockResolvedValue([]);
  mocks.makeMatchingLeadsTeam.mockResolvedValue(undefined);
  mocks.findBuilderDealsFubPersonId.mockResolvedValue(null);
  mocks.requeueDealPhoto.mockResolvedValue(undefined);
  mocks.processPendingDealPhotos.mockResolvedValue({ processed: 0, hidden: 0, awaitingRegion: 0, retried: 0, failed: 0, skipped: 0 });
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: true });
  mocks.saveDealSettings.mockImplementation(async (patch: Record<string, unknown>) => ({ ...settings, ...patch }));
  mocks.reprocessBuilderPhotos.mockResolvedValue(3);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("deals.start: Verify send outcomes", () => {
  it("keeps the pending row, logs a rejected outcome and returns kind cannot_receive when the number cannot receive texts", async () => {
    mocks.sendTwilioVerify.mockResolvedValue({ ok: false, reason: "cannot_receive" });
    const result = await visitor().start({ phone: "(210) 555-0123", choice: "buyer", src: "sl1" });
    expect(result).toEqual({ ok: false, kind: "cannot_receive", message: "That number can't receive texts. Try a mobile number or tap Call me.", displayPhone: "(210) 555-0123" });
    expect(mocks.removePending).not.toHaveBeenCalled();
    expect(mocks.recordTwilioVerifyOutcome).toHaveBeenCalledWith({ sourceCode: "sl1", deviceHash: "d".repeat(64), ip: "203.0.113.9", phone: "+12105550123", outcome: "rejected" });
    expect(mocks.recordTwilioVerifyFailure).not.toHaveBeenCalled();
  });

  it("removes the pending row and records an API failure when Twilio itself fails", async () => {
    mocks.sendTwilioVerify.mockResolvedValue({ ok: false, reason: "twilio" });
    const result = await visitor().start({ phone: "(210) 555-0123", choice: "buyer", src: "sl1" });
    expect(result).toMatchObject({ ok: false, kind: "twilio" });
    expect(mocks.removePending).toHaveBeenCalledTimes(1);
    expect(mocks.recordTwilioVerifyFailure).toHaveBeenCalledWith({ sourceCode: "sl1", deviceHash: "d".repeat(64), ip: "203.0.113.9" });
    expect(mocks.recordTwilioVerifyOutcome).not.toHaveBeenCalled();
  });

  it("logs the success event and returns the display phone when the code goes out", async () => {
    mocks.sendTwilioVerify.mockResolvedValue({ ok: true });
    const result = await visitor().start({ phone: "(210) 555-0123", choice: "buyer", src: "sl1" });
    expect(result).toEqual({ ok: true, status: "code_sent", displayPhone: "(210) 555-0123", test: false });
    expect(mocks.logDealEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "twilio_verify_success", phone: "+12105550123" }));
  });

  it("uses the full spec wording for a non-US number with the keyword and text line from settings", async () => {
    mocks.createPendingVerification.mockResolvedValue({ ok: false, kind: "outside_us" });
    const result = await visitor().start({ phone: "+44 20 7946 0000", choice: "buyer" });
    expect(result).toEqual({ ok: false, kind: "outside_us", message: "US mobile numbers only for now. Outside the US? Text HOME to (512) 542-1477 and we'll help you directly." });
  });
});

describe("deals.resend", () => {
  const pending = { phoneE164: "+12105550123", sourceCode: "sl1", deviceHash: "d".repeat(64), clientIp: "203.0.113.9", expiresAt: new Date(Date.now() + 600_000) };

  it("reports cannot_receive with the Call me copy and logs the rejected outcome, leaving the pending row for the voice retry", async () => {
    mocks.currentPending.mockResolvedValue(pending);
    mocks.sendTwilioVerify.mockResolvedValue({ ok: false, reason: "cannot_receive" });
    const result = await visitor().resend({ channel: "sms" });
    expect(result).toEqual({ ok: false, kind: "cannot_receive", message: "That number can't receive texts. Try a mobile number or tap Call me." });
    expect(mocks.recordTwilioVerifyOutcome).toHaveBeenCalledWith({ sourceCode: "sl1", deviceHash: "d".repeat(64), ip: "203.0.113.9", phone: "+12105550123", outcome: "rejected" });
    expect(mocks.removePending).not.toHaveBeenCalled();
  });

  it("sends the voice channel through the same pending row", async () => {
    mocks.currentPending.mockResolvedValue(pending);
    mocks.sendTwilioVerify.mockResolvedValue({ ok: true });
    const result = await visitor().resend({ channel: "call" });
    expect(result).toEqual({ ok: true, test: false });
    expect(mocks.sendTwilioVerify).toHaveBeenCalledWith("+12105550123", "call");
    expect(mocks.reserveVerificationAttempt).toHaveBeenCalledWith(expect.objectContaining({ channel: "call", phone: "+12105550123" }));
  });
});

describe("deals.updateProfile", () => {
  const lead = (status: "verified" | "team") => ({
    id: 41, phoneE164: "+12105550123", email: null, name: null, instagramHandle: "pete_realtor", sourceCode: "sl1", timeline: null, status, flags: "[]",
    consentText: "x", consentAt: new Date(), consentIp: "203.0.113.9", deviceHash: "d".repeat(64), expiresAt: new Date(Date.now() + 3600_000), revokedAt: null, fubPersonId: null, fubStatus: "pending" as const, createdAt: new Date(), updatedAt: new Date(),
  });

  it("saves name and timeline for a team preview without running flags or any FUB/alert side effect", async () => {
    const row = lead("team");
    db.seed(dealLeads, row);
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 41, lead: row, deviceHash: row.deviceHash });
    const result = await visitor().updateProfile({ name: "Jane Agent", timeline: "0-3 months" });
    expect(result).toEqual({ ok: true });
    expect(mocks.profileRealtorFlags).not.toHaveBeenCalled();
    const stored = db.rows(dealLeads)[0];
    expect(stored).toMatchObject({ name: "Jane Agent", timeline: "0-3 months", flags: "[]" });
    expect(mocks.handleDealsProfileUpdate).toHaveBeenCalledWith({ lead: expect.objectContaining({ id: 41, status: "team", name: "Jane Agent", flags: "[]" }), newFlags: [] });
  });

  it("merges newly found flags into the lead and hands only the new ones to the FUB profile update", async () => {
    const row = { ...lead("verified"), flags: JSON.stringify(["Possible Agent - Handle"]) };
    db.seed(dealLeads, row);
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 41, lead: row, deviceHash: row.deviceHash });
    mocks.profileRealtorFlags.mockResolvedValue(["Possible Agent - Handle", "Possible Agent - TREC Name Match"]);
    await visitor().updateProfile({ name: "Test Jane Buyer" });
    expect(mocks.profileRealtorFlags).toHaveBeenCalledWith({ name: "Test Jane Buyer", instagramHandle: "pete_realtor", handleKeywords: ["realtor", "realty"], trecCounties: ["Bexar"] });
    expect(JSON.parse(String(db.rows(dealLeads)[0].flags))).toEqual(["Possible Agent - Handle", "Possible Agent - TREC Name Match"]);
    expect(mocks.handleDealsProfileUpdate).toHaveBeenCalledWith({ lead: expect.objectContaining({ name: "Test Jane Buyer" }), newFlags: ["Possible Agent - TREC Name Match"] });
  });

  it("requires a live session", async () => {
    mocks.isLiveDealSession.mockResolvedValue(null);
    await expect(visitor().updateProfile({ name: "Someone" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("agent client links through the router", () => {
  const TOKEN = "Tok_".repeat(8);
  const row = (overrides: Partial<typeof dealLeads.$inferSelect> = {}) => ({
    id: 41, phoneE164: "+12105550123", email: null, name: "Maria Lopez", instagramHandle: null, sourceCode: "agent", timeline: null, status: "verified" as const, flags: "[]",
    consentText: "x", consentAt: new Date(), consentIp: "203.0.113.9", deviceHash: "d".repeat(64), expiresAt: new Date(Date.now() + 3600_000), revokedAt: null, fubPersonId: null, fubStatus: "pending" as const, agentTeamId: null, clientLinkId: null, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  });
  let teamId: number;
  beforeEach(() => {
    teamId = db.seed(dealTeamAllowlist, { name: "Tiffany Agent", phoneE164: "+12105550101", email: "tiffany@example.com", fubUserId: "77", source: "fub", active: true });
    const communityId = db.seed(dealCommunities, { builder: "Chesmar", privateName: "Fixture Lakes", sourceUrl: "https://www.chesmar.com/x/", privateAddress: "100 Fixture Blvd", publicLabel: "Southeast San Antonio | Lots", areaLabel: "Southeast San Antonio", amenities: "[]", reelCode: "sl1", scrubList: "{}", active: true, paused: false, manualMode: false });
    db.seed(dealHomes, { communityId, sourceKey: "home-1", sourceUrl: "https://www.chesmar.com/x/plan/1/", privateAddress: "118 Fixture Blvd", privatePlanName: "Brandon", kind: "quick_move_in", status: "available", origin: "official", price: 489_990 });
    db.seed(dealClientLinks, { token: TOKEN, agentTeamId: teamId, agentLeadId: 9, clientName: "Maria Lopez", expiresAt: new Date(Date.now() + 86_400_000) });
    mocks.isLiveDealSession.mockResolvedValue(null);
    mocks.currentPending.mockResolvedValue(null);
  });

  it("names the agent on the landing state for a live link, counts the open, and names them on a dead one too", async () => {
    const state = await visitor().state({ c: TOKEN });
    expect(state.clientLink).toEqual({ state: "live", agentName: "Tiffany Agent", clientFirstName: "Maria" });
    expect(db.rows(dealClientLinks)[0]).toMatchObject({ openCount: 1 });
    expect((await visitor().state({ c: "nope" })).clientLink).toBeNull();
    expect((await visitor().state()).clientLink).toBeNull();
    // The agent previewing their own link is not counted as the client opening it.
    db.rows(dealClientLinks)[0].openedAt = null;
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 9, lead: row({ id: 9, status: "team" }), deviceHash: "d" });
    await visitor().state({ c: TOKEN });
    expect(db.rows(dealClientLinks)[0]).toMatchObject({ openCount: 1 });
    mocks.isLiveDealSession.mockResolvedValue(null);
    db.rows(dealClientLinks)[0].revokedAt = new Date();
    expect((await visitor().state({ c: TOKEN })).clientLink).toEqual({ state: "dead", agentName: "Tiffany Agent" });
  });

  it("offers to connect only a new link that is the buyer's own, and says the link-client blocked line on the gate", async () => {
    const buyer = row();
    db.seed(dealLeads, buyer);
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 41, lead: buyer, deviceHash: buyer.deviceHash });
    expect((await visitor().state({ c: TOKEN })).connectOffer).toBe("ask");
    // Already on this link: straight to the list, every time they tap the agent's text again.
    const attached = row({ agentTeamId: teamId, clientLinkId: 1 });
    db.rows(dealClientLinks)[0].leadId = 41;
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 41, lead: attached, deviceHash: attached.deviceHash });
    expect((await visitor().state({ c: TOKEN })).connectOffer).toBe("connected");
    // A link the agent made for another number is not offered to this buyer.
    db.rows(dealClientLinks)[0].leadId = null;
    db.rows(dealClientLinks)[0].clientPhoneE164 = "+12105550999";
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 41, lead: buyer, deviceHash: buyer.deviceHash });
    expect((await visitor().state({ c: TOKEN })).connectOffer).toBe("not_theirs");
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 9, lead: row({ id: 9, status: "team" }), deviceHash: "d" });
    expect((await visitor().state({ c: TOKEN })).connectOffer).toBeNull();
    // On the gate, a refused link client reads the agent's line, never the reel's "not working with an agent".
    mocks.isLiveDealSession.mockResolvedValue(null);
    expect((await visitor().state({ c: TOKEN })).blockedMessage).toBe("This number can't open the list right now. Text Tiffany Agent, or text (512) 542-1477.");
    expect((await visitor().state()).blockedMessage).not.toContain("Tiffany");
  });

  it("finds an agent client's link from their lapsed session on the bare landing page, but never a dead one", async () => {
    const { hashSecret } = await import("./dealsService");
    db.seed(dealLeads, row({ agentTeamId: teamId, clientLinkId: 1, expiresAt: new Date(Date.now() - 3600_000) }));
    db.rows(dealClientLinks)[0].leadId = 41;
    db.seed(dealAccessTokens, { leadId: 41, tokenHash: hashSecret("lapsed-session"), deviceHash: hashSecret("device-1"), expiresAt: new Date(Date.now() - 3600_000), kind: "session" });
    const ctx = makeCtx(null);
    (ctx.req as unknown as { headers: Record<string, string> }).headers = { cookie: "ldr_deals_session=lapsed-session; ldr_deals_device=device-1" };
    const lapsed = () => dealsRouter.createCaller(ctx);
    const state = await lapsed().state();
    expect(state).toMatchObject({ session: null, clientLink: { state: "live", agentName: "Tiffany Agent" }, clientLinkToken: TOKEN });
    db.rows(dealClientLinks)[0].revokedAt = new Date();
    expect(await lapsed().state()).toMatchObject({ clientLink: null, clientLinkToken: null });
    // Another browser (no lapsed session) gets nothing.
    expect((await visitor().state()).clientLinkToken).toBeNull();
  });

  it("serves Best Deals on the landing page without card handles, and on the private list only for cards on that list", async () => {
    const landing = await visitor().featured();
    // The landing page gets the price band, never the exact figure.
    expect(landing.lowestPayment).toEqual([expect.objectContaining({ label: "Southeast San Antonio | Lots", price: 480_000, priceLabel: "$480s", estMonthly: expect.any(Number) })]);
    expect(JSON.stringify(landing)).not.toContain("489990");
    expect(JSON.stringify(landing)).not.toMatch(/"card"|"detail"|Fixture|118 Fixture/);
    const buyer = row({ id: 52, phoneE164: "+12105550152" });
    db.seed(dealLeads, buyer);
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 52, lead: buyer, deviceHash: buyer.deviceHash });
    const mine = await visitor().mine();
    const cards = (mine.communities as Array<{ homes: Array<{ card: string }> }>).flatMap((community) => community.homes.map((home) => home.card));
    expect(mine.featured.lowestPayment.map((deal) => deal.card)).toEqual([cards[0]]);
    expect(mine.featured.lowestPayment[0]).not.toHaveProperty("detail");
  });

  it("turns link refusals into the agent's copy and never into the reel buyer's has-agent message", async () => {
    mocks.createPendingVerification.mockResolvedValueOnce({ ok: false, kind: "link_other_phone", agentName: "Tiffany Agent" });
    await expect(visitor().start({ phone: "(210) 555-0123", choice: "buyer", c: TOKEN })).resolves.toEqual({ ok: false, kind: "link_other_phone", message: "This link was sent for a different mobile number. Ask Tiffany Agent to send a new link to this number, or text (512) 542-1477." });
    mocks.createPendingVerification.mockResolvedValueOnce({ ok: false, kind: "blocked" });
    const blocked = await visitor().start({ phone: "(210) 555-0123", choice: "buyer", c: TOKEN });
    expect(blocked).toEqual({ ok: false, kind: "blocked", message: "This number can't open the list right now. Text Tiffany Agent, or text (512) 542-1477." });
  });

  it("passes the token into the pending verification on start", async () => {
    mocks.sendTwilioVerify.mockResolvedValue({ ok: true });
    await visitor().start({ phone: "(210) 555-0123", choice: "buyer", c: TOKEN });
    expect(mocks.createPendingVerification).toHaveBeenCalledWith(expect.objectContaining({ clientLinkToken: TOKEN }));
  });

  it("serves the full list with the agent's name to the agent's client, and the scrubbed list to a reel buyer", async () => {
    const client = row({ agentTeamId: teamId, clientLinkId: 1 });
    db.seed(dealLeads, client);
    db.rows(dealClientLinks)[0].leadId = 41;
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 41, lead: client, deviceHash: client.deviceHash });
    const mine = await visitor().mine();
    expect(mine.fullDetails).toBe(true);
    // The client gets the agent's real number, formatted, never a masked one.
    expect(mine.agent).toEqual({ name: "Tiffany Agent", firstName: "Tiffany", phone: "(210) 555-0101" });
    expect(mine.lead.agentClient).toBe(true);
    expect(JSON.stringify(mine.communities)).toContain("Fixture Lakes");
    expect(JSON.stringify(mine.communities)).not.toContain("chesmar.com");

    const buyer = row({ id: 42, phoneE164: "+12105550124", sourceCode: "sl1" });
    db.seed(dealLeads, buyer);
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 42, lead: buyer, deviceHash: buyer.deviceHash });
    const reel = await visitor().mine();
    expect(reel.fullDetails).toBe(false);
    expect(reel.agent).toBeNull();
    expect(JSON.stringify(reel.communities)).not.toContain("Fixture Lakes");
    expect(reel.saved).toEqual([]);
  });

  it("saves and unsaves a home for a live session and reports the saved cards on mine", async () => {
    const client = row({ agentTeamId: teamId });
    db.seed(dealLeads, client);
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 41, lead: client, deviceHash: client.deviceHash });
    const card = (await visitor().mine()).communities[0]!.homes[0]!.card as string;
    await expect(visitor().saveHome({ card, saved: true })).resolves.toEqual({ ok: true, saved: true, notified: true });
    expect((await visitor().mine()).saved).toEqual([card]);
    expect(db.rows(dealTourRequests)).toHaveLength(1);
    await expect(visitor().saveHome({ card, saved: false })).resolves.toEqual({ ok: true, saved: false, notified: false });
    await expect(visitor().saveHome({ card: "0".repeat(20), saved: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    mocks.isLiveDealSession.mockResolvedValue(null);
    await expect(visitor().saveHome({ card, saved: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("attaches a live buyer session to a client link without a second code and extends the session", async () => {
    const { hashSecret } = await import("./dealsService");
    const buyer = row({ id: 42, phoneE164: "+12105550124", sourceCode: "sl1", deviceHash: hashSecret("device-cookie") });
    db.seed(dealLeads, buyer);
    db.seed(dealAccessTokens, { leadId: 42, tokenHash: hashSecret("session-cookie"), deviceHash: buyer.deviceHash, kind: "session", expiresAt: buyer.expiresAt });
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 42, lead: buyer, deviceHash: buyer.deviceHash });
    const ctx = makeCtx(null);
    (ctx.req as unknown as { headers: Record<string, string> }).headers = { cookie: "ldr_deals_session=session-cookie; ldr_deals_device=device-cookie" };
    await expect(dealsRouter.createCaller(ctx).attachClientLink({ c: TOKEN })).resolves.toEqual({ ok: true, attached: true, agentName: "Tiffany Agent" });
    expect(db.rows(dealLeads).find((lead) => lead.id === 42)).toMatchObject({ agentTeamId: teamId, clientLinkId: 1 });
    // One FUB note naming the agent and one alert to the owners and the agent.
    expect(mocks.enqueueDealsFubJob).toHaveBeenCalledWith(42, "reverify", expect.objectContaining({ reason: "attached to an agent's client link" }));
    expect(mocks.queueClientLinkAttachedAlert).toHaveBeenCalledWith(expect.objectContaining({ id: 42, agentTeamId: teamId }), { name: "Tiffany Agent", email: "tiffany@example.com" }, 1);
    // The session row follows the longer window.
    expect((db.rows(dealAccessTokens)[0].expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(160 * 3600_000);
    expect(db.rows(dealClientLinks)[0]).toMatchObject({ leadId: 42 });
    await expect(visitor().attachClientLink({ c: "x".repeat(32) })).resolves.toMatchObject({ ok: false, kind: "invalid_link" });
    mocks.isLiveDealSession.mockResolvedValue(null);
    await expect(visitor().attachClientLink({ c: TOKEN })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("gives the team their workspace and link controls, and refuses buyers", async () => {
    const agent = row({ id: 9, phoneE164: "+12105550101", status: "team", sourceCode: "other" });
    db.seed(dealLeads, agent);
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 9, lead: agent, deviceHash: agent.deviceHash });
    const workspace = await visitor().team.workspace();
    expect(workspace.agent).toEqual({ name: "Tiffany Agent", email: "tiffany@example.com", fubLinked: true });
    expect(workspace.clients.map((client) => client.clientName)).toEqual(["Maria Lopez"]);
    const created = await visitor().team.createClientLink({ clientName: "Sam Reyes", clientPhone: "(210) 555-0303" });
    expect(created.path).toMatch(/^\/deals\?c=[A-Za-z0-9_-]{20,64}$/);
    expect((await visitor().team.workspace()).clients.map((client) => client.clientName)).toEqual(["Sam Reyes", "Maria Lopez"]);
    await expect(visitor().team.createClientLink({ clientName: "Bad Phone", clientPhone: "12" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(visitor().team.revokeClientLink({ id: created.id })).resolves.toEqual({ ok: true });
    await expect(visitor().team.revokeClientLink({ id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The team member's own list is the full one with builder pages.
    const mine = await visitor().mine();
    expect(mine.fullDetails).toBe(true);
    expect(JSON.stringify(mine.communities)).toContain("https://www.chesmar.com/x/plan/1/");

    const buyer = row({ id: 42, phoneE164: "+12105550124", sourceCode: "sl1" });
    db.seed(dealLeads, buyer);
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 42, lead: buyer, deviceHash: buyer.deviceHash });
    await expect(visitor().team.workspace()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(visitor().team.createClientLink({ clientName: "Nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.isLiveDealSession.mockResolvedValue(null);
    await expect(visitor().team.workspace()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

});

describe("admin gating", () => {
  it("refuses non-admin users and admins outside the allowlist", async () => {
    await expect(dealsRouter.createCaller(makeCtx("user")).admin.communityDiagnostics()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(dealsRouter.createCaller(makeCtx("admin", "someone@example.com")).admin.communityDiagnostics()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(visitor().admin.communityDiagnostics()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("serves the builder choices (adapter hosts plus Manual) to admins only, so no builder name has to live in the client bundle", async () => {
    const builders = await admin().builders();
    expect(builders.map((builder) => builder.id)).toEqual(["Chesmar", "M/I Homes", "Perry Homes", "D.R. Horton", "Pulte", "Centex", "Del Webb", "First America Homes", "Coventry Homes", "Davidson Homes", "Manual"]);
    expect(builders.find((builder) => builder.id === "M/I Homes")).toMatchObject({ host: "www.mihomes.com", manual: false });
    expect(builders.find((builder) => builder.id === "Manual")).toMatchObject({ host: null, manual: true });
    await expect(dealsRouter.createCaller(makeCtx("user")).admin.builders()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("admin.saveCommunity", () => {
  const base = {
    builder: "M/I Homes" as const, privateName: "Vista Gardens", sourceUrl: "https://www.mihomes.com/new-homes/texas/greater-san-antonio/southeast-san-antonio/vista-gardens",
    publicLabel: "Southeast San Antonio | New Phase Now Selling", areaLabel: "Southeast San Antonio", privateAddress: "8106 Onion Patch, San Antonio TX 78263", reelCode: "vg1", salesPhone: "(210) 555-0199",
  };

  it("stores a categorised scrub list with the builder aliases and community name, normalises the sales phone and refreshes the ZIP geography", async () => {
    const result = await admin().saveCommunity({ ...base, scrubList: { plan: ["Magnolia"], street: ["Onion Patch", "Gardner Road"], lender: ["M/I Financial"] } });
    const row = db.rows(dealCommunities)[0];
    expect(result).toMatchObject({ ok: true, id: row.id });
    const stored = JSON.parse(String(row.scrubList));
    expect(stored.builder).toEqual(expect.arrayContaining(["M/I Homes", "M/I"]));
    expect(stored.lender).toEqual(expect.arrayContaining(["M/I Financial"]));
    expect(stored.community).toEqual(["Vista Gardens"]);
    expect(stored.plan).toEqual(["Magnolia"]);
    expect(stored.street).toEqual(["Onion Patch", "Gardner Road"]);
    expect(stored.other).toEqual([]);
    expect(row.salesPhone).toBe("+12105550199");
    expect(mocks.refreshCommunityGeography).toHaveBeenCalledWith(row.id);
  });

  it("accepts a legacy flat list (it lands in other) and never shortens the stored list on edit", async () => {
    const id = db.seed(dealCommunities, { ...base, salesPhone: null, scrubList: JSON.stringify({ builder: ["M/I Homes"], plan: ["Magnolia"], street: ["Onion Patch"], other: [] }), active: true, paused: false, manualMode: false });
    await admin().saveCommunity({ ...base, id, scrubList: ["Calaveras Trail"] });
    const stored = JSON.parse(String(db.rows(dealCommunities)[0].scrubList));
    expect(stored.plan).toEqual(["Magnolia"]);
    expect(stored.street).toEqual(["Onion Patch"]);
    expect(stored.other).toEqual(["Calaveras Trail"]);
    expect(mocks.refreshCommunityGeography).toHaveBeenCalledWith(id);
  });

  it("refuses a public label that leaks a private term from any category, including a street name", async () => {
    await expect(admin().saveCommunity({ ...base, publicLabel: "Homes on Onion Patch", scrubList: { street: ["Onion Patch"] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().saveCommunity({ ...base, areaLabel: "Vista Gardens area" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows(dealCommunities)).toHaveLength(0);
  });

  it("requires the adapter's exact official host for an official builder and rejects a Manual row on a fetched host", async () => {
    await expect(admin().saveCommunity({ ...base, builder: "Chesmar", sourceUrl: "https://chesmar.com/texas/san-antonio-new-homes/san-antonio/sienna-lakes/" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().saveCommunity({ ...base, sourceUrl: "http://www.mihomes.com/new-homes/texas" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().saveCommunity({ ...base, builder: "Manual", sourceUrl: "https://www.chesmar.com/some/page" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const manual = await admin().saveCommunity({ ...base, builder: "Manual", privateName: "Cedar Row", reelCode: "cr1", sourceUrl: "https://example-builder.test/community" });
    expect(manual.ok).toBe(true);
    expect(db.rows(dealCommunities)).toHaveLength(1);
  });

  it("refuses a reel code already used by another community", async () => {
    db.seed(dealCommunities, { ...base, salesPhone: null, scrubList: "{}", active: true, paused: false, manualMode: false });
    await expect(admin().saveCommunity({ ...base, privateName: "Other Place", publicLabel: "Another label" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("replaces the discovered plan and street lists only with replaceDiscovered, and stores excluded false positives the labels may then use", async () => {
    const id = db.seed(dealCommunities, { ...base, salesPhone: null, scrubList: JSON.stringify({ plan: ["Magnolia", "Cypress"], street: ["Onion Patch", "New Homes in San Antonio"], other: [] }), active: true, paused: false, manualMode: false });
    // The client sends neither field: union semantics, exclusions untouched.
    await admin().saveCommunity({ ...base, id, scrubList: { plan: ["Oak"] } });
    let stored = JSON.parse(String(db.rows(dealCommunities)[0].scrubList));
    expect(stored).toMatchObject({ plan: ["Magnolia", "Cypress", "Oak"], street: ["Onion Patch", "New Homes in San Antonio"] });
    expect(stored.excludedTerms).toBeUndefined();
    // A public label that contains the wrongly discovered heading is refused until it is excluded.
    await expect(admin().saveCommunity({ ...base, id, publicLabel: "New Homes in San Antonio | Half-Acre Lots" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const result = await admin().saveCommunity({ ...base, id, publicLabel: "New Homes in San Antonio | Half-Acre Lots", scrubList: { plan: ["Oak"], street: ["Onion Patch"] }, replaceDiscovered: true, excludedTerms: ["New Homes in San Antonio"] });
    expect(result).toMatchObject({ ok: true, id, excludedTerms: ["New Homes in San Antonio"] });
    expect(result.scrubList).toMatchObject({ plan: ["Oak"], street: ["Onion Patch"] });
    stored = JSON.parse(String(db.rows(dealCommunities)[0].scrubList));
    expect(stored).toMatchObject({ plan: ["Oak"], street: ["Onion Patch"], excludedTerms: ["New Homes in San Antonio"], community: ["Vista Gardens"] });
    expect(db.rows(dealCommunities)[0].publicLabel).toBe("New Homes in San Antonio | Half-Acre Lots");
    // The community name can never be excluded away.
    await expect(admin().saveCommunity({ ...base, id, publicLabel: "Vista Gardens homes", excludedTerms: ["Vista Gardens"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("admin: read-only health procedures", () => {
  it("previews the health check without the render prune and the Monday report through the maintenance module", async () => {
    mocks.builderDealsHealthCheck.mockResolvedValue({ state: "ok", attention: [], renderPrune: null });
    mocks.builderDealsMondayReport.mockResolvedValue({ ok: true, subject: "Builder Deals System OK: all checks passed", body: "body" });
    expect(await admin().health()).toMatchObject({ state: "ok", renderPrune: null });
    expect(mocks.builderDealsHealthCheck).toHaveBeenCalledWith(expect.any(Date), { prune: false });
    expect(await admin().mondayReport()).toMatchObject({ ok: true });
    expect(mocks.builderDealsMondayReport).toHaveBeenCalledWith();
  });
});

describe("admin: sync-admin wiring and error mapping", () => {
  it("runs Refresh now in the background and maps a DealsAdminError onto the same tRPC code", async () => {
    mocks.refreshCommunityInBackground.mockResolvedValue({ queued: true, jobName: "deals-refresh-community-3" });
    expect(await admin().refreshCommunity({ id: 3 })).toEqual({ queued: true, jobName: "deals-refresh-community-3" });
    mocks.refreshCommunityInBackground.mockRejectedValue(new DealsAdminError("PRECONDITION_FAILED", "This community is in manual mode, no auto-update."));
    await expect(admin().refreshCommunity({ id: 3 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "This community is in manual mode, no auto-update." });
  });

  it("passes the extended Accept this update input through, including the no-contract-deadline tick", async () => {
    mocks.acceptIncentiveHold.mockResolvedValue({ ok: true });
    const input = { id: 9, noContractDeadline: true, followOnRate: "6.25%", followOnPeriod: "years 2 to 30", apr: "6.051%", closeBy: "2026-11-30" };
    expect(await admin().acceptHold(input)).toEqual({ ok: true });
    expect(mocks.acceptIncentiveHold).toHaveBeenCalledWith(input);
    mocks.acceptIncentiveHold.mockRejectedValue(new DealsAdminError("BAD_REQUEST", "Edit and complete this incentive before accepting: contractBy"));
    await expect(admin().acceptHold({ id: 9 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().acceptHold({ id: 9, contractBy: "11/08/2026" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("delegates saveIncentive, dismissHold, dismissCatalogHold, testCommunitySource and communityDiagnostics to the sync admin module", async () => {
    mocks.saveIncentiveForCommunity.mockResolvedValue({ ok: true, id: 12 });
    mocks.dismissIncentiveHold.mockResolvedValue({ ok: true });
    mocks.dismissCatalogHold.mockResolvedValue({ ok: true, dismissed: "homes_container_missing" });
    mocks.testCommunitySource.mockResolvedValue({ host: "www.mihomes.com", status: 200, bytes: 65536, truncated: true, redirected: false, redirectSameHost: null });
    mocks.listCommunityDiagnostics.mockResolvedValue([{ id: 1 }]);
    const incentive = { communityId: 1, publicText: "First-year rates as low as 4.25% (6.051% APR) on select quick move-in homes.", manual: true, contractBy: "2026-11-08", closeBy: null, apr: "6.051%", headlineRate: "4.25%", followOnRate: "6.25%", followOnPeriod: "years 2 to 30" };
    expect(await admin().saveIncentive(incentive)).toEqual({ ok: true, id: 12 });
    expect(mocks.saveIncentiveForCommunity).toHaveBeenCalledWith(incentive);
    expect(await admin().dismissHold({ id: 12 })).toEqual({ ok: true });
    expect(mocks.dismissIncentiveHold).toHaveBeenCalledWith(12);
    expect(await admin().dismissCatalogHold({ id: 1 })).toEqual({ ok: true, dismissed: "homes_container_missing" });
    expect(mocks.dismissCatalogHold).toHaveBeenCalledWith(1);
    expect(await admin().testCommunitySource({ id: 1 })).toMatchObject({ status: 200, truncated: true });
    expect(await admin().communityDiagnostics()).toEqual([{ id: 1 }]);
  });

  it("accepts the sync email recipients and drive destinations and validates them", async () => {
    await admin().saveSettings({ syncEmailRecipients: ["peter@lifestyledesignrealty.com"], driveDestinations: ["downtown San Antonio", "Randolph AFB"] });
    expect(mocks.saveDealSettings).toHaveBeenCalledWith({ syncEmailRecipients: ["peter@lifestyledesignrealty.com"], driveDestinations: ["downtown San Antonio", "Randolph AFB"] });
    await expect(admin().saveSettings({ syncEmailRecipients: ["not-an-email"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().saveSettings({ driveDestinations: ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((value) => `${value} place`) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().saveSettings({ driveDestinations: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.saveDealSettings).toHaveBeenCalledTimes(1);
  });
});

describe("admin: photo procedures", () => {
  it("maps PhotoAdminError codes onto tRPC codes", async () => {
    const { PhotoAdminError } = await import("./dealsPhotosAdmin");
    mocks.saveBuilderPhotoSettings.mockRejectedValue(new PhotoAdminError("invalid_region", "The watermark region must be a percent box inside the photo."));
    await expect(admin().saveBuilderPhotoSettings({ builder: "Chesmar", enabled: true, region: { x: 0, y: 95, width: 100, height: 20 } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "The watermark region must be a percent box inside the photo." });
    mocks.uploadManualHomePhoto.mockRejectedValue(new PhotoAdminError("home_not_found", "Home not found."));
    await expect(admin().uploadHomePhoto({ homeId: 99, base64: "AAAA", contentType: "image/jpeg" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    mocks.listBuilderPhotoSamples.mockRejectedValue(new PhotoAdminError("storage_unavailable", "The photo could not be read."));
    await expect(admin().builderPhotoSamples({ builder: "Chesmar" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("saves builder settings through the photos admin module and reports the requeue", async () => {
    mocks.saveBuilderPhotoSettings.mockResolvedValue({ builder: "Chesmar", settings: { enabled: true, region: { x: 0, y: 88, width: 100, height: 12 }, keywords: ["Homes"], reviewedSampleIds: [1], revision: "admin-x" }, changed: true, requeued: 14 });
    const input = { builder: "Chesmar", enabled: true, region: { x: 0, y: 88, width: 100, height: 12 }, keywords: ["Realty"], reviewedSampleIds: [1, 2] };
    expect(await admin().saveBuilderPhotoSettings(input)).toMatchObject({ changed: true, requeued: 14 });
    expect(mocks.saveBuilderPhotoSettings).toHaveBeenCalledWith(input);
    expect(await admin().reprocessBuilderPhotos({ builder: "Chesmar" })).toEqual({ ok: true, requeued: 3 });
    await Promise.resolve();
    expect(mocks.reprocessBuilderPhotos).toHaveBeenCalledWith("Chesmar");
  });

  it("returns the preview, or NOT_FOUND when no bytes are stored yet", async () => {
    mocks.getDealPhotoPreview.mockResolvedValue({ id: 5, source: "master", dataUrl: "data:image/webp;base64,AAAA", width: 320, height: 200, processingState: "processed", automaticHidden: false, adminHidden: false, lastProcessingError: null, ocrMatches: [] });
    expect(await admin().photoPreview({ id: 5 })).toMatchObject({ id: 5, source: "master" });
    expect(mocks.getDealPhotoPreview).toHaveBeenCalledWith({ id: 5 });
    mocks.getDealPhotoPreview.mockResolvedValue(null);
    await expect(admin().photoPreview({ id: 6 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requeues a photo and kicks the queue drain", async () => {
    expect(await admin().reprocessPhoto({ id: 8 })).toEqual({ ok: true, queued: true });
    expect(mocks.requeueDealPhoto).toHaveBeenCalledWith(8);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.processPendingDealPhotos).toHaveBeenCalledWith(5);
  });

  it("refuses an upload over 8 MB of image bytes before touching storage and forwards a valid data URL", async () => {
    const big = `data:image/jpeg;base64,${"A".repeat(Math.ceil((8 * 1024 * 1024 + 4096) * 4 / 3))}`;
    await expect(admin().uploadHomePhoto({ homeId: 1, base64: big, contentType: "image/jpeg" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Photos must be 8 MB or smaller." });
    expect(mocks.uploadManualHomePhoto).not.toHaveBeenCalled();
    mocks.uploadManualHomePhoto.mockResolvedValue({ id: 3, homeId: 1, sortOrder: 0, width: 1600, height: 1066 });
    const small = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    expect(await admin().uploadHomePhoto({ homeId: 1, base64: small, contentType: "image/jpeg" })).toEqual({ id: 3, homeId: 1, sortOrder: 0, width: 1600, height: 1066 });
    expect(mocks.uploadManualHomePhoto).toHaveBeenCalledWith({ homeId: 1, base64: small, contentType: "image/jpeg" });
  });
});

describe("admin.saveCommunityState", () => {
  it("ends a discovered community's wait for its first sync when an admin turns it on or off by hand", async () => {
    const seed = (privateName: string) => db.seed(dealCommunities, { builder: "Chesmar", privateName, sourceUrl: `https://www.chesmar.com/${privateName}/`, privateAddress: "1 Main St", publicLabel: "Southeast San Antonio | New Homes", areaLabel: "Southeast San Antonio", amenities: "[]", reelCode: `auto-${privateName}`, scrubList: "{}", active: false, paused: false, manualMode: false, awaitingFirstSync: true });
    const off = seed("off");
    const on = seed("on");
    const untouched = seed("untouched");
    await admin().saveCommunityState({ id: off, active: false });
    await admin().saveCommunityState({ id: on, active: true });
    await admin().saveCommunityState({ id: untouched, reelUrl: null });
    const byId = (id: number) => db.rows(dealCommunities).find((row) => row.id === id);
    expect(byId(off)).toMatchObject({ active: false, awaitingFirstSync: false });
    expect(byId(on)).toMatchObject({ active: true, awaitingFirstSync: false });
    expect(byId(untouched)).toMatchObject({ active: false, awaitingFirstSync: true });
  });
});

describe("admin.unblock", () => {
  const phone = "+12105550177";

  it("falls back to a FUB person lookup by the unblocked value when no local lead or known-agent row carries a person id", async () => {
    vi.stubEnv("FUB_API_KEY", "test-key");
    const id = db.seed(dealBlocklist, { phoneE164: phone, email: null, deviceHash: null, searchPhone: null, reason: "fub_match:phone", expiresAt: null });
    mocks.findBuilderDealsFubPersonId.mockResolvedValue("4521");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      if (!init?.method || init.method === "GET") return new Response(JSON.stringify({ id: 4521, phones: [{ value: "(210) 555-0177" }], emails: [], tags: ["Agent - FUB Match", "Recruit - Test"] }), { status: 200 });
      return new Response("{}", { status: 200 });
    }));
    const result = await admin().unblock({ id });
    expect(result).toMatchObject({ ok: true, fubCleanup: { state: "complete", cleaned: 1 } });
    expect(mocks.findBuilderDealsFubPersonId).toHaveBeenCalledWith({ phone, email: null });
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toContain("/people/4521");
    expect(JSON.parse(put!.body!)).toEqual({ tags: ["Recruit - Test"], mergeTags: false });
    expect(db.rows(dealBlocklist)).toHaveLength(0);
    expect(db.rows(dealDoNotAutoImport)).toEqual([expect.objectContaining({ kind: "phone", value: phone })]);
  });

  it("does not look up FUB when a local record already names the person", async () => {
    const id = db.seed(dealBlocklist, { phoneE164: phone, email: null, deviceHash: null, searchPhone: null, reason: "known_agent", expiresAt: null });
    db.seed(dealKnownAgents, { name: "Known Agent", phoneE164: phone, email: null, source: "csv", fubPersonId: "77", active: true });
    await admin().unblock({ id });
    expect(mocks.findBuilderDealsFubPersonId).not.toHaveBeenCalled();
    expect(db.rows(dealKnownAgents)).toHaveLength(0);
  });

  it("re-normalises a blocked Canadian number under the system's allowCanada setting instead of refusing the unblock", async () => {
    const toronto = "+14165550123";
    const id = db.seed(dealBlocklist, { phoneE164: toronto, email: null, deviceHash: null, searchPhone: null, reason: "fub_match:phone", expiresAt: null });
    db.seed(dealKnownAgents, { name: "Northern Agent", phoneE164: toronto, email: null, source: "csv", fubPersonId: "78", active: true });
    mocks.getDealSettings.mockResolvedValue(settings);
    await expect(admin().unblock({ id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows(dealBlocklist)).toHaveLength(1);

    mocks.getDealSettings.mockResolvedValue({ ...settings, allowCanada: true });
    await expect(admin().unblock({ id })).resolves.toMatchObject({ ok: true, nextStep: "fresh_verification_required" });
    expect(db.rows(dealBlocklist)).toHaveLength(0);
    expect(db.rows(dealKnownAgents)).toHaveLength(0);
    expect(db.rows(dealDoNotAutoImport)).toEqual([expect.objectContaining({ kind: "phone", value: toronto })]);
  });
});

describe("admin: team phone entry", () => {
  it("lists FUB users with no phone and drops those already covered by a hand-entered manual row", async () => {
    db.seed(dealTeamAllowlist, [
      { name: "No Phone Agent", phoneE164: null, email: "nophone@lifestyledesignrealty.com", fubUserId: "u1", source: "fub", active: true },
      { name: "Covered Agent", phoneE164: null, email: "covered@lifestyledesignrealty.com", fubUserId: "u2", source: "fub", active: true },
      { name: "Covered Agent", phoneE164: "+12105550101", email: null, fubUserId: "u2", source: "manual", active: true },
      { name: "Has Phone", phoneE164: "+12105550102", email: "has@lifestyledesignrealty.com", fubUserId: "u3", source: "fub", active: true },
      { name: "Gone Agent", phoneE164: null, email: "gone@lifestyledesignrealty.com", fubUserId: "u4", source: "fub", active: false },
    ]);
    const rows = await admin().teamNeedsPhone();
    expect(rows.map((row) => row.name)).toEqual(["No Phone Agent"]);
  });

  it("adds the number as a manual row carrying the FUB user id and runs the team cascade", async () => {
    const id = db.seed(dealTeamAllowlist, { name: "No Phone Agent", phoneE164: null, email: "nophone@lifestyledesignrealty.com", fubUserId: "u1", source: "fub", active: true });
    db.seed(dealBlocklist, { phoneE164: "+12105550123", email: null, deviceHash: null, searchPhone: null, reason: "known_agent", expiresAt: null });
    db.seed(dealKnownAgents, { name: "No Phone Agent", phoneE164: "+12105550123", email: null, source: "fub_recruit", fubPersonId: null, active: true });
    expect(await admin().addTeamPhone({ id, phoneE164: "210-555-0123" })).toEqual({ ok: true });
    expect(db.rows(dealTeamAllowlist)).toContainEqual(expect.objectContaining({ phoneE164: "+12105550123", fubUserId: "u1", source: "manual", name: "No Phone Agent", active: true }));
    expect(db.rows(dealBlocklist)).toHaveLength(0);
    expect(db.rows(dealKnownAgents)).toHaveLength(0);
    expect(db.rows(dealDoNotAutoImport)).toEqual([expect.objectContaining({ kind: "phone", value: "+12105550123" })]);
    expect(mocks.makeMatchingLeadsTeam).toHaveBeenCalledWith(expect.anything(), { phoneE164: "+12105550123", email: null, deviceHash: null });
    expect(await admin().teamNeedsPhone()).toEqual([]);
    await expect(admin().addTeamPhone({ id, phoneE164: "not a phone" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().addTeamPhone({ id: 999, phoneE164: "210-555-0124" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("admin.blockLeadAndKillLink", () => {
  it("still blocks the lead identity and revokes every access token", async () => {
    const { blockDealAccess } = await import("./dealsService");
    void blockDealAccess;
    db.seed(dealLeads, { id: 5, phoneE164: "+12105550123", email: null, name: "Buyer", instagramHandle: null, sourceCode: "sl1", timeline: null, status: "verified", flags: "[]", consentText: "x", consentAt: new Date(), consentIp: "203.0.113.9", deviceHash: "d".repeat(64), expiresAt: new Date(Date.now() + 3600_000), revokedAt: null, fubPersonId: null, fubStatus: "synced" });
    db.seed(dealAccessTokens, { leadId: 5, tokenHash: "t".repeat(64), deviceHash: "d".repeat(64), kind: "session", expiresAt: new Date(Date.now() + 3600_000), consumedAt: null, revokedAt: null });
    await admin().blockLeadAndKillLink({ leadId: 5, reason: "admin review" });
    expect(db.rows(dealLeads)[0].status).toBe("blocked");
    expect(db.rows(dealAccessTokens)[0].revokedAt).toBeInstanceOf(Date);
    expect(db.rows(dealBlocklist)).toContainEqual(expect.objectContaining({ phoneE164: "+12105550123", reason: "admin review" }));
  });
});
