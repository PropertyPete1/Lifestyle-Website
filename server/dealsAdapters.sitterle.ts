import {
  SITTERLE_HOST, asUrl, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
  storiesFrom,
} from "./dealsAdapters";

/**
 * SITTERLE HOMES reader. A WordPress (Elementor) site, server-rendered. The
 * community page lists one `.comm--listing-container` card per home
 * (`inventory` or `construction` class) and per plan (`plan` class): an
 * `a.result--title` with the street (or "<Plan> Plan") and the page link, "in
 * <Community>", "Price: $526,730" (struck through when reduced) and "Reduced
 * Price: $445,000", "Plan: <strong>Ozona</strong>", "Estimated Completion:
 * <span class="comm--custom-note">Available Now</span>" (or a season, "Fall
 * 2026"), and mini-stats (Beds, Baths, Car Garage, Sq. Ft.; plans say "From
 * 1,852 Sq. Ft." and "Stories"). The community's name sits in
 * `#community-name`, its sales address in `.comm-page-address` ("10103
 * Zimmer, San Antonio, TX 78254, U.S.A."), its coordinates in a Google Maps
 * directions link ("…/@29.5371268,-98.7423396,18z"). The communities page
 * lists every community of the three Texas markets as `.single-result-container`
 * cards with the city line, so discovery reads each page in the area for its
 * address and pin. Photos sit on the official host. Read-only, plain GET,
 * official host only. Everything here is private operational data.
 *
 * Page shapes (October 2026):
 * - communities: /communities/                       (about 330 KB)
 * - community:   /communities/<slug>/                (about 300 KB)
 * - home:        /listings/<street slug>-<plan>-<community slug>/
 * - plan:        /plans/<plan>-<community slug>/
 */
/** A community with more homes for sale than this is held, never truncated. */
export const SITTERLE_MAX_HOMES = 150;
export const sitterleListingUrl = () => `https://${SITTERLE_HOST}/communities/`;

const MONTHS: Record<string, string> = { jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June", jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December" };
/** A season's last month, for judging whether it has passed. */
const SEASON_END: Record<string, number> = { winter: 1, spring: 4, summer: 7, fall: 10, autumn: 10 };
const normalize = (value: string) => decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
const money = (value: string | null): number | null => { const match = value ? /\$\s*([\d,]{5,})/.exec(value) : null; return match ? Number(match[1]!.replace(/,/g, "")) : null; };

/**
 * "Available Now" is ready; "Fall 2026" or "November 2026" names when the
 * home is expected (a past one is a stale estimate: no date); "Coming Soon" or
 * "TBD" is no date yet; only sale words sell; other wording, or none, gives no
 * status (the run is held).
 */
export function sitterleStatus(note: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (note ?? "").replace(/\s+/g, " ").replace(/^(?:est(?:imated)?\.?\s*completion:?\s*)/i, "").trim();
  if (!text) return { status: null, readyNow: false, moveInDate: null };
  if (/\bsold\b|under\s+contract/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  if (/^(?:available\s+now|move[- ]?in\s+ready|ready\s+now|complete[d]?)!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  // Oct 29, 2026 (Parmer Ranch Cottages, 200 Timberwilde: a priced home under construction, "Est. Completion: Coming
  // Soon" on its card and its own page): the completion date is not set yet. A home for sale with no date, like a
  // stale estimate; this note is only ever the completion field, never a sale word.
  if (/^(?:coming\s+soon|tbd|to\s+be\s+determined)!?$/i.test(text)) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const when = /^(?:early|mid|late)?\s*([A-Za-z]{3,9})\.?\s+(20\d{2})$/i.exec(text);
  if (!when) return { status: null, readyNow: false, moveInDate: null };
  const word = when[1]!.toLowerCase();
  const year = Number(when[2]);
  const monthName = MONTHS[word.slice(0, 3)];
  const seasonEnd = SEASON_END[word];
  if (!monthName && seasonEnd === undefined) return { status: null, readyNow: false, moveInDate: null };
  // The month (or the season's last month) before the run month is a stale estimate.
  const lastMonth = monthName ? Object.keys(MONTHS).indexOf(word.slice(0, 3)) : seasonEnd!;
  if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && lastMonth < now.getUTCMonth())) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  const label = monthName ? `${monthName} ${year}` : `${word[0]!.toUpperCase()}${word.slice(1)} ${year}`;
  return { status: `Quick Move-In (${label})`, readyNow: false, moveInDate: label };
}

export type SitterleCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

/** The community's name, sales address and map pin from its page; null when the page has neither name nor address block. */
export function sitterleRecord(html: string): SitterleCommunityRecord | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const all = descendants(root);
  const nameBlock = all.find((element) => element.attributes.id === "community-name");
  const name = nameBlock ? normalize(htmlToText(html.slice(nameBlock.contentStart, nameBlock.contentEnd))) : null;
  const addressBlock = all.find((element) => elementClass(element, "comm-page-address"));
  const line = addressBlock ? normalize(htmlToText(html.slice(addressBlock.contentStart, addressBlock.contentEnd))) : "";
  if (!name || !addressBlock) return null;
  const parts = /^(.*?),\s*([A-Za-z .'-]+),\s*TX(?:\s+(\d{5}))?/.exec(line);
  const pin = /google\.com\/maps\/dir\/\/[^"'\s]*?@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(html) ?? /google\.com\/maps\/[^"'\s]*?@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(html);
  return {
    name,
    street: parts && /\d/.test(parts[1]!) ? parts[1]!.trim() : null,
    city: parts ? parts[2]!.trim() : null,
    zip: parts?.[3] ?? null,
    phone: null,
    priceFrom: null,
    geo: pin ? { lat: Number(pin[1]), lng: Number(pin[2]) } : null,
  };
}

/** A text block of the page opens "Coming soon" (the community's introduction). */
export function sitterleComingSoon(html: string): boolean {
  return /class="elementor-widget-container">\s*Coming\s+soon\b/i.test(html);
}

export type SitterlePage = { record: SitterleCommunityRecord | null; homes: PrivatePlanOrHome[]; plans: PrivatePlanOrHome[]; cardCount: number; foreignHome: boolean };

function stat(statsText: string, label: RegExp): number | null {
  const match = new RegExp(`([\\d,.]+)\\s*${label.source}`, "i").exec(statsText);
  return match ? Number(match[1]!.replace(/,/g, "")) || null : null;
}

/** Every listing card on the page, homes and plans apart; null when the page has no listing block at all. */
export function parseSitterleCommunity(html: string, pageUrl: string, now: Date = new Date()): SitterlePage | null {
  const community = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const all = descendants(root);
  const container = all.find((element) => elementClass(element, "comm--listings-container") || element.attributes.id === "comm--filters-content");
  if (!container) return null;
  const record = sitterleRecord(html);
  const host = community.hostname;
  const homes: PrivatePlanOrHome[] = [];
  const plans: PrivatePlanOrHome[] = [];
  let cardCount = 0;
  let foreignHome = false;
  for (const card of descendants(container).filter((element) => elementClass(element, "comm--listing-container"))) {
    const inner = descendants(card);
    const title = inner.find((element) => elementClass(element, "result--title"));
    const titleText = title ? normalize(elementText(title, html)) : null;
    const href = title?.attributes.href ? decodeHtmlEntities(title.attributes.href) : null;
    const page = href ? asUrl(new URL(href, community).toString()) : null;
    const link = page && sameOfficialHost(page, host) ? page : null;
    const info = inner.find((element) => elementClass(element, "listing--info-container"));
    const infoHtml = info ? html.slice(info.contentStart, info.contentEnd) : "";
    const paragraphs = Array.from(infoHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map((match) => normalize(htmlToText(match[1]!)));
    const field = (label: RegExp) => paragraphs.map((paragraph) => label.exec(paragraph)?.[1]?.trim() ?? null).find((value): value is string => Boolean(value)) ?? null;
    const inCommunity = field(/^in\s+(.+)$/i);
    const struck = /<strong class="[^"]*custom-strikethrough[^"]*">([^<]*)<\/strong>/i.exec(infoHtml)?.[1] ?? null;
    const listedPrice = money(field(/^Price:\s*(.+)$/i));
    const reducedPrice = money(field(/^Reduced Price:\s*(.+)$/i));
    const current = reducedPrice ?? (struck ? null : listedPrice);
    const previous = struck ? money(struck) : null;
    const statsText = paragraphs.join(" ");
    const beds = stat(statsText, /Beds?/);
    const baths = stat(statsText, /Baths?/);
    const garage = stat(statsText, /Car\s+Garage/);
    const stories = storiesFrom(stat(statsText, /Stor(?:y|ies)/));
    const sqft = stat(statsText, /Sq\.?\s*Ft/);
    const images = inner.filter((element) => element.tag === "img" && element.attributes.src).map((element) => asUrl(decodeHtmlEntities(element.attributes.src!))).filter((url): url is URL => Boolean(url && sameOfficialHost(url, host)));
    const gallery: PrivateGalleryImage[] = images.map((url) => { url.search = ""; return { sourceUrl: url.toString(), caption: null, width: null, height: null, srcSet: null }; });
    if (elementClass(card, "plan")) {
      const planName = titleText ? titleText.replace(/\s+Plan$/i, "").trim() : null;
      if (!planName || !link) continue;
      plans.push({
        sourceUrl: link.toString(), privateName: planName, privatePlanName: planName, status: null,
        price: listedPrice && listedPrice > 0 ? listedPrice : null, bedrooms: beds, bathrooms: baths, squareFeet: sqft, garage, stories, readyNow: false,
        gallery: gallery.map((image) => ({ ...image, caption: "Representative image" })),
      });
      continue;
    }
    cardCount++;
    // A card saying "in <another community>" is not this community's inventory.
    if (record && inCommunity && normalize(inCommunity).toLowerCase() !== record.name.toLowerCase()) foreignHome = true;
    const note = inner.find((element) => elementClass(element, "comm--custom-note"));
    const status = sitterleStatus(note ? normalize(elementText(note, html)) : field(/^Est(?:imated)?\.?\s*Completion:\s*(.+)$/i), now);
    const readable = Boolean(titleText && link && current);
    const cityLine = record?.city ? `${record.city}, ${record.zip ? `TX ${record.zip}` : "TX"}` : null;
    homes.push({
      sourceUrl: readable ? link!.toString() : `${community.origin}${community.pathname.replace(/\/+$/, "")}/unreadable-${homes.length}`,
      privateName: titleText,
      privateAddress: titleText && cityLine ? `${titleText}, ${cityLine}` : titleText,
      privatePlanName: field(/^Plan:\s*(.+)$/i),
      status: readable ? status.status : null,
      price: current && current > 0 ? current : null,
      previousPrice: previous && current && previous > current ? previous : null,
      priceDrop: previous && current && previous > current ? previous - current : null,
      bedrooms: beds, bathrooms: baths, squareFeet: sqft, garage, stories,
      readyNow: status.readyNow, moveInDate: status.moveInDate, gallery,
    });
  }
  return { record, homes, plans, cardCount, foreignHome };
}

/** The communities page's cards: name, page link and city line; the page is read for the address and pin. Null when the page has no cards. */
export function sitterleListingEntries(html: string, host: string): Array<{ url: string; record: SitterleCommunityRecord }> | null {
  const root = parseHtmlElements(html);
  if (!root) return null;
  const cards = descendants(root).filter((element) => elementClass(element, "single-result-container"));
  if (!cards.length) return null;
  const out = new Map<string, { url: string; record: SitterleCommunityRecord }>();
  for (const card of cards) {
    const inner = descendants(card);
    const title = inner.find((element) => elementClass(element, "result--title") && element.tag === "a");
    const name = title ? normalize(elementText(title, html)) : null;
    const url = title?.attributes.href ? asUrl(decodeHtmlEntities(title.attributes.href)) : null;
    if (!name || !url || !sameOfficialHost(url, host)) continue;
    const cityBlock = inner.find((element) => elementClass(element, "result--city"));
    const cityLine = cityBlock ? normalize(elementText(cityBlock, html)) : "";
    const parts = /^([A-Za-z .'-]+),\s*TX(?:\s+(\d{5}))?/.exec(cityLine);
    const key = `${url.origin}${url.pathname}`;
    if (!out.has(key)) out.set(key, { url: key, record: { name, street: null, city: parts?.[1]?.trim() ?? null, zip: parts?.[2] ?? null, phone: null, priceFrom: null, geo: null } });
  }
  return Array.from(out.values());
}

export class SitterleAdapter implements DealAdapter {
  readonly builder = "Sitterle Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, SITTERLE_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", SITTERLE_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const parsed = parseSitterleCommunity(page.text, community.toString(), now());
    // An empty listing block under an introduction that opens "Coming soon" (Oak Bend Estates, Oct 22: "Coming soon to Fair Oaks Ranch … Join our interest list"): coming soon, not a changed page.
    if (parsed && parsed.cardCount === 0 && parsed.homes.length === 0 && sitterleComingSoon(page.text)) return failedResult(config, fetchedAt, privateSnapshot, ["community_coming_soon"]);
    // Without the listing block, the community's name or its sales address this is not a community page.
    if (!parsed || !parsed.record?.street) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.homes.length < parsed.cardCount) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (parsed.foreignHome) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_inventory_response"]);
    if (parsed.homes.length > SITTERLE_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const facts = parseCommunityFacts(page.text);
    const planPrices = parsed.plans.map((plan) => plan.price).filter((price): price is number => price !== null);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? (planPrices.length ? Math.min(...planPrices) : null) };
    for (const home of parsed.homes) { privateSnapshot.homes.push(home); privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName)); }
    for (const plan of parsed.plans) { privateSnapshot.plans.push(plan); privateSnapshot.pages.push(sourcePage("plan", plan.sourceUrl, plan.privatePlanName ?? null)); }
    // The page carries a payment calculator and no offer terms; nothing is read as an incentive.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}


