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
  [/\bhalf[\s-]+acre/i, 0.5],
  [/\b(?:one[\s-]+)?quarter[\s-]+acre/i, 0.25],
  [/\bthree[\s-]+quarter[\s-]+acre/i, 0.75],
  [/\b(?:one|1)[\s-]+acre/i, 1],
  // "Acre lots", but not the "acre lots" inside "Half-Acre Lots" or "1.5 acre lots" (those are read above).
  [/(?<![a-z0-9./][\s-]*)\bacre[\s-]+(?:plus|\+)?\s*(?:lots?|homesites?|sites?)\b/i, 1],
];

/** The largest lot size a text mentions, in acres: "Half-Acre Lots" -> 0.5, "0.75 acre" -> 0.75, "1/2 acre" -> 0.5. */
export function acresFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const found: number[] = [];
  for (const match of Array.from(text.matchAll(/(\d+)\s*\/\s*(\d+)\s*-?\s*acres?\b/gi))) {
    const value = Number(match[1]) / Number(match[2]);
    if (Number.isFinite(value) && value > 0) found.push(value);
  }
  for (const match of Array.from(text.matchAll(/(?<![\d/])(\d*\.?\d+)\s*\+?\s*-?\s*acres?\b/gi))) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value < 1_000) found.push(value);
  }
  for (const [pattern, value] of WORD_ACRES) if (pattern.test(text)) found.push(value);
  return found.length ? Math.max(...found) : null;
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

/** "Lennar" excludes "Lennar", "Lennar Homes" and "lennar"; a blank entry excludes nothing. */
export function builderExcluded(builder: string | null | undefined, excluded: readonly string[]): boolean {
  const name = builder?.trim().toLowerCase() ?? "";
  return Boolean(name) && excluded.some((entry) => entry.trim() && name.includes(entry.trim().toLowerCase()));
}

/** "4.999%" style figure with no trailing zeros. */
export function formatRate(percent: number): string {
  return `${Number(percent.toFixed(3))}%`;
}
