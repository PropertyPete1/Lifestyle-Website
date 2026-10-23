import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { dealSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { createFakeDealsDb } from "./dealsFubFakeDb.test-support";
import { EventEmitter } from "node:events";
import { SERVER_BEATS_KEY, SERVER_BEAT_MS, SERVER_BOOTS_KEY, SERVER_BOOT_HISTORY, SERVER_EXITS_KEY, installServerExitRecorder, parseServerBeats, parseServerBoots, parseServerExits, processLine, processSnapshot, recordServerBoot, recordServerExit, sampleProcessMemory, serverBootsSince, serverLives, writeServerBeat, type ServerBeat, type ServerExit } from "./dealsProcessTelemetry";

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

  it("keeps one beat per process, newest first, and records exits with their memory", async () => {
    const other: ServerBeat = { instance: "other", beatAt: "2026-10-23T03:00:00.000Z", bootedAt: "2026-10-23T02:59:00.000Z", uptimeMinutes: 1, rssMb: 530, heapUsedMb: 40, externalMb: 10, peakRssMb: 545 };
    const db = createFakeDealsDb([[dealSettings, [{ key: SERVER_BEATS_KEY, value: JSON.stringify([other]) }]]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await writeServerBeat(new Date("2026-10-23T03:01:00Z"));
    const beats = parseServerBeats((db.writes.filter((entry) => entry.table === dealSettings).at(-1)!.values as { value: string }).value);
    expect(beats.map((beat) => beat.instance)).toEqual([expect.not.stringMatching(/^other$/), "other"]);
    await recordServerExit("uncaughtException", "TypeError: boom", new Date("2026-10-23T03:02:00Z"));
    const exits = parseServerExits((db.writes.filter((entry) => entry.table === dealSettings).at(-1)!.values as { value: string }).value);
    expect(exits[0]).toMatchObject({ reason: "uncaughtException", detail: "TypeError: boom", instance: beats[0]!.instance });
    expect(SERVER_EXITS_KEY).not.toBe(SERVER_BEATS_KEY);
  });

  it("calls a process that stopped beating without an exit killed, and shows its last memory", () => {
    const now = new Date("2026-10-23T03:10:00Z");
    const beat = (instance: string, beatAt: string, rssMb: number): ServerBeat => ({ instance, beatAt, bootedAt: "2026-10-23T03:00:00.000Z", uptimeMinutes: 2, rssMb, heapUsedMb: 40, externalMb: 10, peakRssMb: rssMb + 5 });
    const exits: ServerExit[] = [{ instance: "b", at: "2026-10-23T03:05:00.000Z", reason: "SIGTERM", detail: null, rssMb: 300, peakRssMb: 320, uptimeMinutes: 5 }, { instance: "c", at: "2026-10-23T03:04:00.000Z", reason: "uncaughtException", detail: "Error: x", rssMb: 200, peakRssMb: 210, uptimeMinutes: 4 }];
    const lives = serverLives([beat("a", "2026-10-23T03:09:50.000Z", 400), beat("b", "2026-10-23T03:04:50.000Z", 290), beat("c", "2026-10-23T03:03:50.000Z", 190), beat("d", new Date(now.getTime() - 2 * SERVER_BEAT_MS - 20_000).toISOString(), 540)], exits, now);
    expect(lives.map((life) => [life.ended, life.rssMb])).toEqual([["running", 400], ["stopped", 300], ["crashed", 200], ["killed", 540]]);
    expect(lives[2]!.detail).toBe("Error: x");
  });

  it("records SIGTERM and then lets the stop happen; records an uncaught exception and exits 1", async () => {
    const target = Object.assign(new EventEmitter(), { pid: 42, kill: vi.fn(), exit: vi.fn() });
    const record = vi.fn().mockResolvedValue(undefined);
    expect(installServerExitRecorder(target as never, record, 50)).toBe(true);
    target.emit("SIGTERM");
    await vi.waitFor(() => expect(target.kill).toHaveBeenCalledWith(42, "SIGTERM"));
    expect(record).toHaveBeenCalledWith("SIGTERM", null);
    target.emit("uncaughtException", new TypeError("boom"));
    await vi.waitFor(() => expect(target.exit).toHaveBeenCalledWith(1));
    expect(record).toHaveBeenLastCalledWith("uncaughtException", expect.stringContaining("TypeError: boom"));
  });

  it("still stops when recording hangs", async () => {
    const target = Object.assign(new EventEmitter(), { pid: 7, kill: vi.fn(), exit: vi.fn() });
    installServerExitRecorder(target as never, () => new Promise<void>(() => undefined), 30);
    target.emit("SIGTERM");
    await vi.waitFor(() => expect(target.kill).toHaveBeenCalledWith(7, "SIGTERM"));
  });
});
