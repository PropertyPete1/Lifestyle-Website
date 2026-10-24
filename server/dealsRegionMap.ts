import type { Request, Response } from "express";
import { ENV } from "./_core/env";

/**
 * REGION MAP: the landing page's one map of the whole market, with a marker per community. The image is a plain
 * static map (no markers, fetched server-side and cached), and the page places its own markers on it from fractions
 * this module computes. A landing marker stands at the community's coarse public grid cell (the same point its public
 * area map already shows), never at the community or its ZIP code.
 */
export type RegionPin = { x: number; y: number };
type Centroid = { lat: number; lng: number };

/** San Antonio and the towns around it (New Braunfels, Seguin, Boerne, Castroville, Floresville) in one picture. */
export const SAN_ANTONIO_REGION = { center: { lat: 29.44, lng: -98.45 }, zoom: 9, size: 640 } as const;
export const REGION_MAP_ATTRIBUTION = "Map data and imagery from Google. Markers show the general area only.";
/** Markers this close to the edge are left off (the marker would hang outside the picture). */
const EDGE = 0.02;

function worldPixels(point: Centroid, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin((point.lat * Math.PI) / 180), -0.9999), 0.9999);
  return { x: ((point.lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

/** Where a point falls on the region picture, as fractions of its width and height; null when it is off the picture. */
export function regionPin(point: Centroid, region: { center: Centroid; zoom: number; size: number } = SAN_ANTONIO_REGION): RegionPin | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const at = worldPixels(point, region.zoom);
  const middle = worldPixels(region.center, region.zoom);
  const x = 0.5 + (at.x - middle.x) / region.size;
  const y = 0.5 + (at.y - middle.y) / region.size;
  if (x < EDGE || x > 1 - EDGE || y < EDGE || y > 1 - EDGE) return null;
  // Three decimals is about a quarter mile at this zoom: the grid cell already moved the point by miles.
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

const DAY_MS = 24 * 60 * 60_000;
const FAILURE_MS = 10 * 60_000;
let cached: { bytes: Buffer; expiresAt: number } | null = null;
let failedUntil = 0;
let loading: Promise<Buffer | null> | null = null;

function regionMapUrl(): string {
  const base = ENV.forgeApiUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/v1/maps/proxy/maps/api/staticmap`);
  url.searchParams.set("key", ENV.forgeApiKey);
  url.searchParams.set("center", `${SAN_ANTONIO_REGION.center.lat},${SAN_ANTONIO_REGION.center.lng}`);
  url.searchParams.set("zoom", String(SAN_ANTONIO_REGION.zoom));
  url.searchParams.set("size", `${SAN_ANTONIO_REGION.size}x${SAN_ANTONIO_REGION.size}`);
  url.searchParams.set("scale", "2");
  url.searchParams.set("maptype", "roadmap");
  // Quiet the map so the page's own markers carry it: no businesses or transit icons.
  url.searchParams.append("style", "feature:poi|visibility:off");
  url.searchParams.append("style", "feature:transit|visibility:off");
  return url.toString();
}

/** The region picture: fetched once a day server-side (never by the visitor's browser), a failure retried after ten minutes. */
export async function loadRegionMap(fetcher: typeof fetch = fetch): Promise<Buffer | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.bytes;
  if (failedUntil > Date.now() || !ENV.forgeApiUrl || !ENV.forgeApiKey) return null;
  loading ??= (async () => {
    try {
      const response = await fetcher(regionMapUrl(), { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) throw new Error("not an image");
      const raw = Buffer.from(await response.arrayBuffer());
      if (!raw.length || raw.length > 8_000_000) throw new Error("bad size");
      const { default: sharp } = await import("sharp");
      const bytes = await sharp(raw, { limitInputPixels: 20_000_000 }).webp({ quality: 80 }).toBuffer();
      cached = { bytes, expiresAt: Date.now() + DAY_MS };
      return bytes;
    } catch {
      failedUntil = Date.now() + FAILURE_MS;
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export async function regionMapHandler(_req: Request, res: Response) {
  const bytes = await loadRegionMap();
  if (!bytes) return res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type("image/webp").send(bytes);
}

/** Test seam only. */
export function resetRegionMap() {
  cached = null;
  failedUntil = 0;
  loading = null;
}
