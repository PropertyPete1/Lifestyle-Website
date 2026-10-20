import {
  NMLS_ID_PATTERN_ALL, PULTEGROUP_HOSTS, asUrl, decodeHtmlEntities, emptyPrivate, failedResult, getDocument, htmlToText, makePublicSnapshot, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlFetcher, type PrivateDealSnapshot, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * PULTEGROUP reader: Pulte, Centex and Del Webb share one platform, each on
 * its own host (www.pulte.com, www.centex.com, www.delwebb.com). The site's own
 * JSON endpoints carry the inventory, so no page is parsed for homes:
 *
 * - GET /API/Community/Search?State=Texas&Region=San Antonio&Brand=<brand>&JsonFormat=true&pageSize=0
 *     every community of every brand in the market (id, name, pageURL, address,
 *     coordinates, phone, startingFromPrice, status); read once an hour per host
 * - GET /api/plan/qmiplans?communityId=<id>   homes for sale (address, price,
 *     priceDiscount, finalPrice, dateAvailable, specs, lotBlock, images, soldDate)
 * - GET /api/plan/homeplans?communityId=<id>  floor plans (planName, price, specs, images)
 *
 * The brand's market offers (a rate offer with its disclaimer) are rendered on
 * every home and plan page in a "SpecialOffersV2" carousel; the first home page
 * of a community is read for them once an hour per host (the community page
 * itself is over 8 MB). Read-only, plain GET, official host only. Everything
 * here is private operational data.
 */
export type PulteGroupBrand = keyof typeof PULTEGROUP_HOSTS;

const CACHE_MS = 60 * 60_000;
/** A community with more homes for sale than this is held, never truncated. */
export const PULTEGROUP_MAX_HOMES = 150;

type Listing = { id: number; name: string; pageURL: string; brandName: string; status: string | null; address: { street1: string | null; city: string | null; zipCode: string | null } | null; latitude: number | null; longitude: number | null; salesPhoneNumber: string | null; startingFromPrice: number | null; schoolDistrictLabel: string | null; isCommunityActive: boolean };

const listingCache = new Map<string, { listings: Listing[]; fetchedAt: number }>();
const offersCache = new Map<string, { offer: { text: string; sourceUrl: string } | null; fetchedAt: number }>();

/** Test seam only. */
export function resetPulteGroupCaches() {
  listingCache.clear();
  offersCache.clear();
}

const num = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

/** The market listing as this reader uses it; null when the body is not the listing. */
export function parsePulteListing(body: string): Listing[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const listings: Listing[] = [];
  for (const entry of parsed as Array<Record<string, unknown>>) {
    const id = num(entry.id);
    const name = str(entry.name);
    const pageURL = str(entry.pageURL);
    if (id === null || !name || !pageURL) return null;
    const address = entry.address && typeof entry.address === "object" ? entry.address as Record<string, unknown> : null;
    listings.push({
      id, name, pageURL, brandName: str(entry.brandName) ?? "", status: str(entry.status),
      address: address ? { street1: str(address.street1), city: str(address.city), zipCode: str(address.zipCode) } : null,
      latitude: num(entry.latitude), longitude: num(entry.longitude),
      salesPhoneNumber: str(entry.salesPhoneNumber), startingFromPrice: num(entry.startingFromPrice), schoolDistrictLabel: str(entry.schoolDistrictLabel),
      isCommunityActive: entry.isCommunityActive !== false,
    });
  }
  return listings;
}

export function pulteListingUrl(host: string, brand: PulteGroupBrand): string {
  return `https://${host}/API/Community/Search?State=Texas&Region=${encodeURIComponent("San Antonio")}&Brand=${encodeURIComponent(brand)}&JsonFormat=true&pageSize=0`;
}

/** The community id at the end of a community path: /homes/texas/san-antonio/san-antonio/bison-ridge-210867 -> 210867. */
export function pulteCommunityId(pathname: string): number | null {
  const match = /-(\d{4,8})\/?$/.exec(pathname);
  return match ? Number(match[1]) : null;
}

const MONTHS: Record<string, string> = { jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June", jul: "July", aug: "August", sep: "September", sept: "September", oct: "October", nov: "November", dec: "December" };

/**
 * "Oct 2026" -> "October 2026"; "Available Now" -> ready now; an empty value
 * -> a home for sale with no date. Any other wording ("Under Contract",
 * "Coming Soon", "TBD") is `unknown`: the home gets no status, so the sync
 * holds the run instead of publishing it as available.
 */
export function pulteMoveIn(dateAvailable: string | null): { readyNow: boolean; moveInDate: string | null; unknown: boolean } {
  if (!dateAvailable) return { readyNow: false, moveInDate: null, unknown: false };
  if (/^(?:available\s+now|move[- ]?in\s+ready|ready\s+now|available)$/i.test(dateAvailable.trim())) return { readyNow: true, moveInDate: null, unknown: false };
  const month = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(dateAvailable.trim());
  if (month) { const name = MONTHS[month[1]!.toLowerCase().slice(0, 4)] ?? MONTHS[month[1]!.toLowerCase().slice(0, 3)]; if (name) return { readyNow: false, moveInDate: `${name} ${month[2]}`, unknown: false }; }
  return { readyNow: false, moveInDate: null, unknown: true };
}

/** A sale date the platform really set: a valid past date from this century. .NET's default "0001-01-01" and a future date are not sales. */
export function pulteSoldDate(value: unknown, now: Date = new Date()): boolean {
  const text = str(value);
  if (!text) return false;
  const time = Date.parse(text);
  return Number.isFinite(time) && time >= Date.UTC(2000, 0, 1) && time <= now.getTime() + 24 * 3600_000;
}

/** A flag the platform writes as a boolean or as the strings "true"/"false". */
export function flag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true" ? true : value.trim().toLowerCase() === "false" ? false : null;
  return null;
}

function gallery(images: unknown, representative: boolean): PrivateGalleryImage[] {
  if (!Array.isArray(images)) return [];
  const sorted = (images as Array<Record<string, unknown>>)
    .filter((image) => typeof image.path === "string" && /^https:\/\/pultegroup\.cdn\.picturepark\.com\/v\/[A-Za-z0-9_-]+\/?$/.test(image.path))
    .sort((a, b) => (num(a.imageRank) ?? 999) - (num(b.imageRank) ?? 999));
  const seen = new Set<string>();
  const out: PrivateGalleryImage[] = [];
  for (const image of sorted) {
    const path = image.path as string;
    if (seen.has(path)) continue;
    seen.add(path);
    const type = str(image.imageType) ?? "";
    // Floor-plan drawings and event artwork carry the plan name or a promotion, never the home.
    if (/floor\s*plan|site\s*plan|logo|event|promotion/i.test(`${type} ${str(image.caption) ?? ""} ${str(image.altText) ?? ""}`)) continue;
    out.push({ sourceUrl: path.endsWith("/") ? path : `${path}/`, caption: representative ? "Representative image" : null, width: null, height: null, srcSet: null });
  }
  return out;
}

export type PulteHome = PrivatePlanOrHome & { kind: "home" | "plan"; communityId: number | null };

/** One record of /api/plan/qmiplans. Null when it lacks the fields a home needs. */
export function parsePulteQmi(entry: Record<string, unknown>, host: string, now: Date = new Date()): PulteHome | null {
  const pageUrl = str(entry.inventoryPageURL);
  const address = entry.address && typeof entry.address === "object" ? entry.address as Record<string, unknown> : null;
  const street = address ? str(address.street1) : null;
  const listPrice = num(entry.price);
  const finalPrice = num(entry.finalPrice);
  if (!pageUrl || !street || (listPrice === null && finalPrice === null)) return null;
  const price = finalPrice && finalPrice > 0 ? finalPrice : listPrice && listPrice > 0 ? listPrice : null;
  const discount = num(entry.priceDiscount);
  const previous = listPrice && price && listPrice > price ? listPrice : null;
  const city = address ? str(address.city) : null;
  const zip = address ? str(address.zipCode) : null;
  const sold = pulteSoldDate(entry.soldDate, now);
  const moveIn = pulteMoveIn(str(entry.dateAvailable));
  const lot = str(entry.lotBlock);
  return {
    kind: "home",
    communityId: num(entry.communityId),
    sourceUrl: new URL(pageUrl, `https://${host}/`).toString(),
    privateName: street,
    privateAddress: [street, [city, zip ? `TX ${zip}` : "TX"].filter(Boolean).join(", ")].filter(Boolean).join(", "),
    privatePlanName: str(entry.planName),
    status: sold ? "Sold" : moveIn.unknown ? null : moveIn.readyNow ? "Quick Move-In (Move-In Ready)" : moveIn.moveInDate ? `Quick Move-In (${moveIn.moveInDate})` : "Quick Move-In",
    price,
    previousPrice: previous,
    priceDrop: previous ? (discount && discount > 0 ? discount : previous - price!) : null,
    bedrooms: num(entry.bedrooms),
    bathrooms: num(entry.totalBaths) ?? num(entry.bathrooms),
    squareFeet: num(entry.squareFeet),
    garage: num(entry.garages),
    homesite: lot ? `Homesite ${lot}` : null,
    readyNow: moveIn.readyNow,
    moveInDate: moveIn.moveInDate,
    gallery: gallery(entry.images, false),
  };
}

/** One record of /api/plan/homeplans. Null when it lacks the fields a plan needs; a sold-out or future plan is skipped by the caller. */
export function parsePultePlan(entry: Record<string, unknown>, host: string): PulteHome | null {
  const pageUrl = str(entry.pageURL);
  const name = str(entry.planName);
  if (!pageUrl || !name) return null;
  const price = num(entry.price);
  return {
    kind: "plan",
    communityId: num(entry.communityId),
    sourceUrl: new URL(pageUrl, `https://${host}/`).toString(),
    privateName: name,
    privatePlanName: name,
    status: null,
    price: price && price > 0 ? price : null,
    bedrooms: num(entry.bedrooms),
    bathrooms: num(entry.maxTotalBaths) ?? num(entry.bathrooms),
    squareFeet: num(entry.squareFeet),
    garage: num(entry.garages),
    readyNow: false,
    gallery: gallery(entry.images, true),
  };
}

/**
 * The market offers carousel on a home or plan page: each slide's description
 * and the disclaimer behind its (i) button. The slide that names a rate is the
 * one read (the others are hero credits and "best price" flags); its text is
 * the description followed by the disclaimer, with links and the licensing
 * line removed. Null when the page carries no carousel at all.
 */
export function parsePulteOffers(html: string): { slides: Array<{ title: string; description: string; disclaimer: string }>; rateOffer: string | null } | null {
  if (!/SpecialOffersV2/.test(html)) return null;
  const slides: Array<{ title: string; description: string; disclaimer: string }> = [];
  for (const match of Array.from(html.matchAll(/SpecialOffersV2__title[^>]*>\s*<span>([\s\S]*?)<\/span>([\s\S]*?)SpecialOffersV2__description[^>]*>([\s\S]*?)<\/div>/g))) {
    const [, title, between, description] = match;
    const disclaimerAttr = /data-content=(['"])([\s\S]*?)\1\s*>/.exec(between!);
    const disclaimer = disclaimerAttr ? cleanDisclaimer(disclaimerAttr[2]!) : "";
    slides.push({ title: htmlToText(title!), description: htmlToText(description!), disclaimer });
  }
  const rate = slides.find((slide) => /\d+(?:\.\d+)?\s*%\s*(?:\/\s*\d+(?:\.\d+)?\s*%\s*)?APR|rate\s+as\s+low\s+as\s+\d|\d+(?:\.\d+)?%\s+(?:fixed|interest)/i.test(`${slide.description} ${slide.disclaimer}`));
  return { slides, rateOffer: rate ? [rate.description, rate.disclaimer].filter(Boolean).join(" ") : null };
}

function cleanDisclaimer(attr: string): string {
  const text = htmlToText(decodeHtmlEntities(attr).replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ").replace(/^\s*Disclaimer\s*/i, ""));
  return text
    // The licensing line (NMLS lookup links) closes the disclaimer; the copyright sentence and the date tag say nothing about the offer.
    .replace(/\bLicensing information:[\s\S]*$/i, " ")
    .replace(NMLS_ID_PATTERN_ALL, " ")
    .replace(/(?:&copy;|©|\(c\))\s*\d{4}.{0,120}?All rights reserved\.?/gi, " ")
    .replace(/(?:&copy;|©|\(c\))\s*\d{4}[^.]*\./gi, " ")
    .replace(/\[[A-Za-z]+\s+\d{4}\]/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9.-]+\.(?:com|org|net)\/\S*/gi, " ")
    .replace(/^\s*Disclaimer\s+/i, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function marketListings(host: string, brand: PulteGroupBrand, fetcher: HtmlFetcher, now: number, snapshot: PrivateDealSnapshot): Promise<{ listings: Listing[] } | { hold: DealHoldReason }> {
  const cached = listingCache.get(host);
  if (cached && now - cached.fetchedAt < CACHE_MS) return { listings: cached.listings };
  const url = pulteListingUrl(host, brand);
  const page = await getDocument(url, fetcher, "application/json", host);
  if (!page.ok) return { hold: page.redirectedOffOfficialHost ? "unsupported_official_host" : "inventory_fetch_failed" };
  snapshot.pages.push(sourcePage("inventory", url, null));
  const listings = parsePulteListing(page.text);
  if (!listings) return { hold: "invalid_inventory_response" };
  listingCache.set(host, { listings, fetchedAt: now });
  return { listings };
}

async function marketOffer(host: string, pageUrl: string, fetcher: HtmlFetcher, now: number, snapshot: PrivateDealSnapshot): Promise<{ offer: { text: string; sourceUrl: string } | null } | { hold: DealHoldReason }> {
  const cached = offersCache.get(host);
  if (cached && now - cached.fetchedAt < CACHE_MS) return { offer: cached.offer };
  const page = await getDocument(pageUrl, fetcher, "text/html,application/xhtml+xml", host);
  if (!page.ok) return { hold: page.redirectedOffOfficialHost ? "unsupported_official_host" : "incentive_fetch_failed" };
  const offers = parsePulteOffers(page.text);
  if (!offers) return { hold: "expected_incentive_container_not_found" };
  snapshot.pages.push(sourcePage("incentive", pageUrl, null));
  const offer = offers.rateOffer ? { text: offers.rateOffer, sourceUrl: pageUrl } : null;
  offersCache.set(host, { offer, fetchedAt: now });
  return { offer };
}

export class PulteGroupAdapter implements DealAdapter {
  readonly builder: PulteGroupBrand;
  readonly host: string;

  constructor(brand: PulteGroupBrand) {
    this.builder = brand;
    this.host = PULTEGROUP_HOSTS[brand];
  }

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, this.host)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const id = pulteCommunityId(community.pathname);
    if (id === null) return failedResult(config, fetchedAt, privateSnapshot, ["missing_community_guid"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    // The market listing says whether this community is still listed, and carries its facts.
    const market = await marketListings(this.host, this.builder, fetcher, now().getTime(), privateSnapshot);
    if ("hold" in market) return failedResult(config, fetchedAt, privateSnapshot, [market.hold]);
    const listing = market.listings.find((entry) => entry.id === id);
    if (!listing) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    privateSnapshot.communityFacts = { fromPrice: listing.startingFromPrice && listing.startingFromPrice >= 50_000 ? listing.startingFromPrice : null, schoolDistrict: listing.schoolDistrictLabel, lotSizes: null, amenities: [] };
    const qmiUrl = `https://${this.host}/api/plan/qmiplans?communityId=${id}`;
    const plansUrl = `https://${this.host}/api/plan/homeplans?communityId=${id}`;
    const [qmiPage, plansPage] = [await getDocument(qmiUrl, fetcher, "application/json", this.host), await getDocument(plansUrl, fetcher, "application/json", this.host)];
    for (const page of [qmiPage, plansPage]) if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "inventory_fetch_failed"]);
    const qmis = jsonArray(qmiPage.ok ? qmiPage.text : "");
    const plans = jsonArray(plansPage.ok ? plansPage.text : "");
    if (!qmis || !plans) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    if (qmis.length > PULTEGROUP_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    privateSnapshot.pages.push(sourcePage("inventory", qmiUrl, null), sourcePage("inventory", plansUrl, null));
    for (const entry of qmis) {
      const home = parsePulteQmi(entry, this.host, now());
      // A record for another community, or one without the fields a home needs, means the endpoint changed shape.
      if (!home || home.communityId !== id) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
      const { kind: _kind, communityId: _communityId, ...item } = home;
      privateSnapshot.homes.push(item);
    }
    for (const entry of plans) {
      if (flag(entry.isSoldOut) === true || flag(entry.isFutureRelease) === true || flag(entry.isPlanActive) === false) continue;
      const plan = parsePultePlan(entry, this.host);
      if (!plan || plan.communityId !== id) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
      const { kind: _kind, communityId: _communityId, ...item } = plan;
      privateSnapshot.plans.push(item);
    }
    // The brand's market offers sit on every home and plan page; one page an hour per brand is read for them.
    // A sold home's page may be gone, so homes still for sale come first, then plans; a page that cannot be read gives way to the next.
    const candidates = [...privateSnapshot.homes.filter((home) => home.status !== "Sold"), ...privateSnapshot.plans, ...privateSnapshot.homes.filter((home) => home.status === "Sold")].map((item) => item.sourceUrl).slice(0, 3);
    const incentiveHolds: DealHoldReason[] = [];
    let offerHold: DealHoldReason | null = null;
    for (const offerPage of candidates) {
      const offer = await marketOffer(this.host, offerPage, fetcher, now().getTime(), privateSnapshot);
      // A page that was read but carries no carousel says more than one that could not be read; a redirect off the host ends the search.
      if ("hold" in offer) { if (offerHold !== "expected_incentive_container_not_found") offerHold = offer.hold; if (offer.hold === "unsupported_official_host") break; continue; }
      offerHold = null;
      privateSnapshot.offerRead = true;
      if (offer.offer) privateSnapshot.incentive = { sourceUrl: offer.offer.sourceUrl, text: offer.offer.text, facts: parsePromotionalRate(offer.offer.text) };
      break;
    }
    if (offerHold) incentiveHolds.push(offerHold);
    // A community with nothing listed has no page of its own to read; the brand's offer read within the hour still applies to it.
    if (!candidates.length) {
      const cached = offersCache.get(this.host);
      if (cached && now().getTime() - cached.fetchedAt < CACHE_MS && cached.offer) privateSnapshot.incentive = { sourceUrl: cached.offer.sourceUrl, text: cached.offer.text, facts: parsePromotionalRate(cached.offer.text) };
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
  }
}

function jsonArray(body: string): Array<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) && parsed.every((entry) => entry && typeof entry === "object") ? parsed as Array<Record<string, unknown>> : null;
  } catch {
    return null;
  }
}
