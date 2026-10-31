import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { BROWSE_SORTS, EMPTY_FILTERS, PAYMENT_CAPS, PAYMENT_SORT, activeFilterCount, sortHomes } from "../client/src/lib/dealsBrowse";

const { byPayment, entryPayment } = await import("../client/src/components/deals/PublicHomeList");

const assumptions = { defaultDownPercent: 3.5, termYears: 30, costs: { taxRatePercent: 3, insuranceRatePercent: 1.2, hoaMonthly: 60, mortgageInsuranceRatePercent: 0.55 } };
const fha = { headlineRate: "4.99%", followOnRate: null, loanType: "FHA", downPayment: "3.5% down", apr: "5.62%" };
const entry = (key: string, price: number | null, incentive: unknown = fha) => ({ key, index: 0, community: { key, label: key, area: "Area", reelUrl: null, homesAvailable: 1, incentive } as never, home: { card: key, kind: "quick_move_in", price, beds: 3, baths: 2, sqft: 1800, garage: "2", photos: [] } as never });

/**
 * Oct 30, 2026 (ChatGPT's New Home Buddy comparison): shop by monthly payment, which only our site can offer.
 */
describe("max monthly payment and lowest-payment sort", () => {
  const cheap = entry("cheap", 250_000);
  const mid = entry("mid", 330_000);
  const dear = entry("dear", 450_000);
  const noRate = entry("norate", 200_000, null);

  it("figures the same payment the card shows", () => {
    expect(entryPayment(cheap, assumptions)).toBeGreaterThan(1000);
    expect(entryPayment(noRate, assumptions)).toBeNull();
    expect(entryPayment(cheap, null)).toBeNull();
  });

  it("keeps homes at or under the cap; a home with no builder-rate payment can't fit", () => {
    const capped = byPayment([dear, noRate, mid, cheap], { maxPayment: Math.ceil(entryPayment(mid, assumptions)!), sort: "recommended" }, assumptions);
    expect(capped.map((e) => e.key)).toEqual(["mid", "cheap"]);
  });

  it("orders by lowest payment, homes without one last, and leaves the list alone when unused", () => {
    expect(byPayment([dear, noRate, mid, cheap], { maxPayment: null, sort: "payment_asc" }, assumptions).map((e) => e.key)).toEqual(["cheap", "mid", "dear", "norate"]);
    expect(byPayment([dear, cheap], { maxPayment: null, sort: "recommended" }, assumptions).map((e) => e.key)).toEqual(["dear", "cheap"]);
  });

  it("counts as a filter, clears with the rest, and isn't offered where payments aren't known", () => {
    expect(EMPTY_FILTERS.maxPayment).toBeNull();
    expect(activeFilterCount({ ...EMPTY_FILTERS, maxPayment: 2000 })).toBe(1);
    expect(PAYMENT_SORT).toEqual({ value: "payment_asc", label: "Lowest payment" });
    expect(BROWSE_SORTS.some((s) => s.value === "payment_asc")).toBe(false);
    expect(PAYMENT_CAPS).toEqual([1500, 2000, 2500, 3000, 3500]);
    // other lists keep their recommended order under "Lowest payment"
    const homes = [{ kind: "x", price: 3 }, { kind: "x", price: 1 }, { kind: "x", price: 2 }];
    expect(sortHomes(homes, "payment_asc").map((h) => h.price)).toEqual([3, 1, 2]);
  });

  it("is wired on the public page: the Filters sheet, the sort, the map and the featured row", () => {
    const page = readFileSync(join(__dirname, "../client/src/components/deals/PublicDealsPage.tsx"), "utf-8");
    expect(page).toContain("<BrowseBar sheet payments={Boolean(assumptions)}");
    expect(page).toContain("(assumptions ? [...BROWSE_SORTS, PAYMENT_SORT] : BROWSE_SORTS)");
    expect(page).toContain("if (!savedOnly && paymentCap === null) return matching;");
    expect(page).toContain("&& (paymentCap === null || deal.estMonthly <= paymentCap)");
    const bar = readFileSync(join(__dirname, "../client/src/components/deals/BrowseBar.tsx"), "utf-8");
    expect(bar).toContain('{payments && <div className="col-span-2" data-deals-payment-filter="true">');
    expect(bar).toContain('maxPayment: "Max monthly payment"');
  });
});
