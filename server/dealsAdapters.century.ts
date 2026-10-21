import {
  CENTURY_HOST, asUrl, cardAroundLink, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlElement, type HtmlFetcher, type PrivatePlanOrHome,
} from "./dealsAdapters";
import { jsonLdRecords } from "./dealsAdapters.homefiniti";

/**
 * CENTURY COMMUNITIES reader. The community page is server-rendered and
 * carries one schema.org `ProductGroup` whose `hasVariant` Products are the
 * homes for sale ("9122 OCOTILLO RDG, San Antonio, TX 78222", "3 beds, 2
 * baths, 1,388 sq ft", `offers.price`, `sku`, `url`, one `image`), plus a card
 * per home with its completion ("Est. Completion: Dec. Move In." or "Move-in
 * Ready!"), plan ("Easton - 1388") and the price it dropped from (`.wasPrice`).
 * The community's own record is `HomeAndConstructionBusiness`. Floor plans are
 * not on the page. Read-only, plain GET, official host only. Everything here is
 * private operational data.
 *
 * Page shapes (October 2026):
 * - community: /find-your-new-home/texas/san-antonio-metro/<city>/<community>/   (about 490 KB)
 * - home:      .../<community>/lots/<lot>-<address-slug>/
 *
 * Since October 20, 2026 the cards sit in `section.quick-move-in-commerce-container`
 * blocks: "Available homes" (one `li.quick-move-in-card` per home: street and
 * lot, completion, plan, `.wasPrice`, `.price`, `.spec-value`/`.spec-label`
 * cells) and "ALREADY TAKEN" ("Homes reserved or under contract", no price).
 * A taken card is not a home for sale and never counts against the records;
 * some pages (Senna) carry no ProductGroup at all, and then the available
 * cards are the inventory.
 */
/** A community with more homes for sale than this is held, never truncated. */
export const CENTURY_MAX_HOMES = 150;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : null;
const num = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value.replace(/[$,]/g, ""))) ? Number(value.replace(/[$,]/g, "")) : null;
const MONTHS: Record<string, string> = { jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June", jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December" };
const MONTH_INDEX = Object.keys(MONTHS);

/**
 * "Est. Completion: Dec. Move In." names a month without a year: the next
 * occurrence of that month from today. "Move-in Ready!" is ready now. Other
 * wording gives no status (the run is held).
 */
export function centuryStatus(card: string | null, now: Date = new Date()): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const value = (card ?? "").replace(/\s+/g, " ").replace(/^Est\.?\s*Completion:?\s*/i, "").trim();
  if (!value) return { status: null, readyNow: false, moveInDate: null };
  // A completion field: only sale words sell; "pending" there is an unknown date, not a sale.
  if (/\bsold\b|under\s+contract/i.test(value)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/move[- ]?in\s+ready|ready\s+now|available\s+now|complete/i.test(value)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const month = /^([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?\s+move[- ]?in/i.exec(value);
  const name = month ? MONTHS[month[1]!.toLowerCase().slice(0, 3)] : undefined;
  if (month && name) {
    const index = MONTH_INDEX.indexOf(month[1]!.toLowerCase().slice(0, 3));
    const year = month[2] ? Number(month[2]) : now.getUTCMonth() <= index ? now.getUTCFullYear() : now.getUTCFullYear() + 1;
    // An explicit month already past is a stale estimate: still for sale, no date.
    if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && index < now.getUTCMonth())) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
    return { status: `Quick Move-In (${name} ${year})`, readyNow: false, moveInDate: `${name} ${year}` };
  }
  return { status: null, readyNow: false, moveInDate: null };
}

export type CenturyPage = { community: Json | null; homes: Array<PrivatePlanOrHome & { path: string }> };

/** The homes in the page's ProductGroup; null when the page has no ProductGroup at all. */
export function parseCenturyRecords(html: string, host: string): CenturyPage | null {
  const records = jsonLdRecords(html);
  const typed = (record: Json, type: string) => (Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]]).includes(type);
  const group = records.find((record) => typed(record, "ProductGroup"));
  const community = records.find((record) => typed(record, "HomeAndConstructionBusiness")) ?? null;
  if (!group || !Array.isArray(group.hasVariant)) return null;
  const homes: CenturyPage["homes"] = [];
  for (const raw of group.hasVariant) {
    const variant = obj(raw);
    if (!variant) continue;
    const url = asUrl(text(variant.url) ?? text(obj(variant.offers)?.url) ?? "");
    const name = text(variant.name);
    if (!url || !sameOfficialHost(url, host) || !name) continue;
    const address = /^(.*?),\s*([A-Za-z .'-]+),\s*TX\s+(\d{5})/.exec(name);
    const street = address ? address[1]!.replace(/\s+/g, " ").trim() : name;
    const specs = text(variant.description) ?? "";
    const beds = /(\d+(?:\.\d)?)\s*beds?/i.exec(specs);
    const baths = /(\d+(?:\.\d)?)\s*baths?/i.exec(specs);
    const sqft = /([\d,]{3,6})\s*sq\s*ft/i.exec(specs);
    const price = num(obj(variant.offers)?.price);
    const image = text(variant.image);
    const imageUrl = image ? asUrl(image) : null;
    homes.push({
      path: url.pathname,
      sourceUrl: url.toString(),
      privateName: titleCaseStreet(street),
      privateAddress: address ? `${titleCaseStreet(street)}, ${address[2]!.trim()}, TX ${address[3]}` : titleCaseStreet(street),
      privatePlanName: null,
      status: null,
      price: price && price > 0 ? price : null,
      bedrooms: beds ? Number(beds[1]) : null,
      bathrooms: baths ? Number(baths[1]) : null,
      squareFeet: sqft ? Number(sqft[1]!.replace(/,/g, "")) : null,
      readyNow: false,
      gallery: imageUrl && sameOfficialHost(imageUrl, host) ? [{ sourceUrl: imageUrl.toString(), caption: null, width: null, height: null, srcSet: null }] : [],
    });
  }
  return { community, homes };
}

/** The community's own schema.org business record (its city and ZIP finish a card's street), null when the page has none. */
export function centuryBusinessRecord(html: string): Json | null {
  return jsonLdRecords(html).find((record) => (Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]]).includes("HomeAndConstructionBusiness")) ?? null;
}

/** A commerce block's heading says its cards are reserved, under contract or sold: not homes for sale. */
const TAKEN_HEADING = /already\s+taken|reserved|under\s+contract|\bsold\b/i;

export type CenturyCards = {
  /** The page has at least one available-homes commerce block. */
  hasAvailableSection: boolean;
  /** Street cards (`.street-number-text`) outside the taken blocks: the page's own count of homes for sale. */
  availableCardCount: number;
  /** The homes read from the available cards (an unreadable card stays, with no status, so the run holds). */
  available: Array<PrivatePlanOrHome & { path: string }>;
  /** The home pages the taken blocks link: reserved or under contract. */
  takenPaths: string[];
};

/** The quick move-in cards by block: available homes read in full, taken ones only by link. */
export function parseCenturyCards(html: string, root: HtmlElement, pageUrl: string, now: Date = new Date()): CenturyCards {
  const community = asUrl(pageUrl);
  const all = descendants(root);
  const sections = all.filter((element) => element.tag === "section" && elementClass(element, "quick-move-in-commerce-container"));
  const heading = (section: HtmlElement) => { const h2 = descendants(section).find((element) => element.tag === "h2"); return h2 ? elementText(h2, html) : ""; };
  const taken = sections.filter((section) => TAKEN_HEADING.test(heading(section)));
  const insideTaken = new Set<HtmlElement>(taken.flatMap((section) => descendants(section)));
  const availableSections = sections.filter((section) => !taken.includes(section));
  const linkOf = (card: HtmlElement) => {
    const title = descendants(card).find((element) => elementClass(element, "street-number"));
    const anchor = title ? descendants(title).find((element) => element.tag === "a" && element.attributes.href) : undefined;
    return anchor && community ? asUrl(new URL(decodeHtmlEntities(anchor.attributes.href!), community).toString()) : null;
  };
  const takenPaths = taken.flatMap((section) => descendants(section).filter((element) => elementClass(element, "quick-move-in-card"))).map(linkOf).filter((url): url is URL => url !== null).map((url) => url.pathname);
  const availableCardCount = all.filter((element) => elementClass(element, "street-number-text") && !insideTaken.has(element)).length;
  const business = centuryBusinessRecord(html);
  const address = obj(business?.address);
  const city = text(address?.addressLocality);
  const zip = /^\d{5}/.exec(text(address?.postalCode) ?? "")?.[0] ?? null;
  const available: CenturyCards["available"] = [];
  for (const card of availableSections.flatMap((section) => descendants(section).filter((element) => elementClass(element, "quick-move-in-card")))) {
    const inner = descendants(card);
    const read = (token: string) => { const element = inner.find((item) => elementClass(item, token)); return element ? elementText(element, html) || null : null; };
    const url = linkOf(card);
    const official = url && sameOfficialHost(url, CENTURY_HOST) ? url : null;
    // "6566 Bufflehead Bend | Lot 220201": the street, then the lot.
    const label = read("street-number-text") ?? "";
    const street = label.split("|")[0]!.replace(/\s+/g, " ").trim() || null;
    const price = num(/\$\s*([\d,]{6,})/.exec(read("price") ?? "")?.[1]);
    const was = num(/\$\s*([\d,]{6,})/.exec(read("wasPrice") ?? "")?.[1]);
    const specs = new Map<string, number>();
    for (const cell of inner.filter((element) => elementClass(element, "cell"))) {
      const value = descendants(cell).find((element) => elementClass(element, "spec-value"));
      const name = descendants(cell).find((element) => elementClass(element, "spec-label"));
      const figure = value ? num(elementText(value, html)) : null;
      if (name && figure !== null) specs.set(elementText(name, html).toLowerCase(), figure);
    }
    const spec = (pattern: RegExp) => { for (const [name, value] of Array.from(specs)) if (pattern.test(name)) return value; return null; };
    const status = centuryStatus(read("est-complete-date"), now);
    const plan = read("title");
    const image = inner.find((element) => element.tag === "img" && /\/globalassets\//.test(element.attributes.src ?? ""));
    const imageUrl = image ? asUrl(new URL(decodeHtmlEntities(image.attributes.src!), community ?? `https://${CENTURY_HOST}/`).toString()) : null;
    if (imageUrl) imageUrl.search = "";
    const readable = Boolean(official && street && price && price > 0);
    const name = street ? titleCaseStreet(street) : null;
    available.push({
      path: official ? official.pathname : `/unreadable-${available.length}`,
      sourceUrl: official ? official.toString() : `${community?.origin ?? `https://${CENTURY_HOST}`}${(community?.pathname ?? "/").replace(/\/+$/, "")}/unreadable-${available.length}`,
      privateName: name,
      privateAddress: name ? (city ? `${name}, ${city}, ${zip ? `TX ${zip}` : "TX"}` : name) : null,
      privatePlanName: plan ? plan.replace(/\s*-\s*\d{3,5}\s*$/, "").trim() || null : null,
      // A card without its link, street or price is not read on a guess: no status, so the run is held.
      status: readable ? status.status : null,
      price: price && price > 0 ? price : null,
      previousPrice: was && price && was > price ? was : null,
      priceDrop: was && price && was > price ? was - price : null,
      bedrooms: spec(/^beds?$/),
      bathrooms: spec(/^baths?$/),
      squareFeet: spec(/^sq\.?\s*ft/),
      garage: spec(/^cars?$|garage/),
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      // The card photo is often another lot's elevation of the plan: shown as representative.
      gallery: imageUrl && sameOfficialHost(imageUrl, CENTURY_HOST) ? [{ sourceUrl: imageUrl.toString(), caption: "Representative image", width: null, height: null, srcSet: null }] : [],
    });
  }
  return { hasAvailableSection: availableSections.length > 0, availableCardCount, available, takenPaths };
}

/** "9122 OCOTILLO RDG" -> "9122 Ocotillo Rdg". */
function titleCaseStreet(value: string): string {
  return value.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

export class CenturyAdapter implements DealAdapter {
  readonly builder = "Century Communities" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, CENTURY_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", CENTURY_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const records = parseCenturyRecords(page.text, CENTURY_HOST);
    const root = parseHtmlElements(page.text);
    // Without the community's own business record this is not a community page.
    if (!root || !centuryBusinessRecord(page.text)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    const cards = parseCenturyCards(page.text, root, community.toString(), now());
    // Without the ProductGroup the available-homes block is the inventory; a page with neither is not one the reader knows.
    if (!records && !cards.hasAvailableSection) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    const homesRead = records ? records.homes : cards.available;
    if (homesRead.length > CENTURY_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    // A variant of another community on the host (a nearby-homes block) is never this community's inventory.
    const base = community.pathname.replace(/\/+$/, "").toLowerCase();
    if (homesRead.some((home) => !home.path.toLowerCase().startsWith(`${base}/`) && !home.path.startsWith("/unreadable-"))) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // More home cards on the page (outside the "already taken" block) than homes read means the records or cards changed shape, not that homes sold.
    if (cards.availableCardCount > homesRead.length) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // A record the page also shows as reserved or under contract is not read on a guess.
    const taken = new Set(cards.takenPaths.map((path) => path.replace(/\/+$/, "").toLowerCase()));
    if (homesRead.some((home) => taken.has(home.path.replace(/\/+$/, "").toLowerCase()))) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    privateSnapshot.communityFacts = parseCommunityFacts(page.text);
    if (records) {
      const homePaths = records.homes.map((home) => home.path);
      for (const record of records.homes) {
        const { path, ...home } = record;
        const card = cardAroundLink(page.text, root, path, { statusClasses: ["est-complete-date"], fields: { plan: ["title"] }, otherHomePaths: homePaths });
        const status = centuryStatus(card.status, now());
        privateSnapshot.homes.push({
          ...home, status: status.status, readyNow: status.readyNow, moveInDate: status.moveInDate,
          privatePlanName: card.fields.plan ? card.fields.plan.replace(/\s*-\s*\d{3,5}\s*$/, "").trim() || null : null,
          previousPrice: card.previousPrice && home.price && card.previousPrice > home.price ? card.previousPrice : null,
          priceDrop: card.previousPrice && home.price && card.previousPrice > home.price ? card.previousPrice - home.price : null,
        });
        privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName));
      }
    } else {
      for (const { path: _path, ...home } of cards.available) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    }
    // Floor plans are not on the page; the site's promotions are a header line ("Below-Market Rates") with no terms. Neither is read.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
