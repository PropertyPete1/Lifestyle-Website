import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { dealCommunities } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { makeRequest, type DistanceMatrixResult, type GeocodingResult } from "./_core/map";
import { getDb } from "./db";
import { getDealSettings, isLiveDealSession } from "./dealsService";

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
export const DEFAULT_DRIVE_DESTINATIONS = ["downtown San Antonio", "Randolph AFB", "Lackland AFB", "The Pearl"];
const IMAGE_CACHE_MS = 6 * 60 * 60_000;
const IMAGE_CACHE_LIMIT = 50;

export type DealsAreaMap = { lat: number; lng: number; radiusMiles: number; zoom: number; imageUrl: string; attribution: string };
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
    for (const key of Array.from(imageCache.keys())) if (Math.floor(key / 100) === communityId) imageCache.delete(key);
    return { ok: true, chips };
  } catch (error) {
    console.warn("[deals-map] geocoding unavailable", error instanceof Error ? error.message : error);
    return { ok: false, reason: "geocoder_unavailable" };
  }
}

/** The only coordinates a buyer response may carry: the stored ZIP centroid. */
/**
 * The private list gets a closer circle (behind the session check); the public
 * landing card a wider one, zoomed out to match. Either way the circle is
 * centered on the ZIP code centroid, never the community.
 */
export function communityAreaMap(row: Pick<typeof dealCommunities.$inferSelect, "id" | "zipCentroidLat" | "zipCentroidLng">, options: { variant?: AreaMapVariant; radiusMiles?: number } = {}): DealsAreaMap | null {
  const lat = finiteCoordinate(row.zipCentroidLat, 85);
  const lng = finiteCoordinate(row.zipCentroidLng, 180);
  if (lat === null || lng === null) return null;
  const variant = options.variant ?? "gated";
  const radiusMiles = options.radiusMiles ?? (variant === "public" ? PUBLIC_AREA_MAP_RADIUS_MILES : AREA_MAP_RADIUS_MILES);
  const imageUrl = variant === "public" ? `/deals/maps/${row.id}.png` : `/deals/mine/maps/${row.id}.png`;
  return { lat, lng, radiusMiles, zoom: zoomForRadius(radiusMiles, lat), imageUrl, attribution: AREA_MAP_ATTRIBUTION };
}

export function mapCommunityIdFromPath(raw: string | undefined): number | null {
  const match = /^(\d{1,9})(?:\.(?:png|webp))?$/.exec(raw ?? "");
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const imageCache = new Map<number, { bytes: Buffer; expiresAt: number; centroidKey: string }>();
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
  if (variant === "wide") return meta.width === AREA_MAP_WIDTH && meta.height === AREA_MAP_HEIGHT ? image.png().toBuffer() : null;
  // Central crop covering (AREA_MAP_WIDTH / 2) x (AREA_MAP_HEIGHT / 2) at the previous zoom level.
  const width = Math.min(meta.width, Math.round(meta.width * (AREA_MAP_WIDTH / 2) / 640));
  const height = Math.min(meta.height, Math.round(meta.height * (AREA_MAP_HEIGHT / 2) / 320));
  return image.extract({ left: Math.floor((meta.width - width) / 2), top: Math.floor((meta.height - height) / 2), width, height }).resize(AREA_MAP_WIDTH, AREA_MAP_HEIGHT).png().toBuffer();
}

/** Static map bytes for a centroid: no markers, provider request made server-side only. */
export async function loadStaticAreaMap(communityId: number, centroid: Centroid, fetcher: typeof fetch = fetch, zoom = AREA_MAP_ZOOM): Promise<Buffer | null> {
  const centroidKey = `${centroid.lat.toFixed(6)},${centroid.lng.toFixed(6)}:${zoom}`;
  const cacheKey = communityId * 100 + zoom;
  const cached = imageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && cached.centroidKey === centroidKey) return cached.bytes;
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) return null;
  let bytes: Buffer | null = null;
  if (wideStaticMapsAllowed !== false) {
    bytes = await fetchStaticMapVariant(centroid, "wide", fetcher, zoom).catch(() => null);
    if (bytes) wideStaticMapsAllowed = true;
    else if (wideStaticMapsAllowed === null) wideStaticMapsAllowed = false;
  }
  if (!bytes) bytes = await fetchStaticMapVariant(centroid, "cropped", fetcher, zoom).catch(() => null);
  if (!bytes) return null;
  if (imageCache.size >= IMAGE_CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value as number);
  imageCache.set(cacheKey, { bytes, expiresAt: Date.now() + IMAGE_CACHE_MS, centroidKey });
  return bytes;
}

/** Test seam only. */
export function resetAreaMapCache() {
  imageCache.clear();
  wideStaticMapsAllowed = null;
}

/**
 * GET /deals/mine/maps/:communityId(.png) behind the live-session check. The
 * response is image bytes only, served no-store; a missing session, community,
 * or centroid yields an empty status with no hint about what exists.
 */
export async function dealsMapImageHandler(req: Request, res: Response, variant: AreaMapVariant = "gated") {
  if (variant === "gated") {
    const session = await isLiveDealSession(req);
    if (!session) return res.status(401).end();
  }
  const communityId = mapCommunityIdFromPath(String(req.params.communityId ?? ""));
  if (!communityId) return res.status(404).end();
  const db = await getDb();
  if (!db) return res.status(503).end();
  const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, communityId)).limit(1))[0];
  if (!community || !community.active || community.paused) return res.status(404).end();
  const map = communityAreaMap(community, { variant, radiusMiles: areaMapRadius(await getDealSettings(), variant) });
  if (!map) return res.status(404).end();
  const bytes = await loadStaticAreaMap(communityId, { lat: map.lat, lng: map.lng }, fetch, map.zoom);
  if (!bytes) return res.status(404).end();
  // The public card's wide map carries nothing private, so browsers may keep it for an hour.
  res.setHeader("Cache-Control", variant === "public" ? "public, max-age=3600" : "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "same-origin");
  res.type("image/png").send(bytes);
}
