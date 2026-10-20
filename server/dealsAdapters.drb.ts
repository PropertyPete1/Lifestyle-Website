import { DRB_HOST, type PrivatePlanOrHome } from "./dealsAdapters";
import { NdgAdapter, ndgApiUrl, ndgListingEntries, parseNdgCommunity, parseNdgHomes, parseNdgOffer, parseNdgPlans, type NdgBrand, type NdgCommunityRecord } from "./dealsAdapters.ndg";

/**
 * DRB HOMES: an NDG-platform site (see dealsAdapters.ndg.ts). The San Antonio
 * region's communities live at
 * `/drbhomes/find-your-home/communities/texas/san-antonio/<slug>`
 * (`/overview`, `/home-plans`, `/quick-move-in-homes` are the same page), and
 * the API resolves a slug with
 * `public/community/state/region/by-name?state=texas&region=san-antonio&name=<slug>`.
 * The slug is the community's name in lower case with punctuation dropped
 * and each space a hyphen ("Meyer Ranch – Premier" is `meyer-ranch--premier`,
 * verified against the API for every community in October 2026). Photos sit
 * on `assets.drbhomes.com`. The sister brand "DRB Elevate" (55+) shares the
 * API; none of its communities is in the region.
 *
 * Page shapes (October 2026):
 * - market:    /drbhomes/find-your-home/communities/texas/san-antonio
 * - community: /drbhomes/find-your-home/communities/texas/san-antonio/<slug>[/overview|/home-plans|/quick-move-in-homes]
 */
export const DRB_API_HOST = "api.drbhomes.com";
export const DRB_ASSET_HOST = "assets.drbhomes.com";
export const DRB_REGION = { state: "texas", region: "san-antonio", searchValue: "San Antonio" };
const COMMUNITY_PATH = /^\/drbhomes\/find-your-home\/communities\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/(?:overview|home-plans|quick-move-in-homes|homesites))?\/?$/i;

/** The site's own URL slug for a community, plan or street: lower case, punctuation dropped, each space a hyphen. */
export function drbSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s/g, "-");
}

/** The state, region and community slug of a community page URL; null for any other page. */
export function drbCommunityPath(url: URL): { state: string; region: string; slug: string } | null {
  const match = COMMUNITY_PATH.exec(url.pathname);
  return match ? { state: match[1]!.toLowerCase(), region: match[2]!.toLowerCase(), slug: match[3]!.toLowerCase() } : null;
}

export const drbCommunityPageUrl = (slug: string) => `https://${DRB_HOST}/drbhomes/find-your-home/communities/${DRB_REGION.state}/${DRB_REGION.region}/${slug}`;

export const DRB_BRAND: NdgBrand = {
  builder: "DRB Homes",
  host: DRB_HOST,
  apiHost: DRB_API_HOST,
  assetHost: DRB_ASSET_HOST,
  listingUrl: () => ndgApiUrl(DRB_BRAND, `public-drb/community?searchField=communityRegion&searchValue=${encodeURIComponent(DRB_REGION.searchValue)}&state=${DRB_REGION.state}&region=${DRB_REGION.region}&page=1&limit=1000`),
  parsePath: (url) => {
    const path = drbCommunityPath(url);
    return path ? {
      lookup: `public/community/state/region/by-name?state=${encodeURIComponent(path.state)}&region=${encodeURIComponent(path.region)}&name=${encodeURIComponent(path.slug)}`,
      page: `${url.origin}/drbhomes/find-your-home/communities/${path.state}/${path.region}/${path.slug}`,
      slug: path.slug,
    } : null;
  },
  pageUrlFor: (row) => typeof row.name === "string" && row.name.trim() ? drbCommunityPageUrl(drbSlug(row.name)) : null,
  slug: drbSlug,
};

export const drbApiUrl = (path: string) => ndgApiUrl(DRB_BRAND, path);
export const drbListingUrl = () => DRB_BRAND.listingUrl();
export const drbListingEntries = (body: string, host: string): Array<{ url: string; record: NdgCommunityRecord | null }> | null => ndgListingEntries(DRB_BRAND, body, host);
export const parseDrbCommunity = parseNdgCommunity;
export const parseDrbHomes = (body: string, communityId: number, communityPage: string, record: NdgCommunityRecord | null, now: Date) => parseNdgHomes(DRB_BRAND, body, communityId, communityPage, record, now);
export const parseDrbPlans = (body: string, communityPage: string): PrivatePlanOrHome[] | null => parseNdgPlans(DRB_BRAND, body, communityPage);
export const parseDrbOffer = parseNdgOffer;
export { ndgStatus as drbStatus } from "./dealsAdapters.ndg";

export class DrbHomesAdapter extends NdgAdapter {
  constructor() { super(DRB_BRAND); }
}
