import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { homePrimaryDown } from "../shared/dealsHomeLayout";
import { landingHomeFacts } from "./dealsService";
import { EMPTY_FILTERS, activeFilterCount, homePasses, landingHome, landingMatches, moreFilterCount, type LandingHomeFacts } from "../client/src/lib/dealsBrowse";
import { decodeSharedFilters, encodeSharedFilters, sharedFiltersSummary } from "../client/src/lib/dealsListShare";
import { BrowseBar } from "../client/src/components/deals/BrowseBar";

(globalThis as { React?: typeof React }).React = React;

/** Oct 31, 2026 (Peter: "how can we add the master bed downstairs like the filter New Home Buddy has?" ... "Go"). */
describe("Primary bedroom downstairs", () => {
  it("every single-story home has it; otherwise the builder's word, or unknown", () => {
    expect(homePrimaryDown({ stories: 1, primaryDown: null })).toBe(true);
    expect(homePrimaryDown({ stories: 1, primaryDown: false })).toBe(true);
    expect(homePrimaryDown({ stories: 2, primaryDown: true })).toBe(true);
    expect(homePrimaryDown({ stories: 2, primaryDown: false })).toBe(false);
    expect(homePrimaryDown({ stories: 2, primaryDown: null })).toBeNull();
    expect(homePrimaryDown({ stories: null })).toBeNull();
  });

  it("rides in the landing card's facts (1 down, 0 up, null not said) and back out", () => {
    const base = { kind: "quick_move_in", price: 329_990, previousPrice: null, beds: "3", baths: "2", sqft: 1_800, garage: "2", moveInDate: null };
    expect(landingHomeFacts({ ...base, stories: 1 })[10]).toBe(1);
    expect(landingHomeFacts({ ...base, stories: 2, primaryDown: true })[10]).toBe(1);
    expect(landingHomeFacts({ ...base, stories: 2, primaryDown: false })[10]).toBe(0);
    expect(landingHomeFacts({ ...base, stories: null })[10]).toBeNull();
    expect(landingHome(landingHomeFacts({ ...base, stories: 2, primaryDown: true }) as LandingHomeFacts).primaryDown).toBe(true);
    // A page from before the fact still reads (its single-story homes still count).
    expect(landingHome([300_000, 3, 2, 1_500, 2, 0, 1, null]).primaryDown).toBeNull();
  });

  it("the filter keeps single-story homes and two-story homes with the primary down, and leaves out up or unknown", () => {
    const on = { ...EMPTY_FILTERS, primaryDown: true };
    expect(homePasses({ kind: "quick_move_in", stories: 1 }, on)).toBe(true);
    expect(homePasses({ kind: "quick_move_in", stories: 2, primaryDown: true }, on)).toBe(true);
    expect(homePasses({ kind: "quick_move_in", stories: 2, primaryDown: false }, on)).toBe(false);
    expect(homePasses({ kind: "quick_move_in", stories: 2 }, on)).toBe(false);
    expect(homePasses({ kind: "quick_move_in", stories: null }, on)).toBe(false);
    expect(homePasses({ kind: "quick_move_in", stories: 2 }, EMPTY_FILTERS)).toBe(true);
    const card = { area: "Seguin", label: "Seguin | Move-In Ready", homesAvailable: 2, homeFacts: [[300_000, 4, 2, 2_000, 2, 0, 2, null, null, 0, null], [320_000, 4, 3, 2_300, 2, 0, 2, null, null, 0, 1]] as LandingHomeFacts[] };
    expect(landingMatches(card, on)).toBe(true);
    expect(landingMatches({ ...card, homeFacts: [card.homeFacts[0]!] }, on)).toBe(false);
    expect(activeFilterCount(on)).toBe(1);
    expect(moreFilterCount(on)).toBe(1);
  });

  it("travels in an agent's client link and reads in its summary", () => {
    const filters = { ...EMPTY_FILTERS, primaryDown: true, minBeds: 4 };
    expect(decodeSharedFilters(encodeSharedFilters(filters).slice(2))?.primaryDown).toBe(true);
    expect(sharedFiltersSummary(filters)).toBe("4+ beds, primary bedroom downstairs");
  });

  it("the filters sheet offers it", () => {
    const html = renderToStaticMarkup(React.createElement(BrowseBar, { sheet: true, filters: EMPTY_FILTERS, onChange: () => undefined, areas: [], shown: 10, total: 10, unit: "homes", showStories: true }));
    expect(html).toContain('data-deals-filter="primary-down"');
    expect(html).toContain("Primary bedroom downstairs");
  });
});
