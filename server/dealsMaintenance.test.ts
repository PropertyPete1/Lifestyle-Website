import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDealSettings: vi.fn(),
  makeMatchingLeadsTeam: vi.fn(),
  revokeOrphanedTeamPreviewLinks: vi.fn(),
  sendBuilderDealsEmail: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsPhotos", () => ({ pruneDealPhotoRenders: () => Promise.resolve({ scanned: 0, expiredRows: 0, staleRows: 0, rowsDeleted: 0, objectsDeleted: 0, objectsFailed: 0 }) }));
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FUB_API_KEY", "test-key");
  mocks.getDealSettings.mockResolvedValue(settings);
  mocks.makeMatchingLeadsTeam.mockResolvedValue(0);
  mocks.revokeOrphanedTeamPreviewLinks.mockResolvedValue(1);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "sent", deliveryLog: "resend sent" });
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
function snapshotDb(now: Date, options: { healthy?: boolean } = {}) {
  const healthy = options.healthy ?? false;
  return createFakeDealsDb([
    [dealEvents, [{ landed: 40, consented: 12, verificationSends: 9, verified: 7, listingViews: 6, requests: 2 }]],
    [dealLeads, [{ count: 5 }]],
    [dealLeads, [{ count: healthy ? 0 : 1 }]],
    [dealTrecImports, [{ completedAt: hoursAgo(healthy ? 10 : 40, now) }]],
    [dealCommunities, healthy
      ? [{ id: 7, privateName: "Private Grove", publicLabel: "Community A", lastSuccessfulSyncAt: hoursAgo(20, now), holdReason: null }]
      : [
        { id: 7, privateName: "Private Grove", publicLabel: "Community A", lastSuccessfulSyncAt: hoursAgo(50, now), holdReason: "Homes container missing" },
        { id: 8, privateName: "Hidden Ranch", publicLabel: "Community B", lastSuccessfulSyncAt: hoursAgo(120, now), holdReason: null },
      ]],
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
    expect(BUILDER_DEALS_HEALTH_THRESHOLDS).toMatchObject({ twilioMinimumBalanceUsd: 20, pendingPhotoMinutes: 60, fubFailureMinutes: 60, trecImportHours: 36, communityUpdateHours: 96, emailFailureHours: 24, jobFailureHours: 24 });
    expect(health.twilioVerify).toMatchObject({ account: "active", balance: "low", balanceUsd: 12.5, currency: "USD", state: "attention" });
    expect(health.state).toBe("attention");
    expect(health.attention).toEqual(expect.arrayContaining([
      expect.stringContaining("$12.50"),
      expect.stringContaining("RESEND_FROM_EMAIL"),
      expect.stringContaining("TREC file is 40h old"),
      expect.stringContaining("Last builder update is over 4 days old for 1 of 2"),
      expect.stringContaining("1 community update is held"),
      expect.stringContaining("oldest pending 90 minutes"),
      expect.stringContaining("1 FUB write has been failing for over 60 minutes"),
      expect.stringContaining("2 alert emails failed to send in the last 24 hours"),
      expect.stringContaining("builder-deals-team-sync"),
      expect.stringContaining("1 incentive hold"),
    ]));
    expect(health.operational.holds.items).toEqual([
      expect.objectContaining({ kind: "community", label: "Private Grove (Community A)", reason: "Homes container missing", ageHours: 50 }),
      expect.objectContaining({ kind: "incentive", label: "Private Grove (Community A)", ageHours: 30 }),
    ]);
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
    expect(email.content).toContain("Community update hold, Private Grove (Community A): Homes container missing (hold age 50h");
    expect(email.content).toContain("Incentive hold, Private Grove (Community A): Promotional rate needs its follow-on period (hold age 30h");
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
    expect(report.body).toContain("Last builder update: Sat, Oct 17, 2026, 5:05 AM CDT (50h ago)");
    expect(report.body).toContain("balance $250.00 (alert under $20)");
    expect(report.body).toContain("Last 7 days: 7 verifications, 5 new leads, 9 code sends");
    expect(report.body).toContain("Community update hold, Private Grove (Community A): Homes container missing (hold age 50h");
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
