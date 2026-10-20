import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDealSettings: vi.fn(),
  makeMatchingLeadsTeam: vi.fn(),
  revokeOrphanedTeamPreviewLinks: vi.fn(),
  sendBuilderDealsEmail: vi.fn(),
  pruneDealPhotoRenders: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsPhotos", () => ({ pruneDealPhotoRenders: (...args: unknown[]) => mocks.pruneDealPhotoRenders(...args) }));
vi.mock("./dealsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsService")>()),
  getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args),
}));
vi.mock("./dealsEligibility", () => ({
  makeMatchingLeadsTeam: (...args: unknown[]) => mocks.makeMatchingLeadsTeam(...args),
  revokeOrphanedTeamPreviewLinks: (...args: unknown[]) => mocks.revokeOrphanedTeamPreviewLinks(...args),
}));
vi.mock("./dealsEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsEmail")>()),
  sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args),
}));

import { dealCommunities, dealEmailLogs, dealEvents, dealFubJobs, dealIncentives, dealJobRuns, dealLeads, dealPhotos, dealTeamAllowlist, dealTrecImports } from "../drizzle/schema";
import { createFakeDealsDb, jsonResponse } from "./dealsFubFakeDb.test-support";
import { privacyResidueDetail } from "./dealsService";
import { summarizeHolds } from "./dealsSync";
import {
  BUILDER_DEALS_HEALTH_THRESHOLDS,
  builderDealsHealthCheck,
  builderDealsMondayReport,
  holdLines,
  isActiveFubUser,
  normalizeFubPhone,
  runBuilderDealsHealthJob,
  sendBuilderDealsMondayReport,
  syncTeamAllowlistFromFub,
} from "./dealsMaintenance";

const settings = { testNumbers: [] as string[], alertRecipients: ["peter@lifestyledesignrealty.com", "steven@lifestyledesignrealty.com"], alertMode: "immediate" as const };
const peter = { id: 1, name: "Peter Allen", email: "peter@lifestyledesignrealty.com", phones: [{ value: "(210) 555-0101" }, { value: "210-555-0111" }] };
const steven = { id: 2, name: "Steven Van Orden", email: "steven@lifestyledesignrealty.com", phones: [{ value: "(210) 555-0102" }] };
const mirroredRows = [
  { id: 10, fubIdentityKey: "fub:1:+12105550101", active: true },
  { id: 12, fubIdentityKey: "fub:1:+12105550111", active: true },
  { id: 11, fubIdentityKey: "fub:2:+12105550102", active: true },
];
type Call = { url: string; init?: RequestInit };
function mockFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => { const call = { url: String(input), init }; calls.push(call); return handler(call); });
  return calls;
}

const pruneResult = { scanned: 3, expiredRows: 1, staleRows: 0, rowsDeleted: 1, objectsDeleted: 1, objectsFailed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FUB_API_KEY", "test-key");
  mocks.getDealSettings.mockResolvedValue(settings);
  mocks.makeMatchingLeadsTeam.mockResolvedValue(0);
  mocks.revokeOrphanedTeamPreviewLinks.mockResolvedValue(1);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "sent", deliveryLog: "resend sent" });
  mocks.pruneDealPhotoRenders.mockResolvedValue(pruneResult);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Builder Deals maintenance utilities", () => {
  it("normalizes only valid North American FUB phone values", () => {
    expect(normalizeFubPhone("(210) 555-0123")).toBe("+12105550123");
    expect(normalizeFubPhone("+1 210 555 0123")).toBe("+12105550123");
    expect(normalizeFubPhone("not a phone")).toBeNull();
  });

  it("treats a FUB user as inactive only when FUB explicitly says so", () => {
    expect(isActiveFubUser({ id: 1, email: "a@b.co" })).toBe(true);
    expect(isActiveFubUser({ id: 1, status: "Active" })).toBe(true);
    expect(isActiveFubUser({ id: 1, status: "Pending Invite" })).toBe(true);
    expect(isActiveFubUser({ id: 1, status: "Inactive" })).toBe(false);
    expect(isActiveFubUser({ id: 1, active: false })).toBe(false);
    expect(isActiveFubUser({ id: 1, deleted: true })).toBe(false);
  });
});

describe("Builder Deals team allowlist mirror", () => {
  it("removes a user who left the mocked users list, keeps the rest, and runs the reverse cascade", async () => {
    const calls = mockFetch(() => jsonResponse({ users: [peter], _metadata: { total: 1 } }));
    const db = createFakeDealsDb([[dealTeamAllowlist, [{ id: 10 }]], [dealTeamAllowlist, [{ id: 12 }]], [dealTeamAllowlist, mirroredRows]]);
    mocks.getDb.mockResolvedValue(db);

    const result = await syncTeamAllowlistFromFub();
    expect(result).toMatchObject({ ok: true, usersFetched: 1, activeUsers: 1, upserted: 2, deactivated: 1, orphanedTeamLeads: 1 });
    // Every phone of the remaining user is mirrored; only Steven's row is deactivated.
    const deactivations = db.writes.filter((write) => write.op === "update" && write.table === dealTeamAllowlist && (write.set as { active?: boolean }).active === false);
    expect(deactivations).toHaveLength(1);
    expect(mocks.makeMatchingLeadsTeam).toHaveBeenCalledWith(db, { phoneE164: "+12105550101", email: "peter@lifestyledesignrealty.com" });
    expect(mocks.makeMatchingLeadsTeam).toHaveBeenCalledWith(db, { phoneE164: "+12105550111", email: "peter@lifestyledesignrealty.com" });
    expect(mocks.revokeOrphanedTeamPreviewLinks).toHaveBeenCalledWith(db);
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();
    expect(calls[0]!.url).not.toContain("fields=");
    expect(calls[0]!.url).toContain("limit=100");
  });

  it("mirrors a user whose record has no status or active field instead of deactivating the team", async () => {
    mockFetch(() => jsonResponse({ users: [{ id: 1, email: "peter@lifestyledesignrealty.com", phones: [{ value: "(210) 555-0101" }] }, { ...steven, active: false }] }));
    const db = createFakeDealsDb([[dealTeamAllowlist, [{ id: 10 }]], [dealTeamAllowlist, mirroredRows]]);
    mocks.getDb.mockResolvedValue(db);
    const result = await syncTeamAllowlistFromFub();
    expect(result).toMatchObject({ ok: true, usersFetched: 2, activeUsers: 1, upserted: 1 });
    const deactivatedRows = db.writes.filter((write) => write.op === "update" && write.table === dealTeamAllowlist && (write.set as { active?: boolean }).active === false);
    // Peter's second phone row (not in this mocked payload) and Steven's row go inactive; Peter's first row is refreshed.
    expect(deactivatedRows).toHaveLength(2);
    expect(db.writes.filter((write) => write.op === "update" && write.table === dealTeamAllowlist && (write.set as { active?: boolean }).active === true)).toHaveLength(1);
  });

  it("aborts without touching a row and emails the owners when FUB returns zero users", async () => {
    mockFetch(() => jsonResponse({ users: [] }));
    const db = createFakeDealsDb([[dealTeamAllowlist, mirroredRows]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(syncTeamAllowlistFromFub()).resolves.toMatchObject({ ok: false, reason: "fub_no_users", emailed: true, deactivated: 0 });
    expect(db.writes).toHaveLength(0);
    expect(mocks.revokeOrphanedTeamPreviewLinks).not.toHaveBeenCalled();
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledWith(expect.objectContaining({ category: "team_sync", recipients: settings.alertRecipients, subject: "Builder Deals team sync aborted", content: expect.stringContaining("zero users") }));
  });

  it("aborts with an email when every returned user is inactive or the users call errors", async () => {
    mockFetch(() => jsonResponse({ users: [{ ...peter, status: "Inactive" }] }));
    const db = createFakeDealsDb([[dealTeamAllowlist, mirroredRows]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(syncTeamAllowlistFromFub()).resolves.toMatchObject({ ok: false, reason: "fub_no_active_users", usersFetched: 1, activeUsers: 0, emailed: true });
    expect(db.writes).toHaveLength(0);

    mockFetch(() => new Response("upstream error", { status: 503 }));
    await expect(syncTeamAllowlistFromFub()).resolves.toMatchObject({ ok: false, reason: "fub_unavailable", emailed: true });
    expect(db.writes).toHaveLength(0);
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledTimes(2);
  });
});

const hoursAgo = (hours: number, now: Date) => new Date(now.getTime() - hours * 3_600_000);
type CommunityRow = { id: number; privateName: string; publicLabel: string; builder: string; manualMode: boolean; lastSuccessfulSyncAt: Date | null; catalogHoldReason: string | null; catalogHoldSeenAt: Date | null; incentiveHoldReason: string | null; incentiveHoldSeenAt: Date | null; holdReason: string | null };
/** Rows shaped exactly as dealsSync writes them: the two hold columns plus the summary column it derives with summarizeHolds. */
function communityRow(input: { id: number; privateName: string; publicLabel: string; builder?: string; manualMode?: boolean; lastSuccessfulSyncAt: Date | null; catalogHold?: { reason: string; seenAt: Date } | null; incentiveHold?: { reason: string; seenAt: Date } | null }): CommunityRow {
  const catalogHoldReason = input.catalogHold?.reason ?? null;
  const incentiveHoldReason = input.incentiveHold?.reason ?? null;
  return {
    id: input.id, privateName: input.privateName, publicLabel: input.publicLabel, builder: input.builder ?? "M/I Homes", manualMode: input.manualMode ?? false, lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
    catalogHoldReason, catalogHoldSeenAt: input.catalogHold?.seenAt ?? null, incentiveHoldReason, incentiveHoldSeenAt: input.incentiveHold?.seenAt ?? null,
    holdReason: summarizeHolds(catalogHoldReason, incentiveHoldReason),
  };
}
function snapshotDb(now: Date, options: { healthy?: boolean; communities?: CommunityRow[]; residueRows?: Array<{ detail: string | null }> } = {}) {
  const healthy = options.healthy ?? false;
  const communities = options.communities ?? (healthy
    ? [communityRow({ id: 7, privateName: "Private Grove", publicLabel: "Community A", lastSuccessfulSyncAt: hoursAgo(20, now) })]
    : [
      // A successful refresh whose incentive is held: the catalog is on schedule (daily), so this is an incentive hold only.
      communityRow({ id: 7, privateName: "Private Grove", publicLabel: "Community A", lastSuccessfulSyncAt: hoursAgo(20, now), incentiveHold: { reason: "missing_follow_on_rate (text abcd1234)", seenAt: hoursAgo(30, now) } }),
      communityRow({ id: 8, privateName: "Hidden Ranch", publicLabel: "Community B", lastSuccessfulSyncAt: hoursAgo(120, now) }),
      // A catalog hold recorded 50h ago on a community whose last good data is still within the daily limit.
      communityRow({ id: 9, privateName: "Quiet Meadow", publicLabel: "Community C", lastSuccessfulSyncAt: hoursAgo(40, now), catalogHold: { reason: "expected_community_container_not_found", seenAt: hoursAgo(50, now) } }),
    ]);
  return createFakeDealsDb([
    [dealEvents, [{ landed: 40, consented: 12, verificationSends: 9, verified: 7, listingViews: 6, requests: 2 }]],
    [dealEvents, options.residueRows ?? []],
    [dealLeads, [{ count: 5 }]],
    [dealLeads, [{ count: healthy ? 0 : 1 }]],
    [dealTrecImports, [{ completedAt: hoursAgo(healthy ? 10 : 40, now) }]],
    [dealCommunities, communities],
    [dealPhotos, [{ pending: healthy ? 0 : 1, processing: 0, failed: 0, oldestPendingAt: healthy ? null : new Date(now.getTime() - 90 * 60_000) }]],
    [dealFubJobs, [{ count: healthy ? 0 : 2 }]],
    [dealFubJobs, [{ count: healthy ? 0 : 1 }]],
    [dealIncentives, healthy ? [] : [{ id: 5, communityId: 7, holdReason: "Promotional rate needs its follow-on period", createdAt: hoursAgo(30, now) }]],
    [dealEmailLogs, [{ count: healthy ? 0 : 2 }]],
    [dealJobRuns, healthy ? [] : [{ jobName: "builder-deals-team-sync" }]],
    [dealJobRuns, [{ status: "ok", chicagoDay: "2026-10-17", completedAt: hoursAgo(24, now), startedAt: hoursAgo(24, now) }]],
  ]);
}
function mockServices(options: { balance?: string; accountStatus?: string; fubOk?: boolean } = {}) {
  return mockFetch((call) => {
    if (call.url.includes("api.twilio.com") && call.url.endsWith("/Balance.json")) return jsonResponse({ balance: options.balance ?? "12.50", currency: "USD" });
    if (call.url.includes("api.twilio.com")) return jsonResponse({ status: options.accountStatus ?? "active" });
    if (call.url.includes("followupboss.com")) return options.fubOk === false ? new Response("", { status: 401 }) : jsonResponse({ account: { id: 1 } });
    throw new Error(`unexpected request ${call.url}`);
  });
}

describe("Builder Deals daily health check", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");
  beforeEach(() => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "VAtest");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
  });

  it("applies the spec thresholds and reads the balance amount", async () => {
    mockServices({ balance: "12.50" });
    mocks.getDb.mockResolvedValue(snapshotDb(now));
    const health = await builderDealsHealthCheck(now);
    expect(BUILDER_DEALS_HEALTH_THRESHOLDS).toMatchObject({ twilioMinimumBalanceUsd: 20, pendingPhotoMinutes: 60, fubFailureMinutes: 60, trecImportHours: 36, communityUpdateHours: 48, emailFailureHours: 24, jobFailureHours: 24 });
    expect(health.twilioVerify).toMatchObject({ account: "active", balance: "low", balanceUsd: 12.5, currency: "USD", state: "attention" });
    expect(health.state).toBe("attention");
    expect(health.attention).toEqual(expect.arrayContaining([
      expect.stringContaining("$12.50"),
      expect.stringContaining("RESEND_FROM_EMAIL"),
      expect.stringContaining("TREC file is 40h old"),
      expect.stringContaining("Last builder update is over 2 days old for 1 of 3"),
      expect.stringContaining("1 community update is held"),
      expect.stringContaining("oldest pending 90 minutes"),
      expect.stringContaining("1 FUB write has been failing for over 60 minutes"),
      expect.stringContaining("2 alert emails failed to send in the last 24 hours"),
      expect.stringContaining("builder-deals-team-sync"),
      expect.stringContaining("1 incentive hold"),
    ]));
    // The held incentive on Private Grove is not a community-update hold; the catalog hold is as old as its seenAt column.
    expect(health.operational.holds.items).toEqual([
      expect.objectContaining({ kind: "community", communityId: 9, label: "Quiet Meadow (Community C)", reason: "expected_community_container_not_found", ageHours: 50 }),
      expect.objectContaining({ kind: "incentive", communityId: 7, label: "Private Grove (Community A)", ageHours: 30 }),
    ]);
    expect(health.operational.holds.items[0]!.since).toEqual(hoursAgo(50, now));
    expect(health.operational.sourceUpdates).toMatchObject({ activeCommunities: 3, staleCommunities: 1, heldCommunities: 1, state: "attention" });
    expect(health.attention.filter((item) => /community update/.test(item))).toHaveLength(1);
    expect(health.attention.some((item) => /residue/.test(item))).toBe(false);
  });

  it("reads the hold columns, not the summary: an incentive-only hold is never a community hold and a dismissed catalog hold is not a hold", async () => {
    mockServices({ balance: "250.00" });
    vi.stubEnv("RESEND_FROM_EMAIL", "deals@lifestyledesignrealty.com");
    mocks.getDb.mockResolvedValue(snapshotDb(now, { healthy: true, communities: [
      communityRow({ id: 7, privateName: "Private Grove", publicLabel: "Community A", lastSuccessfulSyncAt: hoursAgo(1, now), incentiveHold: { reason: "missing_follow_on_rate, missing_follow_on_period (text abcd1234)", seenAt: hoursAgo(1, now) } }),
      communityRow({ id: 8, privateName: "Hidden Ranch", publicLabel: "Community B", lastSuccessfulSyncAt: hoursAgo(2, now), catalogHold: { reason: "dismissed:community_fetch_failed", seenAt: hoursAgo(90, now) } }),
    ] }));
    const health = await builderDealsHealthCheck(now);
    expect(health.operational.sourceUpdates).toMatchObject({ activeCommunities: 2, staleCommunities: 0, heldCommunities: 0, state: "ok" });
    expect(health.operational.holds.items.filter((item) => item.kind === "community")).toEqual([]);
    expect(health.attention.some((item) => /community update/.test(item))).toBe(false);
    expect(health.state).toBe("ok");
  });

  it("leaves Manual-builder and manual-mode communities out of the stale and active counts and the message", async () => {
    mockServices({ balance: "250.00" });
    vi.stubEnv("RESEND_FROM_EMAIL", "deals@lifestyledesignrealty.com");
    mocks.getDb.mockResolvedValue(snapshotDb(now, { healthy: true, communities: [
      communityRow({ id: 7, privateName: "Private Grove", publicLabel: "Community A", lastSuccessfulSyncAt: hoursAgo(20, now) }),
      communityRow({ id: 8, privateName: "Hand Kept", publicLabel: "Community B", builder: "Manual", lastSuccessfulSyncAt: null }),
      communityRow({ id: 9, privateName: "Switched Off", publicLabel: "Community C", manualMode: true, lastSuccessfulSyncAt: hoursAgo(400, now), catalogHold: { reason: "expected_community_container_not_found", seenAt: hoursAgo(300, now) } }),
    ] }));
    const health = await builderDealsHealthCheck(now);
    expect(health.operational.sourceUpdates).toMatchObject({ activeCommunities: 1, staleCommunities: 0, heldCommunities: 0, oldestAgeHours: 20, state: "ok" });
    expect(health.operational.sourceUpdates.lastSuccessfulSyncAt).toEqual(hoursAgo(20, now));
    expect(health.attention.some((item) => /Last builder update|community update/.test(item))).toBe(false);
    const report = await builderDealsMondayReport(now);
    expect(report.body).toContain("0 of 1 active communities stale");
  });

  it("runs the render prune only inside the scheduled job; the admin health and Monday previews are read-only", async () => {
    mockServices({ balance: "250.00" });
    mocks.getDb.mockResolvedValue(snapshotDb(now, { healthy: true }));
    const preview = await builderDealsHealthCheck(now);
    expect(preview.renderPrune).toBeNull();
    const explicit = await builderDealsHealthCheck(now, { prune: false });
    expect(explicit.renderPrune).toBeNull();
    await builderDealsMondayReport(now);
    expect(mocks.pruneDealPhotoRenders).not.toHaveBeenCalled();

    mocks.getDb.mockResolvedValue(snapshotDb(now, { healthy: true }));
    const job = await runBuilderDealsHealthJob(now);
    expect(mocks.pruneDealPhotoRenders).toHaveBeenCalledTimes(1);
    expect(job.health.renderPrune).toEqual(pruneResult);
  });

  it("surfaces buyer-facing entries dropped for private residue (deal_events rows with the community id) in attention", async () => {
    mockServices({ balance: "250.00" });
    vi.stubEnv("RESEND_FROM_EMAIL", "deals@lifestyledesignrealty.com");
    mocks.getDb.mockResolvedValue(snapshotDb(now, { healthy: true, residueRows: [{ detail: privacyResidueDetail(7, "public", "0123456789abcdef") }, { detail: privacyResidueDetail(7, "gated", "fedcba9876543210") }, { detail: privacyResidueDetail(12, "gated", "00ff00ff00ff00ff") }] }));
    const health = await builderDealsHealthCheck(now);
    expect(health.operational.privacyResidue).toMatchObject({ dropped: 3, communityIds: [7, 12], state: "attention" });
    expect(health.state).toBe("attention");
    expect(health.attention).toEqual([expect.stringContaining("3 buyer-facing community entries were dropped for private residue in the last 24 hours (community ids 7, 12)")]);
    expect(health.attention[0]).not.toContain("—");
  });

  it("reports OK with no email when every check passes", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "deals@lifestyledesignrealty.com");
    mockServices({ balance: "250.00" });
    mocks.getDb.mockResolvedValue(snapshotDb(now, { healthy: true }));
    const result = await runBuilderDealsHealthJob(now);
    expect(result).toMatchObject({ ok: true, state: "ok", attention: [], emailed: false });
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();
  });

  it("emails the alert recipients the failing checks and every hold with its age when any check needs attention", async () => {
    mockServices({ balance: "12.50", fubOk: false });
    mocks.getDb.mockResolvedValue(snapshotDb(now));
    const result = await runBuilderDealsHealthJob(now);
    expect(result).toMatchObject({ ok: true, state: "attention", emailed: true });
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledTimes(1);
    const email = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { category: string; recipients: string[]; subject: string; content: string };
    expect(email.category).toBe("health");
    expect(email.recipients).toEqual(settings.alertRecipients);
    expect(email.subject).not.toContain("—");
    expect(email.content).toContain("Follow Up Boss credentials did not work");
    expect(email.content).toContain("Community update hold, Quiet Meadow (Community C): expected_community_container_not_found (hold age 50h");
    expect(email.content).toContain("Incentive hold, Private Grove (Community A): Promotional rate needs its follow-on period (hold age 30h");
    expect(email.content).not.toContain("Community update hold, Private Grove");
  });

  it("flags missing Twilio credentials instead of silently skipping the check", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    mockServices();
    mocks.getDb.mockResolvedValue(snapshotDb(now, { healthy: true }));
    const health = await builderDealsHealthCheck(now);
    expect(health.twilioVerify.account).toBe("not_checked");
    expect(health.attention).toEqual(expect.arrayContaining([expect.stringContaining("Twilio Verify credentials are missing")]));
  });

  it("returns ok:false when the attention email itself could not be delivered", async () => {
    mockServices();
    mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: false, status: "failed", deliveryLog: "resend failed", error: "Resend 403" });
    mocks.getDb.mockResolvedValue(snapshotDb(now));
    await expect(runBuilderDealsHealthJob(now)).resolves.toMatchObject({ ok: false, emailed: false, emailError: "Resend 403" });
  });
});

describe("Builder Deals Monday System OK email", () => {
  const now = new Date("2026-10-19T12:05:00.000Z");
  beforeEach(() => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "VAtest");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "deals@lifestyledesignrealty.com");
  });

  it("builds the body from the live check: last result, last builder update, balance, 7-day counts and holds", async () => {
    mockServices({ balance: "250.00" });
    mocks.getDb.mockResolvedValue(snapshotDb(now));
    const report = await builderDealsMondayReport(now);
    expect(report.subject).toContain("System OK");
    expect(report.subject).not.toContain("—");
    expect(report.body).not.toContain("—");
    expect(report.body).toContain("Last health check result: ATTENTION");
    expect(report.body).toContain("Last scheduled 7:00 AM check: ok on 2026-10-17");
    expect(report.body).toContain("Last builder update: Sun, Oct 18, 2026, 11:05 AM CDT (20h ago)");
    expect(report.body).toContain("balance $250.00 (alert under $20)");
    expect(report.body).toContain("Last 7 days: 7 verifications, 5 new leads, 9 code sends");
    expect(report.body).toContain("1 of 3 active communities stale");
    expect(report.body).toContain("Community update hold, Quiet Meadow (Community C): expected_community_container_not_found (hold age 50h");
    expect(report.body).toContain("Incentive hold, Private Grove (Community A)");
    expect(report.body).not.toContain("Community update hold, Private Grove");
    expect(report.body).toContain("TREC file: 40h old (limit 36h)");
  });

  it("sends the System OK email unconditionally, even when nothing needs attention", async () => {
    mockServices({ balance: "250.00" });
    mocks.getDb.mockResolvedValue(snapshotDb(now, { healthy: true }));
    const result = await sendBuilderDealsMondayReport(now);
    expect(result).toMatchObject({ ok: true, emailed: true, attention: [] });
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledWith(expect.objectContaining({ category: "weekly", recipients: settings.alertRecipients, subject: "Builder Deals System OK: all checks passed", content: expect.stringContaining("Holds: none.") }));
  });

  it("formats hold ages for both hold kinds", () => {
    expect(holdLines([])).toEqual(["Holds: none."]);
    expect(holdLines([{ kind: "incentive", communityId: 1, label: "Private Grove (Community A)", reason: "", since: null, ageHours: null }])[1]).toBe("- Incentive hold, Private Grove (Community A): no reason recorded (hold age unknown)");
  });
});
