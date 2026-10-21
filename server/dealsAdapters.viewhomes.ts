import {
  NMLS_ID_PATTERN_ALL, VIEWHOMES_HOST, asUrl, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * VIEW HOMES reader (yourviewhome.com, a WordPress site). Two documents
 * describe a community:
 *
 * - The community page `/communities/<slug>/` is server-rendered: a hero with
 *   the name ("Welcome to<br>Name"), a status badge ("Now Selling", "Coming
 *   Soon", "Final Opportunity"), the sales phone, the sales address (text of
 *   the Google Maps link) and "Starting Price" / "Sq. Ft." / "Beds" / "Baths"
 *   meta; then the "Available Homes + Home Designs" module (`#floorplans`)
 *   with one `.home-preview` card per home for sale (street, "Plan: X",
 *   "Ready Now!" or "Est. Completion- October", "Move In: Oct 2026", price,
 *   Sq. Ft./Beds/Baths/Garage, a link to `/communities/<slug>/homes/<street
 *   slug>/`) and one `.floorplan-preview` card per plan ("Starting From
 *   $369,990", specs, a link to `/communities/<slug>/floorplans/<plan>/`).
 *   A community with no homes for sale has no "Available Homes" tab at all; a
 *   coming-soon page (hero badge "Coming Soon") has no module at all.
 * - The region page `/region/texas/` embeds the market roster as JSON
 *   (`oceanFloorModules.communitiesMapList.push({ …, regions: [...] })`):
 *   every Texas community with its page URL, status, sales address with
 *   coordinates, phone, price range and its homes for sale (page URL, plan,
 *   status text, "Move In: Oct 2026" month, price, specs, photo). The roster
 *   is the discovery listing (every record, no page reads) and, read once
 *   per run, it corroborates each community page: the page's home links and
 *   the roster's must be the same set, or the run is held.
 *
 * The site-wide promotion is an image banner linking to a promo page
 * (`/promo-<campaign>/`) whose text states the offer ("choose a 5.25%*
 * Fixed-Rate or up to $55,000** in flex cash", the APR footnotes and the
 * terms) and lists the participating communities by link; the offer applies
 * to a community only when that list links its page. Read-only, plain GET,
 * official host only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - roster:    /region/texas/                       (about 250 KB)
 * - community: /communities/<slug>/                 (about 300 KB)
 * - home:      /communities/<slug>/homes/<street>/
 * - plan:      /communities/<slug>/floorplans/<plan>/
 * - promo:     /promo-<campaign>/
 */
/** A community with more homes for sale than this is held, never truncated. */
export const VIEWHOMES_MAX_HOMES = 150;
export const viewHomesListingUrl = () => `https://${VIEWHOMES_HOST}/region/texas/`;
/** The roster and the promo page are read once per run: both are shared by every community. */
const CACHE_MS = 10 * 60 * 1000;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Oct", "Oct.", "Sept" and "October" name a month; "Octember" does not. */
const monthIndex = (name: string): number | null => {
  const key = name.toLowerCase().replace(/\.$/, "");
  const index = MONTH_NAMES.findIndex((month) => month.toLowerCase() === key || month.toLowerCase().slice(0, 3) === key || (key === "sept" && month === "September"));
  return index >= 0 ? index + 1 : null;
};

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : null;
const num = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const positive = (value: unknown): number | null => { const parsed = num(value); return parsed && parsed > 0 ? parsed : null; };

let rosterCache: { fetchedAt: number; communities: ViewHomesListedCommunity[] } | null = null;
let promoCache: { fetchedAt: number; url: string; promo: ViewHomesPromo | null } | null = null;
export function resetViewHomesCaches(): void { rosterCache = null; promoCache = null; }

/** A page path for comparison: decoded, lower case, one trailing slash. */
const pagePath = (url: URL): string => `${comparablePath(url.pathname.replace(/\/+$/, ""))}/`;
const pageUrlOf = (url: URL): string => `${url.origin}${url.pathname.replace(/\/+$/, "")}/`;

/**
 * "Ready Now!" is ready; "Est. Completion- October" names a month, whose
 * year is the "Move In: Oct 2026" line's when the card has one, else this
 * year for a month still to come and (a stale estimate) no date for one that
 * has passed. Sold or under contract is sold. Other wording, or none, gives no
 * status (the run is held).
 */
export function viewHomesStatus(label: string | null, moveIn: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under\s+contract/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/^(?:ready\s+now|move[- ]?in\s+ready|available\s+now)\s*!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const estimated = /^est\.?(?:imated)?\s+completion\s*[-–:]?\s*([A-Za-z]+)\.?(?:\s+(\d{4}))?$/i.exec(text);
  if (!estimated) return { status: null, readyNow: false, moveInDate: null };
  const month = monthIndex(estimated[1]!);
  const badgeYear = estimated[2] ? Number(estimated[2]) : null;
  if (month === null) return { status: null, readyNow: false, moveInDate: null };
  const stated = /^(?:move[- ]?in\s*:?\s*)?([A-Za-z]+)\.?\s+(\d{4})$/i.exec((moveIn ?? "").replace(/\s+/g, " ").trim());
  const statedMonth = stated ? monthIndex(stated[1]!) : null;
  const statedYear = stated ? Number(stated[2]) : null;
  const thisYear = now.getUTCFullYear();
  const thisMonth = now.getUTCMonth() + 1;
  // A move-in line names the year (and, when it differs from the badge, the newer month); without one the badge's month is the next such month (this year's at or after the current month, else next year's), as the Century reader reads a year-less month; a stated month that has passed is a stale estimate.
  if (stated && (statedMonth === null || statedYear === null || statedYear < 2000 || statedYear > thisYear + 5)) return { status: null, readyNow: false, moveInDate: null };
  if (!stated && badgeYear !== null && (badgeYear < 2000 || badgeYear > thisYear + 5)) return { status: null, readyNow: false, moveInDate: null };
  const effectiveMonth = stated ? statedMonth! : month;
  const year = stated ? statedYear! : badgeYear ?? (month >= thisMonth ? thisYear : thisYear + 1);
  if (year < thisYear || (year === thisYear && effectiveMonth < thisMonth)) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${MONTH_NAMES[effectiveMonth - 1]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type ViewHomesCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };
export type ViewHomesListedHome = { url: string; street: string | null; plan: string | null; statusText: string | null; moveIn: string | null; price: number | null; squareFeet: number | null; bedrooms: number | null; bathrooms: number | null; garage: number | null; photo: string | null };
export type ViewHomesListedCommunity = { postId: number | null; url: string; status: { value: string | null; label: string | null }; record: ViewHomesCommunityRecord; homes: ViewHomesListedHome[] };

/** The JSON array that starts at `html[start]` (a `[`), read with string-aware bracket matching; null when unbalanced. */
function jsonArrayAt(html: string, start: number): string | null {
  if (html[start] !== "[") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length && index - start < 6_000_000; index++) {
    const char = html[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") { if (--depth === 0) return html.slice(start, index + 1); }
  }
  return null;
}

const photoUrl = (value: unknown): string | null => {
  const url = typeof value === "string" ? asUrl(decodeHtmlEntities(value)) : null;
  if (!url || !sameOfficialHost(url, VIEWHOMES_HOST) || !/^\/wp-content\/uploads\//i.test(url.pathname) || /floor\s*plan|floorplan|site\s*plan|\.pdf$|\.svg$/i.test(url.pathname)) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
};

function listedRecord(row: Json): ViewHomesCommunityRecord | null {
  const name = str(row.post_title);
  if (!name) return null;
  const address = obj(row.address);
  const street = str(address?.street);
  const lat = Number(address?.lat);
  const lng = Number(address?.lng);
  const range = obj(row.price_range);
  const price = obj(row.price);
  return {
    name,
    street: looksLikeStreetAddress(street) ? street : null,
    city: str(address?.city),
    zip: /^\d{5}/.exec(str(address?.zip) ?? "")?.[0] ?? null,
    phone: (str(row.phone) ?? "").replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "") || null,
    priceFrom: positive(range?.PriceLow) ?? positive(price?.value),
    geo: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
  };
}

function listedHome(row: Json, host: string): ViewHomesListedHome | null {
  const link = str(row.permalink);
  const url = link ? asUrl(link) : null;
  if (!url || !sameOfficialHost(url, host)) return null;
  const specs = obj(row.specs);
  const plan = obj(row.plan);
  return {
    url: pageUrlOf(url),
    street: str(row.post_title),
    plan: str(plan?.name),
    statusText: str(obj(row.status)?.text),
    moveIn: str(row.move_in),
    price: positive(row.price),
    squareFeet: positive(specs?.sqft),
    bedrooms: positive(specs?.beds),
    bathrooms: positive(specs?.baths),
    garage: positive(specs?.garage),
    photo: photoUrl(row.full) ?? photoUrl(row.thumbnail),
  };
}

/** The region page's roster: every community with its record, status and homes for sale, one entry per page; null when the page embeds no roster. */
export function parseViewHomesRoster(html: string, host: string): ViewHomesListedCommunity[] | null {
  const push = html.indexOf("oceanFloorModules.communitiesMapList.push(");
  if (push < 0) return null;
  const key = /\bregions\s*:\s*\[/g;
  key.lastIndex = push;
  const match = key.exec(html);
  if (!match) return null;
  const text = jsonArrayAt(html, match.index + match[0].length - 1);
  let regions: unknown;
  try { regions = text ? JSON.parse(text) : null; } catch { return null; }
  if (!Array.isArray(regions)) return null;
  const out = new Map<string, ViewHomesListedCommunity>();
  const visit = (region: Json) => {
    for (const raw of arr(region.communities)) {
      const row = obj(raw);
      const link = row ? str(row.permalink) : null;
      const url = link ? asUrl(link) : null;
      const record = row ? listedRecord(row) : null;
      if (!row || !url || !sameOfficialHost(url, host) || !record) continue;
      const page = pageUrlOf(url);
      if (out.has(page)) continue;
      const status = obj(obj(row.status)?.status) ?? obj(row.status);
      out.set(page, {
        postId: positive(row.post_id),
        url: page,
        status: { value: str(status?.value), label: str(status?.label) },
        record,
        homes: arr(row.homes).map((home) => obj(home)).flatMap((home) => { const parsed = home ? listedHome(home, host) : null; return parsed ? [parsed] : []; }),
      });
    }
    for (const nested of arr(region.regions)) { const inner = obj(nested); if (inner) visit(inner); }
  };
  for (const raw of regions) { const region = obj(raw); if (region) visit(region); }
  return Array.from(out.values());
}

/** The roster's communities for discovery: every selling record (a coming-soon row has nothing to read yet, as with Drees). */
export function viewHomesListingEntries(html: string, host: string): Array<{ url: string; record: ViewHomesCommunityRecord }> | null {
  const roster = parseViewHomesRoster(html, host);
  return roster ? roster.filter((row) => !/^soon$/i.test(row.status.value ?? "") && !/coming\s+soon/i.test(row.status.label ?? "")).map((row) => ({ url: row.url, record: row.record })) : null;
}

function classText(scope: readonly HtmlElement[], html: string, token: string): string | null {
  const element = scope.find((item) => elementClass(item, token));
  return element ? elementText(element, html) || null : null;
}

/** The card's Sq. Ft./Beds/Baths/Garage pairs by label. */
function specPairs(scope: readonly HtmlElement[], html: string, prefix: string): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const spec of scope.filter((item) => elementClass(item, `${prefix}__spec`))) {
    const inner = descendants(spec);
    const label = classText(inner, html, `${prefix}__spec-label`)?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
    const value = classText(inner, html, `${prefix}__spec-value`);
    if (label) out[label] = positive(value);
  }
  return out;
}

function cardPhotos(scope: readonly HtmlElement[], token: string): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  for (const wrapper of scope.filter((item) => elementClass(item, token))) {
    for (const image of descendants(wrapper).filter((item) => item.tag === "img")) {
      // Lazy images name their file in data-breeze; the sized copy "-400x267" stands for the original WordPress keeps beside it.
      const source = image.attributes["data-breeze"] || image.attributes.src || "";
      const url = photoUrl(source.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]{3,4}$)/i, ""));
      if (url && !out.some((item) => item.sourceUrl === url)) out.push({ sourceUrl: url, caption: "Representative image", width: null, height: null, srcSet: null });
    }
  }
  return out;
}

export type ViewHomesPage = {
  name: string;
  /** The hero badge: "Now Selling", "Coming Soon", "Final Opportunity"; null when the hero has none. */
  heroStatus: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
  priceFrom: number | null;
  /** True when the page's canonical link names another page on the host: a same-host redirect to another community. */
  foreignPage: boolean;
  /** True when the page has the homes-and-plans module at all (a coming-soon page has none). */
  hasModule: boolean;
  /** True when the module has an "Available Homes" tab (a community with no homes for sale has none). */
  hasHomesTab: boolean;
  /** The home cards' page URLs under this community. */
  homeUrls: string[];
  /** True when a home or plan card links under another community's path. */
  foreignHome: boolean;
  foreignPlan: boolean;
  plans: PrivatePlanOrHome[];
  /** The promotion banner's page on the official host, when the page carries one. */
  promoUrl: string | null;
};

/** The community on the page; null when the page has no hero heading. */
export function parseViewHomesCommunity(html: string, pageUrl: string): ViewHomesPage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const host = community.hostname;
  const all = descendants(root);
  const heading = all.find((item) => item.tag === "h1" && elementClass(item, "hero__heading"));
  const name = heading ? elementText(heading, html).replace(/^welcome\s+to\s*/i, "").trim() : "";
  if (!name) return null;
  const base = pagePath(community);
  const hero = all.find((item) => elementClass(item, "hero__content"));
  const heroParts = hero ? descendants(hero) : [];
  const addressLink = heroParts.find((item) => item.tag === "a" && elementClass(item, "notranslate") && /maps/i.test(item.attributes.href ?? ""));
  const addressText = addressLink ? elementText(addressLink, html) : "";
  const address = /^(?:(.*?),\s*)?([A-Za-z .'-]+),\s*TX\s*(\d{5})?/.exec(addressText);
  const street = address?.[1]?.trim() ?? null;
  const tel = heroParts.find((item) => item.tag === "a" && /^tel:/i.test(item.attributes.href ?? ""));
  let priceFrom: number | null = null;
  for (const item of heroParts.filter((element) => elementClass(element, "hero__meta-item"))) {
    const inner = descendants(item);
    if (/starting\s+price/i.test(classText(inner, html, "hero__meta-label") ?? "")) priceFrom = positive(classText(inner, html, "hero__meta-value"));
  }
  const canonical = all.find((item) => item.tag === "link" && (item.attributes.rel ?? "").toLowerCase() === "canonical" && item.attributes.href);
  const canonicalUrl = canonical ? asUrl(decodeHtmlEntities(canonical.attributes.href!)) : null;
  const foreignPage = canonicalUrl !== null && sameOfficialHost(canonicalUrl, host) && pagePath(canonicalUrl) !== base;
  const module = all.find((item) => elementClass(item, "module-community-floorplans-homes"));
  const moduleParts = module ? descendants(module) : [];
  const hasHomesTab = moduleParts.some((item) => elementClass(item, "js-tabs-title") && (item.attributes["data-slug"] ?? "").toLowerCase() === "homes");
  const homeUrls: string[] = [];
  let foreignHome = false;
  for (const card of moduleParts.filter((item) => elementClass(item, "home-preview"))) {
    const link = descendants(card).find((item) => item.tag === "a" && elementClass(item, "home-preview__link") && item.attributes.href);
    const url = link ? asUrl(new URL(decodeHtmlEntities(link.attributes.href!), community).toString()) : null;
    if (!url || !sameOfficialHost(url, host)) { foreignHome = true; continue; }
    if (!pagePath(url).startsWith(`${base}homes/`)) { foreignHome = true; continue; }
    const page = pageUrlOf(url);
    if (!homeUrls.includes(page)) homeUrls.push(page);
  }
  const plans: PrivatePlanOrHome[] = [];
  let foreignPlan = false;
  for (const card of moduleParts.filter((item) => elementClass(item, "floorplan-preview"))) {
    const inner = descendants(card);
    const link = inner.find((item) => item.tag === "a" && elementClass(item, "floorplan-preview__link") && item.attributes.href);
    const planName = classText(inner, html, "floorplan-preview__title");
    const url = link ? asUrl(new URL(decodeHtmlEntities(link.attributes.href!), community).toString()) : null;
    if (!planName || !url || !sameOfficialHost(url, host)) continue;
    if (!pagePath(url).startsWith(`${base}floorplans/`)) { foreignPlan = true; continue; }
    const specs = specPairs(inner, html, "floorplan-preview");
    const price = /\$\s*([\d,]{5,9})/.exec(classText(inner, html, "floorplan-preview__price") ?? "");
    plans.push({
      sourceUrl: pageUrlOf(url),
      privateName: planName,
      privatePlanName: planName,
      status: null,
      price: price ? positive(price[1]) : null,
      bedrooms: specs.beds ?? null,
      bathrooms: specs.baths ?? null,
      squareFeet: specs.sqft ?? null,
      garage: specs.garage ?? null,
      readyNow: false,
      gallery: cardPhotos(inner, "floorplan-preview__image"),
    });
  }
  const banner = all.find((item) => item.tag === "a" && elementClass(item, "banner-ad__link") && item.attributes.href);
  const bannerUrl = banner ? asUrl(new URL(decodeHtmlEntities(banner.attributes.href!), community).toString()) : null;
  return {
    name,
    heroStatus: hero ? classText(heroParts, html, "hero__status") : null,
    street: looksLikeStreetAddress(street) ? street : null,
    city: address?.[2]?.trim() ?? null,
    zip: address?.[3] ?? null,
    phone: tel ? decodeHtmlEntities(tel.attributes.href!).replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "") || null : null,
    priceFrom,
    foreignPage,
    hasModule: Boolean(module),
    hasHomesTab,
    homeUrls,
    foreignHome,
    foreignPlan,
    plans,
    promoUrl: bannerUrl && sameOfficialHost(bannerUrl, host) ? pageUrlOf(bannerUrl) : null,
  };
}

/** Links, e-mail addresses, phone numbers, NMLS ids and footnote marks go from the offer text. */
function cleanOfferText(value: string): string {
  return value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/\(?\b\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, " ")
    .replace(NMLS_ID_PATTERN_ALL, " ")
    .replace(/\*+/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim();
}

export type ViewHomesPromo = { text: string | null; communityUrls: string[]; /** True when the page has the participating-communities block at all. */ hasCommunityList: boolean };

/** The promo page's offer text (headline, option and footnotes) and the participating communities' page URLs; null when the page is not a promotion. */
export function parseViewHomesPromo(html: string, pageUrl: string): ViewHomesPromo | null {
  const page = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!page || !root) return null;
  const all = descendants(root);
  const overview = all.find((item) => elementClass(item, "promo-overview"));
  if (!overview) return null;
  const parts = descendants(overview);
  const pieces: string[] = [];
  for (const token of ["promo-overview__highlight", "promo-overview__option-label", "promo-overview__option-title", "promo-overview__option-text"]) {
    for (const element of parts.filter((item) => elementClass(item, token))) { const text = elementText(element, html); if (text) pieces.push(text); }
  }
  const disclaimer = all.find((item) => elementClass(item, "PromoFooter__disclaimer"));
  for (const paragraph of disclaimer ? descendants(disclaimer).filter((item) => item.tag === "p") : []) { const text = elementText(paragraph, html); if (text) pieces.push(text); }
  const text = cleanOfferText(pieces.join(" ").slice(0, 4_000));
  const list = all.find((item) => elementClass(item, "promo-info__communities"));
  const communityUrls: string[] = [];
  for (const link of list ? descendants(list).filter((item) => item.tag === "a" && item.attributes.href) : []) {
    const url = asUrl(new URL(decodeHtmlEntities(link.attributes.href!), page).toString());
    // The site is on the apex host; a "www." link in the list names the same page.
    if (url && url.hostname.toLowerCase() === `www.${page.hostname.toLowerCase()}`) url.hostname = page.hostname;
    if (url && sameOfficialHost(url, page.hostname)) communityUrls.push(pageUrlOf(url));
  }
  return { text: text && /\d+(?:\.\d+)?\s*%|\$\s*[\d,]{4,}/.test(text) ? text : null, communityUrls, hasCommunityList: Boolean(list) };
}

/** The Texas roster, read once per run. */
async function roster(fetcher: HtmlFetcher, now: number): Promise<{ communities: ViewHomesListedCommunity[] } | { hold: DealHoldReason }> {
  if (rosterCache && now - rosterCache.fetchedAt < CACHE_MS) return { communities: rosterCache.communities };
  const page = await getDocument(viewHomesListingUrl(), fetcher, "text/html,application/xhtml+xml", VIEWHOMES_HOST);
  if (!page.ok) return { hold: fetchFailureHold(page, "community_fetch_failed") };
  const communities = parseViewHomesRoster(page.text, VIEWHOMES_HOST);
  if (!communities) return { hold: "expected_community_container_not_found" };
  rosterCache = { fetchedAt: now, communities };
  return { communities };
}

/** The promotion page, read once per run. */
async function promotion(url: string, fetcher: HtmlFetcher, now: number): Promise<{ promo: ViewHomesPromo | null } | { hold: DealHoldReason }> {
  if (promoCache && promoCache.url === url && now - promoCache.fetchedAt < CACHE_MS) return { promo: promoCache.promo };
  const page = await getDocument(url, fetcher, "text/html,application/xhtml+xml", VIEWHOMES_HOST);
  if (!page.ok) return { hold: page.redirectedOffOfficialHost ? "unsupported_official_host" : "incentive_fetch_failed" };
  const promo = parseViewHomesPromo(page.text, url);
  if (!promo) return { hold: "expected_incentive_container_not_found" };
  promoCache = { fetchedAt: now, url, promo };
  return { promo };
}

export class ViewHomesAdapter implements DealAdapter {
  readonly builder = "View Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, VIEWHOMES_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", VIEWHOMES_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseViewHomesCommunity(page.text, community.toString());
    // Without the hero heading and the homes-and-plans module this is not a community page, unless the hero says "Coming Soon":
    // a coming-soon page has no module at all (Ladera, Enclave 35 in October 2026), which the roster must corroborate below.
    const comingSoonPage = Boolean(parsed && !parsed.hasModule && /^coming\s+soon!?$/i.test(parsed.heroStatus ?? ""));
    if (!parsed || (!parsed.hasModule && !comingSoonPage)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The page must be this community's (a same-host redirect to another one is not), and so must its homes and plans.
    if (parsed.foreignPage || parsed.foreignHome || parsed.foreignPlan) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    const market = await roster(fetcher, now().getTime());
    if ("hold" in market) return failedResult(config, fetchedAt, privateSnapshot, [market.hold]);
    const communityPage = pageUrlOf(community);
    const row = market.communities.find((item) => pagePath(new URL(item.url)) === pagePath(community));
    // The roster must list the page's community.
    if (!row) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // A page without the module is a community with nothing for sale only when the roster also lists it as coming soon, with no homes.
    if (comingSoonPage && !((/^soon$/i.test(row.status.value ?? "") || /^coming\s+soon$/i.test(row.status.label ?? "")) && row.homes.length === 0)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The page's home cards and the roster's homes must be the same set; an "Available Homes" tab with no cards is a changed page.
    const listedUrls = row.homes.map((home) => pagePath(new URL(home.url)));
    const cardUrls = parsed.homeUrls.map((url) => pagePath(new URL(url)));
    if (parsed.hasHomesTab && cardUrls.length === 0) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (cardUrls.length !== listedUrls.length || !cardUrls.every((url) => listedUrls.includes(url))) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    if (row.homes.length > VIEWHOMES_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const city = parsed.city ?? row.record.city;
    const zip = parsed.zip ?? row.record.zip;
    const cityLine = city ? `${city}, ${zip ? `TX ${zip}` : "TX"}` : "TX";
    const homes: PrivatePlanOrHome[] = [];
    for (const home of row.homes) {
      const readable = looksLikeStreetAddress(home.street);
      const status = viewHomesStatus(home.statusText, home.moveIn, now());
      homes.push({
        sourceUrl: home.url,
        privateName: home.street,
        privateAddress: readable ? `${home.street}, ${cityLine}` : null,
        privatePlanName: home.plan,
        status: readable ? status.status : null,
        price: home.price,
        bedrooms: home.bedrooms,
        bathrooms: home.bathrooms,
        squareFeet: home.squareFeet,
        garage: home.garage,
        readyNow: status.readyNow,
        moveInDate: status.moveInDate,
        gallery: home.photo ? [{ sourceUrl: home.photo, caption: "Representative image", width: null, height: null, srcSet: null }] : [],
      });
    }
    const facts = parseCommunityFacts(page.text);
    const prices = homes.map((home) => home.price).filter((price): price is number => price !== null && price >= 50_000);
    const fromPrice = [parsed.priceFrom, row.record.priceFrom, facts.fromPrice].find((price): price is number => price !== null && price >= 50_000) ?? (prices.length ? Math.min(...prices) : null);
    privateSnapshot.communityFacts = { ...facts, fromPrice };
    for (const home of homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    const incentiveHolds: DealHoldReason[] = [];
    if (!parsed.promoUrl) privateSnapshot.offerRead = true;
    if (parsed.promoUrl) {
      const promo = await promotion(parsed.promoUrl, fetcher, now().getTime());
      if ("hold" in promo) incentiveHolds.push(promo.hold);
      // An offer with no participating-communities block is a changed page: held, never applied or dropped silently.
      else if (promo.promo?.text && !promo.promo.hasCommunityList) incentiveHolds.push("expected_incentive_container_not_found");
      else {
        privateSnapshot.offerRead = true;
        if (promo.promo?.text && promo.promo.communityUrls.some((url) => pagePath(new URL(url)) === pagePath(community))) {
          privateSnapshot.pages.push(sourcePage("incentive", parsed.promoUrl, null));
          privateSnapshot.incentive = { sourceUrl: communityPage, text: promo.promo.text, facts: parsePromotionalRate(promo.promo.text) };
        }
      }
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
  }
}
