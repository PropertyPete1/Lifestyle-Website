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
      expect.objectContaining({ name: "builder-deals-fub-retry", cron: "17 0 * * * *", payload: { job: "fub" } }),
      expect.objectContaining({ name: "builder-deals-alert-digest", cron: "41 5 * * * *", payload: { job: "alerts" } }),
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

  it("runs the photo queue every 2 minutes on even minutes and the catalog on odd minutes, and moves earlier registrations over", () => {
    expect(DEALS_JOB_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "builder-deals-photo-queue", cron: "13 */2 * * * *", payload: { job: "photos" } }),
      expect.objectContaining({ name: "builder-deals-catalog-refresh", cron: "13 1-59/2 * * * *", payload: { job: "catalog" } }),
      expect.objectContaining({ name: "builder-deals-activity-note", cron: "47 30 6-12 * * *", payload: { job: "activity" } }),
    ]));
    const catalog = DEALS_JOB_DEFINITIONS.find((job) => job.payload.job === "catalog")!;
    const photoJob = DEALS_JOB_DEFINITIONS.find((job) => job.payload.job === "photos")!;
    // Earlier builds registered the catalog every 10 minutes and photos every 10 or 5: reconciled in place on the next boot.
    expect(dealsJobNeedsReconcile({ cronExpression: "0 */10 * * * *", callbackPath: DEALS_CRON_PATH, callbackPayload: '{"job":"catalog"}' }, catalog)).toBe(true);
    expect(dealsJobNeedsReconcile({ cronExpression: "0 */5 * * * *", callbackPath: DEALS_CRON_PATH, callbackPayload: '{"job":"photos"}' }, photoJob)).toBe(true);
    expect(dealsJobNeedsReconcile({ cronExpression: " 13 */2 * * * * ", callbackPath: DEALS_CRON_PATH, callbackPayload: '{"job":"photos"}' }, photoJob)).toBe(false);
  });

  it("adds two photo jobs half a minute apart, so a call starts every 30 s and none lands on the catalog's start", () => {
    const photoJobs = DEALS_JOB_DEFINITIONS.filter((job) => job.payload.job === "photos");
    expect(photoJobs.map((job) => [job.name, job.cron])).toEqual([
      ["builder-deals-photo-queue", "13 */2 * * * *"],
      ["builder-deals-photo-queue-b", "43 */2 * * * *"],
      ["builder-deals-photo-queue-c", "43 1-59/2 * * * *"],
    ]);
    expect(new Set(DEALS_JOB_DEFINITIONS.map((job) => job.name)).size).toBe(DEALS_JOB_DEFINITIONS.length);
    // Second-of-the-2-minute-cycle each call starts at: photo jobs and the catalog call never share a start.
    const startsInCycle = (cron: string) => { const [sec, min] = cron.split(" "); return min === "*/2" ? [Number(sec)] : [60 + Number(sec)]; };
    const starts = [...photoJobs.flatMap((job) => startsInCycle(job.cron)), ...startsInCycle(DEALS_JOB_DEFINITIONS.find((job) => job.payload.job === "catalog")!.cron)].sort((a, b) => a - b);
    expect(starts).toEqual([13, 43, 73, 103]);
  });

});

describe("ensureDealsCron error isolation", () => {
  it("keeps creating the remaining jobs when one is rejected", async () => {
    listMock.mockResolvedValue({ total: 0, actorUserId: "owner", jobs: [] });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rejected = DEALS_JOB_DEFINITIONS[2].name;
    createMock.mockImplementation(async (job: { name: string }) => {
      if (job.name === rejected) throw new Error("scheduler rejected the expression");
      return { taskUid: `task-${job.name}` };
    });

    await ensureDealsCron();

    expect(createMock).toHaveBeenCalledTimes(DEALS_JOB_DEFINITIONS.length);
    expect(spy).toHaveBeenCalledWith(`[cron] could not register ${rejected}:`, "scheduler rejected the expression");
    spy.mockRestore();
  });

  it("never starts a job on second :00, where the shared scheduler drops most fires, and no two jobs share a start", () => {
    for (const job of DEALS_JOB_DEFINITIONS) expect(job.cron.split(" ")[0], job.name).not.toBe("0");
    const starts = DEALS_JOB_DEFINITIONS.map((job) => job.cron);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("registers the catalog job on odd minutes with a compact expression", () => {
    const catalog = DEALS_JOB_DEFINITIONS.find((job) => job.payload.job === "catalog");
    expect(catalog?.cron).toBe("13 1-59/2 * * * *");
  });
});
