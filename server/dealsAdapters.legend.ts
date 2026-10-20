import { LEGEND_HOST } from "./dealsAdapters";
import { NdgAdapter, ndgApiUrl, ndgListingEntries, type NdgBrand, type NdgCommunityRecord } from "./dealsAdapters.ndg";

/**
 * LEGEND HOMES: an NDG-platform site (see dealsAdapters.ndg.ts), the same
 * platform as DRB Homes. The San Antonio division's communities live at
 * `/communities/san-antonio/<region>/<county>/<city>/<slug>` (region, county
 * and city are the API row's `regions[0].label`, `address.countyName` and
 * `address.city` as slugs: "New Braunfels/Seguin" is `new-braunfels-seguin`,
 * "Saint Hedwig" `saint-hedwig`), and the API resolves a page with
 * `public-epcon/community/state/region/county/city/by-name-v2?state=texas&region=…&county=…&city=…&name=…`
 * (HTTP 400 otherwise). Both verified against the sitemap and the API for
 * all 11 communities in October 2026. The division list is
 * `public-epcon/community/for-legend?limit=1000&division=san-antonio`. Photos
 * sit on `assets.livelegendhomes.com`. Legend's "Open Door Deal" offers come
 * from `offers-v2` as banners whose `title` is a back-office name
 * ("Open Door Deal_InPage"); the public copy is `content.titleOne`/`copyOne`.
 *
 * Page shapes (October 2026):
 * - market:    /communities/san-antonio
 * - community: /communities/san-antonio/<region>/<county>/<city>/<slug>
 */
export const LEGEND_API_HOST = "api.livelegendhomes.com";
export const LEGEND_ASSET_HOST = "assets.livelegendhomes.com";
export const LEGEND_DIVISION = "san-antonio";
const COMMUNITY_PATH = /^\/communities\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i;

/** The site's own URL slug: lower case, punctuation dropped, spaces and slashes hyphens ("New Braunfels/Seguin" is "new-braunfels-seguin"). */
export function legendSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s/-]/g, "").replace(/[\s/]+/g, "-");
}

/** The division, region, county, city and community slug of a community page URL; null for any other page. */
export function legendCommunityPath(url: URL): { division: string; region: string; county: string; city: string; slug: string } | null {
  const match = COMMUNITY_PATH.exec(url.pathname);
  return match ? { division: match[1]!.toLowerCase(), region: match[2]!.toLowerCase(), county: match[3]!.toLowerCase(), city: match[4]!.toLowerCase(), slug: match[5]!.toLowerCase() } : null;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

/** A listing row's page: the division, then the row's region, county, city and name as slugs; null when any is missing. */
export function legendPageUrlFor(row: Json): string | null {
  const region = text(obj((Array.isArray(row.regions) ? row.regions : [])[0])?.label);
  const address = obj(row.address);
  const county = text(address?.countyName);
  const city = text(address?.city);
  const name = text(row.name);
  if (!region || !county || !city || !name) return null;
  return `https://${LEGEND_HOST}/communities/${LEGEND_DIVISION}/${legendSlug(region)}/${legendSlug(county)}/${legendSlug(city)}/${legendSlug(name)}`;
}

export const LEGEND_BRAND: NdgBrand = {
  builder: "Legend Homes",
  host: LEGEND_HOST,
  apiHost: LEGEND_API_HOST,
  assetHost: LEGEND_ASSET_HOST,
  listingUrl: () => ndgApiUrl(LEGEND_BRAND, `public-epcon/community/for-legend?limit=1000&division=${LEGEND_DIVISION}&barebones=false`),
  parsePath: (url) => {
    const path = legendCommunityPath(url);
    return path ? {
      lookup: `public-epcon/community/state/region/county/city/by-name-v2?state=texas&region=${encodeURIComponent(path.region)}&county=${encodeURIComponent(path.county)}&city=${encodeURIComponent(path.city)}&name=${encodeURIComponent(path.slug)}`,
      page: `${url.origin}/communities/${path.division}/${path.region}/${path.county}/${path.city}/${path.slug}`,
      slug: path.slug,
    } : null;
  },
  pageUrlFor: legendPageUrlFor,
  slug: legendSlug,
};

export const legendApiUrl = (path: string) => ndgApiUrl(LEGEND_BRAND, path);
export const legendListingUrl = () => LEGEND_BRAND.listingUrl();
export const legendListingEntries = (body: string, host: string): Array<{ url: string; record: NdgCommunityRecord | null }> | null => ndgListingEntries(LEGEND_BRAND, body, host);

export class LegendHomesAdapter extends NdgAdapter {
  constructor() { super(LEGEND_BRAND); }
}
