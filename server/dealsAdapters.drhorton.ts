import {
  DRHORTON_HOST, asUrl, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivateDealSnapshot, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";

/**
 * D.R. HORTON reader. D.R. Horton's site (Sitecore) renders a community page
 * with every home for sale and every floor plan as server-side cards, so one
 * page carries the whole inventory; each home's own page adds its photo
 * gallery and plan name. Read-only, plain GET, official host only. Everything
 * here is private operational data.
 *
 * Page shapes (October 2026):
 * - community: /texas/san-antonio/<city>/<community>
 *     #relatedmovein  (data-currentindex, data-totalitems): a.available-home-card per home;
 *                      a card with no href and "Under Contract" is no longer for sale
 *     #floorplans     (data-currentindex, data-totalitems): a.CoveoResultLink per plan,
 *                      "Starting in the $242s"
 * - home:      .../<community>/qmis/5919-granite-quarry
 *     .PropertyGallery img[data-lazy] under the home's own media folder
 * D.R. Horton does not publish a move-in date per home; a home that is for sale
 * is listed as a quick move-in, nothing more specific.
 */
/** A community with more homes for sale than this is held, never truncated. */
export const DRHORTON_MAX_DETAIL_PAGES = 120;

const normalize = (value: string) => decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
const money = (value: string): number | null => { const match = /\$\s*(\d{1,3}(?:,\d{3})+|\d{5,7})(?!\d)/.exec(value); const price = match ? Number(match[1]!.replace(/,/g, "")) : NaN; return Number.isFinite(price) && price >= 50_000 ? price : null; };
const titleCase = (value: string) => value.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());

export type DrhCard = PrivatePlanOrHome & { kind: "home" | "plan"; detailPath: string | null; stories: number | null };

/** The stats line of a card: "3 Bed | 2 Bath | 2 Garage" and "1 Story | 1,489 Sq. Ft. | Lot 20". */
function cardStats(text: string): { bedrooms: number | null; bathrooms: number | null; garage: number | null; stories: number | null; squareFeet: number | null; homesite: string | null } {
  const number = (pattern: RegExp) => { const match = pattern.exec(text); return match ? Number(match[1]!.replace(/,/g, "")) : null; };
  const lot = /\bLot\s+([A-Za-z0-9-]+)/.exec(text);
  return {
    bedrooms: number(/(\d+(?:\.\d)?)\s*Bed\b/i),
    bathrooms: number(/(\d+(?:\.\d)?)\s*Bath\b/i),
    garage: number(/(\d+)\s*Garage\b/i),
    stories: number(/(\d+)\s*Stor(?:y|ies)\b/i),
    squareFeet: number(/([\d,]{3,6})\s*Sq\.?\s*Ft\b/i),
    homesite: lot ? `Lot ${lot[1]}` : null,
  };
}

/** The listing blocks' own counts: the page renders every item when currentindex equals totalitems; otherwise more sit behind an API. */
export function drhListingCounts(html: string): { homes: { rendered: number; total: number } | null; plans: { rendered: number; total: number } | null } {
  const counts = (id: string) => {
    const match = new RegExp(`<[a-z][a-z0-9]*\\b[^>]*\\bid=(["']?)${id}\\1[^>]*>`, "i").exec(html);
    if (!match) return null;
    const rendered = /data-currentindex=["']?(\d+)/.exec(match[0]);
    const total = /data-totalitems=["']?(\d+)/.exec(match[0]);
    return rendered && total ? { rendered: Number(rendered[1]), total: Number(total[1]) } : null;
  };
  return { homes: counts("relatedmovein"), plans: counts("floorplans") };
}

const CITY_ZIP = /^\s*([A-Za-z .'-]+),\s*TX\s+(\d{5})\b/;

/** The community's city and ZIP from its LocalBusiness record ("SAN ANTONIO", "78222"); null when the page carries none. */
export function drhCommunityAddress(html: string): { street: string | null; city: string | null; zip: string | null } | null {
  for (const match of Array.from(html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))) {
    try {
      const parsed = JSON.parse(match[1]!.trim()) as { "@type"?: string; address?: Record<string, string> };
      if (parsed["@type"] !== "LocalBusiness" || !parsed.address) continue;
      const address = parsed.address;
      const zip = /\b(\d{5})\b/.exec(address.postalCode ?? "")?.[1] ?? null;
      return { street: address.streetAddress?.trim() || null, city: address.addressLocality ? titleCase(address.addressLocality.trim()) : null, zip };
    } catch { /* a broken block is skipped */ }
  }
  return null;
}

/**
 * Every card in the community page's homes-for-sale and floor-plans blocks.
 * Null when the page has no homes block at all (a layout change holds the run
 * rather than marking every home sold).
 */
/**
 * The community's own status badge in its page header ("Coming Soon", "New Phase Coming Soon", "Now Selling"),
 * not a badge on a nearby community's card; null when the header carries none.
 */
export function drhCommunityStatus(html: string): string | null {
  const match = /class="community-main-info"[\s\S]{0,800}?class="home-info__community-status"[\s\S]{0,400}?<span>([^<]{1,60})<\/span>/i.exec(html);
  return match ? decodeHtmlEntities(match[1]!).replace(/\s+/g, " ").trim() : null;
}

export function parseDrhCommunityCards(html: string, communityUrl: string): DrhCard[] | null {
  const community = asUrl(communityUrl);
  const root = parseHtmlElements(html);
  if (!community || !root) return null;
  const elements = descendants(root);
  const homesBlock = elements.find((element) => element.attributes.id === "relatedmovein");
  if (!homesBlock) return null;
  const plansBlock = elements.find((element) => element.attributes.id === "floorplans");
  const address = drhCommunityAddress(html);
  const cityLine = address?.city ? `${address.city}, ${address.zip ? `TX ${address.zip}` : "TX"}` : null;
  const cards: DrhCard[] = [];
  for (const anchor of descendants(homesBlock).filter((element) => element.tag === "a" && elementClass(element, "available-home-card"))) {
    const text = elementText(anchor, html);
    const inner = descendants(anchor);
    const heading = inner.find((element) => element.tag === "h2");
    const street = inner.find((element) => element.tag === "h3");
    const priceText = heading ? elementText(heading, html) : "";
    const underContract = /under\s+contract/i.test(priceText) || elementClass(anchor, "disabled");
    const was = /was\s+\$\s*([\d,]{6,})/i.exec(priceText);
    const price = money(priceText.replace(/was\s+\$\s*[\d,]+/i, ""));
    const previous = was ? Number(was[1]!.replace(/,/g, "")) : null;
    const href = anchor.attributes.href ? decodeHtmlEntities(anchor.attributes.href) : null;
    const detail = href ? asUrl(new URL(href, community).toString()) : null;
    const streetText = street ? normalize(elementText(street, html)) : "";
    // A card the reader cannot read is still a card: it stays, unnamed and without a status, so the sync holds the run instead of marking homes sold.
    if (!streetText) { cards.push({ kind: "home", detailPath: null, sourceUrl: `${community.origin}${community.pathname.replace(/\/+$/, "")}/qmis/unreadable-${cards.length}`, privateName: null, privateAddress: null, privatePlanName: null, status: null, price: null, readyNow: false, ...cardStats(text), gallery: [] }); continue; }
    const image = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(descendants(anchor).find((element) => elementClass(element, "card-image"))?.attributes.style ?? "");
    cards.push({
      kind: "home",
      detailPath: detail && sameOfficialHost(detail, DRHORTON_HOST) && /\/qmis\//.test(detail.pathname) ? detail.pathname : null,
      sourceUrl: detail ? detail.toString() : `${community.origin}${community.pathname.replace(/\/+$/, "")}/qmis/${streetText.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      privateName: streetText,
      privateAddress: cityLine ? `${streetText}, ${cityLine}` : streetText,
      privatePlanName: null,
      status: underContract ? "Under Contract" : price ? "Quick Move-In (For Sale)" : null,
      price,
      previousPrice: previous && price && previous > price ? previous : null,
      priceDrop: previous && price && previous > price ? previous - price : null,
      readyNow: false,
      ...cardStats(text),
      gallery: image ? [{ sourceUrl: new URL(decodeHtmlEntities(image[1]!), community).toString(), caption: null, width: null, height: null, srcSet: null }] : [],
    });
  }
  for (const anchor of plansBlock ? descendants(plansBlock).filter((element) => element.tag === "a" && element.attributes.href && /\/floor-plans\//.test(element.attributes.href)) : []) {
    const inner = descendants(anchor);
    const name = inner.find((element) => element.tag === "h2");
    const from = inner.find((element) => element.tag === "h3");
    const planName = name ? normalize(elementText(name, html)) : "";
    if (!planName) continue;
    const fromText = from ? elementText(from, html) : "";
    // "Starting in the $242s" is a band; its low end is the plan's starting price.
    const band = /\$\s*(\d{3})s\b/.exec(fromText);
    const price = money(fromText) ?? (band ? Number(band[1]) * 1_000 : null);
    const detail = asUrl(new URL(decodeHtmlEntities(anchor.attributes.href!), community).toString());
    if (!detail || !sameOfficialHost(detail, DRHORTON_HOST)) continue;
    const image = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(inner.find((element) => elementClass(element, "card-image"))?.attributes.style ?? "");
    cards.push({
      kind: "plan",
      detailPath: detail.pathname,
      sourceUrl: detail.toString(),
      privateName: planName,
      privatePlanName: planName,
      status: null,
      price,
      readyNow: false,
      ...cardStats(elementText(anchor, html)),
      gallery: image ? [{ sourceUrl: new URL(decodeHtmlEntities(image[1]!), community).toString(), caption: "Representative image", width: null, height: null, srcSet: null }] : [],
    });
  }
  return cards;
}

/**
 * A home page's own photos: the gallery images under the home's media folder
 * (…/<lot>-<address-slug>/…). Floor-plan drawings and the design's feature
 * sheets are never included. The plan name comes from the stats line
 * ("| The Caroline floor plan").
 */
export function parseDrhHomeDetail(html: string, pageUrl: string): { gallery: PrivateGalleryImage[]; planName: string | null; price: number | null; previousPrice: number | null } | null {
  const url = asUrl(pageUrl);
  if (!url) return null;
  const slug = url.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
  if (!slug || !/PropertyGallery/.test(html)) return null;
  const images: PrivateGalleryImage[] = [];
  const seen = new Set<string>();
  for (const match of Array.from(html.matchAll(/<img\b[^>]*?(?:data-lazy|src)="([^"]+)"[^>]*>/gi))) {
    const raw = decodeHtmlEntities(match[1]!);
    const path = raw.split("?")[0]!.toLowerCase();
    if (!path.includes("/-/media/drhorton/productcatalog/") || !/\.(?:jpe?g|png|webp)$/.test(path)) continue;
    // The home's own folder is "<lot>-<address slug>"; a folder for another address or the plan itself is not this home.
    const folder = path.split("/").at(-2) ?? "";
    if (!(folder === slug || folder.endsWith(`-${slug}`))) continue;
    const file = path.split("/").at(-1) ?? "";
    if (/^fp-|floor[-_]?plan|interior_features|elevation_chart/.test(file)) continue;
    // The page asks for thumbnails (w=494); the photo pipeline wants the original, so the sizing parameters go.
    const full = new URL(raw, url);
    for (const key of ["w", "h", "thn", "sc", "as", "iar", "mw", "mh"]) full.searchParams.delete(key);
    if (seen.has(full.toString())) continue;
    seen.add(full.toString());
    images.push({ sourceUrl: full.toString(), caption: null, width: null, height: null, srcSet: null });
  }
  const text = htmlToText(html);
  // The stats line of this home: "1,489 Sq. Ft. | Lot 20 | The Caroline floor plan"; a similar-homes card elsewhere on the page names another plan.
  const statsLine = /[\d,]{3,6}\s*Sq\.?\s*Ft\.?\s*\|\s*Lot\s+[A-Za-z0-9-]+\s*\|\s*((?:The\s+)?[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})\s+floor\s+plan\b/.exec(text);
  const plan = statsLine ?? null;
  const priceBlock = /\$\s*[\d,]{6,}(?:\s*was\s+\$\s*[\d,]{6,})?/.exec(text);
  const was = priceBlock ? /was\s+\$\s*([\d,]{6,})/i.exec(priceBlock[0]) : null;
  return {
    gallery: images,
    planName: plan ? normalize(plan[1]!) : null,
    price: priceBlock ? money(priceBlock[0].replace(/was\s+\$\s*[\d,]+/i, "")) : null,
    previousPrice: was ? Number(was[1]!.replace(/,/g, "")) : null,
  };
}

export class DrHortonAdapter implements DealAdapter {
  readonly builder = "D.R. Horton" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, DRHORTON_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", DRHORTON_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const cards = parseDrhCommunityCards(page.text, community.toString());
    // No home block and the header says coming soon (Blue Wing Trails, McQueeney Oaks, Winding Creek's new phase, Oct 22).
    if (!cards && /coming\s+soon/i.test(drhCommunityStatus(page.text) ?? "")) return failedResult(config, fetchedAt, privateSnapshot, ["community_coming_soon"]);
    if (!cards) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    // The page says how many items each block holds; anything not rendered sits behind an API this reader does not call.
    const counts = drhListingCounts(page.text);
    if ((counts.homes && counts.homes.rendered < counts.homes.total) || (counts.plans && counts.plans.rendered < counts.plans.total)) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    // The block says how many homes it holds; fewer cards parsed than that means the card markup changed, not that homes sold.
    const parsedHomes = cards.filter((card) => card.kind === "home").length;
    if (counts.homes && parsedHomes < counts.homes.total) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (!counts.homes) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    privateSnapshot.communityFacts = parseCommunityFacts(page.text);
    const homes = cards.filter((card) => card.kind === "home");
    const forSale = homes.filter((card) => card.detailPath);
    if (forSale.length > DRHORTON_MAX_DETAIL_PAGES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    for (const card of homes) {
      const { kind: _kind, detailPath, ...home } = card;
      if (detailPath) {
        const detail = await getDocument(home.sourceUrl, fetcher, "text/html,application/xhtml+xml", DRHORTON_HOST);
        if (!detail.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(detail, "detail_fetch_failed")]);
        const parsed = parseDrhHomeDetail(detail.text, home.sourceUrl);
        if (!parsed) return failedResult(config, fetchedAt, privateSnapshot, ["expected_detail_container_not_found"]);
        privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName));
        home.privatePlanName = parsed.planName;
        if (parsed.gallery.length) home.gallery = parsed.gallery;
      }
      privateSnapshot.homes.push(home);
    }
    for (const card of cards.filter((item) => item.kind === "plan")) {
      const { kind: _kind, detailPath: _detailPath, ...plan } = card;
      privateSnapshot.plans.push(plan);
    }
    // D.R. Horton's promotions are site-wide event banners with their own terms pages; none is read as a community incentive here.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
