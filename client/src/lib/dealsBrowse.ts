import { BIG_LOT_ACRES, homeLotAcres, lotAcres, redHotDeal } from "@shared/dealsFeatured";
import { areaMarketName } from "@shared/dealsArea";

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
  maxSqft: number | null;
  /** Move in by this month, as months from now (0: ready now, 3: within three months). */
  availableBy: number | null;
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
  /** Oct 26, 2026: homes that arrived this week (newThisWeek). */
  newOnly: boolean;
  /** Private list only: just the homes this buyer has saved. */
  savedOnly: boolean;
  /** Team only (Peter and his agents): one builder, or "" for all. Buyers never see builder names. */
  builder: string;
  /** One school district ("Northside ISD"), or "" for all. */
  schoolDistrict: string;
  /** Oct 26, 2026: the order of the cards and homes; not a filter (never counted, "Clear filters" resets it too). */
  sort: BrowseSort;
  /**
   * Oct 30, 2026 (ChatGPT's New Home Buddy comparison: shop by monthly payment, which only we can offer): the highest
   * estimated monthly payment at the builder's rate. The public page applies it (it knows the payment assumptions);
   * homes with no builder-rate payment never match it.
   */
  maxPayment?: number | null;
};

export type BrowseSort = "recommended" | "price_asc" | "price_desc" | "newest" | "largest" | "payment_asc";
export const BROWSE_SORTS: ReadonlyArray<{ value: BrowseSort; label: string }> = [
  { value: "recommended", label: "Recommended" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "newest", label: "Newest first" },
  { value: "largest", label: "Largest first" },
];
/** Oct 30, 2026: offered where the page can figure payments (the public page); homes without one go last. */
export const PAYMENT_SORT: { value: BrowseSort; label: string } = { value: "payment_asc", label: "Lowest payment" };
export const PAYMENT_CAPS = [1_500, 2_000, 2_500, 3_000, 3_500] as const;

export const EMPTY_FILTERS: BrowseFilters = { area: "", minPrice: null, maxPrice: null, minBeds: null, minBaths: null, minSqft: null, maxSqft: null, availableBy: null, minGarage: null, stories: null, moveInReady: false, toBeBuilt: false, builderRate: false, bigLots: false, redHot: false, newOnly: false, savedOnly: false, builder: "", schoolDistrict: "", sort: "recommended", maxPayment: null };
export const PRICE_CAPS = [200_000, 300_000, 400_000, 500_000, 600_000, 750_000, 1_000_000] as const;
export const PRICE_FLOORS = [200_000, 250_000, 300_000, 350_000, 400_000, 500_000, 600_000, 750_000] as const;
export const BED_MINIMUMS = [2, 3, 4, 5] as const;
export const BATH_MINIMUMS = [2, 2.5, 3, 4] as const;
export const SQFT_MINIMUMS = [1_200, 1_500, 1_800, 2_000, 2_500, 3_000, 3_500] as const;
export const SQFT_MAXIMUMS = [1_500, 1_800, 2_000, 2_500, 3_000, 3_500, 4_000] as const;
/** "Available by": ready now, or within this many months. */
export const AVAILABLE_BY = [0, 1, 3, 6, 12] as const;
export const GARAGE_MINIMUMS = [2, 3] as const;
/** Communities shown before "Show more". */
export const BROWSE_PAGE = 12;
/** A short list opens every community; a long one opens only the buyer's own. */
export const OPEN_ALL_UP_TO = 3;

/** A filter is on when it is not its empty value (null, false or ""); 0 ("ready now") counts. */
const filterOn = (value: unknown) => value !== null && value !== false && value !== undefined && value !== "";

/** The filters tucked behind "More filters" (counted on that button). */
export function moreFilterCount(filters: BrowseFilters): number {
  return [filters.minBaths, filters.minSqft, filters.maxSqft, filters.availableBy, filters.minGarage, filters.stories, filters.toBeBuilt, filters.bigLots, filters.builderRate, filters.schoolDistrict].filter(filterOn).length;
}

export function activeFilterCount(filters: BrowseFilters): number {
  return [filters.area, filters.minPrice, filters.maxPrice, filters.minBeds, filters.minBaths, filters.minSqft, filters.maxSqft, filters.availableBy, filters.minGarage, filters.stories, filters.moveInReady, filters.toBeBuilt, filters.builderRate, filters.bigLots, filters.redHot, filters.newOnly, filters.savedOnly, filters.builder, filters.schoolDistrict, filters.maxPayment ?? null].filter(filterOn).length;
}

/** Areas present in the list, most communities first, for the area picker. */
export function areaChoices(items: ReadonlyArray<{ area: string }>): Array<{ area: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) if (item.area?.trim()) counts.set(item.area, (counts.get(item.area) ?? 0) + 1);
  return Array.from(counts, ([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count || a.area.localeCompare(b.area));
}

/** The area filter's value for a whole market ("every Austin-area community"), never a real area label. */
export const MARKET_AREA_PREFIX = "market:";

/**
 * The area picker grouped by market (Oct 25, 2026: with Austin on the page, 55 mixed towns sorted by count were a hunt):
 * each market a group, "All of the Austin area" first, then the sides of the city, then its towns A to Z. A market
 * with no communities on the list is left out.
 */
export function areaGroups(items: ReadonlyArray<{ area: string }>): Array<{ market: "San Antonio" | "Austin"; total: number; choices: Array<{ area: string; count: number }> }> {
  const all = areaChoices(items);
  return (["San Antonio", "Austin"] as const).map((market) => {
    const choices = all.filter((choice) => areaMarketName(choice.area) === market);
    const side = (area: string) => new RegExp(`\\b${market}\\b|^Greater `, "i").test(area) ? 0 : 1;
    choices.sort((a, b) => side(a.area) - side(b.area) || a.area.localeCompare(b.area));
    return { market, total: choices.reduce((sum, choice) => sum + choice.count, 0), choices };
  }).filter((group) => group.choices.length > 0);
}

/** True when the community is in the picked area, or in the picked market when the whole market was picked. */
export function areaMatches(area: string, picked: string): boolean {
  if (!picked) return true;
  if (picked.startsWith(MARKET_AREA_PREFIX)) return areaMarketName(area) === picked.slice(MARKET_AREA_PREFIX.length);
  return area === picked;
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
  moveInDate?: string | null;
  /** Arrived this week (the server decides; see newThisWeek). */
  isNew?: boolean;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/**
 * A builder's move-in text as months from now: "Available Now" / "Move-in ready" -> 0, "Nov 2026" or
 * "Est. Completion - Nov '26" -> months until that month, "4 - 6 month build" -> 6. Null when it says nothing datable.
 */
export function monthsUntilMoveIn(value: string | null | undefined, now: Date = new Date()): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/\b(now|ready|immediate|complete[d]?)\b/i.test(text) && !/est\.?\s*complet/i.test(text)) return 0;
  const build = /(\d+)\s*(?:-|to)\s*(\d+)\s*month/i.exec(text) ?? /(\d+)\s*month/i.exec(text);
  if (build) return Number(build[2] ?? build[1]);
  const month = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*'?(\d{2}|\d{4})\b/i.exec(text);
  if (!month) return null;
  const year = month[2]!.length === 2 ? 2000 + Number(month[2]) : Number(month[2]);
  const index = MONTHS.indexOf(month[1]!.slice(0, 3).toLowerCase());
  return Math.max(0, (year - now.getFullYear()) * 12 + (index - now.getMonth()));
}

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
  if (filters.maxSqft !== null && !(home.sqft && home.sqft <= filters.maxSqft)) return false;
  if (filters.availableBy !== null) {
    // A move-in-ready home with no date is ready now; a plan to be built with no date is not datable, so it is out.
    const months = monthsUntilMoveIn(home.moveInDate) ?? (home.kind === "quick_move_in" ? 0 : null);
    if (months === null || months > filters.availableBy) return false;
  }
  if (filters.minGarage !== null && (numberFrom(home.garage) ?? 0) < filters.minGarage) return false;
  if (filters.stories === 1 && home.stories !== 1) return false;
  if (filters.stories === 2 && !(home.stories && home.stories >= 2)) return false;
  // Move-in ready and to be built together mean either kind.
  if (filters.moveInReady !== filters.toBeBuilt && home.kind !== (filters.moveInReady ? "quick_move_in" : "to_be_built")) return false;
  if (filters.bigLots && (homeLotAcres(home.lotSize, communityLot) ?? 0) < BIG_LOT_ACRES) return false;
  if (filters.redHot && !redHotDeal(home.price, home.previousPrice)) return false;
  if (filters.newOnly && !home.isNew) return false;
  return true;
}

/** The landing card's homes, compact: [price, beds, baths, sqft, garage, kind (0 move-in ready, 1 to be built), stories, previous price, move-in text]. */
export type LandingHomeFacts = [number | null, number | null, number | null, number | null, number | null, 0 | 1, number | null, number | null, (string | null)?, (0 | 1)?];

export function landingHome(facts: LandingHomeFacts): FilterableHome {
  const [price, beds, baths, sqft, garage, kind, stories, previousPrice, moveInDate, isNew] = facts;
  return { price, beds, baths, sqft, garage, kind: kind === 1 ? "to_be_built" : "quick_move_in", stories, previousPrice, moveInDate: moveInDate ?? null, isNew: isNew === 1 };
}

export type LandingBrowseCommunity = {
  area: string;
  schoolDistrict?: string | null;
  label: string;
  fromPrice?: number | null;
  homesAvailable: number;
  incentive?: { headlineRate?: string | null } | null;
  /** Homes in the community that are Red Hot Deals. */
  redHotDeals?: number;
  /** Homes in the community that arrived this week. */
  newThisWeek?: number;
  /** The homes the community card stands for (see LandingHomeFacts); older pages have none. */
  homeFacts?: LandingHomeFacts[] | null;
};

/** The school districts on the list, most communities first (the district picker). */
export function districtChoices(items: ReadonlyArray<{ schoolDistrict?: string | null }>): Array<{ district: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) { const name = item.schoolDistrict?.trim(); if (name) counts.set(name, (counts.get(name) ?? 0) + 1); }
  return Array.from(counts, ([district, count]) => ({ district, count })).sort((a, b) => b.count - a.count || a.district.localeCompare(b.district));
}

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

const LANDING_HOME_FILTERS = (filters: BrowseFilters) => filters.minPrice !== null || filters.maxPrice !== null || filters.minBeds !== null || filters.minBaths !== null || filters.minSqft !== null || filters.maxSqft !== null || filters.availableBy !== null || filters.minGarage !== null || filters.stories !== null || filters.moveInReady || filters.toBeBuilt || filters.redHot || filters.newOnly;

/** A landing card matches when it is in the area, has the offer and lot asked for, and has a home that passes the home filters. */
export function landingMatches(community: LandingBrowseCommunity, filters: BrowseFilters): boolean {
  if (!areaMatches(community.area, filters.area)) return false;
  if (filters.schoolDistrict && community.schoolDistrict !== filters.schoolDistrict) return false;
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
  if (filters.newOnly && !(community.newThisWeek && community.newThisWeek > 0)) return false;
  return true;
}

const price = (value: number | null | undefined) => typeof value === "number" && value > 0 ? value : null;
/** A stable sort: ties keep the recommended order. Missing figures sort last whichever way. */
function orderBy<T>(items: readonly T[], sort: BrowseSort, keyOf: (item: T) => number | null): T[] {
  // "Lowest payment" is ordered by the public page, which knows the payments; elsewhere it keeps the recommended order.
  if (sort === "recommended" || sort === "payment_asc") return [...items];
  const direction = sort === "price_asc" ? 1 : -1;
  return items.map((item, index) => ({ item, index, key: keyOf(item) })).sort((a, b) => {
    if (a.key === null && b.key === null) return a.index - b.index;
    if (a.key === null) return 1;
    if (b.key === null) return -1;
    return a.key === b.key ? a.index - b.index : (a.key - b.key) * direction;
  }).map((entry) => entry.item);
}

/** The landing cards in the chosen order: by starting price, by how many homes arrived this week, or by the biggest home shown. */
export function sortLandingCommunities<T extends LandingBrowseCommunity>(items: readonly T[], sort: BrowseSort): T[] {
  return orderBy(items, sort, (community) => {
    if (sort === "price_asc" || sort === "price_desc") return price(community.fromPrice) ?? price(community.homeFacts?.map((facts) => facts[0]).filter((value): value is number => typeof value === "number" && value > 0).sort((a, b) => a - b)[0]);
    if (sort === "newest") return community.newThisWeek ?? community.homeFacts?.filter((facts) => facts[9] === 1).length ?? 0;
    return community.homeFacts?.reduce<number | null>((best, facts) => facts[3] && (best === null || facts[3] > best) ? facts[3] : best, null) ?? null;
  });
}

/** The homes inside a community (private list and the community sheet) in the chosen order. */
export function sortHomes<T extends FilterableHome>(homes: readonly T[], sort: BrowseSort): T[] {
  return orderBy(homes, sort, (home) => sort === "price_asc" || sort === "price_desc" ? price(home.price) : sort === "newest" ? (home.isNew ? 1 : 0) : home.sqft ?? null);
}

/** The private list's communities in the chosen order, judged by the homes they show. */
export function sortGatedCommunities<T extends { homes: readonly FilterableHome[] }>(items: readonly T[], sort: BrowseSort): T[] {
  return orderBy(items, sort, (community) => {
    const homes = community.homes;
    if (sort === "price_asc" || sort === "price_desc") { const prices = homes.map((home) => price(home.price)).filter((value): value is number => value !== null); return prices.length ? Math.min(...prices) : null; }
    if (sort === "newest") return homes.filter((home) => home.isNew).length;
    const sizes = homes.map((home) => home.sqft ?? 0); return sizes.length ? Math.max(...sizes) || null : null;
  });
}

/** The "New this week" toggle shows only while some home on the list is new (otherwise it would match nothing). */
export function newThisWeekKnown(items: ReadonlyArray<{ newThisWeek?: number; homes?: ReadonlyArray<{ isNew?: boolean }> }>): boolean {
  return items.some((item) => (item.newThisWeek ?? 0) > 0 || item.homes?.some((home) => home.isNew));
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
  schoolDistrict?: string | null;
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
  if (!areaMatches(community.area, filters.area)) return false;
  if (filters.schoolDistrict && community.schoolDistrict !== filters.schoolDistrict) return false;
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
