import { afterEach, describe, expect, it, vi } from "vitest";
import { dealEvents, dealSettings } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  notifyOwner: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: (...args: unknown[]) => mocks.notifyOwner(...args),
}));

import { reserveVerificationAttempt } from "./dealsService";

type VerificationDb = {
  db: { select: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
  sentCount: () => number;
};

/**
 * Models the count queries that reserveVerificationAttempt makes around each
 * serialized request. The test deliberately shares one phone while retaining
 * the default high IP and daily limits, so the phone cap is decisive.
 */
function verificationDb(): VerificationDb {
  let sent = 0;
  const query = (rows: unknown[]) =>
    Object.assign(rows, {
      limit: vi.fn(async () => rows),
    });
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => query(table === dealSettings ? [] : [{ n: sent }])),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (value: { kind?: string }) => {
        if (table === dealEvents && value.kind === "code_sent") sent += 1;
        return { affectedRows: 1 };
      }),
    })),
  };
  return { db, sentCount: () => sent };
}

const phone = "+12105550123";
const baseAttempt = {
  phone,
  sourceCode: "sl1",
  deviceHash: "device-hash",
  ip: "198.51.100.19",
  channel: "sms" as const,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("Builder Deals verification send caps", () => {
  it("refuses the fourth normal verification send for one phone within an hour", async () => {
    const { db, sentCount } = verificationDb();
    mocks.getDb.mockResolvedValue(db);

    const results = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      results.push(
        await reserveVerificationAttempt({ ...baseAttempt, isTest: false })
      );
    }

    expect(results.slice(0, 3).every(result => result.ok)).toBe(true);
    expect(results[3]).toEqual({ ok: false, kind: "rate_limited" });
    expect(sentCount()).toBe(3);
  });

  it("allows ten test-number sends per hour and refuses the eleventh", async () => {
    const { db, sentCount } = verificationDb();
    mocks.getDb.mockResolvedValue(db);

    const results = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      results.push(
        await reserveVerificationAttempt({ ...baseAttempt, isTest: true })
      );
    }

    expect(results.slice(0, 10).every(result => result.ok)).toBe(true);
    expect(results[10]).toEqual({ ok: false, kind: "rate_limited" });
    expect(sentCount()).toBe(10);
  });
});
