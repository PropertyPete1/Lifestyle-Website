import {
  DREES_HOST, asUrl, comparablePath, decodeHtmlEntities, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, looksLikeStreetAddress, makePublicSnapshot, parsePromotionalRate, postJsonDocument, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlFetcher, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * DREES CUSTOM HOMES reader. The community page is a client-rendered app
 * shell that names itself in an inline script (`var contentId = 309651;
 * var isNeighborhoodPage = true;` — a parent community says
 * `isCommunityPage=true`) and loads its content from the site's own JSON
 * API with POST search queries, which this reader sends as the page does
 * (read-only, `{ contentId, pageSize, pageNumber }`, never a form):
 * - `GET  /api/en/dreeshomes/areas` → the markets (`areaName` "San Antonio",
 *   `pageId` 310095, `pageUrl` "/new-homes-san-antonio/");
 * - `POST /api/en/dreeshomes/community` `{ contentId: <area pageId> }` →
 *   `data.neighborhoods[]` (`contentId`, `neighborhoodName` or
 *   `communityName` for a parent with `isCommunity`, `url`, `address` (the
 *   model's), `cityName`, `zipCode`, `modelPhone`, `lat`, `lng`, `priceLow`,
 *   `qmiCount`, `planCount`, `caption` "Now Selling!");
 * - `POST /api/en/dreeshomes/qmi` `{ contentId }` → `data.homes[]`
 *   (`address`, `cityName`, `zipCode`, `url`, `planName`, `moveInDate`
 *   "Jan 23, 2027", `discountedPrice` (the price), `actualPrice` (the price
 *   before a cut, 0 when none), `bedLow`, `bathLow`, `halfBathLow`,
 *   `sqFtLow`, `garagesLow`, `isModelHome`, `isBoylHome`, `mlsNumber`),
 *   `data.filteredRecords`, `data.promos[]` (`title`, `description` HTML,
 *   `inactive`); a parent's query returns its sub-neighborhoods' homes;
 * - `POST /api/en/dreeshomes/plan` `{ contentId }` → `data.plans[]`
 *   (`planName`, `url`, `priceLow`, `suppressPrice`, `isPlanAvailable`,
 *   `bedLow`, `bathLow`, `halfBathLow`, `sqFtLow`, `garagesLow`).
 * The cards show "Move-in date: Jan 23, 2027" only; no "ready now" wording,
 * so a date that has passed is an undated quick move-in, never a ready one.
 * Photos come from a separate image endpoint and are not read. Official host
 * only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - market:    /new-homes-san-antonio/
 * - community: /new-homes-san-antonio/<city>/<community>/<neighborhood>/   (a parent: /new-homes-san-antonio/<city>/comm-<slug>/)
 * - home:      /new-homes-san-antonio/<city>/<community>/<neighborhood>/<street slug>/
 * - plan:      /new-homes-san-antonio/<city>/<community>/<neighborhood>/<plan>-floorplan/
 */
/** A community with more homes for sale than this is held, never truncated. */
export const DREES_MAX_HOMES = 150;
export const DREES_AREA_NAME = "San Antonio";
export const dreesApiUrl = (path: string) => `https://${DREES_HOST}/api/en/dreeshomes/${path}`;
export const dreesListingUrl = () => dreesApiUrl("areas");
const LIST_CACHE_MS = 60 * 60 * 1000;
const PAGE = { pageSize: 1000, pageNumber: 1 };
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
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
/**
 * Full baths plus half a bath per half bath; null when the figures are not a plausible count (more than two half
 * baths: Haby Hill's Wagner plan lists 4 full and 4 half, with a "high" of 2, on October 20, 2026), never a guess.
 */
const bathCount = (full: unknown, half: unknown): number | null => {
  const fullBaths = num(full);
  const halfBaths = num(half) ?? 0;
  if (fullBaths === null || halfBaths < 0 || halfBaths > 2) return null;
  return fullBaths + halfBaths * 0.5;
};

let listCache: { fetchedAt: number; neighborhoods: Json[] } | null = null;
export function resetDreesCaches(): void { listCache = null; }

/** The page's own ids from its inline script; null when the page does not name a neighborhood or parent community. */
export function parseDreesPage(html: string): { contentId: number; parent: boolean; url: string | null } | null {
  const id = /\bvar\s+contentId\s*=\s*(\d+)\s*;/.exec(html);
  if (!id) return null;
  const neighborhood = /\bvar\s+isNeighborhoodPage\s*=\s*true\b/.test(html);
  const parent = /\bvar\s+isCommunityPage\s*=\s*true\b/.test(html);
  if (!neighborhood && !parent) return null;
  // The page's own `var url` sits in the script block that declares `contentId`, never a tracking snippet's.
  const scriptStart = html.lastIndexOf("<script", id.index);
  const scriptEnd = html.indexOf("</script", id.index);
  const block = scriptStart >= 0 && scriptEnd > scriptStart ? html.slice(scriptStart, scriptEnd) : html.slice(Math.max(0, id.index - 2_000), id.index + 2_000);
  const url = /\bvar\s+url\s*=\s*"([^"]+)"/.exec(block);
  return { contentId: Number(id[1]), parent, url: url ? url[1]! : null };
}

/**
 * "Move-in date: Jan 23, 2027" names a month; a date that has passed is an
 * undated quick move-in (the site never says "ready"); no date is the same.
 * Other wording gives no status (the run is held).
 */
export function dreesStatus(moveInDate: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (moveInDate ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const match = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text) ?? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) return { status: null, readyNow: false, moveInDate: null };
  const month = /^\d/.test(match[1]!) ? Number(match[1]) : MONTHS[match[1]!.toLowerCase()] ?? null;
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month === null || month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > now.getUTCFullYear() + 5) return { status: null, readyNow: false, moveInDate: null };
  if (Date.UTC(year, month - 1, day) <= now.getTime()) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${MONTH_NAMES[month - 1]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type DreesCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };
export type DreesNeighborhood = { contentId: number; url: string; parent: boolean; qmiCount: number | null; planCount: number | null; caption: string | null; record: DreesCommunityRecord };

/** The market's neighborhoods from the community body; null when the body is not the list. */
export function parseDreesNeighborhoods(body: string, host: string): DreesNeighborhood[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const rows = obj(obj(parsed)?.data)?.neighborhoods;
  if (!Array.isArray(rows)) return null;
  const out: DreesNeighborhood[] = [];
  for (const raw of rows) {
    const row = obj(raw);
    const id = num(row?.contentId);
    const name = str(row?.neighborhoodName) ?? str(row?.communityName);
    const path = str(row?.url);
    const url = path ? asUrl(new URL(path, `https://${host}/`).toString()) : null;
    if (!row || id === null || !Number.isInteger(id) || !name || !url || !sameOfficialHost(url, host)) continue;
    const street = str(row.address);
    const lat = num(row.lat);
    const lng = num(row.lng);
    out.push({
      contentId: id, url: `${url.origin}${url.pathname}`, parent: row.isCommunity === true, qmiCount: num(row.qmiCount), planCount: num(row.planCount), caption: str(row.caption),
      record: {
        name,
        street: looksLikeStreetAddress(street) ? street : null,
        city: str(row.cityName),
        zip: /^\d{5}/.exec(str(row.zipCode) ?? "")?.[0] ?? null,
        phone: (str(row.modelPhone) ?? str(row.nhsPhoneNumber) ?? "").replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "") || null,
        priceFrom: positive(row.priceLow),
        geo: lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
      },
    });
  }
  return out;
}

/** A parent community's record takes the sales address of its first sub-neighborhood (the parent row names none). */
export function withParentAddress(rows: DreesNeighborhood[]): DreesNeighborhood[] {
  return rows.map((row) => {
    if (!row.parent || row.record.street) return row;
    const base = new URL(row.url).pathname.toLowerCase();
    const child = rows.find((other) => other !== row && !other.parent && other.record.street && new URL(other.url).pathname.toLowerCase().startsWith(base));
    return child ? { ...row, record: { ...row.record, street: child.record.street, city: row.record.city ?? child.record.city, zip: row.record.zip ?? child.record.zip, phone: row.record.phone ?? child.record.phone, geo: row.record.geo ?? child.record.geo } } : row;
  });
}

/** The San Antonio market's page id from the areas body; null when the body is not the list or names no such market. */
export function parseDreesAreaId(body: string): number | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const area = arr(obj(parsed)?.data).map(obj).find((row) => row && (str(row.areaName) ?? "").toLowerCase() === DREES_AREA_NAME.toLowerCase());
  const id = num(area?.pageId);
  return id !== null && Number.isInteger(id) && id > 0 ? id : null;
}

export type DreesHomes = { homes: PrivatePlanOrHome[]; listed: number; total: number | null; foreignHome: boolean; offer: string | null };

/** The homes (and the market's promotions) from the qmi body; null when the body is not the list. */
export function parseDreesHomes(body: string, communityPage: string, now: Date): DreesHomes | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const data = obj(obj(parsed)?.data);
  if (!data || !Array.isArray(data.homes)) return null;
  const community = asUrl(communityPage);
  if (!community) return null;
  const base = `${comparablePath(community.pathname.replace(/\/+$/, ""))}/`;
  const homes: PrivatePlanOrHome[] = [];
  let foreignHome = false;
  for (const raw of data.homes) {
    const home = obj(raw);
    if (!home) continue;
    // A build-on-your-lot listing is a plan on the buyer's land, not a home for sale.
    if (home.isBoylHome === true) continue;
    const street = str(home.address);
    const path = str(home.url);
    const page = path ? asUrl(new URL(path, community).toString()) : null;
    // The home's page sits under this community's path (a parent's under its sub-neighborhoods'); another community's home is never this one's.
    const under = Boolean(page && sameOfficialHost(page, community.hostname) && comparablePath(page.pathname).startsWith(base));
    if (page && sameOfficialHost(page, community.hostname) && !under) foreignHome = true;
    const readable = looksLikeStreetAddress(street) && under;
    const status = dreesStatus(str(home.moveInDate), now);
    const price = positive(home.discountedPrice) ?? positive(home.priceLow);
    const before = positive(home.actualPrice);
    const city = str(home.cityName);
    const zip = /^\d{5}/.exec(str(home.zipCode) ?? "")?.[0] ?? null;
    const model = home.isModelHome === true;
    homes.push({
      sourceUrl: readable ? `${page!.origin}${page!.pathname}` : `${community.origin}${community.pathname.replace(/\/+$/, "")}/unreadable-${homes.length}`,
      privateName: street,
      privateAddress: street ? `${street}, ${city ? `${city}, ${zip ? `TX ${zip}` : "TX"}` : "TX"}` : null,
      privatePlanName: str(home.planName),
      // A model home is not for sale (the sync leaves a "Model" home out).
      status: !readable ? null : model ? "Model" : status.status,
      price,
      previousPrice: before && price && before > price ? before : null,
      priceDrop: before && price && before > price ? before - price : null,
      bedrooms: num(home.bedLow),
      bathrooms: bathCount(home.bathLow, home.halfBathLow),
      squareFeet: positive(home.sqFtLow),
      garage: num(home.garagesLow),
      readyNow: false,
      moveInDate: model ? null : status.moveInDate,
      gallery: [],
    });
  }
  return { homes, listed: data.homes.length, total: num(data.filteredRecords), foreignHome, offer: dreesOfferText(data.promos) };
}

/** The plans from the plan body (available ones, prices unless suppressed); null when the body is not the list. */
export function parseDreesPlans(body: string, communityPage: string): { plans: PrivatePlanOrHome[]; foreignPlan: boolean } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const data = obj(obj(parsed)?.data);
  if (!data || !Array.isArray(data.plans)) return null;
  const community = asUrl(communityPage);
  if (!community) return null;
  const base = `${comparablePath(community.pathname.replace(/\/+$/, ""))}/`;
  const plans: PrivatePlanOrHome[] = [];
  let foreignPlan = false;
  for (const raw of data.plans) {
    const plan = obj(raw);
    const name = plan ? str(plan.planName) ?? str(plan.address) : null;
    const path = plan ? str(plan.url) : null;
    const page = path ? asUrl(new URL(path, community).toString()) : null;
    if (!plan || !name || !page || !sameOfficialHost(page, community.hostname)) continue;
    if (!comparablePath(page.pathname).startsWith(base)) { foreignPlan = true; continue; }
    if (plan.isPlanAvailable === false) continue;
    plans.push({
      sourceUrl: `${page.origin}${page.pathname}`,
      privateName: name,
      privatePlanName: name,
      status: null,
      price: plan.suppressPrice === true ? null : positive(plan.priceLow),
      bedrooms: num(plan.bedLow),
      bathrooms: bathCount(plan.bathLow, plan.halfBathLow),
      squareFeet: positive(plan.sqFtLow),
      garage: num(plan.garagesLow),
      readyNow: false,
      gallery: [],
    });
  }
  return { plans, foreignPlan };
}

/** The market's promotions as one offer text: the one naming a rate first, else the first; inactive ones left out; null when none. */
export function dreesOfferText(promos: unknown): string | null {
  const texts = arr(promos).map(obj).filter((promo): promo is Json => promo !== null && promo.inactive !== true).map((promo) => {
    const parts = [str(promo.title), htmlToText(String(promo.description ?? ""))].filter(Boolean).map((part) => part!.replace(/\*+/g, "").replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ").replace(/\(?\b\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim()).filter(Boolean);
    return parts.map((part) => /[.!?]$/.test(part) ? part : `${part}.`).join(" ");
  }).filter(Boolean);
  if (!texts.length) return null;
  return texts.find((text) => parsePromotionalRate(text).rateKind !== "none") ?? texts[0]!;
}

/** The San Antonio market's neighborhoods, read once an hour (areas, then the community list). */
async function marketNeighborhoods(fetcher: HtmlFetcher, now: number): Promise<{ neighborhoods: Json[] } | { hold: DealHoldReason }> {
  if (listCache && now - listCache.fetchedAt < LIST_CACHE_MS) return { neighborhoods: listCache.neighborhoods };
  const areas = await getDocument(dreesListingUrl(), fetcher, "application/json", DREES_HOST);
  if (!areas.ok) return { hold: fetchFailureHold(areas, "community_fetch_failed") };
  const areaId = parseDreesAreaId(areas.text);
  if (areaId === null) return { hold: "expected_community_container_not_found" };
  const list = await postJsonDocument(dreesApiUrl("community"), fetcher, { contentId: areaId, ...PAGE }, DREES_HOST);
  if (!list.ok) return { hold: fetchFailureHold(list, "community_fetch_failed") };
  let parsed: unknown;
  try { parsed = JSON.parse(list.text); } catch { return { hold: "expected_community_container_not_found" }; }
  const rows = obj(obj(parsed)?.data)?.neighborhoods;
  if (!Array.isArray(rows)) return { hold: "expected_community_container_not_found" };
  const neighborhoods = rows.map(obj).filter((row): row is Json => row !== null);
  listCache = { fetchedAt: now, neighborhoods };
  return { neighborhoods };
}

export class DreesAdapter implements DealAdapter {
  readonly builder = "Drees Custom Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, DREES_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", DREES_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const own = parseDreesPage(page.text);
    // Without the page's own id and kind this is not a community page.
    if (!own) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The page must be this community's (a same-host redirect to another one is not).
    if (own.url) {
      const ownUrl = asUrl(new URL(own.url, community).toString());
      if (!ownUrl || comparablePath(ownUrl.pathname.replace(/\/+$/, "")) !== comparablePath(community.pathname.replace(/\/+$/, ""))) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    }
    const market = await marketNeighborhoods(fetcher, now().getTime());
    if ("hold" in market) return failedResult(config, fetchedAt, privateSnapshot, [market.hold]);
    const listed = withParentAddress(parseDreesNeighborhoods(JSON.stringify({ data: { neighborhoods: market.neighborhoods } }), DREES_HOST) ?? []);
    const row = listed.find((item) => item.contentId === own.contentId);
    // The market list must name the page's community, with its own URL and its sales address. A parent community's
    // row names no address of its own, and its sub-neighborhoods need not be listed (Haby Hill on October 20, 2026:
    // the parent row only, its homes under haby-hill-50s/ and -60s/): a parent row is accepted on its id, its URL and
    // the page's own word that it is a parent, and its home count still corroborates the homes read below.
    if (!row || (!row.record.street && !(row.parent && own.parent))) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (comparablePath(new URL(row.url).pathname.replace(/\/+$/, "")) !== comparablePath(community.pathname.replace(/\/+$/, ""))) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    const communityPage = `${community.origin}${community.pathname.replace(/\/+$/, "")}/`;
    const [homesBody, plansBody] = await Promise.all([
      postJsonDocument(dreesApiUrl("qmi"), fetcher, { contentId: own.contentId, ...PAGE }, DREES_HOST),
      postJsonDocument(dreesApiUrl("plan"), fetcher, { contentId: own.contentId, ...PAGE }, DREES_HOST),
    ]);
    if (!homesBody.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(homesBody, "community_fetch_failed")]);
    const homes = parseDreesHomes(homesBody.text, communityPage, now());
    if (!homes) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (homes.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // The list must be whole: the query's own total, and the market list's count of homes for sale, never exceed it.
    if (homes.homes.length > DREES_MAX_HOMES || (homes.total !== null && homes.listed < homes.total) || (row.qmiCount !== null && homes.homes.length < row.qmiCount)) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    if (!plansBody.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(plansBody, "community_fetch_failed")]);
    const plans = parseDreesPlans(plansBody.text, communityPage);
    if (!plans) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (plans.foreignPlan) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    privateSnapshot.communityFacts = { fromPrice: row.record.priceFrom && row.record.priceFrom >= 50_000 ? row.record.priceFrom : null, schoolDistrict: null, lotSizes: null, amenities: [] };
    for (const home of homes.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of plans.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    privateSnapshot.offerRead = true;
    if (homes.offer) { privateSnapshot.pages.push(sourcePage("incentive", dreesApiUrl("qmi"), null)); privateSnapshot.incentive = { sourceUrl: communityPage, text: homes.offer, facts: parsePromotionalRate(homes.offer) }; }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}

/** The market's neighborhoods for discovery: every listed neighborhood or parent community with its record (parents' sub-neighborhoods are their own pages too). */
export async function dreesDiscoveryEntries(fetcher: HtmlFetcher, now: number): Promise<Array<{ url: string; record: DreesCommunityRecord | null }> | null> {
  const market = await marketNeighborhoods(fetcher, now);
  if ("hold" in market) return null;
  const listed = withParentAddress(parseDreesNeighborhoods(JSON.stringify({ data: { neighborhoods: market.neighborhoods } }), DREES_HOST) ?? []);
  // Each neighborhood is its own page; a parent community's page would show the same homes a second time (and the research list carries the
  // sub-neighborhood URLs), so parents are left out. A row without a sales address, or captioned "Coming Soon", has nothing to read yet.
  return listed.filter((row) => !row.parent && row.record.street && !/coming\s+soon/i.test(row.caption ?? "")).map((row) => ({ url: row.url, record: row.record }));
}
