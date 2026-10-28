import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, PRICE_CAPS, activeFilterCount, areaChoices, areaGroups, areaMatches, districtChoices, bedsFrom, dealSelection, gatedCommunityVisible, homePasses, homesMatching, landingHome, landingMatches, moreFilterCount, monthsUntilMoveIn, newThisWeekKnown, priceCapLabel, storiesKnown, builderChoices, type LandingHomeFacts } from "../client/src/lib/dealsBrowse";
import { FIRST_SYNC_GRACE_MS, NEW_WINDOW_MS, newThisWeek } from "../shared/dealsFeatured";
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

describe("New Home Buddy style filters (Peter, Oct 25: price range, beds, baths, size, garage, stories, home type)", () => {
  // [price, beds, baths, sqft, garage, kind, stories, previous price]
  const oneStory: LandingHomeFacts = [329_990, 3, 2, 1_650, 2, 0, 1, null];
  const twoStory: LandingHomeFacts = [419_990, 5, 3.5, 2_900, 3, 0, 2, 459_990];
  const plan: LandingHomeFacts = [289_990, 4, 2, 1_900, 2, 1, null, null];
  const card = (homeFacts: LandingHomeFacts[], over: Record<string, unknown> = {}) => ({ area: "New Braunfels", label: "New Braunfels | Hill Country Views", fromPrice: 289_990, homesAvailable: 2, homeFacts, ...over });

  it("matches a community when one of its homes passes every home filter together", () => {
    const community = card([oneStory, twoStory]);
    expect(landingMatches(community, { ...EMPTY_FILTERS, stories: 1 })).toBe(true);
    expect(landingMatches(community, { ...EMPTY_FILTERS, stories: 1, minBeds: 4 })).toBe(false);
    expect(landingMatches(community, { ...EMPTY_FILTERS, stories: 2, minBeds: 4, minBaths: 3, minGarage: 3, minSqft: 2_500 })).toBe(true);
    expect(landingMatches(community, { ...EMPTY_FILTERS, minPrice: 400_000, maxPrice: 500_000 })).toBe(true);
    expect(landingMatches(community, { ...EMPTY_FILTERS, minPrice: 450_000 })).toBe(false);
    expect(landingMatches(community, { ...EMPTY_FILTERS, maxPrice: 300_000 })).toBe(false);
    // A Red Hot Deal only counts when that same home passes the other filters.
    expect(landingMatches(community, { ...EMPTY_FILTERS, redHot: true })).toBe(true);
    expect(landingMatches(community, { ...EMPTY_FILTERS, redHot: true, stories: 1 })).toBe(false);
  });

  it("tells move-in ready homes from homes to be built, and both together mean either", () => {
    expect(landingMatches(card([plan]), { ...EMPTY_FILTERS, moveInReady: true })).toBe(false);
    expect(landingMatches(card([plan]), { ...EMPTY_FILTERS, toBeBuilt: true })).toBe(true);
    expect(landingMatches(card([oneStory]), { ...EMPTY_FILTERS, toBeBuilt: true })).toBe(false);
    expect(landingMatches(card([oneStory]), { ...EMPTY_FILTERS, moveInReady: true, toBeBuilt: true })).toBe(true);
  });

  it("never shows a home whose builder does not list the fact asked for (no stories listed is not one story)", () => {
    expect(homePasses({ kind: "to_be_built", price: 300_000 }, { ...EMPTY_FILTERS, stories: 1 })).toBe(false);
    expect(homePasses({ kind: "to_be_built", price: 300_000 }, { ...EMPTY_FILTERS, minGarage: 2 })).toBe(false);
    expect(homePasses({ kind: "quick_move_in", price: 300_000, garage: "2 car", baths: "2.5" }, { ...EMPTY_FILTERS, minGarage: 2, minBaths: 2.5 })).toBe(true);
  });

  it("falls back to the card's own figures on a page from before the home facts", () => {
    expect(landingMatches(card([], { homeFacts: undefined }), { ...EMPTY_FILTERS, maxPrice: 300_000 })).toBe(true);
    expect(landingMatches(card([], { homeFacts: undefined, homesAvailable: 0 }), { ...EMPTY_FILTERS, moveInReady: true })).toBe(false);
  });

  it("shows the stories filter only once some home on the list has its stories from the builder", () => {
    expect(storiesKnown([card([plan])])).toBe(false);
    expect(storiesKnown([card([plan]), card([oneStory])])).toBe(true);
    expect(storiesKnown([{ homes: [{ stories: null }] }])).toBe(false);
    expect(storiesKnown([{ homes: [{ stories: 2 }] }])).toBe(true);
  });

  it("reads a builder's move-in text as months from now, and filters homes by max size and move-in month", () => {
    const now = new Date(2026, 9, 25);
    expect(monthsUntilMoveIn("Available Now", now)).toBe(0);
    expect(monthsUntilMoveIn("Move-In Ready", now)).toBe(0);
    expect(monthsUntilMoveIn("Nov 2026", now)).toBe(1);
    expect(monthsUntilMoveIn("Est. Completion - Feb '27", now)).toBe(4);
    expect(monthsUntilMoveIn("December, 2026", now)).toBe(2);
    expect(monthsUntilMoveIn("4 - 6 month build", now)).toBe(6);
    expect(monthsUntilMoveIn("Call for details", now)).toBeNull();
    expect(monthsUntilMoveIn(null, now)).toBeNull();
    const ready = { kind: "quick_move_in", price: 300_000, sqft: 1_800 };
    const later = { kind: "quick_move_in", price: 300_000, sqft: 2_600, moveInDate: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(new Date().getMonth() + 5) % 12]} ${new Date().getFullYear() + (new Date().getMonth() + 5 >= 12 ? 1 : 0)}` };
    const plan = { kind: "to_be_built", price: 280_000, sqft: 2_000 };
    expect(homePasses(ready, { ...EMPTY_FILTERS, maxSqft: 2_000 })).toBe(true);
    expect(homePasses(later, { ...EMPTY_FILTERS, maxSqft: 2_000 })).toBe(false);
    expect(homePasses(ready, { ...EMPTY_FILTERS, availableBy: 0 })).toBe(true);
    expect(homePasses(later, { ...EMPTY_FILTERS, availableBy: 3 })).toBe(false);
    expect(homePasses(later, { ...EMPTY_FILTERS, availableBy: 6 })).toBe(true);
    expect(homePasses(plan, { ...EMPTY_FILTERS, availableBy: 12 })).toBe(false);
    expect(activeFilterCount({ ...EMPTY_FILTERS, availableBy: 0 })).toBe(1);
    expect(moreFilterCount({ ...EMPTY_FILTERS, availableBy: 0, maxSqft: 2_000 })).toBe(2);
  });

  it("counts the filters, and the ones under More filters on that button", () => {
    const filters = { ...EMPTY_FILTERS, minPrice: 300_000, stories: 1 as const, minGarage: 3, toBeBuilt: true };
    expect(activeFilterCount(filters)).toBe(4);
    expect(moreFilterCount(filters)).toBe(3);
  });
});

describe("the builder filter (Peter, Oct 25: team only, like New Home Buddy for agents)", () => {
  const named = (index: number, builderName: string | null) => community(index, { details: builderName ? { builderName, communityName: `C${index}`, address: null } as never : null });
  it("narrows a team list to one builder and lists the builders by how many communities they have", () => {
    const list = [named(1, "D.R. Horton"), named(2, "Perry Homes"), named(3, "D.R. Horton"), named(4, null)];
    expect(builderChoices(list)).toEqual([{ builder: "D.R. Horton", count: 2 }, { builder: "Perry Homes", count: 1 }]);
    expect(list.filter((item) => gatedCommunityVisible(item, { ...EMPTY_FILTERS, builder: "D.R. Horton" })).length).toBe(2);
    expect(activeFilterCount({ ...EMPTY_FILTERS, builder: "Perry Homes" })).toBe(1);
  });

  it("shows the builder picker on a team list only, never on a buyer's list", () => {
    const many = Array.from({ length: 14 }, (_, index) => named(index, index % 2 ? "D.R. Horton" : "Perry Homes"));
    const team = renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead: { ...lead, teamPreview: true }, communities: many, now: NOW })));
    const buyer = renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead, communities: many.map((item) => ({ ...item, details: null })), now: NOW })));
    expect(team).toContain('data-deals-builder-filter="true"');
    expect(team).toContain("D.R. Horton (7)");
    expect(buyer).not.toContain("data-deals-builder-filter");
  });
});

describe("the area picker with two markets (Oct 25: Austin joined San Antonio)", () => {
  const items = [{ area: "Georgetown" }, { area: "Kyle" }, { area: "Kyle" }, { area: "North Austin" }, { area: "West San Antonio" }, { area: "Boerne" }, { area: "Northwest San Antonio" }, { area: "Southeast of Austin" }];
  it("groups areas by market, the city's own sides first then towns A to Z, with a whole-market choice", () => {
    const groups = areaGroups(items);
    expect(groups.map((group) => group.market)).toEqual(["San Antonio", "Austin"]);
    expect(groups[0]!.choices.map((choice) => choice.area)).toEqual(["Northwest San Antonio", "West San Antonio", "Boerne"]);
    expect(groups[1]!.choices.map((choice) => choice.area)).toEqual(["North Austin", "Southeast of Austin", "Georgetown", "Kyle"]);
    expect(groups[1]!.total).toBe(5);
    expect(areaGroups([{ area: "Boerne" }]).map((group) => group.market)).toEqual(["San Antonio"]);
  });
  it("matches a whole market or one area", () => {
    expect(areaMatches("Kyle", "market:Austin")).toBe(true);
    expect(areaMatches("Boerne", "market:Austin")).toBe(false);
    expect(areaMatches("Boerne", "market:San Antonio")).toBe(true);
    expect(areaMatches("Kyle", "Kyle")).toBe(true);
    expect(areaMatches("Kyle", "Buda")).toBe(false);
    expect(areaMatches("Kyle", "")).toBe(true);
    expect(landingMatches({ area: "Kyle", label: "Kyle | x", homesAvailable: 1 }, { ...EMPTY_FILTERS, area: "market:Austin" })).toBe(true);
  });
});

describe("the school district filter (Oct 26: districts are clean, so buyers can pick one like on New Home Buddy)", () => {
  it("lists districts by how many communities they have and narrows both lists to one", () => {
    const items = [{ area: "Boerne", schoolDistrict: "Boerne ISD" }, { area: "West San Antonio", schoolDistrict: "Northside ISD" }, { area: "Northwest San Antonio", schoolDistrict: "Northside ISD" }, { area: "Kyle", schoolDistrict: null }];
    expect(districtChoices(items)).toEqual([{ district: "Northside ISD", count: 2 }, { district: "Boerne ISD", count: 1 }]);
    expect(items.filter((item) => landingMatches({ ...item, label: "x", homesAvailable: 1 }, { ...EMPTY_FILTERS, schoolDistrict: "Northside ISD" })).length).toBe(2);
    expect(gatedCommunityVisible(community(1, { schoolDistrict: "Boerne ISD" } as never), { ...EMPTY_FILTERS, schoolDistrict: "Boerne ISD" })).toBe(true);
    expect(gatedCommunityVisible(community(1, { schoolDistrict: "Boerne ISD" } as never), { ...EMPTY_FILTERS, schoolDistrict: "Comal ISD" })).toBe(false);
    expect(activeFilterCount({ ...EMPTY_FILTERS, schoolDistrict: "Comal ISD" })).toBe(1);
  });
});

describe("browse filters", () => {
  it("offers the areas on the list, most communities first, and readable price caps", () => {
    expect(areaChoices([{ area: "B" }, { area: "A" }, { area: "B" }, { area: " " }])).toEqual([{ area: "B", count: 2 }, { area: "A", count: 1 }]);
    expect(priceCapLabel(400_000)).toBe("$400K");
    expect(priceCapLabel(1_000_000)).toBe("$1M");
    expect(PRICE_CAPS[0]).toBe(200_000);
    expect(priceCapLabel(200_000)).toBe("$200K");
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

  it("narrows to the buyer's saved homes, alone or with other filters, and narrows nothing while nothing is saved", () => {
    const one = community(1);
    const two = community(2);
    const saved = new Set([one.homes[1]!.card]);
    const filters = { ...EMPTY_FILTERS, savedOnly: true };
    expect(homesMatching(one, filters, saved).map((row) => row.card)).toEqual([one.homes[1]!.card]);
    expect(gatedCommunityVisible(one, filters, saved)).toBe(true);
    expect(gatedCommunityVisible(two, filters, saved)).toBe(false);
    expect(gatedCommunityVisible(one, { ...filters, moveInReady: true }, saved)).toBe(false);
    expect(homesMatching(one, filters, new Set()).length).toBe(2);
    expect(gatedCommunityVisible(two, filters, new Set())).toBe(true);
    expect(gatedCommunityVisible(two, filters)).toBe(true);
    // A Best Deals tap on an unsaved home clears the saved-only filter so the home can be shown.
    expect(dealSelection([one, two], two.homes[0]!.card, filters, { many: false, pages: 1, visibleIndexes: [0] }, saved)).toMatchObject({ index: 1, clearFilters: true });
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

  it("lays a long list out like the landing page: cards beside one map, the reel's community first, 12 at a time (Oct 27)", () => {
    const many = Array.from({ length: 20 }, (_, index) => community(index, index === 0 ? { fromYourReel: true, reelUrl: "https://www.instagram.com/reel/abc/" } : {}));
    const html = render(many);
    expect(html).toContain('data-deals-browse="true"');
    expect(html.match(/data-deals-card="true"/g)).toHaveLength(12);
    expect(html).not.toContain('data-deals-community="open"');
    expect(html).toContain("From your reel");
    expect(html).toContain("From $310,000");
    expect(html).toContain("Show 8 more of 8");
    expect(html).toContain("40 homes");
    // No reel embeds on the list itself: a community's video loads when its sheet opens.
    expect(html.match(/instagram-media/g) ?? []).toHaveLength(0);
  });

  it("shows a Saved toggle with the count once the buyer has saved a home, and the under-$200K price choice", () => {
    const many = Array.from({ length: 20 }, (_, index) => community(index));
    const saved = [many[3]!.homes[0]!.card, many[7]!.homes[1]!.card];
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead, communities: many, now: NOW, saved })));
    expect(html).toContain('data-deals-filter="saved"');
    expect(html).toContain("Saved (2)");
    expect(html).toContain("Under $200K");
    expect(render(many)).not.toContain('data-deals-filter="saved"');
    // Saves of homes no longer on the list (sold, or a plan behind quick move-ins) are not counted, and alone they show no toggle.
    const withGone = renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead, communities: many, now: NOW, saved: [...saved, "gone-sold-home-xxxxx", "gone-plan-xxxxxxxxxx"] })));
    expect(withGone).toContain("Saved (2)");
    const allGone = renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead, communities: [many[3]!], now: NOW, saved: ["gone-sold-home-xxxxx"] })));
    expect(allGone).not.toContain('data-deals-filter="saved"');
    // With every saved home gone, the buyer is told why the Saved button is not there.
    expect(allGone).toContain("1 home you saved is no longer available.");
    // "Under $200K" is below the cap on both lists.
    expect(homesMatching(community(1, { homes: [home("cap", { price: 200_000 }), home("below", { price: 199_990 })] }), { ...EMPTY_FILTERS, maxPrice: 200_000 }).map((row) => row.card.slice(0, 5))).toEqual(["below"]);
    // A short list with a saved home gets the bar too, so the toggle is there.
    expect(renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead, communities: [many[3]!], now: NOW, saved: [many[3]!.homes[0]!.card] })))).toContain("Saved (1)");
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


describe("Oct 26, 2026: New this week", () => {
  const now = Date.parse("2026-10-26T18:00:00Z");
  const day = 24 * 60 * 60_000;
  it("marks a home first seen in the last 7 days, unless it came with the community's opening stock", () => {
    const opened = new Date(now - 30 * day);
    expect(newThisWeek(new Date(now - 2 * day), opened, now)).toBe(true);
    expect(newThisWeek(new Date(now - NEW_WINDOW_MS - 1), opened, now)).toBe(false);
    expect(newThisWeek(new Date(now + 1000), opened, now)).toBe(false);
    // The community was added 3 days ago and this home came in its first two days: stock, not an arrival.
    const young = new Date(now - 3 * day);
    expect(newThisWeek(new Date(young.getTime() + FIRST_SYNC_GRACE_MS - 1), young, now)).toBe(false);
    expect(newThisWeek(new Date(young.getTime() + FIRST_SYNC_GRACE_MS + 1000), young, now)).toBe(true);
    expect(newThisWeek(null, opened, now)).toBe(false);
    expect(newThisWeek("2026-10-25T00:00:00Z", null, now)).toBe(true);
  });
  it("filters on it, on the landing facts and on the private list, and the toggle shows only when something is new", () => {
    const facts: LandingHomeFacts = [300_000, 3, 2, 1_500, 2, 0, 1, null, null, 1];
    expect(landingHome(facts).isNew).toBe(true);
    expect(landingHome([300_000, 3, 2, 1_500, 2, 0, 1, null, null]).isNew).toBe(false);
    const filters = { ...EMPTY_FILTERS, newOnly: true };
    expect(homePasses({ kind: "quick_move_in", price: 300_000, isNew: true }, filters)).toBe(true);
    expect(homePasses({ kind: "quick_move_in", price: 300_000 }, filters)).toBe(false);
    expect(activeFilterCount(filters)).toBe(1);
    const base = { label: "A", area: "North San Antonio", homesAvailable: 2, reelUrl: null } as const;
    expect(landingMatches({ ...base, homeFacts: [facts] }, filters)).toBe(true);
    expect(landingMatches({ ...base, homeFacts: [[300_000, 3, 2, 1_500, 2, 0, 1, null, null, 0]] }, filters)).toBe(false);
    expect(landingMatches({ ...base, newThisWeek: 1 }, filters)).toBe(true);
    expect(landingMatches({ ...base, newThisWeek: 0 }, filters)).toBe(false);
    expect(newThisWeekKnown([{ newThisWeek: 0 }, { homes: [{ isNew: false }] }])).toBe(false);
    expect(newThisWeekKnown([{ newThisWeek: 0 }, { homes: [{ isNew: true }] }])).toBe(true);
  });
});

describe("Oct 26, 2026: sort order", () => {
  it("orders landing cards, private-list communities and homes; missing figures go last; recommended keeps the order", async () => {
    const { BROWSE_SORTS, sortGatedCommunities, sortHomes, sortLandingCommunities } = await import("../client/src/lib/dealsBrowse");
    expect(BROWSE_SORTS.map((option) => option.value)).toEqual(["recommended", "price_asc", "price_desc", "newest", "largest"]);
    const cards = [
      { label: "A", area: "x", homesAvailable: 1, reelUrl: null, fromPrice: 400_000, newThisWeek: 0, homeFacts: [[400_000, 3, 2, 2_000, 2, 0, 1, null, null, 0]] },
      { label: "B", area: "x", homesAvailable: 1, reelUrl: null, fromPrice: null, newThisWeek: 2, homeFacts: [[300_000, 3, 2, 1_500, 2, 0, 1, null, null, 1]] },
      { label: "C", area: "x", homesAvailable: 0, reelUrl: null, fromPrice: null, newThisWeek: 0, homeFacts: [] },
      { label: "D", area: "x", homesAvailable: 1, reelUrl: null, fromPrice: 350_000, newThisWeek: 1, homeFacts: [[350_000, 4, 3, 2_600, 2, 0, 2, null, null, 1]] },
    ] as const;
    const labels = (items: ReadonlyArray<{ label: string }>) => items.map((item) => item.label).join("");
    expect(labels(sortLandingCommunities(cards as never, "recommended"))).toBe("ABCD");
    expect(labels(sortLandingCommunities(cards as never, "price_asc"))).toBe("BDAC");
    expect(labels(sortLandingCommunities(cards as never, "price_desc"))).toBe("ADBC");
    expect(labels(sortLandingCommunities(cards as never, "newest"))).toBe("BDAC");
    expect(labels(sortLandingCommunities(cards as never, "largest"))).toBe("DABC");
    const homes = [{ kind: "q", price: 300_000, sqft: 1_800 }, { kind: "q", price: null, sqft: 2_400, isNew: true }, { kind: "q", price: 250_000, sqft: null }];
    expect(sortHomes(homes, "price_asc").map((home) => home.price)).toEqual([250_000, 300_000, null]);
    expect(sortHomes(homes, "price_desc").map((home) => home.price)).toEqual([300_000, 250_000, null]);
    expect(sortHomes(homes, "largest").map((home) => home.sqft)).toEqual([2_400, 1_800, null]);
    expect(sortHomes(homes, "newest")[0]!.isNew).toBe(true);
    const communities = [{ label: "A", homes: [{ kind: "q", price: 500_000, sqft: 3_000 }] }, { label: "B", homes: [{ kind: "q", price: 320_000, sqft: 1_700, isNew: true }, { kind: "q", price: 290_000, sqft: 1_600 }] }, { label: "C", homes: [] }];
    expect(labels(sortGatedCommunities(communities, "price_asc"))).toBe("BAC");
    expect(labels(sortGatedCommunities(communities, "largest"))).toBe("ABC");
    expect(labels(sortGatedCommunities(communities, "newest"))).toBe("BAC");
  });
});
