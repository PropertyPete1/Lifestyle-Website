import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadOfficialDeals, type CommunitySourceConfig, type HtmlFetcher } from "./dealsAdapters";
import { homefinitiStatus, parseHomefinitiRecords } from "./dealsAdapters.homefiniti";
import { kbStatus } from "./dealsAdapters.kbhome";
import { parseTexasHomesCommunity, resetTexasHomesCaches, texasHomesHomesUrl } from "./dealsAdapters.texashomes";
import { parseTollCommunity } from "./dealsAdapters.toll";
import { parseViewHomesCommunity, resetViewHomesCaches, viewHomesListingUrl } from "./dealsAdapters.viewhomes";

/**
 * Regression tests on the pages the official sites served late on October 20,
 * 2026 (about 11 PM Central, the readers' User-Agent, redirects followed),
 * when the nightly sync still held these communities. The fixtures in
 * fixtures/deals/live-2026-10-20b/ are those captures with scripts other than
 * the data the readers use (JSON-LD, `__NEXT_DATA__`, KB's inline arrays),
 * styles, inline SVG, comments, non-canonical links and image source sets
 * removed, then gzipped; the markup and data the readers parse are as served.
 * Pages the captures do not include (the View Homes roster) are synthetic and
 * say so where they are built.
 */
const NOW = new Date("2026-10-21T04:00:00Z");
const live = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-10-20b/${name}.html.gz`, import.meta.url))).toString("utf8");
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

  it("still holds a model without its list that does not count zero, and Shavano Highlands, whose site plan counts a home the data does not list", async () => {
    // Amaury without its list but counting a home: the list moved, never a sold home.
    const counted = siteFetcher({ [BRIGGS]: live("toll-briggs-ranch").replace('"qmiCount":0', '"qmiCount":1') });
    const held = await loadOfficialDeals(config, { fetcher: counted.fetcher, now: () => NOW });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    // No count at all beside a missing list: held too.
    const uncounted = siteFetcher({ [BRIGGS]: live("toll-briggs-ranch").replace('"qmiCount":0', '"qmiTotal":0') });
    expect((await loadOfficialDeals(config, { fetcher: uncounted.fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // Shavano Highlands: six models, none with homes (qmiCount 0 each), while the site plan counts one quick move-in lot. That
    // disagreement is held (the site plan's lot data was not captured), never read as "nothing for sale".
    const shavanoPage = live("toll-shavano-highlands");
    const shavano = parseTollCommunity(shavanoPage, SHAVANO, NOW)!;
    expect([shavano.shapeIntact, shavano.homes.length, shavano.plans.length, shavano.sitePlanHomes]).toEqual([true, 0, 6, 1]);
    const { fetcher } = siteFetcher({ [SHAVANO]: shavanoPage });
    const result = await loadOfficialDeals({ builder: "Toll Brothers", sourceUrl: SHAVANO, privateCommunityName: "Shavano Highlands", scrubList: ["Shavano Highlands"] }, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual(["expected_community_container_not_found"]);
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
  const COMMUNITY = "https://www.coventryhomes.com/new-homes/tx/san-antonio/garden-grove/";
  const config: CommunitySourceConfig = { builder: "Coventry Homes", sourceUrl: COMMUNITY, privateCommunityName: "Garden Grove", scrubList: ["Garden Grove"] };

  it("finds the live hold: every home sits under garden-grove-40/ or garden-grove-50/, each record twice, and one card (4912 Hawkwell Lane) has no record; still held", async () => {
    const page = live("coventry-garden-grove");
    const records = parseHomefinitiRecords(page, "www.coventryhomes.com");
    expect(records.homes).toHaveLength(17);
    expect(records.plans).toEqual([]);
    expect(new Set(records.homes.map((home) => new URL(home.sourceUrl).pathname.split("/")[4]))).toEqual(new Set(["garden-grove-40", "garden-grove-50"]));
    const cardHomes = new Set(Array.from(page.matchAll(/href="(\/new-homes\/tx\/san-antonio\/garden-grove-[45]0\/[a-z0-9-]+\/[a-z0-9-]+\/)"/g), (match) => match[1]));
    expect(cardHomes.size).toBe(18);
    expect(records.homes.some((home) => home.sourceUrl.includes("4912-hawkwell-lane"))).toBe(false);
    // The child list counts 10 + 8 homes; the plans (6 + 7) are only on the collection pages, which were not captured.
    expect(page).toMatch(/Garden Grove 40'[\s\S]*?10 Homes[\s\S]*?6 Plans[\s\S]*?Garden Grove 50'[\s\S]*?8 Homes[\s\S]*?7 Plans/);
    const { fetcher } = siteFetcher({ [COMMUNITY]: page });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual(["invalid_inventory_response"]);
    expect(result.public.homes).toEqual([]);
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
  /** The Texas roster was not captured: synthetic, in the live shape (status.status.{value,label}, address, homes[]). */
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

  it("reads Ladera and Enclave 35 as coming soon (nothing for sale) when the roster lists them as coming soon with no homes", async () => {
    for (const [name, url, community] of [["view-ladera", LADERA, "Ladera"], ["view-enclave-35", ENCLAVE, "Enclave 35 at Medical Center"]] as const) {
      resetViewHomesCaches();
      const { fetcher, requested } = siteFetcher({ [url]: live(name), [viewHomesListingUrl()]: soonRoster });
      const result = await loadOfficialDeals({ builder: "View Homes", sourceUrl: url, privateCommunityName: community, scrubList: [community] }, { fetcher, now: () => NOW });
      // The catalog reads; the site-wide promo page the hero banner links was not captured, so only the offer is held.
      expect(result.catalogOk).toBe(true);
      expect(result.holdReasons).toEqual(["incentive_fetch_failed"]);
      expect(result.incentiveHoldReasons).toEqual(["incentive_fetch_failed"]);
      expect(requested.slice(0, 2)).toEqual([url, viewHomesListingUrl()]);
      expect(result.private.homes).toEqual([]);
      expect(result.private.plans).toEqual([]);
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

  it("goes on to the community's quick move-in list (not captured: the run holds there until it is)", async () => {
    const { fetcher, requested } = siteFetcher({ [COMMUNITY]: live("texas-enclave-potranco-oaks") });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(requested).toEqual([COMMUNITY, texasHomesHomesUrl(424)]);
    expect(result.holdReasons).toEqual(["community_fetch_failed"]);
    expect(result.public.homes).toEqual([]);
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

describe("Chesmar: the Alsatian Oaks community page (October 20, 2026)", () => {
  it("passes its container check and goes on to the sitemap; the home pages that carry the status were not captured", async () => {
    const COMMUNITY = "https://www.chesmar.com/texas/san-antonio-new-homes/castroville/alsatian-oaks/";
    const { fetcher, requested } = siteFetcher({ [COMMUNITY]: live("chesmar-alsatian-oaks") });
    const result = await loadOfficialDeals({ builder: "Chesmar", sourceUrl: COMMUNITY, privateCommunityName: "Alsatian Oaks", scrubList: ["Alsatian Oaks"] }, { fetcher, now: () => NOW });
    expect(requested).toEqual([COMMUNITY, "https://www.chesmar.com/sitemap.xml"]);
    expect(result.holdReasons).toEqual(["sitemap_fetch_failed"]);
  });
});
