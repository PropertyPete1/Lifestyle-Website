import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_BYTES, getDocument, loadOfficialDeals, type CommunitySourceConfig, type HtmlFetcher } from "./dealsAdapters";
import { parseCenturyCards } from "./dealsAdapters.century";
import { parseDreesPage, resetDreesCaches } from "./dealsAdapters.drees";
import { hakesComingSoon } from "./dealsAdapters.hakes";
import { parseHighlandSections } from "./dealsAdapters.highland";
import { legendApiUrl } from "./dealsAdapters.legend";
import { resetPerrySitemapCache } from "./dealsAdapters.perry";
import { parseWeekleyNeighborhood, resetWeekleyCaches, weekleyListingUrl, weekleyPromotionsUrl } from "./dealsAdapters.weekley";
import { parseHtmlElements } from "./dealsAdapters";

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
    // The live preview cards, three more cloned under other lots: the section page in the card markup the community page uses.
    const cards = Array.from(page.matchAll(/<a\s+class="home-card[\s\S]*?<\/a>/g), (match) => match[0]);
    expect(cards).toHaveLength(3);
    const more = cards.map((card, index) => card.replace(/788-0\d\d/g, `788-1${index}0`).replace(/\d{4} Haecker View/, `19${index}0 Haecker View`));
    const sectionPage = (list: string[]) => `<!DOCTYPE html><html><body><h1><strong>Veramendi</strong></h1><p class="secondLine">New Braunfels, TX 78132</p><div class="card-grid">${list.join("\n")}</div></body></html>`;

    // Section page not captured on October 20: a missing page holds the run.
    const missing = siteFetcher({ [VERAMENDI]: page });
    const held = await loadOfficialDeals(veramendi, { fetcher: missing.fetcher, now: () => NOW });
    expect(held.holdReasons).toEqual(["detail_fetch_failed"]);
    expect(held.public.homes).toEqual([]);
    expect(missing.requested).toEqual([VERAMENDI, SECTION]);

    const whole = siteFetcher({ [VERAMENDI]: page, [SECTION]: sectionPage([...cards, ...more]) });
    const read = await loadOfficialDeals(veramendi, { fetcher: whole.fetcher, now: () => NOW });
    expect(read.holdReasons).toEqual([]);
    expect(read.private.homes).toHaveLength(6);
    expect(read.private.homes.map((home) => [home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.moveInDate])).toContainEqual([925_139, 5, 5.5, 4_098, "December 2026"]);
    expect(read.private.homes.every((home) => home.status === "Quick Move-In (December 2026)" && /, New Braunfels, TX 78132$/.test(home.privateAddress ?? ""))).toBe(true);

    // Five of six: never a sale of the sixth, the run is held.
    const short = siteFetcher({ [VERAMENDI]: page, [SECTION]: sectionPage([...cards, ...more.slice(0, 2)]) });
    expect((await loadOfficialDeals(veramendi, { fetcher: short.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A section page in a layout the reader does not know (no cards): held.
    const reshaped = siteFetcher({ [VERAMENDI]: page, [SECTION]: "<html><body><div class=\"homes-app\"></div></body></html>" });
    expect((await loadOfficialDeals(veramendi, { fetcher: reshaped.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
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
  const config: CommunitySourceConfig = { builder: "David Weekley Homes", sourceUrl: CONFIGURED, privateCommunityName: "Briggs Ranch", scrubList: ["Briggs Ranch", "Fixture Willow", "Sweet Acacia"] };
  /** A series community page with page data in the shape the reader has always read (synthetic: the series pages were not captured). */
  const seriesPage = (url: string, id: string, count: number, base: number) => {
    const path = new URL(url).pathname;
    const slug = path.split("/").at(-1)!;
    const homes = Array.from({ length: count }, (_, index) => ({
      Token: `/homes-ready-soon/tx/san-antonio/san-antonio/${slug}/2423${base + index}`, Name: "Cassia", CommunityId: id, IsModel: false, Hidden: false, Ready: true, LostReadyStatus: null,
      Address: { Line1: `${13200 + base + index} Fixture Willow`, City: "San Antonio", ZipCode: "78245" }, ReadyLabel: index % 2 ? "Ready Now" : "Ready 12/15/2026", ReadyDate: index % 2 ? "2026-07-31T00:00:00" : "2026-12-15T00:00:00",
      Price: 380_000 + index * 10_000, HideQmiPrice: false, SquareFootage: 1_900 + index * 50, Bedrooms: 3 + (index % 2), FullBaths: 2, HalfBaths: index % 2, Garages: 2, JobNumber: `2423${base + index}`, ExteriorPhotos: [], InteriorPhotos: [],
    }));
    const data = { communityName: `Briggs Ranch ${slug}`, communityId: id, communityAvailability: "Active", basePrice: 365_480, url: path, city: "San Antonio",
      salesOffices: [{ Address: "13222 Sweet Acacia<br />San Antonio, TX 78245", SearchableAddress: "29.39,-98.75" }],
      floorplans: [{ Name: "Cassia", Token: `${path}/cassia`, IsActive: true, BasePrice: 367_990, PriceDisplay: "$367,990", Bedrooms: { Minimum: 3 }, FullBaths: { Minimum: 2 }, HalfBaths: { Minimum: 0 }, SquareFootage: { Minimum: 1_652 }, Garages: { Minimum: 2 } }],
      quickMoveIns: homes };
    return `<!DOCTYPE html><html><body><script>window.pageData= ${JSON.stringify(data)};\r\n</script></body></html>`;
  };
  const listing = JSON.stringify({ Communities: [{ Id: "communities/22915", Token: "/new-homes/tx/san-antonio/san-antonio/briggs-ranch-45", ShowcaseCount: 7 }, { Id: "communities/22916", Token: "/new-homes/tx/san-antonio/san-antonio/briggs-ranch-60", ShowcaseCount: 4 }] });
  const promotions = JSON.stringify([{ Description: "Save $2,000 in flex dollars.", StartDate: "2026-01-05T00:00:00", EndDate: "2027-01-01T00:00:00", IsSiteWide: true, ShowOnCommunityIds: [] }]);
  const site = (series45: string, series60: string): Site => ({
    [CONFIGURED]: { status: 301, location: "/neighborhoods/tx/san-antonio/briggs-ranch" },
    [NEIGHBORHOOD]: live("david-briggs-ranch"),
    [SERIES_45]: series45, [SERIES_60]: series60,
    [weekleyListingUrl()]: { status: 200, body: listing, type: "application/json" },
    [weekleyPromotionsUrl()]: { status: 200, body: promotions, type: "application/json" },
  });

  it("parses the live neighborhood pages: each series' community page and its quick move-in count", () => {
    expect(parseWeekleyNeighborhood(live("david-briggs-ranch"), NEIGHBORHOOD)).toEqual({ name: "Briggs Ranch", series: [{ url: SERIES_45, quickMoveIns: 7 }, { url: SERIES_60, quickMoveIns: 4 }] });
    expect(parseWeekleyNeighborhood(live("david-confluence"), `${HOST}/neighborhoods/tx/san-antonio/confluence`)).toEqual({ name: "Confluence", series: [{ url: `${HOST}/new-homes/tx/san-antonio/marion/confluence-select-reserve-series`, quickMoveIns: 8 }] });
  });

  it("follows the same-host 301, reads both series as one community and publishes all 11 homes", async () => {
    const { fetcher, requested } = siteFetcher(site(seriesPage(SERIES_45, "communities/22915", 7, 0), seriesPage(SERIES_60, "communities/22916", 4, 50)));
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested.slice(0, 4)).toEqual([CONFIGURED, NEIGHBORHOOD, SERIES_45, SERIES_60]);
    expect(result.private.homes).toHaveLength(11);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.homes.filter((home) => home.readyNow)).toHaveLength(5);
    expect(result.private.homes.find((home) => !home.readyNow)).toMatchObject({ status: "Quick Move-In (December 2026)", moveInDate: "December 2026" });
    expect(result.private.incentive?.text).toContain("$2,000");
    for (const secret of ["Briggs", "Fixture Willow", "Weekley", "78245"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("holds when a series page is missing or shows fewer homes than the neighborhood counts, and never follows a redirect to another host", async () => {
    const noSeries = siteFetcher({ ...site(seriesPage(SERIES_45, "communities/22915", 7, 0), ""), [SERIES_60]: { status: 404 } });
    expect((await loadOfficialDeals(config, { fetcher: noSeries.fetcher, now: () => NOW })).holdReasons).toEqual(["community_fetch_failed"]);
    const short = siteFetcher(site(seriesPage(SERIES_45, "communities/22915", 6, 0), seriesPage(SERIES_60, "communities/22916", 4, 50)));
    const held = await loadOfficialDeals(config, { fetcher: short.fetcher, now: () => NOW });
    expect(held.holdReasons).toEqual(["incomplete_inventory"]);
    expect(held.public.homes).toEqual([]);
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

  it("still holds a tab-less page that does not say both: the cell alone, or the price line alone, is not proof", async () => {
    const page = live("hakes-mesa-vista");
    for (const variant of [page.replace("Interest List Now Forming", "Now Selling"), page.replace("Price Coming Soon", "From the $290s")]) {
      expect(hakesComingSoon(variant)).toBe(false);
      const { fetcher } = siteFetcher({ [COMMUNITY]: variant });
      expect((await loadOfficialDeals(config, { fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    }
  });
});

describe("Drees and Perry: the community pages still pass their checks (the holds are past them)", () => {
  it("Drees Haby Hill names itself a parent community with its own id and URL; its homes come from the site's API (not captured)", async () => {
    const page = live("drees-haby-hill");
    expect(parseDreesPage(page)).toEqual({ contentId: 326325, parent: true, url: "/new-homes-san-antonio/san-antonio/comm-haby-hills/" });
    const COMMUNITY = "https://www.dreeshomes.com/new-homes-san-antonio/san-antonio/comm-haby-hills/";
    const { fetcher, requested } = siteFetcher({ [COMMUNITY]: page });
    const result = await loadOfficialDeals({ builder: "Drees Custom Homes", sourceUrl: COMMUNITY, privateCommunityName: "Haby Hill", scrubList: ["Haby Hill"] }, { fetcher, now: () => NOW });
    // Past the page: the market list is asked for next (here 404, so a fetch failure, not a changed page).
    expect(requested).toEqual([COMMUNITY, "https://www.dreeshomes.com/api/en/dreeshomes/areas"]);
    expect(result.holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("Perry Alsatian Oaks and Esperanza carry their collections in the Flight payload; the reader goes on to the sitemap", async () => {
    for (const [name, slug] of [["perry-alsatian-oaks", "alsatian-oaks"], ["perry-esperanza", "esperanza"]] as const) {
      resetPerrySitemapCache();
      const COMMUNITY = `https://www.perryhomes.com/new-homes/texas/san-antonio/${slug}`;
      const { fetcher, requested } = siteFetcher({ [COMMUNITY]: live(name) });
      const result = await loadOfficialDeals({ builder: "Perry Homes", sourceUrl: COMMUNITY, privateCommunityName: slug, scrubList: [slug] }, { fetcher, now: () => NOW });
      expect(result.holdReasons).toEqual(["sitemap_fetch_failed"]);
      expect(requested).toContain("https://www.perryhomes.com/sitemap.xml");
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
