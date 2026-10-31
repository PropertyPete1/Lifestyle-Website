import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const { featuredForSearch, FEATURED_COPY } = await import("../client/src/components/deals/FeaturedDeals");

const deal = (key: string, price: number, reason: "payment" | "rate" | "lot" = "payment") => ({
  reason, label: key, area: "Area", price, kind: "quick_move_in", estMonthly: 2000, downPercent: 3.5, acres: reason === "lot" ? 0.5 : null,
  rate: { ratePercent: 4.99, builderOffer: true, firstYearRatePercent: null, aprPercent: 5.6, loanType: "FHA" } as never, key, landingKey: key,
});
const featured = {
  lowestPayment: [deal("a", 310_000), deal("b", 350_000)],
  bestRate: deal("c", 380_000, "rate"),
  bigLots: [deal("d", 390_000, "lot")],
  assumptions: { marketRatePercent: 7, defaultDownPercent: 3.5, termYears: 30, costs: { taxRatePercent: 3, insuranceRatePercent: 1.2, hoaMonthly: 60, mortgageInsuranceRatePercent: 0.55 } },
  priceRange: { min: 300_000, max: 400_000 },
} as never;

/**
 * Oct 30, 2026 (ChatGPT's New Home Buddy comparison): "Austin + under $200K still promotes New Braunfels deals at
 * $300K to $400K". The featured row follows the buyer's search, or says it's outside it.
 */
describe("featured row and the buyer's search", () => {
  it("is unchanged when the buyer isn't searching", () => {
    const out = featuredForSearch(featured, false, () => false);
    expect(out.featured).toBe(featured);
    expect(out.eyebrow).toBeUndefined();
  });

  it("keeps only the deals that fit, headed 'matching your search'", () => {
    const out = featuredForSearch(featured, true, (d) => d.landingKey === "b" || d.landingKey === "d");
    expect(out.eyebrow).toBe(FEATURED_COPY.matching);
    expect((out.featured as { lowestPayment: Array<{ key: string }> }).lowestPayment.map((d) => d.key)).toEqual(["b"]);
    expect((out.featured as { bestRate: unknown }).bestRate).toBeNull();
    expect((out.featured as { bigLots: Array<{ key: string }> }).bigLots.map((d) => d.key)).toEqual(["d"]);
  });

  it("keeps every deal when none fit, headed 'outside your search'", () => {
    const out = featuredForSearch(featured, true, () => false);
    expect(out.featured).toBe(featured);
    expect(out.eyebrow).toBe(FEATURED_COPY.outside);
    expect(FEATURED_COPY.matching).toBe("Best deals matching your search");
    expect(FEATURED_COPY.outside).toBe("Best deals outside your search");
  });

  it("is wired on the public page: results, the map area and the home's own filters decide a fit", () => {
    const src = readFileSync(join(__dirname, "../client/src/components/deals/PublicDealsPage.tsx"), "utf-8");
    expect(src).toContain("return featuredForSearch(featured, active > 0 || areaKeys !== null, fits);");
    expect(src).toContain("inResults.has(deal.landingKey) && (!areaKeys || areaKeys.has(deal.landingKey))");
    expect(src).toContain("homePasses({ kind: deal.kind, price: deal.price");
    expect(src).toContain("<FeaturedStrip compact featured={strip?.featured} eyebrow={strip?.eyebrow} opens");
  });

  it("shows only the saved homes' communities on the map in the saved view (Oct 30)", () => {
    const src = readFileSync(join(__dirname, "../client/src/components/deals/PublicDealsPage.tsx"), "utf-8");
    expect(src).toContain("const mapCommunities = useMemo(() => { if (!savedOnly) return matching;");
    expect(src).toContain("communities={mapCommunities} filters={filters}");
  });
});
