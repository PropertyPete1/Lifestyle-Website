import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealIncentives, dealPhotos, dealSettings } from "../drizzle/schema";
import { DEFAULT_PAYMENT_COSTS, acresFromText, builderExcluded, downPaymentPercentFrom, estimatedMonthlyPayment, garageSpaces, homeLotAcres, loanTypeLabel, lotAcres, monthlyPrincipalAndInterest, mortgageRateFrom, percentFrom, priceBandLabel, rankFeatured, type FeaturedCandidate } from "../shared/dealsFeatured";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Best Deals: the payment math, the "meeting table" ranking, what each viewer
 * may see, and the strip as it renders on a phone.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { featuredDeals, offerFromIncentive } from "./dealsFeatured";
import { photoIdFromToken } from "./dealsPhotoToken";
import { dealsCardHandle } from "./dealsService";

(globalThis as { React?: typeof React }).React = React;
const { FeaturedDeals, dealKey, rateLine } = await import("../client/src/components/deals/FeaturedDeals");
const decode = (value: string) => value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// Taxes, insurance and HOA at zero keep these figures principal and interest; the full payment has its own test.
const NO_COSTS = { taxRatePercent: 0, insuranceRatePercent: 0, hoaMonthly: 0, mortgageInsuranceRatePercent: 0 };
const settings = { marketRatePercent: 7.4, defaultDownPercent: 5, costs: NO_COSTS };
/** A builder offer at 7.4% that states no down payment (so the default 5% is used). */
const at74 = { ratePercent: 7.4, firstYearRatePercent: null, loanType: null, downPercent: null };
const candidate = (over: Partial<FeaturedCandidate>): FeaturedCandidate => ({ communityKey: "1", label: "Area | Label", area: "Area", price: 400_000, kind: "quick_move_in", offer: null, acres: null, excluded: false, garage: "2", ...over });

describe("the payment math", () => {
  it("figures principal and interest like a mortgage calculator", () => {
    expect(monthlyPrincipalAndInterest({ price: 400_000, ratePercent: 6, downPercent: 0 })).toBe(2398);
    expect(monthlyPrincipalAndInterest({ price: 315_000, ratePercent: 7, downPercent: 5 })).toBe(1991);
    expect(monthlyPrincipalAndInterest({ price: 360_000, ratePercent: 0.0001, downPercent: 0 })).toBe(1000);
    expect(monthlyPrincipalAndInterest({ price: 100_000, ratePercent: 6, downPercent: 100 })).toBe(0);
  });

  it("figures the mortgage payment: principal and interest plus mortgage insurance, never tax, insurance or HOA", () => {
    // A $170K home at a 4.99% FHA builder rate with 3.5% down: $880 P&I and $75 mortgage insurance (Oct 24: taxes, insurance and HOA left out).
    expect(estimatedMonthlyPayment({ price: 170_000, ratePercent: 4.99, downPercent: 3.5, costs: DEFAULT_PAYMENT_COSTS })).toBe(955);
    // Peter's $225,105 home at 4.99% FHA, 3.5% down: $1,164 P&I + $100 MIP.
    expect(estimatedMonthlyPayment({ price: 225_105, ratePercent: 4.99, downPercent: 3.5, loanType: "FHA", costs: DEFAULT_PAYMENT_COSTS })).toBe(1264);
    expect(estimatedMonthlyPayment({ price: 225_105, ratePercent: 4.99, downPercent: 3.5, loanType: "FHA", costs: { ...DEFAULT_PAYMENT_COSTS, taxRatePercent: 6, insuranceRatePercent: 5, hoaMonthly: 2000 } })).toBe(1264);
    // 20% down carries no mortgage insurance.
    expect(estimatedMonthlyPayment({ price: 170_000, ratePercent: 4.99, downPercent: 20, costs: NO_COSTS })).toBe(monthlyPrincipalAndInterest({ price: 170_000, ratePercent: 4.99, downPercent: 20 }));
    expect(estimatedMonthlyPayment({ price: 170_000, ratePercent: 4.99, downPercent: 20, costs: { ...NO_COSTS, mortgageInsuranceRatePercent: 0.55 } })).toBe(monthlyPrincipalAndInterest({ price: 170_000, ratePercent: 4.99, downPercent: 20 }));
    // VA has no monthly mortgage insurance at 0% down; FHA keeps its MIP even at 20% down.
    const mi = { ...NO_COSTS, mortgageInsuranceRatePercent: 0.55 };
    expect(estimatedMonthlyPayment({ price: 400_000, ratePercent: 5.5, downPercent: 0, loanType: "VA", costs: mi })).toBe(monthlyPrincipalAndInterest({ price: 400_000, ratePercent: 5.5, downPercent: 0 }));
    expect(estimatedMonthlyPayment({ price: 400_000, ratePercent: 5.5, downPercent: 0, loanType: "Conventional", costs: mi })).toBe(monthlyPrincipalAndInterest({ price: 400_000, ratePercent: 5.5, downPercent: 0 }) + 183);
    expect(estimatedMonthlyPayment({ price: 400_000, ratePercent: 5.5, downPercent: 20, loanType: "FHA", costs: mi })).toBe(monthlyPrincipalAndInterest({ price: 400_000, ratePercent: 5.5, downPercent: 20 }) + 147);
  });

  it("reads rates, down payments and lot sizes out of builder wording", () => {
    expect(percentFrom("4.999%")).toBe(4.999);
    expect(percentFrom("3.5% minimum down payment")).toBe(3.5);
    expect(percentFrom("5.25")).toBe(5.25);
    expect(percentFrom("call for details")).toBeNull();
    expect(mortgageRateFrom("0% down")).toBeNull();
    expect(mortgageRateFrom("100% financing")).toBeNull();
    expect(mortgageRateFrom("5.99% APR")).toBe(5.99);
    expect(acresFromText("Southeast San Antonio | Half-Acre Lots and Lakes")).toBe(0.5);
    expect(acresFromText("1/2 acre homesites")).toBe(0.5);
    expect(acresFromText("0.75-acre to 1.5 acres")).toBe(1.5);
    expect(acresFromText("quarter-acre lots")).toBe(0.25);
    expect(acresFromText("Acre lots with views")).toBe(1);
    expect(acresFromText("60 ft homesites")).toBeNull();
    expect(acresFromText(null)).toBeNull();
  });

  it("reads a lot size only where the text talks about lots, smallest first, and never a park", () => {
    expect(lotAcres("Southeast San Antonio | Half-Acre Lots and Lakes")).toBe(0.5);
    expect(lotAcres("0.15 to 0.5 acres", { field: true })).toBe(0.15);
    expect(lotAcres("Homesites from 0.15 to 0.5 acres")).toBe(0.15);
    expect(lotAcres("Homes by a 200-acre park")).toBeNull();
    expect(lotAcres("15 acres of trails and 0.25-acre lots")).toBe(0.25);
    expect(lotAcres("15 acres of trails")).toBeNull();
    expect(lotAcres("a 200-acre community with half-acre homesites")).toBe(0.5);
    // "Up to" promises nothing about the smallest lot.
    expect(lotAcres("lots up to 1 acre")).toBeNull();
    expect(lotAcres("Homesites up to 1 acre", { field: true })).toBeNull();
    expect(lotAcres("Lots from 0.25 up to 1 acre")).toBe(0.25);
    expect(lotAcres("0.52 acres", { field: true })).toBe(0.52);
    expect(lotAcres("40 acres", { field: true })).toBeNull();
    // A lot given in square feet is read in acres; a home's own lot field answers for the home, even when it says nothing usable.
    expect(lotAcres("6,500 sq ft", { field: true })).toBeCloseTo(0.149, 3);
    expect(lotAcres("21780 sqft", { field: true })).toBe(0.5);
    expect(lotAcres("Homesites of 7,200 square feet")).toBeCloseTo(0.165, 3);
    expect(homeLotAcres("6,500 sq ft", 0.5)).toBeCloseTo(0.149, 3);
    expect(homeLotAcres("corner homesite", 0.5)).toBeNull();
    expect(homeLotAcres("", 0.5)).toBe(0.5);
    expect(homeLotAcres(null, 0.5)).toBe(0.5);
  });

  it("reads down payments and keeps the loan program to a fixed list", () => {
    expect(downPaymentPercentFrom("3.5% minimum down payment")).toBe(3.5);
    expect(downPaymentPercentFrom("100% financing")).toBe(0);
    expect(downPaymentPercentFrom("$0 down")).toBe(0);
    expect(downPaymentPercentFrom("No down payment for VA")).toBe(0);
    expect(downPaymentPercentFrom("0% down")).toBe(0);
    expect(downPaymentPercentFrom("60% down")).toBeNull();
    expect(downPaymentPercentFrom("ask us")).toBeNull();
    expect(loanTypeLabel("Conventional with Pulte Mortgage")).toBe("Conventional");
    expect(loanTypeLabel("30-year fixed FHA through HomeAmerican Mortgage")).toBe("FHA");
    expect(loanTypeLabel("FHA or VA")).toBe("FHA/VA");
    expect(loanTypeLabel("Lennar Mortgage special")).toBeNull();
    // "100% financing" is no longer 100% down, so the payment is never $0.
    expect(offerFromIncentive({ headlineRate: "5.5%", followOnRate: null, loanType: "USDA", downPayment: "100% financing" })).toMatchObject({ downPercent: 0, loanType: "USDA" });
  });

  it("keeps Lennar out by default however the name is written, and nothing out for a blank entry", () => {
    expect(builderExcluded("Lennar", ["Lennar"])).toBe(true);
    expect(builderExcluded("Lennar Homes of Texas", ["lennar"])).toBe(true);
    expect(builderExcluded("Chesmar", ["Lennar"])).toBe(false);
    expect(builderExcluded("Chesmar", [" "])).toBe(false);
    expect(builderExcluded(["Manual", "Lennar Mortgage"], ["Lennar"])).toBe(true);
    expect(builderExcluded(["Manual", "www.lennar.com"], ["Lennar"])).toBe(true);
  });
});

describe("the meeting table", () => {
  it("never features a home without a garage, or one whose builder lists none (Peter, Oct 24)", () => {
    const offer = { ratePercent: 4.99, firstYearRatePercent: null, loanType: "FHA", downPercent: 3.5, aprPercent: 5.735 };
    const ranked = rankFeatured([
      candidate({ communityKey: "1", price: 205_090, garage: null, offer }),
      candidate({ communityKey: "2", price: 210_000, garage: "0", offer }),
      candidate({ communityKey: "3", price: 225_105, garage: "2", offer }),
      candidate({ communityKey: "4", price: 230_000, garage: "1 car", offer }),
    ], { marketRatePercent: 7.4, defaultDownPercent: 5 });
    expect(ranked.lowestPayment.map((deal) => deal.price)).toEqual([225_105, 230_000]);
    expect([garageSpaces("2"), garageSpaces("2.5"), garageSpaces("3-car"), garageSpaces(2), garageSpaces(null), garageSpaces("")]).toEqual([2, 2.5, 3, 2, null, null]);
  });

  it("picks the three lowest payments from three different communities, cheapest first", () => {
    const ranked = rankFeatured([
      candidate({ communityKey: "a", label: "A", price: 300_000, offer: at74 }),
      candidate({ communityKey: "a", label: "A", price: 280_000, card: "a2", offer: at74 }),
      candidate({ communityKey: "b", label: "B", price: 350_000, offer: { ratePercent: 4.999, firstYearRatePercent: null, loanType: "FHA", downPercent: 3.5 } }),
      candidate({ communityKey: "c", label: "C", price: 330_000, offer: at74 }),
      candidate({ communityKey: "d", label: "D", price: 290_000, offer: at74 }),
      candidate({ communityKey: "e", label: "Lennar place", price: 150_000, excluded: true, offer: at74 }),
      // No builder rate published: never featured at a market rate.
      candidate({ communityKey: "f", label: "No rate", price: 120_000 }),
    ], settings);
    // B's builder rate beats A's lower price; C is fourth and drops off.
    expect(ranked.lowestPayment.map((deal) => [deal.label, deal.estMonthly])).toEqual([["B", 1813], ["A", 1842], ["D", 1908]]);
    expect(ranked.lowestPayment[1]).toMatchObject({ label: "A", card: "a2", price: 280_000, downPercent: 5, rate: { ratePercent: 7.4, builderOffer: true } });
    expect([...ranked.lowestPayment, ranked.bestRate, ...ranked.bigLots].some((deal) => deal?.label === "No rate")).toBe(false);
    expect(ranked.lowestPayment.some((deal) => deal.label === "Lennar place")).toBe(false);
    expect(ranked.bestRate).toMatchObject({ label: "B", reason: "rate", rate: { ratePercent: 4.999, loanType: "FHA", builderOffer: true }, downPercent: 3.5 });
  });

  it("judges a community on its move-in-ready homes, and on plans only when it has none", () => {
    const ranked = rankFeatured([
      candidate({ communityKey: "a", label: "A", price: 450_000, offer: at74 }),
      candidate({ communityKey: "a", label: "A plan", price: 200_000, kind: "to_be_built", offer: at74 }),
      candidate({ communityKey: "b", label: "B plan", price: 300_000, kind: "to_be_built", offer: at74 }),
    ], settings);
    expect(ranked.lowestPayment.map((deal) => deal.label)).toEqual(["B plan", "A"]);
  });

  it("figures a buydown at its long-term rate and ranks the best rate on that", () => {
    const offer = offerFromIncentive({ headlineRate: "3.99%", followOnRate: "5.99%", loanType: "Conventional", downPayment: "5% down" });
    expect(offer).toEqual({ ratePercent: 5.99, firstYearRatePercent: 3.99, loanType: "Conventional", downPercent: 5 });
    expect(offerFromIncentive({ headlineRate: "4.999%", followOnRate: null, loanType: "FHA", downPayment: "3.5% minimum down payment" })).toEqual({ ratePercent: 4.999, firstYearRatePercent: null, loanType: "FHA", downPercent: 3.5 });
    expect(offerFromIncentive({ headlineRate: "Closing costs paid", followOnRate: null, loanType: null, downPayment: null })).toBeNull();
    expect(offerFromIncentive(undefined)).toBeNull();
    const ranked = rankFeatured([
      candidate({ communityKey: "a", label: "Buydown", offer }),
      candidate({ communityKey: "b", label: "Fixed", offer: { ratePercent: 5.5, firstYearRatePercent: null, loanType: "VA", downPercent: 0 } }),
    ], settings);
    expect(ranked.bestRate?.label).toBe("Fixed");
    expect(rateLine(ranked.lowestPayment.find((deal) => deal.label === "Buydown")!)).toBe("at 3.99% first year, then 5.99% Conventional, 5% down");
    expect(rateLine(ranked.bestRate!)).toBe("at 5.5% VA, 0% down");
    // A home whose builder publishes no rate is never priced at a market rate here: it is not featured.
    expect(rankFeatured([candidate({})], settings)).toMatchObject({ lowestPayment: [], bestRate: null, bigLots: [] });
  });

  it("lists big lots (half an acre and up) cheapest first, one per community", () => {
    const ranked = rankFeatured([
      candidate({ communityKey: "a", label: "Half acre", price: 500_000, acres: 0.5, offer: at74 }),
      candidate({ communityKey: "a", label: "Half acre", price: 520_000, acres: 0.5, offer: at74 }),
      candidate({ communityKey: "b", label: "Acre", price: 700_000, acres: 1, offer: at74 }),
      candidate({ communityKey: "c", label: "Small", price: 250_000, acres: 0.18, offer: at74 }),
    ], settings);
    expect(ranked.bigLots.map((deal) => [deal.label, deal.price])).toEqual([["Half acre", 500_000], ["Acre", 700_000]]);
    expect(rankFeatured([], settings)).toMatchObject({ lowestPayment: [], bestRate: null, bigLots: [], assumptions: { marketRatePercent: 7.4, defaultDownPercent: 5, termYears: 30 } });
  });
});

describe("Best Deals from the database, by viewer", () => {
  let db: FakeDealsDb;
  const community = (over: Partial<typeof dealCommunities.$inferInsert>) => db.seed(dealCommunities, {
    builder: "Chesmar", privateName: "Sienna Lakes", sourceUrl: "https://www.chesmar.com/x/", privateAddress: "100 Sienna Lakes Blvd", publicLabel: "Southeast San Antonio | Half-Acre Lots and Lakes", areaLabel: "Southeast San Antonio",
    amenities: "[]", reelCode: "sl1", scrubList: JSON.stringify({ community: ["Sienna Lakes"], street: ["Sienna Lakes Blvd"] }), active: true, paused: false, manualMode: false, ...over,
  });
  const home = (communityId: number, over: Partial<typeof dealHomes.$inferInsert>) => db.seed(dealHomes, { communityId, sourceKey: `home-${Math.random()}`, sourceUrl: "https://www.chesmar.com/x/h/", privateAddress: "118 Sienna Lakes Blvd", privatePlanName: "Brandon", kind: "quick_move_in", status: "available", origin: "official", price: 400_000, garage: "2", ...over });

  beforeEach(() => {
    db = new FakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    db.seed(dealSettings, { key: "builder_deals", value: JSON.stringify({ paymentMarketRate: 7.4, paymentDownPercent: 5, featuredExcludedBuilders: ["Lennar"], paymentTaxRate: 0, paymentInsuranceRate: 0, paymentHoaMonthly: 0, paymentMortgageInsuranceRate: 0 }) });
  });
  /** A live builder offer at 7.4% (with its APR) and no stated down payment. */
  const offer74 = (communityId: number) => db.seed(dealIncentives, { communityId, normalizedText: "o", publicText: "o", headlineRate: "7.4%", apr: "7.6%", confirmedAt: new Date(), active: true, held: false, manual: false });

  it("gives the landing page labels and payments only, the private list card handles, and the team names", async () => {
    const sienna = community({});
    const sourceKey = "sienna-118";
    home(sienna, { sourceKey, price: 499_990 });
    db.seed(dealIncentives, { communityId: sienna, normalizedText: "x", publicText: "x", headlineRate: "4.999%", apr: "5.737%", loanType: "FHA", downPayment: "3.5%", confirmedAt: new Date(), active: true, held: false, manual: false });
    const vista = community({ builder: "M/I Homes", privateName: "Vista Gardens", publicLabel: "Southeast San Antonio | New Phase Now Selling", scrubList: JSON.stringify({ community: ["Vista Gardens"] }) });
    home(vista, { price: 354_990, privateAddress: "9 Vista Way" });
    offer74(vista);
    const lennar = community({ builder: "Lennar", privateName: "Cheap Acres", publicLabel: "West San Antonio | Starter Homes", scrubList: "{}" });
    home(lennar, { price: 199_990, privateAddress: "1 Cheap Rd" });
    offer74(lennar);
    const paused = community({ privateName: "Paused Place", publicLabel: "North | Paused", paused: true, scrubList: "{}" });
    home(paused, { price: 150_000 });

    const pub = await featuredDeals("public");
    expect(pub.lowestPayment.map((deal) => deal.label)).toEqual(["Southeast San Antonio | New Phase Now Selling", "Southeast San Antonio | Half-Acre Lots and Lakes"]);
    const json = JSON.stringify(pub);
    for (const secret of ["Sienna Lakes", "Vista Gardens", "118 Sienna", "9 Vista", "Cheap", "Lennar", "Paused", "card", "detail", "chesmar.com"]) expect(json).not.toContain(secret);
    expect(pub.bestRate).toMatchObject({ label: "Southeast San Antonio | Half-Acre Lots and Lakes", rate: { ratePercent: 4.999, loanType: "FHA" }, downPercent: 3.5 });
    expect(pub.bigLots.map((deal) => deal.label)).toEqual(["Southeast San Antonio | Half-Acre Lots and Lakes"]);

    const gated = await featuredDeals({ view: "gated" });
    expect(gated.bestRate?.card).toBe(dealsCardHandle(`${sourceKey}`));
    expect(JSON.stringify(gated)).not.toContain("Sienna Lakes");
    expect(gated.bestRate).not.toHaveProperty("detail");

    const full = await featuredDeals({ view: "full", builderPages: true });
    expect(full.bestRate?.detail).toBe("Sienna Lakes · 118 Sienna Lakes Blvd");
  });

  it("keeps a hand-added (Manual) Lennar community out, found by its scrub names or its site", async () => {
    const byScrub = community({ builder: "Manual", privateName: "Cheap Acres", publicLabel: "West San Antonio | Starter Homes", sourceUrl: "https://example.com/cheap", scrubList: JSON.stringify({ builder: ["Lennar"] }) });
    home(byScrub, { price: 219_990 });
    offer74(byScrub);
    const bySite = community({ builder: "Manual", privateName: "Other Acres", publicLabel: "North San Antonio | Starter Homes", sourceUrl: "https://www.lennar.com/new-homes/texas/san-antonio/x", scrubList: "{}" });
    home(bySite, { price: 209_990 });
    offer74(bySite);
    const fair = community({ builder: "Manual", privateName: "Fair Place", publicLabel: "East San Antonio | New Homes", sourceUrl: "https://example.com/fair", scrubList: "{}" });
    home(fair, { price: 330_000 });
    offer74(fair);
    const pub = await featuredDeals("public");
    expect(pub.lowestPayment.map((deal) => deal.label)).toEqual(["East San Antonio | New Homes"]);
  });

  it("never shows a lender's name from a typed loan type, and never a lot bigger than the home's own", async () => {
    const pulte = community({ privateName: "Pulte Place", publicLabel: "North San Antonio | Homesites from 0.15 to 0.5 acres", scrubList: JSON.stringify({ lender: ["Pulte Mortgage"], builder: ["Pulte"] }) });
    home(pulte, { price: 350_000, lotSize: "0.15 acres" });
    db.seed(dealIncentives, { communityId: pulte, normalizedText: "x", publicText: "x", headlineRate: "4.99%", apr: "5.62%", loanType: "Conventional with Pulte Mortgage", downPayment: "5%", confirmedAt: new Date(), active: true, held: false, manual: false });
    for (const view of ["public", { view: "gated" as const }] as const) {
      const featured = await featuredDeals(view);
      expect(JSON.stringify(featured)).not.toMatch(/Pulte/i);
      expect(featured.bestRate).toMatchObject({ rate: { loanType: "Conventional" } });
      // The home's own 0.15-acre lot wins over the community's "up to 0.5 acres", so it is not a big lot.
      expect(featured.bestRate?.acres).toBe(0.15);
      expect(featured.bigLots).toEqual([]);
    }
    // A park in the label never makes a big lot either.
    const park = community({ privateName: "Park Place", publicLabel: "West San Antonio | Homes by a 200-acre park", scrubList: "{}" });
    home(park, { price: 360_000 });
    expect((await featuredDeals("public")).bigLots).toEqual([]);
  });

  it("gives the landing page the same price and size as the list (prices are public), never a card handle or a name", async () => {
    const id = community({});
    home(id, { price: 349_990, sqft: 2_318, lotSize: "0.52 acres" });
    offer74(id);
    const pub = await featuredDeals("public");
    expect(pub.lowestPayment[0]).toMatchObject({ price: 349_990, sqft: 2_318, acres: 0.52 });
    expect(pub.lowestPayment[0]?.estMonthly).toBe(monthlyPrincipalAndInterest({ price: 349_990, ratePercent: 7.4, downPercent: 5 }));
    expect(pub.lowestPayment[0]).not.toHaveProperty("card");
    expect(JSON.stringify(pub)).not.toMatch(/Sienna|Chesmar|chesmar\.com|118 Sienna/);
    expect(priceBandLabel(1_250_000)).toBe("$1.2M+");
    expect(decode(renderToStaticMarkup(React.createElement(FeaturedDeals, { featured: pub, locked: true })))).toContain("$349,990 · 2,318 sq ft");
  });

  it("gives every landing deal its own opaque key, so same-label, same-band communities stay apart and the key names no row", async () => {
    // Discovery labels hundreds of communities from a fixed vocabulary, so labels and bands repeat.
    const a = community({ publicLabel: "Northwest San Antonio | From the $300s", areaLabel: "Northwest San Antonio" });
    home(a, { price: 341_990 });
    offer74(a);
    const b = community({ publicLabel: "Northwest San Antonio | From the $300s", areaLabel: "Northwest San Antonio", sourceUrl: "https://www.chesmar.com/b/" });
    home(b, { price: 348_500 });
    db.seed(dealIncentives, { communityId: b, normalizedText: "r", publicText: "Rates as low as 7.25% FHA with 3.5% down", confirmedAt: new Date(), active: true, held: false, manual: false, headlineRate: "7.25%", apr: "7.9%" });
    const c = community({ publicLabel: "North San Antonio | Lakes", areaLabel: "North San Antonio", sourceUrl: "https://www.chesmar.com/c/" });
    home(c, { price: 360_000 });
    offer74(c);
    const pub = await featuredDeals("public");
    expect(pub.lowestPayment.map((deal) => deal.price)).toEqual([341_990, 348_500, 360_000]);
    const keys = [...pub.lowestPayment, pub.bestRate!].map((deal) => deal.key);
    expect(keys.every((key) => typeof key === "string" && /^[a-f0-9]{12}$/.test(key))).toBe(true);
    expect(new Set(pub.lowestPayment.map((deal) => deal.key)).size).toBe(3);
    // The best-rate home is the second same-label home, and only that row carries the tag.
    expect(dealKey(pub.bestRate!)).toBe(dealKey(pub.lowestPayment[1]!));
    expect(dealKey(pub.bestRate!)).not.toBe(dealKey(pub.lowestPayment[0]!));
    const html = decode(renderToStaticMarkup(React.createElement(FeaturedDeals, { featured: pub, locked: true })));
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).not.toContain("Best builder rate");
    expect(rows[1]).toContain('data-deals-featured-tag="Best builder rate"');
    expect(rows[1]).toContain("7.25%");
    expect(JSON.stringify(pub)).not.toMatch(new RegExp(`"key":"${a}"|k-|sourceKey`));
  });

  it("shows each featured home's cover photo: a public render by opaque key on the landing page, the lead's render on a private list", async () => {
    const id = community({});
    const homeId = home(id, { sourceKey: "with-photo", price: 300_000 });
    offer74(id);
    const shown = (sortOrder: number, over: Partial<typeof dealPhotos.$inferInsert> = {}) => db.seed(dealPhotos, { homeId, sourceUrl: `https://www.chesmar.com/p${sortOrder}.jpg`, sourceHash: `h${sortOrder}`, sortOrder, processingState: "processed", automaticHidden: false, adminHidden: false, nextProcessingAttemptAt: new Date(), ...over });
    shown(0, { automaticHidden: true });
    const cover = shown(1);
    shown(2);
    const other = community({ privateName: "No Photo Place", publicLabel: "North | No photo yet", scrubList: "{}" });
    home(other, { price: 310_000 });
    offer74(other);
    const pub = await featuredDeals("public");
    const withPhoto = pub.lowestPayment.find((deal) => deal.photo)!;
    // A sealed token that opens to the cover (the first photo not hidden); never the row id itself.
    const token = withPhoto.photo!.replace("/deals/pub/img/", "");
    expect(withPhoto.photo).toMatch(/^\/deals\/pub\/img\/[a-f0-9]{32}$/);
    expect(photoIdFromToken(token)).toBe(cover);
    expect(photoIdFromToken("a".repeat(32))).toBeNull();
    expect(photoIdFromToken("../etc/passwd")).toBeNull();
    expect(pub.lowestPayment.find((deal) => deal.label === "North | No photo yet")).not.toHaveProperty("photo");
    expect(JSON.stringify(pub)).not.toContain("/deals/mine/img/");
    const gated = await featuredDeals({ view: "gated" });
    expect(gated.lowestPayment.find((deal) => deal.photo)?.photo).toBe(`/deals/mine/img/${cover}`);
  });

  it("ranks a private list's strip among that list's homes only, so it is never short", async () => {
    const keys = ["a", "b", "c", "d"].map((letter, index) => {
      const id = community({ privateName: `Place ${letter}`, publicLabel: `Area ${letter} | New Homes`, scrubList: "{}" });
      home(id, { sourceKey: `key-${letter}`, price: 300_000 + index * 10_000 });
      offer74(id);
      return dealsCardHandle(`key-${letter}`);
    });
    // The cheapest community is not on this buyer's list.
    const onList = new Set(keys.slice(1));
    const featured = await featuredDeals({ view: "gated" }, { onlyCards: onList });
    expect(featured.lowestPayment.map((deal) => deal.label)).toEqual(["Area b | New Homes", "Area c | New Homes", "Area d | New Homes"]);
  });

  it("drops a community whose public label slipped a private name, and ignores a held or lapsed offer", async () => {
    const leaky = community({ publicLabel: "Sienna Lakes | Big Lots" });
    home(leaky, { price: 300_000 });
    offer74(leaky);
    const held = community({ privateName: "Held Place", publicLabel: "East | Held offer", scrubList: "{}" });
    home(held, { price: 320_000 });
    db.seed(dealIncentives, { communityId: held, normalizedText: "x", publicText: "x", headlineRate: "3.5%", confirmedAt: new Date(), active: true, held: true, manual: false });
    const lapsed = community({ privateName: "Old Place", publicLabel: "South | Old offer", scrubList: "{}" });
    home(lapsed, { price: 330_000 });
    db.seed(dealIncentives, { communityId: lapsed, normalizedText: "x", publicText: "x", headlineRate: "3.5%", confirmedAt: new Date(Date.now() - 60 * 86_400_000), active: true, held: false, manual: false });
    // A held or lapsed offer is no builder rate, so those homes are not featured at all (never at a market rate).
    const pub = await featuredDeals("public");
    expect(pub.lowestPayment).toEqual([]);
    expect(pub.bestRate).toBeNull();
    // The private list scrubs the slip exactly as its catalog does, so the deal stays, without the name.
    expect((await featuredDeals({ view: "gated" })).lowestPayment.map((deal) => deal.label)).toEqual(["this community | Big Lots"]);
    // The team sees the label the admin wrote, private names and all.
    expect((await featuredDeals({ view: "full", builderPages: true })).lowestPayment[0]?.label).toBe("Sienna Lakes | Big Lots");
  });
});

describe("the Best Deals strip", () => {
  const deals = rankFeatured([
    candidate({ communityKey: "a", label: "Southeast San Antonio | New Phase Now Selling", price: 354_990, beds: "4", sqft: 2_011, card: "card-a", offer: { ...at74, aprPercent: 7.6 } }),
    candidate({ communityKey: "b", label: "Southeast San Antonio | Half-Acre Lots and Lakes", price: 499_990, acres: 0.5, card: "card-b", offer: { ratePercent: 4.999, firstYearRatePercent: null, loanType: "FHA", downPercent: 3.5 } }),
  ], settings);

  it("locks every deal on the landing page and states the assumptions in plain words", () => {
    const html = decode(renderToStaticMarkup(React.createElement(FeaturedDeals, { featured: deals, locked: true })));
    expect(html).toContain("Best deals right now");
    expect(html).toContain("Ranked by estimated monthly payment");
    expect(html).toContain("Schedule a tour");
    expect(html).not.toContain("See this home");
    expect(html).toContain("$2,335");
    expect(html).toContain("$354,990 · 4 beds · 2,011 sq ft");
    expect(html).toContain("at 7.4% (7.6% APR), 5% down");
    expect(html).not.toContain("market rate");
    expect(html).toContain("at 4.999% FHA, 3.5% down · 0.5 acre lot");
    // The half-acre home wins all three ways: it is shown once, tagged, not repeated under its own headings.
    expect(html.match(/>Southeast San Antonio \| Half-Acre Lots and Lakes</g)).toHaveLength(1);
    expect(html).toContain('data-deals-featured-tag="Best builder rate"');
    expect(html).toContain('data-deals-featured-tag="Big lot"');
    expect(html).not.toContain(">Best builder rate</p>");
    expect(html).toContain("Estimated monthly mortgage payment on a 30-year loan: principal and interest, plus mortgage insurance when the loan carries it. Property taxes, home insurance and HOA dues are not included");
    expect(html).not.toMatch(/property tax at/i);
    expect(html).toContain("Builder rates apply to select homes with the builder's lender and qualifying credit. Not a commitment to lend.");
    expect(html).not.toContain("—");
    // A deal with a cover photo shows it on its card; one without shows none.
    const withPhoto = { ...deals, lowestPayment: deals.lowestPayment.map((deal, index) => index === 0 ? { ...deal, photo: "/deals/pub/img/abcdefabcdef" } : deal) };
    const photoHtml = renderToStaticMarkup(React.createElement(FeaturedDeals, { featured: withPhoto, locked: true }));
    expect(photoHtml.match(/data-deals-featured-photo="true"/g)).toHaveLength(1);
    expect(photoHtml).toContain('src="/deals/pub/img/abcdefabcdef"');
  });

  it("jumps to the home on the private list and renders nothing when there is nothing to rank", () => {
    const html = decode(renderToStaticMarkup(React.createElement(FeaturedDeals, { featured: deals })));
    expect(html).toContain("See this home");
    expect(html).toMatch(/min-h-11/);
    expect(renderToStaticMarkup(React.createElement(FeaturedDeals, { featured: rankFeatured([], settings) }))).toBe("");
    expect(renderToStaticMarkup(React.createElement(FeaturedDeals, { featured: undefined }))).toBe("");
  });
});

describe("Red Hot Deals (Oct 24, 2026)", () => {
  it("is a real price drop of at least $5,000 or 2%, whichever is more", async () => {
    const { redHotDeal } = await import("../shared/dealsFeatured");
    // D.R. Horton's red event cards: $275,950 was $318,500; $161,000 was $165,000 (only $4,000: not red hot).
    expect(redHotDeal(275_950, 318_500)).toEqual({ savings: 42_550, was: 318_500 });
    expect(redHotDeal(161_000, 165_000)).toBeNull();
    expect(redHotDeal(600_000, 610_000)).toBeNull(); // $10,000 is under 2% of $600,000
    expect(redHotDeal(600_000, 612_000)).toEqual({ savings: 12_000, was: 612_000 });
    expect(redHotDeal(300_000, null)).toBeNull();
    expect(redHotDeal(300_000, 290_000)).toBeNull();
  });
});
