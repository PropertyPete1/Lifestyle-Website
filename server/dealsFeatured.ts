import { and, eq, inArray } from "drizzle-orm";
import { dealCommunities, dealHomes, dealIncentives } from "../drizzle/schema";
import { scrubPrivateNames, selectDealCatalogHomes } from "../shared/deals";
import { builderExcluded, downPaymentPercentFrom, homeLotAcres, loanTypeLabel, lotAcres, mortgageRateFrom, rankFeatured, roundFeaturedForPublic, type FeaturedCandidate, type FeaturedDeals } from "../shared/dealsFeatured";
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
  return {
    ratePercent: followOn ?? headline,
    firstYearRatePercent: followOn !== null && headline !== null && headline !== followOn ? headline : null,
    // Only the program name ("FHA"), never free text that could carry a lender's name.
    loanType: loanTypeLabel(row.loanType),
    downPercent: downPaymentPercentFrom(row.downPayment),
  };
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

/**
 * The excluded-builder list matches every name the community is known by: the
 * builder column, the builder and lender names in its private list, its own
 * name and its site, so a Lennar community added by hand ("Manual") is still out.
 */
export function communityExcludedFromFeatured(community: Pick<typeof dealCommunities.$inferSelect, "builder" | "privateName" | "sourceUrl">, config: { builder: readonly string[]; lender: readonly string[]; other?: readonly string[] }, excluded: readonly string[]): boolean {
  return builderExcluded([community.builder, ...config.builder, ...config.lender, ...(config.other ?? []), community.privateName, hostOf(community.sourceUrl)], excluded);
}

export async function featuredDeals(view: FeaturedView, options: { onlyCards?: ReadonlySet<string> } = {}): Promise<FeaturedDeals> {
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
    // The smallest lot the community promises; a home's own lot size wins when it has one.
    const communityAcres = lotAcres(community.lotSizes, { field: true }) ?? lotAcres(community.publicLabel);
    const excluded = communityExcludedFromFeatured(community, config, excludedBuilders);
    for (const home of selectDealCatalogHomes(homes.filter((row) => row.communityId === community.id))) {
      // A home with its own lot size answers for itself, even when that text gives no acreage.
      const homeAcres = homeLotAcres(home.lotSize, communityAcres);
      const card = view !== "public" ? hashSecret(`deals-card:${home.sourceKey}`).slice(0, 20) : undefined;
      // On a private list, only homes on that list compete, so the strip is never short.
      if (options.onlyCards && (!card || !options.onlyCards.has(card))) continue;
      candidates.push({
        communityKey: String(community.id),
        key: hashSecret(`deals-featured:${community.id}:${home.sourceKey}`).slice(0, 12),
        label,
        area,
        ...(card ? { card } : {}),
        ...(full ? { detail: [community.privateName, home.privateAddress ?? home.privatePlanName].filter(Boolean).join(" · ") || null } : {}),
        price: home.price,
        kind: home.kind,
        beds: home.beds,
        sqft: home.sqft,
        offer,
        acres: homeAcres,
        excluded,
      });
    }
  }
  const ranked = rankFeatured(candidates, ranking);
  // Ranked on exact figures; shown to the landing page in bands only.
  return view === "public" ? roundFeaturedForPublic(ranked) : ranked;
}
