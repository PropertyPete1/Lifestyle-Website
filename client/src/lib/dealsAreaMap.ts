/**
 * AREA MAP geometry shared by the gated page and its tests.
 *
 * The server prepares `areaMap` from the community's ZIP centroid, never from
 * the community itself, and serves the static image through a same-origin,
 * session-checked route. The image is always rendered at the same viewport as
 * this overlay (800 x 400 CSS px at `zoom`, scale 1), so the shaded circle can
 * be drawn client-side from the radius alone: no pin, no provider request and
 * no coordinate ever leaves the page.
 */
export type DealsAreaMap = { lat: number; lng: number; radiusMiles: number; zoom: number; imageUrl: string; attribution: string };

export const AREA_MAP_IMAGE_WIDTH = 800;
export const AREA_MAP_IMAGE_HEIGHT = 400;
const METRES_PER_MILE = 1609.344;
/** Web Mercator ground resolution at the equator for 256 px tiles at zoom 0. */
const EQUATOR_METRES_PER_PIXEL = 156543.03392;

export function validDealsAreaMap(value: unknown): value is DealsAreaMap {
  if (!value || typeof value !== "object") return false;
  const map = value as DealsAreaMap;
  return Number.isFinite(map.lat) && Math.abs(map.lat) <= 85 && Number.isFinite(map.lng) && Math.abs(map.lng) <= 180
    && Number.isFinite(map.radiusMiles) && map.radiusMiles > 0 && map.radiusMiles <= 20
    && Number.isInteger(map.zoom) && map.zoom >= 0 && map.zoom <= 18
    && typeof map.imageUrl === "string" && /^\/deals\/mine\/maps\/[A-Za-z0-9_-]+\.(?:png|webp)$/.test(map.imageUrl)
    && typeof map.attribution === "string" && map.attribution.trim().length > 0;
}

/** Metres covered by one image pixel at this latitude and zoom (Web Mercator, scale 1). */
export function mercatorMetresPerPixel(lat: number, zoom: number): number {
  return EQUATOR_METRES_PER_PIXEL * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
}

/** Radius of the shaded circle in image pixels for an 800 x 400 static map at the server's zoom. */
export function areaMapRadiusPixels(map: Pick<DealsAreaMap, "lat" | "zoom" | "radiusMiles">): number {
  return map.radiusMiles * METRES_PER_MILE / mercatorMetresPerPixel(map.lat, map.zoom);
}

/** Only drive-time chips are shown; every chip says "about" and carries a minute figure. */
export function driveTimeChipLabels(chips: unknown): string[] {
  if (!Array.isArray(chips)) return [];
  return chips
    .filter((chip): chip is string => typeof chip === "string" && /\b\d+\s*(?:min|minutes)\b/i.test(chip))
    .map((chip) => /\babout\b/i.test(chip) ? chip : `About ${chip}`);
}
