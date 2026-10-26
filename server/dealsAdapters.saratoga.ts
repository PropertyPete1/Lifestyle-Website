import {
  SARATOGA_HOST, asUrl, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * SARATOGA HOMES (Texas) reader. A WordPress site. The community page is
 * server-rendered: its "Floor Plans" tab lists `div.floor_plans div.item`
 * cards (`h3` plan name, "4 BR | 3.5 BA | 2,453 sq.ft.", "From $538,950" or
 * "From the $500s", a `.badge` "2 Available Homes", one rendering), and its
 * map script sets `window.mapCenter = { lat, lng }` and `window.community =
 * "Enclave at Cele"`. The page has no sales address; the city is in the title
 * ("New Homes in Pflugerville, TX | Enclave at Cele - Saratoga"). Homes for
 * sale are not on the community page: each plan page lists `div.home_card`s
 * for EVERY community that sells the plan (`data-community` names the
 * community, `data-address` the street; "Enclave at Cele | Pflugerville, TX";
 * "2,453 sqft | 4 BR, 3.5 BA"; `.price strong` now and `span` the struck
 * "was" price; a `.badge` "Move-In Ready"; one photo; the link
 * /new-homes/<street slug>), so the reader keeps only this community's. The
 * communities page lists `div.item[data-region="Austin"]` entries with the
 * name, city and "From $" (the Houston and El Paso regions are outside both
 * areas). Read-only, plain GET, official host only. Everything here is
 * private operational data.
 *
 * Page shapes (October 2026):
 * - communities: /communities/                 (about 125 KB)
 * - community:   /community/<slug>/            (about 120 KB)
 * - plan:        /floor-plan/<slug>/           (about 100 KB), read for the homes
 */
/** A community with more homes for sale than this is held, never truncated. */
export const SARATOGA_MAX_HOMES = 150;
/** Plan pages read per community per run (a community lists a dozen plans at most). */
export const SARATOGA_MAX_PLAN_PAGES = 24;
export const saratogaCommunitiesUrl = () => `https://${SARATOGA_HOST}/communities/`;

const num = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const clean = (value: string | null | undefined): string | null => value ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() || null : null;
/** "From $538,950" -> 538950; "From the $500s" -> 500000 (the band's low end). */
const fromPrice = (text: string | null): number | null => {
  if (!text) return null;
  const exact = /\$\s*([\d,]{5,9})(?!\d*s)/.exec(text);
  if (exact) return num(exact[1]);
  const band = /\$\s*(\d{3})s\b/.exec(text);
  return band ? Number(band[1]) * 1000 : null;
};

export type SaratogaCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

function classText(scope: readonly HtmlElement[], html: string, token: string): string | null {
  const element = scope.find((item) => elementClass(item, token));
  return element ? clean(elementText(element, html)) : null;
}

function photo(scope: readonly HtmlElement[], host: string): PrivateGalleryImage[] {
  const image = scope.find((item) => item.tag === "img" && item.attributes.src);
  const url = image ? asUrl(decodeHtmlEntities(image.attributes.src!)) : null;
  if (!url || url.protocol !== "https:" || !sameOfficialHost(url, host) || !/\/wp-content\/uploads\//.test(url.pathname) || /\.(?:svg|gif)$/i.test(url.pathname) || /logo|favicon|icon|floor-?plan|-plan-/i.test(url.pathname)) return [];
  url.search = "";
  return [{ sourceUrl: url.toString(), caption: "Representative image", width: null, height: null, srcSet: null }];
}

export type SaratogaCommunityPage = { record: SaratogaCommunityRecord; plans: PrivatePlanOrHome[] };

/** The community on its page: name and pin from the map script, city from the title, its plans; null when the page is not one. */
export function parseSaratogaCommunity(html: string, pageUrl: string): SaratogaCommunityPage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const host = community.hostname;
  const name = clean(/window\.community\s*=\s*"([^"]+)"/.exec(html)?.[1]);
  const lat = Number(/window\.mapCenter\s*=\s*\{\s*lat:\s*(-?\d+(?:\.\d+)?)/.exec(html)?.[1]);
  const lng = Number(/lng:\s*(-?\d+(?:\.\d+)?)/.exec(html)?.[1]);
  const title = clean(/<title>([^<]*)<\/title>/i.exec(html)?.[1]) ?? "";
  const city = clean(/New\s+Homes\s+in\s+([A-Za-z .'-]+?),\s*TX/i.exec(title)?.[1]);
  if (!name) return null;
  const all = descendants(root);
  const list = all.find((item) => elementClass(item, "floor_plans"));
  const plans: PrivatePlanOrHome[] = [];
  for (const card of list ? descendants(list).filter((item) => item.tag === "div" && elementClass(item, "item")) : []) {
    const inner = descendants(card);
    const link = inner.find((item) => item.tag === "a" && item.attributes.href && /\/floor-plan\//.test(item.attributes.href));
    const page = link ? asUrl(decodeHtmlEntities(link.attributes.href!)) : null;
    const heading = inner.find((item) => item.tag === "h3");
    const planName = heading ? clean(elementText(heading, html)) : null;
    if (!page || !planName || !sameOfficialHost(page, host)) continue;
    const text = clean(elementText(card, html)) ?? "";
    const beds = /(\d+(?:\.\d)?)\s*BR\b/i.exec(text);
    const baths = /(\d+(?:\.\d)?)\s*BA\b/i.exec(text);
    const sqft = /([\d,]{3,6})\s*sq\.?\s*ft/i.exec(text);
    const garage = /(\d)\s*CG\b/i.exec(planName) ?? /(\d)\s*-?\s*car/i.exec(text);
    plans.push({
      sourceUrl: `${page.origin}${page.pathname.replace(/\/+$/, "")}/`,
      privateName: planName,
      privatePlanName: planName,
      status: null,
      price: fromPrice(text),
      bedrooms: beds ? Number(beds[1]) : null,
      bathrooms: baths ? Number(baths[1]) : null,
      squareFeet: sqft ? num(sqft[1]) : null,
      garage: garage ? Number(garage[1]) : null,
      readyNow: false,
      gallery: photo(inner, host),
    });
  }
  // The page states "From $447,950" for the community and for each plan; the lowest exact figure is the community's.
  const stated = Array.from(html.matchAll(/From\s+\$\s*([\d,]{5,9})(?!\d*s)/g), (match) => num(match[1])).filter((price): price is number => price !== null && price >= 50_000);
  const prices = stated.length ? stated : plans.map((plan) => plan.price).filter((price): price is number => price !== null && price >= 50_000);
  return {
    record: { name, street: null, city, zip: null, phone: null, priceFrom: prices.length ? Math.min(...prices) : null, geo: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null },
    plans,
  };
}

/** This community's homes for sale on a plan page (the page lists every community's); each keyed by its own /new-homes/ page. */
export function parseSaratogaPlanHomes(html: string, pageUrl: string, communityName: string, planName: string | null): PrivatePlanOrHome[] {
  const page = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!page || !root) return [];
  const host = page.hostname;
  const homes: PrivatePlanOrHome[] = [];
  const wanted = communityName.replace(/\s+/g, " ").trim().toLowerCase();
  for (const card of descendants(root).filter((item) => item.tag === "div" && elementClass(item, "home_card"))) {
    const inner = descendants(card);
    const save = inner.find((item) => item.attributes["data-community"] !== undefined);
    const owner = clean(save?.attributes["data-community"])?.toLowerCase();
    if (owner !== wanted) continue;
    const link = inner.find((item) => item.tag === "a" && elementClass(item, "home_card__link") && item.attributes.href);
    const url = link ? asUrl(decodeHtmlEntities(link.attributes.href!)) : null;
    if (!url || !sameOfficialHost(url, host)) continue;
    const street = clean(save?.attributes["data-address"]) ?? (link ? clean(elementText(link, html)) : null);
    const addressLine = classText(inner, html, "address") ?? "";
    const cityMatch = /\|\s*([A-Za-z .'-]+?),\s*TX\b/.exec(addressLine);
    const specs = classText(inner, html, "specs") ?? "";
    const sqft = /([\d,]{3,6})\s*sq\.?\s*ft/i.exec(specs);
    const beds = /(\d+(?:\.\d)?)\s*BR\b/i.exec(specs);
    const baths = /(\d+(?:\.\d)?)\s*BA\b/i.exec(specs);
    const priceBlock = inner.find((item) => elementClass(item, "price"));
    const priceParts = priceBlock ? descendants(priceBlock).filter((item) => item.tag === "strong" || item.tag === "span").map((item) => num(/\$\s*([\d,]{5,9})/.exec(elementText(item, html))?.[1])) : [];
    const price = priceParts[0] ?? num(/\$\s*([\d,]{5,9})/.exec(priceBlock ? elementText(priceBlock, html) : "")?.[1]);
    const was = priceParts[1] ?? null;
    const badge = classText(inner, html, "badge");
    const ready = badge ? /move[- ]?in\s+ready|available\s+now|ready\s+now/i.test(badge) : false;
    const sold = badge ? /\bsold\b|under\s+contract|pending/i.test(badge) : false;
    homes.push({
      sourceUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
      privateName: street,
      privateAddress: street ? `${street}, ${cityMatch ? clean(cityMatch[1]) : "TX"}${cityMatch ? ", TX" : ""}` : null,
      privatePlanName: planName,
      status: sold ? "Sold" : ready ? "Quick Move-In (Move-In Ready)" : looksLikeStreetAddress(street) ? "Quick Move-In" : null,
      price,
      previousPrice: was !== null && price !== null && was > price ? was : null,
      bedrooms: beds ? Number(beds[1]) : null,
      bathrooms: baths ? Number(baths[1]) : null,
      squareFeet: sqft ? num(sqft[1]) : null,
      garage: planName ? (/(\d)\s*CG\b/i.exec(planName) ? Number(/(\d)\s*CG\b/i.exec(planName)![1]) : null) : null,
      readyNow: ready,
      gallery: photo(inner, host),
    });
  }
  return homes;
}

/** The communities page's Austin-region entries: name, city and starting price, each pointing at its page. */
export function saratogaListingEntries(html: string, host: string): Array<{ url: string; record: SaratogaCommunityRecord }> | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const out = new Map<string, { url: string; record: SaratogaCommunityRecord }>();
  for (const item of descendants(root).filter((element) => element.tag === "div" && elementClass(element, "item") && /^austin$/i.test(element.attributes["data-region"] ?? ""))) {
    const inner = descendants(item);
    const link = inner.find((element) => element.tag === "a" && element.attributes.href && /\/community\//.test(element.attributes.href));
    const url = link ? asUrl(decodeHtmlEntities(link.attributes.href!)) : null;
    if (!url || !sameOfficialHost(url, host)) continue;
    const addressBlock = inner.find((element) => elementClass(element, "item__address"));
    const strong = addressBlock ? descendants(addressBlock).find((element) => element.tag === "strong") : undefined;
    const name = strong ? clean(elementText(strong, html)) : null;
    const addressText = addressBlock ? clean(elementText(addressBlock, html)) ?? "" : "";
    const city = name ? clean(addressText.replace(name, "")) : null;
    if (!name) continue;
    const key = `${url.origin}${url.pathname.replace(/\/+$/, "")}/`;
    if (!out.has(key)) out.set(key, { url: key, record: { name, street: null, city, zip: null, phone: null, priceFrom: fromPrice(classText(inner, html, "price")), geo: null } });
  }
  return out.size ? Array.from(out.values()) : null;
}

export class SaratogaAdapter implements DealAdapter {
  readonly builder = "Saratoga Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, SARATOGA_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", SARATOGA_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseSaratogaCommunity(page.text, community.toString());
    if (!parsed || !parsed.plans.length) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // Each plan page lists the plan's homes for sale across the builder's communities; this community's are kept.
    const homes: PrivatePlanOrHome[] = [];
    const seen = new Set<string>();
    for (const plan of parsed.plans.slice(0, SARATOGA_MAX_PLAN_PAGES)) {
      const planPage = await getDocument(plan.sourceUrl, fetcher, "text/html,application/xhtml+xml", SARATOGA_HOST);
      if (!planPage.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(planPage, "community_fetch_failed")]);
      for (const home of parseSaratogaPlanHomes(planPage.text, plan.sourceUrl, parsed.record.name, plan.privatePlanName ?? null)) {
        if (seen.has(home.sourceUrl)) continue;
        seen.add(home.sourceUrl);
        homes.push(home);
      }
    }
    if (parsed.plans.length > SARATOGA_MAX_PLAN_PAGES || homes.length > SARATOGA_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? parsed.record.priceFrom };
    for (const home of homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    privateSnapshot.offerRead = false;
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
