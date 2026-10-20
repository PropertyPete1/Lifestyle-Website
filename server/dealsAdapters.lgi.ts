import {
  LGI_HOST, asUrl, decodeHtmlEntities, emptyPrivate, failedResult, getDocument, makePublicSnapshot, parseCommunityFacts, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";
import { parseNextData } from "./dealsAdapters.davidson";

/**
 * LGI HOMES reader. The site is Sitecore JSS on Next.js; a community page's
 * `__NEXT_DATA__` carries the community in `pageProps.page.layout.sitecore.route.fields`
 * (`CommunityName`, `Address1`, `City`, `ZipCode`, `Phone`, `Latitude`,
 * `Longitude`, `SaleStatus.fields.Key` "Active" | "Sold Out" | "Reduced
 * Pricing!" | "Immediate Move-in", `MinListPrice`, `PandIInfo` "5% Fixed /
 * 5.805% APR, 3.5% Down, FHA 30 Year") and its floor plans in the
 * `FloorPlanSearch` component's props (`pageProps.componentProps[uid]
 * .community.floorplans.results[]`: `floorPlanName`, `listPrice`,
 * `previousListPrice`, `numberofBedrooms`, `numberofBathrooms`,
 * `numberofCarGarage`, `numberofStories`, `sizeSqft`, `adStatus.fields.Key`,
 * `url.path`). LGI sells by floor plan; the pages name no addressed homes, so
 * the reader publishes plans only. The market page's `CommunitySearch`
 * component lists every community with coordinates, phone, city and status
 * (no street), so discovery reads each page for its address. Read-only, plain
 * GET, official host only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - market:    /texas/san-antonio                      (about 380 KB)
 * - community: /texas/san-antonio/<slug>               (about 300 KB)
 * - plan:      /texas/san-antonio/<slug>/<plan>
 */
export const lgiListingUrl = () => `https://${LGI_HOST}/texas/san-antonio`;

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
/** Sitecore fields come as `{ value }` or `{ jsonValue: { value } }`. */
const field = (value: unknown): unknown => { const item = obj(value); if (!item) return value; if ("jsonValue" in item) return field(item.jsonValue); return "value" in item ? item.value : item; };
/** A key-value item ("sale status") comes as `{ jsonValue: { fields: { Key: { value } } } }`. */
const keyOf = (value: unknown): string | null => { const item = obj(field(value)) ?? obj(value); const fields = obj(item?.fields); return str(field(fields?.Key)) ?? str(field(fields?.Value)) ?? str(item?.name); };

/** The props of the named component on the page, found through the route's placeholders. */
export function lgiComponentProps(data: Json | null, componentName: string): Json | null {
  const pageProps = obj(obj(data?.props)?.pageProps);
  const route = obj(obj(obj(obj(pageProps?.page)?.layout)?.sitecore)?.route);
  const props = obj(pageProps?.componentProps);
  if (!route || !props) return null;
  const queue: unknown[] = [route.placeholders];
  while (queue.length) {
    const placeholders = obj(queue.shift());
    for (const rendering of Object.values(placeholders ?? {}).flatMap(arr)) {
      const item = obj(rendering);
      if (!item) continue;
      if (item.componentName === componentName && typeof item.uid === "string" && obj(props[item.uid])) return obj(props[item.uid]);
      if (item.placeholders) queue.push(item.placeholders);
    }
  }
  return null;
}

export type LgiCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

function geoOf(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = num(lat);
  const b = num(lng);
  return a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (a !== 0 || b !== 0) ? { lat: a, lng: b } : null;
}

export type LgiPage = { record: LgiCommunityRecord | null; saleStatus: string | null; plans: PrivatePlanOrHome[]; offer: string | null; amenities: string[] };

/** A sold-out or not-yet-selling community has nothing to publish; any other label is a selling community. */
export function lgiSelling(saleStatus: string | null): boolean {
  return !/sold\s*out|coming\s+soon|closed|not\s+selling|future/i.test(saleStatus ?? "");
}

/** The community on the page; null when the page has no community route or no floor-plan component. */
export function parseLgiCommunity(html: string, pageUrl: string): LgiPage | null {
  const community = asUrl(pageUrl);
  const data = parseNextData(html);
  const route = obj(obj(obj(obj(obj(obj(data?.props)?.pageProps)?.page)?.layout)?.sitecore)?.route);
  const fields = obj(route?.fields);
  const search = lgiComponentProps(data, "FloorPlanSearch");
  const plansList = obj(obj(search?.community)?.floorplans)?.results;
  if (!community || !fields || !search || !Array.isArray(plansList)) return null;
  const host = community.hostname;
  const name = str(field(fields.CommunityName));
  const record: LgiCommunityRecord | null = name ? {
    name,
    street: str(field(fields.Address1)),
    city: str(field(fields.City)),
    zip: /^\d{5}/.exec(str(field(fields.ZipCode)) ?? "")?.[0] ?? null,
    phone: (str(field(fields.Phone)) ?? "").replace(/[^\d]/g, "") || null,
    priceFrom: num(field(fields.MinListPrice)),
    geo: geoOf(field(fields.Latitude), field(fields.Longitude)),
  } : null;
  const plans: PrivatePlanOrHome[] = [];
  for (const raw of plansList) {
    const plan = obj(raw);
    if (!plan) continue;
    const planName = str(field(plan.floorPlanName));
    const path = str(obj(plan.url)?.path);
    const page = path ? asUrl(new URL(path, community).toString()) : null;
    if (!planName || !page || !sameOfficialHost(page, host)) continue;
    if (!/^active$/i.test(keyOf(plan.adStatus) ?? "active")) continue;
    const price = num(field(plan.listPrice));
    const previous = num(field(plan.previousListPrice));
    const image = str(obj(field(plan.primaryImage))?.src);
    const gallery: PrivateGalleryImage[] = [];
    const imageUrl = image ? asUrl(image) : null;
    if (imageUrl && (sameOfficialHost(imageUrl, host) || (imageUrl.hostname === "edge.sitecorecloud.io" && /^\/lgihomes/i.test(imageUrl.pathname)))) gallery.push({ sourceUrl: imageUrl.toString(), caption: "Representative image", width: null, height: null, srcSet: null });
    plans.push({
      sourceUrl: page.toString(),
      privateName: planName,
      privatePlanName: planName,
      status: null,
      price: price && price > 0 ? price : null,
      previousPrice: previous && price && previous > price ? previous : null,
      priceDrop: previous && price && previous > price ? previous - price : null,
      bedrooms: num(field(plan.numberofBedrooms)),
      bathrooms: num(field(plan.numberofBathrooms)),
      squareFeet: num(field(plan.sizeSqft)),
      garage: num(field(plan.numberofCarGarage)),
      readyNow: false,
      gallery,
    });
  }
  const amenities = arr(fields.CommunityAmenities).map((item) => str(field(obj(obj(item)?.fields)?.AmenityTitle)) ?? str(obj(item)?.displayName)).filter((item): item is string => Boolean(item));
  const example = str(field(fields.PandIInfo));
  return {
    record,
    saleStatus: keyOf(fields.SaleStatus),
    plans,
    // "5% Fixed / 5.805% APR, 3.5% Down, FHA 30 Year" is the page's financing example; the rate parser reads its terms.
    offer: example && /\d+(?:\.\d+)?\s*%/.test(example) ? `Financing example: ${example}.` : null,
    amenities,
  };
}

/** The community's record for discovery, from its page. */
export function lgiRecord(html: string, pageUrl: string): LgiCommunityRecord | null {
  return parseLgiCommunity(html, pageUrl)?.record ?? null;
}

/** The market page's community list: pins, phones, cities and status; the page is still read for the address. Null when the list is not there. */
export function lgiListingEntries(html: string, host: string): Array<{ url: string; record: LgiCommunityRecord }> | null {
  const search = lgiComponentProps(parseNextData(html), "CommunitySearch");
  const results = obj(search?.communities)?.results;
  if (!Array.isArray(results)) return null;
  const out: Array<{ url: string; record: LgiCommunityRecord }> = [];
  for (const raw of results) {
    const item = obj(raw);
    const path = str(obj(item?.url)?.path);
    const name = str(field(item?.communityName));
    const url = path ? asUrl(new URL(path, `https://${host}/`).toString()) : null;
    if (!item || !url || !sameOfficialHost(url, host) || !name) continue;
    out.push({ url: `${url.origin}${url.pathname}`, record: {
      name, street: null, city: str(field(item.locationIdentifier)), zip: null,
      phone: (str(field(item.phone)) ?? "").replace(/[^\d]/g, "") || null,
      priceFrom: num(field(item.minListPrice)),
      geo: geoOf(field(item.latitude), field(item.longitude)),
    } });
  }
  return out;
}

export class LgiHomesAdapter implements DealAdapter {
  readonly builder = "LGI Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, LGI_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", LGI_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseLgiCommunity(page.text, community.toString());
    // Without the community route, its floor-plan component or its sales address this is not a community page.
    if (!parsed || !parsed.record?.street) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    privateSnapshot.communityFacts = { fromPrice: parsed.record.priceFrom && parsed.record.priceFrom >= 50_000 ? parsed.record.priceFrom : null, schoolDistrict: parseCommunityFacts(page.text).schoolDistrict, lotSizes: null, amenities: parsed.amenities };
    // LGI sells by floor plan; a sold-out or not-yet-selling community has nothing to publish.
    if (lgiSelling(parsed.saleStatus)) {
      for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
      if (parsed.offer) privateSnapshot.incentive = { sourceUrl: community.toString(), text: parsed.offer, facts: parsePromotionalRate(parsed.offer) };
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
