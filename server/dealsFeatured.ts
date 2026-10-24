import { and, asc, eq, inArray } from "drizzle-orm";
import { dealCommunities, dealHomes, dealIncentives, dealPhotos } from "../drizzle/schema";
import { scrubPrivateNames, selectDealCatalogHomes } from "../shared/deals";
import { DEFAULT_PAYMENT_COSTS, builderExcluded, downPaymentPercentFrom, homeLotAcres, loanTypeLabel, lotAcres, mortgageRateFrom, rankFeatured, roundFeaturedForPublic, type FeaturedCandidate, type FeaturedDeal, type FeaturedDeals } from "../shared/dealsFeatured";
import { getDb } from "./db";
import { communityScrubConfig, dealsCardHandle, dealsHandle, getDealSettings, hashSecret, publicNoPrivateNames, type DealsCatalogView } from "./dealsService";

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
  const ranking = {
    marketRatePercent: finite(settings.paymentMarketRate, 7.4, 1, 15),
    defaultDownPercent: finite(settings.paymentDownPercent, 5, 0, 100),
    costs: {
      taxRatePercent: finite(settings.paymentTaxRate, DEFAULT_PAYMENT_COSTS.taxRatePercent, 0, 6),
      insuranceRatePercent: finite(settings.paymentInsuranceRate, DEFAULT_PAYMENT_COSTS.insuranceRatePercent, 0, 5),
      hoaMonthly: finite(settings.paymentHoaMonthly, DEFAULT_PAYMENT_COSTS.hoaMonthly, 0, 2000),
      mortgageInsuranceRatePercent: finite(settings.paymentMortgageInsuranceRate, DEFAULT_PAYMENT_COSTS.mortgageInsuranceRatePercent, 0, 3),
    },
  };
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
  /** Deal key to home id, kept on the server only (a key is never reversible). */
  const homeByKey = new Map<string, number>();
  for (const community of communities) {
    const config = communityScrubConfig(community);
    const scrub = (value: string) => full || view === "public" ? value : scrubPrivateNames(value, config);
    const label = scrub(community.publicLabel);
    const area = scrub(community.areaLabel);
    // The public label is written to be safe; a slip still never reaches a buyer, here or in the catalog.
    if (!full && !publicNoPrivateNames({ label, area }, config)) continue;
    const live = incentives.filter((row) => row.communityId === community.id && incentiveIsLive(row, now, settings.incentiveLapseDays))
      .sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime())[0];
    const baseOffer = offerFromIncentive(live);
    // The APR goes with the rate wherever the rate is printed (Reg Z): an offer with no APR is not a builder rate here,
    // so its homes are figured (and printed) at the market rate.
    const aprPercent = mortgageRateFrom(live?.apr);
    const offer = baseOffer && aprPercent !== null ? { ...baseOffer, aprPercent } : null;
    // The smallest lot the community promises; a home's own lot size wins when it has one.
    const communityAcres = lotAcres(community.lotSizes, { field: true }) ?? lotAcres(community.publicLabel);
    const excluded = communityExcludedFromFeatured(community, config, excludedBuilders);
    for (const home of selectDealCatalogHomes(homes.filter((row) => row.communityId === community.id))) {
      // A home with its own lot size answers for itself, even when that text gives no acreage.
      const homeAcres = homeLotAcres(home.lotSize, communityAcres);
      const card = view !== "public" ? dealsCardHandle(home.sourceKey) : undefined;
      // On a private list, only homes on that list compete, so the strip is never short.
      if (options.onlyCards && (!card || !options.onlyCards.has(card))) continue;
      const key = dealsHandle(`deals-featured:${community.id}:${home.sourceKey}`, 12);
      homeByKey.set(key, home.id);
      candidates.push({
        communityKey: String(community.id),
        key,
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
  const ranked = await withCoverPhotos(rankFeatured(candidates, ranking), homeByKey, view);
  // Ranked on exact figures; shown to the landing page in bands only.
  return view === "public" ? roundFeaturedForPublic(ranked) : ranked;
}

/** The landing page's featured photo keys, from its latest ranking: the only photos the public route serves. */
const publicPhotoByKey = new Map<string, number>();
let publicPhotosRankedAt = 0;
/** An unknown key re-ranks at most this often, so made-up keys cannot make every request re-rank the catalog. */
const PUBLIC_PHOTO_RERANK_MS = 60_000;

/** The photo the landing page may show for a featured deal key; null when the key is not featured now. */
export async function publicFeaturedPhotoId(key: string): Promise<number | null> {
  if (!/^[a-f0-9]{12}$/.test(key)) return null;
  if (!publicPhotoByKey.has(key) && Date.now() - publicPhotosRankedAt > PUBLIC_PHOTO_RERANK_MS) await featuredDeals("public");
  return publicPhotoByKey.get(key) ?? null;
}

/** Each winner's cover (first shown photo): on the landing page a public render of it, on a private list the lead's own render. */
async function withCoverPhotos(ranked: FeaturedDeals, homeByKey: ReadonlyMap<string, number>, view: FeaturedView): Promise<FeaturedDeals> {
  const deals = [...ranked.lowestPayment, ...(ranked.bestRate ? [ranked.bestRate] : []), ...ranked.bigLots];
  const homeIds = Array.from(new Set(deals.map((deal) => deal.key ? homeByKey.get(deal.key) : undefined).filter((id): id is number => id !== undefined)));
  const db = await getDb();
  if (!db || !homeIds.length) return ranked;
  const rows = await db.select({ id: dealPhotos.id, homeId: dealPhotos.homeId }).from(dealPhotos)
    .where(and(inArray(dealPhotos.homeId, homeIds), eq(dealPhotos.processingState, "processed"), eq(dealPhotos.automaticHidden, false), eq(dealPhotos.adminHidden, false)))
    .orderBy(asc(dealPhotos.sortOrder), asc(dealPhotos.id));
  const cover = new Map<number, number>();
  for (const row of rows) if (row.homeId !== null && !cover.has(row.homeId)) cover.set(row.homeId, row.id);
  if (view === "public") {
    publicPhotosRankedAt = Date.now();
    publicPhotoByKey.clear();
    for (const deal of deals) { const photoId = deal.key ? cover.get(homeByKey.get(deal.key) ?? -1) : undefined; if (deal.key && photoId) publicPhotoByKey.set(deal.key, photoId); }
  }
  const attach = (deal: FeaturedDeal): FeaturedDeal => {
    const photoId = deal.key ? cover.get(homeByKey.get(deal.key) ?? -1) : undefined;
    if (!photoId) return deal;
    return { ...deal, photo: view === "public" ? `/deals/featured/img/${deal.key}` : `/deals/mine/img/${photoId}` };
  };
  return { ...ranked, lowestPayment: ranked.lowestPayment.map(attach), bestRate: ranked.bestRate ? attach(ranked.bestRate) : null, bigLots: ranked.bigLots.map(attach) };
}
