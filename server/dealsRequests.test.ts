import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./dealsFubJobs", () => ({
  enqueueDealsRequestJobs: vi.fn(),
  runPendingDealsFubJobs: vi.fn(),
}));

import { getDb } from "./db";
import { hashSecret } from "./dealsService";
import { enqueueDealsRequestJobs } from "./dealsFubJobs";
import { createDealsHomeRequest } from "./dealsRequests";

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => rows,
        limit: () => rows,
      }),
    }),
  };
}

describe("Builder Deals request duplicate recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns duplicate:true when a concurrent home double-tap loses to the database unique key", async () => {
    const home = { id: 9, sourceKey: "private-home-9", status: "available" };
    const lead = { id: 4 };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(selectRows([home]))
        .mockReturnValueOnce(selectRows([lead]))
        .mockReturnValueOnce(selectRows([])),
      insert: vi.fn(() => ({
        values: vi
          .fn()
          .mockRejectedValue({ code: "ER_DUP_ENTRY", errno: 1062 }),
      })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(
      createDealsHomeRequest({
        leadId: lead.id,
        card: hashSecret(`deals-card:${home.sourceKey}`).slice(0, 20),
        requestType: "tour",
        preferredAt: new Date(Date.now() + 60 * 60_000),
        sourceCode: "sl1",
        deviceHash: "device",
      })
    ).resolves.toEqual({ ok: true, appended: true, duplicate: true });

    expect(enqueueDealsRequestJobs).not.toHaveBeenCalled();
  });
});
