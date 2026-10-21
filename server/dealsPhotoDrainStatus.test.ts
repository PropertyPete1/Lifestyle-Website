import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { dealSettings } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import { PHOTO_DRAIN_STATUS_KEY, drainWasHealthy, photoDrainStall, readDealPhotoDrainStatus, recordDealPhotoDrainStatus } from "./dealsPhotoDrainStatus";

const zero = { processed: 0, hidden: 0, awaitingRegion: 0, retried: 0, failed: 0, skipped: 0 };
const T = Date.parse("2026-10-21T15:00:00Z");
let db: FakeDealsDb;

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
});
afterEach(() => { vi.clearAllMocks(); });

describe("photo drain status for the health check", () => {
  it("treats a drain that moved photos or had nothing to start as healthy, and a queue-read error, all-skipped or timeout-only drain as not", () => {
    expect(drainWasHealthy({ ...zero, processed: 3 })).toBe(true);
    expect(drainWasHealthy(zero)).toBe(true);
    expect(drainWasHealthy({ ...zero, error: "queue_read_failed" })).toBe(false);
    expect(drainWasHealthy({ ...zero, skipped: 4 })).toBe(false);
    expect(drainWasHealthy({ ...zero, retried: 1, timedOut: 1 })).toBe(false);
  });

  it("flags photos due with no healthy drain for over 30 minutes, and reports the last error; a fresh deploy starts the clock", async () => {
    // First status ever, already failing: the clock starts now, so nothing is stalled yet.
    await recordDealPhotoDrainStatus({ ...zero, error: "queue_read_failed" }, new Date(T));
    let status = await readDealPhotoDrainStatus();
    expect(status).toMatchObject({ lastError: "queue_read_failed", lastHealthyAt: new Date(T).toISOString() });
    expect(photoDrainStall(status, 500, new Date(T + 10 * 60_000))).toEqual({ stalled: false, stalledMinutes: 10, lastError: "queue_read_failed", lastWarning: null });

    // Still failing 40 minutes later: stalled.
    await recordDealPhotoDrainStatus({ ...zero, error: "queue_read_failed" }, new Date(T + 40 * 60_000));
    status = await readDealPhotoDrainStatus();
    expect(photoDrainStall(status, 500, new Date(T + 41 * 60_000))).toMatchObject({ stalled: true, stalledMinutes: 41 });
    // Nothing due: nothing to judge.
    expect(photoDrainStall(status, 0, new Date(T + 41 * 60_000))).toMatchObject({ stalled: false, stalledMinutes: null });

    // A healthy drain clears it.
    await recordDealPhotoDrainStatus({ ...zero, processed: 12 }, new Date(T + 45 * 60_000));
    status = await readDealPhotoDrainStatus();
    expect(status).toMatchObject({ lastError: null, lastHealthyAt: new Date(T + 45 * 60_000).toISOString() });
    expect(photoDrainStall(status, 500, new Date(T + 50 * 60_000))).toMatchObject({ stalled: false, lastError: null });
    expect(db.rows(dealSettings).filter((row) => row.key === PHOTO_DRAIN_STATUS_KEY)).toHaveLength(1);
    expect(photoDrainStall(null, 500)).toEqual({ stalled: false, stalledMinutes: null, lastError: null, lastWarning: null });
  });
});
