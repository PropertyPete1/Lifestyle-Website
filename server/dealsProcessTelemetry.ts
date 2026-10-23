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
