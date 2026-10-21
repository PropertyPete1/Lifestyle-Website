import {
  asUrl, decodeHtmlEntities, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, looksLikeStreetAddress, makePublicSnapshot, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  NMLS_ID_PATTERN_ALL, type AdapterRunOptions, type BuilderId, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * NDG-PLATFORM reader, shared by DRB Homes and Legend Homes (the same
 * builder-website platform: an Angular app shell whose content comes from
 * the builder's own public JSON API, no key, plain GET, which the page itself
 * calls). Each brand supplies its hosts, its market listing, how a community
 * page URL resolves to the API's lookup, and how a listing row names its
 * page. The API shape (DRB's paths; Legend's differ only in the lookup):
 * - `/api/v1/public/community/state/region/by-name?state=texas&region=san-antonio&name=<slug>`
 *   → `{ id }` (HTTP 400 "No community with such name" otherwise);
 * - `/api/v1/public-drb/community/<id>` → the community (`name`, `address
 *   {address1, city, zip, latitude, longitude}`, `salesOfficePhone`,
 *   `priceFrom`, `communityAvailabilityRef.name` "Active" | "Closeout" |
 *   "ComingSoon", `moveInNowHomesCount`, `plansCount`, `brand`);
 * - `/api/v1/public/community/<id>/move-in-homes?page=1&limit=1000` →
 *   `{ items[], meta.totalItems }`: homes with `communityId`, `address`,
 *   `homesite` "12.19", `price`, `originalPrice` (0 = none), `salesStatus`
 *   "available" | "sold", `availabilityDate` "2026-09-22", `isModel`,
 *   `displayInventory`, `planName`, `beds`, `fullBaths`, `halfBaths`, `sqFt`,
 *   `garageSpaces`, `images[] {url, type}`;
 * - `/api/v1/public/community/<id>/plans?page=1&limit=1000` → plans with
 *   `name`, `basePrice`, `communityPlanSalesStatus`, `status`, `bedsMin`,
 *   `bathsFullMin`, `bathsHalfMin`, `sqFtMin`, `garageSpacesMin`, `images[]`;
 * - `/api/v1/public/offers-v2/by-community/<id>` → offers with
 *   `content.titleOne`/`copyOne`/`disclaimer` (the public copy; `title` and
 *   `description` are the back office's own names and notes), `status`,
 *   `displayFrom`, `displayThrough`.
 * The page labels a home "Available Now" once `availabilityDate` has passed
 * and "Available <Month YYYY>" otherwise. A home's page is
 * `/…/<community slug>/quick-move-in-homes/<street slug>-<homesite digits>`,
 * a plan's `/…/<community slug>/home-plans/<plan slug>`. Photos sit on the
 * brand's asset host. Read-only, official hosts only. Everything here is
 * private operational data; the API rows carry staff names, e-mails and
 * audit fields that are never read.
 */
/** A community with more homes for sale than this is held, never truncated. */
export const NDG_MAX_HOMES = 150;

export type NdgBrand = {
  builder: Exclude<BuilderId, "Manual">;
  /** The public site (the configured community URLs). */
  host: string;
  /** The builder's API. */
  apiHost: string;
  /** The builder's photo host. */
  assetHost: string;
  /** The market's community list on the API. */
  listingUrl: () => string;
  /** A community page URL → the API lookup path (relative to /api/v1/) that resolves it to an id, and the canonical page; null for any other page. */
  parsePath: (url: URL) => { lookup: string; page: string; slug: string } | null;
  /** A listing row's community page on the site; null when the row cannot name one. */
  pageUrlFor: (row: Record<string, unknown>) => string | null;
  /** The site's URL slug for a street or plan name. */
  slug: (value: string) => string;
};
export const ndgApiUrl = (brand: NdgBrand, path: string) => `https://${brand.apiHost}/api/v1/${path}`;

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
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A JSON body; null when it is not JSON. */
function parseJson(body: string): unknown {
  try { return JSON.parse(body); } catch { return null; }
}

/**
 * "available" with a date that has passed (or none) is ready now, as the
 * site's "Available Now" says; a future date names its month. "sold" sells;
 * "contract_pending" and "reserved" are Pending (left out, not held). Other
 * wording, or none, gives no status (the run is held).
 */
export function ndgStatus(salesStatus: string | null, availabilityDate: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const label = (salesStatus ?? "").replace(/[\s_-]+/g, " ").trim().toLowerCase();
  if (!label) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under contract/.test(label)) return { status: "Sold", readyNow: false, moveInDate: null };
  // A home under a pending contract or reserved is not for sale today and not sold: the sync leaves it out.
  if (/\bpending\b|\breserved\b/.test(label)) return { status: "Pending", readyNow: false, moveInDate: null };
  if (label !== "available") return { status: null, readyNow: false, moveInDate: null };
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(availabilityDate ?? "");
  const year = iso ? Number(iso[1]) : null;
  const month = iso ? Number(iso[2]) : null;
  const valid = year !== null && month !== null && month >= 1 && month <= 12 && year >= 2000 && year <= now.getUTCFullYear() + 5;
  if (!valid) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  if (Date.UTC(year!, month! - 1, Number(iso![3])) <= now.getTime()) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const name = `${MONTHS[month! - 1]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type NdgCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

function geoOf(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = num(lat);
  const b = num(lng);
  return a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (a !== 0 || b !== 0) ? { lat: a, lng: b } : null;
}

/** The community's record from an API community row; null without a name. */
export function ndgRecord(row: Json): NdgCommunityRecord | null {
  const name = str(row.name);
  if (!name) return null;
  const address = obj(row.address);
  const street = str(address?.address1);
  const price = num(row.priceFrom);
  return {
    name,
    street: looksLikeStreetAddress(street) ? street : null,
    city: str(address?.city),
    zip: /^\d{5}/.exec(str(address?.zip) ?? "")?.[0] ?? null,
    phone: (str(row.salesOfficePhone) ?? str(row.callTrackingNumber) ?? "").replace(/[^\d]/g, "") || null,
    priceFrom: price && price > 0 ? price : null,
    geo: geoOf(address?.latitude, address?.longitude),
  };
}

export type NdgCommunity = { id: number; record: NdgCommunityRecord | null; availability: string | null; brand: string | null; moveInNowCount: number | null; plansCount: number | null };

/** The community row's facts; null when the body is not a community. */
export function parseNdgCommunity(body: string): NdgCommunity | null {
  const row = obj(parseJson(body));
  const id = num(row?.id);
  if (!row || id === null || !Number.isInteger(id)) return null;
  return {
    id,
    record: ndgRecord(row),
    availability: str(obj(row.communityAvailabilityRef)?.name) ?? str(obj(row.communityAvailabilityRef)?.label),
    brand: str(row.brand),
    moveInNowCount: num(row.moveInNowHomesCount),
    plansCount: num(row.plansCount),
  };
}

function photo(raw: unknown, assetHost: string): PrivateGalleryImage | null {
  const item = obj(raw);
  const link = item ? str(item.url) : null;
  const url = link ? asUrl(link) : null;
  if (!item || !url || url.protocol !== "https:" || url.hostname.toLowerCase() !== assetHost || /floor\s*plan|floorplan|site\s*plan|siteplan|\.pdf$|\.svg$/i.test(`${str(item.type) ?? ""} ${url.pathname}`)) return null;
  url.search = "";
  return { sourceUrl: url.toString(), caption: str(item.title) ?? str(item.caption), width: null, height: null, srcSet: null };
}

function gallery(assetHost: string, ...sources: unknown[]): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const raw of arr(source)) {
      const image = photo(raw, assetHost);
      if (!image || seen.has(image.sourceUrl)) continue;
      seen.add(image.sourceUrl);
      out.push(image);
    }
  }
  return out;
}

export type NdgHomes = { homes: PrivatePlanOrHome[]; /** Rows in the body, hidden ones included. */ listed: number; /** The API's own count of rows. */ total: number | null; foreignHome: boolean };

/** The community's homes for sale from the move-in-homes body; null when the body is not the list. */
export function parseNdgHomes(brand: NdgBrand, body: string, communityId: number, communityPage: string, record: NdgCommunityRecord | null, now: Date): NdgHomes | null {
  const data = obj(parseJson(body));
  const items = data ? data.items : null;
  if (!Array.isArray(items)) return null;
  const base = communityPage.replace(/\/+$/, "");
  const homes: PrivatePlanOrHome[] = [];
  let foreignHome = false;
  for (const raw of items) {
    const home = obj(raw);
    if (!home) continue;
    // A home filed under another community is never this one's inventory.
    if (num(home.communityId) !== communityId) { foreignHome = true; continue; }
    // A home the site does not display is not on the page the visitor sees.
    if (home.displayInventory === false) continue;
    const address = obj(home.address);
    const street = str(address?.address1);
    const readable = looksLikeStreetAddress(street);
    const city = str(address?.city) ?? record?.city ?? null;
    const zip = /^\d{5}/.exec(str(address?.zip) ?? "")?.[0] ?? record?.zip ?? null;
    const status = ndgStatus(str(home.salesStatus), str(home.availabilityDate), now);
    const price = num(home.price);
    const original = num(home.originalPrice);
    const full = num(home.fullBaths);
    const homesite = str(home.homesite);
    const homesiteDigits = (homesite ?? "").replace(/\D/g, "");
    const geo = geoOf(address?.latitude, address?.longitude);
    homes.push({
      sourceUrl: readable ? `${base}/quick-move-in-homes/${brand.slug(street)}${homesiteDigits ? `-${homesiteDigits}` : ""}` : `${base}/unreadable-${homes.length}`,
      privateName: street,
      privateAddress: street ? `${street}, ${city ? `${city}, ${zip ? `TX ${zip}` : "TX"}` : "TX"}` : null,
      privatePlanName: str(home.planName),
      // A model home is not for sale (the sync leaves a "Model" home out).
      status: !readable ? null : home.isModel === true ? "Model" : status.status,
      price: price && price > 0 ? price : null,
      previousPrice: original && price && original > price ? original : null,
      priceDrop: original && price && original > price ? original - price : null,
      bedrooms: num(home.beds),
      bathrooms: full === null ? null : full + (num(home.halfBaths) ?? 0) * 0.5,
      squareFeet: num(home.sqFt),
      garage: num(home.garageSpaces),
      homesite: homesite ? `Homesite ${homesite}` : null,
      readyNow: home.isModel === true ? false : status.readyNow,
      moveInDate: home.isModel === true ? null : status.moveInDate,
      geo: geo ? { latitude: geo.lat, longitude: geo.lng } : null,
      gallery: gallery(brand.assetHost, home.images, home.exteriorImages, home.interiorImages),
    });
  }
  return { homes, listed: items.length, total: num(obj(data!.meta)?.totalItems), foreignHome };
}

/** The community's plans from the plans body (only those selling); null when the body is not the list. */
export function parseNdgPlans(brand: NdgBrand, body: string, communityPage: string): PrivatePlanOrHome[] | null {
  const data = obj(parseJson(body));
  const items = data ? data.items : null;
  if (!Array.isArray(items)) return null;
  const base = communityPage.replace(/\/+$/, "");
  const plans: PrivatePlanOrHome[] = [];
  for (const raw of items) {
    const plan = obj(raw);
    const name = plan ? str(plan.name) : null;
    if (!plan || !name) continue;
    if (!/^active$/i.test(str(plan.status) ?? "active") || !/^available$/i.test((str(plan.communityPlanSalesStatus) ?? "available").replace(/[_-]/g, " ")) || plan.isModel === true) continue;
    const price = num(plan.basePrice);
    const full = num(plan.bathsFullMin) ?? num(plan.bathsMin);
    plans.push({
      sourceUrl: `${base}/home-plans/${brand.slug(name)}`,
      privateName: name,
      privatePlanName: name,
      status: null,
      price: price && price > 0 ? price : null,
      bedrooms: num(plan.bedsMin),
      bathrooms: full === null ? null : full + (num(plan.bathsHalfMin) ?? 0) * 0.5,
      squareFeet: num(plan.sqFtMin),
      garage: num(plan.garageSpacesMin),
      readyNow: false,
      gallery: gallery(brand.assetHost, plan.images, plan.elevationImages).map((image) => ({ ...image, caption: "Representative image" })),
    });
  }
  return plans;
}

/** Links, phone numbers, NMLS ids and e-mail addresses go; a sentence that only pointed at them goes with them. */
function cleanOfferText(value: string): string {
  return htmlToText(value)
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/\(?\b\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, " ")
    .replace(NMLS_ID_PATTERN_ALL, " ")
    .replace(/\*+/g, "")
    .replace(/(?:^|(?<=[.!?]\s))(?:Call|Visit|Click|Contact)(?:\s+(?:us|here|a\s+sales\s+\w+))?(?:\s+or\s+(?:call|visit|click)(?:\s+(?:us|here))?)?\s*(?:for\s+details|to\s+learn\s+more|today)?\s*\.?(?=\s|$)/gi, " ")
    .replace(/\s+([,.;:!?])/g, "$1").replace(/(?:\s*\.){2,}/g, ".").replace(/^[\s.,;:]+/, "").replace(/\s+/g, " ").trim();
}

/** The community's current offer from the offers body as one text, or null when there is none; "unreadable" when the body is not the list. */
export function parseNdgOffer(body: string, now: Date): string | null | "unreadable" {
  const items = parseJson(body);
  if (!Array.isArray(items)) return "unreadable";
  const today = now.toISOString().slice(0, 10);
  const current = items.map(obj).filter((offer): offer is Json => offer !== null).filter((offer) => {
    const status = (str(offer.status) ?? "active").toLowerCase();
    const from = str(offer.displayFrom)?.slice(0, 10);
    const through = str(offer.displayThrough)?.slice(0, 10);
    return status === "active" && (!from || from <= today) && (!through || through >= today);
  }).map((offer) => {
    // The public copy is the content block; `title` and `description` are the back office's own names and notes ("Open Door Deal_InPage"), used only when the block says nothing.
    const content = obj(offer.content);
    const copy = [str(content?.titleOne), str(content?.copyOne), str(content?.titleTwo), str(content?.copyTwo)].filter((part): part is string => Boolean(part));
    // An offer with a content block that says nothing (an image-only popup, with or without a disclaimer) is no text; one without a block is its title and description.
    const parts = (content ? (copy.length ? [...copy, str(content.disclaimer)] : []) : [str(offer.title), str(offer.description)]).filter((part): part is string => Boolean(part)).map(cleanOfferText).filter(Boolean);
    return parts.map((part) => /[.!?]$/.test(part) ? part : `${part}.`).join(" ");
  }).filter(Boolean);
  if (!current.length) return null;
  // One offer only: joining two would publish one's deadline or terms as the other's.
  return current.find((text) => /\d+(?:\.\d+)?\s*%\s*(?:\(|\/|APR|interest|rate|fixed)/i.test(text)) ?? current[0]!;
}

/** The market list's communities with their records; null when the body is not the list. Each entry's page is the one the brand names for the row. */
export function ndgListingEntries(brand: NdgBrand, body: string, host: string): Array<{ url: string; record: NdgCommunityRecord | null }> | null {
  const data = obj(parseJson(body));
  const items = data ? data.items : null;
  if (!Array.isArray(items)) return null;
  const out = new Map<string, { url: string; record: NdgCommunityRecord | null }>();
  for (const raw of items) {
    const row = obj(raw);
    const record = row ? ndgRecord(row) : null;
    const availability = row ? str(obj(row.communityAvailabilityRef)?.name) : null;
    // A coming-soon community has no inventory page worth syncing yet.
    if (!row || !record || (availability && /coming\s*soon/i.test(availability))) continue;
    const page = brand.pageUrlFor(row);
    const url = page ? asUrl(page) : null;
    if (!url || !sameOfficialHost(url, host) || out.has(url.toString())) continue;
    out.set(url.toString(), { url: url.toString(), record });
  }
  return Array.from(out.values());
}

export class NdgAdapter implements DealAdapter {
  readonly builder: Exclude<BuilderId, "Manual">;
  constructor(private readonly brand: NdgBrand) { this.builder = brand.builder; }

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const brand = this.brand;
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, brand.host)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const path = brand.parsePath(community);
    if (!path) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    const communityPage = path.page;
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const api = async (relative: string) => getDocument(ndgApiUrl(brand, relative), fetcher, "application/json", brand.apiHost);
    privateSnapshot.pages.push(sourcePage("community", communityPage, config.privateCommunityName));
    // The slug resolves to the community's id, as the page itself resolves it (HTTP 400 is "no such community"; 401/403 is the builder refusing the reader; anything else — a server error, a timeout, a 404 or 429 — is a failed read).
    const lookup = await getDocument(ndgApiUrl(brand, path.lookup), fetcher, "application/json", brand.apiHost);
    if (!lookup.ok) return failedResult(config, fetchedAt, privateSnapshot, [lookup.status === 400 && !lookup.redirectedOffOfficialHost ? "expected_community_container_not_found" : fetchFailureHold(lookup, "community_fetch_failed")]);
    const id = num(obj(parseJson(lookup.text))?.id);
    if (id === null || !Number.isInteger(id) || id <= 0) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    const detail = await api(`public-drb/community/${id}`);
    if (!detail.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(detail, "community_fetch_failed")]);
    const parsed = parseNdgCommunity(detail.text);
    // The row must be this community, with its name and sales address.
    if (!parsed || parsed.id !== id || !parsed.record) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The API says how the community is selling; wording the reader does not know is not read as a selling community.
    if (parsed.availability && !/^(?:active|current|close\s*out|coming\s*soon|sold\s*out|grand\s*opening|now\s*selling)$/i.test(parsed.availability)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    const [homesBody, plansBody, offersBody] = await Promise.all([
      api(`public/community/${id}/move-in-homes?page=1&limit=1000`),
      api(`public/community/${id}/plans?page=1&limit=1000`),
      api(`public/offers-v2/by-community/${id}`),
    ]);
    if (!homesBody.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(homesBody, "community_fetch_failed")]);
    const homes = parseNdgHomes(brand, homesBody.text, id, communityPage, parsed.record, now());
    if (!homes) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (homes.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // The list must be whole: the API's own total, and the community's count of move-in-ready homes, never exceed it.
    if (homes.homes.length > NDG_MAX_HOMES || (homes.total !== null && homes.listed < homes.total) || (parsed.moveInNowCount !== null && homes.homes.length < parsed.moveInNowCount)) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    if (!plansBody.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(plansBody, "community_fetch_failed")]);
    const plans = parseNdgPlans(brand, plansBody.text, communityPage);
    if (!plans) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    privateSnapshot.communityFacts = { fromPrice: parsed.record.priceFrom && parsed.record.priceFrom >= 50_000 ? parsed.record.priceFrom : null, schoolDistrict: null, lotSizes: null, amenities: [] };
    const incentiveHolds: DealHoldReason[] = [];
    // A sold-out community has nothing to publish.
    if (!/sold\s*out/i.test(parsed.availability ?? "")) {
      for (const home of homes.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
      for (const plan of plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
      if (!offersBody.ok) incentiveHolds.push(offersBody.redirectedOffOfficialHost ? "unsupported_official_host" : "incentive_fetch_failed");
      else {
        const offer = parseNdgOffer(offersBody.text, now());
        if (offer === "unreadable") incentiveHolds.push("expected_incentive_container_not_found");
        else privateSnapshot.offerRead = true;
        if (offer && offer !== "unreadable") {
          privateSnapshot.pages.push(sourcePage("incentive", ndgApiUrl(brand, `public/offers-v2/by-community/${id}`), null));
          privateSnapshot.incentive = { sourceUrl: communityPage, text: offer, facts: parsePromotionalRate(offer) };
        }
      }
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
  }
}
