import crypto from "crypto";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { dealCommunities, dealSuppliedImportCalls, dealSuppliedImportKeys, dealSuppliedImports } from "../drizzle/schema";
import { getDb } from "./db";
import { hasBuilderReader, officialHostFor } from "./dealsAdapters";
import { suppliedCommunitySchema, type StoredSuppliedImport, type SuppliedCommunity } from "./dealsAdapters.supplied";
import { hashSecret } from "./dealsService";

/**
 * Storage for the supplied source import: per-builder import keys (only the
 * SHA-256 is kept), the latest imports per community, and the call log behind
 * the hourly limit. No environment secret is involved.
 */

export const SUPPLIED_KEY_PREFIX = "ldrimp_";
/** 32 random bytes, base64url: 43 characters after the prefix. */
const KEY_PATTERN = /^ldrimp_[A-Za-z0-9_-]{43}$/;
/** The latest import and the one before it are kept per community. */
const KEEP_PER_COMMUNITY = 2;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db;
}

export function isWellFormedImportKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/**
 * A new key for the builder; it replaces any earlier one at once. The plaintext
 * is returned to show once and is never stored or logged.
 */
export async function generateSuppliedImportKey(builder: string, now = new Date()): Promise<{ builder: string; key: string; createdAt: Date }> {
  if (!hasBuilderReader(builder)) throw new Error("Import keys are only for builders with an official site.");
  const db = await requireDb();
  const key = `${SUPPLIED_KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const keyHash = hashSecret(key);
  const existing = (await db.select({ id: dealSuppliedImportKeys.id }).from(dealSuppliedImportKeys).where(eq(dealSuppliedImportKeys.builder, builder)).limit(1))[0];
  if (existing) await db.update(dealSuppliedImportKeys).set({ keyHash, createdAt: now }).where(eq(dealSuppliedImportKeys.id, existing.id));
  else await db.insert(dealSuppliedImportKeys).values({ builder, keyHash, createdAt: now });
  return { builder, key, createdAt: now };
}

/** Removes the builder's key: imports are refused and its communities go back to being read from the builder's site. */
export async function revokeSuppliedImportKey(builder: string): Promise<{ revoked: boolean }> {
  const db = await requireDb();
  const result = await db.delete(dealSuppliedImportKeys).where(eq(dealSuppliedImportKeys.builder, builder));
  return { revoked: Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) > 0 };
}

/** Builders that take imports, with the key's creation time (never the hash). */
export async function listSuppliedImportKeys(): Promise<Array<{ builder: string; createdAt: Date }>> {
  const db = await requireDb();
  return (await db.select({ builder: dealSuppliedImportKeys.builder, createdAt: dealSuppliedImportKeys.createdAt }).from(dealSuppliedImportKeys)).map((row) => ({ builder: row.builder, createdAt: row.createdAt }));
}

/**
 * The builder a presented key belongs to, or null. The presented key's hash is
 * compared with every stored hash in constant time, with no early exit, so the
 * answer time does not depend on which key (or how much of one) matched.
 */
export async function authenticateSuppliedImportKey(presented: string): Promise<string | null> {
  if (!isWellFormedImportKey(presented)) return null;
  const db = await requireDb();
  const rows = await db.select({ builder: dealSuppliedImportKeys.builder, keyHash: dealSuppliedImportKeys.keyHash }).from(dealSuppliedImportKeys);
  const candidate = Buffer.from(hashSecret(presented), "hex");
  let match: string | null = null;
  for (const row of rows) {
    const stored = /^[a-f0-9]{64}$/.test(row.keyHash) ? Buffer.from(row.keyHash, "hex") : Buffer.alloc(32);
    const equal = crypto.timingSafeEqual(candidate, stored);
    if (equal && /^[a-f0-9]{64}$/.test(row.keyHash)) match = row.builder;
  }
  return match;
}

/** Whether the builder takes imports (it has a key): its communities are read from imports, never fetched. */
export async function isSuppliedBuilder(builder: string): Promise<boolean> {
  const db = await requireDb();
  return (await db.select({ id: dealSuppliedImportKeys.id }).from(dealSuppliedImportKeys).where(eq(dealSuppliedImportKeys.builder, builder)).limit(1)).length > 0;
}

function parseStored(row: typeof dealSuppliedImports.$inferSelect): StoredSuppliedImport | null {
  try {
    const parsed = suppliedCommunitySchema.safeParse(JSON.parse(row.payload));
    return parsed.success ? { communityId: row.communityId, builder: row.builder, capturedAt: row.capturedAt, receivedAt: row.receivedAt, community: parsed.data } : null;
  } catch {
    return null;
  }
}

/** The newest import for the community (by capture time); null when none is stored or it no longer parses. */
export async function latestSuppliedImport(communityId: number): Promise<StoredSuppliedImport | null> {
  const db = await requireDb();
  const row = (await db.select().from(dealSuppliedImports).where(eq(dealSuppliedImports.communityId, communityId)).orderBy(desc(dealSuppliedImports.capturedAt), desc(dealSuppliedImports.id)).limit(1))[0];
  return row ? parseStored(row) : null;
}

/** For the sync: null when the builder does not take imports; otherwise the community's latest import (or null inside). */
export async function suppliedSourceFor(builder: string, communityId: number): Promise<{ latest: StoredSuppliedImport | null } | null> {
  if (!(await isSuppliedBuilder(builder))) return null;
  return { latest: await latestSuppliedImport(communityId) };
}

/** Stores one community's import and keeps only the newest two for that community. */
export async function storeSuppliedImport(input: { communityId: number; builder: string; capturedAt: Date; receivedAt: Date; community: SuppliedCommunity }): Promise<void> {
  const db = await requireDb();
  await db.insert(dealSuppliedImports).values({ communityId: input.communityId, builder: input.builder, payload: JSON.stringify(input.community), capturedAt: input.capturedAt, receivedAt: input.receivedAt });
  const rows = await db.select({ id: dealSuppliedImports.id }).from(dealSuppliedImports).where(eq(dealSuppliedImports.communityId, input.communityId)).orderBy(desc(dealSuppliedImports.capturedAt), desc(dealSuppliedImports.id));
  const extra = rows.slice(KEEP_PER_COMMUNITY).map((row) => row.id);
  if (extra.length) await db.delete(dealSuppliedImports).where(inArray(dealSuppliedImports.id, extra));
}

/** Each community's latest import time, for Admin (no payload). */
export async function latestImportTimes(communityIds: readonly number[]): Promise<Map<number, { capturedAt: Date; receivedAt: Date }>> {
  const out = new Map<number, { capturedAt: Date; receivedAt: Date }>();
  if (!communityIds.length) return out;
  const db = await requireDb();
  const rows = await db.select({ communityId: dealSuppliedImports.communityId, capturedAt: dealSuppliedImports.capturedAt, receivedAt: dealSuppliedImports.receivedAt }).from(dealSuppliedImports).where(inArray(dealSuppliedImports.communityId, [...communityIds]));
  for (const row of rows) {
    const known = out.get(row.communityId);
    if (!known || row.capturedAt > known.capturedAt) out.set(row.communityId, { capturedAt: row.capturedAt, receivedAt: row.receivedAt });
  }
  return out;
}

/** Records an authenticated call and returns how many the builder made in the last hour, this one included. Rows older than a day are pruned. */
export async function recordSuppliedImportCall(builder: string, now: Date): Promise<number> {
  const db = await requireDb();
  await db.delete(dealSuppliedImportCalls).where(lt(dealSuppliedImportCalls.createdAt, new Date(now.getTime() - 24 * 60 * 60_000)));
  await db.insert(dealSuppliedImportCalls).values({ builder, createdAt: now });
  const recent = await db.select({ id: dealSuppliedImportCalls.id }).from(dealSuppliedImportCalls).where(and(eq(dealSuppliedImportCalls.builder, builder), gt(dealSuppliedImportCalls.createdAt, new Date(now.getTime() - 60 * 60_000))));
  return recent.length;
}

export type SuppliedImportOverview = Array<{
  builder: string;
  host: string | null;
  keyCreatedAt: Date;
  communities: Array<{ id: number; privateName: string; sourceUrl: string; active: boolean; paused: boolean; manualMode: boolean; catalogHoldReason: string | null; lastCapturedAt: Date | null; lastReceivedAt: Date | null }>;
}>;

/** Admin only (private names and links): each builder that takes imports, with its communities and their latest import times. */
export async function suppliedImportOverview(): Promise<SuppliedImportOverview> {
  const db = await requireDb();
  const keys = await listSuppliedImportKeys();
  if (!keys.length) return [];
  const communities = await db.select().from(dealCommunities).where(inArray(dealCommunities.builder, keys.map((key) => key.builder)));
  const times = await latestImportTimes(communities.map((community) => community.id));
  return keys.sort((a, b) => a.builder.localeCompare(b.builder)).map((key) => ({
    builder: key.builder,
    host: officialHostFor(key.builder),
    keyCreatedAt: key.createdAt,
    communities: communities.filter((community) => community.builder === key.builder).sort((a, b) => a.privateName.localeCompare(b.privateName)).map((community) => ({
      id: community.id,
      privateName: community.privateName,
      sourceUrl: community.sourceUrl,
      active: community.active,
      paused: community.paused,
      manualMode: community.manualMode,
      catalogHoldReason: community.catalogHoldReason,
      lastCapturedAt: times.get(community.id)?.capturedAt ?? null,
      lastReceivedAt: times.get(community.id)?.receivedAt ?? null,
    })),
  }));
}
