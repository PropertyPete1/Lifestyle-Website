import {
  DRB_HOST, asUrl, decodeHtmlEntities, emptyPrivate, failedResult, getDocument, htmlToText, looksLikeStreetAddress, makePublicSnapshot, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  NMLS_ID_PATTERN_ALL, type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * DRB HOMES reader. The site is a client-rendered Angular app; every page is
 * the same shell, and the content comes from the builder's own public JSON
 * API on `api.drbhomes.com` (no key, plain GET), which the page itself calls:
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
 * - `/api/v1/public/offers-v2/by-community/<id>` → offers with `title`,
 *   `description`, `status`, `displayFrom`, `displayThrough`,
 *   `content.disclaimer`.
 * The page labels a home "Available Now" once `availabilityDate` has passed
 * and "Available <Month YYYY>" otherwise. A home's page is
 * `/…/<community slug>/quick-move-in-homes/<street slug>-<homesite digits>`,
 * a plan's `/…/<community slug>/home-plans/<plan slug>`. Photos sit on
 * `assets.drbhomes.com`. Read-only, official hosts only. Everything here is
 * private operational data; the API rows carry staff names, e-mails and
 * audit fields that are never read.
 *
 * Page shapes (October 2026):
 * - market:    /drbhomes/find-your-home/communities/texas/san-antonio
 * - community: /drbhomes/find-your-home/communities/texas/san-antonio/<slug>[/overview|/home-plans|/quick-move-in-homes]
 */
/** A community with more homes for sale than this is held, never truncated. */
export const DRB_MAX_HOMES = 150;
export const DRB_API_HOST = "api.drbhomes.com";
export const DRB_ASSET_HOST = "assets.drbhomes.com";
export const DRB_REGION = { state: "texas", region: "san-antonio", searchValue: "San Antonio" };
export const drbApiUrl = (path: string) => `https://${DRB_API_HOST}/api/v1/${path}`;
export const drbListingUrl = () => drbApiUrl(`public-drb/community?searchField=communityRegion&searchValue=${encodeURIComponent(DRB_REGION.searchValue)}&state=${DRB_REGION.state}&region=${DRB_REGION.region}&page=1&limit=1000`);
export const drbCommunityPageUrl = (slug: string) => `https://${DRB_HOST}/drbhomes/find-your-home/communities/${DRB_REGION.state}/${DRB_REGION.region}/${slug}`;
const COMMUNITY_PATH = /^\/drbhomes\/find-your-home\/communities\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/(?:overview|home-plans|quick-move-in-homes|homesites))?\/?$/i;

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

/** The site's own URL slug for a community, plan or street: lower case, punctuation dropped, each space a hyphen ("Meyer Ranch – Premier" is "meyer-ranch--premier"). */
export function drbSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s/g, "-");
}

/** The state, region and community slug of a community page URL on the official host; null for any other page. */
export function drbCommunityPath(url: URL): { state: string; region: string; slug: string } | null {
  const match = COMMUNITY_PATH.exec(url.pathname);
  return match ? { state: match[1]!.toLowerCase(), region: match[2]!.toLowerCase(), slug: match[3]!.toLowerCase() } : null;
}

/** A JSON body; null when it is not JSON. */
function parseJson(body: string): unknown {
  try { return JSON.parse(body); } catch { return null; }
}

/**
 * "available" with a date that has passed (or none) is ready now, as the
 * site's "Available Now" says; a future date names its month. "sold" sells.
 * Other wording, or none, gives no status (the run is held).
 */
export function drbStatus(salesStatus: string | null, availabilityDate: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const label = (salesStatus ?? "").replace(/[\s_-]+/g, " ").trim().toLowerCase();
  if (!label) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under contract/.test(label)) return { status: "Sold", readyNow: false, moveInDate: null };
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

export type DrbCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

function geoOf(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = num(lat);
  const b = num(lng);
  return a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (a !== 0 || b !== 0) ? { lat: a, lng: b } : null;
}

/** The community's record from an API community row; null without a name. */
export function drbRecord(row: Json): DrbCommunityRecord | null {
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

export type DrbCommunity = { id: number; record: DrbCommunityRecord | null; availability: string | null; brand: string | null; moveInNowCount: number | null; plansCount: number | null };

/** The community row's facts; null when the body is not a community. */
export function parseDrbCommunity(body: string): DrbCommunity | null {
  const row = obj(parseJson(body));
  const id = num(row?.id);
  if (!row || id === null || !Number.isInteger(id)) return null;
  return {
    id,
    record: drbRecord(row),
    availability: str(obj(row.communityAvailabilityRef)?.name) ?? str(obj(row.communityAvailabilityRef)?.label),
    brand: str(row.brand),
    moveInNowCount: num(row.moveInNowHomesCount),
    plansCount: num(row.plansCount),
  };
}

function photo(raw: unknown): PrivateGalleryImage | null {
  const item = obj(raw);
  const link = item ? str(item.url) : null;
  const url = link ? asUrl(link) : null;
  if (!item || !url || url.protocol !== "https:" || url.hostname.toLowerCase() !== DRB_ASSET_HOST || /floor\s*plan|floorplan|site\s*plan|siteplan|\.pdf$|\.svg$/i.test(`${str(item.type) ?? ""} ${url.pathname}`)) return null;
  url.search = "";
  return { sourceUrl: url.toString(), caption: str(item.title) ?? str(item.caption), width: null, height: null, srcSet: null };
}

function gallery(...sources: unknown[]): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const raw of arr(source)) {
      const image = photo(raw);
      if (!image || seen.has(image.sourceUrl)) continue;
      seen.add(image.sourceUrl);
      out.push(image);
    }
  }
  return out;
}

export type DrbHomes = { homes: PrivatePlanOrHome[]; /** Rows in the body, hidden ones included. */ listed: number; /** The API's own count of rows. */ total: number | null; foreignHome: boolean };

/** The community's homes for sale from the move-in-homes body; null when the body is not the list. */
export function parseDrbHomes(body: string, communityId: number, communityPage: string, record: DrbCommunityRecord | null, now: Date): DrbHomes | null {
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
    const status = drbStatus(str(home.salesStatus), str(home.availabilityDate), now);
    const price = num(home.price);
    const original = num(home.originalPrice);
    const full = num(home.fullBaths);
    const homesite = str(home.homesite);
    const homesiteDigits = (homesite ?? "").replace(/\D/g, "");
    const geo = geoOf(address?.latitude, address?.longitude);
    homes.push({
      sourceUrl: readable ? `${base}/quick-move-in-homes/${drbSlug(street)}${homesiteDigits ? `-${homesiteDigits}` : ""}` : `${base}/unreadable-${homes.length}`,
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
      gallery: gallery(home.images, home.exteriorImages, home.interiorImages),
    });
  }
  return { homes, listed: items.length, total: num(obj(data!.meta)?.totalItems), foreignHome };
}

/** The community's plans from the plans body (only those selling); null when the body is not the list. */
export function parseDrbPlans(body: string, communityPage: string): PrivatePlanOrHome[] | null {
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
      sourceUrl: `${base}/home-plans/${drbSlug(name)}`,
      privateName: name,
      privatePlanName: name,
      status: null,
      price: price && price > 0 ? price : null,
      bedrooms: num(plan.bedsMin),
      bathrooms: full === null ? null : full + (num(plan.bathsHalfMin) ?? 0) * 0.5,
      squareFeet: num(plan.sqFtMin),
      garage: num(plan.garageSpacesMin),
      readyNow: false,
      gallery: gallery(plan.images, plan.elevationImages).map((image) => ({ ...image, caption: "Representative image" })),
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
export function parseDrbOffer(body: string, now: Date): string | null | "unreadable" {
  const items = parseJson(body);
  if (!Array.isArray(items)) return "unreadable";
  const today = now.toISOString().slice(0, 10);
  const current = items.map(obj).filter((offer): offer is Json => offer !== null).filter((offer) => {
    const status = (str(offer.status) ?? "active").toLowerCase();
    const from = str(offer.displayFrom)?.slice(0, 10);
    const through = str(offer.displayThrough)?.slice(0, 10);
    return status === "active" && (!from || from <= today) && (!through || through >= today);
  }).map((offer) => {
    const parts = [str(offer.title), str(offer.description), str(obj(offer.content)?.disclaimer)].filter((part): part is string => Boolean(part)).map(cleanOfferText).filter(Boolean);
    return parts.map((part) => /[.!?]$/.test(part) ? part : `${part}.`).join(" ");
  }).filter(Boolean);
  if (!current.length) return null;
  // One offer only: joining two would publish one's deadline or terms as the other's.
  return current.find((text) => /\d+(?:\.\d+)?\s*%\s*(?:\(|\/|APR|interest|rate|fixed)/i.test(text)) ?? current[0]!;
}

/** The market list's communities with their records; null when the body is not the list. Each entry's page is the community's slug under the market. */
export function drbListingEntries(body: string, host: string): Array<{ url: string; record: DrbCommunityRecord | null }> | null {
  const data = obj(parseJson(body));
  const items = data ? data.items : null;
  if (!Array.isArray(items)) return null;
  const out = new Map<string, { url: string; record: DrbCommunityRecord | null }>();
  for (const raw of items) {
    const row = obj(raw);
    const record = row ? drbRecord(row) : null;
    const availability = row ? str(obj(row.communityAvailabilityRef)?.name) : null;
    // A coming-soon community has no inventory page worth syncing yet.
    if (!row || !record || (availability && /coming\s*soon/i.test(availability))) continue;
    const url = asUrl(drbCommunityPageUrl(drbSlug(record.name)));
    if (!url || !sameOfficialHost(url, host) || out.has(url.toString())) continue;
    out.set(url.toString(), { url: url.toString(), record });
  }
  return Array.from(out.values());
}

export class DrbHomesAdapter implements DealAdapter {
  readonly builder = "DRB Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, DRB_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const path = drbCommunityPath(community);
    if (!path) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    const communityPage = `${community.origin}/drbhomes/find-your-home/communities/${path.state}/${path.region}/${path.slug}`;
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const api = async (relative: string) => getDocument(drbApiUrl(relative), fetcher, "application/json", DRB_API_HOST);
    privateSnapshot.pages.push(sourcePage("community", communityPage, config.privateCommunityName));
    // The slug resolves to the community's id, as the page itself resolves it.
    const lookup = await api(`public/community/state/region/by-name?state=${encodeURIComponent(path.state)}&region=${encodeURIComponent(path.region)}&name=${encodeURIComponent(path.slug)}`);
    if (!lookup.ok) return failedResult(config, fetchedAt, privateSnapshot, [lookup.redirectedOffOfficialHost ? "unsupported_official_host" : "expected_community_container_not_found"]);
    const id = num(obj(parseJson(lookup.text))?.id);
    if (id === null || !Number.isInteger(id) || id <= 0) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    const detail = await api(`public-drb/community/${id}`);
    if (!detail.ok) return failedResult(config, fetchedAt, privateSnapshot, [detail.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    const parsed = parseDrbCommunity(detail.text);
    // The row must be this community, with its name and sales address.
    if (!parsed || parsed.id !== id || !parsed.record) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The API says how the community is selling; wording the reader does not know is not read as a selling community.
    if (parsed.availability && !/^(?:active|current|close\s*out|coming\s*soon|sold\s*out|grand\s*opening|now\s*selling)$/i.test(parsed.availability)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    const [homesBody, plansBody, offersBody] = await Promise.all([
      api(`public/community/${id}/move-in-homes?page=1&limit=1000`),
      api(`public/community/${id}/plans?page=1&limit=1000`),
      api(`public/offers-v2/by-community/${id}`),
    ]);
    if (!homesBody.ok) return failedResult(config, fetchedAt, privateSnapshot, [homesBody.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    const homes = parseDrbHomes(homesBody.text, id, communityPage, parsed.record, now());
    if (!homes) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (homes.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // The list must be whole: the API's own total, and the community's count of move-in-ready homes, never exceed it.
    if (homes.homes.length > DRB_MAX_HOMES || (homes.total !== null && homes.listed < homes.total) || (parsed.moveInNowCount !== null && homes.homes.length < parsed.moveInNowCount)) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    if (!plansBody.ok) return failedResult(config, fetchedAt, privateSnapshot, [plansBody.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    const plans = parseDrbPlans(plansBody.text, communityPage);
    if (!plans) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    privateSnapshot.communityFacts = { fromPrice: parsed.record.priceFrom && parsed.record.priceFrom >= 50_000 ? parsed.record.priceFrom : null, schoolDistrict: null, lotSizes: null, amenities: [] };
    const incentiveHolds: DealHoldReason[] = [];
    // A sold-out community has nothing to publish.
    if (!/sold\s*out/i.test(parsed.availability ?? "")) {
      for (const home of homes.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
      for (const plan of plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
      if (!offersBody.ok) incentiveHolds.push(offersBody.redirectedOffOfficialHost ? "unsupported_official_host" : "incentive_fetch_failed");
      else {
        const offer = parseDrbOffer(offersBody.text, now());
        if (offer === "unreadable") incentiveHolds.push("expected_incentive_container_not_found");
        else if (offer) {
          privateSnapshot.pages.push(sourcePage("incentive", drbApiUrl(`public/offers-v2/by-community/${id}`), null));
          privateSnapshot.incentive = { sourceUrl: communityPage, text: offer, facts: parsePromotionalRate(offer) };
        }
      }
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
  }
}
