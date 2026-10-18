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
  /** Optional official M/I incentive URL. Chesmar always uses its current /incentives/ page. */
  incentiveSourceUrl?: string;
  /** Explicit records for the Manual adapter. No network request is made for these. */
  manualEntries?: readonly ManualEntry[];
  /** Bounds sitemap/link discovery, not the complete M/I QMI catalog or its galleries. */
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
  | "missing_community_guid"
  | "inventory_fetch_failed"
  | "invalid_inventory_response"
  | "incomplete_inventory"
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
  rateKind: "promotional" | "fixed";
  /** Historical field name: the headline rate, including a full-term fixed offer. */
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
  kind: "community" | "plan" | "home" | "incentive" | "sitemap" | "inventory" | "manual";
  sourceUrl: string;
  privateName: string | null;
}

export interface PrivateGalleryImage {
  sourceUrl: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  srcSet: string | null;
}

export interface PrivatePlanOrHome {
  sourceUrl: string;
  privateName: string | null;
  status: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  /** M/I card/detail metadata: never copied into PublicPlanOrHome. */
  privateAddress?: string | null;
  privatePlanName?: string | null;
  previousPrice?: number | null;
  priceDrop?: number | null;
  readyNow?: boolean;
  moveInDate?: string | null;
  garage?: number | null;
  homesite?: string | null;
  geo?: { latitude: number; longitude: number } | null;
  gallery?: PrivateGalleryImage[];
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
    rateKind: "promotional" | "fixed";
    promotionalRatePercent: number;
    promotionalPeriod: string | null;
    followOnRatePercent: number | null;
    followOnPeriod: string | null;
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
  /** Whole-snapshot publication status; incentive holds do not imply a failed catalog. */
  ok: boolean;
  catalogOk: boolean;
  incentiveHoldReasons: DealHoldReason[];
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
const CHESMAR_INCENTIVES_URL = "https://www.chesmar.com/incentives/";
const MI_INVENTORY_PATH = "/sitecore/api/ssc/MIHomes-Project-Website-Api-Controllers/PlansQmi/";
const MAX_MI_CATALOG_ITEMS = 500;
const MAX_MI_CATALOG_PAGES = 170;

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
    catalogOk: false,
    incentiveHoldReasons: [],
    fetchedAt,
    private: privateSnapshot,
    public: { ...EMPTY_PUBLIC, holdReasons },
    holdReasons,
  };
}

function successfulResult(
  fetchedAt: string,
  privateSnapshot: PrivateDealSnapshot,
  converted: { snapshot: PublicDealSnapshot; catalogHolds: DealHoldReason[]; incentiveHolds: DealHoldReason[] },
): DealAdapterResult {
  const publicSnapshot = converted.snapshot;
  const holdReasons = uniqueReasons(publicSnapshot.holdReasons);
  return {
    ok: holdReasons.length === 0,
    catalogOk: converted.catalogHolds.length === 0,
    incentiveHoldReasons: uniqueReasons(converted.incentiveHolds),
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
  return url.protocol === "https:" && !url.port && !url.username && !url.password && url.hostname.toLowerCase() === expectedHost;
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
  expectedHost: string,
): Promise<{ ok: true; text: string } | { ok: false; redirectedOffOfficialHost: boolean }> {
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
    // `redirect: follow` is convenient for canonical paths but a followed
    // redirect is a fresh trust boundary. Native fetch exposes the final URL;
    // fixture Response objects leave it blank, so only a supplied final URL is
    // validated here.
    if (response.url) {
      const finalUrl = asUrl(response.url);
      if (!finalUrl || !sameOfficialHost(finalUrl, expectedHost)) return { ok: false, redirectedOffOfficialHost: true };
    }
    if (!response.ok) return { ok: false, redirectedOffOfficialHost: false };
    return { ok: true, text: await response.text() };
  } catch {
    // Do not include url in logs or errors: it is private source metadata.
    return { ok: false, redirectedOffOfficialHost: false };
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
  const numeric = compact.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    // Official MM/DD/YY campaign dates explicitly supply a year, not a scrape-year guess.
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    return validIsoDate(year, month, day);
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
  return validIsoDate(year, month, day);
}

function validIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
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
  const between = new RegExp(`\\b(?:purchase\\s+agreements?|contracts?|contract\\s+sales?)\\b[^.]{0,160}?(?:between\\s+|written\\s+|from\\s+)(${DEADLINE_DATE})\\s*,?\\s*(?:and|to|through|-)\\s+(${DEADLINE_DATE})`, "i").exec(text);
  if (between) return deadlineFromMatch(between[2]);
  const ending = new RegExp(`(?:purchase\\s+agreements?|contract(?:s|\\s+signing)?|offer)[^.]{0,90}?\\b(?:by|through|until)\\s+(${DEADLINE_DATE})`, "i").exec(text);
  return ending ? deadlineFromMatch(ending[1]) : null;
}

function findClosingDeadline(text: string): DeadlineFact | null {
  const pattern = new RegExp(`\\b(?:must\\s+)?close(?:\\s+on)?\\s+(?:by|(?:or\\s+)?before|no\\s+later\\s+than)\\s+(${DEADLINE_DATE})`, "gi");
  const matches = Array.from(text.matchAll(pattern));
  // Prefer the fully dated fine print over a shortened banner date when both exist.
  const match = matches.find((item) => /\b\d{4}$/.test(item[1])) ?? matches[0];
  return match ? deadlineFromMatch(match[1]) : null;
}

const DEADLINE_DATE = "(?:\\d{1,2}/\\d{1,2}/(?:\\d{4}|\\d{2})(?!\\d)|(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},?\\s+\\d{4})";

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
  const fixedHeadline = /(\d+(?:\.\d+)?)%\s*\(\s*\d+(?:\.\d+)?%\s*APR\s*\)\s*(?:FHA|VA|USDA|conventional|jumbo)\s+\d{1,2}(?:[- ]year|\s*yr)\s*,?\s*fixed[- ]rate/i.exec(text);
  const hasTemporaryRate = /\b(?:buydown|first[- ]year|year\s*1|temporarily|introductory)\b/i.test(text);
  const rateKind = fixedHeadline && !hasTemporaryRate ? "fixed" : "promotional";
  const promotionalRatePercent =
    (rateKind === "fixed" ? numericValue(fixedHeadline![1]) : null) ??
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
  const aprPercent = rateNear(text, /(\d+(?:\.\d+)?)%\s*(?:annual\s+percentage\s+rate|apr)\b/i) ??
    rateNear(text, /\bAPR\s*[:=]\s*(\d+(?:\.\d+)?)%/i);
  const repaymentTermYears = numberMatch(text, /\b(\d{1,2})(?:[- ]year|\s*yr)\s*,?\s*fixed(?:[- ]rate)?\b/i);
  const loanType =
    firstMatch(text, /\b(FHA|VA|USDA|conventional|jumbo)\s+\d{1,2}(?:[- ]year|\s*yr)\s*,?\s*fixed[- ]rate\b/i) ??
    firstMatch(text, /\b\d{1,2}[- ]year\s*,?\s*fixed(?:[- ]rate)?\s+(FHA|VA|USDA|conventional|jumbo)\s+loan\b/i) ??
    firstMatch(text, /\b(FHA|VA|USDA|conventional|jumbo)\s+loan\b/i);
  const downPaymentPercent = numberMatch(text, /(\d+(?:\.\d+)?)%\s+(?:minimum\s+)?down(?:\s+payment)?\b/i);
  const contractDeadline = findContractDeadline(text);
  const closingDeadline = findClosingDeadline(text);

  const holdReasons: DealHoldReason[] = [];
  if (promotionalRatePercent === null) holdReasons.push("missing_promotional_rate");
  if (aprPercent === null) holdReasons.push("missing_apr");
  if (!loanType) holdReasons.push("missing_loan_type");
  if (repaymentTermYears === null) holdReasons.push("missing_repayment_term");
  if (rateKind === "promotional") {
    if (!promotionalPeriod) holdReasons.push("missing_promotional_period");
    if (followOnRatePercent === null) holdReasons.push("missing_follow_on_rate");
    if (!followOnPeriod) holdReasons.push("missing_follow_on_period");
  }
  if (downPaymentPercent === null) holdReasons.push("missing_down_payment");
  if (!contractDeadline?.isoDate) holdReasons.push("missing_contract_deadline");
  if (!closingDeadline?.isoDate) holdReasons.push("missing_closing_deadline");

  return {
    normalizedText: text,
    rateKind,
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

interface HtmlElement {
  tag: string;
  attributes: Record<string, string>;
  children: HtmlElement[];
  contentStart: number;
  contentEnd: number;
}

/** Limited server-only tree: quoted >/<, nested same-name elements, void tags and raw scripts. */
function parseHtmlElements(html: string): HtmlElement | null {
  if (html.length > 8_000_000) return null;
  const root: HtmlElement = { tag: "root", attributes: {}, children: [], contentStart: 0, contentEnd: html.length };
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(html))) {
    const token = match[0];
    const tagMatch = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/i.exec(token);
    if (!tagMatch) continue;
    const tag = tagMatch[2].toLowerCase();
    if (tagMatch[1]) {
      const index = stack.findLastIndex((element) => element.tag === tag);
      if (index > 0) {
        while (stack.length > index) stack.pop()!.contentEnd = match.index;
      }
      continue;
    }
    if (++count > 100_000 || stack.length > 128) return null;
    const attributes: Record<string, string> = Object.create(null);
    const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const attributeText = token.slice(tagMatch[0].length, token.length - 1);
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(attributeText))) {
      const name = attribute[1].toLowerCase();
      if (!(name in attributes)) attributes[name] = decodeHtmlEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    const element: HtmlElement = { tag, attributes, children: [], contentStart: tokens.lastIndex, contentEnd: html.length };
    stack[stack.length - 1].children.push(element);
    if (["script", "style", "textarea", "title"].includes(tag)) {
      const closing = new RegExp(`</${tag}\\s*>`, "gi");
      closing.lastIndex = tokens.lastIndex;
      const end = closing.exec(html);
      if (!end) return null;
      element.contentEnd = end.index;
      tokens.lastIndex = closing.lastIndex;
    } else if (!voidTags.has(tag) && !/\/\s*>$/.test(token)) stack.push(element);
    else element.contentEnd = tokens.lastIndex;
  }
  return root;
}

function descendants(element: HtmlElement): HtmlElement[] {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function elementClass(element: HtmlElement, token: string): boolean {
  return (element.attributes.class ?? "").split(/\s+/).includes(token);
}

function elementText(element: HtmlElement, html: string): string {
  return htmlToText(html.slice(element.contentStart, element.contentEnd));
}

function classText(elements: readonly HtmlElement[], html: string, token: string): string | null {
  const element = elements.find((item) => elementClass(item, token));
  return element ? elementText(element, html) || null : null;
}

function jsonLdObjects(elements: readonly HtmlElement[], html: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  function collect(value: unknown): void {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      objects.push(object);
      if (Array.isArray(object["@graph"])) object["@graph"].forEach(collect);
    }
  }
  for (const element of elements) {
    if (element.tag !== "script" || element.attributes.type?.toLowerCase() !== "application/ld+json") continue;
    const json = html.slice(element.contentStart, element.contentEnd).trim();
    try { collect(JSON.parse(json)); } catch {
      try { collect(JSON.parse(decodeHtmlEntities(json))); } catch { /* Invalid metadata is not a Product. */ }
    }
  }
  return objects;
}

function schemaType(object: Record<string, unknown>, type: string): boolean {
  return object["@type"] === type || (Array.isArray(object["@type"]) && object["@type"].includes(type));
}

function schemaNumber(value: unknown): number | null {
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return schemaNumber(object.value ?? object.minValue);
  }
  return typeof value === "number" || typeof value === "string" ? numericValue(String(value)) : null;
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

function chesmarGallery(sourceUrl: string, html: string): PrivateGalleryImage[] {
  const result = new Map<string, PrivateGalleryImage>();
  const srcPattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = srcPattern.exec(html)) !== null) {
    const url = absoluteUrl(match[1], new URL(sourceUrl));
    if (!url || !["www.chesmar.com", "chesmar.com", "images.ctfassets.net", "cdn.sanity.io"].includes(url.hostname.toLowerCase())) continue;
    if (/logo|icon|avatar|thumbnail/i.test(url.pathname)) continue;
    result.set(url.toString(), { sourceUrl: url.toString(), caption: null, width: null, height: null, srcSet: null });
  }
  return Array.from(result.values()).slice(0, 12);
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
    gallery: chesmarGallery(sourceUrl, html),
  };
}

function parseSitemapUrls(xml: string): string[] | null {
  // A branded error page can still be HTTP 200. Do not interpret it as a
  // genuine empty inventory sitemap. Both documents used by this adapter are
  // URL sets, so reject any other payload before extracting incidental <loc>s.
  if (!/^\s*(?:<\?xml\b[^>]*>\s*)?<urlset\b[^>]*>/i.test(xml) || !/<\/urlset\s*>\s*$/i.test(xml)) return null;
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
  const builderTerms = config.builder === "M/I Homes" ? ["M/I Homes", "M/I Financial"] : config.builder === "Chesmar" ? ["Chesmar Homes", "HomeAmerican Mortgage Corporation", "HomeAmerican Mortgage", "HMC"] : [];
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
  // Incentive text can originate from a Manual review entry as well as parsed
  // HTML. Normalize it as text first so markup and executable-content tags do
  // not become a public DTO. Public offers do not need outbound source links;
  // reject rather than trying to redact an arbitrary URL.
  const scrubbed = scrubPrivateNames(htmlToText(input), allTerms, { planField });
  if (!scrubbed || /\b(?:https?:\/\/|www\.)\S+/i.test(scrubbed)) return null;
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
    (facts.rateKind === "promotional" && (!facts.promotionalPeriod || facts.followOnRatePercent === null || !facts.followOnPeriod)) ||
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
      rateKind: facts.rateKind,
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

function makePublicSnapshot(privateSnapshot: PrivateDealSnapshot, config: CommunitySourceConfig, incentiveHolds: readonly DealHoldReason[] = []): { snapshot: PublicDealSnapshot; catalogHolds: DealHoldReason[]; incentiveHolds: DealHoldReason[] } {
  const discoveredNames = [...privateSnapshot.plans, ...privateSnapshot.homes].flatMap((item) => [item.privateName, item.privateAddress, item.privatePlanName].filter((name): name is string => Boolean(name)));
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
  const heldIncentiveReasons = uniqueReasons([...incentiveHolds, ...incentive.reasons]);
  return {
    snapshot: { plans, homes, incentive: heldIncentiveReasons.length ? null : incentive.incentive, holdReasons: uniqueReasons([...reasons, ...heldIncentiveReasons]) },
    catalogHolds: uniqueReasons(reasons),
    incentiveHolds: heldIncentiveReasons,
  };
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
  expectedHost: string,
): Promise<DealHoldReason[]> {
  const results = await mapWithConcurrency(urls, 4, async (url) => {
    const page = await getDocument(url, fetcher, "text/html,application/xhtml+xml", expectedHost);
    if (!page.ok) {
      const hold: DealHoldReason = page.redirectedOffOfficialHost ? "unsupported_official_host" : "detail_fetch_failed";
      return { hold, property: null };
    }
    if (!containsExpectedDetailContainer(page.text)) return { hold: "expected_detail_container_not_found" as const, property: null };
    const property = parsePrivateProperty(url, page.text);
    // A plan or home record must contain at least one first-party property
    // fact; an arbitrary branded detail page is not a successful discovery.
    if (property.price === null && property.bedrooms === null && property.bathrooms === null && property.squareFeet === null) {
      return { hold: "expected_detail_container_not_found" as const, property: null };
    }
    return { hold: null, property };
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

function chesmarFhaIncentiveText(html: string): string | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const elements = descendants(root);
  const headline = elements
    .filter((element) => ["strong", "b", "h1", "h2", "p"].includes(element.tag))
    .map((element) => elementText(element, html))
    .filter((text) => /\d+(?:\.\d+)?%\s*\(\s*\d+(?:\.\d+)?%\s*APR\s*\)\s*FHA\s+\d{1,2}(?:[- ]year|\s*yr)\s*,?\s*fixed[- ]rate/i.test(text))
    .sort((a, b) => a.length - b.length)[0];
  if (!headline) return null;
  const disclosure = elements
    .filter((element) => ["small", "em", "p"].includes(element.tag))
    .map((element) => elementText(element, html))
    .filter((text) => /\*\s*Loan promotions/i.test(text) && /fixed[- ]rate FHA loan/i.test(text))
    .sort((a, b) => a.length - b.length)[0] ?? "";
  const start = disclosure.search(/\*\s*Loan promotions/i);
  const fhaTerms = start < 0 ? "" : disclosure.slice(start).split(/\*{2,}\s*Loan promotions/i)[0];
  // Exclude the conventional/VA footnotes and unrelated lender licensing/navigation.
  return normalizeIncentiveText(`${headline} ${fhaTerms}`);
}

async function fetchOfficialIncentive(
  url: URL,
  fetcher: HtmlFetcher,
  privateSnapshot: PrivateDealSnapshot,
  expectedHost: string,
  chesmar = false,
): Promise<DealHoldReason[]> {
  const page = await getDocument(url.toString(), fetcher, "text/html,application/xhtml+xml", expectedHost);
  if (!page.ok) return [page.redirectedOffOfficialHost ? "unsupported_official_host" : "incentive_fetch_failed"];
  if (!containsExpectedIncentiveContainer(page.text)) return ["expected_incentive_container_not_found"];
  const text = chesmar ? chesmarFhaIncentiveText(page.text) : htmlToText(page.text);
  if (!text) return ["expected_incentive_container_not_found"];
  privateSnapshot.pages.push(sourcePage("incentive", url.toString(), extractFirstHeading(page.text)));
  privateSnapshot.incentive = { sourceUrl: url.toString(), text, facts: parsePromotionalRate(text) };
  return [];
}

class ChesmarAdapter implements DealAdapter {
  readonly builder = "Chesmar" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const configuredCommunity = asUrl(config.sourceUrl);
    if (!configuredCommunity) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(configuredCommunity, CHESMAR_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const community = configuredCommunity;
    const fetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", CHESMAR_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    if (!containsExpectedChesmarCommunityContainer(page.text)) {
      return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    }

    const sitemapResults = await mapWithConcurrency(CHESMAR_SITEMAPS, 2, async (sitemapUrl) => ({
      sitemapUrl,
      page: await getDocument(sitemapUrl, fetcher, "application/xml,text/xml;q=0.9,*/*;q=0.1", CHESMAR_HOST),
    }));
    const failedSitemap = sitemapResults.find((result) => !result.page.ok);
    if (failedSitemap && !failedSitemap.page.ok) {
      return failedResult(config, fetchedAt, privateSnapshot, [failedSitemap.page.redirectedOffOfficialHost ? "unsupported_official_host" : "sitemap_fetch_failed"]);
    }
    for (const sitemap of sitemapResults) {
      privateSnapshot.pages.push(sourcePage("sitemap", sitemap.sitemapUrl, null));
    }

    const parsedSitemaps = sitemapResults.map((result) => result.page.ok ? parseSitemapUrls(result.page.text) : null);
    if (parsedSitemaps.some((sitemap) => sitemap === null)) {
      return failedResult(config, fetchedAt, privateSnapshot, ["sitemap_fetch_failed"]);
    }
    const candidates = parsedSitemaps.flatMap((sitemap) => sitemap ?? []);
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
      ...(await fetchDiscoveredProperties(distinctPlanUrls, "plan", fetcher, privateSnapshot, CHESMAR_HOST)),
      ...(await fetchDiscoveredProperties(distinctHomeUrls, "home", fetcher, privateSnapshot, CHESMAR_HOST)),
    ];
    if (detailHolds.length > 0) return failedResult(config, fetchedAt, privateSnapshot, detailHolds);

    // Ignore stale configured /campaigns/... URLs: only this official page has the current window.
    const incentiveHolds = await fetchOfficialIncentive(new URL(CHESMAR_INCENTIVES_URL), fetcher, privateSnapshot, CHESMAR_HOST, true);
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
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

function miCommunityGuid(html: string): string | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const elements = descendants(root);
  const inventoryMarker = elements.find((element) => element.attributes.id?.toLowerCase() === "pqmb");
  const values = [
    inventoryMarker?.attributes["data-guid"],
    ...elements.map((element) => element.attributes["data-community-guid"]),
    ...elements.filter((element) => element.attributes.id?.toLowerCase() === "itemid").map((element) => element.attributes.value),
  ];
  for (const value of values) {
    if (!value) continue;
    let decoded: string;
    try { decoded = decodeURIComponent(value).replace(/^\{|\}$/g, ""); } catch { continue; }
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(decoded)) return decoded.toLowerCase();
  }
  return null;
}

function miProductUrl(product: Record<string, unknown>, community: URL, type: "homes" | "plans" | "models"): URL | null {
  if (!schemaType(product, type === "plans" ? "ProductModel" : "Product")) return null;
  if (typeof product.url !== "string") return null;
  const url = absoluteUrl(product.url, community);
  if (!url || !sameOfficialHost(url, MI_HOST) || !(type === "plans" ? isMiPlan(url, community) : isMiHome(url, community))) return null;
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function miCardProperty(card: HtmlElement, html: string, product: Record<string, unknown>, url: URL, type: "homes" | "plans" | "models"): PrivatePlanOrHome {
  const elements = descendants(card);
  const meta = new Map<string, string>();
  for (const element of elements.filter((item) => elementClass(item, "home-card-meta-item"))) {
    const value = descendants(element).find((item) => elementClass(item, "home-card-meta-value"));
    if (!value) continue;
    const label = htmlToText(html.slice(element.contentStart, value.contentStart).replace(/<[^>]*>$/, "")).toLowerCase();
    meta.set(label, elementText(value, html));
  }
  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const offer = offers && typeof offers === "object" ? offers as Record<string, unknown> : {};
  const price = extractPrice(classText(elements, html, "home-card-price-new") ?? "") ?? schemaNumber(offer.price) ??
    extractPrice(classText(elements, html, "home-card-price") ?? "");
  const previousPrice = extractPrice(classText(elements, html, "home-card-price-old") ?? "");
  const name = typeof product.name === "string" ? normalizeWhitespace(decodeHtmlEntities(product.name)) : null;
  const address = classText(elements, html, "home-card-name") ?? name;
  const moveInDate = meta.get("estimated move in date") ?? meta.get("estimated move-in date") ?? null;
  const readyNow = /\bready\s+now\b/i.test(classText(elements, html, "home-card__flags") ?? moveInDate ?? "");
  const fullBaths = schemaNumber(product.numberOfFullBathrooms);
  const partialBaths = schemaNumber(product.numberOfPartialBathrooms);
  const geo = product.geo && typeof product.geo === "object" ? product.geo as Record<string, unknown> : {};
  const latitude = schemaNumber(geo.latitude);
  const longitude = schemaNumber(geo.longitude);
  return {
    sourceUrl: url.toString(),
    privateName: name ?? address,
    status: /\/(?:SoldOut|OutOfStock)$/i.test(String(offer.availability ?? "")) ? "Sold" : type === "plans" ? null : type === "models" ? "Model For Tour" : readyNow ? "Available Now" : "Quick Move-In",
    price,
    previousPrice,
    priceDrop: previousPrice !== null && price !== null && previousPrice > price ? previousPrice - price : null,
    bedrooms: schemaNumber(meta.get("bed") ?? meta.get("beds")) ?? schemaNumber(product.numberOfBedrooms),
    bathrooms: schemaNumber(meta.get("bath") ?? meta.get("baths")) ?? (fullBaths === null ? null : fullBaths + (partialBaths ?? 0) / 2),
    squareFeet: schemaNumber(meta.get("sq ft")) ?? schemaNumber(product.floorSize),
    privateAddress: type === "plans" ? null : address,
    privatePlanName: type === "plans" ? name : meta.get("plan") ?? null,
    readyNow,
    moveInDate,
    garage: schemaNumber(meta.get("garage")),
    homesite: meta.get("homesite") ?? null,
    geo: latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null,
    gallery: [],
  };
}

async function fetchMiCatalog(
  community: URL,
  guid: string,
  type: "homes" | "plans" | "models",
  fetcher: HtmlFetcher,
  privateSnapshot: PrivateDealSnapshot,
): Promise<{ properties: PrivatePlanOrHome[]; holds: DealHoldReason[] }> {
  const properties = new Map<string, PrivatePlanOrHome>();
  let expectedTotal: number | null = null;
  let offset = 0;
  for (let pageIndex = 0; pageIndex < MAX_MI_CATALOG_PAGES; pageIndex++) {
    const url = new URL(MI_INVENTORY_PATH, community);
    url.searchParams.set("id", `{${guid}}`);
    url.searchParams.set("type", type);
    url.searchParams.set("items", String(offset));
    const response = await getDocument(url.toString(), fetcher, "application/json", MI_HOST);
    if (!response.ok) return { properties: [], holds: ["inventory_fetch_failed"] };
    let payload: unknown;
    try { payload = JSON.parse(response.text); } catch { return { properties: [], holds: ["invalid_inventory_response"] }; }
    if (!payload || typeof payload !== "object") return { properties: [], holds: ["invalid_inventory_response"] };
    const { TotalItems: total, Html: html } = payload as Record<string, unknown>;
    if (typeof total !== "number" || !Number.isInteger(total) || total < 0 || total > MAX_MI_CATALOG_ITEMS || typeof html !== "string") {
      return { properties: [], holds: ["invalid_inventory_response"] };
    }
    if (expectedTotal !== null && total !== expectedTotal) return { properties: [], holds: ["incomplete_inventory"] };
    expectedTotal = total;
    const root = parseHtmlElements(html);
    if (!root) return { properties: [], holds: ["invalid_inventory_response"] };
    const elements = descendants(root);
    const cards = elements.filter((element) => elementClass(element, "home-card"));
    if (total === 0 && cards.length === 0 && (html.trim() === "" || elements.some((element) => elementClass(element, "row")))) {
      privateSnapshot.pages.push(sourcePage("inventory", url.toString(), null));
      return { properties: [], holds: [] };
    }
    if (total === 0) return { properties: [], holds: ["invalid_inventory_response"] };
    const before = properties.size;
    for (const card of cards) {
      const products = jsonLdObjects(descendants(card), html).filter((product) => schemaType(product, type === "plans" ? "ProductModel" : "Product"));
      if (products.length !== 1) return { properties: [], holds: ["invalid_inventory_response"] };
      const product = products[0];
      const productUrl = miProductUrl(product, community, type);
      if (!productUrl) return { properties: [], holds: ["invalid_inventory_response"] };
      if (!properties.has(productUrl.toString())) properties.set(productUrl.toString(), miCardProperty(card, html, product, productUrl, type));
    }
    privateSnapshot.pages.push(sourcePage("inventory", url.toString(), null));
    if (properties.size > total) return { properties: [], holds: ["invalid_inventory_response"] };
    if (properties.size === total) return { properties: Array.from(properties.values()), holds: [] };
    // A missing card container, malformed Product, or stuck endpoint is never a zero-homes update.
    if (properties.size === before) return { properties: [], holds: ["incomplete_inventory"] };
    offset = offset === 0 ? 5 : offset + 3;
  }
  return { properties: [], holds: ["incomplete_inventory"] };
}

function officialMiImage(value: string, base: URL): URL | null {
  const url = absoluteUrl(value, base);
  return url && url.protocol === "https:" && [MI_HOST, "dam.mihomes.com", "cdn.mihomes.com"].includes(url.hostname.toLowerCase()) ? url : null;
}

function miDetailGallery(html: string, property: PrivatePlanOrHome): PrivateGalleryImage[] | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const elements = descendants(root);
  const base = new URL(property.sourceUrl);
  const product = jsonLdObjects(elements, html).find((item) => {
    if (!schemaType(item, "Product") || typeof item.url !== "string") return false;
    const url = absoluteUrl(item.url, base);
    return url?.hostname === base.hostname && normalizePathname(url.pathname) === normalizePathname(base.pathname);
  });
  const slides = elements.filter((element) => elementClass(element, "gallery-slide-container"));
  const images = new Map<string, PrivateGalleryImage>();
  for (const slide of slides) {
    const image = descendants(slide).find((element) => element.tag === "img");
    if (!image) continue;
    const url = officialMiImage(image.attributes.src ?? image.attributes["data-src"] ?? "", base);
    if (!url || images.has(url.toString())) continue;
    images.set(url.toString(), {
      sourceUrl: url.toString(),
      caption: slide.attributes["data-caption"] || image.attributes.alt || null,
      width: schemaNumber(image.attributes.width),
      height: schemaNumber(image.attributes.height),
      srcSet: image.attributes.srcset ?? null,
    });
  }
  const schemaImages = product ? (Array.isArray(product.image) ? product.image : [product.image]) : [];
  for (const image of schemaImages) {
    const source = typeof image === "string" ? image : image && typeof image === "object" ? (image as Record<string, unknown>).url : null;
    if (typeof source !== "string") continue;
    const url = officialMiImage(source, base);
    if (url && !images.has(url.toString())) images.set(url.toString(), { sourceUrl: url.toString(), caption: null, width: null, height: null, srcSet: null });
  }
  return product || slides.length ? Array.from(images.values()) : null;
}

async function fetchMiHomeGalleries(properties: readonly PrivatePlanOrHome[], fetcher: HtmlFetcher, privateSnapshot: PrivateDealSnapshot): Promise<DealHoldReason[]> {
  const results = await mapWithConcurrency(properties, 4, async (property) => {
    const page = await getDocument(property.sourceUrl, fetcher, "text/html,application/xhtml+xml", MI_HOST);
    if (!page.ok) return { property, gallery: null, hold: "detail_fetch_failed" as const };
    const gallery = miDetailGallery(page.text, property);
    return { property, gallery, hold: gallery === null ? "expected_detail_container_not_found" as const : null };
  });
  const holds: DealHoldReason[] = [];
  for (const result of results) {
    if (result.hold) holds.push(result.hold);
    else {
      result.property.gallery = result.gallery!;
      privateSnapshot.pages.push(sourcePage("home", result.property.sourceUrl, result.property.privateName));
    }
  }
  return uniqueReasons(holds);
}

class MiHomesAdapter implements DealAdapter {
  readonly builder = "M/I Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const configuredCommunity = asUrl(config.sourceUrl);
    if (!configuredCommunity) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(configuredCommunity, MI_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const community = configuredCommunity;
    const fetcher = options.fetcher ?? fetch;
    const communityPage = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", MI_HOST);
    if (!communityPage.ok) return failedResult(config, fetchedAt, privateSnapshot, [communityPage.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    if (!containsExpectedMiCommunityContainer(communityPage.text)) {
      return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    }

    const discovered = discoverMiCommunityUrls(communityPage.text, community);
    const guid = miCommunityGuid(communityPage.text);
    if (!guid) return failedResult(config, fetchedAt, privateSnapshot, ["missing_community_guid"]);
    // maxDetailPages must not truncate this catalog: an incomplete snapshot could mark real homes sold.
    const homes = await fetchMiCatalog(community, guid, "homes", fetcher, privateSnapshot);
    if (homes.holds.length) return failedResult(config, fetchedAt, privateSnapshot, homes.holds);
    const plans = await fetchMiCatalog(community, guid, "plans", fetcher, privateSnapshot);
    if (plans.holds.length) return failedResult(config, fetchedAt, privateSnapshot, plans.holds);
    privateSnapshot.homes = homes.properties;
    privateSnapshot.plans = plans.properties;
    for (const plan of plans.properties) privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privateName));
    const detailHolds = await fetchMiHomeGalleries(homes.properties, fetcher, privateSnapshot);
    if (detailHolds.length > 0) return failedResult(config, fetchedAt, privateSnapshot, detailHolds);

    const configuredIncentive = config.incentiveSourceUrl ? asUrl(config.incentiveSourceUrl) : null;
    const incentiveUrl = config.incentiveSourceUrl
      ? configuredIncentive && sameOfficialHost(configuredIncentive, MI_HOST) ? configuredIncentive : null
      : discovered.incentiveUrls[0] ? asUrl(discovered.incentiveUrls[0]) : null;
    const incentiveHolds: DealHoldReason[] = config.incentiveSourceUrl && !incentiveUrl ? [configuredIncentive ? "unsupported_official_host" : "invalid_source_url"] : [];
    if (incentiveUrl) {
      incentiveHolds.push(...await fetchOfficialIncentive(incentiveUrl, fetcher, privateSnapshot, MI_HOST));
    }

    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
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
