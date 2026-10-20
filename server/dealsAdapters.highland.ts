import {
  HIGHLAND_HOST, asUrl, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, getDocument, htmlToText, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * HIGHLAND HOMES reader. The community page is server-rendered with one
 * `a.homeSpec` card per quick move-in home (price, street, plan, beds, baths
 * as "4/1" full/half, stories, garages, square feet, a status tag and one
 * photo) and a "N quick move-in homes" count. Floor plans and the community
 * list are rendered in the browser from a search index, so plans are not read
 * and discovery uses the sitemap. Read-only, plain GET, official host only.
 * Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - community: /san-antonio/<city>/<community>       (about 330 KB)
 * - home:      /san-antonio/<city>/<community>/<lot id, e.g. 760-026>
 * - status tags: "Complete & Move-in Ready!", "Est. Completion - Nov '26"
 */
/** A community with more homes for sale than this is held, never truncated. */
export const HIGHLAND_MAX_HOMES = 150;

const normalize = (value: string) => decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
const MONTHS: Record<string, string> = { jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June", jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December" };

/** "4/1" -> 4.5 (four full, one half); "3" -> 3. */
export function highlandBaths(value: string): number | null {
  const match = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(value.trim());
  return match ? Number(match[1]) + (match[2] ? Number(match[2]) * 0.5 : 0) : null;
}

/** The status tag's meaning: ready now, a completion month, sold, or unknown wording (no status: the run is held). */
export function highlandStatus(tag: string | null, now: Date = new Date()): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (tag ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: null, readyNow: false, moveInDate: null };
  if (/sold|under\s+contract|pending/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/move[- ]?in\s+ready|complete\b/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const completion = /est\.?\s*completion\s*[-–:]?\s*([A-Za-z]{3,9})\.?\s*'?(\d{2,4})/i.exec(text);
  if (completion) {
    const month = MONTHS[completion[1]!.toLowerCase().slice(0, 3)];
    const year = completion[2]!.length === 2 ? `20${completion[2]}` : completion[2]!;
    // A completion month already past is a stale estimate: the home is still for sale, with no date.
    const index = Object.keys(MONTHS).indexOf(completion[1]!.toLowerCase().slice(0, 3));
    const past = Number(year) < now.getUTCFullYear() || (Number(year) === now.getUTCFullYear() && index < now.getUTCMonth());
    if (month && past) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
    if (month) return { status: `Quick Move-In (${month} ${year})`, readyNow: false, moveInDate: `${month} ${year}` };
  }
  return { status: null, readyNow: false, moveInDate: null };
}

/** The community's sales office line ("13316 Sweet Acacia, San Antonio, TX 78245"), name, phone and coordinates, for addresses and discovery. */
export function highlandCommunityFacts(html: string): { name: string | null; street: string | null; city: string | null; zip: string | null; phone: string | null; geo: { lat: number; lng: number } | null } {
  const office = /id="salesOfficeAddressDirectionsLink"[^>]*>([\s\S]*?)<\/span>/.exec(html);
  const line = office ? htmlToText(office[1]!) : "";
  const parts = /^(.*?),\s*([A-Za-z .'-]+),\s*TX\s+(\d{5})/.exec(line);
  const name = /<h1[^>]*>\s*<strong>([^<]+)<\/strong>/.exec(html)?.[1] ?? /<title>[^<]*?New Homes in\s+(.+?)\s+-\s/i.exec(html)?.[1] ?? null;
  const phone = /\bO:\s*(?:<[^>]*>\s*)*([\d-]{10,14})/.exec(html)?.[1] ?? null;
  const loc = /maps\.google\.com\/maps\?q=loc:(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(html);
  return {
    name: name ? normalize(name) : null,
    street: parts ? normalize(parts[1]!) : null,
    city: parts ? normalize(parts[2]!) : null,
    zip: parts ? parts[3]! : null,
    phone: phone ? phone.replace(/[^\d]/g, "") : null,
    geo: loc ? { lat: Number(loc[1]), lng: Number(loc[2]) } : null,
  };
}

/** "5 quick move-in homes" -> 5; null when the page does not say. */
export function highlandHomeCount(html: string): number | null {
  const match = /(\d+)\s+quick\s+move-?in\s+homes?/i.exec(htmlToText(html));
  return match ? Number(match[1]) : null;
}

/** Every home card on the page; null when the page has no home section at all. */
export function parseHighlandCards(html: string, communityUrl: string, now: Date = new Date()): PrivatePlanOrHome[] | null {
  const community = asUrl(communityUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const facts = highlandCommunityFacts(html);
  const cityLine = facts.city ? `${facts.city}, ${facts.zip ? `TX ${facts.zip}` : "TX"}` : null;
  const cards = descendants(root).filter((element) => element.tag === "a" && elementClass(element, "homeSpec"));
  // No cards is proof of nothing unless the page counts its homes ("0 quick move-in homes"): a renamed card class is a layout change.
  if (!cards.length && highlandHomeCount(html) === null) return null;
  const homes: PrivatePlanOrHome[] = [];
  for (const card of cards) {
    const inner = descendants(card);
    const read = (token: string) => { const element = inner.find((item) => elementClass(item, token)); return element ? normalize(elementText(element, html)) : null; };
    const street = read("homeIdentifier");
    const priceText = read("price");
    const price = priceText ? Number((/\$\s*([\d,]{6,})/.exec(priceText)?.[1] ?? "").replace(/,/g, "")) || null : null;
    const details = new Map<string, string>();
    for (const item of inner.filter((element) => elementClass(element, "homeDetailItem") || elementClass(element, "homeSqFootage"))) {
      const numeral = descendants(item).find((element) => elementClass(element, "numeral"));
      const label = descendants(item).find((element) => elementClass(element, "label"));
      if (numeral && label) details.set(normalize(elementText(label, html)).toLowerCase(), normalize(elementText(numeral, html)));
    }
    const href = card.attributes.href ? decodeHtmlEntities(card.attributes.href) : null;
    const page = href ? asUrl(new URL(href, community).toString()) : null;
    const tag = read("home-tag");
    const status = highlandStatus(tag, now);
    const plan = read("homeUpgrades");
    const planName = plan ? /^(.*?\bPlan)\b/.exec(plan)?.[1] ?? plan.split(/\s+with\s+/)[0] ?? null : null;
    const image = inner.find((element) => element.tag === "img")?.attributes["data-src"] ?? inner.find((element) => element.tag === "img")?.attributes.src ?? null;
    const sqft = details.get("sq ft") ?? details.get("sqft");
    homes.push({
      sourceUrl: page && sameOfficialHost(page, HIGHLAND_HOST) ? page.toString() : `${community.origin}${community.pathname.replace(/\/+$/, "")}/unreadable-${homes.length}`,
      privateName: street,
      privateAddress: street && cityLine ? `${street}, ${cityLine}` : street,
      privatePlanName: planName ? normalize(planName) : null,
      // A card without its link, street or price is not read on a guess: no status, so the run is held.
      status: street && price && page && sameOfficialHost(page, HIGHLAND_HOST) ? status.status : null,
      price,
      bedrooms: details.has("beds") ? Number(details.get("beds")) || null : null,
      bathrooms: details.has("baths") ? highlandBaths(details.get("baths")!) : null,
      squareFeet: sqft ? Number(sqft.replace(/,/g, "")) || null : null,
      garage: details.has("garages") ? Number(details.get("garages")) || null : null,
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      gallery: image && /^https:\/\/media\.hhomesltd\.com\//.test(decodeHtmlEntities(image)) ? [{ sourceUrl: decodeHtmlEntities(image), caption: null, width: null, height: null, srcSet: null }] : [],
    });
  }
  return homes;
}

export class HighlandAdapter implements DealAdapter {
  readonly builder = "Highland Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, HIGHLAND_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", HIGHLAND_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const homes = parseHighlandCards(page.text, community.toString(), now());
    const count = highlandHomeCount(page.text);
    // Without the home section or the office address this is not a community page; fewer cards than the page counts means the card markup changed.
    if (!homes || !highlandCommunityFacts(page.text).street) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (count !== null && homes.length < count) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (homes.length > HIGHLAND_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    privateSnapshot.communityFacts = parseCommunityFacts(page.text);
    for (const home of homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    // Floor plans are rendered in the browser from a search index, and the promotion overlay ("Rates as Low as 4.99%") links to an outside page with no terms: neither is read.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}

/** The community's record for discovery, from its own page (no schema.org record there). */
export function highlandRecord(html: string): { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null } | null {
  const facts = highlandCommunityFacts(html);
  if (!facts.name || !facts.street) return null;
  return { name: facts.name, street: facts.street, city: facts.city, zip: facts.zip, phone: facts.phone, priceFrom: null, geo: facts.geo };
}
