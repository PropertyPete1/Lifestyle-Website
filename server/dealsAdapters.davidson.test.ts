import { beforeEach, describe, expect, it, vi } from "vitest";
import { DavidsonAdapter, davidsonMarketLinks, davidsonRecord, davidsonStatus, parseDavidsonCommunity, parseDavidsonPromotion, parseNextData, resetDavidsonCaches, sanityImageUrl } from "./dealsAdapters.davidson";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Davidson Homes pages in the shape the live site served in October
 * 2026: a Next.js `__NEXT_DATA__` script carrying the community, its homes for
 * sale, its plans and a banner to the region's promotion page. Names and
 * addresses are invented.
 */
const HOST = "https://www.davidsonhomes.com";
const COMMUNITY = `${HOST}/states/texas/san-antonio-market-area/san-antonio/fixture-meadows/`;
const PROMO = "/states/texas/san-antonio-market-area/promotions/sat-rate-promo/";
const image = (hash: string, alt = "Home exterior") => ({ alt, asset: { _ref: `image-${hash}-1620x1080-jpg`, hotspot: null, lqip: "data:image/jpeg;base64,xx" }, caption: null });
const nextPage = (pageProps: unknown, page: string) => `<!DOCTYPE html><html><head><title>Fixture</title><link rel="preload" href="https://cdn.sanity.io/images/2nureyi3/production/39b2f0e5e6be541d3f4ef287c96dc3-1330x256.jpg"></head><body><div id="__next">Loading</div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps }, page, buildId: "qqJMali6", isFallback: false })}</script></body></html>`;

const home = (input: { title: string; slug: string; price: number; old?: number | null; beds: number; baths: number; half: number; sqft: number; lot: string; ready?: boolean; est: string; status?: string; plan: string; hash: string }) => ({
  _id: `id-${input.slug}`, title: input.title, slug: { _type: "slug", current: input.slug }, status: input.status ?? "Active", overrideMls: input.ready ? "moveinready" : "nooverride", estCompletionMonth: input.est,
  price: input.price, oldPrice: input.old ?? null, beds: input.beds, baths: input.baths, halfBaths: input.half, sqft: input.sqft, lotId: input.lot, floorPlanPicker: { title: input.plan }, promotions: [], specialRateDetails: null,
  propertyImages: [image(input.hash), image(`${input.hash}0`, "Kitchen"), image(`${input.hash}1`, "The Colorado B floor plan")], coordinates: { _type: "geopoint", lat: 29.31, lng: -98.55 },
});
const community = {
  _id: "78577ac8", title: "Fixture Meadows", communityStatus: "Now Selling", phone: "2105550400", subStreet1: "10326 Fixture Jct", subZipCode: "78224",
  salesOffice: { outOfCommunity: false, salesOfficeGeocode: { lat: 29.3139, lng: -98.552 }, streetAddress: "10326 Fixture Jct", zipCode: "78224" },
  coordinates: { _type: "geopoint", lat: 29.3119, lng: -98.5503 }, communityPriceRange: { lowestPrice: 260_990, highestPrice: 378_990 },
  schools: [{ schoolTitle: "Southside ISD", schoolType: "district" }], features: ["Community pool", "Playscape", "Near Loop 410"],
  communityBanner: { enableCommunityBanner: true, template: { bannerLink: PROMO, campaign: {} } },
  availableHomes: [
    home({ title: "2535 Fixture Pearl Dr.", slug: "2535-fixture-pearl-dr", price: 289_990, old: 303_030, beds: 4, baths: 2, half: 0, sqft: 1_590, lot: "46-23", ready: true, est: "2026-10-02", plan: "The Colorado B", hash: "aaa1" }),
    home({ title: "2527 Fixture Pearl Dr", slug: "2527-fixture-pearl-dr", price: 348_370, beds: 5, baths: 3, half: 1, sqft: 2_438, lot: "44-23", est: "2026-12-09", plan: "The San Marcos D", hash: "bbb2" }),
    home({ title: "2510 Fixture Meadow", slug: "2510-fixture-meadow", price: 329_990, beds: 5, baths: 3, half: 0, sqft: 2_128, lot: "11-23", est: "2026-10-08", status: "Sold", plan: "The Brazos B", hash: "ccc3" }),
  ],
  plans: [
    { _id: "p1", title: "The Comal C", slug: { current: "the-comal-c-sat" }, price: 260_990, beds: 3, baths: 2, halfBaths: null, sqft: 1_253, propertyImages: [image("ddd4", "The Comal C elevation")] },
    { _id: "p2", title: "The Frio C", slug: { current: "the-frio-c-sat" }, price: 0, beds: 3, baths: 2, halfBaths: 1, sqft: 1_400, propertyImages: [] },
  ],
};
const communityPage = nextPage({ community, city: { title: "San Antonio", slug: "san-antonio" }, region: { title: "San Antonio Region" }, settings: { interestRate: "7.375" } }, "/states/[state]/[region]/[city]/[community]");
const promoPage = nextPage({ promo: {
  title: "Rates as low as 4.5% + $10,000 Flex Cash!", eventStart: "2026-10-19", eventEnd: "2026-10-31", incentivePercentage: "4.5", incentiveApr: "6.38", promotionType: "21buydown", phone: "2107969092",
  content: [{ _type: "block", children: [{ text: "For a limited time, qualified buyers can enjoy a 4.5% FHA (6.380% APR) 5/1 ARM on select quick move-in homes when you purchase by October 31, 2026, plus up to $10,000 toward closing costs and prepaids when financing with NorthStar Mortgage Advisors!*" }] }, { _type: "block", children: [{ text: "Fill out the form or call (210) 796-9092 to learn more. Visit https://www.davidsonhomes.com/finance/ for details." }] }],
  finePrint: [{ _type: "block", children: [{ text: "*FHA financing: 4.5% initial interest rate, 6.380% Annual Percentage Rate. 5/1 ARM: rate fixed for 5 years, then adjusts annually based on the weekly 1-year Treasury (CMT) index plus a 2.00% margin (caps 1/1/5; maximum rate 9.5%). Example: sales price $349,990, 3.5% down ($12,250), 680 credit score. Offer valid on purchase agreements signed by 10/31/2026 and financed through NorthStar Mortgage Advisors." }] }],
  regions: [{ title: "San Antonio Region", communities: [{ title: "Fixture Meadows" }, { title: "Royal Fixture" }] }],
}, settings: {} }, "/states/[state]/[region]/promotions/[slug]");
const marketPage = nextPage({ communities: [
  { _id: "1", title: "Fixture Meadows", city: "San Antonio", uri: "/states/texas/san-antonio-market-area/san-antonio/fixture-meadows/", coordinates: { lat: 29.31, lng: -98.55 } },
  { _id: "2", title: "Far Fixture", city: "Kyle", uri: "/states/texas/san-antonio-market-area/kyle/far-fixture/", coordinates: { lat: 29.99, lng: -97.87 } },
], region: { title: "San Antonio Region" } }, "/states/[state]/[region]");

const site: Record<string, string> = { [COMMUNITY]: communityPage, [`${HOST}${PROMO}`]: promoPage, [`${HOST}/states/texas/san-antonio-market-area/`]: marketPage };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Davidson Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Meadows", scrubList: ["Fixture Meadows", "Fixture Pearl", "Fixture Meadow", "Fixture Jct"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; resetDavidsonCaches(); });

describe("Davidson Homes reader: page data", () => {
  it("reads the community's homes and plans from the page data: address with the office's city and ZIP, prices, specs, lot, move-in, photos without the floor plan", () => {
    const NOW = new Date("2026-10-20T12:00:00Z");
    const parsed = parseDavidsonCommunity(communityPage, COMMUNITY, NOW)!;
    expect(parsed.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.previousPrice, home.priceDrop, home.bedrooms, home.bathrooms, home.squareFeet, home.homesite, home.moveInDate, home.gallery?.length])).toEqual([
      ["2535 Fixture Pearl Dr, San Antonio, TX 78224", "The Colorado B", "Quick Move-In (Move-In Ready)", 289_990, 303_030, 13_040, 4, 2, 1_590, "Lot 46-23", null, 2],
      ["2527 Fixture Pearl Dr, San Antonio, TX 78224", "The San Marcos D", "Quick Move-In (December 2026)", 348_370, null, null, 5, 3.5, 2_438, "Lot 44-23", "December 2026", 2],
      ["2510 Fixture Meadow, San Antonio, TX 78224", "The Brazos B", "Sold", 329_990, null, null, 5, 3, 2_128, "Lot 11-23", null, 2],
    ]);
    expect(parsed.homes[0]!.sourceUrl).toBe(`${COMMUNITY}available-homes/2535-fixture-pearl-dr/`);
    expect(parsed.homes[0]!.gallery![0]!.sourceUrl).toBe("https://cdn.sanity.io/images/2nureyi3/production/aaa1-1620x1080.jpg");
    expect(parsed.plans.map((plan) => [plan.privatePlanName, plan.price, plan.bathrooms, plan.gallery?.[0]?.caption ?? null])).toEqual([["The Comal C", 260_990, 2, "Representative image"], ["The Frio C", null, 2.5, null]]);
    expect(parsed.plans[0]!.sourceUrl).toBe(`${COMMUNITY}floor-plans/the-comal-c-sat/`);
    expect(parsed.facts).toMatchObject({ name: "Fixture Meadows", street: "10326 Fixture Jct", city: "San Antonio", zip: "78224", phone: "2105550400", geo: { lat: 29.3119, lng: -98.5503 }, fromPrice: 260_990, schoolDistrict: "Southside ISD", amenities: ["Community pool", "Playscape", "Near Loop 410"] });
    expect(parsed.promotionPath).toBe(PROMO);
    expect(parseDavidsonCommunity("<html><body>new layout</body></html>", COMMUNITY)).toBeNull();
    // Status words: "Active" is for sale, sold words are sold, anything else or none gives no status (the sync holds the run); overrideMls likewise.
    expect(davidsonStatus("Active", "nooverride")).toEqual({ sold: false, readyNow: false, known: true });
    expect(davidsonStatus("active", null)).toEqual({ sold: false, readyNow: false, known: true });
    expect(davidsonStatus("Active", "moveinready")).toEqual({ sold: false, readyNow: true, known: true });
    expect(davidsonStatus("Under Contract", "nooverride")).toEqual({ sold: true, readyNow: false, known: true });
    expect(davidsonStatus("Active", "undercontract")).toEqual({ sold: true, readyNow: false, known: true });
    for (const word of ["Inactive", "Coming Soon", "Model", "Reserved", "", null]) expect(davidsonStatus(word, "nooverride").known).toBe(false);
    expect(davidsonStatus("Active", "comingsoon").known).toBe(false);
    const withStatuses = (statuses: Array<string | null>, overrides: Array<string | null> = []) => nextPage({ community: { ...community, availableHomes: community.availableHomes.map((entry, index) => { const copy: Record<string, unknown> = { ...entry, status: statuses[index] ?? entry.status, overrideMls: overrides[index] ?? entry.overrideMls }; if (statuses[index] === null) delete copy.status; return copy; }) }, city: { title: "San Antonio" } }, "/x");
    expect(parseDavidsonCommunity(withStatuses(["Inactive", "Active", null]), COMMUNITY, NOW)!.homes.map((home) => home.status)).toEqual([null, "Quick Move-In (December 2026)", null]);
    expect(parseDavidsonCommunity(withStatuses([], ["undercontract", "comingsoon"]), COMMUNITY, NOW)!.homes.map((home) => home.status)).toEqual(["Sold", null, "Sold"]);
    // An entry whose title or slug key moved stays in the list without a status: never dropped, so never swept to sold.
    const renamed = nextPage({ community: { ...community, availableHomes: community.availableHomes.map((entry) => ({ ...entry, title: undefined, name: entry.title })) }, city: { title: "San Antonio" } }, "/x");
    const unreadable = parseDavidsonCommunity(renamed, COMMUNITY, NOW)!;
    expect(unreadable.homes).toHaveLength(3);
    expect(unreadable.homes.map((home) => [home.status, home.privateName])).toEqual([[null, null], [null, null], [null, null]]);
    expect(new Set(unreadable.homes.map((home) => home.sourceUrl)).size).toBe(3);
    // A completion month already past is no move-in date.
    const stale = nextPage({ community: { ...community, availableHomes: [{ ...community.availableHomes[1]!, estCompletionMonth: "2025-03-01" }] }, city: { title: "San Antonio" } }, "/x");
    expect(parseDavidsonCommunity(stale, COMMUNITY, NOW)!.homes[0]).toMatchObject({ status: "Quick Move-In", moveInDate: null });
    expect(parseDavidsonCommunity(nextPage({ community: { title: "x" } }, "/x"), COMMUNITY)).toBeNull();
    expect(parseNextData("<html></html>")).toBeNull();
    expect(sanityImageUrl("image-abc-100x50-png", { id: "p", dataset: "d" })).toBe("https://cdn.sanity.io/images/p/d/abc-100x50.png");
    expect(sanityImageUrl("file-abc", { id: "p", dataset: "d" })).toBeNull();
  });

  it("reads the promotion page's offer as one text, listing the communities it applies to, and the market page's community links", async () => {
    const promo = parseDavidsonPromotion(promoPage)!;
    expect(promo.title).toBe("Rates as low as 4.5% + $10,000 Flex Cash!");
    expect(promo.communities).toEqual(["Fixture Meadows", "Royal Fixture"]);
    expect(promo.text).toContain("4.5% FHA (6.380% APR) 5/1 ARM");
    expect(promo.text).toContain("3.5% down");
    expect(promo.text).not.toMatch(/https?:|\(210\) 796-9092/);
    expect(parseDavidsonPromotion(communityPage)).toBeNull();
    // The lender's NMLS id and form copy are stripped from the offer text; a regions list that names no community is a changed shape.
    const withNmls = promoPage.replace("Advisors!*", "Advisors (NMLS ID No. 1791)!* Fill out the form or call to learn more.");
    expect(parseDavidsonPromotion(withNmls)!.text).not.toMatch(/1791|NMLS|Fill out the form/);
    const nested = promoPage.replace("\"communities\":[{\"title\":\"Fixture Meadows\"},{\"title\":\"Royal Fixture\"}]", "\"communities\":[{\"community\":{\"title\":\"Fixture Meadows\"}}]");
    expect(parseDavidsonPromotion(nested)!.communities).toEqual(["Fixture Meadows"]);
    const nameless = promoPage.replace("\"communities\":[{\"title\":\"Fixture Meadows\"},{\"title\":\"Royal Fixture\"}]", "\"communities\":[]");
    expect(parseDavidsonPromotion(nameless)).toMatchObject({ hasRegions: true, communities: [] });
    resetDavidsonCaches();
    const namelessFetcher = vi.fn(async (input: string) => input.endsWith(PROMO) ? new Response(nameless, { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const heldOffer = await loadOfficialDeals(config, { fetcher: namelessFetcher });
    expect(heldOffer.incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
    expect(heldOffer.private.incentive).toBeNull();
    resetDavidsonCaches();
    expect(davidsonMarketLinks(marketPage)).toEqual(["/states/texas/san-antonio-market-area/san-antonio/fixture-meadows/", "/states/texas/san-antonio-market-area/kyle/far-fixture/"]);
    expect(davidsonMarketLinks(communityPage)).toBeNull();
    expect(davidsonRecord(communityPage, COMMUNITY)).toEqual({ name: "Fixture Meadows", street: "10326 Fixture Jct", city: "San Antonio", zip: "78224", phone: "2105550400", priceFrom: 260_990, geo: { lat: 29.3119, lng: -98.5503 } });
  });
});

describe("Davidson Homes reader: a community", () => {
  it("reads the community page and the region's promotion once an hour, publishes homes and plans scrubbed, and holds the adjustable-rate offer for a look", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => new Date("2026-10-20T12:00:00Z") });
    expect(result.catalogOk).toBe(true);
    expect(requested).toEqual([COMMUNITY, `${HOST}${PROMO}`]);
    expect(result.private.homes.map((home) => [home.privateName, home.status])).toEqual([["2535 Fixture Pearl Dr", "Quick Move-In (Move-In Ready)"], ["2527 Fixture Pearl Dr", "Quick Move-In (December 2026)"], ["2510 Fixture Meadow", "Sold"]]);
    expect(result.private.plans).toHaveLength(2);
    // The offer is a 5/1 ARM: every fact is read, and the adjustable rate holds it for the admin's look.
    expect(result.private.incentive?.facts).toMatchObject({ promotionalRatePercent: 4.5, aprPercent: 6.38, loanType: "FHA", downPaymentPercent: 3.5, contractDeadline: { isoDate: "2026-10-31" }, publishable: false });
    expect(result.private.incentive?.facts.holdReasons).toContain("adjustable_rate");
    expect(result.incentiveHoldReasons).toContain("adjustable_rate");
    expect(result.public.incentive).toBeNull();
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78224", "davidsonhomes", "Davidson", "NorthStar", "Colorado"]) expect(json).not.toContain(secret);
    // Another community of the region within the hour reuses the promotion page.
    requested.length = 0;
    const other = `${HOST}/states/texas/san-antonio-market-area/san-antonio/royal-fixture/`;
    site[other] = communityPage.replace("\"title\":\"Fixture Meadows\"", "\"title\":\"Royal Fixture\"");
    const second = await loadOfficialDeals({ ...config, sourceUrl: other, privateCommunityName: "Royal Fixture" }, { fetcher, now: () => new Date("2026-10-20T12:30:00Z") });
    expect(requested).toEqual([other]);
    expect(second.private.incentive).not.toBeNull();
    // A community the promotion does not list gets no offer from it.
    const third = await loadOfficialDeals({ ...config, sourceUrl: other, privateCommunityName: "Elsewhere Fixture" }, { fetcher, now: () => new Date("2026-10-20T12:40:00Z") });
    expect(third.private.incentive).toBeNull();
    delete site[other];
  });

  it("holds the run when the page is not a community page, when the site is not Davidson's, or when it cannot be read; a missing promotion page holds the offer only", async () => {
    const reshaped = vi.fn(async () => new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://davidsonhomes.com/states/texas/san-antonio-market-area/san-antonio/fixture-meadows/" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
    const noPromo = vi.fn(async (input: string) => input.endsWith(PROMO) ? new Response("gone", { status: 404, headers: { "content-type": "text/html" } }) : fetcher(input));
    const held = await loadOfficialDeals(config, { fetcher: noPromo });
    expect(held.catalogOk).toBe(true);
    expect(held.incentiveHoldReasons).toEqual(["incentive_fetch_failed"]);
    expect(held.public.homes).toHaveLength(3);
  });

  it("is an adapter the registry knows", () => {
    expect(new DavidsonAdapter().builder).toBe("Davidson Homes");
    expect(DEAL_ADAPTERS["Davidson Homes"].builder).toBe("Davidson Homes");
  });
});
