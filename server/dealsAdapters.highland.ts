import {
  HIGHLAND_HOST, asUrl, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlElement, type HtmlFetcher, type PrivatePlanOrHome,
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
 *
 * Since October 20, 2026 the community page (about 117 KB) is split into lot
 * sections ("Homes on 50ft. lots", linking /<community>/<section>/section):
 * each `div.wrapper` has an `h2.display_name`, an overview square
 * "<N> Quick Move-in" and a preview of up to three `a.home-card` cards
 * (`.home-price`, `.home-plan`, `.home-address` "255 White Oak, Castroville,
 * TX", "4 bds", "3/1 ba", "2 gar", "2,241 sf", `.home-tag`). There is no sales
 * office line any more: the hero's `p.secondLine` gives the city and ZIP. A
 * section whose preview shows fewer cards than its count is read from its
 * section page; if that page does not show them all, the run is held.
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

/** The hero's "Castroville, TX 78009" line (the community pages since October 20, 2026). */
export function highlandHeroPlace(html: string): { city: string; zip: string } | null {
  const line = /<p class="secondLine">([^<]*)<\/p>/.exec(html);
  const parts = line ? /^\s*([A-Za-z .'-]+),\s*TX\s+(\d{5})\s*$/.exec(decodeHtmlEntities(line[1]!)) : null;
  return parts ? { city: normalize(parts[1]!), zip: parts[2]! } : null;
}

/** "4 bds" -> 4, "3/1 ba" -> 3.5, "2,241 sf" -> 2241. */
const leadingFigure = (value: string | null): string | null => value ? /^\s*([\d,]+(?:\s*\/\s*\d+)?)/.exec(value)?.[1]?.replace(/\s+/g, "") ?? null : null;

/** One `a.home-card` (the card since October 20, 2026); a card without its link, street or price has no status, so the run is held. */
function highlandHomeCard(card: HtmlElement, html: string, community: URL, place: { city: string; zip: string } | null, now: Date, index: number): PrivatePlanOrHome {
  const inner = descendants(card);
  const read = (token: string) => { const element = inner.find((item) => elementClass(item, token)); return element ? normalize(elementText(element, html)) || null : null; };
  const href = card.attributes.href ? decodeHtmlEntities(card.attributes.href) : null;
  const page = href ? asUrl(new URL(href, community).toString()) : null;
  const official = page && sameOfficialHost(page, HIGHLAND_HOST) && page.pathname.toLowerCase().startsWith(`${community.pathname.replace(/\/+$/, "").toLowerCase()}/`) ? page : null;
  // "255 White Oak, Castroville, TX": the street, then the city.
  const addressLine = read("home-address");
  const address = addressLine ? /^(.*?),\s*([A-Za-z .'-]+),\s*TX\b/.exec(addressLine) : null;
  const street = address ? normalize(address[1]!) : null;
  const city = address ? normalize(address[2]!) : null;
  const zip = place && city && place.city.toLowerCase() === city.toLowerCase() ? place.zip : null;
  const price = Number((/\$\s*([\d,]{6,})/.exec(read("home-price") ?? "")?.[1] ?? "").replace(/,/g, "")) || null;
  const status = highlandStatus(read("home-tag"), now);
  const plan = read("home-plan");
  const beds = leadingFigure(read("home-bedrooms"));
  const baths = leadingFigure(read("home-baths"));
  const garages = leadingFigure(read("home-garages"));
  const sqft = leadingFigure(read("home-squarefootage"));
  const image = inner.find((element) => element.tag === "img");
  const imageUrl = image ? decodeHtmlEntities(image.attributes.src ?? image.attributes["data-src"] ?? "") : "";
  return {
    sourceUrl: official ? official.toString() : `${community.origin}${community.pathname.replace(/\/+$/, "")}/unreadable-${index}`,
    privateName: street,
    privateAddress: street && city ? `${street}, ${city}, ${zip ? `TX ${zip}` : "TX"}` : street,
    privatePlanName: plan ? normalize(/^(.*?\bPlan)\b/.exec(plan)?.[1] ?? plan) : null,
    status: street && price && official ? status.status : null,
    price,
    bedrooms: beds ? Number(beds) || null : null,
    bathrooms: baths ? highlandBaths(baths) : null,
    squareFeet: sqft ? Number(sqft.replace(/,/g, "")) || null : null,
    garage: garages ? Number(garages) || null : null,
    readyNow: status.readyNow,
    moveInDate: status.moveInDate,
    gallery: /^https:\/\/media\.hhomesltd\.com\//.test(imageUrl) ? [{ sourceUrl: imageUrl, caption: null, width: null, height: null, srcSet: null }] : [],
  };
}

export type HighlandSection = {
  /** The section's own page (".../<community>/<section>/section"), on the official host under the community. */
  url: string | null;
  /** The overview square's "<N> Quick Move-in"; 0 when the section shows no such square. */
  quickMoveIn: number;
  homes: PrivatePlanOrHome[];
};

/** The lot sections of a community page in the October 20, 2026 layout; null when the page has none. */
export function parseHighlandSections(html: string, communityUrl: string, now: Date = new Date()): HighlandSection[] | null {
  const community = asUrl(communityUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const place = highlandHeroPlace(html);
  const isHeading = (element: HtmlElement) => element.tag === "h2" && elementClass(element, "display_name");
  const wrappers = descendants(root).filter((element) => elementClass(element, "wrapper") && descendants(element).some(isHeading));
  if (!wrappers.length) return null;
  const sections: HighlandSection[] = [];
  let index = 0;
  for (const wrapper of wrappers) {
    const inner = descendants(wrapper);
    // One heading per section: a wrapper around two is not a layout this reader knows.
    if (inner.filter(isHeading).length !== 1) return null;
    const heading = inner.find(isHeading)!;
    const link = descendants(heading).find((element) => element.tag === "a" && element.attributes.href);
    const page = link ? asUrl(new URL(decodeHtmlEntities(link.attributes.href!), community).toString()) : null;
    const url = page && sameOfficialHost(page, HIGHLAND_HOST) && page.pathname.toLowerCase().startsWith(`${community.pathname.replace(/\/+$/, "").toLowerCase()}/`) ? `${page.origin}${page.pathname}` : null;
    let quickMoveIn = 0;
    for (const square of inner.filter((element) => elementClass(element, "overview-2x2-square-item"))) {
      const label = descendants(square).find((element) => elementClass(element, "label"));
      const number = descendants(square).find((element) => elementClass(element, "number"));
      // A count that is not a plain number ("6+") is not a count: -1, so the section is held.
      if (label && number && /^quick\s*move-?\s*in$/i.test(normalize(elementText(label, html)))) quickMoveIn = /^\d+$/.test(normalize(elementText(number, html))) ? Number(normalize(elementText(number, html))) : -1;
    }
    const seen = new Set<string>();
    const homes: PrivatePlanOrHome[] = [];
    for (const card of inner.filter((element) => element.tag === "a" && elementClass(element, "home-card"))) {
      const home = highlandHomeCard(card, html, community, place, now, index++);
      if (seen.has(home.sourceUrl)) continue;
      seen.add(home.sourceUrl);
      homes.push(home);
    }
    sections.push({ url, quickMoveIn, homes });
  }
  return sections;
}

/** Every home card on a section page, either card shape, under the community; deduplicated by page. */
export function parseHighlandSectionPage(html: string, communityUrl: string, now: Date = new Date()): PrivatePlanOrHome[] | null {
  const community = asUrl(communityUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const place = highlandHeroPlace(html);
  const homes: PrivatePlanOrHome[] = [];
  const seen = new Set<string>();
  let index = 0;
  for (const card of descendants(root).filter((element) => element.tag === "a" && elementClass(element, "home-card"))) {
    const home = highlandHomeCard(card, html, community, place, now, index++);
    if (!seen.has(home.sourceUrl)) { seen.add(home.sourceUrl); homes.push(home); }
  }
  for (const home of parseHighlandCards(html, communityUrl, now) ?? []) if (!seen.has(home.sourceUrl)) { seen.add(home.sourceUrl); homes.push(home); }
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
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const sections = parseHighlandSections(page.text, community.toString(), now());
    if (sections) return this.loadSections(config, fetchedAt, privateSnapshot, community, page.text, sections, fetcher, now());
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

  /** The sectioned community page: each section's preview, or its own page when the preview shows fewer homes than the section counts. */
  private async loadSections(config: CommunitySourceConfig, fetchedAt: string, privateSnapshot: ReturnType<typeof emptyPrivate>, community: URL, html: string, sections: HighlandSection[], fetcher: HtmlFetcher, now: Date): Promise<DealAdapterResult> {
    // The hero's city and ZIP and the community's name are this layout's proof of a community page.
    if (!highlandHeroPlace(html) || !highlandCommunityFacts(html).name) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    const homes: PrivatePlanOrHome[] = [];
    for (const section of sections) {
      let sectionHomes = section.homes;
      // Home cards with no readable "Quick Move-in" count (the square reworded, moved or unreadable): the preview of up to
      // three proves nothing about the rest, so nothing is published.
      if (section.quickMoveIn < 0 || (section.quickMoveIn === 0 && section.homes.length > 0)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
      if (sectionHomes.length < section.quickMoveIn) {
        // The preview is partial: the section page must show every home the count names, or nothing is published.
        if (!section.url) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
        const sectionPage = await getDocument(section.url, fetcher, "text/html,application/xhtml+xml", HIGHLAND_HOST);
        if (!sectionPage.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(sectionPage, "detail_fetch_failed")]);
        privateSnapshot.pages.push(sourcePage("community", section.url, null));
        const read = parseHighlandSectionPage(sectionPage.text, community.toString(), now) ?? [];
        if (read.length < section.quickMoveIn) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
        sectionHomes = read;
      }
      for (const home of sectionHomes) if (!homes.some((other) => other.sourceUrl === home.sourceUrl)) homes.push(home);
    }
    if (homes.length > HIGHLAND_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    privateSnapshot.communityFacts = parseCommunityFacts(html);
    for (const home of homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    // The sections' "Build Your Own Home" plan cards are a preview of each section's plans, never the whole list: plans are not read.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}

/** The community's record for discovery, from its own page (no schema.org record there). */
export function highlandRecord(html: string): { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null } | null {
  const facts = highlandCommunityFacts(html);
  if (!facts.name || !facts.street) return null;
  return { name: facts.name, street: facts.street, city: facts.city, zip: facts.zip, phone: facts.phone, priceFrom: null, geo: facts.geo };
}
