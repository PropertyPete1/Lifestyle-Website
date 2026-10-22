import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getDb: vi.fn(),
  chicagoClock: vi.fn(),
  chicagoDay: vi.fn(),
  refreshDueCommunitiesBatch: vi.fn(),
  revalidateDealIncentives: vi.fn(),
  importTrecLicenses: vi.fn(),
  runBuilderDealsHealthJob: vi.fn(),
  sendBuilderDealsMondayReport: vi.fn(),
  cleanupDealsTestRecords: vi.fn(),
  syncKnownAgentsFromFub: vi.fn(),
  syncTeamAllowlistFromFub: vi.fn(),
  runPendingDealsFubJobs: vi.fn(),
  enqueueDailyActivityNote: vi.fn(),
  runScheduledDealPhotoDrain: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: {
    authenticateRequest: (...args: unknown[]) =>
      mocks.authenticateRequest(...args),
  },
}));
vi.mock("./db", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
}));
vi.mock("./dealsService", () => ({
  chicagoClock: (...args: unknown[]) => mocks.chicagoClock(...args),
  chicagoDay: (...args: unknown[]) => mocks.chicagoDay(...args),
}));
vi.mock("./dealsSync", () => ({
  refreshDueCommunitiesBatch: (...args: unknown[]) =>
    mocks.refreshDueCommunitiesBatch(...args),
  revalidateDealIncentives: (...args: unknown[]) =>
    mocks.revalidateDealIncentives(...args),
  CATALOG_BATCH_BUDGET_MS: 20_000,
}));
vi.mock("./dealsTrec", () => ({
  importTrecLicenses: (...args: unknown[]) => mocks.importTrecLicenses(...args),
}));
vi.mock("./dealsMaintenance", () => ({
  runBuilderDealsHealthJob: (...args: unknown[]) =>
    mocks.runBuilderDealsHealthJob(...args),
  sendBuilderDealsMondayReport: (...args: unknown[]) =>
    mocks.sendBuilderDealsMondayReport(...args),
  cleanupDealsTestRecords: (...args: unknown[]) =>
    mocks.cleanupDealsTestRecords(...args),
  syncKnownAgentsFromFub: (...args: unknown[]) =>
    mocks.syncKnownAgentsFromFub(...args),
  syncTeamAllowlistFromFub: (...args: unknown[]) =>
    mocks.syncTeamAllowlistFromFub(...args),
}));
vi.mock("./dealsFubJobs", () => ({
  runPendingDealsFubJobs: (...args: unknown[]) =>
    mocks.runPendingDealsFubJobs(...args),
  enqueueDailyActivityNote: (...args: unknown[]) =>
    mocks.enqueueDailyActivityNote(...args),
}));
vi.mock("./dealsPhotos", () => ({
  runScheduledDealPhotoDrain: (...args: unknown[]) =>
    mocks.runScheduledDealPhotoDrain(...args),
  SCHEDULED_PHOTO_RESPOND_MS: 24_000,
  pruneDealPhotoRenders: () => Promise.resolve({ scanned: 0, expiredRows: 0, staleRows: 0, rowsDeleted: 0, objectsDeleted: 0, objectsFailed: 0 }),
}));

import { dealJobRuns } from "../drizzle/schema";
import { createFakeDealsDb } from "./dealsFubFakeDb.test-support";
import { SCHEDULED_RESPOND_MS, catalogCall, isDueAtChicago, scheduledDealsHandler } from "./scheduledDealsHandler";

function responseRecorder() {
  const json = vi.fn((body: unknown) => body);
  const response = {
    status: vi.fn(),
    json,
  } as unknown as Response;
  vi.mocked(response.status).mockReturnValue(response);
  return { response, json };
}

function runningJobDb() {
  const query = Object.assign([{ id: 42, status: "running" }], {
    limit: vi.fn(async () => [{ id: 42, status: "running" }]),
  });
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => query) })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
  };
}

beforeEach(() => {
  mocks.authenticateRequest.mockResolvedValue({
    isCron: true,
    taskUid: "cron-task",
  });
  mocks.chicagoClock.mockReturnValue({ hour: 6, minute: 0, weekday: "Mon" });
  mocks.chicagoDay.mockReturnValue("2026-10-18");
  mocks.refreshDueCommunitiesBatch.mockResolvedValue({ checked: 0, ok: 0, failed: 0, remaining: 0, stoppedForTime: false, digest: "waiting", results: [] });
  mocks.revalidateDealIncentives.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Builder Deals scheduled handler helpers", () => {
  it("accepts only the intended America/Chicago hourly window and weekday", () => {
    expect(
      isDueAtChicago({ hour: 18, minute: 14, weekday: "Mon" }, 18, 15)
    ).toBe(false);
    expect(
      isDueAtChicago({ hour: 18, minute: 15, weekday: "Mon" }, 18, 15)
    ).toBe(true);
    expect(
      isDueAtChicago({ hour: 18, minute: 59, weekday: "Mon" }, 18, 15)
    ).toBe(true);
    expect(
      isDueAtChicago({ hour: 19, minute: 0, weekday: "Mon" }, 18, 15)
    ).toBe(false);
    expect(
      isDueAtChicago({ hour: 7, minute: 5, weekday: "Tue" }, 7, 5, "Mon")
    ).toBe(false);
    expect(
      isDueAtChicago({ hour: 7, minute: 5, weekday: "Mon" }, 7, 5, "Mon")
    ).toBe(true);
  });

  it("runs the scheduled photo drain on every callback, at any hour, without a daily job record", async () => {
    mocks.runScheduledDealPhotoDrain.mockResolvedValue({ processed: 2, retried: 1, skipped: 0 });
    for (const hour of [3, 6, 13, 23]) {
      mocks.chicagoClock.mockReturnValue({ hour, minute: 0, weekday: "Mon" });
      const { response, json } = responseRecorder();
      await scheduledDealsHandler({ body: { job: "photos" } } as Request, response);
      expect(json).toHaveBeenCalledWith({ ok: true, result: { processed: 2, retried: 1, skipped: 0 } });
    }
    expect(mocks.runScheduledDealPhotoDrain).toHaveBeenCalledTimes(4);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("answers the photo and catalog calls within 26 s (inside the host's 30 s limit) even when their work hangs", async () => {
    expect(SCHEDULED_RESPOND_MS).toBeLessThanOrEqual(26_000);
    vi.useFakeTimers();
    try {
      mocks.runScheduledDealPhotoDrain.mockReturnValue(new Promise(() => undefined));
      const photos = responseRecorder();
      const photoCall = scheduledDealsHandler({ body: { job: "photos" } } as Request, photos.response);
      await vi.advanceTimersByTimeAsync(SCHEDULED_RESPOND_MS - 1);
      expect(photos.json).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await photoCall;
      expect(photos.json).toHaveBeenCalledWith({ ok: true, result: expect.objectContaining({ partial: true }) });

      mocks.chicagoClock.mockReturnValue({ hour: 9, minute: 1, weekday: "Mon" });
      mocks.refreshDueCommunitiesBatch.mockReturnValue(new Promise(() => undefined));
      const catalog = responseRecorder();
      const catalogCall = scheduledDealsHandler({ body: { job: "catalog" } } as Request, catalog.response);
      await vi.advanceTimersByTimeAsync(SCHEDULED_RESPOND_MS);
      await catalogCall;
      expect(catalog.json).toHaveBeenCalledWith({ ok: true, result: expect.objectContaining({ partial: true }) });
    } finally {
      vi.useRealTimers();
    }
  });

  it("enqueues the daily activity note only inside the 1:30 AM Chicago window", async () => {
    mocks.chicagoClock.mockReturnValue({ hour: 6, minute: 0, weekday: "Mon" });
    const early = responseRecorder();
    await scheduledDealsHandler({ body: { job: "activity" } } as Request, early.response);
    expect(early.json).toHaveBeenCalledWith({ ok: true, result: { skipped: "not_due_chicago" } });
    expect(mocks.enqueueDailyActivityNote).not.toHaveBeenCalled();

    mocks.chicagoClock.mockReturnValue({ hour: 1, minute: 31, weekday: "Mon" });
    const db = runningJobDb();
    mocks.getDb.mockResolvedValue(db);
    const due = responseRecorder();
    await scheduledDealsHandler({ body: { job: "activity" } } as Request, due.response);
    expect(due.json).toHaveBeenCalledWith({ ok: true, result: { skipped: "already_running" } });
  });

  it("runs a time-boxed catalog batch on every callback from 4 AM to 10 PM Chicago, and drains photos outside those hours, without a daily job record", async () => {
    mocks.runScheduledDealPhotoDrain.mockResolvedValue({ processed: 7 });
    for (const [hour, runs] of [[3, false], [4, true], [13, true], [21, true], [22, false]] as const) {
      mocks.refreshDueCommunitiesBatch.mockClear();
      mocks.chicagoClock.mockReturnValue({ hour, minute: 10, weekday: "Mon" });
      const { response, json } = responseRecorder();
      await scheduledDealsHandler({ body: { job: "catalog" } } as Request, response);
      expect(mocks.refreshDueCommunitiesBatch).toHaveBeenCalledTimes(runs ? 1 : 0);
      // The mocked batch finishes at once with nothing to do, so the rest of the call drains photos.
      expect(json).toHaveBeenCalledWith({ ok: true, result: runs ? expect.objectContaining({ checked: 0, photos: { processed: 7 } }) : { skipped: "outside_catalog_hours_chicago", photos: { processed: 7 } } });
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("a catalog call spends only its leftover budget on photos, after the builder checks, and none when the batch ran out of time", async () => {
    mocks.chicagoClock.mockReturnValue({ hour: 9, minute: 1, weekday: "Tue" });
    mocks.runScheduledDealPhotoDrain.mockResolvedValue({ processed: 3 });
    let now = 1_000_000;
    const order: string[] = [];
    mocks.refreshDueCommunitiesBatch.mockImplementation(async () => { order.push("catalog"); now += 6_000; return { checked: 2, stoppedForTime: false }; });
    mocks.runScheduledDealPhotoDrain.mockImplementation(async () => { order.push("photos"); return { processed: 3 }; });
    expect(await catalogCall(() => now)).toEqual({ checked: 2, stoppedForTime: false, photos: { processed: 3 } });
    expect(order).toEqual(["catalog", "photos"]);
    // 6 s of the 20 s budget went to builder pages: 14 s for photos, answered within 24 s of the call's start.
    expect(mocks.runScheduledDealPhotoDrain).toHaveBeenLastCalledWith({ budgetMs: 14_000, respondWithinMs: 18_000 });

    mocks.runScheduledDealPhotoDrain.mockClear();
    mocks.refreshDueCommunitiesBatch.mockImplementation(async () => { now += 20_000; return { checked: 5, stoppedForTime: true }; });
    expect(await catalogCall(() => now)).toEqual({ checked: 5, stoppedForTime: true });
    // Finished in time but under 3 s left: not worth a drain.
    mocks.refreshDueCommunitiesBatch.mockImplementation(async () => { now += 18_000; return { checked: 4, stoppedForTime: false }; });
    expect(await catalogCall(() => now)).toEqual({ checked: 4, stoppedForTime: false });
    expect(mocks.runScheduledDealPhotoDrain).not.toHaveBeenCalled();
  });
});

describe("Builder Deals once-per-day job records", () => {
  /** No run yet today: once() claims the (job, Chicago day) row, runs the work and records the outcome on that row. */
  const freshDb = () => createFakeDealsDb([[dealJobRuns, []]]);
  const runRows = (db: ReturnType<typeof createFakeDealsDb>) => db.writes.filter((write) => write.table === dealJobRuns);

  it("records an ok:false job result as failed so tomorrow's health check sees it, and an ok:true result as ok", async () => {
    mocks.chicagoClock.mockReturnValue({ hour: 7, minute: 2, weekday: "Tue" });
    mocks.runBuilderDealsHealthJob.mockResolvedValue({ ok: false, state: "attention", attention: ["x"], emailed: false, emailError: "Resend 403" });
    const failed = freshDb();
    mocks.getDb.mockResolvedValue(failed);
    const first = responseRecorder();
    await scheduledDealsHandler({ body: { job: "health" } } as Request, first.response);
    expect(first.response.status).toHaveBeenCalledWith(500);
    expect(runRows(failed)[1]).toMatchObject({ op: "update", set: { status: "failed" } });

    mocks.runBuilderDealsHealthJob.mockResolvedValue({ ok: true, state: "ok", attention: [], emailed: false });
    const succeeded = freshDb();
    mocks.getDb.mockResolvedValue(succeeded);
    const second = responseRecorder();
    await scheduledDealsHandler({ body: { job: "health" } } as Request, second.response);
    expect(second.json).toHaveBeenCalledWith({ ok: true, result: { ok: true, state: "ok", attention: [], emailed: false } });
    expect(runRows(succeeded)[1]).toMatchObject({ op: "update", set: { status: "ok" } });
    expect(mocks.runBuilderDealsHealthJob).toHaveBeenCalledTimes(2);
  });

  it("records the job's own reason on a failed run (not a generic line), with its result for diagnosis", async () => {
    mocks.chicagoClock.mockReturnValue({ hour: 1, minute: 46, weekday: "Wed" });
    mocks.syncKnownAgentsFromFub.mockResolvedValue({ ok: false, peopleFetched: 3_200, recruitTagged: 0, upserted: 0, skipped: 0, noteFetchFailures: 0, linksKilled: 0, skippedBy: {}, reason: "fub_rate_limited", detail: "/people page 33 (3,200 read so far): /people: HTTP 429 after 5 tries (Retry-After 10, context global)", fubRequests: 38, rateLimited: 5 });
    const db = freshDb();
    mocks.getDb.mockResolvedValue(db);
    const recorder = responseRecorder();
    await scheduledDealsHandler({ body: { job: "agents" } } as Request, recorder.response);
    expect(recorder.response.status).toHaveBeenCalledWith(500);
    expect(recorder.json).toHaveBeenCalledWith({ error: "reported ok:false: fub_rate_limited; /people page 33 (3,200 read so far): /people: HTTP 429 after 5 tries (Retry-After 10, context global)" });
    const set = runRows(db)[1]!.set as { status: string; detail: string };
    expect(set.status).toBe("failed");
    expect(set.detail.split("\n")[0]).toBe("reported ok:false: fub_rate_limited; /people page 33 (3,200 read so far): /people: HTTP 429 after 5 tries (Retry-After 10, context global)");
    expect(JSON.parse(set.detail.split("\n")[1]!)).toMatchObject({ peopleFetched: 3_200, rateLimited: 5 });
    expect(set.detail).not.toContain("scheduled operation reported no successful community");
  });

  it("names the email error of a health run whose alert could not be sent, and a thrown error as thrown", async () => {
    const { jobFailureReason } = await import("./scheduledDealsHandler");
    expect(jobFailureReason({ ok: false, emailed: false, emailError: "Owner notification was not accepted" })).toBe("reported ok:false: email: Owner notification was not accepted");
    expect(jobFailureReason([{ ok: false, reason: "community_fetch_failed" }, { ok: false, skipped: "paused" }])).toBe("no successful community (2 tried: community_fetch_failed, paused)");
    expect(jobFailureReason({ ok: false })).toBe("reported ok:false without a reason");
    mocks.chicagoClock.mockReturnValue({ hour: 1, minute: 46, weekday: "Wed" });
    mocks.syncKnownAgentsFromFub.mockRejectedValue(new Error("Database unavailable"));
    const db = freshDb();
    mocks.getDb.mockResolvedValue(db);
    await scheduledDealsHandler({ body: { job: "agents" } } as Request, responseRecorder().response);
    expect(runRows(db)[1]!.set).toMatchObject({ status: "failed", detail: "threw: Database unavailable" });
  });

  it("never stores or answers a database error's values: first line only, no params, quoted values replaced", async () => {
    mocks.chicagoClock.mockReturnValue({ hour: 1, minute: 46, weekday: "Wed" });
    mocks.syncKnownAgentsFromFub.mockRejectedValue(new Error("Failed query: insert into `deal_known_agents` (`name`, `phone_e164`, `email`) values (?, ?, ?)\nparams: Jane Doe,+12105550123,jane@example.com"));
    const db = freshDb();
    mocks.getDb.mockResolvedValue(db);
    const recorder = responseRecorder();
    await scheduledDealsHandler({ body: { job: "agents" } } as Request, recorder.response);
    const set = runRows(db)[1]!.set as { detail: string };
    expect(set.detail).toBe("threw: Failed query: insert into `deal_known_agents` (`name`, `phone_e164`, `email`) values (?, ?, ?)");
    expect(recorder.json).toHaveBeenCalledWith({ error: "Failed query: insert into `deal_known_agents` (`name`, `phone_e164`, `email`) values (?, ?, ?)" });

    mocks.syncKnownAgentsFromFub.mockRejectedValue(new Error("Duplicate entry '+12105550123-jane@example.com' for key 'idx_deal_known_agent_identity'"));
    const duplicate = freshDb();
    mocks.getDb.mockResolvedValue(duplicate);
    const second = responseRecorder();
    await scheduledDealsHandler({ body: { job: "agents" } } as Request, second.response);
    expect((runRows(duplicate)[1]!.set as { detail: string }).detail).toBe("threw: Duplicate entry '?' for key '?'");
    expect(JSON.stringify(second.json.mock.calls)).not.toMatch(/2105550123|jane@/);
  });

  it("redacts a value that holds its own apostrophe, and masks phone, e-mail and long numbers in every stored result", async () => {
    const { redactJobError, maskPersonalData } = await import("./dealsJobRuns");
    expect(redactJobError("Duplicate entry 'O'Brien-+12105551234' for key 'idx_deal_known_agent'")).toBe("Duplicate entry '?' for key '?'");
    expect(redactJobError("Incorrect string value: 'O'Neil \\xF0\\x9F' for column 'name' at row 1")).toBe("Incorrect string value: '?' for column '?' at row 1");
    expect(redactJobError("Data too long for column 'email' at row 3 (jane.o'neil@example.com)")).not.toMatch(/jane|example/);
    expect(redactJobError("lookup failed for (210) 555-0123 and 12105550123 and account 9876543210")).toBe("lookup failed for [phone] and [phone] and account [phone]");
    expect(maskPersonalData("call +1 210.555.0123, write jane@example.com, card 4111111111111111; 3,200 people, 2026-10-21")).toBe("call [phone], write [email], card [number]; 3,200 people, 2026-10-21");
    mocks.chicagoClock.mockReturnValue({ hour: 1, minute: 46, weekday: "Wed" });
    // A successful run's stored result is masked too.
    mocks.syncKnownAgentsFromFub.mockResolvedValue({ ok: true, peopleFetched: 3, note: "parked number 210-555-0199 for jo@agents.test", ref: "acct 123456789" });
    const db = freshDb();
    mocks.getDb.mockResolvedValue(db);
    await scheduledDealsHandler({ body: { job: "agents" } } as Request, responseRecorder().response);
    const stored = (runRows(db)[1]!.set as { status: string; detail: string });
    expect(stored.status).toBe("ok");
    expect(JSON.parse(stored.detail)).toEqual({ ok: true, peopleFetched: 3, note: "parked number [phone] for [email]", ref: "acct [number]" });
    // And a failed one's reason line and result.
    mocks.syncKnownAgentsFromFub.mockResolvedValue({ ok: false, reason: "fub_unavailable", detail: "person jo@agents.test (210) 555-0199", peopleFetched: 0 });
    const failed = freshDb();
    mocks.getDb.mockResolvedValue(failed);
    await scheduledDealsHandler({ body: { job: "agents" } } as Request, responseRecorder().response);
    expect((runRows(failed)[1]!.set as { detail: string }).detail).not.toMatch(/jo@agents|555-0199/);
  });
});
