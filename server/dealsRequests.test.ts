import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./dealsFubJobs", () => ({
  enqueueDealsRequestJobs: vi.fn(),
  runPendingDealsFubJobs: vi.fn(),
  requestTestMode: vi.fn(),
}));
vi.mock("./dealsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsService")>()),
  logDealEvent: vi.fn(),
}));

import { getDb } from "./db";
import { dealsCardHandle, logDealEvent } from "./dealsService";
import { enqueueDealsRequestJobs, requestTestMode, runPendingDealsFubJobs } from "./dealsFubJobs";
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

const home = { id: 9, sourceKey: "private-home-9", status: "available" };
const lead = { id: 4, phoneE164: "+12105550300" };
const request = () => createDealsHomeRequest({
  leadId: lead.id,
  card: dealsCardHandle(`${home.sourceKey}`),
  requestType: "tour",
  preferredAt: new Date(Date.now() + 60 * 60_000),
  sourceCode: "sl1",
  deviceHash: "device",
});
/** Home lookup, lead lookup, then the empty same-day request list; the insert reports the new row id. */
function dbForNewRequest() {
  return {
    select: vi.fn()
      .mockReturnValueOnce(selectRows([home]))
      .mockReturnValueOnce(selectRows([lead]))
      .mockReturnValueOnce(selectRows([])),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([{ insertId: 41, affectedRows: 1 }]) })),
  };
}

describe("Builder Deals request duplicate recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestTestMode).mockResolvedValue({ isTest: false, quiet: false });
    vi.mocked(runPendingDealsFubJobs).mockResolvedValue({ sent: 0, failed: 0, skipped: 0, leased: 0 });
  });

  it("returns duplicate:true when a concurrent home double-tap loses to the database unique key", async () => {
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

    await expect(request()).resolves.toEqual({ ok: true, appended: true, duplicate: true });

    expect(enqueueDealsRequestJobs).not.toHaveBeenCalled();
  });
});

describe("Builder Deals requests respect toggle (c)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runPendingDealsFubJobs).mockResolvedValue({ sent: 0, failed: 0, skipped: 0, leased: 0 });
  });

  it("stores the request but queues no FUB task, note or email for a test number while the full pipeline is off", async () => {
    vi.mocked(requestTestMode).mockResolvedValue({ isTest: true, quiet: true });
    const db = dbForNewRequest();
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(request()).resolves.toEqual({ ok: true, appended: false, duplicate: false, quietTest: true });
    expect(requestTestMode).toHaveBeenCalledWith(lead.phoneE164);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(enqueueDealsRequestJobs).not.toHaveBeenCalled();
    expect(runPendingDealsFubJobs).not.toHaveBeenCalled();
    expect(logDealEvent).toHaveBeenCalledWith(expect.objectContaining({ leadId: lead.id, kind: "tour_request", detail: "tour" }));
  });

  it("queues the task, note and email rows for a live lead and for a test number with the full pipeline on", async () => {
    for (const mode of [{ isTest: false, quiet: false }, { isTest: true, quiet: false }]) {
      vi.mocked(requestTestMode).mockResolvedValue(mode);
      vi.mocked(getDb).mockResolvedValue(dbForNewRequest() as never);
      await expect(request()).resolves.toEqual({ ok: true, appended: false, duplicate: false, quietTest: false });
    }
    expect(enqueueDealsRequestJobs).toHaveBeenCalledTimes(2);
    expect(enqueueDealsRequestJobs).toHaveBeenCalledWith(lead.id, 41, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(runPendingDealsFubJobs).toHaveBeenCalledTimes(2);
  });
});
