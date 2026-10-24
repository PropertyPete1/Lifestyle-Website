import {
  NMLS_ID_PATTERN_ALL, TEXASHOMES_HOST, asUrl, comparablePath, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, looksLikeStreetAddress, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type DealHoldReason, type HtmlElement, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * TEXAS HOMES reader (www.texas-homes.com, a Drupal site, server-rendered).
 *
 * - The community page `/<slug>` has the name (h1), the model home's sales
 *   address (`.sales-address-link a`, also the Google Maps `query`), the
 *   pin (`.field--name-field-geolocation` "29.4293913, -98.8569532"), the
 *   sales phone (`a.contact-phone`), one `.plan-teaser` per plan (name,
 *   "Starting from $657,990", stories/sqft/beds/baths/garage/half-baths
 *   with "3 to 4" ranges, the main elevation) and, when homes are for sale,
 *   a "Quick Move-In Homes in <name>" link to the site's quick move-in
 *   list filtered to this community
 *   (`/move-in-ready?field_neighborhood_target_id=<id>`); the plan teasers'
 *   `/move-in-ready-plan?neighborhood_id=<id>&plan_id=…` links name the
 *   same id.
 * - The site menu on every page lists the communities with a "View Quick
 *   Move-In Homes" count (`.menu-mir-count`); the count is a lower bound on
 *   the list's rows (sold rows stay listed for a while).
 * - The filtered list has one `.mir-view .views-row` per home: the street
 *   (h3 link to `/move-in-ready/<slug>`), specs, an MLS number (not read),
 *   "Valued at: $739,737" with "Now: $719,737" when cut, "Available" + "Move
 *   In Ready Now" / "Ready Now!" / "November 2026" / nothing, photos under
 *   `/sites/default/files/styles/…/public/…` (the original sits under
 *   `/sites/default/files/…`), and the `mir-teaser-sold` class on a sold
 *   card. No pager in October 2026 (29 homes site-wide).
 * - The promotion is on the home page: a wysiwyg heading naming the rate
 *   ("4.99% 30-year fixed FHA/VA") followed by a "Learn More" link to the
 *   campaign page, whose heading and "*" footnote state the offer
 *   (rate, APR, loan types, term, lender, contract window, closing
 *   deadline). The offer is site-wide.
 * Read-only, plain GET, official host only. Everything here is private
 * operational data.
 */
/** A community with more homes for sale than this is held, never truncated. */
export const TEXASHOMES_MAX_HOMES = 150;
export const texasHomesListingUrl = () => `https://${TEXASHOMES_HOST}/`;
export const texasHomesHomesUrl = (neighborhoodId: number) => `https://${TEXASHOMES_HOST}/move-in-ready?field_neighborhood_target_id=${neighborhoodId}`;
/** The home page and the campaign page are read once per run: both are shared by every community. */
const CACHE_MS = 10 * 60 * 1000;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthIndex = (name: string): number | null => {
  const key = name.toLowerCase().replace(/\.$/, "");
  const index = MONTH_NAMES.findIndex((month) => month.toLowerCase() === key || month.toLowerCase().slice(0, 3) === key || (key === "sept" && month === "September"));
  return index >= 0 ? index + 1 : null;
};

const num = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(value);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const positive = (value: string | null | undefined): number | null => { const parsed = num(value); return parsed && parsed > 0 ? parsed : null; };

let homeCache: { fetchedAt: number; page: TexasHomesHomePage } | null = null;
let promoCache: { fetchedAt: number; url: string; text: string | null } | null = null;
/** A home page that answered but did not parse is not fetched again for two minutes. */
const HOLD_CACHE_MS = 2 * 60_000;
let homeHoldUntil = 0;
export function resetTexasHomesCaches(): void { homeCache = null; promoCache = null; homeHoldUntil = 0; }

const pagePath = (url: URL): string => comparablePath(url.pathname.replace(/\/+$/, "")) || "/";
const pageUrlOf = (url: URL): string => `${url.origin}${url.pathname.replace(/\/+$/, "")}`;

/**
 * "Move In Ready Now", "Move In Ready", "Ready Now!" are ready; "November
 * 2026" names a month (a past one is a stale estimate: no date); no wording
 * is an undated quick move-in; sold is sold; other wording gives no status
 * (the run is held).
 */
export function texasHomesStatus(label: string | null, sold: boolean, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  if (sold) return { status: "Sold", readyNow: false, moveInDate: null };
  const text = (label ?? "").replace(/\s+/g, " ").replace(/^available\s*/i, "").trim();
  if (!text) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  if (/\bsold\b|under\s+contract/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/^(?:move[- ]?in\s+ready(?:\s+now)?|ready\s+now|available\s+now|now)\s*!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  const dated = /^(?:est\.?(?:imated)?\s+)?([A-Za-z]+)\.?,?\s+(\d{4})$/i.exec(text);
  const month = dated ? monthIndex(dated[1]!) : null;
  const year = dated ? Number(dated[2]) : null;
  if (month === null || year === null || year < 2000 || year > now.getUTCFullYear() + 5) return { status: null, readyNow: false, moveInDate: null };
  if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month <= now.getUTCMonth())) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const name = `${MONTH_NAMES[month - 1]} ${year}`;
  return { status: `Quick Move-In (${name})`, readyNow: false, moveInDate: name };
}

export type TexasHomesCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

function classText(scope: readonly HtmlElement[], html: string, token: string): string | null {
  const element = scope.find((item) => elementClass(item, token));
  return element ? elementText(element, html) || null : null;
}

/** A features block's value by its container token: the first number of "3245 to 3550". */
function feature(scope: readonly HtmlElement[], html: string, token: string): number | null {
  const container = scope.find((item) => elementClass(item, "features-single-container") && elementClass(item, token));
  const content = container ? classText(descendants(container), html, "features-content") : null;
  return positive(content);
}

const photoUrl = (value: string | null | undefined, base: URL): string | null => {
  const url = value ? asUrl(new URL(decodeHtmlEntities(value), base).toString()) : null;
  if (!url || !sameOfficialHost(url, base.hostname) || /floor\s*plan|floorplan|site\s*plan|logo|\.pdf$|\.svg$/i.test(url.pathname)) return null;
  // A styled copy (…/files/styles/<style>/public/<path>) stands for the original at …/files/<path>.
  const path = url.pathname.replace(/^\/sites\/default\/files\/styles\/[^/]+\/public\//i, "/sites/default/files/");
  if (!/^\/sites\/default\/files\//i.test(path)) return null;
  return `${url.origin}${path}`;
};

function gallery(scope: readonly HtmlElement[], token: string, base: URL): PrivateGalleryImage[] {
  const out: PrivateGalleryImage[] = [];
  for (const field of scope.filter((item) => elementClass(item, token))) {
    for (const image of descendants(field).filter((item) => item.tag === "img")) {
      const url = photoUrl(image.attributes.src, base);
      if (url && !out.some((item) => item.sourceUrl === url) && out.length < 8) out.push({ sourceUrl: url, caption: "Representative image", width: null, height: null, srcSet: null });
    }
  }
  return out;
}

/** The menu's quick move-in count for the page at `path`; null when the menu has no row for it. */
export function texasHomesMenuCount(html: string, path: string): number | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  for (const row of descendants(root).filter((item) => elementClass(item, "views-row"))) {
    const inner = descendants(row);
    const link = inner.find((item) => item.tag === "a" && elementClass(item, "main-menu-main-link") && item.attributes.href);
    if (!link) continue;
    const target = asUrl(new URL(decodeHtmlEntities(link.attributes.href!), `https://${TEXASHOMES_HOST}/`).toString());
    if (!target || pagePath(target) !== comparablePath(path.replace(/\/+$/, ""))) continue;
    const count = classText(inner, html, "menu-mir-count");
    return count === null ? null : num(count);
  }
  return null;
}

export type TexasHomesPage = {
  record: TexasHomesCommunityRecord;
  /** The quick move-in list's neighborhood id from the page's own link; null when the page links none (no homes for sale). */
  neighborhoodId: number | null;
  /** True when a plan teaser names another neighborhood id, or links under another page. */
  foreignPlan: boolean;
  /** True when the page has the sales address or pin block at all. */
  hasRecord: boolean;
  /** The community's logo path, which the quick move-in list's rows repeat; null when the page shows none. */
  logo: string | null;
  plans: PrivatePlanOrHome[];
};

/**
 * A logo image's file name on the official host, for comparison: Drupal
 * renders the same file through image styles (`/styles/<style>/public/…`)
 * and resized copies (`…-300x200.png`, `…-resized.png`), so the path's
 * style segment and a size suffix are set aside; null when it is elsewhere.
 * The list's rows may name the site's own hosting origin for the same file
 * (Ventana, Oct 24 2026: `https://live-texas-homes.pantheonsite.io/sites/default/files/…`).
 */
export const TEXASHOMES_ORIGIN_HOST = "live-texas-homes.pantheonsite.io";
function logoPath(src: string, base: URL): string | null {
  const url = asUrl(new URL(decodeHtmlEntities(src), base).toString());
  if (!url || !(sameOfficialHost(url, base.hostname) || (url.protocol === "https:" && url.hostname.toLowerCase() === TEXASHOMES_ORIGIN_HOST))) return null;
  const path = comparablePath(url.pathname).replace(/\/styles\/[^/]+\/public\//, "/");
  return path.replace(/(-\d+x\d+|-resized|-scaled)(\.[a-z0-9]+)$/i, "$2");
}

/** The community on the page; null when the page has no heading. */
export function parseTexasHomesCommunity(html: string, pageUrl: string): TexasHomesPage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const host = community.hostname;
  const all = descendants(root);
  const heading = all.find((item) => item.tag === "h1");
  const name = heading ? elementText(heading, html) : "";
  if (!name) return null;
  const base = `${pagePath(community)}/`;
  // The sales address: the Google Maps link's query ("241 Stone Loop, Castroville, TX, 78009"), else the link's text.
  const addressBlock = all.find((item) => elementClass(item, "sales-address-link"));
  const addressLink = addressBlock ? descendants(addressBlock).find((item) => item.tag === "a" && item.attributes.href) : undefined;
  let street: string | null = null;
  let city: string | null = null;
  let zip: string | null = null;
  if (addressLink) {
    let query: string | null = null;
    try { query = new URL(decodeHtmlEntities(addressLink.attributes.href!)).searchParams.get("query"); } catch { query = null; }
    // Without the query, the link's lines ("241 Stone Loop<br>Castroville, TX, 78009") are the street and the city line.
    const lines = html.slice(addressLink.contentStart, addressLink.contentEnd).split(/<br\s*\/?>/i).map((line) => htmlToText(line)).filter(Boolean);
    // "241 Stone Loop, Castroville, TX, 78009" and "241 Stone Loop, Castroville, TX 78009" alike.
    const parts = (query ?? lines.join(", ")).split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
    const stateIndex = parts.findIndex((part) => /^(?:TX|Texas)(?:\s+\d{5}(?:-\d{4})?)?$/i.test(part));
    if (stateIndex >= 2) {
      street = parts.slice(0, stateIndex - 1).join(", ");
      city = parts[stateIndex - 1]!;
      zip = /\b(\d{5})\b/.exec(`${parts[stateIndex]} ${parts[stateIndex + 1] ?? ""}`)?.[1] ?? null;
    }
  }
  // The community's logo (`.field--name-field-logo img`): the list's rows carry the same file, which ties each row to the community.
  const logoField = all.find((item) => elementClass(item, "field--name-field-logo"));
  const logoImage = logoField ? descendants(logoField).find((item) => item.tag === "img" && item.attributes.src) : undefined;
  const logo = logoImage ? logoPath(logoImage.attributes.src!, community) : null;
  const geoField = all.find((item) => elementClass(item, "field--name-field-geolocation"));
  const geoMatch = geoField ? /(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(elementText(geoField, html)) : null;
  const lat = geoMatch ? Number(geoMatch[1]) : NaN;
  const lng = geoMatch ? Number(geoMatch[2]) : NaN;
  const phoneLink = all.find((item) => item.tag === "a" && /^tel:/i.test(item.attributes.href ?? ""));
  const phone = phoneLink ? decodeHtmlEntities(phoneLink.attributes.href!).replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "") || null : null;
  // The page's own quick move-in link ("Quick Move-In Homes in <name>"), never the menu's "View Quick Move-In Homes" rows.
  let neighborhoodId: number | null = null;
  for (const link of all.filter((item) => item.tag === "a" && /move-in-ready\?/.test(item.attributes.href ?? "") && /^quick\s+move-?in\s+homes\s+in\b/i.test(elementText(item, html)))) {
    const id = /[?&]field_neighborhood_target_id=(\d+)/.exec(decodeHtmlEntities(link.attributes.href!));
    if (id) { neighborhoodId = Number(id[1]); break; }
  }
  const plans: PrivatePlanOrHome[] = [];
  let foreignPlan = false;
  const teasers = all.filter((item) => elementClass(item, "plan-teaser")).flatMap((teaser) => {
    const inner = descendants(teaser);
    const title = inner.find((item) => item.tag === "h2");
    const link = title ? descendants(title).find((item) => item.tag === "a" && item.attributes.href) : undefined;
    const planName = title ? elementText(title, html) : "";
    const url = link ? asUrl(new URL(decodeHtmlEntities(link.attributes.href!), community).toString()) : null;
    if (!planName || !url || !sameOfficialHost(url, host)) return [];
    const ids = inner.filter((item) => item.tag === "a" && /move-in-ready-plan\?/.test(item.attributes.href ?? "")).flatMap((homesLink) => {
      const id = /[?&]neighborhood_id=(\d+)/.exec(decodeHtmlEntities(homesLink.attributes.href!));
      return id ? [Number(id[1])] : [];
    });
    return [{ inner, planName, url, ids }];
  });
  // A renamed community keeps its plans under the old path (The Enclave at Potranco Oaks, October 2026: the page at
  // /enclave-at-potranco-oaks, its plans at /enclave-potranco-oaks/plan-1663). Plans under one other parent path are this
  // community's only when that path is one segment whose words are the page's own less some ("enclave potranco oaks" in
  // "enclave at potranco oaks"; at least two words), and when the page links its own quick move-in list and a plan there
  // links its homes with that same neighborhood id; any other plan path is another page's.
  const parentOf = (url: URL) => pagePath(url).split("/").slice(0, -1).join("/");
  const words = (path: string) => new Set(path.split("/").filter(Boolean).join("-").split("-").filter(Boolean));
  const pageWords = words(pagePath(community));
  const renamedFrom = (parent: string) => {
    const old = words(parent);
    const [small, large] = old.size <= pageWords.size ? [old, pageWords] : [pageWords, old];
    return parent.split("/").filter(Boolean).length === 1 && pagePath(community).split("/").filter(Boolean).length === 1 && small.size >= 2 && Array.from(small).every((word) => large.has(word));
  };
  const outside = teasers.filter((teaser) => !`${pagePath(teaser.url)}/`.startsWith(base) && pagePath(teaser.url) !== pagePath(community));
  const aliasParents = new Set(outside.map((teaser) => parentOf(teaser.url)));
  const onlyParent = aliasParents.size === 1 ? Array.from(aliasParents)[0]! : null;
  const alias = onlyParent && renamedFrom(onlyParent) && neighborhoodId !== null && outside.some((teaser) => teaser.ids.includes(neighborhoodId!)) ? onlyParent : null;
  for (const { inner, planName, url, ids } of teasers) {
    const underPage = `${pagePath(url)}/`.startsWith(base) && pagePath(url) !== pagePath(community);
    const underAlias = alias !== null && alias !== "" && parentOf(url) === alias && pagePath(url) !== pagePath(community);
    if (!underPage && !underAlias) { foreignPlan = true; continue; }
    if (neighborhoodId !== null && ids.some((id) => id !== neighborhoodId)) foreignPlan = true;
    const baths = feature(inner, html, "baths");
    const half = feature(inner, html, "half-baths");
    plans.push({
      sourceUrl: pageUrlOf(url),
      privateName: planName,
      privatePlanName: planName,
      status: null,
      price: positive(classText(inner, html, "teaser-price")),
      bedrooms: feature(inner, html, "beds"),
      bathrooms: baths === null ? null : baths + (half ? half * 0.5 : 0),
      squareFeet: feature(inner, html, "sqft"),
      garage: feature(inner, html, "garage"),
      readyNow: false,
      gallery: gallery(inner, "field--name-field-main-elevation", community),
    });
  }
  const prices = plans.map((plan) => plan.price).filter((price): price is number => price !== null && price >= 50_000);
  return {
    record: {
      name,
      street: looksLikeStreetAddress(street) ? street : null,
      city,
      zip,
      phone,
      priceFrom: prices.length ? Math.min(...prices) : null,
      geo: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
    },
    neighborhoodId,
    foreignPlan,
    hasRecord: Boolean(addressBlock || geoField),
    logo,
    plans,
  };
}

/** The community's record from its page, for discovery; null when the page is not a community page. */
export function texasHomesRecord(html: string, pageUrl: string): TexasHomesCommunityRecord | null {
  const page = parseTexasHomesCommunity(html, pageUrl);
  return page && page.hasRecord ? page.record : null;
}

export type TexasHomesListing = {
  homes: PrivatePlanOrHome[];
  hasPager: boolean;
  /** True when a row links elsewhere, or carries another community's logo (the page's own, when it has one). */
  foreignHome: boolean;
  /** The exposed filter's selected neighborhood id, when the form shows one; the list must be filtered to the community's. */
  selectedNeighborhoodId: number | null;
  /** Rows that are not sold. */
  available: number;
};

/** The filtered quick move-in list; null when the body is not the list. The rows must carry the community's logo when the page shows one. */
export function parseTexasHomesListing(html: string, listUrl: string, now: Date, cityLine: string, logo: string | null = null): TexasHomesListing | null {
  const page = asUrl(listUrl);
  const root = parseHtmlElements(html);
  if (!page || !root) return null;
  const all = descendants(root);
  const view = all.find((item) => elementClass(item, "mir-view"));
  if (!view) return null;
  const inner = descendants(view);
  // The exposed filter form names the neighborhood the list is filtered to.
  const select = all.find((item) => item.tag === "select" && item.attributes.name === "field_neighborhood_target_id");
  const selectedOption = select ? descendants(select).find((item) => item.tag === "option" && "selected" in item.attributes) : undefined;
  const selectedNeighborhoodId = selectedOption && /^\d+$/.test(selectedOption.attributes.value ?? "") ? Number(selectedOption.attributes.value) : null;
  const homes: PrivatePlanOrHome[] = [];
  let foreignHome = false;
  let available = 0;
  for (const row of inner.filter((item) => elementClass(item, "views-row"))) {
    const parts = descendants(row);
    const title = parts.find((item) => item.tag === "h3");
    const link = title ? descendants(title).find((item) => item.tag === "a" && item.attributes.href) : undefined;
    const street = title ? elementText(title, html) : "";
    const url = link ? asUrl(new URL(decodeHtmlEntities(link.attributes.href!), page).toString()) : null;
    if (!url || !sameOfficialHost(url, page.hostname) || !/^\/move-in-ready\/[^/]+$/i.test(pagePath(url))) { foreignHome = true; continue; }
    // The row's community logo must be this community's: a row from another community (an unfiltered list) is never this one's.
    if (logo) {
      const rowLogo = parts.find((item) => elementClass(item, "mir-teaser-bottom-right"));
      const rowImage = rowLogo ? descendants(rowLogo).find((item) => item.tag === "img" && item.attributes.src) : undefined;
      if (!rowImage || logoPath(rowImage.attributes.src!, page) !== logo) { foreignHome = true; continue; }
    }
    const sold = parts.some((item) => elementClass(item, "mir-teaser-sold"));
    if (!sold) available++;
    const readable = looksLikeStreetAddress(street);
    // A row with no availability element at all (not a blank one) has wording the reader cannot find: no status.
    const dateElement = parts.find((item) => elementClass(item, "mir-date"));
    const status = sold || dateElement ? texasHomesStatus(dateElement ? elementText(dateElement, html) : null, sold, now) : { status: null, readyNow: false, moveInDate: null };
    const valued = positive(classText(parts, html, "mir-price"));
    const reduced = positive(classText(parts, html, "reduced-price-teaser"));
    const baths = feature(parts, html, "baths");
    homes.push({
      sourceUrl: pageUrlOf(url),
      privateName: street || null,
      privateAddress: readable ? `${street}, ${cityLine}` : null,
      privatePlanName: null,
      status: readable ? status.status : null,
      price: reduced ?? valued,
      previousPrice: reduced !== null && valued !== null && valued > reduced ? valued : null,
      bedrooms: feature(parts, html, "beds"),
      bathrooms: baths,
      squareFeet: feature(parts, html, "sqft"),
      garage: feature(parts, html, "garage"),
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      gallery: gallery(parts, "field--name-field-images", page),
    });
  }
  return { homes, hasPager: all.some((item) => elementClass(item, "pager") || elementClass(item, "pager__items")), foreignHome, selectedNeighborhoodId, available };
}

/** A rate ("4.99% fixed", "5.75% APR", "4.99% interest rate", "4.99% financing") or an amount of four digits or more. */
const PROMO_FIGURE = /\d+(?:\.\d+)?\s*%\s*(?:\(|\[|fixed|rate|apr|financing|interest|limited|[0-9]{2}-?\s*year)|\$\s*[\d,]{4,}/i;

export type TexasHomesHomePage = { communityUrls: string[]; promoUrl: string | null };

/** The home page: the menu's community links and the promotion's campaign page (the "Learn More" after a wysiwyg heading that names a rate or an amount). */
export function parseTexasHomesHomePage(html: string, host: string): TexasHomesHomePage | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const all = descendants(root);
  const communityUrls: string[] = [];
  for (const link of all.filter((item) => item.tag === "a" && elementClass(item, "main-menu-main-link") && item.attributes.href)) {
    const url = asUrl(new URL(decodeHtmlEntities(link.attributes.href!), `https://${host}/`).toString());
    if (url && sameOfficialHost(url, host) && !communityUrls.includes(pageUrlOf(url))) communityUrls.push(pageUrlOf(url));
  }
  // The promotion: a short wysiwyg heading that names a rate or an amount ("4.99% 30-year fixed FHA/VA"), then the next field's
  // "Learn More" link. A marketing line naming a bare figure is not a promotion, nor is a link that is not a call to read more.
  let promoUrl: string | null = null;
  let named = false;
  for (const field of all.filter((item) => elementClass(item, "field--name-field-wysiwyg"))) {
    const text = elementText(field, html);
    if (!named) { named = PROMO_FIGURE.test(text) && text.length < 300; continue; }
    const link = descendants(field).find((item) => item.tag === "a" && item.attributes.href && /\b(?:learn\s+more|details|see\s+(?:the\s+)?offer|view\s+(?:the\s+)?offer)\b/i.test(elementText(item, html)));
    if (!link) { named = PROMO_FIGURE.test(text) && text.length < 300; continue; }
    const url = asUrl(new URL(decodeHtmlEntities(link.attributes.href!), `https://${host}/`).toString());
    if (url && sameOfficialHost(url, host)) promoUrl = pageUrlOf(url);
    break;
  }
  return communityUrls.length ? { communityUrls, promoUrl } : null;
}

/** Links, e-mail addresses, phone numbers, NMLS ids and footnote marks go from the offer text. */
function cleanOfferText(value: string): string {
  return value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/\(?\b\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, " ")
    .replace(NMLS_ID_PATTERN_ALL, " ")
    .replace(/\*+/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1").replace(/,(?:\s*,)+/g, ",").replace(/\s+/g, " ").trim();
}

/** The campaign page's offer: its rate-naming heading and the "*" footnotes; null when the page states none. */
export function parseTexasHomesPromo(html: string): string | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const all = descendants(root);
  const pieces: string[] = [];
  const heading = all.filter((item) => /^h[1-3]$/.test(item.tag)).map((item) => elementText(item, html)).find((text) => PROMO_FIGURE.test(text));
  if (heading) pieces.push(heading);
  for (const field of all.filter((item) => elementClass(item, "field--name-field-wysiwyg"))) {
    const text = elementText(field, html);
    if (/^\*/.test(text)) pieces.push(text);
  }
  // Each piece ends a sentence, so the heading and the footnote never run together.
  const text = cleanOfferText(pieces.map((piece) => /[.!?]$/.test(piece.trim()) ? piece : `${piece.trim()}.`).join(" ").slice(0, 4_000));
  return text && PROMO_FIGURE.test(text) ? text : null;
}

/** The home page, read once per run. */
async function homePage(fetcher: HtmlFetcher, now: number): Promise<{ page: TexasHomesHomePage } | { hold: DealHoldReason }> {
  if (homeCache && now - homeCache.fetchedAt < CACHE_MS) return { page: homeCache.page };
  if (now < homeHoldUntil) return { hold: "expected_incentive_container_not_found" };
  const page = await getDocument(texasHomesListingUrl(), fetcher, "text/html,application/xhtml+xml", TEXASHOMES_HOST);
  if (!page.ok) return { hold: page.redirectedOffOfficialHost ? "unsupported_official_host" : "incentive_fetch_failed" };
  const parsed = parseTexasHomesHomePage(page.text, TEXASHOMES_HOST);
  // A page that answered but did not parse (a bot check, maintenance, a redesign) says nothing about the promo: a hold,
  // remembered briefly so the rest of the batch does not fetch it again.
  if (!parsed) { homeHoldUntil = now + HOLD_CACHE_MS; return { hold: "expected_incentive_container_not_found" }; }
  homeCache = { fetchedAt: now, page: parsed };
  return { page: parsed };
}

/** The campaign page, read once per run. */
async function promotion(url: string, fetcher: HtmlFetcher, now: number): Promise<{ text: string | null } | { hold: DealHoldReason }> {
  if (promoCache && promoCache.url === url && now - promoCache.fetchedAt < CACHE_MS) return { text: promoCache.text };
  const page = await getDocument(url, fetcher, "text/html,application/xhtml+xml", TEXASHOMES_HOST);
  if (!page.ok) return { hold: page.redirectedOffOfficialHost ? "unsupported_official_host" : "incentive_fetch_failed" };
  const text = parseTexasHomesPromo(page.text);
  if (!text) return { hold: "expected_incentive_container_not_found" };
  promoCache = { fetchedAt: now, url, text };
  return { text };
}

export class TexasHomesAdapter implements DealAdapter {
  readonly builder = "Texas Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, TEXASHOMES_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", TEXASHOMES_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseTexasHomesCommunity(page.text, community.toString());
    // Without the heading and the sales address or pin this is not a community page.
    if (!parsed || !parsed.hasRecord) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The plans must be this community's, under its path and its neighborhood id.
    if (parsed.foreignPlan) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    const menuCount = texasHomesMenuCount(page.text, community.pathname);
    const cityLine = parsed.record.city ? `${parsed.record.city}, ${parsed.record.zip ? `TX ${parsed.record.zip}` : "TX"}` : "TX";
    let homes: PrivatePlanOrHome[] = [];
    let listUrl: string | null = null;
    if (parsed.neighborhoodId !== null) {
      listUrl = texasHomesHomesUrl(parsed.neighborhoodId);
      const list = await getDocument(listUrl, fetcher, "text/html,application/xhtml+xml", TEXASHOMES_HOST);
      if (!list.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(list, "community_fetch_failed")]);
      const listing = parseTexasHomesListing(list.text, listUrl, now(), cityLine, parsed.logo);
      if (!listing) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
      // The list must be this community's: its rows carry the community's logo, its filter names the community's id, and its
      // homes for sale never outnumber the menu's count (an unfiltered list would show every community's homes here).
      if (listing.foreignHome || (listing.selectedNeighborhoodId !== null && listing.selectedNeighborhoodId !== parsed.neighborhoodId) || (menuCount !== null && listing.available > menuCount)) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
      // The list must be whole: no further page, and never fewer rows than the menu counts for the community.
      if (listing.hasPager || listing.homes.length > TEXASHOMES_MAX_HOMES || (menuCount !== null && listing.homes.length < menuCount)) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
      homes = listing.homes;
    } else if (menuCount !== null && menuCount > 0) {
      // The menu counts homes for sale here but the page links no list: a changed page.
      return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    }
    const facts = parseCommunityFacts(page.text);
    const prices = homes.map((home) => home.price).filter((price): price is number => price !== null && price >= 50_000);
    privateSnapshot.communityFacts = { ...facts, fromPrice: parsed.record.priceFrom ?? facts.fromPrice ?? (prices.length ? Math.min(...prices) : null) };
    if (listUrl) privateSnapshot.pages.push(sourcePage("inventory", listUrl, null));
    for (const home of homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    const incentiveHolds: DealHoldReason[] = [];
    const home = await homePage(fetcher, now().getTime());
    if ("hold" in home) incentiveHolds.push(home.hold);
    else if (!home.page.promoUrl) privateSnapshot.offerRead = true;
    else {
      const promo = await promotion(home.page.promoUrl, fetcher, now().getTime());
      if ("hold" in promo) incentiveHolds.push(promo.hold);
      else privateSnapshot.offerRead = true;
      if (!("hold" in promo) && promo.text) {
        privateSnapshot.pages.push(sourcePage("incentive", home.page.promoUrl, null));
        privateSnapshot.incentive = { sourceUrl: pageUrlOf(community), text: promo.text, facts: parsePromotionalRate(promo.text) };
      }
    }
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config, incentiveHolds));
  }
}

/** The menu's community links for discovery; each page is read for its record. */
export function texasHomesListingEntries(html: string, host: string): Array<{ url: string; record: null }> | null {
  const page = parseTexasHomesHomePage(html, host);
  return page ? page.communityUrls.map((url) => ({ url, record: null })) : null;
}
