import crypto from "node:crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { dealCommunities } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { makeRequest, type DistanceMatrixResult, type GeocodingResult } from "./_core/map";
import { getDb } from "./db";
import { communityScrubConfig, getDealSettings, isLiveDealSession, publicNoPrivateNames } from "./dealsService";

/**
 * AREA MAP: one small static map per community, centered on the community's
 * ZIP code centroid (a fixed public point), never on the community itself. The
 * gated API returns only that centroid and radius; the image is proxied through
 * a same-origin, session-checked route so no tile request or coordinate reaches
 * the browser from a map provider.
 */
/** The private list's circle (Admin can change it); the public landing card shows a wider one. */
export const AREA_MAP_RADIUS_MILES = 5;
export const PUBLIC_AREA_MAP_RADIUS_MILES = 8;
export const AREA_MAP_ZOOM = 11;
const MIN_AREA_MAP_ZOOM = 8;
const MAX_AREA_MAP_ZOOM = 13;
/** The circle stays inside the 800 x 400 image with room around it: at most 150 px radius. */
const MAX_CIRCLE_RADIUS_PX = 150;
export const AREA_MAP_WIDTH = 800;
export const AREA_MAP_HEIGHT = 400;
export const AREA_MAP_ATTRIBUTION = "Map data and imagery from Google. Centered on the ZIP code area, not the community.";
/** The landing card names no ZIP code: its circle is moved off the ZIP center by a few miles. */
export const PUBLIC_AREA_MAP_ATTRIBUTION = "Map data and imagery from Google. General area only.";
/** How far the landing card's circle is moved off the ZIP center (never more than 40% of its radius). */
const PUBLIC_OFFSET_MIN_MILES = 1.5;
const PUBLIC_OFFSET_MAX_MILES = 3;
export const DEFAULT_DRIVE_DESTINATIONS = ["downtown San Antonio", "Randolph AFB", "Lackland AFB", "The Pearl"];
const IMAGE_CACHE_MS = 24 * 60 * 60_000;
/** Enough for both maps of every community; stored as WebP (about 40 KB each). */
const IMAGE_CACHE_LIMIT = 800;
/** A failed provider call is not repeated for this long. */
const FAILURE_CACHE_MS = 10 * 60_000;

/**
 * What the page gets to draw the circle. The private list also gets the ZIP
 * centroid and zoom; the landing card gets only the circle's size in pixels.
 */
export type DealsAreaMap = { lat?: number; lng?: number; zoom?: number; radiusMiles: number; radiusPixels: number; imageUrl: string; attribution: string };
export type AreaMapVariant = "gated" | "public";

/** The closest zoom at which a circle of this radius still fits comfortably in the image. */
export function zoomForRadius(radiusMiles: number, lat: number): number {
  const metresPerPixelAtZoom0 = 156543.03392 * Math.cos(lat * Math.PI / 180);
  for (let zoom = MAX_AREA_MAP_ZOOM; zoom > MIN_AREA_MAP_ZOOM; zoom--) {
    if ((radiusMiles * 1609.344) / (metresPerPixelAtZoom0 / 2 ** zoom) <= MAX_CIRCLE_RADIUS_PX) return zoom;
  }
  return MIN_AREA_MAP_ZOOM;
}

/** The radius Admin set for this variant, kept to a sane range. */
export function areaMapRadius(settings: { areaMapRadiusMiles?: unknown; publicAreaMapRadiusMiles?: unknown }, variant: AreaMapVariant): number {
  const value = variant === "public" ? settings.publicAreaMapRadiusMiles : settings.areaMapRadiusMiles;
  const fallback = variant === "public" ? PUBLIC_AREA_MAP_RADIUS_MILES : AREA_MAP_RADIUS_MILES;
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 20 ? value : fallback;
}
type Centroid = { lat: number; lng: number };

export function zipFromAddress(address: string | null | undefined): string | null {
  const match = /\b(\d{5})(?:-\d{4})?\s*$/.exec((address ?? "").trim());
  return match ? match[1] : null;
}

function finiteCoordinate(value: unknown, limit: number): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}

/** The ZIP code centroid as Google reports it; a street-level result is refused. */
export async function geocodeZipCentroid(zip: string): Promise<Centroid | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const result = await makeRequest<GeocodingResult>("/maps/api/geocode/json", { components: `postal_code:${zip}|country:US` });
  const match = result.results?.find((item) => item.types?.includes("postal_code") && item.geometry?.location);
  if (!match) return null;
  const lat = finiteCoordinate(match.geometry.location.lat, 90);
  const lng = finiteCoordinate(match.geometry.location.lng, 180);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

export function roundToFiveMinutes(seconds: number): number {
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}

function destinationQuery(destination: string): string {
  const trimmed = destination.trim();
  // Short names such as "The Pearl" are anchored to the metro so Google does not
  // resolve a same-named place elsewhere.
  return /,|\bTX\b|\bTexas\b/i.test(trimmed) ? trimmed : `${trimmed}, San Antonio, TX`;
}

/** "about N min to X" chips from the ZIP centroid, rounded to 5 minutes; failed legs are skipped. */
export async function driveTimeChips(centroid: Centroid, destinations: readonly string[]): Promise<string[]> {
  const list = destinations.map((value) => value.trim()).filter(Boolean).slice(0, 8);
  if (!list.length) return [];
  const result = await makeRequest<DistanceMatrixResult>("/maps/api/distancematrix/json", {
    origins: `${centroid.lat},${centroid.lng}`,
    destinations: list.map(destinationQuery).join("|"),
    mode: "driving",
    units: "imperial",
  });
  const elements = result.rows?.[0]?.elements ?? [];
  return list.flatMap((destination, index) => {
    const element = elements[index];
    if (!element || element.status !== "OK" || typeof element.duration?.value !== "number") return [];
    return [`about ${roundToFiveMinutes(element.duration.value)} min to ${destination}`];
  });
}

/**
 * Geocode the community's ZIP centroid and compute the drive-time chips. Called
 * on save/seed and whenever a community has no centroid yet. Never throws: a
 * provider failure leaves the map unavailable rather than breaking a save.
 */
export async function refreshCommunityGeography(communityId: number): Promise<{ ok: boolean; reason?: string; chips?: string[] }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "database_unavailable" };
  const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, communityId)).limit(1))[0];
  if (!community) return { ok: false, reason: "not_found" };
  const zip = zipFromAddress(community.privateAddress);
  if (!zip) return { ok: false, reason: "no_zip_in_private_address" };
  try {
    const centroid = await geocodeZipCentroid(zip);
    if (!centroid) return { ok: false, reason: "zip_not_geocoded" };
    let chips: string[] = [];
    try {
      const settings = await getDealSettings();
      chips = await driveTimeChips(centroid, settings.driveDestinations);
    } catch (error) {
      console.warn("[deals-map] drive times unavailable", error instanceof Error ? error.message : error);
    }
    await db.update(dealCommunities).set({
      zipCentroidLat: centroid.lat.toFixed(6),
      zipCentroidLng: centroid.lng.toFixed(6),
      driveTimeChips: JSON.stringify(chips),
    }).where(eq(dealCommunities.id, communityId));
    for (const key of Array.from(imageCache.keys())) if (key.startsWith(`${communityId}:`)) imageCache.delete(key);
    for (const key of Array.from(failureCache.keys())) if (key.startsWith(`${communityId}:`)) failureCache.delete(key);
    return { ok: true, chips };
  } catch (error) {
    console.warn("[deals-map] geocoding unavailable", error instanceof Error ? error.message : error);
    return { ok: false, reason: "geocoder_unavailable" };
  }
}

/** A keyed, per-community direction and distance, so the offset cannot be recomputed from the public id. */
export function publicMapCenter(communityId: number, centroid: Centroid, radiusMiles: number): Centroid {
  const key = ENV.cookieSecret || "deals-public-map-offset";
  const digest = crypto.createHmac("sha256", key).update(`deals-public-map-offset:${communityId}`).digest();
  const fraction = (offset: number) => digest.readUInt32BE(offset) / 0xffffffff;
  const miles = Math.min(PUBLIC_OFFSET_MIN_MILES + (PUBLIC_OFFSET_MAX_MILES - PUBLIC_OFFSET_MIN_MILES) * fraction(0), radiusMiles * 0.4);
  const bearing = 2 * Math.PI * fraction(4);
  const lat = centroid.lat + (miles * Math.cos(bearing)) / 69.0;
  const lng = centroid.lng + (miles * Math.sin(bearing)) / (69.172 * Math.cos(centroid.lat * Math.PI / 180));
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

function circlePixels(radiusMiles: number, lat: number, zoom: number): number {
  return Math.round(radiusMiles * 1609.344 / (156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** zoom) * 10) / 10;
}

type MapGeometry = { center: Centroid; zoom: number; radiusMiles: number; radiusPixels: number };

/** Where the image is centered and how big the circle is, for either variant. */
export function areaMapGeometry(row: Pick<typeof dealCommunities.$inferSelect, "id" | "zipCentroidLat" | "zipCentroidLng">, variant: AreaMapVariant, radiusMiles: number): MapGeometry | null {
  const lat = finiteCoordinate(row.zipCentroidLat, 85);
  const lng = finiteCoordinate(row.zipCentroidLng, 180);
  if (lat === null || lng === null) return null;
  const center = variant === "public" ? publicMapCenter(row.id, { lat, lng }, radiusMiles) : { lat, lng };
  const zoom = zoomForRadius(radiusMiles, center.lat);
  return { center, zoom, radiusMiles, radiusPixels: circlePixels(radiusMiles, center.lat, zoom) };
}

/**
 * The private list gets a closer circle (behind the session check), centered on
 * the ZIP code centroid, never the community. The public landing card gets a
 * wider circle moved a few miles off the ZIP center, and no coordinates at all.
 */
export function communityAreaMap(row: Pick<typeof dealCommunities.$inferSelect, "id" | "zipCentroidLat" | "zipCentroidLng">, options: { variant?: AreaMapVariant; radiusMiles?: number } = {}): DealsAreaMap | null {
  const variant = options.variant ?? "gated";
  const radiusMiles = options.radiusMiles ?? (variant === "public" ? PUBLIC_AREA_MAP_RADIUS_MILES : AREA_MAP_RADIUS_MILES);
  const geometry = areaMapGeometry(row, variant, radiusMiles);
  if (!geometry) return null;
  if (variant === "public") return { radiusMiles, radiusPixels: geometry.radiusPixels, imageUrl: `/deals/maps/${row.id}.webp`, attribution: PUBLIC_AREA_MAP_ATTRIBUTION };
  return { lat: geometry.center.lat, lng: geometry.center.lng, zoom: geometry.zoom, radiusMiles, radiusPixels: geometry.radiusPixels, imageUrl: `/deals/mine/maps/${row.id}.webp`, attribution: AREA_MAP_ATTRIBUTION };
}

export function mapCommunityIdFromPath(raw: string | undefined): number | null {
  const match = /^(\d{1,9})(?:\.(?:png|webp))?$/.exec(raw ?? "");
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const imageCache = new Map<string, { bytes: Buffer; expiresAt: number; centroidKey: string }>();
const failureCache = new Map<string, number>();
/** Remembered per process: whether the provider accepts the exact 800x400 request. */
let wideStaticMapsAllowed: boolean | null = null;

function staticMapUrl(centroid: Centroid, variant: "wide" | "cropped", zoom = AREA_MAP_ZOOM): string {
  const base = ENV.forgeApiUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/v1/maps/proxy/maps/api/staticmap`);
  url.searchParams.set("key", ENV.forgeApiKey);
  url.searchParams.set("center", `${centroid.lat},${centroid.lng}`);
  url.searchParams.set("maptype", "roadmap");
  if (variant === "wide") {
    url.searchParams.set("zoom", String(zoom));
    url.searchParams.set("size", `${AREA_MAP_WIDTH}x${AREA_MAP_HEIGHT}`);
    url.searchParams.set("scale", "1");
  } else {
    // One zoom level out at 2x scale, then the central 800x400 pixels are
    // geometrically identical to an 800x400 zoom-11 image, which the client's
    // circle overlay assumes. This keeps every size inside the provider's 640px cap.
    url.searchParams.set("zoom", String(zoom - 1));
    url.searchParams.set("size", "640x320");
    url.searchParams.set("scale", "2");
  }
  // No markers: the image must never point at anything.
  return url.toString();
}

async function fetchStaticMapVariant(centroid: Centroid, variant: "wide" | "cropped", fetcher: typeof fetch, zoom = AREA_MAP_ZOOM): Promise<Buffer | null> {
  const response = await fetcher(staticMapUrl(centroid, variant, zoom), { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 8_000_000) return null;
  const { default: sharp } = await import("sharp");
  const image = sharp(bytes, { limitInputPixels: 20_000_000 });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) return null;
  if (variant === "wide") return meta.width === AREA_MAP_WIDTH && meta.height === AREA_MAP_HEIGHT ? image.webp({ quality: 80 }).toBuffer() : null;
  // Central crop covering (AREA_MAP_WIDTH / 2) x (AREA_MAP_HEIGHT / 2) at the previous zoom level.
  const width = Math.min(meta.width, Math.round(meta.width * (AREA_MAP_WIDTH / 2) / 640));
  const height = Math.min(meta.height, Math.round(meta.height * (AREA_MAP_HEIGHT / 2) / 320));
  return image.extract({ left: Math.floor((meta.width - width) / 2), top: Math.floor((meta.height - height) / 2), width, height }).resize(AREA_MAP_WIDTH, AREA_MAP_HEIGHT).webp({ quality: 80 }).toBuffer();
}

/**
 * Static map bytes for a center: no markers, provider request made server-side
 * only. Kept a day per community and variant; a failure is remembered for ten
 * minutes so repeated requests cannot keep calling the provider.
 */
export async function loadStaticAreaMap(communityId: number, centroid: Centroid, fetcher: typeof fetch = fetch, zoom = AREA_MAP_ZOOM, variant: AreaMapVariant = "gated"): Promise<Buffer | null> {
  const centroidKey = `${centroid.lat.toFixed(6)},${centroid.lng.toFixed(6)}:${zoom}`;
  const cacheKey = `${communityId}:${variant}:${zoom}`;
  const cached = imageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && cached.centroidKey === centroidKey) {
    // Most recently used goes to the back, so the busiest maps stay cached.
    imageCache.delete(cacheKey);
    imageCache.set(cacheKey, cached);
    return cached.bytes;
  }
  const failedUntil = failureCache.get(`${cacheKey}:${centroidKey}`);
  if (failedUntil && failedUntil > Date.now()) return null;
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) return null;
  let bytes: Buffer | null = null;
  if (wideStaticMapsAllowed !== false) {
    bytes = await fetchStaticMapVariant(centroid, "wide", fetcher, zoom).catch(() => null);
    if (bytes) wideStaticMapsAllowed = true;
    else if (wideStaticMapsAllowed === null) wideStaticMapsAllowed = false;
  }
  if (!bytes) bytes = await fetchStaticMapVariant(centroid, "cropped", fetcher, zoom).catch(() => null);
  if (!bytes) {
    if (failureCache.size >= IMAGE_CACHE_LIMIT) failureCache.delete(failureCache.keys().next().value as string);
    failureCache.set(`${cacheKey}:${centroidKey}`, Date.now() + FAILURE_CACHE_MS);
    return null;
  }
  if (imageCache.size >= IMAGE_CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value as string);
  imageCache.set(cacheKey, { bytes, expiresAt: Date.now() + IMAGE_CACHE_MS, centroidKey });
  return bytes;
}

/** Test seam only. */
export function resetAreaMapCache() {
  imageCache.clear();
  failureCache.clear();
  publicMapHits.clear();
  wideStaticMapsAllowed = null;
}

/** Public map requests allowed per visitor IP in ten minutes (a full landing page is far fewer). */
export const PUBLIC_MAP_REQUESTS_PER_WINDOW = 300;
const PUBLIC_MAP_WINDOW_MS = 10 * 60_000;
const publicMapHits = new Map<string, { count: number; resetAt: number }>();

function publicMapAllowed(ip: string, now = Date.now()): boolean {
  if (publicMapHits.size > 10_000) for (const [key, entry] of Array.from(publicMapHits.entries())) if (entry.resetAt <= now) publicMapHits.delete(key);
  const entry = publicMapHits.get(ip);
  if (!entry || entry.resetAt <= now) { publicMapHits.set(ip, { count: 1, resetAt: now + PUBLIC_MAP_WINDOW_MS }); return true; }
  entry.count += 1;
  return entry.count <= PUBLIC_MAP_REQUESTS_PER_WINDOW;
}

/**
 * GET /deals/mine/maps/:communityId(.webp) behind the live-session check, and
 * GET /deals/maps/:communityId(.webp) for a community shown on the landing
 * page (no session, rate-limited per IP, no cookies set). The response is image
 * bytes only; a missing session, community or centroid yields an empty status
 * with no hint about what exists.
 */
export async function dealsMapImageHandler(req: Request, res: Response, variant: AreaMapVariant = "gated") {
  if (variant === "gated") {
    const session = await isLiveDealSession(req);
    if (!session) return res.status(401).end();
  } else if (!publicMapAllowed(req.ip || req.socket?.remoteAddress || "unknown")) {
    return res.status(429).end();
  }
  const communityId = mapCommunityIdFromPath(String(req.params.communityId ?? ""));
  if (!communityId) return res.status(404).end();
  const db = await getDb();
  if (!db) return res.status(503).end();
  const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, communityId)).limit(1))[0];
  if (!community || !community.active || community.paused) return res.status(404).end();
  // The public map exists only for a community the landing page shows (its label passed the residue check).
  if (variant === "public" && !publicNoPrivateNames({ label: community.publicLabel, area: community.areaLabel }, communityScrubConfig(community))) return res.status(404).end();
  const geometry = areaMapGeometry(community, variant, areaMapRadius(await getDealSettings(), variant));
  if (!geometry) return res.status(404).end();
  const bytes = await loadStaticAreaMap(communityId, geometry.center, fetch, geometry.zoom, variant);
  if (!bytes) return res.status(404).end();
  // The landing card's map carries nothing private, so browsers may keep it for an hour.
  res.setHeader("Cache-Control", variant === "public" ? "public, max-age=3600" : "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "same-origin");
  res.type("image/webp").send(bytes);
}
