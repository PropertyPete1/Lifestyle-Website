import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DEALS_AUSTIN_URL, SITE, newConstructionUrlFor } from "../shared/site";
import { areaLabelFor, areaMarketName } from "../shared/dealsArea";
import { EMPTY_FILTERS, dealsMarketFromSearch, landingMatches, marketFilters, pickedMarket, type BrowseFilters, type LandingHomeFacts } from "../client/src/lib/dealsBrowse";

/**
 * Nov 7, 2026 (Peter: "fix whatever is not supposed to happen"): the Austin city page and an Austin City Finder match
 * opened the deals on the San Antonio default. They now open /deals?market=austin: the list on the whole Austin area,
 * the intro naming Austin and the map on Austin. Every other city, and /deals itself, keeps its default.
 */
(globalThis as { React?: typeof React }).React = React;
const { PublicDealsPage, PUBLIC_PAGE_COPY } = await import("../client/src/components/deals/PublicDealsPage");
const { publicHomeEntries } = await import("../client/src/components/deals/PublicHomeList");
const { REGION_VIEW } = await import("../client/src/components/deals/LandingBrowse");

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf-8");

/** Communities at real places, labelled by the same function the sync uses; each home has its own price so a page can be checked by price. */
const PLACES: Array<{ place: string; lat: number; lng: number; prices: number[] }> = [
  { place: "downtown Austin", lat: 30.2672, lng: -97.7431, prices: [512_301, 598_302] },
  { place: "north Austin", lat: 30.4, lng: -97.72, prices: [447_303] },
  { place: "Kyle", lat: 29.989, lng: -97.877, prices: [318_304, 341_305] },
  { place: "Georgetown", lat: 30.6333, lng: -97.677, prices: [402_306] },
  { place: "San Marcos", lat: 29.883, lng: -97.941, prices: [289_307, 305_308] },
  { place: "northwest San Antonio", lat: 29.55, lng: -98.6, prices: [276_401, 333_402] },
  { place: "New Braunfels", lat: 29.703, lng: -98.1245, prices: [361_403] },
  { place: "Boerne", lat: 29.7947, lng: -98.732, prices: [489_404] },
  { place: "south San Antonio", lat: 29.33, lng: -98.49, prices: [239_405, 251_406] },
];
const facts = (price: number): LandingHomeFacts => [price, 3, 2, 1_800, 2, 0, 1, null, null, 0, null];
const COMMUNITIES = PLACES.map((spot, index) => ({
  key: `a1b2c3d4e5${String(index).padStart(2, "0")}`,
  label: `Community ${index + 1}`,
  area: areaLabelFor({ centroid: { lat: spot.lat, lng: spot.lng } }),
  fromPrice: Math.min(...spot.prices),
  fromPriceLabel: null,
  reelUrl: null,
  homesAvailable: spot.prices.length,
  pin: null,
  homeFacts: spot.prices.map(facts),
  updatedAt: "2026-11-07T12:00:00.000Z",
}));
const austinPrices = PLACES.slice(0, 5).flatMap((spot) => spot.prices);
const sanAntonioPrices = PLACES.slice(5).flatMap((spot) => spot.prices);
const money = (price: number) => `$${price.toLocaleString("en-US")}`;
const noHomes = () => ({ isLoading: false, data: [] });

/** A browser tab's storage for the page's own reads and writes (the test runs in node). */
function fakeTab(keptFilters: Partial<BrowseFilters> | null) {
  const store = new Map<string, string>();
  if (keptFilters) store.set("deals-public-filters", JSON.stringify(keptFilters));
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
  (globalThis as { window?: unknown }).window = { sessionStorage: storage, localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, location: { pathname: "/deals", search: "" } };
  return store;
}
const render = (props: Partial<React.ComponentProps<typeof PublicDealsPage>> = {}) =>
  renderToStaticMarkup(React.createElement(Router, { ssrPath: "/deals" }, React.createElement(PublicDealsPage, { communities: COMMUNITIES, useHomes: noHomes, onTour: () => undefined, ...props })));
/** The page's own result count line ("8 homes"). */
/** Text as React writes it into HTML (an apostrophe becomes &#x27;). */
const asHtml = (text: string) => text.replace(/'/g, "&#x27;");
const resultCount = (html: string) => html.match(/data-deals-result-count="true">([^<]+)</)?.[1];

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe("the Austin links", () => {
  it("open the deals on Austin from the Austin page and an Austin City Finder match; every other city keeps /deals", () => {
    expect(DEALS_AUSTIN_URL).toBe("/deals?market=austin");
    for (const city of ["Austin", "austin", " AUSTIN "]) expect(newConstructionUrlFor(city)).toBe("/deals?market=austin");
    for (const city of ["San Antonio", "san-antonio", "New Braunfels", "new-braunfels", "DFW", "dfw", "Houston", "East Austin", "", null, undefined]) expect(newConstructionUrlFor(city)).toBe(SITE.newConstructionUrl);
    expect(SITE.newConstructionUrl).toBe("/deals");
    // The city page (/:slug) and the City Finder's per-city link use it; the other New Construction links are unchanged.
    expect(read("client/src/pages/NeighborhoodDetail.tsx")).toContain("href={newConstructionUrlFor(hood.slug)}");
    expect(read("client/src/pages/CityFinder.tsx")).toContain("href={newConstructionUrlFor(c.name)}");
    expect(read("client/src/pages/CityFinder.tsx")).not.toContain("SITE.newConstructionUrl");
    for (const path of ["client/src/pages/Home.tsx", "client/src/components/SiteNav.tsx", "client/src/components/SiteFooter.tsx", "client/src/pages/Search.tsx", "client/src/pages/SearchComingSoon.tsx", "client/src/pages/Links.tsx"]) {
      expect(read(path)).toContain("SITE.newConstructionUrl");
      expect(read(path)).not.toContain("market=austin");
    }
    // The City Finder's Austin entry is the Austin page's slug.
    expect(read("client/src/pages/CityFinder.tsx")).toMatch(/name: "Austin",\s*\n\s*slug: "austin"/);
  });

  it("only ?market=austin opens on Austin", () => {
    expect(dealsMarketFromSearch("?market=austin")).toBe("Austin");
    expect(dealsMarketFromSearch("?market=Austin")).toBe("Austin");
    expect(dealsMarketFromSearch("?src=abc&market=austin")).toBe("Austin");
    for (const search of ["", "?market=", "?market=san-antonio", "?market=dfw", "?market=austin-tx", "?k=a1b2c3d4e5f6"]) expect(dealsMarketFromSearch(search)).toBeNull();
  });

  it("Landing reads ?market once, takes it off the address and hands it to the page", () => {
    const deals = read("client/src/pages/Deals.tsx");
    expect(deals).toContain("const [market] = useState(() => dealsMarketFromSearch(window.location.search));");
    expect(deals).toContain('url.searchParams.delete("market"); window.history.replaceState(');
    expect(deals).toContain("onTour={askForDetails} market={market} />");
    // The signed-in redirects, the gate and the agent links are untouched.
    expect(deals).toContain('window.location.assign(teamSession ? "/deals/team" : "/deals/mine");');
  });
});

describe("the Austin view lists Austin-area homes only", () => {
  it("the real area labels put each community in its market", () => {
    expect(COMMUNITIES.map((community) => community.area)).toEqual(["Central Austin", "North Austin", "Kyle", "Georgetown", "San Marcos", "Northwest San Antonio", "New Braunfels", "Boerne", "South San Antonio"]);
    expect(COMMUNITIES.slice(0, 5).every((community) => areaMarketName(community.area) === "Austin")).toBe(true);
    expect(COMMUNITIES.slice(5).every((community) => areaMarketName(community.area) === "San Antonio")).toBe(true);
  });

  it("the market filter keeps the Austin communities and their homes, and nothing from San Antonio", () => {
    const filters = marketFilters("Austin");
    expect(filters).toEqual({ ...EMPTY_FILTERS, area: "market:Austin" });
    const matching = COMMUNITIES.filter((community) => landingMatches(community as never, filters));
    expect(matching.map((community) => community.area)).toEqual(["Central Austin", "North Austin", "Kyle", "Georgetown", "San Marcos"]);
    const homes = publicHomeEntries(matching as never, filters).map((entry) => entry.home.price);
    expect([...homes].sort()).toEqual([...austinPrices].sort());
    expect(pickedMarket(filters.area)).toBe("Austin");
    expect(pickedMarket("Kyle")).toBe("Austin");
    expect(pickedMarket("Northwest San Antonio")).toBe("San Antonio");
    expect(pickedMarket("market:San Antonio")).toBe("San Antonio");
    expect(pickedMarket("")).toBeNull();
  });

  it("the page opened on Austin shows the Austin homes, the Austin intro and saves the Austin filters, even over stale San Antonio filters", () => {
    const tab = fakeTab({ area: "Northwest San Antonio", savedOnly: true, maxPrice: 300_000, sort: "price_desc" });
    const html = render({ market: "Austin" });
    expect(html).toContain(asHtml(PUBLIC_PAGE_COPY.introAustin));
    expect(html).not.toContain(asHtml(PUBLIC_PAGE_COPY.intro));
    expect(resultCount(html)).toBe(`${austinPrices.length} homes`);
    for (const price of austinPrices) expect(html).toContain(money(price));
    for (const price of sanAntonioPrices) expect(html).not.toContain(money(price));
    expect(JSON.parse(tab.get("deals-public-filters")!)).toEqual({ ...EMPTY_FILTERS, area: "market:Austin" });
  });

  it("normal /deals is unchanged: every area, the San Antonio intro, and filters kept from the visit still come back", () => {
    fakeTab(null);
    const all = render();
    expect(all).toContain(asHtml(PUBLIC_PAGE_COPY.intro));
    expect(all).not.toContain(asHtml(PUBLIC_PAGE_COPY.introAustin));
    expect(resultCount(all)).toBe(`${austinPrices.length + sanAntonioPrices.length} homes`);
    for (const price of [...austinPrices, ...sanAntonioPrices]) expect(all).toContain(money(price));

    fakeTab({ area: "Northwest San Antonio" });
    const kept = render();
    expect(kept).toContain(asHtml(PUBLIC_PAGE_COPY.intro));
    expect(resultCount(kept)).toBe("2 homes");
    expect(kept).toContain(money(276_401));
    expect(kept).not.toContain(money(512_301));

    // A visitor who picked Austin themselves on /deals (kept for the visit) reads the Austin intro too.
    fakeTab({ area: "market:Austin" });
    expect(render()).toContain(asHtml(PUBLIC_PAGE_COPY.introAustin));
  });

  it("an agent's own intro is never replaced", () => {
    fakeTab(null);
    const html = render({ market: "Austin", intro: "Hand-picked by Tiffany at Lifestyle Design Realty." });
    expect(html).toContain("Hand-picked by Tiffany at Lifestyle Design Realty.");
    expect(html).not.toContain(asHtml(PUBLIC_PAGE_COPY.introAustin));
  });

  it("the map opens on its own Austin quick jump for a page opened on Austin, and on San Antonio otherwise", () => {
    const austin = REGION_VIEW.jumps.find((spot) => spot.label === "Austin");
    expect(austin).toEqual({ label: "Austin", x: 0.7313, y: 0.2622, span: 0.36 });
    const page = read("client/src/components/deals/PublicDealsPage.tsx");
    expect(page).toContain('const AUSTIN_MAP_VIEW = REGION_VIEW.jumps.find((spot) => spot.label === "Austin") ?? null;');
    expect(page).toContain('const [mapOpenOn] = useState(() => (market === "Austin" ? AUSTIN_MAP_VIEW : null));');
    expect(page).toContain("mapOpenOn={mapOpenOn}");
    const map = read("client/src/components/deals/LandingBrowse.tsx");
    expect(map).toContain("const home = openOn ?? (now.w < 560 ? { ...REGION_VIEW.home, span: REGION_VIEW.home.span * 0.62 } : REGION_VIEW.home);");
    expect(map).toContain("openOn: mapOpenOn };");
  });
});
