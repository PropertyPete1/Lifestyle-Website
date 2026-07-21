import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/heartbeat", () => ({
  listHeartbeatJobs: vi.fn(),
  createHeartbeatJob: vi.fn(),
}));

import { createHeartbeatJob, listHeartbeatJobs } from "./_core/heartbeat";
import {
  ensureStatsSyncCron,
  STATS_CRON_EXPRESSION,
  STATS_CRON_JOB_NAME,
  STATS_CRON_PATH,
} from "./registerCron";

const listMock = vi.mocked(listHeartbeatJobs);
const createMock = vi.mocked(createHeartbeatJob);

afterEach(() => {
  listMock.mockReset();
  createMock.mockReset();
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
