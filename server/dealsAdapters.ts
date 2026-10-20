import { dealScrubTerms, emptyDealScrubConfig, hasPrivateTerm, normalizedText, parseDealScrubConfig, scrubPrivateNames, type DealScrubConfig } from "../shared/deals";
import { applyScrubExclusions } from "./dealsScrub";
import { PerryHomesAdapter } from "./dealsAdapters.perry";
import { DrHortonAdapter } from "./dealsAdapters.drhorton";
import { PulteGroupAdapter } from "./dealsAdapters.pultegroup";
import { HomefinitiAdapter } from "./dealsAdapters.homefiniti";
import { DavidsonAdapter } from "./dealsAdapters.davidson";
import { HighlandAdapter } from "./dealsAdapters.highland";
import { CenturyAdapter } from "./dealsAdapters.century";
import { KbHomeAdapter } from "./dealsAdapters.kbhome";
import { TollBrothersAdapter } from "./dealsAdapters.toll";
import { DavidWeekleyAdapter } from "./dealsAdapters.weekley";
import { AshtonWoodsAdapter } from "./dealsAdapters.ashton";
import { LgiHomesAdapter } from "./dealsAdapters.lgi";
import { SitterleAdapter } from "./dealsAdapters.sitterle";
import { ScottFelderAdapter } from "./dealsAdapters.scottfelder";
import { DrbHomesAdapter } from "./dealsAdapters.drb";
import { StarlightAdapter } from "./dealsAdapters.starlight";
import { LegendHomesAdapter } from "./dealsAdapters.legend";
import { DreesAdapter } from "./dealsAdapters.drees";
import { ViewHomesAdapter } from "./dealsAdapters.viewhomes";
import { TexasHomesAdapter } from "./dealsAdapters.texashomes";
import { HakesBrothersAdapter } from "./dealsAdapters.hakes";
import { BeazerAdapter } from "./dealsAdapters.beazer";
import { LennarAdapter } from "./dealsAdapters.lennar";

/**
 * Official, read-only builders supported by this module.  These display names
 * deliberately exist only in the private/internal half of an adapter result.
 */
export type BuilderId = "Chesmar" | "M/I Homes" | "Perry Homes" | "D.R. Horton" | "Pulte" | "Centex" | "Del Webb" | "First America Homes" | "Coventry Homes" | "Davidson Homes" | "Highland Homes" | "Century Communities" | "KB Home" | "Toll Brothers" | "David Weekley Homes" | "Ashton Woods" | "LGI Homes" | "Sitterle Homes" | "Scott Felder Homes" | "DRB Homes" | "Starlight Homes" | "Legend Homes" | "Drees Custom Homes" | "View Homes" | "Texas Homes" | "Hakes Brothers" | "Beazer Homes" | "Lennar" | "Manual";

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
  /** Categorized private configuration; legacy flat terms remain supported. */
  scrubConfig?: DealScrubConfig;
  /** Admin-excluded false positives: never treated as private, even when a page discovers them again. */
  excludedTerms?: readonly string[];
  /** Explicit reviewed plan slugs (not arbitrary child pages). */
  planSlugs?: readonly string[];
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
  /** A home card whose status could not be read: a layout change holds the catalog instead of marking homes sold. */
  | "unlabelled_home_status"
  /** The reader itself threw: nothing was published or marked sold; the admin hears about it instead of a silent retry loop. */
  | "refresh_failed"
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
  | "missing_closing_deadline"
  /** The offer is an adjustable-rate loan (an ARM): the headline rate is a starting rate, so the admin reads the terms before it shows. */
  | "adjustable_rate";

export interface DeadlineFact {
  /** What the official page said; it is not guessed or expanded. */
  raw: string;
  /** ISO date only when the official text supplied an unambiguous year. */
  isoDate: string | null;
}

export interface PromotionalRateFacts {
  normalizedText: string;
  rateKind: "promotional" | "fixed" | "none";
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
  /** First-party facts and discoveries remain operational/server-only. */
  communityFacts?: { fromPrice: number | null; schoolDistrict: string | null; lotSizes: string | null; amenities: string[] };
  discoveredScrubConfig?: DealScrubConfig;
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
    rateKind: "promotional" | "fixed" | "none";
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
export const PERRY_HOST = "www.perryhomes.com";
export const DRHORTON_HOST = "www.drhorton.com";
/** PulteGroup's three brands share one platform; each brand has its own host. */
export const PULTEGROUP_HOSTS = { Pulte: "www.pulte.com", Centex: "www.centex.com", "Del Webb": "www.delwebb.com" } as const;
/** Builders on the Homefiniti site platform (schema.org home records on the community page); each has its own host. */
export const HOMEFINITI_HOSTS = { "First America Homes": "www.firstamericahomes.com", "Coventry Homes": "www.coventryhomes.com" } as const;
export const DAVIDSON_HOST = "www.davidsonhomes.com";
export const HIGHLAND_HOST = "www.highlandhomes.com";
export const CENTURY_HOST = "www.centurycommunities.com";
export const KBHOME_HOST = "www.kbhome.com";
export const TOLL_HOST = "www.tollbrothers.com";
export const WEEKLEY_HOST = "www.davidweekleyhomes.com";
export const ASHTON_HOST = "www.ashtonwoods.com";
export const LGI_HOST = "www.lgihomes.com";
export const SITTERLE_HOST = "www.sitterlehomes.com";
export const SCOTTFELDER_HOST = "www.scottfelderhomes.com";
export const DRB_HOST = "www.drbhomes.com";
export const STARLIGHT_HOST = "www.starlighthomes.com";
export const LEGEND_HOST = "www.livelegendhomes.com";
export const DREES_HOST = "www.dreeshomes.com";
/** View Homes serves its site from the apex host (www redirects to it). */
export const VIEWHOMES_HOST = "yourviewhome.com";
export const TEXASHOMES_HOST = "www.texas-homes.com";
export const HAKES_HOST = "www.hakesbrothers.com";
export const BEAZER_HOST = "www.beazer.com";
export const LENNAR_HOST = "www.lennar.com";
/** The exact official hosts each adapter accepts; apex or other subdomains hold every run. */
export const OFFICIAL_BUILDER_HOSTS: Readonly<Record<Exclude<BuilderId, "Manual">, string>> = { Chesmar: CHESMAR_HOST, "M/I Homes": MI_HOST, "Perry Homes": PERRY_HOST, "D.R. Horton": DRHORTON_HOST, ...PULTEGROUP_HOSTS, ...HOMEFINITI_HOSTS, "Davidson Homes": DAVIDSON_HOST, "Highland Homes": HIGHLAND_HOST, "Century Communities": CENTURY_HOST, "KB Home": KBHOME_HOST, "Toll Brothers": TOLL_HOST, "David Weekley Homes": WEEKLEY_HOST, "Ashton Woods": ASHTON_HOST, "LGI Homes": LGI_HOST, "Sitterle Homes": SITTERLE_HOST, "Scott Felder Homes": SCOTTFELDER_HOST, "DRB Homes": DRB_HOST, "Starlight Homes": STARLIGHT_HOST, "Legend Homes": LEGEND_HOST, "Drees Custom Homes": DREES_HOST, "View Homes": VIEWHOMES_HOST, "Texas Homes": TEXASHOMES_HOST, "Hakes Brothers": HAKES_HOST, "Beazer Homes": BEAZER_HOST, Lennar: LENNAR_HOST };
/** True when a reader exists for this builder's official site (new builders get one at a time). */
export function hasBuilderReader(builder: string): builder is Exclude<BuilderId, "Manual"> {
  return Object.prototype.hasOwnProperty.call(OFFICIAL_BUILDER_HOSTS, builder);
}
export function officialHostFor(builder: string): string | null {
  return hasBuilderReader(builder) ? OFFICIAL_BUILDER_HOSTS[builder] : null;
}
const CHESMAR_SITEMAP_INDEX = "https://www.chesmar.com/sitemap.xml";
const DEFAULT_DETAIL_LIMIT = 24;
/** Safety cap only: a community whose plan and home pages exceed it is held, never truncated. */
export const MAX_DETAIL_LIMIT = 60;
/** Builder pages have answered in 5 to 10 seconds from the cloud; nightly runs saw longer. */
const FETCH_TIMEOUT_MS = 45_000;
/** One further attempt after a network failure, timeout or server-side error. */
const FETCH_RETRY_DELAY_MS = 1_500;
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

export function emptyPrivate(config: CommunitySourceConfig): PrivateDealSnapshot {
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

export function failedResult(
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

export function successfulResult(
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

export function asUrl(value: string): URL | null {
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

/** A URL path for comparison: percent escapes decoded ("%27" and "'" are one spelling), lower case; an undecodable path is kept as written. */
export function comparablePath(pathname: string): string {
  try { return decodeURIComponent(pathname).toLowerCase(); } catch { return pathname.toLowerCase(); }
}

export function sameOfficialHost(url: URL, expectedHost: string): boolean {
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

export function sourcePage(kind: PrivateSourcePage["kind"], sourceUrl: string, privateName: string | null): PrivateSourcePage {
  return { kind, sourceUrl, privateName };
}

/** Plain GET only. There are no form submissions, click goals, or browser automation here. */
export async function getDocument(
  url: string,
  fetcher: HtmlFetcher,
  accept: string,
  expectedHost: string,
): Promise<{ ok: true; text: string } | { ok: false; redirectedOffOfficialHost: boolean; /** The HTTP status of the last answer, null when none came. */ status: number | null }> {
  // A slow or briefly failing official site gets one more attempt; a redirect
  // off the official host or a definite client error does not.
  for (let attempt = 0; ; attempt++) {
    const result = await getDocumentOnce(url, fetcher, accept, expectedHost);
    if (result.ok || result.redirectedOffOfficialHost || !result.retryable || attempt >= 1) return result.ok ? result : { ok: false, redirectedOffOfficialHost: result.redirectedOffOfficialHost, status: result.status };
    await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
  }
}

/**
 * A read-only JSON query, for the few builder sites whose own pages load
 * their listings with a POST search (Drees). Same guards as a GET: official
 * host only, no credentials, no redirect off the host, one retry on a server
 * error. It is never a form: the body names a page or filter, nothing else.
 */
export async function postJsonDocument(
  url: string,
  fetcher: HtmlFetcher,
  body: Record<string, unknown>,
  expectedHost: string,
): Promise<{ ok: true; text: string } | { ok: false; redirectedOffOfficialHost: boolean; status: number | null }> {
  for (let attempt = 0; ; attempt++) {
    const result = await postJsonOnce(url, fetcher, body, expectedHost);
    if (result.ok || result.redirectedOffOfficialHost || !result.retryable || attempt >= 1) return result.ok ? result : { ok: false, redirectedOffOfficialHost: result.redirectedOffOfficialHost, status: result.status };
    await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
  }
}

async function postJsonOnce(
  url: string,
  fetcher: HtmlFetcher,
  body: Record<string, unknown>,
  expectedHost: string,
): Promise<{ ok: true; text: string } | { ok: false; redirectedOffOfficialHost: boolean; retryable: boolean; status: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const target = asUrl(url);
    if (!target || !sameOfficialHost(target, expectedHost)) return { ok: false, redirectedOffOfficialHost: true, retryable: false, status: null };
    // A POST is never followed through a redirect: the answer is the page's own or nothing.
    const response = await fetcher(target.toString(), {
      method: "POST", redirect: "manual", signal: controller.signal, body: JSON.stringify(body),
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "LifestyleDesignRealtyDeals/1.0 (read-only official-page parser)" },
    });
    if (response.url && !sameOfficialHost(new URL(response.url), expectedHost)) return { ok: false, redirectedOffOfficialHost: true, retryable: false, status: response.status };
    // A redirect answer, even on the official host, is refused (a POST is never replayed); only one off the host is reported as such.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      const target = location ? asUrl(new URL(location, url).toString()) : null;
      return { ok: false, redirectedOffOfficialHost: target !== null && !sameOfficialHost(target, expectedHost), retryable: false, status: response.status };
    }
    if (!response.ok) return { ok: false, redirectedOffOfficialHost: false, retryable: response.status === 429 || response.status >= 500, status: response.status };
    const text = await response.text();
    if (text.length > 8_000_000) return { ok: false, redirectedOffOfficialHost: false, retryable: false, status: response.status };
    return { ok: true, text };
  } catch {
    return { ok: false, redirectedOffOfficialHost: false, retryable: true, status: null };
  } finally {
    clearTimeout(timer);
  }
}

async function getDocumentOnce(
  url: string,
  fetcher: HtmlFetcher,
  accept: string,
  expectedHost: string,
): Promise<{ ok: true; text: string } | { ok: false; redirectedOffOfficialHost: boolean; retryable: boolean; status: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let target = asUrl(url);
    for (let hop = 0; hop <= 5; hop++) {
      if (!target || !sameOfficialHost(target, expectedHost)) return { ok: false, redirectedOffOfficialHost: true, retryable: false, status: null };
      const response = await fetcher(target.toString(), {
        method: "GET", redirect: "manual", signal: controller.signal,
        headers: { Accept: accept, "User-Agent": "LifestyleDesignRealtyDeals/1.0 (read-only official-page parser)" },
      });
      // Check BEFORE the next request; checking only Response.url is too late for SSRF.
      if (response.url && !sameOfficialHost(new URL(response.url), expectedHost)) return { ok: false, redirectedOffOfficialHost: true, retryable: false, status: response.status };
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        target = location ? absoluteUrl(location, target) : null;
        if (!target || !sameOfficialHost(target, expectedHost)) return { ok: false, redirectedOffOfficialHost: true, retryable: false, status: response.status };
        continue;
      }
      if (!response.ok) return { ok: false, redirectedOffOfficialHost: false, retryable: response.status === 429 || response.status >= 500, status: response.status };
      const text = await response.text();
      if (text.length > 8_000_000) return { ok: false, redirectedOffOfficialHost: false, retryable: false, status: response.status };
      return { ok: true, text };
    }
    return { ok: false, redirectedOffOfficialHost: false, retryable: false, status: null };
  } catch {
    // Do not include url in logs or errors: it is private source metadata.
    return { ok: false, redirectedOffOfficialHost: false, retryable: true, status: null };
  } finally {
    clearTimeout(timer);
  }
}

export function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    quot: '"',
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    copy: "©",
    reg: "®",
    trade: "™",
  };
  // A numeric entity past U+10FFFF is not a character; it is kept as written rather than throwing.
  const codePoint = (whole: string, code: number) => Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (whole, hex: string) => codePoint(whole, Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (whole, decimal: string) => codePoint(whole, Number.parseInt(decimal, 10)))
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
  // "between September 4 and September 30, 2026": the first date may leave its year to the second.
  const between = new RegExp(`\\b(?:purchase\\s+agreements?|contracts?|contract\\s+sales?)\\b[^.]{0,160}?(?:between\\s+|written\\s+|from\\s+)(${DEADLINE_DATE}|${MONTH_DAY})\\s*,?\\s*(?:and|to|through|-)\\s+(${DEADLINE_DATE})`, "i").exec(text);
  if (between) return deadlineFromMatch(between[2]);
  // The span between the contract words and the date must not run into the
  // closing clause, or "contract by October 18 and close by 12/31/26" would
  // take the closing date as the contract deadline.
  const ending = new RegExp(`(?:purchase\\s+agreements?|contract(?:s|\\s+signing)?|\\bsign(?:ed|ing)?\\b|offer)(?:(?!\\bclos)[^.]){0,90}?\\b(?:by|through|until)\\s+(${DEADLINE_DATE})`, "i").exec(text);
  return ending ? deadlineFromMatch(ending[1]) : null;
}

function findClosingDeadline(text: string): DeadlineFact | null {
  // "close by", "must close on or before", "closing by 11/30/2026", "close per contract by 12/07/2026".
  const pattern = new RegExp(`\\b(?:must\\s+)?clos(?:e|ing)(?:\\s+(?:on|per\\s+(?:the\\s+)?contract|escrow))?\\s+(?:by|(?:on\\s+or\\s+)?before|no\\s+later\\s+than)\\s+(${DEADLINE_DATE})`, "gi");
  const matches = Array.from(text.matchAll(pattern));
  // Prefer the fully dated fine print over a shortened banner date when both exist.
  const match = matches.find((item) => /\b\d{4}$/.test(item[1])) ?? matches[0];
  return match ? deadlineFromMatch(match[1]) : null;
}

const MONTH_DAY = "(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2}";
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
  // "2/1 Program … year one … year two" is a temporary buydown as surely as "buydown" is.
  // "year one/two" counts only as rate wording ("rate … for year one", "year one is N%"), not in an HOA-dues or warranty sentence.
  // Cash "applied toward a rate buydown" is a use of the cash, not a temporary rate.
  const hasTemporaryRate = /\b(?:(?<!\btowards?\s(?:an?\s)?(?:interest\s)?(?:rate\s)?)buy[- ]?down|first[- ]year|year\s*1|temporarily|introductory|\d\/\d\s+(?:program|rate\s+program))\b/i.test(text) || /\brate[^.!?]{0,60}\byear\s+(?:one|two)\b|\byear\s+(?:one|two)\s+is\s+\d+(?:\.\d+)?%/i.test(text);
  // "the rate for year one is 2% lower" names a discount, not a rate.
  const headline = rateNear(text, /\brate\s+(?:that\s+applies\s+)?(?:for|to|in|during)\s+(?:the\s+)?(?:first[- ]year|year\s*(?:1|one))\s+(?:is|of|:)?\s*(\d+(?:\.\d+)?)%(?!\s*(?:lower|less|below|off|decrease|reduction|discount|under))/i) ??
    rateNear(text, /(?:first[- ]year|year\s*1)[\s\S]{0,100}?(\d+(?:\.\d+)?)%(?!\s*(?:lower|less|below|off|decrease|reduction|discount|under))/i) ??
    rateNear(text, /(?:rates?\s+as\s+low\s+as|as\s+low\s+as|reduced\s+to)\s+(\d+(?:\.\d+)?)%/i) ??
    // "4.25% (6.051% APR)", "2.99% (APR 6.81%)", "4.99% [6.62% APR]", "4.990% (6.619% Annual Percentage Rate)", "5% Fixed / 5.805% APR", "4.99% interest rate".
    rateNear(text, /(\d+(?:\.\d+)?)%\s*(?:fixed\s*)?(?:[(\[]\s*\d+(?:\.\d+)?%\s*(?:APR|Annual\s+Percentage\s+Rate)|[(\[]\s*APR\s*\d+(?:\.\d+)?%|\/\s*\d+(?:\.\d+)?%\s*APR|(?:interest\s+)?rate\b)/i);
  const rateMentioned = headline !== null || /\b(?:interest\s+rates?|APR|buy[- ]?down)\b|\d+(?:\.\d+)?%\s*(?:fixed|financing)/i.test(text);
  const rateKind = !rateMentioned ? "none" : hasTemporaryRate ? "promotional" : "fixed";
  const promotionalRatePercent = headline;
  const promotionalPeriod = firstMatch(text, /\b(first[- ]year|year\s*1|year\s+one)\b/i) ?? firstMatch(text, /\b(for\s+year\s*\d+)\b/i);
  const followOnPeriod = firstMatch(text, /\b(years?\s*2\s*(?:-|to|through)\s*\d+|after\s+(?:the\s+)?first\s+year|(?:beginning|starting)\s+(?:in\s+)?year\s+(?:three|3|two|2)|years?\s+(?:three|3)\s+(?:onward|and\s+beyond|through\s+\d+))\b/i);
  // "5.25% (6.051% APR) for years 2-30" names its rate before the period, so
  // that trailing form is tried first. The forward look after the period stops
  // at down-payment or APR wording so "3.5% down" is never read as a rate.
  const followOnRatePercent = rateNear(text, /(\d+(?:\.\d+)?)%\s*(?:\([^)]{0,40}\)\s*)?(?:interest\s+rate\s*)?for\s+years?\s*2\b/i) ??
    rateNear(text, /(?:years?\s*2\s*(?:-|to|through)\s*\d+|after\s+(?:the\s+)?first\s+year|(?:beginning|starting)\s+(?:in\s+)?year\s+(?:three|3|two|2)|years?\s+(?:three|3)\s+(?:onward|and\s+beyond|through\s+\d+))(?:(?!\b(?:down|payments?|APR)\b)[\s\S]){0,80}?(\d+(?:\.\d+)?)%(?!\s*(?:minimum\s+)?down\b)/i);
  const aprPercent = rateNear(text, /(\d+(?:\.\d+)?)%\s*(?:annual\s+percentage\s+rate|apr)\b/i) ??
    rateNear(text, /\b(?:APR|ANNUAL\s+PERCENTAGE\s+RATE)\s*(?::|=|is)?\s*(\d+(?:\.\d+)?)%/i);
  // The term is read beside loan wording only ("30-year fixed", "30-YR Fixed FHA loan", "a term of 30 years"): "2 years of HOA dues" is not a term.
  const repaymentTermYears = numberMatch(text, /\b(\d{1,2})(?:[- ]?year|[- ]?yr)s?\b\.?[-,\s]*(?:fixed|mortgage|loan|term|financing|amortiz|fha\b|va\b|usda|conventional)/i) ??
    numberMatch(text, /\b(?:term|mortgage|loan|financing|fixed)\s+(?:of\s+|for\s+)?(\d{1,2})(?:[- ]?year|[- ]?yr)s?\b/i);
  const loanType = firstMatch(text, /\b(FHA|VA|USDA|conventional|jumbo)\b/i);
  const downPaymentPercent = numberMatch(text, /(\d+(?:\.\d+)?)%\s+(?:minimum\s+)?down(?:\s+payment)?\b/i) ?? (/\bno\s+down\s+payment\b/i.test(text) ? 0 : null);
  const contractDeadline = findContractDeadline(text);
  const closingDeadline = findClosingDeadline(text);
  // Repayment disclosures are required only when the text itself states terms:
  // an N-year or N yr term, payments, or a down payment. "first-year" alone is a
  // promotional period, not a repayment term.
  const triggersTerms = /\b(?:\d+[- ]year|\d+\s*yr|payments?|down\s+payment)\b/i.test(text);
  // The span must not run into the closing clause (as in the finder): "contracts … closing by 11/30" names a closing deadline only.
  const namesContractDeadline = /\b(?:contracts?|purchase\s+agreements?|contract\s+sales?|sign(?:ed|ing)?)\b(?:(?!\bclos)[^.]){0,100}\b(?:by|through|until|between|from|written)\b/i.test(text);
  const namesClosingDeadline = /\b(?:clos(?:e|ing))\b[^.]{0,35}\b(?:by|before|than|through)\b/i.test(text);
  const holdReasons: DealHoldReason[] = [];
  if (rateKind !== "none") {
    if (promotionalRatePercent === null) holdReasons.push("missing_promotional_rate");
    if (aprPercent === null) holdReasons.push("missing_apr");
    if (triggersTerms) {
      if (!loanType) holdReasons.push("missing_loan_type");
      if (repaymentTermYears === null) holdReasons.push("missing_repayment_term");
      if (downPaymentPercent === null) holdReasons.push("missing_down_payment");
    }
    if (rateKind === "promotional") {
      if (!promotionalPeriod) holdReasons.push("missing_promotional_period");
      if (followOnRatePercent === null) holdReasons.push("missing_follow_on_rate");
      if (!followOnPeriod) holdReasons.push("missing_follow_on_period");
    }
  }
  if (namesContractDeadline && !contractDeadline?.isoDate) holdReasons.push("missing_contract_deadline");
  if (namesClosingDeadline && !closingDeadline?.isoDate) holdReasons.push("missing_closing_deadline");
  // An adjustable-rate offer ("5/1 ARM", "adjustable rate mortgage") is never published as a plain rate without a look.
  if (rateKind !== "none" && (/\bARM\b/.test(text) || /\b\d{1,2}\/\d\s+arm\b|\badjustable[- ]rate|\brate\s+adjusts|\binitial\s+(?:interest\s+)?rate\b/i.test(text))) holdReasons.push("adjustable_rate");

  return {
    normalizedText: normalizedText(text),
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

export interface HtmlElement {
  tag: string;
  attributes: Record<string, string>;
  children: HtmlElement[];
  contentStart: number;
  contentEnd: number;
}

/** Limited server-only tree: quoted >/<, nested same-name elements, void tags and raw scripts. */
export function parseHtmlElements(html: string): HtmlElement | null {
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

export function descendants(element: HtmlElement): HtmlElement[] {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

export function elementClass(element: HtmlElement, token: string): boolean {
  return (element.attributes.class ?? "").split(/\s+/).includes(token);
}

export function elementText(element: HtmlElement, html: string): string {
  return htmlToText(html.slice(element.contentStart, element.contentEnd));
}

/**
 * The card around a home's link on a listing page: the nearest ancestor of the
 * link that holds a status element (by class token), its text, a struck-through
 * price in the same card (one or two levels up, where a platform splits badge
 * and prices), and any other class-named fields asked for. Null status when no
 * card holds the link.
 */
export function cardAroundLink(html: string, root: HtmlElement, path: string, options: { statusClasses: readonly string[]; maxStatusLength?: number; fields?: Readonly<Record<string, readonly string[]>>; otherHomePaths?: readonly string[] }): { status: string | null; previousPrice: number | null; fields: Record<string, string | null>; card: HtmlElement | null } {
  const all = descendants(root);
  const parents = new Map<HtmlElement, HtmlElement>();
  for (const element of all) for (const child of element.children) parents.set(child, element);
  const normalized = path.replace(/\/+$/, "");
  // The home's link may appear more than once (a featured strip, a map list, its card): each is tried; the walks that find a
  // status must agree, or the home has none (two different badges next to one home's links is not a status, it is a guess).
  const anchors = all.filter((element) => element.tag === "a" && element.attributes.href && decodeHtmlEntities(element.attributes.href).split(/[?#]/)[0]!.replace(/\/+$/, "").endsWith(normalized));
  const maxLength = options.maxStatusLength ?? 40;
  // The walk stops at the first ancestor that also holds another home's link: beyond it lies the list, and a neighbour's status is not this home's.
  // Readers that know every home's path pass the others; besides those, another page as deep as this one under the same
  // community folder (two levels up: ".../community/lots/<home>" or ".../community/<plan>/<home>") counts as a neighbour.
  const segments = normalized.split("/");
  const communityFolder = `${segments.slice(0, -2).join("/")}/`;
  const others = (options.otherHomePaths ?? []).map((other) => other.replace(/\/+$/, "")).filter((other) => other && other !== normalized);
  const siblingLink = (element: HtmlElement) => element.tag === "a" && Boolean(element.attributes.href) && (() => {
    const href = decodeHtmlEntities(element.attributes.href!).split(/[?#]/)[0]!.replace(/\/+$/, "");
    if (href.endsWith(normalized)) return false;
    if (others.some((other) => href.endsWith(other))) return true;
    const at = href.indexOf(communityFolder);
    if (at < 0) return false;
    const tail = href.slice(at + communityFolder.length).split("/").filter(Boolean);
    return tail.length === 2;
  })();
  const isStatus = (element: HtmlElement) => options.statusClasses.some((token) => elementClass(element, token)) && elementText(element, html).length <= maxLength;
  // The card: from the node holding the status, up while the parent still holds only this home's links and one status.
  const cardTop = (node: HtmlElement) => {
    let top = node;
    for (let up = 0; up < 3; up++) {
      const parent = parents.get(top);
      if (!parent) break;
      const inside = descendants(parent);
      if (inside.some(siblingLink) || inside.filter(isStatus).length > 1) break;
      top = parent;
    }
    return top;
  };
  const found: Array<{ status: string | null; previousPrice: number | null; fields: Record<string, string | null>; card: HtmlElement | null }> = [];
  for (const anchor of anchors) {
  let node: HtmlElement | undefined = anchor;
  for (let depth = 0; node && depth < 8; depth++) {
    const inside = descendants(node);
    if (inside.some(siblingLink)) break;
    const statuses = inside.filter(isStatus);
    // Two status elements under one ancestor means the walk has left the card: this home's status is not among them.
    if (statuses.length > 1) break;
    const status = statuses[0];
    if (status) {
      // The struck-through price and other fields may sit in a sibling block of the same card, never in a neighbour's.
      const within = descendants(cardTop(node));
      const was = within.find((element) => /strike|was-?price|previous-price|old-price/i.test(element.attributes.class ?? "") || element.tag === "del" || element.tag === "s");
      const previous = was ? /\$\s*([\d,]{6,})/.exec(elementText(was, html)) : null;
      const fields: Record<string, string | null> = {};
      for (const [name, classes] of Object.entries(options.fields ?? {})) {
        const found = within.find((item) => classes.some((token) => elementClass(item, token)));
        fields[name] = found ? elementText(found, html) || null : null;
      }
      found.push({ status: elementText(status, html) || null, previousPrice: previous ? Number(previous[1]!.replace(/,/g, "")) : null, fields, card: node });
      break;
    }
    node = parents.get(node);
  }
  }
  if (!found.length) return { status: null, previousPrice: null, fields: {}, card: null };
  const agree = found.every((item) => (item.status ?? "").toLowerCase() === (found[0]!.status ?? "").toLowerCase());
  return agree ? found[0]! : { status: null, previousPrice: null, fields: {}, card: null };
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

const CHESMAR_IMAGE_HOSTS = ["www.chesmar.com", "chesmar.com", "images.ctfassets.net", "cdn.sanity.io"];
const GALLERY_CONTAINER_PATTERN = /(?:^|[\s_-])(?:gallery|galleries|slider|slides|carousel|swiper|slick|photos|lightbox|slideshow|fotorama|glide|splide|flickity|owl)(?:$|[\s_-])/i;
const MIN_GALLERY_IMAGE_WIDTH = 600;
const EXCLUDED_CHROME_TAGS = new Set(["nav", "footer", "header", "script", "style", "noscript", "template"]);

function insideChrome(element: HtmlElement, chrome: readonly HtmlElement[]): boolean {
  return chrome.some((region) => region !== element && element.contentStart >= region.contentStart && element.contentEnd <= region.contentEnd);
}

/** Largest candidate from a srcset, or null when the attribute has no usable entry. */
function largestSrcSetEntry(srcset: string | undefined, base: URL): { url: URL; width: number | null } | null {
  if (!srcset) return null;
  let best: { url: URL; width: number | null } | null = null;
  for (const entry of srcset.split(",")) {
    const [raw, descriptor] = entry.trim().split(/\s+/, 2);
    if (!raw) continue;
    const url = absoluteUrl(raw, base);
    if (!url) continue;
    const width = descriptor && /^\d+w$/i.test(descriptor) ? Number.parseInt(descriptor, 10) : null;
    if (!best || (width ?? 0) > (best.width ?? 0)) best = { url, width };
  }
  return best;
}

function imageWidthHint(image: HtmlElement, url: URL): number | null {
  const attribute = schemaNumber(image.attributes.width);
  if (attribute !== null) return attribute;
  const fromPath = /[-_](\d{3,4})x\d{2,4}(?:[.-]|$)/.exec(url.pathname);
  if (fromPath) return Number(fromPath[1]);
  const query = url.searchParams.get("w") ?? url.searchParams.get("width");
  return query && /^\d+$/.test(query) ? Number(query) : null;
}

/**
 * Chesmar photos come only from a gallery/slider container, never from page
 * chrome, plan drawings or brand graphics scattered across the page. Null means
 * the expected container is missing (a layout change), which holds the catalog.
 */
export function chesmarGallery(sourceUrl: string, html: string): PrivateGalleryImage[] | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const elements = descendants(root);
  const chrome = elements.filter((element) => EXCLUDED_CHROME_TAGS.has(element.tag));
  const marker = (element: HtmlElement) => `${element.attributes.class ?? ""} ${element.attributes.id ?? ""} ${element.attributes["data-gallery"] ?? ""}`;
  const containers = elements.filter((element) => GALLERY_CONTAINER_PATTERN.test(marker(element)) && !insideChrome(element, chrome));
  if (!containers.length) return null;
  const base = new URL(sourceUrl);
  const result = new Map<string, PrivateGalleryImage>();
  for (const container of containers) {
    for (const image of descendants(container).filter((element) => element.tag === "img" || element.tag === "source")) {
      const fromSet = largestSrcSetEntry(image.attributes.srcset ?? image.attributes["data-srcset"], base);
      const single = [image.attributes["data-src"], image.attributes["data-lazy"], image.attributes["data-original"], image.attributes.src]
        .find((value) => value && !/^data:/i.test(value));
      const url = fromSet?.url ?? (single ? absoluteUrl(single, base) : null);
      if (!url || url.protocol !== "https:" || !CHESMAR_IMAGE_HOSTS.includes(url.hostname.toLowerCase())) continue;
      if (/logo|icon|avatar|thumbnail|thumb|placeholder|spinner|sprite|\.svg$/i.test(url.pathname)) continue;
      const width = fromSet?.width ?? imageWidthHint(image, url);
      if (width !== null && width < MIN_GALLERY_IMAGE_WIDTH) continue;
      // The live site serves every slide as a <picture> with a .webp source, a
      // .jpg source and an <img>: one photo, three URLs. Key on the stem so the
      // card gets each photo once, preferring the JPEG variant.
      const stem = `${url.origin}${url.pathname.replace(/\.(?:webp|avif|jpe?g|png)$/i, "")}`;
      const existing = result.get(stem);
      const jpeg = /\.jpe?g$/i.test(url.pathname);
      if (existing && !(jpeg && !/\.jpe?g$/i.test(new URL(existing.sourceUrl).pathname))) continue;
      result.set(stem, { sourceUrl: url.toString(), caption: image.attributes.alt || null, width, height: schemaNumber(image.attributes.height), srcSet: image.attributes.srcset ?? null });
      if (result.size >= 12 && !existing) return Array.from(result.values());
    }
  }
  return Array.from(result.values());
}

const FACT_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*(?:beds?|bedrooms?)\b/i,
  /\b\d+(?:\.\d+)?\s*(?:baths?|bathrooms?)\b/i,
  /\b[\d,]+\s*(?:sq\.?\s*(?:ft|feet)|square\s+feet)\b/i,
];
const RANGE_FACT_PATTERN = /\b[\d,]+\s*(?:-|–|to)\s*[\d,]+\s*(?:beds?|bedrooms?|baths?|bathrooms?|sq\.?\s*(?:ft|feet)|square\s+feet)\b/i;

/**
 * The home facts of a detail page live in the compact stat block that follows
 * its h1. Site navigation that carries the community range ("From $499,990",
 * "3 - 5 Beds") or a "Quick Move-In Homes" menu entry is never consulted.
 */
export function detailStatBlock(html: string): { block: string; region: string; near: string } | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const elements = descendants(root);
  const h1 = elements.find((element) => element.tag === "h1");
  if (!h1) return null;
  const chrome = elements.filter((element) => EXCLUDED_CHROME_TAGS.has(element.tag));
  const parent = elements.find((element) => element.children.includes(h1));
  // A compact heading section may list the stats just before the h1 itself.
  const headingSection = parent && !insideChrome(parent, chrome) && elementText(parent, html).length <= 1500 ? parent : null;
  let block: HtmlElement | null = null;
  for (const element of elements) {
    const afterHeading = element.contentStart >= h1.contentEnd;
    const inHeadingSection = headingSection !== null && element !== headingSection && element.contentStart >= headingSection.contentStart && element.contentEnd <= headingSection.contentEnd && !(element.contentStart <= h1.contentStart && element.contentEnd >= h1.contentEnd);
    if ((!afterHeading && !inHeadingSection) || EXCLUDED_CHROME_TAGS.has(element.tag) || insideChrome(element, chrome)) continue;
    const text = elementText(element, html);
    if (!text || text.length > 500 || RANGE_FACT_PATTERN.test(text)) continue;
    if (FACT_PATTERNS.filter((pattern) => pattern.test(text)).length >= 2) { block = element; break; }
  }
  if (!block) return null;
  const blockText = elementText(block, html);
  const regionText = htmlToText(html.slice(Math.min(h1.contentEnd, block.contentStart), Math.max(block.contentEnd, h1.contentEnd)));
  const nearText = parent ? elementText(parent, html) : htmlToText(html.slice(h1.contentStart, h1.contentEnd));
  return {
    block: blockText,
    region: regionText.length <= 800 ? regionText : blockText,
    near: nearText.length <= 300 ? nearText : htmlToText(html.slice(h1.contentStart, h1.contentEnd)),
  };
}

/**
 * The live Chesmar detail layout labels its facts: an Overview list
 * ("Beds: 4", "Baths: 3.5", "Sq. Ft.: 2,982"), a "Starting from $499,990"
 * price block, icon tiles ("2982 Square Feet"), the plan name in the
 * f-title block, the lot address in the breadcrumb, and the sale status in
 * the document title ("... | Model For Tour in ..."). Absent facts stay null.
 */
export function chesmarDetailFacts(html: string): { price: number | null; bedrooms: number | null; bathrooms: number | null; squareFeet: number | null; status: string | null; planName: string | null; address: string | null } {
  const text = htmlToText(html);
  const title = htmlToText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const block = (pattern: RegExp) => { const match = pattern.exec(html); return match ? htmlToText(match[1]) : ""; };
  const planName = block(/class=["'][^"']*\bf-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || null;
  const crumb = block(/class=["'][^"']*\bbread-current\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/i);
  const mapLink = block(/class=["'][^"']*\bmaplink\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  const address = [crumb, mapLink].find((value) => looksLikeStreetAddress(value)) ?? null;
  const price = numberMatch(text, /\bStarting\s+From\s*:?\s*\$\s*([\d,]+)/i) ?? numberMatch(block(/class=["'][^"']*\bf-price\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<a/i), /\$\s*([\d,]+)/);
  const bedrooms = numberMatch(text, /\bBeds?\s*:\s*(\d+(?:\.\d+)?)\b/i) ?? numberMatch(text, /\b(\d+(?:\.\d+)?)\s+Bedrooms?\b/i);
  const bathrooms = numberMatch(text, /\bBaths?\s*:\s*(\d+(?:\.\d+)?)\b/i) ?? numberMatch(text, /\b(\d+(?:\.\d+)?)\s+Bathrooms?\b/i);
  const squareFeet = numberMatch(text, /\bSq\.?\s*Ft\.?\s*:\s*([\d,]+)\b/i) ?? numberMatch(text, /\b([\d,]{3,})\s+Square\s+Feet\b/i);
  return { price, bedrooms, bathrooms, squareFeet, status: extractStatus(title), planName, address };
}

/** Null when the page has neither labelled room facts nor an h1 stat block, or no gallery container; the caller holds. */
function parsePrivateProperty(sourceUrl: string, html: string): PrivatePlanOrHome | null {
  const facts = chesmarDetailFacts(html);
  const stats = detailStatBlock(html);
  if (!stats && facts.bedrooms === null && facts.bathrooms === null && facts.squareFeet === null) return null;
  const gallery = chesmarGallery(sourceUrl, html);
  if (gallery === null) return null;
  return {
    sourceUrl,
    privateName: extractFirstHeading(html),
    privatePlanName: facts.planName,
    privateAddress: facts.address,
    status: facts.status ?? (stats ? extractStatus(stats.block) ?? extractStatus(stats.region) ?? extractStatus(stats.near) : null),
    price: facts.price ?? (stats ? extractPrice(stats.block) ?? extractPrice(stats.region) : null),
    bedrooms: facts.bedrooms ?? (stats ? extractBedrooms(stats.block) : null),
    bathrooms: facts.bathrooms ?? (stats ? extractBathrooms(stats.block) : null),
    squareFeet: facts.squareFeet ?? (stats ? extractSquareFeet(stats.block) : null),
    gallery,
  };
}

/** A Chesmar plan page: a FloorPlan breadcrumb, the floor-plan info block, or an "About the <plan>" heading. */
function looksLikeChesmarPlanPage(html: string): boolean {
  return /<a\b[^>]*\btitle=["']FloorPlan["']/i.test(html)
    || /class=["'][^"']*\bbread-current\b[^"']*["'][^>]*>[\s\S]{0,200}?Floor\s*Plan/i.test(html)
    || /class=["'][^"']*\bfloor-plan-info\b[^"']*["']/i.test(html)
    || /<h1\b[^>]*>\s*About\s+the\b/i.test(html);
}

/**
 * First-party community facts read only from the official community page.
 * Absent facts stay null/empty; nothing is guessed or carried over from a nav.
 */
export function parseCommunityFacts(html: string): NonNullable<PrivateDealSnapshot["communityFacts"]> {
  const text = htmlToText(html);
  const range = /\$\s*(\d{3},\d{3}(?:,\d{3})?)\s*(?:-|–|to)\s*\$\s*(\d{3},\d{3}(?:,\d{3})?)/i.exec(text);
  const from = /(?:priced\s+from|starting\s+(?:from|at)|from|as\s+low\s+as)\s*:?\s*\$\s*(\d{3},\d{3}(?:,\d{3})?)/i.exec(text);
  const fromPrice = numericValue(range?.[1] ?? from?.[1] ?? "");
  const district = /\bSchool\s+Districts?(?:\(s\))?\s*:\s*((?:[A-Z][A-Za-z.'-]+\s+){1,4}(?:ISD|CISD|Independent\s+School\s+District|School\s+District))\b/.exec(text)
    ?? /\b((?:[A-Z][A-Za-z.'-]+\s+){1,4}(?:ISD|CISD|Independent\s+School\s+District|School\s+District))\b/.exec(text);
  // A lot size needs a lot word next to it: "a one-acre dog park" is not a lot size.
  const lots = /\b((?:half|quarter|third|one|two)[- ]acre\+?\s+(?:home\s*sites?|homesites?|lots?)|\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?[- ]acre\+?\s+(?:home\s*sites?|homesites?|lots?)|\d+(?:\.\d+)?\+?[- ]acre\s+(?:home\s*sites?|homesites?|lots?)|(?:home\s*sites?|homesites?|lots?)\s+(?:from|of|on|up\s+to)\s+(?:\d+(?:\.\d+)?\s*(?:-|–|to)\s*)?\d+(?:\.\d+)?\+?[- ]acres?|\d{2,3}(?:'|\s*-?\s*(?:ft|foot|feet))(?:\s+wide)?\s+(?:home)?sites)\b/i.exec(text);
  return {
    fromPrice: fromPrice !== null && Number.isInteger(fromPrice) && fromPrice >= 50_000 ? fromPrice : null,
    schoolDistrict: district ? normalizeWhitespace(district[1]) : null,
    lotSizes: lots ? normalizeWhitespace(lots[1]) : null,
    amenities: parseAmenityList(html),
  };
}

function parseAmenityList(html: string): string[] {
  const root = parseHtmlElements(html);
  if (!root) return [];
  const elements = descendants(root);
  const chrome = elements.filter((element) => EXCLUDED_CHROME_TAGS.has(element.tag));
  const items = (container: HtmlElement) => descendants(container)
    .filter((element) => element.tag === "li")
    .map((element) => elementText(element, html))
    .filter((value) => value.length >= 3 && value.length <= 60 && !/\$|\bbeds?\b|\bbaths?\b|sq\.?\s*ft/i.test(value));
  const section = elements.find((element) => /amenit/i.test(`${element.attributes.class ?? ""} ${element.attributes.id ?? ""}`) && !insideChrome(element, chrome));
  const fromSection = section ? items(section) : [];
  if (fromSection.length) return Array.from(new Set(fromSection)).slice(0, 20);
  const heading = elements.find((element) => /^h[2-5]$/.test(element.tag) && /\bamenities\b/i.test(elementText(element, html)) && !insideChrome(element, chrome));
  if (!heading) return [];
  const parent = elements.find((element) => element.children.includes(heading));
  if (!parent) return [];
  const following = parent.children.slice(parent.children.indexOf(heading) + 1);
  const list = following.find((element) => descendants(element).some((child) => child.tag === "li") || element.tag === "ul" || element.tag === "ol");
  return list ? Array.from(new Set(items(list))).slice(0, 20) : [];
}

export function parseSitemapUrls(xml: string): string[] | null {
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

/**
 * A lender's NMLS identifier in any of its spellings: "NMLS 1791", "NMLS #1791",
 * "NMLS ID No. 1791", "NMLSR ID 1791", "NMLS Unique Identifier 1791",
 * "N.M.L.S. 1791", "NMLS Consumer Access 1791". Stripped from disclaimers
 * before they are kept, and treated as residue in any public text.
 */
export const NMLS_ID_PATTERN = /\(?\bN\.?M\.?L\.?S\.?R?\b(?:[\s#:.]*(?:ID|No\.?|#|number|unique\s+identifier|consumer\s+access))*[\s#:.]*\d{3,}\)?/i;
export const NMLS_ID_PATTERN_ALL = new RegExp(NMLS_ID_PATTERN.source, "gi");

/** A street address starts with a house number and continues with words; an H1 such as "New Homes in San Antonio" does not. */
const STREET_ADDRESS_PATTERN = /^\d{1,6}[A-Za-z]?\s+[A-Za-z][A-Za-z0-9.'’#-]*(?:[\s,]+[A-Za-z0-9.'’#-]+)*$/;
export function looksLikeStreetAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && STREET_ADDRESS_PATTERN.test(value.trim());
}

/**
 * The builder's own names and its lender's, kept out of every public text. One
 * table for the sync (stored scrub lists), onboarding, Admin and the readers.
 */
export function builderScrubConfig(builder: string): DealScrubConfig {
  const config = emptyDealScrubConfig();
  if (builder === "M/I Homes") { config.builder.push("M/I Homes", "M/I"); config.lender.push("M/I Financial, LLC", "M/I Financial"); }
  if (builder === "Chesmar") { config.builder.push("Chesmar Homes", "Chesmar"); config.lender.push("HomeAmerican Mortgage Corporation", "HomeAmerican Mortgage", "HomeAmerican", "HMC"); }
  if (builder === "Perry Homes") { config.builder.push("Perry Homes", "Perry"); config.lender.push("Parkstone Mortgage", "Parkstone", "Crestmark Mortgage", "Crestmark"); }
  if (builder === "Century Communities") { config.builder.push("Century Communities", "Century Complete", "Century"); config.lender.push("Inspire Home Loans"); }
  if (builder === "KB Home") { config.builder.push("KB Home", "KB Homes", "KB"); config.lender.push("KBHS Home Loans", "KBHS"); }
  if (builder === "Toll Brothers") { config.builder.push("Toll Brothers", "Toll Brothers Inc"); config.lender.push("Toll Brothers Mortgage Company", "Toll Brothers Mortgage", "TBI Mortgage", "TBI"); }
  if (builder === "David Weekley Homes") { config.builder.push("David Weekley Homes", "David Weekley", "Weekley Homes", "Weekley"); config.lender.push("Priority Home Mortgage"); }
  if (builder === "Ashton Woods") { config.builder.push("Ashton Woods Homes", "Ashton Woods", "Starlight Homes"); config.lender.push("Velocio Mortgage", "Velocio"); }
  if (builder === "Starlight Homes") { config.builder.push("Starlight Homes", "Starlight", "Ashton Woods"); config.lender.push("Velocio Mortgage", "Velocio", "Trailblazer Mortgage", "Trailblazer"); }
  if (builder === "LGI Homes") { config.builder.push("LGI Homes", "LGI", "Terrata Homes", "CompleteHome"); config.lender.push("LGI Mortgage Solutions", "CalCon Mutual Mortgage", "One Trust Home Loans", "OneTrust Home Loans"); }
  if (builder === "Sitterle Homes") { config.builder.push("Sitterle Homes", "Sitterle"); }
  if (builder === "Drees Custom Homes") { config.builder.push("Drees Custom Homes", "Drees Homes", "The Drees Company", "Drees"); config.lender.push("First Equity Mortgage", "First Equity"); }
  if (builder === "Legend Homes") { config.builder.push("Legend Homes", "Legend Home", "Camillo Companies", "Camillo"); }
  if (builder === "DRB Homes") { config.builder.push("DRB Homes", "DRB Group", "DRB Elevate", "DRB"); }
  if (builder === "Beazer Homes") { config.builder.push("Beazer Homes", "Beazer", "Gatherings by Beazer", "Gatherings"); config.lender.push("Beazer Mortgage Choice", "Mortgage Choice", "Cardinal Financial Company", "Cardinal Financial", "Choice Lender"); }
  if (builder === "Hakes Brothers") { config.builder.push("Hakes Brothers", "Hakes Bros", "Hakes"); }
  if (builder === "Lennar") { config.builder.push("Lennar Homes", "Lennar Corporation", "Lennar", "Everything's Included", "Everything’s Included", "Next Gen"); config.lender.push("Lennar Mortgage", "Lennar Title"); }
  if (builder === "Texas Homes") { config.builder.push("Texas Homes"); config.lender.push("CMG Mortgage", "CMG Home Loans", "CMG"); }
  if (builder === "View Homes") { config.builder.push("View Homes", "Your View Home", "Thoughtful Collection"); config.lender.push("View Homes Lending"); }
  if (builder === "Scott Felder Homes") { config.builder.push("Scott Felder Homes", "Scott Felder"); config.lender.push("Southern Lending", "First Continental Mortgage", "First Continental"); }
  if (builder === "Highland Homes") { config.builder.push("Highland Homes", "Highland"); config.lender.push("Highland HomeLoans", "Highland Home Loans"); }
  if (builder === "Davidson Homes") { config.builder.push("Davidson Homes", "Davidson"); config.lender.push("NorthStar Mortgage Advisors", "NorthStar Mortgage", "NorthStar"); }
  if (builder === "First America Homes") { config.builder.push("First America Homes", "First America"); }
  if (builder === "Coventry Homes") { config.builder.push("Coventry Homes", "Coventry", "DFH Coventry", "Dream Finders Homes", "Dream Finders"); }
  if (builder === "Pulte" || builder === "Centex" || builder === "Del Webb") { config.builder.push("PulteGroup", "Pulte Homes", "Pulte", "Centex Homes", "Centex", "Del Webb"); config.lender.push("Pulte Mortgage LLC", "Pulte Mortgage"); }
  // D.R. Horton's product lines name the builder as surely as the builder does.
  if (builder === "D.R. Horton") { config.builder.push("D.R. Horton", "DR Horton", "D. R. Horton", "Horton", "Express Series", "Express Homes", "Emerald Homes", "Freedom Homes", "Tradition Series"); config.lender.push("DHI Mortgage", "DHI Title", "DHI"); }
  return config;
}

export function categorizedPrivateTerms(config: Pick<CommunitySourceConfig, "builder" | "privateCommunityName" | "scrubList" | "scrubConfig" | "excludedTerms">, discovered?: PrivateDealSnapshot): DealScrubConfig {
  const result = parseDealScrubConfig(config.scrubConfig ?? emptyDealScrubConfig());
  const builderNames = builderScrubConfig(config.builder);
  result.builder.push(...builderNames.builder); result.lender.push(...builderNames.lender); result.community.push(config.privateCommunityName);
  const known = new Set(dealScrubTerms(result).map((term) => term.toLowerCase()));
  result.other.push(...config.scrubList.filter((term) => !known.has(term.toLowerCase())));
  for (const item of [...(discovered?.plans ?? []), ...(discovered?.homes ?? [])]) {
    const plan = item.privatePlanName ?? (discovered?.plans.includes(item) ? item.privateName : null);
    if (plan) result.plan.push(plan, plan.replace(/\s*[-–]\s*[A-Z]$/i, ""));
    // Only a value shaped like a street address joins the street category; a
    // page heading used as a home's name is verbatim marketing text, not a street.
    const address = item.privateAddress ?? (!discovered?.plans.includes(item) ? item.privateName : null);
    if (looksLikeStreetAddress(address)) result.street.push(address, address.replace(/^\d+[A-Za-z]?\s+/, "").split(",")[0].trim());
  }
  return applyScrubExclusions(parseDealScrubConfig(result), config.excludedTerms ?? []);
}
function remainingPrivateTerm(text: string, terms: readonly string[] | DealScrubConfig, planField = false): boolean { return hasPrivateTerm(text, terms, { planField }); }
/** Scrub checked text only; never publish markup, outbound source links or private residue. */
export function toPublicSafeText(
  input: string,
  config: Pick<CommunitySourceConfig, "privateCommunityName" | "scrubList" | "scrubConfig">,
  planField = false,
  extraPrivateTerms: readonly string[] = [],
): string | null {
  const categories = categorizedPrivateTerms({ ...config, builder: "Manual" });
  const known = new Set(dealScrubTerms(categories));
  categories.other.push(...extraPrivateTerms.filter((term) => !known.has(term)));
  const scrubbed = scrubPrivateNames(htmlToText(input), categories, { planField });
  // A link, a bare domain ("TollBrothersMortgage.com") or a phone number, with or without separators, is residue.
  if (!scrubbed || /\b(?:https?:\/\/|www\.)\S+/i.test(scrubbed) || /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|us|io|info|biz)\b/i.test(scrubbed) || /(?<![\d.$,])\d{10}(?!\d|\.\d)/.test(scrubbed) || /(?<![\d.$,])\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?!\d|\.\d)/.test(scrubbed)) return null;
  // A lender's NMLS number names the lender as surely as its name does.
  if (NMLS_ID_PATTERN.test(scrubbed)) return null;
  // Residue is judged per category: a bare plan word such as "Magnolia trees"
  // outside a plan field is verbatim text, not a private name.
  return remainingPrivateTerm(scrubbed, categories, planField) ? null : scrubbed;
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

export function makePublicSnapshot(privateSnapshot: PrivateDealSnapshot, config: CommunitySourceConfig, incentiveHolds: readonly DealHoldReason[] = []): { snapshot: PublicDealSnapshot; catalogHolds: DealHoldReason[]; incentiveHolds: DealHoldReason[] } {
  // An admin-excluded false positive is not private, however often a page repeats it.
  const excluded = new Set((config.excludedTerms ?? []).map((term) => term.trim().toLowerCase()));
  const discoveredNames = [...privateSnapshot.plans, ...privateSnapshot.homes].flatMap((item) => [item.privateName, item.privateAddress, item.privatePlanName].filter((name): name is string => Boolean(name) && !excluded.has(String(name).trim().toLowerCase())));
  const categories = categorizedPrivateTerms(config, privateSnapshot);
  privateSnapshot.discoveredScrubConfig = categories;
  const terms = Array.from(new Set([...dealScrubTerms(categories), ...discoveredNames]));
  config = { ...config, scrubConfig: categories };
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

/**
 * Approved plan pages and home pages must parse or the catalog is held. Probe
 * mode (no whitelist could be built) fetches the community's child pages and
 * silently skips any page that is not an official floor-plan page, instead of
 * letting a site-map or virtual-tour page hold the whole catalog.
 */
async function fetchDiscoveredProperties(
  urls: readonly string[],
  kind: "plan" | "home",
  fetcher: HtmlFetcher,
  privateSnapshot: PrivateDealSnapshot,
  expectedHost: string,
  mode: "approved" | "probe" = "approved",
  /** Paths parsed strictly even in probe mode: a home's parent is a plan page by the site's URL grammar. */
  strictPaths: ReadonlySet<string> = new Set(),
): Promise<{ holds: DealHoldReason[]; skipped: number }> {
  const results = await mapWithConcurrency(urls, 4, async (url) => {
    const strict = mode === "approved" || strictPaths.has(normalizePathname(new URL(url).pathname));
    const page = await getDocument(url, fetcher, "text/html,application/xhtml+xml", expectedHost);
    if (!page.ok) {
      const hold: DealHoldReason = page.redirectedOffOfficialHost ? "unsupported_official_host" : "detail_fetch_failed";
      return { hold, property: null, skipped: false };
    }
    if (kind === "plan" && !strict && !looksLikeChesmarPlanPage(page.text)) return { hold: null, property: null, skipped: true };
    const property = containsExpectedDetailContainer(page.text) ? parsePrivateProperty(url, page.text) : null;
    // A plan or home record must contain at least one first-party property
    // fact; an arbitrary branded detail page is not a successful discovery.
    if (!property || (property.price === null && property.bedrooms === null && property.bathrooms === null && property.squareFeet === null)) {
      return strict ? { hold: "expected_detail_container_not_found" as const, property: null, skipped: false } : { hold: null, property: null, skipped: true };
    }
    return { hold: null, property, skipped: false };
  });
  const holds: DealHoldReason[] = [];
  let skipped = 0;
  for (const result of results) {
    if (result.hold) {
      holds.push(result.hold);
      continue;
    }
    if (result.skipped) skipped += 1;
    if (!result.property) continue;
    privateSnapshot.pages.push(sourcePage(kind, result.property.sourceUrl, result.property.privateName));
    if (kind === "plan") privateSnapshot.plans.push(result.property);
    else privateSnapshot.homes.push(result.property);
  }
  return { holds, skipped };
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

function miIncentiveText(html: string): string | null {
  const root = parseHtmlElements(html); if (!root) return null;
  const elements = descendants(root);
  const heading = elements.find((item) => elementClass(item, "single-incentive__headline"));
  if (heading) {
    const container = elements.filter((item) => elementClass(item, "content-inner-content") && descendants(item).includes(heading))
      .sort((a, b) => (a.contentEnd - a.contentStart) - (b.contentEnd - b.contentStart))[0];
    return container ? elementText(container, html) : null;
  }
  // Reviewed fragments contain only campaign content; refuse whole site fallback.
  if (!elements.some((item) => ["nav", "footer", "form"].includes(item.tag)) && elements.some((item) => item.tag === "h1")) return htmlToText(html);
  return null;
}
/** Full sitemap-index traversal, with strict official-host validation and a fail-closed bound. */
async function chesmarSitemapCandidates(fetcher: HtmlFetcher, snapshot: PrivateDealSnapshot): Promise<{ urls: string[]; holds: DealHoldReason[] }> {
  const pending = [CHESMAR_SITEMAP_INDEX]; const seen = new Set<string>(); const urls: string[] = [];
  while (pending.length) {
    if (seen.size >= 32) return { urls: [], holds: ["incomplete_inventory"] };
    const url = pending.shift()!; if (seen.has(url)) continue; seen.add(url);
    const page = await getDocument(url, fetcher, "application/xml,text/xml", CHESMAR_HOST);
    if (!page.ok) return { urls: [], holds: [page.redirectedOffOfficialHost ? "unsupported_official_host" : "sitemap_fetch_failed"] };
    snapshot.pages.push(sourcePage("sitemap", url, null));
    const locations = Array.from(page.text.matchAll(/<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi), (match) => decodeHtmlEntities(match[1]).trim());
    if (/^\s*(?:<\?xml\b[^>]*>\s*)?<sitemapindex\b/i.test(page.text) && /<\/sitemapindex\s*>\s*$/i.test(page.text)) {
      if (!locations.length) return { urls: [], holds: ["sitemap_fetch_failed"] };
      for (const raw of locations) { const next = asUrl(raw); if (!next || !sameOfficialHost(next, CHESMAR_HOST)) return { urls: [], holds: ["unsupported_official_host"] }; if (!seen.has(next.toString())) pending.push(next.toString()); }
    } else {
      const parsed = parseSitemapUrls(page.text); if (!parsed) return { urls: [], holds: ["sitemap_fetch_failed"] }; urls.push(...parsed);
    }
  }
  return { urls: Array.from(new Set(urls)), holds: [] };
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
  const text = chesmar ? chesmarFhaIncentiveText(page.text) : miIncentiveText(page.text);
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

    privateSnapshot.communityFacts = parseCommunityFacts(page.text);

    const sitemap = await chesmarSitemapCandidates(fetcher, privateSnapshot);
    if (sitemap.holds.length) return failedResult(config, fetchedAt, privateSnapshot, sitemap.holds);
    const candidates = sitemap.urls;
    // Plan pages are whitelisted by reviewed slugs and by explicit plan links
    // inside the community's floorplans container. The live community page
    // renders that container client-side (it is empty in the served HTML), so
    // the usual case is probe mode: every single-segment child the sitemap
    // lists is fetched and kept only when it looks like a floor-plan page.
    // Other single-segment children (site-map, virtual-tour, ...) are skipped
    // by name. The parent slug of every home URL is always a candidate.
    const approved = new Set((config.planSlugs ?? []).map((slug) => slug.toLowerCase()));
    const tree = parseHtmlElements(page.text);
    const planContainer = tree ? descendants(tree).find((item) => item.attributes.id === "floorplans") : null;
    if (planContainer) for (const href of extractHrefValues(page.text.slice(planContainer.contentStart, planContainer.contentEnd))) {
      const link = absoluteUrl(href, community); if (link && isChesmarPlan(link, community)) approved.add(link.pathname.split("/").filter(Boolean).at(-1)!.toLowerCase());
    }
    const homeParents = new Set<string>();
    for (const raw of candidates) { const link = asUrl(raw); if (link && isChesmarHome(link, community)) homeParents.add(link.pathname.split("/").filter(Boolean).at(-2)!.toLowerCase()); }
    const planUrls: string[] = [];
    const homeUrls: string[] = [];
    const slugOf = (url: URL) => url.pathname.split("/").filter(Boolean).at(-1)!.toLowerCase();
    for (const raw of candidates) {
      const url = asUrl(raw);
      if (!url || !sameOfficialHost(url, CHESMAR_HOST)) continue;
      if (isChesmarPlan(url, community) && !/^(?:gallery|map|location|overview|photos|models|incentives|contact|site-?map|virtual-?tours?|videos?|directions|amenities|schools?|news|blog|events?)$/i.test(slugOf(url))) planUrls.push(url.toString());
      else if (isChesmarHome(url, community)) homeUrls.push(url.toString());
    }
    const mode: "approved" | "probe" = approved.size ? "approved" : "probe";
    // An approved slug (or a home's parent plan) missing from a lagging sitemap is still fetched at its official path.
    const planBase = new URL(normalizePathname(community.pathname), community.origin).toString();
    const planByPath = new Map<string, string>();
    const wanted = mode === "approved"
      ? [...planUrls.filter((url) => approved.has(slugOf(new URL(url))) || homeParents.has(slugOf(new URL(url)))), ...Array.from(approved, (slug) => `${planBase}${slug}/`), ...Array.from(homeParents, (slug) => `${planBase}${slug}/`)]
      : [...planUrls, ...Array.from(homeParents, (slug) => `${planBase}${slug}/`)];
    for (const url of wanted) {
      const path = normalizePathname(new URL(url).pathname);
      if (!planByPath.has(path)) planByPath.set(path, url);
    }
    const distinctPlanUrls = Array.from(planByPath.values());
    const distinctHomeUrls = Array.from(new Set(homeUrls));
    if (!distinctPlanUrls.length && !distinctHomeUrls.length) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (distinctPlanUrls.length + distinctHomeUrls.length > detailLimit(config)) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const strictPlanPaths = new Set(Array.from(homeParents, (slug) => normalizePathname(`${new URL(planBase).pathname}${slug}/`)));
    const planResults = await fetchDiscoveredProperties(distinctPlanUrls, "plan", fetcher, privateSnapshot, CHESMAR_HOST, mode, strictPlanPaths);
    const homeResults = await fetchDiscoveredProperties(distinctHomeUrls, "home", fetcher, privateSnapshot, CHESMAR_HOST, "approved");
    const detailHolds = [...planResults.holds, ...homeResults.holds];
    if (detailHolds.length > 0) return failedResult(config, fetchedAt, privateSnapshot, detailHolds);
    // Zero parsed plans means the plan pages no longer look like plan pages.
    if (!privateSnapshot.plans.length) return failedResult(config, fetchedAt, privateSnapshot, [mode === "approved" ? "expected_detail_container_not_found" : "expected_community_container_not_found"]);

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
    else if (/\/incentives?\/[^/]+\/?$/i.test(url.pathname)) incentiveUrls.push(url.toString());
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
  if (!(type === "plans" ? schemaType(product, "ProductModel") || schemaType(product, "Product") : schemaType(product, "Product"))) return null;
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
      const local = jsonLdObjects(descendants(card), html).filter((product) => miProductUrl(product, community, type));
      const linkUrls = extractHrefValues(html.slice(card.contentStart, card.contentEnd)).map((href) => absoluteUrl(href, community)?.toString());
      const products = local.length ? local : jsonLdObjects(elements, html).filter((product) => typeof product.url === "string" && linkUrls.includes(absoluteUrl(product.url, community)?.toString()) && miProductUrl(product, community, type));
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
    if ((!schemaType(item, "Product") && !schemaType(item, "ProductModel")) || typeof item.url !== "string") return false;
    const url = absoluteUrl(item.url, base);
    return url?.hostname === base.hostname && normalizePathname(url.pathname) === normalizePathname(base.pathname);
  });
  const slides = elements.filter((element) => elementClass(element, "gallery-slide-container") || element.attributes["data-gallery"] === "simple-gallery-modal");
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
      privateSnapshot.pages.push(sourcePage(privateSnapshot.plans.includes(result.property) ? "plan" : "home", result.property.sourceUrl, result.property.privateName));
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

    privateSnapshot.communityFacts = parseCommunityFacts(communityPage.text);
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
    const detailHolds = await fetchMiHomeGalleries([...homes.properties, ...plans.properties], fetcher, privateSnapshot);
    if (detailHolds.length > 0) return failedResult(config, fetchedAt, privateSnapshot, detailHolds);

    const configuredIncentive = config.incentiveSourceUrl ? asUrl(config.incentiveSourceUrl) : null;
    const incentiveUrl = discovered.incentiveUrls[0] ? asUrl(discovered.incentiveUrls[0]) : configuredIncentive && sameOfficialHost(configuredIncentive, MI_HOST) ? configuredIncentive : null;
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
let perryAdapter: DealAdapter | null = null;
let drHortonAdapter: DealAdapter | null = null;
const pulteGroupAdapters: Partial<Record<keyof typeof PULTEGROUP_HOSTS, DealAdapter>> = {};
const homefinitiAdapters: Partial<Record<keyof typeof HOMEFINITI_HOSTS, DealAdapter>> = {};
let davidsonAdapter: DealAdapter | null = null;
let highlandAdapter: DealAdapter | null = null;
let centuryAdapter: DealAdapter | null = null;
let kbHomeAdapter: DealAdapter | null = null;
let tollAdapter: DealAdapter | null = null;
let weekleyAdapter: DealAdapter | null = null;
let ashtonAdapter: DealAdapter | null = null;
let lgiAdapter: DealAdapter | null = null;
let sitterleAdapter: DealAdapter | null = null;
let scottFelderAdapter: DealAdapter | null = null;
let drbAdapter: DealAdapter | null = null;
let starlightAdapter: DealAdapter | null = null;
let legendAdapter: DealAdapter | null = null;
let dreesAdapter: DealAdapter | null = null;
let viewHomesAdapter: DealAdapter | null = null;
let texasHomesAdapter: DealAdapter | null = null;
let hakesAdapter: DealAdapter | null = null;
let beazerAdapter: DealAdapter | null = null;
let lennarAdapter: DealAdapter | null = null;
export const DEAL_ADAPTERS: Readonly<Record<BuilderId, DealAdapter>> = {
  Chesmar: new ChesmarAdapter(),
  "M/I Homes": new MiHomesAdapter(),
  // Readers in their own modules import this one's helpers, so they are made on first use, after every module has loaded.
  get "Perry Homes"() { return (perryAdapter ??= new PerryHomesAdapter()); },
  get "D.R. Horton"() { return (drHortonAdapter ??= new DrHortonAdapter()); },
  get Pulte() { return (pulteGroupAdapters.Pulte ??= new PulteGroupAdapter("Pulte")); },
  get Centex() { return (pulteGroupAdapters.Centex ??= new PulteGroupAdapter("Centex")); },
  get "Del Webb"() { return (pulteGroupAdapters["Del Webb"] ??= new PulteGroupAdapter("Del Webb")); },
  get "First America Homes"() { return (homefinitiAdapters["First America Homes"] ??= new HomefinitiAdapter("First America Homes")); },
  get "Coventry Homes"() { return (homefinitiAdapters["Coventry Homes"] ??= new HomefinitiAdapter("Coventry Homes")); },
  get "Davidson Homes"() { return (davidsonAdapter ??= new DavidsonAdapter()); },
  get "Highland Homes"() { return (highlandAdapter ??= new HighlandAdapter()); },
  get "Century Communities"() { return (centuryAdapter ??= new CenturyAdapter()); },
  get "KB Home"() { return (kbHomeAdapter ??= new KbHomeAdapter()); },
  get "Toll Brothers"() { return (tollAdapter ??= new TollBrothersAdapter()); },
  get "David Weekley Homes"() { return (weekleyAdapter ??= new DavidWeekleyAdapter()); },
  get "Ashton Woods"() { return (ashtonAdapter ??= new AshtonWoodsAdapter()); },
  get "LGI Homes"() { return (lgiAdapter ??= new LgiHomesAdapter()); },
  get "Sitterle Homes"() { return (sitterleAdapter ??= new SitterleAdapter()); },
  get "Scott Felder Homes"() { return (scottFelderAdapter ??= new ScottFelderAdapter()); },
  get "DRB Homes"() { return (drbAdapter ??= new DrbHomesAdapter()); },
  get "Starlight Homes"() { return (starlightAdapter ??= new StarlightAdapter()); },
  get "Legend Homes"() { return (legendAdapter ??= new LegendHomesAdapter()); },
  get "Drees Custom Homes"() { return (dreesAdapter ??= new DreesAdapter()); },
  get "View Homes"() { return (viewHomesAdapter ??= new ViewHomesAdapter()); },
  get "Texas Homes"() { return (texasHomesAdapter ??= new TexasHomesAdapter()); },
  get "Hakes Brothers"() { return (hakesAdapter ??= new HakesBrothersAdapter()); },
  get "Beazer Homes"() { return (beazerAdapter ??= new BeazerAdapter()); },
  get Lennar() { return (lennarAdapter ??= new LennarAdapter()); },
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
