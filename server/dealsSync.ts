import { and, desc, eq, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { dealCommunities, dealHomePriceHistory, dealHomes, dealIncentives, dealJobRuns, dealPhotos, dealSyncDigestEntries } from "../drizzle/schema";
import { getDb } from "./db";
import { chicagoClock, chicagoDay, chicagoEndOfDay, getDealSettings, hashSecret } from "./dealsService";
import { builderScrubConfig, MAX_DETAIL_LIMIT, hasBuilderReader, htmlToText, loadOfficialDeals, mentionsTriggeringTerm, normalizeIncentiveText, publicTextResidue, toPublicSafeText, type BuilderId, type CommunitySourceConfig, type DealAdapterResult, type DealHoldReason, type PromotionalRateFacts, type HtmlFetcher } from "./dealsAdapters";
export { builderScrubConfig };
import { dealScrubTerms, emptyDealScrubConfig, mergeDealScrubConfig, normalizedDealSourceKey, normalizedText, scrubPrivateNames, type DealScrubConfig } from "../shared/deals";
import { applyScrubExclusions, parseStoredScrubList, serializeStoredScrubList } from "./dealsScrub";
import { AUTO_ACCEPTED_NO_DEADLINE, HELD_INCENTIVE_PUBLIC_LINE, autoAcceptedStatus, deadlineOnlyHold, isAutoAcceptedIncentive, unreadDateIn } from "../shared/dealsHeldIncentive";
import { processPendingDealPhotos } from "./dealsPhotos";
import { sendBuilderDealsEmail } from "./dealsEmail";
import { refreshCommunityGeography } from "./dealsMap";
import { suppliedDealsSnapshot } from "./dealsAdapters.supplied";
import { suppliedSourceFor } from "./dealsSuppliedStore";

type CommunityRow = typeof dealCommunities.$inferSelect;
type IncentiveRow = typeof dealIncentives.$inferSelect;

/**
 * Seed data only. Every refresh is driven by deal_communities rows; this list
 * exists so scripts/seed-deals.mts can create the two launch rows once.
 * Never import this module into client code.
 */
export const LAUNCH_DEALS = [
  {
    builder: "Chesmar" as const,
    privateName: "Sienna Lakes",
    sourceUrl: "https://www.chesmar.com/texas/san-antonio-new-homes/san-antonio/sienna-lakes/",
    privateAddress: "9010 Arroyo Grove, San Antonio, TX 78263",
    publicLabel: "Southeast San Antonio | Half-Acre Lots and Lakes",
    areaLabel: "Southeast San Antonio",
    schoolDistrict: "East Central ISD",
    lotSizes: "Half-acre lots",
    amenities: ["Walking trails", "Lakes"],
    fromPrice: 499990,
    reelCode: "sl1",
    scrubConfig: { builder: ["Chesmar", "Chesmar Homes"], lender: ["HomeAmerican", "HomeAmerican Mortgage", "HomeAmerican Mortgage Corporation"], community: ["Sienna Lakes"], plan: [], street: ["Arroyo Grove"], other: [] } satisfies DealScrubConfig,
  },
  {
    builder: "M/I Homes" as const,
    privateName: "Vista Gardens",
    sourceUrl: "https://www.mihomes.com/new-homes/texas/greater-san-antonio/southeast-san-antonio/vista-gardens",
    privateAddress: "8106 Onion Patch, San Antonio, TX 78263",
    publicLabel: "Southeast San Antonio | New Phase Now Selling",
    areaLabel: "Southeast San Antonio",
    schoolDistrict: "East Central ISD",
    lotSizes: "Half-acre homesites",
    amenities: ["Spacious homesites", "Access to Calaveras Lake", "Close to major roadways"],
    fromPrice: 354990,
    reelCode: "vg1",
    scrubConfig: { builder: ["M/I", "M/I Homes"], lender: ["M/I Financial", "M/I Financial, LLC"], community: ["Vista Gardens"], plan: [], street: ["Onion Patch", "Gardner Road", "Hanging Basket"], other: [] } satisfies DealScrubConfig,
  },
] as const;

/** Builder and lender aliases that every community of that builder must scrub. */

/**
 * Categorized private names for one community; a legacy flat array lands in
 * "other" after the known categories. Admin-excluded terms are removed here, so
 * every scrubber and residue check that starts from this config ignores them.
 */
export function storedScrubConfig(row: Pick<CommunityRow, "builder" | "privateName" | "scrubList">): DealScrubConfig {
  const stored = parseStoredScrubList(row.scrubList);
  const known = builderScrubConfig(row.builder);
  known.community.push(row.privateName);
  return applyScrubExclusions(mergeDealScrubConfig(known, stored.categories), stored.excludedTerms);
}

/** The admin's excluded-term list stored beside the categories (false positives such as a discovered page heading). */
export function storedExcludedScrubTerms(row: Pick<CommunityRow, "scrubList">): string[] {
  return parseStoredScrubList(row.scrubList).excludedTerms;
}

async function upsertCommunity(config: (typeof LAUNCH_DEALS)[number]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = (await db.select().from(dealCommunities).where(eq(dealCommunities.reelCode, config.reelCode)).limit(1))[0];
  // These source fields already live in deal_communities. Preserve an existing
  // reviewed row instead of overwriting database configuration on every seed.
  if (existing) return existing.id;
  const result = await db.insert(dealCommunities).values({
    builder: config.builder,
    privateName: config.privateName,
    sourceUrl: config.sourceUrl,
    privateAddress: config.privateAddress,
    publicLabel: config.publicLabel,
    areaLabel: config.areaLabel,
    schoolDistrict: config.schoolDistrict,
    lotSizes: config.lotSizes,
    amenities: JSON.stringify(config.amenities),
    fromPrice: config.fromPrice,
    reelCode: config.reelCode,
    scrubList: JSON.stringify(mergeDealScrubConfig(builderScrubConfig(config.builder), config.scrubConfig)),
    active: true,
  });
  const id = Number((result as unknown as [{ insertId: number }])[0].insertId);
  await refreshCommunityGeography(id).catch(() => null);
  return id;
}

function storedPrice(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : null;
}

function isOfficialBuilder(value: string): value is Exclude<BuilderId, "Manual"> {
  return hasBuilderReader(value);
}

/** Adapter configuration built from the row itself; LAUNCH_DEALS plays no part here. */
export function communitySourceConfig(community: CommunityRow): CommunitySourceConfig | null {
  if (!isOfficialBuilder(community.builder) || !community.sourceUrl.trim() || !community.privateName.trim()) return null;
  const scrubConfig = storedScrubConfig(community);
  return {
    builder: community.builder,
    sourceUrl: community.sourceUrl,
    privateCommunityName: community.privateName,
    scrubList: dealScrubTerms(scrubConfig),
    scrubConfig,
    excludedTerms: storedExcludedScrubTerms(community),
    // The safety cap only: an inventory above it is held, never truncated.
    maxDetailPages: MAX_DETAIL_LIMIT,
  };
}

type HomeUpsertInput = { communityId: number; sourceUrl: string; privatePlanName?: string | null; privateAddress?: string | null; kind: "quick_move_in" | "to_be_built"; beds?: string | null; baths?: string | null; sqft?: number | null; price?: number | null; moveInDate?: string | null; lotSize?: string | null; garage?: string | null; homesite?: string | null; readyNow?: boolean; status?: "available" | "sold" };
type HomeUpsertResult = { id: number; inserted: boolean; skipped: boolean; priceChange: { from: number; to: number } | null; statusChange: { from: string; to: string } | null };

const PRICE_WINDOW_MS = 30 * 24 * 60 * 60_000;

/**
 * Keyed by the builder's listing URL so updates change the record in place.
 * Every observed price is written to deal_home_price_history; previousPrice is
 * derived only from that history (never from a card's strike-through price).
 */
async function upsertHome(input: HomeUpsertInput, now = new Date()): Promise<HomeUpsertResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const sourceUrl = normalizedDealSourceKey(input.sourceUrl);
  const sourceKey = hashSecret(sourceUrl);
  // Let raw historical rows converge to the canonical key once, preserving
  // their existing record and price history instead of creating a duplicate.
  const legacySourceKey = hashSecret(input.sourceUrl);
  const existing =
    (await db.select().from(dealHomes).where(eq(dealHomes.sourceKey, sourceKey)).limit(1))[0] ??
    (legacySourceKey === sourceKey ? undefined : (await db.select().from(dealHomes).where(eq(dealHomes.sourceKey, legacySourceKey)).limit(1))[0]);
  const incomingPrice = storedPrice(input.price);
  const status = input.status ?? "available";
  const { status: _status, ...fields } = input;
  if (!existing) {
    const result = await db.insert(dealHomes).values({ ...fields, sourceUrl, sourceKey, price: incomingPrice, previousPrice: null, status, origin: "official" });
    const id = Number((result as unknown as [{ insertId: number }])[0].insertId);
    if (incomingPrice !== null) await db.insert(dealHomePriceHistory).values({ homeId: id, price: incomingPrice, observedAt: now });
    return { id, inserted: true, skipped: false, priceChange: null, statusChange: null };
  }
  // Admin-maintained rows are never rewritten by an official refresh.
  if (existing.origin === "manual") return { id: existing.id, inserted: false, skipped: true, priceChange: null, statusChange: null };
  // A failed or incomplete card parse must never erase a good price.
  const price = incomingPrice ?? existing.price;
  let priceChange: HomeUpsertResult["priceChange"] = null;
  if (incomingPrice !== null && existing.price !== null && incomingPrice !== existing.price) {
    // The old price was in effect until this observation, so it is recorded as
    // observed now before the new price; the 30-day high then covers a drop
    // from a long-standing price, which is what the Price drop badge is for.
    await db.insert(dealHomePriceHistory).values({ homeId: existing.id, price: existing.price, observedAt: now });
    await db.insert(dealHomePriceHistory).values({ homeId: existing.id, price: incomingPrice, observedAt: now });
    priceChange = { from: existing.price, to: incomingPrice };
  } else if (incomingPrice !== null && existing.price === null) {
    await db.insert(dealHomePriceHistory).values({ homeId: existing.id, price: incomingPrice, observedAt: now });
  }
  let previousPrice = existing.previousPrice;
  if (price !== null) {
    const history = await db.select({ price: dealHomePriceHistory.price }).from(dealHomePriceHistory)
      .where(and(eq(dealHomePriceHistory.homeId, existing.id), gte(dealHomePriceHistory.observedAt, new Date(now.getTime() - PRICE_WINDOW_MS))));
    const candidates = history.map((row) => storedPrice(row.price)).filter((value): value is number => value !== null);
    const high = candidates.length ? Math.max(...candidates) : null;
    previousPrice = high !== null && high > price ? high : null;
  }
  // Admin-hidden rows stay hidden; sold rows that reappear become available in place.
  const nextStatus = existing.status === "hidden" ? "hidden" : status;
  const statusChange = nextStatus !== existing.status ? { from: existing.status, to: nextStatus } : null;
  await db.update(dealHomes).set({ ...fields, sourceUrl, sourceKey, price, previousPrice, status: nextStatus, origin: "official" }).where(eq(dealHomes.id, existing.id));
  return { id: existing.id, inserted: false, skipped: false, priceChange, statusChange };
}

async function upsertPhotos(homeId: number, gallery: Array<{ sourceUrl: string }> | undefined) {
  if (!gallery?.length) return;
  const db = await getDb(); if (!db) return;
  for (let sortOrder = 0; sortOrder < gallery.length; sortOrder++) {
    const image = gallery[sortOrder];
    const sourceHash = hashSecret(image.sourceUrl);
    const existing = (await db.select({ id: dealPhotos.id }).from(dealPhotos).where(and(eq(dealPhotos.homeId, homeId), eq(dealPhotos.sourceHash, sourceHash))).limit(1))[0];
    if (existing) continue;
    const result = await db.insert(dealPhotos).values({
      homeId,
      sourceUrl: image.sourceUrl,
      sourceHash,
      sortOrder,
      processingState: "pending",
      nextProcessingAttemptAt: new Date(),
    });
    void result;
  }
  // The DB rows are the source of truth: the photo cron (every 5 minutes, in its
  // own request) processes them. No drain is kicked here, because this runs
  // inside the catalog request and image work beside the page reads is what
  // made the host answer 503.
}

/** Private, admin-only summary of what one refresh changed. */
export type CommunityChangeSummary = {
  communityId: number;
  privateName: string;
  builder: string;
  added: string[];
  sold: string[];
  reappeared: string[];
  priceChanges: Array<{ name: string; from: number; to: number }>;
  incentive: string[];
};

export type HoldNotice = { communityId: number; privateName: string; builder: string; kind: "catalog" | "incentive"; reason: string; detail?: string };

export type RefreshResult = { communityId: number; reelCode: string; ok: boolean; reason?: string; skipped?: string };

function emptySummary(community: CommunityRow): CommunityChangeSummary {
  return { communityId: community.id, privateName: community.privateName, builder: community.builder, added: [], sold: [], reappeared: [], priceChanges: [], incentive: [] };
}

function hasChanges(summary: CommunityChangeSummary): boolean {
  return summary.added.length + summary.sold.length + summary.reappeared.length + summary.priceChanges.length + summary.incentive.length > 0;
}

/** "catalog: ..." and "incentive: ..." in one admin-visible column; a dismissed catalog hold is not a hold. */
export function summarizeHolds(catalogHoldReason: string | null, incentiveHoldReason: string | null): string | null {
  const parts = [
    catalogHoldReason && !catalogHoldReason.startsWith("dismissed:") ? `catalog: ${catalogHoldReason}` : null,
    incentiveHoldReason ? `incentive: ${incentiveHoldReason}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join("; ") : null;
}

export function activeCatalogHold(row: Pick<CommunityRow, "catalogHoldReason">): string | null {
  return row.catalogHoldReason && !row.catalogHoldReason.startsWith("dismissed:") ? row.catalogHoldReason : null;
}

/** The e-mail line for a catalog hold the admin can only settle by hand. */
export const SOURCE_ACCESS_REFUSED_DETAIL = "The builder's site refused our reader (HTTP 401/403): the builder is blocking automated reads, and the reader will not work around that. A one-off challenge page can clear on its own; if it keeps happening, switch this community to Manual in Admin, Builder Deals.";

/** The e-mail line for each supplied-import hold (docs/builder-deals-supplied-import.md); the last good data stays live meanwhile. */
export const SUPPLIED_IMPORT_HOLD_DETAIL: Readonly<Record<string, string>> = {
  supplied_import_missing: "This builder takes its data from the owner's browser agent (an import key exists), and no import has arrived for this community yet. Check that the agent's daily run includes this community's page exactly as saved in Admin.",
  supplied_import_stale: "The browser agent's latest import for this community is more than 36 hours old, so it was not published. Check that the agent's daily run is still going and that it posts this community.",
  supplied_import_incomplete: "The browser agent's import for this community was partial (it said the page was not read whole, or it sent a different number of homes than the page shows), so nothing was published or marked sold. The next complete import clears it.",
  supplied_import_out_of_bounds: "The browser agent's import had a price, bed, bath or square-foot figure outside the sanity bounds, so nothing from this community was published. The import response lists the home and the figure.",
  supplied_import_invalid_home: "The browser agent's import had a home whose link is not on the builder's site, whose address is not a street address, or whose move-in wording could not be read, so nothing from this community was published.",
  supplied_import_duplicate_home: "The browser agent's import listed the same home twice (same link or address), so nothing from this community was published.",
};

/** The e-mail detail for a catalog hold: one line per reason that has one. */
function catalogHoldDetail(reason: string): string | undefined {
  const lines = reason.split(",").map((part) => part.trim()).map((part) => part === "source_access_refused" ? SOURCE_ACCESS_REFUSED_DETAIL : SUPPLIED_IMPORT_HOLD_DETAIL[part]).filter((line): line is string => Boolean(line));
  return lines.length ? Array.from(new Set(lines)).join(" ") : undefined;
}

async function recordCatalogHold(community: CommunityRow, reason: string, now: Date, holds: HoldNotice[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const stored = community.catalogHoldReason;
  const storedReason = stored?.replace(/^dismissed:/, "") ?? null;
  // The same parse result, held or dismissed, never produces a second email.
  if (storedReason === reason) return;
  await db.update(dealCommunities).set({ catalogHoldReason: reason, catalogHoldSeenAt: now, holdReason: summarizeHolds(reason, community.incentiveHoldReason) }).where(eq(dealCommunities.id, community.id));
  const detail = catalogHoldDetail(reason);
  holds.push({ communityId: community.id, privateName: community.privateName, builder: community.builder, kind: "catalog", reason, ...(detail ? { detail } : {}) });
}

/** Sets the community's incentive hold; a new hold is e-mailed unless `notify` is off (a hold that was e-mailed when it began). */
async function recordIncentiveHold(community: CommunityRow, reason: string | null, now: Date, holds: HoldNotice[], detail?: string, notify = true) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if ((community.incentiveHoldReason ?? null) === reason) return;
  const catalog = activeCatalogHold(community) ?? community.catalogHoldReason;
  await db.update(dealCommunities).set({ incentiveHoldReason: reason, incentiveHoldSeenAt: reason ? now : null, holdReason: summarizeHolds(catalog, reason) }).where(eq(dealCommunities.id, community.id));
  community.incentiveHoldReason = reason;
  if (reason && notify) holds.push({ communityId: community.id, privateName: community.privateName, builder: community.builder, kind: "incentive", reason, detail });
}

function isoDay(value: Date | null | undefined): string | null {
  return value ? chicagoDay(value) : null;
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

function dateFromIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return chicagoEndOfDay(year, month, day);
}

function scrapedIncentiveValues(facts: PromotionalRateFacts) {
  const contractBy = dateFromIso(facts.contractDeadline?.isoDate);
  const closeBy = dateFromIso(facts.closingDeadline?.isoDate);
  return {
    headlineRate: facts.promotionalRatePercent !== null ? `${facts.promotionalRatePercent}%` : null,
    followOnRate: facts.followOnRatePercent !== null ? `${facts.followOnRatePercent}%` : null,
    followOnPeriod: facts.followOnPeriod,
    apr: facts.aprPercent !== null ? `${facts.aprPercent}%` : null,
    loanType: facts.loanType,
    downPayment: facts.downPaymentPercent !== null ? `${facts.downPaymentPercent}% down payment` : null,
    repaymentTerms: facts.repaymentTermYears !== null ? `${facts.repaymentTermYears}-year fixed` : null,
    contractBy,
    closeBy,
    expiresAt: earliest(contractBy, closeBy),
  };
}

/** Admin-entered dates survive a text change only on the record they were set on. */
function manualDatesOf(row: IncentiveRow): string[] {
  return [
    row.contractBy && (row.contractByManual || row.manual) ? `contract-by ${isoDay(row.contractBy)}` : null,
    row.closeBy && (row.closeByManual || row.manual) ? `close-by ${isoDay(row.closeBy)}` : null,
  ].filter((value): value is string => Boolean(value));
}

/**
 * Whether a record that carries no acceptedAt was accepted by an admin before acceptance was recorded (migration 0021).
 * Only evidence the parser cannot produce counts, so a row an older parser published is never adopted with its guesses:
 * - text the admin edited: the published text is not the builder's text it is filed under, and carries no residue; or
 * - every reason this scrape gives is answered by a value the builder's text never states (an APR, a rate, a term the
 *   admin typed). A parser reads figures only from the text, so a figure the text does not state was typed.
 * A legacy Accept of a figure the text does state is held once more after deploy (one e-mail): no stored value can tell
 * it from an older parser's guess, and a guess must never be kept for good.
 */
export function acceptedBeforeRecorded(row: Pick<IncentiveRow, "publicText" | "normalizedText" | "apr" | "headlineRate" | "followOnRate" | "followOnPeriod" | "downPayment" | "repaymentTerms" | "loanType" | "contractBy" | "closeBy" | "contractByManual" | "closeByManual">, reasons: readonly string[]): boolean {
  const builderText = row.normalizedText;
  const edited = normalizedText(row.publicText) !== builderText && publicTextResidue(row.publicText) === null;
  const stated = new Set((builderText.match(/\d+(?:\.\d+)?/g) ?? []).map((figure) => String(Number(figure))));
  const typed = (value: string | null | undefined) => {
    const text = value?.trim();
    if (!text) return false;
    const figures = text.match(/\d+(?:\.\d+)?/g);
    if (figures) return figures.every((figure) => !stated.has(String(Number(figure))));
    return !` ${builderText} `.includes(` ${normalizedText(text)} `);
  };
  const answered = (reason: string): boolean => {
    switch (reason) {
      case "private_text_remaining": return edited;
      case "missing_apr": return typed(row.apr);
      case "missing_promotional_rate": return typed(row.headlineRate);
      case "missing_follow_on_rate": return typed(row.followOnRate);
      case "missing_follow_on_period": case "missing_promotional_period": return typed(row.followOnPeriod);
      case "missing_down_payment": return typed(row.downPayment);
      case "missing_repayment_term": return typed(row.repaymentTerms);
      case "missing_loan_type": return typed(row.loanType);
      case "missing_contract_deadline": return Boolean(row.contractBy && row.contractByManual);
      case "missing_closing_deadline": return Boolean(row.closeBy && row.closeByManual);
      default: return false;
    }
  };
  if (!reasons.length) return edited;
  return reasons.every(answered);
}

/**
 * INCENTIVE EXPIRY rules for one scrape. Same normalized text only re-confirms
 * (dates, manual fields and acceptance stay sticky); new text starts a new
 * record; unpublishable facts produce a held record that admin can accept; a
 * date-expired or dismissed record is never revived by the same text.
 */
async function applyScrapedIncentive(community: CommunityRow, snapshot: DealAdapterResult, config: CommunitySourceConfig, now: Date, summary: CommunityChangeSummary, holds: HoldNotice[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const scraped = snapshot.private.incentive;
  const rows = await db.select().from(dealIncentives).where(eq(dealIncentives.communityId, community.id)).orderBy(desc(dealIncentives.confirmedAt), desc(dealIncentives.id));
  type Tx = Pick<typeof db, "update">;
  // The two rules every successful read applies: a scraped promo the builder no longer shows is not live, and a held
  // text the builder no longer shows is retired (it can no longer be accepted). A manual override is the admin's and stays.
  const takeOffOthers = async (tx: Tx, keepId: number | null) => { for (const row of rows) if (row.active && !row.manual && row.id !== keepId) { await tx.update(dealIncentives).set({ active: false }).where(eq(dealIncentives.id, row.id)); row.active = false; } };
  const retireOtherHeld = async (tx: Tx, keepId: number | null) => { for (const row of rows) if (row.held && row.id !== keepId) { await tx.update(dealIncentives).set({ held: false, active: false, holdReason: "superseded" }).where(eq(dealIncentives.id, row.id)); row.held = false; row.holdReason = "superseded"; } };
  if (!scraped) {
    // A failed incentive fetch or a missing container is a hold: keep the last
    // good incentive (the lapse rule still applies) and say so once.
    if (snapshot.incentiveHoldReasons.length) { await recordIncentiveHold(community, snapshot.incentiveHoldReasons.join(", "), now, holds, "The official incentive page could not be read; the last good incentive stays until it lapses."); return; }
    // A reader that did not read the builder's offer source this run (one that never reads offers, a cached brand offer,
    // a closeout with no page) says nothing about the promo: the last one stays to the lapse rule.
    // The community's hold line is left as it is: a text held for Accept stays visible, and a fetch hold is not e-mailed again.
    if (!snapshot.private.offerRead) return;
    // The offer source was read and shows no incentive: the builder took the promo down. Scraped records come off at once
    // and a held one is retired; a manual override stays.
    const takenOff = rows.filter((row) => row.active && !row.manual);
    if (takenOff.length || rows.some((row) => row.held)) {
      await db.transaction(async (tx) => { await takeOffOthers(tx, null); await retireOtherHeld(tx, null); });
      if (takenOff.length) summary.incentive.push(`The builder's page no longer shows the incentive; it came off: "${takenOff[0]!.publicText.slice(0, 160)}"`);
    }
    await recordIncentiveHold(community, null, now, holds);
    return;
  }
  // The names this very run discovered (plan and street names from the pages) scrub the offer too: an offer that names a
  // home listed for the first time must not reach a buyer with that address on the run that first sees it.
  const categories = applyScrubExclusions(mergeDealScrubConfig(config.scrubConfig ?? storedScrubConfig(community), snapshot.private.discoveredScrubConfig ?? null), storedExcludedScrubTerms(community));
  const safeText = snapshot.incentiveHoldReasons.includes("private_text_remaining") ? null : toPublicSafeText(scraped.text, { ...config, scrubConfig: categories });
  // A held record needs reviewable text; residue is listed as a hold reason and
  // acceptance re-checks it, so this best-effort text never reaches a buyer.
  const publicText = safeText ?? scrubPrivateNames(htmlToText(scraped.text), categories);
  const norm = normalizedText(publicText);
  const facts = scraped.facts;
  const fingerprint = hashSecret(norm).slice(0, 8);
  const reasons: string[] = [...facts.holdReasons];
  if (!safeText) reasons.push("private_text_remaining");
  const activeRows = rows.filter((row) => row.active);
  const activeManual = activeRows.find((row) => row.manual) ?? null;
  const same = rows.find((row) => row.normalizedText === norm) ?? null;
  const holdString = (list: readonly string[]) => `${Array.from(new Set(list)).sort().join(", ")} (text ${fingerprint})`;
  // Deadline-only holds publish by themselves (owner's decision, 2026-10-21): the text names a deadline the parser could
  // not read as a date and carries no other date-like phrase, so it is published as an admin's Accept with "no deadline in
  // the text" would publish it, and follows the undated lapse rule. A date the parser could not read keeps it held, and
  // nothing is published by itself while a manual override is live.
  const unreadDate = unreadDateIn(normalizeIncentiveText(scraped.text), [facts.contractDeadline, facts.closingDeadline]);
  // A payment, down payment or term stated without an APR (Reg Z 1026.24(d)) is never published by itself either: the
  // parser checks those only beside a rate, so this read is made here for any offer.
  const undisclosedTerms = facts.aprPercent === null && mentionsTriggeringTerm(scraped.text);
  const autoAcceptable = (list: readonly string[]) => deadlineOnlyHold(list) && unreadDate === null && !undisclosedTerms && !activeManual;
  /** The e-mail detail of a held text: what buyers see meanwhile (the manual override, or the neutral line), and the Accept is optional. */
  const heldDetail = (list: readonly string[], text: string) => [
    deadlineOnlyHold(list) && unreadDate !== null ? `The text names a deadline with a date the reader could not read ("${unreadDate.slice(0, 40)}"), so it was not published by itself.` : null,
    deadlineOnlyHold(list) && undisclosedTerms ? "The text states a payment, down payment or loan term without an APR, so it was not published by itself." : null,
    activeManual
      ? "Buyers keep seeing the manual override; Accept this update in Admin is optional."
      : `Buyers see "${HELD_INCENTIVE_PUBLIC_LINE}" for this community until it is reviewed; Accept this update in Admin is optional and publishes the full offer.`,
    `Held text: "${text.slice(0, 400)}"`,
  ].filter(Boolean).join(" ");
  const autoLine = (text: string, dates: { contractBy: Date | null; closeBy: Date | null }) => `${autoAcceptedStatus(dates)}: "${text.slice(0, 160)}"`;
  /** Admin-entered dates on another live record that this text would take off: like a new text, it then waits for the admin. */
  const droppedDatesBeside = (keepId: number | null) => activeRows.filter((row) => row.id !== keepId).flatMap(manualDatesOf);
  /** This read's dates for a scraped record, keeping any date an admin set on it; expiresAt follows them. */
  const datesFor = (row: Pick<IncentiveRow, "contractBy" | "closeBy" | "contractByManual" | "closeByManual">) => {
    const scrapedDates = scrapedIncentiveValues(facts);
    const contractBy = row.contractByManual ? row.contractBy : scrapedDates.contractBy;
    const closeBy = row.closeByManual ? row.closeBy : scrapedDates.closeBy;
    return { contractBy, closeBy, expiresAt: earliest(contractBy, closeBy) };
  };

  if (same) {
    // An admin's acceptance (or save) and a manual override are sticky for this builder text: the sync never re-judges them.
    const adminOwned = same.manual || Boolean(same.acceptedAt);
    const unique = Array.from(new Set(reasons));
    /** This text goes (back) on hold. A text that was held before (and retired when the builder moved on) was e-mailed then: no second e-mail. */
    const holdSame = async (message: string, notify: boolean, list: readonly string[] = unique, prefix?: string) => {
      await db.transaction(async (tx) => {
        await takeOffOthers(tx, same.id);
        await retireOtherHeld(tx, same.id);
        await tx.update(dealIncentives).set({ held: true, active: false, holdReason: JSON.stringify(list), confirmedAt: now }).where(eq(dealIncentives.id, same.id));
      });
      summary.incentive.push(`${message} (${list.join(", ")}): "${publicText.slice(0, 160)}"`);
      await recordIncentiveHold(community, holdString(list), now, holds, [prefix, heldDetail(list, publicText)].filter(Boolean).join(" "), notify);
    };
    /** A record an admin accepted before acceptance was recorded is marked accepted now and goes (back) live as the admin left it. */
    const adoptAccepted = async () => {
      await db.transaction(async (tx) => {
        await takeOffOthers(tx, same.id);
        await retireOtherHeld(tx, same.id);
        await tx.update(dealIncentives).set({ acceptedAt: same.updatedAt ?? now, active: true, held: false, holdReason: null, confirmedAt: now }).where(eq(dealIncentives.id, same.id));
      });
      if (!same.active) summary.incentive.push(`Incentive returned as the admin accepted it: "${same.publicText.slice(0, 160)}"`);
      await recordIncentiveHold(community, null, now, holds);
    };
    if (!same.active && (same.holdReason === "expired" || same.holdReason === "dismissed")) {
      // Stays off until the scraped TEXT changes; the same promo never returns by itself. The builder shows it, so any other scraped promo is not live.
      const tookOff = activeRows.filter((row) => !row.manual);
      await db.transaction(async (tx) => { await takeOffOthers(tx, same.id); await retireOtherHeld(tx, same.id); });
      if (tookOff.length) summary.incentive.push(`The builder shows again an incentive that was ${same.holdReason}, so the live one came off and none shows: "${tookOff[0]!.publicText.slice(0, 160)}"`);
      await recordIncentiveHold(community, null, now, holds);
      return;
    }
    if (same.active) {
      // A record the sync published by itself is never taken for an admin's legacy Accept.
      if (!adminOwned && !isAutoAcceptedIncentive(same) && acceptedBeforeRecorded(same, unique)) { await adoptAccepted(); return; }
      // A scraped record published under earlier rules is judged again on every run: what this scrape cannot publish comes off and is held.
      if (!adminOwned && unique.length && !autoAcceptable(unique)) { await holdSame("Live incentive no longer passes the publication rules and is held", true); return; }
      // Same promo re-confirmed: confirmedAt moves; a scraped (not admin-owned) record takes this scrape's figures. Dates and admin values are sticky.
      const figures = adminOwned ? {} : (({ headlineRate, followOnRate, followOnPeriod, apr, loanType, downPayment, repaymentTerms }) => ({ headlineRate, followOnRate, followOnPeriod, apr, loanType, downPayment, repaymentTerms }))(scrapedIncentiveValues(facts));
      // A scraped record carries the deadline-only mark exactly while its reasons are deadline-only.
      const mark = adminOwned ? {} : { holdReason: unique.length ? AUTO_ACCEPTED_NO_DEADLINE : null };
      await db.transaction(async (tx) => {
        await takeOffOthers(tx, same.id);
        await retireOtherHeld(tx, same.id);
        await tx.update(dealIncentives).set({ confirmedAt: now, ...figures, ...mark }).where(eq(dealIncentives.id, same.id));
      });
      await recordIncentiveHold(community, null, now, holds);
      return;
    }
    if (same.held) {
      // Still awaiting "Accept this update". The builder shows this text, so another scraped promo that was live comes off and
      // another held text is retired; the community carries this text's hold (no new e-mail: it went out when the hold began).
      const storedReasons = (() => { try { const parsed: unknown = JSON.parse(same.holdReason ?? "[]"); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; } catch { return [] as string[]; } })();
      const tookOff = activeRows.filter((row) => !row.manual);
      // The held record takes this read's figures and reasons: a parser fix releases a record it no longer holds, and an Accept
      // works from what the builder's text says now. The two admin-side reasons are judged on the state now, not carried:
      // a manual override live beside it keeps it held (as the new-text path does), and so does an admin's date it replaced
      // while that date still runs (on a live record, or on the record this text took off); once the override is gone or
      // the admin's date has passed, the text is judged on its own reasons.
      const adminDateRuns = (row: IncentiveRow) => row.id !== same.id && !row.held && manualDatesOf(row).length > 0 && row.holdReason !== "dismissed" && row.holdReason !== "expired" && Boolean(row.expiresAt && row.expiresAt > now);
      const replacesAdminDate = droppedDatesBeside(same.id).length > 0 || (storedReasons.includes("replaces_manual_date") && rows.some(adminDateRuns));
      const nextReasons = Array.from(new Set([...unique, ...(replacesAdminDate ? ["replaces_manual_date"] : []), ...(activeManual && activeManual.id !== same.id ? ["differs_from_manual_override"] : [])]));
      const figures = (({ headlineRate, followOnRate, followOnPeriod, apr, loanType, downPayment, repaymentTerms }) => ({ headlineRate, followOnRate, followOnPeriod, apr, loanType, downPayment, repaymentTerms }))(scrapedIncentiveValues(facts));
      // Deadline-only reasons release it too, marked as published by the sync itself.
      const auto = nextReasons.length > 0 && autoAcceptable(nextReasons);
      const release = nextReasons.length === 0 || auto;
      // A released record takes this read's dates too (unless the admin set them), so it expires by them like any new record.
      const dates = release ? datesFor(same) : {};
      await db.transaction(async (tx) => {
        await takeOffOthers(tx, same.id);
        await retireOtherHeld(tx, same.id);
        await tx.update(dealIncentives).set({ confirmedAt: now, ...figures, ...dates, ...(release ? { held: false, active: true, holdReason: auto ? AUTO_ACCEPTED_NO_DEADLINE : null } : { holdReason: JSON.stringify(nextReasons) }) }).where(eq(dealIncentives.id, same.id));
      });
      if (tookOff.length) summary.incentive.push(`The builder shows the held incentive again; the live one came off: "${tookOff[0]!.publicText.slice(0, 160)}"`);
      if (release) {
        summary.incentive.push(auto ? autoLine(same.publicText, datesFor(same)) : `A held incentive now passes the publication rules and is live: "${same.publicText.slice(0, 160)}"`);
        await recordIncentiveHold(community, null, now, holds);
      } else await recordIncentiveHold(community, holdString(nextReasons), now, holds, heldDetail(nextReasons, same.publicText), false);
      return;
    }
    if (activeManual && activeManual.id !== same.id) {
      await db.transaction(async (tx) => {
        await retireOtherHeld(tx, same.id);
        await tx.update(dealIncentives).set({ held: true, active: false, holdReason: JSON.stringify(["differs_from_manual_override"]), confirmedAt: now }).where(eq(dealIncentives.id, same.id));
      });
      summary.incentive.push(`Scraped incentive differs from the manual override and is held: "${publicText.slice(0, 160)}"`);
      // A text that was held before (and retired when the builder moved on) was e-mailed then: no second e-mail.
      await recordIncentiveHold(community, holdString(["differs_from_manual_override"]), now, holds, `Manual override stays live: "${activeManual.publicText.slice(0, 160)}"`, same.holdReason !== "superseded");
      return;
    }
    // A superseded record was never published, and a lapsed or replaced scraped one was published under the rules of its
    // day: this scrape judges it again. An accepted one returns as the admin left it.
    if (!adminOwned && same.holdReason !== "superseded" && !isAutoAcceptedIncentive(same) && acceptedBeforeRecorded(same, unique)) { await adoptAccepted(); return; }
    // Returning would take off a live record that carries an admin's date: like a new text, it waits for the admin.
    const droppedDates = adminOwned ? [] : droppedDatesBeside(same.id);
    if (droppedDates.length) { await holdSame("Incentive text returned in place of a record with an admin's date and is held", true, Array.from(new Set([...unique, "replaces_manual_date"])), `Dropped manual date(s): ${droppedDates.join(", ")}.`); return; }
    if (!adminOwned && unique.length && !autoAcceptable(unique)) { await holdSame("Incentive text returned and is held", same.holdReason !== "superseded"); return; }
    // A lapsed (or replaced) record returns when a successful scrape confirms its text again; one held only for a deadline
    // the text does not date returns marked as published by the sync itself. A scraped record takes this read's figures and
    // dates (an older parser's figures never return beside this text); an admin's values and dates stay.
    const autoReturn = !adminOwned && unique.length > 0;
    const refreshed = adminOwned ? {} : { ...(({ headlineRate, followOnRate, followOnPeriod, apr, loanType, downPayment, repaymentTerms }) => ({ headlineRate, followOnRate, followOnPeriod, apr, loanType, downPayment, repaymentTerms }))(scrapedIncentiveValues(facts)), ...datesFor(same) };
    await db.transaction(async (tx) => {
      await takeOffOthers(tx, same.id);
      await retireOtherHeld(tx, same.id);
      await tx.update(dealIncentives).set({ active: true, held: false, holdReason: autoReturn ? AUTO_ACCEPTED_NO_DEADLINE : null, confirmedAt: now, ...refreshed }).where(eq(dealIncentives.id, same.id));
    });
    summary.incentive.push(autoReturn ? autoLine(publicText, datesFor(same)) : `Incentive returned after ${same.holdReason === "lapsed_unconfirmed" ? "lapsing" : "being replaced"}: "${publicText.slice(0, 160)}"`);
    await recordIncentiveHold(community, null, now, holds);
    return;
  }

  // New normalized text: a NEW record with no inherited dates. The previous scraped promo comes off and a held record
  // for text the builder no longer shows is retired rather than left pending.
  const droppedManualDates = activeRows.flatMap(manualDatesOf);
  if (droppedManualDates.length) reasons.push("replaces_manual_date");
  if (activeManual) reasons.push("differs_from_manual_override");
  const values = { communityId: community.id, normalizedText: norm, publicText, ...scrapedIncentiveValues(facts), confirmedAt: now, manual: false, contractByManual: false, closeByManual: false };
  const autoNew = reasons.length > 0 && autoAcceptable(Array.from(new Set(reasons)));
  if (reasons.length && !autoNew) {
    const unique = Array.from(new Set(reasons));
    await db.transaction(async (tx) => {
      await takeOffOthers(tx, null);
      await retireOtherHeld(tx, null);
      await tx.insert(dealIncentives).values({ ...values, active: false, held: true, holdReason: JSON.stringify(unique) });
    });
    summary.incentive.push(`New incentive text held (${unique.join(", ")}): "${publicText.slice(0, 160)}"`);
    const detail = [
      droppedManualDates.length ? `Dropped manual date(s): ${droppedManualDates.join(", ")}.` : null,
      activeManual ? `Manual override stays live: "${activeManual.publicText.slice(0, 160)}"` : null,
      heldDetail(unique, publicText),
    ].filter(Boolean).join(" ");
    await recordIncentiveHold(community, holdString(unique), now, holds, detail);
    return;
  }
  await db.transaction(async (tx) => {
    await takeOffOthers(tx, null);
    await retireOtherHeld(tx, null);
    await tx.insert(dealIncentives).values({ ...values, active: true, held: false, holdReason: autoNew ? AUTO_ACCEPTED_NO_DEADLINE : null });
  });
  summary.incentive.push(autoNew ? autoLine(publicText, values) : `New incentive published: "${publicText.slice(0, 160)}"`);
  await recordIncentiveHold(community, null, now, holds);
}

function publicFact(value: string | null, config: CommunitySourceConfig): string | null {
  if (!value) return null;
  return toPublicSafeText(value, config);
}

/** Facts from the official community page replace stored values only when present and clean. */
async function writeCommunityFacts(community: CommunityRow, snapshot: DealAdapterResult, config: CommunitySourceConfig) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const facts = snapshot.private.communityFacts;
  if (!facts) return;
  const patch: Partial<CommunityRow> = {};
  if (facts.fromPrice !== null && storedPrice(facts.fromPrice) !== null) patch.fromPrice = facts.fromPrice;
  const district = publicFact(facts.schoolDistrict, config);
  if (district) patch.schoolDistrict = district.slice(0, 120);
  const lots = publicFact(facts.lotSizes, config);
  if (lots) patch.lotSizes = lots.slice(0, 160);
  const amenities = facts.amenities.map((item) => publicFact(item, config)).filter((item): item is string => Boolean(item));
  if (amenities.length) patch.amenities = JSON.stringify(amenities.slice(0, 20));
  if (Object.keys(patch).length) await db.update(dealCommunities).set(patch).where(eq(dealCommunities.id, community.id));
}

/** Names found on this run join the private per-community list used by every scrub; admin-excluded terms never return and the exclusion list itself is kept. */
async function mergeDiscoveredNames(community: CommunityRow, snapshot: DealAdapterResult) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const excludedTerms = storedExcludedScrubTerms(community);
  const merged = applyScrubExclusions(mergeDealScrubConfig(storedScrubConfig(community), snapshot.private.discoveredScrubConfig ?? null), excludedTerms);
  const serialized = serializeStoredScrubList(merged, excludedTerms);
  if (serialized !== community.scrubList) await db.update(dealCommunities).set({ scrubList: serialized }).where(eq(dealCommunities.id, community.id));
}

/** Typed against the adapter's reason union so the three hold-reason listings cannot drift apart. */
const UNLABELLED_HOME_STATUS: DealHoldReason = "unlabelled_home_status";
const REFRESH_FAILED: DealHoldReason = "refresh_failed";

/** The reader threw: recorded as a catalog hold (one email, no silent retry loop); the last good data stays live. */
async function refreshFailed(community: CommunityRow, now: Date, holds: HoldNotice[], error: unknown): Promise<RefreshResult> {
  // Do not log the source URL: it is private metadata.
  console.error(`[deals-sync] community ${community.id} refresh failed`, error instanceof Error ? error.message : error);
  await recordCatalogHold(community, REFRESH_FAILED, now, holds).catch(() => undefined);
  return { communityId: community.id, reelCode: community.reelCode, ok: false, reason: REFRESH_FAILED };
}

/**
 * A fetcher that renews the builder lease as pages are read, so a long
 * community (150 Perry pages, each allowed 45 s and a retry) never looks dead
 * to another lane. At most one renewal a minute: the renewal is a DB write.
 */
export function leaseRenewingFetcher(heartbeat: (() => Promise<void>) | undefined, clock: () => number = Date.now, everyMs = 60_000): HtmlFetcher {
  let last = clock();
  return async (input, init) => {
    const response = await fetch(input, init);
    if (heartbeat && clock() - last >= everyMs) { last = clock(); await heartbeat().catch(() => undefined); }
    return response;
  };
}

async function refreshCommunity(community: CommunityRow, now: Date, summaries: CommunityChangeSummary[], holds: HoldNotice[], heartbeat?: () => Promise<void>): Promise<RefreshResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const base = { communityId: community.id, reelCode: community.reelCode };
  // A community discovery added is inactive until this first clean sync turns it on.
  if (!community.active && !community.awaitingFirstSync) return { ...base, ok: false, skipped: "inactive" };
  if (community.paused) return { ...base, ok: false, skipped: "paused" };
  if (community.manualMode || community.builder === "Manual") return { ...base, ok: false, skipped: "manual_mode" };
  // Discovered communities wait quietly (no hold, no email) until their builder has a reader.
  if (community.awaitingFirstSync && !hasBuilderReader(community.builder)) return { ...base, ok: false, skipped: "no_builder_reader" };
  await db.update(dealCommunities).set({ lastAttemptAt: now }).where(eq(dealCommunities.id, community.id));
  if (!community.zipCentroidLat || !community.zipCentroidLng) await refreshCommunityGeography(community.id).catch(() => null);
  const sourceConfig = communitySourceConfig(community);
  if (!sourceConfig) {
    await recordCatalogHold(community, "invalid_source_url", now, holds);
    return { ...base, ok: false, reason: "invalid_source_url" };
  }
  // A builder that takes imports (it has an import key) is never fetched: its latest stored import is read instead and
  // judged by the same rules below. If the import tables cannot be read, the community is read from the site as before.
  const supplied = await suppliedSourceFor(community.builder, community.id).catch((error) => {
    console.warn(`[deals-sync] community ${community.id} supplied-import lookup failed`, error instanceof Error ? error.message : error);
    return null;
  });
  const snapshot = supplied ? suppliedDealsSnapshot(sourceConfig, supplied.latest, now, supplied.previous) : await loadOfficialDeals(sourceConfig, heartbeat ? { fetcher: leaseRenewingFetcher(heartbeat) } : {});
  if (!snapshot.catalogOk) {
    const reason = snapshot.holdReasons.join(", ");
    await recordCatalogHold(community, reason, now, holds);
    return { ...base, ok: false, reason };
  }
  // A home card whose status could not be read is a layout change, not a sale.
  // Hold the whole run before anything is published or swept to sold; the last
  // good data stays live until admin dismisses the hold or the parse recovers.
  if (snapshot.private.homes.some((home) => home.status === null)) {
    await recordCatalogHold(community, UNLABELLED_HOME_STATUS, now, holds);
    return { ...base, ok: false, reason: UNLABELLED_HOME_STATUS };
  }
  const summary = emptySummary(community);
  const publishable = new Set<string>();
  const label = (item: { privateAddress?: string | null; privatePlanName?: string | null; privateName: string | null }) => item.privateAddress ?? item.privateName ?? item.privatePlanName ?? "unnamed";
  const record = (result: HomeUpsertResult, name: string) => {
    if (result.inserted) summary.added.push(name);
    if (result.priceChange) summary.priceChanges.push({ name, ...result.priceChange });
    if (result.statusChange?.to === "available" && result.statusChange.from === "sold") summary.reappeared.push(name);
    if (result.statusChange?.to === "sold") summary.sold.push(name);
  };
  for (const plan of snapshot.private.plans) {
    const result = await upsertHome({ communityId: community.id, sourceUrl: plan.sourceUrl, privatePlanName: plan.privatePlanName ?? plan.privateName, privateAddress: plan.privateAddress ?? null, kind: "to_be_built", beds: plan.bedrooms === null ? null : String(plan.bedrooms), baths: plan.bathrooms === null ? null : String(plan.bathrooms), sqft: plan.squareFeet, price: plan.price, moveInDate: plan.moveInDate ?? null, garage: plan.garage ? String(plan.garage) : null, homesite: plan.homesite ?? null, readyNow: plan.readyNow ?? false, status: "available" }, now);
    publishable.add(normalizedDealSourceKey(plan.sourceUrl));
    record(result, label(plan));
    await upsertPhotos(result.id, plan.gallery);
  }
  for (const home of snapshot.private.homes) {
    const sold = /sold/i.test(home.status ?? "");
    // Only publish a QMI when the official page explicitly labels it as such.
    const quickMoveIn = /quick\s+move|available\s+now/i.test(home.status ?? "");
    if (!sold && !quickMoveIn) continue; // A model or unlabeled card is treated as absent below.
    const result = await upsertHome({ communityId: community.id, sourceUrl: home.sourceUrl, privatePlanName: home.privatePlanName ?? home.privateName, privateAddress: home.privateAddress ?? null, kind: "quick_move_in", beds: home.bedrooms === null ? null : String(home.bedrooms), baths: home.bathrooms === null ? null : String(home.bathrooms), sqft: home.squareFeet, price: home.price, moveInDate: home.moveInDate ?? null, garage: home.garage ? String(home.garage) : null, homesite: home.homesite ?? null, readyNow: home.readyNow ?? false, status: sold ? "sold" : "available" }, now);
    if (!sold) publishable.add(normalizedDealSourceKey(home.sourceUrl));
    record(result, label(home));
    if (!sold) await upsertPhotos(result.id, home.gallery);
  }
  // A complete official snapshot (both kinds, both builders) proves absence:
  // official available rows not in it are sold. Hidden and manual rows never flip.
  const existingAvailable = await db.select().from(dealHomes).where(and(eq(dealHomes.communityId, community.id), eq(dealHomes.origin, "official"), eq(dealHomes.status, "available")));
  for (const missing of existingAvailable) {
    if (publishable.has(normalizedDealSourceKey(missing.sourceUrl))) continue;
    await db.update(dealHomes).set({ status: "sold" }).where(eq(dealHomes.id, missing.id));
    summary.sold.push(missing.privateAddress ?? missing.privatePlanName ?? `home ${missing.id}`);
  }
  await writeCommunityFacts(community, snapshot, sourceConfig);
  // The discovered names are stored before the offer is judged, so the stored list is the one the offer was scrubbed with.
  await mergeDiscoveredNames(community, snapshot);
  await applyScrapedIncentive(community, snapshot, sourceConfig, now, summary, holds);
  const incentiveHold = community.incentiveHoldReason;
  if (community.awaitingFirstSync) {
    // First clean pull of a discovered community: its headline now uses what the pull found, then it goes live.
    // Whether the label is still the generated one is judged on the row as it was before this pull's facts.
    const facts = snapshot.private.communityFacts;
    const { generatedLabelFor, relabelFromCentroid } = await import("./dealsOnboarding");
    const { lotAcres } = await import("../shared/dealsFeatured");
    await relabelFromCentroid(community.id, {
      acres: lotAcres(facts?.lotSizes ?? null, { field: true }),
      fromPrice: facts?.fromPrice ?? community.fromPrice,
      amenities: facts?.amenities ?? [],
      moveInReadyCount: snapshot.private.homes.filter((home) => /quick\s+move|available\s+now/i.test(home.status ?? "")).length,
    }, { labelUntouched: await (async () => {
      // Judged on the row as it is now, before this pull's facts: an admin may have rewritten the label while the pull ran.
      const current = (await db.select({ publicLabel: dealCommunities.publicLabel }).from(dealCommunities).where(eq(dealCommunities.id, community.id)).limit(1))[0];
      return (current?.publicLabel ?? community.publicLabel) === generatedLabelFor(community);
    })() });
  }
  await db.update(dealCommunities).set({ lastSuccessfulSyncAt: now, catalogUpdatedAt: now, catalogHoldReason: null, catalogHoldSeenAt: null, holdReason: summarizeHolds(null, incentiveHold) }).where(eq(dealCommunities.id, community.id));
  // Goes live only if it is still waiting: an admin who turned it on or off, paused it or
  // switched it to manual while this pull ran has the last word (those clear the wait).
  if (community.awaitingFirstSync) {
    await db.update(dealCommunities).set({ active: true, awaitingFirstSync: false })
      .where(and(eq(dealCommunities.id, community.id), eq(dealCommunities.awaitingFirstSync, true), eq(dealCommunities.paused, false), eq(dealCommunities.manualMode, false)));
  }
  if (hasChanges(summary)) summaries.push(summary);
  return { ...base, ok: true };
}

function money(value: number) {
  return `$${value.toLocaleString("en-US")}`;
}

type RunEmail = { category: string; subject: string; content: string };

function summaryBody(summaries: readonly CommunityChangeSummary[]): string {
  const lines = summaries.flatMap((summary) => [
    `${summary.privateName} (${summary.builder})`,
    ...summary.added.map((name) => `  added: ${name}`),
    ...summary.sold.map((name) => `  sold: ${name}`),
    ...summary.reappeared.map((name) => `  back on the market: ${name}`),
    ...summary.priceChanges.map((change) => `  price ${change.to < change.from ? "drop" : "change"}: ${change.name} ${money(change.from)} to ${money(change.to)}`),
    ...summary.incentive.map((line) => `  incentive: ${line}`),
    "",
  ]);
  return ["Official builder refresh summary.", "", ...lines, "Review in Admin, Builder Deals: /admin/deals"].join("\n");
}

function holdBody(holds: readonly HoldNotice[]): string {
  const lines = holds.flatMap((hold) => [`${hold.privateName} (${hold.builder}), ${hold.kind} hold: ${hold.reason}`, ...(hold.detail ? [`  ${hold.detail}`] : []), ""]);
  return ["A builder page could not be published. The last good data stays live.", "", ...lines, `Catalog holds offer Dismiss hold or Switch to Manual. A held incentive needs nothing from you: buyers see "${HELD_INCENTIVE_PUBLIC_LINE}" for that community until it is reviewed (or the manual override, where one is live), and Accept this update (optional) publishes the full offer. Offers held only for a deadline the text does not date are published by themselves. Admin, Builder Deals: /admin/deals`].join("\n");
}

/** One change-summary email and one hold email per run; a failure never fails the sync, and is reported as false. */
async function sendRunEmails(summaries: readonly CommunityChangeSummary[], holds: readonly HoldNotice[]): Promise<boolean> {
  const messages = composeRunEmails(summaries, holds);
  if (!messages.length) return true;
  let recipients: string[] = [];
  try { recipients = (await getDealSettings()).syncEmailRecipients; } catch { recipients = []; }
  let allSent = true;
  for (const message of messages) {
    const result = await sendBuilderDealsEmail({ ...message, recipients }).catch((error) => { console.error("[deals-sync] email failed", error instanceof Error ? error.message : error); return null; });
    if (!result || (typeof result === "object" && "ok" in result && (result as { ok?: boolean }).ok === false)) allSent = false;
  }
  return allSent;
}

function composeRunEmails(summaries: readonly CommunityChangeSummary[], holds: readonly HoldNotice[]): RunEmail[] {
  const messages: RunEmail[] = [];
  const send = (category: string, subject: string, content: string) => { messages.push({ category, subject, content }); };
  // Changes and holds from one run travel in one email, so a send either happened or did not.
  if (summaries.length && holds.length) {
    const changes = summaries.reduce((count, summary) => count + summary.added.length + summary.sold.length + summary.reappeared.length + summary.priceChanges.length + summary.incentive.length, 0);
    // Filed under the hold category: a hold needs an admin's hand, a change only needs reading.
    send("deals_sync_hold", `Builder Deals update: ${changes} change${changes === 1 ? "" : "s"}, ${holds.length} hold${holds.length === 1 ? "" : "s"}`, [holdBody(holds), "", "CHANGES", "", summaryBody(summaries)].join("\n"));
    return messages;
  }
  if (summaries.length) {
    const total = summaries.reduce((count, summary) => count + summary.added.length + summary.sold.length + summary.reappeared.length + summary.priceChanges.length + summary.incentive.length, 0);
    send("deals_sync_summary", `Builder Deals update: ${total} change${total === 1 ? "" : "s"}`, summaryBody(summaries));
  }
  if (holds.length) {
    send("deals_sync_hold", `Builder Deals hold: ${holds.map((hold) => hold.privateName).join(", ")}`, holdBody(holds));
  }
  return messages;
}

/**
 * Read-only official refresh driven by deal_communities rows. Existing listings
 * are never erased on a parser error; the community is placed on hold for admin
 * review while the last good presentation stays intact.
 */
export async function refreshOfficialDeals(options: { communityId?: number; communityIds?: readonly number[]; now?: Date; heartbeat?: () => Promise<void> } = {}): Promise<RefreshResult[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = options.now ?? new Date();
  // A prior refresh may have ended between claiming and processing an image.
  // Drain a small bounded batch before doing network-heavy catalog work.
  void processPendingDealPhotos(5).catch((error) => console.warn("[deals-photo] retry queue drain failed", error));
  const wanted = options.communityId !== undefined ? [options.communityId] : options.communityIds ? [...options.communityIds] : null;
  if (wanted && !wanted.length) return [];
  const communities = wanted
    ? await db.select().from(dealCommunities).where(inArray(dealCommunities.id, wanted))
    : await db.select().from(dealCommunities).where(and(or(eq(dealCommunities.active, true), eq(dealCommunities.awaitingFirstSync, true)), eq(dealCommunities.paused, false), eq(dealCommunities.manualMode, false)));
  const results: RefreshResult[] = [];
  const summaries: CommunityChangeSummary[] = [];
  const holds: HoldNotice[] = [];
  for (const community of communities) {
    try {
      results.push(await refreshCommunity(community, now, summaries, holds, options.heartbeat));
    } catch (error) {
      results.push(await refreshFailed(community, now, holds, error));
    }
  }
  await sendRunEmails(summaries, holds);
  // Also make newly discovered records eligible without making catalog refresh
  // depend on OCR throughput. Each entry is atomically leased by the worker.
  void processPendingDealPhotos(10).catch((error) => console.warn("[deals-photo] retry queue drain failed", error));
  return results;
}

/** First launch uses a current read-only official refresh, never a saved capture. */
export async function seedLaunchDeals(): Promise<{ communities: number; homes: number; heldIncentives: number }> {
  for (const config of LAUNCH_DEALS) await upsertCommunity(config);
  await refreshOfficialDeals();
  const db = await getDb();
  const homes = db ? (await db.select({ id: dealHomes.id }).from(dealHomes)).length : 0;
  const heldIncentives = db ? (await db.select({ id: dealIncentives.id }).from(dealIncentives).where(eq(dealIncentives.held, true))).length : 0;
  return { communities: LAUNCH_DEALS.length, homes, heldIncentives };
}

function chicagoDayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, date) / 86_400_000);
}

/**
 * Calendar-day distance in America/Chicago: with the default of one day, a
 * community last pulled yesterday is due this morning (Admin: "Builder check
 * every N days"; 3 keeps the earlier every-third-day pace).
 */
export function communityRefreshDue(lastSuccessfulSyncAt: Date | null, now = new Date(), everyDays = 1): boolean {
  if (!lastSuccessfulSyncAt) return true;
  const days = Number.isInteger(everyDays) && everyDays >= 1 && everyDays <= 30 ? everyDays : 1;
  return chicagoDayNumber(chicagoDay(now)) - chicagoDayNumber(chicagoDay(lastSuccessfulSyncAt)) >= days;
}

/** Each scheduled batch stops starting new communities after this long, so one cron call stays short. */
export const CATALOG_BATCH_BUDGET_MS = 4 * 60_000;
/** Builders checked side by side; one builder's communities are always checked one at a time. */
export const CATALOG_BATCH_LANES = 2;
/** A failed (or still running) community is not tried again sooner than this. */
export const CATALOG_RETRY_GAP_MS = 90 * 60_000;
/** The morning summary goes out once nothing is left to check, or at this Chicago hour at the latest. */
const DIGEST_MORNING_DEADLINE_HOUR = 10;
/** Anything found after the morning summary (including what the 6:15 PM incentive job retires) goes out in one 7 PM follow-up. */
const DIGEST_EVENING_HOUR = 19;
const DIGEST_KEEP_DAYS = 30;

export type CatalogBatchResult = {
  checked: number;
  ok: number;
  failed: number;
  /** Due communities this batch did not reach (time budget or another batch had them). */
  remaining: number;
  stoppedForTime: boolean;
  digest: "sent" | "nothing_new" | "waiting";
  results: RefreshResult[];
};

type DueCandidate = CommunityRow;

/** Due today and not tried within the retry gap; communities whose builder has no reader yet are left out. */
function dueCandidates(rows: readonly CommunityRow[], now: Date, everyDays: number): DueCandidate[] {
  return rows.filter((community) => community.builder !== "Manual" && hasBuilderReader(community.builder)
    && communityRefreshDue(community.lastSuccessfulSyncAt, now, everyDays)
    && (!community.lastAttemptAt || now.getTime() - community.lastAttemptAt.getTime() >= CATALOG_RETRY_GAP_MS));
}

/**
 * Atomically takes a community for this batch, so two overlapping batches never
 * check it twice, and only while it is still checkable (an admin may have paused,
 * archived or switched it to manual since the batch listed it). Returns the row
 * as it is now.
 */
async function claimCommunity(communityId: number, at: Date): Promise<CommunityRow | null> {
  const db = await getDb();
  if (!db) return null;
  const claimed = await db.update(dealCommunities).set({ lastAttemptAt: at })
    .where(and(
      eq(dealCommunities.id, communityId),
      or(isNull(dealCommunities.lastAttemptAt), lt(dealCommunities.lastAttemptAt, new Date(at.getTime() - CATALOG_RETRY_GAP_MS))),
      or(eq(dealCommunities.active, true), eq(dealCommunities.awaitingFirstSync, true)),
      eq(dealCommunities.paused, false),
      eq(dealCommunities.manualMode, false),
    ));
  if (Number((claimed as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) !== 1) return null;
  return (await db.select().from(dealCommunities).where(eq(dealCommunities.id, communityId)).limit(1))[0] ?? null;
}

const BUILDER_LEASE_PREFIX = "builder-deals-lane-";
/** One lease row per builder, whatever the day (a lane may cross midnight). */
const BUILDER_LEASE_DAY = "lease";
/**
 * A lease not heartbeaten for this long belongs to a run that died; the next batch may take it. The holder
 * heartbeats between communities and at least once a minute while it fetches, so ten minutes of silence means
 * the process is gone (on the production host an instance that crashes or is recycled mid-batch never
 * releases its leases, and a two-hour window left those builders unread for two hours).
 */
export const BUILDER_LEASE_STALE_MS = 10 * 60_000;

export type BuilderLease = { release: () => Promise<void>; heartbeat: () => Promise<void> };

/**
 * One request stream per builder: a batch lane, "Refresh now" or discovery
 * holds the builder's lease while it reads that builder's pages. The lease
 * carries its holder's token, so only the holder can release or extend it, and
 * the (job, day) unique key on deal_job_runs settles two takers racing for it.
 * The holder heartbeats between communities; a lease without a heartbeat for
 * ten minutes is treated as dead.
 */
export async function leaseBuilder(builder: string, now = new Date()): Promise<BuilderLease | null> {
  const db = await getDb();
  if (!db) return null;
  const jobName = `${BUILDER_LEASE_PREFIX}${builder}`;
  const token = hashSecret(`lease:${builder}:${now.getTime()}:${Math.random()}`).slice(0, 24);
  const stale = new Date(now.getTime() - BUILDER_LEASE_STALE_MS);
  const existing = (await db.select().from(dealJobRuns).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, BUILDER_LEASE_DAY))).limit(1))[0];
  if (existing) {
    const taken = await db.update(dealJobRuns).set({ status: "running", startedAt: now, completedAt: null, detail: token })
      .where(and(eq(dealJobRuns.id, existing.id), or(ne(dealJobRuns.status, "running"), lt(dealJobRuns.startedAt, stale))));
    if (Number((taken as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) !== 1) return null;
  } else {
    try { await db.insert(dealJobRuns).values({ jobName, chicagoDay: BUILDER_LEASE_DAY, status: "running", startedAt: now, detail: token }); } catch { return null; }
  }
  const mine = and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, BUILDER_LEASE_DAY), eq(dealJobRuns.status, "running"), eq(dealJobRuns.detail, token));
  return {
    release: async () => {
      const connection = await getDb();
      if (!connection) return;
      await connection.update(dealJobRuns).set({ status: "ok", completedAt: new Date() }).where(mine).catch(() => undefined);
    },
    heartbeat: async () => {
      const connection = await getDb();
      if (!connection) return;
      await connection.update(dealJobRuns).set({ startedAt: new Date() }).where(mine).catch(() => undefined);
    },
  };
}

/** Builders some run is reading right now (a live lease), so their communities may still be in flight. */
export async function buildersInFlight(now = new Date()): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ jobName: dealJobRuns.jobName }).from(dealJobRuns)
    .where(and(eq(dealJobRuns.chicagoDay, BUILDER_LEASE_DAY), eq(dealJobRuns.status, "running"), gte(dealJobRuns.startedAt, new Date(now.getTime() - BUILDER_LEASE_STALE_MS))));
  return rows.flatMap((row) => row.jobName.startsWith(BUILDER_LEASE_PREFIX) ? [row.jobName.slice(BUILDER_LEASE_PREFIX.length)] : []);
}

/**
 * True while the catalog cron still has work in this slot: a community is due
 * and checkable now, or a builder is being read under a live lease. The photo
 * cron yields the catalog's slot only then, so the two never run their heavy
 * work side by side.
 */
export async function catalogBatchPending(now = new Date()): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  if ((await buildersInFlight(now)).length) return true;
  const { catalogRefreshDays } = await getDealSettings();
  const rows = await db.select().from(dealCommunities).where(and(or(eq(dealCommunities.active, true), eq(dealCommunities.awaitingFirstSync, true)), eq(dealCommunities.paused, false), eq(dealCommunities.manualMode, false)));
  return dueCandidates(rows, now, catalogRefreshDays).length > 0;
}

/** What one community's check found, written as its own digest entry the moment it finishes, so a restart loses nothing. */
async function recordDigestEntry(summaries: readonly CommunityChangeSummary[], holds: readonly HoldNotice[]) {
  if (!summaries.length && !holds.length) return;
  const db = await getDb();
  if (!db) return;
  await db.insert(dealSyncDigestEntries).values({ summaries: JSON.stringify(summaries), holds: JSON.stringify(holds) }).catch((error) => console.error("[deals-sync] digest entry failed", error instanceof Error ? error.message : error));
}

/**
 * The scheduled builder check, run every 10 minutes from 4 AM Central. Each
 * call checks the communities that are due (daily by default, Admin's
 * "Check each builder page every (days)"), several builders side by side, and
 * stops starting new ones after a few minutes; the next call picks up the rest.
 * Changes and new holds are collected into one morning summary email instead
 * of an email per batch.
 */
export async function refreshDueCommunitiesBatch(options: { clock?: () => number; budgetMs?: number; lanes?: number } = {}): Promise<CatalogBatchResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const clock = options.clock ?? (() => Date.now());
  const startedAt = clock();
  const deadline = startedAt + (options.budgetMs ?? CATALOG_BATCH_BUDGET_MS);
  const now = new Date(startedAt);
  const { catalogRefreshDays } = await getDealSettings();
  const rows = await db.select().from(dealCommunities).where(and(or(eq(dealCommunities.active, true), eq(dealCommunities.awaitingFirstSync, true)), eq(dealCommunities.paused, false), eq(dealCommunities.manualMode, false)));
  // Live communities first (oldest data first), then ones waiting for their first pull.
  const due = dueCandidates(rows, now, catalogRefreshDays).sort((a, b) =>
    Number(a.awaitingFirstSync) - Number(b.awaitingFirstSync)
    || (a.lastSuccessfulSyncAt?.getTime() ?? 0) - (b.lastSuccessfulSyncAt?.getTime() ?? 0)
    || a.id - b.id);
  const byBuilder = new Map<string, DueCandidate[]>();
  for (const community of due) byBuilder.set(community.builder, [...(byBuilder.get(community.builder) ?? []), community]);
  const lanesOfWork = Array.from(byBuilder.entries());
  const results: RefreshResult[] = [];
  let stoppedForTime = false;
  let next = 0;
  const lane = async () => {
    while (next < lanesOfWork.length) {
      const [builder, communities] = lanesOfWork[next++]!;
      // Another batch (or Refresh now) is already reading this builder: leave it to them.
      const lease = await leaseBuilder(builder, new Date(clock()));
      if (!lease) continue;
      const { release, heartbeat } = lease;
      try {
        for (const community of communities) {
          if (clock() >= deadline) { stoppedForTime = true; return; }
          const at = new Date(clock());
          const fresh = await claimCommunity(community.id, at);
          if (!fresh) continue;
          const summaries: CommunityChangeSummary[] = [];
          const holds: HoldNotice[] = [];
          try {
            results.push(await refreshCommunity(fresh, at, summaries, holds, heartbeat));
          } catch (error) {
            results.push(await refreshFailed(fresh, at, holds, error));
          }
          await recordDigestEntry(summaries, holds);
          await heartbeat();
        }
      } finally {
        await release();
      }
    }
  };
  // Photos are left to their own cron job: processing them here ran image work alongside the page reads in
  // the same request, and the host answered later calls with 503 after such batches.
  if (lanesOfWork.length) await Promise.all(Array.from({ length: Math.min(Math.max(1, options.lanes ?? CATALOG_BATCH_LANES), lanesOfWork.length) }, lane));
  const checkedIds = new Set(results.map((result) => result.communityId));
  const remaining = due.filter((community) => !checkedIds.has(community.id)).length;
  // Still to do today: due and not tried yet today (a failed one being retried later does not hold
  // the summary back), and nothing still being read by another run.
  const today = chicagoDay(now);
  const fresh = await db.select().from(dealCommunities).where(and(or(eq(dealCommunities.active, true), eq(dealCommunities.awaitingFirstSync, true)), eq(dealCommunities.paused, false), eq(dealCommunities.manualMode, false)));
  const untriedToday = dueCandidates(fresh, new Date(clock()), catalogRefreshDays).filter((community) => !community.lastAttemptAt || chicagoDay(community.lastAttemptAt) !== today).length;
  const inFlight = (await buildersInFlight(new Date(clock()))).length;
  const digest = await sendSyncDigestIfReady(new Date(clock()), untriedToday === 0 && inFlight === 0);
  return {
    checked: results.filter((result) => !result.skipped).length,
    ok: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok && !result.skipped).length,
    remaining,
    stoppedForTime,
    digest,
    results,
  };
}

/**
 * The refresh a supplied import triggers, awaited inside the import request (the
 * production host suspends work left running after a response). It takes the
 * builder's lease like a batch lane, so a batch never reads the same community at
 * the same time; when the lease stays busy past `leaseWaitMs` nothing is refreshed
 * and `processed` is false (the import is stored; the agent posts again). Each
 * community's changes and holds go into the digest, as a batch's do.
 */
export async function refreshSuppliedCommunities(builder: string, communityIds: readonly number[], options: { now?: Date; leaseWaitMs?: number; pollMs?: number } = {}): Promise<{ processed: boolean; results: RefreshResult[] }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (!communityIds.length) return { processed: true, results: [] };
  const waitUntil = Date.now() + (options.leaseWaitMs ?? 20_000);
  let lease = await leaseBuilder(builder, options.now ?? new Date());
  while (!lease && Date.now() < waitUntil) {
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 1_000));
    lease = await leaseBuilder(builder, options.now ?? new Date());
  }
  if (!lease) return { processed: false, results: [] };
  const results: RefreshResult[] = [];
  try {
    for (const id of communityIds) {
      const now = options.now ?? new Date();
      const row = (await db.select().from(dealCommunities).where(and(eq(dealCommunities.id, id), eq(dealCommunities.builder, builder))).limit(1))[0];
      if (!row) continue;
      const summaries: CommunityChangeSummary[] = [];
      const holds: HoldNotice[] = [];
      try {
        results.push(await refreshCommunity(row, now, summaries, holds, lease.heartbeat));
      } catch (error) {
        results.push(await refreshFailed(row, now, holds, error));
      }
      await recordDigestEntry(summaries, holds);
      await lease.heartbeat();
    }
  } finally {
    await lease.release();
  }
  return { processed: true, results };
}

/**
 * Claims a once-a-day digest slot; null when another batch has it or already
 * spent it. A slot whose send failed (status "failed") may be taken again, so
 * a bad email minute never loses a day's changes.
 */
async function claimDigestSlot(slot: "morning" | "evening", now: Date): Promise<{ done: (ok: boolean) => Promise<void> } | null> {
  const db = await getDb();
  if (!db) return null;
  const jobName = `builder-deals-sync-digest-${slot}`;
  const day = chicagoDay(now);
  const existing = (await db.select().from(dealJobRuns).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day))).limit(1))[0];
  if (existing) {
    const retaken = await db.update(dealJobRuns).set({ status: "running", startedAt: now, completedAt: null })
      .where(and(eq(dealJobRuns.id, existing.id), or(eq(dealJobRuns.status, "failed"), and(eq(dealJobRuns.status, "running"), lt(dealJobRuns.startedAt, new Date(now.getTime() - BUILDER_LEASE_STALE_MS))))));
    if (Number((retaken as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) !== 1) return null;
  } else {
    try {
      // The (job, day) unique key settles two batches racing for the same slot.
      await db.insert(dealJobRuns).values({ jobName, chicagoDay: day, status: "running", startedAt: now });
    } catch {
      return null;
    }
  }
  return {
    done: async (ok) => {
      const connection = await getDb();
      if (!connection) return;
      await connection.update(dealJobRuns).set({ status: ok ? "ok" : "failed", completedAt: new Date() }).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day))).catch(() => undefined);
    },
  };
}

/**
 * The morning summary goes out once every due community has been tried today
 * (or at 10 AM Central at the latest); the evening follow-up at 6 PM carries
 * anything found after it. Each entry is claimed before sending, so it goes
 * out once even when batches overlap.
 */
export async function sendSyncDigestIfReady(now: Date, allTriedToday: boolean): Promise<CatalogBatchResult["digest"]> {
  const db = await getDb();
  if (!db) return "waiting";
  await db.delete(dealSyncDigestEntries).where(lt(dealSyncDigestEntries.sentAt, new Date(now.getTime() - DIGEST_KEEP_DAYS * 86_400_000)));
  const { hour } = chicagoClock(now);
  const slot = hour >= DIGEST_EVENING_HOUR ? "evening" : allTriedToday || hour >= DIGEST_MORNING_DEADLINE_HOUR ? "morning" : null;
  if (!slot) return "waiting";
  const pending = await db.select({ id: dealSyncDigestEntries.id }).from(dealSyncDigestEntries).where(isNull(dealSyncDigestEntries.sentAt)).limit(1);
  // The evening follow-up only goes out when something new turned up; the morning slot is spent either way.
  if (slot === "evening" && !pending.length) return "nothing_new";
  const claim = await claimDigestSlot(slot, now);
  if (!claim) return pending.length ? "waiting" : "nothing_new";
  // Read the entries under the slot, send, and only then mark them sent: a failed send
  // releases the slot (status "failed") and the entries stay unsent for the next try.
  const unsent = await db.select().from(dealSyncDigestEntries).where(isNull(dealSyncDigestEntries.sentAt)).orderBy(dealSyncDigestEntries.id);
  if (!unsent.length) { await claim.done(true); return "nothing_new"; }
  const parse = <T,>(text: string): T[] => { try { const value: unknown = JSON.parse(text); return Array.isArray(value) ? value as T[] : []; } catch { return []; } };
  const sent = await sendRunEmails(unsent.flatMap((entry) => parse<CommunityChangeSummary>(entry.summaries)), unsent.flatMap((entry) => parse<HoldNotice>(entry.holds)));
  if (!sent) { await claim.done(false); return "waiting"; }
  await db.update(dealSyncDigestEntries).set({ sentAt: now }).where(inArray(dealSyncDigestEntries.id, unsent.map((entry) => entry.id)));
  await claim.done(true);
  return "sent";
}

/**
 * The evening incentive job is deliberately network-free. It retires an
 * expired dated offer or an undated offer that exceeds the configured lapse
 * period and emails once per retired record; the next catalog refresh is
 * responsible for discovering a current official promotion.
 */
export async function revalidateDealIncentives(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = await getDealSettings();
  const rows = await db.select().from(dealIncentives).where(eq(dealIncentives.active, true));
  const lapseBefore = now.getTime() - settings.incentiveLapseDays * 24 * 60 * 60_000;
  const stale = rows.filter((row) => (row.expiresAt && row.expiresAt <= now) || (!row.expiresAt && row.confirmedAt.getTime() <= lapseBefore));
  const retired: CommunityChangeSummary[] = [];
  for (const row of stale) {
    const expired = Boolean(row.expiresAt);
    await db.update(dealIncentives).set({ active: false, holdReason: expired ? "expired" : "lapsed_unconfirmed" }).where(eq(dealIncentives.id, row.id));
    const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, row.communityId)).limit(1))[0];
    await db.update(dealCommunities).set({ catalogUpdatedAt: now }).where(eq(dealCommunities.id, row.communityId));
    const name = community?.privateName ?? `community ${row.communityId}`;
    // Into the daily digest, not an email per incentive: a month end can retire dozens at once.
    retired.push({
      communityId: row.communityId, privateName: name, builder: community?.builder ?? "", added: [], sold: [], reappeared: [], priceChanges: [],
      incentive: [
        expired
          ? `came off the page: reached its ${row.contractBy && row.expiresAt && row.contractBy.getTime() === row.expiresAt.getTime() ? "contract-by" : "close-by"} date (${isoDay(row.expiresAt)})`
          : `came off the page: no dates and not re-confirmed for ${settings.incentiveLapseDays} days (last confirmed ${isoDay(row.confirmedAt)})`,
        `  "${row.publicText}"${row.manual ? " (manual override)" : ""}`,
      ],
    });
  }
  await recordDigestEntry(retired, []);
  return { ok: true as const, expired: stale.filter((row) => Boolean(row.expiresAt)).length, lapsed: stale.filter((row) => !row.expiresAt).length, checked: rows.length };
}
