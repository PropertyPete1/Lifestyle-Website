import {
  HOMEFINITI_HOSTS, asUrl, cardAroundLink, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome, type PromotionalRateFacts,
  storiesFrom,
} from "./dealsAdapters";

/**
 * HOMEFINITI reader: First America Homes and Coventry Homes run on the same
 * site platform (media.<builder>.com/<id>/…, SKUs "HF-C…"). A community page is
 * server-rendered and carries one schema.org record per home for sale
 * (`["Product","SingleFamilyResidence"]`: address, offer price, beds, baths,
 * floor size, photos, page URL) and per floor plan (`["ProductModel",
 * "SingleFamilyResidence"]`), plus the community's HomeAndConstructionBusiness
 * record. The home's status ("Move-In Ready", "Under Construction") and the
 * price it dropped from are on its card, next to its link. Read-only, plain
 * GET, official host only. Everything here is private operational data.
 */
export type HomefinitiBrand = keyof typeof HOMEFINITI_HOSTS;

/** A community with more homes for sale than this is held, never truncated. */
export const HOMEFINITI_MAX_HOMES = 150;

type Json = Record<string, unknown>;

/** Every JSON-LD object on the page (graphs and arrays flattened), broken blocks skipped. */
export function jsonLdRecords(html: string): Json[] {
  const records: Json[] = [];
  for (const match of Array.from(html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))) {
    try {
      const queue: unknown[] = [JSON.parse(match[1]!.trim())];
      while (queue.length) {
        const item = queue.shift();
        if (Array.isArray(item)) queue.push(...item);
        else if (item && typeof item === "object") { records.push(item as Json); if (Array.isArray((item as Json)["@graph"])) queue.push(...((item as Json)["@graph"] as unknown[])); }
      }
    } catch { /* a broken block is skipped, never guessed at */ }
  }
  return records;
}

const types = (record: Json): string[] => Array.isArray(record["@type"]) ? (record["@type"] as unknown[]).map(String) : [String(record["@type"] ?? "")];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : null;
const num = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") { const parsed = Number(value.replace(/[$,\s]/g, "")); return value.trim() && Number.isFinite(parsed) ? parsed : null; }
  return null;
};
/** A count given plainly (4) or as a QuantitativeValue range ({minValue: 3, maxValue: 5}): the low end. */
const low = (value: unknown): number | null => {
  if (value && typeof value === "object") { const range = value as Json; return num(range.minValue) ?? num(range.value) ?? num(range.maxValue); }
  return num(value);
};

function gallery(images: unknown, representative: boolean): PrivateGalleryImage[] {
  if (!Array.isArray(images)) return [];
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const raw of images) {
    const url = typeof raw === "string" ? asUrl(raw) : null;
    if (!url || url.protocol !== "https:" || !/^media\.[a-z0-9-]+\.com$/i.test(url.hostname)) continue;
    // A floor-plan drawing or site plan shows the plan's name, never the home.
    if (/floor[-_]?plan|site[-_]?plan|\bfp[-_]|sqft-/i.test(url.pathname)) continue;
    url.search = "";
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sourceUrl: key, caption: representative ? "Representative image" : null, width: null, height: null, srcSet: null });
  }
  return out;
}

export type HomefinitiRecord = PrivatePlanOrHome & { kind: "home" | "plan" };

/** The home records of a community page, in page order; status and previous price are filled in from the cards by `withCardFacts`. */
export function parseHomefinitiRecords(html: string, host: string): { homes: HomefinitiRecord[]; plans: HomefinitiRecord[]; community: Json | null } {
  const homes: HomefinitiRecord[] = [];
  const plans: HomefinitiRecord[] = [];
  let community: Json | null = null;
  for (const record of jsonLdRecords(html)) {
    const kind = types(record);
    if (kind.includes("HomeAndConstructionBusiness")) { community ??= record; continue; }
    const offers = (record.offers && typeof record.offers === "object" ? record.offers : {}) as Json;
    const pageUrl = asUrl(text(record.url) ?? text(offers.url) ?? "");
    if (!pageUrl || !sameOfficialHost(pageUrl, host)) continue;
    const price = num(offers.price);
    const floor = (record.floorSize && typeof record.floorSize === "object" ? record.floorSize : {}) as Json;
    const full = low(record.numberOfFullBathrooms);
    const partial = low(record.numberOfPartialBathrooms);
    const baths = full === null && partial === null ? low(record.numberOfBathroomsTotal) : (full ?? 0) + (partial ?? 0) * 0.5;
    const base = { sourceUrl: pageUrl.toString(), price: price && price > 0 ? price : null, bedrooms: low(record.numberOfBedrooms), bathrooms: baths, squareFeet: low(floor), readyNow: false };
    if (kind.includes("Product") && kind.includes("SingleFamilyResidence")) {
      const address = (record.address && typeof record.address === "object" ? record.address : {}) as Json;
      const street = text(address.streetAddress) ?? text(record.name);
      if (!street) continue;
      const city = text(address.addressLocality);
      const zip = /\b\d{5}\b/.exec(text(address.postalCode) ?? "")?.[0] ?? null;
      const planPath = text(record.model);
      homes.push({ kind: "home", ...base, privateName: street, privateAddress: [street, [city, zip ? `TX ${zip}` : "TX"].filter(Boolean).join(", ")].join(", "), privatePlanName: planPath ? planNameFromPath(planPath) : null, status: null, gallery: gallery(record.image, false) });
    } else if (kind.includes("ProductModel")) {
      const name = text(record.name);
      if (!name) continue;
      plans.push({ kind: "plan", ...base, privateName: name, privatePlanName: name, status: null, gallery: gallery(record.image, true) });
    }
  }
  return { homes: once(homes), plans: once(plans), community };
}

/**
 * One record per page. A page may repeat a record (a list and a map strip):
 * the copies are one home, so a repeat never counts as a second home against
 * the cards (a card without a record of its own still holds the run). Copies
 * whose figures differ are not one home: both are kept, and the reader holds.
 */
function once(records: HomefinitiRecord[]): HomefinitiRecord[] {
  const out: HomefinitiRecord[] = [];
  const seen = new Map<string, string>();
  const facts = (record: HomefinitiRecord) => JSON.stringify([record.privateName, record.privateAddress, record.privatePlanName, record.price, record.bedrooms, record.bathrooms, record.squareFeet]);
  for (const record of records) {
    const key = comparablePath(new URL(record.sourceUrl).pathname.replace(/\/+$/, ""));
    const known = seen.get(key);
    if (known === facts(record)) continue;
    seen.set(key, known ?? facts(record));
    out.push(record);
  }
  return out;
}

/** ".../applewhite-meadows/vail/" -> "Vail". */
function planNameFromPath(value: string): string | null {
  const slug = asUrl(value)?.pathname.split("/").filter(Boolean).at(-1) ?? value.split("/").filter(Boolean).at(-1);
  return slug ? slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : null;
}

const STATUS_CLASSES = ["status", "status-text", "spec-status", "home-status"];

/** The card around a home's link: its status element's text and a struck-through price (shared helper, status classes of this platform). */
function cardFacts(html: string, root: HtmlElement, path: string, otherHomePaths: readonly string[]): { status: string | null; previousPrice: number | null } {
  const card = cardAroundLink(html, root, path, { statusClasses: STATUS_CLASSES, otherHomePaths });
  return { status: card.status, previousPrice: card.previousPrice };
}

/** The sync publishes a home as a quick move-in only when its status says so; every home on the "available homes" list is one. */
/**
 * The card's status word, from a closed list: ready words, "Under Construction",
 * sold words and "Model". Any other wording, or none, gives no status, so the
 * sync holds the run instead of publishing a home that may not be for sale.
 */
const READY_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function homefinitiStatus(cardStatus: string | null, now: Date = new Date()): { status: string | null; readyNow: boolean; moveInDate?: string } {
  const label = (cardStatus ?? "").replace(/\s+/g, " ").trim();
  if (!label) return { status: null, readyNow: false };
  if (/sold|under\s+contract|pending/i.test(label)) return { status: "Sold", readyNow: false };
  if (/model/i.test(label)) return { status: "Model Home", readyNow: false };
  // "Ready For You" is First America's card word for a finished home (October 2026), the other card word being "Under Construction".
  if (/^(?:move[- ]?in\s+ready|ready\s+now|ready\s+for\s+you|available\s+now|completed?|quick\s+move[- ]?in)!?$/i.test(label)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true };
  if (/^under\s+construction!?$/i.test(label)) return { status: "Quick Move-In (Under Construction)", readyNow: false };
  // Nov 11, 2026 (First America, twelve communities held): a home under construction now says when it will be done,
  // "Ready in November" / "Ready in February", with no year. The month is this year's when it has not passed, next
  // year's otherwise; a month that passed within the last two is a stale estimate (for sale, no date). A year on the
  // card is taken as written.
  const when = /^ready\s+in\s+([A-Za-z]{3,9})\.?(?:\s+(20\d{2}))?!?$/i.exec(label);
  if (when) {
    const month = READY_MONTHS.findIndex((name) => name === when[1]!.toLowerCase() || name.slice(0, 3) === when[1]!.toLowerCase());
    if (month < 0) return { status: null, readyNow: false };
    const thisMonth = now.getUTCMonth();
    const thisYear = now.getUTCFullYear();
    const monthName = `${READY_MONTHS[month]![0]!.toUpperCase()}${READY_MONTHS[month]!.slice(1)}`;
    if (when[2]) {
      const year = Number(when[2]);
      if (year < thisYear || (year === thisYear && month < thisMonth)) return { status: "Quick Move-In (Under Construction)", readyNow: false };
      return { status: `Quick Move-In (${monthName} ${year})`, readyNow: false, moveInDate: `${monthName} ${year}` };
    }
    const monthsAgo = (thisMonth - month + 12) % 12;
    if (monthsAgo === 1 || monthsAgo === 2) return { status: "Quick Move-In (Under Construction)", readyNow: false };
    const year = month >= thisMonth ? thisYear : thisYear + 1;
    return { status: `Quick Move-In (${monthName} ${year})`, readyNow: false, moveInDate: `${monthName} ${year}` };
  }
  return { status: null, readyNow: false };
}

export class HomefinitiAdapter implements DealAdapter {
  readonly builder: HomefinitiBrand;
  readonly host: string;

  constructor(brand: HomefinitiBrand) {
    this.builder = brand;
    this.host = HOMEFINITI_HOSTS[brand];
  }

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, this.host)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", this.host);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const children = homefinitiCollections(page.text, community, this.host);
    let read: HomefinitiPageRead;
    if (!children) read = readHomefinitiPage(page.text, community, this.host, now());
    else {
      // A parent page over collections (Coventry's Garden Grove: "Garden Grove 40'" and "Garden Grove 50'", October 2026) lists
      // its homes under the collections' paths and no plans: each collection's own page is read as part of the community.
      const parent = parseHomefinitiRecords(page.text, this.host);
      if (!parent.community) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
      const childPaths = children.map((child) => pathKey(new URL(child.url)));
      // Every home the parent lists must sit under one of its collections.
      if (parent.homes.some((home) => !childPaths.some((path) => pathKey(new URL(home.sourceUrl)).startsWith(`${path}/`)))) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
      read = { homes: [], plans: [], facts: parseCommunityFacts(page.text) };
      for (const child of children) {
        const childPage = await getDocument(child.url, fetcher, "text/html,application/xhtml+xml", this.host);
        if (!childPage.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(childPage, "community_fetch_failed")]);
        privateSnapshot.pages.push(sourcePage("community", child.url, null));
        const childRead = readHomefinitiPage(childPage.text, new URL(child.url), this.host, now());
        if ("hold" in childRead) return failedResult(config, fetchedAt, privateSnapshot, [childRead.hold]);
        // The parent counts each collection's homes ("10 Homes"): fewer on the collection's page is a partial list.
        if (child.homes !== null && childRead.homes.length < child.homes) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
        read.homes.push(...childRead.homes);
        read.plans.push(...childRead.plans);
      }
      const readPaths = new Set(read.homes.map((home) => pathKey(new URL(home.sourceUrl))));
      if (parent.homes.some((home) => !readPaths.has(pathKey(new URL(home.sourceUrl))))) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
      if (read.homes.length > HOMEFINITI_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    }
    if ("hold" in read) return failedResult(config, fetchedAt, privateSnapshot, [read.hold]);
    privateSnapshot.communityFacts = read.facts;
    for (const home of read.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of read.plans) privateSnapshot.plans.push(plan);
    // Nov 16, 2026 (Peter: "we need to be able to read every banner as that is the headline info per community"): the
    // page's banner is the builder's current headline offer; its terms are on the sales-event page it links to.
    const offerHolds = await readBannerOffer(page.text, read.homes, community, this.host, fetcher, privateSnapshot);
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, offerHolds));
  }
}

/** The page-top banner: its headline ("Interest Rates Starting at 2.99% (5.959% APR)*") and the sales-event page it links to. */
export function homefinitiBanner(html: string, host: string): { headline: string; eventUrl: string | null } | null {
  const root = parseHtmlElements(html);
  const banner = root ? descendants(root).find((element) => elementClass(element, "promo-nav")) : null;
  if (!banner) return null;
  const inner = descendants(banner);
  const headlineElement = inner.find((element) => element.tag === "p") ?? inner.find((element) => element.tag === "span");
  const headline = headlineElement ? elementText(headlineElement, html).replace(/\s+/g, " ").trim() : "";
  if (!headline) return null;
  const link = inner.find((element) => element.tag === "a" && /\/sales-event(?:-listing)?\/?$/i.test(element.attributes.href ?? ""));
  const url = link ? asUrl(new URL(link.attributes.href!, `https://${host}`).toString()) : null;
  return { headline, eventUrl: url && sameOfficialHost(url, host) ? url.toString() : null };
}

/** The market pages a sales-event hub links to ("/san-antonio/sales-event-listing/"), official host only. */
export function homefinitiEventMarkets(html: string, host: string): string[] {
  const out = new Set<string>();
  for (const match of Array.from(html.matchAll(/href=["']([^"']*\/sales-event-listing\/?)["']/gi))) {
    const url = asUrl(new URL(decodeHtmlEntities(match[1]!), `https://${host}`).toString());
    if (url && sameOfficialHost(url, host)) { url.search = ""; url.hash = ""; out.add(url.toString()); }
  }
  return Array.from(out);
}

/**
 * One market's sales-event page: the homes it lists (the offer is for "select homesites": these are them) and its
 * terms, from the first footnote on. What precedes the first footnote is the lender's licensing block (name, NMLS id,
 * street address, phone), which is not offer text.
 */
export function readHomefinitiEventPage(html: string, host: string): { terms: string; homePaths: Set<string> } | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const all = descendants(root);
  const disclaimer = all.find((element) => elementClass(element, "sales-event-disclaimer"));
  if (!disclaimer) return null;
  const full = elementText(disclaimer, html).replace(/\s+/g, " ").trim();
  const footnote = full.search(/\*(?=\s*[A-Za-z0-9])/);
  const terms = footnote > 0 ? full.slice(footnote) : full;
  const homePaths = new Set<string>();
  for (const card of all.filter((element) => element.tag === "article" && elementClass(element, "card-spec"))) {
    for (const link of descendants(card)) {
      if (link.tag !== "a" || !link.attributes.href) continue;
      const url = asUrl(new URL(link.attributes.href, `https://${host}`).toString());
      if (url && sameOfficialHost(url, host) && /^\/new-homes\//i.test(url.pathname)) homePaths.add(pathKey(url));
    }
  }
  return terms ? { terms, homePaths } : null;
}

const MONTHS = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";

/**
 * The offer's facts. The general reader holds a 2/1 buydown (which rate lasts is not its call), but this platform's
 * footnote states the whole schedule in one fixed form: "Year 1 (0-12 months) rate at 2.99%, APR of 5.959% …; Year 2
 * (13-24 months) rate at 3.99%, APR …; Years 3-30 (25-360 months) rate at 4.99%, APR …", the loan ("an FHA 30-year
 * agreement (360 months) fixed rate loan … at 96.5% LTV") and the last closing date. When every part is there and
 * agrees (rates rising, one APR above the last rate, the headline's rate and APR the same as year 1's), the first
 * year and the rate for years 3 on are the facts, and the payment is figured at that last rate. Anything else stays
 * as the general reader left it, held.
 */
export function scheduledBuydownFacts(text: string): PromotionalRateFacts {
  const base = parsePromotionalRate(text);
  const flat = text.replace(/\s+/g, " ");
  const figure = "(\\d+(?:\\.\\d+)?)%";
  const step = (label: string) => `${label}\\s*\\([^)]{0,30}\\)\\s*rate\\s+at\\s+${figure},\\s*APR\\s+of\\s+${figure}`;
  const schedule = new RegExp(`\\b${step("Year\\s*1")}[^;]{0,90};\\s*${step("Year\\s*2")}[^;]{0,90};\\s*${step("Years\\s*3\\s*-\\s*(\\d{2})")}`, "i").exec(flat);
  if (!schedule) return base;
  const [first, firstApr, second, secondApr, term, last, lastApr] = [1, 2, 3, 4, 5, 6, 7].map((index) => Number(schedule[index]));
  const loan = /\b(FHA|VA|USDA|conventional)\s+(\d{2})-year\b[^.]{0,80}?\bfixed\s+rate\b/i.exec(flat);
  const ltv = /\bat\s+(\d{2,3}(?:\.\d+)?)%\s+LTV\b/i.exec(flat);
  const closes = new RegExp(`\\bloans?\\s+closed\\s+on\\s+or\\s+before\\s+(${MONTHS}\\s+\\d{1,2},\\s+\\d{4})`, "i").exec(flat);
  const closingDeadline = closes ? parsePromotionalRate(`Must close on or before ${closes[1]}.`).closingDeadline : null;
  const down = ltv ? Math.round((100 - Number(ltv[1])) * 1000) / 1000 : null;
  const agrees = first! < second! && second! < last! && last! - first! <= 3 && firstApr === secondApr && secondApr === lastApr && lastApr! > last!
    && base.promotionalRatePercent === first && base.aprPercent === lastApr && loan !== null && Number(loan[2]) === term && down !== null && down >= 0 && down < 50
    && Boolean(closingDeadline?.isoDate);
  if (!agrees) return base;
  const resolved = new Set<DealHoldReason>(["missing_repayment_term", "missing_down_payment", "missing_follow_on_rate", "missing_follow_on_period"]);
  const holdReasons = base.holdReasons.filter((reason) => !resolved.has(reason));
  return {
    ...base,
    rateKind: "promotional",
    promotionalPeriod: "Year 1",
    followOnRatePercent: last!,
    followOnPeriod: `Years 3-${term}`,
    loanType: loan![1]!.toUpperCase() === "CONVENTIONAL" ? "Conventional" : loan![1]!.toUpperCase(),
    repaymentTermYears: term!,
    downPaymentPercent: down,
    closingDeadline,
    holdReasons,
    publishable: holdReasons.length === 0,
  };
}

type EventPages = Array<{ url: string; terms: string; homePaths: Set<string> }>;
/** One read of the brand's sales-event pages serves every community synced in the next few minutes (72 communities, 5 pages). */
const EVENT_CACHE_MS = 15 * 60_000;
const eventCache = new WeakMap<object, Map<string, { at: number; pages: Promise<EventPages | null> }>>();

async function loadEventPages(eventUrl: string, host: string, fetcher: HtmlFetcher): Promise<EventPages | null> {
  const accept = "text/html,application/xhtml+xml";
  const first = await getDocument(eventUrl, fetcher, accept, host);
  if (!first.ok) return null;
  // The banner links to the hub ("/sales-event/"), which links to each market's page; a market page is read as is.
  const own = readHomefinitiEventPage(first.text, host);
  const pages: EventPages = own && own.homePaths.size ? [{ url: eventUrl, ...own }] : [];
  for (const url of homefinitiEventMarkets(first.text, host).filter((url) => url !== eventUrl).slice(0, 8)) {
    const market = await getDocument(url, fetcher, accept, host);
    const read = market.ok ? readHomefinitiEventPage(market.text, host) : null;
    if (read) pages.push({ url, ...read });
  }
  return pages.length ? pages : null;
}

/**
 * Reads the banner's offer for this community. The offer is the banner's headline plus the terms of the market page
 * that lists one of this community's homes; a community with no home on any market's list has no offer here.
 */
async function readBannerOffer(pageHtml: string, homes: readonly PrivatePlanOrHome[], community: URL, host: string, fetcher: HtmlFetcher, privateSnapshot: ReturnType<typeof emptyPrivate>): Promise<DealHoldReason[]> {
  const banner = homefinitiBanner(pageHtml, host);
  // No banner: the builder shows no offer now. A banner with no sales-event page is not read (its terms are not published).
  if (!banner) { privateSnapshot.offerRead = true; return []; }
  if (!banner.eventUrl) return [];
  let perFetcher = eventCache.get(fetcher);
  if (!perFetcher) { perFetcher = new Map(); eventCache.set(fetcher, perFetcher); }
  let cached = perFetcher.get(banner.eventUrl);
  if (!cached || Date.now() - cached.at > EVENT_CACHE_MS) {
    cached = { at: Date.now(), pages: loadEventPages(banner.eventUrl, host, fetcher).catch(() => null) };
    perFetcher.set(banner.eventUrl, cached);
  }
  const pages = await cached.pages;
  if (!pages) { perFetcher.delete(banner.eventUrl); return ["incentive_fetch_failed"]; }
  const mine = homes.map((home) => pathKey(new URL(home.sourceUrl)));
  const page = pages.find((candidate) => mine.some((path) => candidate.homePaths.has(path)));
  privateSnapshot.offerRead = true;
  if (!page) return [];
  const text = `${banner.headline} ${page.terms}`;
  privateSnapshot.pages.push(sourcePage("incentive", page.url, banner.headline));
  privateSnapshot.incentive = { sourceUrl: page.url, text, facts: scheduledBuydownFacts(text) };
  void community;
  return [];
}

const pathKey = (url: URL) => comparablePath(url.pathname.replace(/\/+$/, ""));

type HomefinitiPageRead = { hold: DealHoldReason } | { homes: PrivatePlanOrHome[]; plans: PrivatePlanOrHome[]; facts: ReturnType<typeof parseCommunityFacts> };

/**
 * A parent page's collections: the links of its `.child-list` block to sibling pages named for it ("garden-grove" ->
 * "garden-grove-40"), each with the home count its row states ("10 Homes"; null when the row states none). Null when
 * the page lists no collections (an ordinary community page); a list with any other link is not read as collections.
 */
export function homefinitiCollections(html: string, community: URL, host: string): Array<{ url: string; homes: number | null }> | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const list = descendants(root).find((item) => elementClass(item, "child-list"));
  if (!list) return null;
  const parentParts = community.pathname.toLowerCase().split("/").filter(Boolean);
  const slug = parentParts.at(-1) ?? "";
  const out: Array<{ url: string; homes: number | null }> = [];
  for (const row of list.children) {
    const links = Array.from(new Set(descendants(row).filter((item) => item.tag === "a" && item.attributes.href).map((item) => decodeHtmlEntities(item.attributes.href!))));
    if (!links.length) continue;
    const urls = links.map((href) => asUrl(new URL(href, community).toString()));
    const parts = urls.map((url) => url && sameOfficialHost(url, host) ? url.pathname.toLowerCase().split("/").filter(Boolean) : null);
    // One collection per row, a sibling of the parent page whose slug extends the parent's.
    const pages = new Set(parts.map((item) => item ? item.join("/") : ""));
    const first = parts[0];
    if (pages.size !== 1 || !first || first.length !== parentParts.length || first.slice(0, -1).join("/") !== parentParts.slice(0, -1).join("/") || !first.at(-1)!.startsWith(`${slug}-`)) return null;
    const count = /\b(\d{1,3})\s+Homes?\b/i.exec(elementText(row, html));
    out.push({ url: `${urls[0]!.origin}/${first.join("/")}/`, homes: count ? Number(count[1]) : null });
  }
  return out.length && out.length <= 8 ? out : null;
}

/** "4 bed · 2/1 bath · 1,645 sqft": beds, baths (full/half; at most two half baths are a count) and square feet. */
function cardSpecs(text: string): { bedrooms: number; bathrooms: number; squareFeet: number } | null {
  const match = /(\d{1,2})\s*bed\s*·\s*(\d{1,2})(?:\/(\d))?\s*bath\s*·\s*([\d,]{3,6})\s*sqft/i.exec(text.replace(/\s+/g, " "));
  if (!match) return null;
  const half = match[3] ? Number(match[3]) : 0;
  if (half > 2) return null;
  return { bedrooms: Number(match[1]), bathrooms: Number(match[2]) + half * 0.5, squareFeet: Number(match[4]!.replace(/,/g, "")) };
}

type CardHome = { path: string; street: string; city: string | null; price: number; bedrooms: number; bathrooms: number; squareFeet: number; stories: number | null; image: string | null };

/**
 * The page's home cards (`article.card-spec`, Coventry's markup in October 2026): link, `data-price`, the
 * "4 bed · 3 bath · 2,082 sqft" line, the address ("4912 Hawkwell Lane, San Antonio · Homesite 7-2-1"). A card whose
 * figures do not agree with themselves (data attributes against the shown text), or two cards of one home that differ,
 * read as nothing (null for that home).
 */
function parseCardHomes(html: string, root: HtmlElement, community: URL): Map<string, CardHome | null> {
  const out = new Map<string, CardHome | null>();
  for (const article of descendants(root).filter((item) => item.tag === "article" && elementClass(item, "card-spec"))) {
    const inner = descendants(article);
    const hrefs = Array.from(new Set(inner.filter((item) => item.tag === "a" && item.attributes.href).map((item) => decodeHtmlEntities(item.attributes.href!).split(/[?#]/)[0]!)));
    const url = hrefs.length === 1 ? asUrl(new URL(hrefs[0]!, community).toString()) : null;
    if (!url || !sameOfficialHost(url, community.hostname)) continue;
    const path = pathKey(url);
    const specs = inner.filter((item) => item.tag === "p").map((item) => cardSpecs(elementText(item, html))).find(Boolean) ?? null;
    const price = num(article.attributes["data-price"]);
    const shownPrice = inner.filter((item) => elementClass(item, "card-spec-price")).map((item) => /\$\s*([\d,]{5,9})/.exec(elementText(item, html))?.[1]).find(Boolean);
    const address = inner.find((item) => item.tag === "address");
    const place = address ? elementText(address, html).split("·")[0]!.split(",").map((part) => part.trim()) : [];
    const image = inner.find((item) => item.tag === "img" && item.attributes.src)?.attributes.src ?? null;
    const card: CardHome | null = specs && price && price > 0 && shownPrice && num(shownPrice) === price && num(article.attributes["data-square-feet"]) === specs.squareFeet && place[0]
      ? { path, street: place[0], city: place[1] || null, price, ...specs, stories: null, image }
      : null;
    if (out.has(path)) { const known = out.get(path); if (!known || !card || JSON.stringify(known) !== JSON.stringify(card)) out.set(path, null); }
    else out.set(path, card);
  }
  // First America's cards (October 24, 2026): `div.oi-map-item[data-listing-type=spec]` with the price (`.fs-4`), the
  // address (`.address`, street then "City, TX 78155"), `.stat` spans ("5 Beds", "3.0 Baths", "2,824 Sq. Ft.") and a
  // map pop-up repeating the price; a card whose two prices differ reads as nothing.
  for (const block of descendants(root).filter((item) => item.tag !== "article" && elementClass(item, "oi-map-item") && item.attributes["data-listing-type"] === "spec")) {
    const inner = descendants(block);
    const own = Array.from(new Set(inner.filter((item) => item.tag === "a" && item.attributes.href).map((item) => asUrl(new URL(decodeHtmlEntities(item.attributes.href!).split(/[?#]/)[0]!, community).toString())).filter((url): url is URL => Boolean(url && sameOfficialHost(url, community.hostname))).map((url) => pathKey(url))));
    if (own.length !== 1) continue;
    const path = own[0]!;
    const prices = inner.filter((item) => elementClass(item, "fs-4") || (elementClass(item, "fs-5") && elementClass(item, "f-display"))).map((item) => num((/\$\s*([\d,]{5,9})/.exec(elementText(item, html)) ?? [])[1]?.replace(/,/g, "")));
    const price = prices[0] ?? null;
    const stat = (pattern: RegExp) => inner.filter((item) => elementClass(item, "stat")).map((item) => pattern.exec(elementText(item, html))).find(Boolean);
    const beds = stat(/^(\d{1,2})\s*Beds?$/i);
    const baths = stat(/^(\d{1,2}(?:\.\d)?)\s*Baths?$/i);
    const sqft = stat(/^([\d,]{3,6})\s*Sq\.?\s*Ft\.?$/i);
    const stories = stat(/^(\d(?:\.\d)?)\s*Stor(?:y|ies)$/i);
    const address = inner.find((item) => elementClass(item, "address"));
    const lines = address ? html.slice(address.contentStart, address.contentEnd).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").split("\n").map((line) => decodeHtmlEntities(line).replace(/\s+/g, " ").trim()).filter(Boolean) : [];
    const image = inner.find((item) => item.tag === "img" && item.attributes.src)?.attributes.src ?? null;
    const consistent = price !== null && price > 0 && prices.every((value) => value === price);
    const card: CardHome | null = consistent && beds && baths && sqft && lines[0]
      ? { path, street: lines[0], city: lines[1]?.split(",")[0]?.trim() || null, price, bedrooms: Number(beds[1]), bathrooms: Number(baths[1]), squareFeet: Number(sqft[1]!.replace(/,/g, "")), stories: stories ? storiesFrom(stories[1]) : null, image }
      : null;
    if (out.has(path)) { const known = out.get(path); if (!known || !card || JSON.stringify(known) !== JSON.stringify(card)) out.set(path, null); }
    else out.set(path, card);
  }
  return out;
}

/** One community page of the platform: its homes (records, and cards the records corroborate) and plans, or the hold. */
function readHomefinitiPage(html: string, community: URL, host: string, now: Date = new Date()): HomefinitiPageRead {
  const records = parseHomefinitiRecords(html, host);
  // Without the community's own record this is not one of the platform's community pages.
  if (!records.community) return { hold: "expected_community_container_not_found" };
  if (records.homes.length > HOMEFINITI_MAX_HOMES) return { hold: "incomplete_inventory" };
  // Two records of one home page that disagree on its figures: neither is read as the home.
  const recordPaths = records.homes.map((home) => pathKey(new URL(home.sourceUrl)));
  if (new Set(recordPaths).size !== recordPaths.length) return { hold: "invalid_inventory_response" };
  const root = parseHtmlElements(html);
  if (!root) return { hold: "expected_community_container_not_found" };
  // A home record of another community on the same host (a "nearby homes" block) is never this community's inventory.
  const communitySlug = community.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
  if (records.homes.some((home) => !new URL(home.sourceUrl).pathname.toLowerCase().split("/").includes(communitySlug))) return { hold: "invalid_inventory_response" };
  // More home cards on the page than home records means the records changed shape, not that homes sold. A card is a status
  // element with links into this community near it, counted once per set of links (a featured strip repeats a card's home);
  // a community-wide badge ("Now Selling") has no such link and is not a card.
  const all = descendants(root);
  const parents = new Map<HtmlElement, HtmlElement>();
  for (const element of all) for (const child of element.children) parents.set(child, element);
  const communityDepth = community.pathname.split("/").filter(Boolean).length;
  const linksIntoCommunity = (scope: HtmlElement) => Array.from(new Set(descendants(scope).flatMap((item) => {
    if (item.tag !== "a" || !item.attributes.href) return [];
    const path = decodeHtmlEntities(item.attributes.href).split(/[?#]/)[0]!.toLowerCase().replace(/\/+$/, "");
    return path.split("/").includes(communitySlug) && path.split("/").filter(Boolean).length > communityDepth ? [path] : [];
  }))).sort();
  const isStatus = (element: HtmlElement) => STATUS_CLASSES.some((token) => elementClass(element, token)) && elementText(element, html).length <= 40;
  const cards = new Set<string>();
  for (const element of all.filter(isStatus)) {
    let scope: HtmlElement | undefined = element;
    for (let up = 0; scope && up < 4; up++, scope = parents.get(scope)) {
      // The card is the nearest block that links to a home and holds this one status; a block holding several is the list.
      if (descendants(scope).filter(isStatus).length > 1) break;
      const links = linksIntoCommunity(scope);
      if (links.length) { cards.add(links.join(" ")); break; }
    }
  }
  // A home with a card but no record (Coventry's 4912 Hawkwell Lane, October 2026: no record on any page) is read from its
  // card only when the cards say exactly what the records say for every home that has both, and at least three do; a home
  // page one level under a plan in this community, never another page.
  const cardHomes = parseCardHomes(html, root, community);
  const recordByPath = new Map(records.homes.map((home) => [pathKey(new URL(home.sourceUrl)), home] as const));
  // Homes sit two levels under the community: under its page's path, or under the shorter path its own records use (First
  // America's Cordova Crossing, Oct 24 2026: page /new-homes/tx/san-antonio-metro/seguin/cordova-crossing/, homes under
  // /new-homes/tx/seguin/cordova-crossing/<plan>/<home>/), never anywhere else.
  const homeBases = new Set([pathKey(community)]);
  for (const path of Array.from(recordByPath.keys())) {
    const segments = path.split("/").filter(Boolean);
    const at = segments.lastIndexOf(communitySlug);
    if (at >= 0 && segments.length === at + 3) homeBases.add(`/${segments.slice(0, at + 1).join("/")}`);
  }
  const unrecorded = Array.from(cardHomes.keys()).filter((path) => !recordByPath.has(path) && Array.from(homeBases).some((base) => path.startsWith(`${base}/`) && path.split("/").filter(Boolean).length === base.split("/").filter(Boolean).length + 2));
  const fromCards: HomefinitiRecord[] = [];
  if (unrecorded.length) {
    const pairs = Array.from(recordByPath).filter(([path]) => cardHomes.has(path));
    const agree = pairs.every(([path, record]) => {
      const card = cardHomes.get(path);
      return card && card.price === record.price && card.bedrooms === record.bedrooms && card.bathrooms === record.bathrooms && card.squareFeet === record.squareFeet && card.street.toLowerCase() === (record.privateName ?? "").toLowerCase();
    });
    if (agree && pairs.length >= 3 && unrecorded.every((path) => cardHomes.get(path))) {
      for (const path of unrecorded) {
        const card = cardHomes.get(path)!;
        const url = new URL(path.replace(/\/?$/, "/"), community.origin);
        fromCards.push({ kind: "home", sourceUrl: url.toString(), privateName: card.street, privateAddress: [card.street, card.city, "TX"].filter(Boolean).join(", "), privatePlanName: planNameFromPath(url.pathname.split("/").filter(Boolean).at(-2) ?? ""), status: null, price: card.price, bedrooms: card.bedrooms, bathrooms: card.bathrooms, squareFeet: card.squareFeet, stories: card.stories, readyNow: false, gallery: card.image ? gallery([card.image], false) : [] });
      }
    }
  }
  const homes = [...records.homes, ...fromCards];
  if (cards.size > homes.length) return { hold: "expected_community_container_not_found" };
  const homePaths = homes.map((home) => new URL(home.sourceUrl).pathname);
  const out: PrivatePlanOrHome[] = [];
  for (const record of homes) {
    const { kind: _kind, ...home } = record;
    const card = cardFacts(html, root, new URL(home.sourceUrl).pathname, homePaths);
    // A home listed without a card, or with a status word the reader does not know, is not published on a guess: the run is held.
    const status = homefinitiStatus(card.status, now);
    if (!status.status) return { hold: "unlabelled_home_status" };
    out.push({
      ...home, status: status.status, readyNow: status.readyNow, ...(status.moveInDate ? { moveInDate: status.moveInDate } : {}),
      previousPrice: card.previousPrice && home.price && card.previousPrice > home.price ? card.previousPrice : null,
      priceDrop: card.previousPrice && home.price && card.previousPrice > home.price ? card.previousPrice - home.price : null,
    });
  }
  return { homes: out, plans: records.plans.map(({ kind: _kind, ...plan }) => plan), facts: parseCommunityFacts(html) };
}

/** Community page links on a builder's market page (Coventry lists its San Antonio communities at /new-homes/tx/san-antonio/). */
export function homefinitiMarketLinks(html: string, host: string): string[] {
  const out = new Set<string>();
  for (const match of Array.from(html.matchAll(/<a\b[^>]*href=["']([^"'#?]+)["']/gi))) {
    const href = decodeHtmlEntities(match[1]!);
    const url = asUrl(new URL(href, `https://${host}/`).toString());
    if (!url || !sameOfficialHost(url, host)) continue;
    if (!/^\/new-homes\/tx\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(url.pathname)) continue;
    if (/\/(?:available-homes|floorplans|build-on-your-lot[a-z0-9-]*)\/?$/i.test(url.pathname)) continue;
    out.add(`${url.origin}${url.pathname.replace(/\/?$/, "/")}`);
  }
  return Array.from(out);
}

