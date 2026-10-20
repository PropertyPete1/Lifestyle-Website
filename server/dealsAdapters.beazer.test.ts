import { beforeEach, describe, expect, it, vi } from "vitest";
import { BeazerAdapter, beazerListingEntries, beazerListingUrl, beazerRecord, beazerStatus, parseBeazerCommunity, parseBeazerFlight, resolveBeazerRef } from "./dealsAdapters.beazer";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";
import { normalizedDealSourceKey } from "../shared/deals";

/**
 * Synthetic Beazer pages in the shape the live site served in October 2026:
 * a Next.js app shell whose server-component payload carries the community
 * row, the plan rows, the quick move-in card grids and the offers. Names
 * and addresses are invented.
 */
const HOST = "https://www.beazer.com";
const COMMUNITY = `${HOST}/san-antonio-TX/san-antonio/fixture-meadows`;
const NOW = new Date("2026-10-20T15:00:00Z");
const DISCLAIMER = "<p>*Offer available on a pool of limited funds – the buyer’s choice of Beazer® homes – available only through Cardinal Financial Company, Limited Partnership NMLS #66247 for select Quick Move-In homes located in San Antonio. Homes must be contracted between 10/07/2026 and 12/07/2026 and close per contract by 12/07/2026. FHA 5/1 Adjustable Rate Mortgage with an initial interest rate of 4.990% (6.619% Annual Percentage Rate(APR)). Interest rate remains fixed for the first five years then adjusts annually years 6-30. Call 210-555-0142 or see www.beazer.com for details.</p>";
const image = (url: string) => ({ __typename: "ContentAreaItemModelSearch", ContentLink: { __typename: "ContentModelReferenceSearch", ProviderName: "dam", Expanded: { __typename: "DAMImageAsset", Url: url, Name: url.split("/").pop() } } });
type Home = { street: string; plan: string; homesite: string; availability: string | null; price: number; beds?: number; baths?: number; sqft?: number; active?: boolean; model?: boolean; url?: string; city?: string; zip?: string };
const homeRow = (home: Home) => ({
  _concreteType: "HomeDetailPage", __typename: "HomeDetailPage",
  ParentCommunityContent: { __typename: "QueryRef", CommunityDetailPage: { __typename: "CommunityDetailPageOutput", item: { __typename: "CommunityDetailPage", CommunityName: "Fixture Meadows", HasVIPList: false } } },
  Url: home.url ?? `${COMMUNITY}/${home.plan.toLowerCase()}/${home.homesite}`, Name: home.homesite, StreetAddress: home.street, City: home.city ?? "San Antonio", StateID: "TX", Zip: home.zip ?? "78253", HomesiteNumber: home.homesite, MLSNumber: "1234567",
  SpecDescription: "A fixture home.", SpecAdditionalFlagTypeID: "", EnergySeriesTypeID: "1003", PropertyHighlight: "", BedsOverride: null, BathsOverride: null, Beds: home.beds ?? 4, Baths: home.baths ?? 2.5, SquareFoot: home.sqft ?? 2_249, SquareFeetOverride: null,
  Availability: home.availability, IsActive: home.active ?? true, IsModel: home.model ?? null, HomeType: "Single Family Homes", HomePrice: home.price, HasVIPList: false, SolarScenario: "", CalculatedMonthlyEnergyCost: 71,
  ParentLink: { __typename: "ContentModelReference", Id: 215687 },
  Elevation: { __typename: "ContentModelReference", Expanded: { __typename: "ElevationPage", Id: "33901-35625", DisplayName: "PRA", Price: 393_990, SquareFoot: 2_249, Beds: 4, Baths: 2.5, IsActive: false, Images: [image(`https://cmp.beazer.com/images/${home.homesite}-elevation.jpg`)] } },
  InteriorImages: [image(`https://cms.beazer.com/contentassets/${home.homesite}/kitchen.jpg`), image("https://evil.example/x.jpg"), image(`https://cmp.beazer.com/images/${home.homesite}-floorplan.jpg`)],
  ParentPlanContent: { __typename: "QueryRef", PlanDetailPage: { __typename: "PlanDetailPageOutput", item: { __typename: "PlanDetailPage", PlanName: home.plan } } },
  ElevationImages: [image(`https://cmp.beazer.com/images/${home.homesite}-front.jpg`)], Offers: [], Offer: { __typename: "ContentModelReference", Expanded: { __typename: "Content" } },
  ContentLink: { __typename: "ContentModelReference", Id: 300_000 + Number(home.homesite) },
});
const HOMES: Home[] = [
  { street: "6410 Fixture Trace", plan: "Berkshire", homesite: "8378", availability: "2026-10-02T04:00:00Z", price: 379_999 },
  { street: "6418 Fixture Trace", plan: "Berkshire", homesite: "8380", availability: "2026-12-15T04:00:00Z", price: 384_999, beds: 5, baths: 3, sqft: 2_610 },
  { street: "14435 Fixture Point", plan: "Crockett", homesite: "9612", availability: null, price: 422_307 },
];
type Plan = { name: string; price: number; hidden?: boolean | null; active?: boolean | null; hasHomes?: boolean; sqft?: [number, number]; beds?: [number, number]; baths?: [number, number]; url?: string; elevations?: Array<[number, boolean]> };
const planRow = (plan: Plan) => ({
  __typename: "PlanDetailPage", ContentLink: { __typename: "ContentModelReference", Id: 215_000 + plan.name.length }, CommunityName: "Fixture Meadows",
  Url: plan.url ?? `${COMMUNITY}/${plan.name.toLowerCase()}`, PlanName: plan.name, Price: plan.price, SquareFootMin: plan.sqft?.[0] ?? 0, SquareFootMax: plan.sqft?.[1] ?? 0, BedsMin: plan.beds?.[0] ?? 0, BedsMax: plan.beds?.[1] ?? 0, BathsMin: plan.baths?.[0] ?? 0, BathsMax: plan.baths?.[1] ?? 0,
  HomeType: "Single Family Homes", IsHidden: plan.hidden ?? null, IsActive: plan.active === undefined ? true : plan.active, HasHomes: plan.hasHomes ?? false, Offers: [],
  Elevations: (plan.elevations ?? [[plan.price + 4_000, true], [plan.price + 1_000, true], [plan.price - 2_000, false]]).map(([price, active], index) => ({ __typename: "ContentAreaItemModelSearch", ContentLink: { __typename: "ContentModelReferenceSearch", Expanded: { __typename: "ElevationPage", Id: `${plan.name}-${index}`, DisplayName: `E${index}`, Price: price, IsActive: active, Images: [image(`https://cmp.beazer.com/images/${plan.name.toLowerCase()}-${index}.jpg`)] } } })),
});
const PLANS: Plan[] = [
  { name: "Berkshire", price: 0, hidden: true, active: false, hasHomes: true },
  { name: "Travis", price: 332_990, sqft: [1_504, 1_504], beds: [3, 3], baths: [2, 2] },
  { name: "Austin", price: 0, sqft: [1_599, 1_599], beds: [3, 3], baths: [2, 2], hasHomes: true, elevations: [[346_990, true], [341_990, true], [330_000, false]] },
  { name: "LAND JOB", price: 0, hidden: null, active: null, url: `${COMMUNITY}/land-job2` },
];
type PageInput = { url?: string; street?: string | null; vip?: boolean; homes?: Home[] | null; grids?: unknown[][] | null; plans?: Plan[]; offers?: unknown[] | null; extraRows?: Array<[string, unknown]> };
function communityRow(input: PageInput = {}) {
  return {
    __typename: "CommunityDetailPage", ContentLink: { __typename: "ContentModelReference", Id: 210_156 }, _id: "guid_en_Published",
    Ancestors: ["590066d2-665d-41ad-900f-c155391a7194", "55228d07-f388-4656-9b45-c4671017e201"], Latitude: 29.4997036, Longitude: -98.7811012, MinimumPrice: 358_990, CommunityName: "Fixture Meadows", CommunityID: 1566,
    HasVIPList: input.vip ?? false, CommunityStatus: "Active", IsInActiveMetro: true, Url: input.url ?? COMMUNITY,
    ProductLines: { __typename: "QueryRef", ProductLinePage: { __typename: "ProductLinePageOutput", items: [{ __typename: "ProductLinePage", ProductLineID: 4924, HoursOfOperation: "Mon-Sat 10-6", ...(input.street === null ? {} : { StreetAddress: input.street ?? "6614 Fixture Glen " }), City: "San Antonio", PostalCode: "78253", ProductLineName: "Fixture Meadows", StateID: "TX", PhoneNumber: "210-555-0142", Counselors: [{ __typename: "Counselor", CounselorName: "A. Person", CounselorEmail: "a.person@example.test" }] }] } },
    Plans: { __typename: "QueryRef", PlanDetailPage: { __typename: "PlanDetailPageOutput", items: (input.plans ?? PLANS).map(planRow) } },
    Offers: [{ __typename: "ContentAreaItemModelSearch", ContentLink: { __typename: "ContentModelReferenceSearch", GuidValue: "72ec7f01-bd1e-4919-a747-d37e63b4f724" } }],
  };
}
const OFFERS = [
  { __typename: "OfferBlock", ContentLink: { __typename: "ContentModelReference", GuidValue: "0a1aa81a" }, DisplayStartDate: "2026-08-01T04:59:00Z", DisplayEndDate: "2026-11-01T04:00:00Z", Content: "<p>Personalized savings, your way!</p>\n<p><span class=\"EOP\">Receive </span>up to $35,000 towards design options and closing costs!*</p>", Disclaimer: [{ __typename: "ContentAreaItemModelSearch", ContentLink: { __typename: "ContentModelReferenceSearch", Expanded: { __typename: "DisclaimerBlock", Text: "$2a", Title: "Disclaimer" } } }], IsActive: true, OfferName: "Your Home. Your Savings. Your Way.*" },
  { __typename: "OfferBlock", ContentLink: { __typename: "ContentModelReference", GuidValue: "72ec7f01" }, DisplayStartDate: "2026-09-23T04:59:00Z", DisplayEndDate: "2026-11-01T04:00:00Z", Content: "<p><strong>Lock In 4.99%!</strong></p>\n<p>4.99% Limited Time 5/1 ARM [6.62% APR] with Choice Lender!* &nbsp;</p>", Disclaimer: [{ __typename: "ContentAreaItemModelSearch", ContentLink: { __typename: "ContentModelReferenceSearch", Expanded: { __typename: "DisclaimerBlock", Text: "$29", Title: "Disclaimer" } } }], IsActive: true, OfferName: "Lock In 4.99%!", Name: "4.99-Under $518" },
  { __typename: "OfferBlock", DisplayStartDate: "2026-05-01T05:00:00Z", DisplayEndDate: "2026-07-01T04:00:00Z", Content: "<p>Hello June: 3.99% (5.5% APR) 30-year fixed!</p>", Disclaimer: [], IsActive: true, OfferName: "Hello June" },
];
function communityPage(input: PageInput = {}) {
  const homes = input.homes === undefined ? HOMES : input.homes;
  const grids = input.grids ?? (homes === null ? [] : [homes.map((home) => ({ ContentLink: { Expanded: homeRow(home) } }))]);
  const tabs = [{ title: "Home plans", cards: (input.plans ?? PLANS).map((plan, index) => ({ ContentLink: { Expanded: { _concreteType: "PlanDetailPage", __typename: "PlanDetailPage", ContentLink: `$19:props:extraData:communityDetailPage:Plans:PlanDetailPage:items:${index}:ContentLink`, PlanName: `$19:props:extraData:communityDetailPage:Plans:PlanDetailPage:items:${index}:PlanName` } } })), anchorLink: "#home-plans" }, ...grids.map((cards) => ({ title: "Quick move-in homes", cards: Array.isArray(cards) && cards.length === 1 && typeof cards[0] === "string" ? cards[0] : cards, anchorLink: "#quick-move-ins" }))];
  const rows: Array<[string, unknown]> = [
    ["0", ["$", "$L1", null, { children: ["$", "$L19", null, {}] }]],
    ["19", ["$", "$L2", null, { extraData: { communityDetailPage: communityRow(input), activeOffersCurrently: input.offers === undefined ? OFFERS : input.offers ?? [] }, children: ["$", "$L1a", null, {}] }]],
    ["1a", ["$", "div", null, { children: [["$", "div", "0", { children: ["$", "$L1b", null, { tabs }] }]] }]],
    ...(input.extraRows ?? []),
  ];
  const texts: Array<[string, string]> = [["29", DISCLAIMER], ["2a", "<p>*Offer valid only on contracts for to-be-built homes signed between 9.01.26 and 10.31.26 in San Antonio, TX. See a New Home Counselor for details.</p>"]];
  const lines = [...rows.map(([id, value]) => `${id}:${JSON.stringify(value)}`), "2:I[\"1234\",[],\"\"]", ...texts.map(([id, text]) => `${id}:T${Buffer.byteLength(text, "utf8").toString(16)},${text}`)];
  const flight = `${lines.join("\n")}\n`;
  const half = Math.floor(flight.length / 2);
  const pushes = [flight.slice(0, half), flight.slice(half)].map((piece) => `<script>self.__next_f.push([1,${JSON.stringify(piece)}])</script>`);
  return `<!DOCTYPE html><html><head><title>Fixture Meadows</title></head><body><div id="__next"><h1>The Fixture Meadows Community</h1><p>Zoned to Northside ISD.</p></div><script>self.__next_f=self.__next_f||[]</script>${pushes.join("")}</body></html>`;
}
const listing = (items: unknown[] = [
  { __typename: "CommunityDetailPage", Url: COMMUNITY, MinimumPrice: 358_990, Name: "Fixture Meadows", CommunityName: "Fixture Meadows", Latitude: 29.4997036, Longitude: -98.7811012, HasHomes: true, HasVIPList: false, ProductLines: { __typename: "QueryRef", ProductLinePage: { __typename: "ProductLinePageOutput", items: [{ __typename: "ProductLinePage", City: "San Antonio", StateID: "TX" }] } } },
  { __typename: "CommunityDetailPage", Url: `${HOST}/san-antonio-TX/san-antonio/fixture-creek`, MinimumPrice: 0, Name: "Fixture Creek", CommunityName: "Fixture Creek", Latitude: 53.135945, Longitude: 8.941838, HasHomes: false, HasVIPList: true, ProductLines: { __typename: "QueryRef", ProductLinePage: { __typename: "ProductLinePageOutput", items: [{ __typename: "ProductLinePage", City: "San Antonio" }] } } },
  { __typename: "CommunityDetailPage", Url: "https://evil.example/x", Name: "Elsewhere", CommunityName: "Elsewhere", Latitude: 29.5, Longitude: -98.5 },
]) => JSON.stringify({ items, total: items.length });

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Beazer Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Meadows", scrubList: ["Fixture Meadows", "Fixture Trace", "Fixture Point", "Fixture Glen"] };
const html = (body: string) => vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }));

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Beazer reader: the payload", () => {
  it("reads the rows (JSON, text and module rows across split pushes) and follows references, props included", () => {
    const rows = parseBeazerFlight(communityPage())!;
    expect(rows.get("29")).toBe(DISCLAIMER);
    expect(rows.has("2")).toBe(false);
    expect(resolveBeazerRef(rows, "$29")).toBe(DISCLAIMER);
    expect(resolveBeazerRef(rows, "$19:props:extraData:communityDetailPage:Plans:PlanDetailPage:items:1:PlanName")).toBe("Travis");
    expect(resolveBeazerRef(rows, "$19:props:extraData:communityDetailPage:CommunityID")).toBe(1566);
    expect(resolveBeazerRef(rows, "$zz")).toBe("$zz");
    expect(resolveBeazerRef(rows, "$L1a")).toBe("$L1a");
    expect(resolveBeazerRef(rows, "$undefined")).toBe("$undefined");
    expect(resolveBeazerRef(rows, "$19:props:nothing:here")).toBeUndefined();
    expect(parseBeazerFlight("<html><body>new layout</body></html>")).toBeNull();
    expect(parseBeazerFlight(`<script>self.__next_f.push([1,"19:Tzz,oops"])</script>`)).toBeNull();
  });

  it("reads statuses from the availability date", () => {
    expect(beazerStatus("2026-10-02T04:00:00Z", false, NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(beazerStatus("2026-12-15T04:00:00Z", false, NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(beazerStatus("2027-02-03T05:00:00Z", false, NOW)).toEqual({ status: "Quick Move-In (February 2027)", readyNow: false, moveInDate: "February 2027" });
    expect(beazerStatus(null, false, NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(beazerStatus("2026-12-15T04:00:00Z", true, NOW)).toEqual({ status: "Model", readyNow: false, moveInDate: null });
    expect(beazerStatus("soon", false, NOW).status).toBeNull();
    expect(beazerStatus("2099-01-01T00:00:00Z", false, NOW).status).toBeNull();
  });
});

describe("Beazer reader: the payload (bytes)", () => {
  it("reads a text row by its UTF-8 byte length (the wire's), a hint row with no id, and holds a payload it cannot read (an unknown line, an overrunning text row)", () => {
    const text = "<p>The buyer’s choice – Beazer® homes</p>";
    const flight = `:HL["/_next/static/media/x.woff2","font",{"crossOrigin":""}]\n0:["$","$L1",null,{}]\n29:T${Buffer.byteLength(text, "utf8").toString(16)},${text}19:{"a":1}\n`;
    const rows = parseBeazerFlight(`<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`)!;
    expect(rows.get("29")).toBe(text);
    expect(rows.get("19")).toEqual({ a: 1 });
    expect(rows.has("")).toBe(false);
    expect(parseBeazerFlight(`<script>self.__next_f.push([1,${JSON.stringify(`0:["$","$L1",null,{}]\n29:T${text.length.toString(16)},${text}19:{"a":1}\n`)}])</script>`)).toBeNull();
    expect(parseBeazerFlight(`<script>self.__next_f.push([1,${JSON.stringify("0:[1]\nnot a row\n")}])</script>`)).toBeNull();
    expect(parseBeazerFlight(`<script>self.__next_f.push([1,${JSON.stringify("0:[1]\n\n1:[2]\n")}])</script>`)!.size).toBe(2);
  });
});

describe("Beazer reader: page data", () => {
  it("reads the community row (office, pin, minimum price), the quick move-in cards (status, price, specs, plan, homesite, photos on the DAM hosts), the plans for sale (hidden and inactive left out, price from the elevations) and the current rate offer with its disclaimer", () => {
    const page = parseBeazerCommunity(communityPage(), COMMUNITY, NOW)!;
    expect(page.record).toEqual({ name: "Fixture Meadows", street: "6614 Fixture Glen", city: "San Antonio", zip: "78253", phone: "2105550142", priceFrom: 358_990, geo: { lat: 29.4997036, lng: -98.7811012 } });
    expect(page).toMatchObject({ foreignPage: false, comingSoon: false, foreignHome: false, hasHomesGrid: true, plansSayHomes: true, foreignPlan: false });
    expect(page.homes.map((home) => [home.sourceUrl, home.privateAddress, home.privatePlanName, home.status, home.readyNow, home.moveInDate, home.price, home.previousPrice, home.bedrooms, home.bathrooms, home.squareFeet, home.homesite, home.gallery?.map((image) => image.sourceUrl)])).toEqual([
      [`${COMMUNITY}/berkshire/8378`, "6410 Fixture Trace, San Antonio, TX 78253", "Berkshire", "Quick Move-In (Move-In Ready)", true, null, 379_999, undefined, 4, 2.5, 2_249, "Lot 8378", ["https://cmp.beazer.com/images/8378-front.jpg", "https://cmp.beazer.com/images/8378-elevation.jpg", "https://cms.beazer.com/contentassets/8378/kitchen.jpg"]],
      [`${COMMUNITY}/berkshire/8380`, "6418 Fixture Trace, San Antonio, TX 78253", "Berkshire", "Quick Move-In (December 2026)", false, "December 2026", 384_999, undefined, 5, 3, 2_610, "Lot 8380", ["https://cmp.beazer.com/images/8380-front.jpg", "https://cmp.beazer.com/images/8380-elevation.jpg", "https://cms.beazer.com/contentassets/8380/kitchen.jpg"]],
      [`${COMMUNITY}/crockett/9612`, "14435 Fixture Point, San Antonio, TX 78253", "Crockett", "Quick Move-In", false, null, 422_307, undefined, 4, 2.5, 2_249, "Lot 9612", ["https://cmp.beazer.com/images/9612-front.jpg", "https://cmp.beazer.com/images/9612-elevation.jpg", "https://cms.beazer.com/contentassets/9612/kitchen.jpg"]],
    ]);
    expect(new Set(page.homes.map((home) => normalizedDealSourceKey(home.sourceUrl))).size).toBe(3);
    expect(page.plans.map((plan) => [plan.sourceUrl, plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.gallery?.map((image) => image.sourceUrl)])).toEqual([
      [`${COMMUNITY}/travis`, "Travis", 332_990, 3, 2, 1_504, ["https://cmp.beazer.com/images/travis-0.jpg", "https://cmp.beazer.com/images/travis-1.jpg"]],
      [`${COMMUNITY}/austin`, "Austin", 341_990, 3, 2, 1_599, ["https://cmp.beazer.com/images/austin-0.jpg", "https://cmp.beazer.com/images/austin-1.jpg"]],
    ]);
    expect(page.offer).toBe("Lock In 4.99%! 4.99% Limited Time 5/1 ARM [6.62% APR] with Choice Lender! Offer available on a pool of limited funds – the buyer’s choice of Beazer® homes – available only through Cardinal Financial Company, Limited Partnership for select Quick Move-In homes located in San Antonio. Homes must be contracted between 10/07/2026 and 12/07/2026 and close per contract by 12/07/2026. FHA 5/1 Adjustable Rate Mortgage with an initial interest rate of 4.990% (6.619% Annual Percentage Rate(APR)). Interest rate remains fixed for the first five years then adjusts annually years 6-30. Call or see for details.");
    expect(page.offer).not.toMatch(/NMLS|66247|555-0142|beazer\.com/);
  });

  it("reads several product lines' grids as one list, a VIP-list community, a page without the grid, and flags a row elsewhere and foreign links; the first current offer stands in for a rate-less season", () => {
    const two = parseBeazerCommunity(communityPage({ grids: [[{ ContentLink: { Expanded: homeRow(HOMES[0]!) } }], [{ ContentLink: { Expanded: homeRow(HOMES[1]!) } }, { ContentLink: { Expanded: homeRow(HOMES[1]!) } }]] }), COMMUNITY, NOW)!;
    expect(two.homes.map((home) => home.privateName)).toEqual(["6410 Fixture Trace", "6418 Fixture Trace"]);
    expect(parseBeazerCommunity(communityPage({ vip: true, street: null, homes: null, plans: [] }), COMMUNITY, NOW)).toMatchObject({ comingSoon: true, record: { street: null }, homes: [], hasHomesGrid: false, plansSayHomes: false });
    expect(parseBeazerCommunity(communityPage({ url: `${HOST}/san-antonio-TX/san-antonio/fixture-creek` }), COMMUNITY, NOW)).toMatchObject({ foreignPage: true });
    expect(parseBeazerCommunity(communityPage({ homes: [{ ...HOMES[0]!, url: `${HOST}/san-antonio-TX/san-antonio/fixture-creek/berkshire/1` }] }), COMMUNITY, NOW)).toMatchObject({ foreignHome: true, homes: [] });
    expect(parseBeazerCommunity(communityPage({ plans: [{ name: "Zinnia", price: 1, url: `${HOST}/san-antonio-TX/san-antonio/fixture-creek/zinnia` }] }), COMMUNITY, NOW)).toMatchObject({ foreignPlan: true, plans: [] });
    expect(parseBeazerCommunity(communityPage({ homes: [{ ...HOMES[0]!, active: false }, { ...HOMES[1]!, model: true }] }), COMMUNITY, NOW)!.homes.map((home) => [home.privateName, home.status])).toEqual([["6418 Fixture Trace", "Model"]]);
    expect(parseBeazerCommunity(communityPage({ offers: [OFFERS[0]!, OFFERS[2]!] }), COMMUNITY, NOW)!.offer).toBe("Personalized savings, your way! Receive up to $35,000 towards design options and closing costs! Offer valid only on contracts for to-be-built homes signed between 9.01.26 and 10.31.26 in San Antonio, TX. See a New Home Counselor for details.");
    expect(parseBeazerCommunity(communityPage({ offers: [OFFERS[2]!] }), COMMUNITY, NOW)!.offer).toBeNull();
    expect(parseBeazerCommunity(communityPage({ offers: null }), COMMUNITY, NOW)!.offer).toBeNull();
    // An offer whose disclaimer points at a row the payload lacks, or whose window is not a date, is unreadable: held, never joined as "$29".
    const dangling = parseBeazerCommunity(communityPage({ offers: [{ ...OFFERS[1]!, Disclaimer: [{ __typename: "ContentAreaItemModelSearch", ContentLink: { __typename: "ContentModelReferenceSearch", Expanded: { __typename: "DisclaimerBlock", Text: "$7f", Title: "Disclaimer" } } }] }] }), COMMUNITY, NOW)!;
    expect(dangling).toMatchObject({ offer: null, offerUnreadable: true });
    expect(parseBeazerCommunity(communityPage({ offers: [{ ...OFFERS[1]!, DisplayStartDate: "soon", DisplayEndDate: "later" }] }), COMMUNITY, NOW)).toMatchObject({ offer: null, offerUnreadable: true });
    expect(parseBeazerCommunity(communityPage({ offers: [{ ...OFFERS[1]!, DisplayStartDate: "2026-09-23T00:00:00", DisplayEndDate: "11/01/2026" }] }), COMMUNITY, NOW)).toMatchObject({ offerUnreadable: false });
    expect(parseBeazerCommunity(communityPage({ offers: [{ ...OFFERS[1]!, DisplayStartDate: "2026-09-23T00:00:00", DisplayEndDate: "11/01/2026" }] }), COMMUNITY, NOW)!.offer).toMatch(/^Lock In 4\.99%/);
    expect(parseBeazerCommunity(communityPage(), COMMUNITY, NOW)).toMatchObject({ offerUnreadable: false });
    // The page's own row is the one whose URL is the page, even when another community's row streams first; a row URL on another host or scheme is another page.
    const nearby = { ...communityRow({ url: `${HOST}/san-antonio-TX/san-antonio/fixture-creek` }), CommunityName: "Fixture Creek", ProductLines: { __typename: "QueryRef", ProductLinePage: { __typename: "ProductLinePageOutput", items: [{ __typename: "ProductLinePage", StreetAddress: "100 Creek Row", City: "San Antonio", PostalCode: "78253" }] } } };
    expect(parseBeazerCommunity(communityPage({ extraRows: [["18", { nearbyCommunities: [nearby] }]] }), COMMUNITY, NOW)).toMatchObject({ foreignPage: false, record: { name: "Fixture Meadows", street: "6614 Fixture Glen" } });
    expect(parseBeazerCommunity(communityPage({ url: "https://beazer.com/san-antonio-TX/san-antonio/fixture-meadows" }), COMMUNITY, NOW)).toMatchObject({ foreignPage: true });
    expect(parseBeazerCommunity(communityPage({ url: "http://www.beazer.com/san-antonio-TX/san-antonio/fixture-meadows" }), COMMUNITY, NOW)).toMatchObject({ foreignPage: true });
    // A grid whose cards arrive as a reference to another row is still the grid.
    expect(parseBeazerCommunity(communityPage({ grids: [["$7a" as unknown as never]], extraRows: [["7a", HOMES.map((home) => ({ ContentLink: { Expanded: homeRow(home) } }))]] }), COMMUNITY, NOW)!.homes).toHaveLength(3);
    expect(parseBeazerCommunity("<html><body>new layout</body></html>", COMMUNITY, NOW)).toBeNull();
    expect(beazerRecord(communityPage(), COMMUNITY)).toMatchObject({ street: "6614 Fixture Glen" });
    expect(beazerListingEntries(listing(), "www.beazer.com")!.map((entry) => [entry.url, entry.record.name, entry.record.street, entry.record.city, entry.record.priceFrom, entry.record.geo])).toEqual([[COMMUNITY, "Fixture Meadows", null, "San Antonio", 358_990, { lat: 29.4997036, lng: -98.7811012 }]]);
    expect(beazerListingEntries("<html>", "www.beazer.com")).toBeNull();
    expect(beazerListingEntries("{}", "www.beazer.com")).toBeNull();
    expect(beazerListingUrl()).toContain("ancestorMainId=55228d07");
  });
});

describe("Beazer reader: adapter", () => {
  it("is registered under its builder id", () => {
    expect(DEAL_ADAPTERS["Beazer Homes"]).toBeInstanceOf(BeazerAdapter);
    expect(DEAL_ADAPTERS["Beazer Homes"].builder).toBe("Beazer Homes");
  });

  it("reads the page once and publishes the homes, the plans, the facts and the offer held as adjustable", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes.map((home) => [home.privateName, home.status, home.price])).toEqual([["6410 Fixture Trace", "Quick Move-In (Move-In Ready)", 379_999], ["6418 Fixture Trace", "Quick Move-In (December 2026)", 384_999], ["14435 Fixture Point", "Quick Move-In", 422_307]]);
    expect(result.private.plans.map((plan) => plan.privatePlanName)).toEqual(["Travis", "Austin"]);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 358_990, schoolDistrict: "Northside ISD" });
    expect(result.private.incentive?.facts).toMatchObject({ promotionalRatePercent: 4.99, aprPercent: 6.62, contractDeadline: { isoDate: "2026-12-07" }, closingDeadline: { isoDate: "2026-12-07" } });
    expect(result.private.incentive?.facts.holdReasons).toContain("adjustable_rate");
    expect(result.public.incentive).toBeNull();
    expect(result.private.pages.map((page) => page.kind)).toEqual(["community", "home", "home", "home", "plan", "plan"]);
    expect(result.public.homes).toHaveLength(3);
    expect(JSON.stringify(result.public)).not.toMatch(/Fixture|1234567|555-0142|beazer\.com|A\. Person|a\.person/);
  });

  it("publishes nothing for a community whose plans say no homes and whose page shows no grid", async () => {
    const result = await loadOfficialDeals(config, { fetcher: html(communityPage({ homes: null, plans: [{ name: "Travis", price: 332_990, sqft: [1_504, 1_504], beds: [3, 3], baths: [2, 2] }] })), now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(result.private.homes).toEqual([]);
    expect(result.private.plans).toHaveLength(1);
  });

  it("holds when the page is not a community page, when the office is missing (a VIP-list community), when the row or its links are another community's, when the plans say homes the grid does not show, when a home's date is unreadable, and when the site or the read fails", async () => {
    const load = (page: string) => loadOfficialDeals(config, { fetcher: html(page), now: () => NOW });
    expect((await load("<html><body>new layout</body></html>")).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ vip: true, street: null, homes: null, plans: [] }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ url: `${HOST}/san-antonio-TX/san-antonio/fixture-creek` }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ homes: [{ ...HOMES[0]!, url: `${HOST}/san-antonio-TX/san-antonio/fixture-creek/berkshire/1` }] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ plans: [{ name: "Zinnia", price: 1, url: `${HOST}/san-antonio-TX/san-antonio/fixture-creek/zinnia` }] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ homes: null }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ grids: [[]] }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    const unknown = await load(communityPage({ homes: [...HOMES, { ...HOMES[0]!, street: "9 Fixture Way", homesite: "1", availability: "soon" }] }));
    expect(unknown.catalogOk).toBe(true);
    expect(unknown.private.homes.find((home) => home.privateName === "9 Fixture Way")?.status).toBeNull();
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://beazer.com/san-antonio-TX/san-antonio/fixture-meadows" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("busy", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("holds the offer only when its disclaimer points at a row the payload lacks", async () => {
    const dangling = { ...OFFERS[1]!, Disclaimer: [{ __typename: "ContentAreaItemModelSearch", ContentLink: { __typename: "ContentModelReferenceSearch", Expanded: { __typename: "DisclaimerBlock", Text: "$7f", Title: "Disclaimer" } } }] };
    const result = await loadOfficialDeals(config, { fetcher: html(communityPage({ offers: [dangling] })), now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(result.incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
    expect(result.private.incentive).toBeNull();
    expect(result.public.incentive).toBeNull();
    expect(result.private.homes).toHaveLength(3);
  });

  it("holds a community with more homes for sale than the cap", async () => {
    const many = Array.from({ length: 151 }, (_, index) => ({ ...HOMES[0]!, street: `${100 + index} Fixture Trace`, homesite: String(1000 + index) }));
    expect((await loadOfficialDeals(config, { fetcher: html(communityPage({ homes: many })), now: () => NOW })).holdReasons).toEqual(["incomplete_inventory"]);
  });
});
