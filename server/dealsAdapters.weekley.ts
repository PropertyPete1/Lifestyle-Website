import {
  WEEKLEY_HOST, asUrl, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, makePublicSnapshot, parsePromotionalRate, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlFetcher, type PrivateDealSnapshot, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * DAVID WEEKLEY HOMES reader. The community page is server-rendered and carries
 * its inventory in one inline `window.pageData= {...}` object: `floorplans[]`
 * (plans: `Name`, `BasePrice`, `PriceDisplay` "$367,990" or " Call For
 * Information", `HidePlanPrice`, `Bedrooms.Minimum`, `FullBaths.Minimum`,
 * `HalfBaths.Minimum`, `Garages.Minimum`, `SquareFootage.Minimum`, `Token`,
 * `Elevations[].Renderings[].Url`, `Status` "Active"), `quickMoveIns[]` (homes:
 * `Address.Line1/City/ZipCode`, `Price`, `HideQmiPrice`, `ReadyLabel` "Ready
 * Now" or "Ready 11/2/2026", `ReadyDate`, `IsCompleted`, `Stage` 1-10,
 * `Hidden`, `Name` = plan, `Bedrooms`, `FullBaths`, `HalfBaths`, `Garages`,
 * `SquareFootage`, `Token` "/homes-ready-soon/…/<job>", `ExteriorPhotos[]`,
 * `InteriorPhotos[]`, `Elevation.Renderings[]`, `IsModel`, `LostReadyStatus`),
 * `salesOffices[0]` (`Address` "13222 Sweet Acacia<br />San Antonio, TX
 * 78245", `SearchableAddress` "lat,lng"), `communityAvailability` ("Active",
 * "Close Out"), `amenities` (comma list), `communityId`, `url` (the page's
 * own). The market's community list is a plain JSON endpoint on the same host
 * (`/search/CommunityData?marketId=markets/3`, each community with its
 * `ShowcaseCount` of homes for sale, read once an hour to corroborate the
 * page's list), and so is its promotion list
 * (`/promotion/marketpromotionslist`), each promotion naming the communities
 * it shows on; one promotion is the offer, never several joined. Photos sit on
 * the official host and on `assetcontentdeliveryapi.davidweekleyhomes.com`.
 * Read-only, plain GET, official host only. Everything here is private
 * operational data.
 *
 * Page shapes (October 2026):
 * - neighborhood: /neighborhoods/tx/san-antonio/<slug>     (since October 20, 2026 the old /neighborhoods/TX/… path
 *   answers 301 to it). No page data: a `#neighborhood` landing page with the
 *   sales offices and one `.single-listing` per series ("Briggs Ranch – Select
 *   Classic Series"), each linking its community page with "View Quick
 *   Move-ins (7)" and "View Floor Plans (8)". The reader reads every series
 *   page as one community and checks each against its count.
 * - community: /new-homes/tx/san-antonio/<city>/<slug>        (about 930 KB)
 * - home:      /homes-ready-soon/tx/san-antonio/<city>/<slug>/<job number>
 * - plan:      /new-homes/tx/san-antonio/<city>/<slug>/<plan>
 */
/** A community with more homes for sale than this is held, never truncated. */
export const WEEKLEY_MAX_HOMES = 150;
/** A neighborhood listing more series than this is held, never read in part. */
export const WEEKLEY_MAX_SERIES = 6;
export const WEEKLEY_ASSET_HOST = "assetcontentdeliveryapi.davidweekleyhomes.com";
export const WEEKLEY_MARKET_ID = "markets/3";
export const weekleyListingUrl = () => `https://${WEEKLEY_HOST}/search/CommunityData?marketId=${WEEKLEY_MARKET_ID}`;
export const weekleyPromotionsUrl = () => `https://${WEEKLEY_HOST}/promotion/marketpromotionslist?marketId=${WEEKLEY_MARKET_ID}`;
const PROMO_CACHE_MS = 60 * 60 * 1000;

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
const minimum = (value: unknown): number | null => num(obj(value)?.Minimum ?? value);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

let promoCache: { fetchedAt: number; promotions: WeekleyPromotion[] } | null = null;
let listingCache: { fetchedAt: number; counts: Map<string, number> } | null = null;
export function resetWeekleyCaches(): void { promoCache = null; listingCache = null; }

/** The page's `window.pageData= {...}` object, read by matching braces outside strings; null when absent or not JSON. */
export function parseWeekleyPageData(html: string): Json | null {
  const match = /window\.pageData\s*=\s*\{/.exec(html);
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

/**
 * "Ready Now" is ready; "Ready 11/2/2026" names a month (a past one is a
 * stale estimate: no date); other wording, or none, gives no status (the run
 * is held).
 */
export function weekleyStatus(label: string | null, readyDate: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under\s+contract/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/^(?:ready\s+now|move[- ]?in\s+ready|available\s+now)!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const labelled = /^ready\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/i.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(readyDate ?? "");
  const month = labelled ? Number(labelled[1]) : iso ? Number(iso[2]) : null;
  const year = labelled ? Number(labelled[3]) : iso ? Number(iso[1]) : null;
  if (!labelled || month === null || year === null || month < 1 || month > 12 || year < 2000 || year > now.getUTCFullYear() + 5) return { status: null, readyNow: false, moveInDate: null };
  if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month - 1 < now.getUTCMonth())) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${MONTHS[month - 1]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type WeekleyCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

function photo(raw: unknown, host: string, caption: string | null): PrivateGalleryImage | null {
  const item = obj(raw);
  const link = item ? str(item.Url) ?? str(item.SchemelessUrl) : null;
  const url = link ? asUrl(link) : null;
  if (!url || (!sameOfficialHost(url, host) && url.hostname !== WEEKLEY_ASSET_HOST) || /FloorPlan|PlanPDF|\.pdf$|\.svg$/i.test(url.pathname)) return null;
  url.search = "";
  return { sourceUrl: url.toString(), caption: caption ?? (item ? str(item.Caption) : null), width: null, height: null, srcSet: null };
}

function gallery(host: string, caption: string | null, ...sources: unknown[]): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const raw of arr(source)) {
      const image = photo(raw, host, caption);
      if (!image || seen.has(image.sourceUrl)) continue;
      seen.add(image.sourceUrl);
      out.push(image);
    }
  }
  return out;
}

export type WeekleyPage = {
  record: WeekleyCommunityRecord | null;
  communityId: string | null;
  availability: string | null;
  /** True when the data's own `url` is another page on the host: a same-host redirect to another community. */
  foreignPage: boolean;
  /** True when a plan's page sits under another community's slug: not this community's plan. */
  foreignPlan: boolean;
  /** True when a home's page sits under another community's slug on the host: not this community's inventory. */
  foreignHome: boolean;
  homes: PrivatePlanOrHome[];
  plans: PrivatePlanOrHome[];
  facts: { schoolDistrict: string | null; amenities: string[] };
};

/** The community on the page; null when the page has no `pageData` or its plan and home arrays are missing. */
export function parseWeekleyCommunity(html: string, pageUrl: string, now: Date = new Date()): WeekleyPage | null {
  const community = asUrl(pageUrl);
  const data = parseWeekleyPageData(html);
  if (!community || !data || !Array.isArray(data.floorplans) || !Array.isArray(data.quickMoveIns)) return null;
  const host = community.hostname;
  const office = obj(arr(data.salesOffices)[0]);
  // "13222 Sweet Acacia<br />San Antonio, TX 78245": the line break separates the street from the city line.
  const officeLine = office ? htmlToText(String(office.Address ?? "").replace(/<br\s*\/?>/gi, ", ")).replace(/\s+/g, " ").replace(/\s*,\s*,/g, ",").trim() : "";
  const officeParts = /^(.*?),\s*([A-Za-z .'-]+),\s*TX\s+(\d{5})/.exec(officeLine);
  const coordinates = /^(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)$/.exec(str(office?.SearchableAddress) ?? "");
  const firstCommunity = obj(obj(arr(data.floorplans)[0])?.Community) ?? obj(obj(arr(data.quickMoveIns)[0])?.Community);
  const name = str(data.communityName);
  const city = str(officeParts?.[2]) ?? str(data.city);
  const zip = officeParts?.[3] ?? null;
  const communityId = str(data.communityId);
  const record: WeekleyCommunityRecord | null = name ? {
    name,
    street: officeParts ? officeParts[1]!.replace(/,$/, "").trim() || null : null,
    city,
    zip,
    phone: (str(firstCommunity?.PhoneNumber) ?? "").replace(/[^\d]/g, "") || null,
    priceFrom: num(data.basePrice),
    geo: coordinates ? { lat: Number(coordinates[1]), lng: Number(coordinates[2]) } : null,
  } : null;
  const cityLine = city ? `${city}, ${zip ? `TX ${zip}` : "TX"}` : null;
  const hidePlanPrices = obj(firstCommunity?.HidePricing)?.HidePlanPrices === true || data.communityAvailability === "Call For Pricing";
  const hideHomePrices = obj(firstCommunity?.HidePricing)?.HideQmiPrices === true;
  const base = `${comparablePath(community.pathname.replace(/\/+$/, ""))}/`;
  const ownLink = str(data.url);
  const own = ownLink ? asUrl(new URL(ownLink, community).toString()) : null;
  const foreignPage = own !== null && sameOfficialHost(own, host) && comparablePath(own.pathname.replace(/\/+$/, "")) !== comparablePath(community.pathname.replace(/\/+$/, ""));
  const plans: PrivatePlanOrHome[] = [];
  let foreignPlan = false;
  for (const raw of data.floorplans) {
    const plan = obj(raw);
    if (!plan) continue;
    const planName = str(plan.Name);
    const token = str(plan.Token) ?? str(plan.CanonicalUrl);
    const page = token ? asUrl(new URL(token, community).toString()) : null;
    if (!planName || !page || !sameOfficialHost(page, host) || plan.IsActive === false || plan.NotOnWebsite === true) continue;
    // The plan's page sits under this community's path ("/new-homes/…/<slug>/<plan>"); another community's plan is never this one's.
    if (!comparablePath(page.pathname).startsWith(base)) { foreignPlan = true; continue; }
    const price = num(plan.BasePrice);
    const shown = !hidePlanPrices && plan.HidePlanPrice !== true && /\$/.test(str(plan.PriceDisplay) ?? "$");
    const full = minimum(plan.FullBaths);
    plans.push({
      sourceUrl: page.toString(),
      privateName: planName,
      privatePlanName: planName,
      status: null,
      price: shown && price && price > 0 ? price : null,
      bedrooms: minimum(plan.Bedrooms),
      bathrooms: full === null ? null : full + (minimum(plan.HalfBaths) ?? 0) * 0.5,
      squareFeet: minimum(plan.SquareFootage),
      garage: minimum(plan.Garages),
      readyNow: false,
      gallery: gallery(host, "Representative image", ...arr(plan.Elevations).map((elevation) => obj(elevation)?.Renderings), plan.ExteriorPhotos),
    });
  }
  const homes: PrivatePlanOrHome[] = [];
  const slug = community.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
  let foreignHome = false;
  for (const raw of data.quickMoveIns) {
    const home = obj(raw);
    if (!home) continue;
    // A hidden home is not on the page the visitor sees.
    if (home.Hidden === true) continue;
    const address = obj(home.Address);
    const street = str(address?.Line1);
    const token = str(home.Token) ?? str(home.CanonicalUrl);
    const page = token ? asUrl(new URL(token, community).toString()) : null;
    // The home's page carries this community's slug ("/homes-ready-soon/…/<slug>/<job>") and its id when given.
    const underCommunity = Boolean(page && sameOfficialHost(page, host) && page.pathname.toLowerCase().split("/").includes(slug));
    if (page && sameOfficialHost(page, host) && !underCommunity) foreignHome = true;
    const ownCommunity = (communityId === null || home.CommunityId === undefined || str(home.CommunityId) === communityId) && underCommunity;
    const readable = Boolean(street && ownCommunity);
    const price = num(home.Price);
    const shown = !hideHomePrices && home.HideQmiPrice !== true;
    const status = weekleyStatus(str(home.ReadyLabel), str(home.ReadyDate), now);
    const full = num(home.FullBaths);
    const homeCity = str(address?.City) ?? city;
    const homeZip = /^\d{5}/.exec(str(address?.ZipCode) ?? "")?.[0] ?? zip;
    homes.push({
      sourceUrl: readable ? page!.toString() : `${community.origin}${community.pathname.replace(/\/+$/, "")}/unreadable-${homes.length}`,
      privateName: street,
      privateAddress: street ? `${street}, ${homeCity ? `${homeCity}, ${homeZip ? `TX ${homeZip}` : "TX"}` : cityLine ?? "TX"}` : null,
      privatePlanName: str(home.Name),
      // A model home is not for sale (the sync leaves a "Model" home out); a lost ready status is a hold, as documented.
      status: !readable || home.Ready === false || (home.LostReadyStatus !== undefined && home.LostReadyStatus !== null && home.LostReadyStatus !== false && home.LostReadyStatus !== "") ? null : home.IsModel === true ? "Model" : status.status,
      price: shown && price && price > 0 ? price : null,
      bedrooms: num(home.Bedrooms),
      bathrooms: full === null ? null : full + (num(home.HalfBaths) ?? 0) * 0.5,
      squareFeet: num(home.SquareFootage),
      garage: num(home.Garages),
      homesite: str(home.JobNumber) ? `Job ${str(home.JobNumber)}` : null,
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      gallery: gallery(host, null, home.ExteriorPhotos, obj(home.Elevation)?.Renderings, home.InteriorPhotos),
    });
  }
  const districts = arr(data.schoolDistricts).map((item) => str(obj(item)?.Name) ?? str(item)).filter((item): item is string => Boolean(item));
  return {
    record,
    communityId,
    availability: str(data.communityAvailability),
    foreignPage,
    foreignPlan,
    foreignHome,
    homes,
    plans,
    facts: { schoolDistrict: districts[0] ?? null, amenities: (str(data.amenities) ?? "").split(",").map((item) => item.trim()).filter(Boolean) },
  };
}

export type WeekleyPromotion = { text: string; communityIds: string[]; siteWide: boolean; start: string | null; end: string | null };

/** The market's promotions: each a description with the community ids it shows on; null when the body is not the list. */
export function parseWeekleyPromotions(body: string): WeekleyPromotion[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const out: WeekleyPromotion[] = [];
  for (const raw of parsed) {
    const promotion = obj(raw);
    const description = promotion ? str(promotion.Description) : null;
    if (!promotion || !description) continue;
    const disclaimer = str(promotion.Disclaimer);
    // Links and phone numbers go, and with them a sentence that only pointed at them ("Call or visit").
    const text = [description, disclaimer].filter(Boolean).join(" ")
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
      .replace(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g, " ")
      .replace(/(?:^|(?<=[.!?]\s))(?:Call|Visit|Click)(?:\s+(?:us|here))?(?:\s+or\s+(?:call|visit|click)(?:\s+(?:us|here))?)?\s*(?:for\s+details|to\s+learn\s+more)?\s*\.?(?=\s|$)/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim();
    out.push({ text, communityIds: arr(promotion.ShowOnCommunityIds).map((id) => str(id)).filter((id): id is string => Boolean(id)), siteWide: promotion.IsSiteWide === true, start: str(promotion.StartDate), end: str(promotion.EndDate) });
  }
  return out;
}

/** The market listing's community pages (both the flat list and the neighbourhood groups), build-on-your-lot and coming-soon left out; null when the body is not the listing. */
export function weekleyListingEntries(body: string, host: string): Array<{ url: string; record: null }> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const data = obj(parsed);
  if (!data || !Array.isArray(data.Communities)) return null;
  const out = new Map<string, { url: string; record: null }>();
  const visit = (raw: unknown) => {
    const item = obj(raw);
    const token = item ? str(item.Token) : null;
    // Build-on-your-lot programs and coming-soon communities (status 3) have no inventory page worth syncing yet.
    if (!item || !token || item.CommunityType === 2 || num(item.CommunityStatuses) === 3 || /build-on-your-lot/i.test(token)) return;
    const url = asUrl(new URL(token, `https://${host}/`).toString());
    if (!url || !sameOfficialHost(url, host)) return;
    const key = `${url.origin}${url.pathname}`;
    if (!out.has(key)) out.set(key, { url: key, record: null });
  };
  for (const item of data.Communities) visit(item);
  for (const group of arr(data.NeighborhoodGroups)) for (const item of arr(obj(group)?.Communities)) visit(item);
  return Array.from(out.values());
}

/** Each listed community's `ShowcaseCount` (homes for sale) by id, from both the flat list and the neighbourhood groups; null when the body is not the listing. */
export function weekleyShowcaseCounts(body: string): Map<string, number> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const data = obj(parsed);
  if (!data || !Array.isArray(data.Communities)) return null;
  const counts = new Map<string, number>();
  const visit = (raw: unknown) => {
    const item = obj(raw);
    const id = item ? str(item.Id) : null;
    const count = num(item?.ShowcaseCount);
    if (id && count !== null && count >= 0 && !counts.has(id)) counts.set(id, count);
  };
  for (const item of data.Communities) visit(item);
  for (const group of arr(data.NeighborhoodGroups)) for (const item of arr(obj(group)?.Communities)) visit(item);
  return counts;
}

export type WeekleyNeighborhood = { name: string; series: Array<{ url: string; quickMoveIns: number | null }> };

/**
 * A neighborhood landing page (`#neighborhood`, no page data): its name and
 * each series' community page with the quick move-in count it shows; null
 * when the page is not one, when a series link leaves the official host's
 * /new-homes/ pages, or when one series shows two different counts.
 */
export function parseWeekleyNeighborhood(html: string, pageUrl: string): WeekleyNeighborhood | null {
  const page = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!page || !root || parseWeekleyPageData(html)) return null;
  const all = descendants(root);
  const container = all.find((element) => element.attributes.id === "neighborhood");
  if (!container) return null;
  const inside = descendants(container);
  const title = inside.find((element) => element.tag === "h1" && elementClass(element, "page-title"));
  const name = title ? elementText(title, html) : "";
  if (!name) return null;
  const series = new Map<string, number | null>();
  for (const listing of inside.filter((element) => elementClass(element, "single-listing"))) {
    const within = descendants(listing);
    const links = within.filter((element) => element.tag === "h3" && elementClass(element, "blue")).flatMap((heading) => descendants(heading).filter((element) => element.tag === "a" && element.attributes.href));
    const urls = Array.from(new Set(links.map((link) => { const url = asUrl(new URL(decodeHtmlEntities(link.attributes.href!), page).toString()); return url ? `${url.origin}${url.pathname}` : ""; })));
    if (urls.length !== 1) return null;
    const url = asUrl(urls[0]!);
    if (!url || !sameOfficialHost(url, page.hostname) || !/^\/new-homes\/[a-z]{2}\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/i.test(url.pathname)) return null;
    const counts = new Set(within.filter((element) => elementClass(element, "showcase-link")).map((element) => /quick\s+move-?ins?\s*\((\d+)\)/i.exec(elementText(element, html))?.[1]).filter((value): value is string => value !== undefined).map(Number));
    if (counts.size > 1) return null;
    series.set(url.toString(), counts.size ? Array.from(counts)[0]! : null);
  }
  if (!series.size) return null;
  return { name, series: Array.from(series, ([url, quickMoveIns]) => ({ url, quickMoveIns })) };
}

/** The community's record for discovery, from its page. */
export function weekleyRecord(html: string, pageUrl: string): WeekleyCommunityRecord | null {
  const parsed = parseWeekleyCommunity(html, pageUrl);
  return parsed?.record?.street ? parsed.record : null;
}

export class DavidWeekleyAdapter implements DealAdapter {
  readonly builder = "David Weekley Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, WEEKLEY_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", WEEKLEY_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    // A neighborhood landing page: each series' community page is read as part of this community.
    const neighborhood = parseWeekleyNeighborhood(page.text, community.toString());
    const pages: Array<{ url: string; text: string; expectedHomes: number | null }> = [];
    if (neighborhood) {
      if (neighborhood.series.length > WEEKLEY_MAX_SERIES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
      for (const series of neighborhood.series) {
        const seriesPage = await getDocument(series.url, fetcher, "text/html,application/xhtml+xml", WEEKLEY_HOST);
        if (!seriesPage.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(seriesPage, "community_fetch_failed")]);
        privateSnapshot.pages.push(sourcePage("community", series.url, null));
        pages.push({ url: series.url, text: seriesPage.text, expectedHomes: series.quickMoveIns });
      }
    } else pages.push({ url: community.toString(), text: page.text, expectedHomes: null });
    const read: WeekleyPage[] = [];
    for (const entry of pages) {
      const parsed = parseWeekleyCommunity(entry.text, entry.url, now());
      // Without the page data, its arrays or the sales office this is not a community page.
      if (!parsed || !parsed.record?.street) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
      // The page says how the community is selling; wording the reader does not know is not read as a sold-out community.
      if (parsed.availability && !/^(?:active|close\s*out|coming\s+soon|call\s+for\s+pricing)$/i.test(parsed.availability)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
      if (parsed.homes.length > WEEKLEY_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
      // The data has always carried the community's id; without it neither the homes nor the market count can be tied to this community.
      if (parsed.communityId === null) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
      // The data must describe this community (a same-host redirect to another page does not); a home or plan under another community's slug is never this community's.
      if (parsed.foreignPage || parsed.foreignPlan || parsed.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
      // A series page must show at least the homes its neighborhood listing counts.
      if (entry.expectedHomes !== null && parsed.homes.filter((home) => home.status !== "Model").length < entry.expectedHomes) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
      // The market list counts each community's homes for sale; fewer homes on the page than that is a changed page, not homes sold. With the list unreachable, an empty page is not trusted.
      const showcase = await showcaseCount(fetcher, now().getTime(), privateSnapshot, parsed.communityId);
      if (showcase === "unavailable" ? parsed.homes.length === 0 : showcase !== null && parsed.homes.length < showcase) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
      read.push(parsed);
    }
    if (read.reduce((total, parsed) => total + parsed.homes.length, 0) > WEEKLEY_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const prices = read.map((parsed) => parsed.record!.priceFrom).filter((price): price is number => price !== null && price >= 50_000);
    privateSnapshot.communityFacts = { fromPrice: prices.length ? Math.min(...prices) : null, schoolDistrict: read.find((parsed) => parsed.facts.schoolDistrict)?.facts.schoolDistrict ?? null, lotSizes: null, amenities: Array.from(new Set(read.flatMap((parsed) => parsed.facts.amenities))) };
    for (const parsed of read) {
      for (const home of parsed.homes) { if (privateSnapshot.homes.some((other) => other.sourceUrl === home.sourceUrl)) continue; privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
      for (const plan of parsed.plans) { if (privateSnapshot.plans.some((other) => other.sourceUrl === plan.sourceUrl)) continue; privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    }
    const incentiveHolds: DealHoldReason[] = [];
    const offers: Array<{ text: string | null } | { hold: DealHoldReason }> = [];
    for (const parsed of read) offers.push(await promotions(fetcher, now().getTime(), privateSnapshot, parsed.communityId));
    const failed = offers.find((offer): offer is { hold: DealHoldReason } => "hold" in offer);
    const texts = Array.from(new Set(offers.map((offer) => "hold" in offer ? null : offer.text)));
    if (failed) incentiveHolds.push(failed.hold);
    // Series of one neighborhood with different promotions: one would be published as the other's; the admin reads them instead.
    else if (texts.length > 1) incentiveHolds.push("expected_incentive_container_not_found");
    else privateSnapshot.offerRead = true;
    if (!failed && texts.length === 1 && texts[0]) privateSnapshot.incentive = { sourceUrl: weekleyPromotionsUrl(), text: texts[0], facts: parsePromotionalRate(texts[0]) };
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
  }
}

/** The market list, read once an hour; this community's `ShowcaseCount`, null when it is not listed or counts nothing, "unavailable" when the list cannot be read. */
async function showcaseCount(fetcher: HtmlFetcher, now: number, snapshot: PrivateDealSnapshot, communityId: string | null): Promise<number | null | "unavailable"> {
  if (communityId === null) return null;
  if (!listingCache || now - listingCache.fetchedAt >= PROMO_CACHE_MS) {
    const page = await getDocument(weekleyListingUrl(), fetcher, "application/json", WEEKLEY_HOST);
    const counts = page.ok ? weekleyShowcaseCounts(page.text) : null;
    if (!counts) return "unavailable";
    listingCache = { fetchedAt: now, counts };
  }
  snapshot.pages.push(sourcePage("community", weekleyListingUrl(), null));
  return listingCache.counts.get(communityId) ?? null;
}

/** The market's promotion list, read once an hour; the offer is ONE promotion naming this community (or the whole site): the one that states a rate, else the first for the community, else the first site-wide. */
async function promotions(fetcher: HtmlFetcher, now: number, snapshot: PrivateDealSnapshot, communityId: string | null): Promise<{ text: string | null } | { hold: DealHoldReason }> {
  let list: WeekleyPromotion[];
  if (promoCache && now - promoCache.fetchedAt < PROMO_CACHE_MS) list = promoCache.promotions;
  else {
    const page = await getDocument(weekleyPromotionsUrl(), fetcher, "application/json", WEEKLEY_HOST);
    if (!page.ok) return { hold: page.redirectedOffOfficialHost ? "unsupported_official_host" : "incentive_fetch_failed" };
    const parsed = parseWeekleyPromotions(page.text);
    if (!parsed) return { hold: "expected_incentive_container_not_found" };
    list = parsed;
    promoCache = { fetchedAt: now, promotions: list };
  }
  snapshot.pages.push(sourcePage("incentive", weekleyPromotionsUrl(), null));
  const today = new Date(now).toISOString().slice(0, 10);
  const current = list.filter((promotion) => (promotion.siteWide || (communityId !== null && promotion.communityIds.includes(communityId))) && (!promotion.end || promotion.end.slice(0, 10) >= today) && (!promotion.start || promotion.start.slice(0, 10) <= today));
  // One promotion only: joining two would publish one's deadline or down payment as a term of the other's rate.
  const namesRate = (promotion: WeekleyPromotion) => parsePromotionalRate(promotion.text).promotionalRatePercent !== null;
  const chosen = current.find((promotion) => !promotion.siteWide && namesRate(promotion)) ?? current.find(namesRate) ?? current.find((promotion) => !promotion.siteWide) ?? current[0];
  return { text: chosen?.text ?? null };
}
