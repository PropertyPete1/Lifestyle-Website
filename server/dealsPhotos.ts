import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { dealCommunities, dealHomes, dealPhotoRenders, dealPhotos, dealLeads, dealSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { storageDelete, storagePut, storageReadPrivate } from "./storage";
import { dealScrubTerms, displayForLead } from "../shared/deals";
import { effectiveScrubConfig } from "./dealsScrub";

const PRIVATE_PREFIX = "builder-deals-private/";
const MAX_DOWNLOAD_BYTES = 18 * 1024 * 1024;
const MAX_INPUT_PIXELS = 50_000_000;
const MAX_ORIGINAL_EDGE = 1_600;
const MIN_MASTER_EDGE = 16;
const MIN_OCR_WORD_CONFIDENCE = 70;
const MAX_PROCESSING_ATTEMPTS = 5;
/**
 * A claimed row whose run died (instance recycled, request cut off) is put back
 * after this long. One photo takes seconds and at most about two minutes (20 s
 * download cap plus two 30 s OCR deadlines), so ten minutes never steals a live claim.
 */
export const PROCESSING_LEASE_MS = 10 * 60_000;
/** Spec step 5: only text inside the outer 20 percent of the height is ever cropped away. */
const OUTER_BAND_FRACTION = 0.2;
/** A region crop must leave this share of the height; otherwise the region is covered instead. */
const MIN_REMAINING_HEIGHT_FRACTION = 0.4;
/**
 * Photos in flight per drain. OCR runs on one worker (serialized), so a second
 * lane overlaps download, sharp work and storage writes with it; more lanes
 * would mostly add memory and libuv threadpool pressure on the web instance.
 */
export const PHOTO_PROCESSING_CONCURRENCY = 2;
/** At most this many downloads from one builder image host at a time, whatever the lane count. */
const HOST_DOWNLOAD_CONCURRENCY = 2;
/**
 * Cron drains stop starting photos after this long; photos in flight then
 * finish (seconds), so one call stays well under five minutes.
 */
export const PHOTO_DRAIN_BUDGET_MS = 210_000;
/** Candidates read per queue refill (priority order). */
const PHOTO_DRAIN_BATCH = 40;
/** Same-source rows queued right behind a candidate per refill, so their work is reused while it is still in memory. */
const PHOTO_SIBLINGS_PER_REFILL = 200;
/**
 * libwebp effort for the stored original and master. Effort trades CPU for a
 * few percent of file size at the same quality setting; these are private
 * intermediates (every lead render is re-encoded), so the cheaper setting
 * is used (scripts/bench-deal-photos.mts: the normalize and master steps take
 * about 20 percent less time than at effort 4).
 */
const STORED_WEBP_EFFORT = 2;
const RENDER_CONCURRENCY = 3;
const RENDER_MEMORY_ENTRIES = 50;
/** Parked queue state: the builder is enabled for removal but has no saved region yet. */
export const AWAITING_REGION = "awaiting_region";
/** The upload pipeline entry shares the queue; its source is a private opaque id, never a URL. */
export const UPLOAD_SOURCE_PREFIX = "upload:";
export const RENDERABLE_LEAD_STATUSES = ["verified", "team"] as const;
const APPROVED_IMAGE_HOSTS = new Set([
  "www.mihomes.com",
  "mihomes.com",
  "dam.mihomes.com",
  "cdn.mihomes.com",
  "www.chesmar.com",
  "chesmar.com",
  "images.ctfassets.net",
  "cdn.sanity.io",
  // Perry Homes serves its photos from Cloudinary (…/perryhomes/…); the path is checked below.
  "res.cloudinary.com",
  "www.drhorton.com",
  "drhorton.com",
  // PulteGroup (Pulte, Centex, Del Webb) serves its photos from Picturepark.
  "pultegroup.cdn.picturepark.com",
  // Homefiniti-platform builders serve photos from media.<builder>.com.
  "media.firstamericahomes.com",
  "media.coventryhomes.com",
  "media.hhomesltd.com",
  "www.centurycommunities.com",
  "www.kbhome.com",
  "cdn.tollbrothers.com",
  "www.davidweekleyhomes.com",
  "assetcontentdeliveryapi.davidweekleyhomes.com",
  "awh.widen.net",
  "www.sitterlehomes.com",
  // Scott Felder Homes serves its photos from the BuilderCloud bucket (…/buildercloud/…); the path is checked below.
  "s3.amazonaws.com",
  "assets.drbhomes.com",
  "assets.livelegendhomes.com",
  // View Homes serves its photos from its WordPress uploads (…/wp-content/uploads/…); the path is checked below.
  "yourviewhome.com",
  // Texas Homes serves its photos from its Drupal files (…/sites/default/files/…); the path is checked below.
  "www.texas-homes.com",
  // Hakes Brothers serves its photos from its media library (…/storage/app/medialibrary/…); the path is checked below.
  "www.hakesbrothers.com",
  // Beazer serves its photos from its DAM (…/images/…) and CMS (…/contentassets/…, …/globalassets/…) hosts; the path is checked below.
  "cmp.beazer.com",
  "cms.beazer.com",
  "www.beazer.com",
  // Lennar serves its photos from its image API (…/api/images/…); the path is checked below.
  "cdn.lennar.com",
  // Empire Homes serves its photos from its WordPress uploads (…/wp-content/uploads/…); the path is checked below.
  "empirehomes.com",
  // LGI Homes serves its photos from Sitecore's edge CDN (…/lgihomesinc…/…); the path is checked below.
  "edge.sitecorecloud.io",
]);
const ACCEPTED_IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "heif"]);

const digest = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");

export class PhotoProcessingError extends Error {
  constructor(readonly code: PhotoProcessingErrorCode) {
    super(code);
  }
}

export type PhotoProcessingErrorCode =
  | "unapproved_source"
  | "source_unavailable"
  | "invalid_image"
  | "image_too_large"
  | "invalid_crop"
  | "image_too_small"
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
/** Launch builders stamp a logo strip along the bottom edge; admin can refine this from the sample picker. */
export const DEFAULT_LAUNCH_WATERMARK_REGION: PhotoRegion = { x: 0, y: 88, width: 100, height: 12 };
const LAUNCH_BUILDERS = new Set(["chesmar", "chesmar homes", "m/i homes"]);
export const builderKey = (builder: string) => builder.trim().toLowerCase().replace(/\s+/g, " ");
export const builderSettingsKey = (builder: string) => `photos.builder.${digest(builderKey(builder)).slice(0, 32)}`;

/** Minimal promise concurrency limiter (p-limit is not a dependency). A released slot is handed straight to the next waiter. */
export function createLimiter(concurrency: number) {
  const max = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const waiters: Array<() => void> = [];
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else active--;
  };
  const limiter = async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiters.push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      release();
    }
  };
  return Object.assign(limiter, { inFlight: () => active, waiting: () => waiters.length });
}

/** Small least-recently-used map. Keys are opaque cache versions, never lead or photo identifiers alone. */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly maxEntries: number) {}
  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }
  set(key: string, value: V) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
  delete(key: string) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}

/** Stored in the existing private settings table; no migration is required. */
export function validatePhotoRegion(value: unknown): PhotoRegion {
  if (!value || typeof value !== "object") throw new PhotoProcessingError("watermark_settings_invalid");
  const { x, y, width, height } = value as PhotoRegion;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n)) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) {
    throw new PhotoProcessingError("watermark_settings_invalid");
  }
  return { x, y, width, height };
}

const UNCONFIGURED_REVISION = "unconfigured-v1";
const LAUNCH_DEFAULT_REVISION = "launch-default-v1";

export function defaultBuilderPhotoSettings(builder: string): BuilderPhotoSettings {
  // Launch removal is ON with the reviewed bottom-strip default so the preview
  // processes immediately; any other builder waits for an admin region.
  const launch = LAUNCH_BUILDERS.has(builderKey(builder));
  return { enabled: launch, region: launch ? { ...DEFAULT_LAUNCH_WATERMARK_REGION } : null, keywords: [...DEFAULT_PHOTO_HIDE_KEYWORDS], reviewedSampleIds: [], revision: launch ? LAUNCH_DEFAULT_REVISION : UNCONFIGURED_REVISION };
}

/**
 * Rows seeded by the earlier code carry region null and were never saved by an
 * admin; a launch builder upgrades to the reviewed default so its photos stop
 * parking. An admin save (revision "admin-...") is never overridden.
 */
function launchUpgradeFor(builder: string, settings: BuilderPhotoSettings): BuilderPhotoSettings | null {
  if (settings.revision !== UNCONFIGURED_REVISION || settings.region || !LAUNCH_BUILDERS.has(builderKey(builder))) return null;
  return { ...defaultBuilderPhotoSettings(builder), keywords: settings.keywords, reviewedSampleIds: settings.reviewedSampleIds };
}

/**
 * Read-only view of a builder's settings: the stored row as the processing
 * path would interpret it (launch upgrade applied in memory), or the defaults
 * when nothing is stored. Nothing is written, so admin GETs can use it.
 */
export async function readBuilderPhotoSettings(builder: string): Promise<BuilderPhotoSettings> {
  const db = await getDb();
  if (!db) throw new PhotoProcessingError("queue_unavailable");
  const stored = (await db.select().from(dealSettings).where(eq(dealSettings.key, builderSettingsKey(builder))).limit(1))[0];
  if (!stored) return defaultBuilderPhotoSettings(builder);
  const settings = parseBuilderPhotoSettings(stored.value);
  return launchUpgradeFor(builder, settings) ?? settings;
}

/** The processing path's reader: seeds the defaults row and persists the launch upgrade (the only write-on-read). */
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
  const settings = parseBuilderPhotoSettings(stored.value);
  const upgraded = launchUpgradeFor(builder, settings);
  if (upgraded) {
    await db.update(dealSettings).set({ value: JSON.stringify(upgraded) }).where(eq(dealSettings.key, key));
    return upgraded;
  }
  return settings;
}

export function parseBuilderPhotoSettings(value: string): BuilderPhotoSettings {
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
  // A shared image CDN is approved for the builder's own account only.
  if (url.hostname.toLowerCase() === "res.cloudinary.com" && !url.pathname.startsWith("/perryhomes/")) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "edge.sitecorecloud.io" && !/^\/lgihomes/i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "s3.amazonaws.com" && !/^\/buildercloud\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "yourviewhome.com" && !/^\/wp-content\/uploads\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "www.texas-homes.com" && !/^\/sites\/default\/files\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "www.hakesbrothers.com" && !/^\/storage\/app\/medialibrary\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "cdn.lennar.com" && !/^\/api\/images\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (/^(?:cmp|cms|www)\.beazer\.com$/i.test(url.hostname) && !/^\/(?:images|contentassets|globalassets)\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "empirehomes.com" && !/^\/wp-content\/uploads\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  return url;
}

export const isUploadSource = (sourceUrl: string) => sourceUrl.startsWith(UPLOAD_SOURCE_PREFIX);

function xmlText(value: string) {
  return value.replace(/[&<>"']/g, "");
}

/**
 * Covers the complete image after rotation. The identity is only ever used in
 * the private render bytes and is never embedded in an object key or URL.
 * Alternate rows are staggered by half a column so no blank diagonal survives.
 */
export function tiledWatermarkSvg(text: string, width: number, height: number) {
  const safe = xmlText(text).slice(0, 240) || "Lifestyle Design Realty";
  const fontSize = Math.max(13, Math.round(width / 42));
  // Arial 600 measures about 0.5em per character; 0.55em plus one em of air
  // keeps labels apart without the ~300px gaps the old 0.6em + 2em pad left.
  const columnGap = Math.ceil(safe.length * fontSize * 0.55) + fontSize;
  const rowGap = Math.round(fontSize * 4.5);
  const labels: string[] = [];
  let row = 0;
  for (let y = -height; y < height * 2; y += rowGap, row++) {
    const offset = row % 2 ? Math.round(columnGap / 2) : 0;
    for (let x = -width - columnGap + offset; x < width * 2; x += columnGap) {
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

function ocrLineParts(lineId: string | undefined) {
  if (!lineId) return null;
  const parts = lineId.split(":").map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite)) return null;
  return { block: parts[0], paragraph: parts[1], line: parts[2] };
}

/**
 * Two consecutive OCR words may form a phrase on the same line or across two
 * adjacent lines of one paragraph (a stacked monument sign). Words without
 * positional ids are accepted; ids in an unknown format must be identical.
 */
export function ocrWordsAdjacent(previous: OcrWord, word: OcrWord): boolean {
  if (!previous.lineId || !word.lineId) return true;
  const a = ocrLineParts(previous.lineId);
  const b = ocrLineParts(word.lineId);
  if (!a || !b) return previous.lineId === word.lineId;
  return a.block === b.block && a.paragraph === b.paragraph && (b.line === a.line || b.line === a.line + 1);
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
      if (candidate.every((word, index) => word.text === tokens[index] && Number.isFinite(word.confidence) && word.confidence >= minimumConfidence && (index === 0 || ocrWordsAdjacent(candidate[index - 1], word)))) {
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

/**
 * Step 6: full words/phrases only; short builder names need adjacent Homes.
 * `exactTerms` (the home's own house number) bypass the four-character rule.
 */
export function findDealPhotoHideMatches(words: OcrWord[], terms: string[], keywords: string[] = DEFAULT_PHOTO_HIDE_KEYWORDS, exactTerms: string[] = []): OcrMatch[] {
  const longTerms: string[] = [];
  for (const term of terms) {
    const tokens = normalizedOcrTokens(term);
    if (!tokens.length) continue;
    if (tokens.join("").length >= 4) longTerms.push(term);
    else longTerms.push(`${term} Homes`, `Homes ${term}`);
  }
  // Keywords intentionally include the short term MLS. Homes is independently
  // prohibited even if a short builder name was missed by OCR.
  return findExactOcrMatches(words, [...longTerms, ...DEFAULT_PHOTO_HIDE_KEYWORDS, ...keywords, ...exactTerms]);
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
const ocrShutdownHookTargets = new WeakSet<object>();
const OCR_TIMEOUT_MS = 30_000;
const OCR_SHUTDOWN_GRACE_MS = 3_000;

/** Bundled English data ships in server/ocr; a packaged deploy can point elsewhere. */
export function dealPhotoOcrPaths() {
  const langPath = process.env.DEALS_OCR_LANG_PATH?.trim() || path.join(process.cwd(), "server", "ocr");
  const cachePath = process.env.DEALS_OCR_CACHE_PATH?.trim() || path.join(process.cwd(), ".cache", "builder-deals-ocr");
  return { langPath, cachePath };
}

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

type ShutdownSignal = "SIGTERM" | "SIGINT";
type SignalTarget = {
  pid: number;
  once(signal: ShutdownSignal, listener: () => void): unknown;
  listenerCount(signal: ShutdownSignal): number;
  kill(pid: number, signal: ShutdownSignal): unknown;
};

/**
 * The worker thread would otherwise outlive a graceful stop. The hook closes
 * the worker and then re-raises the signal when no other handler exists, so the
 * platform default (exit) still happens. Installed once per process target.
 */
export function installDealPhotoOcrShutdownHooks(target: SignalTarget = process): boolean {
  if (ocrShutdownHookTargets.has(target)) return false;
  ocrShutdownHookTargets.add(target);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    target.once(signal, () => {
      void closeDealPhotoOcrWorker(OCR_SHUTDOWN_GRACE_MS).catch(() => undefined).finally(() => {
        if (target.listenerCount(signal) === 0) target.kill(target.pid, signal);
      });
    });
  }
  return true;
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
        const { langPath, cachePath } = dealPhotoOcrPaths();
        try { fs.mkdirSync(cachePath, { recursive: true }); } catch { /* a read-only cache dir only disables tesseract's cache */ }
        installDealPhotoOcrShutdownHooks();
        ocrWorkerPromise = createWorker("eng", 1, {
          logger: () => undefined,
          langPath,
          cachePath,
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

export async function closeDealPhotoOcrWorker(graceMs = OCR_TIMEOUT_MS + 2_000) {
  await withDeadline(ocrWork, graceMs).catch(() => undefined);
  await resetOcrWorker();
}

/** Every stored private name (categorized or legacy flat) minus the admin-excluded false positives; those are never OCR hide terms. */
function safeScrubList(value: string): string[] {
  return dealScrubTerms(effectiveScrubConfig(value)).filter((item) => item.trim().length > 0);
}

function photoErrorCode(error: unknown): PhotoProcessingErrorCode {
  if (error instanceof PhotoProcessingError) return error.code;
  return "processing_failed";
}

function wasUpdated(result: unknown): boolean {
  const packet = Array.isArray(result) ? result[0] : result;
  return Number((packet as { affectedRows?: number } | undefined)?.affectedRows ?? 0) > 0;
}

function affectedRows(result: unknown): number {
  const packet = Array.isArray(result) ? result[0] : result;
  return Number((packet as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
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
      .webp({ quality: 90, effort: STORED_WEBP_EFFORT, smartSubsample: true })
      .toBuffer();
  } catch {
    throw new PhotoProcessingError("invalid_image");
  }
}

type RawImage = { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

async function decodeRaw(bytes: Buffer): Promise<RawImage> {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).raw().toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) throw new Error("empty image");
    return { data, width: info.width, height: info.height, channels: info.channels };
  } catch {
    throw new PhotoProcessingError("invalid_image");
  }
}

const fromRaw = (image: RawImage) => sharp(image.data, { raw: { width: image.width, height: image.height, channels: image.channels }, limitInputPixels: MAX_INPUT_PIXELS });

async function extractRaw(image: RawImage, area: { left: number; top: number; width: number; height: number }): Promise<RawImage> {
  if (area.width < MIN_MASTER_EDGE || area.height < MIN_MASTER_EDGE) throw new PhotoProcessingError("image_too_small");
  const { data, info } = await fromRaw(image).extract(area).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Percent region to whole pixels on the normalized (post-rotation) original. */
export function photoRegionToPixels(region: PhotoRegion, width: number, height: number) {
  const left = clamp(Math.round((region.x / 100) * width), 0, width - 1);
  const top = clamp(Math.round((region.y / 100) * height), 0, height - 1);
  const right = clamp(Math.round(((region.x + region.width) / 100) * width), left + 1, width);
  const bottom = clamp(Math.round(((region.y + region.height) / 100) * height), top + 1, height);
  return { left, top, width: right - left, height: bottom - top };
}

/** A full-width strip touching the top or bottom edge is cropped away rather than painted over. */
export function regionCropPlan(region: PhotoRegion, width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  const px = photoRegionToPixels(region, width, height);
  if (px.left !== 0 || px.width !== width) return null;
  const remaining = height - px.height;
  if (remaining < Math.max(MIN_MASTER_EDGE, Math.round(height * MIN_REMAINING_HEIGHT_FRACTION))) return null;
  if (px.top === 0) return { left: 0, top: px.height, width, height: remaining };
  if (px.top + px.height === height) return { left: 0, top: 0, width, height: remaining };
  return null;
}

async function sampledFill(image: RawImage, area: { left: number; top: number; width: number; height: number }) {
  const neutral = { r: 38, g: 38, b: 38 };
  try {
    const stripHeight = Math.min(12, area.top > 0 ? area.top : image.height - (area.top + area.height));
    if (stripHeight < 1) return neutral;
    const stripTop = area.top > 0 ? area.top - stripHeight : area.top + area.height;
    const stats = await fromRaw(image).extract({ left: area.left, top: stripTop, width: area.width, height: stripHeight }).stats();
    const [r, g, b] = stats.channels.map((channel) => clamp(Math.round(channel.mean), 0, 255));
    return { r: r ?? neutral.r, g: g ?? neutral.g, b: b ?? neutral.b };
  } catch {
    return neutral;
  }
}

export type DealPhotoMaster = { data: Buffer; width: number; height: number; regionAction: "none" | "cropped" | "covered" };

/**
 * Step 3 plus the admin bottom crop: the saved builder region is cropped off
 * (full-width edge strip) or covered with an opaque fill sampled beside it,
 * then the per-photo bottom crop applies unconditionally.
 */
export async function makeDealPhotoMaster(normalizedOriginal: Buffer, options: { region?: PhotoRegion | null; bottomCrop?: number } = {}): Promise<DealPhotoMaster> {
  let image = await decodeRaw(normalizedOriginal);
  let regionAction: DealPhotoMaster["regionAction"] = "none";
  if (options.region) {
    const crop = regionCropPlan(options.region, image.width, image.height);
    if (crop) {
      image = await extractRaw(image, crop);
      regionAction = "cropped";
    } else {
      const area = photoRegionToPixels(options.region, image.width, image.height);
      const fill = await sampledFill(image, area);
      const { data, info } = await fromRaw(image)
        .composite([{ input: { create: { width: area.width, height: area.height, channels: 3, background: fill } }, left: area.left, top: area.top }])
        .raw().toBuffer({ resolveWithObject: true });
      image = { data, width: info.width, height: info.height, channels: info.channels };
      regionAction = "covered";
    }
  }
  const bottomCrop = options.bottomCrop ?? 0;
  if (bottomCrop > 0) {
    if (!Number.isInteger(bottomCrop) || bottomCrop >= image.height - MIN_MASTER_EDGE) throw new PhotoProcessingError("invalid_crop");
    image = await extractRaw(image, { left: 0, top: 0, width: image.width, height: image.height - bottomCrop });
  }
  const data = await fromRaw(image).webp({ quality: 88, effort: STORED_WEBP_EFFORT, smartSubsample: true }).toBuffer();
  return { data, width: image.width, height: image.height, regionAction };
}

/**
 * Step 5 gate: every match must sit entirely inside one outer 20 percent band.
 * A mid-frame hit, a match without a box, or hits in both bands means hide.
 */
export function outerBandForMatches(matches: OcrMatch[], height: number): "top" | "bottom" | null {
  let band: "top" | "bottom" | null = null;
  for (const match of matches) {
    if (!match.bbox) return null;
    const inTop = match.bbox.y1 <= height * OUTER_BAND_FRACTION;
    const inBottom = match.bbox.y0 >= height * (1 - OUTER_BAND_FRACTION);
    const here = inTop ? "top" : inBottom ? "bottom" : null;
    if (!here || (band && band !== here)) return null;
    band = here;
  }
  return band;
}

export async function cropOuterBand(master: DealPhotoMaster, band: "top" | "bottom"): Promise<DealPhotoMaster> {
  const bandHeight = Math.ceil(master.height * OUTER_BAND_FRACTION);
  const image = await extractRaw(await decodeRaw(master.data), { left: 0, top: band === "top" ? bandHeight : 0, width: master.width, height: master.height - bandHeight });
  return { data: await fromRaw(image).webp({ quality: 88, effort: STORED_WEBP_EFFORT, smartSubsample: true }).toBuffer(), width: image.width, height: image.height, regionAction: master.regionAction };
}

type PhotoDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Least-recently-used map of in-flight or finished work for one drain. A
 * second caller for a key awaits the first caller's promise instead of
 * repeating the work; a rejected promise is dropped so a later caller retries.
 */
export class SingleFlightCache<V> {
  private readonly entries: LruCache<Promise<V>>;
  constructor(maxEntries: number) {
    this.entries = new LruCache<Promise<V>>(maxEntries);
  }
  async get(key: string, work: () => Promise<V>): Promise<{ value: V; reused: boolean }> {
    const existing = this.entries.get(key);
    if (existing) return { value: await existing, reused: true };
    const pending = work();
    this.entries.set(key, pending);
    try {
      return { value: await pending, reused: false };
    } catch (error) {
      if (this.entries.get(key) === pending) this.entries.delete(key);
      throw error;
    }
  }
  /** A value already in hand (e.g. bytes read for another row), for later callers. */
  set(key: string, value: V) { this.entries.set(key, Promise.resolve(value)); }
  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}

type ReusableOriginal = { bytes: Buffer; version: string; donor: boolean };
export type DealPhotoReuseCounts = { originals: number; masters: number; ocr: number };
/**
 * Work shared by the photos of one drain (many homes of one plan use the same
 * gallery image). Only pure, deterministic steps are shared, and only inside
 * one builder: the source download plus normalization (keyed by source URL),
 * the master (keyed by original bytes, the builder's region and the row's
 * bottom crop) and the OCR words (keyed by the exact master bytes). Each row
 * still applies its own builder settings and its own hide terms (its address,
 * house number, plan and community names) to those words, writes its own
 * private objects, and is published or hidden on its own result.
 */
export type DealPhotoRunContext = {
  originals: SingleFlightCache<ReusableOriginal>;
  originalsByVersion: LruCache<Buffer>;
  masters: SingleFlightCache<DealPhotoMaster>;
  ocr: SingleFlightCache<OcrWord[]>;
  /** A stored original of the same builder and source, from an earlier run: read instead of downloaded again. */
  donors: Map<string, { storageKey: string; version: string }>;
  reused: DealPhotoReuseCounts;
};

/** Small bounds: a handful of ~0.5 MB WebP buffers, so a drain's caches stay in the low megabytes. */
export function createDealPhotoRunContext(): DealPhotoRunContext {
  return {
    originals: new SingleFlightCache<ReusableOriginal>(6),
    originalsByVersion: new LruCache<Buffer>(6),
    masters: new SingleFlightCache<DealPhotoMaster>(8),
    ocr: new SingleFlightCache<OcrWord[]>(64),
    donors: new Map(),
    reused: { originals: 0, masters: 0, ocr: 0 },
  };
}

/** Every reuse key starts with the builder, so nothing is ever shared across builders. */
const reuseKey = (builder: string, ...parts: Array<string | number>) => [builderKey(builder), ...parts].join("\u0000");
/** The source identity used for reuse; the same URL always gives the same key. */
export const dealPhotoSourceKey = (builder: string, sourceUrl: string) => reuseKey(builder, "source", digest(sourceUrl));

async function reuse<V>(ctx: DealPhotoRunContext | undefined, cache: (ctx: DealPhotoRunContext) => SingleFlightCache<V>, kind: keyof DealPhotoReuseCounts, key: string, work: () => Promise<V>): Promise<V> {
  if (!ctx) return work();
  const { value, reused } = await cache(ctx).get(key, work);
  if (reused) ctx.reused[kind]++;
  return value;
}

const hostLimiters = new Map<string, ReturnType<typeof createLimiter>>();
/** Politeness: at most HOST_DOWNLOAD_CONCURRENCY downloads per builder image host in this process. */
async function downloadPolitely(raw: string): Promise<Buffer> {
  let host = "";
  try { host = new URL(raw).hostname.toLowerCase(); } catch { /* downloadDealPhoto rejects it below */ }
  let limiter = hostLimiters.get(host);
  if (!limiter) {
    limiter = createLimiter(HOST_DOWNLOAD_CONCURRENCY);
    hostLimiters.set(host, limiter);
  }
  return limiter(() => downloadDealPhoto(raw));
}

async function claimDealPhoto(photoId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  // A null attempt time is a parked row (awaiting_region) and is never claimed.
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
      isNotNull(dealPhotos.nextProcessingAttemptAt),
      lte(dealPhotos.nextProcessingAttemptAt, now),
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

/**
 * Every write of a claimed row is fenced on the claim: still `processing` with
 * the attempt count this claim set. If the lease expired and another run
 * reclaimed the row (the count went up), or an admin requeued it (pending,
 * count 0), this run's late result is dropped instead of overwriting theirs.
 */
export function dealPhotoLeaseWhere(photoId: number, attempts: number) {
  return and(eq(dealPhotos.id, photoId), eq(dealPhotos.processingState, "processing"), eq(dealPhotos.processingAttempts, attempts));
}

async function recordPhotoFailure(db: PhotoDb, photoId: number, attempt: number, lease: ReturnType<typeof dealPhotoLeaseWhere>, code: PhotoProcessingErrorCode) {
  const retry = attempt < MAX_PROCESSING_ATTEMPTS && code !== "unapproved_source" && code !== "invalid_crop";
  await db.update(dealPhotos).set({
    automaticHidden: true,
    processingState: retry ? "pending" : "failed",
    nextProcessingAttemptAt: retry ? retryAt(attempt) : null,
    processingStartedAt: null,
    lastProcessingError: code,
    ocrMatches: JSON.stringify([{ kind: "processing_error", code }]),
  }).where(lease);
  return retry;
}

async function putPrivateObject(key: string, data: Buffer) {
  try {
    return await storagePut(key, data, "image/webp", { unique: false });
  } catch {
    throw new PhotoProcessingError("storage_unavailable");
  }
}

/**
 * Step 1 source of bytes. A stored original (admin upload, or any earlier run)
 * is reused and verified by digest, so reprocessing never depends on the
 * builder's CDN still serving the file; only a first import downloads. Within
 * a drain, a row whose stored version is already in memory skips the read, and
 * a first import of a source another row of the same builder already stored
 * (or is downloading right now) reads or awaits that copy instead.
 */
async function loadDealPhotoOriginal(photo: { sourceUrl: string; originalStorageKey: string | null; originalVersion: string | null }, builder: string, ctx?: DealPhotoRunContext): Promise<{ bytes: Buffer; fromStorage: boolean }> {
  if (photo.originalStorageKey && photo.originalVersion) {
    const versionKey = reuseKey(builder, "version", photo.originalVersion);
    const known = ctx?.originalsByVersion.get(versionKey);
    if (ctx && known) {
      ctx.reused.originals++;
      return { bytes: known, fromStorage: true };
    }
    try {
      const stored = await storageReadPrivate(photo.originalStorageKey);
      if (digest(stored.data) === photo.originalVersion) {
        ctx?.originalsByVersion.set(versionKey, stored.data);
        return { bytes: stored.data, fromStorage: true };
      }
    } catch {
      // A transient private-store failure falls through to a fresh download
      // when the source is remote; an upload has no other copy.
    }
    if (isUploadSource(photo.sourceUrl)) throw new PhotoProcessingError("storage_unavailable");
  } else if (isUploadSource(photo.sourceUrl)) {
    throw new PhotoProcessingError("source_unavailable");
  }
  const fetchNormalized = async () => normalizeDealPhotoOriginal(await downloadPolitely(photo.sourceUrl));
  if (!ctx) return { bytes: await fetchNormalized(), fromStorage: false };
  const sourceKey = dealPhotoSourceKey(builder, photo.sourceUrl);
  const { value, reused } = await ctx.originals.get(sourceKey, async (): Promise<ReusableOriginal> => {
    const donor = ctx.donors.get(sourceKey);
    if (donor) {
      try {
        const stored = await storageReadPrivate(donor.storageKey);
        if (digest(stored.data) === donor.version) return { bytes: stored.data, version: donor.version, donor: true };
      } catch {
        // The donor copy is gone or unreadable: download as a first import would.
      }
    }
    const bytes = await fetchNormalized();
    return { bytes, version: digest(bytes), donor: false };
  });
  if (reused || value.donor) ctx.reused.originals++;
  ctx.originalsByVersion.set(reuseKey(builder, "version", value.version), value.bytes);
  return { bytes: value.bytes, fromStorage: false };
}

export type DealPhotoProcessResult = {
  /** True only when the photo is processed and publishable. */
  ok: boolean;
  processed?: boolean;
  hidden?: boolean;
  awaitingRegion?: boolean;
  matches?: OcrMatch[];
  bandCropped?: "top" | "bottom";
  regionAction?: DealPhotoMaster["regionAction"];
  retryScheduled?: boolean;
  skipped?: boolean;
  /** The claim expired or was taken back while this run worked; nothing was written. */
  leaseLost?: boolean;
};

const regionReuseKey = (region: PhotoRegion | null) => region ? `${region.x},${region.y},${region.width},${region.height}` : "none";

/**
 * Claims and processes one durable queue entry. No source error, signed URL, or
 * remote response is propagated to a browser or persisted as an admin message.
 * Steps 1 to 6 of the spec pipeline run here; an OCR hide still stores the
 * original and master so admin can preview, crop, and recover it. `ctx` (a
 * drain's shared work, see DealPhotoRunContext) is optional.
 */
export async function processDealPhoto(photoId: number, ctx?: DealPhotoRunContext): Promise<DealPhotoProcessResult> {
  const claimed = await claimDealPhoto(photoId);
  if (!claimed) return { ok: false, skipped: true };
  const { db, row } = claimed;
  if (!row) return { ok: false, skipped: true };
  const attempt = Math.max(1, row.photo.processingAttempts);
  const lease = dealPhotoLeaseWhere(photoId, row.photo.processingAttempts);
  const builder = row.community.builder;

  try {
    // Nullable so the original's bytes can be let go once the master exists.
    let { bytes: original, fromStorage }: { bytes: Buffer | null; fromStorage: boolean } = await loadDealPhotoOriginal(row.photo, builder, ctx);
    const originalVersion = digest(original);
    // Stable keys overwrite obsolete private bytes on reprocess, so retries and
    // crop updates never create a new orphan object.
    let originalStorageKey = row.photo.originalStorageKey;
    if (!fromStorage || !originalStorageKey) {
      originalStorageKey = (await putPrivateObject(`${PRIVATE_PREFIX}originals/${photoId}.webp`, original)).key;
      // Persist the original before the region check so the admin sample
      // picker can show a builder's photos while they wait for a region.
      await db.update(dealPhotos).set({ originalStorageKey, originalVersion }).where(lease);
    }

    const settings = await getBuilderPhotoSettings(builder);
    if (settings.enabled && !settings.region) {
      const parked = await db.update(dealPhotos).set({
        automaticHidden: true,
        processingState: "pending",
        processingAttempts: attempt - 1,
        nextProcessingAttemptAt: null,
        processingStartedAt: null,
        lastProcessingError: AWAITING_REGION,
      }).where(lease);
      if (!wasUpdated(parked)) return { ok: false, skipped: true, leaseLost: true };
      return { ok: false, awaitingRegion: true };
    }

    const region = settings.enabled ? settings.region : null;
    const bottomCrop = row.photo.bottomCrop;
    const masterOf = (bytes: Buffer) => reuse(ctx, (c) => c.masters, "masters", reuseKey(builder, "master", originalVersion, regionReuseKey(region), bottomCrop), () => makeDealPhotoMaster(bytes, { region, bottomCrop }));
    let master = await masterOf(original);
    // The original's bytes are not needed past this point; let them go before OCR.
    original = null;
    const configuredTerms = Array.from(new Set([
      row.community.builder,
      row.community.privateName,
      row.home.privateAddress ?? "",
      row.home.privatePlanName ?? "",
      ...safeScrubList(row.community.scrubList),
    ].filter((term): term is string => Boolean(term.trim()))));
    const exactTerms = [dealPhotoHouseNumber(row.home.privateAddress)].filter((term): term is string => Boolean(term));
    // OCR output depends only on the exact bytes; the hide decision below is always this row's own.
    const wordsOf = (bytes: Buffer) => reuse(ctx, (c) => c.ocr, "ocr", reuseKey(builder, "ocr", digest(bytes)), () => recognizeDealPhotoWords(bytes));
    let matches = findDealPhotoHideMatches(await wordsOf(master.data), configuredTerms, settings.keywords, exactTerms);
    let bandCropped: "top" | "bottom" | undefined;
    if (matches.length && settings.enabled) {
      const band = outerBandForMatches(matches, master.height);
      if (band) {
        const uncropped = master;
        master = await reuse(ctx, (c) => c.masters, "masters", reuseKey(builder, "band", band, digest(uncropped.data)), () => cropOuterBand(uncropped, band));
        bandCropped = band;
        matches = findDealPhotoHideMatches(await wordsOf(master.data), configuredTerms, settings.keywords, exactTerms);
      }
    }

    const version = digest(master.data);
    const processedStored = await putPrivateObject(`${PRIVATE_PREFIX}masters/${photoId}.webp`, master.data);
    const hidden = matches.length > 0;
    const written = await db.update(dealPhotos).set({
      // sourceHash remains the source-URL dedupe key used by dealsSync. The
      // deterministic bytes are represented by originalVersion/version keys.
      originalStorageKey,
      processedStorageKey: processedStored.key,
      originalVersion,
      processedVersion: version,
      automaticHidden: hidden,
      ocrMatches: JSON.stringify(matches),
      processingState: "processed",
      nextProcessingAttemptAt: null,
      processingStartedAt: null,
      lastProcessingError: null,
      processedAt: new Date(),
    }).where(lease);
    if (!wasUpdated(written)) {
      console.warn(`[deals-photo] lease lost for photo ${photoId}; result dropped`);
      return { ok: false, skipped: true, leaseLost: true };
    }
    if (row.photo.processedVersion && row.photo.processedVersion !== version) {
      void pruneDealPhotoRendersForPhoto(photoId).catch((error) => console.warn(`[deals-photo] render prune failed for photo ${photoId}: ${error instanceof Error ? error.message : "unknown"}`));
    }
    return { ok: !hidden, processed: true, hidden, matches, bandCropped, regionAction: master.regionAction };
  } catch (error) {
    const code = photoErrorCode(error);
    console.warn(`[deals-photo] processing ${code} for photo ${photoId}`);
    const retryScheduled = await recordPhotoFailure(db, photoId, attempt, lease, code).catch(() => false);
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

/**
 * Re-runs steps 3 to 6 on every photo of the builder's communities from the
 * stored originals (settings, region, toggle, or keyword change). Returns the
 * number of photos requeued; the caller kicks processPendingDealPhotos.
 */
export async function reprocessBuilderPhotos(builder: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const key = builderKey(builder);
  if (!key) return 0;
  const communities = await db.select({ id: dealCommunities.id }).from(dealCommunities).where(sql`LOWER(TRIM(${dealCommunities.builder})) = ${key}`);
  if (!communities.length) return 0;
  const homeIds = db.select({ id: dealHomes.id }).from(dealHomes).where(inArray(dealHomes.communityId, communities.map((community) => community.id)));
  const result = await db.update(dealPhotos).set({
    automaticHidden: true,
    processingState: "pending",
    processingAttempts: 0,
    nextProcessingAttemptAt: new Date(),
    processingStartedAt: null,
    lastProcessingError: null,
    ocrMatches: "[]",
  }).where(and(inArray(dealPhotos.homeId, homeIds), ne(dealPhotos.processingState, "processing")));
  return affectedRows(result);
}

export type DealPhotoDrainResult = {
  processed: number;
  hidden: number;
  awaitingRegion: number;
  retried: number;
  failed: number;
  skipped: number;
  coalesced?: boolean;
  /** Work taken from another row of the same builder and source instead of repeated. */
  reused?: DealPhotoReuseCounts;
  /** The drain stopped starting photos because its time budget ran out (more may be due). */
  stoppedForTime?: boolean;
  elapsedMs?: number;
  /** Time spent waiting for a drain already running in this process to finish first. */
  waitedMs?: number;
};

export type DealPhotoDrainOptions = {
  /** Stop starting photos after this long (photos in flight finish). Default PHOTO_DRAIN_BUDGET_MS. */
  budgetMs?: number;
  /** Optional cap on photos started; a cron drain normally runs on its budget alone. */
  maxPhotos?: number;
  /** Lanes (photos in flight), 1 to 4. Default PHOTO_PROCESSING_CONCURRENCY. */
  concurrency?: number;
  /** Test seam for the budget. */
  clock?: () => number;
};

let drainInFlight: Promise<DealPhotoDrainResult> | null = null;
let drainRerunRequested = false;
let failedRowsRecovered = false;
/** Failures that no code change can fix are left alone by the boot-time recovery. */
const PERMANENT_FAILURE_CODES: PhotoProcessingErrorCode[] = ["unapproved_source", "invalid_crop", "invalid_image", "image_too_large", "image_too_small"];

const emptyDrainResult = (): DealPhotoDrainResult => ({ processed: 0, hidden: 0, awaitingRegion: 0, retried: 0, failed: 0, skipped: 0 });

function mergeDrainResults(a: DealPhotoDrainResult, b: DealPhotoDrainResult): DealPhotoDrainResult {
  return {
    processed: a.processed + b.processed, hidden: a.hidden + b.hidden, awaitingRegion: a.awaitingRegion + b.awaitingRegion,
    retried: a.retried + b.retried, failed: a.failed + b.failed, skipped: a.skipped + b.skipped,
    reused: { originals: (a.reused?.originals ?? 0) + (b.reused?.originals ?? 0), masters: (a.reused?.masters ?? 0) + (b.reused?.masters ?? 0), ocr: (a.reused?.ocr ?? 0) + (b.reused?.ocr ?? 0) },
    stoppedForTime: Boolean(a.stoppedForTime || b.stoppedForTime),
    elapsedMs: (a.elapsedMs ?? 0) + (b.elapsedMs ?? 0),
  };
}

const dueNow = (now: Date) => and(eq(dealPhotos.processingState, "pending"), isNotNull(dealPhotos.nextProcessingAttemptAt), lte(dealPhotos.nextProcessingAttemptAt, now));
const homeIsShown = sql`(${dealHomes.status} = 'available' AND ${dealCommunities.active} = 1 AND ${dealCommunities.paused} = 0)`;
/** The home already shows at least one photo. Probes idx_deal_photos_home (home_id, processing_state). */
const homeHasServedPhoto = sql`EXISTS (SELECT 1 FROM ${dealPhotos} AS served WHERE served.home_id = ${dealPhotos.homeId} AND served.processing_state = 'processed' AND served.automatic_hidden = 0 AND served.admin_hidden = 0)`;

/**
 * Queue order: photos of homes buyers can see first; among those, homes that
 * show no photo yet; then gallery position (every home's cover before any
 * home's second photo); then the cheapest homes (the ones the featured and
 * best-deal lists lead with); then the oldest due row.
 */
export const DEAL_PHOTO_PRIORITY_ORDER = [
  sql`CASE WHEN ${homeIsShown} THEN 0 ELSE 1 END`,
  sql`CASE WHEN ${homeHasServedPhoto} THEN 1 ELSE 0 END`,
  asc(dealPhotos.sortOrder),
  sql`CASE WHEN ${dealHomes.price} IS NULL THEN 1 ELSE 0 END`,
  asc(dealHomes.price),
  asc(dealPhotos.nextProcessingAttemptAt),
  asc(dealPhotos.id),
];

type QueueRow = { id: number; sourceUrl: string; sourceHash: string; builder: string | null };

/**
 * One refill of a drain's work queue: the next due rows in priority order,
 * each followed by the due rows of the same builder and source (their work is
 * shared through the run context while it is still in memory), plus the
 * stored originals other rows of those sources already have.
 */
async function nextDrainBatch(db: PhotoDb, now: Date, limit: number, exclude: ReadonlySet<number>, ctx: DealPhotoRunContext): Promise<number[]> {
  const excluded = Array.from(exclude);
  const rows: QueueRow[] = await db.select({ id: dealPhotos.id, sourceUrl: dealPhotos.sourceUrl, sourceHash: dealPhotos.sourceHash, builder: dealCommunities.builder })
    .from(dealPhotos)
    .leftJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
    .leftJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
    .where(and(dueNow(now), excluded.length ? notInArray(dealPhotos.id, excluded) : undefined))
    .orderBy(...DEAL_PHOTO_PRIORITY_ORDER)
    .limit(limit);
  const fresh = rows.filter((row) => !exclude.has(row.id));
  const shareable = fresh.filter((row) => row.builder && typeof row.sourceUrl === "string" && !isUploadSource(row.sourceUrl) && row.sourceHash);
  const queued = new Set(fresh.map((row) => row.id));
  const siblingsBySource = new Map<string, number[]>();
  if (shareable.length) {
    const hashes = Array.from(new Set(shareable.map((row) => row.sourceHash)));
    const [siblings, donors] = await Promise.all([
      db.select({ id: dealPhotos.id, sourceUrl: dealPhotos.sourceUrl, sourceHash: dealPhotos.sourceHash, builder: dealCommunities.builder })
        .from(dealPhotos)
        .innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
        .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
        .where(and(dueNow(now), inArray(dealPhotos.sourceHash, hashes), notInArray(dealPhotos.id, [...excluded, ...Array.from(queued)])))
        .orderBy(asc(dealPhotos.id))
        .limit(PHOTO_SIBLINGS_PER_REFILL),
      db.select({ sourceUrl: dealPhotos.sourceUrl, originalStorageKey: dealPhotos.originalStorageKey, originalVersion: dealPhotos.originalVersion, builder: dealCommunities.builder })
        .from(dealPhotos)
        .innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
        .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
        .where(and(inArray(dealPhotos.sourceHash, hashes), isNotNull(dealPhotos.originalStorageKey), isNotNull(dealPhotos.originalVersion)))
        .limit(PHOTO_DRAIN_BATCH * 4),
    ]);
    for (const donor of donors) {
      if (!donor.builder || !donor.originalStorageKey || !donor.originalVersion || isUploadSource(donor.sourceUrl)) continue;
      const key = dealPhotoSourceKey(donor.builder, donor.sourceUrl);
      if (!ctx.donors.has(key)) ctx.donors.set(key, { storageKey: donor.originalStorageKey, version: donor.originalVersion });
    }
    for (const sibling of siblings) {
      if (!sibling.builder || queued.has(sibling.id) || exclude.has(sibling.id)) continue;
      const key = dealPhotoSourceKey(sibling.builder, sibling.sourceUrl);
      siblingsBySource.set(key, [...(siblingsBySource.get(key) ?? []), sibling.id]);
      queued.add(sibling.id);
    }
  }
  // Each source's rows run back to back (the batch's own and the siblings read
  // above), at the position of its highest-priority row.
  const groups = new Map<string, number[]>();
  for (const row of fresh) {
    const key = row.builder && typeof row.sourceUrl === "string" && !isUploadSource(row.sourceUrl) ? dealPhotoSourceKey(row.builder, row.sourceUrl) : `row:${row.id}`;
    const group = groups.get(key);
    if (group) group.push(row.id);
    else groups.set(key, [row.id]);
  }
  const order: number[] = [];
  for (const [key, ids] of Array.from(groups.entries())) order.push(...ids, ...(siblingsBySource.get(key) ?? []));
  return order;
}

async function drainDealPhotoQueue(options: { maxPhotos: number; deadline: number; clock: () => number; concurrency: number }): Promise<DealPhotoDrainResult> {
  const startedAt = options.clock();
  const result: DealPhotoDrainResult = { ...emptyDrainResult(), stoppedForTime: false };
  const db = await getDb();
  if (!db) return result;
  const now = new Date();
  const leaseExpired = new Date(now.getTime() - PROCESSING_LEASE_MS);
  await db.update(dealPhotos).set({
    processingState: "pending",
    nextProcessingAttemptAt: now,
    processingStartedAt: null,
    lastProcessingError: "processing_lease_expired",
  }).where(and(eq(dealPhotos.processingState, "processing"), lt(dealPhotos.processingStartedAt, leaseExpired)));
  // Legacy pending rows without an attempt time are adopted; only awaiting_region stays parked.
  await db.update(dealPhotos).set({ nextProcessingAttemptAt: now })
    .where(and(eq(dealPhotos.processingState, "pending"), isNull(dealPhotos.nextProcessingAttemptAt), or(isNull(dealPhotos.lastProcessingError), ne(dealPhotos.lastProcessingError, AWAITING_REGION))));
  if (!failedRowsRecovered) {
    // Once per boot, rows that exhausted their attempts under earlier code (for
    // example the region-less launch settings or the redirect-rejecting
    // downloader) get a fresh set of attempts with the current pipeline.
    failedRowsRecovered = true;
    await db.update(dealPhotos).set({ processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: now, processingStartedAt: null })
      .where(and(eq(dealPhotos.processingState, "failed"), or(isNull(dealPhotos.lastProcessingError), notInArray(dealPhotos.lastProcessingError, PERMANENT_FAILURE_CODES))));
  }

  const ctx = createDealPhotoRunContext();
  const queue: number[] = [];
  const seen = new Set<number>();
  let started = 0;
  let exhausted = false;
  let refilling: Promise<void> | null = null;
  const refill = async () => {
    const want = Math.max(1, Math.min(PHOTO_DRAIN_BATCH, options.maxPhotos - started));
    const ids = await nextDrainBatch(db, new Date(), want, seen, ctx);
    if (!ids.length) exhausted = true;
    for (const id of ids) {
      seen.add(id);
      queue.push(id);
    }
  };
  // Lanes pull ids one at a time, so a lane never idles at a batch boundary and
  // nothing is claimed before a lane is free to work on it.
  const next = async (): Promise<number | null> => {
    for (;;) {
      if (started >= options.maxPhotos) return null;
      if (options.clock() >= options.deadline) {
        if (queue.length || !exhausted) result.stoppedForTime = true;
        return null;
      }
      const id = queue.shift();
      if (id !== undefined) {
        started++;
        return id;
      }
      if (exhausted) return null;
      refilling ??= refill().catch((error) => {
        exhausted = true;
        console.warn(`[deals-photo] queue read failed: ${error instanceof Error ? error.message : "unknown"}`);
      }).finally(() => { refilling = null; });
      await refilling;
    }
  };
  const lane = async () => {
    for (let id = await next(); id !== null; id = await next()) {
      const outcome = await processDealPhoto(id, ctx).catch((): DealPhotoProcessResult => ({ ok: false, skipped: true }));
      if (outcome.skipped) result.skipped++;
      else if (outcome.awaitingRegion) result.awaitingRegion++;
      else if (outcome.processed && outcome.hidden) result.hidden++;
      else if (outcome.processed) result.processed++;
      else if (outcome.retryScheduled) result.retried++;
      else result.failed++;
    }
  };
  try {
    await Promise.all(Array.from({ length: options.concurrency }, lane));
  } finally {
    ctx.originals.clear();
    ctx.originalsByVersion.clear();
    ctx.masters.clear();
    ctx.ocr.clear();
  }
  result.reused = { ...ctx.reused };
  result.elapsedMs = options.clock() - startedAt;
  return result;
}

async function waitAtMost(promise: Promise<unknown>, milliseconds: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([promise.catch(() => undefined), new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, milliseconds)); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * Drains due photos (new imports, due retries, expired leases) in priority
 * order with PHOTO_PROCESSING_CONCURRENCY photos in flight. One drain runs per
 * process.
 *
 * - `processPendingDealPhotos(n)` (sync and admin kicks): at most n photos (50
 *   max). An overlapping kick returns at once and asks the running drain for
 *   one more pass, so rows inserted meanwhile are picked up promptly.
 * - `processPendingDealPhotos({ budgetMs })` (the cron): keeps starting photos
 *   until the budget is spent, then lets the ones in flight finish. If another
 *   drain is running in this process it waits for it first (two drains side by
 *   side would double the memory), within the same budget.
 *
 * Across processes, every row is claimed atomically when its lane starts it
 * and every write is fenced on that claim, so overlapping drains on different
 * instances never process a row twice; a claim left by a dead instance is put
 * back after PROCESSING_LEASE_MS.
 */
export async function processPendingDealPhotos(input: number | DealPhotoDrainOptions = 20): Promise<DealPhotoDrainResult> {
  const budgeted = typeof input !== "number";
  const options: DealPhotoDrainOptions = budgeted ? input : { maxPhotos: input };
  const clock = options.clock ?? Date.now;
  const begin = clock();
  const deadline = begin + Math.max(0, options.budgetMs ?? PHOTO_DRAIN_BUDGET_MS);
  const maxPhotos = budgeted
    ? Math.max(1, Math.floor(options.maxPhotos ?? Number.MAX_SAFE_INTEGER))
    : Math.max(1, Math.min(50, Math.floor(options.maxPhotos ?? 20)));
  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? PHOTO_PROCESSING_CONCURRENCY)));
  if (!budgeted && drainInFlight) {
    drainRerunRequested = true;
    return { ...emptyDrainResult(), coalesced: true };
  }
  let waitedMs: number | undefined;
  while (drainInFlight) {
    const remaining = deadline - clock();
    if (remaining <= 0) return { ...emptyDrainResult(), coalesced: true, waitedMs: clock() - begin };
    await waitAtMost(drainInFlight, remaining);
    waitedMs = clock() - begin;
  }
  const run = (async () => {
    let total = await drainDealPhotoQueue({ maxPhotos, deadline, clock, concurrency });
    // A budgeted drain refills until its budget is spent, so it already picks up rows a kick asked for.
    for (let reruns = 0; !budgeted && drainRerunRequested && reruns < 3; reruns++) {
      drainRerunRequested = false;
      total = mergeDrainResults(total, await drainDealPhotoQueue({ maxPhotos, deadline, clock, concurrency }));
    }
    drainRerunRequested = false;
    if (budgeted) {
      // One line per cron drain, so the host logs show the real throughput.
      console.log(`[deals-photo] drain: ${total.processed} published, ${total.hidden} hidden, ${total.retried} retry, ${total.failed} failed, ${total.skipped} skipped, ${total.awaitingRegion} awaiting region in ${Math.round((total.elapsedMs ?? 0) / 1000)} s; reused originals ${total.reused?.originals ?? 0}, masters ${total.reused?.masters ?? 0}, OCR ${total.reused?.ocr ?? 0}${total.stoppedForTime ? "; budget spent, more due" : ""}`);
    }
    return waitedMs === undefined ? total : { ...total, waitedMs };
  })();
  drainInFlight = run.finally(() => { drainInFlight = null; });
  return drainInFlight;
}

export function dealPhotoRenderCacheVersion(photoVersion: string, leadId: number, identity: string) {
  return digest(`watermark-v1\u0000${photoVersion}\u0000${leadId}\u0000${identity}`).slice(0, 64);
}

type RenderedPhoto = { data: Buffer; contentType: string };
const renderLimiter = createLimiter(RENDER_CONCURRENCY);
const renderMemory = new LruCache<RenderedPhoto>(RENDER_MEMORY_ENTRIES);

/** Test seam: clears in-process caches and the drain guard. Never called by product code. */
export function resetDealPhotoRuntimeState() {
  renderMemory.clear();
  drainInFlight = null;
  drainRerunRequested = false;
  failedRowsRecovered = false;
}

/** Produces only per-lead watermarked image bytes; no object URL leaves the server. */
export async function renderDealPhotoForLead(photoId: number, leadId: number): Promise<RenderedPhoto | null> {
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
        inArray(dealLeads.status, [...RENDERABLE_LEAD_STATUSES]),
        gt(dealLeads.expiresAt, now),
      )).limit(1))[0];
    if (!row?.photo.processedStorageKey || !row.photo.processedVersion) return null;

    const identity = displayForLead(row.lead);
    const cacheVersion = dealPhotoRenderCacheVersion(row.photo.processedVersion, leadId, identity);
    const inMemory = renderMemory.get(cacheVersion);
    if (inMemory) return inMemory;

    return await renderLimiter(async () => {
      const raced = renderMemory.get(cacheVersion);
      if (raced) return raced;
      const cached = (await db.select().from(dealPhotoRenders).where(and(
        eq(dealPhotoRenders.photoId, photoId),
        eq(dealPhotoRenders.leadId, leadId),
        eq(dealPhotoRenders.version, cacheVersion),
        gt(dealPhotoRenders.expiresAt, now),
      )).limit(1))[0];
      if (cached) {
        try {
          const stored = await storageReadPrivate(cached.storageKey);
          const value = { data: stored.data, contentType: stored.contentType || "image/webp" };
          renderMemory.set(cacheVersion, value);
          return value;
        } catch {
          // A stale/missing cache object is regenerated below. Do not leak the
          // signed-store error to a protected image response.
        }
      }

      const source = await storageReadPrivate(row.photo.processedStorageKey as string);
      const meta = await sharp(source.data, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).metadata();
      if (!meta.width || !meta.height) return null;
      const rendered = await sharp(source.data, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
        .composite([{ input: tiledWatermarkSvg(`Prepared for ${identity} | Lifestyle Design Realty`, meta.width, meta.height), gravity: "center" }])
        .webp({ quality: 88, effort: 4, smartSubsample: true })
        .toBuffer();
      const value = { data: rendered, contentType: "image/webp" };
      renderMemory.set(cacheVersion, value);
      const expiry = new Date(Math.min(row.lead.expiresAt.getTime(), Date.now() + 48 * 60 * 60_000));
      // The versioned database cache key includes lead identity. The physical key
      // is stable per lead/photo/identity so reprocesses overwrite obsolete
      // private bytes instead of accumulating objects. Do not use a bare
      // lead/photo key: an identity edit could otherwise race with an older
      // request and make a previous cache row read another lead label.
      const identityKey = digest(`${leadId}\u0000${identity}`).slice(0, 32);
      // The response does not wait for the durable cache write.
      void storagePut(`${PRIVATE_PREFIX}renders/${leadId}/${photoId}-${identityKey}.webp`, rendered, "image/webp", { unique: false })
        .then((stored) => db.insert(dealPhotoRenders).values({ photoId, leadId, version: cacheVersion, storageKey: stored.key, expiresAt: expiry })
          .onDuplicateKeyUpdate({ set: { storageKey: stored.key, expiresAt: expiry } }))
        .catch((error) => console.warn(`[deals-photo] render cache write skipped: ${error instanceof Error ? error.message : "unknown"}`));
      return value;
    });
  } catch {
    // Protected routes deliberately return the same not-found shape for an
    // unavailable asset, unreadable private object, and invalid image.
    return null;
  }
}

type RenderDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Deletes render rows and, when no other row references the object, its bytes. Counts are returned, never thrown. */
async function removeRenderRows(db: RenderDb, rows: Array<{ id: number; storageKey: string }>) {
  let rowsDeleted = 0;
  let objectsDeleted = 0;
  let objectsFailed = 0;
  for (const row of rows) {
    await db.delete(dealPhotoRenders).where(eq(dealPhotoRenders.id, row.id));
    rowsDeleted++;
  }
  for (const storageKey of Array.from(new Set(rows.map((row) => row.storageKey)))) {
    const remaining = Number((await db.select({ n: sql<number>`count(*)` }).from(dealPhotoRenders).where(eq(dealPhotoRenders.storageKey, storageKey)))[0]?.n ?? 0);
    if (remaining > 0) continue;
    if (await storageDelete(storageKey)) objectsDeleted++;
    else objectsFailed++;
  }
  return { rowsDeleted, objectsDeleted, objectsFailed };
}

/** Removes expired render rows in bounded batches and attempts object deletion. */
export async function cleanupExpiredDealPhotoRenders(limit = 200) {
  const db = await getDb();
  if (!db) return { recordsDeleted: 0, storageObjectsDeleted: 0, storageObjectsFailed: 0 };
  const rows = await db.select({ id: dealPhotoRenders.id, storageKey: dealPhotoRenders.storageKey }).from(dealPhotoRenders)
    .where(lt(dealPhotoRenders.expiresAt, new Date()))
    .limit(Math.max(1, Math.min(500, Math.floor(limit))));
  const removed = await removeRenderRows(db, rows);
  return { recordsDeleted: removed.rowsDeleted, storageObjectsDeleted: removed.objectsDeleted, storageObjectsFailed: removed.objectsFailed };
}

/** A changed processed master invalidates every cached render of that photo. */
export async function pruneDealPhotoRendersForPhoto(photoId: number) {
  const db = await getDb();
  if (!db) return { rowsDeleted: 0, objectsDeleted: 0, objectsFailed: 0 };
  const rows = await db.select({ id: dealPhotoRenders.id, storageKey: dealPhotoRenders.storageKey }).from(dealPhotoRenders).where(eq(dealPhotoRenders.photoId, photoId));
  return removeRenderRows(db, rows);
}

export type DealPhotoRenderPruneResult = { scanned: number; expiredRows: number; staleRows: number; rowsDeleted: number; objectsDeleted: number; objectsFailed: number };

/**
 * Daily maintenance: expired renders (lead link gone) plus renders whose
 * version no longer matches the photo's current master or the lead's current
 * display identity. Scans in id order so a large table is covered in pages.
 */
export async function pruneDealPhotoRenders(options: { pageSize?: number; maxRows?: number } = {}): Promise<DealPhotoRenderPruneResult> {
  const result: DealPhotoRenderPruneResult = { scanned: 0, expiredRows: 0, staleRows: 0, rowsDeleted: 0, objectsDeleted: 0, objectsFailed: 0 };
  const db = await getDb();
  if (!db) return result;
  const expired = await cleanupExpiredDealPhotoRenders(options.pageSize ?? 500);
  result.expiredRows = expired.recordsDeleted;
  result.rowsDeleted += expired.recordsDeleted;
  result.objectsDeleted += expired.storageObjectsDeleted;
  result.objectsFailed += expired.storageObjectsFailed;

  const pageSize = Math.max(1, Math.min(500, Math.floor(options.pageSize ?? 500)));
  const maxRows = Math.max(pageSize, Math.floor(options.maxRows ?? 20_000));
  const now = new Date();
  const stale: Array<{ id: number; storageKey: string }> = [];
  let lastId = 0;
  while (result.scanned < maxRows) {
    const page = await db.select({
      id: dealPhotoRenders.id,
      leadId: dealPhotoRenders.leadId,
      version: dealPhotoRenders.version,
      storageKey: dealPhotoRenders.storageKey,
      expiresAt: dealPhotoRenders.expiresAt,
      photoVersion: dealPhotos.processedVersion,
      leadName: dealLeads.name,
      leadHandle: dealLeads.instagramHandle,
      leadPhone: dealLeads.phoneE164,
    }).from(dealPhotoRenders)
      .leftJoin(dealPhotos, eq(dealPhotoRenders.photoId, dealPhotos.id))
      .leftJoin(dealLeads, eq(dealPhotoRenders.leadId, dealLeads.id))
      .where(gt(dealPhotoRenders.id, lastId))
      .orderBy(asc(dealPhotoRenders.id))
      .limit(pageSize);
    if (!page.length) break;
    for (const row of page) {
      lastId = row.id;
      result.scanned++;
      if (row.expiresAt <= now) continue; // handled by the expiry pass on the next run
      const expected = row.photoVersion && row.leadPhone
        ? dealPhotoRenderCacheVersion(row.photoVersion, row.leadId, displayForLead({ name: row.leadName, instagramHandle: row.leadHandle, phoneE164: row.leadPhone }))
        : null;
      if (row.version !== expected) stale.push({ id: row.id, storageKey: row.storageKey });
    }
    if (page.length < pageSize) break;
  }
  const removed = await removeRenderRows(db, stale);
  result.staleRows = stale.length;
  result.rowsDeleted += removed.rowsDeleted;
  result.objectsDeleted += removed.objectsDeleted;
  result.objectsFailed += removed.objectsFailed;
  return result;
}
