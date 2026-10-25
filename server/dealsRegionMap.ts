import type { Request, Response } from "express";
import { ENV } from "./_core/env";

/**
 * REGION MAP: the landing page's one map of the whole market, with a marker per community. The image is a plain
 * static map (no markers, fetched server-side and cached), and the page places its own markers on it from fractions
 * this module computes. A landing marker stands at the community's coarse public grid cell (the same point its public
 * area map already shows), never at the community or its ZIP code.
 *
 * October 24, 2026 (Peter: "make sure the map is scrollable so we can scroll up towards Austin"): the picture is the
 * whole market, San Antonio and its towns (Castroville, Mico, Hondo, Pleasanton, Floresville, Seguin), New Braunfels,
 * San Marcos, Austin and Georgetown, as a 3x3 mosaic of static maps at zoom 10 stitched server-side. The page drags
 * and zooms it and opens on San Antonio. Width and height are world pixels at that zoom; rows overlap so only the
 * bottom row keeps Google's logo and copyright.
 */
export type RegionPin = { x: number; y: number };
type Centroid = { lat: number; lng: number };

export const MOSAIC_COLUMNS = 3;
export const MOSAIC_ROWS = 3;
export const MOSAIC_TILE = 640;
/** Each tile's bottom band (logo and copyright) is covered by the next row, except the last row's. */
export const MOSAIC_ROW_STEP = 600;
export const SAN_ANTONIO_REGION = {
  center: { lat: 29.8, lng: -98.37 },
  zoom: 10,
  width: MOSAIC_COLUMNS * MOSAIC_TILE,
  height: (MOSAIC_ROWS - 1) * MOSAIC_ROW_STEP + MOSAIC_TILE,
  /** Where the page opens: San Antonio, showing about this many world pixels across (the old single picture's scale). */
  home: { lat: 29.47, lng: -98.42, span: 1180 },
} as const;
type Region = { center: Centroid; zoom: number; width: number; height: number };
export const REGION_MAP_ATTRIBUTION = "Map data and imagery from Google. Markers show the general area only.";
/** Markers this close to the edge are left off (the marker would hang outside the picture). */
const EDGE = 0.01;

function worldPixels(point: Centroid, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin((point.lat * Math.PI) / 180), -0.9999), 0.9999);
  return { x: ((point.lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

function fromWorldPixels(x: number, y: number, zoom: number): Centroid {
  const scale = 256 * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng };
}

/** Where a point falls on the region picture, as fractions of its width and height; null when it is off the picture. */
export function regionPin(point: Centroid, region: Region = SAN_ANTONIO_REGION): RegionPin | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const at = worldPixels(point, region.zoom);
  const middle = worldPixels(region.center, region.zoom);
  const x = 0.5 + (at.x - middle.x) / region.width;
  const y = 0.5 + (at.y - middle.y) / region.height;
  if (x < EDGE || x > 1 - EDGE || y < EDGE || y > 1 - EDGE) return null;
  // Four decimals is a few hundred feet on this picture: the grid cell already moved the point by miles.
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
}

/** The landing card's image is centered on a coarse grid cell, never on the ZIP itself: a cell is about 4 miles. */
export const PUBLIC_GRID_MILES = 4;
/** The coarse public grid cell's size in miles for a given public circle radius (see publicMapCenter in dealsMap). */
export function publicCellMiles(radiusMiles: number): number {
  return Math.min(PUBLIC_GRID_MILES, radiusMiles * 0.6);
}

/**
 * Communities in one coarse grid cell share its centre, so dozens stood on one spot and no zoom could pull them apart
 * (Peter, Oct 25: "it's missing communities on the map"; 430 communities sat on 52 points). Each stack spreads out
 * around its cell's centre on a sunflower pattern ordered by the communities' opaque keys, out to about one cell (4
 * miles): the spot is arbitrary and says nothing finer about where a community is than the cell already did.
 */
export function spreadStackedPins<T extends { key: string; pin: RegionPin | null }>(items: T[], cellMiles: number, region: Region = SAN_ANTONIO_REGION): T[] {
  const origin = { lat: 29.4241, lng: -98.4936 };
  const base = regionPin(origin, region);
  const east = regionPin({ lat: origin.lat, lng: origin.lng + cellMiles / (69.172 * Math.cos((origin.lat * Math.PI) / 180)) }, region);
  const south = regionPin({ lat: origin.lat - cellMiles / 69.0, lng: origin.lng }, region);
  if (!base || !east || !south) return items;
  const cellX = east.x - base.x;
  const cellY = south.y - base.y;
  const stacks = new Map<string, T[]>();
  for (const item of items) if (item.pin) {
    const at = `${item.pin.x}:${item.pin.y}`;
    stacks.set(at, [...(stacks.get(at) ?? []), item]);
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spread = new Map<T, RegionPin>();
  for (const stack of Array.from(stacks.values())) {
    if (stack.length < 2) continue;
    const ordered = [...stack].sort((a, b) => a.key.localeCompare(b.key));
    ordered.forEach((item, index) => {
      // Out to 90% of a cell from its centre, so a stack of dozens separates when the map is zoomed in.
      const radius = 0.9 * Math.sqrt((index + 0.5) / ordered.length);
      const angle = index * golden;
      spread.set(item, { x: Math.round((item.pin!.x + radius * Math.cos(angle) * cellX) * 10000) / 10000, y: Math.round((item.pin!.y + radius * Math.sin(angle) * cellY) * 10000) / 10000 });
    });
  }
  return items.map((item) => spread.has(item) ? { ...item, pin: spread.get(item)! } : item);
}

/** The page's opening view: the home point as fractions of the picture, and the span to show as a fraction of its width. */
export function regionHomeView(region: Region & { home: { lat: number; lng: number; span: number } } = SAN_ANTONIO_REGION): { x: number; y: number; span: number; aspect: number } {
  const at = worldPixels(region.home, region.zoom);
  const middle = worldPixels(region.center, region.zoom);
  return { x: 0.5 + (at.x - middle.x) / region.width, y: 0.5 + (at.y - middle.y) / region.height, span: region.home.span / region.width, aspect: region.width / region.height };
}

/** Each tile's centre, row by row: tiles are MOSAIC_TILE apart across and MOSAIC_ROW_STEP apart down, around the region's centre. */
export function mosaicTileCenters(region: Region = SAN_ANTONIO_REGION): Centroid[] {
  const middle = worldPixels(region.center, region.zoom);
  const left = middle.x - region.width / 2;
  const top = middle.y - region.height / 2;
  const out: Centroid[] = [];
  for (let row = 0; row < MOSAIC_ROWS; row++) {
    for (let column = 0; column < MOSAIC_COLUMNS; column++) out.push(fromWorldPixels(left + column * MOSAIC_TILE + MOSAIC_TILE / 2, top + row * MOSAIC_ROW_STEP + MOSAIC_TILE / 2, region.zoom));
  }
  return out;
}

const DAY_MS = 24 * 60 * 60_000;
const FAILURE_MS = 10 * 60_000;
let cached: { bytes: Buffer; expiresAt: number } | null = null;
let failedUntil = 0;
let loading: Promise<Buffer | null> | null = null;

function regionMapUrl(center: Centroid): string {
  const base = ENV.forgeApiUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/v1/maps/proxy/maps/api/staticmap`);
  url.searchParams.set("key", ENV.forgeApiKey);
  url.searchParams.set("center", `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`);
  url.searchParams.set("zoom", String(SAN_ANTONIO_REGION.zoom));
  url.searchParams.set("size", `${MOSAIC_TILE}x${MOSAIC_TILE}`);
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
  let urls: string[];
  try { urls = mosaicTileCenters().map(regionMapUrl); } catch { failedUntil = Date.now() + FAILURE_MS; return null; }
  loading ??= (async () => {
    try {
      const tiles = await Promise.all(urls.map(async (url) => {
        const response = await fetcher(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000) });
        if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) throw new Error("not an image");
        const raw = Buffer.from(await response.arrayBuffer());
        if (!raw.length || raw.length > 8_000_000) throw new Error("bad size");
        return raw;
      }));
      const { default: sharp } = await import("sharp");
      // Tiles come at scale 2 (1280 px for 640 world px); a later row is drawn over the bottom band of the row above.
      const pixel = 2;
      const composites = await Promise.all(tiles.map(async (raw, index) => ({
        input: await sharp(raw, { limitInputPixels: 20_000_000 }).resize(MOSAIC_TILE * pixel, MOSAIC_TILE * pixel, { fit: "fill" }).png().toBuffer(),
        left: (index % MOSAIC_COLUMNS) * MOSAIC_TILE * pixel,
        top: Math.floor(index / MOSAIC_COLUMNS) * MOSAIC_ROW_STEP * pixel,
      })));
      const width = SAN_ANTONIO_REGION.width * pixel;
      const height = SAN_ANTONIO_REGION.height * pixel;
      const stitched = await sharp({ create: { width, height, channels: 3, background: "#e8eaed" }, limitInputPixels: 40_000_000 }).composite(composites).png().toBuffer();
      // Three quarters of full resolution keeps the file near a megabyte and the streets readable when zoomed in.
      const bytes = await sharp(stitched, { limitInputPixels: 40_000_000 }).resize(Math.round(width * 0.75), Math.round(height * 0.75)).webp({ quality: 72 }).toBuffer();
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
