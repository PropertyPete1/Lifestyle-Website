import { z } from "zod";
import { normalizedDealSourceKey, normalizedText } from "../shared/deals";
import {
  asUrl, emptyPrivate, failedResult, looksLikeStreetAddress, makePublicSnapshot, officialHostFor, parsePromotionalRate, sameOfficialHost, sourcePage, successfulResult,
  type CommunitySourceConfig, type DealAdapterResult, type DealHoldReason, type PrivateGalleryImage, type PrivatePlanOrHome,
} from "./dealsAdapters";
import { cleanOfferText } from "./dealsAdapters.ndg";
import { LEGEND_ASSET_HOST } from "./dealsAdapters.legend";

/**
 * SUPPLIED SOURCE. Some builders refuse our reader (Legend Homes answers 403 to
 * any non-browser client). The reader never works around that. Instead the
 * owner's own browser agent visits the builder's public pages and posts what it
 * saw to POST /api/deals/import (dealsSuppliedImport.ts). The latest import per
 * community is stored, and the normal refresh (dealsSync refreshCommunity) turns
 * it into the same DealAdapterResult a reader returns, so holds, sold sweeps,
 * price history, incentive parsing and holds, scrubbing and e-mails behave
 * exactly as for a fetched page. Schema and rules: docs/builder-deals-supplied-import.md.
 */

/** An import captured longer ago than this holds the community instead of publishing. */
export const SUPPLIED_IMPORT_STALE_MS = 36 * 60 * 60_000;
/** A capturedAt further ahead of the server clock than this is refused. */
export const SUPPLIED_IMPORT_FUTURE_SKEW_MS = 10 * 60_000;
export const SUPPLIED_PRICE_MIN = 50_000;
export const SUPPLIED_PRICE_MAX = 5_000_000;
export const SUPPLIED_SQFT_MIN = 400;
export const SUPPLIED_SQFT_MAX = 15_000;
export const SUPPLIED_ROOMS_MIN = 1;
export const SUPPLIED_ROOMS_MAX = 10;
const MAX_HOMES = 500;
const MAX_PHOTOS = 40;

/**
 * Hosts a supplied home photo may come from besides the builder's site: the
 * builder's own image host, as its reader accepts it (Legend's photos sit on
 * assets.livelegendhomes.com). Anything else is not the builder's photo.
 */
export const SUPPLIED_PHOTO_HOSTS: Readonly<Record<string, readonly string[]>> = { "Legend Homes": [LEGEND_ASSET_HOST] };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const text = (max: number) => z.string().trim().min(1).max(max);

export const suppliedHomeSchema = z.strictObject({
  /** The home's own page on the builder's site (https, official host). */
  url: text(2048),
  /** As the page shows it: "1234 Example Way, New Braunfels, TX 78130". */
  address: text(255),
  plan: text(190).nullable().optional(),
  price: z.number().finite().nullable(),
  beds: z.number().finite().nullable().optional(),
  baths: z.number().finite().nullable().optional(),
  sqft: z.number().finite().nullable().optional(),
  status: z.enum(["available", "under_construction", "sold"]),
  /** "ready now", "Month YYYY" (e.g. "December 2026"), or null when the page gives none. */
  moveIn: z.string().trim().max(40).nullable().optional(),
  /** Optional photo links from the builder's own site or image host. */
  photos: z.array(text(2048)).max(MAX_PHOTOS).optional(),
});

export const suppliedCommunitySchema = z.strictObject({
  /** The community page as saved in Admin (official https URL). */
  communityUrl: text(2048),
  /** True only when every home card on the page was read (all pages, "load more" exhausted). */
  pageComplete: z.boolean(),
  /** The number of homes for sale the page itself shows (or the cards counted), sold homes excluded. */
  homesShownCount: z.number().int().min(0).max(MAX_HOMES),
  /** The page's offer text verbatim; null when the page shows no offer; omit when the offer was not looked at. */
  incentiveText: z.string().max(4000).nullable().optional(),
  homes: z.array(suppliedHomeSchema).max(MAX_HOMES),
});

export const suppliedImportSchema = z.strictObject({
  builder: text(80),
  capturedAt: z.string().datetime({ offset: true }),
  communities: z.array(suppliedCommunitySchema).min(1).max(50),
});

export type SuppliedHome = z.infer<typeof suppliedHomeSchema>;
export type SuppliedCommunity = z.infer<typeof suppliedCommunitySchema>;
export type SuppliedImport = z.infer<typeof suppliedImportSchema>;
/** What deal_supplied_imports keeps for one community. */
export type StoredSuppliedImport = { communityId: number; builder: string; capturedAt: Date; receivedAt: Date; community: SuppliedCommunity };

/** The comparison key for a community or home link: canonical source key, path in lower case (the builder's slugs are lower case). */
export function suppliedUrlKey(value: string): string {
  return normalizedDealSourceKey(value).toLowerCase();
}

/** The link as an https URL on the builder's official site, without fragment; null otherwise. */
export function officialSuppliedUrl(builder: string, value: string): URL | null {
  const host = officialHostFor(builder);
  const url = asUrl(value.trim());
  if (!host || !url || !sameOfficialHost(url, host)) return null;
  url.hash = "";
  return url;
}

type MoveIn = { kind: "ready" } | { kind: "month"; label: string; year: number; month: number } | { kind: "none" } | { kind: "invalid" };

function readMoveIn(value: string | null | undefined, now: Date): MoveIn {
  const raw = (value ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return { kind: "none" };
  if (/^ready now$/i.test(raw)) return { kind: "ready" };
  const match = /^([A-Za-z]+) (\d{4})$/.exec(raw);
  const month = match ? MONTHS.indexOf(match[1]!.toLowerCase()) + 1 : 0;
  const year = match ? Number(match[2]) : 0;
  const thisYear = now.getUTCFullYear();
  if (!month || year < thisYear - 1 || year > thisYear + 3) return { kind: "invalid" };
  return { kind: "month", label: `${MONTHS[month - 1]![0]!.toUpperCase()}${MONTHS[month - 1]!.slice(1)} ${year}`, year, month };
}

/** The status, ready-now flag and move-in month a reader would give this card (see ndgStatus). */
function statusOf(home: SuppliedHome, moveIn: MoveIn, now: Date): { status: string; readyNow: boolean; moveInDate: string | null } | null {
  if (home.status === "sold") return { status: "Sold", readyNow: false, moveInDate: null };
  if (moveIn.kind === "invalid") return null;
  if (moveIn.kind === "ready") return home.status === "available" ? { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null } : null;
  if (moveIn.kind === "none") return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  // An available home whose month has passed is ready now, as a reader treats a past availability date.
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  if (home.status === "available" && moveIn.year * 12 + moveIn.month - 1 < current) return { status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null };
  // An under-construction home whose month has passed carries a stale estimate: no date, as a reader treats one.
  if (moveIn.year * 12 + moveIn.month - 1 < current) return { status: "Quick Move-In", readyNow: false, moveInDate: null };
  return { status: `Quick Move-In (${moveIn.label})`, readyNow: false, moveInDate: moveIn.label };
}

const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

export type SuppliedCheck = {
  /** Catalog hold reasons; empty when the import can be published. */
  reasons: DealHoldReason[];
  /** One line per problem for the agent's response and the admin, naming the home by its position only. */
  problems: string[];
  homes: PrivatePlanOrHome[];
};

/**
 * Every rule a stored import must pass before anything is published or swept to sold:
 * fresh (36 hours), complete (page read whole and the home count matches the page's own),
 * every home on the builder's site with a street address, figures inside the sanity
 * bounds, no home twice. Any failure holds the whole community; nothing from it is used.
 */
export function checkSuppliedCommunity(builder: string, stored: Pick<StoredSuppliedImport, "capturedAt" | "community">, now: Date): SuppliedCheck {
  const reasons = new Set<DealHoldReason>();
  const problems: string[] = [];
  const homes: PrivatePlanOrHome[] = [];
  const community = stored.community;
  const age = now.getTime() - stored.capturedAt.getTime();
  if (age > SUPPLIED_IMPORT_STALE_MS) { reasons.add("supplied_import_stale"); problems.push(`captured ${Math.floor(age / 3_600_000)} hours ago (more than 36)`); }
  if (age < -SUPPLIED_IMPORT_FUTURE_SKEW_MS) { reasons.add("supplied_import_stale"); problems.push("captured in the future"); }
  if (!community.pageComplete) { reasons.add("supplied_import_incomplete"); problems.push("pageComplete is false"); }
  const forSale = community.homes.filter((home) => home.status !== "sold").length;
  if (forSale !== community.homesShownCount) { reasons.add("supplied_import_incomplete"); problems.push(`${forSale} homes for sale sent, the page shows ${community.homesShownCount}`); }
  const urls = new Map<string, number>();
  const addresses = new Map<string, number>();
  const photoHosts = SUPPLIED_PHOTO_HOSTS[builder] ?? [];
  community.homes.forEach((home, index) => {
    const at = `homes[${index}]`;
    const bad = (reason: DealHoldReason, problem: string) => { reasons.add(reason); problems.push(`${at}: ${problem}`); };
    const url = officialSuppliedUrl(builder, home.url);
    if (!url) bad("supplied_import_invalid_home", "url is not an https link on the builder's site");
    else if (suppliedUrlKey(url.toString()) === suppliedUrlKey(community.communityUrl)) bad("supplied_import_invalid_home", "url is the community page, not the home's page");
    // A home's page sits under its community's page (Legend: <community>/quick-move-in-homes/<home>); a card linking under
    // another community (a "nearby homes" strip) is never this community's home, as a reader holds such a home.
    else if (!suppliedUrlKey(url.toString()).startsWith(`${suppliedUrlKey(community.communityUrl)}/`)) bad("supplied_import_invalid_home", "url is not under this community's page");
    if (!looksLikeStreetAddress(home.address.split(",")[0])) bad("supplied_import_invalid_home", "address does not start with a house number and street");
    if (home.price !== null && !(Number.isInteger(home.price) && inRange(home.price, SUPPLIED_PRICE_MIN, SUPPLIED_PRICE_MAX))) bad("supplied_import_out_of_bounds", `price ${home.price} is outside ${SUPPLIED_PRICE_MIN.toLocaleString("en-US")}-${SUPPLIED_PRICE_MAX.toLocaleString("en-US")}`);
    if (home.beds != null && !(Number.isInteger(home.beds) && inRange(home.beds, SUPPLIED_ROOMS_MIN, SUPPLIED_ROOMS_MAX))) bad("supplied_import_out_of_bounds", `beds ${home.beds} is outside 1-10`);
    if (home.baths != null && !(Number.isInteger(home.baths * 2) && inRange(home.baths, SUPPLIED_ROOMS_MIN, SUPPLIED_ROOMS_MAX))) bad("supplied_import_out_of_bounds", `baths ${home.baths} is outside 1-10 in steps of 0.5`);
    if (home.sqft != null && !(Number.isInteger(home.sqft) && inRange(home.sqft, SUPPLIED_SQFT_MIN, SUPPLIED_SQFT_MAX))) bad("supplied_import_out_of_bounds", `sqft ${home.sqft} is outside ${SUPPLIED_SQFT_MIN}-${SUPPLIED_SQFT_MAX.toLocaleString("en-US")}`);
    const moveIn = readMoveIn(home.moveIn, now);
    const status = statusOf(home, moveIn, now);
    if (!status) bad("supplied_import_invalid_home", moveIn.kind === "invalid" ? "moveIn is not \"ready now\" or \"Month YYYY\"" : "an under-construction home cannot be \"ready now\"");
    const gallery: PrivateGalleryImage[] = [];
    (home.photos ?? []).forEach((link, photoIndex) => {
      const photo = asUrl(link.trim());
      const host = photo?.hostname.toLowerCase();
      if (!photo || photo.protocol !== "https:" || photo.port || photo.username || photo.password || !host || (host !== officialHostFor(builder) && !photoHosts.includes(host))) { bad("supplied_import_invalid_home", `photos[${photoIndex}] is not on the builder's site or image host`); return; }
      photo.hash = "";
      photo.search = "";
      if (!gallery.some((image) => image.sourceUrl === photo.toString())) gallery.push({ sourceUrl: photo.toString(), caption: null, width: null, height: null, srcSet: null });
    });
    if (url) {
      const key = suppliedUrlKey(url.toString());
      if (urls.has(key)) bad("supplied_import_duplicate_home", `same url as homes[${urls.get(key)}]`);
      else urls.set(key, index);
    }
    const addressKey = normalizedText(home.address.split(",")[0]!);
    if (addresses.has(addressKey)) bad("supplied_import_duplicate_home", `same address as homes[${addresses.get(addressKey)}]`);
    else addresses.set(addressKey, index);
    if (!url || !status) return;
    // The builder's slugs are lower case: one home is one link whatever case the agent copied it in.
    url.pathname = url.pathname.toLowerCase();
    const street = home.address.split(",")[0]!.trim();
    homes.push({
      sourceUrl: url.toString(),
      privateName: street,
      privateAddress: home.address.trim(),
      privatePlanName: home.plan?.trim() || null,
      status: status.status,
      price: home.price,
      bedrooms: home.beds ?? null,
      bathrooms: home.baths ?? null,
      squareFeet: home.sqft ?? null,
      readyNow: status.readyNow,
      moveInDate: status.moveInDate,
      gallery,
    });
  });
  return { reasons: Array.from(reasons), problems, homes };
}

/**
 * The stored import as a reader's result for this community. No import (or one
 * filed under another page) and every failed rule are catalog holds: the last good
 * data stays live and nothing is swept to sold. The offer text is cleaned as the
 * builder's reader cleans it and parsed by parsePromotionalRate, unchanged.
 */
export function suppliedDealsSnapshot(config: CommunitySourceConfig, stored: StoredSuppliedImport | null, now: Date, previous: StoredSuppliedImport | null = null): DealAdapterResult {
  const privateSnapshot = emptyPrivate(config);
  const fetchedAt = (stored?.capturedAt ?? now).toISOString();
  if (!stored || suppliedUrlKey(stored.community.communityUrl) !== suppliedUrlKey(config.sourceUrl)) return failedResult(config, fetchedAt, privateSnapshot, ["supplied_import_missing"]);
  const check = checkSuppliedCommunity(config.builder, stored, now);
  if (check.reasons.length) return failedResult(config, fetchedAt, privateSnapshot, check.reasons);
  // "No homes for sale" would sweep every home of the community to sold on the agent's word alone: it is taken only when
  // the import before it, captured earlier, said the same (two separate visits agree); otherwise the community holds.
  const forSale = (item: StoredSuppliedImport) => item.community.homes.filter((home) => home.status !== "sold").length;
  if (forSale(stored) === 0 && !(previous && previous.capturedAt.getTime() < stored.capturedAt.getTime() && forSale(previous) === 0)) return failedResult(config, fetchedAt, privateSnapshot, ["supplied_import_incomplete"]);
  privateSnapshot.pages.push(sourcePage("community", config.sourceUrl, config.privateCommunityName));
  for (const home of check.homes) {
    privateSnapshot.homes.push(home);
    privateSnapshot.pages.push(sourcePage("home", home.sourceUrl, home.privateName));
  }
  const offer = stored.community.incentiveText;
  // Omitted: the agent did not look at the offer, so the last one is left to the lapse rule (as a reader that read no offer).
  if (offer !== undefined) {
    privateSnapshot.offerRead = true;
    const cleaned = offer === null ? "" : cleanOfferText(offer);
    if (cleaned) privateSnapshot.incentive = { sourceUrl: config.sourceUrl, text: cleaned, facts: parsePromotionalRate(cleaned) };
  }
  return successfulResult(fetchedAt, privateSnapshot, makePublicSnapshot(privateSnapshot, config));
}
