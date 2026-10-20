import {
  ASHTON_HOST, asUrl, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, getDocument, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";
import { jsonLdRecords } from "./dealsAdapters.homefiniti";

/**
 * ASHTON WOODS reader. The community page is server-rendered with one
 * `.js-property-card` per plan ("series" cards: `.property-card--is-series`,
 * the plan's name as the title, "From $358,240", a link) and per quick move-in
 * home (`data-property-id`, `.property-card__body-title` "Available Now" or
 * "Available Nov 2026", `.property-card__title a` "7419 Hound Crossing<br>San
 * Antonio, TX 78252" linking to the home page, `.property-card__price` with
 * `--strike` and `--red` spans when the price dropped, a feature list with the
 * plan link (/san-antonio/all-home-plans/<plan>), "4 Beds", "3 Baths", "2165
 * sq. ft.", "1 Story", "2 Car Garage", and photos on `awh.widen.net`). A parent
 * community's page shows the homes of its child communities (The Preserve at
 * Hennersby Hollow under Hennersby Hollow), so discovery adds parents only.
 * The community's own record is a schema.org `HomeAndConstructionBusiness`
 * with the sales address but no coordinates; the division map endpoint
 * (`/ashton-woods/get-division-community-map/13`, JSON, no key) lists the
 * parents with coordinates and phone. Read-only, plain GET, official host
 * only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - community: /san-antonio/<slug>                                   (about 600-990 KB)
 * - home:      /san-antonio/<child slug>/<child slug>-<plan>/<address slug>
 * - plan:      /san-antonio/<slug>/<slug>-<plan>  (series card link)
 */
/** A community with more homes for sale than this is held, never truncated. */
export const ASHTON_MAX_HOMES = 150;
export const ASHTON_PHOTO_HOST = "awh.widen.net";
export const ASHTON_DIVISION_ID = "13";
export const ashtonListingUrl = () => `https://${ASHTON_HOST}/ashton-woods/get-division-community-map/${ASHTON_DIVISION_ID}`;

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
const MONTHS: Record<string, string> = { jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June", jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December" };
const MONTH_INDEX = Object.keys(MONTHS);

/** "Available Now" is ready; "Available Nov 2026" names a month (a past one is a stale estimate: no date); other wording gives no status (the run is held). */
export function ashtonStatus(label: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under\s+contract/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/^(?:available\s+now|move[- ]?in\s+ready|ready\s+now)!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const month = /^available\s+([A-Za-z]{3,9})\.?\s+(20\d{2})$/i.exec(text);
  const key = month ? month[1]!.toLowerCase().slice(0, 3) : "";
  if (!month || !MONTHS[key]) return { status: null, readyNow: false, moveInDate: null };
  const year = Number(month[2]);
  const index = MONTH_INDEX.indexOf(key);
  if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && index < now.getUTCMonth())) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${MONTHS[key]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type AshtonCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

/** The community's business record from the page's JSON-LD: name ("… By Ashton Woods" dropped), sales address, phone when given; no coordinates on the page. */
export function ashtonRecord(html: string): AshtonCommunityRecord | null {
  const record = jsonLdRecords(html).find((item) => (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).includes("HomeAndConstructionBusiness"));
  const name = record ? str(record.name)?.replace(/\s+by\s+Ashton\s+Woods$/i, "") ?? null : null;
  if (!record || !name) return null;
  const address = obj(record.address);
  const street = str(address?.streetAddress);
  return {
    name,
    // "By Appointment Only" in the street field is not an address.
    street: street && /\d/.test(street) ? street : null,
    city: str(address?.addressLocality),
    zip: /^\d{5}/.exec(str(address?.postalCode) ?? "")?.[0] ?? null,
    phone: (str(record.telephone) ?? "").replace(/[^\d]/g, "") || null,
    priceFrom: null,
    geo: null,
  };
}

function classText(scope: readonly HtmlElement[], html: string, token: string): string | null {
  const element = scope.find((item) => elementClass(item, token));
  return element ? elementText(element, html) || null : null;
}

function gallery(card: readonly HtmlElement[]): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const image of card.filter((item) => item.tag === "img" && item.attributes.src)) {
    const url = asUrl(decodeHtmlEntities(image.attributes.src!));
    if (!url || url.hostname !== ASHTON_PHOTO_HOST) continue;
    url.search = "";
    if (seen.has(url.toString())) continue;
    seen.add(url.toString());
    out.push({ sourceUrl: url.toString(), caption: null, width: null, height: null, srcSet: null });
  }
  return out;
}

export type AshtonPage = {
  record: AshtonCommunityRecord | null;
  /** True when the business record's own `url` is another page on the host: a same-host redirect to another community. */
  foreignPage: boolean;
  homes: PrivatePlanOrHome[];
  plans: PrivatePlanOrHome[];
};

/** The business record's own page URL, when the record names one on the official host. */
export function ashtonRecordUrl(html: string, host: string): URL | null {
  const record = jsonLdRecords(html).find((item) => (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).includes("HomeAndConstructionBusiness"));
  const link = record ? str(record.url) : null;
  const url = link ? asUrl(link) : null;
  return url && sameOfficialHost(url, host) ? url : null;
}

/** Every property card on the page, homes and plans apart; null when the page has no card at all or no community record. */
export function parseAshtonCommunity(html: string, pageUrl: string, now: Date = new Date()): AshtonPage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const record = ashtonRecord(html);
  const cards = descendants(root).filter((element) => elementClass(element, "js-property-card"));
  if (!record || !cards.length) return null;
  const host = community.hostname;
  const own = ashtonRecordUrl(html, host);
  const foreignPage = own !== null && comparablePath(own.pathname.replace(/\/+$/, "")) !== comparablePath(community.pathname.replace(/\/+$/, ""));
  const homes: PrivatePlanOrHome[] = [];
  const plans: PrivatePlanOrHome[] = [];
  for (const card of cards) {
    const inner = descendants(card);
    const title = inner.find((item) => elementClass(item, "property-card__title"));
    const titleLink = title ? descendants(title).find((item) => item.tag === "a" && item.attributes.href) ?? null : null;
    const href = titleLink ? decodeHtmlEntities(titleLink.attributes.href!) : null;
    const page = href ? asUrl(new URL(href, community).toString()) : null;
    const link = page && sameOfficialHost(page, host) ? page : null;
    const features = inner.filter((item) => item.tag === "li").map((item) => elementText(item, html));
    const find = (pattern: RegExp) => { for (const feature of features) { const match = pattern.exec(feature); if (match) return match; } return null; };
    const beds = find(/(\d+(?:\.\d)?)\s*beds?\b/i);
    const baths = find(/(\d+(?:\.\d)?)\s*baths?\b/i);
    const sqft = find(/([\d,]{3,6})\s*sq\.?\s*ft/i);
    const garage = find(/(\d+(?:\.\d)?)\s*car\s+garage/i);
    const priceText = classText(inner, html, "property-card__price") ?? "";
    const strike = classText(inner, html, "property-card__price--strike");
    const reduced = classText(inner, html, "property-card__price--red");
    const current = num(/\$\s*([\d,]{6,})/.exec(reduced ?? priceText.replace(strike ?? "", ""))?.[1]);
    const previous = num(/\$\s*([\d,]{6,})/.exec(strike ?? "")?.[1]);
    const images = gallery(inner);
    if (elementClass(card, "property-card--is-series")) {
      const planName = title ? elementText(title, html) : null;
      if (!planName || !link) continue;
      plans.push({
        sourceUrl: link.toString(), privateName: planName, privatePlanName: planName, status: null,
        price: current && current > 0 ? current : null,
        bedrooms: beds ? Number(beds[1]) : null, bathrooms: baths ? Number(baths[1]) : null, squareFeet: sqft ? Number(sqft[1]!.replace(/,/g, "")) : null, garage: garage ? Number(garage[1]) : null,
        readyNow: false, gallery: images.map((image) => ({ ...image, caption: "Representative image" })),
      });
      continue;
    }
    // "7419 Hound Crossing<br>San Antonio, TX 78252": the street, then the city line.
    const titleText = title ? htmlLines(html.slice(title.contentStart, title.contentEnd)) : [];
    const street = titleText[0] ?? null;
    const cityLine = titleText.slice(1).join(", ") || null;
    const planLink = inner.find((item) => item.tag === "a" && /\/all-home-plans\//.test(item.attributes.href ?? ""));
    const status = ashtonStatus(classText(inner, html, "property-card__body-title"), now);
    const readable = Boolean(street && link && card.attributes["data-property-id"]);
    homes.push({
      sourceUrl: readable ? link!.toString() : `${community.origin}${community.pathname.replace(/\/+$/, "")}/unreadable-${homes.length}`,
      privateName: street,
      privateAddress: street && cityLine ? `${street}, ${cityLine}` : street,
      privatePlanName: planLink ? elementText(planLink, html) || null : null,
      status: readable && current ? status.status : null,
      price: current && current > 0 ? current : null,
      previousPrice: previous && current && previous > current ? previous : null,
      priceDrop: previous && current && previous > current ? previous - current : null,
      bedrooms: beds ? Number(beds[1]) : null, bathrooms: baths ? Number(baths[1]) : null, squareFeet: sqft ? Number(sqft[1]!.replace(/,/g, "")) : null, garage: garage ? Number(garage[1]) : null,
      readyNow: status.readyNow, moveInDate: status.moveInDate, gallery: images,
    });
  }
  return { record, foreignPage, homes, plans };
}

/** The text lines of a fragment, split at line breaks. */
function htmlLines(fragment: string): string[] {
  return fragment.split(/<br\s*\/?>/i).map((part) => decodeHtmlEntities(part.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** The division map's parent communities with coordinates and phone; the page is still read for the address. Null when the body is not the map. */
export function ashtonListingEntries(body: string, host: string): Array<{ url: string; record: AshtonCommunityRecord }> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const data = obj(parsed);
  if (!data || !Array.isArray(data.communities)) return null;
  const out: Array<{ url: string; record: AshtonCommunityRecord }> = [];
  for (const raw of data.communities) {
    const group = obj(raw);
    const coordinates = obj(group?.coordinates);
    const lat = num(coordinates?.lat);
    const lng = num(coordinates?.lon ?? coordinates?.lng);
    for (const rawItem of arr(group?.items)) {
      const item = obj(rawItem);
      const url = asUrl(str(item?.url) ?? "");
      const name = str(item?.community_title);
      if (!item || !url || !sameOfficialHost(url, host) || !name) continue;
      out.push({ url: `${url.origin}${url.pathname}`, record: {
        name, street: null, city: str(item.area), zip: null,
        phone: (str(item.community_phone) ?? "").replace(/[^\d]/g, "") || null, priceFrom: null,
        geo: lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
      } });
    }
  }
  return out;
}

export class AshtonWoodsAdapter implements DealAdapter {
  readonly builder = "Ashton Woods" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, ASHTON_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", ASHTON_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [page.redirectedOffOfficialHost ? "unsupported_official_host" : "community_fetch_failed"]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseAshtonCommunity(page.text, community.toString(), now());
    // Without the business record or a single property card this is not a community page (a sold-out page shape is a live check).
    if (!parsed) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The page must be this community's (a same-host redirect to another one is not).
    if (parsed.foreignPage) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // The page's own count of homes: the "data-property-id" cards; fewer homes read than cards means the card markup changed.
    const cardCount = (page.text.match(/\bdata-property-id="/g) ?? []).length;
    if (parsed.homes.length < cardCount) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.homes.length > ASHTON_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    const planPrices = parsed.plans.map((plan) => plan.price).filter((price): price is number => price !== null);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? (planPrices.length ? Math.min(...planPrices) : null) };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    // The seasonal banner ("Fall Savings that Feel Right at Home") opens a form with no offer terms on the page; not read.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
