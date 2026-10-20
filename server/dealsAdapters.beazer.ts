import {
  BEAZER_HOST, NMLS_ID_PATTERN_ALL, asUrl, comparablePath, decodeHtmlEntities, emptyPrivate, failedResult, getDocument, htmlToText, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * BEAZER HOMES reader (www.beazer.com, a Next.js App Router site). The
 * community page `/san-antonio-TX/<city>/<slug>` is an app shell whose data
 * rides in the React Server Components payload (`self.__next_f.push([1,
 * "…"])` chunks: lines of `<id>:<json>`, `<id>:T<hex length>,<text>` and
 * `<id>:I[...]` module rows; a string "$<id>" or "$<id>:<path>" points at
 * another row). The payload carries:
 *
 * - the community (`__typename: "CommunityDetailPage"`: CommunityName,
 *   CommunityID, Url, Latitude/Longitude, MinimumPrice, CommunityStatus,
 *   HasVIPList, `ProductLines.ProductLinePage.items[]` with the sales
 *   office's StreetAddress, City, PostalCode and PhoneNumber, and
 *   `Plans.PlanDetailPage.items[]`: PlanName, Url, Price (0 when unpriced),
 *   SquareFoot/Beds/Baths min-max, IsHidden, IsActive, HasHomes,
 *   `Elevations[].ContentLink.Expanded` with Price, IsActive and Images);
 * - the card grids (`{ title: "Quick move-in homes", cards: [{ ContentLink:
 *   { Expanded: HomeDetailPage } }] }`, one grid per product line):
 *   each home's Url (`<community>/<plan>/<homesite>`), StreetAddress, City,
 *   Zip, HomesiteNumber, MLSNumber (never read), Beds, Baths, SquareFoot,
 *   Availability (ISO; passed → ready now, to come → its month, none →
 *   undated), IsActive, IsModel, HomePrice, `Elevation.Expanded` (the
 *   plan's base price — not a previous price — and photos),
 *   ElevationImages, InteriorImages, `ParentPlanContent…PlanName`;
 * - the community's offers (`extraData.activeOffersCurrently[]`:
 *   OfferBlock with Content HTML, DisplayStartDate/End, IsActive and
 *   `Disclaimer[].ContentLink.Expanded.Text`, a "$<id>" reference to a
 *   text row). The rate-naming offer is the text; a "5/1 ARM" holds as
 *   adjustable.
 * The site's own community search (`/api/get-communities-per-area?…&
 * ancestorMainId=<San Antonio metro id>`, a plain GET with no key) lists
 * the metro's 18 communities with name, URL, pin, minimum price and city;
 * each page is read for the sales address. Read-only, plain GET, official
 * host only. Everything here is private operational data.
 */
/** A community with more homes for sale than this is held, never truncated. */
export const BEAZER_MAX_HOMES = 150;
/** The San Antonio metro page's content id (`MetroDetailPage` 55228d07…, October 2026). */
export const BEAZER_SAN_ANTONIO_METRO_ID = "55228d07-f388-4656-9b45-c4671017e201";
export const beazerListingUrl = () => `https://${BEAZER_HOST}/api/get-communities-per-area?skip=0&limit=100&orderBy=FeatureOrder%3AASC&filters=%7B%7D&ancestorMainId=${BEAZER_SAN_ANTONIO_METRO_ID}`;
export const BEAZER_PHOTO_HOSTS = ["cmp.beazer.com", "cms.beazer.com", "www.beazer.com"] as const;
/** The photo paths on those hosts: the DAM's `/images/`, the CMS's content and global assets (never a `/_next/image` proxy). */
export const BEAZER_PHOTO_PATH = /^\/(?:images|contentassets|globalassets)\//i;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
const pagePath = (url: URL): string => comparablePath(url.pathname.replace(/\/+$/, ""));
const pageUrlOf = (url: URL): string => `${url.origin}${url.pathname.replace(/\/+$/, "")}`;

/**
 * The page's server-component rows by id: parsed JSON, or the text of a
 * `T` row; null when the page carries none, or when a row cannot be read
 * (a head that is not `<id>:`, a text row that overruns the payload, more
 * rows than a page has). The payload is handled as UTF-8 bytes: a `T`
 * row's declared length is its text's byte length on the wire (the live
 * Veranda page's row 1b: 1,305 characters, 0x520 = 1,312 bytes), and the
 * next row's head follows the text directly.
 */
export function parseBeazerFlight(html: string): Map<string, unknown> | null {
  const pieces: string[] = [];
  for (const match of Array.from(html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g))) {
    try { pieces.push(JSON.parse(`"${match[1]!}"`) as string); } catch { return null; }
  }
  if (!pieces.length) return null;
  const flight = Buffer.from(pieces.join(""), "utf8");
  const rows = new Map<string, unknown>();
  let position = 0;
  let count = 0;
  while (position < flight.length) {
    if (count++ >= 5_000) return null;
    // A hint row has no id (":HL[…]"); the live Veranda page (2026-10-20) carried 10 such rows among 100.
    const head = /^([0-9a-f]*):/.exec(flight.subarray(position, position + 12).toString("latin1"));
    if (!head) {
      // A blank line between rows is nothing; anything else is a payload the reader does not know.
      const newline = flight.indexOf(0x0a, position);
      const gap = flight.subarray(position, newline < 0 ? flight.length : newline).toString("utf8");
      if (gap.trim()) return null;
      if (newline < 0) break;
      position = newline + 1;
      continue;
    }
    const id = head[1]!;
    position += head[0].length;
    const kind = String.fromCharCode(flight[position] ?? 0);
    if (kind === "T") {
      // "<id>:T<hex byte length>,<text>"
      const comma = flight.indexOf(0x2c, position);
      const length = comma > position + 1 ? parseInt(flight.subarray(position + 1, comma).toString("latin1"), 16) : NaN;
      if (!Number.isFinite(length) || comma + 1 + length > flight.length) return null;
      rows.set(id, flight.subarray(comma + 1, comma + 1 + length).toString("utf8"));
      position = comma + 1 + length;
      if (flight[position] === 0x0a) position++;
      continue;
    }
    const newline = flight.indexOf(0x0a, position);
    const line = flight.subarray(position, newline < 0 ? flight.length : newline).toString("utf8");
    position = newline < 0 ? flight.length : newline + 1;
    if (kind === "I" || kind === "H" || kind === "E") continue;
    try { rows.set(id, JSON.parse(line)); } catch { /* a row the reader does not need */ }
  }
  return rows.size ? rows : null;
}

/** A "$<id>" or "$<id>:<path>" reference followed into the rows (a React element row's `props` is its fourth slot); anything else as it is. */
export function resolveBeazerRef(rows: Map<string, unknown>, value: unknown, depth = 0): unknown {
  if (typeof value !== "string" || !/^\$[0-9a-f]+(?::|$)/.test(value) || depth > 8) return value;
  const [, id, path] = /^\$([0-9a-f]+)(?::(.*))?$/.exec(value)!;
  if (!rows.has(id!)) return value;
  let node: unknown = rows.get(id!);
  for (const segment of path ? path.split(":") : []) {
    node = resolveBeazerRef(rows, node, depth + 1);
    if (Array.isArray(node)) node = segment === "props" && node[0] === "$" ? node[3] : node[Number(segment)];
    else if (obj(node)) node = obj(node)![segment];
    else return undefined;
  }
  return resolveBeazerRef(rows, node, depth + 1);
}

/** Every object in the rows that satisfies the test, in row order (React element arrays walked too). */
function findAll(rows: Map<string, unknown>, test: (node: Json) => boolean): Json[] {
  const out: Json[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 120) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    const record = obj(node);
    if (!record) return;
    if (test(record)) out.push(record);
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  for (const row of Array.from(rows.values())) if (typeof row !== "string") walk(row, 0);
  return out;
}

/**
 * The home's availability date: one that has passed is ready now, one to
 * come names its month, none is an undated quick move-in; a model home is a
 * Model; an unreadable date gives no status (the run is held).
 */
export function beazerStatus(availability: string | null, isModel: boolean, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  if (isModel) return { status: "Model", readyNow: false, moveInDate: null };
  const text = (availability ?? "").trim();
  if (!text) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const year = match ? Number(match[1]) : NaN;
  const month = match ? Number(match[2]) : NaN;
  const day = match ? Number(match[3]) : NaN;
  if (!match || month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > now.getUTCFullYear() + 5) return { status: null, readyNow: false, moveInDate: null };
  if (Date.UTC(year, month - 1, day) <= now.getTime()) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const name = `${MONTH_NAMES[month - 1]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type BeazerCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

const geoOf = (latitude: unknown, longitude: unknown): { lat: number; lng: number } | null => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
};

/** The community row's record: name, the first product line's sales office, pin and minimum price. */
function recordOf(community: Json): BeazerCommunityRecord | null {
  const name = str(community.CommunityName) ?? str(community.Name);
  if (!name) return null;
  const office = arr(obj(obj(community.ProductLines)?.ProductLinePage)?.items).map(obj).find((item) => item && (str(item.StreetAddress) || str(item.PhoneNumber))) ?? arr(obj(obj(community.ProductLines)?.ProductLinePage)?.items).map(obj).find(Boolean) ?? null;
  const street = str(office?.StreetAddress);
  return {
    name,
    street: looksLikeStreetAddress(street) ? street : null,
    city: str(office?.City),
    zip: /^\d{5}/.exec(str(office?.PostalCode) ?? "")?.[0] ?? null,
    phone: (str(office?.PhoneNumber) ?? "").replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "") || null,
    priceFrom: positive(community.MinimumPrice),
    geo: geoOf(community.Latitude, community.Longitude),
  };
}

function photoUrl(value: unknown, host: string): string | null {
  const url = typeof value === "string" ? asUrl(decodeHtmlEntities(value)) : null;
  if (!url || url.protocol !== "https:" || !(BEAZER_PHOTO_HOSTS as readonly string[]).includes(url.hostname.toLowerCase()) || !BEAZER_PHOTO_PATH.test(url.pathname) || /floor\s*plan|floorplan|site\s*plan|\.pdf$|\.svg$/i.test(url.pathname)) return null;
  void host;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** The image URLs of a content-area list (`[{ ContentLink: { Expanded: { Url } } }]`), on the photo hosts. */
function gallery(rows: Map<string, unknown>, lists: unknown[], host: string): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  for (const list of lists) {
    for (const item of arr(resolveBeazerRef(rows, list))) {
      const expanded = obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, item))?.ContentLink))?.Expanded));
      const url = photoUrl(expanded?.Url, host);
      if (url && !out.some((image) => image.sourceUrl === url) && out.length < 8) out.push({ sourceUrl: url, caption: "Representative image", width: null, height: null, srcSet: null });
    }
  }
  return out;
}

export type BeazerPage = {
  record: BeazerCommunityRecord;
  /** True when the community row's own URL is another page: a same-host redirect to another community. */
  foreignPage: boolean;
  /** True when the community takes a VIP list instead of selling (coming soon). */
  comingSoon: boolean;
  homes: PrivatePlanOrHome[];
  /** True when a home links under another community's path. */
  foreignHome: boolean;
  /** True when the page has a quick move-in card grid at all. */
  hasHomesGrid: boolean;
  /** True when a plan row says it has homes (the grid must then show some). */
  plansSayHomes: boolean;
  plans: PrivatePlanOrHome[];
  foreignPlan: boolean;
  offer: string | null;
  /** True when a current offer's disclaimer or display window cannot be read: the offer is held, never published without its terms. */
  offerUnreadable: boolean;
};

/** The community on the page; null when the payload carries no community row. */
export function parseBeazerCommunity(html: string, pageUrl: string, now: Date = new Date()): BeazerPage | null {
  const community = asUrl(pageUrl);
  const rows = parseBeazerFlight(html);
  if (!community || !rows) return null;
  const host = community.hostname;
  // The page's own row is the one whose URL is the page (a nearby-communities list may stream other rows first); the first stands in for a redirected page.
  const candidates = findAll(rows, (node) => node.__typename === "CommunityDetailPage" && node.CommunityID !== undefined && typeof node.Url === "string");
  const row = candidates.find((node) => { const url = asUrl(String(node.Url)); return url !== null && sameOfficialHost(url, host) && pagePath(url) === pagePath(community); }) ?? candidates[0];
  const record = row ? recordOf(row) : null;
  if (!row || !record) return null;
  // The row's own URL must be this page on the official host: another path, host or scheme is another page.
  const own = asUrl(String(row.Url));
  const foreignPage = own === null || !sameOfficialHost(own, host) || pagePath(own) !== pagePath(community);
  const base = `${pagePath(community)}/`;
  const homes: PrivatePlanOrHome[] = [];
  let foreignHome = false;
  let hasHomesGrid = false;
  const seen = new Set<string>();
  // A grid's title or cards may arrive as a reference to another row (React outlines a value referenced twice).
  const grids = findAll(rows, (node) => typeof resolveBeazerRef(rows, node.title) === "string" && /quick\s*move/i.test(String(resolveBeazerRef(rows, node.title))) && Array.isArray(resolveBeazerRef(rows, node.cards)));
  for (const grid of grids) {
    hasHomesGrid = true;
    for (const card of arr(resolveBeazerRef(rows, grid.cards))) {
      const home = obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, card))?.ContentLink))?.Expanded));
      if (!home || home.__typename !== "HomeDetailPage") continue;
      const link = str(home.Url);
      const url = link ? asUrl(link) : null;
      if (!url || !sameOfficialHost(url, host)) { foreignHome = true; continue; }
      if (!`${pagePath(url)}/`.startsWith(base) || pagePath(url) === pagePath(community)) { foreignHome = true; continue; }
      if (seen.has(pagePath(url))) continue;
      seen.add(pagePath(url));
      if (home.IsActive === false) continue;
      const street = str(home.StreetAddress);
      const readable = looksLikeStreetAddress(street);
      const status = beazerStatus(str(home.Availability), home.IsModel === true, now);
      const city = str(home.City) ?? record.city;
      const zip = /^\d{5}/.exec(str(home.Zip) ?? "")?.[0] ?? record.zip;
      const elevation = obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, home.Elevation))?.Expanded));
      const planName = str(obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, home.ParentPlanContent))?.PlanDetailPage))?.item))?.PlanName) ?? null;
      const homesite = str(home.HomesiteNumber);
      homes.push({
        sourceUrl: pageUrlOf(url),
        privateName: street,
        privateAddress: readable ? `${street}, ${city ? `${city}, ${zip ? `TX ${zip}` : "TX"}` : "TX"}` : null,
        privatePlanName: planName,
        status: readable ? status.status : null,
        price: positive(home.HomePrice),
        bedrooms: positive(home.BedsOverride) ?? positive(home.Beds),
        bathrooms: positive(home.BathsOverride) ?? positive(home.Baths),
        squareFeet: positive(home.SquareFeetOverride) ?? positive(home.SquareFoot),
        homesite: homesite && /^\d+$/.test(homesite) ? `Lot ${homesite}` : null,
        readyNow: status.readyNow,
        moveInDate: status.moveInDate,
        gallery: gallery(rows, [home.ElevationImages, elevation?.Images, home.InteriorImages], host),
      });
    }
  }
  const plans: PrivatePlanOrHome[] = [];
  let foreignPlan = false;
  let plansSayHomes = false;
  for (const raw of arr(obj(obj(row.Plans)?.PlanDetailPage)?.items)) {
    const plan = obj(resolveBeazerRef(rows, raw));
    if (!plan) continue;
    if (plan.HasHomes === true) plansSayHomes = true;
    const link = str(plan.Url);
    const url = link ? asUrl(link) : null;
    const name = str(plan.PlanName);
    if (!name || !url || !sameOfficialHost(url, host)) continue;
    if (!`${pagePath(url)}/`.startsWith(base) || pagePath(url) === pagePath(community)) { foreignPlan = true; continue; }
    // A hidden or inactive plan is not for sale as a build; a "LAND JOB" placeholder has no figures at all.
    if (plan.IsHidden === true || plan.IsActive !== true) continue;
    const elevations = arr(plan.Elevations).map((item) => obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, item))?.ContentLink))?.Expanded))).filter((item): item is Json => item !== null && item.IsActive !== false);
    const elevationPrices = elevations.map((item) => positive(item.Price)).filter((price): price is number => price !== null);
    const price = positive(plan.Price) ?? (elevationPrices.length ? Math.min(...elevationPrices) : null);
    const squareFeet = positive(plan.SquareFootMin) ?? positive(plan.SquareFootMax);
    // A row with neither a price nor a size is a placeholder, not a plan for sale.
    if (price === null && squareFeet === null) continue;
    plans.push({
      sourceUrl: pageUrlOf(url),
      privateName: name,
      privatePlanName: name,
      status: null,
      price,
      bedrooms: positive(plan.BedsMin) ?? positive(plan.BedsMax),
      bathrooms: positive(plan.BathsMin) ?? positive(plan.BathsMax),
      squareFeet,
      readyNow: false,
      gallery: gallery(rows, elevations.map((item) => item.Images), host),
    });
  }
  // The community's current offers: the rate-naming one first, else the first; each is its content and its disclaimer.
  const offers = findAll(rows, (node) => Array.isArray(node.activeOffersCurrently)).flatMap((node) => arr(node.activeOffersCurrently));
  let offerUnreadable = false;
  // A display window is a date; one the reader cannot read holds the offer rather than dropping or showing it.
  const windowDate = (value: unknown): number | null | false => {
    const text = str(value);
    if (!text) return null;
    const time = Date.parse(text);
    return Number.isFinite(time) ? time : false;
  };
  const current = offers.map((item) => obj(resolveBeazerRef(rows, item))).filter((item): item is Json => item !== null && item.IsActive !== false).filter((item) => {
    const from = windowDate(item.DisplayStartDate);
    const through = windowDate(item.DisplayEndDate);
    if (from === false || through === false) { offerUnreadable = true; return false; }
    return (from === null || from <= now.getTime()) && (through === null || through >= now.getTime());
  }).map((item) => {
    const content = typeof item.Content === "string" ? htmlToText(item.Content) : "";
    const disclaimers = arr(item.Disclaimer).map((entry) => resolveBeazerRef(rows, obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, obj(resolveBeazerRef(rows, entry))?.ContentLink))?.Expanded))?.Text));
    // A disclaimer still written as a "$<id>" reference points at a row the payload does not carry: the offer's terms are unreadable.
    if (disclaimers.some((text) => typeof text === "string" && /^\$[0-9a-f]+(?::|$)/.test(text))) { offerUnreadable = true; return ""; }
    return cleanOfferText([content, ...disclaimers.map((text) => typeof text === "string" ? htmlToText(text) : "")].filter(Boolean).join(" ").slice(0, 6_000));
  }).filter((text) => text && /\d+(?:\.\d+)?\s*%|\$\s*[\d,]{4,}/.test(text));
  const offer = current.find((text) => /\d+(?:\.\d+)?\s*%\s*(?:\(|\[|\/|APR|interest|rate|fixed|limited)/i.test(text)) ?? current[0] ?? null;
  return { record, foreignPage, comingSoon: row.HasVIPList === true, homes, foreignHome, hasHomesGrid, plansSayHomes, plans, foreignPlan, offer, offerUnreadable };
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
    .replace(/\s+([,.;:!?])/g, "$1").replace(/,(?:\s*,)+/g, ",").replace(/\s+/g, " ").trim();
}

/** The community's record from its page, for discovery; null when the page is not a community page. */
export function beazerRecord(html: string, pageUrl: string): BeazerCommunityRecord | null {
  return parseBeazerCommunity(html, pageUrl)?.record ?? null;
}

/** The metro search's communities for discovery: every row with its name, pin, city and minimum price (the page gives the street); null when the body is not the list. */
export function beazerListingEntries(body: string, host: string): Array<{ url: string; record: BeazerCommunityRecord }> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const items = obj(parsed)?.items;
  if (!Array.isArray(items)) return null;
  const out = new Map<string, { url: string; record: BeazerCommunityRecord }>();
  for (const raw of items) {
    const row = obj(raw);
    const link = row ? str(row.Url) : null;
    const url = link ? asUrl(link) : null;
    const record = row ? recordOf(row) : null;
    if (!row || !url || !sameOfficialHost(url, host) || !record) continue;
    // A VIP-list community is not selling yet (no office on its page): it is listed once it opens.
    if (row.HasVIPList === true) continue;
    const key = pageUrlOf(url);
    if (!out.has(key)) out.set(key, { url: key, record });
  }
  return Array.from(out.values());
}

export class BeazerAdapter implements DealAdapter {
  readonly builder = "Beazer Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, BEAZER_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", BEAZER_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseBeazerCommunity(page.text, community.toString(), now());
    // Without the community row and its sales office this is not a selling community's page (a VIP-list community has no office yet).
    if (!parsed || !parsed.record.street) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The page must be this community's (a same-host redirect to another one is not), and so must its homes and plans.
    if (parsed.foreignPage || parsed.foreignHome || parsed.foreignPlan) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // A plan that says it has homes needs the quick move-in grid; a grid is never truncated.
    if (parsed.plansSayHomes && (!parsed.hasHomesGrid || parsed.homes.length === 0)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.homes.length > BEAZER_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    const prices = parsed.homes.map((home) => home.price).filter((price): price is number => price !== null && price >= 50_000);
    privateSnapshot.communityFacts = { ...facts, fromPrice: parsed.record.priceFrom && parsed.record.priceFrom >= 50_000 ? parsed.record.priceFrom : facts.fromPrice ?? (prices.length ? Math.min(...prices) : null) };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    const incentiveHolds: DealHoldReason[] = [];
    if (parsed.offerUnreadable) incentiveHolds.push("expected_incentive_container_not_found");
    else if (parsed.offer) privateSnapshot.incentive = { sourceUrl: community.toString(), text: parsed.offer, facts: parsePromotionalRate(parsed.offer) };
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
  }
}
