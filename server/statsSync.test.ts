import { describe, expect, it } from "vitest";
import { computeStats, fmtShort, statsToRows } from "./statsSync";

const stageIds = new Set([25, 26]);

function deal(stageId: number, price: number, id = Math.random()) {
  return { id, stageId, price };
}

describe("statsSync.computeStats", () => {
  it("computes stats from closed deals only", () => {
    const deals = [
      deal(25, 300_000),
      deal(25, 450_000),
      deal(26, 200_000),
      deal(26, 885_000),
      deal(25, 350_000),
      deal(1, 999_999), // not a closed stage — excluded
    ];
    const s = computeStats(deals, stageIds);
    expect(s).not.toBeNull();
    expect(s!.closedSales).toBe(5);
    expect(s!.totalValue).toBe(2_185_000);
    expect(s!.minPrice).toBe(200_000);
    expect(s!.maxPrice).toBe(885_000);
    expect(s!.avgPrice).toBe(437_000);
  });

  it("excludes sub-$50k artifacts from price range but counts them in sales/total", () => {
    const deals = [
      deal(25, 1_465), // referral-fee artifact
      deal(25, 300_000),
      deal(25, 400_000),
      deal(25, 500_000),
      deal(25, 600_000),
      deal(25, 700_000),
    ];
    const s = computeStats(deals, stageIds);
    expect(s).not.toBeNull();
    expect(s!.closedSales).toBe(6); // artifact still counts as a closed transaction
    expect(s!.minPrice).toBe(300_000); // but not in the price range
  });

  it("returns null on thin data so last-known values are preserved", () => {
    expect(computeStats([deal(25, 300_000)], stageIds)).toBeNull();
    expect(computeStats([], stageIds)).toBeNull();
  });
});

describe("statsSync.fmtShort", () => {
  it("formats compactly like the existing strip", () => {
    expect(fmtShort(16_516_348)).toBe("$16.5M");
    expect(fmtShort(26_000_000)).toBe("$26M");
    expect(fmtShort(424_400)).toBe("$424K");
    expect(fmtShort(885_000)).toBe("$885K");
    expect(fmtShort(50_000)).toBe("$50K");
  });
});

describe("statsSync.statsToRows", () => {
  it("produces the four labeled rows in order", () => {
    const rows = statsToRows({
      closedSales: 67,
      totalValue: 16_516_348,
      minPrice: 200_000,
      maxPrice: 885_000,
      avgPrice: 424_400,
    });
    expect(rows.map((r) => r.label)).toEqual([
      "Closed Sales",
      "Total Value",
      "Price Range",
      "Average Price",
    ]);
    expect(rows[1]!.value).toBe("$16.5M");
    expect(rows[2]!.value).toBe("$200K–$885K");
  });
});
