import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getDb: vi.fn(),
  chicagoClock: vi.fn(),
  chicagoDay: vi.fn(),
  refreshOfficialDealsIfDue: vi.fn(),
  revalidateDealIncentives: vi.fn(),
  importTrecLicenses: vi.fn(),
  runBuilderDealsHealthJob: vi.fn(),
  sendBuilderDealsMondayReport: vi.fn(),
  cleanupDealsTestRecords: vi.fn(),
  syncKnownAgentsFromFub: vi.fn(),
  syncTeamAllowlistFromFub: vi.fn(),
  runPendingDealsFubJobs: vi.fn(),
  enqueueDailyActivityNote: vi.fn(),
  processPendingDealPhotos: vi.fn(),
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
  refreshOfficialDealsIfDue: (...args: unknown[]) =>
    mocks.refreshOfficialDealsIfDue(...args),
  revalidateDealIncentives: (...args: unknown[]) =>
    mocks.revalidateDealIncentives(...args),
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
  processPendingDealPhotos: (...args: unknown[]) =>
    mocks.processPendingDealPhotos(...args),
  pruneDealPhotoRenders: () => Promise.resolve({ scanned: 0, expiredRows: 0, staleRows: 0, rowsDeleted: 0, objectsDeleted: 0, objectsFailed: 0 }),
}));

import { dealJobRuns } from "../drizzle/schema";
import { createFakeDealsDb } from "./dealsFubFakeDb.test-support";
import { isDueAtChicago, scheduledDealsHandler } from "./scheduledDealsHandler";

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
  mocks.refreshOfficialDealsIfDue.mockResolvedValue({ ok: true });
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

  it("drains the photo queue on every 10-minute callback without a daily job record", async () => {
    mocks.processPendingDealPhotos.mockResolvedValue({ processed: 2, retried: 1, skipped: 0 });
    const { response, json } = responseRecorder();

    await scheduledDealsHandler({ body: { job: "photos" } } as Request, response);

    expect(mocks.processPendingDealPhotos).toHaveBeenCalledWith(10);
    expect(json).toHaveBeenCalledWith({ ok: true, result: { processed: 2, retried: 1, skipped: 0 } });
    expect(mocks.getDb).not.toHaveBeenCalled();
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

  it("does not run catalog work when that Chicago-day job is already running", async () => {
    const db = runningJobDb();
    mocks.getDb.mockResolvedValue(db);
    const { response, json } = responseRecorder();

    await scheduledDealsHandler(
      { body: { job: "catalog" } } as Request,
      response
    );

    expect(json).toHaveBeenCalledWith({
      ok: true,
      result: { skipped: "already_running" },
    });
    expect(mocks.refreshOfficialDealsIfDue).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("Builder Deals once-per-day job records", () => {
  /** No run yet today: once() claims the (job, Chicago day) row, runs the work and records the outcome on that row. */
  const freshDb = () => createFakeDealsDb([[dealJobRuns, []]]);
  const runRows = (db: ReturnType<typeof createFakeDealsDb>) => db.writes.filter((write) => write.table === dealJobRuns);

  it("records a successful catalog run as ok with the result as detail and answers with the result", async () => {
    const result = [{ communityId: 1, reelCode: "vg1", ok: true }, { communityId: 2, reelCode: "sl1", ok: false, reason: "community_fetch_failed" }];
    mocks.refreshOfficialDealsIfDue.mockResolvedValue(result);
    const db = freshDb();
    mocks.getDb.mockResolvedValue(db);
    const { response, json } = responseRecorder();

    await scheduledDealsHandler({ body: { job: "catalog" } } as Request, response);

    expect(mocks.refreshOfficialDealsIfDue).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({ ok: true, result });
    expect(response.status).not.toHaveBeenCalled();
    const writes = runRows(db);
    expect(writes[0]).toMatchObject({ op: "insert", values: { jobName: "builder-deals-catalog-refresh", chicagoDay: "2026-10-18", status: "running" } });
    expect(writes[1]).toMatchObject({ op: "update", set: { status: "ok", detail: JSON.stringify(result), completedAt: expect.any(Date) } });
    expect(writes).toHaveLength(2);
  });

  it("records the run as failed and answers 500 when every due community is held", async () => {
    mocks.refreshOfficialDealsIfDue.mockResolvedValue([{ communityId: 1, reelCode: "vg1", ok: false, reason: "community_fetch_failed" }, { communityId: 2, reelCode: "sl1", ok: false, reason: "unlabelled_home_status" }]);
    const db = freshDb();
    mocks.getDb.mockResolvedValue(db);
    const { response, json } = responseRecorder();

    await scheduledDealsHandler({ body: { job: "catalog" } } as Request, response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "scheduled operation reported no successful community" });
    expect(runRows(db)[1]).toMatchObject({ op: "update", set: { status: "failed", detail: "scheduled operation reported no successful community", completedAt: expect.any(Date) } });
  });

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
});
