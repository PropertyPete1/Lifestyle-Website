import {
  HAKES_HOST, asUrl, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";
import { jsonLdRecords } from "./dealsAdapters.homefiniti";

/**
 * HAKES BROTHERS reader (www.hakesbrothers.com, an October CMS site,
 * server-rendered). The community page `/san-antonio/<slug>` carries:
 *
 * - a schema.org `HomeAndConstructionBusiness` record ("Hakes Brothers at
 *   The Woodlands": sales address, phone, pin, its own `url`);
 * - one `SingleFamilyResidence` record per home for sale (its `url`,
 *   street address, pin, floor size, bedrooms, full and partial bathrooms,
 *   photo) — the structured copy of the cards;
 * - the "Find Your New Home Design" tabs: `#home-designs` with one
 *   `article.card` per plan (`.plan-card__title a` to
 *   `/san-antonio/<slug>/home-design/<plan>`, "Pricing starting at
 *   $259,490", Square Feet / Bedrooms / Bathrooms / Garage cells with "2.5
 *   - 3" ranges, elevation photos) and, when homes are for sale,
 *   `#quick-move-in-homes` with one `article.card[data-spec]` per home
 *   (`.card-title` "Move-In Ready" or "Dec 2026", `data-move-in-date`
 *   "2026-10-19", the street linking to `/san-antonio/<slug>/home/<street
 *   slug>`, a struck "original" price and the price, the same cells,
 *   "Homesite Number: 4"). A community with no homes for sale has no
 *   quick move-in tab (Hickory Ridge in October 2026).
 * The cards are the source of statuses and prices; the residence records
 * must name the same set of home pages (a card without its record, or a
 * record without its card, is a changed page). The market page
 * `/san-antonio` links every community (11 in October 2026; each page is
 * read for its business record). The site states no promotion (October
 * 2026; the mortgage calculator's wording is not an offer). Read-only,
 * plain GET, official host only. Everything here is private operational
 * data.
 */
/** A community with more homes for sale than this is held, never truncated. */
export const HAKES_MAX_HOMES = 150;
export const hakesListingUrl = (market = "san-antonio") => `https://${HAKES_HOST}/${market}`;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthIndex = (name: string): number | null => {
  const key = name.toLowerCase().replace(/\.$/, "");
  const index = MONTH_NAMES.findIndex((month) => month.toLowerCase() === key || month.toLowerCase().slice(0, 3) === key || (key === "sept" && month === "September"));
  return index >= 0 ? index + 1 : null;
};

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : null;
const num = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const match = /\d[\d,]*(?:\.\d+)?/.exec(value);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const positive = (value: string | null | undefined): number | null => { const parsed = num(value); return parsed && parsed > 0 ? parsed : null; };
const pagePath = (url: URL): string => comparablePath(url.pathname.replace(/\/+$/, ""));
const pageUrlOf = (url: URL): string => `${url.origin}${url.pathname.replace(/\/+$/, "")}`;

/**
 * "Move-In Ready" is ready; "Dec 2026" names a month (a past one is a stale
 * estimate: no date); without a label the card's `data-move-in-date`
 * decides (passed → ready, else its month); sold wording is sold; anything
 * else, a label with a month name the reader does not know included, gives
 * no status (the run is held).
 */
export function hakesStatus(label: string | null, moveInDate: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (/\bsold\b|under\s+contract/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/^(?:move[- ]?in\s+ready|ready\s+now|available\s+now)\s*!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const dated = /^(?:est\.?(?:imated)?\s+)?(?:available\s+|ready\s+)?([A-Za-z]+)\.?,?\s+(\d{4})$/i.exec(text);
  let month = dated ? monthIndex(dated[1]!) : null;
  let year = dated ? Number(dated[2]) : null;
  // A label the reader cannot read ("Early 2027", "Reserved") gives no status: the card's own date decides only when there is no label at all.
  if (dated && month === null) return { status: null, readyNow: false, moveInDate: null };
  if (!text) {
    // No label: the card's own date.
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((moveInDate ?? "").trim());
    if (!iso) return { status: null, readyNow: false, moveInDate: null };
    const date = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isFinite(date) || Number(iso[2]) < 1 || Number(iso[2]) > 12) return { status: null, readyNow: false, moveInDate: null };
    if (date <= now.getTime()) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
    month = Number(iso[2]);
    year = Number(iso[1]);
  }
  if (month === null || year === null || year < 2000 || year > now.getUTCFullYear() + 5) return { status: null, readyNow: false, moveInDate: null };
  if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month <= now.getUTCMonth())) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${MONTH_NAMES[month - 1]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type HakesCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

const businessRecord = (html: string): Json | null => jsonLdRecords(html).find((item) => (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).some((type) => /^homeandconstructionbusiness$/i.test(String(type)))) ?? null;

/**
 * True when the hero says the community is coming soon (it has no homes tab
 * yet): a detail cell "Coming Soon", or — the wording since October 20, 2026
 * (Mesa Vista) — a detail cell "Interest List Now Forming" with the price
 * line "Price Coming Soon". Each is the whole text of its element, never a
 * phrase found somewhere on the page.
 */
export function hakesComingSoon(html: string): boolean {
  const root = parseHtmlElements(html);
  const all = root ? descendants(root) : [];
  const details = all.find((item) => elementClass(item, "object-details"));
  const cells = details ? descendants(details).filter((item) => elementClass(item, "cell")).map((cell) => elementText(cell, html)) : [];
  if (cells.some((cell) => /^\s*coming\s+soon\s*!?\s*$/i.test(cell))) return true;
  const priceLine = all.find((item) => elementClass(item, "community__price-min"));
  const priceComingSoon = priceLine ? /^\s*price\s+coming\s+soon\s*!?\s*$/i.test(elementText(priceLine, html)) : false;
  return priceComingSoon && cells.some((cell) => /^\s*interest\s+list\s+(?:now\s+)?forming\s*!?\s*$/i.test(cell));
}

/** The record for discovery: none for a coming-soon page (it is listed once it opens). */
export function hakesDiscoveryRecord(html: string): HakesCommunityRecord | null {
  return hakesComingSoon(html) ? null : hakesRecord(html);
}

/** The community's schema.org business record: name without the brand prefix, sales address, phone and pin; null when the page has none. */
export function hakesRecord(html: string): HakesCommunityRecord | null {
  const record = businessRecord(html);
  const name = record ? str(record.name)?.replace(/^Hakes\s+Brothers\s+(?:at|in)\s+/i, "") ?? null : null;
  if (!record || !name) return null;
  const address = obj(record.address);
  const street = str(address?.streetAddress);
  const geo = obj(record.geo);
  const lat = Number(geo?.latitude);
  const lng = Number(geo?.longitude);
  return {
    name,
    street: looksLikeStreetAddress(street) ? street : null,
    city: str(address?.addressLocality),
    zip: /^\d{5}/.exec(str(address?.postalCode) ?? "")?.[0] ?? null,
    phone: (str(record.telephone) ?? "").replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "") || null,
    priceFrom: null,
    geo: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
  };
}

/** The business record's own page URL on the official host, when it names one. */
export function hakesRecordUrl(html: string, host: string): URL | null {
  const record = businessRecord(html);
  const link = record ? str(record.url) : null;
  const url = link ? asUrl(link) : null;
  return url && sameOfficialHost(url, host) ? url : null;
}

export type HakesResidence = { url: string; street: string | null; city: string | null; zip: string | null; squareFeet: number | null; bedrooms: number | null; bathrooms: number | null; photo: string | null };

/** The page's `SingleFamilyResidence` records on the official host, one per home page. */
export function hakesResidences(html: string, host: string): HakesResidence[] {
  const out = new Map<string, HakesResidence>();
  for (const record of jsonLdRecords(html)) {
    if (!(Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]]).some((type) => /^(?:singlefamily)?residence$|^house$/i.test(String(type)))) continue;
    const link = str(record.url);
    const url = link ? asUrl(link) : null;
    if (!url || !sameOfficialHost(url, host)) continue;
    const address = obj(record.address);
    const street = str(address?.streetAddress) ?? str(record.name);
    const full = Number(record.numberOfFullBathrooms);
    const partial = Number(record.numberOfPartialBathrooms);
    const total = Number(record.numberOfBathroomsTotal);
    const bathrooms = Number.isFinite(full) && full > 0 ? full + (Number.isFinite(partial) && partial > 0 ? partial * 0.5 : 0) : Number.isFinite(total) && total > 0 ? total : null;
    out.set(pageUrlOf(url), {
      url: pageUrlOf(url),
      street: looksLikeStreetAddress(street) ? street : null,
      city: str(address?.addressLocality),
      zip: /^\d{5}/.exec(str(address?.postalCode) ?? "")?.[0] ?? null,
      squareFeet: positive(str(obj(record.floorSize)?.value) ?? (typeof obj(record.floorSize)?.value === "number" ? String(obj(record.floorSize)!.value) : null)),
      bedrooms: positive(typeof record.numberOfBedrooms === "number" ? String(record.numberOfBedrooms) : str(record.numberOfBedrooms)),
      bathrooms,
      photo: photoUrl(str(record.image), host),
    });
  }
  return Array.from(out.values());
}

function photoUrl(value: string | null | undefined, host: string): string | null {
  const url = value ? asUrl(new URL(decodeHtmlEntities(value), `https://${host}/`).toString()) : null;
  if (!url || !sameOfficialHost(url, host) || !/^\/storage\/app\/medialibrary\//i.test(url.pathname) || /floor\s*plan|floorplan|site\s*plan|logo|\.pdf$|\.svg$/i.test(url.pathname)) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function classText(scope: readonly HtmlElement[], html: string, token: string): string | null {
  const element = scope.find((item) => elementClass(item, token));
  return element ? elementText(element, html) || null : null;
}

/** A card's "Square Feet / Bedrooms / Bathrooms / Garage" cells: the first number of each ("2.5 - 3" → 2.5, "4+" → 4). */
function cardDetails(scope: readonly HtmlElement[], html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const details = scope.find((item) => elementClass(item, "object-card__details"));
  for (const cell of details ? descendants(details).filter((item) => elementClass(item, "cell")) : []) {
    const text = elementText(cell, html);
    const strong = descendants(cell).find((item) => item.tag === "strong");
    const value = strong ? elementText(strong, html) : "";
    const label = text.replace(value, "").toLowerCase().replace(/[^a-z]/g, "");
    if (label) out[label] = positive(value);
  }
  return out;
}

function cardGallery(scope: readonly HtmlElement[], host: string): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  for (const image of scope.filter((item) => item.tag === "img")) {
    const url = photoUrl(image.attributes.src, host);
    if (url && !out.some((item) => item.sourceUrl === url) && out.length < 8) out.push({ sourceUrl: url, caption: "Representative image", width: null, height: null, srcSet: null });
  }
  return out;
}

export type HakesPage = {
  record: HakesCommunityRecord | null;
  /** True when the business record's own `url` is another page on the host: a same-host redirect to another community. */
  foreignPage: boolean;
  /** True when the page has the home-designs tabs at all. */
  hasTabs: boolean;
  /** True when the page has the quick move-in tab (a community with no homes for sale has none). */
  hasHomesTab: boolean;
  homes: PrivatePlanOrHome[];
  /** The residence records' home pages, to check against the cards. */
  residenceUrls: string[];
  plans: PrivatePlanOrHome[];
  /** True when a home or plan card links under another community's path. */
  foreignHome: boolean;
  foreignPlan: boolean;
  /** The hero's school district cell, when the page has one. */
  schoolDistrict: string | null;
  /** True when the hero says the community is coming soon: a tab-less page is then an empty community, not a changed one. */
  comingSoon: boolean;
};

/** The community on the page; null when the page has no business record. */
export function parseHakesCommunity(html: string, pageUrl: string, now: Date = new Date()): HakesPage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  const record = hakesRecord(html);
  if (!community || !root || !record) return null;
  const host = community.hostname;
  const base = `${pagePath(community)}/`;
  const own = hakesRecordUrl(html, host);
  const foreignPage = own !== null && pagePath(own) !== pagePath(community);
  const all = descendants(root);
  const tabs = all.find((item) => item.attributes.id === "home-tabs");
  const hasHomesTab = tabs ? descendants(tabs).some((item) => item.tag === "a" && /#quick-move-in-homes$/i.test(item.attributes.href ?? "")) : false;
  const residences = hakesResidences(html, host);
  const byUrl = new Map(residences.map((residence) => [pagePath(new URL(residence.url)), residence]));
  const cityLine = record.city ? `${record.city}, ${record.zip ? `TX ${record.zip}` : "TX"}` : "TX";
  const homes: PrivatePlanOrHome[] = [];
  let foreignHome = false;
  const homesPanel = all.find((item) => item.attributes.id === "quick-move-in-homes");
  for (const card of homesPanel ? descendants(homesPanel).filter((item) => item.tag === "article" && elementClass(item, "card")) : []) {
    const inner = descendants(card);
    const title = inner.find((item) => item.tag === "h4");
    const link = title ? descendants(title).find((item) => item.tag === "a" && item.attributes.href) : undefined;
    const street = title ? elementText(title, html) : "";
    const url = link ? asUrl(new URL(decodeHtmlEntities(link.attributes.href!), community).toString()) : null;
    if (!url || !sameOfficialHost(url, host) || !`${pagePath(url)}/`.startsWith(`${base}home/`)) { foreignHome = true; continue; }
    const residence = byUrl.get(pagePath(url)) ?? null;
    const readable = looksLikeStreetAddress(street);
    const status = hakesStatus(classText(inner, html, "card-title"), card.attributes["data-move-in-date"] ?? null, now);
    const details = cardDetails(inner, html);
    const struck = inner.find((item) => item.tag === "del");
    const priceElement = inner.find((item) => item.tag === "strong" && elementClass(item, "h2") && !elementClass(item, "text-primary"));
    const price = positive(priceElement ? elementText(priceElement, html) : null) ?? positive(card.attributes["data-price"]);
    const previous = struck ? positive(elementText(struck, html)) : null;
    const homesite = /Homesite\s+Number:\s*(\d+)/i.exec(elementText(card, html));
    homes.push({
      sourceUrl: pageUrlOf(url),
      privateName: street || null,
      privateAddress: readable ? `${street}, ${residence?.city ? `${residence.city}, ${residence.zip ? `TX ${residence.zip}` : "TX"}` : cityLine}` : null,
      privatePlanName: null,
      status: readable ? status.status : null,
      price,
      previousPrice: previous !== null && price !== null && previous > price ? previous : null,
      bedrooms: details.bedrooms ?? residence?.bedrooms ?? null,
      bathrooms: details.bathrooms ?? residence?.bathrooms ?? null,
      squareFeet: details.squarefeet ?? residence?.squareFeet ?? positive(card.attributes["data-sqft"]),
      garage: details.garage ?? null,
      homesite: homesite ? `Lot ${homesite[1]}` : null,
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      gallery: [...cardGallery(inner, host), ...(residence?.photo ? [{ sourceUrl: residence.photo, caption: "Representative image", width: null, height: null, srcSet: null }] : [])].filter((image, index, list) => list.findIndex((other) => other.sourceUrl === image.sourceUrl) === index).slice(0, 8),
    });
  }
  const plans: PrivatePlanOrHome[] = [];
  let foreignPlan = false;
  const plansPanel = all.find((item) => item.attributes.id === "home-designs");
  for (const card of plansPanel ? descendants(plansPanel).filter((item) => item.tag === "article" && elementClass(item, "card")) : []) {
    const inner = descendants(card);
    const title = inner.find((item) => elementClass(item, "plan-card__title"));
    const link = title ? descendants(title).find((item) => item.tag === "a" && item.attributes.href) : undefined;
    const planName = title ? elementText(title, html) : "";
    const url = link ? asUrl(new URL(decodeHtmlEntities(link.attributes.href!), community).toString()) : null;
    if (!planName || !url || !sameOfficialHost(url, host)) continue;
    if (!`${pagePath(url)}/`.startsWith(`${base}home-design/`)) { foreignPlan = true; continue; }
    const details = cardDetails(inner, html);
    const priceElement = inner.find((item) => item.tag === "strong" && elementClass(item, "text-primary"));
    plans.push({
      sourceUrl: pageUrlOf(url),
      privateName: planName,
      privatePlanName: planName,
      status: null,
      price: positive(priceElement ? elementText(priceElement, html) : null),
      bedrooms: details.bedrooms ?? null,
      bathrooms: details.bathrooms ?? null,
      squareFeet: details.squarefeet ?? null,
      garage: details.garage ?? null,
      readyNow: false,
      gallery: cardGallery(inner, host),
    });
  }
  const prices = plans.map((plan) => plan.price).filter((price): price is number => price !== null && price >= 50_000);
  record.priceFrom = prices.length ? Math.min(...prices) : null;
  // The hero's detail cells name the school district on its own ("Medina Valley ISD"), apart from the "Now Selling" cell before it.
  const details = all.find((item) => elementClass(item, "object-details"));
  const districtCell = details ? descendants(details).filter((item) => elementClass(item, "cell")).map((cell) => elementText(cell, html)).find((text) => /\b(?:ISD|CISD|Independent School District|School District)\b/.test(text)) : undefined;
  const schoolDistrict = districtCell ? /((?:[A-Z][A-Za-z.'-]+\s+){1,4}(?:ISD|CISD|Independent School District|School District))/.exec(districtCell)?.[1]?.trim() ?? null : null;
  return { record, foreignPage, hasTabs: Boolean(tabs), hasHomesTab, homes, residenceUrls: residences.map((residence) => residence.url), plans, foreignHome, foreignPlan, schoolDistrict, comingSoon: hakesComingSoon(html) };
}

/** The market page's community links; null when there are none. Each page is read for its record. */
export function hakesListingEntries(html: string, host: string, market = "san-antonio"): Array<{ url: string; record: null }> | null {
  const out = new Map<string, { url: string; record: null }>();
  for (const match of Array.from(html.matchAll(new RegExp(`href="(https?://[^"]+/${market}/[a-z0-9-]+|/${market}/[a-z0-9-]+)/?"`, "gi")))) {
    const url = asUrl(new URL(decodeHtmlEntities(match[1]!), `https://${host}/`).toString());
    if (!url || !sameOfficialHost(url, host) || !new RegExp(`^/${market}/[a-z0-9-]+$`, "i").test(url.pathname.replace(/\/+$/, ""))) continue;
    const key = pageUrlOf(url);
    if (!out.has(key)) out.set(key, { url: key, record: null });
  }
  return out.size ? Array.from(out.values()) : null;
}

export class HakesBrothersAdapter implements DealAdapter {
  readonly builder = "Hakes Brothers" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, HAKES_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", HAKES_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseHakesCommunity(page.text, community.toString(), now());
    // Without the business record, its sales address and the home-designs tabs this is not a community page — unless the hero says it is coming soon, when it is an empty one.
    if (!parsed || !parsed.record?.street || (!parsed.hasTabs && !parsed.comingSoon)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The page must be this community's (a same-host redirect to another one is not), and so must its homes and plans.
    if (parsed.foreignPage || parsed.foreignHome || parsed.foreignPlan) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // The cards and the residence records must name the same home pages; a quick move-in tab with no cards is a changed page.
    const cardUrls = parsed.homes.map((home) => pagePath(new URL(home.sourceUrl)));
    const recordUrls = parsed.residenceUrls.map((url) => pagePath(new URL(url)));
    if (parsed.hasHomesTab && cardUrls.length === 0) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (cardUrls.length !== recordUrls.length || !cardUrls.every((url) => recordUrls.includes(url))) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    if (parsed.homes.length > HAKES_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    const prices = parsed.homes.map((home) => home.price).filter((price): price is number => price !== null && price >= 50_000);
    privateSnapshot.communityFacts = { ...facts, schoolDistrict: parsed.schoolDistrict ?? facts.schoolDistrict, fromPrice: parsed.record.priceFrom ?? facts.fromPrice ?? (prices.length ? Math.min(...prices) : null) };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    // The site states no promotion; the mortgage calculator's wording is never an offer.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
