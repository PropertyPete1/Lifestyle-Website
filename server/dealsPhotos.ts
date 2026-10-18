import crypto from "node:crypto";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { dealCommunities, dealHomes, dealPhotoRenders, dealPhotos, dealLeads, dealSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { storageDelete, storageDeleteCapability, storagePut, storageReadPrivate } from "./storage";
import { displayForLead } from "../shared/deals";

const PRIVATE_PREFIX = "builder-deals-private/";
const MAX_DOWNLOAD_BYTES = 18 * 1024 * 1024;
const MAX_INPUT_PIXELS = 50_000_000;
const MAX_ORIGINAL_EDGE = 1_600;
const MIN_OCR_WORD_CONFIDENCE = 70;
const MAX_PROCESSING_ATTEMPTS = 5;
const PROCESSING_LEASE_MS = 15 * 60_000;
const APPROVED_IMAGE_HOSTS = new Set([
  "www.mihomes.com",
  "mihomes.com",
  "dam.mihomes.com",
  "cdn.mihomes.com",
  "www.chesmar.com",
  "chesmar.com",
  "images.ctfassets.net",
  "cdn.sanity.io",
]);
const ACCEPTED_IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "heif"]);

const digest = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");

class PhotoProcessingError extends Error {
  constructor(readonly code: PhotoProcessingErrorCode) {
    super(code);
  }
}

type PhotoProcessingErrorCode =
  | "unapproved_source"
  | "source_unavailable"
  | "invalid_image"
  | "image_too_large"
  | "invalid_crop"
  | "image_too_small"
  | "watermark_region_missing"
  | "watermark_settings_invalid"
  | "queue_unavailable"
  | "storage_unavailable"
  | "ocr_unavailable"
  | "processing_failed";

export type PhotoRegion = { x: number; y: number; width: number; height: number };
export type OcrBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrWord = { text: string; confidence: number; bbox?: OcrBox; lineId?: string };
export type OcrMatch = { term: string; confidence: number; words: string[]; bbox?: OcrBox };
export type BuilderPhotoSettings = {
  enabled: boolean;
  region: PhotoRegion | null;
  keywords: string[];
  reviewedSampleIds: number[];
  revision: string;
};
export const DEFAULT_PHOTO_HIDE_KEYWORDS = ["Homes", "Realty", "Realtors", "Real Estate", "MLS", "Photography", "Copyright"];
const LAUNCH_BUILDERS = new Set(["chesmar", "chesmar homes", "m/i homes"]);
const builderKey = (builder: string) => builder.trim().toLowerCase().replace(/\s+/g, " ");
const builderSettingsKey = (builder: string) => `photos.builder.${digest(builderKey(builder)).slice(0, 32)}`;

/** Stored in the existing private settings table; no migration is required. */
export function validatePhotoRegion(value: unknown): PhotoRegion {
  if (!value || typeof value !== "object") throw new PhotoProcessingError("watermark_settings_invalid");
  const { x, y, width, height } = value as PhotoRegion;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n)) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) {
    throw new PhotoProcessingError("watermark_settings_invalid");
  }
  return { x, y, width, height };
}

function defaultBuilderPhotoSettings(builder: string): BuilderPhotoSettings {
  // Launch removal is ON, but an unreviewed/legacy "bottom" string is NEVER
  // guessed into a rectangle. Publication waits for five reviewed samples.
  return { enabled: LAUNCH_BUILDERS.has(builderKey(builder)), region: null, keywords: [...DEFAULT_PHOTO_HIDE_KEYWORDS], reviewedSampleIds: [], revision: "unconfigured-v1" };
}

export async function getBuilderPhotoSettings(builder: string): Promise<BuilderPhotoSettings> {
  const db = await getDb();
  if (!db) throw new PhotoProcessingError("queue_unavailable");
  const key = builderSettingsKey(builder);
  const stored = (await db.select().from(dealSettings).where(eq(dealSettings.key, key)).limit(1))[0];
  if (!stored) {
    const settings = defaultBuilderPhotoSettings(builder);
    await db.insert(dealSettings).values({ key, value: JSON.stringify(settings) }).onDuplicateKeyUpdate({ set: { key } });
    // Re-read a concurrent admin write rather than use stale defaults.
    const actual = (await db.select().from(dealSettings).where(eq(dealSettings.key, key)).limit(1))[0];
    if (!actual) return settings;
    return parseBuilderPhotoSettings(actual.value);
  }
  return parseBuilderPhotoSettings(stored.value);
}

function parseBuilderPhotoSettings(value: string): BuilderPhotoSettings {
  try {
    const parsed = JSON.parse(value) as BuilderPhotoSettings;
    if (typeof parsed.enabled !== "boolean" || !Array.isArray(parsed.keywords) || !parsed.keywords.every((s) => typeof s === "string") || typeof parsed.revision !== "string" || !Array.isArray(parsed.reviewedSampleIds)) throw new Error("invalid settings");
    return { ...parsed, region: parsed.region ? validatePhotoRegion(parsed.region) : null, keywords: Array.from(new Set([...DEFAULT_PHOTO_HIDE_KEYWORDS, ...parsed.keywords])) };
  } catch { throw new PhotoProcessingError("watermark_settings_invalid"); }
}

/** Read a builder image with strict redirects and a streaming download cap. */
export async function downloadDealPhoto(raw: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  let url = safeDealImageUrl(raw);
  const initialHost = url.hostname;
  const signal = AbortSignal.timeout(20_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new PhotoProcessingError("source_unavailable");
      url = safeDealImageUrl(new URL(location, url).toString());
      if (url.hostname !== initialHost) throw new PhotoProcessingError("unapproved_source");
      continue;
    }
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("image/") || !response.body) {
      await response.body?.cancel();
      throw new PhotoProcessingError("source_unavailable");
    }
    if (Number(response.headers.get("content-length")) > MAX_DOWNLOAD_BYTES) {
      await response.body.cancel();
      throw new PhotoProcessingError("image_too_large");
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > MAX_DOWNLOAD_BYTES) throw new PhotoProcessingError("image_too_large");
        chunks.push(Buffer.from(next.value));
      }
    } finally { await reader.cancel().catch(() => undefined); }
    return Buffer.concat(chunks, length);
  }
  throw new PhotoProcessingError("source_unavailable");
}

/** Only explicitly reviewed HTTPS builder/CDN origins may supply a Deals image. */
export function safeDealImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PhotoProcessingError("unapproved_source");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !APPROVED_IMAGE_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new PhotoProcessingError("unapproved_source");
  }
  return url;
}

function xmlText(value: string) {
  return value.replace(/[&<>"']/g, "");
}

/**
 * Covers the complete image after rotation. The identity is only ever used in
 * the private render bytes and is never embedded in an object key or URL.
 */
export function tiledWatermarkSvg(text: string, width: number, height: number) {
  const safe = xmlText(text).slice(0, 240);
  const fontSize = Math.max(13, Math.round(width / 42));
  // Keep adjacent labels from overlapping even on narrow/mobile renders.
  const estimatedLabelWidth = Math.ceil(safe.length * fontSize * 0.6);
  const columnGap = Math.max(estimatedLabelWidth + fontSize * 2, Math.round(width / 2.2));
  const rowGap = Math.max(56, Math.round(height / 5));
  const labels: string[] = [];
  for (let y = -height; y < height * 2; y += rowGap) {
    for (let x = -width; x < width * 2; x += columnGap) {
      labels.push(`<text x="${x}" y="${y}">${safe}</text>`);
    }
  }
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(-28 ${width / 2} ${height / 2})" fill="#ffffff" fill-opacity="0.32" font-family="Arial" font-size="${fontSize}" font-weight="600">${labels.join("")}</g></svg>`,
  );
}

/** Lowercase, punctuation-neutral OCR tokens. Matching is never substring-based. */
export function normalizedOcrTokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    // Sources and configured builder names are ASCII in this deployment. Avoid
    // Unicode-property escapes because this project currently downlevels tests.
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * A configured term only matches a consecutive sequence of complete OCR words,
 * and every word in that sequence must meet the confidence floor. This avoids
 * e.g. treating "chester" as an occurrence of "Chesmar".
 */
export function findExactOcrMatches(words: OcrWord[], terms: string[], minimumConfidence = MIN_OCR_WORD_CONFIDENCE): OcrMatch[] {
  const expandedWords = words.flatMap((word) => normalizedOcrTokens(word.text).map((text) => ({ ...word, text, confidence: Number(word.confidence) })));
  const uniqueTerms = new Map<string, { term: string; tokens: string[] }>();
  for (const rawTerm of terms) {
    const term = rawTerm.trim();
    const tokens = normalizedOcrTokens(term);
    if (term && tokens.length) uniqueTerms.set(tokens.join("\u0000"), { term, tokens });
  }

  const matches: OcrMatch[] = [];
  for (const { term, tokens } of Array.from(uniqueTerms.values())) {
    for (let start = 0; start <= expandedWords.length - tokens.length; start++) {
      const candidate = expandedWords.slice(start, start + tokens.length);
      if (candidate.every((word, index) => word.text === tokens[index] && Number.isFinite(word.confidence) && word.confidence >= minimumConfidence && (!word.lineId || !candidate[0].lineId || word.lineId === candidate[0].lineId))) {
        const boxes = candidate.map((word) => word.bbox).filter((box): box is OcrBox => Boolean(box));
        matches.push({
          term,
          confidence: Math.round(Math.min(...candidate.map((word) => word.confidence)) * 100) / 100,
          words: candidate.map((word) => word.text),
          ...(boxes.length === candidate.length ? { bbox: { x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) } } : {}),
        });
        break;
      }
    }
  }
  return matches;
}

/** Step 6: full words/phrases only; short builder names need adjacent Homes. */
export function findDealPhotoHideMatches(words: OcrWord[], terms: string[], keywords: string[] = DEFAULT_PHOTO_HIDE_KEYWORDS): OcrMatch[] {
  const longTerms: string[] = [];
  for (const term of terms) {
    const tokens = normalizedOcrTokens(term);
    if (!tokens.length) continue;
    if (tokens.join("").length >= 4) longTerms.push(term);
    else longTerms.push(`${term} Homes`, `Homes ${term}`);
  }
  // Keywords intentionally include the short term MLS. Homes is independently
  // prohibited even if a short builder name was missed by OCR.
  return findExactOcrMatches(words, [...longTerms, ...DEFAULT_PHOTO_HIDE_KEYWORDS, ...keywords]);
}

export function dealPhotoHouseNumber(address: string | null | undefined): string | null {
  return /^\s*(\d+[a-z]?)\b/i.exec(address ?? "")?.[1] ?? null;
}

type OcrWorker = {
  recognize(bytes: Buffer, options: object, output: { blocks: boolean }): Promise<{ data?: { blocks?: Array<{ paragraphs: Array<{ lines: Array<{ words: OcrWord[] }> }> }> | null } }>;
  terminate(): Promise<unknown>;
};

let ocrWorkerPromise: Promise<OcrWorker> | null = null;
let ocrWork: Promise<void> = Promise.resolve();
const OCR_TIMEOUT_MS = 30_000;

async function withDeadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new PhotoProcessingError("ocr_unavailable")), milliseconds); })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function resetOcrWorker() {
  const previous = ocrWorkerPromise;
  ocrWorkerPromise = null;
  if (previous) void previous.then((worker) => withDeadline(worker.terminate(), 2_000)).catch(() => undefined);
}

async function runOcrExclusively<T>(work: () => Promise<T>): Promise<T> {
  const previous = ocrWork;
  let release: () => void = () => undefined;
  ocrWork = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

export async function recognizeDealPhotoWords(bytes: Buffer): Promise<OcrWord[]> {
  return runOcrExclusively(async () => {
    try {
      if (!ocrWorkerPromise) {
        const { createWorker } = await import("tesseract.js");
        ocrWorkerPromise = createWorker("eng", 1, {
          logger: () => undefined,
          langPath: path.join(process.cwd(), "server", "ocr"),
          cachePath: path.join(process.cwd(), ".cache", "builder-deals-ocr"),
          gzip: false,
        }) as unknown as Promise<OcrWorker>;
      }
      // Tesseract 7 defaults to text-only and has no data.words. Request blocks
      // explicitly and flatten their line words, preserving spatial adjacency.
      const worker = await withDeadline(ocrWorkerPromise, OCR_TIMEOUT_MS);
      const result = await withDeadline(worker.recognize(bytes, {}, { blocks: true }), OCR_TIMEOUT_MS);
      if (!result.data || !(result.data.blocks === null || Array.isArray(result.data.blocks))) throw new Error("missing OCR blocks");
      return (result.data.blocks ?? []).flatMap((block, b) => block.paragraphs.flatMap((paragraph, p) => paragraph.lines.flatMap((line, l) => line.words
        .filter((word) => typeof word.text === "string" && Number.isFinite(word.confidence))
        .map((word) => ({ text: word.text, confidence: word.confidence, bbox: word.bbox, lineId: `${b}:${p}:${l}` })))));
    } catch {
      await resetOcrWorker();
      throw new PhotoProcessingError("ocr_unavailable");
    }
  });
}

export async function closeDealPhotoOcrWorker() {
  await withDeadline(ocrWork, OCR_TIMEOUT_MS + 2_000).catch(() => undefined);
  await resetOcrWorker();
}

function safeScrubList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? Object.values(parsed).flat() : [];
    return values.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function photoErrorCode(error: unknown): PhotoProcessingErrorCode {
  if (error instanceof PhotoProcessingError) return error.code;
  return "processing_failed";
}

function wasUpdated(result: unknown): boolean {
  const packet = Array.isArray(result) ? result[0] : result;
  return Number((packet as { affectedRows?: number } | undefined)?.affectedRows ?? 0) > 0;
}

function retryAt(attempt: number) {
  const delay = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6));
  return new Date(Date.now() + delay);
}

/** Deterministically rotate, resize, transcode, and strip all input metadata. */
export async function normalizeDealPhotoOriginal(original: Buffer): Promise<Buffer> {
  if (original.byteLength === 0 || original.byteLength > MAX_DOWNLOAD_BYTES) throw new PhotoProcessingError("image_too_large");
  let metadata: Metadata;
  try {
    metadata = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).metadata();
  } catch {
    throw new PhotoProcessingError("invalid_image");
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > MAX_INPUT_PIXELS ||
    !metadata.format ||
    !ACCEPTED_IMAGE_FORMATS.has(metadata.format) ||
    (metadata.pages !== undefined && metadata.pages > 1)
  ) {
    throw new PhotoProcessingError("invalid_image");
  }
  try {
    // sharp does not copy EXIF/XMP/ICC metadata unless withMetadata() is used.
    return await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize({ width: MAX_ORIGINAL_EDGE, height: MAX_ORIGINAL_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90, effort: 4, smartSubsample: true })
      .toBuffer();
  } catch {
    throw new PhotoProcessingError("invalid_image");
  }
}

async function makeDealPhotoMaster(normalizedOriginal: Buffer, bottomCrop: number, cropApproved: boolean): Promise<Buffer> {
  let source = sharp(normalizedOriginal, { limitInputPixels: MAX_INPUT_PIXELS, animated: false });
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) throw new PhotoProcessingError("invalid_image");
  if (cropApproved && bottomCrop > 0) {
    if (!Number.isInteger(bottomCrop) || bottomCrop >= metadata.height) throw new PhotoProcessingError("invalid_crop");
    source = source.extract({ left: 0, top: 0, width: metadata.width, height: metadata.height - bottomCrop });
  }
  return source.webp({ quality: 88, effort: 4, smartSubsample: true }).toBuffer();
}

async function claimDealPhoto(photoId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const claimed = await db
    .update(dealPhotos)
    .set({
      processingState: "processing",
      processingAttempts: sql`${dealPhotos.processingAttempts} + 1`,
      processingStartedAt: now,
      lastProcessingError: null,
    })
    .where(and(
      eq(dealPhotos.id, photoId),
      eq(dealPhotos.processingState, "pending"),
      or(isNull(dealPhotos.nextProcessingAttemptAt), lte(dealPhotos.nextProcessingAttemptAt, now)),
    ));
  if (!wasUpdated(claimed)) return null;

  return {
    db,
    row: (await db
      .select({ photo: dealPhotos, home: dealHomes, community: dealCommunities })
      .from(dealPhotos)
      .innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
      .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
      .where(eq(dealPhotos.id, photoId))
      .limit(1))[0],
  };
}

async function recordPhotoFailure(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, photoId: number, attempt: number, code: PhotoProcessingErrorCode) {
  const retry = attempt < MAX_PROCESSING_ATTEMPTS && code !== "unapproved_source" && code !== "invalid_crop";
  await db.update(dealPhotos).set({
    automaticHidden: true,
    processingState: retry ? "pending" : "failed",
    nextProcessingAttemptAt: retry ? retryAt(attempt) : null,
    processingStartedAt: null,
    lastProcessingError: code,
    ocrMatches: JSON.stringify([{ kind: "processing_error", code }]),
  }).where(eq(dealPhotos.id, photoId));
  return retry;
}

/**
 * Claims and processes one durable queue entry. No source error, signed URL, or
 * remote response is propagated to a browser or persisted as an admin message.
 */
export async function processDealPhoto(photoId: number): Promise<{ ok: boolean; hidden?: boolean; matches?: OcrMatch[]; retryScheduled?: boolean; skipped?: boolean }> {
  const claimed = await claimDealPhoto(photoId);
  if (!claimed) return { ok: false, skipped: true };
  const { db, row } = claimed;
  if (!row) return { ok: false, skipped: true };
  const attempt = Math.max(1, row.photo.processingAttempts);

  try {
    const url = safeDealImageUrl(row.photo.sourceUrl);
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("image/")) {
      throw new PhotoProcessingError("source_unavailable");
    }
    const normalizedOriginal = await normalizeDealPhotoOriginal(Buffer.from(await response.arrayBuffer()));
    const builderSettings = await getBuilderPhotoSettings(row.community.builder);
    if (builderSettings.enabled && !builderSettings.region) throw new PhotoProcessingError("watermark_region_missing");
    const master = await makeDealPhotoMaster(normalizedOriginal, row.photo.bottomCrop, row.community.watermarkRemovalApproved);
    const configuredTerms = Array.from(new Set([
      row.community.builder,
      row.community.privateName,
      row.home.privateAddress ?? "",
      row.home.privatePlanName ?? "",
      ...safeScrubList(row.community.scrubList),
    ].filter((term): term is string => Boolean(term.trim()))));
    const matches = findDealPhotoHideMatches(await recognizeDealPhotoWords(master), configuredTerms, builderSettings.keywords);
    if (matches.length) {
      await db.update(dealPhotos).set({
        automaticHidden: true,
        processingState: "failed",
        nextProcessingAttemptAt: null,
        processingStartedAt: null,
        lastProcessingError: null,
        ocrMatches: JSON.stringify(matches),
      }).where(eq(dealPhotos.id, photoId));
      return { ok: false, hidden: true, matches };
    }

    const originalVersion = digest(normalizedOriginal);
    const version = digest(master);
    // Stable keys overwrite obsolete private bytes on reprocess. The object
    // store API available to this app has no delete operation, so this prevents
    // a new orphan for every retry/crop update while keeping all objects private.
    const originalStored = await storagePut(`${PRIVATE_PREFIX}originals/${photoId}.webp`, normalizedOriginal, "image/webp", { unique: false });
    const processedStored = await storagePut(`${PRIVATE_PREFIX}masters/${photoId}.webp`, master, "image/webp", { unique: false });
    await db.update(dealPhotos).set({
      // sourceHash remains the source-URL dedupe key used by dealsSync. The
      // deterministic bytes are represented by originalVersion/version keys.
      originalStorageKey: originalStored.key,
      processedStorageKey: processedStored.key,
      originalVersion,
      processedVersion: version,
      automaticHidden: false,
      ocrMatches: "[]",
      processingState: "processed",
      nextProcessingAttemptAt: null,
      processingStartedAt: null,
      lastProcessingError: null,
      processedAt: new Date(),
    }).where(eq(dealPhotos.id, photoId));
    return { ok: true };
  } catch (error) {
    const code = photoErrorCode(error);
    console.warn(`[deals-photo] processing ${code} for photo ${photoId}`);
    const retryScheduled = await recordPhotoFailure(db, photoId, attempt, code).catch(() => false);
    return { ok: false, hidden: true, retryScheduled };
  }
}

/** Puts a photo back into the durable queue. Safe for admin reprocess controls. */
export async function requeueDealPhoto(photoId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(dealPhotos).set({
    automaticHidden: true,
    processingState: "pending",
    processingAttempts: 0,
    nextProcessingAttemptAt: new Date(),
    processingStartedAt: null,
    lastProcessingError: null,
    ocrMatches: "[]",
  }).where(eq(dealPhotos.id, photoId));
}

/** Processes due retries and abandoned leases after a process restart. */
export async function processPendingDealPhotos(limit = 10) {
  const db = await getDb();
  if (!db) return { processed: 0, retried: 0, skipped: 0 };
  const now = new Date();
  const leaseExpired = new Date(now.getTime() - PROCESSING_LEASE_MS);
  await db.update(dealPhotos).set({
    processingState: "pending",
    nextProcessingAttemptAt: now,
    processingStartedAt: null,
    lastProcessingError: "processing_lease_expired",
  }).where(and(eq(dealPhotos.processingState, "processing"), lt(dealPhotos.processingStartedAt, leaseExpired)));

  const due = await db.select({ id: dealPhotos.id }).from(dealPhotos)
    .where(and(eq(dealPhotos.processingState, "pending"), or(isNull(dealPhotos.nextProcessingAttemptAt), lte(dealPhotos.nextProcessingAttemptAt, now))))
    .limit(Math.max(1, Math.min(50, Math.floor(limit))));
  let processed = 0;
  let retried = 0;
  let skipped = 0;
  for (const photo of due) {
    const result = await processDealPhoto(photo.id);
    if (result.skipped) skipped++;
    else if (result.ok) processed++;
    else if (result.retryScheduled) retried++;
  }
  return { processed, retried, skipped };
}

export function dealPhotoRenderCacheVersion(photoVersion: string, leadId: number, identity: string) {
  return digest(`watermark-v1\u0000${photoVersion}\u0000${leadId}\u0000${identity}`).slice(0, 64);
}

/** Produces only per-lead watermarked image bytes; no object URL leaves the server. */
export async function renderDealPhotoForLead(photoId: number, leadId: number) {
  try {
    const db = await getDb();
    if (!db) return null;
    const now = new Date();
    const row = (await db.select({ photo: dealPhotos, home: dealHomes, community: dealCommunities, lead: dealLeads }).from(dealPhotos)
      .innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
      .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
      .innerJoin(dealLeads, eq(dealLeads.id, leadId))
      .where(and(
        eq(dealPhotos.id, photoId),
        eq(dealPhotos.processingState, "processed"),
        eq(dealPhotos.automaticHidden, false),
        eq(dealPhotos.adminHidden, false),
        eq(dealHomes.status, "available"),
        eq(dealCommunities.paused, false),
        eq(dealCommunities.active, true),
        eq(dealLeads.status, "verified"),
        gt(dealLeads.expiresAt, now),
      )).limit(1))[0];
    if (!row?.photo.processedStorageKey || !row.photo.processedVersion) return null;

    const identity = displayForLead(row.lead);
    const cacheVersion = dealPhotoRenderCacheVersion(row.photo.processedVersion, leadId, identity);
    const cached = (await db.select().from(dealPhotoRenders).where(and(
      eq(dealPhotoRenders.photoId, photoId),
      eq(dealPhotoRenders.leadId, leadId),
      eq(dealPhotoRenders.version, cacheVersion),
      gt(dealPhotoRenders.expiresAt, now),
    )).limit(1))[0];
    if (cached) {
      try {
        return await storageReadPrivate(cached.storageKey);
      } catch {
        // A stale/missing cache object is regenerated below. Do not leak the
        // signed-store error to a protected image response.
      }
    }

    const source = await storageReadPrivate(row.photo.processedStorageKey);
    const meta = await sharp(source.data, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).metadata();
    if (!meta.width || !meta.height) return null;
    const rendered = await sharp(source.data, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .composite([{ input: tiledWatermarkSvg(`Prepared for ${identity} | Lifestyle Design Realty`, meta.width, meta.height), gravity: "center" }])
      .webp({ quality: 88, effort: 4, smartSubsample: true })
      .toBuffer();
    const expiry = new Date(Math.min(row.lead.expiresAt.getTime(), Date.now() + 48 * 60 * 60_000));
    // The versioned database cache key includes lead identity. The physical key
    // is stable per lead/photo so reprocesses overwrite obsolete private bytes
    // instead of accumulating objects when storage deletion is unavailable.
    // Do not use a bare lead/photo key: an identity edit could otherwise race
    // with an older request and make a previous cache row read another lead
    // label. This opaque component is stable for the same lead identity.
    const identityKey = digest(`${leadId}\u0000${identity}`).slice(0, 32);
    const stored = await storagePut(`${PRIVATE_PREFIX}renders/${leadId}/${photoId}-${identityKey}.webp`, rendered, "image/webp", { unique: false });
    await db.insert(dealPhotoRenders).values({ photoId, leadId, version: cacheVersion, storageKey: stored.key, expiresAt: expiry })
      .onDuplicateKeyUpdate({ set: { storageKey: stored.key, expiresAt: expiry } });
    return { data: rendered, contentType: "image/webp" };
  } catch {
    // Protected routes deliberately return the same not-found shape for an
    // unavailable asset, unreadable private object, and invalid image.
    return null;
  }
}

/**
 * Removes expired render metadata in bounded batches. Forge exposes put/get
 * presigning to this app but no verified delete endpoint, so callers must not
 * claim that remote S3 objects were deleted. Stable render keys prevent new
 * reprocess or retry orphans; existing legacy random-key objects remain a
 * storage-operator cleanup task.
 */
export async function cleanupExpiredDealPhotoRenders(limit = 100) {
  const db = await getDb();
  if (!db) return { recordsDeleted: 0, storageObjectsDeleted: 0, storageCleanup: "unavailable" as const };
  const rows = await db.select({ id: dealPhotoRenders.id }).from(dealPhotoRenders)
    .where(lt(dealPhotoRenders.expiresAt, new Date()))
    .limit(Math.max(1, Math.min(500, Math.floor(limit))));
  for (const row of rows) await db.delete(dealPhotoRenders).where(eq(dealPhotoRenders.id, row.id));
  return { recordsDeleted: rows.length, storageObjectsDeleted: 0, storageCleanup: "unavailable" as const };
}
