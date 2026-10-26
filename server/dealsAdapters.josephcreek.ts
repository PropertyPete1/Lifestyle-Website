import {
  JOSEPHCREEK_HOST, asUrl, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, storiesFrom, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * JOSEPH CREEK HOMES reader (a San Antonio-area builder on Webflow). The
 * community page is static: `h1` name, "Model Home Address" then the office
 * ("10106 Mulhouse Dr, Schertz, TX 78154"), a Google Maps embed whose
 * `!2d<lng>!3d<lat>` is the office pin, the sales phone as a `tel:` link, and
 * plan cards (`a.floorplan-card-linked`: `.floorplan-card_title`, "1700 Sq
 * Ft", "Starting at 359999", Beds / Baths / Stories / Garage cells, one
 * rendering) whose links are /floorplans/<plan>-at-<community>. Homes for
 * sale sit on one site-wide page, /available-homes: `div.mir_item` cards with
 * `.mir_card_community` (the community), `.mir_card_title` (the street),
 * "2805 Sq Ft", "$649,999" (and a hidden "650000"), an incentive line, Beds /
 * Baths / Stories / Garage, "Featuring our floorplan The Pin Oak at Pradera
 * Ridge", one photo and the link /available-homes/<slug>. The reader keeps
 * this community's cards. The communities page links /communities/<slug> for
 * each. Read-only, plain GET, official host only. Everything here is private
 * operational data.
 *
 * Page shapes (October 2026):
 * - communities: /our-communities      (about 33 KB)
 * - community:   /communities/<slug>   (about 80 KB)
 * - homes:       /available-homes      (about 64 KB, every community's)
 */
export const JOSEPHCREEK_MAX_HOMES = 150;
export const josephCreekCommunitiesUrl = () => `https://${JOSEPHCREEK_HOST}/our-communities`;
export const josephCreekAvailableUrl = () => `https://${JOSEPHCREEK_HOST}/available-homes`;
const PHOTO_HOST = "cdn.prod.website-files.com";

const num = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const clean = (value: string | null | undefined): string | null => value ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() || null : null;

export type JosephCreekCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

/** The value of the info cell whose label is this ("Beds" -> "3"). */
function cell(scope: readonly HtmlElement[], html: string, label: string): string | null {
  for (const item of scope.filter((element) => elementClass(element, "floorplan-card_info-cell"))) {
    const parts = descendants(item);
    const own = parts.find((element) => elementClass(element, "floorplan-card_info-label"));
    if (own && clean(elementText(own, html))?.toLowerCase() === label.toLowerCase()) {
      const value = parts.find((element) => elementClass(element, "floorplan-card_info") && !elementClass(element, "floorplan-card_info-label"));
      return value ? clean(elementText(value, html)) : null;
    }
  }
  return null;
}

function photo(scope: readonly HtmlElement[]): PrivateGalleryImage[] {
  const image = scope.find((item) => item.tag === "img" && item.attributes.src && elementClass(item, "image-5"));
  const url = image ? asUrl(decodeHtmlEntities(image.attributes.src!)) : null;
  if (!url || url.protocol !== "https:" || url.hostname.toLowerCase() !== PHOTO_HOST || /\.(?:svg|gif)$/i.test(url.pathname)) return [];
  url.search = "";
  return [{ sourceUrl: url.toString(), caption: "Representative image", width: null, height: null, srcSet: null }];
}

export type JosephCreekCommunityPage = { record: JosephCreekCommunityRecord; plans: PrivatePlanOrHome[] };

/** The community on its page; null when the page has no name. */
export function parseJosephCreekCommunity(html: string, pageUrl: string): JosephCreekCommunityPage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const host = community.hostname;
  const all = descendants(root);
  const h1 = all.find((item) => item.tag === "h1");
  const name = h1 ? clean(elementText(h1, html)) : null;
  if (!name) return null;
  const office = clean(/Model\s+Home\s+Address<\/strong><\/div>\s*<div[^>]*>([^<]{6,160})</i.exec(html)?.[1]);
  const officeMatch = office ? /^(.+?),\s*([A-Za-z .'-]+),\s*TX(?:\s+(\d{5}))?$/i.exec(office) : null;
  const street = officeMatch ? officeMatch[1]!.trim() : null;
  const embed = /!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/.exec(html);
  const lng = embed ? Number(embed[1]) : NaN;
  const lat = embed ? Number(embed[2]) : NaN;
  const phone = /href="tel:([^"]+)"/i.exec(html)?.[1]?.replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "") || null;
  const plans: PrivatePlanOrHome[] = [];
  for (const card of all.filter((item) => item.tag === "a" && elementClass(item, "floorplan-card-linked") && item.attributes.href)) {
    const inner = descendants(card);
    const page = asUrl(new URL(decodeHtmlEntities(card.attributes.href!), community).toString());
    const title = inner.find((item) => elementClass(item, "floorplan-card_title"));
    const planName = title ? clean(elementText(title, html)) : null;
    if (!page || !planName || !sameOfficialHost(page, host)) continue;
    const subtitle = inner.find((item) => elementClass(item, "floorplan-card_subtitle"));
    const subtitleText = subtitle ? clean(elementText(subtitle, html)) ?? "" : "";
    const sqft = /([\d,]{3,6})\s*Sq\s*Ft/i.exec(subtitleText);
    const price = /Starting\s+at\s*\$?\s*([\d,]{5,9})/i.exec(subtitleText);
    plans.push({
      sourceUrl: `${page.origin}${page.pathname}`,
      privateName: planName,
      privatePlanName: planName,
      status: null,
      price: price ? num(price[1]) : null,
      bedrooms: num(cell(inner, html, "Beds")),
      bathrooms: num(cell(inner, html, "Baths")),
      squareFeet: sqft ? num(sqft[1]) : null,
      garage: num(cell(inner, html, "Garage")),
      stories: storiesFrom(cell(inner, html, "Stories")),
      readyNow: false,
      gallery: photo(inner),
    });
  }
  const prices = plans.map((plan) => plan.price).filter((price): price is number => price !== null && price >= 50_000);
  return {
    record: {
      name,
      street: looksLikeStreetAddress(street) ? street : null,
      city: officeMatch ? clean(officeMatch[2]) : null,
      zip: officeMatch?.[3] ?? null,
      phone,
      priceFrom: prices.length ? Math.min(...prices) : null,
      geo: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    },
    plans,
  };
}

/** This community's homes for sale on the site-wide page, each keyed by its own page. */
export function parseJosephCreekHomes(html: string, pageUrl: string, communityName: string, cityLine: string | null): PrivatePlanOrHome[] {
  const page = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!page || !root) return [];
  const host = page.hostname;
  const wanted = communityName.replace(/\s+/g, " ").trim().toLowerCase();
  const homes: PrivatePlanOrHome[] = [];
  for (const card of descendants(root).filter((item) => elementClass(item, "mir_item"))) {
    const inner = descendants(card);
    const owner = inner.find((item) => elementClass(item, "mir_card_community"));
    if (!owner || clean(elementText(owner, html))?.toLowerCase() !== wanted) continue;
    const link = inner.find((item) => item.tag === "a" && elementClass(item, "mir_card-linked") && item.attributes.href);
    const url = link ? asUrl(new URL(decodeHtmlEntities(link.attributes.href!), page).toString()) : null;
    if (!url || !sameOfficialHost(url, host)) continue;
    const title = inner.find((item) => elementClass(item, "mir_card_title"));
    const street = title ? clean(elementText(title, html)) : null;
    const subtitle = inner.find((item) => elementClass(item, "floorplan-card_subtitle"));
    const subtitleText = subtitle ? clean(elementText(subtitle, html)) ?? "" : "";
    const sqft = /([\d,]{3,6})\s*Sq\s*Ft/i.exec(subtitleText);
    const price = /\$\s*([\d,]{5,9})/.exec(subtitleText);
    const plan = inner.find((item) => elementClass(item, "mir_card_floorplan"));
    const planName = plan ? clean(elementText(plan, html))?.replace(/\s+at\s+.+$/i, "") ?? null : null;
    const readable = looksLikeStreetAddress(street);
    homes.push({
      sourceUrl: `${url.origin}${url.pathname}`,
      privateName: street,
      privateAddress: street && cityLine ? `${street}, ${cityLine}` : street,
      privatePlanName: planName,
      // The site lists a home only while it is for sale; it says nothing about a move-in month.
      status: readable ? "Quick Move-In" : null,
      price: price ? num(price[1]) : null,
      bedrooms: num(cell(inner, html, "Beds")),
      bathrooms: num(cell(inner, html, "Baths")),
      squareFeet: sqft ? num(sqft[1]) : null,
      garage: num(cell(inner, html, "Garage")),
      stories: storiesFrom(cell(inner, html, "Stories")),
      readyNow: false,
      gallery: photo(inner),
    });
  }
  return homes;
}

/** The communities page's links; each page is read for its record. */
export function josephCreekListingEntries(html: string, host: string): Array<{ url: string; record: null }> | null {
  const out = new Map<string, { url: string; record: null }>();
  for (const match of Array.from(html.matchAll(/href="(\/communities\/[a-z0-9-]+)"/gi))) {
    const url = asUrl(new URL(decodeHtmlEntities(match[1]!), `https://${host}/`).toString());
    if (!url || !sameOfficialHost(url, host)) continue;
    const key = `${url.origin}${url.pathname}`;
    if (!out.has(key)) out.set(key, { url: key, record: null });
  }
  return out.size ? Array.from(out.values()) : null;
}

export class JosephCreekAdapter implements DealAdapter {
  readonly builder = "Joseph Creek Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, JOSEPHCREEK_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", JOSEPHCREEK_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseJosephCreekCommunity(page.text, community.toString());
    if (!parsed || !parsed.plans.length) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    const available = await getDocument(josephCreekAvailableUrl(), fetcher, "text/html,application/xhtml+xml", JOSEPHCREEK_HOST);
    if (!available.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(available, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("inventory", josephCreekAvailableUrl(), null));
    const cityLine = parsed.record.city ? `${parsed.record.city}, TX${parsed.record.zip ? ` ${parsed.record.zip}` : ""}` : null;
    const homes = parseJosephCreekHomes(available.text, josephCreekAvailableUrl(), parsed.record.name, cityLine);
    if (homes.length > JOSEPHCREEK_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? parsed.record.priceFrom };
    for (const home of homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    privateSnapshot.offerRead = false;
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
