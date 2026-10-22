import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chesmarDetailFacts, loadOfficialDeals, type CommunitySourceConfig, type HtmlFetcher } from "./dealsAdapters";
import { homefinitiCollections, homefinitiStatus, parseHomefinitiRecords } from "./dealsAdapters.homefiniti";
import { kbStatus } from "./dealsAdapters.kbhome";
import { parseTexasHomesCommunity, resetTexasHomesCaches, texasHomesHomesUrl } from "./dealsAdapters.texashomes";
import { parseTollCommunity } from "./dealsAdapters.toll";
import { parseViewHomesCommunity, parseViewHomesRoster, resetViewHomesCaches, viewHomesListingUrl } from "./dealsAdapters.viewhomes";

/**
 * Regression tests on the pages the official sites served late on October 20,
 * 2026 (about 11 PM Central, the readers' User-Agent, redirects followed),
 * when the nightly sync still held these communities. The fixtures in
 * fixtures/deals/live-2026-10-20b/ are those captures with scripts other than
 * the data the readers use (JSON-LD, `__NEXT_DATA__`, KB's inline arrays),
 * styles, inline SVG, comments, non-canonical links and image source sets
 * removed, then gzipped; the markup and data the readers parse are as served.
 * The follow-up captures (the View Homes roster and promotion, the Texas Homes
 * quick move-in list, Coventry's collection pages, every Toll Brothers
 * community, Chesmar's sitemaps, home pages and plan pages) were taken the same
 * night; Chesmar's sitemaps are cut to their first entry and Alsatian Oaks'
 * entries (and one entry's image list to three), and its pages keep their image
 * source sets (its gallery reads them). The variants the hold tests build are
 * synthetic and say so where they are built.
 */
const NOW = new Date("2026-10-21T04:00:00Z");
const fixture = (file: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-10-20b/${file}.gz`, import.meta.url))).toString("utf8");
const live = (name: string) => fixture(`${name}.html`);
/** The page with its `__NEXT_DATA__` object changed (for the hold tests). */
function withNextData(page: string, change: (data: any) => void): string {
  return page.replace(/(<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>)([\s\S]*?)(<\/script>)/, (_all, open: string, json: string, close: string) => { const data = JSON.parse(json); change(data); return `${open}${JSON.stringify(data)}${close}`; });
}
type Site = Record<string, string | { status: number; body?: string; type?: string }>;
function siteFetcher(site: Site) {
  const requested: string[] = [];
  const fetcher = vi.fn(async (input: string) => {
    requested.push(input);
    const entry = site[input];
    if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    if (typeof entry === "string") return new Response(entry, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response(entry.body ?? null, { status: entry.status, headers: { "content-type": entry.type ?? "text/html" } });
  });
  return { fetcher: fetcher as unknown as HtmlFetcher, requested };
}
const publicJson = (result: Awaited<ReturnType<typeof loadOfficialDeals>>) => JSON.stringify(result.public);
const facts = (result: Awaited<ReturnType<typeof loadOfficialDeals>>, kind: "homes" | "plans") => result.private[kind].map((item) => [item.privateName, item.privatePlanName, item.status, item.price, item.bedrooms, item.bathrooms, item.squareFeet, item.garage ?? null, item.moveInDate ?? null, item.readyNow ?? false]);

beforeEach(() => { resetViewHomesCaches(); resetTexasHomesCaches(); });

describe("Toll Brothers: a model with no homes now leaves its qmis list out (October 20, 2026)", () => {
  const BRIGGS = "https://www.tollbrothers.com/luxury-homes-for-sale/Texas/Toll-Brothers-at-Briggs-Ranch";
  const SHAVANO = "https://www.tollbrothers.com/luxury-homes-for-sale/Texas/Shavano-Highlands";
  const config: CommunitySourceConfig = { builder: "Toll Brothers", sourceUrl: BRIGGS, privateCommunityName: "Toll Brothers at Briggs Ranch", scrubList: ["Briggs Ranch", "Hawthorn Oak", "Boxwood Green", "Blue Cedar", "Kissing Tree"] };

  it("finds the live hold: the Amaury model has no qmis key and says qmiCount 0 (every model used to carry qmis: [])", () => {
    const page = live("toll-briggs-ranch");
    expect(page).toContain('"qmiCount":0');
    const parsed = parseTollCommunity(page, BRIGGS, NOW)!;
    expect(parsed.shapeIntact).toBe(true);
    expect([parsed.homes.length, parsed.plans.length, parsed.sitePlanHomes]).toEqual([7, 7, 7]);
  });

  it("Briggs Ranch: reads the 7 quick move-in homes and 7 plans as the data states them", async () => {
    const { fetcher, requested } = siteFetcher({ [BRIGGS]: live("toll-briggs-ranch") });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([BRIGGS]);
    expect(facts(result, "homes")).toEqual([
      ["4106 Hawthorn Oak", "Aberforth", "Quick Move-In (November 2026)", 520_000, 3, 2, 1_912, 2, "November 2026", false],
      ["4006 Boxwood Green", "Aberforth", "Quick Move-In (Move-In Ready)", 459_000, 3, 2, 1_912, 2, null, true],
      ["13307 Blue Cedar", "Caden", "Quick Move-In (Move-In Ready)", 439_000, 3, 2, 2_089, 2, null, true],
      ["4003 Kissing Tree", "Evalyn", "Quick Move-In (Move-In Ready)", 434_000, 4, 3, 2_238, 2, null, true],
      ["4124 Hawthorn Oak", "Ronan", "Quick Move-In (Move-In Ready)", 499_000, 4, 3.5, 2_484, 2, null, true],
      ["4019 Kissing Tree", "Sylvia", "Quick Move-In (December 2026)", 638_000, 4, 3.5, 2_812, 2, "December 2026", false],
      ["4128 Hawthorn Oak", "Aubriella", "Quick Move-In (Move-In Ready)", 661_000, 4, 3.5, 3_116, 2, null, true],
    ]);
    expect(result.private.homes[0]).toMatchObject({ privateAddress: "4106 Hawthorn Oak, San Antonio, TX 78245", homesite: "Lot 16", sourceUrl: `${BRIGGS}/Quick-Move-In/285653` });
    expect(result.private.plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet])).toEqual([
      ["Aberforth", 414_995, 3, 2, 1_912], ["Amaury", 457_995, 4, 3, 2_253], ["Caden", 426_995, 3, 2, 2_089], ["Evalyn", 442_995, 3, 2, 2_247],
      ["Ronan", 479_995, 4, 3.5, 2_484], ["Sylvia", 494_995, 4, 3, 2_819], ["Aubriella", 519_995, 4, 3.5, 3_124],
    ]);
    for (const secret of ["Briggs", "Hawthorn", "Boxwood", "Blue Cedar", "Kissing Tree", "Toll", "Aberforth", "78245"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("still holds a model without its list that does not count zero, and reads Shavano Highlands, whose site plan counts its decorated model", async () => {
    // Amaury without its list but counting a home: the list moved, never a sold home.
    const counted = siteFetcher({ [BRIGGS]: live("toll-briggs-ranch").replace('"qmiCount":0', '"qmiCount":1') });
    const held = await loadOfficialDeals(config, { fetcher: counted.fetcher, now: () => NOW });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    // No count at all beside a missing list: held too.
    const uncounted = siteFetcher({ [BRIGGS]: live("toll-briggs-ranch").replace('"qmiCount":0', '"qmiTotal":0') });
    expect((await loadOfficialDeals(config, { fetcher: uncounted.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // Shavano Highlands: six models, none with homes (qmiCount 0 each), while the site plan counts one quick move-in lot: the
    // decorated model (Toll's page lists no quick move-in home, Oct 22). Every plan counting zero agrees with the empty listing.
    const shavanoPage = live("toll-shavano-highlands");
    const shavano = parseTollCommunity(shavanoPage, SHAVANO, NOW)!;
    expect([shavano.shapeIntact, shavano.homes.length, shavano.plans.length, shavano.sitePlanHomes]).toEqual([true, 0, 6, 1]);
    const { fetcher } = siteFetcher({ [SHAVANO]: shavanoPage });
    const result = await loadOfficialDeals({ builder: "Toll Brothers", sourceUrl: SHAVANO, privateCommunityName: "Shavano Highlands", scrubList: ["Shavano Highlands"] }, { fetcher, now: () => NOW });
    expect(result.holdReasons).not.toContain("expected_community_container_not_found");
    expect(result.private.homes).toEqual([]);
  });
});

describe("Toll Brothers: every San Antonio community (October 20, 2026 captures)", () => {
  const T = "https://www.tollbrothers.com/luxury-homes-for-sale/Texas/";
  type Row = [fixture: string, path: string, holds: string[], homes: number, plans: number];
  // The catalog outcome per community; an `ambiguous_rate` hold is the offer's alone (the catalog publishes).
  // Filled in from the captures' own offers below (the catalog outcome is what this table checks).
  const CALIZA_HOLDS = ["ambiguous_rate"], NOLTE_HOLDS: string[] = [], REGENCY_HOLDS = ["ambiguous_rate"];
  const ROWS: Row[] = [
    ["toll-briggs-ranch", "Toll-Brothers-at-Briggs-Ranch", [], 7, 7],
    ["toll-enchanted-bluff", "Toll-Brothers-at-Enchanted-Bluff", ["ambiguous_rate"], 3, 5],
    ["toll-flat-creek", "Toll-Brothers-at-Flat-Creek", [], 3, 6],
    ["toll-georges-ranch", "Toll-Brothers-at-George%27s-Ranch", ["ambiguous_rate"], 2, 6],
    ["toll-legacy-at-lake-dunlap", "Toll-Brothers-at-Legacy-at-Lake-Dunlap", [], 4, 6],
    ["toll-mayfair", "Toll-Brothers-at-Mayfair", ["ambiguous_rate"], 3, 0],
    ["toll-thornebrook", "Toll-Brothers-at-Thornebrook", ["ambiguous_rate"], 2, 6],
    ["toll-windborne", "Toll-Brothers-at-Windborne", ["ambiguous_rate"], 2, 6],
    // The site plan counts one quick move-in lot more than the data lists (Shavano 1 of 0, Caliza Reserve 3 of 2, Nolte Farms 3 of 2,
    // Sunset Ridge 13 of 12) or attributes one to another collection (Regency at Esperanza 5/5/4 on the plan, 5/4/5 listed). Where
    // every plan entry states its count and the counts add up to the listing, the listing is complete: Toll's own page showed
    // "2 Quick Move-In Homes Available" for Caliza Reserve and none for Shavano Highlands (its extra lot is the decorated model) on
    // Oct 22. Sunset Ridge's entries carry no counts: still held.
    ["toll-shavano-highlands", "Shavano-Highlands", ["ambiguous_rate"], 0, 6],
    ["toll-caliza-reserve", "Toll-Brothers-at-Caliza-Reserve", CALIZA_HOLDS, 2, 6],
    ["toll-nolte-farms", "Toll-Brothers-at-Nolte-Farms", NOLTE_HOLDS, 2, 6],
    ["toll-sunset-ridge", "Toll-Brothers-at-Sunset-Ridge", ["expected_community_container_not_found"], 0, 0],
    ["toll-regency-at-esperanza", "Regency-at-Esperanza", REGENCY_HOLDS, 14, 12],
  ];
  const read = (name: string, url: string, page = live(name)) => loadOfficialDeals({ builder: "Toll Brothers", sourceUrl: url, privateCommunityName: name, scrubList: [] }, { fetcher: siteFetcher({ [url]: page }).fetcher, now: () => NOW });

  it("reads 12 of the 13 and holds Sunset Ridge, whose site plan counts a home the data does not list and whose plans state no counts", async () => {
    for (const [name, path, holds, homes, plans] of ROWS) {
      const result = await read(name, `${T}${path}`);
      expect([name, result.holdReasons, result.catalogOk, result.private.homes.length, result.private.plans.length]).toEqual([name, holds, holds.every((hold) => hold === "ambiguous_rate"), homes, plans]);
    }
  });

  it("Legacy at Lake Dunlap: a home whose plan has no model sits in an unnamed isQMI entry that holds only its list (4 homes, the site plan's 4)", async () => {
    const result = await read("toll-legacy-at-lake-dunlap", `${T}Toll-Brothers-at-Legacy-at-Lake-Dunlap`);
    expect(facts(result, "homes")).toEqual([
      ["221 Grand Legacy", "Maren", "Quick Move-In (Move-In Ready)", 529_000, 3, 3, 2_664, 3, null, true],
      ["335 Grand Legacy", "Nocona", "Quick Move-In (Move-In Ready)", 569_000, 4, 3.5, 2_936, 3, null, true],
      ["331 Grand Legacy", "Paisano", "Quick Move-In (December 2026)", 741_000, 4, 4.5, 3_524, 3, "December 2026", false],
      ["308 Flathead Lake", "Kieran", "Quick Move-In (December 2026)", 654_000, 5, 4, 2_834, 2, "December 2026", false],
    ]);
    expect(result.private.plans.map((plan) => plan.privatePlanName)).toEqual(["Quentin", "Liliana", "Maren", "Nocona", "Ophelia", "Paisano"]);
  });

  it("Mayfair: a master community's page (two collections, homes only, each naming its collection's id) reads its 3 homes", async () => {
    const result = await read("toll-mayfair", `${T}Toll-Brothers-at-Mayfair`);
    expect(result.catalogOk).toBe(true);
    expect(facts(result, "homes")).toEqual([
      ["338 Cleveland Way", "Aubriella", "Quick Move-In (Move-In Ready)", 744_000, 4, 3.5, 3_116, 2, null, true],
      ["5755 Tug Pt", "Maren", "Quick Move-In (Move-In Ready)", 589_000, 4, 4, 2_664, 3, null, true],
      ["318 Cleveland Way", "Ophelia", "Quick Move-In (Move-In Ready)", 959_000, 4, 4.5, 3_877, 3, null, true],
    ]);
    expect(result.private.homes.map((home) => home.sourceUrl)).toEqual([`${T}Toll-Brothers-at-Mayfair/Comal-Collection/Quick-Move-In/MLS-612218`, `${T}Toll-Brothers-at-Mayfair/Guadalupe-Collection/Quick-Move-In/274722`, `${T}Toll-Brothers-at-Mayfair/Guadalupe-Collection/Quick-Move-In/287458`]);
    for (const secret of ["Mayfair", "Cleveland Way", "Tug Pt", "Comal", "Guadalupe", "Toll"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("still holds an isQMI entry that is a home or names another page, a master's home of no listed collection, and a collection short of its own site plan", async () => {
    const LEGACY = `${T}Toll-Brothers-at-Legacy-at-Lake-Dunlap`;
    const legacy = live("toll-legacy-at-lake-dunlap");
    const holder = (data: any) => data.props.pageProps.pageData.communityComponent.homes.models.find((model: any) => model.isQMI);
    // The entry has a street of its own: a home listed at the top level, a changed shape.
    expect((await read("x", LEGACY, withNextData(legacy, (data) => { holder(data).street = "308 Flathead Lake"; }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    // The entry names another community's page.
    expect((await read("x", LEGACY, withNextData(legacy, (data) => { holder(data).communityUrl = `${T}Toll-Brothers-at-Flat-Creek`; }))).holdReasons).toEqual(["invalid_inventory_response"]);
    const MAYFAIR = `${T}Toll-Brothers-at-Mayfair`;
    const mayfair = live("toll-mayfair");
    const master = (data: any) => data.props.pageProps.pageData.masterCommunityComponent;
    // A home naming a collection the master does not list (taken from the collection whose site plan counts none, so every
    // count is still met): no status (the sync holds), never published as this community's.
    const stray = await read("x", MAYFAIR, withNextData(mayfair, (data) => { master(data).homes.models[0].qmis[0].communityId = 99999; }));
    expect(stray.private.homes.map((home) => home.status)).toEqual([null, "Quick Move-In (Move-In Ready)", "Quick Move-In (Move-In Ready)"]);
    // A collection's site plan counts more homes than the lists give it, though the master's total is met.
    expect((await read("x", MAYFAIR, withNextData(mayfair, (data) => { master(data).communities[0].qmiSitePlanLots = 2; }))).holdReasons).toEqual(["expected_community_container_not_found"]);
  });

  it("Shavano Highlands: the community API (/api/v1/community/14460) says the same as the page: one site-plan lot, no model with a home, and no lot list", () => {
    const api = JSON.parse(fixture("toll-api-community-14460.json"));
    expect([api.qmiSitePlanLots, api.availableLots, api.reservedLots, api.homes.models.length]).toEqual([1, 2, 2, 6]);
    expect(api.homes.models.every((model: any) => model.qmiCount === 0 && model.qmis === undefined)).toBe(true);
    expect(JSON.stringify(api)).not.toMatch(/"(?:lots|lotNumber|qmis)"/);
  });
});

describe("First America Homes: the 'Ready For You' card label (October 20, 2026)", () => {
  const COMMUNITY = "https://www.firstamericahomes.com/new-homes/tx/san-antonio-metro/seguin/cordova-crossing/";
  const config: CommunitySourceConfig = { builder: "First America Homes", sourceUrl: COMMUNITY, privateCommunityName: "Cordova Crossing", scrubList: ["Cordova Crossing", "Sierra Chicas"] };

  it("reads the 9 homes (4 'Ready For You', 5 'Under Construction') and 8 plans", async () => {
    expect(homefinitiStatus("Ready For You")).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true });
    const { fetcher } = siteFetcher({ [COMMUNITY]: live("firstamerica-cordova-crossing") });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.readyNow])).toEqual([
      ["521 Cordova Crossing, Seguin, TX 78155", "Avery", "Quick Move-In (Under Construction)", 527_236, 5, 3.5, 3_226, false],
      ["2708 Sierra Chicas Lane, Seguin, TX 78155", "Sterling", "Quick Move-In (Move-In Ready)", 397_670, 4, 3, 2_162, true],
      ["2704 Sierra Chicas Lane, Seguin, TX 78155", "Rowan", "Quick Move-In (Move-In Ready)", 449_000, 5, 3, 2_824, true],
      ["2709 Sierra Chicas Lane, Seguin, TX 78155", "Hudson", "Quick Move-In (Move-In Ready)", 435_000, 4, 3, 2_684, true],
      ["2713 Sierra Chicas Lane, Seguin, TX 78155", "Rowan", "Quick Move-In (Move-In Ready)", 475_000, 5, 3, 2_824, true],
      ["529 Cordova Crossing, Seguin, TX 78155", "Creston", "Quick Move-In (Under Construction)", 385_000, 3, 2.5, 1_901, false],
      ["2700 Sierra Chicas Lane, Seguin, TX 78155", "Archer", "Quick Move-In (Under Construction)", 424_000, 4, 3, 2_533, false],
      ["2705 Sierra Chicas Lane, Seguin, TX 78155", "Avery", "Quick Move-In (Under Construction)", 499_000, 5, 3.5, 3_226, false],
      ["525 Cordova Crossing, Seguin, TX 78155", "Rowan", "Quick Move-In (Under Construction)", 479_047, 5, 3, 2_824, false],
    ]);
    expect(result.private.plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet])).toEqual([
      ["Bellamy", 335_990, 3, 2, 1_799], ["Creston", 347_990, 3, 2.5, 1_901], ["Ellington", 361_990, 3, 2.5, 1_990], ["Sterling", 381_990, 4, 3, 2_162],
      ["Archer", 410_990, 4, 3, 2_533], ["Hudson", 417_990, 4, 3, 2_684], ["Rowan", 436_990, 5, 3, 2_824], ["Avery", 458_990, 5, 3.5, 3_226],
    ]);
    for (const secret of ["Cordova", "Sierra Chicas", "Seguin", "First America", "Sterling", "78155"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("still holds a card whose label the reader does not know", async () => {
    for (const label of ["Reserved", "Ready Soon", "Ready For You Soon"]) expect(homefinitiStatus(label).status, label).toBeNull();
    const page = live("firstamerica-cordova-crossing").replace(/(<div class="status-text">\s*)Ready For You/, "$1Reserved");
    const { fetcher } = siteFetcher({ [COMMUNITY]: page });
    const held = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(held.holdReasons).toEqual(["unlabelled_home_status"]);
    expect(held.public.homes).toEqual([]);
  });

  it("a repeated record never stands in for a card that has no record of its own (the home would be swept to sold); copies that disagree hold", async () => {
    const page = live("firstamerica-cordova-crossing");
    const record = (street: string) => new RegExp(`<script type='application/ld\\+json'>(?:(?!</script>)[\\s\\S])*?"name": "${street}"(?:(?!</script>)[\\s\\S])*?</script>`);
    const kept = record("2708 Sierra Chicas Lane").exec(page)![0];
    // 2713's record gone, 2708's repeated in its place: nine records by count, eight homes, nine cards.
    const masked = page.replace(record("2713 Sierra Chicas Lane"), kept);
    expect(parseHomefinitiRecords(masked, "www.firstamericahomes.com").homes).toHaveLength(8);
    const missing = siteFetcher({ [COMMUNITY]: masked });
    expect((await loadOfficialDeals(config, { fetcher: missing.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // Two records of one home with different prices: neither is read.
    const disagree = siteFetcher({ [COMMUNITY]: page.replace("</body>", `${kept.replace('"price": "397670.00"', '"price": "297670.00"')}</body>`) });
    expect((await loadOfficialDeals(config, { fetcher: disagree.fetcher, now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
  });
});

describe("Coventry Homes: Garden Grove is a parent page over two collections (October 20, 2026)", () => {
  const BASE = "https://www.coventryhomes.com/new-homes/tx/san-antonio/";
  const COMMUNITY = `${BASE}garden-grove/`;
  const FORTY = `${BASE}garden-grove-40/`;
  const FIFTY = `${BASE}garden-grove-50/`;
  const config: CommunitySourceConfig = { builder: "Coventry Homes", sourceUrl: COMMUNITY, privateCommunityName: "Garden Grove", scrubList: ["Garden Grove", "Kestis", "Frostwood", "Hastings", "Hawkwell", "Rocket View", "Spectre Hill"] };
  const site = (overrides: Site = {}): Site => ({ [COMMUNITY]: live("coventry-garden-grove"), [FORTY]: live("coventry-garden-grove-40"), [FIFTY]: live("coventry-garden-grove-50"), ...overrides });

  it("finds the live hold: every home sits under garden-grove-40/ or garden-grove-50/, each record twice, and one card (4912 Hawkwell Lane) has no record anywhere", () => {
    const page = live("coventry-garden-grove");
    const records = parseHomefinitiRecords(page, "www.coventryhomes.com");
    expect(records.homes).toHaveLength(17);
    expect(records.plans).toEqual([]);
    expect(new Set(records.homes.map((home) => new URL(home.sourceUrl).pathname.split("/")[4]))).toEqual(new Set(["garden-grove-40", "garden-grove-50"]));
    const cardHomes = new Set(Array.from(page.matchAll(/href="(\/new-homes\/tx\/san-antonio\/garden-grove-[45]0\/[a-z0-9-]+\/[a-z0-9-]+\/)"/g), (match) => match[1]));
    expect(cardHomes.size).toBe(18);
    expect(records.homes.some((home) => home.sourceUrl.includes("4912-hawkwell-lane"))).toBe(false);
    expect(page).toMatch(/Garden Grove 40'[\s\S]*?10 Homes[\s\S]*?6 Plans[\s\S]*?Garden Grove 50'[\s\S]*?8 Homes[\s\S]*?7 Plans/);
    expect(homefinitiCollections(page, new URL(COMMUNITY), "www.coventryhomes.com")).toEqual([{ url: FORTY, homes: 10 }, { url: FIFTY, homes: 8 }]);
    // The collection page and the home's own page carry no record for it either (the home page's records are other homes').
    expect(parseHomefinitiRecords(live("coventry-garden-grove-40"), "www.coventryhomes.com").homes.some((home) => home.sourceUrl.includes("4912-hawkwell-lane"))).toBe(false);
    expect(parseHomefinitiRecords(live("coventry-4912-hawkwell"), "www.coventryhomes.com").homes.some((home) => home.sourceUrl.includes("4912-hawkwell-lane"))).toBe(false);
    // An ordinary community page lists no collections.
    expect(homefinitiCollections(live("coventry-garden-grove-50"), new URL(FIFTY), "www.coventryhomes.com")).toBeNull();
  });

  it("reads both collections' pages as the community: 10 + 8 homes and 6 + 7 plans, Hawkwell Lane from its card (every other card agrees with its record)", async () => {
    const { fetcher, requested } = siteFetcher(site());
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY, FORTY, FIFTY]);
    expect(result.private.homes.map((home) => [home.privateName, home.privatePlanName, home.status, home.price, home.previousPrice ?? null, home.bedrooms, home.bathrooms, home.squareFeet])).toEqual([
      ["4917 Kestis Lane", null, "Quick Move-In (Under Construction)", 259_990, 273_090, 4, 2, 1_557],
      ["8448 Frostwood Heights", "Gray", "Quick Move-In (Under Construction)", 271_940, null, 3, 2, 1_433],
      ["4934 Hastings Way", null, "Quick Move-In (Under Construction)", 274_990, 279_340, 3, 2.5, 1_645],
      ["8437 Frostwood Heights", null, "Quick Move-In (Under Construction)", 279_990, 284_090, 4, 2, 1_570],
      ["8508 Frostwood Heights", "Gray", "Quick Move-In (Under Construction)", 281_140, null, 3, 2, 1_433],
      ["8440 Frostwood Heights", "King", "Quick Move-In (Under Construction)", 282_640, null, 3, 2.5, 1_808],
      ["4953 Kestis Lane", "King", "Quick Move-In (Under Construction)", 296_740, null, 3, 2.5, 1_808],
      ["8445 Frostwood Heights", "Lynn Ii", "Quick Move-In (Under Construction)", 319_990, 327_790, 5, 3.5, 2_242],
      ["8441 Frostwood Heights", "Jones", "Quick Move-In (Under Construction)", 334_990, 337_790, 5, 3, 2_414],
      ["4912 Hawkwell Lane", "La Salle", "Quick Move-In (Under Construction)", 318_490, null, 4, 3, 2_082],
      ["8403 Rocket View", "Starr", "Quick Move-In (Under Construction)", 324_590, null, 4, 2, 1_669],
      ["8340 Rocket View", "Young", "Quick Move-In (Move-In Ready)", 339_990, 352_190, 4, 3, 2_019],
      ["8336 Rocket View", "Llana", "Quick Move-In (Move-In Ready)", 339_990, 351_740, 4, 2.5, 2_073],
      ["8332 Rocket View", "Young", "Quick Move-In (Move-In Ready)", 344_990, 357_190, 4, 3, 2_006],
      ["8322 Rocket View", "Martin", "Quick Move-In (Under Construction)", 359_990, 371_340, 4, 2.5, 2_341],
      ["8328 Rocket View", "Howard", "Quick Move-In (Move-In Ready)", 364_990, 376_890, 5, 2.5, 2_533],
      ["8368 Rocket View", "Howard", "Quick Move-In (Under Construction)", 394_890, null, 5, 2.5, 2_469],
      ["8303 Spectre Hill", "Martin", "Quick Move-In (Under Construction)", 398_440, null, 4, 2.5, 2_361],
    ]);
    expect(result.private.homes.find((home) => home.privateName === "4912 Hawkwell Lane")).toMatchObject({ privateAddress: "4912 Hawkwell Lane, San Antonio, TX", sourceUrl: `${FORTY}la-salle/4912-hawkwell-lane/` });
    expect(result.private.plans.map((plan) => [plan.privatePlanName, plan.price])).toEqual([
      ["Gray", 259_990], ["Hill II", 269_990], ["King", 280_990], ["La Salle", 304_990], ["Lynn II", 314_990], ["Jones", 324_990],
      ["Starr", 314_990], ["Upton", 334_990], ["Llana", 339_990], ["Young", 339_990], ["Donley", 354_990], ["Martin", 359_990], ["Howard", 364_990],
    ]);
    for (const secret of ["Garden Grove", "Kestis", "Frostwood", "Hawkwell", "Rocket View", "Coventry", "La Salle"]) expect(publicJson(result)).not.toContain(secret);
    // Each collection configured on its own reads the same homes.
    for (const [url, count] of [[FORTY, 10], [FIFTY, 8]] as const) {
      const alone = await loadOfficialDeals({ ...config, sourceUrl: url }, { fetcher: siteFetcher(site()).fetcher, now: () => NOW });
      expect([alone.holdReasons, alone.private.homes.length]).toEqual([[], count]);
    }
  });

  it("still holds a card-only home when any card disagrees with its record or with itself, and a parent whose collections are missing, short or not its own", async () => {
    const forty = live("coventry-garden-grove-40");
    const run = async (overrides: Site) => (await loadOfficialDeals(config, { fetcher: siteFetcher(site(overrides)).fetcher, now: () => NOW })).holdReasons;
    // A recorded home's card shows another price: the cards are not to be trusted for Hawkwell Lane.
    expect(await run({ [FORTY]: forty.replaceAll('data-price="259990"', 'data-price="259000"').replaceAll("$259,990", "$259,000") })).toEqual(["expected_community_container_not_found"]);
    // Hawkwell Lane's own card disagrees with itself (data attribute against the price shown).
    expect(await run({ [FORTY]: forty.replaceAll('data-price="318490"', 'data-price="218490"') })).toEqual(["expected_community_container_not_found"]);
    // A collection page missing, or showing fewer homes than the parent counts for it.
    expect(await run({ [FIFTY]: { status: 404 } })).toEqual(["community_fetch_failed"]);
    expect(await run({ [COMMUNITY]: live("coventry-garden-grove").replace("8 Homes", "9 Homes") })).toEqual(["incomplete_inventory"]);
    // A parent home that no collection page lists (the parent's count lowered to match, so only the missing home tells).
    expect(await run({ [COMMUNITY]: live("coventry-garden-grove").replace("8 Homes", "7 Homes"), [FIFTY]: live("coventry-garden-grove-50").replace(/<script type='application\/ld\+json'>(?:(?!<\/script>)[\s\S])*?"name": "8303 Spectre Hill"(?:(?!<\/script>)[\s\S])*?<\/script>/g, "").replace(/<article class="card-spec[^"]*"[^>]*>(?:(?!<\/article>)[\s\S])*?8303-spectre-hill(?:(?!<\/article>)[\s\S])*?<\/article>/g, "") })).toEqual(["incomplete_inventory"]);
    // A child list that links a page not named for the parent is not a list of its collections: the parent's homes are then foreign.
    expect(await run({ [COMMUNITY]: live("coventry-garden-grove").replaceAll('href="/new-homes/tx/san-antonio/garden-grove-50/"', 'href="/new-homes/tx/san-antonio/orchard-grove/"') })).toEqual(["invalid_inventory_response"]);
  });
});

describe("KB Home: the 'Available 3-6 Months' move-in wording (October 20, 2026)", () => {
  const COMMUNITY = "https://www.kbhome.com/new-homes-san-antonio/medina-crossing-villa-collection";
  const config: CommunitySourceConfig = { builder: "KB Home", sourceUrl: COMMUNITY, privateCommunityName: "Medina Crossing - Villa Collection", scrubList: ["Medina Crossing", "Mutton Crossing", "Von Ormy"] };

  it("reads both homes as quick move-ins with no date (the page names a window, not a month) and the 4 plans", async () => {
    expect(kbStatus("Available 3-6 Months", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    const { fetcher } = siteFetcher({ [COMMUNITY]: live("kb-medina-crossing") });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.garage, home.homesite, home.moveInDate, home.readyNow])).toEqual([
      ["12915 Mutton Crossing, Von Ormy, TX 78073", "Plan 1676 Modeled", "Quick Move-In", 215_475, 3, 2.5, 1_676, 2, "Lot 24", null, false],
      ["12951 Mutton Crossing, Von Ormy, TX 78073", "Plan 1676 Modeled", "Quick Move-In", 210_900, 3, 2.5, 1_676, 2, "Lot 15", null, false],
    ]);
    expect(result.private.homes.map((home) => home.sourceUrl)).toEqual([`${COMMUNITY}/mir?homesite=1473910`, `${COMMUNITY}/mir?homesite=1487581`]);
    expect(result.private.plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet])).toEqual([
      ["Plan 1245 Modeled", 170_995, 3, 2, 1_245], ["Plan 1389", 179_995, 2, 2.5, 1_389], ["Plan 1529", 186_995, 3, 2.5, 1_529], ["Plan 1676 Modeled", 193_995, 3, 2.5, 1_676],
    ]);
    for (const secret of ["Medina", "Mutton", "Von Ormy", "KB Home", "78073"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("still gives no status to a window past a year or wording the reader does not know (the sync holds the run)", async () => {
    for (const copy of ["Available 12-18 Months", "Available 0-3 Months", "Available 6-3 Months", "Available Soon", "Available 3-6 Weeks"]) expect(kbStatus(copy, NOW).status, copy).toBeNull();
    expect(kbStatus("Available in 4 Months", NOW).status).toBe("Quick Move-In");
    const { fetcher } = siteFetcher({ [COMMUNITY]: live("kb-medina-crossing").replace('"moveInDateCopy":"Available 3-6 Months"', '"moveInDateCopy":"Available Soon"') });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.private.homes.map((home) => home.status)).toEqual([null, "Quick Move-In"]);
  });
});

describe("View Homes: a coming-soon page has no homes-and-plans module (October 20, 2026)", () => {
  const HOST = "https://yourviewhome.com";
  const LADERA = `${HOST}/communities/ladera/`;
  const ENCLAVE = `${HOST}/communities/enclave-35-at-medical-center/`;
  /** A roster for the hold tests: synthetic, in the live shape (status.status.{value,label}, address, homes[]). */
  const roster = (rows: Array<{ url: string; title: string; status: [string, string]; homes?: unknown[] }>) => {
    const communities = rows.map((row, index) => ({ post_id: 14000 + index, post_title: row.title, permalink: row.url, status: { status: { value: row.status[0], label: row.status[1] } }, address: { street: "", city: "San Antonio", state: "TX", zip: "78245", lat: "29.4", lng: "-98.7" }, price: { value: "", text: "" }, price_range: { PriceLow: 0 }, phone: "(210) 817-5507", homes: row.homes ?? [] }));
    const regions = [{ id: 8, name: "San Antonio", communities, regions: [] }];
    return `<html><body><script>oceanFloorModules.communitiesMapList.push({ id: 'communities-list-map', regions: ${JSON.stringify(regions).replace(/\//g, "\\/")}, currentPage: 'texas', });</script></body></html>`;
  };
  const soonRoster = roster([{ url: LADERA, title: "Ladera", status: ["soon", "Coming Soon"] }, { url: ENCLAVE, title: "Enclave 35 at Medical Center", status: ["soon", "Coming Soon"] }]);

  it("finds the live hold: both pages say 'Coming Soon' in the hero and carry no module (the reader required the module)", () => {
    for (const [name, url] of [["view-ladera", LADERA], ["view-enclave-35", ENCLAVE]] as const) {
      expect(parseViewHomesCommunity(live(name), url)).toMatchObject({ heroStatus: "Coming Soon", hasModule: false, hasHomesTab: false, homeUrls: [], plans: [], foreignPage: false });
    }
  });

  it("reads Ladera and Enclave 35 as coming soon (nothing for sale): the live roster lists both as coming soon with no homes", async () => {
    const PROMO = `${HOST}/promo-autumnatic-san-antonio/`;
    const rosterPage = live("view-region-texas");
    expect(parseViewHomesRoster(rosterPage, "yourviewhome.com")!.filter((row) => row.url === LADERA || row.url === ENCLAVE).map((row) => [row.url, row.status.value, row.homes.length])).toEqual([[LADERA, "soon", 0], [ENCLAVE, "soon", 0]]);
    for (const [name, url, community] of [["view-ladera", LADERA, "Ladera"], ["view-enclave-35", ENCLAVE, "Enclave 35 at Medical Center"]] as const) {
      resetViewHomesCaches();
      const { fetcher, requested } = siteFetcher({ [url]: live(name), [viewHomesListingUrl()]: rosterPage, [PROMO]: live("view-promo-autumnatic") });
      const result = await loadOfficialDeals({ builder: "View Homes", sourceUrl: url, privateCommunityName: community, scrubList: [community] }, { fetcher, now: () => NOW });
      expect(result.holdReasons).toEqual([]);
      expect(requested).toEqual([url, viewHomesListingUrl(), PROMO]);
      expect(result.private.homes).toEqual([]);
      expect(result.private.plans).toEqual([]);
      // The promotion lists eight participating communities, neither of these.
      expect(result.private.incentive).toBeNull();
    }
  });

  it("still holds a module-less page the roster does not corroborate, and one whose hero does not say coming soon", async () => {
    const run = async (page: string, rosterPage: string) => { resetViewHomesCaches(); return (await loadOfficialDeals({ builder: "View Homes", sourceUrl: LADERA, privateCommunityName: "Ladera", scrubList: ["Ladera"] }, { fetcher: siteFetcher({ [LADERA]: page, [viewHomesListingUrl()]: rosterPage }).fetcher, now: () => NOW })).holdReasons; };
    const page = live("view-ladera");
    // The roster lists it as selling, or with a home for sale: the module is missing, never "nothing for sale".
    expect(await run(page, roster([{ url: LADERA, title: "Ladera", status: ["now", "Now Selling"] }]))).toEqual(["expected_community_container_not_found"]);
    expect(await run(page, roster([{ url: LADERA, title: "Ladera", status: ["soon", "Coming Soon"], homes: [{ post_title: "15011 Early Dawn", permalink: `${LADERA}homes/15011-early-dawn/`, status: { text: "Ready Now!" }, price: "$300,000", specs: {} }] }]))).toEqual(["expected_community_container_not_found"]);
    // The roster does not list it at all, or cannot be read.
    expect(await run(page, roster([{ url: ENCLAVE, title: "Enclave 35 at Medical Center", status: ["soon", "Coming Soon"] }]))).toEqual(["expected_community_container_not_found"]);
    expect(await run(page, "<html><body>new layout</body></html>")).toEqual(["expected_community_container_not_found"]);
    // A hero that says something else on a page without the module: held before the roster is read.
    expect(await run(page.replace(/(hero__status[^>]*>)Coming Soon/, "$1Now Selling"), soonRoster)).toEqual(["expected_community_container_not_found"]);
    expect(await run(page.replace(/(hero__status[^>]*>)Coming Soon/, "$1Final Opportunity"), soonRoster)).toEqual(["expected_community_container_not_found"]);
  });
});

describe("Texas Homes: a renamed community keeps its plans under the old path (October 20, 2026)", () => {
  const COMMUNITY = "https://www.texas-homes.com/enclave-at-potranco-oaks";
  const config: CommunitySourceConfig = { builder: "Texas Homes", sourceUrl: COMMUNITY, privateCommunityName: "The Enclave at Potranco Oaks", scrubList: ["Enclave at Potranco Oaks", "Potranco", "Thunder Gulch"] };

  it("finds the live hold: the page is /enclave-at-potranco-oaks, its 8 plans are /enclave-potranco-oaks/plan-…, and 4 of them link their homes with the page's own id 424", () => {
    const page = live("texas-enclave-potranco-oaks");
    expect(page).toContain('<article data-history-node-id="424" about="/enclave-at-potranco-oaks">');
    const parsed = parseTexasHomesCommunity(page, COMMUNITY)!;
    expect(parsed.foreignPlan).toBe(false);
    expect(parsed.neighborhoodId).toBe(424);
    expect(parsed.plans.map((plan) => [plan.sourceUrl, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.garage])).toEqual([
      ["https://www.texas-homes.com/enclave-potranco-oaks/plan-1663", 399_990, 3, 2, 1_663, 2],
      ["https://www.texas-homes.com/enclave-potranco-oaks/plan-1977", 410_990, 3, 2, 1_977, 2],
      ["https://www.texas-homes.com/enclave-potranco-oaks/plan-2110", 433_990, 3, 3, 2_110, 2],
      ["https://www.texas-homes.com/enclave-potranco-oaks/plan-2305", 454_990, 4, 3, 2_305, 2],
      ["https://www.texas-homes.com/enclave-potranco-oaks/plan-2435", 466_990, 4, 3, 2_435, 2],
      ["https://www.texas-homes.com/enclave-potranco-oaks/plan-2632", 492_990, 4, 3, 2_632, 2],
      ["https://www.texas-homes.com/enclave-potranco-oaks/plan-2830", 504_990, 3, 3.5, 2_830, 2],
      ["https://www.texas-homes.com/enclave-potranco-oaks/plan-3218", 531_990, 4, 3, 3_218, 2],
    ]);
  });

  it("reads the 4 homes of its quick move-in list (the menu's count of 4) and the 8 plans", async () => {
    const { fetcher, requested } = siteFetcher({ [COMMUNITY]: live("texas-enclave-potranco-oaks"), [texasHomesHomesUrl(424)]: live("texas-mir-424") });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    // The catalog reads; the home page that carries the site-wide offer was not captured, so only the offer is held.
    expect(result.catalogOk).toBe(true);
    expect(result.holdReasons).toEqual(["incentive_fetch_failed"]);
    expect(requested).toEqual([COMMUNITY, texasHomesHomesUrl(424), "https://www.texas-homes.com/"]);
    expect(result.private.homes.map((home) => [home.privateName, home.status, home.price, home.previousPrice, home.bedrooms, home.bathrooms, home.squareFeet, home.garage, home.sourceUrl])).toEqual([
      ["142 Secretariat Ave", "Quick Move-In (Move-In Ready)", 499_999, 554_900, 3, 4, 2_830, 2, "https://www.texas-homes.com/move-in-ready/142-secretariat-ave"],
      ["137 Gallant Fox", "Quick Move-In (Move-In Ready)", 479_727, 516_215, 4, 3, 2_435, 2, "https://www.texas-homes.com/move-in-ready/137-gallant-fox"],
      ["130 Gallant Fox", "Quick Move-In (Move-In Ready)", 469_767, 489_767, 4, 3, 2_632, 2, "https://www.texas-homes.com/move-in-ready/130-gallant-fox"],
      ["110 Thunder Gulch", "Quick Move-In (Move-In Ready)", 599_777, 625_000, 4, 3, 2_305, 2, "https://www.texas-homes.com/move-in-ready/110-thunder-gulch"],
    ]);
    expect(result.private.plans).toHaveLength(8);
    for (const secret of ["Potranco", "Secretariat", "Gallant Fox", "Thunder Gulch", "Texas Homes", "78009"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("still holds plans under another path that no plan ties to the page's id, that name another id, that are named for another community, or that sit under two other paths", async () => {
    const page = live("texas-enclave-potranco-oaks");
    const run = async (variant: string) => (await loadOfficialDeals(config, { fetcher: siteFetcher({ [COMMUNITY]: variant }).fetcher, now: () => NOW })).holdReasons;
    // No teaser links its homes: nothing ties /enclave-potranco-oaks/ to this page.
    const untied = page.replace(/<a\b[^>]*move-in-ready-plan\?[^>]*>[\s\S]*?<\/a>/g, "");
    expect(parseTexasHomesCommunity(untied, COMMUNITY)!.foreignPlan).toBe(true);
    expect(await run(untied)).toEqual(["invalid_inventory_response"]);
    // One teaser names another community's id.
    expect(await run(page.replace("neighborhood_id=424&plan_id=442", "neighborhood_id=425&plan_id=442"))).toEqual(["invalid_inventory_response"]);
    // Every plan under a path named for another community, even with the page's id: not a renamed path of this one.
    expect(await run(page.replaceAll('href="/enclave-potranco-oaks/', 'href="/potranco-ranch/'))).toEqual(["invalid_inventory_response"]);
    expect(await run(page.replaceAll('href="/enclave-potranco-oaks/', 'href="/oaks/'))).toEqual(["invalid_inventory_response"]);
    // Two other parent paths: which one is this community's is not known.
    expect(await run(page.replaceAll('href="/enclave-potranco-oaks/plan-3218"', 'href="/potranco-ranch/plan-3218"'))).toEqual(["invalid_inventory_response"]);
    // The page links no list of its own (so no id to tie the plans to): held.
    expect(await run(page.replace(/field_neighborhood_target_id=424/g, "field_neighborhood_target_id=x"))).toEqual(["invalid_inventory_response"]);
  });

  it("Timbers answers 403 (also from a residential connection): held as a refusal after one request, never worked around", async () => {
    const TIMBERS = "https://www.texas-homes.com/timbers";
    const { fetcher, requested } = siteFetcher({ [TIMBERS]: { status: 403, body: live("texas-timbers") } });
    const result = await loadOfficialDeals({ builder: "Texas Homes", sourceUrl: TIMBERS, privateCommunityName: "Timbers", scrubList: ["Timbers"] }, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual(["source_access_refused"]);
    expect(requested).toEqual([TIMBERS]);
  });
});

describe("Chesmar: inventory homes now say 'Home For Sale' in their title (October 20, 2026)", () => {
  const COMMUNITY = "https://www.chesmar.com/texas/san-antonio-new-homes/castroville/alsatian-oaks/";
  const HOMES = { "brandy/42210000-0044/": "chesmar-home-brandy-42210000-0044", "lauren/42210000-0039/": "chesmar-home-lauren-42210000-0039", "morgan/42210000-0001/": "chesmar-home-morgan-42210000-0001" } as const;
  const PLANS = ["acadia", "aspen", "brandy", "brooks", "cayman", "hampton", "lauren", "morgan", "shenandoah", "summerton"];
  function chesmarSite(homes: Partial<Record<keyof typeof HOMES, string>> = {}): Site {
    const site: Site = { [COMMUNITY]: live("chesmar-alsatian-oaks"), "https://www.chesmar.com/sitemap.xml": { status: 200, body: fixture("chesmar-sitemap.xml"), type: "application/xml" } };
    for (let index = 1; index <= 7; index++) site[`https://www.chesmar.com/sitemap${index}.xml`] = { status: 200, body: fixture(`chesmar-sitemap${index}.xml`), type: "application/xml" };
    for (const slug of PLANS) site[`${COMMUNITY}${slug}/`] = live(`chesmar-plan-${slug}`);
    for (const [path, name] of Object.entries(HOMES)) site[`${COMMUNITY}${path}`] = homes[path as keyof typeof HOMES] ?? live(name);
    return site;
  }
  const config: CommunitySourceConfig = { builder: "Chesmar", sourceUrl: COMMUNITY, privateCommunityName: "Alsatian Oaks", scrubList: ["Alsatian Oaks", "Mountain Oak", "White Oak"] };

  it("finds the live hold: the two homes' titles say 'Home For Sale in Alsatian Oaks', which the status reader did not know", () => {
    expect(chesmarDetailFacts(live("chesmar-home-brandy-42210000-0044"))).toEqual({ price: 429_800, bedrooms: 3, bathrooms: 3, squareFeet: 2_142, status: "Quick Move-In", planName: "Brandy", address: "165 Mountain Oak" });
    expect(chesmarDetailFacts(live("chesmar-home-lauren-42210000-0039"))).toEqual({ price: 479_800, bedrooms: 4, bathrooms: 3, squareFeet: 2_376, status: "Quick Move-In", planName: "Lauren", address: "331 Mountain Oak" });
    // The model keeps its own wording: never a quick move-in.
    expect(chesmarDetailFacts(live("chesmar-home-morgan-42210000-0001"))).toMatchObject({ status: "Model For Tour", price: null, planName: "Morgan", address: "242 White Oak" });
  });

  it("reads the live sitemaps, plan pages and home pages: 10 plans, 2 quick move-ins and the model", async () => {
    const { fetcher, requested } = siteFetcher(chesmarSite());
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(requested.filter((url) => /\/\d{8}-\d{4}\/$/.test(url)).sort()).toEqual(Object.keys(HOMES).map((path) => `${COMMUNITY}${path}`).sort());
    expect(result.private.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet]).sort()).toEqual([
      ["165 Mountain Oak", "Brandy", "Quick Move-In", 429_800, 3, 3, 2_142],
      ["242 White Oak", "Morgan", "Model For Tour", null, 3, 2, 2_301],
      ["331 Mountain Oak", "Lauren", "Quick Move-In", 479_800, 4, 3, 2_376],
    ]);
    expect(result.holdReasons).toEqual(["incentive_fetch_failed"]); // the site-wide incentives page was not captured: the offer alone holds
    expect(result.private.plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet]).sort()).toEqual([
      ["Acadia", 489_990, 5, 4, 3_065], ["Aspen", 374_990, 3, 2, 1_743], ["Brandy", 429_800, 3, 3, 2_142], ["Brooks", 429_990, 3, 3, 2_138], ["Cayman", 485_990, 4, 3.5, 2_700],
      ["Hampton", 441_990, 4, 3, 2_399], ["Lauren", 451_990, 3, 3, 2_538], ["Morgan", 427_990, 3, 2, 2_301], ["Shenandoah", 482_990, 4, 3.5, 3_024], ["Summerton", 420_990, 4, 3, 2_052],
    ]);
    expect(result.private.plans.every((plan) => plan.sourceUrl.startsWith(COMMUNITY) && (plan.gallery?.length ?? 0) > 0)).toBe(true);
    for (const secret of ["Alsatian", "Mountain Oak", "White Oak", "Chesmar", "Shenandoah", "Summerton"]) expect(publicJson(result)).not.toContain(secret);
  });

  it("still gives no status to a title in other wording, or to 'Home For Sale' anywhere but the title (the sync holds the run)", async () => {
    const page = live("chesmar-home-brandy-42210000-0044");
    for (const variant of [page.replaceAll("| Home For Sale in Alsatian Oaks", "| Home Reserved in Alsatian Oaks"), page.replaceAll("| Home For Sale in Alsatian Oaks", "| Alsatian Oaks").replace("</body>", "<p>Home For Sale in Alsatian Oaks</p></body>")]) {
      expect(chesmarDetailFacts(variant).status).toBeNull();
      const result = await loadOfficialDeals(config, { fetcher: siteFetcher(chesmarSite({ "brandy/42210000-0044/": variant })).fetcher, now: () => NOW });
      expect(result.private.homes.find((home) => home.privateAddress === "165 Mountain Oak")!.status).toBeNull();
    }
  });
});
