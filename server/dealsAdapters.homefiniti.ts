import {
  HOMEFINITI_HOSTS, asUrl, cardAroundLink, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
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
export function homefinitiStatus(cardStatus: string | null): { status: string | null; readyNow: boolean } {
  const label = (cardStatus ?? "").replace(/\s+/g, " ").trim();
  if (!label) return { status: null, readyNow: false };
  if (/sold|under\s+contract|pending/i.test(label)) return { status: "Sold", readyNow: false };
  if (/model/i.test(label)) return { status: "Model Home", readyNow: false };
  // "Ready For You" is First America's card word for a finished home (October 2026), the other card word being "Under Construction".
  if (/^(?:move[- ]?in\s+ready|ready\s+now|ready\s+for\s+you|available\s+now|completed?|quick\s+move[- ]?in)!?$/i.test(label)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true };
  if (/^under\s+construction!?$/i.test(label)) return { status: "Quick Move-In (Under Construction)", readyNow: false };
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
    const records = parseHomefinitiRecords(page.text, this.host);
    // Without the community's own record this is not one of the platform's community pages.
    if (!records.community) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (records.homes.length > HOMEFINITI_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    // Two records of one home page that disagree on its figures: neither is read as the home.
    const recordPaths = records.homes.map((home) => comparablePath(new URL(home.sourceUrl).pathname.replace(/\/+$/, "")));
    if (new Set(recordPaths).size !== recordPaths.length) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    const root = parseHtmlElements(page.text);
    if (!root) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // A home record of another community on the same host (a "nearby homes" block) is never this community's inventory.
    const communitySlug = community.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
    if (records.homes.some((home) => !new URL(home.sourceUrl).pathname.toLowerCase().split("/").includes(communitySlug))) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
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
    const isStatus = (element: HtmlElement) => STATUS_CLASSES.some((token) => elementClass(element, token)) && elementText(element, page.text).length <= 40;
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
    if (cards.size > records.homes.length) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    privateSnapshot.communityFacts = parseCommunityFacts(page.text);
    const homePaths = records.homes.map((home) => new URL(home.sourceUrl).pathname);
    for (const record of records.homes) {
      const { kind: _kind, ...home } = record;
      const card = cardFacts(page.text, root, new URL(home.sourceUrl).pathname, homePaths);
      // A home listed without a card, or with a status word the reader does not know, is not published on a guess: the run is held.
      const status = homefinitiStatus(card.status);
      if (!status.status) return failedResult(config, fetchedAt, privateSnapshot, ["unlabelled_home_status"]);
      privateSnapshot.homes.push({
        ...home, status: status.status, readyNow: status.readyNow,
        previousPrice: card.previousPrice && home.price && card.previousPrice > home.price ? card.previousPrice : null,
        priceDrop: card.previousPrice && home.price && card.previousPrice > home.price ? card.previousPrice - home.price : null,
      });
      privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName));
    }
    for (const record of records.plans) {
      const { kind: _kind, ...plan } = record;
      privateSnapshot.plans.push(plan);
    }
    // The platform's promotions are site-wide banners ("Interest Rates Starting at 3.99%") whose terms are not published with them; none is read as a community incentive.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
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

