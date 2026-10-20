import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, areaChoices, bedsFrom, dealSelection, gatedCommunityVisible, homesMatching, landingMatches, priceCapLabel } from "../client/src/lib/dealsBrowse";
import type { GatedCommunity, GatedLead } from "../client/src/components/deals/GatedCatalog";
import { browseOrder } from "./dealsService";

/**
 * Every community in the area on one page: the filters, the order (the reel
 * that brought the buyer first), and a long list that opens only what matters.
 */
(globalThis as { React?: typeof React }).React = React;
const { GatedCatalog } = await import("../client/src/components/deals/GatedCatalog");
const { ReelCard } = await import("../client/src/components/deals/shared");
const { createElement } = React;

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const lead: GatedLead = { display: "@demo_buyer", expiresAt: new Date(NOW + 3_600_000).toISOString(), name: "Demo", timeline: null, teamPreview: false };
const home = (card: string, over: Partial<GatedCommunity["homes"][number]> = {}) => ({ card: card.padEnd(20, "x"), kind: "quick_move_in", beds: "4", baths: "3", sqft: 2_000, price: 400_000, photos: [], ...over });
const community = (index: number, over: Partial<GatedCommunity> = {}): GatedCommunity => ({
  key: `k${index}`, label: `Area ${index % 3} | Homes ${index}`, area: ["North San Antonio", "New Braunfels", "Southeast San Antonio"][index % 3]!, reelUrl: null, incentive: null, areaMap: null, driveTimes: [],
  homes: [home(`h${index}a`, { price: 300_000 + index * 10_000 }), home(`h${index}b`, { kind: "to_be_built", beds: "3-5", price: 450_000 + index * 10_000 })], ...over,
});

describe("browse filters", () => {
  it("offers the areas on the list, most communities first, and readable price caps", () => {
    expect(areaChoices([{ area: "B" }, { area: "A" }, { area: "B" }, { area: " " }])).toEqual([{ area: "B", count: 2 }, { area: "A", count: 1 }]);
    expect(priceCapLabel(400_000)).toBe("$400K");
    expect(priceCapLabel(1_000_000)).toBe("$1M");
    expect(bedsFrom("3-5")).toBe(5);
    expect(bedsFrom(4)).toBe(4);
    expect(bedsFrom(null)).toBeNull();
  });

  it("matches a landing card on its area, starting price, homes ready now, builder rate and big lots", () => {
    const card = { area: "North San Antonio", label: "North San Antonio | Half-Acre Lots and Lakes", fromPrice: 420_000, homesAvailable: 0, incentive: { headlineRate: "4.99%" } };
    expect(landingMatches(card, EMPTY_FILTERS)).toBe(true);
    expect(landingMatches(card, { ...EMPTY_FILTERS, area: "New Braunfels" })).toBe(false);
    expect(landingMatches(card, { ...EMPTY_FILTERS, maxPrice: 400_000 })).toBe(false);
    expect(landingMatches(card, { ...EMPTY_FILTERS, maxPrice: 500_000, builderRate: true, bigLots: true })).toBe(true);
    expect(landingMatches(card, { ...EMPTY_FILTERS, moveInReady: true })).toBe(false);
    expect(landingMatches({ ...card, label: "North San Antonio | Trails" }, { ...EMPTY_FILTERS, bigLots: true })).toBe(false);
    // The landing card carries a band floor ("From the $300s" is 300,000), so "Under $300K" leaves out a community really starting at $309,990.
    expect(landingMatches({ ...card, fromPrice: 300_000 }, { ...EMPTY_FILTERS, maxPrice: 300_000 })).toBe(false);
    expect(landingMatches({ ...card, fromPrice: 290_000 }, { ...EMPTY_FILTERS, maxPrice: 300_000 })).toBe(true);
  });

  it("clears filters for a Best Deals tap only when they hide the community or the home itself, and turns to its page otherwise", () => {
    const list = Array.from({ length: 20 }, (_, index) => community(index));
    const all = list.map((_, index) => index);
    const shown = { many: true, pages: 1, visibleIndexes: all };
    // No filters: a home on page 2 turns the page; a home on page 1 changes nothing.
    expect(dealSelection(list, list[15]!.homes[0]!.card, EMPTY_FILTERS, shown)).toEqual({ index: 15, clearFilters: false, pages: 2 });
    expect(dealSelection(list, list[2]!.homes[0]!.card, EMPTY_FILTERS, shown)).toEqual({ index: 2, clearFilters: false, pages: null });
    // A price cap keeps community 2 on the list (its $320,000 home passes) but hides its $470,000 plan: tapping that plan clears the filters.
    const capped = { ...EMPTY_FILTERS, maxPrice: 400_000 };
    expect(dealSelection(list, list[2]!.homes[0]!.card, capped, shown)).toEqual({ index: 2, clearFilters: false, pages: null });
    expect(dealSelection(list, list[2]!.homes[1]!.card, capped, shown)).toEqual({ index: 2, clearFilters: true, pages: 1 });
    // An area filter that hides the whole community clears too, and lands on the page the community is on without filters.
    const visibleInArea = list.flatMap((entry, index) => entry.area === "New Braunfels" ? [index] : []);
    expect(dealSelection(list, list[15]!.homes[0]!.card, { ...EMPTY_FILTERS, area: "New Braunfels" }, { ...shown, visibleIndexes: visibleInArea })).toEqual({ index: 15, clearFilters: true, pages: 2 });
    // A card from no community on this list is left to the page to scroll to.
    expect(dealSelection(list, "elsewhere", EMPTY_FILTERS, shown)).toEqual({ index: -1, clearFilters: false, pages: null });
  });

  it("filters a private list's homes by price, bedrooms, move-in ready and lot, and drops communities with none left", () => {
    const lots = community(1, { lotSizes: "0.15 to 0.5 acres", homes: [home("big", { lotSize: "0.6 acres" }), home("small"), home("plan", { kind: "to_be_built", beds: "3-5", price: 380_000 })] });
    expect(homesMatching(lots, { ...EMPTY_FILTERS, bigLots: true }).map((row) => row.card.slice(0, 3))).toEqual(["big"]);
    expect(homesMatching(lots, { ...EMPTY_FILTERS, minBeds: 5 }).map((row) => row.card.slice(0, 4))).toEqual(["plan"]);
    expect(homesMatching(lots, { ...EMPTY_FILTERS, moveInReady: true, maxPrice: 390_000 })).toEqual([]);
    expect(gatedCommunityVisible(lots, { ...EMPTY_FILTERS, moveInReady: true, maxPrice: 390_000 })).toBe(false);
    expect(gatedCommunityVisible(lots, { ...EMPTY_FILTERS, builderRate: true })).toBe(false);
    expect(gatedCommunityVisible({ ...lots, incentive: { headlineRate: "5%" } } as GatedCommunity, { ...EMPTY_FILTERS, builderRate: true })).toBe(true);
  });
});

describe("list order", () => {
  it("puts the community whose reel brought the visitor first, then the ones with reels, then the rest", () => {
    const rows = [
      { id: 1, reelCode: "a1", reelUrl: null }, { id: 2, reelCode: "b2", reelUrl: "https://www.instagram.com/reel/x/" },
      { id: 3, reelCode: "c3", reelUrl: null }, { id: 4, reelCode: "d4", reelUrl: "https://www.instagram.com/reel/y/" },
    ];
    expect(browseOrder(rows, "C3").map((row) => row.id)).toEqual([3, 2, 4, 1]);
    expect(browseOrder(rows, null).map((row) => row.id)).toEqual([2, 4, 1, 3]);
    expect(browseOrder(rows, "nope").map((row) => row.id)).toEqual([2, 4, 1, 3]);
  });
});

describe("a long private list", () => {
  const render = (communities: GatedCommunity[]) => renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead, communities, now: NOW })));

  it("opens only the buyer's reel community, shows the rest as rows with a summary, and pages after 12", () => {
    const many = Array.from({ length: 20 }, (_, index) => community(index, index === 0 ? { fromYourReel: true, reelUrl: "https://www.instagram.com/reel/abc/" } : {}));
    const html = render(many);
    expect(html).toContain('data-deals-browse="true"');
    expect(html.match(/data-deals-community="open"/g)).toHaveLength(1);
    expect(html.match(/data-deals-community="closed"/g)).toHaveLength(11);
    expect(html).toContain("From your reel");
    expect(html).toContain("From $310,000 · 1 quick move-in");
    expect(html).toContain("Show 8 more of 8");
    expect(html).toContain("40 homes");
    // The open community's reel loads; nothing else on the page embeds Instagram.
    expect(html.match(/instagram-media/g)).toHaveLength(1);
  });

  it("keeps a short list exactly as before: every community open, no filters, no paging", () => {
    const html = render([community(1), community(2)]);
    expect(html).not.toContain('data-deals-browse="true"');
    expect(html.match(/data-deals-community="open"/g)).toHaveLength(2);
    expect(html).not.toContain("data-deals-show-more");
  });

  it("shows a reel cover that loads the embed only when tapped", () => {
    const deferred = renderToStaticMarkup(createElement(ReelCard, { reelUrl: "https://www.instagram.com/reel/abc/", label: "North | Homes", autoLoad: false }));
    expect(deferred).toContain('data-deals-reel-cover="true"');
    expect(deferred).toContain("Watch the video tour");
    expect(deferred).not.toContain("instagram-media");
    const loaded = renderToStaticMarkup(createElement(ReelCard, { reelUrl: "https://www.instagram.com/reel/abc/", label: "North | Homes" }));
    expect(loaded).toContain("instagram-media");
  });
});
