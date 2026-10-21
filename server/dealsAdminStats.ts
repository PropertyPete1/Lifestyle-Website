/**
 * Whole-table counts for the Builder Deals admin header. The overview lists
 * are capped (the newest 500 homes and 200 photos) for display, so counting
 * them showed at most 500 available homes and, while the newest photos were
 * still queued, 0 photos served.
 */
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { dealHomes, dealPhotos } from "../drizzle/schema";
import type { getDb } from "./db";

/** dealsPhotos' AWAITING_REGION; repeated here so this module stays free of the image pipeline (sharp, OCR). */
const AWAITING_REGION = "awaiting_region";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type BuilderDealsAdminStats = {
  homes: { available: number };
  photos: { served: number; queued: number; processing: number; failed: number; awaitingRegion: number };
};

export async function builderDealsAdminStats(db: Db): Promise<BuilderDealsAdminStats> {
  const count = async (query: Promise<Array<{ n: unknown }>>) => Number((await query)[0]?.n ?? 0) || 0;
  const n = sql<number>`count(*)`;
  const [available, served, queued, processing, failed, awaitingRegion] = await Promise.all([
    count(db.select({ n }).from(dealHomes).where(eq(dealHomes.status, "available"))),
    count(db.select({ n }).from(dealPhotos).where(and(eq(dealPhotos.processingState, "processed"), eq(dealPhotos.automaticHidden, false), eq(dealPhotos.adminHidden, false)))),
    count(db.select({ n }).from(dealPhotos).where(and(eq(dealPhotos.processingState, "pending"), or(isNull(dealPhotos.lastProcessingError), ne(dealPhotos.lastProcessingError, AWAITING_REGION))))),
    count(db.select({ n }).from(dealPhotos).where(eq(dealPhotos.processingState, "processing"))),
    count(db.select({ n }).from(dealPhotos).where(eq(dealPhotos.processingState, "failed"))),
    count(db.select({ n }).from(dealPhotos).where(and(eq(dealPhotos.processingState, "pending"), eq(dealPhotos.lastProcessingError, AWAITING_REGION)))),
  ]);
  return { homes: { available }, photos: { served, queued, processing, failed, awaitingRegion } };
}
