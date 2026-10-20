import {
  NMLS_ID_PATTERN_ALL, TOLL_HOST, asUrl, comparablePath, decodeHtmlEntities, emptyPrivate, failedResult, getDocument, makePublicSnapshot, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";
import { parseNextData } from "./dealsAdapters.davidson";

/**
 * TOLL BROTHERS reader. The community page is Next.js (pages router); its
 * `__NEXT_DATA__.props.pageProps.pageData.communityComponent` carries the
 * whole community: `homes.models[]` (the plans: `name`, `pricedFrom` number,
 * `minBed`, `minBath`, `minHalfBath`, `minSqft`, `minGarage`, `url`,
 * `headShot.media.url`) each with `qmis[]` (the quick move-in homes: `street`,
 * `pricedFrom`, `moveInDate` "2026-11-30", `isComingSoon`, `lotNumber`, `url`,
 * `communityId`, `headShot`, `elevations[]`), `qmiSitePlanLots` (how many homes
 * the site plan shows for sale), `salesOffice` (street, city, zip, phone, lat,
 * lon), `schoolInfo.schoolDistrict`, `amenities`, and `events[]` (the national
 * sales event and a rate banner, each with headline, paragraphs and
 * disclaimer). The city search page's `searchResults.perfect[]` lists every
 * community of the metro with address and coordinates (master communities
 * nest their collections in `communities[]`), so discovery needs no page
 * reads. Photos sit on `cdn.tollbrothers.com`. Read-only, plain GET, official
 * host only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - listing:   /luxury-homes/San-Antonio-TX                                    (about 260 KB)
 * - community: /luxury-homes-for-sale/Texas/<slug>[/<Collection>]              (about 460 KB)
 * - home:      .../<slug>/Quick-Move-In/<id>
 * - plan:      .../<slug>/<Plan-Name>
 */
/** A community with more homes for sale than this is held, never truncated. */
export const TOLL_MAX_HOMES = 150;
export const TOLL_CDN_HOST = "cdn.tollbrothers.com";
/** The metro search page (a function: this module and dealsAdapters import each other, so the host is read when called, not when loaded). */
export const tollListingUrl = () => `https://${TOLL_HOST}/luxury-homes/San-Antonio-TX`;

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

/**
 * A quick move-in home's status from its move-in date: on or before today is
 * ready now, a later date names its month, a "coming soon" flag is not for sale
 * yet, and no readable date gives no status (the run is held).
 */
export function tollStatus(moveInDate: string | null, comingSoon: boolean, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  if (comingSoon) return { status: "Coming Soon", readyNow: false, moveInDate: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(moveInDate ?? "");
  if (!match) return { status: null, readyNow: false, moveInDate: null };
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > now.getUTCFullYear() + 5) return { status: null, readyNow: false, moveInDate: null };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (Date.UTC(year, month - 1, Number(match[3])) <= today) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const label = `${MONTHS[month - 1]} ${year}`;
  return { status: `Quick Move-In (${label})`, readyNow: false, moveInDate: label };
}

export type TollCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

function geoOf(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = num(lat);
  const b = num(lng);
  return a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (a !== 0 || b !== 0) ? { lat: a, lng: b } : null;
}

function imageOf(media: unknown): PrivateGalleryImage | null {
  const item = obj(media);
  const inner = item ? obj(item.media) ?? item : null;
  const link = inner ? str(inner.url) : null;
  const url = link ? asUrl(link) : null;
  if (!url || url.hostname !== TOLL_CDN_HOST || /floorplan|siteplan|\.svg$|logo/i.test(url.pathname)) return null;
  url.search = "";
  return { sourceUrl: url.toString(), caption: inner && inner.representative === true ? "Representative image" : (inner ? str(inner.title) : null), width: null, height: null, srcSet: null };
}

function gallery(...sources: unknown[]): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const media of Array.isArray(source) ? source : [source]) {
      const image = imageOf(media);
      if (!image || seen.has(image.sourceUrl)) continue;
      seen.add(image.sourceUrl);
      out.push(image);
    }
  }
  return out;
}

export type TollPage = {
  record: TollCommunityRecord | null;
  communityId: string | null;
  /** The community page's own URL in the data, compared with the one configured. */
  pageUrl: string | null;
  /** False when a model has no `qmis` array or a quick move-in home is listed as a top-level model: the home list changed shape. */
  shapeIntact: boolean;
  /** True when a home's page sits under another community's path on the host: not this community's inventory. */
  foreignHome: boolean;
  homes: PrivatePlanOrHome[];
  plans: PrivatePlanOrHome[];
  /** The site plan's count of homes for sale, when the page says. */
  sitePlanHomes: number | null;
  facts: { schoolDistrict: string | null; amenities: string[] };
  /** The national event or rate banner the page shows, as one text; null when there is none. */
  offer: string | null;
};

/** A date-only field ("2026-10-26") compared with today's date. */
const dayOf = (value: unknown): string | null => /^(\d{4}-\d{2}-\d{2})/.exec(str(value) ?? "")?.[1] ?? null;

/**
 * The current event texts on the page, the one naming a rate first; an event
 * whose dates say it has ended or not begun is left out. Links (with or
 * without a scheme), phone numbers (with or without separators), NMLS ids and
 * a sentence naming a loan officer are stripped; parts are joined as sentences.
 */
export function tollOfferText(events: unknown, now: Date = new Date()): string | null {
  const today = now.toISOString().slice(0, 10);
  const texts: string[] = [];
  for (const raw of arr(events)) {
    const event = obj(raw);
    if (!event) continue;
    const start = dayOf(event.startDate);
    const end = dayOf(event.endDate);
    if ((end && end < today) || (start && start > today)) continue;
    const headline = obj(event.headline);
    const parts = [headline ? str(headline.text) : null, ...arr(event.paragraphs).map((paragraph) => str(obj(paragraph)?.text)), str(event.disclaimer) ?? (headline ? str(headline.disclaimer) : null)];
    const text = parts.filter((part): part is string => Boolean(part)).map((part) => part.replace(/\s+/g, " ").trim()).map((part) => /[.!?]$/.test(part) ? part : `${part}.`).join(" ")
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
      .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|us|io|info|biz)\b(?:\/\S*)?/gi, " ")
      .replace(/\(?\b\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, " ")
      .replace(NMLS_ID_PATTERN_ALL, " ")
      // A sentence naming a loan officer ends at a sentence end after a word, never at an initial ("Jane Q.").
      .replace(/\b(?:Loan\s+officer|Mortgage\s+(?:loan\s+)?(?:officer|consultant|advisor))\b.*?(?:(?<=[A-Za-z]{2}|\d)[.!?](?=\s|$)|$)/gi, " ")
      .replace(/(?<=(?:^|[.!?(])\s*)(?:See|Visit|Call|Click)(?:\s+(?:us|here))?(?:\s+or\s+(?:see|visit|call|click)(?:\s+(?:us|here))?)?(?:\s+(?:today|now))?\s*(?:for\s+(?:state\s+licensing\s+)?(?:details|information)|to\s+learn\s+more)?\s*\.?(?=\s|$)/g, " ")
      .replace(/\(\s*\)/g, " ")
      // A parenthesis left open when what it held was stripped.
      .replace(/\(\s*(?=[^()]*(?:[.!?](?:\s|$)|$))(?![^()]*\))/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1").replace(/([.!?])\s*\1+/g, "$1").replace(/\s+/g, " ").trim();
    if (/[A-Za-z]/.test(text)) texts.push(text);
  }
  return texts.find((text) => /\d+(?:\.\d+)?\s*%/.test(text)) ?? texts[0] ?? null;
}

/** The community on the page; null when the page has no community component or no plan list. */
export function parseTollCommunity(html: string, pageUrl: string, now: Date = new Date()): TollPage | null {
  const community = asUrl(pageUrl);
  const data = parseNextData(html);
  const component = obj(obj(obj(obj(data?.props)?.pageProps)?.pageData)?.communityComponent);
  if (!community || !component) return null;
  const models = obj(component.homes)?.models;
  if (!Array.isArray(models)) return null;
  const host = community.hostname;
  const office = obj(component.salesOffice);
  const communityId = str(component.communityId) ?? (typeof component.communityId === "number" ? String(component.communityId) : null);
  const name = str(component.name);
  const city = str(office?.city) ?? str(component.city);
  const zip = /^\d{5}/.exec(str(office?.zip) ?? str(component.zip) ?? "")?.[0] ?? null;
  const record: TollCommunityRecord | null = name ? {
    name,
    street: str(office?.street),
    city,
    zip,
    phone: (str(office?.salesOfficePhone) ?? "").replace(/[^\d]/g, "") || null,
    priceFrom: num(component.pricedFromInt) ?? num(component.pricedFrom),
    geo: geoOf(office?.lat, office?.lon) ?? geoOf(component.lat, component.lon),
  } : null;
  const cityLine = city ? `${city}, ${zip ? `TX ${zip}` : "TX"}` : null;
  const plans: PrivatePlanOrHome[] = [];
  const homes: PrivatePlanOrHome[] = [];
  let shapeIntact = true;
  let foreignHome = false;
  const base = `${comparablePath(community.pathname.replace(/\/+$/, ""))}/`;
  for (const raw of models) {
    const model = obj(raw);
    if (!model) continue;
    // Every model carries its `qmis` list (empty when none); a model without one, or a quick move-in home listed at the top level, is a changed shape.
    if (!Array.isArray(model.qmis) || model.isQMI === true) shapeIntact = false;
    const planName = str(model.name) ?? str(model.modelName);
    const link = str(model.url);
    const page = link ? asUrl(link) : null;
    if (planName && page && sameOfficialHost(page, host) && model.isQMI !== true) {
      const price = num(model.pricedFrom);
      plans.push({
        sourceUrl: page.toString(),
        privateName: planName,
        privatePlanName: planName,
        status: null,
        price: price && price > 0 ? price : null,
        bedrooms: num(model.minBed),
        bathrooms: num(model.minBath) === null ? null : (num(model.minBath) ?? 0) + (num(model.minHalfBath) ?? 0) * 0.5,
        squareFeet: num(model.minSqft),
        garage: num(model.minGarage),
        readyNow: false,
        gallery: gallery(model.headShot, model.elevations).map((image) => ({ ...image, caption: "Representative image" })),
      });
    }
    for (const rawHome of arr(model.qmis)) {
      const home = obj(rawHome);
      if (!home) continue;
      const street = str(home.street) ?? str(home.address);
      const homeLink = str(home.url);
      const homePage = homeLink ? asUrl(homeLink) : null;
      // The home must belong here: the community id when given, and a page under this community's own path.
      const underCommunity = Boolean(homePage && sameOfficialHost(homePage, host) && comparablePath(homePage.pathname).startsWith(base));
      if (homePage && sameOfficialHost(homePage, host) && !underCommunity) foreignHome = true;
      const ownCommunity = (communityId === null || home.communityId === undefined || String(home.communityId) === communityId) && underCommunity;
      const readable = Boolean(street && homePage && sameOfficialHost(homePage, host) && ownCommunity);
      const price = num(home.pricedFrom);
      const status = tollStatus(str(home.moveInDate), home.isComingSoon === true, now);
      const lot = str(home.lotNumber);
      homes.push({
        sourceUrl: readable ? homePage!.toString() : `${community.origin}${community.pathname.replace(/\/+$/, "")}/Quick-Move-In/unreadable-${homes.length}`,
        privateName: street,
        privateAddress: street && cityLine ? `${street}, ${cityLine}` : street,
        privatePlanName: str(home.modelName) ?? planName,
        status: readable && price ? status.status : null,
        price: price && price > 0 ? price : null,
        bedrooms: num(home.minBed),
        bathrooms: num(home.minBath) === null ? null : (num(home.minBath) ?? 0) + (num(home.minHalfBath) ?? 0) * 0.5,
        squareFeet: num(home.minSqft),
        garage: num(home.minGarage),
        homesite: lot ? `Lot ${lot}` : null,
        readyNow: status.readyNow,
        moveInDate: status.moveInDate,
        gallery: gallery(home.headShot, home.elevations),
      });
    }
  }
  const amenities = arr(obj(component.amenities)?.amenityGroups).flatMap((group) => arr(obj(group)?.amenities).map((item) => str(obj(item)?.name) ?? str(item)).filter((item): item is string => Boolean(item)));
  return {
    record,
    communityId,
    pageUrl: str(component.url),
    shapeIntact,
    foreignHome,
    homes,
    plans,
    sitePlanHomes: num(component.qmiSitePlanLots),
    facts: { schoolDistrict: str(obj(component.schoolInfo)?.schoolDistrict), amenities },
    offer: tollOfferText(component.events, now),
  };
}

/** Every community on the metro listing page, collections of a master community included; null when the page has no results list. */
export function tollListingEntries(html: string, host: string): Array<{ url: string; record: TollCommunityRecord }> | null {
  const data = parseNextData(html);
  const results = obj(obj(obj(data?.props)?.pageProps)?.searchResults);
  if (!results || !Array.isArray(results.perfect)) return null;
  const out: Array<{ url: string; record: TollCommunityRecord }> = [];
  const visit = (raw: unknown) => {
    const item = obj(raw);
    if (!item) return;
    if (item.isMaster === true) { for (const child of arr(item.communities)) visit(child); return; }
    const url = asUrl(str(item.url) ?? "");
    const name = str(item.name);
    if (!url || !sameOfficialHost(url, host) || !name) return;
    out.push({ url: `${url.origin}${url.pathname}`, record: {
      name,
      street: str(item.streetAddress),
      city: str(item.city),
      zip: /^\d{5}/.exec(str(item.zipCode) ?? "")?.[0] ?? null,
      phone: (str(item.phone) ?? "").replace(/[^\d]/g, "") || null,
      priceFrom: num(item.pMin) ?? num(item.pricedFrom),
      geo: geoOf(item.lat, item.lon),
    } });
  };
  for (const item of results.perfect) visit(item);
  return out;
}

export class TollBrothersAdapter implements DealAdapter {
  readonly builder = "Toll Brothers" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, TOLL_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", TOLL_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseTollCommunity(page.text, community.toString(), now());
    // Without the community component, its plan list or its sales office this is not a community page.
    if (!parsed || !parsed.record?.street) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The data must describe this community (a same-host redirect to another page does not), with every model's home list in place.
    // The two spellings of an apostrophe ("'" and "%27") are one page, as they are one source key.
    const ownPage = parsed.pageUrl ? asUrl(parsed.pageUrl) : null;
    if (ownPage && (ownPage.origin.toLowerCase() !== community.origin.toLowerCase() || comparablePath(ownPage.pathname.replace(/\/+$/, "")) !== comparablePath(community.pathname.replace(/\/+$/, "")))) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    if (!parsed.shapeIntact) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The site plan counts the homes for sale; fewer homes in the data than that means the home list changed shape, not that homes sold.
    if (parsed.sitePlanHomes !== null && parsed.homes.length < parsed.sitePlanHomes) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // A home listed under another community's path is never this community's inventory.
    if (parsed.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    if (parsed.homes.length > TOLL_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    privateSnapshot.communityFacts = { fromPrice: parsed.record.priceFrom && parsed.record.priceFrom >= 50_000 ? parsed.record.priceFrom : null, schoolDistrict: parsed.facts.schoolDistrict, lotSizes: null, amenities: parsed.facts.amenities };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    if (parsed.offer) privateSnapshot.incentive = { sourceUrl: community.toString(), text: parsed.offer, facts: parsePromotionalRate(parsed.offer) };
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
