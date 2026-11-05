import {
  WILDOAK_HOST, asUrl, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * WILD OAK HOMES reader (Nov 5, 2026; Peter found Heritage Woods and Medina Trails missing from the site). A small
 * semi-custom builder on one-acre-plus homesites around San Antonio, New Braunfels, Austin and Brenham. WordPress
 * (Elementor), server-rendered: a community page (`/<slug>/`) carries one `article.wo-hc` card per home and per plan:
 * `a.wo-hc-img` (link to the home's page, `data-gal` = JSON array of photo URLs on the i0.wp.com image CDN, which
 * mirrors the official host's `/wp-content/uploads/` path), `.wo-hc-badge` ("Quick Move-In", "Under Construction",
 * "Coming Soon", "Now Pre-Selling", "Model Home", "Under Contract", "Floor Plan"), `.wo-hc-lot` ("Lot 64"),
 * `.wo-hc-eye` ("Heritage Woods · La Vernia"), `h3 > a` (the plan: "The Lavaca"), `.wo-hc-addr` (the street, or
 * "<street> · Sales center" on a model, or "La Vernia, TX" on a plan), `.wo-hc-specs` (`<b>1,880</b><span>Sq ft</span>`
 * pairs: Sq ft, Beds, Baths, Acres) and `.wo-hc-price` (`<b>$489,900</b><small>Move-in ready</small>`, or "From
 * $554,000", "Request pricing", "Tour the model", "$1.45M – $1.6M", "Under Contract"). The sales office is a text line
 * "Model & sales office: 113 Syrah Street, La Vernia, TX 78121" (or, on a community without a model, inside the FAQ:
 * "At the property: 729 CR 664, Devine, TX 78016"). The community index (`/our-communities/`) links each community.
 * Read-only, plain GET, official host only. Everything here is private operational data.
 *
 * Page shapes (November 2026):
 * - communities: /our-communities/            (about 300 KB)
 * - community:   /<slug>/                      (about 400 KB; also /available-homes/ for every community at once)
 * - home:        /property/<slug>/
 * - plan:        /property/<plan>/?community=<slug>
 */
export const WILDOAK_MAX_HOMES = 150;
export const wildOakListingUrl = () => `https://${WILDOAK_HOST}/our-communities/`;

const normalize = (value: string) => decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
const money = (value: string | null): number | null => { const match = value ? /\$\s*([\d,]{5,})/.exec(value) : null; return match ? Number(match[1]!.replace(/,/g, "")) : null; };

/**
 * The card badge decides the status: "Quick Move-In" is ready now; "Under Construction", "Coming Soon" and "Now
 * Pre-Selling" are homes for sale with no date yet; "Under Contract" sells; "Model Home" is the sales center (not for
 * sale); "Floor Plan" is a plan. Any other badge, or none, gives no status (the run is held: a layout change).
 */
export function wildOakStatus(badge: string | null): { status: string | null; readyNow: boolean; kind: "home" | "plan" | "model" } {
  const text = (badge ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (text === "floor plan") return { status: null, readyNow: false, kind: "plan" };
  if (text === "model home") return { status: "Model Home", readyNow: false, kind: "model" };
  if (text === "quick move-in" || text === "move-in ready") return { status: "Quick Move-In (Move-In Ready)", readyNow: true, kind: "home" };
  // "New Home" (Medina Trails, Nov 5: a lot with a plan chosen, "Reserve early") is a home for sale that is not built yet.
  if (text === "under construction" || text === "coming soon" || text === "now pre-selling" || text === "now selling" || text === "new home") return { status: "Quick Move-In", readyNow: false, kind: "home" };
  if (/under\s+contract|sold|pending/.test(text)) return { status: "Sold", readyNow: false, kind: "home" };
  return { status: null, readyNow: false, kind: "home" };
}

/** The i0.wp.com CDN copy of an official photo ("https://i0.wp.com/wildoakhomes.com/wp-content/uploads/…?fit=…") back on the official host, without the size query. */
export function wildOakPhotoUrl(raw: string): URL | null {
  const url = asUrl(decodeHtmlEntities(raw));
  if (!url) return null;
  if (url.hostname.toLowerCase() === "i0.wp.com" && url.pathname.toLowerCase().startsWith(`/${WILDOAK_HOST}/wp-content/uploads/`)) {
    const official = asUrl(`https://${WILDOAK_HOST}${url.pathname.slice(WILDOAK_HOST.length + 1)}`);
    return official;
  }
  if (!sameOfficialHost(url, WILDOAK_HOST) || !url.pathname.toLowerCase().startsWith("/wp-content/uploads/")) return null;
  url.search = "";
  return url;
}

export type WildOakCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

/** The community's name (og:title) and sales address from its page; null without a name. */
export function wildOakRecord(html: string): WildOakCommunityRecord | null {
  const name = /<meta property="og:title" content="([^"]+)"/i.exec(html)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? null;
  const cleanName = name ? normalize(htmlToText(name)).replace(/\s*[|–-]\s*Wild Oak Homes$/i, "") : null;
  if (!cleanName) return null;
  const text = normalize(htmlToText(html));
  const office = /(?:Model\s*&(?:amp;)?\s*sales\s+office|Sales\s+office|Model\s+home|At\s+the\s+property):\s*(\d[^,]{2,60}),\s*([A-Za-z .'-]+),\s*TX(?:\s+(\d{5}))?/i.exec(text);
  const cityFromTitle = /New Homes in ([A-Za-z .'-]+?),\s*TX/i.exec(html)?.[1] ?? null;
  const pin = /google\.com\/maps[^"'\s]*?@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(html);
  const fromPrice = money(/From\s+(\$[\d,]{5,})/i.exec(text)?.[1] ?? null);
  return {
    name: cleanName,
    street: office?.[1]?.trim() ?? null,
    city: office?.[2]?.trim() ?? cityFromTitle?.trim() ?? null,
    zip: office?.[3] ?? null,
    phone: null,
    priceFrom: fromPrice,
    geo: pin ? { lat: Number(pin[1]), lng: Number(pin[2]) } : null,
  };
}

export type WildOakPage = { record: WildOakCommunityRecord | null; homes: PrivatePlanOrHome[]; plans: PrivatePlanOrHome[]; cardCount: number; foreignHome: boolean };

function specValue(specs: Array<[string, string]>, label: RegExp): number | null {
  const hit = specs.find(([, name]) => label.test(name));
  if (!hit) return null;
  // "3-4" beds on a plan: the smaller figure.
  const first = /([\d,.]+)/.exec(hit[0])?.[1];
  const value = first ? Number(first.replace(/,/g, "")) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Every `article.wo-hc` card on the page, homes and plans apart; null when the page has no cards at all. */
export function parseWildOakCommunity(html: string, pageUrl: string): WildOakPage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const cards = descendants(root).filter((element) => element.tag === "article" && elementClass(element, "wo-hc"));
  if (!cards.length) return null;
  const record = wildOakRecord(html);
  const homes: PrivatePlanOrHome[] = [];
  const plans: PrivatePlanOrHome[] = [];
  let cardCount = 0;
  let foreignHome = false;
  for (const card of cards) {
    const inner = descendants(card);
    const cardHtml = html.slice(card.contentStart, card.contentEnd);
    const text = (className: string) => { const el = inner.find((element) => elementClass(element, className)); return el ? normalize(elementText(el, html)) : null; };
    const imgLink = inner.find((element) => element.tag === "a" && elementClass(element, "wo-hc-img"));
    const href = imgLink?.attributes.href ? decodeHtmlEntities(imgLink.attributes.href) : null;
    const page = href ? asUrl(new URL(href, community).toString()) : null;
    const link = page && sameOfficialHost(page, WILDOAK_HOST) ? page : null;
    const badge = text("wo-hc-badge");
    const eye = text("wo-hc-eye");
    const plan = /<h3>\s*<a[^>]*>([\s\S]*?)<\/a>/i.exec(cardHtml)?.[1];
    const planName = plan ? normalize(htmlToText(plan)).replace(/^The\s+/i, "") : null;
    const addr = text("wo-hc-addr");
    const lot = text("wo-hc-lot");
    const priceBlock = inner.find((element) => elementClass(element, "wo-hc-price"));
    const priceHtml = priceBlock ? html.slice(priceBlock.contentStart, priceBlock.contentEnd) : "";
    const priceText = /<b>([\s\S]*?)<\/b>/i.exec(priceHtml)?.[1] ? normalize(htmlToText(/<b>([\s\S]*?)<\/b>/i.exec(priceHtml)![1]!)) : null;
    const specs = Array.from(cardHtml.matchAll(/<b>([^<]*)<\/b>\s*<span>([^<]*)<\/span>/gi)).map((match) => [normalize(match[1]!), normalize(match[2]!)] as [string, string]);
    const sqft = specValue(specs, /sq\s*ft/i);
    const beds = specValue(specs, /bed/i);
    const baths = specValue(specs, /bath/i);
    const acres = specs.find(([, name]) => /acre/i.test(name))?.[0] ?? null;
    const galleryRaw = imgLink?.attributes["data-gal"] ? decodeHtmlEntities(imgLink.attributes["data-gal"]) : null;
    let galleryUrls: string[] = [];
    if (galleryRaw) { try { const parsed = JSON.parse(galleryRaw); if (Array.isArray(parsed)) galleryUrls = parsed.filter((value): value is string => typeof value === "string"); } catch { galleryUrls = []; } }
    if (!galleryUrls.length) { const bg = /background-image:\s*url\(['"]?([^'")]+)['"]?\)/i.exec(imgLink?.attributes.style ?? "")?.[1]; if (bg) galleryUrls = [decodeHtmlEntities(bg)]; }
    const gallery: PrivateGalleryImage[] = galleryUrls.map(wildOakPhotoUrl).filter((url): url is URL => Boolean(url)).map((url) => ({ sourceUrl: url.toString(), caption: null, width: null, height: null, srcSet: null }));
    const status = wildOakStatus(badge);
    const price = priceText && /^(?:from\s+)?\$[\d,]{5,}$/i.test(priceText) ? money(priceText) : null;
    if (status.kind === "plan") {
      if (!planName || !link) continue;
      plans.push({
        sourceUrl: link.toString(), privateName: planName, privatePlanName: planName, status: null,
        price: price && price > 0 ? price : null, bedrooms: beds, bathrooms: baths, squareFeet: sqft, garage: null, stories: null, readyNow: false,
        gallery: gallery.map((image) => ({ ...image, caption: "Representative image" })),
      });
      continue;
    }
    // The model home is the sales center, not a home for sale.
    if (status.kind === "model") continue;
    cardCount++;
    // A card under another community's eyebrow is not this community's inventory (the all-communities page mixes them).
    const eyeCommunity = eye ? eye.split("·")[0]!.trim() : null;
    if (record && eyeCommunity && eyeCommunity.toLowerCase() !== record.name.toLowerCase()) foreignHome = true;
    // The address line is a street ("105 Tempranillo Terrace"), or only the city ("Devine, TX") on a lot that has no
    // street yet: then the lot is the home's name and the plan page its link.
    const addrLine = addr ? addr.split("·")[0]!.trim() : null;
    const street = addrLine && /^\d/.test(addrLine) ? addrLine : null;
    const city = eye?.includes("·") ? eye.split("·")[1]!.trim() : record?.city ?? null;
    const where = street ?? lot;
    const readable = Boolean(where && link && status.status);
    const cityLine = city ? `${city}, TX${record?.zip && city === record.city ? ` ${record.zip}` : ""}` : "TX";
    homes.push({
      sourceUrl: readable ? link!.toString() : `${community.origin}${community.pathname.replace(/\/+$/, "")}/unreadable-${homes.length}`,
      privateName: where ? `${planName ? `${planName} – ` : ""}${where}` : planName,
      privateAddress: where ? `${where}, ${cityLine}` : null,
      privatePlanName: planName,
      status: readable ? status.status : null,
      price: price && price > 0 ? price : null,
      bedrooms: beds, bathrooms: baths, squareFeet: sqft, garage: null, stories: null,
      readyNow: status.readyNow, moveInDate: null,
      homesite: [lot, acres ? `${acres} acres` : null].filter(Boolean).join(" · ") || null,
      gallery,
    });
  }
  return { record, homes, plans, cardCount, foreignHome };
}

/**
 * The communities in the site's "Communities" menu (the dropdown under the /our-communities/ link, one `a.dropdown-item`
 * per community); each page is read for its sales address. Null when the menu is missing.
 */
export function wildOakListingEntries(html: string, host: string): Array<{ url: string; record: WildOakCommunityRecord }> | null {
  const toggle = /href="https?:\/\/[^"]*\/our-communities\/?"[^>]*>\s*Communities\s*<\/a>/i.exec(html);
  if (!toggle) return null;
  const rest = html.slice(toggle.index + toggle[0].length);
  const menu = /<ul[^>]*class="[^"]*dropdown-menu[^"]*"[^>]*>([\s\S]*?)<\/ul>/i.exec(rest);
  if (!menu) return null;
  const out = new Map<string, { url: string; record: WildOakCommunityRecord }>();
  for (const match of Array.from(menu[1]!.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi))) {
    const url = asUrl(new URL(decodeHtmlEntities(match[1]!), `https://${host}/`).toString());
    if (!url || !sameOfficialHost(url, host) || !/^\/[a-z0-9-]+\/?$/i.test(url.pathname)) continue;
    const name = normalize(htmlToText(match[2]!));
    if (!name || name.length > 60) continue;
    const key = `${url.origin}${url.pathname.replace(/\/?$/, "/")}`;
    if (!out.has(key)) out.set(key, { url: key, record: { name, street: null, city: null, zip: null, phone: null, priceFrom: null, geo: null } });
  }
  return out.size ? Array.from(out.values()) : null;
}

/**
 * The builder's community pages carry no map pin, but the all-homes page (`/available-homes/`) does: a Houzez map
 * (`#houzez-properties-map[data-map]`, JSON with one entry per home: `url`, `latitude`, `longitude`) next to the same
 * `article.wo-hc` cards, whose eyebrow names each home's community. Joining the two places every community that has a
 * home on the page. Discovery reads this page once and takes a community's pin from any of its homes.
 */
export const wildOakHomesUrl = () => `https://${WILDOAK_HOST}/available-homes/`;
export function wildOakCommunityPins(html: string): Map<string, { lat: number; lng: number }> {
  const out = new Map<string, { lat: number; lng: number }>();
  const mapAttr = /id="houzez-properties-map"[^>]*data-map='([^']*)'/i.exec(html)?.[1] ?? /data-map='([^']*)'[^>]*id="houzez-properties-map"/i.exec(html)?.[1];
  if (!mapAttr) return out;
  let entries: Array<{ url?: unknown; latitude?: unknown; longitude?: unknown }> = [];
  try { const parsed = JSON.parse(decodeHtmlEntities(mapAttr)); entries = Array.isArray(parsed?.properties) ? parsed.properties : []; } catch { return out; }
  const pinByUrl = new Map<string, { lat: number; lng: number }>();
  for (const entry of entries) {
    const url = typeof entry.url === "string" ? asUrl(entry.url) : null;
    const lat = Number(entry.latitude);
    const lng = Number(entry.longitude);
    if (!url || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !lat || !lng) continue;
    pinByUrl.set(`${url.origin}${url.pathname}`, { lat, lng });
  }
  const root = parseHtmlElements(html);
  if (!root) return out;
  for (const card of descendants(root).filter((element) => element.tag === "article" && elementClass(element, "wo-hc"))) {
    const inner = descendants(card);
    const link = inner.find((element) => element.tag === "a" && elementClass(element, "wo-hc-img"));
    const eye = inner.find((element) => elementClass(element, "wo-hc-eye"));
    const href = link?.attributes.href ? asUrl(decodeHtmlEntities(link.attributes.href)) : null;
    const community = eye ? normalize(elementText(eye, html)).split("·")[0]!.trim() : null;
    if (!href || !community) continue;
    const pin = pinByUrl.get(`${href.origin}${href.pathname}`);
    if (pin && !out.has(community.toLowerCase())) out.set(community.toLowerCase(), pin);
  }
  return out;
}

export class WildOakAdapter implements DealAdapter {
  readonly builder = "Wild Oak Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, WILDOAK_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", WILDOAK_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseWildOakCommunity(page.text, community.toString());
    if (!parsed || !parsed.record) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.homes.length < parsed.cardCount) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    if (parsed.homes.length > WILDOAK_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    const planPrices = parsed.plans.map((plan) => plan.price).filter((price): price is number => price !== null);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? parsed.record.priceFrom ?? (planPrices.length ? Math.min(...planPrices) : null) };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    // The site carries no rate offers; nothing is read as an incentive.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
