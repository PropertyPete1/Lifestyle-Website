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

/** The monthly costs besides principal and interest, as yearly percentages of the price (HOA as dollars a month). */
export type PaymentCosts = { taxRatePercent: number; insuranceRatePercent: number; hoaMonthly: number; mortgageInsuranceRatePercent: number };
/**
 * October 24, 2026 defaults for San Antonio area new construction: ~3% total property tax (MUD/PID districts are
 * common), homeowners insurance ~1.2% of the price a year, a typical HOA, and FHA's 0.55% annual mortgage insurance
 * whenever less than 20% is put down. Admin edits them.
 */
export const DEFAULT_PAYMENT_COSTS: PaymentCosts = { taxRatePercent: 3, insuranceRatePercent: 1.2, hoaMonthly: 60, mortgageInsuranceRatePercent: 0.55 };

/**
 * Whether the loan carries monthly mortgage insurance: FHA always does (its annual MIP does not depend on the down
 * payment), VA never does, and anything else (conventional, or unknown) does under 20% down.
 */
export function carriesMortgageInsurance(loanType: string | null | undefined, downPercent: number): boolean {
  const type = loanType ?? "";
  if (/\bFHA\b/i.test(type)) return true;
  if (/\bVA\b/i.test(type)) return false;
  return downPercent < 20;
}

/** One home's estimated monthly total, part by part, in whole dollars; `total` is the sum of the parts shown. */
export type MonthlyPaymentParts = {
  downAmount: number;
  loanAmount: number;
  principalAndInterest: number;
  mortgageInsurance: number;
  homeInsurance: number;
  hoa: number;
  total: number;
};

export type PaymentInput = { price: number; ratePercent: number; downPercent: number; costs: PaymentCosts; loanType?: string | null; years?: number };

/**
 * The estimated monthly total, part by part. October 30, 2026 (Peter: "we are making false expectations on the
 * monthly, payments being too low"): home insurance and HOA are in, so the number a buyer sees is closer to what they
 * will pay. They are estimates from the admin settings (a yearly percent of the price for insurance, a typical HOA),
 * never a quote, and the breakdown says so. Later Oct 30 (Peter: "just remove the property taxes entirely"): property
 * tax is NOT part of the total; it varies too much by district and exemption, and the breakdown says it is not
 * included. `costs.taxRatePercent` stays in the settings shape but nothing here reads it. Mortgage insurance follows
 * carriesMortgageInsurance; the loan is amortized at the note rate passed in.
 */
export function monthlyPaymentParts(input: PaymentInput): MonthlyPaymentParts {
  const down = Math.min(Math.max(input.downPercent, 0), 100);
  const loan = input.price * (1 - down / 100);
  const months = (input.years ?? DEFAULT_TERM_YEARS) * 12;
  const monthlyRate = input.ratePercent / 100 / 12;
  const principalAndInterest = loan <= 0 ? 0 : monthlyRate === 0 ? loan / months : (loan * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
  const mortgageInsurance = carriesMortgageInsurance(input.loanType, down) ? (loan * input.costs.mortgageInsuranceRatePercent) / 100 / 12 : 0;
  const parts = {
    principalAndInterest: Math.round(principalAndInterest),
    mortgageInsurance: Math.round(mortgageInsurance),
    homeInsurance: Math.round((input.price * input.costs.insuranceRatePercent) / 100 / 12),
    hoa: Math.round(input.costs.hoaMonthly),
  };
  return {
    downAmount: Math.round(input.price - loan),
    loanAmount: Math.round(loan),
    ...parts,
    total: parts.principalAndInterest + parts.mortgageInsurance + parts.homeInsurance + parts.hoa,
  };
}

/** The estimated monthly total (see monthlyPaymentParts): the one number every card, the ranking and the strip use. */
export function estimatedMonthlyPayment(input: PaymentInput): number {
  return monthlyPaymentParts(input).total;
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
  // A lot given in square feet: "6,500 sq ft", "7200 sqft", "0.15 ac" is 6,534 sq ft.
  for (const match of Array.from(text.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d{3,6})\s*(?:sq\.?\s*\.?\s*f(?:ee)?t\.?|square\s+feet|sf)\b/gi))) push(Number(match[1]!.replace(/,/g, "")) / 43_560, match);
  return found;
}

/**
 * A home's own lot, when it has a lot-size field: the acreage it states, or
 * null when the field is empty. A field that is filled but reads as nothing
 * ("corner", "TBD") is still the home's own answer, so the caller must not fall
 * back to the community's lots; `own` says whether to.
 */
export function homeLotAcres(lotSize: string | null | undefined, communityAcres: number | null): number | null {
  if (!lotSize || !lotSize.trim()) return communityAcres;
  return lotAcres(lotSize, { field: true });
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

/** The builder's offer as a payment input (see offerFromIncentive). */
export type BuilderOffer = { ratePercent: number; firstYearRatePercent: number | null; loanType: string | null; downPercent: number | null; aprPercent?: number | null };

/**
 * The builder's financing as a payment input. A buydown's headline is a temporary first-year rate: the payment is
 * figured at the long-term rate that follows it, and the first-year rate is shown alongside. Shared by the server's
 * ranking and the page's cards, so a home's payment is the same number everywhere.
 */
export function offerFromIncentive(row: { headlineRate?: string | null; followOnRate?: string | null; loanType?: string | null; downPayment?: string | null } | null | undefined): BuilderOffer | null {
  if (!row) return null;
  const headline = mortgageRateFrom(row.headlineRate);
  const followOn = mortgageRateFrom(row.followOnRate);
  if (headline === null && followOn === null) return null;
  return {
    ratePercent: (followOn ?? headline)!,
    firstYearRatePercent: followOn !== null && headline !== null && headline !== followOn ? headline : null,
    // Only the program name ("FHA"), never free text that could carry a lender's name.
    loanType: loanTypeLabel(row.loanType),
    downPercent: downPaymentPercentFrom(row.downPayment),
  };
}

/** What every home's estimate is figured with besides the builder's offer (from the admin settings, sent with Best Deals). */
export type PaymentAssumptions = { defaultDownPercent: number; termYears: number; costs: PaymentCosts };

/** A home's estimate with the terms it was figured on (all printed in the breakdown). */
export type HomePaymentEstimate = {
  parts: MonthlyPaymentParts;
  ratePercent: number;
  firstYearRatePercent: number | null;
  aprPercent: number;
  loanType: string | null;
  downPercent: number;
  termYears: number;
  costs: PaymentCosts;
};

/**
 * One home's estimated monthly total, or null. October 24 and 30, 2026 (Peter: "make sure the monthly payment is based
 * off the interest rate of builder only"): only a live builder offer with a usable rate AND its APR (Reg Z: a rate and a
 * payment are printed with the APR) gives a figure; a held offer, a home with no price, or a community with no builder
 * rate shows no monthly figure at all, never one at a market rate.
 */
export function homePaymentEstimate(price: number | null | undefined, incentive: { headlineRate?: string | null; followOnRate?: string | null; loanType?: string | null; downPayment?: string | null; apr?: string | null; pending?: boolean | null } | null | undefined, assumptions: PaymentAssumptions | null | undefined): HomePaymentEstimate | null {
  if (!price || price <= 0 || !incentive || incentive.pending || !assumptions) return null;
  const offer = offerFromIncentive(incentive);
  const aprPercent = mortgageRateFrom(incentive.apr);
  if (!offer || aprPercent === null) return null;
  const downPercent = offer.downPercent ?? assumptions.defaultDownPercent;
  return {
    parts: monthlyPaymentParts({ price, ratePercent: offer.ratePercent, downPercent, loanType: offer.loanType, costs: assumptions.costs, years: assumptions.termYears }),
    ratePercent: offer.ratePercent,
    firstYearRatePercent: offer.firstYearRatePercent,
    aprPercent,
    loanType: offer.loanType,
    downPercent,
    termYears: assumptions.termYears,
    costs: assumptions.costs,
  };
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
  /** The offer's APR, printed beside its rate (Reg Z); null when the stored offer has none. Absent on the market rate. */
  aprPercent?: number | null;
};

export type FeaturedCandidate = {
  /** Groups homes by community so the top three are three different communities. */
  communityKey: string;
  /** Opaque per-home handle carried onto the deal (see FeaturedDeal.key). */
  key?: string;
  /** Landing page only: the community's landing key, so a featured home opens its community's sheet. */
  landingKey?: string;
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
  offer: { ratePercent: number | null; firstYearRatePercent: number | null; loanType: string | null; downPercent: number | null; aprPercent?: number | null } | null;
  /** Largest lot this home or its community mentions, in acres. */
  acres: number | null;
  /** Builders kept out of Best Deals (Lennar by default). */
  excluded: boolean;
  /** Garage spaces as the builder lists them ("2", "2.5", "3 car"); a home with none listed is never featured. */
  garage?: string | number | null;
  /** The home's original price when it came down (see redHotDeal). */
  previousPrice?: number | null;
};

/** Garage spaces from the builder's figure ("2", "2.5", "3-car", 2): the first number, or null when none is given. */
export function garageSpaces(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = /(\d+(?:\.\d+)?)/.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

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
  /** Landing page only: the community's landing key (the same opaque key as its card and map marker). */
  landingKey?: string;
  /** The home's cover photo (the landing page's public render, or the lead's own on a private list); absent when it has none yet. */
  photo?: string;
  /** The original price when the home is a Red Hot Deal (a real price drop). */
  previousPrice?: number | null;
};

export type FeaturedDeals = {
  lowestPayment: FeaturedDeal[];
  bestRate: FeaturedDeal | null;
  bigLots: FeaturedDeal[];
  /** The assumptions printed under the section. */
  assumptions: { marketRatePercent: number; defaultDownPercent: number; termYears: number; costs: PaymentCosts };
};

export type FeaturedSettings = { marketRatePercent: number; defaultDownPercent: number; limit?: number; costs?: PaymentCosts };

function priced(candidate: FeaturedCandidate, settings: FeaturedSettings): FeaturedDeal | null {
  if (!candidate.price || candidate.price <= 0) return null;
  const offerRate = candidate.offer?.ratePercent ?? null;
  const rate: FeaturedRate = offerRate !== null
    ? { ratePercent: offerRate, firstYearRatePercent: candidate.offer?.firstYearRatePercent ?? null, loanType: candidate.offer?.loanType ?? null, builderOffer: true, ...(candidate.offer?.aprPercent !== undefined ? { aprPercent: candidate.offer.aprPercent } : {}) }
    : { ratePercent: settings.marketRatePercent, firstYearRatePercent: null, loanType: null, builderOffer: false };
  const downPercent = (offerRate !== null ? candidate.offer?.downPercent : null) ?? settings.defaultDownPercent;
  return {
    reason: "payment",
    label: candidate.label,
    area: candidate.area,
    ...(candidate.card ? { card: candidate.card } : {}),
    ...(candidate.key ? { key: candidate.key } : {}),
    ...(candidate.landingKey ? { landingKey: candidate.landingKey } : {}),
    ...(candidate.detail !== undefined ? { detail: candidate.detail } : {}),
    price: candidate.price,
    kind: candidate.kind,
    beds: candidate.beds ?? null,
    sqft: candidate.sqft ?? null,
    ...(redHotDeal(candidate.price, candidate.previousPrice) ? { previousPrice: candidate.previousPrice! } : {}),
    estMonthly: estimatedMonthlyPayment({ price: candidate.price, ratePercent: rate.ratePercent, downPercent, loanType: rate.loanType, costs: settings.costs ?? DEFAULT_PAYMENT_COSTS }),
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
  // October 24, 2026: a featured payment is figured at the builder's own published rate only, never the market rate.
  // A home whose builder publishes no rate is still on the list; it just does not compete here.
  // October 24, 2026 (Peter): a featured home has a garage; one listed with none (or no figure) is never featured.
  const eligible = candidates.filter((candidate) => !candidate.excluded && typeof candidate.offer?.ratePercent === "number" && (garageSpaces(candidate.garage) ?? 0) >= 1);
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
  return { lowestPayment, bestRate, bigLots, assumptions: { marketRatePercent: settings.marketRatePercent, defaultDownPercent: settings.defaultDownPercent, termYears: DEFAULT_TERM_YEARS, costs: settings.costs ?? DEFAULT_PAYMENT_COSTS } };
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
export function roundForPublic(deal: FeaturedDeal, costs: PaymentCosts = DEFAULT_PAYMENT_COSTS): FeaturedDeal {
  const bandPrice = priceBandFloor(deal.price);
  return {
    ...deal,
    price: bandPrice,
    priceLabel: `${priceBandLabel(deal.price)}`,
    // The payment is figured on the band's low end, so it cannot be turned back into the exact price.
    estMonthly: estimatedMonthlyPayment({ price: bandPrice, ratePercent: deal.rate.ratePercent, downPercent: deal.downPercent, loanType: deal.rate.loanType, costs }),
    sqft: deal.sqft ? roundedSqft(deal.sqft) : deal.sqft ?? null,
    sqftLabel: deal.sqft ? `about ${roundedSqft(deal.sqft).toLocaleString("en-US")} sq ft` : null,
    acres: deal.acres ? Math.round(deal.acres * 10) / 10 : deal.acres,
  };
}

export function roundFeaturedForPublic(featured: FeaturedDeals): FeaturedDeals {
  const round = (deal: FeaturedDeal) => roundForPublic(deal, featured.assumptions.costs ?? DEFAULT_PAYMENT_COSTS);
  return { ...featured, lowestPayment: featured.lowestPayment.map(round), bestRate: featured.bestRate ? round(featured.bestRate) : null, bigLots: featured.bigLots.map(round) };
}

/**
 * RED HOT DEALS (October 24, 2026, Peter): a home whose price really came down, by at least $15,000 or 8% of the price,
 * whichever is more (raised from $5,000 / 2% on Oct 25: builders show a "was" price on most homes, and 4 in 10
 * communities carried the badge; 8% keeps it to about the top fifth, the real markdowns). The original price is the builder's own published "was" price (D.R. Horton's red event cards) or
 * the highest price this site saw in the last 30 days. The badge says "Red Hot Deal" and shows the savings; it never
 * says why a home is promoted.
 */
export const RED_HOT_MIN_SAVINGS = 15_000;
export const RED_HOT_MIN_PERCENT = 8;
export function redHotDeal(price: number | null | undefined, previousPrice: number | null | undefined): { savings: number; was: number } | null {
  if (!price || !previousPrice || !Number.isFinite(price) || !Number.isFinite(previousPrice) || previousPrice <= price) return null;
  const savings = previousPrice - price;
  return savings >= Math.max(RED_HOT_MIN_SAVINGS, (price * RED_HOT_MIN_PERCENT) / 100) ? { savings, was: previousPrice } : null;
}

/** "New this week": a home first seen in the last 7 days. */
export const NEW_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** A community's first sync lists everything at once; homes from those first two days are the stock, not arrivals. */
export const FIRST_SYNC_GRACE_MS = 48 * 60 * 60_000;

/**
 * Oct 26, 2026: a home is new this week when it was first seen within the window and was not part of its
 * community's opening stock (the first two days after the community itself was added).
 */
export function newThisWeek(homeCreatedAt: Date | string | null | undefined, communityCreatedAt: Date | string | null | undefined, now: number | Date = Date.now()): boolean {
  if (!homeCreatedAt) return false;
  const seen = new Date(homeCreatedAt).getTime();
  const at = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(seen) || at - seen > NEW_WINDOW_MS || seen > at) return false;
  const opened = communityCreatedAt ? new Date(communityCreatedAt).getTime() : NaN;
  return !Number.isFinite(opened) || seen - opened > FIRST_SYNC_GRACE_MS;
}
