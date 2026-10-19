import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeVerification: vi.fn(),
  getDealSettings: vi.fn(),
  enqueueDealsFubJob: vi.fn(),
  runPendingDealsFubJobs: vi.fn(),
  queueFirstUnlockAlert: vi.fn(),
  queueProfileFlagAlert: vi.fn(),
}));
vi.mock("./dealsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsService")>()),
  completeVerification: (...args: unknown[]) => mocks.completeVerification(...args),
  getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args),
}));
vi.mock("./dealsFubJobs", () => ({
  enqueueDealsFubJob: (...args: unknown[]) => mocks.enqueueDealsFubJob(...args),
  runPendingDealsFubJobs: (...args: unknown[]) => mocks.runPendingDealsFubJobs(...args),
}));
vi.mock("./dealsAlerts", () => ({
  queueFirstUnlockAlert: (...args: unknown[]) => mocks.queueFirstUnlockAlert(...args),
  queueProfileFlagAlert: (...args: unknown[]) => mocks.queueProfileFlagAlert(...args),
}));

import { registerDealsRoutes } from "./dealsRoutes";

const settings = { testModeFullPipeline: false, activeReelCodes: ["sl1"] };
const completed = { ok: true as const, token: "t".repeat(40), leadId: 31, expiresAt: new Date(Date.now() + 3_600_000), firstUnlock: true, reverifiedActive: false, isTeam: false, isTest: false, fubCheckDeferred: false, duplicate: false };

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerDealsRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.close(); await once(server, "close"); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDealSettings.mockResolvedValue(settings);
  mocks.enqueueDealsFubJob.mockResolvedValue(undefined);
  mocks.runPendingDealsFubJobs.mockResolvedValue({ sent: 0, failed: 0, skipped: 0, leased: 0 });
});

async function verify() {
  const response = await fetch(`${baseUrl}/deals/verify`, { method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "123456" }) });
  // The route hands off to a void promise; let it settle before asserting.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return response;
}

describe("Builder Deals verify route side effects", () => {
  it("hands the deferred FUB check to the outbox job and leaves the unlock alert to the job runner", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, fubCheckDeferred: true });
    const response = await verify();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/deals/v/${completed.token}`);
    expect(mocks.enqueueDealsFubJob).toHaveBeenCalledWith(31, "first_unlock", { reason: "returned for a new link", deferredCheck: true });
    expect(mocks.runPendingDealsFubJobs).toHaveBeenCalledWith(1);
    expect(mocks.queueFirstUnlockAlert).not.toHaveBeenCalled();
    expect(mocks.queueProfileFlagAlert).not.toHaveBeenCalled();
  });

  it("marks a second-device reverify with its reason", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, firstUnlock: false, reverifiedActive: true });
    await verify();
    expect(mocks.enqueueDealsFubJob).toHaveBeenCalledWith(31, "reverify", { reason: "re-verified on a second device", deferredCheck: false });
  });

  it("creates no FUB job (and therefore no alert) for a team member", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, isTeam: true });
    const response = await verify();
    expect(response.headers.get("location")).toBe(`/deals/v/${completed.token}`);
    expect(mocks.enqueueDealsFubJob).not.toHaveBeenCalled();
  });

  it("skips the spurious second-device note when a double-submitted verify returns the duplicate receipt", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, firstUnlock: false, reverifiedActive: true, duplicate: true });
    const response = await verify();
    expect(response.headers.get("location")).toBe(`/deals/v/${completed.token}`);
    expect(mocks.enqueueDealsFubJob).not.toHaveBeenCalled();
  });

  it("keeps test numbers out of FUB unless full-pipeline test mode is on", async () => {
    mocks.completeVerification.mockResolvedValue({ ...completed, isTest: true });
    await verify();
    expect(mocks.enqueueDealsFubJob).not.toHaveBeenCalled();
    mocks.getDealSettings.mockResolvedValue({ ...settings, testModeFullPipeline: true });
    await verify();
    expect(mocks.enqueueDealsFubJob).toHaveBeenCalledTimes(1);
  });

  it("still redirects the buyer when the outbox enqueue throws", async () => {
    mocks.completeVerification.mockResolvedValue(completed);
    mocks.enqueueDealsFubJob.mockRejectedValue(new Error("database down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await verify();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/deals/v/${completed.token}`);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
