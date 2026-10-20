/**
 * Best Deals: after every refresh, every available home across every community
 * is compared on one number buyers actually feel, the estimated monthly
 * principal and interest, plus the best rate on offer and the big lots people
 * keep asking for. Pure functions only; the server builds the candidates and
 * both the landing page and the private list render the result.
 */

export const DEFAULT_TERM_YEARS = 30;
/** Rates outside this band are typos or not mortgage rates ("0% down", "100% financing"). */
const MIN_RATE = 1;
const MAX_RATE = 15;
/** A lot this size or bigger is a "big lot" (half an acre). */
export const BIG_LOT_ACRES = 0.5;
export const FEATURED_LIMIT = 3;

/** The first percentage in a builder figure: "4.999%" -> 4.999, "3.5% minimum down payment" -> 3.5. */
export function percentFrom(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(value) ?? /^\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A plausible mortgage rate, or null. */
export function mortgageRateFrom(value: string | null | undefined): number | null {
  const rate = percentFrom(value);
  return rate !== null && rate >= MIN_RATE && rate <= MAX_RATE ? rate : null;
}

/** Monthly principal and interest, in whole dollars. Taxes, insurance and HOA are not included. */
export function monthlyPrincipalAndInterest(input: { price: number; ratePercent: number; downPercent: number; years?: number }): number {
  const years = input.years ?? DEFAULT_TERM_YEARS;
  const down = Math.min(Math.max(input.downPercent, 0), 100);
  const loan = input.price * (1 - down / 100);
  const months = years * 12;
  const monthlyRate = input.ratePercent / 100 / 12;
  if (loan <= 0) return 0;
  if (monthlyRate === 0) return Math.round(loan / months);
  return Math.round((loan * monthlyRate) / (1 - (1 + monthlyRate) ** -months));
}

const WORD_ACRES: Array<[RegExp, number]> = [
  [/\bhalf[\s-]+acre/gi, 0.5],
  [/\b(?:one[\s-]+)?quarter[\s-]+acre/gi, 0.25],
  [/\bthree[\s-]+quarter[\s-]+acre/gi, 0.75],
  [/\b(?:one|1)[\s-]+acre/gi, 1],
  // "Acre lots", but not the "acre lots" inside "Half-Acre Lots" or "1.5 acre lots" (those are read above).
  [/(?<![a-z0-9./][\s-]*)\bacre[\s-]+(?:plus|\+)?\s*(?:lots?|homesites?|sites?)\b/gi, 1],
];
/** No lot in a buyer's search is bigger than this; larger figures are parks, ranches or the whole community. */
export const MAX_LOT_ACRES = 20;
const LOT_WORDS = /\b(?:lots?|homesites?|home\s*sites?|sites?|acreage)\b/i;

type AcreMention = { value: number; start: number; end: number };

function acreMentions(text: string): AcreMention[] {
  const found: AcreMention[] = [];
  const push = (value: number, match: RegExpMatchArray) => {
    if (Number.isFinite(value) && value > 0) found.push({ value, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  };
  // "0.15 to 0.5 acres", "1/4 - 1/2 acre": the low end of a range counts too.
  for (const match of Array.from(text.matchAll(/(?<![\d/.])(\d*\.?\d+)\s*(?:up\s+to|to|-|–|—)\s*\d*\.?\d+\s*-?\s*acres?\b/gi))) push(Number(match[1]), match);
  for (const match of Array.from(text.matchAll(/(\d+)\s*\/\s*(\d+)\s*(?:to|-|–|—)\s*\d+\s*\/\s*\d+\s*-?\s*acres?\b/gi))) push(Number(match[1]) / Number(match[2]), match);
  for (const match of Array.from(text.matchAll(/(\d+)\s*\/\s*(\d+)\s*-?\s*acres?\b/gi))) push(Number(match[1]) / Number(match[2]), match);
  for (const match of Array.from(text.matchAll(/(?<![\d/])(\d*\.?\d+)\s*\+?\s*-?\s*acres?\b/gi))) push(Number(match[1]), match);
  for (const [pattern, value] of WORD_ACRES) for (const match of Array.from(text.matchAll(pattern))) push(value, match);
  return found;
}

/** The largest acreage a text mentions: "Half-Acre Lots" -> 0.5, "0.75 acre" -> 0.75, "1/2 acre" -> 0.5. */
export function acresFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const values = acreMentions(text).map((mention) => mention.value).filter((value) => value < 1_000);
  return values.length ? Math.max(...values) : null;
}

/**
 * The smallest lot a text promises, in acres, so a home is never shown on a
 * bigger lot than it may have: "0.15 to 0.5 acres" -> 0.15. A lot-size field
 * (`field`) is read as is; free text only counts acreage right next to a lot
 * word ("half-acre homesites", "lots up to 1 acre"), never "a 200-acre park"
 * or "15 acres of trails". Anything over 20 acres is not a lot.
 */
export function lotAcres(text: string | null | undefined, options: { field?: boolean } = {}): number | null {
  if (!text) return null;
  const values = acreMentions(text).filter((mention) => {
    if (mention.value > MAX_LOT_ACRES) return false;
    const after = text.slice(mention.end, mention.end + 25);
    const before = text.slice(Math.max(0, mention.start - 25), mention.start);
    if (/^\s*of\b/i.test(after)) return false;
    // "Homesites up to 1 acre" promises nothing about the smallest lot.
    if (/\b(?:up\s+to|as\s+(?:large|big)\s+as|max(?:imum)?)\s*$/i.test(before)) return false;
    if (options.field) return true;
    return LOT_WORDS.test(text.slice(mention.start, mention.end)) || LOT_WORDS.test(after) || LOT_WORDS.test(before);
  }).map((mention) => mention.value);
  return values.length ? Math.min(...values) : null;
}

/**
 * The down payment as a percent of the price: "3.5% down" -> 3.5, "100%
 * financing" / "$0 down" / "no down payment" -> 0. Half the price or more is
 * not a down payment figure, so it is ignored (the default is used).
 */
export function downPaymentPercentFrom(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  if (/100\s*%\s*financ|\bzero[\s-]+down\b|\bno[\s-]+(?:money[\s-]+)?down\b|\$\s*0\s+down\b|(?<![\d.])0\s*%\s*down\b/i.test(value)) return 0;
  const percent = percentFrom(value);
  return percent !== null && percent >= 0 && percent < 50 ? percent : null;
}

const LOAN_TYPES: Array<[RegExp, string]> = [[/\bFHA\b/i, "FHA"], [/\bVA\b/, "VA"], [/\bUSDA\b/i, "USDA"], [/\bconventional\b/i, "Conventional"], [/\bjumbo\b/i, "Jumbo"]];

/** Only the loan program, from a fixed list: "Conventional with Pulte Mortgage" -> "Conventional". Anything else is dropped. */
export function loanTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const found = LOAN_TYPES.filter(([pattern]) => pattern.test(value)).map(([, label]) => label);
  return found.length ? found.join("/") : null;
}

/** The builder's financing on a home, as the ranking uses it. */
export type FeaturedRate = {
  /** The rate the payment is figured at: the long-term (note) rate. */
  ratePercent: number;
  /** A temporary first-year rate shown alongside, when the offer is a buydown. */
  firstYearRatePercent: number | null;
  loanType: string | null;
  /** True when this is the builder's offer; false for the market rate. */
  builderOffer: boolean;
};

export type FeaturedCandidate = {
  /** Groups homes by community so the top three are three different communities. */
  communityKey: string;
  /** Opaque per-home handle carried onto the deal (see FeaturedDeal.key). */
  key?: string;
  label: string;
  area: string;
  /** The home's opaque card handle on the private list (never on the landing page). */
  card?: string;
  /** Full-view lines (team and agent clients): community name and address. */
  detail?: string | null;
  price: number | null;
  kind: string;
  beds?: string | number | null;
  sqft?: number | null;
  /** The builder's offer for this community, if it has a usable rate. */
  offer: { ratePercent: number | null; firstYearRatePercent: number | null; loanType: string | null; downPercent: number | null } | null;
  /** Largest lot this home or its community mentions, in acres. */
  acres: number | null;
  /** Builders kept out of Best Deals (Lennar by default). */
  excluded: boolean;
};

export type FeaturedDeal = {
  reason: "payment" | "rate" | "lot";
  label: string;
  area: string;
  card?: string;
  detail?: string | null;
  price: number;
  kind: string;
  beds?: string | number | null;
  sqft?: number | null;
  estMonthly: number;
  rate: FeaturedRate;
  downPercent: number;
  acres: number | null;
  /** Landing page only: "$340s" shown instead of the exact price. */
  priceLabel?: string;
  /** Landing page only: "about 2,300 sq ft". */
  sqftLabel?: string | null;
  /** Opaque, per-deal: lets the strip tell two deals with the same label and band apart. Never an id. */
  key?: string;
};

export type FeaturedDeals = {
  lowestPayment: FeaturedDeal[];
  bestRate: FeaturedDeal | null;
  bigLots: FeaturedDeal[];
  /** The assumptions printed under the section. */
  assumptions: { marketRatePercent: number; defaultDownPercent: number; termYears: number };
};

export type FeaturedSettings = { marketRatePercent: number; defaultDownPercent: number; limit?: number };

function priced(candidate: FeaturedCandidate, settings: FeaturedSettings): FeaturedDeal | null {
  if (!candidate.price || candidate.price <= 0) return null;
  const offerRate = candidate.offer?.ratePercent ?? null;
  const rate: FeaturedRate = offerRate !== null
    ? { ratePercent: offerRate, firstYearRatePercent: candidate.offer?.firstYearRatePercent ?? null, loanType: candidate.offer?.loanType ?? null, builderOffer: true }
    : { ratePercent: settings.marketRatePercent, firstYearRatePercent: null, loanType: null, builderOffer: false };
  const downPercent = (offerRate !== null ? candidate.offer?.downPercent : null) ?? settings.defaultDownPercent;
  return {
    reason: "payment",
    label: candidate.label,
    area: candidate.area,
    ...(candidate.card ? { card: candidate.card } : {}),
    ...(candidate.key ? { key: candidate.key } : {}),
    ...(candidate.detail !== undefined ? { detail: candidate.detail } : {}),
    price: candidate.price,
    kind: candidate.kind,
    beds: candidate.beds ?? null,
    sqft: candidate.sqft ?? null,
    estMonthly: monthlyPrincipalAndInterest({ price: candidate.price, ratePercent: rate.ratePercent, downPercent }),
    rate,
    downPercent,
    acres: candidate.acres,
  };
}

/** The cheapest deal of each community, cheapest first; ties go to the lower price. */
function bestPerCommunity(deals: Array<FeaturedDeal & { communityKey: string }>) {
  const byCommunity = new Map<string, FeaturedDeal & { communityKey: string }>();
  for (const deal of deals) {
    const current = byCommunity.get(deal.communityKey);
    if (!current || deal.estMonthly < current.estMonthly || (deal.estMonthly === current.estMonthly && deal.price < current.price)) byCommunity.set(deal.communityKey, deal);
  }
  return Array.from(byCommunity.values()).sort((a, b) => a.estMonthly - b.estMonthly || a.price - b.price || a.label.localeCompare(b.label));
}

const strip = ({ communityKey: _key, ...deal }: FeaturedDeal & { communityKey: string }): FeaturedDeal => deal;

/**
 * The "meeting table": every candidate is priced on the same terms, and the
 * winners are the three lowest payments (three different communities), the
 * single best builder rate, and the cheapest big lots. Move-in-ready homes are
 * compared first; a community with none competes with its lowest plan price.
 */
export function rankFeatured(candidates: readonly FeaturedCandidate[], settings: FeaturedSettings): FeaturedDeals {
  const limit = settings.limit ?? FEATURED_LIMIT;
  const eligible = candidates.filter((candidate) => !candidate.excluded);
  const priced_ = eligible.flatMap((candidate) => {
    const deal = priced(candidate, settings);
    return deal ? [{ ...deal, communityKey: candidate.communityKey }] : [];
  });
  // A community with move-in-ready homes is judged on those; plans only stand in when it has none.
  const withQmi = new Set(priced_.filter((deal) => deal.kind === "quick_move_in").map((deal) => deal.communityKey));
  const comparable = priced_.filter((deal) => deal.kind === "quick_move_in" || !withQmi.has(deal.communityKey));
  const perCommunity = bestPerCommunity(comparable);
  const lowestPayment = perCommunity.slice(0, limit).map((deal) => ({ ...strip(deal), reason: "payment" as const }));
  const offers = perCommunity.filter((deal) => deal.rate.builderOffer)
    .sort((a, b) => a.rate.ratePercent - b.rate.ratePercent || a.estMonthly - b.estMonthly);
  const bestRate = offers[0] ? { ...strip(offers[0]), reason: "rate" as const } : null;
  const bigLots = bestPerCommunity(comparable.filter((deal) => (deal.acres ?? 0) >= BIG_LOT_ACRES)).slice(0, limit).map((deal) => ({ ...strip(deal), reason: "lot" as const }));
  return { lowestPayment, bestRate, bigLots, assumptions: { marketRatePercent: settings.marketRatePercent, defaultDownPercent: settings.defaultDownPercent, termYears: DEFAULT_TERM_YEARS } };
}

/** "Lennar" excludes "Lennar", "Lennar Homes", "Lennar Mortgage" and "www.lennar.com"; a blank entry excludes nothing. */
export function builderExcluded(names: string | null | undefined | ReadonlyArray<string | null | undefined>, excluded: readonly string[]): boolean {
  const list = (Array.isArray(names) ? names : [names]).map((name) => name?.trim().toLowerCase() ?? "").filter(Boolean);
  return list.some((name) => excluded.some((entry) => entry.trim() && name.includes(entry.trim().toLowerCase())));
}

/** "4.999%" style figure with no trailing zeros. */
export function formatRate(percent: number): string {
  return `${Number(percent.toFixed(3))}%`;
}

/** "$340s" for $340,000 to $349,999; "$1.2M+" above a million. Never the exact price. */
export function priceBandLabel(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "";
  if (price >= 1_000_000) return `$${(Math.floor(price / 100_000) / 10).toFixed(1)}M+`;
  return `$${Math.floor(price / 10_000) * 10}s`;
}

/** The low end of the price band, as a number: 349,990 -> 340,000. */
export function priceBandFloor(price: number): number {
  return price >= 1_000_000 ? Math.floor(price / 100_000) * 100_000 : Math.floor(price / 10_000) * 10_000;
}

/** Square feet to the nearest hundred: 2,318 -> 2,300. */
export function roundedSqft(sqft: number): number {
  return Math.max(100, Math.round(sqft / 100) * 100);
}

/**
 * The landing page (no sign-up) gets rounded figures only: a price band, square
 * feet to the hundred, lot size to the tenth of an acre. Exact figures could be
 * typed into a listing site to find the home without talking to an agent.
 */
export function roundForPublic(deal: FeaturedDeal): FeaturedDeal {
  const bandPrice = priceBandFloor(deal.price);
  return {
    ...deal,
    price: bandPrice,
    priceLabel: `${priceBandLabel(deal.price)}`,
    // The payment is figured on the band's low end, so it cannot be turned back into the exact price.
    estMonthly: monthlyPrincipalAndInterest({ price: bandPrice, ratePercent: deal.rate.ratePercent, downPercent: deal.downPercent }),
    sqft: deal.sqft ? roundedSqft(deal.sqft) : deal.sqft ?? null,
    sqftLabel: deal.sqft ? `about ${roundedSqft(deal.sqft).toLocaleString("en-US")} sq ft` : null,
    acres: deal.acres ? Math.round(deal.acres * 10) / 10 : deal.acres,
  };
}

export function roundFeaturedForPublic(featured: FeaturedDeals): FeaturedDeals {
  return { ...featured, lowestPayment: featured.lowestPayment.map(roundForPublic), bestRate: featured.bestRate ? roundForPublic(featured.bestRate) : null, bigLots: featured.bigLots.map(roundForPublic) };
}
