import { beforeEach, describe, expect, it, vi } from "vitest";
import { DavidWeekleyAdapter, parseWeekleyCommunity, parseWeekleyPageData, parseWeekleyPromotions, resetWeekleyCaches, weekleyListingEntries, weekleyListingUrl, weekleyPromotionsUrl, weekleyRecord, weekleyShowcaseCounts, weekleyStatus } from "./dealsAdapters.weekley";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic David Weekley pages in the shape the live site served in October
 * 2026: `window.pageData= {...}` with plans and quick move-ins, the market's
 * JSON community list and promotion list. Names and addresses are invented.
 */
const HOST = "https://www.davidweekleyhomes.com";
const ASSETS = "https://assetcontentdeliveryapi.davidweekleyhomes.com";
const COMMUNITY = `${HOST}/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45`;
const NOW = new Date("2026-10-20T12:00:00Z");
const communityRecord = { Id: "communities/22915", Name: "Fixture Ranch – Select Classic Series", Token: "/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45", PhoneNumber: "210-399-2074", Address: { Line1: "13222 Fixture Acacia", City: "San Antonio", StateAbbreviation: "TX", ZipCode: "78245" }, HidePricing: { HidePlanPrices: false, HideQmiPrices: false } };
const plan = (input: { name: string; price: number; display?: string; beds: number; baths: number; half: number; sqft: number; hide?: boolean }) => ({
  Name: input.name, Token: `/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45/${input.name.toLowerCase()}`, Status: "Active", IsActive: true, NotOnWebsite: false, Community: communityRecord, CommunityId: "communities/22915",
  BasePrice: input.price, PriceDisplay: input.display ?? `$${input.price.toLocaleString("en-US")}`, HidePlanPrice: input.hide ?? false,
  SquareFootage: { Minimum: input.sqft, Maximum: input.sqft + 9 }, Stories: { Minimum: 1, Maximum: 1 }, Bedrooms: { Minimum: input.beds, Maximum: input.beds }, FullBaths: { Minimum: input.baths, Maximum: input.baths }, HalfBaths: { Minimum: input.half, Maximum: input.half }, Garages: { Minimum: 2, Maximum: 2 },
  Elevations: [{ Name: "B", Renderings: [{ Url: `${HOST}/media/ElevationRendering/${input.name.toLowerCase()}-b.jpg`, Caption: `The ${input.name} - B Exterior` }] }],
  FloorPlanImages: [{ Url: `${ASSETS}/03TqOc`, Caption: "1st Floor" }],
});
const qmi = (input: { street: string; job: string; price: number; label: string; date: string; plan: string; beds: number; baths: number; half: number; sqft: number; stage: number; hidden?: boolean; ready?: boolean; communityId?: string; photos?: number }) => ({
  Token: `/homes-ready-soon/tx/san-antonio/san-antonio/fixture-ranch-45/${input.job}`, Name: input.plan, Title: `${input.street}, San Antonio, TX 78245 Move-In Ready Home`, CommunityId: input.communityId ?? "communities/22915", IsModel: false,
  Address: { Line1: input.street, Line2: null, City: "San Antonio", StateAbbreviation: "TX", ZipCode: "78245" }, ReadyDate: input.date, ReadyLabel: input.label, IsCompleted: input.label === "Ready Now",
  Price: input.price, HideQmiPrice: false, PriceDisplay: `$${input.price.toLocaleString("en-US")}`, SquareFootage: input.sqft, Stories: 1, Bedrooms: input.beds, FullBaths: input.baths, HalfBaths: input.half, Garages: 2,
  JobNumber: input.job, Stage: input.stage, Hidden: input.hidden ?? false, Ready: input.ready ?? true, LostReadyStatus: null, Community: communityRecord,
  ExteriorPhotos: Array.from({ length: input.photos ?? 1 }, (_, index) => ({ Url: `${ASSETS}/ext${input.job}${index}`, Caption: "Front exterior" })),
  InteriorPhotos: [{ Url: `${HOST}/media/InteriorPhoto/${input.job}-kitchen.jpg`, Caption: "Kitchen" }],
  Elevation: { Name: "F", Renderings: [{ Url: `${HOST}/media/ElevationRendering/${input.job}-f.jpg`, Caption: "F Exterior" }] },
  FloorPlanImages: [{ Url: `${ASSETS}/fp${input.job}`, Caption: "Floor plan" }],
});
const PLANS = [plan({ name: "Cassia", price: 367_990, beds: 3, baths: 2, half: 0, sqft: 1_652 }), plan({ name: "Dahlia", price: 411_990, display: " Call For Information", beds: 4, baths: 3, half: 1, sqft: 2_433 })];
const HOMES = [
  qmi({ street: "13224 Fixture Willow", job: "24230018", price: 365_480, label: "Ready Now", date: "2026-07-31T00:00:00", plan: "Amaryllis", beds: 3, baths: 2, half: 0, sqft: 1_891, stage: 10 }),
  qmi({ street: "13223 Fixture Willow", job: "24230008", price: 383_990, label: "Ready 11/2/2026", date: "2026-11-02T00:00:00", plan: "Cassia", beds: 3, baths: 2, half: 0, sqft: 1_652, stage: 8 }),
  qmi({ street: "4207 Fixture Bend", job: "24230036", price: 419_480, label: "Ready Now", date: "2026-10-05T00:00:00", plan: "Dahlia", beds: 4, baths: 3, half: 1, sqft: 2_433, stage: 10 }),
];
function communityPage(input: { homes?: ReturnType<typeof qmi>[]; plans?: ReturnType<typeof plan>[]; availability?: string; office?: boolean; qmis?: boolean; data?: boolean; url?: string } = {}) {
  const data: Record<string, unknown> = {
    communityName: "Fixture Ranch – Select Classic Series", communityNumber: "24230000", communityType: "Normal", communityAvailability: input.availability ?? "Active", isEncore: false, communityFromPrice: "$365s", basePrice: 365480, communityId: "communities/22915",
    salesOffices: input.office === false ? [] : [{ Address: "13222 Fixture Acacia<br />San Antonio, TX 78245", SearchableAddress: "29.3929823888344,-98.7576751930276", Hours: "Monday - Saturday 10:00 AM - 7:00 PM" }],
    amenities: "Golf Course within 5 miles,Home Owners Association,Park,Playground,Pool", marketCode: "SAN", city: "San Antonio", state: "TX", url: input.url ?? COMMUNITY,
    floorplans: input.plans ?? PLANS, imageUrl: `${HOST}/media/CommunityImage/x.jpg`,
  };
  if (input.qmis !== false) data.quickMoveIns = input.homes ?? HOMES;
  return `<!DOCTYPE html><html><head><title>Fixture Ranch</title></head><body>
<div class="community"><h1>Fixture Ranch – Select Classic Series</h1><p>Students attend Medina Valley ISD schools.</p><p>Sales Consultant Alan Fixture</p></div>
${input.data === false ? "" : `<script>window.pageData= ${JSON.stringify(data)};\r\n</script>`}
<div class="outer-wrap"><ul class="breadcrumbs"><li><a href="/">Home</a></li></ul></div></body></html>`;
}
const listing = JSON.stringify({ Communities: [
  { Id: "communities/13442", Token: "/new-homes/tx/san-antonio/san-antonio/build-on-your-lot-san-antonio", Name: "Build on Your Lot", CommunityType: 2, City: { Name: "San Antonio" }, Latitude: 29.69, Longitude: -98.45 },
  { Id: "communities/22915", Token: "/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45", Name: "Fixture Ranch – Select Classic Series", CommunityType: 1, CommunityStatuses: 1, City: { Name: "San Antonio" }, Latitude: 29.3929823888344, Longitude: -98.7576751930276, BasePrice: 365480, CommunityPhoneNumber: "(210) 399-2074", ShowcaseCount: 3 },
  { Id: "communities/99", Token: "https://evil.example/new-homes/tx/san-antonio/x/y", Name: "Elsewhere", CommunityType: 1 },
  { Id: "communities/100", Token: "/new-homes/tx/san-antonio/san-antonio/later-ranch", Name: "Later Ranch", CommunityType: 1, CommunityStatuses: 3, ShowcaseCount: 0 },
], NeighborhoodGroups: [{ NeighborhoodName: "Fixture Ranch", Communities: [
  { Id: "communities/22915", Token: "/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45", Name: "Fixture Ranch – Select Classic Series", CommunityType: 1 },
  { Id: "communities/22916", Token: "/new-homes/tx/san-antonio/san-antonio/fixture-ranch-60", Name: "Fixture Ranch – Signature Legacy Series", CommunityType: 1, ShowcaseCount: 0 },
] }] });
const promotionsBody = JSON.stringify([
  { Description: "David Weekley Homes is honoring active medical personnel, firefighters, police officers, military service men and women, and teachers with $2,000 in flex dollars.", Token: "/promo/hometown-heroes-san-antonio", StartDate: "2026-01-05T00:00:00", EndDate: "2027-01-01T00:00:00", IsSiteWide: false, IsMarketEligible: true, ShowOnCommunityIds: ["communities/13442", "communities/22915", "communities/22916"], Disclaimer: "See a Sales Consultant for details. Call 210-399-2074 or visit www.davidweekleyhomes.com/promo." },
  { Description: "Join our free Build on Your Lot Seminar!", Token: "/promo/build-on-your-lot-seminar-san", StartDate: "2026-08-24T00:00:00Z", EndDate: "2026-10-25T00:00:00", IsSiteWide: false, ShowOnCommunityIds: ["communities/13442"] },
  { Description: "Expired savings.", Token: "/promo/old", StartDate: "2026-01-01T00:00:00", EndDate: "2026-09-30T00:00:00", IsSiteWide: false, ShowOnCommunityIds: ["communities/22915"] },
]);
const ratePromotion = { Description: "4.99% (5.42% APR) 30-year fixed FHA rate with 3.5% down on select homes.", Token: "/promo/rate", StartDate: "2026-10-01T00:00:00", EndDate: "2026-12-31T00:00:00", IsSiteWide: true, ShowOnCommunityIds: [] };

const site: Record<string, { body: string; type?: string }> = { [COMMUNITY]: { body: communityPage() }, [weekleyListingUrl()]: { body: listing, type: "application/json" }, [weekleyPromotionsUrl()]: { body: promotionsBody, type: "application/json" } };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const entry = site[input];
  return entry ? new Response(entry.body, { status: 200, headers: { "content-type": entry.type ?? "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "David Weekley Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Ranch", scrubList: ["Fixture Ranch", "Fixture Willow", "Fixture Bend", "Fixture Acacia", "Alan Fixture"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; resetWeekleyCaches(); });

describe("David Weekley reader: page data", () => {
  it("reads plans and quick move-ins from the page data: office address, hidden plan prices, status from the ready label, job number, photos without the floor plan", () => {
    expect(parseWeekleyPageData('x; window.pageData= {"a":"}","b":[{"c":"\\"]"}]};\r\n</script>')).toEqual({ a: "}", b: [{ c: "\"]" }] });
    expect(parseWeekleyPageData("window.pageData= {\"a\":1")).toBeNull();
    expect(parseWeekleyPageData("<html></html>")).toBeNull();
    const parsed = parseWeekleyCommunity(communityPage(), COMMUNITY, NOW)!;
    expect(parsed.record).toEqual({ name: "Fixture Ranch – Select Classic Series", street: "13222 Fixture Acacia", city: "San Antonio", zip: "78245", phone: "2103992074", priceFrom: 365_480, geo: { lat: 29.3929823888344, lng: -98.7576751930276 } });
    expect(parsed.availability).toBe("Active");
    expect(parsed.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.homesite, home.readyNow, home.moveInDate, home.gallery?.length])).toEqual([
      ["13224 Fixture Willow, San Antonio, TX 78245", "Amaryllis", "Quick Move-In (Move-In Ready)", 365_480, 3, 2, 1_891, "Job 24230018", true, null, 3],
      ["13223 Fixture Willow, San Antonio, TX 78245", "Cassia", "Quick Move-In (November 2026)", 383_990, 3, 2, 1_652, "Job 24230008", false, "November 2026", 3],
      ["4207 Fixture Bend, San Antonio, TX 78245", "Dahlia", "Quick Move-In (Move-In Ready)", 419_480, 4, 3.5, 2_433, "Job 24230036", true, null, 3],
    ]);
    expect(parsed.homes[0]!.sourceUrl).toBe(`${HOST}/homes-ready-soon/tx/san-antonio/san-antonio/fixture-ranch-45/24230018`);
    expect(parsed.homes[0]!.gallery!.map((image) => image.sourceUrl)).toEqual([`${ASSETS}/ext242300180`, `${HOST}/media/ElevationRendering/24230018-f.jpg`, `${HOST}/media/InteriorPhoto/24230018-kitchen.jpg`]);
    // A plan whose price display is "Call For Information" keeps no price; drawings are not photos.
    expect(parsed.plans.map((entry) => [entry.privatePlanName, entry.price, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.gallery?.length, entry.gallery?.[0]?.caption])).toEqual([["Cassia", 367_990, 3, 2, 1_652, 1, "Representative image"], ["Dahlia", null, 4, 3.5, 2_433, 1, "Representative image"]]);
    expect(parsed.plans[0]!.sourceUrl).toBe(`${COMMUNITY}/cassia`);
    expect(parsed.facts).toEqual({ schoolDistrict: null, amenities: ["Golf Course within 5 miles", "Home Owners Association", "Park", "Playground", "Pool"] });
    expect(parseWeekleyCommunity("<html><body>new layout</body></html>", COMMUNITY)).toBeNull();
    expect(parseWeekleyCommunity(communityPage({ qmis: false }), COMMUNITY, NOW)).toBeNull();
    expect(weekleyRecord(communityPage(), COMMUNITY)).toMatchObject({ street: "13222 Fixture Acacia" });
    expect(weekleyRecord(communityPage({ office: false }), COMMUNITY)).toBeNull();
    // Status: ready now, a future month, a past month (no date), unknown wording or none (no status), sold.
    expect(weekleyStatus("Ready Now", "2026-07-31T00:00:00", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(weekleyStatus("Ready 1/4/2027", "2027-01-04T00:00:00", NOW)).toEqual({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    expect(weekleyStatus("Ready 9/4/2026", "2026-09-04T00:00:00", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(weekleyStatus("Sold", null, NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    for (const word of ["Coming Soon", "Ready Soon", "TBD", "", null]) expect(weekleyStatus(word, "2026-11-02T00:00:00", NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    // A hidden home is not on the page the visitor sees; an entry of another community, without a street, or not marked ready has no status.
    const odd = parseWeekleyCommunity(communityPage({ homes: [
      qmi({ ...HOMES[0]!, street: "1 Hidden", job: "1", price: 1, label: "Ready Now", date: "2026-07-31T00:00:00", plan: "x", beds: 3, baths: 2, half: 0, sqft: 1, stage: 10, hidden: true }),
      qmi({ street: "9 Other St", job: "2", price: 400_000, label: "Ready Now", date: "2026-07-31T00:00:00", plan: "x", beds: 3, baths: 2, half: 0, sqft: 1_900, stage: 10, communityId: "communities/99" }),
      qmi({ street: "", job: "3", price: 400_000, label: "Ready Now", date: "2026-07-31T00:00:00", plan: "x", beds: 3, baths: 2, half: 0, sqft: 1_900, stage: 10 }),
      qmi({ street: "4 Not Ready", job: "4", price: 400_000, label: "Ready Now", date: "2026-07-31T00:00:00", plan: "x", beds: 3, baths: 2, half: 0, sqft: 1_900, stage: 3, ready: false }),
    ] }), COMMUNITY, NOW)!;
    expect(odd.homes.map((home) => home.status)).toEqual([null, null, null]);
    // A model home is not for sale; a lost ready status is a hold; the data's own url and the plan tokens must be this community's.
    const model = { ...qmi({ street: "5 Model Way", job: "5", price: 400_000, label: "Ready Now", date: "2026-07-31T00:00:00", plan: "x", beds: 3, baths: 2, half: 0, sqft: 1_900, stage: 10 }), IsModel: true };
    const lost = { ...qmi({ street: "6 Lost Way", job: "6", price: 400_000, label: "Ready Now", date: "2026-07-31T00:00:00", plan: "x", beds: 3, baths: 2, half: 0, sqft: 1_900, stage: 10 }), LostReadyStatus: "Lost" };
    expect(parseWeekleyCommunity(communityPage({ homes: [model, lost] }), COMMUNITY, NOW)!.homes.map((home) => home.status)).toEqual(["Model", null]);
    expect(parsed).toMatchObject({ foreignPage: false, foreignPlan: false });
    expect(parseWeekleyCommunity(communityPage({ url: `${HOST}/new-homes/tx/san-antonio/san-antonio/other-ranch-60` }), COMMUNITY, NOW)!.foreignPage).toBe(true);
    expect(parseWeekleyCommunity(communityPage({ url: `${HOST}/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45/` }), COMMUNITY, NOW)!.foreignPage).toBe(false);
    const elsewhere = { ...plan({ name: "Zinnia", price: 300_000, beds: 3, baths: 2, half: 0, sqft: 1_500 }), Token: "/new-homes/tx/san-antonio/san-antonio/other-ranch-60/zinnia" };
    expect(parseWeekleyCommunity(communityPage({ plans: [elsewhere] }), COMMUNITY, NOW)).toMatchObject({ foreignPlan: true, plans: [] });
    expect(weekleyShowcaseCounts(listing)).toEqual(new Map([["communities/22915", 3], ["communities/100", 0], ["communities/22916", 0]]));
    expect(weekleyShowcaseCounts("<html>")).toBeNull();
  });

  it("lists the market's communities from the JSON endpoint, build-on-your-lot, coming-soon and other hosts left out, each once; reads the promotions with their communities", () => {
    expect(weekleyListingEntries(listing, "www.davidweekleyhomes.com")!.map((entry) => entry.url)).toEqual([COMMUNITY, `${HOST}/new-homes/tx/san-antonio/san-antonio/fixture-ranch-60`]);
    expect(weekleyListingEntries("<html>", "www.davidweekleyhomes.com")).toBeNull();
    expect(weekleyListingEntries("{\"Other\":[]}", "www.davidweekleyhomes.com")).toBeNull();
    const promotions = parseWeekleyPromotions(promotionsBody)!;
    expect(promotions.map((promotion) => [promotion.communityIds.length, promotion.end])).toEqual([[3, "2027-01-01T00:00:00"], [1, "2026-10-25T00:00:00"], [1, "2026-09-30T00:00:00"]]);
    expect(promotions[0]!.text).not.toMatch(/210-399|www\./);
    expect(parseWeekleyPromotions("<html>")).toBeNull();
  });
});

describe("David Weekley reader: a community", () => {
  it("reads the page and the promotion list once an hour, publishes homes and plans scrubbed, and attaches the promotion naming this community", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY, weekleyListingUrl(), weekleyPromotionsUrl()]);
    expect(result.private.homes).toHaveLength(3);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 365_480, amenities: ["Golf Course within 5 miles", "Home Owners Association", "Park", "Playground", "Pool"] });
    // The heroes promotion names this community; the seminar and the expired one do not apply.
    expect(result.private.incentive?.text).toBe("David Weekley Homes is honoring active medical personnel, firefighters, police officers, military service men and women, and teachers with $2,000 in flex dollars. See a Sales Consultant for details.");
    expect(result.public.incentive?.text).not.toMatch(/Weekley/);
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78245", "davidweekleyhomes", "Weekley", "Alan", "24230018"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((home) => home.status)).toEqual(["Quick Move-In (Move-In Ready)", "Quick Move-In (November 2026)", "Quick Move-In (Move-In Ready)"]);
    // A second community within the hour reuses the market list and the promotion list.
    requested.length = 0;
    const other = `${HOST}/new-homes/tx/san-antonio/san-antonio/fixture-ranch-60`;
    site[other] = { body: communityPage().replace(/communities\/22915/g, "communities/22916").replace(/fixture-ranch-45/g, "fixture-ranch-60") };
    const second = await loadOfficialDeals({ ...config, sourceUrl: other }, { fetcher, now: () => new Date("2026-10-20T12:30:00Z") });
    expect(requested).toEqual([other]);
    expect(second.private.incentive).not.toBeNull();
    // A community no promotion names gets none.
    site[other] = { body: communityPage().replace(/communities\/22915/g, "communities/555").replace(/fixture-ranch-45/g, "fixture-ranch-60") };
    const third = await loadOfficialDeals({ ...config, sourceUrl: other }, { fetcher, now: () => new Date("2026-10-20T12:40:00Z") });
    expect(third.private.incentive).toBeNull();
    delete site[other];
    // A close-out community with nothing left is a community with no homes and no plans, when the market list counts none for it.
    const closeOut = vi.fn(async (input: string) => input === COMMUNITY ? new Response(communityPage({ homes: [], plans: [], availability: "Close Out" }).replace(/communities\/22915/g, "communities/22916"), { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const empty = await loadOfficialDeals(config, { fetcher: closeOut, now: () => NOW });
    expect(empty.holdReasons).toEqual([]);
    expect(empty.private.homes).toEqual([]);
  });

  it("takes ONE promotion as the offer: the community's own naming a rate, else a site-wide rate, else the community's first; never two joined", async () => {
    const withRate = vi.fn(async (input: string) => input === weekleyPromotionsUrl() ? new Response(JSON.stringify([...JSON.parse(promotionsBody), ratePromotion]), { status: 200, headers: { "content-type": "application/json" } }) : fetcher(input));
    const result = await loadOfficialDeals(config, { fetcher: withRate, now: () => NOW });
    expect(result.private.incentive?.text).toBe("4.99% (5.42% APR) 30-year fixed FHA rate with 3.5% down on select homes.");
    // The heroes promotion's wording never reaches the rate's record.
    expect(result.private.incentive?.text).not.toMatch(/flex dollars/);
    expect(result.private.incentive?.facts).toMatchObject({ promotionalRatePercent: 4.99, aprPercent: 5.42, contractDeadline: null });
    resetWeekleyCaches();
    const communityRate = { ...ratePromotion, Description: "5.25% (5.6% APR) 30-year fixed conventional rate with 5% down.", IsSiteWide: false, ShowOnCommunityIds: ["communities/22915"] };
    const both = vi.fn(async (input: string) => input === weekleyPromotionsUrl() ? new Response(JSON.stringify([ratePromotion, ...JSON.parse(promotionsBody), communityRate]), { status: 200, headers: { "content-type": "application/json" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: both, now: () => NOW })).private.incentive?.text).toBe("5.25% (5.6% APR) 30-year fixed conventional rate with 5% down.");
    // A percentage that is not a rate ("3% toward closing costs") does not beat the rate offer.
    resetWeekleyCaches();
    const closing = { ...ratePromotion, Description: "Up to 3% toward closing costs on select quick move-in homes.", IsSiteWide: false, ShowOnCommunityIds: ["communities/22915"] };
    const mixed = vi.fn(async (input: string) => input === weekleyPromotionsUrl() ? new Response(JSON.stringify([closing, ratePromotion]), { status: 200, headers: { "content-type": "application/json" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: mixed, now: () => NOW })).private.incentive?.text).toBe("4.99% (5.42% APR) 30-year fixed FHA rate with 3.5% down on select homes.");
  });

  it("holds the run when the page is not a community page, when the home array is gone, when the availability wording is unknown, when the site is not Weekley's, or when it cannot be read; a missing promotion list holds the offer only", async () => {
    const reshaped = vi.fn(async () => new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noQmis = vi.fn(async () => new Response(communityPage({ qmis: false }), { status: 200, headers: { "content-type": "text/html" } }));
    const held = await loadOfficialDeals(config, { fetcher: noQmis });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    const noOffice = vi.fn(async () => new Response(communityPage({ office: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noOffice })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A home whose page lives under another community's slug is not this community's inventory.
    const foreign = vi.fn(async () => new Response(communityPage().replace("/homes-ready-soon/tx/san-antonio/san-antonio/fixture-ranch-45/24230008", "/homes-ready-soon/tx/san-antonio/san-antonio/other-ranch-60/24230008"), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: foreign, now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    // A same-host redirect to another community's page, or a plan under another community's slug, is never this community's inventory.
    const redirected = vi.fn(async () => new Response(communityPage({ url: `${HOST}/new-homes/tx/san-antonio/san-antonio/other-ranch-60` }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: redirected, now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    const foreignPlan = vi.fn(async () => new Response(communityPage().replace("/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45/cassia", "/new-homes/tx/san-antonio/san-antonio/other-ranch-60/cassia"), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: foreignPlan, now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    // The market list counts three homes for sale here: a page listing fewer changed shape; with the list unreachable an empty page is not trusted, a full one is.
    resetWeekleyCaches();
    const fewer = vi.fn(async (input: string) => input === COMMUNITY ? new Response(communityPage({ homes: HOMES.slice(0, 1) }), { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: fewer, now: () => NOW })).holdReasons).toEqual(["incomplete_inventory"]);
    resetWeekleyCaches();
    const noListing = vi.fn(async (input: string) => input === weekleyListingUrl() ? new Response("gone", { status: 404, headers: { "content-type": "text/html" } }) : input === COMMUNITY ? new Response(communityPage({ homes: [] }), { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: noListing, now: () => NOW })).holdReasons).toEqual(["incomplete_inventory"]);
    const noListingFull = vi.fn(async (input: string) => input === weekleyListingUrl() ? new Response("gone", { status: 404, headers: { "content-type": "text/html" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: noListingFull, now: () => NOW })).holdReasons).toEqual([]);
    // Without the community's id nothing ties the homes or the market count to this community.
    const noId = vi.fn(async () => new Response(communityPage().replace(`"communityId":"communities/22915"`, `"communityId":null`), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noId, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    resetWeekleyCaches();
    const oddAvailability = vi.fn(async () => new Response(communityPage({ availability: "Sold Out" }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: oddAvailability })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://davidweekleyhomes.com/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
    const noPromo = vi.fn(async (input: string) => input === weekleyPromotionsUrl() ? new Response("gone", { status: 404, headers: { "content-type": "text/html" } }) : fetcher(input));
    const offerHeld = await loadOfficialDeals(config, { fetcher: noPromo, now: () => NOW });
    expect(offerHeld.catalogOk).toBe(true);
    expect(offerHeld.incentiveHoldReasons).toEqual(["incentive_fetch_failed"]);
    expect(offerHeld.public.homes).toHaveLength(3);
  });

  it("is an adapter the registry knows", () => {
    expect(new DavidWeekleyAdapter().builder).toBe("David Weekley Homes");
    expect(DEAL_ADAPTERS["David Weekley Homes"].builder).toBe("David Weekley Homes");
  });
});
