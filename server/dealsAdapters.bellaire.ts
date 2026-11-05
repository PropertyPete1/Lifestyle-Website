import {
  BELLAIRE_HOST, asUrl, decodeHtmlEntities, descendants, elementClass, elementText, emptyPrivate, failedResult, fetchFailureHold, getDocument, htmlToText, makePublicSnapshot, parseCommunityFacts, parseHtmlElements, sameOfficialHost, sourcePage, successfulResult,
  type AdapterRunOptions, type CommunitySourceConfig, type DealAdapter, type DealAdapterResult, type HtmlFetcher, type PrivateGalleryImage, type PrivatePlanOrHome,
  storiesFrom,
} from "./dealsAdapters";

/**
 * BELLAIRE HOMES reader (Nov 5, 2026; Peter found Annabelle Ranch missing from the site). A local San Antonio-area
 * builder on large homesites. WordPress (Elementor), server-rendered. The neighborhood page
 * (`/texas/neighborhoods/<slug>/`) carries the name in `h1`, the city in the title ("… New Homes in Schertz, TX"), and
 * a Google Maps embed whose `pb` string holds the pin (`!2d<lng>!3d<lat>`) and the sales address (`!2s5011%20Tupelo
 * %20Row%2C%20San%20Antonio%2C%20TX%2078263`). Its "Move-In Ready Homes" page (`<neighborhood>/move-in-ready-homes/`)
 * is one `table.xpro-table` with the columns ADDRESS · FLOOR PLAN · ST/BR/BA/GR · SQ FT · WAS · NOW · EST. MOVE-IN ·
 * VIEW PLAN (a PDF) · PHOTOS OF HOME (a link to `/texas/<street-slug>/` when the home has photos) · 3D TOUR. EST.
 * MOVE-IN is "NOW", a month name, or "SOLD". A home's photo page carries its gallery under `/texas/wp-content/uploads/`.
 * The neighborhoods index (`/texas/neighborhoods/`) links each neighborhood. Read-only, plain GET, official host only.
 * Everything here is private operational data.
 *
 * Page shapes (November 2026):
 * - neighborhoods: /texas/neighborhoods/                            (about 95 KB)
 * - neighborhood:  /texas/neighborhoods/<slug>/                     (about 80 KB)
 * - homes:         /texas/neighborhoods/<slug>/move-in-ready-homes/ (about 90 KB)
 * - home photos:   /texas/<street-slug>/                            (about 80 KB)
 */
export const BELLAIRE_MAX_HOMES = 150;
/** Photo pages read per run; a community with more priced homes than this still publishes, the rest without photos. */
export const BELLAIRE_MAX_PHOTO_PAGES = 40;
export const bellaireListingUrl = () => `https://${BELLAIRE_HOST}/texas/neighborhoods/`;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const normalize = (value: string) => decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
const money = (value: string | null): number | null => { const match = value ? /\$\s*([\d,]{5,})/.exec(value) : null; return match ? Number(match[1]!.replace(/,/g, "")) : null; };

/**
 * "NOW" is ready; "SOLD" (or "pending", "under contract") sells; a month name is the estimate, in this year when the
 * month is still ahead and next year otherwise; anything else gives no status (the run is held).
 */
export function bellaireStatus(cell: string | null, now: Date): { status: string | null; readyNow: boolean; moveInDate: string | null } {
  const text = (cell ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { status: null, readyNow: false, moveInDate: null };
  if (/^(?:now|available\s+now|move[- ]?in\s+ready|ready)!?$/i.test(text)) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  if (/\bsold\b|pending|under\s+contract/i.test(text)) return { status: "Sold", readyNow: false, moveInDate: null };
  const when = /^(?:early|mid|late|est\.?)?\s*([A-Za-z]{3,9})\.?(?:\s+(20\d{2}))?$/i.exec(text);
  if (!when) return { status: null, readyNow: false, moveInDate: null };
  const index = MONTHS.findIndex((month) => month.startsWith(when[1]!.toLowerCase().slice(0, 3)));
  if (index < 0) return { status: null, readyNow: false, moveInDate: null };
  const year = when[2] ? Number(when[2]) : index >= now.getUTCMonth() ? now.getUTCFullYear() : now.getUTCFullYear() + 1;
  const label = `${MONTHS[index]![0]!.toUpperCase()}${MONTHS[index]!.slice(1)} ${year}`;
  return { status: `Quick Move-In (${label})`, readyNow: false, moveInDate: label };
}

export type BellaireCommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

/** The neighborhood's name, city, sales address and pin from its page; null without a name. */
export function bellaireRecord(html: string): BellaireCommunityRecord | null {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const name = h1 ? normalize(htmlToText(h1)) : null;
  if (!name) return null;
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  const titleCity = /in\s+([A-Za-z .'-]+?),\s*TX\b/i.exec(decodeHtmlEntities(title))?.[1]?.trim() ?? null;
  const embed = /maps\/embed\?pb=([^"'\s]+)/i.exec(html)?.[1] ?? null;
  const pin = embed ? /!2d(-?\d{1,3}\.\d+)!3d(-?\d{1,2}\.\d+)/.exec(embed) : null;
  const place = embed ? /!2s([^!]+)/.exec(embed)?.[1] : null;
  let address: string | null = null;
  if (place) { try { address = decodeURIComponent(place.replace(/\+/g, " ")); } catch { address = null; } }
  const parts = address ? /^(\d[^,]{2,60}),\s*([A-Za-z .'-]+),\s*TX(?:\s+(\d{5}))?/.exec(address) : null;
  return {
    name,
    street: parts?.[1]?.trim() ?? null,
    city: parts?.[2]?.trim() ?? titleCity,
    zip: parts?.[3] ?? null,
    phone: null,
    priceFrom: null,
    geo: pin ? { lat: Number(pin[2]), lng: Number(pin[1]) } : null,
  };
}

export type BellaireRow = { address: string; plan: string | null; stories: number | null; beds: number | null; baths: number | null; garage: number | null; sqft: number | null; was: number | null; now: number | null; moveIn: string | null; photoPage: string | null };

/** Every body row of the move-in-ready table; null when the page has no such table. */
export function parseBellaireHomes(html: string, pageUrl: string): BellaireRow[] | null {
  const page = asUrl(pageUrl);
  const root = parseHtmlElements(html);
  if (!page || !root) return null;
  const all = descendants(root);
  const table = all.find((element) => element.tag === "table" && elementClass(element, "xpro-table"));
  if (!table) return null;
  const headers = descendants(table).filter((element) => element.tag === "th").map((element) => normalize(elementText(element, html)).toUpperCase());
  const column = (label: RegExp) => headers.findIndex((header) => label.test(header));
  const columns = { address: column(/ADDRESS/), plan: column(/PLAN/), rooms: column(/ST\/BR\/BA/), sqft: column(/SQ\s*FT/), was: column(/^WAS/), now: column(/^NOW/), moveIn: column(/MOVE-?IN/), photos: column(/PHOTO/) };
  if (columns.address < 0 || columns.now < 0 || columns.moveIn < 0) return null;
  const rows: BellaireRow[] = [];
  for (const tr of descendants(table).filter((element) => element.tag === "tr" && elementClass(element, "xpro-table-body-row"))) {
    const cells = descendants(tr).filter((element) => element.tag === "td");
    const cellText = (index: number) => index >= 0 && cells[index] ? normalize(elementText(cells[index]!, html)) : "";
    const cellLink = (index: number) => { const cell = index >= 0 ? cells[index] : undefined; const a = cell ? descendants(cell).find((element) => element.tag === "a" && element.attributes.href) : undefined; return a ? asUrl(new URL(decodeHtmlEntities(a.attributes.href!), page).toString()) : null; };
    const address = cellText(columns.address);
    if (!address || !/^\d/.test(address)) continue;
    const rooms = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(cellText(columns.rooms));
    const sqft = Number(cellText(columns.sqft).replace(/[^\d]/g, "")) || null;
    const photo = cellLink(columns.photos);
    rows.push({
      address,
      plan: cellText(columns.plan) || null,
      stories: rooms ? storiesFrom(Number(rooms[1])) : null,
      beds: rooms ? Number(rooms[2]) || null : null,
      baths: rooms ? Number(rooms[3]) || null : null,
      garage: rooms ? Number(rooms[4]) || null : null,
      sqft,
      was: money(cellText(columns.was)),
      now: money(cellText(columns.now)),
      moveIn: cellText(columns.moveIn) || null,
      photoPage: photo && sameOfficialHost(photo, BELLAIRE_HOST) && /^\/texas\/[a-z0-9-]+\/?$/i.test(photo.pathname) && !/^\/texas\/neighborhoods\//i.test(photo.pathname) ? `${photo.origin}${photo.pathname}` : null,
    });
  }
  return rows;
}

/** The gallery of a home's photo page: every full-size upload (not the site's own logo or banner sizes). */
export function parseBellaireGallery(html: string): PrivateGalleryImage[] {
  const seen = new Set<string>();
  const out: PrivateGalleryImage[] = [];
  for (const match of Array.from(html.matchAll(/https:\/\/bellairehomes\.net\/texas\/wp-content\/uploads\/(\d{4}\/\d{2}\/[A-Za-z0-9._-]+?)(?:-\d{2,4}x\d{2,4})?\.(jpe?g|webp|png)/gi))) {
    const base = `https://${BELLAIRE_HOST}/texas/wp-content/uploads/${match[1]}.${match[2]!.toLowerCase()}`;
    if (/cropped-|logo|home-bottom-gallery|icon|favicon/i.test(match[1]!)) continue;
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({ sourceUrl: base, caption: null, width: null, height: null, srcSet: null });
  }
  return out;
}

/** The neighborhoods index's links; each page is read for its city, address and pin. Null when the page has none. */
export function bellaireListingEntries(html: string, host: string): Array<{ url: string; record: BellaireCommunityRecord }> | null {
  const out = new Map<string, { url: string; record: BellaireCommunityRecord }>();
  for (const match of Array.from(html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+\/texas\/neighborhoods\/([a-z0-9-]+)\/)"[^>]*>([\s\S]*?)<\/a>/gi))) {
    const url = asUrl(decodeHtmlEntities(match[1]!));
    if (!url || !sameOfficialHost(url, host)) continue;
    const name = normalize(htmlToText(match[3]!));
    const key = `${url.origin}${url.pathname}`;
    const existing = out.get(key);
    const fromSlug = match[2]!.split("-").map((part: string) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part).join(" ");
    const useName = name && name.length <= 60 && !/^(?:learn more|view|see|explore|read more|move-in)/i.test(name) ? name : fromSlug;
    if (!existing) out.set(key, { url: key, record: { name: useName, street: null, city: null, zip: null, phone: null, priceFrom: null, geo: null } });
    else if (existing.record.name === fromSlug && useName !== fromSlug) existing.record.name = useName;
  }
  return out.size ? Array.from(out.values()) : null;
}

export class BellaireAdapter implements DealAdapter {
  readonly builder = "Bellaire Homes" as const;

  async load(config: CommunitySourceConfig, options: AdapterRunOptions = {}): Promise<DealAdapterResult> {
    const now = options.now ?? (() => new Date());
    const fetchedAt = now().toISOString();
    const privateSnapshot = emptyPrivate(config);
    const community = asUrl(config.sourceUrl);
    if (!community) return failedResult(config, fetchedAt, privateSnapshot, ["invalid_source_url"]);
    if (!sameOfficialHost(community, BELLAIRE_HOST)) return failedResult(config, fetchedAt, privateSnapshot, ["unsupported_official_host"]);
    const fetcher: HtmlFetcher = options.fetcher ?? fetch;
    const page = await getDocument(community.toString(), fetcher, "text/html,application/xhtml+xml", BELLAIRE_HOST);
    if (!page.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(page, "community_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("community", community.toString(), config.privateCommunityName));
    const record = bellaireRecord(page.text);
    if (!record) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    const homesUrl = `${community.origin}${community.pathname.replace(/\/+$/, "")}/move-in-ready-homes/`;
    const homesPage = await getDocument(homesUrl, fetcher, "text/html,application/xhtml+xml", BELLAIRE_HOST);
    if (!homesPage.ok) return failedResult(config, fetchedAt, privateSnapshot, [fetchFailureHold(homesPage, "inventory_fetch_failed")]);
    privateSnapshot.pages.push(sourcePage("inventory", homesUrl, config.privateCommunityName));
    const rows = parseBellaireHomes(homesPage.text, homesUrl);
    if (!rows) return failedResult(config, fetchedAt, privateSnapshot, ["expected_community_container_not_found"]);
    if (rows.length > BELLAIRE_MAX_HOMES) return failedResult(config, fetchedAt, privateSnapshot, ["incomplete_inventory"]);
    const cityLine = record.city ? `${record.city}, ${record.zip ? `TX ${record.zip}` : "TX"}` : null;
    let photoPages = 0;
    for (const row of rows) {
      const status = bellaireStatus(row.moveIn, now());
      let gallery: PrivateGalleryImage[] = [];
      if (row.photoPage && status.status !== "Sold" && photoPages < BELLAIRE_MAX_PHOTO_PAGES) {
        photoPages++;
        const photos = await getDocument(row.photoPage, fetcher, "text/html,application/xhtml+xml", BELLAIRE_HOST);
        if (photos.ok) { gallery = parseBellaireGallery(photos.text); privateSnapshot.pages.push(sourcePage("home", row.photoPage, row.address)); }
      }
      const current = row.now;
      const previous = row.was && current && row.was > current ? row.was : null;
      privateSnapshot.homes.push({
        sourceUrl: row.photoPage ?? `${homesUrl}#${row.address.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        privateName: row.address,
        privateAddress: cityLine ? `${row.address}, ${cityLine}` : row.address,
        privatePlanName: row.plan,
        status: status.status,
        price: current && current > 0 ? current : null,
        previousPrice: previous,
        priceDrop: previous && current ? previous - current : null,
        bedrooms: row.beds, bathrooms: row.baths, squareFeet: row.sqft, garage: row.garage, stories: row.stories,
        readyNow: status.readyNow, moveInDate: status.moveInDate, gallery,
      });
    }
    const facts = parseCommunityFacts(page.text);
    const prices = privateSnapshot.homes.map((home) => home.price).filter((price): price is number => price !== null);
    privateSnapshot.communityFacts = { ...facts, fromPrice: facts.fromPrice ?? (prices.length ? Math.min(...prices) : null) };
    // No rate offers on the site; nothing is read as an incentive.
    return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
  }
}
