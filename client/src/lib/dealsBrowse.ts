import { BIG_LOT_ACRES, homeLotAcres, lotAcres, redHotDeal } from "@shared/dealsFeatured";

/**
 * Browsing every community in the area: filters shared by the landing page and
 * the private list, and the page size that keeps a phone fast. Pure functions,
 * so the rules are tested without rendering.
 */
export type BrowseFilters = {
  /** One area label ("Northwest San Antonio", "New Braunfels"), or "" for all. */
  area: string;
  /** At least this price (a home at exactly this price matches). */
  minPrice: number | null;
  maxPrice: number | null;
  minBeds: number | null;
  minBaths: number | null;
  minSqft: number | null;
  /** Garage spaces, at least. */
  minGarage: number | null;
  /** 1: single-story homes only; 2: two stories or more. */
  stories: 1 | 2 | null;
  moveInReady: boolean;
  /** Homes still to be built (pick your plan). */
  toBeBuilt: boolean;
  builderRate: boolean;
  bigLots: boolean;
  /** Homes with a real price drop (see redHotDeal). */
  redHot: boolean;
  /** Private list only: just the homes this buyer has saved. */
  savedOnly: boolean;
  /** Team only (Peter and his agents): one builder, or "" for all. Buyers never see builder names. */
  builder: string;
};

export const EMPTY_FILTERS: BrowseFilters = { area: "", minPrice: null, maxPrice: null, minBeds: null, minBaths: null, minSqft: null, minGarage: null, stories: null, moveInReady: false, toBeBuilt: false, builderRate: false, bigLots: false, redHot: false, savedOnly: false, builder: "" };
export const PRICE_CAPS = [200_000, 300_000, 400_000, 500_000, 600_000, 750_000, 1_000_000] as const;
export const PRICE_FLOORS = [200_000, 250_000, 300_000, 350_000, 400_000, 500_000, 600_000, 750_000] as const;
export const BED_MINIMUMS = [2, 3, 4, 5] as const;
export const BATH_MINIMUMS = [2, 2.5, 3, 4] as const;
export const SQFT_MINIMUMS = [1_200, 1_500, 1_800, 2_000, 2_500, 3_000, 3_500] as const;
export const GARAGE_MINIMUMS = [2, 3] as const;
/** Communities shown before "Show more". */
export const BROWSE_PAGE = 12;
/** A short list opens every community; a long one opens only the buyer's own. */
export const OPEN_ALL_UP_TO = 3;

/** The filters tucked behind "More filters" (counted on that button). */
export function moreFilterCount(filters: BrowseFilters): number {
  return [filters.minBaths, filters.minSqft, filters.minGarage, filters.stories, filters.toBeBuilt, filters.bigLots, filters.builderRate].filter(Boolean).length;
}

export function activeFilterCount(filters: BrowseFilters): number {
  return [filters.area, filters.minPrice, filters.maxPrice, filters.minBeds, filters.minBaths, filters.minSqft, filters.minGarage, filters.stories, filters.moveInReady, filters.toBeBuilt, filters.builderRate, filters.bigLots, filters.redHot, filters.savedOnly, filters.builder].filter(Boolean).length;
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

/** A number from a builder's text: "2.5" -> 2.5, "3-4" -> 4 (the most the plan offers), "2 car" -> 2. */
export function numberFrom(value: string | number | null | undefined): number | null {
  return bedsFrom(value);
}

/** The facts the home filters read, whatever list the home comes from. */
export type FilterableHome = {
  kind: string;
  price?: number | null;
  previousPrice?: number | null;
  beds?: string | number | null;
  baths?: string | number | null;
  sqft?: number | null;
  garage?: string | number | null;
  stories?: number | null;
  lotSize?: string | null;
};

/**
 * One home against the home filters. A filter on a fact the builder does not publish (no garage or stories listed)
 * leaves that home out: a buyer who asked for one story should not be shown a home that might have two.
 */
export function homePasses(home: FilterableHome, filters: BrowseFilters, communityLot: number | null = null): boolean {
  // "Under $200K" means below the cap (a $200,000 home is not under $200K); "$300K+" includes $300,000.
  if (filters.maxPrice !== null && !(home.price && home.price < filters.maxPrice)) return false;
  if (filters.minPrice !== null && !(home.price && home.price >= filters.minPrice)) return false;
  if (filters.minBeds !== null && (bedsFrom(home.beds) ?? 0) < filters.minBeds) return false;
  if (filters.minBaths !== null && (numberFrom(home.baths) ?? 0) < filters.minBaths) return false;
  if (filters.minSqft !== null && (home.sqft ?? 0) < filters.minSqft) return false;
  if (filters.minGarage !== null && (numberFrom(home.garage) ?? 0) < filters.minGarage) return false;
  if (filters.stories === 1 && home.stories !== 1) return false;
  if (filters.stories === 2 && !(home.stories && home.stories >= 2)) return false;
  // Move-in ready and to be built together mean either kind.
  if (filters.moveInReady !== filters.toBeBuilt && home.kind !== (filters.moveInReady ? "quick_move_in" : "to_be_built")) return false;
  if (filters.bigLots && (homeLotAcres(home.lotSize, communityLot) ?? 0) < BIG_LOT_ACRES) return false;
  if (filters.redHot && !redHotDeal(home.price, home.previousPrice)) return false;
  return true;
}

/** The landing card's homes, compact: [price, beds, baths, sqft, garage, kind (0 move-in ready, 1 to be built), stories, previous price]. */
export type LandingHomeFacts = [number | null, number | null, number | null, number | null, number | null, 0 | 1, number | null, number | null];

export function landingHome(facts: LandingHomeFacts): FilterableHome {
  const [price, beds, baths, sqft, garage, kind, stories, previousPrice] = facts;
  return { price, beds, baths, sqft, garage, kind: kind === 1 ? "to_be_built" : "quick_move_in", stories, previousPrice };
}

export type LandingBrowseCommunity = {
  area: string;
  label: string;
  fromPrice?: number | null;
  homesAvailable: number;
  incentive?: { headlineRate?: string | null } | null;
  /** Homes in the community that are Red Hot Deals. */
  redHotDeals?: number;
  /** The homes the community card stands for (see LandingHomeFacts); older pages have none. */
  homeFacts?: LandingHomeFacts[] | null;
};

/** The builders on a team list, most communities first (the builder filter); empty when the list carries no names. */
export function builderChoices(items: ReadonlyArray<{ details?: { builderName?: string | null } | null }>): Array<{ builder: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) { const name = item.details?.builderName?.trim(); if (name) counts.set(name, (counts.get(name) ?? 0) + 1); }
  return Array.from(counts, ([builder, count]) => ({ builder, count })).sort((a, b) => b.count - a.count || a.builder.localeCompare(b.builder));
}

/** True when some home on the list has its stories from the builder (the stories filter shows only then). */
export function storiesKnown(items: ReadonlyArray<{ homeFacts?: LandingHomeFacts[] | null; homes?: ReadonlyArray<{ stories?: number | null }> }>): boolean {
  return items.some((item) => item.homeFacts?.some((facts) => facts[6] !== null) || item.homes?.some((home) => typeof home.stories === "number"));
}

const LANDING_HOME_FILTERS = (filters: BrowseFilters) => filters.minPrice !== null || filters.maxPrice !== null || filters.minBeds !== null || filters.minBaths !== null || filters.minSqft !== null || filters.minGarage !== null || filters.stories !== null || filters.moveInReady || filters.toBeBuilt || filters.redHot;

/** A landing card matches when it is in the area, has the offer and lot asked for, and has a home that passes the home filters. */
export function landingMatches(community: LandingBrowseCommunity, filters: BrowseFilters): boolean {
  if (filters.area && community.area !== filters.area) return false;
  if (filters.builderRate && !community.incentive?.headlineRate) return false;
  if (filters.bigLots && (lotAcres(community.label) ?? 0) < BIG_LOT_ACRES) return false;
  if (!LANDING_HOME_FILTERS(filters)) return true;
  if (community.homeFacts?.length) {
    const homeOnly = { ...filters, bigLots: false };
    return community.homeFacts.some((facts) => homePasses(landingHome(facts), homeOnly));
  }
  // A page from before the home facts: the card's own figures.
  if (filters.maxPrice !== null && !(community.fromPrice && community.fromPrice < filters.maxPrice)) return false;
  if (filters.moveInReady && !filters.toBeBuilt && community.homesAvailable <= 0) return false;
  if (filters.redHot && !(community.redHotDeals && community.redHotDeals > 0)) return false;
  return true;
}

export type GatedBrowseHome = FilterableHome & { card?: string };
/** "Saved only" applies while the buyer has saved something; with nothing saved it narrows nothing (the toggle is hidden then). */
const savedFilterOn = (filters: BrowseFilters, saved?: ReadonlySet<string>) => filters.savedOnly && Boolean(saved && saved.size > 0);
/** True when any filter narrows the homes inside a community. */
export function homeFiltersOn(filters: BrowseFilters, saved?: ReadonlySet<string>): boolean {
  return LANDING_HOME_FILTERS(filters) || filters.bigLots || savedFilterOn(filters, saved);
}
export type GatedBrowseCommunity<Home extends GatedBrowseHome = GatedBrowseHome> = {
  area: string;
  /** The full view's names (team and agent clients); a buyer's list has none. */
  details?: { builderName?: string | null } | null;
  label: string;
  lotSizes?: string | null;
  incentive?: { headlineRate?: string | null } | null;
  homes: Home[];
};

/** The homes of a community that pass the home filters (price, beds, baths, size, garage, stories, kind, lot, saved). */
export function homesMatching<Home extends GatedBrowseHome>(community: GatedBrowseCommunity<Home>, filters: BrowseFilters, saved?: ReadonlySet<string>): Home[] {
  const savedOnly = savedFilterOn(filters, saved);
  const communityLot = lotAcres(community.lotSizes, { field: true }) ?? lotAcres(community.label);
  return community.homes.filter((home) => homePasses(home, filters, communityLot) && (!savedOnly || Boolean(home.card && saved!.has(home.card))));
}

/** A community stays on the private list when it is in the area, has the offer asked for, and has a home that matches. */
export function gatedCommunityVisible<Home extends GatedBrowseHome>(community: GatedBrowseCommunity<Home>, filters: BrowseFilters, saved?: ReadonlySet<string>): boolean {
  if (filters.area && community.area !== filters.area) return false;
  if (filters.builderRate && !community.incentive?.headlineRate) return false;
  if (filters.builder && community.details?.builderName !== filters.builder) return false;
  return !homeFiltersOn(filters, saved) || homesMatching(community, filters, saved).length > 0;
}

export type DealSelection = { index: number; clearFilters: boolean; pages: number | null };

/**
 * What a Best Deals tap has to change before its home can be scrolled to: the
 * community index (or -1 when the card is not on this list), whether the current
 * filters hide the community or the home itself and must be cleared, and the
 * page to turn to (null when the community is already on the page).
 */
export function dealSelection<Home extends GatedBrowseHome & { card: string }>(
  communities: ReadonlyArray<GatedBrowseCommunity<Home>>, card: string, filters: BrowseFilters, state: { many: boolean; pages: number; visibleIndexes: ReadonlyArray<number> }, saved?: ReadonlySet<string>,
): DealSelection {
  const index = communities.findIndex((community) => community.homes.some((home) => home.card === card));
  if (index < 0) return { index, clearFilters: false, pages: null };
  const target = state.visibleIndexes.indexOf(index);
  const cardShown = target >= 0 && (!homeFiltersOn(filters, saved) || homesMatching(communities[index]!, filters, saved).some((home) => home.card === card));
  if (!cardShown) return { index, clearFilters: true, pages: Math.floor(index / BROWSE_PAGE) + 1 };
  if (state.many && target >= state.pages * BROWSE_PAGE) return { index, clearFilters: false, pages: Math.floor(target / BROWSE_PAGE) + 1 };
  return { index, clearFilters: false, pages: null };
}
