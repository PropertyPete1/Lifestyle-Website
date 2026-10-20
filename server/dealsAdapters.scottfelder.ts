import {
  SCOTTFELDER_HOST, asUrl, decodeHtmlEntities, emptyPrivate, failedResult, getDocument, htmlToText, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * SCOTT FELDER HOMES reader. The site is a server-rendered React app; every
 * page embeds the builder's whole catalogue in one inline
 * `window.__PRELOADED_STATE__ = {...}` object (about 3.7 MB):
 * `cloudData.communities[<builder>].data[]` (`name`, `sharedName` = URL slug,
 * `area` "Schertz/Cibolo", `address{streetAddress, addressLocality,
 * postalCode}`, `telephone`, `geoIndexed` [lng, lat], `priceLow`, `status`
 * "Active", `headline` / `custom_banner` / `card_feature_headline` (the
 * offer), `is_parent_community`, `parent_community`, `featured_info[].copy`,
 * `published`), `cloudData.homes[<builder>].data[]` (`containedIn` =
 * community id, `address`, `price`, `originalPrice`, `status` "Active" |
 * "Under Construction", `moveInDate` ISO, `plan` = plan id, `beds`,
 * `bathsFull`, `bathsHalf`, `sqft`, `garages`, `isLot`, `published`,
 * `photos[].contentUrl`, `elevationPhotos[]`, `special_feature_headline`) and
 * `cloudData.plans[<builder>].data[]` (`name`, `communities[].community` with
 * `communityModelProperties.price`, `price`, `hide_price`,
 * `dont_show_price_on_detail`, `beds`, `bathsFull`, `bathsHalf`, `sqft`,
 * `garages`, `photos`, `elevationPhotos[].hiddenCommunities`). The rendered
 * page shows at most six home cards ("Ready Now!" when `moveInDate` has
 * passed, "available - <Month>" otherwise) and states "N Quick Move-In Homes";
 * the state is the complete inventory. A home's page is
 * `/homes/<metro>/<sub-market>/<community slug>/<street slug>`; a plan's is
 * `/plan/<community slug>/<plan slug>`. An unknown path renders the market
 * page (HTTP 200), so the page's `<h1>` must name the community. Photos sit on
 * the BuilderCloud bucket (`s3.amazonaws.com/buildercloud/…`). Read-only,
 * plain GET, official host only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - market:    /communities/san-antonio-area                              (about 3.9 MB)
 * - community: /communities/san-antonio-area/<sub-market>/<slug>          (about 3.9 MB)
 * - home:      /homes/san-antonio-area/<sub-market>/<slug>/<street slug>
 * - plan:      /plan/<slug>/<plan slug>
 */
/** A community with more homes for sale than this is held, never truncated. */
export const SCOTTFELDER_MAX_HOMES = 150;
export const SCOTTFELDER_PHOTO_HOST = "s3.amazonaws.com";
export const SCOTTFELDER_PHOTO_PATH = /^\/buildercloud\//i;
export const scottFelderListingUrl = () => `https://${SCOTTFELDER_HOST}/communities/san-antonio-area`;

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

/** The site's own URL slug for a street or plan name: lower case, runs of anything else become one hyphen. */
export function scottFelderSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The page's `window.__PRELOADED_STATE__ = {...}` object, read by matching braces outside strings; null when absent or not JSON. */
export function parseScottFelderState(html: string): Json | null {
  const match = /window\.__PRELOADED_STATE__\s*=\s*\{/.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let depth = 0;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (char === '"') {
      index++;
      while (index < html.length && html[index] !== '"') { if (html[index] === "\\") index++; index++; }
      continue;
    }
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) {
        try { return obj(JSON.parse(html.slice(start, index + 1))); } catch { return null; }
      }
    }
  }
  return null;
}

/** `cloudData.<collection>` is keyed by builder id, each `{ data: [...] }`; every builder's rows together. */
function collection(state: Json | null, name: string): Json[] {
  const byBuilder = obj(obj(state?.cloudData)?.[name]);
  if (!byBuilder) return [];
  return Object.values(byBuilder).flatMap((entry) => arr(obj(entry)?.data)).map(obj).filter((row): row is Json => row !== null);
}

/**
 * "Active" with a move-in date that has passed (or none) is ready now, as the
 * site's "Ready Now!" says; a future date names its month. "Under
 * Construction" is a quick move-in for its month, or undated once the estimate
 * has passed (the site still says "Ready Now!", the status says otherwise).
 * Other wording, or none, gives no status (the run is held).
 */
export function scottFelderStatus(status: string | null, moveInDate: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const label = (status ?? "").replace(/\s+/g, " ").trim();
  if (!label) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under\s+contract/i.test(label)) return { status: "Sold", readyNow: false, moveInDate: null };
  const active = /^active$/i.test(label);
  if (!active && !/^under\s+construction$/i.test(label)) return { status: null, readyNow: false, moveInDate: null };
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(moveInDate ?? "");
  const year = iso ? Number(iso[1]) : null;
  const month = iso ? Number(iso[2]) : null;
  const valid = year !== null && month !== null && month >= 1 && month <= 12 && year >= 2000 && year <= now.getUTCFullYear() + 5;
  const passed = !valid || Date.UTC(year!, month! - 1, Number(iso![3])) <= now.getTime();
  if (passed) return active && valid ? { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null } : { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${MONTHS[month! - 1]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type ScottFelderCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

function geoOf(value: unknown): { lat: number; lng: number } | null {
  const pair = arr(value);
  const lng = num(pair[0]);
  const lat = num(pair[1]);
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
}

function recordOf(community: Json): ScottFelderCommunityRecord | null {
  const name = str(community.name);
  if (!name) return null;
  const address = obj(community.address);
  const street = str(address?.streetAddress);
  return {
    name,
    // "BOOK BY APPOINTMENT" is not an address.
    street: looksLikeStreetAddress(street) ? street : null,
    city: str(address?.addressLocality),
    zip: /^\d{5}/.exec(str(address?.postalCode) ?? "")?.[0] ?? null,
    phone: (str(community.telephone) ?? "").replace(/[^\d]/g, "") || null,
    priceFrom: num(community.priceLow),
    geo: geoOf(community.geoIndexed),
  };
}

function photo(raw: unknown, communityId: string | null, caption: string | null): PrivateGalleryImage | null {
  const item = obj(raw);
  const link = item ? str(item.contentUrl) : null;
  const url = link ? asUrl(link) : null;
  if (!item || !url || url.protocol !== "https:" || url.hostname.toLowerCase() !== SCOTTFELDER_PHOTO_HOST || !SCOTTFELDER_PHOTO_PATH.test(url.pathname) || /\.(?:pdf|svg)$/i.test(url.pathname)) return null;
  // A rendering the builder hides for this community is not shown on its page.
  if (communityId && obj(item.hiddenCommunities)?.[communityId] === true) return null;
  url.search = "";
  return { sourceUrl: url.toString(), caption: caption ?? str(item.caption), width: null, height: null, srcSet: null };
}

function gallery(communityId: string | null, caption: string | null, ...sources: unknown[]): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const raw of arr(source)) {
      const image = photo(raw, communityId, caption);
      if (!image || seen.has(image.sourceUrl)) continue;
      seen.add(image.sourceUrl);
      out.push(image);
    }
  }
  return out;
}

/** The headline banners as one text, each once, without the footnote stars. */
function offerText(parts: Array<string | null>): string | null {
  const seen = new Set<string>();
  const sentences: string[] = [];
  for (const part of parts) {
    const text = (part ?? "").replace(/\*+/g, "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    sentences.push(/[.!?]$/.test(text) ? text : `${text}.`);
  }
  return sentences.length ? sentences.join(" ") : null;
}

export type ScottFelderPage = {
  record: ScottFelderCommunityRecord | null;
  communityId: string | null;
  communityStatus: string | null;
  /** True when a rendered home link is not one of this community's (or its sub-communities') homes. */
  foreignHome: boolean;
  /** False when a rendered home card does not match the state (the page changed shape). */
  shapeIntact: boolean;
  /** The page's "N Quick Move-In Homes" line, when stated. */
  statedHomeCount: number | null;
  homes: PrivatePlanOrHome[];
  plans: PrivatePlanOrHome[];
  offer: string | null;
  facts: { fromPrice: number | null; schoolDistrict: string | null; amenities: string[] };
};

/** The community on the page; null when the page has no state, no community under the URL's slug, or a heading naming another page. */
export function parseScottFelderCommunity(html: string, pageUrl: string, now: Date = new Date()): ScottFelderPage | null {
  const community = asUrl(pageUrl);
  const state = parseScottFelderState(html);
  if (!community || !state) return null;
  const communities = collection(state, "communities");
  const allHomes = collection(state, "homes");
  const allPlans = collection(state, "plans");
  if (!communities.length) return null;
  const segments = community.pathname.split("/").filter(Boolean);
  const slug = segments.at(-1)?.toLowerCase() ?? "";
  const own = communities.find((row) => str(row.sharedName)?.toLowerCase() === slug && row.published !== false) ?? null;
  const record = own ? recordOf(own) : null;
  // An unknown path renders the market page with the same state; only the heading tells the community page apart.
  const heading = htmlToText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " "))?.[1] ?? "");
  if (!own || !record || !heading.toLowerCase().startsWith(record.name.toLowerCase())) return { record: null, communityId: null, communityStatus: null, foreignHome: false, shapeIntact: true, statedHomeCount: null, homes: [], plans: [], offer: null, facts: { fromPrice: null, schoolDistrict: null, amenities: [] } };
  const communityId = str(own._id);
  const members = new Map<string, string>();
  if (communityId) members.set(communityId, slug);
  for (const row of communities) {
    const id = str(row._id);
    const shared = str(row.sharedName)?.toLowerCase();
    if (id && shared && communityId && str(row.parent_community) === communityId && row.published !== false) members.set(id, shared);
  }
  const planNames = new Map<string, string>();
  for (const plan of allPlans) { const id = str(plan._id); const name = str(plan.name); if (id && name) planNames.set(id, name); }
  // "/communities/<metro>/<sub-market>/<slug>" -> "/homes/<metro>/<sub-market>/<community slug>/<street slug>".
  const homesBase = `${community.origin}/homes/${segments.slice(1, -1).join("/")}`.replace(/\/+$/, "");
  const homes: PrivatePlanOrHome[] = [];
  const homeUrls = new Set<string>();
  for (const home of allHomes) {
    const container = str(home.containedIn);
    const shared = container ? members.get(container) : undefined;
    if (!shared || home.isLot === true || home.published === false) continue;
    const address = obj(home.address);
    const street = str(address?.streetAddress);
    const readable = looksLikeStreetAddress(street);
    const city = str(address?.addressLocality) ?? record.city;
    const zip = /^\d{5}/.exec(str(address?.postalCode) ?? "")?.[0] ?? record.zip;
    const status = scottFelderStatus(str(home.status), str(home.moveInDate), now);
    const price = num(home.price);
    const original = num(home.originalPrice);
    const full = num(home.bathsFull);
    const geo = geoOf(home.geoIndexed);
    const sourceUrl = readable ? `${homesBase}/${shared}/${scottFelderSlug(street)}` : `${community.origin}${community.pathname.replace(/\/+$/, "")}/unreadable-${homes.length}`;
    if (readable) homeUrls.add(sourceUrl);
    homes.push({
      sourceUrl,
      privateName: street,
      privateAddress: street ? `${street}, ${city ? `${city}, ${zip ? `TX ${zip}` : "TX"}` : "TX"}` : null,
      privatePlanName: planNames.get(str(home.plan) ?? "") ?? null,
      status: readable ? status.status : null,
      price: price && price > 0 ? price : null,
      previousPrice: original && price && original > price ? original : null,
      priceDrop: original && price && original > price ? original - price : null,
      bedrooms: num(home.beds),
      bathrooms: full === null ? null : full + (num(home.bathsHalf) ?? 0) * 0.5,
      squareFeet: num(home.sqft),
      garage: num(home.garages),
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      geo: geo ? { latitude: geo.lat, longitude: geo.lng } : null,
      gallery: gallery(container, null, home.photos, home.elevationPhotos),
    });
  }
  // The rendered cards (at most six) must each be one of the state's homes; a card under another community is not this community's inventory.
  let shapeIntact = true;
  let foreignHome = false;
  const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  for (const match of Array.from(body.matchAll(/href="(\/homes\/[^"#?]+)"/g))) {
    const link = decodeHtmlEntities(match[1]!);
    const parts = link.split("/").filter(Boolean);
    if (parts.length < 5) continue;
    const linked = `${community.origin}${link.replace(/\/+$/, "")}`;
    if (homeUrls.has(linked)) continue;
    if (Array.from(members.values()).includes(parts[parts.length - 2]!.toLowerCase())) shapeIntact = false;
    else foreignHome = true;
  }
  const statedHomeCount = (() => { const match = /(\d{1,3})\s+Quick\s+Move-In\s+Homes?\b/i.exec(htmlToText(body)); return match ? Number(match[1]) : null; })();
  const plans: PrivatePlanOrHome[] = [];
  for (const plan of allPlans) {
    const name = str(plan.name);
    if (!name || plan.published === false) continue;
    const placement = arr(plan.communities).map(obj).find((entry) => entry && members.has(str(entry.community) ?? ""));
    if (!placement) continue;
    const placedIn = str(placement.community)!;
    const localPrice = num(obj(placement.communityModelProperties)?.price);
    const price = localPrice && localPrice > 0 ? localPrice : num(plan.price);
    const shown = plan.hide_price !== true && plan.dont_show_price_on_detail !== true;
    const full = num(plan.bathsFull);
    plans.push({
      sourceUrl: `${community.origin}/plan/${members.get(placedIn)}/${scottFelderSlug(name)}`,
      privateName: name,
      privatePlanName: name,
      status: null,
      price: shown && price && price > 0 ? price : null,
      bedrooms: num(plan.beds),
      bathrooms: full === null ? null : full + (num(plan.bathsHalf) ?? 0) * 0.5,
      squareFeet: num(plan.sqftLow) ?? num(plan.sqft),
      garage: num(plan.garagesLow) ?? num(plan.garages),
      readyNow: false,
      gallery: gallery(placedIn, "Representative image", plan.elevationPhotos, plan.photos),
    });
  }
  const selectHomes = Array.from(new Set(allHomes.filter((home) => members.has(str(home.containedIn) ?? "") && home.isLot !== true && home.published !== false).map((home) => (str(home.special_feature_headline) ?? "").replace(/\*+/g, "").trim()).filter(Boolean)));
  const offer = offerText([str(own.headline), str(own.custom_banner), str(own.card_feature_headline), ...selectHomes.map((text) => `On select homes: ${text}`)]);
  const amenities = arr(own.featured_info).flatMap((item) => htmlToText(String(obj(item)?.copy ?? "").replace(/<\/(?:li|p)>/gi, " | ")).split("|").map((part) => part.trim()).filter(Boolean));
  return {
    record,
    communityId,
    communityStatus: str(own.status) ?? str(own.custom_status),
    foreignHome,
    shapeIntact,
    statedHomeCount,
    homes,
    plans,
    offer,
    facts: { fromPrice: record.priceFrom && record.priceFrom >= 50_000 ? record.priceFrom : null, schoolDistrict: parseCommunityFacts(html).schoolDistrict, amenities },
  };
}

/** The community's record for discovery, from its page. */
export function scottFelderRecord(html: string, pageUrl: string): ScottFelderCommunityRecord | null {
  return parseScottFelderCommunity(html, pageUrl)?.record ?? null;
}

/** The market page's community links, each with its record from the page's state; null when the state or the links are not there. */
export function scottFelderListingEntries(html: string, host: string): Array<{ url: string; record: ScottFelderCommunityRecord | null }> | null {
  const state = parseScottFelderState(html);
  if (!state) return null;
  const communities = collection(state, "communities");
  const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  const out = new Map<string, { url: string; record: ScottFelderCommunityRecord | null }>();
  for (const match of Array.from(body.matchAll(/href="(\/communities\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+)(?:[#?][^"]*)?"/gi))) {
    const url = asUrl(new URL(decodeHtmlEntities(match[1]!), `https://${host}/`).toString());
    if (!url || !sameOfficialHost(url, host)) continue;
    const key = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    if (out.has(key)) continue;
    const slug = key.split("/").at(-1)!.toLowerCase();
    const row = communities.find((item) => str(item.sharedName)?.toLowerCase() === slug && item.published !== false);
    if (!row) continue;
    out.set(key, { url: key, record: recordOf(row) });
  }
  return out.size ? Array.from(out.values()) : null;
}

export class ScottFelderAdapter implements DealAdapter {
  readonly builder = "Scott Felder Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, SCOTTFELDER_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", SCOTTFELDER_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseScottFelderCommunity(page.text, community.toString(), now());
    // Without the state, a community under the URL's slug and a heading naming it, this is not the community's page.
    if (!parsed || !parsed.record) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The state says how the community is selling; wording the reader does not know is not read as a selling community.
    if (parsed.communityStatus && !/^(?:active|now\s+selling|coming\s+soon|close[- ]?out|sold\s+out|grand\s+opening|final\s+opportunit(?:y|ies))$/i.test(parsed.communityStatus)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (!parsed.shapeIntact) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // A home card under another community is never this community's inventory.
    if (parsed.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    if (parsed.homes.length > SCOTTFELDER_MAX_HOMES || (parsed.statedHomeCount !== null && parsed.homes.length < parsed.statedHomeCount)) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    privateSnapshot.communityFacts = { fromPrice: parsed.facts.fromPrice, schoolDistrict: parsed.facts.schoolDistrict, lotSizes: null, amenities: parsed.facts.amenities };
    // A sold-out community has nothing to publish.
    if (!/sold\s*out/i.test(parsed.communityStatus ?? "")) {
      for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
      for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
      if (parsed.offer) privateSnapshot.incentive = { sourceUrl: community.toString(), text: parsed.offer, facts: parsePromotionalRate(parsed.offer) };
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
