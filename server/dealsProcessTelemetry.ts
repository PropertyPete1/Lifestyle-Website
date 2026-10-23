/**
 * Server starts and memory, as the health check sees them. The host gives no
 * access to its logs, and the scheduler's photo calls get 503s about half the
 * time: either the instance is restarting (out of memory, say) or it is too
 * busy to answer. Each start is recorded in the private settings table (no
 * migration) and each photo drain records this process's memory, so the
 * health view can tell the two apart. Deploys count as starts too.
 * Kept free of the image pipeline so the health check can read it cheaply.
 */
import { eq } from "drizzle-orm";
import { dealSettings } from "../drizzle/schema";
import { getDb } from "./db";

export const SERVER_BOOTS_KEY = "server.boots";
/** Starts kept, newest last: a day's worth even at a start every three minutes (50 was reached on October 22, 2026, which hid the real count). */
export const SERVER_BOOT_HISTORY = 600;
const MB = 1024 * 1024;

const bootedAt = new Date();
let peakRssBytes = 0;

export type ProcessSnapshot = {
  bootedAt: string;
  uptimeMinutes: number;
  /** Resident memory of the whole process, OCR and image worker threads included. */
  rssMb: number;
  heapUsedMb: number;
  /** Memory held outside the JS heap (Buffers, sharp, WASM): where image work lives. */
  externalMb: number;
  /** Highest resident memory seen by this process (sampled after every OCR recognition and drain). */
  peakRssMb: number;
};

/** Cheap: one resident-memory read. Called after each OCR recognition so the peak includes busy moments. */
export function sampleProcessMemory(rss = process.memoryUsage.rss()): void {
  if (rss > peakRssBytes) peakRssBytes = rss;
}

export function processSnapshot(now = new Date(), usage: Pick<NodeJS.MemoryUsage, "rss" | "heapUsed" | "external"> = process.memoryUsage()): ProcessSnapshot {
  sampleProcessMemory(usage.rss);
  return {
    bootedAt: bootedAt.toISOString(),
    uptimeMinutes: Math.max(0, Math.round((now.getTime() - bootedAt.getTime()) / 60_000)),
    rssMb: Math.round(usage.rss / MB),
    heapUsedMb: Math.round(usage.heapUsed / MB),
    externalMb: Math.round(usage.external / MB),
    peakRssMb: Math.round(peakRssBytes / MB),
  };
}

/** Stored start times, oldest first; anything unreadable is dropped. */
export function parseServerBoots(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && Number.isFinite(Date.parse(item))) : [];
  } catch {
    return [];
  }
}

export function serverBootsSince(boots: string[], since: Date): number {
  return boots.filter((at) => Date.parse(at) >= since.getTime()).length;
}

/** Appends this process's start. Two instances starting together may keep only one of the two (last writer wins). */
export async function recordServerBoot(at: Date = bootedAt): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const row = (await db.select().from(dealSettings).where(eq(dealSettings.key, SERVER_BOOTS_KEY)).limit(1))[0];
  const value = JSON.stringify([...parseServerBoots(row?.value), at.toISOString()].slice(-SERVER_BOOT_HISTORY));
  await db.insert(dealSettings).values({ key: SERVER_BOOTS_KEY, value }).onDuplicateKeyUpdate({ set: { value } });
}

export async function readServerBoots(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const row = (await db.select().from(dealSettings).where(eq(dealSettings.key, SERVER_BOOTS_KEY)).limit(1))[0];
  return parseServerBoots(row?.value);
}

/** One status line: how much memory the process that ran the last drain used, and how often the server started. */
export function processLine(snapshot: ProcessSnapshot | null | undefined, bootsLast24h: number | null): string {
  const starts = bootsLast24h === null ? "" : `${bootsLast24h} server start${bootsLast24h === 1 ? "" : "s"} in 24 h (deploys included)`;
  if (!snapshot) return starts || "no process memory recorded yet";
  return `memory ${snapshot.rssMb} MB (peak ${snapshot.peakRssMb} MB, outside the JS heap ${snapshot.externalMb} MB), up ${snapshot.uptimeMinutes} min${starts ? `; ${starts}` : ""}`;
}

/*
 * Why the server stops. Every 30 s each process stores its memory under its own id ("beats"); a process that
 * stops beating without a recorded exit was killed outright (SIGKILL: the platform's memory limit, typically),
 * and its last beat is its memory just before. A polite stop (SIGTERM: a deploy or the platform scaling down)
 * and a crash (an uncaught exception) record themselves on the way out.
 */
export const SERVER_BEATS_KEY = "server.beats";
export const SERVER_EXITS_KEY = "server.exits";
/** Processes whose last beat is kept, newest first. */
export const SERVER_BEAT_HISTORY = 60;
export const SERVER_EXIT_HISTORY = 100;
export const SERVER_BEAT_MS = 30_000;
/** Resident memory is sampled this often so the peak sees short spikes between beats. */
const MEMORY_SAMPLE_MS = 2_000;

const instanceId = `${bootedAt.toISOString()}#${Math.random().toString(36).slice(2, 8)}`;

export type ServerBeat = ProcessSnapshot & { instance: string; beatAt: string };
export type ServerExit = { instance: string; at: string; reason: "SIGTERM" | "uncaughtException"; detail: string | null; rssMb: number; peakRssMb: number; uptimeMinutes: number };

function parseList<T>(value: string | null | undefined, keep: (item: Record<string, unknown>) => boolean): T[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is T => Boolean(item) && typeof item === "object" && keep(item as Record<string, unknown>)) : [];
  } catch {
    return [];
  }
}
export const parseServerBeats = (value: string | null | undefined) => parseList<ServerBeat>(value, (item) => typeof item.instance === "string" && typeof item.beatAt === "string");
export const parseServerExits = (value: string | null | undefined) => parseList<ServerExit>(value, (item) => typeof item.instance === "string" && typeof item.at === "string");

async function readSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  return (await db.select().from(dealSettings).where(eq(dealSettings.key, key)).limit(1))[0]?.value ?? null;
}
async function writeSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(dealSettings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
}

/** This process's beat replaces its previous one; the newest SERVER_BEAT_HISTORY processes are kept. */
export async function writeServerBeat(now = new Date(), snapshot: ProcessSnapshot = processSnapshot(now)): Promise<void> {
  const beat: ServerBeat = { ...snapshot, instance: instanceId, beatAt: now.toISOString() };
  const others = parseServerBeats(await readSetting(SERVER_BEATS_KEY)).filter((item) => item.instance !== instanceId);
  const kept = [beat, ...others].sort((a, b) => Date.parse(b.beatAt) - Date.parse(a.beatAt)).slice(0, SERVER_BEAT_HISTORY);
  await writeSetting(SERVER_BEATS_KEY, JSON.stringify(kept));
}

export async function recordServerExit(reason: ServerExit["reason"], detail: string | null, now = new Date()): Promise<void> {
  const snapshot = processSnapshot(now);
  const exit: ServerExit = { instance: instanceId, at: now.toISOString(), reason, detail: detail ? detail.slice(0, 500) : null, rssMb: snapshot.rssMb, peakRssMb: snapshot.peakRssMb, uptimeMinutes: snapshot.uptimeMinutes };
  const kept = [exit, ...parseServerExits(await readSetting(SERVER_EXITS_KEY))].slice(0, SERVER_EXIT_HISTORY);
  await writeSetting(SERVER_EXITS_KEY, JSON.stringify(kept));
}

export async function readServerBeats(): Promise<ServerBeat[]> { return parseServerBeats(await readSetting(SERVER_BEATS_KEY)); }
export async function readServerExits(): Promise<ServerExit[]> { return parseServerExits(await readSetting(SERVER_EXITS_KEY)); }

/**
 * The last processes and how each ended: "running" (beat within two intervals), "stopped" or "crashed" (a
 * recorded exit), or "killed" (stopped beating with no exit recorded), with its memory at the last beat.
 */
export function serverLives(beats: ServerBeat[], exits: ServerExit[], now: Date, limit = 15) {
  return beats.slice(0, limit).map((beat) => {
    const exit = exits.find((item) => item.instance === beat.instance) ?? null;
    const silentMs = now.getTime() - Date.parse(beat.beatAt);
    const ended = exit ? (exit.reason === "SIGTERM" ? "stopped" : "crashed") : silentMs > 2 * SERVER_BEAT_MS + 15_000 ? "killed" : "running";
    return {
      bootedAt: beat.bootedAt,
      lastBeatAt: beat.beatAt,
      uptimeMinutes: beat.uptimeMinutes,
      rssMb: exit?.rssMb ?? beat.rssMb,
      peakRssMb: Math.max(beat.peakRssMb, exit?.peakRssMb ?? 0),
      ended,
      detail: exit?.detail ?? null,
    };
  });
}

type ExitTarget = Pick<NodeJS.Process, "pid" | "once" | "on" | "listenerCount" | "kill" | "exit">;
let exitRecorderInstalled = false;

/** Records SIGTERM and uncaught exceptions, then lets the process end as it would have (re-raised SIGTERM; exit 1). */
export function installServerExitRecorder(target: ExitTarget = process, record: typeof recordServerExit = recordServerExit, graceMs = 1_500): boolean {
  if (target === process && exitRecorderInstalled) return false;
  if (target === process) exitRecorderInstalled = true;
  const capped = (work: Promise<void>) => Promise.race([work.catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, graceMs).unref?.())]);
  target.once("SIGTERM", () => {
    void capped(record("SIGTERM", null)).then(() => {
      // Another handler (the OCR worker's) re-raises when it is done; with none left, the default stop happens now.
      if (target.listenerCount("SIGTERM") === 0) target.kill(target.pid, "SIGTERM");
    });
  });
  target.on("uncaughtException", (error: unknown) => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}\n${(error.stack ?? "").split("\n").slice(1, 4).join("\n")}` : String(error);
    console.error("[uncaught-exception]", error);
    void capped(record("uncaughtException", detail)).then(() => target.exit(1));
  });
  return true;
}

/** Beats every SERVER_BEAT_MS and samples memory every two seconds, without keeping the process alive. */
export function startServerBeats(): void {
  const sampler = setInterval(() => sampleProcessMemory(), MEMORY_SAMPLE_MS);
  sampler.unref?.();
  const beat = setInterval(() => void writeServerBeat().catch(() => undefined), SERVER_BEAT_MS);
  beat.unref?.();
  void writeServerBeat().catch(() => undefined);
}
