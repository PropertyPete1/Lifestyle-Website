import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { dealSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { createFakeDealsDb } from "./dealsFubFakeDb.test-support";
import { SERVER_BOOTS_KEY, SERVER_BOOT_HISTORY, parseServerBoots, processLine, processSnapshot, recordServerBoot, sampleProcessMemory, serverBootsSince } from "./dealsProcessTelemetry";

afterEach(() => vi.mocked(getDb).mockReset());

describe("server start and memory telemetry", () => {
  it("reports memory in MB with a peak that includes samples taken between drains", () => {
    const MB = 1024 * 1024;
    sampleProcessMemory(9_000 * MB);
    const snapshot = processSnapshot(new Date(Date.now() + 10 * 60_000), { rss: 600 * MB, heapUsed: 120 * MB, external: 300 * MB });
    expect(snapshot).toMatchObject({ rssMb: 600, heapUsedMb: 120, externalMb: 300, peakRssMb: 9_000 });
    expect(snapshot.uptimeMinutes).toBeGreaterThanOrEqual(10);
    expect(Date.parse(snapshot.bootedAt)).toBeLessThanOrEqual(Date.now());
  });

  it("appends each start, keeps the newest SERVER_BOOT_HISTORY, and counts the last 24 hours", async () => {
    const old = Array.from({ length: SERVER_BOOT_HISTORY }, (_, i) => new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString());
    const db = createFakeDealsDb([[dealSettings, [{ key: SERVER_BOOTS_KEY, value: JSON.stringify([...old, "garbage"]) }]]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const at = new Date("2026-10-22T12:00:00Z");
    await recordServerBoot(at);
    const write = db.writes.find((entry) => entry.table === dealSettings)!;
    const stored = parseServerBoots((write.values as { value: string }).value);
    expect(stored).toHaveLength(SERVER_BOOT_HISTORY);
    expect(stored.at(-1)).toBe(at.toISOString());
    expect(stored[0]).toBe(old[1]);
    expect(serverBootsSince([...old, at.toISOString(), "2026-10-21T13:00:00.000Z"], new Date("2026-10-21T12:00:00Z"))).toBe(2);
    expect(parseServerBoots("not json")).toEqual([]);
  });

  it("writes nothing without a database", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    await expect(recordServerBoot()).resolves.toBeUndefined();
  });

  it("reads as one plain status line", () => {
    expect(processLine({ bootedAt: "x", uptimeMinutes: 42, rssMb: 700, heapUsedMb: 100, externalMb: 350, peakRssMb: 1_900 }, 3)).toBe("memory 700 MB (peak 1900 MB, outside the JS heap 350 MB), up 42 min; 3 server starts in 24 h (deploys included)");
    expect(processLine(null, 1)).toBe("1 server start in 24 h (deploys included)");
    expect(processLine(null, null)).toBe("no process memory recorded yet");
  });
});
