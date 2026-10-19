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
