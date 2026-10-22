import {
  LENNAR_HOST, asUrl, comparablePath, decodeHtmlEntities, emptyPrivate, failedResult, fetchFailureHold, getDocument, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * LENNAR reader (www.lennar.com, a Next.js pages-router site). The community
 * page `/new-homes/texas/san-antonio/<city>/<slug>` carries its data in the
 * `<script id="__NEXT_DATA__">` JSON: `props.pageProps.initialApolloState`
 * is a normalized Apollo cache keyed `<__typename>:<id>` whose objects link
 * with `{ __ref }`. On a community page the cache holds:
 *
 * - the masterplan (`MpcType`: name, url, latitude/longitude, status,
 *   customPrice "$254,999 - $313,499" (or "Coming soon"), `city` → CityType
 *   (name), `consultants.phoneNumber`, `communities[]` → CommunityType);
 * - its collections (`CommunityType`: name "Eventide Collection", url
 *   (`<page>/<collection>`), address (the sales office's street; an
 *   intersection for a community without a model yet), zipCode, priceRange
 *   [min, max], status, `soAddress`/`soCityName`/`soZipCode` (a sales office
 *   elsewhere), `plans[]` → PlanType, homesitesCount (the lot count, never
 *   the homes for sale));
 * - the plans (`PlanType`: name, url (`<collection>/<plan>`), beds, baths,
 *   halfBaths, sqft, startingPrice, status, `homesites[]` → HomesiteType,
 *   `elevationImages({"first":1})[].image.url` on cdn.lennar.com);
 * - the homes for sale (`HomesiteType`: url (`<plan>/<lot id>`), address,
 *   number (the homesite), price, wasPrice (a cut price's previous figure),
 *   status MOVE_IN_READY | UNDER_CONSTRUCTION | COMING_SOON | SOLD, beds,
 *   baths, halfBaths, sqft, latitude/longitude, `elevationImage.image.url`,
 *   `plan` → PlanType). The page's homesite table heading ("36 homes
 *   available" / "No homes available") corroborates the count.
 * - a corporate banner (`MessageV3Type`, "Limited-Time Deals on New Homes")
 *   whose offer page names no figure or term: Lennar's deals are the per-home
 *   price cuts, carried as each home's previous price; there is no incentive.
 * The market page `/new-homes/texas/san-antonio` holds the same cache for
 * every masterplan in the market (name, URL, pin, city, price range and each
 * collection's street and ZIP), so discovery reads no community page. Lubbock's
 * Copper Creek lists under this market; the 45-mile rule leaves it out.
 * Read-only, plain GET, official host only. Everything here is private
 * operational data.
 */
/** A community with more homes for sale than this is held, never truncated. */
export const LENNAR_MAX_HOMES = 150;
export const lennarListingUrl = () => `https://${LENNAR_HOST}/new-homes/texas/san-antonio`;
export const LENNAR_PHOTO_HOSTS = ["cdn.lennar.com"] as const;

type Json = Record<string, unknown>;
type Cache = Record<string, unknown>;
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
/** A cache row's link (a site-relative path or an absolute URL) against the page; null when it is not one. */
const linkOf = (value: unknown, base: URL | string): URL | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try { return asUrl(new URL(value.trim(), base).toString()); } catch { return null; }
};

/** The page's Next.js data (`props.pageProps`); null when the page carries none or it is not JSON. */
export function parseLennarNextData(html: string): Json | null {
  const match = /<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(match[1]!); } catch { return null; }
  return obj(obj(obj(parsed)?.props)?.pageProps);
}

/** The Apollo cache of a page's data; null when the data has none. */
export function lennarCache(pageProps: Json | null): Cache | null {
  const cache = obj(pageProps?.initialApolloState);
  return cache ? cache as Cache : null;
}

/** Follows `{ __ref: "<Type>:<id>" }` links (and arrays of them) into the cache; a plain value is itself. */
export function resolveLennarRef(cache: Cache, value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.map((item) => resolveLennarRef(cache, item, depth + 1));
  const record = obj(value);
  if (!record) return value;
  const ref = record.__ref;
  if (typeof ref === "string") return Object.prototype.hasOwnProperty.call(cache, ref) ? resolveLennarRef(cache, cache[ref], depth + 1) : null;
  return record;
}

/** Every cache object of a type, in cache order. */
export function lennarRows(cache: Cache, typename: string): Json[] {
  const prefix = `${typename}:`;
  return Object.keys(cache).filter((key) => key.startsWith(prefix)).map((key) => obj(cache[key])).filter((row): row is Json => row !== null);
}

/**
 * The home's status: a move-in-ready home is ready now, one under
 * construction is an undated quick move-in, a coming-soon or sold home is
 * named so (neither is published), anything else gives no status (the run
 * is held).
 */
export function lennarStatus(status: string | null): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const value = (status ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (value === "MOVE_IN_READY") return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  if (value === "UNDER_CONSTRUCTION") return { status: "Quick Move-In (Under Construction)", readyNow: false, moveInDate: null };
  if (value === "COMING_SOON") return { status: "Coming Soon", readyNow: false, moveInDate: null };
  if (value === "SOLD") return { status: "Sold", readyNow: false, moveInDate: null };
  return { status: null, readyNow: false, moveInDate: null };
}

export type LennarCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

const geoOf = (latitude: unknown, longitude: unknown): { lat: number; lng: number } | null => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
};
const phoneOf = (value: unknown): string | null => (str(value) ?? "").replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "").replace(/^(?!\d{10}$).*/, "") || null;
const zipOf = (value: unknown): string | null => /^\d{5}/.exec(str(value) ?? "")?.[0] ?? null;
/** The first figure of a "$254,999 - $313,499" price text; none for "Coming soon" or "From $261k". */
const customPriceFrom = (value: unknown): number | null => {
  const match = /\$\s*([\d,]{6,})/.exec(str(value) ?? "");
  return match ? positive(match[1]) : null;
};

/** The masterplan's collections (its CommunityType rows), in order. */
function collectionsOf(cache: Cache, mpc: Json): Json[] {
  return arr(resolveLennarRef(cache, mpc.communities)).map(obj).filter((row): row is Json => row !== null);
}

/** A masterplan's record: name, the first selling collection's sales office (its own, or an override elsewhere), the masterplan's phone, pin and lowest price. */
function recordOf(cache: Cache, mpc: Json): LennarCommunityRecord | null {
  const name = str(mpc.name);
  if (!name) return null;
  const city = str(obj(resolveLennarRef(cache, mpc.city))?.name);
  const collections = collectionsOf(cache, mpc);
  const office = collections.find((row) => str(row.soAddress) || str(row.address)) ?? null;
  const override = office ? str(office.soAddress) : null;
  const street = override ?? (office ? str(office.address) : null);
  const prices = collections.flatMap((row) => [positive(arr(row.priceRange)[0]), positive(row.basePrice)]).filter((price): price is number => price !== null);
  return {
    name,
    street: looksLikeStreetAddress(street) ? street : null,
    city: (override ? str(office?.soCityName) : null) ?? city,
    zip: (override ? zipOf(office?.soZipCode) : null) ?? (office ? zipOf(office.zipCode) : null),
    phone: phoneOf(obj(resolveLennarRef(cache, mpc.consultants))?.phoneNumber) ?? phoneOf(obj(resolveLennarRef(cache, office?.consultants))?.phoneNumber),
    priceFrom: prices.length ? Math.min(...prices) : customPriceFrom(mpc.customPrice),
    geo: geoOf(mpc.latitude, mpc.longitude),
  };
}

function photoUrl(value: unknown): string | null {
  const url = typeof value === "string" ? asUrl(decodeHtmlEntities(value)) : null;
  if (!url || url.protocol !== "https:" || !(LENNAR_PHOTO_HOSTS as readonly string[]).includes(url.hostname.toLowerCase()) || !/^\/api\/images\//i.test(url.pathname) || /floor\s*plan|floorplan|site\s*plan|\.pdf$|\.svg$/i.test(url.pathname)) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** The image URLs of title-image lists (`[{ image: { url } }]`) on the photo host, at most eight. */
function gallery(cache: Cache, lists: unknown[]): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  for (const list of lists) {
    const resolved = resolveLennarRef(cache, list);
    for (const item of Array.isArray(resolved) ? resolved : [resolved]) {
      const url = photoUrl(obj(resolveLennarRef(cache, obj(item)?.image))?.url);
      if (url && !out.some((image) => image.sourceUrl === url) && out.length < 8) out.push({ sourceUrl: url, caption: "Representative image", width: null, height: null, srcSet: null });
    }
  }
  return out;
}

/** The homesite table heading's count: "36 homes available" → 36, "No homes available" → 0, none → null. */
export function lennarHomesAvailable(html: string): number | null {
  const text = html.replace(/<!--[\s\S]*?-->/g, "");
  const match = /<h[1-6][^>]*>\s*(?:(\d{1,4})|No)\s*homes?\s+available\s*<\/h[1-6]>/i.exec(text);
  if (!match) return null;
  return match[1] ? Number(match[1]) : 0;
}

/** A homesite row as a home for sale: its street, status, price (and the previous one of a cut), figures, lot, pin and elevation photo. */
function homeOf(cache: Cache, home: Json, link: URL, city: string | null, zip: string | null, planName: string | null): PrivatePlanOrHome {
  // A short tag after the street is Lennar's label, not part of the address: "20902 Blackberry Grove (WHC)" is the
  // Welcome Home Center (the sales model) for sale at 20902 Blackberry Grove (Lonesome Dove, Oct 22).
  const street = str(home.address)?.replace(/\s*\([A-Za-z]{2,6}\)\s*$/, "") ?? null;
  const readable = looksLikeStreetAddress(street);
  const status = lennarStatus(str(home.status));
  const price = positive(home.price);
  const wasPrice = positive(home.wasPrice);
  const cut = wasPrice !== null && price !== null && wasPrice > price;
  const homesite = str(home.number);
  const geo = geoOf(home.latitude, home.longitude);
  return {
    sourceUrl: pageUrlOf(link),
    privateName: street,
    privateAddress: readable ? `${street}, ${city ? `${city}, ${zip ? `TX ${zip}` : "TX"}` : "TX"}` : null,
    privatePlanName: str(obj(resolveLennarRef(cache, home.plan))?.name) ?? planName,
    status: readable ? status.status : null,
    price,
    previousPrice: cut ? wasPrice : null,
    priceDrop: cut ? wasPrice! - price! : null,
    bedrooms: positive(home.beds),
    bathrooms: bathsOf(home),
    squareFeet: positive(home.sqft),
    homesite: homesite && /^\d+$/.test(homesite) ? `Lot ${homesite}` : null,
    readyNow: status.readyNow,
    moveInDate: status.moveInDate,
    geo: geo ? { latitude: geo.lat, longitude: geo.lng } : null,
    gallery: gallery(cache, [home.elevationImage]),
  };
}
/** Full baths plus half baths as halves; none without a full-bath count. */
const bathsOf = (row: Json): number | null => { const full = positive(row.baths); return full === null ? null : full + (positive(row.halfBaths) ?? 0) * 0.5; };

export type LennarPage = {
  record: LennarCommunityRecord;
  /** True when the masterplan row's own URL is another page: a same-host redirect to another community. */
  foreignPage: boolean;
  /** The collections for sale (each with a sales address); none for a coming-soon masterplan. */
  collections: number;
  homes: PrivatePlanOrHome[];
  /** True when a home links under another community's path. */
  foreignHome: boolean;
  /** The homesite table heading's count; null when the page has no table heading. */
  homesAvailable: number | null;
  /** The masterplan's price reads "Coming soon" (Spring Grove, Oct 22). */
  comingSoon: boolean;
  /** Every selling collection's price reads "Coming soon" too (Sunshine Trails, Oct 22: plans shown, nothing released). */
  collectionsComingSoon: boolean;
  plans: PrivatePlanOrHome[];
  foreignPlan: boolean;
};

/**
 * A community that belongs to no masterplan (Hidden Oasis, Landon Ridge, Red Hawk Landing on Oct 22) has a
 * page of its own: no MpcType row, and its CommunityType row (`mpc: null`) is the page. It is read as a
 * masterplan of one collection, itself; only the row whose URL is this page counts.
 */
function standaloneCommunity(cache: Cache, community: URL): Json | null {
  const entry = Object.entries(cache).find(([key, value]) => {
    if (!key.startsWith("CommunityType:")) return false;
    const row = obj(value);
    const url = row ? linkOf(row.url, community) : null;
    return row !== null && row.mpc == null && url !== null && pagePath(url) === pagePath(community);
  });
  if (!entry) return null;
  const row = obj(entry[1])!;
  return { name: row.name, city: row.city, url: row.url, communities: [{ __ref: entry[0] }], consultants: row.consultants, customPrice: row.customPrice, latitude: row.latitude, longitude: row.longitude };
}

/** The masterplan on the page (a standalone community counts as one of a single collection); null when the page's data carries neither. */
const COMING_SOON = /^\s*coming\s+soon\s*$/i;

export function parseLennarCommunity(html: string, pageUrl: string): LennarPage | null {
  const community = asUrl(pageUrl);
  const pageProps = parseLennarNextData(html);
  const cache = lennarCache(pageProps);
  if (!community || !cache) return null;
  const host = community.hostname;
  // The page's own masterplan (`variables.mpcid`), else the one whose URL is the page, else the first.
  const mpcid = num(obj(pageProps?.variables)?.mpcid);
  const rows = lennarRows(cache, "MpcType");
  const mpc = (mpcid !== null ? obj(cache[`MpcType:m_${mpcid}`]) : null) ?? rows.find((row) => { const url = linkOf(row.url, community); return url !== null && pagePath(url) === pagePath(community); }) ?? rows[0] ?? standaloneCommunity(cache, community);
  const record = mpc ? recordOf(cache, mpc) : null;
  if (!mpc || !record) return null;
  const own = linkOf(mpc.url, community);
  // The row's own URL must be this page on the official host: none, another host or scheme, or another path is another page.
  const foreignPage = own === null || !sameOfficialHost(own, host) || pagePath(own) !== pagePath(community);
  const base = `${pagePath(community)}/`;
  const underPage = (url: URL) => sameOfficialHost(url, host) && `${pagePath(url)}/`.startsWith(base) && pagePath(url) !== pagePath(community);
  const collections = collectionsOf(cache, mpc).filter((row) => str(row.soAddress) || str(row.address));
  // The homes stand in the masterplan's city and their collection's ZIP (a sales office elsewhere is the record's, not theirs).
  const city = str(obj(resolveLennarRef(cache, mpc.city))?.name) ?? record.city;
  const homes: PrivatePlanOrHome[] = [];
  const plans: PrivatePlanOrHome[] = [];
  let foreignHome = false;
  let foreignPlan = false;
  const seenHomes = new Set<string>();
  const seenPlans = new Set<string>();
  for (const collection of collections) {
    const zip = zipOf(collection.zipCode) ?? record.zip;
    for (const plan of arr(resolveLennarRef(cache, collection.plans)).map(obj).filter((row): row is Json => row !== null)) {
      const planName = str(plan.name);
      const planLink = linkOf(plan.url, community);
      if (planName && planLink) {
        if (!underPage(planLink)) foreignPlan = true;
        else if (!seenPlans.has(pagePath(planLink))) {
          seenPlans.add(pagePath(planLink));
          const price = positive(plan.startingPrice) ?? customPriceFrom(plan.customPrice);
          const squareFeet = positive(plan.sqft);
          const elevationKey = Object.keys(plan).find((key) => /^elevationImages\b/.test(key));
          // A plan that is not active, or has neither a price nor a size, is not for sale as a build.
          if ((str(plan.status) ?? "ACTIVE").toUpperCase() === "ACTIVE" && (price !== null || squareFeet !== null)) {
            plans.push({
              sourceUrl: pageUrlOf(planLink),
              privateName: planName,
              privatePlanName: planName,
              status: null,
              price,
              bedrooms: positive(plan.beds),
              bathrooms: bathsOf(plan),
              squareFeet,
              readyNow: false,
              gallery: gallery(cache, [elevationKey ? plan[elevationKey] : null, plan.heroImage]),
            });
          }
        }
      }
      for (const home of arr(resolveLennarRef(cache, plan.homesites)).map(obj).filter((row): row is Json => row !== null)) {
        const link = linkOf(home.url, community);
        if (!link) continue;
        if (!underPage(link)) { foreignHome = true; continue; }
        if (seenHomes.has(pagePath(link))) continue;
        seenHomes.add(pagePath(link));
        homes.push(homeOf(cache, home, link, city, zip, planName));
      }
    }
  }
  // A home in the cache that no plan lists is still a home for sale on the page: it links under this page and is read the same way.
  for (const home of lennarRows(cache, "HomesiteType")) {
    const link = linkOf(home.url, community);
    if (!link || seenHomes.has(pagePath(link))) continue;
    if (!underPage(link)) { foreignHome = true; continue; }
    seenHomes.add(pagePath(link));
    homes.push(homeOf(cache, home, link, city, record.zip, null));
  }
  return { record, foreignPage, collections: collections.length, homes, foreignHome, homesAvailable: lennarHomesAvailable(html), comingSoon: COMING_SOON.test(str(mpc.customPrice) ?? ""), collectionsComingSoon: collections.length > 0 && collections.every((row) => COMING_SOON.test(str(row.customPrice) ?? "")), plans, foreignPlan };
}

/** The community's record from its page, for discovery; null when the page is not a community page. */
export function lennarRecord(html: string, pageUrl: string): LennarCommunityRecord | null {
  return parseLennarCommunity(html, pageUrl)?.record ?? null;
}

/** The market page's masterplans for discovery: every one with a selling collection, with its name, pin, city, street, ZIP and lowest price; null when the body is not the market page. */
export function lennarListingEntries(body: string, host: string): Array<{ url: string; record: LennarCommunityRecord }> | null {
  const cache = lennarCache(parseLennarNextData(body));
  if (!cache) return null;
  const rows = lennarRows(cache, "MpcType");
  if (!rows.length) return null;
  const out = new Map<string, { url: string; record: LennarCommunityRecord }>();
  for (const row of rows) {
    const url = linkOf(row.url, `https://${host}/`);
    const record = recordOf(cache, row);
    // A masterplan with no collection carrying a sales address is not selling yet ("Coming soon").
    if (!url || !sameOfficialHost(url, host) || !record || !collectionsOf(cache, row).some((collection) => str(collection.soAddress) || str(collection.address))) continue;
    const key = pageUrlOf(url);
    if (!out.has(key)) out.set(key, { url: key, record });
  }
  return Array.from(out.values());
}

export class LennarAdapter implements DealAdapter {
  readonly builder = "Lennar" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, LENNAR_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", LENNAR_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseLennarCommunity(page.text, community.toString());
    // No collection selling yet and the masterplan's price reads "Coming soon": coming soon, not a changed page.
    // So is a masterplan whose every collection's price also reads "Coming soon" and that lists no home for sale.
    if (parsed && parsed.comingSoon && !parsed.foreignPage && (parsed.collections === 0 || (parsed.collectionsComingSoon && parsed.homes.length === 0 && !parsed.foreignHome))) return failedResult(config, fetchedAt, privateSnapshot, ["community_coming_soon"]);
    // Without the masterplan and a collection with a sales office this is not a selling community's page.
    if (!parsed || parsed.collections === 0) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The page must be this community's (a same-host redirect to another one is not), and so must its homes and plans.
    if (parsed.foreignPage || parsed.foreignHome || parsed.foreignPlan) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // The homesite table heading counts the homes for sale and is on every page, "No homes available" included: a page without it has changed shape; a count the data does not match is a partial read.
    if (parsed.homesAvailable === null) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.homesAvailable !== null && parsed.homesAvailable !== parsed.homes.length) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    if (parsed.homes.length > LENNAR_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    const prices = parsed.homes.map((home) => home.price).filter((price): price is number => price !== null && price >= 50_000);
    privateSnapshot.communityFacts = { ...facts, fromPrice: parsed.record.priceFrom && parsed.record.priceFrom >= 50_000 ? parsed.record.priceFrom : facts.fromPrice ?? (prices.length ? Math.min(...prices) : null) };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    // Lennar's corporate banner names no rate, figure or term: the deals are the homes' own price cuts, carried above as previous prices.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, []));
  }
}
