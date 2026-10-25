import {
  NMLS_ID_PATTERN_ALL, STARLIGHT_HOST, asUrl, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
  storiesFrom,
} from "./dealsAdapters";
import { jsonLdRecords } from "./dealsAdapters.homefiniti";

/**
 * STARLIGHT HOMES reader (Ashton Woods' entry-level brand). The community
 * page is server-rendered: the homes for sale sit in one `table.qmi-table`
 * (a `thead` row, then one `tbody tr.qmi-table__row` per home with
 * `.qmi-table__price` "$269,990", the street in `.qmi-table__cell--location`,
 * the plan link in `.qmi-table__cell--plan`, "3 Beds | 2 Baths<br>1,402 sq.
 * ft." in `.qmi-table__cell--details`, and "Ready Now" or "Available
 * November 2026" in `.qmi-table__cell--date`), under a heading "N Available
 * Homes In This Neighborhood". The homes have no pages of their own, so each
 * is keyed as `/<community>/available-homes/<street slug>` (a path, since
 * the source key drops fragments and queries). Plans
 * are `.plan-card`s (`.plan-card__heading a`, `.specs__item--beds/baths/
 * stories/garage/area`, photos on `awh.widen.net`) with no price (the site
 * sells by monthly payment). The community's record is a schema.org
 * `HomeAndConstructionBusiness` with the sales address, phone and
 * coordinates. The page's "*Terms are based upon a loan…" paragraph states
 * the current financing offer in full (a 2/1 buydown or a 5/1 ARM with APR,
 * term, down payment and expiry); it is the offer text. The market page
 * `/san-antonio` links every community. Read-only, plain GET, official host
 * only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - market:    /san-antonio                      (about 900 KB)
 * - community: /san-antonio/<slug>               (about 380 KB)
 * - plan:      /san-antonio/<slug>/<plan>
 */
/** A community with more homes for sale than this is held, never truncated. */
export const STARLIGHT_MAX_HOMES = 150;
export const STARLIGHT_PHOTO_HOST = "awh.widen.net";
export const starlightListingUrl = () => `https://${STARLIGHT_HOST}/san-antonio`;
const MONTHS: Record<string, string> = { january: "January", february: "February", march: "March", april: "April", may: "May", june: "June", july: "July", august: "August", september: "September", october: "October", november: "November", december: "December" };

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : null;
const num = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * "Ready Now" is ready; "Available November 2026" names a month (a past one
 * is a stale estimate: no date); other wording, or none, gives no status
 * (the run is held).
 */
export function starlightStatus(label: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under\s+contract/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/^(?:ready\s+now|move[- ]?in\s+ready|available\s+now)!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const dated = /^(?:available|ready|est\.?(?:imated)?\s+completion)\s+([A-Za-z]+)\s+(\d{4})$/i.exec(text);
  const month = dated ? MONTHS[dated[1]!.toLowerCase()] : undefined;
  const year = dated ? Number(dated[2]) : null;
  if (!month || year === null || year < 2000 || year > now.getUTCFullYear() + 5) return { status: null, readyNow: false, moveInDate: null };
  const index = Object.values(MONTHS).indexOf(month);
  if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && index < now.getUTCMonth())) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${month} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type StarlightCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

/** The community's schema.org business record: name without the brand suffix, sales address, phone and pin; null when the page has none. */
export function starlightRecord(html: string): StarlightCommunityRecord | null {
  const record = jsonLdRecords(html).find((item) => (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).some((type) => /^homeandconstructionbusiness$/i.test(String(type))));
  const name = record ? str(record.name)?.replace(/\s+by\s+Starlight\s+Homes$/i, "") ?? null : null;
  if (!record || !name) return null;
  const address = obj(record.address);
  const street = str(address?.streetAddress);
  const geo = obj(record.geo);
  const lat = Number(geo?.latitude);
  const lng = Number(geo?.longitude);
  return {
    name,
    street: looksLikeStreetAddress(street) ? street : null,
    city: str(address?.addressLocality),
    zip: /^\d{5}/.exec(str(address?.postalCode) ?? "")?.[0] ?? null,
    phone: (str(record.telephone) ?? "").replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "") || null,
    priceFrom: null,
    geo: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
  };
}

/** The business record's own page URL on the official host, when it names one. */
export function starlightRecordUrl(html: string, host: string): URL | null {
  const record = jsonLdRecords(html).find((item) => (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).some((type) => /^homeandconstructionbusiness$/i.test(String(type))));
  const link = record ? str(record.url) : null;
  const url = link ? asUrl(link) : null;
  return url && sameOfficialHost(url, host) ? url : null;
}

function classText(scope: readonly HtmlElement[], html: string, token: string): string | null {
  const element = scope.find((item) => elementClass(item, token));
  return element ? elementText(element, html) || null : null;
}

function gallery(scope: readonly HtmlElement[]): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const image of scope.filter((item) => item.tag === "img" && elementClass(item, "plan-card__image"))) {
    const url = image.attributes.src ? asUrl(decodeHtmlEntities(image.attributes.src)) : null;
    if (!url || url.protocol !== "https:" || url.hostname.toLowerCase() !== STARLIGHT_PHOTO_HOST || /floor\s*plan|floorplan|site\s*plan|\.pdf$|\.svg$/i.test(url.pathname)) continue;
    url.search = "";
    if (seen.has(url.toString())) continue;
    seen.add(url.toString());
    out.push({ sourceUrl: url.toString(), caption: "Representative image", width: null, height: null, srcSet: null });
  }
  return out;
}

/** Links, phone numbers, NMLS ids and e-mail addresses go from the offer text. */
function cleanOfferText(value: string): string {
  return value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/\(?\b\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, " ")
    .replace(NMLS_ID_PATTERN_ALL, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/^\*+\s*/, "").replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim();
}

export type StarlightPage = {
  record: StarlightCommunityRecord | null;
  /** True when the business record's own `url` is another page on the host: a same-host redirect to another community. */
  foreignPage: boolean;
  /** True when a plan link sits under another community's path. */
  foreignPlan: boolean;
  /** The page's "N Available Homes In This Neighborhood" count, when stated. */
  statedHomeCount: number | null;
  /** True when the page has the home table at all (a community with none shows no table). */
  hasTable: boolean;
  homes: PrivatePlanOrHome[];
  plans: PrivatePlanOrHome[];
  offer: string | null;
  /** True when the terms element stops before the page's own buydown wording: the offer is held, never published cut short. */
  offerTruncated: boolean;
};

/** The community on the page; null when the page has no business record. */
export function parseStarlightCommunity(html: string, pageUrl: string, now: Date = new Date()): StarlightPage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  const record = starlightRecord(html);
  if (!community || !root || !record) return null;
  const host = community.hostname;
  const base = `${comparablePath(community.pathname.replace(/\/+$/, ""))}/`;
  const own = starlightRecordUrl(html, host);
  const foreignPage = own !== null && comparablePath(own.pathname.replace(/\/+$/, "")) !== comparablePath(community.pathname.replace(/\/+$/, ""));
  const all = descendants(root);
  const table = all.find((item) => item.tag === "table" && elementClass(item, "qmi-table"));
  const homes: PrivatePlanOrHome[] = [];
  const cityLine = record.city ? `${record.city}, ${record.zip ? `TX ${record.zip}` : "TX"}` : "TX";
  if (table) {
    const body = descendants(table).find((item) => item.tag === "tbody") ?? table;
    for (const row of descendants(body).filter((item) => item.tag === "tr" && elementClass(item, "qmi-table__row"))) {
      const cells = descendants(row);
      const street = classText(cells, html, "qmi-table__cell--location");
      const readable = looksLikeStreetAddress(street);
      const planCell = cells.find((item) => elementClass(item, "qmi-table__cell--plan"));
      const planLink = planCell ? descendants(planCell).find((item) => item.tag === "a") : undefined;
      const planName = planLink ? elementText(planLink, html) || null : null;
      const details = classText(cells, html, "qmi-table__cell--details") ?? "";
      const beds = /(\d+(?:\.\d)?)\s*beds?\b/i.exec(details);
      const baths = /(\d+(?:\.\d)?)\s*baths?\b/i.exec(details);
      const sqft = /([\d,]{3,6})\s*sq\.?\s*ft/i.exec(details);
      const status = starlightStatus(classText(cells, html, "qmi-table__cell--date"), now);
      homes.push({
        // The homes have no pages: each is keyed by a path under the community page named by its street (a fragment or query would be dropped by the source key), so a row's key does not shift when another row goes.
        sourceUrl: readable ? `${community.origin}${community.pathname.replace(/\/+$/, "")}/available-homes/${street.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}` : `${community.origin}${community.pathname.replace(/\/+$/, "")}/unreadable-${homes.length}`,
        privateName: street,
        privateAddress: street ? `${street}, ${cityLine}` : null,
        privatePlanName: planName,
        status: readable ? status.status : null,
        price: num(classText(cells, html, "qmi-table__price")),
        bedrooms: beds ? Number(beds[1]) : null,
        bathrooms: baths ? Number(baths[1]) : null,
        squareFeet: sqft ? num(sqft[1]) : null,
        readyNow: status.readyNow,
        moveInDate: status.moveInDate,
        gallery: [],
      });
    }
  }
  const plans: PrivatePlanOrHome[] = [];
  let foreignPlan = false;
  for (const card of all.filter((item) => elementClass(item, "plan-card"))) {
    const inner = descendants(card);
    const heading = inner.find((item) => elementClass(item, "plan-card__heading"));
    const link = heading ? descendants(heading).find((item) => item.tag === "a" && item.attributes.href) : undefined;
    const name = link ? elementText(link, html) || null : null;
    const page = link ? asUrl(new URL(decodeHtmlEntities(link.attributes.href!), community).toString()) : null;
    if (!name || !page || !sameOfficialHost(page, host)) continue;
    if (!comparablePath(page.pathname).startsWith(base)) { foreignPlan = true; continue; }
    const spec = (token: string, pattern: RegExp) => { const text = classText(inner, html, token); const match = text ? pattern.exec(text) : null; return match ? num(match[1]) : null; };
    plans.push({
      sourceUrl: `${page.origin}${page.pathname}`,
      privateName: name,
      privatePlanName: name,
      status: null,
      // The site sells by monthly payment; plan cards carry no price.
      price: null,
      bedrooms: spec("specs__item--beds", /(\d+(?:\.\d)?)/),
      bathrooms: spec("specs__item--baths", /(\d+(?:\.\d)?)/),
      squareFeet: spec("specs__item--area", /([\d,]{3,6})/),
      garage: spec("specs__item--garage", /(\d+(?:\.\d)?)/),
      stories: storiesFrom(spec("specs__item--stories", /(\d+(?:\.\d)?)/)),
      readyNow: false,
      gallery: gallery(inner),
    });
  }
  const text = htmlToText(html);
  const count = /(\d{1,3})\s+Available\s+Homes?\s+In\s+This\s+Neighborhood/i.exec(text);
  // The financing terms paragraph states the offer in full: the one element whose own text opens with it (never the page text after it); a page without it has no offer.
  // The paragraph is the longest `p`/`li` whose own text opens with the sentence (a span inside it, or a split lead sentence, would cut the buydown
  // wording off), else a span, else the shortest `div` (a wrapper runs on into the footer). An element that stops before the page text's own
  // buydown wording is a truncated offer, and says nothing.
  const candidates = all.filter((item) => /^(?:p|div|li|span)$/.test(item.tag)).map((item) => ({ item, text: elementText(item, html) })).filter(({ text: own }) => /^\*?\s*Terms\s+are\s+based\s+upon\s+a\s+loan/i.test(own));
  const byLength = (direction: 1 | -1) => (a: { text: string }, b: { text: string }) => direction * (a.text.length - b.text.length);
  const buydownWording = /\b(?:\d\/\d\s+program|buy[- ]?down|year\s+(?:one|two|three)\b)/i;
  // The innermost `p`/`li` that carries the whole run (the buydown wording) wins over a wrapper that would add the footer; else the longest.
  const blocks = candidates.filter(({ item }) => item.tag === "p" || item.tag === "li");
  const termsElement = blocks.filter(({ text: own }) => buydownWording.test(own)).sort(byLength(1))[0] ?? blocks.sort(byLength(-1))[0] ?? candidates.filter(({ item }) => item.tag === "span").sort(byLength(-1))[0] ?? candidates.filter(({ item }) => item.tag === "div").sort(byLength(1))[0] ?? null;
  // The terms run ends where the footer begins ("**Monthly payment…", "© 2026 …", "Privacy Policy"): wording after that is not the offer's.
  const lead = /\*?\s*Terms\s+are\s+based\s+upon\s+a\s+loan/i.exec(text);
  const following = lead ? text.slice(lead.index, lead.index + 2_500).split(/\*\*|©|\bCopyright\b|Privacy\s+Policy|Terms\s+of\s+Use/i)[0]! : "";
  const truncated = termsElement !== null && buydownWording.test(following) && !buydownWording.test(termsElement.text);
  const offer = termsElement && !truncated ? cleanOfferText(termsElement.text.slice(0, 4_000)) : null;
  return { record, foreignPage, foreignPlan, statedHomeCount: count ? Number(count[1]) : null, hasTable: Boolean(table), homes, plans, offer: offer && /\d+(?:\.\d+)?\s*%/.test(offer) ? offer : null, offerTruncated: truncated };
}

/** The market page's community links; null when there are none. Each page is read for its record. */
export function starlightListingEntries(html: string, host: string): Array<{ url: string; record: null }> | null {
  const out = new Map<string, { url: string; record: null }>();
  for (const match of Array.from(html.matchAll(/href="(\/san-antonio\/(?!areas\/)[a-z0-9-]+)\/?"/gi))) {
    const url = asUrl(new URL(decodeHtmlEntities(match[1]!), `https://${host}/`).toString());
    if (!url || !sameOfficialHost(url, host)) continue;
    const key = `${url.origin}${url.pathname}`;
    if (!out.has(key)) out.set(key, { url: key, record: null });
  }
  return out.size ? Array.from(out.values()) : null;
}

export class StarlightAdapter implements DealAdapter {
  readonly builder = "Starlight Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, STARLIGHT_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", STARLIGHT_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseStarlightCommunity(page.text, community.toString(), now());
    // Without the business record and its sales address this is not a community page.
    if (!parsed || !parsed.record?.street) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The page must be this community's (a same-host redirect to another one is not), and so must its plans.
    if (parsed.foreignPage || parsed.foreignPlan) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    // The page counts its homes; a table with fewer rows than that, or a count with no table, is a changed page.
    if (parsed.statedHomeCount !== null && (parsed.homes.length < parsed.statedHomeCount || (!parsed.hasTable && parsed.statedHomeCount > 0))) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // Rows without a count sentence are a page that changed shape.
    if (parsed.homes.length > 0 && parsed.statedHomeCount === null) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.homes.length > STARLIGHT_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    const prices = parsed.homes.map((home) => home.price).filter((price): price is number => price !== null && price >= 50_000);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? (prices.length ? Math.min(...prices) : null) };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    if (parsed.offer) privateSnapshot.incentive = { sourceUrl: community.toString(), text: parsed.offer, facts: parsePromotionalRate(parsed.offer) };
    privateSnapshot.offerRead = !parsed.offerTruncated;
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, parsed.offerTruncated ? ["expected_incentive_container_not_found"] : []));
  }
}
