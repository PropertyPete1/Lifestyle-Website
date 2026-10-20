import { BIG_LOT_ACRES, lotAcres } from "@shared/dealsFeatured";

/**
 * Browsing every community in the area: filters shared by the landing page and
 * the private list, and the page size that keeps a phone fast. Pure functions,
 * so the rules are tested without rendering.
 */
export type BrowseFilters = {
  /** One area label ("Northwest San Antonio", "New Braunfels"), or "" for all. */
  area: string;
  maxPrice: number | null;
  /** Private list only: the public cards carry no bedroom counts. */
  minBeds: number | null;
  moveInReady: boolean;
  builderRate: boolean;
  bigLots: boolean;
};

export const EMPTY_FILTERS: BrowseFilters = { area: "", maxPrice: null, minBeds: null, moveInReady: false, builderRate: false, bigLots: false };
export const PRICE_CAPS = [300_000, 400_000, 500_000, 600_000, 750_000, 1_000_000] as const;
export const BED_MINIMUMS = [2, 3, 4, 5] as const;
/** Communities shown before "Show more". */
export const BROWSE_PAGE = 12;
/** A short list opens every community; a long one opens only the buyer's own. */
export const OPEN_ALL_UP_TO = 3;

export function activeFilterCount(filters: BrowseFilters): number {
  return [filters.area, filters.maxPrice, filters.minBeds, filters.moveInReady, filters.builderRate, filters.bigLots].filter(Boolean).length;
}

/** Areas present in the list, most communities first, for the area picker. */
export function areaChoices(items: ReadonlyArray<{ area: string }>): Array<{ area: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) if (item.area?.trim()) counts.set(item.area, (counts.get(item.area) ?? 0) + 1);
  return Array.from(counts, ([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count || a.area.localeCompare(b.area));
}

/** "$400K", "$1M". */
export function priceCapLabel(cap: number): string {
  return cap >= 1_000_000 ? `$${Number((cap / 1_000_000).toFixed(1))}M` : `$${Math.round(cap / 1_000)}K`;
}

/** Bedrooms as a number for filtering: "4" -> 4, "3-5" -> 5 (the largest option the plan offers). */
export function bedsFrom(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const numbers = Array.from(String(value ?? "").matchAll(/\d+(?:\.\d+)?/g), (match) => Number(match[0])).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) : null;
}

export type LandingBrowseCommunity = {
  area: string;
  label: string;
  fromPrice?: number | null;
  homesAvailable: number;
  incentive?: { headlineRate?: string | null } | null;
};

/** A landing card matches on what it shows: area, starting price, homes ready now, a builder rate, big lots in its label. */
export function landingMatches(community: LandingBrowseCommunity, filters: BrowseFilters): boolean {
  if (filters.area && community.area !== filters.area) return false;
  if (filters.maxPrice !== null && !(community.fromPrice && community.fromPrice <= filters.maxPrice)) return false;
  if (filters.moveInReady && community.homesAvailable <= 0) return false;
  if (filters.builderRate && !community.incentive?.headlineRate) return false;
  if (filters.bigLots && (lotAcres(community.label) ?? 0) < BIG_LOT_ACRES) return false;
  return true;
}

export type GatedBrowseHome = { kind: string; price?: number | null; beds?: string | number | null; lotSize?: string | null };
export type GatedBrowseCommunity<Home extends GatedBrowseHome = GatedBrowseHome> = {
  area: string;
  label: string;
  lotSizes?: string | null;
  incentive?: { headlineRate?: string | null } | null;
  homes: Home[];
};

/** The homes of a community that pass the home filters (price, beds, move-in ready, lot). */
export function homesMatching<Home extends GatedBrowseHome>(community: GatedBrowseCommunity<Home>, filters: BrowseFilters): Home[] {
  const communityLot = lotAcres(community.lotSizes, { field: true }) ?? lotAcres(community.label);
  return community.homes.filter((home) => {
    if (filters.maxPrice !== null && !(home.price && home.price <= filters.maxPrice)) return false;
    if (filters.minBeds !== null && (bedsFrom(home.beds) ?? 0) < filters.minBeds) return false;
    if (filters.moveInReady && home.kind !== "quick_move_in") return false;
    if (filters.bigLots && (lotAcres(home.lotSize, { field: true }) ?? communityLot ?? 0) < BIG_LOT_ACRES) return false;
    return true;
  });
}

/** A community stays on the private list when it is in the area, has the offer asked for, and has a home that matches. */
export function gatedCommunityVisible<Home extends GatedBrowseHome>(community: GatedBrowseCommunity<Home>, filters: BrowseFilters): boolean {
  if (filters.area && community.area !== filters.area) return false;
  if (filters.builderRate && !community.incentive?.headlineRate) return false;
  const homeFilters = filters.maxPrice !== null || filters.minBeds !== null || filters.moveInReady || filters.bigLots;
  return !homeFilters || homesMatching(community, filters).length > 0;
}
