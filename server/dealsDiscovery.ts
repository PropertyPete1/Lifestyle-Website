import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { dealCommunities, dealJobRuns } from "../drizzle/schema";
import { DOWNTOWN_SAN_ANTONIO, milesBetween } from "../shared/dealsArea";
import { normalizedDealSourceKey } from "../shared/deals";
import { getDb } from "./db";
import { sendBuilderDealsEmail } from "./dealsEmail";
import { chicagoDay, getDealSettings } from "./dealsService";
import { leaseBuilder } from "./dealsSync";
import { ASHTON_HOST, CENTURY_HOST, DRB_HOST, DREES_HOST, LEGEND_HOST, VIEWHOMES_HOST, TEXASHOMES_HOST, HAKES_HOST, BEAZER_HOST, LGI_HOST, SCOTTFELDER_HOST, STARLIGHT_HOST, SITTERLE_HOST, DAVIDSON_HOST, HIGHLAND_HOST, KBHOME_HOST, TOLL_HOST, WEEKLEY_HOST, HOMEFINITI_HOSTS, PULTEGROUP_HOSTS, asUrl, decodeHtmlEntities, getDocument, hasBuilderReader, parseSitemapUrls, sameOfficialHost, type BuilderId, type HtmlFetcher } from "./dealsAdapters";
import { parsePulteListing, pulteListingUrl, type PulteGroupBrand } from "./dealsAdapters.pultegroup";
import { homefinitiMarketLinks } from "./dealsAdapters.homefiniti";
import { davidsonMarketLinks, davidsonRecord } from "./dealsAdapters.davidson";
import { highlandRecord } from "./dealsAdapters.highland";
import { kbRecord } from "./dealsAdapters.kbhome";
import { tollListingEntries, tollListingUrl } from "./dealsAdapters.toll";
import { weekleyListingEntries, weekleyListingUrl, weekleyRecord } from "./dealsAdapters.weekley";
import { ashtonListingEntries, ashtonListingUrl, ashtonRecord } from "./dealsAdapters.ashton";
import { lgiListingEntries, lgiListingUrl, lgiRecord } from "./dealsAdapters.lgi";
import { sitterleListingEntries, sitterleListingUrl, sitterleRecord } from "./dealsAdapters.sitterle";
import { scottFelderListingEntries, scottFelderListingUrl, scottFelderRecord } from "./dealsAdapters.scottfelder";
import { DRB_API_HOST, drbListingEntries, drbListingUrl } from "./dealsAdapters.drb";
import { starlightListingEntries, starlightListingUrl, starlightRecord } from "./dealsAdapters.starlight";
import { LEGEND_API_HOST, legendListingEntries, legendListingUrl } from "./dealsAdapters.legend";
import { dreesDiscoveryEntries } from "./dealsAdapters.drees";
import { viewHomesListingEntries, viewHomesListingUrl } from "./dealsAdapters.viewhomes";
import { texasHomesListingEntries, texasHomesListingUrl, texasHomesRecord } from "./dealsAdapters.texashomes";
import { hakesListingEntries, hakesListingUrl, hakesRecord } from "./dealsAdapters.hakes";
import { beazerListingEntries, beazerListingUrl, beazerRecord } from "./dealsAdapters.beazer";
import { onboardDiscoveredCommunities, type DiscoveredCommunity, type OnboardingResult } from "./dealsOnboarding";

/**
 * FINDING EVERY COMMUNITY: each builder with a reader lists its San Antonio
 * area communities in its own sitemap, and every community page carries a
 * schema.org business record (name, sales address, phone). Discovery reads
 * those, keeps the ones within the area, and hands them to onboarding, which
 * adds new ones hidden until their first clean data pull. It never removes a
 * community: a builder's sitemap missing one is not proof it closed.
 */

/** Communities farther than this from downtown are outside the area we cover (San Marcos is). */
export const DISCOVERY_RADIUS_MILES = 45;
/** Community pages read per builder per run, one at a time. */
const MAX_COMMUNITY_PAGES = 120;
/** Sitemap documents read per builder per run. */
const MAX_SITEMAP_DOCUMENTS = 32;

export type DiscoveryReader = {
  builder: Exclude<BuilderId, "Manual">;
  host: string;
  /**
   * Where the builder lists its community pages: its sitemap, or (when the
   * sitemap is too large or missing) its own market listing. A listing entry
   * may carry the community's record itself; then its page is not read.
   */
  index: { kind: "sitemap"; url: string } | { kind: "listing"; url: string; accept: string; /** The listing's own host when the builder's API is not its site (default: the site). */ host?: string; entries: (body: string, host: string) => ListingEntry[] | null } | { kind: "reader"; /** The reader lists the market itself (several reads); null when it cannot. */ entries: (fetcher: HtmlFetcher, now: number) => Promise<ListingEntry[] | null> };
  /** Path of a community page in the builder's San Antonio market. */
  communityPath: RegExp;
  /** Reads the community's record from its page when the site has no schema.org record (default: communityRecordFromHtml). */
  record?: (html: string, pageUrl: string) => CommunityRecord | null;
};

export type ListingEntry = { url: string; record: CommunityRecord | null };

/** D.R. Horton's San Antonio market listing: `{ CommunityData: [{ commPageLink: "/texas/san-antonio/<city>/<community>", ... }] }`; the page carries the record. */
export function drhListingEntries(body: string, host: string): ListingEntry[] | null {
  try {
    const parsed = JSON.parse(body) as { CommunityData?: Array<{ commPageLink?: unknown }> };
    if (!Array.isArray(parsed.CommunityData)) return null;
    return parsed.CommunityData.flatMap((entry) => typeof entry.commPageLink === "string" ? [{ url: new URL(entry.commPageLink, `https://${host}/`).toString(), record: null }] : []);
  } catch {
    return null;
  }
}

/**
 * PulteGroup's market listing (all three brands in one): each entry carries the
 * community's name, sales address, phone, coordinates and starting price, so
 * no page is read (the pages run past 8 MB). Entries of the other brands point
 * at their own hosts and are left to those readers.
 */
export function pulteListingEntries(body: string, host: string, brand?: string): ListingEntry[] | null {
  const listings = parsePulteListing(body);
  if (!listings) return null;
  // Only this brand's entries: the same community is listed once per brand, each on its own host, and a relative page URL is no proof of brand.
  return listings.filter((entry) => entry.isCommunityActive && (!brand || entry.brandName.toLowerCase() === brand.toLowerCase())).map((entry) => ({
    url: new URL(entry.pageURL, `https://${host}/`).toString(),
    record: {
      name: entry.name.trim(),
      street: entry.address?.street1 ?? null,
      city: entry.address?.city ?? null,
      zip: /^\d{5}/.exec(entry.address?.zipCode ?? "")?.[0] ?? null,
      phone: entry.salesPhoneNumber?.replace(/[^\d+]/g, "") || null,
      priceFrom: entry.startingFromPrice && entry.startingFromPrice >= 50_000 ? entry.startingFromPrice : null,
      // A (0, 0) coordinate is a blank, not a place; without coordinates the area check cannot pass, so the entry is left out below.
      geo: entry.latitude !== null && entry.longitude !== null && (entry.latitude !== 0 || entry.longitude !== 0) ? { lat: entry.latitude, lng: entry.longitude } : null,
    },
  }));
}

export const DISCOVERY_READERS: readonly DiscoveryReader[] = [
  { builder: "Chesmar", host: "www.chesmar.com", index: { kind: "sitemap", url: "https://www.chesmar.com/sitemap.xml" }, communityPath: /^\/texas\/san-antonio-new-homes\/[a-z0-9-]+\/[^/]+\/?$/i },
  {
    builder: "M/I Homes", host: "www.mihomes.com", index: { kind: "sitemap", url: "https://www.mihomes.com/Sitemap/sitemap.xml" },
    communityPath: /^\/new-homes\/texas\/greater-san-antonio\/(?!communities\/|plans-ready-to-build\/|quick-move-in-homes\/|model-homes-to-tour\/)[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
  },
  {
    // The sitemap is a 17 MB file of 40,000 URLs; the market listing the community finder reads is 70 KB and complete.
    builder: "D.R. Horton", host: "www.drhorton.com", index: { kind: "listing", url: "https://www.drhorton.com/api/comms/direct/texas/san-antonio", accept: "application/json", entries: drhListingEntries },
    communityPath: /^\/texas\/san-antonio\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
  },
  { builder: "First America Homes", host: HOMEFINITI_HOSTS["First America Homes"], index: { kind: "sitemap", url: "https://www.firstamericahomes.com/sitemap.xml" }, communityPath: /^\/new-homes\/tx\/san-antonio-metro\/(?!floorplans\/)[a-z0-9-]+\/[a-z0-9-]+\/?$/i },
  {
    // Coventry builds across Texas; its San Antonio market page lists the area's communities, so the sitemap's 270 community pages are not all read.
    builder: "Coventry Homes", host: HOMEFINITI_HOSTS["Coventry Homes"],
    index: { kind: "listing", url: "https://www.coventryhomes.com/new-homes/tx/san-antonio/", accept: "text/html,application/xhtml+xml", entries: (body, host) => homefinitiMarketLinks(body, host).map((url) => ({ url, record: null })) },
    communityPath: /^\/new-homes\/tx\/[a-z0-9-]+\/(?!available-homes\/|floorplans\/|build-on-your-lot)[a-z0-9-]+\/?$/i,
  },
  {
    // Davidson's market page lists the area's communities in its Next.js data; the community page (no schema.org record) gives the sales address.
    builder: "Davidson Homes", host: DAVIDSON_HOST,
    index: { kind: "listing", url: `https://${DAVIDSON_HOST}/states/texas/san-antonio-market-area/`, accept: "text/html,application/xhtml+xml", entries: (body, host) => davidsonMarketLinks(body)?.map((uri) => ({ url: new URL(uri, `https://${host}/`).toString(), record: null })) ?? null },
    communityPath: /^\/states\/texas\/san-antonio-market-area\/(?!counties\/|school-districts\/|promotions\/|zip-codes\/)[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
    record: davidsonRecord,
  },
  {
    // Highland's community list is rendered from a search index; the sitemap names the San Antonio market's community pages, which carry the sales office line and a map link.
    builder: "Highland Homes", host: HIGHLAND_HOST, index: { kind: "sitemap", url: `https://${HIGHLAND_HOST}/sitemap.xml` },
    communityPath: /^\/san-antonio\/[a-z0-9-]+\/(?!new-home-concierge$|homesites$)[a-z0-9-]+$/i,
    record: (html) => highlandRecord(html),
  },
  {
    // KB Home: the sitemap names the San Antonio market's community pages (plan pages sit a segment deeper); each page carries a Place record with the office address and coordinates.
    builder: "KB Home", host: KBHOME_HOST, index: { kind: "sitemap", url: `https://${KBHOME_HOST}/sitemap.xml` },
    communityPath: /^\/new-homes-san-antonio\/[a-z0-9-]+\/?$/i,
    record: (html) => kbRecord(html),
  },
  {
    // Toll Brothers: the metro search page's Next.js data lists every community with its address and coordinates (collections of a master community included), so no page is read.
    builder: "Toll Brothers", host: TOLL_HOST,
    index: { kind: "listing", url: tollListingUrl(), accept: "text/html,application/xhtml+xml", entries: (body, host) => tollListingEntries(body, host) },
    communityPath: /^\/luxury-homes-for-sale\/Texas\/[A-Za-z0-9%'.-]+(?:\/[A-Za-z0-9%'.-]+)?\/?$/,
  },
  {
    // David Weekley: the market's community list is a JSON endpoint on the site (no address); each community page gives the sales office and coordinates.
    builder: "David Weekley Homes", host: WEEKLEY_HOST,
    index: { kind: "listing", url: weekleyListingUrl(), accept: "application/json", entries: (body, host) => weekleyListingEntries(body, host) },
    communityPath: /^\/new-homes\/tx\/san-antonio\/[a-z-]+\/(?!build-on-your-lot)[a-z0-9-]+\/?$/i,
    record: weekleyRecord,
  },
  {
    // Ashton Woods: the division map lists the parent communities with coordinates and phone (a parent's page shows its children's homes); each page gives the sales address.
    builder: "Ashton Woods", host: ASHTON_HOST,
    index: { kind: "listing", url: ashtonListingUrl(), accept: "application/json", entries: (body, host) => ashtonListingEntries(body, host) },
    communityPath: /^\/san-antonio\/(?!all-home-plans$|quick-move-ins$)[a-z0-9'%-]+\/?$/i,
    record: (html) => ashtonRecord(html),
  },
  {
    // LGI: the market page's Next.js data lists every community with its pin, phone and status; each page gives the sales address.
    builder: "LGI Homes", host: LGI_HOST,
    index: { kind: "listing", url: lgiListingUrl(), accept: "text/html,application/xhtml+xml", entries: (body, host) => lgiListingEntries(body, host) },
    communityPath: /^\/texas\/san-antonio\/[a-z0-9-]+\/?$/i,
    record: lgiRecord,
  },
  {
    // Sitterle: the communities page lists all three Texas markets with a city line; each page gives the sales address and map pin, and the 45-mile rule keeps the area's.
    builder: "Sitterle Homes", host: SITTERLE_HOST,
    index: { kind: "listing", url: sitterleListingUrl(), accept: "text/html,application/xhtml+xml", entries: (body, host) => sitterleListingEntries(body, host) },
    communityPath: /^\/communities\/(?!comm_|feed$|page\/)[a-z0-9-]+\/?$/i,
    record: (html) => sitterleRecord(html),
  },
  {
    // Scott Felder: the San Antonio market page links each community, and its inline state carries every record (sales address, pin, phone, price); a page is read only when the address is missing.
    builder: "Scott Felder Homes", host: SCOTTFELDER_HOST,
    index: { kind: "listing", url: scottFelderListingUrl(), accept: "text/html,application/xhtml+xml", entries: (body, host) => scottFelderListingEntries(body, host) },
    communityPath: /^\/communities\/san-antonio-area\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
    record: scottFelderRecord,
  },
  {
    // DRB Homes: the site is client-rendered; its public API lists the San Antonio region's communities with every record (sales address, pin, phone, price), so no page is read.
    builder: "DRB Homes", host: DRB_HOST,
    index: { kind: "listing", url: drbListingUrl(), accept: "application/json", host: DRB_API_HOST, entries: (body, host) => drbListingEntries(body, host) },
    communityPath: /^\/drbhomes\/find-your-home\/communities\/texas\/san-antonio\/[a-z0-9-]+(?:\/(?:overview|home-plans|quick-move-in-homes))?\/?$/i,
    // The page is an app shell with no record: a listing row is kept on its pin even without a street (no page is read).
  },
  {
    // Starlight: the market page links every community; each page's business record gives the sales address, phone and pin.
    builder: "Starlight Homes", host: STARLIGHT_HOST,
    index: { kind: "listing", url: starlightListingUrl(), accept: "text/html,application/xhtml+xml", entries: (body, host) => starlightListingEntries(body, host) },
    communityPath: /^\/san-antonio\/(?!areas\/)[a-z0-9-]+\/?$/i,
    record: (html) => starlightRecord(html),
  },
  {
    // Legend Homes: the same platform as DRB; the division list on the API carries every record, so no page is read.
    builder: "Legend Homes", host: LEGEND_HOST,
    index: { kind: "listing", url: legendListingUrl(), accept: "application/json", host: LEGEND_API_HOST, entries: (body, host) => legendListingEntries(body, host) },
    communityPath: /^\/communities\/san-antonio\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
  },
  {
    // Drees: the reader lists the San Antonio market itself (areas, then the market's community list) with every record; sub-neighborhoods as their own pages (a parent page would show the same homes twice), none without an address or captioned "Coming Soon".
    builder: "Drees Custom Homes", host: DREES_HOST,
    index: { kind: "reader", entries: (fetcher, now) => dreesDiscoveryEntries(fetcher, now) },
    communityPath: /^\/new-homes-san-antonio\/[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)?\/?$/i,
  },
  {
    // View Homes: the Texas region page embeds the roster with every record (the 45-mile rule leaves El Paso out), so no page is read.
    builder: "View Homes", host: VIEWHOMES_HOST,
    index: { kind: "listing", url: viewHomesListingUrl(), accept: "text/html,application/xhtml+xml", entries: (body, host) => viewHomesListingEntries(body, host) },
    communityPath: /^\/communities\/[a-z0-9-]+\/?$/i,
  },
  {
    // Texas Homes: the site menu on the home page links every community; each page gives the model home's address and pin.
    builder: "Texas Homes", host: TEXASHOMES_HOST,
    index: { kind: "listing", url: texasHomesListingUrl(), accept: "text/html,application/xhtml+xml", entries: (body, host) => texasHomesListingEntries(body, host) },
    communityPath: /^\/(?!move-in-ready|about-|why-|contact|build-on|text-agent|choose-|node\/)[a-z0-9-]+\/?$/i,
    record: texasHomesRecord,
  },
  {
    // Hakes Brothers: the market page links every community; each page's business record gives the sales address, phone and pin.
    builder: "Hakes Brothers", host: HAKES_HOST,
    index: { kind: "listing", url: hakesListingUrl(), accept: "text/html,application/xhtml+xml", entries: (body, host) => hakesListingEntries(body, host) },
    communityPath: /^\/san-antonio\/[a-z0-9-]+\/?$/i,
    record: (html) => hakesRecord(html),
  },
  {
    // Beazer: the site's own metro search lists every community with its pin and city; each page gives the sales office's street.
    builder: "Beazer Homes", host: BEAZER_HOST,
    index: { kind: "listing", url: beazerListingUrl(), accept: "application/json", entries: (body, host) => beazerListingEntries(body, host) },
    communityPath: /^\/san-antonio-tx\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
    record: beazerRecord,
  },
  { builder: "Century Communities", host: CENTURY_HOST, index: { kind: "sitemap", url: `https://${CENTURY_HOST}/sitemap.xml` }, communityPath: /^\/find-your-new-home\/texas\/san-antonio-metro\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i },
  ...(Object.keys(PULTEGROUP_HOSTS) as PulteGroupBrand[]).map((brand): DiscoveryReader => ({
    builder: brand, host: PULTEGROUP_HOSTS[brand], index: { kind: "listing", url: pulteListingUrl(PULTEGROUP_HOSTS[brand], brand), accept: "application/json", entries: (body, host) => pulteListingEntries(body, host, brand) },
    communityPath: /^\/homes\/texas\/san-antonio\/[a-z0-9-]+\/[a-z0-9-]+-\d{4,8}\/?$/i,
  })),
];

/** Every URL in a sitemap or sitemap index on the builder's own host; null when it cannot be read whole. */
export async function officialSitemapUrls(index: string, host: string, fetcher: HtmlFetcher): Promise<string[] | null> {
  const pending = [index];
  const seen = new Set<string>();
  const urls: string[] = [];
  while (pending.length) {
    if (seen.size >= MAX_SITEMAP_DOCUMENTS) return null;
    const url = pending.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const page = await getDocument(url, fetcher, "application/xml,text/xml", host);
    if (!page.ok) return null;
    if (/^\s*(?:<\?xml\b[^>]*>\s*)?<sitemapindex\b/i.test(page.text)) {
      const locations = Array.from(page.text.matchAll(/<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi), (match) => decodeHtmlEntities(match[1]!).trim());
      if (!locations.length) return null;
      for (const raw of locations) {
        const next = asUrl(raw);
        if (!next || !sameOfficialHost(next, host)) return null;
        if (!seen.has(next.toString())) pending.push(next.toString());
      }
    } else {
      const parsed = parseSitemapUrls(page.text);
      if (!parsed) return null;
      urls.push(...parsed);
    }
  }
  return Array.from(new Set(urls));
}

type JsonObject = Record<string, unknown>;
const BUSINESS_TYPES = /^(?:LocalBusiness|HomeAndConstructionBusiness|GeneralContractor|RealEstateAgent|Place|Residence|ApartmentComplex|SingleFamilyResidence|Accommodation)$/;
/** A business record is the community itself; a place or residence record may be a featured home. */
const ORGANIZATION_LIKE = /^(?:LocalBusiness|HomeAndConstructionBusiness|GeneralContractor|RealEstateAgent)$/;

function jsonLdObjects(html: string): JsonObject[] {
  const objects: JsonObject[] = [];
  for (const match of Array.from(html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))) {
    try {
      const parsed: unknown = JSON.parse(match[1]!.trim());
      const queue: unknown[] = [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (Array.isArray(item)) queue.push(...item);
        else if (item && typeof item === "object") {
          const object = item as JsonObject;
          objects.push(object);
          if (Array.isArray(object["@graph"])) queue.push(...(object["@graph"] as unknown[]));
        }
      }
    } catch { /* a broken block is skipped, never guessed at */ }
  }
  return objects;
}

const text = (value: unknown) => typeof value === "string" ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : "";
/** "SAN ANTONIO" -> "San Antonio"; a city already in mixed case is left alone. */
const cityCase = (value: string) => value === value.toUpperCase() && /[A-Z]/.test(value) ? value.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase()) : value;

/** "$289,990 - $512,990" or "From $289,990" -> 289990. */
export function priceFromRange(value: unknown): number | null {
  const match = /\$\s*([\d,]{5,})/.exec(text(value));
  const price = match ? Number(match[1]!.replace(/,/g, "")) : NaN;
  return Number.isFinite(price) && price >= 50_000 && price <= 20_000_000 ? price : null;
}

export type CommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

/**
 * The community's own schema.org record: the business object that has a
 * postal address and a name (the builder's Organization record has neither
 * an address nor the community's name). Coordinates are only used to check the
 * distance from downtown here; they are never stored.
 */
export function communityRecordFromHtml(html: string): CommunityRecord | null {
  const candidates: Array<CommunityRecord & { business: boolean }> = [];
  for (const object of jsonLdObjects(html)) {
    const type = Array.isArray(object["@type"]) ? (object["@type"] as unknown[]).map(String) : [String(object["@type"] ?? "")];
    if (!type.some((value) => BUSINESS_TYPES.test(value)) || type.includes("Organization")) continue;
    const business = type.some((value) => ORGANIZATION_LIKE.test(value));
    const rawAddress = (Array.isArray(object.address) ? object.address[0] : object.address) as JsonObject | undefined;
    const name = text(object.name);
    if (!rawAddress || typeof rawAddress !== "object" || !name) continue;
    // Some sites write the address keys in lower case ("addresslocality"); the record is the same.
    const address = Object.fromEntries(Object.entries(rawAddress).map(([key, value]) => [key.toLowerCase(), value]));
    const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(text(address.postalcode))?.[1] ?? null;
    const region = text(address.addressregion);
    if (region && !/^(?:TX|Texas)$/i.test(region)) continue;
    const geoObject = object.geo as JsonObject | undefined;
    const lat = Number(geoObject?.latitude ?? object.latitude);
    const lng = Number(geoObject?.longitude ?? object.longitude);
    const phone = text(object.telephone).replace(/[^\d+]/g, "") || null;
    candidates.push({
      business,
      name,
      street: text(address.streetaddress) || null,
      city: cityCase(text(address.addresslocality)) || null,
      zip,
      phone,
      priceFrom: priceFromRange(object.priceRange),
      geo: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
    });
  }
  // Without a business record there is no community on the page: a lone place or residence record is a featured home, never the community under that home's address.
  if (!candidates.some((candidate) => candidate.business)) return null;
  // A "Place" record named after the page title ("Houses For Sale in … | Blue Ridge Ranch | D.R. Horton") is the page, not the community:
  // the record with a plain name wins, and takes coordinates, phone and price from the others when it has none.
  // A business record (the community) wins over a place or residence record (a featured home); among those, a plain name over a page title.
  const plain = (candidate: CommunityRecord) => !/\s\|\s/.test(candidate.name);
  const { business: _business, ...named } = candidates.find((candidate) => candidate.business && plain(candidate)) ?? candidates.find((candidate) => candidate.business) ?? candidates.find(plain) ?? candidates[0]!;
  return {
    ...named,
    geo: named.geo ?? candidates.find((candidate) => candidate.geo)?.geo ?? null,
    phone: named.phone ?? candidates.find((candidate) => candidate.phone)?.phone ?? null,
    priceFrom: named.priceFrom ?? candidates.find((candidate) => candidate.priceFrom)?.priceFrom ?? null,
  };
}

export type BuilderDiscovery = {
  builder: string;
  ok: boolean;
  reason?: "sitemap_unreadable";
  communities: DiscoveredCommunity[];
  /** Community pages skipped: no record, outside the area, or unreadable. */
  skipped: Array<{ url: string; reason: "no_community_record" | "outside_area" | "page_unreadable" }>;
};

/** One builder's San Antonio area communities, read from its own site, one page at a time. */
/** The builder's community pages from its index (with the record when the index carries it); null when the index cannot be read whole. */
async function indexedEntries(reader: DiscoveryReader, fetcher: HtmlFetcher): Promise<ListingEntry[] | null> {
  if (reader.index.kind === "reader") return reader.index.entries(fetcher, Date.now());
  if (reader.index.kind === "sitemap") {
    const urls = await officialSitemapUrls(reader.index.url, reader.host, fetcher);
    return urls ? urls.map((url) => ({ url, record: null })) : null;
  }
  const page = await getDocument(reader.index.url, fetcher, reader.index.accept, reader.index.host ?? reader.host);
  if (!page.ok) return null;
  return reader.index.entries(page.text, reader.host);
}

export async function discoverBuilderCommunities(reader: DiscoveryReader, fetcher: HtmlFetcher = fetch): Promise<BuilderDiscovery> {
  const result: BuilderDiscovery = { builder: reader.builder, ok: false, communities: [], skipped: [] };
  const entries = await indexedEntries(reader, fetcher);
  if (!entries) return { ...result, reason: "sitemap_unreadable" };
  // One page per community however the index spells it (trailing slash, case): the first spelling is the one read.
  const pages = new Map<string, { url: string; record: CommunityRecord | null }>();
  for (const entry of entries) {
    const url = asUrl(entry.url);
    if (!url || !sameOfficialHost(url, reader.host) || !reader.communityPath.test(url.pathname)) continue;
    const key = normalizedDealSourceKey(`${url.origin}${url.pathname}`);
    if (!pages.has(key)) pages.set(key, { url: `${url.origin}${url.pathname}`, record: entry.record });
    if (pages.size >= MAX_COMMUNITY_PAGES) break;
  }
  for (const { url, record: listed } of Array.from(pages.values())) {
    let record = listed;
    // A listing record without the sales address (a map pin) still needs the page; the page's record takes the pin's coordinates and phone where it has none.
    if (!record || (reader.record && !record.street)) {
      const page = await getDocument(url, fetcher, "text/html,application/xhtml+xml", reader.host);
      if (!page.ok) { result.skipped.push({ url, reason: "page_unreadable" }); continue; }
      const fromPage = reader.record ? reader.record(page.text, url) : communityRecordFromHtml(page.text);
      record = fromPage ? { ...fromPage, city: fromPage.city ?? listed?.city ?? null, geo: fromPage.geo ?? listed?.geo ?? null, phone: fromPage.phone ?? listed?.phone ?? null, priceFrom: fromPage.priceFrom ?? listed?.priceFrom ?? null } : null;
    }
    if (!record) { result.skipped.push({ url, reason: "no_community_record" }); continue; }
    // Every record must place the community: one without coordinates cannot pass the area check and is not added on faith.
    if (!record.geo) { result.skipped.push({ url, reason: "no_community_record" }); continue; }
    if (milesBetween(DOWNTOWN_SAN_ANTONIO, record.geo) > DISCOVERY_RADIUS_MILES) { result.skipped.push({ url, reason: "outside_area" }); continue; }
    const address = [record.street, record.city, record.zip ? `TX ${record.zip}` : "TX"].filter(Boolean).join(", ");
    result.communities.push({
      builder: reader.builder,
      name: record.name,
      sourceUrl: url,
      city: record.city,
      zip: record.zip,
      address,
      salesPhone: record.phone,
      // Close-outs are added too: their last homes are often the best deals. The first sync decides what shows.
      status: "selling",
      priceFrom: record.priceFrom,
    });
  }
  return { ...result, ok: true };
}

export type DiscoveryRun = { builders: Array<{ builder: string; ok: boolean; reason?: string; found: number; skipped: number; created: number; existing: number }>; created: number };

/** How long discovery waits for a builder's lease (a batch lane may be reading its pages) before giving up on that builder this run. */
const LEASE_WAIT_MS = 20 * 60_000;
const LEASE_POLL_MS = 15_000;

/**
 * Discovery for every builder with a reader, then onboarding. Each builder's
 * pages are read under the builder's lease (one request stream per builder,
 * shared with the catalog batches and Refresh now). A builder whose sitemap
 * cannot be read, whose lease stays busy, or whose onboarding throws is
 * reported and adds nothing; the others carry on.
 */
export async function discoverAndOnboardAll(fetcher: HtmlFetcher = fetch, readers: readonly DiscoveryReader[] = DISCOVERY_READERS, createdIds: number[] = [], options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<DiscoveryRun> {
  const run: DiscoveryRun = { builders: [], created: 0 };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  for (const reader of readers) {
    if (!hasBuilderReader(reader.builder)) continue;
    const failed = (reason: string) => { run.builders.push({ builder: reader.builder, ok: false, reason, found: 0, skipped: 0, created: 0, existing: 0 }); };
    let lease = await leaseBuilder(reader.builder, new Date(now()));
    for (const started = now(); !lease && now() - started < LEASE_WAIT_MS;) { await sleep(LEASE_POLL_MS); lease = await leaseBuilder(reader.builder, new Date(now())); }
    if (!lease) { failed("builder_busy"); continue; }
    let found: BuilderDiscovery;
    try {
      // The lease is renewed as pages are read (one slow builder can take an hour); the passed fetcher is wrapped, not replaced.
      let renewed = now();
      found = await discoverBuilderCommunities(reader, async (input, init) => {
        const response = await fetcher(input, init);
        if (now() - renewed >= 60_000) { renewed = now(); await lease!.heartbeat().catch(() => undefined); }
        return response;
      });
    } catch (error) {
      console.error(`[deals-discovery] ${reader.builder} failed`, error instanceof Error ? error.message : error);
      failed("discovery_failed");
      continue;
    } finally {
      await lease.release();
    }
    let onboarded: OnboardingResult = { created: [], existing: 0, skipped: [] };
    try {
      if (found.ok && found.communities.length) onboarded = await onboardDiscoveredCommunities(found.communities);
    } catch (error) {
      console.error(`[deals-discovery] onboarding ${reader.builder} failed`, error instanceof Error ? error.message : error);
      failed("onboarding_failed");
      continue;
    }
    run.builders.push({ builder: reader.builder, ok: found.ok, reason: found.reason, found: found.communities.length, skipped: found.skipped.length + onboarded.skipped.length, created: onboarded.created.length, existing: onboarded.existing });
    run.created += onboarded.created.length;
    createdIds.push(...onboarded.created);
  }
  return run;
}

const DISCOVERY_JOB = "builder-deals-discovery-run";
/** A discovery run with no finish for this long is treated as dead and may be started again. */
const DISCOVERY_STALE_MS = 3 * 60 * 60_000;

/** Tells the sync recipients what was found; only when something new was added. Never fails the run. */
export async function emailDiscoveryRun(run: DiscoveryRun, createdIds: readonly number[]): Promise<void> {
  if (!createdIds.length && run.builders.every((builder) => builder.ok)) return;
  try {
    const db = await getDb();
    const rows = db && createdIds.length ? await db.select({ builder: dealCommunities.builder, privateName: dealCommunities.privateName }).from(dealCommunities).where(inArray(dealCommunities.id, [...createdIds])) : [];
    const lines = [
      createdIds.length ? `${createdIds.length} new communit${createdIds.length === 1 ? "y was" : "ies were"} found on the builders' sites. Each one stays hidden until its first clean update, then goes live by itself.` : "No new communities this time.",
      "",
      ...rows.map((row) => `  ${row.privateName} (${row.builder})`),
      ...(rows.length ? [""] : []),
      ...run.builders.filter((builder) => !builder.ok).map((builder) => `  Could not read ${builder.builder}'s site list this time (${builder.reason ?? "unknown"}). Nothing was changed for that builder.`),
      "",
      "Review in Admin, Builder Deals: /admin/deals",
    ];
    const { syncEmailRecipients } = await getDealSettings();
    await sendBuilderDealsEmail({ category: "deals_discovery", recipients: syncEmailRecipients, subject: createdIds.length ? `Builder Deals: ${createdIds.length} new communit${createdIds.length === 1 ? "y" : "ies"} found` : "Builder Deals: a builder's site list could not be read", content: lines.join("\n") });
  } catch (error) {
    console.error("[deals-discovery] email failed", error instanceof Error ? error.message : error);
  }
}

/**
 * The weekly job and the Admin button: discover, onboard, email. One run at a
 * time across every server: a deal_job_runs row ("running") is the claim, and
 * a run that never finished is taken over after three hours.
 */
export async function runCommunityDiscovery(fetcher: HtmlFetcher = fetch, options: Parameters<typeof discoverAndOnboardAll>[3] = {}): Promise<DiscoveryRun | { skipped: "already_running" }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date(options.now?.() ?? Date.now());
  // The claim carries a token: a run that was taken over after three hours cannot later close the taker's row.
  const token = `run:${randomUUID()}`;
  const existing = (await db.select().from(dealJobRuns).where(and(eq(dealJobRuns.jobName, DISCOVERY_JOB), eq(dealJobRuns.chicagoDay, "run"))).limit(1))[0];
  if (existing) {
    if (existing.status === "running" && existing.startedAt.getTime() > now.getTime() - DISCOVERY_STALE_MS) return { skipped: "already_running" };
    const taken = await db.update(dealJobRuns).set({ status: "running", startedAt: now, completedAt: null, detail: token }).where(and(eq(dealJobRuns.id, existing.id), eq(dealJobRuns.status, existing.status), eq(dealJobRuns.startedAt, existing.startedAt)));
    if (Number((taken as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) !== 1) return { skipped: "already_running" };
  } else {
    try { await db.insert(dealJobRuns).values({ jobName: DISCOVERY_JOB, chicagoDay: "run", status: "running", startedAt: now, detail: token }); } catch { return { skipped: "already_running" }; }
  }
  const mine = and(eq(dealJobRuns.jobName, DISCOVERY_JOB), eq(dealJobRuns.chicagoDay, "run"), eq(dealJobRuns.status, "running"), eq(dealJobRuns.detail, token));
  const finish = async (status: "ok" | "failed", detail: string) => {
    const connection = await getDb();
    if (!connection) return;
    await connection.update(dealJobRuns).set({ status, detail: detail.slice(0, 10_000), completedAt: new Date() }).where(mine).catch(() => undefined);
  };
  try {
    const createdIds: number[] = [];
    const run = await discoverAndOnboardAll(fetcher, DISCOVERY_READERS, createdIds, options);
    await emailDiscoveryRun(run, createdIds);
    await finish(run.builders.every((builder) => builder.ok) ? "ok" : "failed", JSON.stringify({ created: run.created, builders: run.builders.map((builder) => [builder.builder, builder.ok, builder.reason ?? null]), day: chicagoDay(now) }));
    return run;
  } catch (error) {
    await finish("failed", error instanceof Error ? error.message : "discovery failed");
    throw error;
  }
}

/** Starts a run in the background (the weekly job and the Admin button); the result arrives by email. */
export function startCommunityDiscovery(): { started: true } {
  setImmediate(() => { runCommunityDiscovery().catch((error) => console.error("[deals-discovery] run failed", error instanceof Error ? error.message : error)); });
  return { started: true };
}
