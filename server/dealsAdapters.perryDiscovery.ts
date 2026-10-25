import { PERRY_HOST, asUrl, getDocument, parseSitemapUrls, sameOfficialHost, type HtmlFetcher } from "./dealsAdapters";
import { decodeFlightPayload, perrySlugKind } from "./dealsAdapters.perry";
import type { CommunityRecord, ListingEntry } from "./dealsDiscovery";

/**
 * PERRY HOMES community finder (October 25, 2026, Peter: Austin). Perry's pages carry no schema.org record and no
 * coordinates, so a community is placed from the street address its own home pages publish:
 *
 * 1. The sitemap names every community page as /new-homes/texas/<market>/<community> (collections and homes sit
 *    deeper), one read an hour for both markets.
 * 2. The community page's Flight payload lists its collections (`sections` with `section_url`) and its display name.
 * 3. The first home page under the first collection carries `"address":{"address_1","city","state","zip"}`: the
 *    community's street, city and ZIP. A community with plans only (no home page yet) has no address and is skipped;
 *    it is found again once a home is listed.
 * 4. The ZIP's centroid (the same geocoder the area map uses) stands for the pin: a few miles, which is all the
 *    market check and the public grid cell need. The exact home address is private operational data; discovery
 *    stores the street as the sales address the same way every other reader does.
 *
 * Read-only, plain GET, official host only.
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
const str = (source: string, key: string): string | null => {
  const match = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(source);
  const value = match ? unquote(match[1]!) : null;
  return value === null || value.startsWith("$undefined") || !value.trim() ? null : value.trim();
};

/** The community page's own facts: its display name and the collection pages it lists (first first). */
export function parsePerryCommunityPage(html: string, pageUrl: string): { name: string | null; sections: string[]; priceFrom: number | null } | null {
  const flight = decodeFlightPayload(html);
  if (!flight.includes("\"section_url\"") && !flight.includes("\"section_title\"")) return null;
  const sections: string[] = [];
  for (const match of Array.from(flight.matchAll(/"section_url":"((?:[^"\\]|\\.)*)"/g))) {
    const path = unquote(match[1]!);
    if (/^\/new-homes\/texas\//.test(path) && !sections.includes(path)) sections.push(path);
  }
  // "From the $560s" on the first collection: the low end of the band, as the card shows it.
  const band = /"from_price":"From the \$(\d{2,4})s"/.exec(flight);
  const priceFrom = band ? Number(band[1]) * 1000 : null;
  const slug = asUrl(pageUrl)?.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  const name = str(flight, "communityDisplayName") ?? str(flight, "community_display_name") ?? titleFromSlug(slug);
  return { name, sections, priceFrom: priceFrom && priceFrom >= 50_000 ? priceFrom : null };
}

/** "fixture-heights" -> "Fixture Heights" (used only when the page does not name itself). */
function titleFromSlug(slug: string): string | null {
  const words = slug.split("-").filter(Boolean);
  return words.length ? words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ") : null;
}

/** A home page's address block: `"address":{"address_1":"119 Kramm Trail","address_2":null,"city":"Cibolo","state":"TX","zip":"78108"}`. */
export function parsePerryHomeAddress(html: string): { street: string; city: string | null; zip: string | null } | null {
  const flight = decodeFlightPayload(html);
  const block = /"address":\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(flight)?.[1];
  if (!block) return null;
  const street = str(block, "address_1");
  if (!street || !/\d/.test(street)) return null;
  const state = str(block, "state");
  if (state && !/^(?:TX|Texas)$/i.test(state)) return null;
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(str(block, "zip") ?? "")?.[1] ?? null;
  return { street, city: str(block, "city"), zip };
}

/** The first home page under a collection, from the sitemap (an address slug, not a design id). */
function firstHomeUnder(section: string): string | null {
  if (!cache) return null;
  for (const raw of cache.urls) {
    const url = asUrl(raw);
    if (!url || !sameOfficialHost(url, PERRY_HOST)) continue;
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname.startsWith(`${section}/`)) continue;
    const communityPath = section.split("/").slice(0, 5).join("/");
    if (perrySlugKind(pathname, communityPath) === "home") return `${url.origin}${pathname}`;
  }
  return null;
}

/**
 * The community's record: name and price from its page, street, city and ZIP from its first home's page, and the
 * ZIP centroid for the pin. Null when the page is not a community page or no home page gives an address yet.
 */
export async function perryCommunityRecord(html: string, pageUrl: string, fetcher: HtmlFetcher, geocodeZip: (zip: string) => Promise<{ lat: number; lng: number } | null>): Promise<CommunityRecord | null> {
  const page = parsePerryCommunityPage(html, pageUrl);
  if (!page || !page.name) return null;
  let address: ReturnType<typeof parsePerryHomeAddress> = null;
  for (const section of page.sections.slice(0, 3)) {
    const homeUrl = firstHomeUnder(section);
    if (!homeUrl) continue;
    const home = await getDocument(homeUrl, fetcher, "text/html,application/xhtml+xml", PERRY_HOST);
    if (!home.ok) continue;
    address = parsePerryHomeAddress(home.text);
    if (address) break;
  }
  if (!address || !address.zip) return null;
  const geo = await geocodeZip(address.zip);
  return { name: page.name, street: address.street, city: address.city, zip: address.zip, phone: null, priceFrom: page.priceFrom, geo };
}
