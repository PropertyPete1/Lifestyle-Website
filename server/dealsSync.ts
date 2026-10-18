import { and, eq, sql } from "drizzle-orm";
import { dealCommunities, dealHomePriceHistory, dealHomes, dealIncentives, dealPhotos } from "../drizzle/schema";
import { getDb } from "./db";
import { chicagoEndOfDay, hashSecret } from "./dealsService";
import { loadOfficialDeals, toPublicSafeText, type BuilderId, type CommunitySourceConfig } from "./dealsAdapters";
import { normalizedDealSourceKey, normalizedText } from "../shared/deals";
import { processDealPhoto, processPendingDealPhotos } from "./dealsPhotos";

/** Private operational source configurations. Never import this module into client code. */
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
    scrubList: ["Chesmar", "Chesmar Homes", "Sienna Lakes", "Arroyo Grove", "HomeAmerican"],
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
    incentiveSourceUrl: "https://www.mihomes.com/new-homes/texas/greater-san-antonio/incentives/fall-into-savings-2026",
    scrubList: ["M/I", "M/I Homes", "M/I Financial", "Vista Gardens", "Onion Patch", "Gardner Road", "Hanging Basket"],
  },
] as const;

async function upsertCommunity(config: (typeof LAUNCH_DEALS)[number]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = (await db.select().from(dealCommunities).where(eq(dealCommunities.reelCode, config.reelCode)).limit(1))[0];
  const values = {
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
    scrubList: JSON.stringify(config.scrubList),
    active: true,
  };
  // These source fields already live in deal_communities. Preserve an existing
  // reviewed row instead of overwriting database configuration on every seed.
  if (existing) return existing.id;
  const result = await db.insert(dealCommunities).values(values);
  return Number((result as unknown as [{ insertId: number }])[0].insertId);
}

function storedPrice(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : null;
}

function isBuilderId(value: string): value is BuilderId {
  return value === "Chesmar" || value === "M/I Homes" || value === "Manual";
}

function storedScrubList(value: string, fallback: readonly string[]): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) return [...fallback];
    return Array.from(new Set([...fallback, ...parsed.map((item) => item.trim()).filter(Boolean)]));
  } catch {
    return [...fallback];
  }
}

/** Uses only existing deal_communities fields; no schema migration is implied. */
function storedCommunitySourceConfig(
  fallback: (typeof LAUNCH_DEALS)[number],
  community: typeof dealCommunities.$inferSelect,
): CommunitySourceConfig | null {
  if (!isBuilderId(community.builder) || !community.sourceUrl.trim() || !community.privateName.trim()) return null;
  return {
    builder: community.builder,
    sourceUrl: community.sourceUrl,
    privateCommunityName: community.privateName,
    scrubList: storedScrubList(community.scrubList, fallback.scrubList),
    // There is no incentive URL column. M/I discovers a current official link
    // from its configured community rather than retaining a stale campaign.
    maxDetailPages: 12,
  };
}

async function upsertHome(input: { communityId: number; sourceUrl: string; privatePlanName?: string | null; privateAddress?: string | null; kind: "quick_move_in" | "to_be_built"; beds?: string | null; baths?: string | null; sqft?: number | null; price?: number | null; previousPrice?: number | null; moveInDate?: string | null; lotSize?: string | null; garage?: string | null; homesite?: string | null; readyNow?: boolean; status?: "available" | "sold" | "hidden"; origin?: "official" | "manual" }) {
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
  const values = {
    ...input,
    sourceUrl,
    sourceKey,
    price: incomingPrice,
    previousPrice: storedPrice(input.previousPrice),
    status: input.status ?? "available",
    origin: input.origin ?? "official",
  };
  if (existing) {
    // A failed or incomplete card parse must never erase a good price. Record
    // only a real prior observed price; never manufacture a history point.
    values.price = incomingPrice ?? existing.price;
    if (incomingPrice !== null && existing.price !== null && incomingPrice !== existing.price) {
      await db.insert(dealHomePriceHistory).values({ homeId: existing.id, price: existing.price });
    }
    if (values.price !== null) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
      const history = await db.select({ price: dealHomePriceHistory.price }).from(dealHomePriceHistory).where(sql`${dealHomePriceHistory.homeId} = ${existing.id} AND ${dealHomePriceHistory.observedAt} >= ${thirtyDaysAgo}`);
      const candidates = [
        ...history.map((row) => storedPrice(row.price)).filter((price): price is number => price !== null),
        storedPrice(input.previousPrice),
      ].filter((price): price is number => price !== null);
      const high = candidates.length ? Math.max(...candidates) : null;
      values.previousPrice = high !== null && high > values.price ? high : null;
    } else {
      values.previousPrice = existing.previousPrice;
    }
    await db.update(dealHomes).set(values).where(eq(dealHomes.id, existing.id));
    return existing.id;
  }
  const result = await db.insert(dealHomes).values(values);
  return Number((result as unknown as [{ insertId: number }])[0].insertId);
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
    const id = Number((result as unknown as [{ insertId: number }])[0].insertId);
    // The DB row is the source of truth. Best-effort immediate work improves
    // freshness but a restart cannot lose it: scheduled/sync queue draining
    // picks up due pending records and expired processing leases.
    void processDealPhoto(id).catch((error) => console.warn("[deals-photo] initial queue drain failed", error));
  }
}

async function replaceIncentive(input: { communityId: number; normalizedText: string; publicText: string; headlineRate?: string; followOnRate?: string; followOnPeriod?: string; apr?: string; loanType?: string; downPayment?: string; repaymentTerms?: string; contractBy?: Date | null; closeBy?: Date | null; held?: boolean; holdReason?: string | null; manual?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const prior = (await db.select().from(dealIncentives).where(and(eq(dealIncentives.communityId, input.communityId), eq(dealIncentives.normalizedText, input.normalizedText))).limit(1))[0];
  const values = { ...input, active: true, held: input.held ?? false, holdReason: input.holdReason ?? null, manual: input.manual ?? false, expiresAt: input.contractBy && input.closeBy ? (input.contractBy < input.closeBy ? input.contractBy : input.closeBy) : input.contractBy ?? input.closeBy ?? null, confirmedAt: new Date() };
  if (prior) await db.update(dealIncentives).set(values).where(eq(dealIncentives.id, prior.id));
  else await db.insert(dealIncentives).values(values);
}

/** First launch uses a current read-only official refresh, never a saved capture. */
export async function seedLaunchDeals(): Promise<{ communities: number; homes: number; heldIncentives: number }> {
  await Promise.all(LAUNCH_DEALS.map(upsertCommunity));
  await refreshOfficialDeals();

  const db = await getDb();
  const homeCount = db ? Number((await db.select({ n: sql<number>`count(*)` }).from(dealHomes))[0]?.n ?? 0) : 0;
  const heldIncentives = db ? Number((await db.select({ n: sql<number>`count(*)` }).from(dealIncentives).where(eq(dealIncentives.held, true)))[0]?.n ?? 0) : 0;
  return { communities: LAUNCH_DEALS.length, homes: homeCount, heldIncentives };
}

/**
 * Read-only official refresh. Existing listings are never erased on a parser
 * error; the community is placed on hold for admin review while the last good
 * presentation stays intact.
 */
export async function refreshOfficialDeals() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  // A prior refresh may have ended between claiming and processing an image.
  // Drain a small bounded batch before doing network-heavy catalog work.
  void processPendingDealPhotos(5).catch((error) => console.warn("[deals-photo] retry queue drain failed", error));
  const results: Array<{ reelCode: string; ok: boolean; reason?: string }> = [];
  for (const config of LAUNCH_DEALS) {
    const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.reelCode, config.reelCode)).limit(1))[0];
    if (!community || community.paused || community.manualMode) continue;
    await db.update(dealCommunities).set({ lastAttemptAt: new Date() }).where(eq(dealCommunities.id, community.id));
    const sourceConfig = storedCommunitySourceConfig(config, community);
    if (!sourceConfig) {
      await db.update(dealCommunities).set({ holdReason: "invalid_source_url" }).where(eq(dealCommunities.id, community.id));
      results.push({ reelCode: config.reelCode, ok: false, reason: "invalid_source_url" });
      continue;
    }
    const snapshot = await loadOfficialDeals(sourceConfig);
    if (!snapshot.catalogOk) {
      await db.update(dealCommunities).set({ holdReason: snapshot.holdReasons.join(", ") }).where(eq(dealCommunities.id, community.id));
      results.push({ reelCode: config.reelCode, ok: false, reason: snapshot.holdReasons.join(", ") });
      continue;
    }
    // M/I's paged API is enumerated to its declared total. Chesmar discovery
    // is deliberately bounded and therefore cannot prove a previously stored
    // QMI is sold. Do not turn an incomplete observation into sold inventory.
    if (sourceConfig.builder === "M/I Homes") {
      const discovered = new Set(snapshot.private.homes.map((item) => normalizedDealSourceKey(item.sourceUrl)));
      const existingHomes = await db.select().from(dealHomes).where(and(eq(dealHomes.communityId, community.id), eq(dealHomes.origin, "official"), eq(dealHomes.status, "available")));
      for (const missing of existingHomes) {
        if (missing.kind === "quick_move_in" && !discovered.has(normalizedDealSourceKey(missing.sourceUrl))) {
          await db.update(dealHomes).set({ status: "sold" }).where(eq(dealHomes.id, missing.id));
        }
      }
    }
    for (const plan of snapshot.private.plans) {
      const homeId = await upsertHome({ communityId: community.id, sourceUrl: plan.sourceUrl, privatePlanName: plan.privatePlanName ?? plan.privateName, privateAddress: plan.privateAddress ?? null, kind: "to_be_built", beds: plan.bedrooms === null ? null : String(plan.bedrooms), baths: plan.bathrooms === null ? null : String(plan.bathrooms), sqft: plan.squareFeet, price: plan.price, previousPrice: plan.previousPrice ?? null, moveInDate: plan.moveInDate ?? null, garage: plan.garage ? String(plan.garage) : null, homesite: plan.homesite ?? null, readyNow: plan.readyNow ?? false });
      await upsertPhotos(homeId, plan.gallery);
    }
    // Only publish a QMI when the official page explicitly labels it as such.
    for (const home of snapshot.private.homes) {
      if (!/quick\s+move|available\s+now/i.test(home.status ?? "")) continue;
      const homeId = await upsertHome({ communityId: community.id, sourceUrl: home.sourceUrl, privatePlanName: home.privatePlanName ?? home.privateName, privateAddress: home.privateAddress ?? null, kind: "quick_move_in", beds: home.bedrooms === null ? null : String(home.bedrooms), baths: home.bathrooms === null ? null : String(home.bathrooms), sqft: home.squareFeet, price: home.price, previousPrice: home.previousPrice ?? null, moveInDate: home.moveInDate ?? null, garage: home.garage ? String(home.garage) : null, homesite: home.homesite ?? null, readyNow: home.readyNow ?? false });
      await upsertPhotos(homeId, home.gallery);
    }
    if (snapshot.private.incentive?.facts.publishable && snapshot.public.incentive) {
      const fact = snapshot.private.incentive.facts;
      const publicText = toPublicSafeText(snapshot.public.incentive.text, sourceConfig);
      if (!publicText) {
        await db.update(dealCommunities).set({ holdReason: "private_text_remaining" }).where(eq(dealCommunities.id, community.id));
        results.push({ reelCode: config.reelCode, ok: false, reason: "private_text_remaining" });
        continue;
      }
      await replaceIncentive({ communityId: community.id, normalizedText: normalizedText(publicText), publicText, headlineRate: `${fact.promotionalRatePercent}%`, followOnRate: fact.followOnRatePercent ? `${fact.followOnRatePercent}%` : undefined, followOnPeriod: fact.followOnPeriod ?? undefined, apr: `${fact.aprPercent}% APR`, loanType: fact.loanType ?? undefined, downPayment: fact.downPaymentPercent ? `${fact.downPaymentPercent}% down payment` : undefined, repaymentTerms: fact.repaymentTermYears ? `${fact.repaymentTermYears}-year fixed` : undefined, contractBy: fact.contractDeadline?.isoDate ? chicagoEndOfDay(...fact.contractDeadline.isoDate.split("-").map(Number) as [number, number, number]) : null, closeBy: fact.closingDeadline?.isoDate ? chicagoEndOfDay(...fact.closingDeadline.isoDate.split("-").map(Number) as [number, number, number]) : null, held: false, holdReason: null });
    }
    await db.update(dealCommunities).set({ lastSuccessfulSyncAt: new Date(), catalogUpdatedAt: new Date(), holdReason: snapshot.incentiveHoldReasons.length ? snapshot.incentiveHoldReasons.join(", ") : null }).where(eq(dealCommunities.id, community.id));
    results.push({ reelCode: config.reelCode, ok: true });
  }
  // Also make newly discovered records eligible without making catalog refresh
  // depend on OCR throughput. Each entry is atomically leased by the worker.
  void processPendingDealPhotos(10).catch((error) => console.warn("[deals-photo] retry queue drain failed", error));
  return results;
}
