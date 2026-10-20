import {
  KBHOME_HOST, asUrl, comparablePath, decodeHtmlEntities, emptyPrivate, failedResult, getDocument, makePublicSnapshot, parseCommunityFacts, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";
import { jsonLdRecords } from "./dealsAdapters.homefiniti";

/**
 * KB HOME reader. The community page is server-rendered (about 1 MB) and
 * carries its inventory as three JavaScript arrays in an inline script:
 * `FloorPlanList = [...]` (the plans: `name` "Plan 2246", `pricedFrom`
 * "224995" or null, `bedroomsMin`, `bathroomsMin`, `garagesMin`, `size`,
 * `thumbnailImage.image`, `pageUrl`), `LocalQMIs = [...]` (the move-in ready
 * homes: `address`, `price` "281002", `bedrooms`, `bathrooms`, `garages`,
 * `size`, `homesite`, `floorPlanLink` = plan id, `moveInDateCopy` "Available
 * Now", `websitePhotos[].image`, `pageUrl` ".../mir?homesite=1373580") and
 * `LocalMIR` (a copy of the plans). Numbers are strings. The community's own
 * record is a schema.org `Place` in an `@graph` with `@id` ending `#community`
 * (address, phone, geo, nearby schools). Read-only, plain GET, official host
 * only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - community: /new-homes-san-antonio/<slug>
 * - plan:      /new-homes-san-antonio/<slug>/plan-<sqft>[-modeled]
 * - home:      /new-homes-san-antonio/<slug>/mir?homesite=<id>
 */
/** A community with more homes for sale than this is held, never truncated. */
export const KBHOME_MAX_HOMES = 150;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : null;
const num = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const MONTHS: Record<string, string> = { jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June", jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December" };

/**
 * One of the page's inline arrays (`LocalQMIs = [...]`), read by matching
 * brackets outside strings and parsing the slice as JSON; null when the page
 * does not carry it or it is not JSON. The array may be assigned more than
 * once (an empty initialiser before the real list): the fullest assignment is
 * the list, and two non-empty assignments that disagree are no list at all.
 */
export function parseKbArray(html: string, name: string): unknown[] | null {
  const assignments: unknown[][] = [];
  for (const match of Array.from(html.matchAll(new RegExp(`\\b${name}\\s*=\\s*\\[`, "g")))) {
    const start = match.index! + match[0].length - 1;
    let depth = 0;
    for (let index = start; index < html.length; index++) {
      const char = html[index];
      if (char === '"') {
        index++;
        while (index < html.length && html[index] !== '"') { if (html[index] === "\\") index++; index++; }
        continue;
      }
      if (char === "[" || char === "{") depth++;
      else if (char === "]" || char === "}") {
        depth--;
        if (depth === 0) {
          try { const parsed: unknown = JSON.parse(html.slice(start, index + 1)); if (Array.isArray(parsed)) assignments.push(parsed); } catch { return null; }
          break;
        }
      }
    }
  }
  if (!assignments.length) return null;
  const filled = assignments.filter((list) => list.length);
  if (filled.length > 1 && filled.some((list) => JSON.stringify(list) !== JSON.stringify(filled[0]))) return null;
  return filled[0] ?? assignments[0]!;
}

/** "Move-in Ready (3)" on the page: how many homes the page says it shows; null when the page does not say. */
export function kbMoveInCount(html: string, emptyList = false): number | null {
  // The page may count twice ("Move-in Ready (57)" in the market navigation, "(3)" over the community's own list): the smaller is the
  // community's; a "(0)" corroborates an empty list, and says nothing beside a list that is not empty.
  // The community's own count heads its list (a heading); the market's sits in the navigation. A "(0)" corroborates an empty list only as a
  // heading, or when no positive count stands anywhere beside it: a "(0)" in another market's navigation next to the community's own "(3)" says nothing.
  const headed = Array.from(html.matchAll(/<h[1-6]\b[^>]*>(?:(?!<\/h[1-6])[\s\S])*?Move-?in\s+Ready\s*\((\d+)\)/gi)).map((match) => Number(match[1]));
  const headedPositive = headed.filter((count) => count > 0);
  if (headedPositive.length) return Math.min(...headedPositive);
  if (emptyList && headed.includes(0)) return 0;
  const counts = Array.from(html.matchAll(/Move-?in\s+Ready\s*\((\d+)\)/gi)).map((match) => Number(match[1]));
  const positive = counts.filter((count) => count > 0);
  if (emptyList && counts.includes(0) && !positive.length) return 0;
  return positive.length ? Math.min(...positive) : null;
}

/**
 * "Available Now" is ready; "Nov 2026" or "Est. completion November 2026"
 * names a month (a past one is a stale estimate: no date); only sale words
 * sell ("pending" in a date field is an unknown date); other wording gives no
 * status (the run is held).
 */
export function kbStatus(copy: string | null, now: Date = new Date()): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (copy ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under\s+contract/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/^(?:available\s+now|move[- ]?in\s+ready|ready\s+now)!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const month = /^(?:est\.?\s*(?:completion)?\s*|available\s+|move[- ]?in\s+)?([A-Za-z]{3,9})\.?\s+(20\d{2})$/i.exec(text);
  const key = month ? month[1]!.toLowerCase().slice(0, 3) : "";
  const name = MONTHS[key];
  if (!month || !name) return { status: null, readyNow: false, moveInDate: null };
  const year = Number(month[2]);
  const index = Object.keys(MONTHS).indexOf(key);
  if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && index < now.getUTCMonth())) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  return { status: `Quick Move-In (${name} ${year})`, readyNow: false, moveInDate: `${name} ${year}` };
}

export type KbCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

/** The community's `Place` record (`@id` ending "#community") from the page's JSON-LD graph, for discovery and addresses. */
export function kbRecord(html: string): KbCommunityRecord | null {
  const place = jsonLdRecords(html).find((record) => (Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]]).includes("Place") && typeof record["@id"] === "string" && /#community$/.test(record["@id"] as string));
  const name = place ? str(place.name) : null;
  if (!place || !name) return null;
  const address = obj(place.address);
  const geo = obj(place.geo);
  const lat = num(geo?.latitude);
  const lng = num(geo?.longitude);
  return {
    name,
    street: str(address?.streetAddress),
    city: str(address?.addressLocality),
    zip: /^\d{5}/.exec(str(address?.postalCode) ?? "")?.[0] ?? null,
    phone: (str(place.telephone) ?? "").replace(/^\+1/, "").replace(/[^\d]/g, "") || null,
    priceFrom: null,
    geo: lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
  };
}

export type KbPage = {
  record: KbCommunityRecord | null;
  homes: PrivatePlanOrHome[];
  plans: PrivatePlanOrHome[];
  /** True when a home's page sits under another community's path on the host: not this community's inventory. */
  foreignHome: boolean;
  /** Home links the page renders (".../<slug>/mir?homesite=") and the "Move-in Ready (N)" count, to corroborate an empty list. */
  renderedHomeLinks: number;
  moveInCount: number | null;
};

function gallery(photos: unknown, host: string, representative: boolean): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(photos) ? photos : [photos]) {
    const photo = obj(raw);
    const path = photo ? str(photo.image) : null;
    if (!path) continue;
    const url = asUrl(new URL(path, `https://${host}/`).toString());
    // A drawing is named as one in its file name ("2246-floorplan.jpg"); KB keeps exterior photos in a "floor-plan" folder, which is not.
    if (!url || !sameOfficialHost(url, host)) continue;
    const file = url.pathname.split("/").at(-1) ?? "";
    if (/floor-?plan|site-?plan|elevation-drawing|\.svg$/i.test(file)) continue;
    url.search = "";
    if (seen.has(url.toString())) continue;
    seen.add(url.toString());
    out.push({ sourceUrl: url.toString(), caption: representative ? "Representative image" : str(photo!.caption), width: null, height: null, srcSet: null });
  }
  return out;
}

/**
 * The page's homes and plans. Null when the page carries neither array (not a
 * community page, or a new layout). A page with the plans but no `LocalQMIs`
 * array at all is a changed shape too; an empty `LocalQMIs = []` is a community
 * with nothing move-in ready. An entry without an address or link stays in the
 * list with no status, so the sync holds instead of sweeping it to sold.
 */
export function parseKbCommunity(html: string, pageUrl: string, now: Date = new Date()): KbPage | null {
  const community = asUrl(pageUrl);
  const qmis = parseKbArray(html, "LocalQMIs");
  const planList = parseKbArray(html, "FloorPlanList");
  if (!community || !qmis || !planList) return null;
  const host = community.hostname;
  const base = `${comparablePath(community.pathname.replace(/\/+$/, ""))}/`;
  let foreignHome = false;
  const record = kbRecord(html);
  const cityLine = record?.city ? `${record.city}, ${record.zip ? `TX ${record.zip}` : "TX"}` : null;
  const planNames = new Map<string, string>();
  const plans: PrivatePlanOrHome[] = [];
  for (const raw of planList) {
    const plan = obj(raw);
    if (!plan) continue;
    const name = str(plan.name) ?? str(plan.title);
    const id = str(plan.id) ?? (typeof plan.id === "number" ? String(plan.id) : null);
    if (name && id) planNames.set(id, name);
    const link = str(plan.pageUrl);
    const page = link ? asUrl(new URL(link, community).toString()) : null;
    if (!name || !page || !sameOfficialHost(page, host)) continue;
    const price = num(plan.pricedFrom);
    plans.push({
      sourceUrl: page.toString(),
      privateName: name,
      privatePlanName: name,
      status: null,
      price: price && price > 0 ? price : null,
      bedrooms: num(plan.bedroomsMin),
      bathrooms: num(plan.bathroomsMin),
      squareFeet: num(plan.size),
      garage: num(plan.garagesMin),
      readyNow: false,
      gallery: gallery(plan.thumbnailImage, host, true),
    });
  }
  const homes: PrivatePlanOrHome[] = [];
  for (const raw of qmis) {
    const home = obj(raw);
    if (!home) continue;
    const street = str(home.address);
    const link = str(home.pageUrl);
    const page = link ? asUrl(new URL(link, community).toString()) : null;
    // The home's page must sit under this community's own path.
    const underCommunity = Boolean(page && sameOfficialHost(page, host) && comparablePath(page.pathname).startsWith(base));
    if (page && sameOfficialHost(page, host) && !underCommunity) foreignHome = true;
    const readable = Boolean(street && underCommunity);
    const price = num(home.price);
    const status = kbStatus(str(home.moveInDateCopy), now);
    const planId = str(home.floorPlanLink) ?? (typeof home.floorPlanLink === "number" ? String(home.floorPlanLink) : null);
    const lot = str(home.homesite);
    homes.push({
      sourceUrl: readable ? page!.toString() : `${community.origin}${community.pathname.replace(/\/+$/, "")}/mir?homesite=unreadable-${homes.length}`,
      privateName: street,
      privateAddress: street && cityLine ? `${street}, ${cityLine}` : street,
      privatePlanName: planId ? planNames.get(planId) ?? null : null,
      status: readable && price ? status.status : null,
      price: price && price > 0 ? price : null,
      bedrooms: num(home.bedrooms),
      bathrooms: num(home.bathrooms),
      squareFeet: num(home.size),
      garage: num(home.garages),
      homesite: lot ? `Lot ${lot.replace(/^0+(?=\d)/, "")}` : null,
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      gallery: gallery(home.websitePhotos, host, false),
    });
  }
  // Only home links under this community's own path count (a nearby-homes strip links other communities' homes).
  const renderedHomeLinks = new Set(Array.from(html.matchAll(/href="([^"]*\/mir\?homesite=(\d+))"/gi)).filter((match) => { const page = asUrl(new URL(decodeHtmlEntities(match[1]!), community).toString()); return page && sameOfficialHost(page, host) && comparablePath(page.pathname).startsWith(base); }).map((match) => match[2]!)).size;
  return { record, homes, plans, foreignHome, renderedHomeLinks, moveInCount: kbMoveInCount(html, homes.length === 0 && renderedHomeLinks === 0) };
}

export class KbHomeAdapter implements DealAdapter {
  readonly builder = "KB Home" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, KBHOME_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", KBHOME_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseKbCommunity(page.text, community.toString(), now());
    // Without the inventory arrays or the community's own record this is not a community page.
    if (!parsed || !parsed.record?.street) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // An empty list is a community with nothing move-in ready only when the page shows no home links and counts none; a home under another community's path is never this one's.
    if (parsed.homes.length < parsed.renderedHomeLinks || (parsed.moveInCount !== null && parsed.homes.length < parsed.moveInCount)) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    if (parsed.homes.length > KBHOME_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    const planPrices = parsed.plans.map((plan) => plan.price).filter((price): price is number => price !== null);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? (planPrices.length ? Math.min(...planPrices) : null) };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    // The page's promotions are a monthly-payment disclaimer template and site-wide banners with no offer terms; none is read as an incentive.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
