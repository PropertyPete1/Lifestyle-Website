import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { getDb } from "./db";
import { enqueueDealsRequestJobs } from "./dealsFubJobs";

describe("Builder Deals same-day FUB outbox serialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses one lead/Chicago-day operation key for task and note work across requests", async () => {
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onDuplicateKeyUpdate }));
    const db = { insert: vi.fn(() => ({ values })) };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await enqueueDealsRequestJobs(4, 41, "2026-10-18");
    await enqueueDealsRequestJobs(4, 42, "2026-10-18");

    expect(values.mock.calls.map(([value]) => value)).toEqual([
      expect.objectContaining({
        leadId: 4,
        operation: "request_task:2026-10-18",
        payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }),
      }),
      expect.objectContaining({
        leadId: 4,
        operation: "request_note:2026-10-18",
        payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }),
      }),
      expect.objectContaining({
        leadId: 4,
        operation: "request_email:41",
        payload: JSON.stringify({ requestId: 41, chicagoDay: "2026-10-18" }),
      }),
      expect.objectContaining({
        leadId: 4,
        operation: "request_task:2026-10-18",
        payload: JSON.stringify({ requestId: 42, chicagoDay: "2026-10-18" }),
      }),
      expect.objectContaining({
        leadId: 4,
        operation: "request_note:2026-10-18",
        payload: JSON.stringify({ requestId: 42, chicagoDay: "2026-10-18" }),
      }),
      expect.objectContaining({
        leadId: 4,
        operation: "request_email:42",
        payload: JSON.stringify({ requestId: 42, chicagoDay: "2026-10-18" }),
      }),
    ]);
    expect(onDuplicateKeyUpdate).toHaveBeenCalledTimes(6);
  });
});
