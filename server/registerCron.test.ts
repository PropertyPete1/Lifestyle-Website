import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/heartbeat", () => ({
  listHeartbeatJobs: vi.fn(),
  createHeartbeatJob: vi.fn(),
  updateHeartbeatJob: vi.fn(),
}));

import { createHeartbeatJob, listHeartbeatJobs, updateHeartbeatJob } from "./_core/heartbeat";
import {
  DEALS_CRON_PATH,
  DEALS_JOB_DEFINITIONS,
  dealsJobNeedsReconcile,
  ensureDealsCron,
  ensureStatsSyncCron,
  STATS_CRON_EXPRESSION,
  STATS_CRON_JOB_NAME,
  STATS_CRON_PATH,
} from "./registerCron";

const listMock = vi.mocked(listHeartbeatJobs);
const createMock = vi.mocked(createHeartbeatJob);
const updateMock = vi.mocked(updateHeartbeatJob);

afterEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
});

describe("ensureStatsSyncCron", () => {
  it("registers the daily stats-sync job when none exists", async () => {
    listMock.mockResolvedValue({ total: 0, actorUserId: "owner", jobs: [] });
    createMock.mockResolvedValue({ taskUid: "task-1" });

    await ensureStatsSyncCron();

    expect(createMock).toHaveBeenCalledTimes(1);
    const [job, session] = createMock.mock.calls[0];
    expect(job).toMatchObject({
      name: STATS_CRON_JOB_NAME,
      cron: STATS_CRON_EXPRESSION,
      path: STATS_CRON_PATH,
      method: "POST",
    });
    expect(session).toBe(""); // project-owner identity
  });

  it("is idempotent — does not re-create when the job already exists", async () => {
    listMock.mockResolvedValue({
      total: 1,
      actorUserId: "owner",
      jobs: [{ name: STATS_CRON_JOB_NAME } as never],
    });

    await ensureStatsSyncCron();

    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("Builder Deals cron registration", () => {
  it("defines distinct six-field cron callbacks with the intended hourly FUB and alert payloads", () => {
    expect(new Set(DEALS_JOB_DEFINITIONS.map((job) => job.name)).size).toBe(DEALS_JOB_DEFINITIONS.length);
    for (const job of DEALS_JOB_DEFINITIONS) {
      expect(job.cron.trim().split(/\s+/)).toHaveLength(6);
      expect(job.path).toBe(DEALS_CRON_PATH);
      expect(job.payload).toEqual({ job: expect.any(String) });
    }
    expect(DEALS_JOB_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "builder-deals-fub-retry", cron: "0 0 * * * *", payload: { job: "fub" } }),
      expect.objectContaining({ name: "builder-deals-alert-digest", cron: "0 5 * * * *", payload: { job: "alerts" } }),
    ]));
  });

  it("creates every missing Builder Deals definition once under the project owner", async () => {
    listMock.mockResolvedValue({ total: 0, actorUserId: "owner", jobs: [] });
    createMock.mockResolvedValue({ taskUid: "task-deals" });

    await ensureDealsCron();

    expect(createMock).toHaveBeenCalledTimes(DEALS_JOB_DEFINITIONS.length);
    expect(createMock.mock.calls).toEqual(DEALS_JOB_DEFINITIONS.map((job) => [
      expect.objectContaining({
        name: job.name,
        cron: job.cron,
        path: DEALS_CRON_PATH,
        method: "POST",
        payload: job.payload,
        description: job.description,
      }),
      "",
    ]));
  });

  it("leaves an identical existing Builder Deals job untouched and creates only the missing definitions", async () => {
    const existing = DEALS_JOB_DEFINITIONS[0];
    listMock.mockResolvedValue({
      total: 1,
      actorUserId: "owner",
      jobs: [{ name: existing.name, taskUid: "existing", cronExpression: existing.cron, callbackPath: existing.path, callbackPayload: JSON.stringify(existing.payload) } as never],
    });
    createMock.mockResolvedValue({ taskUid: "task-deals" });

    await ensureDealsCron();

    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(DEALS_JOB_DEFINITIONS.length - 1);
    expect(createMock.mock.calls.map(([job]) => job.name)).not.toContain(existing.name);
    expect(createMock.mock.calls.map(([job]) => job.name)).toEqual(DEALS_JOB_DEFINITIONS.slice(1).map((job) => job.name));
  });

  it("repairs a previously registered job whose callback payload was omitted", async () => {
    const existing = DEALS_JOB_DEFINITIONS[0];
    listMock.mockResolvedValue({ total: 1, actorUserId: "owner", jobs: [{ name: existing.name, taskUid: "legacy-job", cronExpression: existing.cron, callbackPath: existing.path, callbackPayload: "{}" } as never] });
    createMock.mockResolvedValue({ taskUid: "task-deals" });
    updateMock.mockResolvedValue({});

    await ensureDealsCron();

    expect(updateMock).toHaveBeenCalledWith("legacy-job", expect.objectContaining({ payload: existing.payload }), "");
  });

  it.each([
    ["cron expression", (job: (typeof DEALS_JOB_DEFINITIONS)[number]) => ({ cronExpression: "0 45 0,23 * * *", callbackPath: job.path, callbackPayload: JSON.stringify(job.payload) })],
    ["callback path", (job: (typeof DEALS_JOB_DEFINITIONS)[number]) => ({ cronExpression: job.cron, callbackPath: "/api/scheduled/legacy", callbackPayload: JSON.stringify(job.payload) })],
  ])("reconciles a registered catalog job whose %s differs so the Chicago window can be reached", async (_, stale) => {
    const catalog = DEALS_JOB_DEFINITIONS.find((job) => job.payload.job === "catalog")!;
    listMock.mockResolvedValue({ total: 1, actorUserId: "owner", jobs: [{ name: catalog.name, taskUid: "stale-catalog", ...stale(catalog) } as never] });
    createMock.mockResolvedValue({ taskUid: "task-deals" });
    updateMock.mockResolvedValue({});

    await ensureDealsCron();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith("stale-catalog", { cron: catalog.cron, path: catalog.path, method: "POST", payload: catalog.payload, description: catalog.description }, "");
    expect(createMock.mock.calls.map(([job]) => job.name)).not.toContain(catalog.name);
  });

  it("defines the photo queue every 10 minutes and the 1:30 AM Chicago activity-note candidates", () => {
    expect(DEALS_JOB_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "builder-deals-photo-queue", cron: "0 */10 * * * *", payload: { job: "photos" } }),
      expect.objectContaining({ name: "builder-deals-activity-note", cron: "0 30 6,7 * * *", payload: { job: "activity" } }),
    ]));
    expect(dealsJobNeedsReconcile({ cronExpression: " 0 0 11,12 * * * ", callbackPath: DEALS_CRON_PATH, callbackPayload: '{"job":"catalog"}' }, DEALS_JOB_DEFINITIONS.find((job) => job.payload.job === "catalog")!)).toBe(false);
  });
});
