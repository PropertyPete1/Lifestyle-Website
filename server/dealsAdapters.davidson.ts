import {
  DAVIDSON_HOST, asUrl, decodeHtmlEntities, emptyPrivate, failedResult, getDocument, makePublicSnapshot, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlFetcher, type PrivateDealSnapshot, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * DAVIDSON HOMES reader. The site is a Next.js app whose community page
 * carries everything in `__NEXT_DATA__.props.pageProps`: `community.availableHomes`
 * (address, price, the price it dropped from, specs, lot, completion month,
 * Sanity photo references), `community.plans`, the sales office address, and
 * a banner pointing at the region's promotion page, whose own `__NEXT_DATA__`
 * has the offer's title, copy and fine print. Read-only, plain GET, official
 * host only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - community: /states/texas/san-antonio-market-area/<city>/<community>/   (about 900 KB)
 * - home:      .../<community>/available-homes/<address-slug>/
 * - plan:      .../<community>/floor-plans/<plan-slug>/
 * - promotion: /states/texas/san-antonio-market-area/promotions/<slug>/     (community.communityBanner.template.bannerLink)
 * - region:    /states/texas/san-antonio-market-area/   (pageProps.communities: every community of the market)
 */
/** A community with more homes for sale than this is held, never truncated. */
export const DAVIDSON_MAX_HOMES = 150;
const PROMO_CACHE_MS = 60 * 60_000;
let promoCache: { path: string; parsed: { text: string; communities: string[] }; fetchedAt: number } | null = null;

/** Test seam only. */
export function resetDavidsonCaches() {
  promoCache = null;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : null;
const num = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value.replace(/[$,]/g, ""))) ? Number(value.replace(/[$,]/g, "")) : null;
const slugOf = (value: unknown): string | null => str(obj(value)?.current) ?? str(value);

/** The page's Next.js data, or null when the page carries none. */
export function parseNextData(html: string): Json | null {
  const match = /<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  try { return obj(JSON.parse(match[1]!)); } catch { return null; }
}

/** Sanity's image CDN: "image-<hash>-<w>x<h>-<fmt>" under the project and dataset the page itself uses. */
export function sanityImageUrl(ref: unknown, project: { id: string; dataset: string } | null): string | null {
  const match = typeof ref === "string" ? /^image-([a-f0-9]+)-(\d+x\d+)-([a-z0-9]+)$/i.exec(ref) : null;
  if (!match || !project) return null;
  return `https://cdn.sanity.io/images/${project.id}/${project.dataset}/${match[1]}-${match[2]}.${match[3]}`;
}

/** The Sanity project the page's own image URLs point at (cdn.sanity.io/images/<id>/<dataset>/…). */
export function sanityProject(html: string): { id: string; dataset: string } | null {
  const match = /cdn\.sanity\.io\/(?:images|files)\/([a-z0-9]+)\/([a-z0-9-]+)\//i.exec(html);
  return match ? { id: match[1]!, dataset: match[2]! } : null;
}

function gallery(images: unknown, project: { id: string; dataset: string } | null, representative: boolean): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const image of arr(images)) {
    const url = sanityImageUrl(obj(obj(image)?.asset)?._ref, project);
    const alt = str(obj(image)?.alt) ?? "";
    if (!url || seen.has(url) || /floor\s*plan|site\s*plan|plat\b/i.test(alt)) continue;
    seen.add(url);
    const size = /-(\d+)x(\d+)\./.exec(url);
    out.push({ sourceUrl: url, caption: representative ? "Representative image" : null, width: size ? Number(size[1]) : null, height: size ? Number(size[2]) : null, srcSet: null });
  }
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type DavidsonPage = {
  community: Json;
  /** The community's own facts for the catalog and for discovery. */
  facts: { name: string | null; street: string | null; city: string | null; zip: string | null; phone: string | null; geo: { lat: number; lng: number } | null; status: string | null; fromPrice: number | null; schoolDistrict: string | null; amenities: string[] };
  homes: PrivatePlanOrHome[];
  plans: PrivatePlanOrHome[];
  promotionPath: string | null;
};

/** One Davidson community page; null when it is not one (no community in the page data). */
export function parseDavidsonCommunity(html: string, pageUrl: string): DavidsonPage | null {
  const url = asUrl(pageUrl);
  const data = parseNextData(html);
  const props = obj(obj(data?.props)?.pageProps);
  const community = obj(props?.community);
  if (!url || !community || !Array.isArray(community.availableHomes) || !Array.isArray(community.plans)) return null;
  const project = sanityProject(html);
  const base = url.pathname.replace(/\/+$/, "");
  const city = str(obj(props?.city)?.title) ?? str(community.city);
  const office = obj(community.salesOffice);
  const zip = /^\d{5}/.exec(str(office?.zipCode) ?? str(community.subZipCode) ?? "")?.[0] ?? null;
  const cityLine = [city, zip ? `TX ${zip}` : "TX"].filter(Boolean).join(", ");
  const homes: PrivatePlanOrHome[] = [];
  for (const raw of community.availableHomes) {
    const home = obj(raw);
    if (!home) continue;
    const street = str(home.title)?.replace(/\.$/, "") ?? null;
    const slug = slugOf(home.slug);
    if (!street || !slug) continue;
    const price = num(home.price);
    const old = num(home.oldPrice);
    const status = str(home.status) ?? "";
    const sold = /sold|pending|contract/i.test(status);
    const readyNow = /move\s*in\s*ready|moveinready/i.test(str(home.overrideMls) ?? "") || /move[- ]?in\s+ready/i.test(status);
    const completion = /^(\d{4})-(\d{2})/.exec(str(home.estCompletionMonth) ?? "");
    const moveInDate = !sold && !readyNow && completion ? `${MONTHS[Number(completion[2]) - 1]} ${completion[1]}` : null;
    const baths = (num(home.baths) ?? 0) + (num(home.halfBaths) ?? 0) * 0.5;
    const lot = str(home.lotId);
    homes.push({
      sourceUrl: `${url.origin}${base}/available-homes/${slug}/`,
      privateName: street,
      privateAddress: `${street}, ${cityLine}`,
      privatePlanName: str(obj(home.floorPlanPicker)?.title),
      status: sold ? "Sold" : readyNow ? "Quick Move-In (Move-In Ready)" : moveInDate ? `Quick Move-In (${moveInDate})` : "Quick Move-In",
      price: price && price > 0 ? price : null,
      previousPrice: old && price && old > price ? old : null,
      priceDrop: old && price && old > price ? old - price : null,
      bedrooms: num(home.beds),
      bathrooms: baths || null,
      squareFeet: num(home.sqft),
      homesite: lot ? `Lot ${lot}` : null,
      readyNow,
      moveInDate,
      gallery: gallery(home.propertyImages, project, false),
    });
  }
  const plans: PrivatePlanOrHome[] = [];
  for (const raw of community.plans) {
    const plan = obj(raw);
    const name = plan ? str(plan.title) : null;
    const slug = plan ? slugOf(plan.slug) : null;
    if (!plan || !name || !slug) continue;
    const price = num(plan.price);
    plans.push({
      sourceUrl: `${url.origin}${base}/floor-plans/${slug}/`,
      privateName: name, privatePlanName: name, status: null,
      price: price && price > 0 ? price : null,
      bedrooms: num(plan.beds), bathrooms: ((num(plan.baths) ?? 0) + (num(plan.halfBaths) ?? 0) * 0.5) || null, squareFeet: num(plan.sqft), readyNow: false,
      gallery: gallery(plan.propertyImages, project, true),
    });
  }
  const coordinates = obj(community.coordinates);
  const lat = num(coordinates?.lat);
  const lng = num(coordinates?.lng);
  const range = obj(community.communityPriceRange);
  const schools = arr(community.schools).map((school) => str(obj(school)?.schoolTitle) ?? "");
  const district = schools.map((school) => /\b((?:[A-Z][A-Za-z.'-]+\s+){1,4}(?:ISD|CISD|Independent School District))\b/.exec(school)?.[1] ?? null).find(Boolean) ?? null;
  const banner = obj(obj(community.communityBanner)?.template);
  const promotionPath = obj(community.communityBanner)?.enableCommunityBanner && str(banner?.bannerLink) ? str(banner?.bannerLink) : null;
  return {
    community,
    facts: {
      name: str(community.title), street: str(office?.streetAddress) ?? str(community.subStreet1), city, zip, phone: (str(community.phone) ?? "").replace(/[^\d+]/g, "") || null,
      geo: lat !== null && lng !== null ? { lat, lng } : null, status: str(community.communityStatus),
      fromPrice: num(range?.lowestPrice), schoolDistrict: district,
      amenities: arr(community.features).map((feature) => str(feature) ?? str(obj(feature)?.title) ?? "").filter((feature) => feature.length >= 3 && feature.length <= 60).slice(0, 20),
    },
    homes, plans, promotionPath,
  };
}

/** Portable-text blocks to plain text, one paragraph per block. */
function blocksText(blocks: unknown): string[] {
  return arr(blocks).map((block) => arr(obj(block)?.children).map((child) => str(obj(child)?.text) ?? "").join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * The promotion page's offer: title, copy and fine print as one text, so the
 * promotional-rate parser sees the rate, APR, loan type, down payment and the
 * deadline. Null when the page carries no promotion.
 */
export function parseDavidsonPromotion(html: string): { text: string; title: string | null; eventEnd: string | null; communities: string[] } | null {
  const data = parseNextData(html);
  const promo = obj(obj(obj(data?.props)?.pageProps)?.promo);
  if (!promo) return null;
  const title = str(promo.title);
  const parts = [title, ...blocksText(promo.content), ...blocksText(promo.finePrint)].filter((part): part is string => Boolean(part));
  // Links, phone numbers and form copy say nothing about the offer.
  const text = parts.join(" ").replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ").replace(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g, " ").replace(/\s+/g, " ").trim();
  const communities = arr(promo.regions).flatMap((region) => arr(obj(region)?.communities).map((community) => str(obj(community)?.title) ?? str(community) ?? "")).filter(Boolean);
  return text ? { text, title, eventEnd: str(promo.eventEnd), communities } : null;
}

export class DavidsonAdapter implements DealAdapter {
  readonly builder = "Davidson Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, DAVIDSON_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", DAVIDSON_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseDavidsonCommunity(page.text, community.toString());
    if (!parsed) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.homes.length > DAVIDSON_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    privateSnapshot.communityFacts = { fromPrice: parsed.facts.fromPrice && parsed.facts.fromPrice >= 50_000 ? parsed.facts.fromPrice : null, schoolDistrict: parsed.facts.schoolDistrict, lotSizes: null, amenities: parsed.facts.amenities };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    privateSnapshot.plans.push(...parsed.plans);
    const incentiveHolds: DealHoldReason[] = [];
    if (parsed.promotionPath) {
      const offer = await promotion(parsed.promotionPath, fetcher, now().getTime(), privateSnapshot, config.privateCommunityName);
      if ("hold" in offer) incentiveHolds.push(offer.hold);
      else if (offer.offer) privateSnapshot.incentive = { sourceUrl: offer.sourceUrl, text: offer.offer.text, facts: parsePromotionalRate(offer.offer.text) };
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
  }
}

/** The region's promotion page, read once an hour; the offer applies to this community only when the page lists it (or lists no communities at all). */
async function promotion(path: string, fetcher: HtmlFetcher, now: number, snapshot: PrivateDealSnapshot, communityName: string): Promise<{ offer: { text: string } | null; sourceUrl: string } | { hold: DealHoldReason }> {
  const url = asUrl(new URL(path, `https://${DAVIDSON_HOST}/`).toString());
  if (!url || !sameOfficialHost(url, DAVIDSON_HOST)) return { hold: "unsupported_official_host" };
  const sourceUrl = url.toString();
  let parsed: { text: string; communities: string[] };
  if (promoCache && promoCache.path === url.pathname && now - promoCache.fetchedAt < PROMO_CACHE_MS) parsed = promoCache.parsed;
  else {
    const page = await getDocument(sourceUrl, fetcher, "text/html,application/xhtml+xml", DAVIDSON_HOST);
    if (!page.ok) return { hold: page.redirectedOffOfficialHost ? "unsupported_official_host" : "incentive_fetch_failed" };
    const promo = parseDavidsonPromotion(page.text);
    if (!promo) return { hold: "expected_incentive_container_not_found" };
    parsed = { text: promo.text, communities: promo.communities };
    promoCache = { path: url.pathname, parsed, fetchedAt: now };
  }
  snapshot.pages.push(sourcePage("incentive", sourceUrl, null));
  const listed = parsed.communities.length === 0 || parsed.communities.some((name) => name.toLowerCase() === communityName.toLowerCase());
  return { offer: listed ? { text: parsed.text } : null, sourceUrl };
}

/** The market page's community links (pageProps.communities[].uri), for discovery. */
export function davidsonMarketLinks(html: string): string[] | null {
  const data = parseNextData(html);
  const communities = obj(obj(data?.props)?.pageProps)?.communities;
  if (!Array.isArray(communities)) return null;
  return communities.flatMap((entry) => { const uri = str(obj(entry)?.uri); return uri ? [uri] : []; });
}

/** The community's record for discovery, from its own page: name, sales office address, phone, coordinates, starting price. */
export function davidsonRecord(html: string, pageUrl: string): { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null } | null {
  const parsed = parseDavidsonCommunity(html, pageUrl);
  if (!parsed?.facts.name) return null;
  const { name, street, city, zip, phone, geo, fromPrice } = parsed.facts;
  return { name, street, city, zip, phone, priceFrom: fromPrice && fromPrice >= 50_000 ? fromPrice : null, geo };
}
