import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_BYTES, getDocument, loadOfficialDeals, type CommunitySourceConfig, type HtmlFetcher } from "./dealsAdapters";
import { parseCenturyCards } from "./dealsAdapters.century";
import { parseDreesAreaId, parseDreesNeighborhoods, parseDreesPage, resetDreesCaches, withParentAddress } from "./dealsAdapters.drees";
import { hakesComingSoon } from "./dealsAdapters.hakes";
import { parseHighlandSections } from "./dealsAdapters.highland";
import { legendApiUrl } from "./dealsAdapters.legend";
import { parsePerryDetail, perryHomeSold, resetPerrySitemapCache } from "./dealsAdapters.perry";
import { parseWeekleyNeighborhood, resetWeekleyCaches, weekleyListingUrl, weekleyPromotionsUrl } from "./dealsAdapters.weekley";
import { descendants, elementClass, elementText, parseHtmlElements } from "./dealsAdapters";

/**
 * Regression tests on the community pages the official sites served on
 * October 20, 2026, the day Builder Deals went live and the nightly sync held
 * these communities ("expected community container not found"). The fixtures
 * in fixtures/deals/live-2026-10-20/ are those captures (fetched with the
 * readers' own User-Agent), with scripts other than the data the readers use,
 * styles, inline SVG, comments and image source sets removed, then gzipped;
 * the markup the readers parse is as served. Pages the captures do not
 * include (Highland section pages, Weekley series pages) are synthetic and
 * built from the live card markup.
 */
const NOW = new Date("2026-10-20T12:00:00Z");
const live = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-10-20/${name}.html.gz`, import.meta.url))).toString("utf8");
type Site = Record<string, string | { status: number; body?: string; location?: string; type?: string }>;
function siteFetcher(site: Site) {
  const requested: string[] = [];
  const fetcher = vi.fn(async (input: string) => {
    requested.push(input);
    const entry = site[input];
    if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    if (typeof entry === "string") return new Response(entry, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response(entry.body ?? null, { status: entry.status, headers: { "content-type": entry.type ?? "text/html", ...(entry.location ? { location: entry.location } : {}) } });
  });
  return { fetcher: fetcher as unknown as HtmlFetcher, requested };
}
const publicJson = (result: Awaited<ReturnType<typeof loadOfficialDeals>>) => JSON.stringify(result.public);

beforeEach(() => { resetWeekleyCaches(); resetDreesCaches(); resetPerrySitemapCache(); });

describe("Highland Homes: the sectioned community page (October 20, 2026)", () => {
  const COMMUNITY = "https://www.highlandhomes.com/san-antonio/castroville/alsatian-oaks";
  const config: CommunitySourceConfig = { builder: "Highland Homes", sourceUrl: COMMUNITY, privateCommunityName: "Alsatian Oaks", scrubList: ["Alsatian Oaks", "White Oak", "Post Oak", "Castroville"] };

  it("reads every quick move-in home when each section's preview shows its whole count (Alsatian Oaks: 2 + 2)", async () => {
    const { fetcher, requested } = siteFetcher({ [COMMUNITY]: live("highland-alsatian-oaks") });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.garage, home.readyNow, home.moveInDate])).toEqual([
      ["255 White Oak, Castroville, TX 78009", "Denton Plan", "Quick Move-In (Move-In Ready)", 439_033, 4, 3, 2_241, 2, true, null],
      ["247 White Oak, Castroville, TX 78009", "Fordham Plan", "Quick Move-In (Move-In Ready)", 509_640, 4, 4, 3_010, 2, true, null],
      ["212 Post Oak, Castroville, TX 78009", "Chesterfield Plan", "Quick Move-In (November 2026)", 539_550, 4, 3.5, 2_905, 2, false, "November 2026"],
      ["112 Post Oak, Castroville, TX 78009", "Birchwood Plan", "Quick Move-In (November 2026)", 589_842, 4, 3.5, 2_822, 3, false, "November 2026"],
    ]);
    expect(result.private.homes[0]!.sourceUrl).toBe(`${COMMUNITY}/794-002`);
    expect(result.private.homes[0]!.gallery?.[0]?.sourceUrl).toMatch(/^https:\/\/media\.hhomesltd\.com\//);
    expect(result.private.plans).toEqual([]);
    const json = publicJson(result);
    for (const secret of ["Alsatian", "Highland", "White Oak", "Post Oak", "Castroville", "78009", "Denton", "794-002"]) expect(json).not.toContain(secret);
  });

  it("reads a section's own page when its preview shows fewer homes than it counts (Veramendi 70ft: 3 shown of 6), and holds when that page does not show them all", async () => {
    const VERAMENDI = "https://www.highlandhomes.com/san-antonio/new-braunfels/veramendi";
    const SECTION = `${VERAMENDI}/70ft-lots/section`;
    const page = live("highland-veramendi");
    const sections = parseHighlandSections(page, VERAMENDI, NOW)!;
    expect(sections.map((section) => [section.url, section.quickMoveIn, section.homes.length])).toEqual([[SECTION, 6, 3], [`${VERAMENDI}/12-acre-lots/section`, 0, 0]]);
    const veramendi: CommunitySourceConfig = { builder: "Highland Homes", sourceUrl: VERAMENDI, privateCommunityName: "Veramendi", scrubList: ["Veramendi", "Haecker View", "New Braunfels"] };
    const sectionPage = live("highland-veramendi-70ft");

    // Without the section page the run is held.
    const missing = siteFetcher({ [VERAMENDI]: page });
    const held = await loadOfficialDeals(veramendi, { fetcher: missing.fetcher, now: () => NOW });
    expect(held.holdReasons).toEqual(["detail_fetch_failed"]);
    expect(held.public.homes).toEqual([]);
    expect(missing.requested).toEqual([VERAMENDI, SECTION]);

    // The live section page (the older a.homeSpec cards, "6 quick move-in homes"): all six, each with its own figures.
    const whole = siteFetcher({ [VERAMENDI]: page, [SECTION]: sectionPage });
    const read = await loadOfficialDeals(veramendi, { fetcher: whole.fetcher, now: () => NOW });
    expect(read.holdReasons).toEqual([]);
    expect(whole.requested).toEqual([VERAMENDI, SECTION]);
    expect(read.private.homes.map((home) => [home.sourceUrl.slice(VERAMENDI.length), home.privateAddress, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.garage, home.moveInDate])).toEqual([
      ["/788-085", "1820 Haecker View, New Braunfels, TX 78132", 857_646, 4, 4.5, 3_610, 3, "December 2026"],
      ["/788-079", "1815 Haecker View, New Braunfels, TX 78132", 925_139, 5, 5.5, 4_098, 4, "December 2026"],
      ["/788-077", "1823 Haecker View, New Braunfels, TX 78132", 825_419, 4, 3.5, 3_042, 2, "December 2026"],
      ["/788-063", "805 Dagger Street, New Braunfels, TX 78132", 730_357, 4, 3.5, 2_870, 3, "January 2027"],
      ["/788-078", "1819 Haecker View, New Braunfels, TX 78132", 762_914, 4, 4.5, 3_050, 3, "January 2027"],
      ["/788-083", "1828 Haecker View, New Braunfels, TX 78132", 814_242, 4, 4.5, 3_048, 3, "January 2027"],
    ]);
    // The section page's card agrees with the community page's preview of the same lot.
    expect(read.private.homes.find((home) => home.sourceUrl.endsWith("/788-079"))).toMatchObject({ privateName: "1815 Haecker View", price: 925_139 });
    for (const secret of ["Veramendi", "Haecker", "Dagger", "New Braunfels", "78132", "Highland"]) expect(publicJson(read)).not.toContain(secret);

    // Five of six: never a sale of the sixth, the run is held.
    const short = siteFetcher({ [VERAMENDI]: page, [SECTION]: sectionPage.replace(/<a\s+href="\/san-antonio\/new-braunfels\/veramendi\/788-083"[\s\S]*?<\/a>/, "") });
    expect((await loadOfficialDeals(veramendi, { fetcher: short.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A section page in a layout the reader does not know (no cards): held.
    const reshaped = siteFetcher({ [VERAMENDI]: page, [SECTION]: "<html><body><div class=\"homes-app\"></div></body></html>" });
    expect((await loadOfficialDeals(veramendi, { fetcher: reshaped.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });

  it("never hands a card its neighbour's figures when a price attribute has a stray quote (data-price=857646\")", () => {
    // Browsers read `data-price=857646"` as an unquoted value; a tokenizer that opened a string at that quote swallowed
    // the card's own street and specs, and the next card's were read as its own (5 beds and 4,098 sq ft at $857,646).
    const sectionPage = live("highland-veramendi-70ft");
    expect(sectionPage).toContain('data-price=857646"');
    const root = parseHtmlElements(sectionPage)!;
    const cards = descendants(root).filter((element) => element.tag === "a" && elementClass(element, "homeSpec"));
    expect(cards.map((card) => card.attributes.href)).toHaveLength(6);
    expect(cards.map((card) => descendants(card).filter((element) => elementClass(element, "homeIdentifier")).map((element) => elementText(element, sectionPage)))).toEqual([["1820 Haecker View"], ["1815 Haecker View"], ["1823 Haecker View"], ["805 Dagger Street"], ["1819 Haecker View"], ["1828 Haecker View"]]);
    expect(parseHtmlElements('<div><i data-price=5" data-x="a>b">x</i><span class="s">y</span></div>')!.children[0]!.children.map((element) => [element.tag, element.attributes["data-price"], element.attributes["data-x"]])).toEqual([["i", "5\"", "a>b"], ["span", undefined, undefined]]);
  });

  it("still holds a page that lacks the container: no hero place line, or no sections and no cards", async () => {
    const noHero = siteFetcher({ [COMMUNITY]: live("highland-alsatian-oaks").replace(/<p class="secondLine">[^<]*<\/p>/g, "") });
    expect((await loadOfficialDeals(config, { fetcher: noHero.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // Another builder's page on the Highland URL is not a Highland community page.
    const foreign = siteFetcher({ [COMMUNITY]: live("century-senna") });
    expect((await loadOfficialDeals(config, { fetcher: foreign.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });
});

describe("Century Communities: the available and already-taken blocks (October 20, 2026)", () => {
  const AGAVE = "https://www.centurycommunities.com/find-your-new-home/texas/san-antonio-metro/san-antonio/agave/";
  const SENNA = "https://www.centurycommunities.com/find-your-new-home/texas/san-antonio-metro/leon-valley/senna/";
  const agaveConfig: CommunitySourceConfig = { builder: "Century Communities", sourceUrl: AGAVE, privateCommunityName: "Agave", scrubList: ["Agave", "Ocotillo Rdg", "Sahara Vlys"] };
  const sennaConfig: CommunitySourceConfig = { builder: "Century Communities", sourceUrl: SENNA, privateCommunityName: "Senna", scrubList: ["Senna", "Bufflehead Bend", "Teal Trace", "Leon Valley"] };

  it("Agave: the ProductGroup's 8 homes, the 4 reserved cards in ALREADY TAKEN not counted against them", async () => {
    const page = live("century-agave");
    const cards = parseCenturyCards(page, parseHtmlElements(page)!, AGAVE, NOW);
    expect([cards.availableCardCount, cards.available.length, cards.takenPaths.length]).toEqual([8, 8, 4]);
    const { fetcher } = siteFetcher({ [AGAVE]: page });
    const result = await loadOfficialDeals(agaveConfig, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toHaveLength(8);
    expect(result.private.homes.map((home) => home.privateName)).not.toContain("9228 Ocotillo Rdg");
    expect(result.private.homes.find((home) => home.privateName === "9208 Ocotillo Rdg")).toMatchObject({ price: 314_990, bedrooms: 4, bathrooms: 2.5, squareFeet: 2_260, status: "Quick Move-In (December 2026)", privatePlanName: "Frederick", privateAddress: "9208 Ocotillo Rdg, San Antonio, TX 78222" });
    expect(result.private.homes.every((home) => home.price !== null && home.price > 200_000 && home.price < 400_000 && (home.bedrooms ?? 0) >= 3 && (home.squareFeet ?? 0) >= 1_300)).toBe(true);
    for (const secret of ["Agave", "Ocotillo", "Century", "78222", "Frederick"]) expect(publicJson(result)).not.toContain(secret);
    // The cards say the same as the records: without the ProductGroup the available block alone reads the same 8 homes and prices.
    const withoutGroup = siteFetcher({ [AGAVE]: page.replace(/"@type":"ProductGroup"/, "\"@type\":\"Thing\"") });
    const fromCards = await loadOfficialDeals(agaveConfig, { fetcher: withoutGroup.fetcher, now: () => NOW });
    expect(fromCards.holdReasons).toEqual([]);
    expect(fromCards.private.homes.map((home) => [home.sourceUrl, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.status]).sort()).toEqual(result.private.homes.map((home) => [home.sourceUrl, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.status]).sort());
  });

  it("Senna: no ProductGroup on the page, so the 13 available cards are the inventory, with completion, plan and the price they dropped from", async () => {
    const { fetcher } = siteFetcher({ [SENNA]: live("century-senna") });
    const result = await loadOfficialDeals(sennaConfig, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toHaveLength(13);
    expect(result.private.homes[0]).toMatchObject({ privateAddress: "6566 Bufflehead Bend, Leon Valley, TX 78240", privatePlanName: "Avery", status: "Quick Move-In (Move-In Ready)", readyNow: true, price: 349_990, previousPrice: 396_836, priceDrop: 46_846, bedrooms: 3, bathrooms: 2.5, squareFeet: 1_681, garage: 2 });
    expect(result.private.homes.filter((home) => home.moveInDate).map((home) => home.moveInDate)).toEqual(expect.arrayContaining(["October 2026", "November 2026", "January 2027"]));
    expect(result.private.homes.every((home) => home.status !== null && home.price !== null && home.price >= 340_000 && home.price <= 400_000)).toBe(true);
    for (const secret of ["Senna", "Bufflehead", "Teal Trace", "Leon Valley", "Century", "Avery"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("holds when neither the ProductGroup nor an available block is there, and never reads a reserved card as for sale", async () => {
    const page = live("century-senna");
    const noBlock = siteFetcher({ [SENNA]: page.replace(/quick-move-in-commerce-container/g, "commerce-block") });
    expect((await loadOfficialDeals(sennaConfig, { fetcher: noBlock.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // The taken block retitled to wording the reader does not know: its cards count as for sale, and with no price they have no status (the sync holds the run).
    const retitled = siteFetcher({ [SENNA]: page.replace(/ALREADY TAKEN/, "Featured homes") });
    const result = await loadOfficialDeals(sennaConfig, { fetcher: retitled.fetcher, now: () => NOW });
    expect(result.private.homes).toHaveLength(16);
    expect(result.private.homes.filter((home) => home.status === null)).toHaveLength(3);
    expect(result.private.homes.filter((home) => home.status === null).every((home) => home.price === null)).toBe(true);
  });
});

describe("Ashton Woods: plan cards carry a property id too (October 20, 2026)", () => {
  const COMMUNITY = "https://www.ashtonwoods.com/san-antonio/arcadia-ridge";
  const config: CommunitySourceConfig = { builder: "Ashton Woods", sourceUrl: COMMUNITY, privateCommunityName: "Arcadia Ridge", scrubList: ["Arcadia Ridge", "Higgins Cove", "Hightower Ln"] };

  it("reads the 5 homes and 6 plans; the plan cards' ids are not counted as homes", async () => {
    const { fetcher } = siteFetcher({ [COMMUNITY]: live("ashton-arcadia-ridge") });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes.map((home) => [home.privateName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet])).toEqual([
      ["1223 Higgins Cove", "Quick Move-In (November 2026)", 382_990, 4, 3, 1_938],
      ["1266 Hightower Ln", "Quick Move-In (November 2026)", 430_990, 5, 3, 2_930],
      ["1243 Higgins Cove", "Quick Move-In (November 2026)", 369_990, 3, 2, 1_741],
      ["1262 Hightower Ln", "Quick Move-In (December 2026)", 404_990, 4, 2, 2_586],
      ["1252 Higgins Cove", "Quick Move-In (December 2026)", 459_990, 5, 3, 2_983],
    ]);
    expect(result.private.plans.map((plan) => [plan.privatePlanName, plan.price])).toEqual([["Sycamore", 350_740], ["Sage", 366_740], ["Willow", 375_740], ["Yaupon", 390_740], ["Laurel", 395_740], ["Iris", 405_740]]);
    for (const secret of ["Arcadia", "Higgins", "Hightower", "Ashton", "Sycamore", "78245"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("still holds when a home card loses the card class the reader reads (its property id still counts it)", async () => {
    const page = live("ashton-arcadia-ridge").replace('class="property-card js-property-card " data-property-id="24321"', 'class="property-card " data-property-id="24321"');
    const { fetcher } = siteFetcher({ [COMMUNITY]: page });
    const held = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
  });
});

describe("David Weekley: the neighborhood page behind the TX -> tx redirect (October 20, 2026)", () => {
  const HOST = "https://www.davidweekleyhomes.com";
  const CONFIGURED = `${HOST}/neighborhoods/TX/san-antonio/briggs-ranch`;
  const NEIGHBORHOOD = `${HOST}/neighborhoods/tx/san-antonio/briggs-ranch`;
  const SERIES_45 = `${HOST}/new-homes/tx/san-antonio/san-antonio/briggs-ranch-45`;
  const SERIES_60 = `${HOST}/new-homes/tx/san-antonio/san-antonio/briggs-ranch-60`;
  const CONFLUENCE = `${HOST}/neighborhoods/TX/san-antonio/confluence`;
  const CONFLUENCE_SERIES = `${HOST}/new-homes/tx/san-antonio/marion/confluence-select-reserve-series`;
  const config: CommunitySourceConfig = { builder: "David Weekley Homes", sourceUrl: CONFIGURED, privateCommunityName: "Briggs Ranch", scrubList: ["Briggs Ranch", "Hanging Willow", "Blackhaw Bend", "Mesquite Bloom", "Kissing Tree", "Ashland Flowers", "Sweet Acacia"] };
  // The market list and promotion list were not captured: synthetic, in the shape the reader has always read.
  const listing = JSON.stringify({ Communities: [{ Id: "communities/22915", Token: "/new-homes/tx/san-antonio/san-antonio/briggs-ranch-45", ShowcaseCount: 7 }, { Id: "communities/22916", Token: "/new-homes/tx/san-antonio/san-antonio/briggs-ranch-60", ShowcaseCount: 4 }, { Id: "communities/24417", Token: "/new-homes/tx/san-antonio/marion/confluence-select-reserve-series", ShowcaseCount: 8 }] });
  const promotions = JSON.stringify([{ Description: "Save $2,000 in flex dollars.", StartDate: "2026-01-05T00:00:00", EndDate: "2027-01-01T00:00:00", IsSiteWide: true, ShowOnCommunityIds: [] }]);
  const market: Site = {
    [weekleyListingUrl()]: { status: 200, body: listing, type: "application/json" },
    [weekleyPromotionsUrl()]: { status: 200, body: promotions, type: "application/json" },
  };
  const site = (overrides: Site = {}): Site => ({
    [CONFIGURED]: { status: 301, location: "/neighborhoods/tx/san-antonio/briggs-ranch" },
    [NEIGHBORHOOD]: live("david-briggs-ranch"),
    [SERIES_45]: live("weekley-briggs-ranch-45"), [SERIES_60]: live("weekley-briggs-ranch-60"),
    ...market, ...overrides,
  });

  it("parses the live neighborhood pages: each series' community page and its quick move-in count", () => {
    expect(parseWeekleyNeighborhood(live("david-briggs-ranch"), NEIGHBORHOOD)).toEqual({ name: "Briggs Ranch", series: [{ url: SERIES_45, quickMoveIns: 7 }, { url: SERIES_60, quickMoveIns: 4 }] });
    expect(parseWeekleyNeighborhood(live("david-confluence"), `${HOST}/neighborhoods/tx/san-antonio/confluence`)).toEqual({ name: "Confluence", series: [{ url: CONFLUENCE_SERIES, quickMoveIns: 8 }] });
    // A series page carries its page data: it is a community page, never a neighborhood.
    expect(parseWeekleyNeighborhood(live("weekley-briggs-ranch-45"), SERIES_45)).toBeNull();
  });

  it("Briggs Ranch: follows the same-host 301 and reads both live series pages as one community (7 + 4 homes)", async () => {
    const { fetcher, requested } = siteFetcher(site());
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested.slice(0, 4)).toEqual([CONFIGURED, NEIGHBORHOOD, SERIES_45, SERIES_60]);
    expect(result.private.homes.map((home) => [home.privateName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet])).toEqual([
      ["13224 Hanging Willow", "Quick Move-In (Move-In Ready)", 365_480, 3, 2, 1_891],
      ["13223 Hanging Willow", "Quick Move-In (November 2026)", 383_990, 3, 2, 1_661],
      ["13219 Hanging Willow", "Quick Move-In (November 2026)", 399_480, 3, 2, 2_093],
      ["13207 Hanging Willow", "Quick Move-In (December 2026)", 416_480, 4, 2.5, 2_728],
      ["4207 Blackhaw Bend", "Quick Move-In (Move-In Ready)", 419_480, 4, 3, 2_288],
      ["13203 Hanging Willow", "Quick Move-In (November 2026)", 424_670, 4, 3, 2_546],
      ["4203 Blackhaw Bend", "Quick Move-In (Move-In Ready)", 426_480, 4, 2.5, 2_748],
      ["13207 Mesquite Bloom", "Quick Move-In (November 2026)", 548_698, 4, 3, 2_450],
      ["13211 Mesquite Bloom", "Quick Move-In (November 2026)", 588_509, 5, 4.5, 3_698],
      ["4117 Kissing Tree", "Quick Move-In (November 2026)", 588_603, 4, 3.5, 2_877],
      ["13322 Ashland Flowers", "Quick Move-In (December 2026)", 616_335, 4, 3.5, 2_877],
    ]);
    expect(result.private.plans).toHaveLength(18);
    expect(result.private.plans.every((plan) => plan.price === null || (plan.price > 300_000 && plan.price < 900_000))).toBe(true);
    expect(result.private.incentive?.text).toContain("$2,000");
    for (const secret of ["Briggs", "Hanging Willow", "Blackhaw", "Mesquite Bloom", "Weekley", "78245", "Cassia"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("Confluence: one series behind the neighborhood page, 8 homes", async () => {
    const { fetcher } = siteFetcher({
      [CONFLUENCE]: { status: 301, location: "/neighborhoods/tx/san-antonio/confluence" },
      [`${HOST}/neighborhoods/tx/san-antonio/confluence`]: live("david-confluence"),
      [CONFLUENCE_SERIES]: live("weekley-confluence-select"),
      ...market,
    });
    const result = await loadOfficialDeals({ builder: "David Weekley Homes", sourceUrl: CONFLUENCE, privateCommunityName: "Confluence", scrubList: ["Confluence", "Merging Rivers", "Converge Ct"] }, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toHaveLength(8);
    expect(result.private.homes.every((home) => home.price !== null && home.price >= 400_000 && home.price < 500_000 && /^Quick Move-In \((?:November 2026|December 2026|January 2027)\)$/.test(home.status ?? ""))).toBe(true);
    expect(result.private.plans).toHaveLength(7);
  });

  it("holds when a series page is missing or shows fewer homes than the neighborhood counts, and never follows a redirect to another host", async () => {
    const noSeries = siteFetcher(site({ [SERIES_60]: { status: 404 } }));
    expect((await loadOfficialDeals(config, { fetcher: noSeries.fetcher, now: () => NOW })).holdReasons).toEqual(["community_fetch_failed"]);
    // The neighborhood counts one more home in the 60' series than its page shows: never a sale, the run is held.
    const short = siteFetcher(site({ [NEIGHBORHOOD]: live("david-briggs-ranch").replaceAll("Quick Move-ins (4)", "Quick Move-ins (5)") }));
    const held = await loadOfficialDeals(config, { fetcher: short.fetcher, now: () => NOW });
    expect(held.holdReasons).toEqual(["incomplete_inventory"]);
    expect(held.public.homes).toEqual([]);
    // A series page in another layout (no page data) is not a community page.
    const reshaped = siteFetcher(site({ [SERIES_45]: "<html><body><div id=\"app\"></div></body></html>" }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const offHost = siteFetcher({ [CONFIGURED]: { status: 301, location: "https://evil.example/neighborhoods/tx/san-antonio/briggs-ranch" } });
    expect((await loadOfficialDeals(config, { fetcher: offHost.fetcher, now: () => NOW })).holdReasons).toEqual(["unsupported_official_host"]);
    expect(offHost.requested).toEqual([CONFIGURED]);
  });
});

describe("Hakes Brothers: the coming-soon page wording (October 20, 2026)", () => {
  const COMMUNITY = "https://www.hakesbrothers.com/san-antonio/mesa-vista";
  const config: CommunitySourceConfig = { builder: "Hakes Brothers", sourceUrl: COMMUNITY, privateCommunityName: "Mesa Vista", scrubList: ["Mesa Vista"] };

  it("reads Mesa Vista ('Price Coming Soon', 'Interest List Now Forming', no home tabs) as a coming-soon community with nothing for sale", async () => {
    const page = live("hakes-mesa-vista");
    expect(hakesComingSoon(page)).toBe(true);
    const { fetcher } = siteFetcher({ [COMMUNITY]: page });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toEqual([]);
    expect(result.private.plans).toEqual([]);
  });

  it("reads Park Place, the same coming-soon page shape, the same way", async () => {
    const PARK = "https://www.hakesbrothers.com/san-antonio/park-place";
    const page = live("hakes-park-place");
    expect(hakesComingSoon(page)).toBe(true);
    const { fetcher } = siteFetcher({ [PARK]: page });
    const result = await loadOfficialDeals({ builder: "Hakes Brothers", sourceUrl: PARK, privateCommunityName: "Park Place", scrubList: ["Park Place"] }, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toEqual([]);
  });

  it("still holds a tab-less page that does not say both: the cell alone, or the price line alone, is not proof", async () => {
    const page = live("hakes-mesa-vista");
    for (const variant of [page.replace("Interest List Now Forming", "Now Selling"), page.replace("Price Coming Soon", "From the $290s")]) {
      expect(hakesComingSoon(variant)).toBe(false);
      const { fetcher } = siteFetcher({ [COMMUNITY]: variant });
      expect((await loadOfficialDeals(config, { fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    }
  });
});

describe("Drees Custom Homes: a parent community listed without its sub-neighborhoods (October 20, 2026)", () => {
  const COMMUNITY = "https://www.dreeshomes.com/new-homes-san-antonio/san-antonio/comm-haby-hills/";
  const API = "https://www.dreeshomes.com/api/en/dreeshomes/";
  const json = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-10-20/${name}.json.gz`, import.meta.url))).toString("utf8");
  const config: CommunitySourceConfig = { builder: "Drees Custom Homes", sourceUrl: COMMUNITY, privateCommunityName: "Haby Hill", scrubList: ["Haby Hill", "Haby Hollow", "Habys Cove"] };
  /** The live answers: the page, GET areas, then the POSTs as the reader sends them (the market list with San Antonio's id, the homes and plans with Haby Hill's). */
  function dreesSite(overrides: { page?: string; community?: string } = {}) {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { contentId: number; pageSize: number; pageNumber: number } : null;
      requests.push(`${init?.method ?? "GET"} ${input}${body ? ` ${body.contentId}` : ""}`);
      const answer = (text: string) => new Response(text, { status: 200, headers: { "content-type": "application/json" } });
      if (input === COMMUNITY) return new Response(overrides.page ?? live("drees-haby-hill"), { status: 200, headers: { "content-type": "text/html" } });
      if (input === `${API}areas` && !body) return answer(json("drees-areas"));
      if (input === `${API}community` && body?.contentId === 310095 && body.pageSize === 1000) return answer(overrides.community ?? json("drees-community-310095"));
      if (input === `${API}qmi` && body?.contentId === 326325) return answer(json("drees-qmi-326325"));
      if (input === `${API}plan` && body?.contentId === 326325) return answer(json("drees-plan-326325"));
      return new Response("not found", { status: 404 });
    });
    return { fetcher: fetcher as unknown as HtmlFetcher, requests };
  }

  it("finds the live hold: the market list carries the parent row only (no address, no Haby Hill 50s/60s rows), which the address check refused", () => {
    expect(parseDreesPage(live("drees-haby-hill"))).toEqual({ contentId: 326325, parent: true, url: "/new-homes-san-antonio/san-antonio/comm-haby-hills/" });
    expect(parseDreesAreaId(json("drees-areas"))).toBe(310095);
    const rows = parseDreesNeighborhoods(json("drees-community-310095"), "www.dreeshomes.com")!;
    const parent = rows.find((row) => row.contentId === 326325)!;
    expect(parent).toMatchObject({ parent: true, qmiCount: 7, url: COMMUNITY, record: { name: "Haby Hill", street: null, zip: "78253" } });
    expect(rows.filter((row) => row.url.includes("comm-haby-hills/") && row.contentId !== 326325)).toEqual([]);
    expect(withParentAddress(rows).find((row) => row.contentId === 326325)!.record.street).toBeNull();
  });

  it("reads Haby Hill's 7 homes and 17 plans from the live API answers, the homes under its sub-neighborhoods", async () => {
    const { fetcher, requests } = dreesSite();
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requests).toEqual([`GET ${COMMUNITY}`, `GET ${API}areas`, `POST ${API}community 310095`, `POST ${API}qmi 326325`, `POST ${API}plan 326325`]);
    expect(result.private.homes.map((home) => [home.privateAddress, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.moveInDate])).toEqual([
      ["203 Haby Hollow, San Antonio, TX 78253", "Quick Move-In (November 2026)", 574_900, 5, 4.5, 3_615, "November 2026"],
      ["346 Haby Hollow, San Antonio, TX 78253", "Quick Move-In", 549_900, 5, 4.5, 3_102, null],
      ["375 Haby Hollow, San Antonio, TX 78253", "Quick Move-In (January 2027)", 499_900, 4, 3, null, "January 2027"],
      ["155 Habys Cove, San Antonio, TX 78253", "Quick Move-In (November 2026)", 549_900, 4, 3, 2_839, "November 2026"],
      ["264 Haby Hill, San Antonio, TX 78253", "Quick Move-In", 524_900, 4, 3.5, 3_240, null],
      ["305 Haby Hill, San Antonio, TX 78253", "Quick Move-In", 549_900, 4, 3, 2_852, null],
      ["221 Haby Hollow, San Antonio, TX 78253", "Quick Move-In", 424_900, 3, 2.5, 2_246, null],
    ]);
    expect(result.private.homes.every((home) => home.sourceUrl.startsWith(`${COMMUNITY}haby-hill-`))).toBe(true);
    expect(result.private.plans).toHaveLength(17);
    // A suppressed price stays hidden; the Wagner plan's "4 full and 4 half baths" (high 2) is not a count to publish.
    expect(result.private.plans.find((plan) => plan.privatePlanName === "Lewis")).toMatchObject({ price: null, bedrooms: 4, bathrooms: 3.5, squareFeet: 3_141 });
    expect(result.private.plans.find((plan) => plan.privatePlanName === "Wagner")).toMatchObject({ price: 705_900, bedrooms: 4, bathrooms: null, squareFeet: 3_822 });
    expect(result.private.incentive?.text).toContain("Save Your Way Up To $50,000!");
    for (const secret of ["Haby", "Drees", "78253", "Brendan", "Wagner"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("still holds a neighborhood (not a parent) whose row has no address, and a page the market list does not name", async () => {
    const neighborhood = dreesSite({ page: live("drees-haby-hill").replace("var isCommunityPage = true;", "var isNeighborhoodPage = true;") });
    expect((await loadOfficialDeals(config, { fetcher: neighborhood.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    resetDreesCaches(); // the market list is read once an hour
    const unlisted = dreesSite({ community: json("drees-community-310095").replace('"contentId":326325', '"contentId":1') });
    expect((await loadOfficialDeals(config, { fetcher: unlisted.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });
});

describe("Perry Homes: a sold home the sitemap still lists (October 20, 2026)", () => {
  const COMMUNITY = "https://www.perryhomes.com/new-homes/texas/san-antonio/alsatian-oaks";
  const SOLD = `${COMMUNITY}/alsatian-oaks-50/173-mountain-oak`;
  const PLAN = `${COMMUNITY}/alsatian-oaks-50/2561h`;
  const config: CommunitySourceConfig = { builder: "Perry Homes", sourceUrl: COMMUNITY, privateCommunityName: "Alsatian Oaks", scrubList: ["Alsatian Oaks", "Mountain Oak"] };
  const sitemap = gunzipSync(readFileSync(new URL("./fixtures/deals/live-2026-10-20/perry-sitemap-san-antonio.xml.gz", import.meta.url))).toString("utf8");
  /** The live sitemap cut to the pages captured on October 20 (the community, its collections and sales centers, the sold home, one plan). */
  const capturedSitemap = sitemap.replace(/<url>[\s\S]*?<\/url>/g, (entry) => /\/(?:173-mountain-oak|2561h|sales-center)<|alsatian-oaks(?:\/alsatian-oaks-\d\d)?<|perryhomes\.com\/<|florida/.test(entry) ? entry : "");

  it("finds the live hold: the home page says it just sold and carries no home object, so the reader held the whole community", () => {
    const page = live("perry-home-173-mountain-oak");
    expect(parsePerryDetail(page, SOLD)).toBeNull();
    expect(perryHomeSold(page, SOLD)).toBe(true);
    // A plan page is never a sold home, and it still reads.
    expect(perryHomeSold(live("perry-plan-2561h"), PLAN)).toBe(false);
    expect(parsePerryDetail(live("perry-plan-2561h"), PLAN)).toMatchObject({ kind: "plan", privatePlanName: "Design 2561H", price: 541_900, bedrooms: 4, bathrooms: 3, squareFeet: 2_561, garage: 2 });
    // The live sitemap still lists the sold home with the community's 16 homes and 44 plans.
    expect(sitemap).toContain("/alsatian-oaks-50/173-mountain-oak<");
  });

  it("leaves the sold home out (the sync marks it sold) and publishes the rest", async () => {
    const { fetcher, requested } = siteFetcher({ [COMMUNITY]: live("perry-alsatian-oaks"), "https://www.perryhomes.com/sitemap.xml": { status: 200, body: capturedSitemap, type: "application/xml" }, [SOLD]: live("perry-home-173-mountain-oak"), [PLAN]: live("perry-plan-2561h") });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY, "https://www.perryhomes.com/sitemap.xml", SOLD, PLAN]);
    expect(result.private.homes).toEqual([]);
    expect(result.private.plans.map((plan) => [plan.sourceUrl, plan.price, plan.bedrooms, plan.squareFeet])).toEqual([[PLAN, 541_900, 4, 2_561]]);
    for (const secret of ["Alsatian", "Mountain Oak", "Perry", "2561H"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("still holds a home page that has no home object and does not say it sold, and the community check still holds a page without its collections", async () => {
    const reshaped = live("perry-home-173-mountain-oak").replaceAll("but this home just sold.", "but this home is reserved.");
    expect(perryHomeSold(reshaped, SOLD)).toBe(false);
    const { fetcher } = siteFetcher({ [COMMUNITY]: live("perry-alsatian-oaks"), "https://www.perryhomes.com/sitemap.xml": { status: 200, body: capturedSitemap, type: "application/xml" }, [SOLD]: reshaped, [PLAN]: live("perry-plan-2561h") });
    const held = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(held.holdReasons).toEqual(["expected_detail_container_not_found"]);
    expect(held.public.plans).toEqual([]);
    for (const [name, slug] of [["perry-alsatian-oaks", "alsatian-oaks"], ["perry-esperanza", "esperanza"]] as const) {
      resetPerrySitemapCache();
      const url = `https://www.perryhomes.com/new-homes/texas/san-antonio/${slug}`;
      const passes = siteFetcher({ [url]: live(name) });
      expect((await loadOfficialDeals({ ...config, sourceUrl: url }, { fetcher: passes.fetcher, now: () => NOW })).holdReasons).toEqual(["sitemap_fetch_failed"]);
    }
  });
});

describe("official reads: redirects, refusals and the body bound", () => {
  it("follows a redirect on the official host, refuses one to another host before requesting it, and refuses a body over the bound without truncating it", async () => {
    const same = siteFetcher({ "https://www.highlandhomes.com/a": { status: 301, location: "/b" }, "https://www.highlandhomes.com/b": "<html>b</html>" });
    expect(await getDocument("https://www.highlandhomes.com/a", same.fetcher, "text/html", "www.highlandhomes.com")).toEqual({ ok: true, text: "<html>b</html>" });
    const away = siteFetcher({ "https://www.highlandhomes.com/a": { status: 302, location: "https://highlandhomes.example/b" } });
    expect(await getDocument("https://www.highlandhomes.com/a", away.fetcher, "text/html", "www.highlandhomes.com")).toMatchObject({ ok: false, redirectedOffOfficialHost: true });
    expect(away.requested).toEqual(["https://www.highlandhomes.com/a"]);
    // A huge answer is read as a stream and abandoned past the bound: refused, never cut to a partial page.
    const chunk = new Uint8Array(1_000_000).fill(97);
    let sent = 0;
    const huge = vi.fn(async () => new Response(new ReadableStream({ pull(controller) { if (sent > MAX_DOCUMENT_BYTES + 2_000_000) { controller.close(); return; } sent += chunk.length; controller.enqueue(chunk); } }), { status: 200 }));
    expect(await getDocument("https://www.highlandhomes.com/a", huge as unknown as HtmlFetcher, "text/html", "www.highlandhomes.com")).toMatchObject({ ok: false, redirectedOffOfficialHost: false, status: 200 });
    expect(sent).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES + 2 * chunk.length);
    // A real 495 KB page reads whole (the 64 KB source test is a diagnostic cap only).
    const page = live("century-senna");
    const big = siteFetcher({ "https://www.centurycommunities.com/x/": page });
    expect(await getDocument("https://www.centurycommunities.com/x/", big.fetcher, "text/html", "www.centurycommunities.com")).toEqual({ ok: true, text: page });
  });

  it("a site that refuses the reader (403) is held as such for the admin, never retried or worked around (Legend Homes)", async () => {
    const COMMUNITY = "https://www.livelegendhomes.com/communities/san-antonio/schertz-cibolo/bexar/converse/fixture-ranch";
    const refused = vi.fn(async () => new Response("Forbidden", { status: 403 }));
    const result = await loadOfficialDeals({ builder: "Legend Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Ranch", scrubList: ["Fixture Ranch"] }, { fetcher: refused as unknown as HtmlFetcher, now: () => NOW });
    expect(result.holdReasons).toEqual(["source_access_refused"]);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(refused.mock.calls[0]![0]).toBe(legendApiUrl("public-epcon/community/state/region/county/city/by-name-v2?state=texas&region=schertz-cibolo&county=bexar&city=converse&name=fixture-ranch"));
    expect((refused.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "User-Agent": "LifestyleDesignRealtyDeals/1.0 (read-only official-page parser)" });
  });
});
