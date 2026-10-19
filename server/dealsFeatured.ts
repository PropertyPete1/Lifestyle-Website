import { and, eq, inArray } from "drizzle-orm";
import { dealCommunities, dealHomes, dealIncentives } from "../drizzle/schema";
import { scrubPrivateNames, selectDealCatalogHomes } from "../shared/deals";
import { acresFromText, builderExcluded, mortgageRateFrom, percentFrom, rankFeatured, type FeaturedCandidate, type FeaturedDeals } from "../shared/dealsFeatured";
import { getDb } from "./db";
import { communityScrubConfig, getDealSettings, hashSecret, publicNoPrivateNames, type DealsCatalogView } from "./dealsService";

/**
 * Who is looking decides what a featured deal may carry:
 * - "public" (the landing page): the public label, area, price and payment only;
 * - the gated list: the same, scrubbed, plus the card handle to jump to the home;
 * - the full list (team, agent clients): plus the community name and address.
 */
export type FeaturedView = "public" | DealsCatalogView;

type Incentive = typeof dealIncentives.$inferSelect;

/** Same rule as the catalog: active, not held, not past its date, and re-confirmed within the lapse window when undated. */
function incentiveIsLive(row: Incentive, now: Date, lapseDays: number) {
  if (!row.active || row.held) return false;
  if (row.expiresAt) return row.expiresAt > now;
  return row.confirmedAt > new Date(now.getTime() - lapseDays * 24 * 60 * 60_000);
}

/**
 * The builder's financing as a payment input. A buydown's headline is a
 * temporary first-year rate: the payment is figured at the long-term rate that
 * follows it, and the first-year rate is shown alongside.
 */
export function offerFromIncentive(row: Pick<Incentive, "headlineRate" | "followOnRate" | "loanType" | "downPayment"> | undefined): FeaturedCandidate["offer"] {
  if (!row) return null;
  const headline = mortgageRateFrom(row.headlineRate);
  const followOn = mortgageRateFrom(row.followOnRate);
  if (headline === null && followOn === null) return null;
  const down = percentFrom(row.downPayment);
  return {
    ratePercent: followOn ?? headline,
    firstYearRatePercent: followOn !== null && headline !== null && headline !== followOn ? headline : null,
    loanType: row.loanType?.trim() || null,
    downPercent: down !== null && down >= 0 && down <= 100 ? down : null,
  };
}

export async function featuredDeals(view: FeaturedView): Promise<FeaturedDeals> {
  const settings = await getDealSettings();
  // Stored settings are hand-editable JSON: anything unusable falls back to the defaults.
  const finite = (value: unknown, fallback: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  const ranking = { marketRatePercent: finite(settings.paymentMarketRate, 7.4, 1, 15), defaultDownPercent: finite(settings.paymentDownPercent, 5, 0, 100) };
  const excludedBuilders = Array.isArray(settings.featuredExcludedBuilders) ? settings.featuredExcludedBuilders.filter((entry): entry is string => typeof entry === "string") : ["Lennar"];
  const db = await getDb();
  if (!db) return rankFeatured([], ranking);
  const now = new Date();
  const communities = await db.select().from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false)));
  if (!communities.length) return rankFeatured([], ranking);
  const ids = communities.map((community) => community.id);
  const [incentives, homes] = await Promise.all([
    db.select().from(dealIncentives).where(inArray(dealIncentives.communityId, ids)),
    db.select().from(dealHomes).where(and(inArray(dealHomes.communityId, ids), eq(dealHomes.status, "available"))),
  ]);
  const full = view !== "public" && view.view === "full";
  const candidates: FeaturedCandidate[] = [];
  for (const community of communities) {
    const config = communityScrubConfig(community);
    const scrub = (value: string) => full || view === "public" ? value : scrubPrivateNames(value, config);
    const label = scrub(community.publicLabel);
    const area = scrub(community.areaLabel);
    // The public label is written to be safe; a slip still never reaches a buyer, here or in the catalog.
    if (!full && !publicNoPrivateNames({ label, area }, config)) continue;
    const live = incentives.filter((row) => row.communityId === community.id && incentiveIsLive(row, now, settings.incentiveLapseDays))
      .sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime())[0];
    const offer = offerFromIncentive(live);
    const communityAcres = Math.max(acresFromText(community.lotSizes) ?? 0, acresFromText(community.publicLabel) ?? 0) || null;
    const excluded = builderExcluded(community.builder, excludedBuilders);
    for (const home of selectDealCatalogHomes(homes.filter((row) => row.communityId === community.id))) {
      const homeAcres = acresFromText(home.lotSize);
      candidates.push({
        communityKey: String(community.id),
        label,
        area,
        ...(view !== "public" ? { card: hashSecret(`deals-card:${home.sourceKey}`).slice(0, 20) } : {}),
        ...(full ? { detail: [community.privateName, home.privateAddress ?? home.privatePlanName].filter(Boolean).join(" · ") || null } : {}),
        price: home.price,
        kind: home.kind,
        beds: home.beds,
        sqft: home.sqft,
        offer,
        acres: Math.max(homeAcres ?? 0, communityAcres ?? 0) || null,
        excluded,
      });
    }
  }
  return rankFeatured(candidates, ranking);
}
