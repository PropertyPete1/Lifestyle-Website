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
};
export type DealPhotoDrainStatus = {
  lastRunAt: string;
  /** Last drain without an error that moved a photo or found nothing to do. */
  lastHealthyAt: string | null;
  lastError: string | null;
  /** Set while drains run in plain due order because the priority or sharing query fails. */
  lastWarning?: string | null;
  last: DealPhotoDrainOutcome;
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
    },
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
export function lastPhotoDrain(status: DealPhotoDrainStatus | null): { at: string; processed: number; hidden: number; partial: boolean; coalesced: boolean } | null {
  if (!status) return null;
  return { at: status.lastRunAt, processed: Number(status.last?.processed ?? 0), hidden: Number(status.last?.hidden ?? 0), partial: Boolean(status.last?.partial), coalesced: Boolean(status.last?.coalesced) };
}
