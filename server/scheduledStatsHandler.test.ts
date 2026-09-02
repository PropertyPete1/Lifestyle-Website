/**
 * /api/scheduled/syncStats must never explain itself to a stranger.
 *
 * Before: the auth check shared a try/catch with the sync, so an anonymous
 * POST got a 500 carrying `error.stack` — server file paths and frames —
 * because ForbiddenError was caught by the same handler as a FUB failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
vi.mock("./statsSync", () => ({ syncStatsFromFub: vi.fn() }));

import { sdk } from "./_core/sdk";
import { syncStatsFromFub } from "./statsSync";
import { syncStatsHandler } from "./scheduledStatsHandler";

const auth = vi.mocked(sdk.authenticateRequest);
const sync = vi.mocked(syncStatsFromFub);

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}
const req = { originalUrl: "/api/scheduled/syncStats" } as never;

beforeEach(() => {
  auth.mockReset();
  sync.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("syncStatsHandler", () => {
  it("answers an unauthenticated caller with a bare 403 — no stack, no message", async () => {
    auth.mockRejectedValue(new Error("Invalid session cookie"));
    const res = fakeRes();
    await syncStatsHandler(req, res as never);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "cron-only" });
    expect(JSON.stringify(res.body)).not.toMatch(/stack|Invalid session/);
    expect(sync).not.toHaveBeenCalled();
  });

  it("refuses a signed-in human (not a cron identity)", async () => {
    auth.mockResolvedValue({ id: 1, openId: "u", isCron: false } as never);
    const res = fakeRes();
    await syncStatsHandler(req, res as never);
    expect(res.statusCode).toBe(403);
    expect(sync).not.toHaveBeenCalled();
  });

  it("runs the sync for a cron identity and reports the result", async () => {
    auth.mockResolvedValue({ id: -1, openId: "cron_x", isCron: true, taskUid: "t1" } as never);
    sync.mockResolvedValue({ updated: true, stats: { closedSales: 7 } as never });
    const res = fakeRes();
    await syncStatsHandler(req, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, updated: true, stats: { closedSales: 7 } });
  });

  it("reports a sync failure as 500 with the message only — the stack stays in the log", async () => {
    auth.mockResolvedValue({ id: -1, openId: "cron_x", isCron: true, taskUid: "t1" } as never);
    sync.mockRejectedValue(new Error("FUB /deals → 502"));
    const res = fakeRes();
    await syncStatsHandler(req, res as never);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: "FUB /deals → 502" });
    expect(Object.keys(res.body as object)).not.toContain("stack");
    expect(console.error).toHaveBeenCalled();
  });
});
