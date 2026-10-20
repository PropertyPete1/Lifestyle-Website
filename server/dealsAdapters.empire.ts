import {
  EMPIRE_HOST, NMLS_ID_PATTERN_ALL, asUrl, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, getDocument, htmlToText, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * EMPIRE HOMES reader (empirehomes.com, a WordPress/Elementor site). The
 * community page `/us/texas/san-antonio/[<city>/]<slug>/` carries:
 *
 * - two "apartments" widgets (`.apartments-widget[data-detail]`, a base64
 *   JSON `{ display: "quick_delivery_homes" | "new_home_plans", endpoint,
 *   community, permalink, region }`) that name the site's own listing
 *   endpoint and the community's record name; the page renders the first
 *   four cards and loads the rest from the endpoint;
 * - the sales office: a static map (`.map-agent-static-container img`,
 *   `src` `…/staticmap?center=<lat>,<lng>…`, `alt` "Map of <street>,
 *   <city>, TX <zip>") with its label (`.map-agent-static-label`, the
 *   community's name) and the office phone in a text widget. The static
 *   map's URL carries the site's own map key: the reader takes the center
 *   and never keeps or sends the URL;
 * - the market's promotion banner (`.banner-promotion-single`: "Smart Move
 *   Sales Event … Interest Rates as Low as 3.99%* …") whose footnote lives
 *   on the campaign page it links (`/us/texas/san-antonio/smart-move-
 *   campaign/`, the "Disclaimer: *…" text widget).
 * The listing endpoint (`/wp-json/custom/v1/get_lots_by_community_name?…
 * &name=<community>&meta_value=quick_delivery|new_home_plan`, the plain
 * GET the page's own widgets make, no key) answers `{ success, data: {
 * data: [rows], pagination: { total, per_page, current_page, last_page } }
 * }`. A home row (`unit_type` "Unit"): `permalink` (`<page>listing/
 * <slug>/`), `unit_address`, `unit_status` MoveInReady | UnderConstruction
 * | Sold, `move_in_date_day` (ISO; a future day names the month), `price`,
 * `previus_price` (sic; a cut's previous figure, "0" when none), `size`,
 * `bedrooms`, `bathrooms`, `halfbaths`, `unit_garages`, `lot`, `block`,
 * `phase`, `mls` (never read), `custom_banner_presale` (a per-home promo
 * label, never read: it names no terms), `plan_images_details[].url` and
 * `interior_images[]` on the site's uploads (`floorplan_images` are floor
 * plans). A plan row (`unit_type` "Plan"): `permalink` (`<page>home-plans/
 * <slug>/`), `unit_name_single`, `price`, `size`, beds/baths, `elevations[]`
 * (pictures on another host, not read). Read-only, plain GET, official host
 * only. Everything here is private operational data.
 */
/** A community with more homes for sale than this is held, never truncated. */
export const EMPIRE_MAX_HOMES = 100;
export const EMPIRE_LISTING_PATH = "/wp-json/custom/v1/get_lots_by_community_name";
export const empireRegionUrl = () => `https://${EMPIRE_HOST}/us/texas/san-antonio/`;
/** The site's own listing query for a community's homes for sale or plans (the page's widgets make the same request). */
export function empireListingUrl(community: string, kind: "homes" | "plans"): string {
  const params = new URLSearchParams({ per_page: String(EMPIRE_MAX_HOMES), page: "1", name: community, meta_key: "apartment_type", meta_value: kind === "homes" ? "quick_delivery" : "new_home_plan", sort_comminity: "collection", orderby: "collection", order: "DESC" });
  if (kind === "plans") params.set("unit_type", "Plan");
  return `https://${EMPIRE_HOST}${EMPIRE_LISTING_PATH}?${params.toString()}`;
}
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

export type EmpireWidget = { display: string; community: string; permalink: URL | null; endpoint: URL | null };

/** The page's listing widgets: their display, community name, permalink and endpoint. */
export function parseEmpireWidgets(html: string): EmpireWidget[] {
  const out: EmpireWidget[] = [];
  const pattern = /data-detail="([A-Za-z0-9+/=]+)"/g;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.from(match[1]!, "base64").toString("utf8")); } catch { continue; }
    const row = obj(parsed);
    const display = row ? str(row.display) : null;
    const community = row ? str(row.community) : null;
    if (!row || !display || !community) continue;
    const permalink = str(row.permalink);
    const endpoint = str(row.endpoint);
    out.push({ display, community, permalink: permalink ? asUrl(permalink) : null, endpoint: endpoint ? asUrl(endpoint.replace(/^(https?:\/\/[^/]+)\/{2,}/i, "$1/")) : null });
  }
  return out;
}

/**
 * The home's status: a sold sale status (or a "Sold" move-in text) is sold
 * and any other sale word gives no status; otherwise a move-in-ready home is
 * ready now, one under construction names the month of a move-in day to come
 * (a passed or missing day is an undated quick move-in), a sold one is sold,
 * and anything else gives no status (the run is held).
 */
export function empireStatus(unitStatus: string | null, moveInDay: string | null, now: Date, saleStatus: string | null = null, moveInText: string | null = null): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  // The sale status moves apart from construction: a sold row is sold whatever its construction status says; any other sale word (Pending, Reserved) is unknown.
  const sale = (saleStatus ?? "").replace(/[\s_-]+/g, "").toLowerCase();
  if (sale === "sold" || /^\s*sold\b/i.test(moveInText ?? "")) return { status: "Sold", readyNow: false, moveInDate: null };
  if (sale) return { status: null, readyNow: false, moveInDate: null };
  const value = (unitStatus ?? "").replace(/[\s_-]+/g, "").toLowerCase();
  if (value === "moveinready") return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  if (value === "sold") return { status: "Sold", readyNow: false, moveInDate: null };
  if (value !== "underconstruction") return { status: null, readyNow: false, moveInDate: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec((moveInDay ?? "").trim());
  const year = match ? Number(match[1]) : NaN;
  const month = match ? Number(match[2]) : NaN;
  const day = match ? Number(match[3]) : NaN;
  if (!match || month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > now.getUTCFullYear() + 5) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  if (Date.UTC(year, month - 1, day) <= now.getTime()) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${MONTH_NAMES[month - 1]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type EmpireCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

const geoOf = (latitude: unknown, longitude: unknown): { lat: number; lng: number } | null => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
};
/** "8602 Partida, San Antonio, TX 78222" or "1531 Estelea Grove, New Braunfels, TX, 78130". */
const ADDRESS_PATTERN = /^(.+?),\s*([A-Za-z .'-]+?),?\s+TX,?\s*(\d{5})(?:-\d{4})?$/;

function photoUrl(value: unknown, host: string): string | null {
  const url = typeof value === "string" ? asUrl(decodeHtmlEntities(value.trim())) : null;
  if (!url || url.protocol !== "https:" || !sameOfficialHost(url, host) || !/^\/wp-content\/uploads\//i.test(url.pathname) || /floor\s*plan|floorplan|site\s*plan|\.pdf$|\.svg$/i.test(url.pathname)) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export type EmpirePage = {
  record: EmpireCommunityRecord;
  /** The quick-delivery widget's community name (the listing query's name); null without the widget. */
  community: string | null;
  /** True when the page has the plans widget. */
  hasPlansWidget: boolean;
  /** True when a widget's permalink is another page: a same-host redirect to another community. */
  foreignPage: boolean;
  /** The page's own home cards (links under `<page>/listing/`), the first page of the listing. */
  cardUrls: string[];
  /** The market's promotion banner text; null without the banner. */
  promo: string | null;
  /** The campaign page the banner's footnote lives on; null when none is linked. */
  campaignUrl: string | null;
};

/** The community on the page; null without the sales office's static map. */
export function parseEmpireCommunity(html: string, pageUrl: string): EmpirePage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const host = community.hostname;
  const all = descendants(root);
  const mapImage = all.find((node) => node.tag === "img" && /\/maps\/api\/staticmap\?/i.test(node.attributes.src ?? ""));
  const label = all.find((node) => elementClass(node, "map-agent-static-label"));
  const widgets = parseEmpireWidgets(html);
  const quick = widgets.find((widget) => /quick/i.test(widget.display)) ?? null;
  const name = (label ? elementText(label, html) : "") || quick?.community || null;
  if (!mapImage || !name) return null;
  const center = /[?&]center=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(decodeHtmlEntities(mapImage.attributes.src ?? ""));
  const alt = decodeHtmlEntities(mapImage.attributes.alt ?? "").replace(/^\s*Map of\s+/i, "").replace(/\s+/g, " ").trim();
  const address = ADDRESS_PATTERN.exec(alt) ?? all.map((node) => elementClass(node, "elementor-shortcode") ? ADDRESS_PATTERN.exec(elementText(node, html)) : null).find((match): match is RegExpExecArray => match !== null) ?? null;
  const street = address ? address[1]!.trim() : null;
  const phone = all.map((node) => node.tag === "div" && elementClass(node, "elementor-widget-container") ? /^\(?(\d{3})\)?[-. ]?(\d{3})[-. ]?(\d{4})$/.exec(elementText(node, html)) : null).find((match): match is RegExpExecArray => match !== null) ?? null;
  const record: EmpireCommunityRecord = {
    name,
    street: looksLikeStreetAddress(street) ? street : null,
    city: address ? address[2]!.trim() : null,
    zip: address ? address[3]! : null,
    phone: phone ? `${phone[1]}${phone[2]}${phone[3]}` : null,
    priceFrom: null,
    geo: center ? geoOf(center[1], center[2]) : null,
  };
  const foreignPage = widgets.some((widget) => widget.permalink !== null && sameOfficialHost(widget.permalink, host) && pagePath(widget.permalink) !== pagePath(community));
  const base = `${pagePath(community)}/listing/`;
  const cardUrls: string[] = [];
  for (const node of all) {
    if (node.tag !== "a") continue;
    const link = asUrl(decodeHtmlEntities(node.attributes.href ?? ""));
    if (!link || !sameOfficialHost(link, host) || !`${pagePath(link)}/`.startsWith(base) || `${pagePath(link)}/` === base) continue;
    const url = pageUrlOf(link);
    if (!cardUrls.includes(url)) cardUrls.push(url);
  }
  const banner = all.find((node) => elementClass(node, "banner-promotion-single"));
  const promo = banner ? cleanOfferText(elementText(banner, html).replace(/\bRequest Information\b.*$/i, "")) || null : null;
  // The campaign page: a link in the banner itself first, else the market's own campaign/offers/promotion page (another market's page is never this community's terms).
  const market = /^\/us\/texas\/san-antonio\//i;
  const campaignOf = (nodes: HtmlElement[]) => nodes.map((node) => node.tag === "a" ? asUrl(decodeHtmlEntities(node.attributes.href ?? "")) : null).find((link): link is URL => link !== null && sameOfficialHost(link, host) && market.test(link.pathname) && /campaign|offers?|promotion/i.test(link.pathname)) ?? null;
  const campaignLink = (banner ? campaignOf(descendants(banner)) : null) ?? campaignOf(all);
  return { record, community: quick?.community ?? null, hasPlansWidget: widgets.some((widget) => /plan/i.test(widget.display)), foreignPage, cardUrls, promo, campaignUrl: campaignLink ? `${pageUrlOf(campaignLink)}/` : null };
}

/** The campaign page's footnote ("Disclaimer: *…" text widget); null without one. */
export function parseEmpireCampaign(html: string): string | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const texts = descendants(root).filter((node) => node.tag === "div" && elementClass(node, "elementor-widget-container")).map((node) => elementText(node, html)).filter((text) => /^\s*Disclaimer\s*:/i.test(text));
  const shortest = texts.sort((a, b) => a.length - b.length)[0];
  return shortest ? cleanOfferText(shortest.slice(0, 6_000)) || null : null;
}

/** Links, e-mail addresses, phone numbers, NMLS ids and footnote marks go from the offer text. */
function cleanOfferText(value: string): string {
  return value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/\(?\b\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, " ")
    // A loan officer named beside the lender ("; A. Person, NMLS #743526") is a private name, not a term.
    .replace(/;\s*[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3},?\s*NMLS\s*(?:ID\s*)?#?\s*\d+/g, " ")
    .replace(NMLS_ID_PATTERN_ALL, " ")
    .replace(/\*+/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1").replace(/,(?:\s*,)+/g, ",").replace(/\s+/g, " ").trim();
}

export type EmpireListing = { rows: Json[]; total: number | null; lastPage: number | null };

/** The listing endpoint's answer; null when the body is not the list. */
export function parseEmpireListing(body: string): EmpireListing | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const envelope = obj(parsed);
  const data = envelope ? obj(envelope.data) : null;
  if (!envelope || envelope.success !== true || !data || !Array.isArray(data.data)) return null;
  const pagination = obj(data.pagination);
  return { rows: data.data.map(obj).filter((row): row is Json => row !== null), total: pagination ? num(pagination.total) : null, lastPage: pagination ? num(pagination.last_page) : null };
}

function gallery(row: Json, host: string): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const candidates = [...arr(row.plan_images_details).map((item) => obj(item)?.url), ...arr(row.plan_images), ...arr(row.interior_images)];
  for (const candidate of candidates) {
    const url = photoUrl(candidate, host);
    if (url && !out.some((image) => image.sourceUrl === url) && out.length < 8) out.push({ sourceUrl: url, caption: "Representative image", width: null, height: null, srcSet: null });
  }
  return out;
}

/** The listing's home rows as homes for sale under the page; a row linking elsewhere flags the list. */
export function empireHomes(listing: EmpireListing, pageUrl: string, record: EmpireCommunityRecord, now: Date): { homes: PrivatePlanOrHome[]; foreignHome: boolean } {
  const community = asUrl(pageUrl);
  const homes: PrivatePlanOrHome[] = [];
  let foreignHome = false;
  if (!community) return { homes, foreignHome };
  const host = community.hostname;
  const base = `${pagePath(community)}/listing/`;
  const seen = new Set<string>();
  for (const row of listing.rows) {
    if ((str(row.unit_type) ?? "Unit").toLowerCase() !== "unit") continue;
    const link = str(row.permalink);
    const url = link ? asUrl(link) : null;
    if (!url || !sameOfficialHost(url, host) || !`${pagePath(url)}/`.startsWith(base) || `${pagePath(url)}/` === base) { foreignHome = true; continue; }
    if (seen.has(pagePath(url))) continue;
    seen.add(pagePath(url));
    if (str(row.is_active) === "0") continue;
    // A rental row is not a home for sale.
    if (str(row.is_rental) === "1") continue;
    const street = str(row.unit_address);
    const readable = looksLikeStreetAddress(street);
    const status = empireStatus(str(row.unit_status), str(row.move_in_date_day), now, str(row.unit_sale_status), str(row.move_in_date));
    const price = positive(row.price);
    const previous = positive(row.previus_price) ?? positive(row.previous_price);
    const cut = previous !== null && price !== null && previous > price;
    const lot = str(row.lot);
    const baths = positive(row.bathrooms);
    const planName = (str(row.unit_name_single) ?? "").split("|")[0]!.trim() || null;
    homes.push({
      sourceUrl: pageUrlOf(url),
      privateName: street,
      privateAddress: readable ? `${street}, ${record.city ? `${record.city}, ${record.zip ? `TX ${record.zip}` : "TX"}` : "TX"}` : null,
      privatePlanName: planName,
      status: readable ? status.status : null,
      price,
      previousPrice: cut ? previous : null,
      priceDrop: cut ? previous! - price! : null,
      bedrooms: positive(row.bedrooms),
      bathrooms: baths === null ? null : baths + (positive(row.halfbaths) ?? 0) * 0.5,
      squareFeet: positive(row.size),
      garage: positive(row.unit_garages),
      homesite: lot && /^\d+[A-Za-z]?$/.test(lot) ? `Lot ${lot}` : null,
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      gallery: gallery(row, host),
    });
  }
  return { homes, foreignHome };
}

/** The listing's plan rows as plans for sale under the page (a row with neither a price nor a size is a placeholder). */
export function empirePlans(listing: EmpireListing, pageUrl: string): { plans: PrivatePlanOrHome[]; foreignPlan: boolean } {
  const community = asUrl(pageUrl);
  const plans: PrivatePlanOrHome[] = [];
  let foreignPlan = false;
  if (!community) return { plans, foreignPlan };
  const host = community.hostname;
  const base = `${pagePath(community)}/home-plans/`;
  const seen = new Set<string>();
  for (const row of listing.rows) {
    if ((str(row.unit_type) ?? "Plan").toLowerCase() !== "plan") continue;
    const name = str(row.unit_name_single) ?? str(row.unit_name);
    const link = str(row.permalink);
    const url = link ? asUrl(link) : null;
    if (!name) continue;
    if (!url || !sameOfficialHost(url, host) || !`${pagePath(url)}/`.startsWith(base) || `${pagePath(url)}/` === base) { foreignPlan = true; continue; }
    if (seen.has(pagePath(url))) continue;
    seen.add(pagePath(url));
    if (str(row.is_active) === "0") continue;
    const elevationPrices = arr(row.elevations).map((item) => positive(obj(item)?.ElevationPrice)).filter((price): price is number => price !== null);
    const price = positive(row.price) ?? (elevationPrices.length ? Math.min(...elevationPrices) : null);
    const squareFeet = positive(row.size);
    if (price === null && squareFeet === null) continue;
    const baths = positive(row.bathrooms);
    plans.push({
      sourceUrl: pageUrlOf(url),
      privateName: name,
      privatePlanName: name,
      status: null,
      price,
      bedrooms: positive(row.bedrooms),
      bathrooms: baths === null ? null : baths + (positive(row.halfbaths) ?? 0) * 0.5,
      squareFeet,
      garage: positive(row.unit_garages),
      readyNow: false,
      gallery: gallery(row, host),
    });
  }
  return { plans, foreignPlan };
}

/** The community's record from its page, for discovery; null when the page is not a selling community's (no sales office). */
export function empireRecord(html: string, pageUrl: string): EmpireCommunityRecord | null {
  const page = parseEmpireCommunity(html, pageUrl);
  return page && page.record.street ? page.record : null;
}

/** The region page's community links for discovery (listing and plan pages sit deeper); null when the page has none. */
export function empireRegionLinks(html: string, host: string): string[] | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const out: string[] = [];
  for (const node of descendants(root)) {
    if (node.tag !== "a") continue;
    const link = asUrl(decodeHtmlEntities(node.attributes.href ?? ""));
    if (!link || !sameOfficialHost(link, host) || !/^\/us\/texas\/san-antonio\/(?:[a-z0-9-]+\/)?[a-z0-9-]+\/?$/i.test(link.pathname) || /\/(?:listing|home-plans)\//i.test(link.pathname)) continue;
    const url = `${pageUrlOf(link)}/`;
    if (!out.includes(url)) out.push(url);
  }
  return out.length ? out : null;
}

export class EmpireHomesAdapter implements DealAdapter {
  readonly builder = "Empire Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, EMPIRE_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", EMPIRE_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseEmpireCommunity(page.text, community.toString());
    // Without the sales office and the listing widget this is not a selling community's page (a sold-out one keeps the map and drops both).
    if (!parsed || !parsed.record.street || !parsed.community) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.foreignPage) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // The homes: the site's own listing query for the widget's community name, whole or held.
    const homesUrl = empireListingUrl(parsed.community, "homes");
    const homesBody = await getDocument(homesUrl, fetcher, "application/json", EMPIRE_HOST);
    if (!homesBody.ok) return failedResult(config, fetchedAt, privateSnapshot, [homesBody.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("inventory", homesUrl, null));
    const listing = parseEmpireListing(homesBody.text);
    if (!listing) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if ((listing.lastPage !== null && listing.lastPage > 1) || (listing.total !== null && listing.total !== listing.rows.length) || listing.rows.length > EMPIRE_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const { homes, foreignHome } = empireHomes(listing, community.toString(), parsed.record, now());
    if (foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // The page's own cards are the listing's first page: a card the listing lacks means the two disagree.
    if (parsed.cardUrls.some((url) => !homes.some((home) => home.sourceUrl === url))) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    let plans: PrivatePlanOrHome[] = [];
    if (parsed.hasPlansWidget) {
      const plansUrl = empireListingUrl(parsed.community, "plans");
      const plansBody = await getDocument(plansUrl, fetcher, "application/json", EMPIRE_HOST);
      if (!plansBody.ok) return failedResult(config, fetchedAt, privateSnapshot, [plansBody.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
      privateSnapshot.pages.push(sourcePage("inventory", plansUrl, null));
      const planListing = parseEmpireListing(plansBody.text);
      if (!planListing) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
      if ((planListing.lastPage !== null && planListing.lastPage > 1) || (planListing.total !== null && planListing.total !== planListing.rows.length)) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
      const read = empirePlans(planListing, community.toString());
      if (read.foreignPlan) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
      plans = read.plans;
    }
    const facts = parseCommunityFacts(page.text);
    const prices = [...homes.map((home) => home.price), ...plans.map((plan) => plan.price)].filter((price): price is number => price !== null && price >= 50_000);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? (prices.length ? Math.min(...prices) : null) };
    for (const home of homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    // The market's promotion: the page's banner with the campaign page's footnote; a banner whose footnote cannot be read holds the offer only.
    const incentiveHolds: DealHoldReason[] = [];
    if (parsed.promo) {
      let footnote: string | null = null;
      if (parsed.campaignUrl) {
        const campaign = await getDocument(parsed.campaignUrl, fetcher, "text/html,application/xhtml+xml", EMPIRE_HOST);
        footnote = campaign.ok ? parseEmpireCampaign(campaign.text) : null;
        if (campaign.ok) privateSnapshot.pages.push(sourcePage("incentive", parsed.campaignUrl, null));
      }
      if (!footnote) incentiveHolds.push("expected_incentive_container_not_found");
      else {
        const text = `${parsed.promo} ${footnote}`.slice(0, 6_000);
        privateSnapshot.incentive = { sourceUrl: parsed.campaignUrl ?? community.toString(), text, facts: parsePromotionalRate(text) };
      }
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
  }
}
