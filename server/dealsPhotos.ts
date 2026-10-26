import crypto from "node:crypto";
import { sampleProcessMemory } from "./dealsProcessTelemetry";
import fs from "node:fs";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { dealCommunities, dealHomes, dealPhotoRenders, dealPhotos, dealLeads, dealSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { storageDelete, storageExistsPrivate, storagePut, storageReadPrivate } from "./storage";
import { dealScrubTerms, displayForLead } from "../shared/deals";
import { effectiveScrubConfig } from "./dealsScrub";
import { recordDealPhotoDrainStatus } from "./dealsPhotoDrainStatus";

/**
 * libvips memory on the web instance. On October 22, 2026 the instance restarted about every three minutes with
 * the process at 505-540 MB (its limit is about 512 MB) while photos were drained. Measured locally on 40
 * 2400x1600 photos at two lanes, libvips' operation cache and per-image thread pool account for 40-100 MB of the
 * peak (518-577 MB down to 477-482 MB) at the same speed: the pipeline never reuses an operation, and the two
 * lanes already keep the CPU busy. Set once for the process (renders and city imagery use the same settings).
 */
/**
 * The host stops a server process at about 500-550 MB (October 23, 2026: every process stopped or killed was at
 * 470-557 MB; the photo-draining one reached that within minutes, so drains and the TREC import died with it). A
 * drain starts no further photo once the process passes PHOTO_RSS_STOP_MB, and closes the OCR worker after a drain
 * that ends above PHOTO_RSS_RELEASE_MB (its thread and WASM memory go back; with MALLOC_ARENA_MAX=2 the process
 * returns to about its idle size). The next recognition starts a new worker in a second or two.
 */
export const PHOTO_RSS_STOP_MB = 450;
export const PHOTO_RSS_RELEASE_MB = 380;
let readRssBytes = () => process.memoryUsage.rss();
/** Test seam: the process memory the guards read. */
export function setDealPhotoRssReader(reader: (() => number) | null) { readRssBytes = reader ?? (() => process.memoryUsage.rss()); }
const overMb = (mb: number) => readRssBytes() > mb * 1024 * 1024;

export const SHARP_CACHE_ENABLED = false;
export const SHARP_THREADS = 1;
sharp.cache(SHARP_CACHE_ENABLED);
sharp.concurrency(SHARP_THREADS);

const PRIVATE_PREFIX = "builder-deals-private/";
const MAX_DOWNLOAD_BYTES = 18 * 1024 * 1024;
const MAX_INPUT_PIXELS = 50_000_000;
const MAX_ORIGINAL_EDGE = 1_600;
const MIN_MASTER_EDGE = 16;
const MIN_OCR_WORD_CONFIDENCE = 70;
const MAX_PROCESSING_ATTEMPTS = 5;
/**
 * A processing_timeout is usually the photo's surroundings (a slow builder CDN,
 * a throttled instance, the other lane's OCR) rather than the photo, so it gets
 * more tries than other errors, spaced at least TIMEOUT_RETRY_MIN_MS apart, before
 * the row is failed for good (an admin requeue still retries it).
 */
const MAX_TIMEOUT_ATTEMPTS = 8;
const TIMEOUT_RETRY_MIN_MS = 5 * 60_000;
/**
 * A claim whose run vanished (the host cuts scheduled calls at 30 s and may
 * then throttle or recycle the instance) costs the row an attempt. Only after
 * this many is it treated as a photo that kills its run and failed for good.
 */
const MAX_ABANDONED_ATTEMPTS = 8;
/** Download deadline; must fit inside PHOTO_TIMEOUT_MS so a slow source fails as source_unavailable. */
const DOWNLOAD_TIMEOUT_MS = 15_000;
/**
 * One photo's hard limit inside a drain: the host aborts every scheduled call
 * at 30 s, so a photo must finish (or be given up) well inside one call. Its
 * own steps have shorter deadlines (download 15 s, OCR 15 s). Past this the
 * lane records a retryable processing_timeout (which also revokes the claim,
 * so the abandoned work can never write) and stops starting photos.
 */
export const PHOTO_TIMEOUT_MS = 22_000;
/**
 * A claimed row whose run died (instance recycled or throttled after the
 * response) is put back after this long. A live claim is resolved within
 * PHOTO_TIMEOUT_MS; a throttled straggler that outlives this does no harm,
 * because every write is fenced on the claim token.
 */
export const PROCESSING_LEASE_MS = 3 * 60_000;
/** An expired claim becomes due again after this pause rather than straight away. */
const LEASE_EXPIRED_RETRY_MS = 2 * 60_000;
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
 * Cron drains stop starting photos after this long. The host's scheduler
 * aborts every scheduled call at 30 s, so the handler answers by
 * SCHEDULED_PHOTO_RESPOND_MS with whatever is done; photos still in flight
 * (normally a second or two, never past PHOTO_TIMEOUT_MS) finish after it.
 */
export const PHOTO_DRAIN_BUDGET_MS = 20_000;
/** The scheduled photo call answers by this time, however far the drain got. */
export const SCHEDULED_PHOTO_RESPOND_MS = 24_000;
/** A drain running in this process for longer than this is presumed hung: a new cron call does not wait for it. */
export const DRAIN_STALE_MS = 45_000;
/** At most this many drains in one process (one may be a hung one a newer call stepped around). */
const MAX_DRAINS_PER_PROCESS = 2;
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
  // …and its Picturepark share links (…/Go/<token>/V/<id>/<size>, redirecting on the same host to …/v/<token>/<id>/<format>); the path is checked below.
  "pultegroup.picturepark.com",
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
  // Drees serves its photos from its own asset host.
  "assetcloud.dreeshomes.com",
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
  // …and, since October 2026, from its Sitecore Content Hub public links (…/api/public/content/<id>); the path is checked below.
  "mss-p-022.sitecorecontenthub.cloud",
  "mss-p-022-delivery.sitecorecontenthub.cloud",
  // The three small builders added Oct 26 (every one of their photos had failed as unapproved_source).
  // Pacesetter and Saratoga serve from their WordPress uploads; the path is checked below.
  "pacesetterhomestexas.com",
  "www.pacesetterhomestexas.com",
  "www.saratogahomestexas.com",
  // Joseph Creek is on Webflow: its photos live under its own site ids on Webflow's shared CDN; the path is checked below.
  "cdn.prod.website-files.com",
]);
/** Joseph Creek's Webflow site ids (the main site and its shared asset library): the only folders approved on that shared CDN. */
const JOSEPH_CREEK_WEBFLOW_SITES = /^\/(?:6387da516f4a3b83431b3562|63861ba77212ca21b38111a8)\//;
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
  | "processing_failed"
  | "processing_timeout"
  | "processing_abandoned";

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

/**
 * Sanity's image CDN resizes on request: Davidson's 3840 px PNG renderings run past the download cap, so a Sanity image
 * with no size of its own is fetched at 2400 px as a JPEG (the stored source URL, and so the photo's identity, is unchanged).
 */
export function sizedDownloadUrl(url: URL): URL {
  if (url.hostname.toLowerCase() !== "cdn.sanity.io" || !url.pathname.startsWith("/images/") || url.search) return url;
  const sized = new URL(url.toString());
  sized.searchParams.set("w", "2400");
  sized.searchParams.set("fm", "jpg");
  sized.searchParams.set("q", "88");
  sized.searchParams.set("fit", "max");
  return sized;
}

/** Read a builder image with strict redirects and a streaming download cap. */
export async function downloadDealPhoto(raw: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  let url = sizedDownloadUrl(safeDealImageUrl(raw));
  const initialHost = url.hostname;
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
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
  if (url.hostname.toLowerCase() === "pultegroup.picturepark.com" && !/^\/(?:Go\/[A-Za-z0-9_-]+\/V\/\d+\/\d+|v\/[A-Za-z0-9_-]+\/[0-9a-f]{32}\/[A-Za-z]+)$/.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (/^mss-p-022(?:-delivery)?\.sitecorecontenthub\.cloud$/i.test(url.hostname) && !/^\/api\/public\/content\/[0-9a-f]{32}$/i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "s3.amazonaws.com" && !/^\/buildercloud\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "yourviewhome.com" && !/^\/wp-content\/uploads\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "www.texas-homes.com" && !/^\/sites\/default\/files\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "www.hakesbrothers.com" && !/^\/storage\/app\/medialibrary\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "cdn.lennar.com" && !/^\/api\/images\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (/^(?:cmp|cms|www)\.beazer\.com$/i.test(url.hostname) && !/^\/(?:images|contentassets|globalassets)\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "empirehomes.com" && !/^\/wp-content\/uploads\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (/^(?:www\.)?pacesetterhomestexas\.com$/i.test(url.hostname) && !/^\/wp-content\/uploads\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "www.saratogahomestexas.com" && !/^\/wp-content\/uploads\//i.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
  if (url.hostname.toLowerCase() === "cdn.prod.website-files.com" && !JOSEPH_CREEK_WEBFLOW_SITES.test(url.pathname)) throw new PhotoProcessingError("unapproved_source");
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
/** Recognitions on the current worker. Tesseract's WASM memory only grows, so the worker is replaced every OCR_RECYCLE_AFTER. */
let ocrWorkerUses = 0;
/** About a second to start a new worker, once every this many photos (under 1% of OCR time at ~3-4 s per photo). */
export const OCR_RECYCLE_AFTER = 150;
let ocrWork: Promise<void> = Promise.resolve();
const ocrShutdownHookTargets = new WeakSet<object>();
/** OCR deadline (worker start or one recognition); fits inside PHOTO_TIMEOUT_MS. */
const OCR_TIMEOUT_MS = 15_000;
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
  ocrWorkerUses = 0;
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
      sampleProcessMemory();
      // Still inside the exclusive section: nothing else is using the worker being replaced.
      ocrWorkerUses += 1;
      if (ocrWorkerUses >= OCR_RECYCLE_AFTER) await resetOcrWorker();
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
  /** Set when the priority query or the sharing lookups failed and the drain fell back to plain due order. */
  warning?: string;
  /** Busy time per pipeline stage, summed over the drain's photos (work shared between rows counts once). */
  stageMs: DealPhotoStageTimings;
};

export const DEAL_PHOTO_STAGES = ["download", "normalize", "master", "ocr", "store"] as const;
export type DealPhotoStage = (typeof DEAL_PHOTO_STAGES)[number];
/** Milliseconds per stage: download (builder CDN or stored original read), normalize, master, OCR (including the wait for the OCR worker), store (private objects and the row writes). */
export type DealPhotoStageTimings = Record<DealPhotoStage, number>;
const emptyStageTimings = (): DealPhotoStageTimings => ({ download: 0, normalize: 0, master: 0, ocr: 0, store: 0 });

async function timed<T>(ctx: DealPhotoRunContext | undefined, stage: DealPhotoStage, work: () => Promise<T>): Promise<T> {
  if (!ctx) return work();
  const started = performance.now();
  try {
    return await work();
  } finally {
    ctx.stageMs[stage] += performance.now() - started;
  }
}

/** Small bounds: a handful of ~0.5 MB WebP buffers, so a drain's caches stay in the low megabytes. */
export function createDealPhotoRunContext(): DealPhotoRunContext {
  return {
    originals: new SingleFlightCache<ReusableOriginal>(6),
    originalsByVersion: new LruCache<Buffer>(6),
    masters: new SingleFlightCache<DealPhotoMaster>(8),
    ocr: new SingleFlightCache<OcrWord[]>(64),
    donors: new Map(),
    reused: { originals: 0, masters: 0, ocr: 0 },
    stageMs: emptyStageTimings(),
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

/** Marks a row's live claim in lastProcessingError (never shown as an error; see isDealPhotoClaimToken). */
export const CLAIM_TOKEN_PREFIX = "claim:";
export const isDealPhotoClaimToken = (value: string | null | undefined) => Boolean(value?.startsWith(CLAIM_TOKEN_PREFIX));

async function claimDealPhoto(photoId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  // A random token per claim: an admin requeue resets the attempt count, so the
  // count alone cannot tell this claim from the next one (A-B-A).
  const token = `${CLAIM_TOKEN_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
  // A null attempt time is a parked row (awaiting_region) and is never claimed.
  const claimed = await db
    .update(dealPhotos)
    .set({
      processingState: "processing",
      processingAttempts: sql`${dealPhotos.processingAttempts} + 1`,
      processingStartedAt: now,
      lastProcessingError: token,
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
    token,
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
 * Every write of a claimed row is fenced on the claim: still `processing`,
 * with the attempt count and the random token this claim set. If the lease
 * expired and another run reclaimed the row, or an admin requeued it (even if
 * it was then claimed again with the same count), or the photo timed out, this
 * run's late result is dropped instead of overwriting theirs.
 */
export function dealPhotoLeaseWhere(photoId: number, attempts: number, token: string) {
  return and(eq(dealPhotos.id, photoId), eq(dealPhotos.processingState, "processing"), eq(dealPhotos.processingAttempts, attempts), eq(dealPhotos.lastProcessingError, token));
}

async function recordPhotoFailure(db: PhotoDb, photoId: number, attempt: number, lease: ReturnType<typeof dealPhotoLeaseWhere>, code: PhotoProcessingErrorCode, original?: { originalStorageKey: string; originalVersion: string }) {
  const timeout = code === "processing_timeout";
  const retry = attempt < (timeout ? MAX_TIMEOUT_ATTEMPTS : MAX_PROCESSING_ATTEMPTS) && code !== "unapproved_source" && code !== "invalid_crop";
  const next = retryAt(attempt);
  await db.update(dealPhotos).set({
    ...(original ?? {}),
    automaticHidden: true,
    processingState: retry ? "pending" : "failed",
    nextProcessingAttemptAt: retry ? (timeout ? new Date(Math.max(next.getTime(), Date.now() + TIMEOUT_RETRY_MIN_MS)) : next) : null,
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
      const stored = await timed(ctx, "download", () => storageReadPrivate(photo.originalStorageKey as string));
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
  const fetchNormalized = async () => {
    const downloaded = await timed(ctx, "download", () => downloadPolitely(photo.sourceUrl));
    return timed(ctx, "normalize", () => normalizeDealPhotoOriginal(downloaded));
  };
  if (!ctx) return { bytes: await fetchNormalized(), fromStorage: false };
  const sourceKey = dealPhotoSourceKey(builder, photo.sourceUrl);
  const { value, reused } = await ctx.originals.get(sourceKey, async (): Promise<ReusableOriginal> => {
    const donor = ctx.donors.get(sourceKey);
    if (donor) {
      try {
        const stored = await timed(ctx, "download", () => storageReadPrivate(donor.storageKey));
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
  /** PHOTO_TIMEOUT_MS passed; a retry was scheduled and the abandoned work can no longer write. */
  timedOut?: boolean;
};

/** Masters are addressed by content, so a stale run can never overwrite the object a published row points at. */
export const dealPhotoMasterKey = (photoId: number, version: string) => `${PRIVATE_PREFIX}masters/${photoId}-${version}.webp`;

const regionReuseKey = (region: PhotoRegion | null) => region ? `${region.x},${region.y},${region.width},${region.height}` : "none";

/**
 * Claims and processes one durable queue entry. No source error, signed URL, or
 * remote response is propagated to a browser or persisted as an admin message.
 * Steps 1 to 6 of the spec pipeline run here; an OCR hide still stores the
 * original and master so admin can preview, crop, and recover it. `ctx` (a
 * drain's shared work, see DealPhotoRunContext) is optional.
 */
export async function processDealPhoto(photoId: number, ctx?: DealPhotoRunContext, options: { timeoutMs?: number } = {}): Promise<DealPhotoProcessResult> {
  const claimed = await claimDealPhoto(photoId);
  if (!claimed) return { ok: false, skipped: true };
  const { db, row, token } = claimed;
  if (!row) return { ok: false, skipped: true };
  const attempt = Math.max(1, row.photo.processingAttempts);
  const lease = dealPhotoLeaseWhere(photoId, row.photo.processingAttempts, token);
  const work = processClaimedDealPhoto(db, row, attempt, lease, ctx);
  if (!options.timeoutMs) return work;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), options.timeoutMs); });
  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome !== "timeout") return outcome;
  } finally { if (timer) clearTimeout(timer); }
  // The work may still finish later; its writes are fenced on the token this failure replaces.
  void work.catch(() => undefined);
  console.warn(`[deals-photo] processing processing_timeout for photo ${photoId}`);
  const retryScheduled = await recordPhotoFailure(db, photoId, attempt, lease, "processing_timeout").catch(() => false);
  return { ok: false, hidden: true, retryScheduled, timedOut: true };
}

type ClaimedRow = NonNullable<NonNullable<Awaited<ReturnType<typeof claimDealPhoto>>>["row"]>;

async function processClaimedDealPhoto(db: PhotoDb, row: ClaimedRow, attempt: number, lease: ReturnType<typeof dealPhotoLeaseWhere>, ctx?: DealPhotoRunContext): Promise<DealPhotoProcessResult> {
  const photoId = row.photo.id;
  const builder = row.community.builder;
  // The stored original, once its upload has finished: kept on a failure too, so a retry reads it instead of downloading.
  let keptOriginal: { originalStorageKey: string; originalVersion: string } | null = null;
  try {
    // Nullable so the original's bytes can be let go once the master exists.
    let { bytes: original, fromStorage }: { bytes: Buffer | null; fromStorage: boolean } = await loadDealPhotoOriginal(row.photo, builder, ctx);
    const originalVersion = digest(original);
    // Stable keys overwrite obsolete private bytes on reprocess, so retries and
    // crop updates never create a new orphan object. A first import's upload
    // runs while the master and OCR are made; the row is only written (or
    // published) once it has finished.
    const storedKey = row.photo.originalStorageKey;
    const originalUpload: Promise<string> = fromStorage && storedKey
      ? Promise.resolve(storedKey)
      : timed(ctx, "store", () => putPrivateObject(`${PRIVATE_PREFIX}originals/${photoId}.webp`, original as Buffer)).then((stored) => stored.key);
    originalUpload.then((key) => { keptOriginal = { originalStorageKey: key, originalVersion }; }, () => undefined);

    const settings = await getBuilderPhotoSettings(builder);
    if (settings.enabled && !settings.region) {
      // Persist the original first so the admin sample picker can show a
      // builder's photos while they wait for a region.
      const originalStorageKey = await originalUpload;
      const parked = await db.update(dealPhotos).set({
        originalStorageKey,
        originalVersion,
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
    const masterOf = (bytes: Buffer) => reuse(ctx, (c) => c.masters, "masters", reuseKey(builder, "master", originalVersion, regionReuseKey(region), bottomCrop), () => timed(ctx, "master", () => makeDealPhotoMaster(bytes, { region, bottomCrop })));
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
    const wordsOf = (bytes: Buffer) => reuse(ctx, (c) => c.ocr, "ocr", reuseKey(builder, "ocr", digest(bytes)), () => timed(ctx, "ocr", () => recognizeDealPhotoWords(bytes)));
    let matches = findDealPhotoHideMatches(await wordsOf(master.data), configuredTerms, settings.keywords, exactTerms);
    let bandCropped: "top" | "bottom" | undefined;
    if (matches.length && settings.enabled) {
      const band = outerBandForMatches(matches, master.height);
      if (band) {
        const uncropped = master;
        master = await reuse(ctx, (c) => c.masters, "masters", reuseKey(builder, "band", band, digest(uncropped.data)), () => timed(ctx, "master", () => cropOuterBand(uncropped, band)));
        bandCropped = band;
        matches = findDealPhotoHideMatches(await wordsOf(master.data), configuredTerms, settings.keywords, exactTerms);
      }
    }

    const version = digest(master.data);
    const finalMaster = master;
    const [processedStored, originalStorageKey] = await timed(ctx, "store", () => Promise.all([putPrivateObject(dealPhotoMasterKey(photoId, version), finalMaster.data), originalUpload]));
    const hidden = matches.length > 0;
    const written = await timed(ctx, "store", async () => db.update(dealPhotos).set({
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
    }).where(lease));
    if (!wasUpdated(written)) {
      // Our object is version-addressed and never referenced: harmless. It is not
      // deleted, because a winning run with identical bytes shares the key.
      console.warn(`[deals-photo] lease lost for photo ${photoId}; result dropped`);
      return { ok: false, skipped: true, leaseLost: true };
    }
    // The previous master (another version, or the legacy per-photo key) is no longer referenced.
    const previousKey = row.photo.processedStorageKey;
    if (previousKey && previousKey !== processedStored.key) {
      void storageDelete(previousKey).catch(() => false);
    }
    if (row.photo.processedVersion && row.photo.processedVersion !== version) {
      void pruneDealPhotoRendersForPhoto(photoId).catch((error) => console.warn(`[deals-photo] render prune failed for photo ${photoId}: ${error instanceof Error ? error.message : "unknown"}`));
    }
    return { ok: !hidden, processed: true, hidden, matches, bandCropped, regionAction: master.regionAction };
  } catch (error) {
    const code = photoErrorCode(error);
    console.warn(`[deals-photo] processing ${code} for photo ${photoId}`);
    const retryScheduled = await recordPhotoFailure(db, photoId, attempt, lease, code, keptOriginal ?? undefined).catch(() => false);
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

/** Admin only: the failed photos by builder and error, with up to two of their source links (private operational data). */
export async function dealPhotoFailures(): Promise<Array<{ builder: string | null; error: string | null; count: number; samples: string[] }> | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({
    builder: dealCommunities.builder,
    error: dealPhotos.lastProcessingError,
    count: sql<number>`count(*)`,
    first: sql<string | null>`min(${dealPhotos.sourceUrl})`,
    last: sql<string | null>`max(${dealPhotos.sourceUrl})`,
  }).from(dealPhotos)
    .innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
    .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
    .where(eq(dealPhotos.processingState, "failed"))
    .groupBy(dealCommunities.builder, dealPhotos.lastProcessingError);
  return rows
    .map((row) => ({ builder: row.builder, error: row.error, count: Number(row.count ?? 0), samples: Array.from(new Set([row.first, row.last].filter((value): value is string => Boolean(value)))) }))
    .sort((a, b) => b.count - a.count);
}

/** Admin only: put failed photos back in line (optionally one builder or one error). Processed and hidden photos are untouched. */
export async function requeueFailedDealPhotos(input: { builder?: string; error?: string } = {}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const conditions = [eq(dealPhotos.processingState, "failed")];
  if (input.error) conditions.push(eq(dealPhotos.lastProcessingError, input.error));
  if (input.builder) {
    const key = builderKey(input.builder);
    if (!key) return 0;
    const communities = await db.select({ id: dealCommunities.id }).from(dealCommunities).where(sql`LOWER(TRIM(${dealCommunities.builder})) = ${key}`);
    if (!communities.length) return 0;
    conditions.push(inArray(dealPhotos.homeId, db.select({ id: dealHomes.id }).from(dealHomes).where(inArray(dealHomes.communityId, communities.map((community) => community.id)))));
  }
  const result = await db.update(dealPhotos).set({ processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: new Date(), processingStartedAt: null, lastProcessingError: null }).where(and(...conditions));
  return affectedRows(result);
}

export type DealPhotoDrainResult = {
  /** The process passed PHOTO_RSS_STOP_MB, so no further photo was started this drain. */
  stoppedForMemory?: boolean;
  /** The OCR worker was closed after the drain to give its memory back (the process was over PHOTO_RSS_RELEASE_MB). */
  ocrReleased?: boolean;
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
  /** Photos that hit PHOTO_TIMEOUT_MS (their lane then stopped). */
  timedOut?: number;
  /** The queue could not be read (for example the priority query failed); nothing more was started. */
  error?: "queue_read_failed";
  /** The database's message for `error`, one line. */
  errorDetail?: string;
  /** The drain kept going in plain due order after a priority or sharing query failed. */
  warning?: string;
  /** Answered before the drain finished (counts so far); photos in flight finish afterwards, fenced on their claims. */
  partial?: boolean;
  /** A drain in this process looked hung (older than DRAIN_STALE_MS), so this call ran its own beside it. */
  steppedAroundStaleDrain?: boolean;
  /** Busy milliseconds per pipeline stage over this drain (live while it runs). */
  stageMs?: DealPhotoStageTimings;
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
  /** Test seam: per-photo limit. Default PHOTO_TIMEOUT_MS. */
  photoTimeoutMs?: number;
  /** Receives the counts as they happen, so a caller that must answer early can report them. */
  progress?: DealPhotoDrainResult;
};

type ActiveDrain = { startedAt: number; done: Promise<DealPhotoDrainResult> };
/** Drains running in this process; a hung one never blocks a newer cron call for longer than DRAIN_STALE_MS. */
const activeDrains = new Set<ActiveDrain>();
let drainRerunRequested = false;
let failedRowsRecovered = false;
/** Failures that no code change can fix are left alone by the boot-time recovery. */
const PERMANENT_FAILURE_CODES: PhotoProcessingErrorCode[] = ["unapproved_source", "invalid_crop", "invalid_image", "image_too_large", "image_too_small", "processing_abandoned", "processing_timeout"];

const emptyDrainResult = (): DealPhotoDrainResult => ({ processed: 0, hidden: 0, awaitingRegion: 0, retried: 0, failed: 0, skipped: 0 });

function mergeDrainResults(a: DealPhotoDrainResult, b: DealPhotoDrainResult): DealPhotoDrainResult {
  return {
    processed: a.processed + b.processed, hidden: a.hidden + b.hidden, awaitingRegion: a.awaitingRegion + b.awaitingRegion,
    retried: a.retried + b.retried, failed: a.failed + b.failed, skipped: a.skipped + b.skipped,
    reused: { originals: (a.reused?.originals ?? 0) + (b.reused?.originals ?? 0), masters: (a.reused?.masters ?? 0) + (b.reused?.masters ?? 0), ocr: (a.reused?.ocr ?? 0) + (b.reused?.ocr ?? 0) },
    stoppedForTime: Boolean(a.stoppedForTime || b.stoppedForTime),
    elapsedMs: (a.elapsedMs ?? 0) + (b.elapsedMs ?? 0),
    ...(a.timedOut || b.timedOut ? { timedOut: (a.timedOut ?? 0) + (b.timedOut ?? 0) } : {}),
    ...(a.stageMs || b.stageMs ? { stageMs: Object.fromEntries(DEAL_PHOTO_STAGES.map((stage) => [stage, (a.stageMs?.[stage] ?? 0) + (b.stageMs?.[stage] ?? 0)])) as DealPhotoStageTimings } : {}),
    ...(a.error || b.error ? { error: a.error ?? b.error } : {}),
    ...(a.errorDetail || b.errorDetail ? { errorDetail: a.errorDetail ?? b.errorDetail } : {}),
    ...(a.warning || b.warning ? { warning: a.warning ?? b.warning } : {}),
  };
}

const dueNow = (now: Date) => and(eq(dealPhotos.processingState, "pending"), isNotNull(dealPhotos.nextProcessingAttemptAt), lte(dealPhotos.nextProcessingAttemptAt, now));
const homeIsShown = sql`(${dealHomes.status} = 'available' AND ${dealCommunities.active} = 1 AND ${dealCommunities.paused} = 0)`;
/** The home already shows at least one photo. Probes idx_deal_photos_home (home_id, processing_state). */

/**
 * Homes that already show at least one photo, as a derived table joined to the
 * queue. TiDB rejects a correlated EXISTS in ORDER BY (error 1054, "Unknown
 * column … in 'where clause'"), which stopped every drain in production; a
 * grouped derived table joined on home_id works on TiDB, MySQL and SQLite.
 */
type SelectBuilder = Pick<PhotoDb, "select">;
function servedHomes(qb: SelectBuilder) {
  return qb.select({ homeId: sql<number>`${dealPhotos.homeId}`.as("served_home_id") })
    .from(dealPhotos)
    .where(and(eq(dealPhotos.processingState, "processed"), eq(dealPhotos.automaticHidden, false), eq(dealPhotos.adminHidden, false)))
    .groupBy(dealPhotos.homeId)
    .as("served_homes");
}

/**
 * Homes buyers can see, and how many of them show no photo yet (no processed, unhidden photo): the number that
 * says when the site looks complete, which the raw queue size does not (most of the queue is later gallery photos).
 */
export async function shownHomePhotoCoverage() {
  const db = await getDb();
  if (!db) return null;
  const served = servedHomes(db);
  const homes = (await db.select({ total: sql<number>`count(*)`, without: sql<number>`sum(case when ${served.homeId} is null then 1 else 0 end)` })
    .from(dealHomes)
    .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
    .leftJoin(served, eq(served.homeId, dealHomes.id))
    .where(homeIsShown))[0];
  const pending = (await db.select({ count: sql<number>`count(*)` })
    .from(dealPhotos)
    .innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
    .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
    .where(and(homeIsShown, inArray(dealPhotos.processingState, ["pending", "processing"]))))[0];
  // Why the homes without a photo have none: per home, what its photo rows look like.
  const rows = db.select({
    homeId: sql<number>`${dealPhotos.homeId}`.as("rows_home_id"),
    total: sql<number>`count(*)`.as("rows_total"),
    queued: sql<number>`sum(case when ${dealPhotos.processingState} in ('pending','processing') then 1 else 0 end)`.as("rows_queued"),
    failed: sql<number>`sum(case when ${dealPhotos.processingState} = 'failed' then 1 else 0 end)`.as("rows_failed"),
  }).from(dealPhotos).groupBy(dealPhotos.homeId).as("photo_rows");
  const why = await db.select({
    builder: dealCommunities.builder,
    noPhotoRows: sql<number>`sum(case when ${rows.homeId} is null then 1 else 0 end)`,
    queued: sql<number>`sum(case when ${rows.queued} > 0 then 1 else 0 end)`,
    allFailed: sql<number>`sum(case when ${rows.total} > 0 and ${rows.failed} = ${rows.total} then 1 else 0 end)`,
    hiddenOrOther: sql<number>`sum(case when ${rows.total} > 0 and ${rows.queued} = 0 and ${rows.failed} < ${rows.total} then 1 else 0 end)`,
    homes: sql<number>`count(*)`,
  })
    .from(dealHomes)
    .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
    .leftJoin(served, eq(served.homeId, dealHomes.id))
    .leftJoin(rows, eq(rows.homeId, dealHomes.id))
    .where(and(homeIsShown, isNull(served.homeId)))
    .groupBy(dealCommunities.builder);
  const withoutPhotoWhy = { noPhotoRows: 0, queued: 0, allFailed: 0, hiddenOrOther: 0, byBuilder: [] as { builder: string | null; homes: number; noPhotoRows: number; queued: number; allFailed: number; hiddenOrOther: number }[] };
  for (const r of why) {
    const b = { builder: r.builder, homes: Number(r.homes ?? 0), noPhotoRows: Number(r.noPhotoRows ?? 0), queued: Number(r.queued ?? 0), allFailed: Number(r.allFailed ?? 0), hiddenOrOther: Number(r.hiddenOrOther ?? 0) };
    withoutPhotoWhy.noPhotoRows += b.noPhotoRows; withoutPhotoWhy.queued += b.queued; withoutPhotoWhy.allFailed += b.allFailed; withoutPhotoWhy.hiddenOrOther += b.hiddenOrOther;
    withoutPhotoWhy.byBuilder.push(b);
  }
  withoutPhotoWhy.byBuilder.sort((a, b) => b.homes - a.homes);
  return { shownHomes: Number(homes?.total ?? 0), withoutPhoto: Number(homes?.without ?? 0), pendingPhotosForShownHomes: Number(pending?.count ?? 0), withoutPhotoWhy };
}

/**
 * Queue order: photos of homes buyers can see first; among those, homes that
 * show no photo yet; then gallery position (every home's cover before any
 * home's second photo); then the cheapest homes (the ones the featured and
 * best-deal lists lead with); then the oldest due row.
 */
function dealPhotoPriorityOrder(served: ReturnType<typeof servedHomes>) {
  return [
    sql`CASE WHEN ${homeIsShown} THEN 0 ELSE 1 END`,
    sql`CASE WHEN ${served.homeId} IS NULL THEN 0 ELSE 1 END`,
    asc(dealPhotos.sortOrder),
    sql`CASE WHEN ${dealHomes.price} IS NULL THEN 1 ELSE 0 END`,
    asc(dealHomes.price),
    asc(dealPhotos.nextProcessingAttemptAt),
    asc(dealPhotos.id),
  ];
}

type QueueRow = { id: number; sourceUrl: string; sourceHash: string; builder: string | null; communityId: number | null; originalVersion: string | null };

/** The due candidates in priority order. Takes any select builder (the database, or a QueryBuilder in the ordering test). */
export function dealPhotoCandidateQuery(qb: SelectBuilder, now: Date, limit: number, excluded: readonly number[]) {
  const served = servedHomes(qb);
  return qb.select({ id: dealPhotos.id, sourceUrl: dealPhotos.sourceUrl, sourceHash: dealPhotos.sourceHash, builder: dealCommunities.builder, communityId: dealHomes.communityId, originalVersion: dealPhotos.originalVersion })
    .from(dealPhotos)
    .leftJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
    .leftJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
    .leftJoin(served, eq(served.homeId, dealPhotos.homeId))
    .where(and(dueNow(now), excluded.length ? notInArray(dealPhotos.id, [...excluded]) : undefined))
    .orderBy(...dealPhotoPriorityOrder(served))
    .limit(limit);
}

export function selectDealPhotoCandidates(db: PhotoDb, now: Date, limit: number, excluded: readonly number[]) {
  return dealPhotoCandidateQuery(db, now, limit, excluded);
}

/** Plain due order (oldest due first): the fallback when the priority query fails on the host's database. */
export function selectDealPhotoCandidatesPlain(db: PhotoDb, now: Date, limit: number, excluded: readonly number[]) {
  return db.select({ id: dealPhotos.id, sourceUrl: dealPhotos.sourceUrl, sourceHash: dealPhotos.sourceHash, builder: dealCommunities.builder, communityId: dealHomes.communityId, originalVersion: dealPhotos.originalVersion })
    .from(dealPhotos)
    .leftJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
    .leftJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
    .where(and(dueNow(now), excluded.length ? notInArray(dealPhotos.id, [...excluded]) : undefined))
    .orderBy(asc(dealPhotos.nextProcessingAttemptAt), asc(dealPhotos.id))
    .limit(limit);
}

/** A database error's message for the health view: one line, no values longer than the message itself needs. */
export function photoQueryErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Drizzle prefixes "Failed query: <sql>\nparams: …"; the cause carries the server's own message.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const text = (cause || raw).replace(/\s+/g, " ").replace(/params:.*$/i, "").trim();
  return text.slice(0, 300);
}

async function nextDrainBatch(db: PhotoDb, now: Date, limit: number, exclude: ReadonlySet<number>, ctx: DealPhotoRunContext): Promise<number[]> {
  const excluded = Array.from(exclude);
  let rows: QueueRow[];
  if (ctx.warning) {
    rows = await selectDealPhotoCandidatesPlain(db, now, limit, excluded);
  } else {
    try {
      rows = await selectDealPhotoCandidates(db, now, limit, excluded);
    } catch (error) {
      // Keep photos moving in plain due order; the health check shows the reason.
      ctx.warning = `priority query failed: ${photoQueryErrorDetail(error)}`;
      console.error(`[deals-photo] ${ctx.warning}`);
      rows = await selectDealPhotoCandidatesPlain(db, now, limit, excluded);
    }
  }
  const fresh = rows.filter((row) => !exclude.has(row.id));
  const shareable = fresh.filter((row) => row.builder && row.communityId !== null && row.communityId !== undefined && typeof row.sourceUrl === "string" && !isUploadSource(row.sourceUrl) && row.sourceHash);
  const queued = new Set(fresh.map((row) => row.id));
  const siblingsBySource = new Map<string, number[]>();
  if (shareable.length) {
    const hashes = Array.from(new Set(shareable.map((row) => row.sourceHash)));
    const communityIds = Array.from(new Set(shareable.map((row) => row.communityId as number)));
    const needOriginal = shareable.filter((row) => !row.originalVersion);
    const donorHashes = Array.from(new Set(needOriginal.map((row) => row.sourceHash)));
    const donorCommunityIds = Array.from(new Set(needOriginal.map((row) => row.communityId as number)));
    const [siblings, donors] = await Promise.all([
      db.select({ id: dealPhotos.id, sourceUrl: dealPhotos.sourceUrl, builder: dealCommunities.builder })
        .from(dealHomes)
        .innerJoin(dealPhotos, eq(dealPhotos.homeId, dealHomes.id))
        .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
        .where(and(inArray(dealHomes.communityId, communityIds), dueNow(now), inArray(dealPhotos.sourceHash, hashes), notInArray(dealPhotos.id, [...excluded, ...Array.from(queued)])))
        .limit(PHOTO_SIBLINGS_PER_REFILL),
      donorHashes.length
        ? db.select({ sourceUrl: dealPhotos.sourceUrl, originalStorageKey: dealPhotos.originalStorageKey, originalVersion: dealPhotos.originalVersion, builder: dealCommunities.builder })
          .from(dealHomes)
          .innerJoin(dealPhotos, eq(dealPhotos.homeId, dealHomes.id))
          .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
          .where(and(inArray(dealHomes.communityId, donorCommunityIds), inArray(dealPhotos.sourceHash, donorHashes), isNotNull(dealPhotos.originalStorageKey), isNotNull(dealPhotos.originalVersion)))
          .limit(donorHashes.length * 2)
        : Promise.resolve([] as Array<{ sourceUrl: string; originalStorageKey: string | null; originalVersion: string | null; builder: string }>),
    ]).catch((error) => {
      // Sharing is an optimisation: without it each row is processed on its own.
      ctx.warning ??= `shared-image lookup failed: ${photoQueryErrorDetail(error)}`;
      console.error(`[deals-photo] shared-image lookup failed: ${photoQueryErrorDetail(error)}`);
      return [[], []] as [Array<{ id: number; sourceUrl: string; builder: string }>, Array<{ sourceUrl: string; originalStorageKey: string | null; originalVersion: string | null; builder: string }>];
    });
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

async function drainDealPhotoQueue(options: { maxPhotos: number; deadline: number; clock: () => number; concurrency: number; photoTimeoutMs: number; progress?: DealPhotoDrainResult }): Promise<DealPhotoDrainResult> {
  const startedAt = options.clock();
  const result: DealPhotoDrainResult = Object.assign(options.progress ?? {}, { ...emptyDrainResult(), stoppedForTime: false });
  const db = await getDb();
  if (!db) return result;
  const now = new Date();
  const leaseExpired = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const abandoned = and(eq(dealPhotos.processingState, "processing"), lt(dealPhotos.processingStartedAt, leaseExpired));
  // A row whose every attempt died with its run (it may be what kills the
  // instance) is failed for good rather than put first in the queue again; the
  // boot-time recovery leaves it alone too. An admin requeue still retries it.
  await db.update(dealPhotos).set({
    processingState: "failed",
    automaticHidden: true,
    nextProcessingAttemptAt: null,
    processingStartedAt: null,
    lastProcessingError: "processing_abandoned",
    ocrMatches: JSON.stringify([{ kind: "processing_error", code: "processing_abandoned" }]),
  }).where(and(abandoned, gte(dealPhotos.processingAttempts, MAX_ABANDONED_ATTEMPTS)));
  // Otherwise it goes back in the queue after a short pause, not straight to the front.
  await db.update(dealPhotos).set({
    processingState: "pending",
    nextProcessingAttemptAt: new Date(now.getTime() + LEASE_EXPIRED_RETRY_MS),
    processingStartedAt: null,
    lastProcessingError: "processing_lease_expired",
  }).where(and(abandoned, lt(dealPhotos.processingAttempts, MAX_ABANDONED_ATTEMPTS)));
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
  // The same object: a caller reading `progress` mid-drain sees the stage times so far.
  result.stageMs = ctx.stageMs;
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
      // Each drain still does one photo, so a process whose memory does not come back keeps the queue moving.
      if (started > 0 && overMb(PHOTO_RSS_STOP_MB)) {
        result.stoppedForMemory = true;
        return null;
      }
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
        result.error = "queue_read_failed";
        result.errorDetail = photoQueryErrorDetail(error);
        console.error(`[deals-photo] queue read failed: ${result.errorDetail}`);
      }).finally(() => { refilling = null; });
      await refilling;
    }
  };
  const lane = async () => {
    for (let id = await next(); id !== null; id = await next()) {
      const outcome = await processDealPhoto(id, ctx, { timeoutMs: options.photoTimeoutMs }).catch((): DealPhotoProcessResult => ({ ok: false, skipped: true }));
      if (outcome.timedOut) {
        // Its work may still be running; this lane starts nothing more, so the request ends on time and memory stays bounded.
        result.timedOut = (result.timedOut ?? 0) + 1;
        if (outcome.retryScheduled) result.retried++;
        else result.failed++;
        return;
      }
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
  if (ctx.warning) result.warning = ctx.warning;
  result.elapsedMs = options.clock() - startedAt;
  return result;
}

async function waitAtMost(promise: Promise<unknown>, milliseconds: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([promise.catch(() => undefined), new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, milliseconds)); })]);
  } finally { if (timer) clearTimeout(timer); }
}

function logAndRecordDrain(total: DealPhotoDrainResult) {
  // One line per cron call, so the host logs show the real throughput.
  console.log(`[deals-photo] drain${total.partial ? " (answered before it finished)" : ""}${total.coalesced ? " (coalesced: another drain is running)" : ""}: ${total.processed} published, ${total.hidden} hidden, ${total.retried} retry, ${total.failed} failed, ${total.skipped} skipped, ${total.awaitingRegion} awaiting region in ${Math.round((total.elapsedMs ?? 0) / 1000)} s; reused originals ${total.reused?.originals ?? 0}, masters ${total.reused?.masters ?? 0}, OCR ${total.reused?.ocr ?? 0}${total.processed + total.hidden ? `; ${Math.round((total.elapsedMs ?? 0) / (total.processed + total.hidden))} ms/photo (busy ms: ${DEAL_PHOTO_STAGES.map((stage) => `${stage} ${Math.round(total.stageMs?.[stage] ?? 0)}`).join(", ")})` : ""}${total.timedOut ? `; ${total.timedOut} timed out` : ""}${total.stoppedForTime ? "; budget spent, more due" : ""}${total.steppedAroundStaleDrain ? "; stepped around a hung drain" : ""}${total.error ? `; ERROR ${total.error}${total.errorDetail ? ` (${total.errorDetail})` : ""}` : ""}${total.warning ? `; WARNING ${total.warning}` : ""}`);
  // For the health check: every cron call leaves a status, so a stuck or coalescing queue is never invisible.
  return recordDealPhotoDrainStatus(total).catch((error) => { console.warn(`[deals-photo] drain status not recorded: ${error instanceof Error ? error.message : "unknown"}`); return null; });
}

/**
 * Drains due photos (new imports, due retries, expired leases) in priority
 * order with PHOTO_PROCESSING_CONCURRENCY photos in flight.
 *
 * - `processPendingDealPhotos(n)` (sync and admin kicks): at most n photos (50
 *   max). While any drain runs in this process the kick returns at once and
 *   asks that drain for one more pass, so rows inserted meanwhile are picked up.
 * - `processPendingDealPhotos({ budgetMs })` (the cron): keeps starting photos
 *   until the budget is spent, then lets the ones in flight finish. A drain
 *   already running here that is younger than DRAIN_STALE_MS is waited for
 *   (within the budget); an older one is presumed hung and this call runs its
 *   own beside it, at most MAX_DRAINS_PER_PROCESS at a time. Every cron call
 *   records the drain status, including a coalesced one.
 *
 * Across processes, every row is claimed atomically when its lane starts it
 * and every write is fenced on that claim, so overlapping drains never process
 * a row twice; a claim left by a dead instance is put back after PROCESSING_LEASE_MS.
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
  const photoTimeoutMs = Math.max(1, options.photoTimeoutMs ?? PHOTO_TIMEOUT_MS);
  if (!budgeted && activeDrains.size) {
    drainRerunRequested = true;
    return { ...emptyDrainResult(), coalesced: true };
  }
  let waitedMs: number | undefined;
  let steppedAround = false;
  for (;;) {
    if (!activeDrains.size) break;
    const fresh = Array.from(activeDrains).filter((drain) => clock() - drain.startedAt < DRAIN_STALE_MS);
    if (!fresh.length && activeDrains.size < MAX_DRAINS_PER_PROCESS) {
      steppedAround = true;
      console.warn(`[deals-photo] a drain in this process has run for over ${Math.round(DRAIN_STALE_MS / 1000)} s; starting another beside it`);
      break;
    }
    const remaining = deadline - clock();
    if (remaining <= 0) {
      const coalesced: DealPhotoDrainResult = { ...emptyDrainResult(), coalesced: true, waitedMs: clock() - begin, elapsedMs: clock() - begin };
      await logAndRecordDrain(coalesced);
      return coalesced;
    }
    // Wait for a drain to end, or for the fresh one to go stale, within this call's budget.
    const untilStale = fresh.length ? Math.min(...fresh.map((drain) => drain.startedAt + DRAIN_STALE_MS)) - clock() : remaining;
    await waitAtMost(Promise.race(Array.from(activeDrains).map((drain) => drain.done)), Math.max(1, Math.min(remaining, untilStale)));
    waitedMs = clock() - begin;
  }
  const drain: ActiveDrain = { startedAt: clock(), done: Promise.resolve(emptyDrainResult()) };
  drain.done = (async () => {
    let total = await drainDealPhotoQueue({ maxPhotos, deadline, clock, concurrency, photoTimeoutMs, progress: options.progress });
    // A budgeted drain refills until its budget is spent, so it already picks up rows a kick asked for.
    for (let reruns = 0; !budgeted && drainRerunRequested && reruns < 3; reruns++) {
      drainRerunRequested = false;
      total = mergeDrainResults(total, await drainDealPhotoQueue({ maxPhotos, deadline, clock, concurrency, photoTimeoutMs }));
    }
    if (!budgeted) drainRerunRequested = false;
    if (steppedAround) total.steppedAroundStaleDrain = true;
    if (waitedMs !== undefined) total.waitedMs = waitedMs;
    if (overMb(PHOTO_RSS_RELEASE_MB)) {
      await closeDealPhotoOcrWorker().catch(() => undefined);
      total.ocrReleased = true;
    }
    if (budgeted) await logAndRecordDrain(total);
    return total;
  })().finally(() => { activeDrains.delete(drain); });
  activeDrains.add(drain);
  return drain.done;
}

/**
 * The scheduled photo call. The host aborts scheduled calls at 30 s, so this
 * answers by `respondWithinMs` (SCHEDULED_PHOTO_RESPOND_MS) whatever happens:
 * with the finished drain, or with its counts so far (`partial`), recording a
 * status either way. A drain still running continues after the answer; every
 * write it makes is fenced on its claims, so a throttled or recycled instance
 * can only lose work, never publish stale results.
 */
export async function runScheduledDealPhotoDrain(options: { budgetMs?: number; respondWithinMs?: number; clock?: () => number; photoTimeoutMs?: number; concurrency?: number } = {}): Promise<DealPhotoDrainResult> {
  const clock = options.clock ?? Date.now;
  const begin = clock();
  const progress: DealPhotoDrainResult = emptyDrainResult();
  const done = processPendingDealPhotos({ budgetMs: options.budgetMs ?? PHOTO_DRAIN_BUDGET_MS, clock, progress, photoTimeoutMs: options.photoTimeoutMs, concurrency: options.concurrency });
  let timer: NodeJS.Timeout | undefined;
  const answerBy = new Promise<"partial">((resolve) => { timer = setTimeout(() => resolve("partial"), Math.max(0, options.respondWithinMs ?? SCHEDULED_PHOTO_RESPOND_MS)); });
  try {
    const outcome = await Promise.race([done, answerBy]);
    if (outcome !== "partial") return outcome;
  } catch (error) {
    const failed: DealPhotoDrainResult = { ...emptyDrainResult(), error: "queue_read_failed", errorDetail: photoQueryErrorDetail(error), elapsedMs: clock() - begin };
    void logAndRecordDrain(failed);
    return failed;
  } finally { if (timer) clearTimeout(timer); }
  void done.catch(() => undefined);
  const partial: DealPhotoDrainResult = { ...progress, reused: progress.reused ? { ...progress.reused } : undefined, stageMs: progress.stageMs ? { ...progress.stageMs } : undefined, partial: true, elapsedMs: clock() - begin };
  if (!partial.stageMs) delete partial.stageMs;
  if (!partial.reused) delete partial.reused;
  // Not awaited: the answer must not wait on the database either.
  void logAndRecordDrain(partial);
  return partial;
}

export function dealPhotoRenderCacheVersion(photoVersion: string, leadId: number, identity: string) {
  // v2: renders made before masters were verified against processedVersion are not reused.
  return digest(`watermark-v2\u0000${photoVersion}\u0000${leadId}\u0000${identity}`).slice(0, 64);
}

type RenderedPhoto = { data: Buffer; contentType: string };
const renderLimiter = createLimiter(RENDER_CONCURRENCY);
const renderMemory = new LruCache<RenderedPhoto>(RENDER_MEMORY_ENTRIES);

/** Test seam: clears in-process caches and the drain guard. Never called by product code. */
export function resetDealPhotoRuntimeState() {
  renderMemory.clear();
  activeDrains.clear();
  hostLimiters.clear();
  drainRerunRequested = false;
  failedRowsRecovered = false;
}

/**
 * A featured home's cover on the landing page (no lead yet): the same checked master, marked for the brokerage
 * instead of a lead, and smaller. Only photos the current Best Deals strip names are ever asked for (the route
 * maps an opaque deal key to the photo), so this never opens the rest of the catalog to visitors.
 */
/** Visitors' renders get their own lanes and a short queue, so they never hold up a signed-up buyer's photos. */
const publicRenderLimiter = createLimiter(3);
/** A few galleries' worth of first-time renders may wait; past that the route answers "busy" and the page retries. */
const PUBLIC_RENDER_QUEUE_MAX = 80;
/** The answer when the public lanes are full: the route says "busy, try again" instead of queueing without end. */
export const PUBLIC_RENDER_BUSY = "busy" as const;

/**
 * A processed photo whose stored master is missing or no longer matches (October 24, 2026: a Vista Gardens cover answered
 * 404 on every load): back to pending, so the queue makes it again; the pages stop listing it until it is processed.
 */
async function requeueBrokenProcessedPhoto(photoId: number, scanCommunity = true) {
  const db = await getDb();
  if (!db) return;
  await db.update(dealPhotos).set({ processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: new Date(), processingStartedAt: null, lastProcessingError: "stored_master_missing" })
    .where(and(eq(dealPhotos.id, photoId), eq(dealPhotos.processingState, "processed"))).catch(() => undefined);
  if (scanCommunity) void scanCommunityMasters(photoId).catch(() => undefined);
  console.warn(`[deals-photos] photo ${photoId}: stored master missing, queued again`);
}

/** Communities whose processed photos were checked recently (a missing master usually has company: Vista Gardens lost several). */
const masterScanAt = new Map<number, number>();
const MASTER_SCAN_EVERY_MS = 6 * 60 * 60_000;

/**
 * Checks every processed photo of the community a broken photo belongs to (one byte each, three at a time) and queues
 * the ones whose master is gone, so the cover and gallery stop cycling through broken photos one visit at a time.
 */
async function scanCommunityMasters(photoId: number) {
  const db = await getDb();
  if (!db) return;
  const owner = (await db.select({ communityId: dealHomes.communityId }).from(dealPhotos).innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id)).where(eq(dealPhotos.id, photoId)).limit(1))[0];
  if (!owner) return;
  const last = masterScanAt.get(owner.communityId) ?? 0;
  if (Date.now() - last < MASTER_SCAN_EVERY_MS) return;
  masterScanAt.set(owner.communityId, Date.now());
  const rows = await db.select({ id: dealPhotos.id, key: dealPhotos.processedStorageKey }).from(dealPhotos).innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
    .where(and(eq(dealHomes.communityId, owner.communityId), eq(dealHomes.status, "available"), eq(dealPhotos.processingState, "processed"), isNotNull(dealPhotos.processedStorageKey))).limit(1500);
  let missing = 0;
  for (let index = 0; index < rows.length; index += 3) {
    const checks = await Promise.all(rows.slice(index, index + 3).map(async (row) => ({ row, there: await storageExistsPrivate(row.key as string) })));
    for (const { row, there } of checks) if (there === false) { missing++; await requeueBrokenProcessedPhoto(row.id, false); }
  }
  console.warn(`[deals-photos] community ${owner.communityId}: checked ${rows.length} photo masters, ${missing} missing and queued again`);
}

export async function renderDealPhotoForPublic(photoId: number): Promise<RenderedPhoto | null | typeof PUBLIC_RENDER_BUSY> {
  try {
    const db = await getDb();
    if (!db) return null;
    const row = (await db.select({ photo: dealPhotos }).from(dealPhotos)
      .innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id))
      .innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id))
      .where(and(
        eq(dealPhotos.id, photoId),
        eq(dealPhotos.processingState, "processed"),
        eq(dealPhotos.automaticHidden, false),
        eq(dealPhotos.adminHidden, false),
        eq(dealHomes.status, "available"),
        eq(dealCommunities.paused, false),
        eq(dealCommunities.active, true),
      )).limit(1))[0];
    if (!row?.photo.processedStorageKey || !row.photo.processedVersion) return null;
    const cacheVersion = `public:${row.photo.processedVersion}`;
    const inMemory = renderMemory.get(cacheVersion);
    if (inMemory) return inMemory;
    // Kept in storage too (keyed by the master's version), so a restart or a busy page does not redo the work.
    const storedKey = `${PRIVATE_PREFIX}public/${photoId}-${row.photo.processedVersion.slice(0, 16)}.webp`;
    if (publicRenderLimiter.waiting() >= PUBLIC_RENDER_QUEUE_MAX) return PUBLIC_RENDER_BUSY;
    return await publicRenderLimiter(async () => {
      const raced = renderMemory.get(cacheVersion);
      if (raced) return raced;
      try {
        const stored = await storageReadPrivate(storedKey);
        if (stored.data.length) {
          const value = { data: stored.data, contentType: "image/webp" };
          renderMemory.set(cacheVersion, value);
          return value;
        }
      } catch { /* not rendered yet */ }
      let source: { data: Buffer };
      try { source = await storageReadPrivate(row.photo.processedStorageKey as string); } catch (error) {
        // The stored master is gone (storage answered 4xx): the photo is processed again rather than staying a broken image.
        if (/\((?:403|404|410)\)/.test(error instanceof Error ? error.message : "")) await requeueBrokenProcessedPhoto(photoId);
        return null;
      }
      if (digest(source.data) !== row.photo.processedVersion) { await requeueBrokenProcessedPhoto(photoId); return null; }
      const resized = await sharp(source.data, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
        .resize({ width: 960, height: 720, fit: "inside", withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true });
      const rendered = await sharp(resized.data)
        .composite([{ input: tiledWatermarkSvg("Lifestyle Design Realty", resized.info.width, resized.info.height), gravity: "center" }])
        .webp({ quality: 82, effort: 4, smartSubsample: true })
        .toBuffer();
      const value = { data: rendered, contentType: "image/webp" };
      renderMemory.set(cacheVersion, value);
      void storagePut(storedKey, rendered, "image/webp", { unique: false }).catch(() => undefined);
      return value;
    });
  } catch {
    return null;
  }
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
      // Fail closed: only the exact master the row's checks passed is ever rendered.
      if (digest(source.data) !== row.photo.processedVersion) {
        console.warn(`[deals-photo] master bytes do not match the processed version for photo ${photoId}; not served`);
        return null;
      }
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
