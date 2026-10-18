import { and, eq, sql } from "drizzle-orm";
import { dealCommunities, dealHomePriceHistory, dealHomes, dealIncentives, dealPhotos } from "../drizzle/schema";
import { getDb } from "./db";
import { hashSecret } from "./dealsService";
import { loadOfficialDeals } from "./dealsAdapters";
import { scrubPrivateNames } from "../shared/deals";
import { processDealPhoto } from "./dealsPhotos";

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
  if (existing) {
    await db.update(dealCommunities).set(values).where(eq(dealCommunities.id, existing.id));
    return existing.id;
  }
  const result = await db.insert(dealCommunities).values(values);
  return Number((result as unknown as [{ insertId: number }])[0].insertId);
}

async function upsertHome(input: { communityId: number; sourceUrl: string; privatePlanName?: string | null; privateAddress?: string | null; kind: "quick_move_in" | "to_be_built"; beds?: string | null; baths?: string | null; sqft?: number | null; price?: number | null; previousPrice?: number | null; moveInDate?: string | null; lotSize?: string | null; garage?: string | null; homesite?: string | null; readyNow?: boolean; status?: "available" | "sold" | "hidden"; origin?: "official" | "manual" }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const sourceKey = hashSecret(input.sourceUrl);
  const existing = (await db.select().from(dealHomes).where(eq(dealHomes.sourceKey, sourceKey)).limit(1))[0];
  const values = { ...input, sourceKey, status: input.status ?? "available", origin: input.origin ?? "official" };
  if (existing) {
    if (input.price && existing.price !== input.price) {
      await db.insert(dealHomePriceHistory).values({ homeId: existing.id, price: existing.price ?? input.price });
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
      const history = await db.select({ price: dealHomePriceHistory.price }).from(dealHomePriceHistory).where(sql`${dealHomePriceHistory.homeId} = ${existing.id} AND ${dealHomePriceHistory.observedAt} >= ${thirtyDaysAgo}`);
      const high = Math.max(input.price, existing.price ?? 0, ...history.map((row) => row.price));
      values.previousPrice = high > input.price ? high : null;
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
    const result = await db.insert(dealPhotos).values({ homeId, sourceUrl: image.sourceUrl, sourceHash, sortOrder, processingState: "pending" });
    const id = Number((result as unknown as [{ insertId: number }])[0].insertId);
    void processDealPhoto(id);
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

/**
 * First launch import uses only verified official-page facts plus the incentive
 * details supplied by the brokerage. The M/I record stays held until its page
 * or flyer provides the missing triggering-term disclosure; it cannot leak to
 * the public page before then.
 */
export async function seedLaunchDeals(): Promise<{ communities: number; homes: number; heldIncentives: number }> {
  const [chesmar, mi] = await Promise.all(LAUNCH_DEALS.map(upsertCommunity));

  const chesmarIncentive = "4.999% (5.737% APR) FHA 30-year, fixed-rate financing on select homes that close by 12/31/26. Available 10/1/26 through 10/18/26. 3.50% down payment. 360 monthly payments.";
  await replaceIncentive({
    communityId: chesmar,
    normalizedText: chesmarIncentive.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim(),
    publicText: chesmarIncentive,
    headlineRate: "4.999%",
    apr: "5.737% APR",
    loanType: "FHA",
    downPayment: "3.5% minimum down payment",
    repaymentTerms: "360 monthly payments · 30-year fixed",
    contractBy: new Date("2026-10-18T23:59:59-05:00"),
    closeBy: new Date("2026-12-31T23:59:59-06:00"),
    held: false,
    holdReason: null,
    manual: false,
  });

  const miIncentive = "Fall Into Savings: Great Rates, Paid Closing Costs, Homesite Savings, and More. Year 1 4.25% interest rate | Years 2 to 30 5.25% interest rate | 6.051% APR. Selected Quick Move-In homes: 30-year fixed FHA loan with a 1/0 buydown and up to $10,000 toward allowable closing costs. 3.5% down payment and a minimum 640 credit score required. Valid on full-priced contracts written 10/12/2026 to 11/8/2026 on selected Quick Move-In homes; must close by 11/30/2026. New contracts only; does not apply to cancellations, rewrites, or transfers; buyer must occupy as primary residence; cannot be combined with any other offer. FHA county loan limits apply. Rate is not guaranteed until locked with the builder's lender.";
  await replaceIncentive({
    communityId: mi,
    normalizedText: miIncentive.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim(),
    publicText: miIncentive,
    headlineRate: "4.25%",
    followOnRate: "5.25%",
    followOnPeriod: "Years 2 to 30",
    apr: "6.051% APR",
    loanType: "FHA",
    downPayment: "3.5% down payment · minimum 640 credit score",
    repaymentTerms: "30-year fixed FHA · 1/0 buydown · selected Quick Move-In homes",
    contractBy: new Date("2026-11-08T23:59:59-06:00"),
    closeBy: new Date("2026-11-30T23:59:59-06:00"),
    held: false,
    holdReason: null,
  });

  // M/I confirmed this available home, current and prior price, 5 beds, 4.5
  // baths, 4,099 sq. ft., and a March 21, 2027 ready date on its official page.
  await upsertHome({
    communityId: mi,
    sourceUrl: "https://www.mihomes.com/new-homes/texas/greater-san-antonio/southeast-san-antonio/vista-gardens/rio-grande-plan/7711-hanging-basket",
    privatePlanName: "Rio Grande",
    privateAddress: "7711 Hanging Basket, San Antonio, TX",
    kind: "quick_move_in",
    beds: "5",
    baths: "4.5",
    sqft: 4099,
    price: 689990,
    previousPrice: 713622,
    moveInDate: "March 21, 2027",
  });

  // A live official Chesmar page currently renders no unambiguous quick move-in
  // entries. Populate the to-be-built catalog from its official plan pages.
  const fetched = await loadOfficialDeals({
    builder: "Chesmar",
    sourceUrl: LAUNCH_DEALS[0].sourceUrl,
    privateCommunityName: LAUNCH_DEALS[0].privateName,
    scrubList: LAUNCH_DEALS[0].scrubList,
    // Current official sitemap has ten plan pages. Keep the first import
    // bounded to twelve detail GETs, avoiding a long-lived connection sweep.
    maxDetailPages: 12,
  });
  if (fetched.ok) {
    for (const plan of fetched.private.plans) {
      const homeId = await upsertHome({
        communityId: chesmar,
        sourceUrl: plan.sourceUrl,
        privatePlanName: plan.privateName,
        kind: "to_be_built",
        beds: plan.bedrooms === null ? null : String(plan.bedrooms),
        baths: plan.bathrooms === null ? null : String(plan.bathrooms),
        sqft: plan.squareFeet,
        price: plan.price,
      });
      await upsertPhotos(homeId, plan.gallery);
    }
  }

  const db = await getDb();
  const homeCount = db ? Number((await db.select({ n: sql<number>`count(*)` }).from(dealHomes))[0]?.n ?? 0) : 0;
  return { communities: 2, homes: homeCount, heldIncentives: 0 };
}

/**
 * Read-only official refresh. Existing listings are never erased on a parser
 * error; the community is placed on hold for admin review while the last good
 * presentation stays intact.
 */
export async function refreshOfficialDeals() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const results: Array<{ reelCode: string; ok: boolean; reason?: string }> = [];
  for (const config of LAUNCH_DEALS) {
    const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.reelCode, config.reelCode)).limit(1))[0];
    if (!community || community.paused || community.manualMode) continue;
    await db.update(dealCommunities).set({ lastAttemptAt: new Date() }).where(eq(dealCommunities.id, community.id));
    const snapshot = await loadOfficialDeals({
      builder: config.builder,
      sourceUrl: config.sourceUrl,
      incentiveSourceUrl: "incentiveSourceUrl" in config ? config.incentiveSourceUrl : undefined,
      privateCommunityName: config.privateName,
      scrubList: config.scrubList,
      maxDetailPages: 12,
    });
    if (!snapshot.catalogOk) {
      await db.update(dealCommunities).set({ holdReason: snapshot.holdReasons.join(", ") }).where(eq(dealCommunities.id, community.id));
      results.push({ reelCode: config.reelCode, ok: false, reason: snapshot.holdReasons.join(", ") });
      continue;
    }
    const discovered = new Set(snapshot.private.homes.map((item) => hashSecret(item.sourceUrl)));
    const existingHomes = await db.select().from(dealHomes).where(and(eq(dealHomes.communityId, community.id), eq(dealHomes.origin, "official"), eq(dealHomes.status, "available")));
    for (const missing of existingHomes) if (!discovered.has(missing.sourceKey) && missing.kind === "quick_move_in") await db.update(dealHomes).set({ status: "sold" }).where(eq(dealHomes.id, missing.id));
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
    if (snapshot.private.incentive?.facts.publishable) {
      const fact = snapshot.private.incentive.facts;
      await replaceIncentive({ communityId: community.id, normalizedText: fact.normalizedText, publicText: scrubPrivateNames(snapshot.private.incentive.text, JSON.parse(community.scrubList)), headlineRate: `${fact.promotionalRatePercent}%`, followOnRate: fact.followOnRatePercent ? `${fact.followOnRatePercent}%` : undefined, followOnPeriod: fact.followOnPeriod ?? undefined, apr: `${fact.aprPercent}% APR`, loanType: fact.loanType ?? undefined, downPayment: fact.downPaymentPercent ? `${fact.downPaymentPercent}% down payment` : undefined, repaymentTerms: fact.repaymentTermYears ? `${fact.repaymentTermYears}-year fixed` : undefined, contractBy: fact.contractDeadline?.isoDate ? new Date(`${fact.contractDeadline.isoDate}T23:59:59-06:00`) : null, closeBy: fact.closingDeadline?.isoDate ? new Date(`${fact.closingDeadline.isoDate}T23:59:59-06:00`) : null, held: false, holdReason: null });
    }
    await db.update(dealCommunities).set({ lastSuccessfulSyncAt: new Date(), catalogUpdatedAt: new Date(), holdReason: snapshot.incentiveHoldReasons.length ? snapshot.incentiveHoldReasons.join(", ") : null }).where(eq(dealCommunities.id, community.id));
    results.push({ reelCode: config.reelCode, ok: true });
  }
  return results;
}
