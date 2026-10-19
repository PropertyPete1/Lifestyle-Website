import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { dealCommunities, dealHomePriceHistory, dealHomes, dealIncentives, dealPhotos } from "../drizzle/schema";
import { getDb } from "./db";
import { chicagoDay, chicagoEndOfDay, getDealSettings, hashSecret } from "./dealsService";
import { MAX_DETAIL_LIMIT, htmlToText, loadOfficialDeals, toPublicSafeText, type BuilderId, type CommunitySourceConfig, type DealAdapterResult, type PromotionalRateFacts } from "./dealsAdapters";
import { dealScrubTerms, emptyDealScrubConfig, mergeDealScrubConfig, normalizedDealSourceKey, normalizedText, parseDealScrubConfig, scrubPrivateNames, type DealScrubConfig } from "../shared/deals";
import { processPendingDealPhotos } from "./dealsPhotos";
import { sendBuilderDealsEmail } from "./dealsEmail";
import { refreshCommunityGeography } from "./dealsMap";

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
export function builderScrubConfig(builder: string): DealScrubConfig {
  const config = emptyDealScrubConfig();
  if (builder === "M/I Homes") { config.builder.push("M/I Homes", "M/I"); config.lender.push("M/I Financial, LLC", "M/I Financial"); }
  if (builder === "Chesmar") { config.builder.push("Chesmar Homes", "Chesmar"); config.lender.push("HomeAmerican Mortgage Corporation", "HomeAmerican Mortgage", "HomeAmerican", "HMC"); }
  return config;
}

/** Categorized private names for one community; a legacy flat array lands in "other" after the known categories. */
export function storedScrubConfig(row: Pick<CommunityRow, "builder" | "privateName" | "scrubList">): DealScrubConfig {
  let parsed: unknown = null;
  try { parsed = JSON.parse(row.scrubList); } catch { parsed = null; }
  const known = builderScrubConfig(row.builder);
  known.community.push(row.privateName);
  return mergeDealScrubConfig(known, parseDealScrubConfig(parsed));
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
  return value === "Chesmar" || value === "M/I Homes";
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
  // The DB rows are the source of truth. One guarded drain kick (max 2 photos in
  // flight) processes the new rows; a restart cannot lose them because the 10-minute
  // photo job and the sync drains pick up due pending records and expired leases.
  void processPendingDealPhotos(20).catch((error) => console.warn("[deals-photo] queue drain failed", error));
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

async function recordCatalogHold(community: CommunityRow, reason: string, now: Date, holds: HoldNotice[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const stored = community.catalogHoldReason;
  const storedReason = stored?.replace(/^dismissed:/, "") ?? null;
  // The same parse result, held or dismissed, never produces a second email.
  if (storedReason === reason) return;
  await db.update(dealCommunities).set({ catalogHoldReason: reason, catalogHoldSeenAt: now, holdReason: summarizeHolds(reason, community.incentiveHoldReason) }).where(eq(dealCommunities.id, community.id));
  holds.push({ communityId: community.id, privateName: community.privateName, builder: community.builder, kind: "catalog", reason });
}

async function recordIncentiveHold(community: CommunityRow, reason: string | null, now: Date, holds: HoldNotice[], detail?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if ((community.incentiveHoldReason ?? null) === reason) return;
  const catalog = activeCatalogHold(community) ?? community.catalogHoldReason;
  await db.update(dealCommunities).set({ incentiveHoldReason: reason, incentiveHoldSeenAt: reason ? now : null, holdReason: summarizeHolds(catalog, reason) }).where(eq(dealCommunities.id, community.id));
  community.incentiveHoldReason = reason;
  if (reason) holds.push({ communityId: community.id, privateName: community.privateName, builder: community.builder, kind: "incentive", reason, detail });
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
 * INCENTIVE EXPIRY rules for one scrape. Same normalized text only re-confirms
 * (dates, manual fields and acceptance stay sticky); new text starts a new
 * record; unpublishable facts produce a held record that admin can accept; a
 * date-expired or dismissed record is never revived by the same text.
 */
async function applyScrapedIncentive(community: CommunityRow, snapshot: DealAdapterResult, config: CommunitySourceConfig, now: Date, summary: CommunityChangeSummary, holds: HoldNotice[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const scraped = snapshot.private.incentive;
  if (!scraped) {
    // A failed incentive fetch or a missing container is a hold: keep the last
    // good incentive (the lapse rule still applies) and say so once. A page that
    // simply shows no incentive is not a hold; the lapse rule retires the old one.
    if (snapshot.incentiveHoldReasons.length) await recordIncentiveHold(community, snapshot.incentiveHoldReasons.join(", "), now, holds, "The official incentive page could not be read; the last good incentive stays until it lapses.");
    else await recordIncentiveHold(community, null, now, holds);
    return;
  }
  const categories = config.scrubConfig ?? storedScrubConfig(community);
  const safeText = toPublicSafeText(scraped.text, config);
  // A held record needs reviewable text; residue is listed as a hold reason and
  // acceptance re-checks it, so this best-effort text never reaches a buyer.
  const publicText = safeText ?? scrubPrivateNames(htmlToText(scraped.text), categories);
  const norm = normalizedText(publicText);
  const facts = scraped.facts;
  const fingerprint = hashSecret(norm).slice(0, 8);
  const reasons: string[] = [...facts.holdReasons];
  if (!safeText) reasons.push("private_text_remaining");
  const rows = await db.select().from(dealIncentives).where(eq(dealIncentives.communityId, community.id)).orderBy(desc(dealIncentives.confirmedAt), desc(dealIncentives.id));
  const activeRows = rows.filter((row) => row.active);
  const activeManual = activeRows.find((row) => row.manual) ?? null;
  const same = rows.find((row) => row.normalizedText === norm) ?? null;
  const holdString = (list: readonly string[]) => `${Array.from(new Set(list)).sort().join(", ")} (text ${fingerprint})`;

  if (same) {
    if (same.active) {
      // Same promo re-confirmed: only confirmedAt moves. Dates, manual fields and
      // accepted values are sticky for this text.
      await db.update(dealIncentives).set({ confirmedAt: now }).where(eq(dealIncentives.id, same.id));
      await recordIncentiveHold(community, null, now, holds);
      return;
    }
    if (same.holdReason === "expired" || same.holdReason === "dismissed") {
      // Stays off until the scraped TEXT changes; the same promo never returns by itself.
      await recordIncentiveHold(community, null, now, holds);
      return;
    }
    if (same.held) {
      await db.update(dealIncentives).set({ confirmedAt: now }).where(eq(dealIncentives.id, same.id));
      return; // Still awaiting "Accept this update"; the earlier email stands.
    }
    if (activeManual && activeManual.id !== same.id) {
      await db.update(dealIncentives).set({ held: true, active: false, holdReason: JSON.stringify(["differs_from_manual_override"]), confirmedAt: now }).where(eq(dealIncentives.id, same.id));
      summary.incentive.push(`Scraped incentive differs from the manual override and is held: "${publicText.slice(0, 160)}"`);
      await recordIncentiveHold(community, holdString(["differs_from_manual_override"]), now, holds, `Manual override stays live: "${activeManual.publicText.slice(0, 160)}"`);
      return;
    }
    // A lapsed (or superseded) record returns when a successful scrape confirms its text again.
    await db.transaction(async (tx) => {
      for (const row of activeRows) await tx.update(dealIncentives).set({ active: false }).where(eq(dealIncentives.id, row.id));
      await tx.update(dealIncentives).set({ active: true, held: false, holdReason: null, confirmedAt: now }).where(eq(dealIncentives.id, same.id));
    });
    summary.incentive.push(`Incentive returned after ${same.holdReason === "lapsed_unconfirmed" ? "lapsing" : "being replaced"}: "${publicText.slice(0, 160)}"`);
    await recordIncentiveHold(community, null, now, holds);
    return;
  }

  // New normalized text: a NEW record with no inherited dates. A held record
  // for text the builder no longer shows is retired rather than left pending.
  const staleHeld = rows.filter((row) => row.held && row.normalizedText !== norm);
  const retireStaleHeld = async (tx: Pick<typeof db, "update">) => {
    for (const row of staleHeld) await tx.update(dealIncentives).set({ held: false, active: false, holdReason: "superseded" }).where(eq(dealIncentives.id, row.id));
  };
  const droppedManualDates = activeRows.flatMap(manualDatesOf);
  if (droppedManualDates.length) reasons.push("replaces_manual_date");
  if (activeManual) reasons.push("differs_from_manual_override");
  const values = { communityId: community.id, normalizedText: norm, publicText, ...scrapedIncentiveValues(facts), confirmedAt: now, manual: false, contractByManual: false, closeByManual: false };
  if (reasons.length) {
    const unique = Array.from(new Set(reasons));
    await db.transaction(async (tx) => {
      // The builder no longer shows the previous promo, so a scraped record comes
      // off immediately; a manual override is the admin's decision and stays.
      for (const row of activeRows) if (!row.manual) await tx.update(dealIncentives).set({ active: false }).where(eq(dealIncentives.id, row.id));
      await retireStaleHeld(tx);
      await tx.insert(dealIncentives).values({ ...values, active: false, held: true, holdReason: JSON.stringify(unique) });
    });
    summary.incentive.push(`New incentive text held (${unique.join(", ")}): "${publicText.slice(0, 160)}"`);
    const detail = [
      droppedManualDates.length ? `Dropped manual date(s): ${droppedManualDates.join(", ")}.` : null,
      activeManual ? `Manual override stays live: "${activeManual.publicText.slice(0, 160)}"` : null,
      `Held text: "${publicText.slice(0, 400)}"`,
    ].filter(Boolean).join(" ");
    await recordIncentiveHold(community, holdString(unique), now, holds, detail);
    return;
  }
  await db.transaction(async (tx) => {
    for (const row of activeRows) await tx.update(dealIncentives).set({ active: false }).where(eq(dealIncentives.id, row.id));
    await retireStaleHeld(tx);
    await tx.insert(dealIncentives).values({ ...values, active: true, held: false, holdReason: null });
  });
  summary.incentive.push(`New incentive published: "${publicText.slice(0, 160)}"`);
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

/** Names found on this run join the private per-community list used by every scrub. */
async function mergeDiscoveredNames(community: CommunityRow, snapshot: DealAdapterResult) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const merged = mergeDealScrubConfig(storedScrubConfig(community), snapshot.private.discoveredScrubConfig ?? null);
  const serialized = JSON.stringify(merged);
  if (serialized !== community.scrubList) await db.update(dealCommunities).set({ scrubList: serialized }).where(eq(dealCommunities.id, community.id));
}

async function refreshCommunity(community: CommunityRow, now: Date, summaries: CommunityChangeSummary[], holds: HoldNotice[]): Promise<RefreshResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const base = { communityId: community.id, reelCode: community.reelCode };
  if (!community.active) return { ...base, ok: false, skipped: "inactive" };
  if (community.paused) return { ...base, ok: false, skipped: "paused" };
  if (community.manualMode || community.builder === "Manual") return { ...base, ok: false, skipped: "manual_mode" };
  await db.update(dealCommunities).set({ lastAttemptAt: now }).where(eq(dealCommunities.id, community.id));
  if (!community.zipCentroidLat || !community.zipCentroidLng) await refreshCommunityGeography(community.id).catch(() => null);
  const sourceConfig = communitySourceConfig(community);
  if (!sourceConfig) {
    await recordCatalogHold(community, "invalid_source_url", now, holds);
    return { ...base, ok: false, reason: "invalid_source_url" };
  }
  const snapshot = await loadOfficialDeals(sourceConfig);
  if (!snapshot.catalogOk) {
    const reason = snapshot.holdReasons.join(", ");
    await recordCatalogHold(community, reason, now, holds);
    return { ...base, ok: false, reason };
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
  await applyScrapedIncentive(community, snapshot, sourceConfig, now, summary, holds);
  await mergeDiscoveredNames(community, snapshot);
  const incentiveHold = community.incentiveHoldReason;
  await db.update(dealCommunities).set({ lastSuccessfulSyncAt: now, catalogUpdatedAt: now, catalogHoldReason: null, catalogHoldSeenAt: null, holdReason: summarizeHolds(null, incentiveHold) }).where(eq(dealCommunities.id, community.id));
  if (hasChanges(summary)) summaries.push(summary);
  return { ...base, ok: true };
}

function money(value: number) {
  return `$${value.toLocaleString("en-US")}`;
}

/** One change-summary email per run and one email for every new hold; failures never fail the sync. */
async function sendRunEmails(summaries: readonly CommunityChangeSummary[], holds: readonly HoldNotice[]) {
  if (!summaries.length && !holds.length) return;
  let recipients: string[] = [];
  try { recipients = (await getDealSettings()).syncEmailRecipients; } catch { recipients = []; }
  const send = (category: string, subject: string, content: string) =>
    sendBuilderDealsEmail({ category, recipients, subject, content }).catch((error) => console.error("[deals-sync] email failed", error instanceof Error ? error.message : error));
  if (summaries.length) {
    const lines = summaries.flatMap((summary) => [
      `${summary.privateName} (${summary.builder})`,
      ...summary.added.map((name) => `  added: ${name}`),
      ...summary.sold.map((name) => `  sold: ${name}`),
      ...summary.reappeared.map((name) => `  back on the market: ${name}`),
      ...summary.priceChanges.map((change) => `  price ${change.to < change.from ? "drop" : "change"}: ${change.name} ${money(change.from)} to ${money(change.to)}`),
      ...summary.incentive.map((line) => `  incentive: ${line}`),
      "",
    ]);
    const total = summaries.reduce((count, summary) => count + summary.added.length + summary.sold.length + summary.reappeared.length + summary.priceChanges.length + summary.incentive.length, 0);
    await send("deals_sync_summary", `Builder Deals update: ${total} change${total === 1 ? "" : "s"}`, ["Official builder refresh summary.", "", ...lines, "Review in Admin, Builder Deals: /admin/deals"].join("\n"));
  }
  if (holds.length) {
    const lines = holds.flatMap((hold) => [`${hold.privateName} (${hold.builder}), ${hold.kind} hold: ${hold.reason}`, ...(hold.detail ? [`  ${hold.detail}`] : []), ""]);
    await send("deals_sync_hold", `Builder Deals hold: ${holds.map((hold) => hold.privateName).join(", ")}`, ["A builder page could not be published. The last good data stays live.", "", ...lines, "Catalog holds offer Dismiss hold or Switch to Manual; incentive holds offer Accept this update in Admin, Builder Deals: /admin/deals"].join("\n"));
  }
}

/**
 * Read-only official refresh driven by deal_communities rows. Existing listings
 * are never erased on a parser error; the community is placed on hold for admin
 * review while the last good presentation stays intact.
 */
export async function refreshOfficialDeals(options: { communityId?: number; communityIds?: readonly number[]; now?: Date } = {}): Promise<RefreshResult[]> {
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
    : await db.select().from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false), eq(dealCommunities.manualMode, false)));
  const results: RefreshResult[] = [];
  const summaries: CommunityChangeSummary[] = [];
  const holds: HoldNotice[] = [];
  for (const community of communities) {
    try {
      results.push(await refreshCommunity(community, now, summaries, holds));
    } catch (error) {
      // Do not log the source URL: it is private metadata.
      console.error(`[deals-sync] community ${community.id} refresh failed`, error instanceof Error ? error.message : error);
      results.push({ communityId: community.id, reelCode: community.reelCode, ok: false, reason: "refresh_failed" });
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

/** Calendar-day distance in America/Chicago, so a 06:04 finish on day 0 is due at 06:00 on day 3. */
export function communityRefreshDue(lastSuccessfulSyncAt: Date | null, now = new Date()): boolean {
  if (!lastSuccessfulSyncAt) return true;
  return chicagoDayNumber(chicagoDay(now)) - chicagoDayNumber(chicagoDay(lastSuccessfulSyncAt)) >= 3;
}

/**
 * The scheduled catalog job intentionally does not scrape every morning. Only
 * the communities that have never completed an official refresh, or whose last
 * success is at least three Chicago calendar days old, are refreshed.
 */
export async function refreshOfficialDealsIfDue(now = new Date()): Promise<RefreshResult[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const communities = await db.select().from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false), eq(dealCommunities.manualMode, false)));
  const due = communities.filter((community) => community.builder !== "Manual" && communityRefreshDue(community.lastSuccessfulSyncAt, now));
  if (!due.length) return [{ communityId: 0, reelCode: "scheduled", ok: true, skipped: "fresh_within_three_days" }];
  return refreshOfficialDeals({ communityIds: due.map((community) => community.id), now });
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
  for (const row of stale) {
    const expired = Boolean(row.expiresAt);
    await db.update(dealIncentives).set({ active: false, holdReason: expired ? "expired" : "lapsed_unconfirmed" }).where(eq(dealIncentives.id, row.id));
    const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, row.communityId)).limit(1))[0];
    await db.update(dealCommunities).set({ catalogUpdatedAt: now }).where(eq(dealCommunities.id, row.communityId));
    const name = community?.privateName ?? `community ${row.communityId}`;
    await sendBuilderDealsEmail({
      category: expired ? "deals_incentive_expired" : "deals_incentive_lapsed",
      recipients: settings.syncEmailRecipients,
      subject: `Builder Deals incentive ${expired ? "expired" : "lapsed"}: ${name}`,
      content: [
        expired
          ? `The incentive for ${name} reached its ${row.contractBy && row.expiresAt && row.contractBy.getTime() === row.expiresAt.getTime() ? "contract-by" : "close-by"} date (${isoDay(row.expiresAt)}) and came off the page.`
          : `The incentive for ${name} has no dates and was not re-confirmed by a successful scrape for ${settings.incentiveLapseDays} days (last confirmed ${isoDay(row.confirmedAt)}), so it came off the page.`,
        "",
        `Text: "${row.publicText}"`,
        row.manual ? "This was a manual override." : "It returns only when the builder's text changes (expired) or the same text is confirmed again (lapsed).",
        "",
        "Review in Admin, Builder Deals: /admin/deals",
      ].join("\n"),
    }).catch((error) => console.error("[deals-sync] incentive email failed", error instanceof Error ? error.message : error));
  }
  return { ok: true as const, expired: stale.filter((row) => Boolean(row.expiresAt)).length, lapsed: stale.filter((row) => !row.expiresAt).length, checked: rows.length };
}
