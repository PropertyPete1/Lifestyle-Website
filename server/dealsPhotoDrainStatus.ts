/**
 * The photo cron's last outcome, kept in the private settings table (no
 * migration) so the health check can tell a slow queue from a stuck one: a
 * drain that keeps failing to read the queue, or that moves no photo while
 * photos are due, would otherwise only show up as an ever-older backlog.
 * Kept free of the image pipeline (sharp, OCR) so the health check can read it cheaply.
 */
import { eq } from "drizzle-orm";
import { dealSettings } from "../drizzle/schema";
import { getDb } from "./db";

export const PHOTO_DRAIN_STATUS_KEY = "photos.drain.status";
/** Due photos and no drain has moved one for this long: the queue is stuck, not just long. */
export const PHOTO_DRAIN_STALL_MINUTES = 30;

export type DealPhotoDrainOutcome = {
  processed: number; hidden: number; awaitingRegion: number; retried: number; failed: number; skipped: number;
  timedOut?: number; error?: string;
  /** The database's message for `error`. */
  errorDetail?: string;
  /** The drain kept going in plain due order after a priority or sharing query failed. */
  warning?: string;
  /** The call answered before its drain finished (counts so far). */
  partial?: boolean;
  /** The call found another drain running and started none. */
  coalesced?: boolean;
  elapsedMs?: number;
  /** Busy milliseconds per pipeline stage (download, normalize, master, ocr, store), summed over the drain's photos. */
  stageMs?: Record<string, number>;
};

/** Per-photo cost, as moving averages over recent drains (weight PHOTO_COST_WEIGHT on the newest). */
export type DealPhotoCost = {
  /** Wall-clock milliseconds per finished photo (published or hidden), with the drain's lanes side by side. */
  msPerPhoto: number;
  /** Busy milliseconds per finished photo in each stage (lanes overlap, so these can add up to more than msPerPhoto). */
  stageMsPerPhoto: Record<string, number>;
  /** The newest drain's own values, before averaging. */
  lastMsPerPhoto: number;
  samples: number;
};
const PHOTO_COST_WEIGHT = 0.3;

/** The newest drain's per-photo cost folded into the moving average; unchanged when the drain finished no photo. */
export function nextPhotoCost(previous: DealPhotoCost | null | undefined, outcome: DealPhotoDrainOutcome): DealPhotoCost | null {
  const finished = outcome.processed + outcome.hidden;
  if (!finished || outcome.coalesced || !outcome.elapsedMs) return previous ?? null;
  const msPerPhoto = outcome.elapsedMs / finished;
  const stages = Object.fromEntries(Object.entries(outcome.stageMs ?? {}).map(([stage, ms]) => [stage, ms / finished]));
  const blend = (old: number | undefined, value: number) => Math.round(old === undefined ? value : old * (1 - PHOTO_COST_WEIGHT) + value * PHOTO_COST_WEIGHT);
  return {
    msPerPhoto: blend(previous?.msPerPhoto, msPerPhoto),
    stageMsPerPhoto: Object.fromEntries(Object.entries(stages).map(([stage, value]) => [stage, blend(previous?.stageMsPerPhoto?.[stage], value)])),
    lastMsPerPhoto: Math.round(msPerPhoto),
    samples: (previous?.samples ?? 0) + 1,
  };
}
export type DealPhotoDrainStatus = {
  lastRunAt: string;
  /** Last drain without an error that moved a photo or found nothing to do. */
  lastHealthyAt: string | null;
  lastError: string | null;
  /** Set while drains run in plain due order because the priority or sharing query fails. */
  lastWarning?: string | null;
  last: DealPhotoDrainOutcome;
  /** Moving average of the per-photo cost, so production shows where a photo's time goes. */
  cost?: DealPhotoCost | null;
};

/**
 * A drain is healthy when it could read the queue and either moved photos or
 * finished with none to start. A coalesced call (it started nothing) or a
 * partial answer that moved nothing proves nothing, so it never counts.
 */
export function drainWasHealthy(outcome: DealPhotoDrainOutcome): boolean {
  if (outcome.error) return false;
  const timedOut = outcome.timedOut ?? 0;
  const moved = outcome.processed + outcome.hidden + outcome.awaitingRegion + Math.max(0, outcome.retried + outcome.failed - timedOut);
  const idle = moved === 0 && outcome.skipped === 0 && timedOut === 0 && !outcome.partial && !outcome.coalesced;
  return moved > 0 || idle;
}

export async function readDealPhotoDrainStatus(): Promise<DealPhotoDrainStatus | null> {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(dealSettings).where(eq(dealSettings.key, PHOTO_DRAIN_STATUS_KEY)).limit(1))[0];
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as DealPhotoDrainStatus;
    return typeof parsed?.lastRunAt === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Last writer wins across instances; lastHealthyAt only ever moves forward. */
export async function recordDealPhotoDrainStatus(outcome: DealPhotoDrainOutcome, now = new Date()): Promise<DealPhotoDrainStatus | null> {
  const db = await getDb();
  if (!db) return null;
  const previous = await readDealPhotoDrainStatus().catch(() => null);
  const healthy = drainWasHealthy(outcome);
  const previousHealthy = previous?.lastHealthyAt ?? null;
  // The first status ever written starts the clock, so a fresh deploy is not reported as stalled.
  const lastHealthyAt = healthy ? now.toISOString() : previousHealthy ?? now.toISOString();
  const status: DealPhotoDrainStatus = {
    lastRunAt: now.toISOString(),
    lastHealthyAt: previousHealthy && previousHealthy > lastHealthyAt ? previousHealthy : lastHealthyAt,
    lastError: outcome.error ? `${outcome.error}${outcome.errorDetail ? `: ${outcome.errorDetail}` : ""}` : null,
    lastWarning: outcome.warning ?? null,
    last: {
      processed: outcome.processed, hidden: outcome.hidden, awaitingRegion: outcome.awaitingRegion, retried: outcome.retried, failed: outcome.failed, skipped: outcome.skipped,
      ...(outcome.timedOut ? { timedOut: outcome.timedOut } : {}), ...(outcome.error ? { error: outcome.error } : {}),
      ...(outcome.partial ? { partial: true } : {}), ...(outcome.coalesced ? { coalesced: true } : {}),
      ...(outcome.elapsedMs !== undefined ? { elapsedMs: Math.round(outcome.elapsedMs) } : {}),
      ...(outcome.stageMs ? { stageMs: Object.fromEntries(Object.entries(outcome.stageMs).map(([stage, ms]) => [stage, Math.round(ms)])) } : {}),
    },
    cost: nextPhotoCost(previous?.cost, outcome),
  };
  const value = JSON.stringify(status);
  await db.insert(dealSettings).values({ key: PHOTO_DRAIN_STATUS_KEY, value }).onDuplicateKeyUpdate({ set: { value } });
  return status;
}

/** Health view: minutes since the last healthy drain, when photos are due; null when there is nothing to judge. */
export function photoDrainStall(status: DealPhotoDrainStatus | null, duePhotos: number, now = new Date()): { stalledMinutes: number | null; stalled: boolean; lastError: string | null; lastWarning: string | null } {
  if (!status) return { stalledMinutes: null, stalled: false, lastError: null, lastWarning: null };
  const since = Date.parse(status.lastHealthyAt ?? status.lastRunAt);
  const stalledMinutes = duePhotos > 0 && Number.isFinite(since) ? Math.max(0, Math.floor((now.getTime() - since) / 60_000)) : null;
  return { stalledMinutes, stalled: stalledMinutes !== null && stalledMinutes > PHOTO_DRAIN_STALL_MINUTES, lastError: status.lastError, lastWarning: status.lastWarning ?? null };
}

/** Health view of the last cron call: when it ran and what it moved. */
export type LastPhotoDrain = { at: string; processed: number; hidden: number; partial: boolean; coalesced: boolean; msPerPhoto: number | null; stageMsPerPhoto: Record<string, number> | null };
export function lastPhotoDrain(status: DealPhotoDrainStatus | null): LastPhotoDrain | null {
  if (!status) return null;
  return {
    at: status.lastRunAt, processed: Number(status.last?.processed ?? 0), hidden: Number(status.last?.hidden ?? 0), partial: Boolean(status.last?.partial), coalesced: Boolean(status.last?.coalesced),
    msPerPhoto: status.cost?.msPerPhoto ?? null, stageMsPerPhoto: status.cost?.stageMsPerPhoto ?? null,
  };
}
