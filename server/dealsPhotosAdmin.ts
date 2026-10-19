/**
 * Admin-side Builder Deals photo operations. Plain async functions with no tRPC
 * dependency; dealsRouter.ts wraps each one in an adminProcedure. Every image
 * leaves this module only as a small base64 data URL for the admin UI, never
 * as an object-store URL, and nothing here is reachable by a lead.
 */
import crypto from "node:crypto";
import sharp from "sharp";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { dealCommunities, dealHomes, dealPhotos, dealSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { storagePut, storageReadPrivate } from "./storage";
import {
  AWAITING_REGION,
  DEFAULT_PHOTO_HIDE_KEYWORDS,
  UPLOAD_SOURCE_PREFIX,
  builderKey,
  builderSettingsKey,
  getBuilderPhotoSettings,
  normalizeDealPhotoOriginal,
  processPendingDealPhotos,
  reprocessBuilderPhotos,
  validatePhotoRegion,
  type BuilderPhotoSettings,
  type PhotoRegion,
} from "./dealsPhotos";

export { reprocessBuilderPhotos } from "./dealsPhotos";

const PRIVATE_PREFIX = "builder-deals-private/";
const MAX_UPLOAD_BYTES = 18 * 1024 * 1024;
const MAX_KEYWORDS = 100;
const MAX_KEYWORD_LENGTH = 60;
const SAMPLE_COUNT = 5;
const SAMPLE_MAX_EDGE = 720;
const PREVIEW_MAX_EDGE = 320;
const ACCEPTED_UPLOAD_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/gif", "image/heic", "image/heif"]);

const digest = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");

export class PhotoAdminError extends Error {
  constructor(readonly code: "database_unavailable" | "builder_required" | "invalid_region" | "invalid_keywords" | "home_not_found" | "photo_not_found" | "invalid_upload" | "upload_too_large" | "storage_unavailable" | "no_stored_image", message: string) {
    super(message);
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new PhotoAdminError("database_unavailable", "Database unavailable.");
  return db;
}

/** Trimmed, de-duplicated (case-insensitive), bounded admin keyword list. */
export function normalizePhotoKeywords(input: unknown): string[] {
  if (!Array.isArray(input) || !input.every((item) => typeof item === "string")) throw new PhotoAdminError("invalid_keywords", "Keywords must be a list of words or phrases.");
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of input as string[]) {
    const keyword = raw.trim().replace(/\s+/g, " ");
    if (!keyword) continue;
    if (keyword.length > MAX_KEYWORD_LENGTH) throw new PhotoAdminError("invalid_keywords", `Each keyword must be ${MAX_KEYWORD_LENGTH} characters or fewer.`);
    const lower = keyword.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    keywords.push(keyword);
  }
  if (keywords.length > MAX_KEYWORDS) throw new PhotoAdminError("invalid_keywords", `At most ${MAX_KEYWORDS} keywords are supported.`);
  return keywords;
}

export type SaveBuilderPhotoSettingsInput = {
  builder: string;
  enabled: boolean;
  /** Percent box on the normalized photo, or null to clear it (enabled builders then park at awaiting_region). */
  region: PhotoRegion | null;
  /** Admin keyword list; the seeded defaults (Homes, Realty, MLS, ...) are always kept. */
  keywords?: string[];
  reviewedSampleIds?: number[];
};
export type SaveBuilderPhotoSettingsResult = {
  builder: string;
  settings: BuilderPhotoSettings;
  /** True when enabled, region, or keywords differ from the stored values. */
  changed: boolean;
  /** Photos of this builder's communities put back in the queue (0 when nothing changed). */
  requeued: number;
};

/**
 * saveBuilderPhotoSettings
 * Input: SaveBuilderPhotoSettingsInput { builder, enabled, region | null, keywords?, reviewedSampleIds? }
 * Output: SaveBuilderPhotoSettingsResult { builder, settings, changed, requeued }
 * Writes the `photos.builder.<key>` settings JSON. The region is validated by
 * validatePhotoRegion (percent, inside the frame). When enabled, region, or the
 * keyword list changed, every photo of that builder's communities is requeued
 * (pending, attempts 0) and a queue drain is kicked, so the change re-runs
 * steps 3 to 6 from the stored originals. Throws PhotoAdminError.
 */
export async function saveBuilderPhotoSettings(input: SaveBuilderPhotoSettingsInput): Promise<SaveBuilderPhotoSettingsResult> {
  const db = await requireDb();
  const builder = String(input.builder ?? "").trim();
  if (!builder) throw new PhotoAdminError("builder_required", "Builder is required.");
  let region: PhotoRegion | null = null;
  if (input.region !== null && input.region !== undefined) {
    try {
      region = validatePhotoRegion(input.region);
    } catch {
      throw new PhotoAdminError("invalid_region", "The watermark region must be a percent box inside the photo.");
    }
  }
  const keywords = normalizePhotoKeywords(input.keywords ?? []);
  let previous: BuilderPhotoSettings | null = null;
  try {
    previous = await getBuilderPhotoSettings(builder);
  } catch {
    // Unreadable stored JSON is simply overwritten below.
  }
  const settings: BuilderPhotoSettings = {
    enabled: Boolean(input.enabled),
    region,
    keywords: Array.from(new Set([...DEFAULT_PHOTO_HIDE_KEYWORDS, ...keywords])),
    reviewedSampleIds: (input.reviewedSampleIds ?? previous?.reviewedSampleIds ?? []).filter((id) => Number.isInteger(id) && id > 0).slice(0, 25),
    revision: `admin-${new Date().toISOString()}`,
  };
  const key = builderSettingsKey(builder);
  const value = JSON.stringify(settings);
  await db.insert(dealSettings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
  const sameKeywords = previous ? previous.keywords.map((k) => k.toLowerCase()).sort().join("\u0000") === settings.keywords.map((k) => k.toLowerCase()).sort().join("\u0000") : false;
  const changed = !previous || previous.enabled !== settings.enabled || JSON.stringify(previous.region) !== JSON.stringify(settings.region) || !sameKeywords;
  let requeued = 0;
  if (changed) {
    requeued = await reprocessBuilderPhotos(builder);
    if (requeued > 0) void processPendingDealPhotos(20).catch(() => undefined);
  }
  return { builder, settings, changed, requeued };
}

export type BuilderPhotoSettingsAdminView = {
  builder: string;
  enabled: boolean;
  region: PhotoRegion | null;
  keywords: string[];
  reviewedSampleIds: number[];
  revision: string;
  /** Show the "Set watermark region" prompt: removal is on but no region is saved. */
  needsRegion: boolean;
  photos: { total: number; processed: number; pending: number; failed: number; awaitingRegion: number; autoHidden: number };
};

/**
 * getBuilderPhotoSettingsForAdmin
 * Input: builder?: string (one builder) or undefined (every builder with a community, plus launch builders)
 * Output: BuilderPhotoSettingsAdminView[] sorted by builder name
 * Reading seeds the stored defaults for a builder that has none yet.
 */
export async function getBuilderPhotoSettingsForAdmin(builder?: string): Promise<BuilderPhotoSettingsAdminView[]> {
  const db = await requireDb();
  const names = new Map<string, string>();
  for (const seed of ["Chesmar", "M/I Homes"]) names.set(builderKey(seed), seed);
  for (const row of await db.selectDistinct({ builder: dealCommunities.builder }).from(dealCommunities)) {
    if (row.builder.trim()) names.set(builderKey(row.builder), row.builder.trim());
  }
  if (builder?.trim()) names.set(builderKey(builder), builder.trim());
  const wanted = builder?.trim() ? [builderKey(builder)] : Array.from(names.keys()).sort();

  const counts = await db.select({
    builder: dealCommunities.builder,
    total: sql<number>`count(*)`,
    processed: sql<number>`SUM(${dealPhotos.processingState} = 'processed')`,
    pending: sql<number>`SUM(${dealPhotos.processingState} IN ('pending', 'processing'))`,
    failed: sql<number>`SUM(${dealPhotos.processingState} = 'failed')`,
    awaitingRegion: sql<number>`SUM(${dealPhotos.lastProcessingError} = ${AWAITING_REGION})`,
    autoHidden: sql<number>`SUM(${dealPhotos.automaticHidden} = 1)`,
  }).from(dealPhotos)
    .innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
    .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
    .groupBy(dealCommunities.builder);
  const countsByBuilder = new Map<string, BuilderPhotoSettingsAdminView["photos"]>();
  for (const row of counts) {
    const key = builderKey(row.builder);
    const prior = countsByBuilder.get(key) ?? { total: 0, processed: 0, pending: 0, failed: 0, awaitingRegion: 0, autoHidden: 0 };
    countsByBuilder.set(key, {
      total: prior.total + Number(row.total ?? 0),
      processed: prior.processed + Number(row.processed ?? 0),
      pending: prior.pending + Number(row.pending ?? 0),
      failed: prior.failed + Number(row.failed ?? 0),
      awaitingRegion: prior.awaitingRegion + Number(row.awaitingRegion ?? 0),
      autoHidden: prior.autoHidden + Number(row.autoHidden ?? 0),
    });
  }

  const views: BuilderPhotoSettingsAdminView[] = [];
  for (const key of wanted) {
    const name = names.get(key) ?? key;
    const settings = await getBuilderPhotoSettings(name);
    views.push({
      builder: name,
      enabled: settings.enabled,
      region: settings.region,
      keywords: settings.keywords,
      reviewedSampleIds: settings.reviewedSampleIds,
      revision: settings.revision,
      needsRegion: settings.enabled && !settings.region,
      photos: countsByBuilder.get(key) ?? { total: 0, processed: 0, pending: 0, failed: 0, awaitingRegion: 0, autoHidden: 0 },
    });
  }
  return views;
}

async function dataUrlFor(bytes: Buffer, maxEdge: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const metadata = await sharp(bytes, { limitInputPixels: 50_000_000, animated: false }).metadata();
  const thumbnail = await sharp(bytes, { limitInputPixels: 50_000_000, animated: false })
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 70, effort: 3 })
    .toBuffer();
  return { dataUrl: `data:image/webp;base64,${thumbnail.toString("base64")}`, width: metadata.width ?? 0, height: metadata.height ?? 0 };
}

export type BuilderPhotoSample = {
  photoId: number;
  homeId: number;
  /** Dimensions of the stored normalized original; region percentages map onto this frame. */
  width: number;
  height: number;
  dataUrl: string;
};

/**
 * listBuilderPhotoSamples
 * Input: builder: string, limit = 5
 * Output: BuilderPhotoSample[] (up to `limit` stored originals, spread across homes, as <= 720px data URLs)
 * Photos parked at awaiting_region already have a stored original, so the
 * picker works before the builder's first region is saved. Unreadable objects
 * are skipped rather than failing the whole list.
 */
export async function listBuilderPhotoSamples(builder: string, limit = SAMPLE_COUNT): Promise<BuilderPhotoSample[]> {
  const db = await requireDb();
  const key = builderKey(builder);
  if (!key) throw new PhotoAdminError("builder_required", "Builder is required.");
  const max = Math.max(1, Math.min(10, Math.floor(limit)));
  const candidates = await db.select({ id: dealPhotos.id, homeId: dealPhotos.homeId, storageKey: dealPhotos.originalStorageKey }).from(dealPhotos)
    .innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
    .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
    .where(and(sql`LOWER(TRIM(${dealCommunities.builder})) = ${key}`, isNotNull(dealPhotos.originalStorageKey)))
    .orderBy(asc(dealPhotos.homeId), asc(dealPhotos.sortOrder), asc(dealPhotos.id))
    .limit(max * 5);
  // One photo per home first, then fill from the remaining candidates.
  const chosen: typeof candidates = [];
  const homesSeen = new Set<number>();
  for (const candidate of candidates) {
    if (chosen.length >= max) break;
    if (homesSeen.has(candidate.homeId)) continue;
    homesSeen.add(candidate.homeId);
    chosen.push(candidate);
  }
  for (const candidate of candidates) {
    if (chosen.length >= max) break;
    if (!chosen.includes(candidate)) chosen.push(candidate);
  }
  const samples: BuilderPhotoSample[] = [];
  for (const candidate of chosen) {
    if (!candidate.storageKey) continue;
    try {
      const stored = await storageReadPrivate(candidate.storageKey);
      const image = await dataUrlFor(stored.data, SAMPLE_MAX_EDGE);
      samples.push({ photoId: candidate.id, homeId: candidate.homeId, ...image });
    } catch {
      // Skip an unreadable object; the next sample still renders.
    }
  }
  return samples;
}

export type DealPhotoPreview = {
  id: number;
  /** "master" is what leads would see (minus the watermark); "original" is the fallback before processing. */
  source: "master" | "original";
  dataUrl: string;
  width: number;
  height: number;
  processingState: "pending" | "processing" | "processed" | "failed";
  automaticHidden: boolean;
  adminHidden: boolean;
  lastProcessingError: string | null;
  ocrMatches: unknown[];
};

/**
 * getDealPhotoPreview
 * Input: { id: number; maxEdge?: number (default 320, max 720); prefer?: "master" | "original" }
 * Output: DealPhotoPreview | null (null when the photo has no stored bytes yet)
 * Hidden photos keep stored bytes, so the admin table can show what was hidden and why.
 */
export async function getDealPhotoPreview(input: { id: number; maxEdge?: number; prefer?: "master" | "original" }): Promise<DealPhotoPreview | null> {
  const db = await requireDb();
  const photo = (await db.select().from(dealPhotos).where(eq(dealPhotos.id, input.id)).limit(1))[0];
  if (!photo) throw new PhotoAdminError("photo_not_found", "Photo not found.");
  const order: Array<["master" | "original", string | null]> = input.prefer === "original"
    ? [["original", photo.originalStorageKey], ["master", photo.processedStorageKey]]
    : [["master", photo.processedStorageKey], ["original", photo.originalStorageKey]];
  const maxEdge = Math.max(64, Math.min(720, Math.floor(input.maxEdge ?? PREVIEW_MAX_EDGE)));
  let matches: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(photo.ocrMatches ?? "[]");
    matches = Array.isArray(parsed) ? parsed : [];
  } catch {
    matches = [];
  }
  for (const [source, storageKey] of order) {
    if (!storageKey) continue;
    try {
      const stored = await storageReadPrivate(storageKey);
      const image = await dataUrlFor(stored.data, maxEdge);
      return { id: photo.id, source, ...image, processingState: photo.processingState, automaticHidden: photo.automaticHidden, adminHidden: photo.adminHidden, lastProcessingError: photo.lastProcessingError, ocrMatches: matches };
    } catch {
      // Try the other stored copy.
    }
  }
  return null;
}

function decodeUploadBase64(raw: string): Buffer {
  const trimmed = raw.trim();
  const payload = trimmed.startsWith("data:") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  if (!payload || /[^A-Za-z0-9+/=\s_-]/.test(payload)) throw new PhotoAdminError("invalid_upload", "The upload is not valid base64 image data.");
  // Base64 is a third larger than the bytes; reject oversize input before decoding.
  if (payload.length > MAX_UPLOAD_BYTES * 1.37) throw new PhotoAdminError("upload_too_large", "Photos must be 18 MB or smaller.");
  const bytes = Buffer.from(payload.replace(/\s+/g, ""), payload.includes("-") || payload.includes("_") ? "base64url" : "base64");
  if (!bytes.byteLength) throw new PhotoAdminError("invalid_upload", "The upload is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new PhotoAdminError("upload_too_large", "Photos must be 18 MB or smaller.");
  return bytes;
}

export type UploadManualHomePhotoInput = { homeId: number; base64: string; contentType: string };
export type UploadManualHomePhotoResult = { id: number; homeId: number; sortOrder: number; width: number; height: number };

/**
 * uploadManualHomePhoto
 * Input: UploadManualHomePhotoInput { homeId, base64 (raw or data URL), contentType (image/*) }
 * Output: UploadManualHomePhotoResult { id, homeId, sortOrder, width, height }
 * Spec step 1 for admin uploads: the bytes are normalized (rotated, EXIF
 * stripped, 1600 px), stored as the private original, and a dealPhotos row is
 * inserted pending with sourceUrl "upload:<random id>" so the regular pipeline
 * (steps 3 to 6) runs from the stored original. A queue drain is kicked.
 */
export async function uploadManualHomePhoto(input: UploadManualHomePhotoInput): Promise<UploadManualHomePhotoResult> {
  const db = await requireDb();
  if (!ACCEPTED_UPLOAD_TYPES.has(String(input.contentType ?? "").toLowerCase().split(";")[0].trim())) throw new PhotoAdminError("invalid_upload", "Upload a JPEG, PNG, WebP, HEIC, AVIF, or GIF photo.");
  const home = (await db.select({ id: dealHomes.id, communityId: dealHomes.communityId }).from(dealHomes).where(eq(dealHomes.id, input.homeId)).limit(1))[0];
  if (!home) throw new PhotoAdminError("home_not_found", "Home not found.");
  const raw = decodeUploadBase64(input.base64);
  let normalized: Buffer;
  try {
    normalized = await normalizeDealPhotoOriginal(raw);
  } catch {
    throw new PhotoAdminError("invalid_upload", "That file could not be read as a photo.");
  }
  const metadata = await sharp(normalized).metadata();
  const sourceUrl = `${UPLOAD_SOURCE_PREFIX}${crypto.randomBytes(12).toString("base64url")}`;
  const sortRow = (await db.select({ next: sql<number>`COALESCE(MAX(${dealPhotos.sortOrder}), -1) + 1` }).from(dealPhotos).where(eq(dealPhotos.homeId, home.id)))[0];
  const sortOrder = Number(sortRow?.next ?? 0);
  const inserted = await db.insert(dealPhotos).values({
    homeId: home.id,
    sourceUrl,
    sourceHash: digest(sourceUrl),
    sortOrder,
    processingState: "pending",
    processingAttempts: 0,
    // Parked until the original is stored; the update below makes it due.
    nextProcessingAttemptAt: null,
    automaticHidden: true,
  });
  const id = Number((inserted as unknown as [{ insertId?: number }])[0]?.insertId ?? 0);
  if (!id) throw new PhotoAdminError("database_unavailable", "The photo record could not be created.");
  try {
    const stored = await storagePut(`${PRIVATE_PREFIX}originals/${id}.webp`, normalized, "image/webp", { unique: false });
    await db.update(dealPhotos).set({ originalStorageKey: stored.key, originalVersion: digest(normalized), nextProcessingAttemptAt: new Date() }).where(eq(dealPhotos.id, id));
  } catch {
    await db.delete(dealPhotos).where(eq(dealPhotos.id, id)).catch(() => undefined);
    throw new PhotoAdminError("storage_unavailable", "The photo could not be stored. Try again.");
  }
  await db.update(dealCommunities).set({ catalogUpdatedAt: new Date() }).where(eq(dealCommunities.id, home.communityId));
  void processPendingDealPhotos(5).catch(() => undefined);
  return { id, homeId: home.id, sortOrder, width: metadata.width ?? 0, height: metadata.height ?? 0 };
}
