import { PERRY_HOST, asUrl, getDocument, parseSitemapUrls, sameOfficialHost, type HtmlFetcher } from "./dealsAdapters";
import { decodeFlightPayload } from "./dealsAdapters.perry";
import type { CommunityRecord, ListingEntry } from "./dealsDiscovery";

/**
 * PERRY HOMES community finder (October 25, 2026, Peter: Austin). Perry's pages carry no schema.org record, so the
 * finder reads the Next.js Flight payload (`self.__next_f.push` chunks), as the Perry catalog reader does. Shapes
 * confirmed on the live Austin pages that day:
 *
 * 1. The sitemap names every community page as /new-homes/texas/<market>/<community>; collections ("Easton Park
 *    40'") sit one segment deeper, homes and plans two. One sitemap read an hour serves both markets.
 * 2. The community page names itself (`"community_name":"Easton Park"`, also `CommDisplayName`), lists its
 *    collections as `"url":"/new-homes/texas/austin/easton-park/easton-park-40"`, and prices each one
 *    (`"ranges_from_price_sq_ft":{"from_price":400000`). It carries no address and no coordinates.
 * 3. Each collection has a /sales-center page with the sales office: `"address":{"address_1","city","state","zip"}`,
 *    `"gps":{"latitude","longitude"}` and `"location_information":{...,"phone":[{"number"}]}`, in that order. A model
 *    home's address follows under `model_homeConnection`; the first block is the office. The office's exact point is
 *    the pin (the public grid cell coarsens it as for every builder).
 *
 * Read-only, plain GET, official host only; two page reads per new community.
 */
export const PERRY_MARKETS = { "san-antonio": "San Antonio", austin: "Austin" } as const;
export type PerryMarket = keyof typeof PERRY_MARKETS;

const PERRY_SITEMAP = "https://www.perryhomes.com/sitemap.xml";
const CACHE_MS = 60 * 60_000;
let cache: { urls: string[]; fetchedAt: number } | null = null;

/** Test seam only. */
export function resetPerryDiscoveryCache() {
  cache = null;
}

/** The community page path for a market: exactly /new-homes/texas/<market>/<community>. */
export function perryCommunityPath(market: PerryMarket): RegExp {
  return new RegExp(`^/new-homes/texas/${market}/(?!promotion|sales-center)[a-z0-9-]+/?$`, "i");
}

/** Every community page in a market, from the sitemap: the collection, home, plan and sales-center pages are left out. */
export async function perryMarketEntries(fetcher: HtmlFetcher, now: number, market: PerryMarket): Promise<ListingEntry[] | null> {
  if (!cache || now - cache.fetchedAt >= CACHE_MS) {
    const page = await getDocument(PERRY_SITEMAP, fetcher, "application/xml,text/xml", PERRY_HOST);
    if (!page.ok) return null;
    const parsed = parseSitemapUrls(page.text);
    if (!parsed || !parsed.length) return null;
    cache = { urls: parsed, fetchedAt: now };
  }
  const path = perryCommunityPath(market);
  const seen = new Set<string>();
  const entries: ListingEntry[] = [];
  for (const raw of cache.urls) {
    const url = asUrl(raw);
    if (!url || !sameOfficialHost(url, PERRY_HOST)) continue;
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!path.test(pathname) || seen.has(pathname)) continue;
    seen.add(pathname);
    entries.push({ url: `${url.origin}${pathname}`, record: null });
  }
  return entries;
}

const unquote = (value: string) => value.replace(/\\"/g, "\"").replace(/\\u0026/g, "&").replace(/\\\\/g, "\\");
/** A string field; Flight writes an absent value as "$undefined", which is no value. */
const str = (source: string, key: string): string | null => {
  const match = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(source);
  const value = match ? unquote(match[1]!) : null;
  return value === null || value.startsWith("$undefined") || !value.trim() ? null : value.trim();
};
const num = (source: string, key: string): number | null => {
  const match = new RegExp(`"${key}":(-?\\d+(?:\\.\\d+)?)`).exec(source);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
};

export type PerryCommunityPage = { name: string; sections: string[]; priceFrom: number | null };

/**
 * The community page's own facts: its name, its collection pages in page order, and the lowest collection price
 * (`from_price` of 0 is a blank). Null when the page is not a community page (no collection links under it).
 */
export function parsePerryCommunityPage(html: string, pageUrl: string): PerryCommunityPage | null {
  const url = asUrl(pageUrl);
  if (!url) return null;
  const communityPath = url.pathname.replace(/\/+$/, "");
  const flight = decodeFlightPayload(html);
  const sections: string[] = [];
  const sectionPath = new RegExp(`"url":"(${communityPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[a-z0-9-]+)"`, "gi");
  for (const match of Array.from(flight.matchAll(sectionPath))) {
    const path = match[1]!;
    if (!/\/(?:sales-center|promotion)/i.test(path) && !sections.includes(path)) sections.push(path);
  }
  if (!sections.length) return null;
  const name = str(flight, "community_name") ?? str(flight, "CommDisplayName") ?? titleFromSlug(communityPath.split("/").pop() ?? "");
  if (!name) return null;
  const prices = Array.from(flight.matchAll(/"ranges_from_price_sq_ft":\{"from_price":(\d+)/g), (match) => Number(match[1])).filter((value) => value >= 50_000);
  return { name, sections, priceFrom: prices.length ? Math.min(...prices) : null };
}

/** "easton-park" -> "Easton Park" (used only when the page does not name itself). */
function titleFromSlug(slug: string): string | null {
  const words = slug.split("-").filter(Boolean);
  return words.length ? words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ") : null;
}

export type PerrySalesCenter = { street: string; city: string | null; zip: string | null; geo: { lat: number; lng: number } | null; phone: string | null };

/**
 * The sales office on a collection's /sales-center page: the first `address` block, with the `gps` point and the
 * `location_information` phone that follow it. Null when the page has no office address.
 */
export function parsePerrySalesCenter(html: string): PerrySalesCenter | null {
  const flight = decodeFlightPayload(html);
  const start = flight.indexOf("\"address\":{\"address_1\":");
  if (start < 0) return null;
  // The office's own block: up to the model homes that follow it.
  const end = flight.indexOf("\"model_homeConnection\"", start);
  const block = flight.slice(start, end > start ? end : start + 4000);
  const address = /"address":\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(block)?.[1] ?? "";
  const street = str(address, "address_1");
  if (!street) return null;
  const state = str(address, "state");
  if (state && !/^(?:TX|Texas)$/i.test(state)) return null;
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(str(address, "zip") ?? "")?.[1] ?? null;
  const gps = /"gps":\{([^}]*)\}/.exec(block)?.[1] ?? "";
  const lat = num(gps, "latitude");
  const lng = num(gps, "longitude");
  const phoneDigits = (str(block, "number") ?? "").replace(/\D/g, "");
  const phone = phoneDigits.length === 10 ? `+1${phoneDigits}` : phoneDigits.length === 11 && phoneDigits.startsWith("1") ? `+${phoneDigits}` : null;
  return { street, city: str(address, "city"), zip, geo: lat !== null && lng !== null && (lat !== 0 || lng !== 0) ? { lat, lng } : null, phone };
}

/**
 * The community's record: name and lowest price from its page; street, city, ZIP, pin and phone from the first
 * collection's sales-center page (the next collection's when the first has none). Null when the page is not a
 * community page or no collection names its office yet.
 */
export async function perryCommunityRecord(html: string, pageUrl: string, fetcher: HtmlFetcher): Promise<CommunityRecord | null> {
  const page = parsePerryCommunityPage(html, pageUrl);
  if (!page) return null;
  const origin = asUrl(pageUrl)!.origin;
  for (const section of page.sections.slice(0, 3)) {
    const office = await getDocument(`${origin}${section}/sales-center`, fetcher, "text/html,application/xhtml+xml", PERRY_HOST);
    if (!office.ok) continue;
    const sales = parsePerrySalesCenter(office.text);
    if (!sales) continue;
    return { name: page.name, street: sales.street, city: sales.city, zip: sales.zip, phone: sales.phone, priceFrom: page.priceFrom, geo: sales.geo };
  }
  return null;
}
