import {
  PERRY_HOST, asUrl, emptyPrivate, failedResult, fetchFailureHold, getDocument, makePublicSnapshot, parseCommunityFacts, parseSitemapUrls, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlFetcher, type PrivateDealSnapshot, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * PERRY HOMES reader. Perry's site is a Next.js app: the community, collection
 * ("Cibolo Valley Heights 65'") and home pages are served with their data in
 * the React Flight payload (`self.__next_f.push` script tags), and the single
 * sitemap lists every home and plan page. Read-only, plain GET, official host
 * only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - community:  /new-homes/texas/san-antonio/<community>
 * - collection: /new-homes/texas/san-antonio/<community>/<community>-65
 * - home:       .../<collection>/119-kramm-trail      (an address slug)
 * - plan:       .../<collection>/2206h                (a design id slug)
 * - sales center: .../<collection>/sales-center       (skipped)
 */
const PERRY_SITEMAP = "https://www.perryhomes.com/sitemap.xml";
/** The sitemap is one 8,000-URL document; read it once an hour, not once per community. */
const SITEMAP_CACHE_MS = 60 * 60_000;
let sitemapCache: { urls: string[]; fetchedAt: number } | null = null;
/** A community (all its collections) with more home and plan pages than this is held, never truncated. */
export const PERRY_MAX_DETAIL_PAGES = 150;

/** Test seam only. */
export function resetPerrySitemapCache() {
  sitemapCache = null;
}

/** The decoded React Flight payload: every `self.__next_f.push([1,"..."])` chunk, unescaped and joined. */
export function decodeFlightPayload(html: string): string {
  const parts: string[] = [];
  for (const match of Array.from(html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g))) {
    try { parts.push(JSON.parse(match[1]!) as string); } catch { /* a chunk that is not a plain string carries no data we read */ }
  }
  return parts.join("");
}

const unquote = (value: string) => value.replace(/\\"/g, "\"").replace(/\\u0026/g, "&").replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\\\/g, "\\");
/** A string field; Flight writes an absent value as "$undefined", which is no value. */
const str = (source: string, key: string): string | null => { const match = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(source); const value = match ? unquote(match[1]!) : null; return value === null || value.startsWith("$undefined") ? null : value; };
/** A number field, written bare (650000) or as a quoted figure ("$650,000"). */
const int = (source: string, key: string): number | null => {
  const match = new RegExp(`"${key}":(?:(-?\\d+(?:\\.\\d+)?)|"\\$?\\s*(\\d[\\d,]*(?:\\.\\d+)?)")`).exec(source);
  if (!match) return null;
  const value = Number((match[1] ?? match[2]!).replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};

/** The end of the object that starts (or continues) at `from`: the first closing brace not matched by an opening one, ignoring braces inside strings. */
function objectEnd(source: string, from: number, limit: number): number {
  let depth = 0;
  let inString = false;
  for (let index = from; index < Math.min(source.length, from + limit); index++) {
    const char = source[index]!;
    if (inString) { if (char === "\\") index += 1; else if (char === "\"") inString = false; continue; }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") { if (depth === 0) return index; depth -= 1; }
  }
  return Math.min(source.length, from + limit);
}

const titleCase = (value: string) => value.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export type PerrySlugKind = "home" | "plan" | "collection" | "other";

/** What a path under the community is: a home (address slug), a plan (design id), a collection, or something else. */
export function perrySlugKind(pathname: string, communityPath: string): PerrySlugKind {
  const base = communityPath.replace(/\/+$/, "");
  if (!pathname.startsWith(`${base}/`)) return "other";
  const parts = pathname.slice(base.length).split("/").filter(Boolean);
  if (parts.length === 1) return /^[a-z0-9-]+$/i.test(parts[0]!) ? "collection" : "other";
  if (parts.length !== 2) return "other";
  const slug = parts[1]!.toLowerCase();
  if (slug === "sales-center" || slug.startsWith("sales-center")) return "other";
  if (/^\d{3,5}[a-z]{1,2}$/.test(slug)) return "plan";
  if (/^\d+[a-z]?-[a-z0-9-]*[a-z][a-z0-9-]*$/.test(slug)) return "home";
  return "other";
}

export type PerryHome = PrivatePlanOrHome & { kind: "home" | "plan"; designId: string | null };

/**
 * One home or plan page. The home's own object sits in the Flight payload as
 * `"address":{...},"home_details":{"baths":..,"bedrooms":..,...,"price":..,
 * "price_discounted":..,"sq_ft":..},...,"move_in_ready_display_status":..,
 * "home_title":..,"home_url":"<path>",...,"badge":..,...,"design_id":..`.
 * Null when the page carries no object for this path (a layout change holds
 * the run rather than publishing a guess).
 */
export function parsePerryDetail(html: string, pageUrl: string): PerryHome | null {
  const url = asUrl(pageUrl);
  if (!url) return null;
  const flight = decodeFlightPayload(html);
  const path = url.pathname.replace(/\/+$/, "");
  const anchor = flight.indexOf(`"home_url":"${path}"`);
  if (anchor < 0) return null;
  const detailsStart = flight.lastIndexOf("\"home_details\":{", anchor);
  if (detailsStart < 0 || anchor - detailsStart > 60_000) return null;
  const before = flight.slice(detailsStart, anchor);
  // Only this home's own object is read after the anchor: a related-homes list further on carries other homes' badges.
  const after = flight.slice(anchor, objectEnd(flight, anchor, 3_000));
  const addressBlockStart = flight.lastIndexOf("\"address\":{", detailsStart);
  const addressBlock = addressBlockStart >= 0 && detailsStart - addressBlockStart < 400 ? flight.slice(addressBlockStart, detailsStart) : "";
  const price = int(before, "price");
  const discounted = int(before, "price_discounted");
  const sqft = int(before, "sq_ft");
  const beds = int(before, "bedrooms");
  const baths = int(before, "baths");
  const garage = int(before, "garage");
  const badge = str(after, "badge") ?? str(before, "move_in_ready_display_status");
  const homeTitle = str(after, "home_title") ?? str(before, "home_title");
  const designTitle = str(after, "designTitle");
  const designId = str(after, "design_id") ?? designTitle ?? null;
  const street = str(addressBlock, "address_1");
  const city = str(addressBlock, "city");
  const zip = str(addressBlock, "zip");
  const kind: "home" | "plan" = street ? "home" : "plan";
  // The object is present: a missing or zero price ("call for pricing") keeps the home with no price, as the other readers do.
  const listPrice = price && price > 0 ? price : null;
  const salePrice = discounted && discounted > 0 ? discounted : listPrice;
  const moveIn = badge ? /^(?:[A-Z][a-z]+|[A-Z]+)\s+move[- ]?in$/i.exec(badge.trim()) : null;
  const readyNow = /move[- ]?in\s+ready/i.test(badge ?? "");
  // The sync publishes a home as a quick move-in only when the status says so; Perry's badges are "Move-In Ready" or "<Month> Move-In".
  const status = kind === "plan"
    ? (badge?.trim() || "Available to Build")
    : readyNow ? "Quick Move-In (Move-In Ready)" : moveIn ? `Quick Move-In (${badge!.trim()})` : /sold/i.test(badge ?? "") ? "Sold" : null;
  const gallery = parsePerryGallery(flight, kind === "home" ? str(before, "home_details_id") ?? str(after, "home_details_id") : null, designId);
  return {
    kind,
    designId,
    sourceUrl: url.toString(),
    privateName: kind === "home" ? (homeTitle || street) : (designTitle || designId ? `Design ${designTitle || designId}` : null),
    privateAddress: kind === "home" && street ? [street, [city, zip ? `TX ${zip}` : "TX"].filter(Boolean).join(", ")].filter(Boolean).join(", ") : null,
    privatePlanName: designId ? `Design ${designId}` : null,
    status,
    price: salePrice ?? null,
    previousPrice: listPrice && salePrice && listPrice > salePrice ? listPrice : null,
    priceDrop: listPrice && salePrice && listPrice > salePrice ? listPrice - salePrice : null,
    bedrooms: beds,
    bathrooms: baths,
    squareFeet: sqft,
    garage,
    readyNow,
    moveInDate: moveIn ? titleCase(badge!.trim().replace(/\s+move[- ]?in$/i, "")) : null,
    gallery,
  };
}

/**
 * The home's own photos: Cloudinary images whose metadata carries this home's
 * job number. A plan gets the design's representative images. Never the
 * floor-plan drawing (it shows the plan name).
 */
export function parsePerryGallery(flight: string, jobNumber: string | null, designId: string | null): PrivateGalleryImage[] {
  const own = collectPerryImages(flight, jobNumber, designId);
  // A home still under construction has no photos of its own yet: the design's representative images stand in.
  return own.length || !jobNumber ? own : collectPerryImages(flight, null, designId);
}

function collectPerryImages(flight: string, jobNumber: string | null, designId: string | null): PrivateGalleryImage[] {
  const images: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const match of Array.from(flight.matchAll(/"secure_url":"(https:\/\/res\.cloudinary\.com\/perryhomes\/image\/upload\/[^"]+\.(?:jpe?g|png|webp))","width":(\d+),"height":(\d+)[^}]*?"metadata":\{((?:[^{}]|\{[^{}]*\})*)\}/g))) {
    const [, secureUrl, width, height, metadata] = match;
    if (!secureUrl || seen.has(secureUrl)) continue;
    const types = str(metadata!, "type") ?? (/"type":\["([^"]*)"/.exec(metadata!)?.[1] ?? "");
    if (/floor_plan|floorplan/i.test(metadata!) || /floor_plan/i.test(types)) continue;
    const job = /"job_number":"([^"]*)"/.exec(metadata!)?.[1] ?? null;
    const design = /"design_id":"([^"]*)"/.exec(metadata!)?.[1] ?? null;
    const ownPhoto = jobNumber ? job === jobNumber : false;
    const designPhoto = !jobNumber && designId && design && design.toLowerCase() === designId.toLowerCase() && !job;
    if (!ownPhoto && !designPhoto) continue;
    seen.add(secureUrl);
    images.push({ sourceUrl: secureUrl, caption: ownPhoto ? null : "Representative image", width: Number(width) || null, height: Number(height) || null, srcSet: null });
  }
  return images;
}

/** Collection pages under the community ("…-65"), from the sitemap. */
async function perrySitemapUrls(fetcher: HtmlFetcher, snapshot: PrivateDealSnapshot, now: number): Promise<{ urls: string[]; holds: DealHoldReason[] }> {
  if (sitemapCache && now - sitemapCache.fetchedAt < SITEMAP_CACHE_MS) return { urls: sitemapCache.urls, holds: [] };
  const page = await getDocument(PERRY_SITEMAP, fetcher, "application/xml,text/xml", PERRY_HOST);
  if (!page.ok) return { urls: [], holds: [fetchFailureHold(page, "sitemap_fetch_failed")] };
  snapshot.pages.push(sourcePage("sitemap", PERRY_SITEMAP, null));
  const parsed = parseSitemapUrls(page.text);
  if (!parsed || !parsed.length) return { urls: [], holds: ["sitemap_fetch_failed"] };
  sitemapCache = { urls: parsed, fetchedAt: now };
  return { urls: parsed, holds: [] };
}

export class PerryHomesAdapter implements DealAdapter {
  readonly builder = "Perry Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, PERRY_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", PERRY_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    // The community page carries its collections in the Flight payload; without them this is not a community page.
    const flight = decodeFlightPayload(page.text);
    if (!flight.includes("\"section_title\"") && !flight.includes("\"section_url\"")) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    privateSnapshot.communityFacts = parseCommunityFacts(page.text);
    const communityPath = community.pathname.replace(/\/+$/, "");
    const sitemap = await perrySitemapUrls(fetcher, privateSnapshot, now().getTime());
    if (sitemap.holds.length) return failedResult(config, fetchedAt, privateSnapshot, sitemap.holds);
    const detailUrls: Array<{ url: URL; kind: "home" | "plan" }> = [];
    for (const raw of sitemap.urls) {
      const url = asUrl(raw);
      if (!url || !sameOfficialHost(url, PERRY_HOST)) continue;
      const kind = perrySlugKind(url.pathname.replace(/\/+$/, ""), communityPath);
      if (kind === "home" || kind === "plan") detailUrls.push({ url, kind });
    }
    // A community with more detail pages than the cap is held, never truncated: a partial snapshot could mark real homes sold.
    if (detailUrls.length > PERRY_MAX_DETAIL_PAGES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const seen = new Set<string>();
    for (const { url, kind } of detailUrls) {
      const key = url.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const detail = await getDocument(key, fetcher, "text/html,application/xhtml+xml", PERRY_HOST);
      if (!detail.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(detail, "detail_fetch_failed")]);
      const parsed = parsePerryDetail(detail.text, key);
      if (!parsed) return failedResult(config, fetchedAt, privateSnapshot, ["expected_detail_container_not_found"]);
      privateSnapshot.pages.push(sourcePage(kind, key, parsed.privateName));
      const { kind: _kind, designId: _designId, ...item } = parsed;
      if (parsed.kind === "plan") privateSnapshot.plans.push({ ...item, status: null });
      else privateSnapshot.homes.push(item);
    }
    // Perry's promotions are site-wide banners with their own terms pages; none is read as a community incentive here.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
