import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDealSettings: vi.fn(),
  blockVerifiedDealsIdentity: vi.fn(),
  classifyDealsAccess: vi.fn(),
  sendBuilderDealsLeadToFub: vi.fn(),
  updateBuilderDealsLeadInFub: vi.fn(),
  updateBuilderDealsProfileInFub: vi.fn(),
  appendBuilderDealsActivity: vi.fn(),
  createBuilderDealsTourTask: vi.fn(),
  appendBuilderDealsTourTask: vi.fn(),
  createBuilderDealsRequestNote: vi.fn(),
  appendBuilderDealsRequestNote: vi.fn(),
  queueFirstUnlockAlert: vi.fn(),
  queueProfileFlagAlert: vi.fn(),
  queueAgentRequestAlert: vi.fn(),
  sendBuilderDealsEmail: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsService")>()),
  getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args),
  blockVerifiedDealsIdentity: (...args: unknown[]) => mocks.blockVerifiedDealsIdentity(...args),
}));
vi.mock("./dealsEligibility", () => ({ classifyDealsAccess: (...args: unknown[]) => mocks.classifyDealsAccess(...args) }));
vi.mock("./dealsFub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsFub")>()),
  sendBuilderDealsLeadToFub: (...args: unknown[]) => mocks.sendBuilderDealsLeadToFub(...args),
  updateBuilderDealsLeadInFub: (...args: unknown[]) => mocks.updateBuilderDealsLeadInFub(...args),
  updateBuilderDealsProfileInFub: (...args: unknown[]) => mocks.updateBuilderDealsProfileInFub(...args),
  appendBuilderDealsActivity: (...args: unknown[]) => mocks.appendBuilderDealsActivity(...args),
  createBuilderDealsTourTask: (...args: unknown[]) => mocks.createBuilderDealsTourTask(...args),
  appendBuilderDealsTourTask: (...args: unknown[]) => mocks.appendBuilderDealsTourTask(...args),
  createBuilderDealsRequestNote: (...args: unknown[]) => mocks.createBuilderDealsRequestNote(...args),
  appendBuilderDealsRequestNote: (...args: unknown[]) => mocks.appendBuilderDealsRequestNote(...args),
}));
vi.mock("./dealsAlerts", () => ({
  queueFirstUnlockAlert: (...args: unknown[]) => mocks.queueFirstUnlockAlert(...args),
  queueProfileFlagAlert: (...args: unknown[]) => mocks.queueProfileFlagAlert(...args),
  queueAgentRequestAlert: (...args: unknown[]) => mocks.queueAgentRequestAlert(...args),
}));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));

import { dealClientLinks, dealCommunities, dealCommunityViews, dealEvents, dealFubJobs, dealFubRecords, dealHomes, dealLeads, dealTeamAllowlist, dealTourRequests } from "../drizzle/schema";
import { createFakeDealsDb, type FakeDealsDb } from "./dealsFubFakeDb.test-support";
import {
  LEASE_MS,
  UNLOCK_ALERT_MAX_WAIT_ATTEMPTS,
  chicagoDayRange,
  enqueueDealsActivityJobs,
  enqueueDealsRequestJobs,
  handleDealsProfileUpdate,
  previousChicagoDay,
  requestTestMode,
  runPendingDealsFubJobs,
  waitingForDeferredCheck,
} from "./dealsFubJobs";

const settings = { testNumbers: [] as string[], testTeamNumbers: [] as string[], testNumbersSkipChecks: true, testModeFullPipeline: false, brokerageDomains: ["kw.com"], fubRealtorTags: ["Recruit"], fubRealtorSources: ["Agent Scouting"], alertRecipients: ["peter@lifestyledesignrealty.com", "steven@lifestyledesignrealty.com"], alertMode: "immediate" as const };
const lead = {
  id: 31, phoneE164: "+12105550123", email: null, name: null, instagramHandle: "pete_buys", sourceCode: "sl1", timeline: null, status: "verified" as const,
  flags: JSON.stringify(["fub_check_deferred", "Possible Agent - Handle"]), consentText: "I agree.", consentAt: new Date("2026-10-18T15:00:00.000Z"), consentIp: "10.0.0.1", deviceHash: "d".repeat(64),
  expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null, fubPersonId: null, fubStatus: "pending" as const, createdAt: new Date(), updatedAt: new Date(),
};
function job(overrides: Partial<typeof dealFubJobs.$inferSelect> = {}): typeof dealFubJobs.$inferSelect {
  return { id: 1, leadId: lead.id, operation: "first_unlock", payload: JSON.stringify({ deferredCheck: true }), status: "pending", attempts: 0, lastError: null, nextAttemptAt: new Date(Date.now() - 1000), leaseToken: null, leasedAt: null, completedAt: null, createdAt: new Date(), ...overrides };
}
/**
 * Queues the candidate row, the leased re-reads of the same job and, for any
 * operation but first_unlock, the lead's first_unlock lookup (empty by default:
 * no deferred check pending) before the post-delivery payload re-read.
 */
function dbWithJob(row: typeof dealFubJobs.$inferSelect, leadRow: typeof dealLeads.$inferSelect | null = lead, extra: Array<[unknown, unknown[]]> = [], firstUnlockRows: Array<Partial<typeof dealFubJobs.$inferSelect>> = []) {
  const leased = { ...row, status: "leased", leaseToken: "lease-token", leasedAt: new Date() };
  const lookup: Array<[unknown, unknown[]]> = row.operation === "first_unlock" ? [] : [[dealFubJobs, [leased]], [dealFubJobs, firstUnlockRows], [dealFubJobs, [leased]]];
  return createFakeDealsDb([
    [dealFubJobs, [row]],
    [dealFubJobs, [leased]],
    ...lookup,
    [dealLeads, leadRow ? [leadRow] : []],
    ...extra,
  ]);
}
const firstUnlockRow = (overrides: Partial<typeof dealFubJobs.$inferSelect> = {}) => job({ id: 90, operation: "first_unlock", payload: JSON.stringify({ deferredCheck: true }), status: "failed", attempts: 2, lastError: "FUB check deferred: FUB is still unavailable", nextAttemptAt: new Date(Date.now() + 60_000), ...overrides });
const tourRequest = { id: 41, leadId: lead.id, homeId: 9, requestType: "tour" as const, preferredAt: new Date("2026-10-18T18:30:00.000Z"), chicagoDay: "2026-10-18", fubTaskId: null, fubNoteId: null, fubNoteSentAt: null, emailSentAt: null, createdAt: new Date("2026-10-18T15:00:00.000Z") };
const requestedHome = { id: 9, communityId: 7, privateAddress: "8106 Private Street", privatePlanName: "Hidden Plan", status: "available" };
const updatesOf = (db: FakeDealsDb, table: unknown) => db.writes.filter((write) => write.op === "update" && write.table === table).map((write) => write.set as Record<string, unknown>);
const insertsOf = (db: FakeDealsDb, table: unknown) => db.writes.filter((write) => write.op === "insert" && write.table === table).map((write) => write.values as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDealSettings.mockResolvedValue(settings);
  mocks.queueFirstUnlockAlert.mockResolvedValue({ queued: true });
  mocks.queueProfileFlagAlert.mockResolvedValue({ queued: true });
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "sent", deliveryLog: "resend sent" });
  mocks.blockVerifiedDealsIdentity.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe("Builder Deals same-day FUB outbox serialization", () => {
  it("uses one lead/Chicago-day operation key for task and note work across requests", async () => {
    const db = createFakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    await enqueueDealsRequestJobs(4, 41, "2026-10-18");
    await enqueueDealsRequestJobs(4, 42, "2026-10-18");
    expect(insertsOf(db, dealFubJobs)).toEqual([
      expect.objectContaining({ leadId: 4, operation: "request_task:2026-10-18", payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }) }),
      expect.objectContaining({ leadId: 4, operation: "request_note:2026-10-18", payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }) }),
      expect.objectContaining({ leadId: 4, operation: "request_email:41", payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }) }),
      expect.objectContaining({ leadId: 4, operation: "request_task:2026-10-18", payload: JSON.stringify({ requestId: 42, chicagoDay: "2026-10-18" }) }),
      expect.objectContaining({ leadId: 4, operation: "request_note:2026-10-18", payload: JSON.stringify({ requestId: 42, chicagoDay: "2026-10-18" }) }),
      expect.objectContaining({ leadId: 4, operation: "request_email:42", payload: JSON.stringify({ requestId: 42, chicagoDay: "2026-10-18" }) }),
    ]);
    expect(db.writes.filter((write) => write.op === "insert").every((write) => write.onDuplicate)).toBe(true);
  });

  it("reclaims an abandoned lease only after fifteen minutes", async () => {
    const db = createFakeDealsDb([[dealFubJobs, []]]);
    mocks.getDb.mockResolvedValue(db);
    const before = Date.now();
    await runPendingDealsFubJobs();
    const rendered = new MySqlDialect().sqlToQuery(db.selects[0]!.where as SQL);
    expect(rendered.sql).toContain("`leased_at` <");
    // Drizzle binds Date values as "YYYY-MM-DD HH:MM:SS.mmm" UTC strings.
    const dates = rendered.params.filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2} /.test(value)).map((value) => new Date(`${value.replace(" ", "T")}Z`).getTime());
    expect(LEASE_MS).toBe(15 * 60_000);
    expect(dates.some((value) => Math.abs(before - LEASE_MS - value) < 5_000)).toBe(true);
    expect(dates.some((value) => Math.abs(before - 5 * 60_000 - value) < 5_000)).toBe(false);
  });
});

describe("Builder Deals deferred realtor re-check in the job runner", () => {
  it("keeps retrying, sends nothing and alerts nobody while FUB is still unavailable", async () => {
    mocks.classifyDealsAccess.mockResolvedValue({ allowed: true, team: false, flags: ["fub_check_deferred"] });
    const db = dbWithJob(job());
    mocks.getDb.mockResolvedValue(db);

    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ failed: 1, sent: 0, leased: 1 });
    expect(mocks.classifyDealsAccess).toHaveBeenCalledWith(expect.objectContaining({ phone: lead.phoneE164, deviceHash: lead.deviceHash, fubTimeoutMs: 30_000 }));
    expect(mocks.sendBuilderDealsLeadToFub).not.toHaveBeenCalled();
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
    const failedUpdate = updatesOf(db, dealFubJobs).find((set) => set.status === "failed")!;
    expect(failedUpdate.nextAttemptAt).toBeInstanceOf(Date);
    expect(String(failedUpdate.lastError)).toContain("FUB check deferred");
  });

  it("blocks the verified identity, kills the link and skips the FUB event when the re-check matches a realtor", async () => {
    mocks.classifyDealsAccess.mockResolvedValue({ allowed: false, team: false, blockedBy: "fub_realtor", matchOn: "phone", flags: ["fub_realtor"] });
    const db = dbWithJob(job());
    mocks.getDb.mockResolvedValue(db);

    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ skipped: 1, failed: 0, sent: 0 });
    expect(mocks.blockVerifiedDealsIdentity).toHaveBeenCalledWith({ phone: lead.phoneE164, email: null, deviceHash: lead.deviceHash, reason: "fub_realtor" }, db);
    expect(updatesOf(db, dealLeads)).toEqual(expect.arrayContaining([expect.objectContaining({ status: "blocked", revokedAt: expect.any(Date) })]));
    expect(insertsOf(db, dealEvents)).toEqual([expect.objectContaining({ leadId: lead.id, kind: "blocked", detail: "fub_realtor:deferred_check" })]);
    expect(mocks.sendBuilderDealsLeadToFub).not.toHaveBeenCalled();
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
    expect(updatesOf(db, dealLeads).some((set) => set.fubStatus === "synced")).toBe(false);
  });

  it("strips the deferred flag, sends the event and queues the single unlock alert with FUB details when the re-check is clear", async () => {
    mocks.classifyDealsAccess.mockResolvedValue({ allowed: true, team: false, flags: [] });
    mocks.sendBuilderDealsLeadToFub.mockResolvedValue({ ok: true, personId: "9001", records: [{ kind: "person", fubId: "9001", createdByUs: true }], screening: { alreadyAssignedTo: "Jane Agent", previouslyOptedOut: true } });
    const db = dbWithJob(job());
    mocks.getDb.mockResolvedValue(db);

    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1, failed: 0 });
    expect(updatesOf(db, dealLeads)).toEqual(expect.arrayContaining([{ flags: JSON.stringify(["Possible Agent - Handle"]) }]));
    expect(mocks.sendBuilderDealsLeadToFub).toHaveBeenCalledWith(expect.objectContaining({ id: lead.id, phone: lead.phoneE164, flags: ["Possible Agent - Handle"], isTest: false }));
    expect(mocks.queueFirstUnlockAlert).toHaveBeenCalledTimes(1);
    expect(mocks.queueFirstUnlockAlert).toHaveBeenCalledWith(expect.objectContaining({ id: lead.id }), { flags: ["Possible Agent - Handle"], fubPersonId: "9001", alreadyAssignedTo: "Jane Agent", previouslyOptedOut: true, fubIssue: null, fubWarning: null });
    expect(insertsOf(db, dealFubRecords)).toEqual([expect.objectContaining({ leadId: lead.id, kind: "person", fubId: "9001", createdByUs: true })]);
    expect(updatesOf(db, dealFubJobs)).toEqual(expect.arrayContaining([expect.objectContaining({ status: "synced" })]));
    expect(updatesOf(db, dealLeads)).toEqual(expect.arrayContaining([expect.objectContaining({ fubStatus: "synced", fubPersonId: "9001" })]));
  });

  it("re-checks a returning lead too before the reverify note", async () => {
    mocks.classifyDealsAccess.mockResolvedValue({ allowed: true, team: false, flags: [] });
    mocks.updateBuilderDealsLeadInFub.mockResolvedValue({ ok: true, personId: "77", records: [{ kind: "person", fubId: "77", createdByUs: false }, { kind: "note", fubId: "800", createdByUs: true }] });
    const db = dbWithJob(job({ operation: "reverify", payload: JSON.stringify({ reason: "returned for a new link", occurrenceId: "2026-10-18T15:00:00.000Z", deferredCheck: true }) }));
    mocks.getDb.mockResolvedValue(db);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.classifyDealsAccess).toHaveBeenCalledTimes(1);
    expect(mocks.updateBuilderDealsLeadInFub).toHaveBeenCalledWith(expect.objectContaining({ id: lead.id }), "returned for a new link", "2026-10-18T15:00:00.000Z");
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
  });

  it("does not re-check when the job carries no deferred flag", async () => {
    mocks.sendBuilderDealsLeadToFub.mockResolvedValue({ ok: true, personId: "9001", records: [{ kind: "person", fubId: "9001", createdByUs: true }] });
    const db = dbWithJob(job({ payload: "{}" }), { ...lead, flags: "[]" });
    mocks.getDb.mockResolvedValue(db);
    await runPendingDealsFubJobs();
    expect(mocks.classifyDealsAccess).not.toHaveBeenCalled();
    expect(mocks.queueFirstUnlockAlert).toHaveBeenCalledWith(expect.objectContaining({ id: lead.id }), expect.objectContaining({ flags: [], fubPersonId: "9001", alreadyAssignedTo: null, previouslyOptedOut: false }));
  });
});

describe("Builder Deals unlock alert and failure handling in the job runner", () => {
  it("creates no FUB lead and no alert for a team member", async () => {
    const db = dbWithJob(job({ payload: "{}" }), { ...lead, status: "team", flags: "[]" });
    mocks.getDb.mockResolvedValue(db);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ skipped: 1 });
    expect(mocks.sendBuilderDealsLeadToFub).not.toHaveBeenCalled();
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
    expect(mocks.classifyDealsAccess).not.toHaveBeenCalled();
  });

  it("parks a terminal first_unlock failure (FUB 204) with no automatic retry and folds it into the unlock alert", async () => {
    mocks.sendBuilderDealsLeadToFub.mockResolvedValue({ ok: false, terminal: true, error: "FUB did not accept the lead event (HTTP 204)" });
    const db = dbWithJob(job({ payload: "{}" }), { ...lead, flags: "[]" });
    mocks.getDb.mockResolvedValue(db);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ failed: 1 });
    const failedUpdate = updatesOf(db, dealFubJobs).find((set) => set.status === "failed")!;
    expect(failedUpdate.nextAttemptAt).toBeNull();
    expect(mocks.queueFirstUnlockAlert).toHaveBeenCalledWith(expect.objectContaining({ id: lead.id }), expect.objectContaining({ fubPersonId: null, fubIssue: expect.stringContaining("204") }));
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();
    expect(updatesOf(db, dealLeads)).toEqual(expect.arrayContaining([{ fubStatus: "failed" }]));
  });

  it("emails the owners about a terminal failure that has no unlock alert to ride on", async () => {
    mocks.updateBuilderDealsLeadInFub.mockResolvedValue({ ok: false, terminal: true, error: "FUB did not accept the lead event (HTTP 204)" });
    const db = dbWithJob(job({ operation: "reverify", payload: JSON.stringify({ reason: "returned for a new link" }) }), { ...lead, flags: "[]" });
    mocks.getDb.mockResolvedValue(db);
    await runPendingDealsFubJobs();
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledWith(expect.objectContaining({ category: "fub_failure", recipients: settings.alertRecipients, subject: expect.not.stringContaining("—") }));
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
  });

  it("sends the unlock alert without FUB details once the FUB sync has stalled past the wait limit", async () => {
    mocks.sendBuilderDealsLeadToFub.mockResolvedValue({ ok: false, error: "FUB delivery failed" });
    const db = dbWithJob(job({ payload: "{}", attempts: UNLOCK_ALERT_MAX_WAIT_ATTEMPTS - 1 }), { ...lead, flags: "[]" });
    mocks.getDb.mockResolvedValue(db);
    await runPendingDealsFubJobs();
    expect(mocks.queueFirstUnlockAlert).toHaveBeenCalledWith(expect.objectContaining({ id: lead.id }), expect.objectContaining({ fubPersonId: null, fubIssue: "FUB delivery failed" }));
    expect(updatesOf(db, dealFubJobs).find((set) => set.status === "failed")!.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("waits for FUB before the alert while the first attempts are still retrying", async () => {
    mocks.sendBuilderDealsLeadToFub.mockResolvedValue({ ok: false, error: "FUB delivery failed" });
    const db = dbWithJob(job({ payload: "{}", attempts: 0 }), { ...lead, flags: "[]" });
    mocks.getDb.mockResolvedValue(db);
    await runPendingDealsFubJobs();
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
  });
});

describe("Builder Deals profile and activity outbox operations", () => {
  it("runs the profile_update operation through the union PUT and stores the person id without touching the sync badge", async () => {
    mocks.updateBuilderDealsProfileInFub.mockResolvedValue({ ok: true, personId: "9001", records: [{ kind: "person", fubId: "9001", createdByUs: false }] });
    const db = dbWithJob(job({ operation: "profile_update", payload: "{}" }), { ...lead, flags: "[]", name: "Pete Buyer", timeline: "0-3 months" });
    mocks.getDb.mockResolvedValue(db);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.updateBuilderDealsProfileInFub).toHaveBeenCalledWith(expect.objectContaining({ id: lead.id, name: "Pete Buyer", timeline: "0-3 months" }));
    expect(updatesOf(db, dealLeads)).toEqual([{ fubPersonId: "9001" }]);
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
  });

  it("handleDealsProfileUpdate enqueues the FUB job and the one follow-up flag alert, but never for team or quiet test leads", async () => {
    const db = createFakeDealsDb([[dealFubJobs, []]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(handleDealsProfileUpdate({ lead: { ...lead, status: "team" }, newFlags: ["Possible Agent - Handle"] })).resolves.toEqual({ queued: false, alerted: false });
    mocks.getDealSettings.mockResolvedValue({ ...settings, testNumbers: [lead.phoneE164] });
    await expect(handleDealsProfileUpdate({ lead, newFlags: ["Possible Agent - Handle"] })).resolves.toEqual({ queued: false, alerted: false });
    expect(insertsOf(db, dealFubJobs)).toHaveLength(0);
    expect(mocks.queueProfileFlagAlert).not.toHaveBeenCalled();

    mocks.getDealSettings.mockResolvedValue(settings);
    await expect(handleDealsProfileUpdate({ lead, newFlags: ["Possible Agent - TREC Name Match"] })).resolves.toEqual({ queued: true, alerted: true });
    expect(insertsOf(db, dealFubJobs)).toEqual([expect.objectContaining({ leadId: lead.id, operation: "profile_update" })]);
    expect(mocks.queueProfileFlagAlert).toHaveBeenCalledWith(lead, ["Possible Agent - TREC Name Match"]);
    await expect(handleDealsProfileUpdate({ lead, newFlags: [] })).resolves.toEqual({ queued: true, alerted: false });
    expect(mocks.queueProfileFlagAlert).toHaveBeenCalledTimes(1);
  });

  it("maps Chicago days to UTC bounds across the DST change and names the day that just closed", () => {
    expect(chicagoDayRange("2026-10-18")).toEqual({ start: new Date("2026-10-18T05:00:00.000Z"), end: new Date("2026-10-19T05:00:00.000Z") });
    expect(chicagoDayRange("2026-11-01")).toEqual({ start: new Date("2026-11-01T05:00:00.000Z"), end: new Date("2026-11-02T06:00:00.000Z") });
    expect(previousChicagoDay(new Date("2026-10-19T06:30:00.000Z"))).toBe("2026-10-18");
    expect(previousChicagoDay(new Date("2026-01-20T07:30:00.000Z"))).toBe("2026-01-19");
  });

  it("queues one activity:{day} job per lead with views or requests that day, skipping team, blocked and quiet test leads", async () => {
    const db = createFakeDealsDb([
      [dealCommunityViews, [{ leadId: 31, viewedAt: new Date("2026-10-18T15:00:00.000Z") }, { leadId: 32, viewedAt: new Date("2026-10-18T16:00:00.000Z") }, { leadId: 33, viewedAt: new Date("2026-10-18T17:00:00.000Z") }, { leadId: 34, viewedAt: new Date("2026-10-18T18:00:00.000Z") }]],
      [dealTourRequests, [{ leadId: 35 }]],
      [dealLeads, [{ id: 31, status: "verified", phoneE164: "+12105550123" }, { id: 32, status: "team", phoneE164: "+12105550124" }, { id: 33, status: "blocked", phoneE164: "+12105550125" }, { id: 34, status: "expired", phoneE164: "+12105550199" }, { id: 35, status: "verified", phoneE164: "+12105550126" }]],
    ]);
    mocks.getDb.mockResolvedValue(db);
    mocks.getDealSettings.mockResolvedValue({ ...settings, testNumbers: ["+12105550199"] });
    await expect(enqueueDealsActivityJobs("2026-10-18")).resolves.toEqual({ ok: true, chicagoDay: "2026-10-18", queued: 2, skipped: 3 });
    expect(insertsOf(db, dealFubJobs).map((row) => [row.leadId, row.operation])).toEqual([[31, "activity:2026-10-18"], [35, "activity:2026-10-18"]]);
  });

  it("builds the one-per-day activity note from community views and tour requests", async () => {
    mocks.appendBuilderDealsActivity.mockResolvedValue({ ok: true, personId: "9001", records: [{ kind: "person", fubId: "9001", createdByUs: false }, { kind: "note", fubId: "900", createdByUs: true }] });
    const db = dbWithJob(job({ operation: "activity:2026-10-18", payload: JSON.stringify({ chicagoDay: "2026-10-18" }) }), { ...lead, flags: "[]", fubPersonId: "9001" }, [
      [dealCommunityViews, [
        { id: 1, leadId: 31, communityId: 7, viewedAt: new Date("2026-10-18T15:00:00.000Z") },
        { id: 2, leadId: 31, communityId: 7, viewedAt: new Date("2026-10-18T20:00:00.000Z") },
        { id: 3, leadId: 31, communityId: 8, viewedAt: new Date("2026-10-18T16:00:00.000Z") },
      ]],
      [dealTourRequests, [{ id: 41, leadId: 31, homeId: 9, requestType: "tour", chicagoDay: "2026-10-18" }]],
      [dealCommunities, [{ id: 7, privateName: "Private Grove", publicLabel: "Community A" }, { id: 8, privateName: "Hidden Ranch", publicLabel: "Community B" }]],
    ]);
    mocks.getDb.mockResolvedValue(db);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1 });
    const [leadRef, day, detail] = mocks.appendBuilderDealsActivity.mock.calls[0]! as [Record<string, unknown>, string, string];
    expect(leadRef).toEqual({ id: 31, fubPersonId: "9001", phoneE164: lead.phoneE164, email: null });
    expect(day).toBe("2026-10-18");
    expect(detail).toContain("Private Grove (shown as Community A): 2 visits");
    expect(detail).toContain("Hidden Ranch (shown as Community B): 1 visit");
    expect(detail).toContain("Tour and question requests: 1");
    expect(insertsOf(db, dealFubRecords)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "note", fubId: "900", createdByUs: true })]));
    expect(updatesOf(db, dealLeads)).toEqual([]);
  });
});

describe("Builder Deals deferred realtor check gates every other FUB write for the lead", () => {
  it("parks a profile_update for retry while the lead's first_unlock row still carries an unsynced deferred check", async () => {
    const db = dbWithJob(job({ id: 2, operation: "profile_update", payload: "{}" }), { ...lead, flags: "[]", name: "Pete Buyer" }, [], [firstUnlockRow()]);
    mocks.getDb.mockResolvedValue(db);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ failed: 1, sent: 0, skipped: 0, leased: 1 });
    expect(mocks.updateBuilderDealsProfileInFub).not.toHaveBeenCalled();
    expect(mocks.classifyDealsAccess).not.toHaveBeenCalled();
    const failedUpdate = updatesOf(db, dealFubJobs).find((set) => set.status === "failed")!;
    expect(failedUpdate.lastError).toBe("waiting for deferred realtor check");
    expect(failedUpdate.nextAttemptAt).toBeInstanceOf(Date);
    // Not a lead-sync row: the lead's FUB badge is left alone and nobody is alerted.
    expect(updatesOf(db, dealLeads)).toEqual([]);
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();
  });

  it("holds a tour request task and its email the same way, so a 'Tour this home' tap cannot write to FUB before the realtor match", async () => {
    const db = dbWithJob(job({ id: 3, operation: "request_email:41", payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }) }), { ...lead, flags: "[]" }, [[dealTourRequests, [tourRequest]], [dealHomes, [requestedHome]]], [firstUnlockRow()]);
    mocks.getDb.mockResolvedValue(db);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ failed: 1 });
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();
    expect(updatesOf(db, dealTourRequests)).toEqual([]);
    expect(updatesOf(db, dealFubJobs).find((set) => set.status === "failed")!.lastError).toBe("waiting for deferred realtor check");
  });

  it("lets the other operations through once first_unlock is synced, or when it never deferred the check", async () => {
    mocks.updateBuilderDealsProfileInFub.mockResolvedValue({ ok: true, personId: "9001", records: [{ kind: "person", fubId: "9001", createdByUs: false }] });
    const synced = dbWithJob(job({ id: 2, operation: "profile_update", payload: "{}" }), { ...lead, flags: "[]", name: "Pete Buyer" }, [], [firstUnlockRow({ status: "synced", completedAt: new Date() })]);
    mocks.getDb.mockResolvedValue(synced);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1, failed: 0 });
    expect(mocks.updateBuilderDealsProfileInFub).toHaveBeenCalledTimes(1);

    const plain = dbWithJob(job({ id: 2, operation: "profile_update", payload: "{}" }), { ...lead, flags: "[]", name: "Pete Buyer" }, [], [firstUnlockRow({ payload: "{}" })]);
    mocks.getDb.mockResolvedValue(plain);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1, failed: 0 });
    expect(mocks.updateBuilderDealsProfileInFub).toHaveBeenCalledTimes(2);
  });

  it("never gates the first_unlock row itself", async () => {
    await expect(waitingForDeferredCheck({ leadId: lead.id, operation: "first_unlock" })).resolves.toBe(false);
    expect(mocks.getDb).not.toHaveBeenCalled();
    mocks.getDb.mockResolvedValue(createFakeDealsDb([[dealFubJobs, [firstUnlockRow()]]]));
    await expect(waitingForDeferredCheck({ leadId: lead.id, operation: "reverify" })).resolves.toBe(true);
    await expect(waitingForDeferredCheck({ leadId: lead.id, operation: "activity:2026-10-18" })).resolves.toBe(true);
  });
});

describe("Builder Deals tour and question requests respect toggle (c)", () => {
  const testLead = { ...lead, flags: "[]", phoneE164: "+12105550300" };

  it("classifies a test number as quiet only while the full pipeline is off", async () => {
    mocks.getDealSettings.mockResolvedValue({ ...settings, testNumbers: [testLead.phoneE164] });
    await expect(requestTestMode(testLead.phoneE164)).resolves.toEqual({ isTest: true, quiet: true });
    mocks.getDealSettings.mockResolvedValue({ ...settings, testNumbers: [testLead.phoneE164], testModeFullPipeline: true });
    await expect(requestTestMode(testLead.phoneE164)).resolves.toEqual({ isTest: true, quiet: false });
    await expect(requestTestMode(lead.phoneE164)).resolves.toEqual({ isTest: false, quiet: false });
  });

  it("creates no FUB task, no FUB note and no email for a test number with the full pipeline off", async () => {
    mocks.getDealSettings.mockResolvedValue({ ...settings, testNumbers: [testLead.phoneE164] });
    for (const operation of ["request_task:2026-10-18", "request_note:2026-10-18", "request_email:41"] as const) {
      const db = dbWithJob(job({ id: 5, operation, payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }) }), testLead, [[dealTourRequests, [tourRequest]], [dealHomes, [requestedHome]]]);
      mocks.getDb.mockResolvedValue(db);
      await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ skipped: 1, failed: 0, sent: 0 });
      expect(updatesOf(db, dealTourRequests)).toEqual([]);
      expect(updatesOf(db, dealFubJobs)).toEqual(expect.arrayContaining([expect.objectContaining({ status: "synced" })]));
    }
    expect(mocks.createBuilderDealsTourTask).not.toHaveBeenCalled();
    expect(mocks.createBuilderDealsRequestNote).not.toHaveBeenCalled();
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();
  });

  it("with the full pipeline on, everything the test request creates is marked TEST", async () => {
    mocks.getDealSettings.mockResolvedValue({ ...settings, testNumbers: [testLead.phoneE164], testModeFullPipeline: true });
    mocks.createBuilderDealsTourTask.mockResolvedValue({ ok: true, personId: "9001", taskId: "T1", records: [{ kind: "person", fubId: "9001", createdByUs: false }, { kind: "task", fubId: "T1", createdByUs: true }] });
    mocks.createBuilderDealsRequestNote.mockResolvedValue({ ok: true, personId: "9001", records: [{ kind: "person", fubId: "9001", createdByUs: false }, { kind: "note", fubId: "N1", createdByUs: true }] });

    const task = dbWithJob(job({ id: 5, operation: "request_task:2026-10-18", payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }) }), testLead, [[dealTourRequests, [tourRequest]], [dealHomes, [requestedHome]]]);
    mocks.getDb.mockResolvedValue(task);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.createBuilderDealsTourTask).toHaveBeenCalledWith(expect.objectContaining({ lead: expect.objectContaining({ id: lead.id, phoneE164: testLead.phoneE164, isTest: true }), privateDescription: "8106 Private Street (Hidden Plan)" }));
    expect(updatesOf(task, dealTourRequests)).toEqual(expect.arrayContaining([{ fubTaskId: "T1" }]));

    const note = dbWithJob(job({ id: 6, operation: "request_note:2026-10-18", payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }) }), testLead, [[dealTourRequests, [tourRequest]], [dealHomes, [requestedHome]]]);
    mocks.getDb.mockResolvedValue(note);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.createBuilderDealsRequestNote).toHaveBeenCalledWith(expect.objectContaining({ lead: expect.objectContaining({ isTest: true }) }));

    const email = dbWithJob(job({ id: 7, operation: "request_email:41", payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }) }), testLead, [[dealTourRequests, [tourRequest]], [dealHomes, [requestedHome]]]);
    mocks.getDb.mockResolvedValue(email);
    await runPendingDealsFubJobs();
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledTimes(1);
    const sent = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { category: string; subject: string; content: string; recipients: string[] };
    expect(sent).toMatchObject({ category: "tour_request", recipients: settings.alertRecipients, subject: "TEST: Builder Deals tour request" });
    expect(sent.content).toContain("TEST RECORD");
    expect(sent.subject).not.toContain("—");
    expect(updatesOf(email, dealTourRequests)).toEqual([expect.objectContaining({ emailSentAt: expect.any(Date) })]);

    // A live lead's email carries no TEST marker.
    mocks.getDealSettings.mockResolvedValue(settings);
    const live = dbWithJob(job({ id: 8, operation: "request_email:41", payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }) }), { ...lead, flags: "[]" }, [[dealTourRequests, [tourRequest]], [dealHomes, [requestedHome]]]);
    mocks.getDb.mockResolvedValue(live);
    await runPendingDealsFubJobs();
    const liveEmail = mocks.sendBuilderDealsEmail.mock.calls[1]![0] as { subject: string; content: string };
    expect(liveEmail.subject).toBe("Builder Deals tour request");
    expect(liveEmail.content).not.toContain("TEST");
  });
});

describe("Builder Deals requests from an agent's client", () => {
  const teamRow = { id: 5, name: "Tiffany Agent", phoneE164: "+12105550101", email: "tiffany@example.com", fubUserId: "77", fubIdentityKey: "fub:77:+12105550101", source: "fub" as const, active: true, createdAt: new Date() };
  const agentClient = { ...lead, flags: "[]", name: "Maria Lopez", sourceCode: "agent", agentTeamId: 5, clientLinkId: 3 };

  it("emails the owners and queues the agent's own copy, names the client and the agent, and hands the task to the agent", async () => {
    const saveRequest = { ...tourRequest, id: 44, requestType: "save" as const };
    const email = dbWithJob(job({ id: 9, operation: "request_email:44", payload: JSON.stringify({ requestId: 44, chicagoDay: "2026-10-18" }) }), agentClient, [[dealTourRequests, [saveRequest]], [dealHomes, [{ ...requestedHome, price: 489_990 }]], [dealTeamAllowlist, [teamRow]]]);
    mocks.getDb.mockResolvedValue(email);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 0, failed: 0 });
    const sent = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { category: string; subject: string; content: string; recipients: string[] };
    expect(sent.category).toBe("home_saved");
    // The owners' email carries the admin pointer; the agent gets a copy of their own without it.
    expect(sent.recipients).toEqual(settings.alertRecipients);
    expect(sent.subject).toBe("Tiffany Agent's client: Builder Deals: a buyer saved a home");
    expect(sent.content).toContain("Tiffany Agent's client Maria Lopez saved 8106 Private Street (Hidden Plan), $489,990.");
    // The task job has not run yet, so the copy does not claim an assignment that has not happened.
    expect(sent.content).toContain("the FUB task for Tiffany Agent is still being created");
    expect(mocks.queueAgentRequestAlert).toHaveBeenCalledWith(expect.objectContaining({
      agent: { name: "Tiffany Agent", fubUserId: "77", email: "tiffany@example.com" },
      requestId: 44, requestType: "save", description: "8106 Private Street (Hidden Plan), $489,990", taskCreated: false, isTest: false,
    }));

    // Once the task exists, both copies say it is assigned.
    mocks.sendBuilderDealsEmail.mockClear();
    mocks.queueAgentRequestAlert.mockClear();
    const withTask = dbWithJob(job({ id: 19, operation: "request_email:44", payload: JSON.stringify({ requestId: 44, chicagoDay: "2026-10-18" }) }), agentClient, [[dealTourRequests, [{ ...saveRequest, fubTaskId: "T9" }]], [dealHomes, [{ ...requestedHome, price: 489_990 }]], [dealTeamAllowlist, [teamRow]]]);
    mocks.getDb.mockResolvedValue(withTask);
    await runPendingDealsFubJobs();
    expect((mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { content: string }).content).toContain("the FUB task is assigned to Tiffany Agent.");
    expect(mocks.queueAgentRequestAlert).toHaveBeenCalledWith(expect.objectContaining({ taskCreated: true }));

    mocks.createBuilderDealsTourTask.mockResolvedValue({ ok: true, taskId: "T9", records: [{ kind: "task", fubId: "T9", createdByUs: true }] });
    const task = dbWithJob(job({ id: 10, operation: "request_task:2026-10-18", payload: JSON.stringify({ requestId: 44, chicagoDay: "2026-10-18" }) }), agentClient, [[dealTourRequests, [saveRequest]], [dealHomes, [{ ...requestedHome, price: 489_990 }]], [dealTeamAllowlist, [teamRow]]]);
    mocks.getDb.mockResolvedValue(task);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.createBuilderDealsTourTask).toHaveBeenCalledWith(expect.objectContaining({ lead: expect.objectContaining({ agent: { name: "Tiffany Agent", fubUserId: "77", email: "tiffany@example.com" } }), privateDescription: "8106 Private Street (Hidden Plan), $489,990" }));
  });

  it("drops the agent once their team row is inactive: owners-only email, Peter's task", async () => {
    const inactive = { ...teamRow, active: false };
    const saveRequest = { ...tourRequest, id: 45, requestType: "save" as const };
    const email = dbWithJob(job({ id: 11, operation: "request_email:45", payload: JSON.stringify({ requestId: 45, chicagoDay: "2026-10-18" }) }), agentClient, [[dealTourRequests, [saveRequest]], [dealHomes, [requestedHome]], [dealTeamAllowlist, [inactive]]]);
    mocks.getDb.mockResolvedValue(email);
    await runPendingDealsFubJobs();
    const sent = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { subject: string; recipients: string[]; content: string };
    expect(sent.recipients).toEqual(settings.alertRecipients);
    expect(sent.subject).toBe("Builder Deals: a buyer saved a home");
    expect(sent.content).not.toContain("Tiffany");
    expect(mocks.queueAgentRequestAlert).not.toHaveBeenCalled();
  });

  it("keeps saves and tours in separate FUB tasks on the same day", async () => {
    const saveRequest = { ...tourRequest, id: 46, requestType: "save" as const, createdAt: new Date("2026-10-18T14:00:00.000Z") };
    mocks.createBuilderDealsTourTask.mockResolvedValue({ ok: true, taskId: "S1", records: [{ kind: "task", fubId: "S1", createdByUs: true }] });
    const saveTask = dbWithJob(job({ id: 12, operation: "save_task:2026-10-18", payload: JSON.stringify({ requestId: 46, chicagoDay: "2026-10-18" }) }), agentClient, [[dealTourRequests, [saveRequest]], [dealHomes, [requestedHome]], [dealTeamAllowlist, [teamRow]], [dealTourRequests, [saveRequest, tourRequest]]]);
    mocks.getDb.mockResolvedValue(saveTask);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1, failed: 0 });
    // Only the save is in the save task; the tour is never appended to it.
    expect(mocks.createBuilderDealsTourTask).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ id: 46, requestType: "save" }) }));
    expect(mocks.appendBuilderDealsTourTask).not.toHaveBeenCalled();
  });

  it("never announces a save the buyer took back before the jobs ran, and appends only new entries", async () => {
    const removed = { ...tourRequest, id: 47, requestType: "save" as const, removedAt: new Date() };
    const email = dbWithJob(job({ id: 13, operation: "request_email:47", payload: JSON.stringify({ requestId: 47, chicagoDay: "2026-10-18" }) }), agentClient, [[dealTourRequests, [removed]], [dealHomes, [requestedHome]], [dealTeamAllowlist, [teamRow]]]);
    mocks.getDb.mockResolvedValue(email);
    await runPendingDealsFubJobs();
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();

    // Day task already holds the first save; a second save is appended once, the removed one never.
    const inTask = { ...tourRequest, id: 48, requestType: "save" as const, fubTaskId: "S1", createdAt: new Date("2026-10-18T13:00:00.000Z") };
    const fresh = { ...tourRequest, id: 49, requestType: "save" as const, createdAt: new Date("2026-10-18T16:00:00.000Z") };
    mocks.appendBuilderDealsTourTask.mockResolvedValue({ ok: true, taskId: "S1", records: [{ kind: "task", fubId: "S1", createdByUs: true }] });
    const task = dbWithJob(job({ id: 14, operation: "save_task:2026-10-18", payload: JSON.stringify({ requestId: 49, chicagoDay: "2026-10-18" }) }), agentClient, [[dealTourRequests, [fresh]], [dealHomes, [requestedHome]], [dealTeamAllowlist, [teamRow]], [dealTourRequests, [inTask, { ...removed, id: 50 }, fresh]]]);
    mocks.getDb.mockResolvedValue(task);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.createBuilderDealsTourTask).not.toHaveBeenCalled();
    expect(mocks.appendBuilderDealsTourTask).toHaveBeenCalledTimes(1);
    expect(mocks.appendBuilderDealsTourTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: "S1", request: expect.objectContaining({ id: 49 }) }));
  });

  it("tells the truth about FUB ownership when the agent has no FUB user", async () => {
    const noFub = { ...teamRow, fubUserId: null };
    const saveRequest = { ...tourRequest, id: 51, requestType: "save" as const };
    const email = dbWithJob(job({ id: 15, operation: "request_email:51", payload: JSON.stringify({ requestId: 51, chicagoDay: "2026-10-18" }) }), agentClient, [[dealTourRequests, [saveRequest]], [dealHomes, [requestedHome]], [dealTeamAllowlist, [noFub]]]);
    mocks.getDb.mockResolvedValue(email);
    await runPendingDealsFubJobs();
    const sent = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { content: string };
    expect(sent.content).toContain("has no Follow Up Boss user yet, so the FUB task is assigned to Peter.");
  });

  it("re-runs a deferred realtor check as the gate did: an agent's live client skips the screening", async () => {
    mocks.classifyDealsAccess.mockResolvedValue({ allowed: true, team: false, flags: ["agent_client"] });
    mocks.sendBuilderDealsLeadToFub.mockResolvedValue({ ok: true, personId: "9003", records: [{ kind: "person", fubId: "9003", createdByUs: true }] });
    const db = dbWithJob(job(), agentClient, [[dealClientLinks, [{ id: 3, leadId: lead.id, revokedAt: null }]], [dealTeamAllowlist, [teamRow]]]);
    mocks.getDb.mockResolvedValue(db);
    await runPendingDealsFubJobs();
    expect(mocks.classifyDealsAccess).toHaveBeenCalledWith(expect.objectContaining({ phone: lead.phoneE164, clientLink: true }));
    // A turned-off link: the screening applies again.
    mocks.classifyDealsAccess.mockClear();
    const revoked = dbWithJob(job(), agentClient, [[dealClientLinks, [{ id: 3, leadId: lead.id, revokedAt: new Date() }]], [dealTeamAllowlist, [teamRow]]]);
    mocks.getDb.mockResolvedValue(revoked);
    await runPendingDealsFubJobs();
    expect(mocks.classifyDealsAccess).toHaveBeenCalledWith(expect.objectContaining({ clientLink: false }));
  });

  it("sends the agent to the first-unlock job so FUB assigns the contact to them", async () => {
    mocks.classifyDealsAccess.mockResolvedValue({ allowed: true, team: false, flags: ["agent_client"] });
    mocks.sendBuilderDealsLeadToFub.mockResolvedValue({ ok: true, personId: "9002", records: [{ kind: "person", fubId: "9002", createdByUs: true }] });
    const db = dbWithJob(job({ payload: JSON.stringify({}) }), agentClient, [[dealTeamAllowlist, [teamRow]]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(runPendingDealsFubJobs()).resolves.toMatchObject({ sent: 1 });
    expect(mocks.sendBuilderDealsLeadToFub).toHaveBeenCalledWith(expect.objectContaining({ id: lead.id, sourceCode: "agent", agent: { name: "Tiffany Agent", fubUserId: "77", email: "tiffany@example.com" } }));
  });
});
