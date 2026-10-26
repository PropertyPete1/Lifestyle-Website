import {
  PACESETTER_HOST, asUrl, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, storiesFrom, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * PACESETTER HOMES (Texas) reader. A WordPress site (Avada): every community
 * page is server-rendered with two card lists. Quick move-in homes are
 * `li.qp_card_li` with the facts as data attributes (`data-price`,
 * `data-bedrooms`, `data-bathrooms`, `data-floor_area`, `data-stories`,
 * `data-garage`, `data-latitude/longitude`, `data-school-divisions-map`),
 * the street in `.qp-address-information` ("238 Bay Breeze Drive<br>Kyle, Tx
 * 78640"), a `.qp-availability` badge ("Now Available", "Available December
 * 14, 2026"), the price and one photo; `data-availability` is a facet value
 * and is not read. Plans are `li.globalPlanCard` with `data-price`,
 * `data-floor_area`, `data-bedrooms`, `data-stories`, a `.globalPlanTitle`,
 * "Starting From $329,900", "3 Beds", "2 Baths", "1,487 Sq.Ft.", "2 Car
 * Garage" and one rendering. "Model Home Address:" names the sales office
 * (street, city, TX). Community pages are
 * /new-homes-for-sale-{austin|dallas}/<city>-tx/<community>/ and the sitemap
 * lists them (community-sitemap.xml). Read-only, plain GET, official host
 * only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - community sitemap: /community-sitemap.xml          (about 6 KB)
 * - community:         /new-homes-for-sale-austin/kyle-tx/crosswinds/   (about 520 KB)
 * - home:              <community>/quick-move-in-home/<street slug>/     (about 430 KB, not read)
 */
/** A community with more homes for sale than this is held, never truncated. */
export const PACESETTER_MAX_HOMES = 150;
export const pacesetterCommunitySitemapUrl = () => `https://${PACESETTER_HOST}/community-sitemap.xml`;
const MONTHS: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const num = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const clean = (value: string | null | undefined): string | null => value ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() || null : null;

/**
 * "Now Available" is ready; "Available December 14, 2026" names a month (a
 * past one is a stale estimate: no date); "Sold" or "Under Contract" is sold;
 * other wording, or none, gives no status (the run is held).
 */
export function pacesetterStatus(label: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under\s+contract|pending/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/^(?:now\s+available|available\s+now|move[- ]?in\s+ready|ready\s+now)!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const dated = /^(?:available|ready|est\.?(?:imated)?\s+completion)\s+([A-Za-z]+)(?:\s+\d{1,2},?)?\s+(\d{4})$/i.exec(text);
  const month = dated ? MONTHS[dated[1]!.toLowerCase()] : undefined;
  const year = dated ? Number(dated[2]) : null;
  if (month === undefined || year === null || year < 2000 || year > now.getUTCFullYear() + 5) return { status: null, readyNow: false, moveInDate: null };
  if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month < now.getUTCMonth())) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${MONTH_NAMES[month]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type PacesetterCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

function classText(scope: readonly HtmlElement[], html: string, token: string): string | null {
  const element = scope.find((item) => elementClass(item, token));
  return element ? clean(elementText(element, html)) : null;
}

function photo(scope: readonly HtmlElement[], host: string): PrivateGalleryImage[] {
  const image = scope.find((item) => item.tag === "img" && item.attributes.src);
  const url = image ? asUrl(decodeHtmlEntities(image.attributes.src!)) : null;
  if (!url || url.protocol !== "https:" || !sameOfficialHost(url, host) || !/\/wp-content\/uploads\//.test(url.pathname) || /\.(?:svg|gif)$/i.test(url.pathname) || /logo|favicon|icon/i.test(url.pathname)) return [];
  url.search = "";
  return [{ sourceUrl: url.toString(), caption: "Representative image", width: null, height: null, srcSet: null }];
}

export type PacesetterPage = {
  /** The page's own name ("Crosswinds") from its title. */
  name: string | null;
  record: PacesetterCommunityRecord | null;
  homes: PrivatePlanOrHome[];
  plans: PrivatePlanOrHome[];
  /** True when a home card sits under another community's path. */
  foreignHome: boolean;
};

/** The community on the page; null when the page is not a Pacesetter community page. */
export function parsePacesetterCommunity(html: string, pageUrl: string, now: Date = new Date()): PacesetterPage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const host = community.hostname;
  const base = `${comparablePath(community.pathname.replace(/\/+$/, ""))}/`;
  const all = descendants(root);
  const title = clean(/<title>([^<]*)<\/title>/i.exec(html)?.[1])?.replace(/\s*[-|–]\s*Pacesetter\s+Homes.*$/i, "") ?? null;
  // "Model Home Address:" then the next text block: "283 Tailwind Drive, Kyle, TX".
  const office = /Model\s+Home\s+Address:?\s*<\/h\d>\s*<\/div>\s*<div[^>]*>\s*([^<]{6,160})/i.exec(html);
  const officeText = clean(office?.[1]);
  const officeMatch = officeText ? /^(.+?),\s*([A-Za-z .'-]+),\s*TX(?:\s+(\d{5}))?$/i.exec(officeText) : null;
  const street = officeMatch ? officeMatch[1]!.trim() : null;
  const homes: PrivatePlanOrHome[] = [];
  let foreignHome = false;
  let pin: { lat: number; lng: number } | null = null;
  let cardCity: string | null = null;
  let cardZip: string | null = null;
  for (const card of all.filter((item) => item.tag === "li" && elementClass(item, "qp_card_li"))) {
    const inner = descendants(card);
    const link = inner.find((item) => item.tag === "a" && item.attributes.href);
    const page = link ? asUrl(decodeHtmlEntities(link.attributes.href!)) : null;
    if (!page || !sameOfficialHost(page, host)) continue;
    if (!comparablePath(page.pathname).startsWith(base)) { foreignHome = true; continue; }
    // The street sits in its own span ("<span>238 Bay Breeze Drive</span><br>Kyle, Tx 78640"); the city line follows it.
    const addressBlock = inner.find((item) => elementClass(item, "qp-address-information"));
    const addressParts = addressBlock ? descendants(addressBlock) : [];
    const streetSpan = addressParts.find((item) => item.tag === "span");
    const homeStreet = streetSpan ? clean(elementText(streetSpan, html)) : null;
    const addressText = addressBlock ? clean(elementText(addressBlock, html)) ?? "" : "";
    const cityLine = homeStreet ? clean(addressText.replace(homeStreet, "")) ?? "" : addressText;
    const parts = /^([A-Za-z .'-]+?),\s*T[Xx]\s*(\d{5})?/.exec(cityLine);
    const city = parts ? clean(parts[1]) : clean(card.attributes["data-city"]);
    const zip = parts?.[2] ?? null;
    if (!cardCity && city) cardCity = city;
    if (!cardZip && zip) cardZip = zip;
    const lat = Number(card.attributes["data-latitude"]);
    const lng = Number(card.attributes["data-longitude"]);
    if (!pin && Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) pin = { lat, lng };
    const status = pacesetterStatus(classText(inner, html, "qp-availability"), now);
    const readable = looksLikeStreetAddress(homeStreet);
    homes.push({
      sourceUrl: `${page.origin}${page.pathname}`,
      privateName: homeStreet,
      privateAddress: homeStreet ? `${homeStreet}, ${city ?? "TX"}${zip ? `, TX ${zip}` : city ? ", TX" : ""}` : null,
      status: readable ? status.status : null,
      price: num(card.attributes["data-price"]) ?? num(classText(inner, html, "qp-price")),
      bedrooms: num(card.attributes["data-bedrooms"]),
      bathrooms: num(card.attributes["data-bathrooms"]),
      squareFeet: num(card.attributes["data-floor_area"]),
      garage: num(card.attributes["data-garage"]),
      stories: storiesFrom(card.attributes["data-stories"]),
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      geo: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { latitude: lat, longitude: lng } : null,
      gallery: photo(inner, host),
    });
  }
  const plans: PrivatePlanOrHome[] = [];
  for (const card of all.filter((item) => item.tag === "li" && elementClass(item, "globalPlanCard"))) {
    const inner = descendants(card);
    const link = inner.find((item) => item.tag === "a" && item.attributes.href);
    const page = link ? asUrl(decodeHtmlEntities(link.attributes.href!)) : null;
    const name = classText(inner, html, "globalPlanTitle");
    if (!page || !name || !sameOfficialHost(page, host) || !comparablePath(page.pathname).startsWith(base)) continue;
    const meta = classText(inner, html, "globalPlanMeta") ?? "";
    const baths = /(\d+(?:\.\d)?)\s*Baths?/i.exec(meta);
    const garage = /(\d+(?:\.\d)?)\s*Car\s+Garage/i.exec(meta);
    plans.push({
      sourceUrl: `${page.origin}${page.pathname}`,
      privateName: name,
      privatePlanName: name,
      status: null,
      price: num(card.attributes["data-price"]) ?? num(/\$\s*([\d,]{5,9})/.exec(classText(inner, html, "globalPlanPrice") ?? "")?.[1]),
      bedrooms: num(card.attributes["data-bedrooms"]),
      bathrooms: baths ? Number(baths[1]) : null,
      squareFeet: num(card.attributes["data-floor_area"]),
      garage: garage ? Number(garage[1]) : null,
      stories: storiesFrom(card.attributes["data-stories"]),
      readyNow: false,
      gallery: photo(inner, host),
    });
  }
  const city = officeMatch ? clean(officeMatch[2]) : cardCity;
  const prices = [...homes, ...plans].map((item) => item.price).filter((price): price is number => price !== null && price >= 50_000);
  const record: PacesetterCommunityRecord | null = title ? {
    name: title,
    street: looksLikeStreetAddress(street) ? street : null,
    city,
    zip: officeMatch?.[3] ?? cardZip,
    phone: null,
    priceFrom: prices.length ? Math.min(...prices) : null,
    geo: pin,
  } : null;
  return { name: title, record, homes, plans, foreignHome };
}

/** The community pages named by the community sitemap, Austin market only (Dallas is outside both areas); null when it lists none. */
export function pacesetterSitemapEntries(xml: string, host: string): Array<{ url: string; record: null }> | null {
  const out = new Map<string, { url: string; record: null }>();
  for (const match of Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi))) {
    const url = asUrl(decodeHtmlEntities(match[1]!));
    if (!url || !sameOfficialHost(url, host) || !/^\/new-homes-for-sale-austin\/[a-z0-9-]+-tx\/[a-z0-9-]+\/?$/i.test(url.pathname)) continue;
    const key = `${url.origin}${url.pathname.replace(/\/+$/, "")}/`;
    if (!out.has(key)) out.set(key, { url: key, record: null });
  }
  return out.size ? Array.from(out.values()) : null;
}

export class PacesetterAdapter implements DealAdapter {
  readonly builder = "Pacesetter Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, PACESETTER_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", PACESETTER_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parsePacesetterCommunity(page.text, community.toString(), now());
    // A community page carries its plan or home card lists; a page with neither is not one (or changed shape).
    if (!parsed || !parsed.name || (!parsed.plans.length && !parsed.homes.length)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    if (parsed.homes.length > PACESETTER_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? parsed.record?.priceFrom ?? null };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    // The site publishes no financing offer on its community pages.
    privateSnapshot.offerRead = false;
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
