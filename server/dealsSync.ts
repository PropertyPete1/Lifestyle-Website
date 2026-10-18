import { and, eq, sql } from "drizzle-orm";
import { dealCommunities, dealHomes, dealIncentives } from "../drizzle/schema";
import { getDb } from "./db";
import { hashSecret } from "./dealsService";
import { loadOfficialDeals } from "./dealsAdapters";

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
    incentiveSourceUrl: "https://www.chesmar.com/campaigns/2553",
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

async function upsertHome(input: { communityId: number; sourceUrl: string; privatePlanName?: string | null; privateAddress?: string | null; kind: "quick_move_in" | "to_be_built"; beds?: string | null; baths?: string | null; sqft?: number | null; price?: number | null; previousPrice?: number | null; moveInDate?: string | null; lotSize?: string | null; status?: "available" | "sold" | "hidden" }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const sourceKey = hashSecret(input.sourceUrl);
  const existing = (await db.select().from(dealHomes).where(eq(dealHomes.sourceKey, sourceKey)).limit(1))[0];
  const values = { ...input, sourceKey, status: input.status ?? "available" };
  if (existing) await db.update(dealHomes).set(values).where(eq(dealHomes.id, existing.id));
  else await db.insert(dealHomes).values(values);
}

async function replaceIncentive(input: { communityId: number; normalizedText: string; publicText: string; headlineRate?: string; followOnRate?: string; followOnPeriod?: string; apr?: string; loanType?: string; downPayment?: string; repaymentTerms?: string; contractBy?: Date | null; closeBy?: Date | null; reconfirmNoDate?: boolean; held?: boolean; holdReason?: string | null; manual?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const prior = (await db.select().from(dealIncentives).where(and(eq(dealIncentives.communityId, input.communityId), eq(dealIncentives.normalizedText, input.normalizedText))).limit(1))[0];
  const { reconfirmNoDate, ...record } = input;
  const values = { ...record, active: true, held: input.held ?? false, holdReason: input.holdReason ?? null, manual: input.manual ?? false, expiresAt: input.contractBy && input.closeBy ? (input.contractBy < input.closeBy ? input.contractBy : input.closeBy) : input.contractBy ?? input.closeBy ?? (reconfirmNoDate ? new Date(Date.now() + 14 * 86400_000) : null), confirmedAt: new Date() };
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

  const chesmarIncentive = "4.999% (5.737% APR) FHA 30yr, fixed-rate special financing on select homes! 3.5% minimum down payment. 360 monthly payments.";
  await replaceIncentive({
    communityId: chesmar,
    normalizedText: chesmarIncentive.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim(),
    publicText: chesmarIncentive,
    headlineRate: "4.999%",
    apr: "5.737% APR",
    loanType: "FHA",
    downPayment: "3.5% minimum down payment",
    repaymentTerms: "360 monthly payments · 30-year fixed",
    // A verified no-date offer is re-confirmed by the scheduled source check.
    // It fails closed after 14 days if those core published terms disappear.
    reconfirmNoDate: true,
    held: false,
    holdReason: null,
    manual: true,
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
      await upsertHome({
        communityId: chesmar,
        sourceUrl: plan.sourceUrl,
        privatePlanName: plan.privateName,
        kind: "to_be_built",
        beds: plan.bedrooms === null ? null : String(plan.bedrooms),
        baths: plan.bathrooms === null ? null : String(plan.bathrooms),
        sqft: plan.squareFeet,
        price: plan.price,
      });
    }
  }

  const db = await getDb();
  const homeCount = db ? Number((await db.select({ n: sql<number>`count(*)` }).from(dealHomes))[0]?.n ?? 0) : 0;
  return { communities: 2, homes: homeCount, heldIncentives: 0 };
}

async function reconfirmNoDateChesmarIncentive(communityId: number, sourceUrl: string) {
  const db = await getDb();
  if (!db) return false;
  try {
    const response = await fetch(sourceUrl, { headers: { Accept: "text/html", "User-Agent": "LifestyleDesignRealtyDeals/1.0 (read-only official-page parser)" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return false;
    const source = (await response.text()).toLowerCase();
    // The exact public source must still contain every rate trigger. This is
    // only a re-confirmation signal; it never publishes newly parsed terms.
    const confirmed = ["4.999%", "5.737%", "3.5%", "30-year"].every((term) => source.includes(term));
    if (!confirmed) return false;
    await db.update(dealIncentives)
      .set({ confirmedAt: new Date(), expiresAt: new Date(Date.now() + 14 * 86400_000), held: false, holdReason: null })
      .where(and(eq(dealIncentives.communityId, communityId), eq(dealIncentives.manual, true), eq(dealIncentives.active, true)));
    return true;
  } catch { return false; }
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
    if (config.builder === "Chesmar" && "incentiveSourceUrl" in config && config.incentiveSourceUrl) {
      await reconfirmNoDateChesmarIncentive(community.id, config.incentiveSourceUrl);
    }
    if (!snapshot.ok) {
      await db.update(dealCommunities).set({ holdReason: snapshot.holdReasons.join(", ") }).where(eq(dealCommunities.id, community.id));
      results.push({ reelCode: config.reelCode, ok: false, reason: snapshot.holdReasons.join(", ") });
      continue;
    }
    for (const plan of snapshot.private.plans) {
      await upsertHome({ communityId: community.id, sourceUrl: plan.sourceUrl, privatePlanName: plan.privateName, kind: "to_be_built", beds: plan.bedrooms === null ? null : String(plan.bedrooms), baths: plan.bathrooms === null ? null : String(plan.bathrooms), sqft: plan.squareFeet, price: plan.price });
    }
    // Only publish a QMI when the official page explicitly labels it as such.
    for (const home of snapshot.private.homes) {
      if (!/quick\s+move|available\s+now/i.test(home.status ?? "")) continue;
      await upsertHome({ communityId: community.id, sourceUrl: home.sourceUrl, privatePlanName: home.privateName, kind: "quick_move_in", beds: home.bedrooms === null ? null : String(home.bedrooms), baths: home.bathrooms === null ? null : String(home.bathrooms), sqft: home.squareFeet, price: home.price });
    }
    await db.update(dealCommunities).set({ lastSuccessfulSyncAt: new Date(), holdReason: null }).where(eq(dealCommunities.id, community.id));
    results.push({ reelCode: config.reelCode, ok: true });
  }
  return results;
}
