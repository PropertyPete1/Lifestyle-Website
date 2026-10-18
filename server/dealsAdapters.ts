import { scrubPrivateNames } from "../shared/deals";

/**
 * Official, read-only builders supported by this module.  These display names
 * deliberately exist only in the private/internal half of an adapter result.
 */
export type BuilderId = "Chesmar" | "M/I Homes" | "Manual";

export interface CommunitySourceConfig {
  /** Selects an adapter from DEAL_ADAPTERS. */
  builder: BuilderId;
  /** Official community URL. This is private metadata and is never public DTO data. */
  sourceUrl: string;
  /** Community name that may appear in first-party markup. */
  privateCommunityName: string;
  /** Every private community, plan, or other term that must not reach a public DTO. */
  scrubList: readonly string[];
  /** Optional official M/I incentive URL. A discovered official incentive link is used otherwise. */
  incentiveSourceUrl?: string;
  /** Explicit records for the Manual adapter. No network request is made for these. */
  manualEntries?: readonly ManualEntry[];
  /** Bounded discovery protects the official sites from an unbounded sitemap crawl. */
  maxDetailPages?: number;
}

export interface ManualEntry {
  kind: "plan" | "home" | "incentive";
  /** Kept only in private output. */
  sourceUrl?: string;
  /** Kept only in private output. */
  privateName?: string;
  status?: string;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
  squareFeet?: number;
  incentiveText?: string;
}

export type DealHoldReason =
  | "invalid_source_url"
  | "unsupported_official_host"
  | "community_fetch_failed"
  | "sitemap_fetch_failed"
  | "detail_fetch_failed"
  | "incentive_fetch_failed"
  | "expected_community_container_not_found"
  | "expected_detail_container_not_found"
  | "expected_incentive_container_not_found"
  | "private_text_remaining"
  | "missing_promotional_rate"
  | "missing_apr"
  | "missing_loan_type"
  | "missing_repayment_term"
  | "missing_promotional_period"
  | "missing_follow_on_rate"
  | "missing_follow_on_period"
  | "missing_down_payment"
  | "missing_contract_deadline"
  | "missing_closing_deadline";

export interface DeadlineFact {
  /** What the official page said; it is not guessed or expanded. */
  raw: string;
  /** ISO date only when the official text supplied an unambiguous year. */
  isoDate: string | null;
}

export interface PromotionalRateFacts {
  normalizedText: string;
  promotionalRatePercent: number | null;
  promotionalPeriod: string | null;
  followOnRatePercent: number | null;
  followOnPeriod: string | null;
  aprPercent: number | null;
  loanType: string | null;
  repaymentTermYears: number | null;
  downPaymentPercent: number | null;
  contractDeadline: DeadlineFact | null;
  closingDeadline: DeadlineFact | null;
  holdReasons: DealHoldReason[];
  publishable: boolean;
}

export interface PrivateSourcePage {
  kind: "community" | "plan" | "home" | "incentive" | "sitemap" | "manual";
  sourceUrl: string;
  privateName: string | null;
}

export interface PrivatePlanOrHome {
  sourceUrl: string;
  privateName: string | null;
  status: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
}

/**
 * This object intentionally retains restricted operational metadata. It must
 * stay server-only and must not be serialized into a browser response.
 */
export interface PrivateDealSnapshot {
  builder: BuilderId;
  sourceUrl: string;
  privateCommunityName: string;
  pages: PrivateSourcePage[];
  plans: PrivatePlanOrHome[];
  homes: PrivatePlanOrHome[];
  incentive: { sourceUrl: string; text: string; facts: PromotionalRateFacts } | null;
}

/** A public record has neither a name nor a URL. */
export interface PublicPlanOrHome {
  status: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
}

/**
 * This is the only shape intended for browser/API publication. It contains no
 * source URL, builder/community/plan name, address, source key, or home ID.
 */
export interface PublicDealSnapshot {
  plans: PublicPlanOrHome[];
  homes: PublicPlanOrHome[];
  incentive: {
    text: string;
    promotionalRatePercent: number;
    promotionalPeriod: string;
    followOnRatePercent: number;
    followOnPeriod: string;
    aprPercent: number;
    loanType: string;
    repaymentTermYears: number;
    downPaymentPercent: number;
    contractDeadline: DeadlineFact;
    closingDeadline: DeadlineFact;
  } | null;
  holdReasons: DealHoldReason[];
}

export interface DealAdapterResult {
  ok: boolean;
  fetchedAt: string;
  /** Server-only data, including private names and official source URLs. */
  private: PrivateDealSnapshot;
  /** Safe for publication only when ok is true and holdReasons is empty. */
  public: PublicDealSnapshot;
  holdReasons: DealHoldReason[];
}

export type HtmlFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface AdapterRunOptions {
  fetcher?: HtmlFetcher;
  now?: () => Date;
}

export interface DealAdapter {
  readonly builder: BuilderId;
  load(config: CommunitySourceConfig, options?: AdapterRunOptions): Promise<DealAdapterResult>;
}

const CHESMAR_HOST = "www.chesmar.com";
const MI_HOST = "www.mihomes.com";
const CHESMAR_SITEMAPS = [
  "https://www.chesmar.com/sitemap5.xml",
  "https://www.chesmar.com/sitemap6.xml",
] as const;
const DEFAULT_DETAIL_LIMIT = 24;
const MAX_DETAIL_LIMIT = 48;
const FETCH_TIMEOUT_MS = 20_000;

const EMPTY_PUBLIC: PublicDealSnapshot = {
  plans: [],
  homes: [],
  incentive: null,
  holdReasons: [],
};

function emptyPrivate(config: CommunitySourceConfig): PrivateDealSnapshot {
  return {
    builder: config.builder,
    sourceUrl: config.sourceUrl,
    privateCommunityName: config.privateCommunityName,
    pages: [],
    plans: [],
    homes: [],
    incentive: null,
  };
}

function uniqueReasons(reasons: readonly DealHoldReason[]): DealHoldReason[] {
  return Array.from(new Set(reasons));
}

function failedResult(
  config: CommunitySourceConfig,
  fetchedAt: string,
  privateSnapshot: PrivateDealSnapshot,
  reasons: readonly DealHoldReason[],
): DealAdapterResult {
  const holdReasons = uniqueReasons(reasons);
  return {
    ok: false,
    fetchedAt,
    private: privateSnapshot,
    public: { ...EMPTY_PUBLIC, holdReasons },
    holdReasons,
  };
}

function successfulResult(
  fetchedAt: string,
  privateSnapshot: PrivateDealSnapshot,
  publicSnapshot: PublicDealSnapshot,
): DealAdapterResult {
  const holdReasons = uniqueReasons(publicSnapshot.holdReasons);
  return {
    ok: holdReasons.length === 0,
    fetchedAt,
    private: privateSnapshot,
    public: { ...publicSnapshot, holdReasons },
    holdReasons,
  };
}

function asUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function normalizePathname(pathname: string): string {
  return `${pathname.replace(/\/+$/, "") || "/"}/`;
}

function sameOfficialHost(url: URL, expectedHost: string): boolean {
  return url.protocol === "https:" && url.hostname.toLowerCase() === expectedHost;
}

function absoluteUrl(href: string, base: URL): URL | null {
  try {
    const value = new URL(decodeHtmlEntities(href.trim()), base);
    return value.protocol === "https:" || value.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function sourcePage(kind: PrivateSourcePage["kind"], sourceUrl: string, privateName: string | null): PrivateSourcePage {
  return { kind, sourceUrl, privateName };
}

/** Plain GET only. There are no form submissions, click goals, or browser automation here. */
async function getDocument(
  url: string,
  fetcher: HtmlFetcher,
  accept: string,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": "LifestyleDesignRealtyDeals/1.0 (read-only official-page parser)",
      },
    });
    if (!response.ok) return { ok: false };
    return { ok: true, text: await response.text() };
  } catch {
    // Do not include url in logs or errors: it is private source metadata.
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    quot: '"',
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
  };
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);?/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole);
}

/** Small, dependency-free parser for text in an already server-rendered document. */
export function htmlToText(html: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p\s*>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\u00a0\s]+/g, " ").trim();
}

/**
 * Normalizes only presentation noise; it does not infer any missing loan fact.
 * It is exported separately so tests and ingestion callers can use it without I/O.
 */
export function normalizeIncentiveText(value: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(value)
      .replace(/<[^>]+>/g, " ")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\*+/g, ""),
  );
}

function numericValue(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMonthDate(raw: string): string | null {
  const compact = raw.trim().replace(/\.$/, "");
  const numeric = compact.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
    return null;
  }
  const monthNames: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  const named = compact.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (!named) return null;
  const month = monthNames[named[1].toLowerCase()];
  const day = Number(named[2]);
  const year = Number(named[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function deadlineFromMatch(raw: string): DeadlineFact | null {
  const cleaned = normalizeWhitespace(raw);
  if (!cleaned) return null;
  return { raw: cleaned, isoDate: normalizeMonthDate(cleaned) };
}

function firstMatch(text: string, pattern: RegExp, group = 1): string | null {
  const match = pattern.exec(text);
  return match?.[group] ? normalizeWhitespace(match[group]) : null;
}

function numberMatch(text: string, pattern: RegExp, group = 1): number | null {
  const value = firstMatch(text, pattern, group);
  return value ? numericValue(value) : null;
}

function findContractDeadline(text: string): DeadlineFact | null {
  const between = /\b(?:contracts?|contract\s+sales?|full\s+priced\s+contracts?)\b[^.]{0,140}?\bbetween\s+(\d{1,2}\/\d{1,2}\/\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\s+(?:and|to|through|-)\s+(\d{1,2}\/\d{1,2}\/\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i.exec(text);
  if (between) return deadlineFromMatch(between[2]);
  const ending = /(?:contract(?:s|\s+signing)?|offer)[^.]{0,90}?\b(?:by|through|until)\s+(\d{1,2}\/\d{1,2}\/\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i.exec(text);
  return ending ? deadlineFromMatch(ending[1]) : null;
}

function findClosingDeadline(text: string): DeadlineFact | null {
  const match = /\b(?:must\s+)?close(?:\s+on)?\s+(?:by|before|no\s+later\s+than)\s+(\d{1,2}\/\d{1,2}\/\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i.exec(text);
  return match ? deadlineFromMatch(match[1]) : null;
}

function rateNear(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  return match ? numericValue(match[1]) : null;
}

/**
 * Extracts only facts present in the supplied official text. A rate is not
 * publishable unless the disclosures needed to state that rate are also there.
 */
export function parsePromotionalRate(input: string): PromotionalRateFacts {
  const text = normalizeIncentiveText(input);
  const promotionalRatePercent =
    rateNear(text, /(?:first[- ]year|year\s*1)[^.]{0,110}?(\d+(?:\.\d+)?)%\s*(?:interest\s+)?rate\b/i) ??
    rateNear(text, /(?:rates?\s+as\s+low\s+as|as\s+low\s+as)\s+(\d+(?:\.\d+)?)%\s*(?:interest\s+)?rate\b/i) ??
    rateNear(text, /(?:temporarily\s+reduced\s+to)\s+(\d+(?:\.\d+)?)%/i);
  const promotionalPeriod =
    firstMatch(text, /\b(first[- ]year|year\s*1)\b/i) ??
    firstMatch(text, /temporarily\s+reduced[^.]{0,100}?\b(for\s+year\s*\d+)\b/i);
  const followOnRatePercent =
    rateNear(text, /(?:year(?:s)?\s*2\s*(?:-|to)\s*\d+|after\s+(?:the\s+)?first\s+year)[^.]{0,110}?(\d+(?:\.\d+)?)%\s*(?:interest\s+)?rate\b/i) ??
    rateNear(text, /(?:reduced\s+to\s+\d+(?:\.\d+)?%[^.]{0,100}?)(\d+(?:\.\d+)?)%\s+for\s+years?\s*2/i);
  const followOnPeriod =
    firstMatch(text, /\b(year(?:s)?\s*2\s*(?:-|to)\s*\d+|after\s+(?:the\s+)?first\s+year)\b/i) ??
    firstMatch(text, /\b(years?\s*2[^.]{0,22})\b/i);
  const aprPercent = rateNear(text, /(\d+(?:\.\d+)?)%\s*(?:annual\s+percentage\s+rate|apr)\b/i);
  const repaymentTermYears = numberMatch(text, /\b(\d{1,2})[- ]year\s+fixed\b/i);
  const loanType =
    firstMatch(text, /\b\d{1,2}[- ]year\s+fixed\s+(FHA|VA|USDA|conventional|jumbo)\s+loan\b/i) ??
    firstMatch(text, /\b(FHA|VA|USDA|conventional|jumbo)\s+loan\b/i);
  const downPaymentPercent = numberMatch(text, /(\d+(?:\.\d+)?)%\s+down\s+payment\b/i);
  const contractDeadline = findContractDeadline(text);
  const closingDeadline = findClosingDeadline(text);

  const holdReasons: DealHoldReason[] = [];
  if (promotionalRatePercent === null) holdReasons.push("missing_promotional_rate");
  if (aprPercent === null) holdReasons.push("missing_apr");
  if (!loanType) holdReasons.push("missing_loan_type");
  if (repaymentTermYears === null) holdReasons.push("missing_repayment_term");
  if (!promotionalPeriod) holdReasons.push("missing_promotional_period");
  if (followOnRatePercent === null) holdReasons.push("missing_follow_on_rate");
  if (!followOnPeriod) holdReasons.push("missing_follow_on_period");
  if (downPaymentPercent === null) holdReasons.push("missing_down_payment");
  if (!contractDeadline?.isoDate) holdReasons.push("missing_contract_deadline");
  if (!closingDeadline?.isoDate) holdReasons.push("missing_closing_deadline");

  return {
    normalizedText: text,
    promotionalRatePercent,
    promotionalPeriod,
    followOnRatePercent,
    followOnPeriod,
    aprPercent,
    loanType,
    repaymentTermYears,
    downPaymentPercent,
    contractDeadline,
    closingDeadline,
    holdReasons,
    publishable: holdReasons.length === 0,
  };
}

function hasElementId(html: string, id: string): boolean {
  const escaped = escapeRegExp(id);
  return new RegExp(`<[^>]+\\bid\\s*=\\s*(["'])${escaped}\\1`, "i").test(html);
}

function hasClassToken(html: string, token: string): boolean {
  const escaped = escapeRegExp(token);
  return new RegExp(`\\bclass\\s*=\\s*(["'])[^"']*\\b${escaped}\\b[^"']*\\1`, "i").test(html);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsExpectedChesmarCommunityContainer(html: string): boolean {
  return hasElementId(html, "floorplans") && (hasClassToken(html, "search-results-container") || /FloorPlans/i.test(html));
}

function containsExpectedMiCommunityContainer(html: string): boolean {
  return hasElementId(html, "product-homes-list") || hasClassToken(html, "product-homes") || hasClassToken(html, "home-results");
}

function containsExpectedDetailContainer(html: string): boolean {
  const text = htmlToText(html);
  const hasHeading = /<h1\b/i.test(html);
  const hasPropertyFact = /\b(?:priced\s+from|starting\s+from|beds?|bedrooms?|baths?|bathrooms?|sq\.?\s*(?:ft|feet)|quick\s+move[- ]in|model\s+for\s+tour)\b/i.test(text);
  return hasHeading && hasPropertyFact;
}

function containsExpectedIncentiveContainer(html: string): boolean {
  const text = htmlToText(html);
  // M/I's current promotion template keeps its visible campaign heading inside
  // a CMS component rather than an h1, but retains a document title plus the
  // legally meaningful rate/APR text. Require both, not a generic page match.
  return (/<h1\b/i.test(html) || /<title>[^<]*(?:incentive|savings|rate)/i.test(html)) &&
    /\b(?:incentive|rate|annual\s+percentage\s+rate|apr|more\s+details)\b/i.test(text);
}

function extractHrefValues(html: string): string[] {
  const results: string[] = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match[2]) results.push(decodeHtmlEntities(match[2]));
  }
  return results;
}

function extractFirstHeading(html: string): string | null {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const heading = match ? htmlToText(match[1]) : "";
  return heading || null;
}

function extractPrice(text: string): number | null {
  const labelled = /(?:priced\s+from|starting\s+from|price(?:\s+from)?|from)\s*:?\s*\$\s*([\d,]+(?:\.\d{2})?)/i.exec(text);
  const fallback = /\$\s*([\d,]+(?:\.\d{2})?)/.exec(text);
  return numericValue((labelled ?? fallback)?.[1] ?? "");
}

function extractBedrooms(text: string): number | null {
  return numberMatch(text, /\b(\d+(?:\.\d+)?)\s*(?:beds?|bedrooms?)\b/i);
}

function extractBathrooms(text: string): number | null {
  return numberMatch(text, /\b(\d+(?:\.\d+)?)\s*(?:baths?|bathrooms?)\b/i);
}

function extractSquareFeet(text: string): number | null {
  const range = /\b([\d,]+)\s*(?:-|to)\s*[\d,]+\s*(?:sq\.?\s*(?:ft|feet)|square\s+feet)\b/i.exec(text);
  const single = /\b([\d,]+)\s*(?:sq\.?\s*(?:ft|feet)|square\s+feet)\b/i.exec(text);
  return numericValue((range ?? single)?.[1] ?? "");
}

function extractStatus(text: string): string | null {
  const match = /\b(Model\s+For\s+Tour|Quick\s+Move[- ]In|Available\s+Now|Now\s+Selling|Sold\s+Out|Sold)\b/i.exec(text);
  return match ? normalizeWhitespace(match[1]) : null;
}

function parsePrivateProperty(sourceUrl: string, html: string): PrivatePlanOrHome {
  const text = htmlToText(html);
  return {
    sourceUrl,
    privateName: extractFirstHeading(html),
    status: extractStatus(text),
    price: extractPrice(text),
    bedrooms: extractBedrooms(text),
    bathrooms: extractBathrooms(text),
    squareFeet: extractSquareFeet(text),
  };
}

function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const locPattern = /<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locPattern.exec(xml)) !== null) {
    const value = decodeHtmlEntities(match[1]).trim();
    if (value) urls.push(value);
  }
  return Array.from(new Set(urls));
}

function detailLimit(config: CommunitySourceConfig): number {
  const requested = config.maxDetailPages;
  if (!Number.isInteger(requested) || !requested || requested < 1) return DEFAULT_DETAIL_LIMIT;
  return Math.min(requested, MAX_DETAIL_LIMIT);
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = new Array(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const current = cursor;
      cursor += 1;
      output[current] = await mapper(values[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

function privateTerms(config: CommunitySourceConfig, discovered: readonly string[] = []): string[] {
  const builderTerms = config.builder === "M/I Homes" ? ["M/I Homes", "M/I Financial"] : config.builder === "Chesmar" ? ["Chesmar Homes"] : [];
  return Array.from(new Set([config.privateCommunityName, ...config.scrubList, ...discovered, ...builderTerms].map((term) => term.trim()).filter(Boolean)));
}

function remainingPrivateTerm(text: string, terms: readonly string[]): boolean {
  const normalizedText = text.toLocaleLowerCase();
  return terms.some((raw) => {
    const term = raw.trim().toLocaleLowerCase();
    if (!term) return false;
    return normalizedText.includes(term);
  });
}

/** Uses the shared canonical scrubber first, then holds output if a configured private term remains. */
export function toPublicSafeText(
  input: string,
  config: Pick<CommunitySourceConfig, "privateCommunityName" | "scrubList">,
  planField = false,
  extraPrivateTerms: readonly string[] = [],
): string | null {
  const terms = privateTerms({ ...config, builder: "Manual", sourceUrl: "https://manual.invalid" });
  const allTerms = Array.from(new Set([...terms, ...extraPrivateTerms]));
  const scrubbed = scrubPrivateNames(input, allTerms, { planField });
  return remainingPrivateTerm(scrubbed, allTerms) ? null : scrubbed;
}

function publicProperty(value: PrivatePlanOrHome, config: CommunitySourceConfig, terms: readonly string[]): { record: PublicPlanOrHome | null; held: boolean } {
  const status = value.status ? scrubPrivateNames(value.status, Array.from(terms)) : null;
  if (status && remainingPrivateTerm(status, terms)) return { record: null, held: true };
  return {
    record: {
      status,
      price: value.price,
      bedrooms: value.bedrooms,
      bathrooms: value.bathrooms,
      squareFeet: value.squareFeet,
    },
    held: false,
  };
}

function publicIncentive(
  value: { sourceUrl: string; text: string; facts: PromotionalRateFacts } | null,
  config: CommunitySourceConfig,
  terms: readonly string[],
): { incentive: PublicDealSnapshot["incentive"]; held: boolean; reasons: DealHoldReason[] } {
  if (!value) return { incentive: null, held: false, reasons: [] };
  const cleanedText = toPublicSafeText(value.text, config, false, terms);
  if (!cleanedText) return { incentive: null, held: true, reasons: ["private_text_remaining"] };
  if (!value.facts.publishable) return { incentive: null, held: true, reasons: value.facts.holdReasons };
  const facts = value.facts;
  // publishable narrows all of the following facts at runtime; explicit checks keep strict TS honest.
  if (
    facts.promotionalRatePercent === null ||
    !facts.promotionalPeriod ||
    facts.followOnRatePercent === null ||
    !facts.followOnPeriod ||
    facts.aprPercent === null ||
    !facts.loanType ||
    facts.repaymentTermYears === null ||
    facts.downPaymentPercent === null ||
    !facts.contractDeadline?.isoDate ||
    !facts.closingDeadline?.isoDate
  ) {
    return { incentive: null, held: true, reasons: facts.holdReasons };
  }
  return {
    incentive: {
      text: cleanedText,
      promotionalRatePercent: facts.promotionalRatePercent,
      promotionalPeriod: facts.promotionalPeriod,
      followOnRatePercent: facts.followOnRatePercent,
      followOnPeriod: facts.followOnPeriod,
      aprPercent: facts.aprPercent,
      loanType: facts.loanType,
      repaymentTermYears: facts.repaymentTermYears,
      downPaymentPercent: facts.downPaymentPercent,
      contractDeadline: facts.contractDeadline,
      closingDeadline: facts.closingDeadline,
    },
    held: false,
    reasons: [],
  };
}

function makePublicSnapshot(privateSnapshot: PrivateDealSnapshot, config: CommunitySourceConfig): PublicDealSnapshot {
  const discoveredNames = [...privateSnapshot.plans, ...privateSnapshot.homes].flatMap((item) => (item.privateName ? [item.privateName] : []));
  const terms = privateTerms(config, discoveredNames);
  const reasons: DealHoldReason[] = [];
  const plans: PublicPlanOrHome[] = [];
  const homes: PublicPlanOrHome[] = [];
  for (const plan of privateSnapshot.plans) {
    const converted = publicProperty(plan, config, terms);
    if (converted.held) reasons.push("private_text_remaining");
    else if (converted.record) plans.push(converted.record);
  }
  for (const home of privateSnapshot.homes) {
    const converted = publicProperty(home, config, terms);
    if (converted.held) reasons.push("private_text_remaining");
    else if (converted.record) homes.push(converted.record);
  }
  const incentive = publicIncentive(privateSnapshot.incentive, config, terms);
  reasons.push(...incentive.reasons);
  return { plans, homes, incentive: incentive.incentive, holdReasons: uniqueReasons(reasons) };
}

function validatedOfficialCommunity(config: CommunitySourceConfig, host: string): URL | null {
  const url = asUrl(config.sourceUrl);
  return url && sameOfficialHost(url, host) ? url : null;
}

function isChesmarPlan(url: URL, community: URL): boolean {
  const base = normalizePathname(community.pathname);
  const pathname = normalizePathname(url.pathname);
  if (!pathname.startsWith(base)) return false;
  const parts = pathname.slice(base.length).split("/").filter(Boolean);
  return parts.length === 1;
}

function isChesmarHome(url: URL, community: URL): boolean {
  const base = normalizePathname(community.pathname);
  const pathname = normalizePathname(url.pathname);
  if (!pathname.startsWith(base)) return false;
  const parts = pathname.slice(base.length).split("/").filter(Boolean);
  return parts.length >= 2 && /^\d{5,}(?:-\d+)?$/i.test(parts[parts.length - 1] ?? "");
}

async function fetchDiscoveredProperties(
  urls: readonly string[],
  kind: "plan" | "home",
  fetcher: HtmlFetcher,
  privateSnapshot: PrivateDealSnapshot,
): Promise<DealHoldReason[]> {
  const results = await mapWithConcurrency(urls, 4, async (url) => {
    const page = await getDocument(url, fetcher, "text/html,application/xhtml+xml");
    if (!page.ok) return { hold: "detail_fetch_failed" as const, property: null };
    if (!containsExpectedDetailContainer(page.text)) return { hold: "expected_detail_container_not_found" as const, property: null };
    return { hold: null, property: parsePrivateProperty(url, page.text) };
  });
  const holds: DealHoldReason[] = [];
  for (const result of results) {
    if (result.hold) {
      holds.push(result.hold);
      continue;
    }
    if (!result.property) continue;
    privateSnapshot.pages.push(sourcePage(kind, result.property.sourceUrl, result.property.privateName));
    if (kind === "plan") privateSnapshot.plans.push(result.property);
    else privateSnapshot.homes.push(result.property);
  }
  return holds;
}

class ChesmarAdapter implements DealAdapter {
  readonly builder = "Chesmar" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = validatedOfficialCommunity(config, CHESMAR_HOST);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    const fetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml");
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, ["community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    if (!containsExpectedChesmarCommunityContainer(page.text)) {
      return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    }

    const sitemapResults = await mapWithConcurrency(CHESMAR_SITEMAPS, 2, async (sitemapUrl) => ({
      sitemapUrl,
      page: await getDocument(sitemapUrl, fetcher, "application/xml,text/xml;q=0.9,*/*;q=0.1"),
    }));
    if (sitemapResults.some((result) => !result.page.ok)) {
      return failedResult(config, fetchedAt, privateSnapshot, ["sitemap_fetch_failed"]);
    }
    for (const sitemap of sitemapResults) {
      privateSnapshot.pages.push(sourcePage("sitemap", sitemap.sitemapUrl, null));
    }

    const candidates = sitemapResults.flatMap((result) => (result.page.ok ? parseSitemapUrls(result.page.text) : []));
    const planUrls: string[] = [];
    const homeUrls: string[] = [];
    for (const raw of candidates) {
      const url = asUrl(raw);
      if (!url || !sameOfficialHost(url, CHESMAR_HOST)) continue;
      if (isChesmarPlan(url, community)) planUrls.push(url.toString());
      else if (isChesmarHome(url, community)) homeUrls.push(url.toString());
    }
    const maxDetails = detailLimit(config);
    const distinctPlanUrls = Array.from(new Set(planUrls)).slice(0, maxDetails);
    const remaining = Math.max(0, maxDetails - distinctPlanUrls.length);
    const distinctHomeUrls = Array.from(new Set(homeUrls)).slice(0, remaining);
    const detailHolds = [
      ...(await fetchDiscoveredProperties(distinctPlanUrls, "plan", fetcher, privateSnapshot)),
      ...(await fetchDiscoveredProperties(distinctHomeUrls, "home", fetcher, privateSnapshot)),
    ];
    if (detailHolds.length > 0) return failedResult(config, fetchedAt, privateSnapshot, detailHolds);

    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}

function isMiPlan(url: URL, community: URL): boolean {
  const base = normalizePathname(community.pathname);
  const pathname = normalizePathname(url.pathname);
  if (!pathname.startsWith(base)) return false;
  const suffix = pathname.slice(base.length).split("/").filter(Boolean);
  return suffix.length === 1 && suffix[0].toLowerCase().endsWith("-plan");
}

function isMiHome(url: URL, community: URL): boolean {
  const base = normalizePathname(community.pathname);
  const pathname = normalizePathname(url.pathname);
  if (!pathname.startsWith(base)) return false;
  const suffix = pathname.slice(base.length).split("/").filter(Boolean);
  return suffix.length === 2 && suffix[0].toLowerCase().endsWith("-plan");
}

function discoverMiCommunityUrls(html: string, community: URL): { planUrls: string[]; homeUrls: string[]; incentiveUrls: string[] } {
  const planUrls: string[] = [];
  const homeUrls: string[] = [];
  const incentiveUrls: string[] = [];
  for (const href of extractHrefValues(html)) {
    const url = absoluteUrl(href, community);
    if (!url || !sameOfficialHost(url, MI_HOST)) continue;
    if (isMiPlan(url, community)) planUrls.push(url.toString());
    else if (isMiHome(url, community)) homeUrls.push(url.toString());
    else if (/\/incentives?(?:\/|$)/i.test(url.pathname)) incentiveUrls.push(url.toString());
  }
  return {
    planUrls: Array.from(new Set(planUrls)),
    homeUrls: Array.from(new Set(homeUrls)),
    incentiveUrls: Array.from(new Set(incentiveUrls)),
  };
}

class MiHomesAdapter implements DealAdapter {
  readonly builder = "M/I Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = validatedOfficialCommunity(config, MI_HOST);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    const fetcher = options.fetcher ?? fetch;
    const communityPage = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml");
    if (!communityPage.ok) return failedResult(config, fetchedAt, privateSnapshot, ["community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    if (!containsExpectedMiCommunityContainer(communityPage.text)) {
      return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    }

    const discovered = discoverMiCommunityUrls(communityPage.text, community);
    const maxDetails = detailLimit(config);
    const planUrls = discovered.planUrls.slice(0, maxDetails);
    const homeUrls = discovered.homeUrls.slice(0, Math.max(0, maxDetails - planUrls.length));
    const detailHolds = [
      ...(await fetchDiscoveredProperties(planUrls, "plan", fetcher, privateSnapshot)),
      ...(await fetchDiscoveredProperties(homeUrls, "home", fetcher, privateSnapshot)),
    ];
    if (detailHolds.length > 0) return failedResult(config, fetchedAt, privateSnapshot, detailHolds);

    const configuredIncentive = config.incentiveSourceUrl ? asUrl(config.incentiveSourceUrl) : null;
    const incentiveUrl = configuredIncentive && sameOfficialHost(configuredIncentive, MI_HOST)
      ? configuredIncentive
      : discovered.incentiveUrls[0] ? asUrl(discovered.incentiveUrls[0]) : null;
    if (config.incentiveSourceUrl && !incentiveUrl) {
      return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    }
    if (incentiveUrl) {
      const incentivePage = await getDocument(incentiveUrl.toString(), fetcher, "text/html,application/xhtml+xml");
      if (!incentivePage.ok) return failedResult(config, fetchedAt, privateSnapshot, ["incentive_fetch_failed"]);
      if (!containsExpectedIncentiveContainer(incentivePage.text)) {
        return failedResult(config, fetchedAt, privateSnapshot, ["expected_incentive_container_not_found"]);
      }
      const incentiveText = htmlToText(incentivePage.text);
      const facts = parsePromotionalRate(incentiveText);
      privateSnapshot.pages.push(sourcePage("incentive", incentiveUrl.toString(), extractFirstHeading(incentivePage.text)));
      privateSnapshot.incentive = { sourceUrl: incentiveUrl.toString(), text: incentiveText, facts };
    }

    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}

class ManualAdapter implements DealAdapter {
  readonly builder = "Manual" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
    const privateSnapshot = emptyPrivate(config);
    // The Manual adapter is an explicit server-side review path, never a fallback scrape.
    const source = asUrl(config.sourceUrl);
    if (!source) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    privateSnapshot.pages.push(sourcePage("manual", source.toString(), config.privateCommunityName));
    for (const entry of config.manualEntries ?? []) {
      const item: PrivatePlanOrHome = {
        sourceUrl: entry.sourceUrl ?? source.toString(),
        privateName: entry.privateName ?? null,
        status: entry.status ?? null,
        price: entry.price ?? null,
        bedrooms: entry.bedrooms ?? null,
        bathrooms: entry.bathrooms ?? null,
        squareFeet: entry.squareFeet ?? null,
      };
      if (entry.kind === "plan") privateSnapshot.plans.push(item);
      else if (entry.kind === "home") privateSnapshot.homes.push(item);
      else {
        const text = entry.incentiveText ?? "";
        privateSnapshot.incentive = { sourceUrl: item.sourceUrl, text, facts: parsePromotionalRate(text) };
      }
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}

/** Generic registry. Callers select only by config.builder; no builder-specific network logic is exposed. */
export const DEAL_ADAPTERS: Readonly<Record<BuilderId, DealAdapter>> = {
  Chesmar: new ChesmarAdapter(),
  "M/I Homes": new MiHomesAdapter(),
  Manual: new ManualAdapter(),
};

/**
 * Fetches official public pages read-only and returns private operational data
 * plus a separately scrubbed public DTO. Never log or serialize result.private.
 */
export async function loadOfficialDeals(
  config: CommunitySourceConfig,
  options: AdapterRunOptions = {},
): Promise<DealAdapterResult> {
  return DEAL_ADAPTERS[config.builder].load(config, options);
}
