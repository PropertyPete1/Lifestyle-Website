import { beforeEach, describe, expect, it, vi } from "vitest";
import { LgiHomesAdapter, lgiComponentProps, lgiPhotoHostPath, lgiListingEntries, lgiRecord, lgiSelling, parseLgiCommunity } from "./dealsAdapters.lgi";
import { parseNextData } from "./dealsAdapters.davidson";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic LGI pages in the shape the live site (Sitecore JSS on Next.js)
 * served in October 2026: the community in the route's fields, the floor plans
 * in the FloorPlanSearch component's props, the market list in the
 * CommunitySearch component's props. Names and addresses are invented.
 */
const HOST = "https://www.lgihomes.com";
const COMMUNITY = `${HOST}/texas/san-antonio/fixture-wing`;
const CDN = "https://edge.sitecorecloud.io/lgihomesinc3717-lgihomes6640-productiondee5-29b9/media/project/lgihomes";
const v = (value: unknown) => ({ jsonValue: { value } });
const kv = (key: string) => ({ jsonValue: { fields: { Key: { value: key }, Value: { value: key } } } });
const nextPage = (route: Record<string, unknown>, componentProps: Record<string, unknown>) => `<!DOCTYPE html><html><head><title>Fixture</title></head><body><div id="__next"><p>Students attend Southside ISD schools.</p></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page: { layout: { sitecore: { route } } }, dictionary: {}, componentProps } }, page: "/[[...path]]" })}</script></body></html>`;
const plan = (input: { name: string; price: number; was?: number; beds: number; baths: number; garage: number; sqft: number; status?: string }) => ({
  id: `id-${input.name}`, name: input.name.toLowerCase(), url: { path: `/texas/san-antonio/fixture-wing/${input.name.toLowerCase()}` }, monthlyPayment: v(1299), floorPlanLeasePrice: v(1790),
  numberofBedrooms: v(input.beds), numberofBathrooms: v(input.baths), numberofCarGarage: v(input.garage), numberofStories: v(1), sizeSqft: v(input.sqft), listPrice: v(input.price), previousListPrice: v(input.was ?? input.price),
  adStatus: kv(input.status ?? "Active"), floorPlanName: { value: input.name }, floorPlanID: { value: "5321" }, primaryImage: v({ src: `${CDN}/brandsite/floorplans/${input.name.toLowerCase()}.jpg?h=568&w=920`, alt: "Exterior" }),
  community: { id: "x", name: "fixture-wing", communityName: { value: "Fixture Wing" } },
});
const PLANS = [plan({ name: "Ash", price: 245_900, was: 249_900, beds: 2, baths: 2, garage: 1, sqft: 1_002 }), plan({ name: "Marek", price: 299_900, beds: 4, baths: 2.5, garage: 2, sqft: 1_820 }), plan({ name: "Retired", price: 1, beds: 3, baths: 2, garage: 2, sqft: 1_500, status: "Inactive" })];
function communityPage(input: { plans?: ReturnType<typeof plan>[]; status?: string; office?: boolean; component?: boolean; pandi?: string | null; routeName?: string; leasing?: boolean } = {}) {
  const fields: Record<string, unknown> = {
    CommunityName: { value: "Fixture Wing" }, CommunityID: { value: 597 }, Address1: input.office === false ? { value: "" } : { value: "11523 Fixture Eagles" }, City: { value: "San Antonio" }, State: { value: "TX" }, ZipCode: { value: "78223" }, Phone: { value: "(888) 384-5144" }, Email: { value: "FixtureWing@lgihomes.com" },
    Latitude: { value: 29.3088049 }, Longitude: { value: -98.4045853 }, MinListPrice: { value: 222900 }, PreviousMinListPrice: { value: 221900 }, MaxListPrice: { value: 345900 },
    SaleStatus: { id: "x", name: (input.status ?? "Active").toLowerCase(), fields: { Key: { value: input.status ?? "Active" }, Value: { value: input.status ?? "Active" } } },
    PandIInfo: { value: input.pandi === undefined ? "5% Fixed / 5.805% APR, 3.5% Down, FHA 30 Year" : input.pandi },
    CommunityAmenities: [{ id: "a", displayName: "childrens playground", fields: { AmenityTitle: { value: "Children's Playground" } } }, { id: "b", displayName: "pool", fields: { AmenityTitle: { value: "Pool" } } }],
    Description: { value: "<p>Fixture Wing is an amenity-rich community.</p>" },
  };
  const placeholders = { "headless-main": [{ componentName: "PartialDesignDynamicPlaceholder", uid: "p1", placeholders: { "sxa-community-page-layout": [{ componentName: "LGICommunityLandingPage", uid: "c1", placeholders: { overview: [{ componentName: "CommunityOverview", uid: "o1" }], "floorplan-search": [{ componentName: "FloorPlanSearch", uid: "fs1" }] } }] } }] };
  const componentProps: Record<string, unknown> = { o1: { site: {}, community: {} } };
  if (input.component !== false) componentProps.fs1 = { datasource: {}, community: { pandIInfo: v(fields.PandIInfo && (fields.PandIInfo as { value: unknown }).value), floorplans: { results: input.plans ?? PLANS } }, isLeasingCommunity: input.leasing ?? false };
  return nextPage({ name: input.routeName ?? "fixture-wing", templateName: "Community Landing Page", fields, placeholders }, componentProps);
}
const marketPage = nextPage({ name: "san-antonio", templateName: "Market Landing Page", fields: {}, placeholders: { "headless-main": [{ componentName: "LGIMarketLandingPage", uid: "m1", placeholders: { "community-search": [{ componentName: "CommunitySearch", uid: "cs1" }] } }] } }, { cs1: { datasource: {}, market: {}, communities: { results: [
  { id: "1", name: "fixture-wing", url: { path: "/texas/san-antonio/fixture-wing" }, communityName: { value: "Fixture Wing" }, locationIdentifier: { value: "San Antonio" }, saleStatus: kv("Active"), latitude: v(29.3088049), longitude: v(-98.4045853), phone: { value: "(888) 384-5144" }, minListPrice: v(222900), pandIInfo: { value: "5% Fixed / 5.805% APR, 3.5% Down, FHA 30 Year" } },
  { id: "2", name: "far-fixture", url: { path: "/texas/san-antonio/far-fixture" }, communityName: { value: "Far Fixture" }, locationIdentifier: { value: "Kyle" }, saleStatus: kv("Active"), latitude: v(29.918482), longitude: v(-97.849621), phone: { value: "(855) 806-2800" }, minListPrice: v(250900) },
  { id: "3", name: "elsewhere", url: { path: "https://evil.example/texas/san-antonio/x" }, communityName: { value: "Elsewhere" }, latitude: v(29.5), longitude: v(-98.5) },
  { id: "4", name: "rental-wing", url: { path: "/texas/san-antonio/rental-wing" }, communityName: { value: "Rental Wing" }, locationIdentifier: { value: "San Antonio" }, saleStatus: kv("Now Leasing"), latitude: v(29.4), longitude: v(-98.4), isLeasingCommunity: true },
  { id: "5", name: "later-wing", url: { path: "/texas/san-antonio/later-wing" }, communityName: { value: "Later Wing" }, locationIdentifier: { value: "San Antonio" }, saleStatus: kv("Coming Soon"), latitude: v(29.4), longitude: v(-98.4) },
] } } });

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "LGI Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Wing", scrubList: ["Fixture Wing", "Fixture Eagles"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("LGI Homes reader: page data", () => {
  it("reads the community from the route's fields and its floor plans from the FloorPlanSearch component: prices with the drop, specs, images, status; the payment example is not an offer", () => {
    const parsed = parseLgiCommunity(communityPage(), COMMUNITY)!;
    expect(parsed.record).toEqual({ name: "Fixture Wing", street: "11523 Fixture Eagles", city: "San Antonio", zip: "78223", phone: "8883845144", priceFrom: 222_900, geo: { lat: 29.3088049, lng: -98.4045853 } });
    expect(parsed.saleStatus).toBe("Active");
    // An inactive plan is not listed.
    expect(parsed.plans.map((entry) => [entry.privatePlanName, entry.price, entry.previousPrice, entry.priceDrop, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage, entry.gallery?.[0]?.sourceUrl])).toEqual([
      ["Ash", 245_900, 249_900, 4_000, 2, 2, 1_002, 1, `${CDN}/brandsite/floorplans/ash.jpg?h=568&w=920`],
      ["Marek", 299_900, null, null, 4, 2.5, 1_820, 2, `${CDN}/brandsite/floorplans/marek.jpg?h=568&w=920`],
    ]);
    expect(parsed.plans[0]!.sourceUrl).toBe(`${COMMUNITY}/ash`);
    expect(parsed).toMatchObject({ foreignPage: false, foreignPlan: false, leasing: false });
    expect(parsed.amenities).toEqual(["Children's Playground", "Pool"]);
    // Another community's page under this URL (a same-host redirect), a plan under another community's path, a leasing community.
    expect(parseLgiCommunity(communityPage({ routeName: "other-wing" }), COMMUNITY)!.foreignPage).toBe(true);
    const elsewhere = { ...plan({ name: "Zinnia", price: 260_000, beds: 3, baths: 2, garage: 2, sqft: 1_400 }), url: { path: "/texas/san-antonio/other-wing/zinnia" } };
    expect(parseLgiCommunity(communityPage({ plans: [elsewhere] }), COMMUNITY)).toMatchObject({ foreignPlan: true, plans: [] });
    expect(parseLgiCommunity(communityPage({ leasing: true }), COMMUNITY)!.leasing).toBe(true);
    // A plan priced only for lease is not for sale.
    const rental = { ...plan({ name: "Rental", price: 0, beds: 3, baths: 2, garage: 2, sqft: 1_400 }), listPrice: v(0), floorPlanLeasePrice: v(1850) };
    expect(parseLgiCommunity(communityPage({ plans: [rental] }), COMMUNITY)!.plans).toEqual([]);
    expect(parseLgiCommunity("<html><body>new layout</body></html>", COMMUNITY)).toBeNull();
    expect(parseLgiCommunity(communityPage({ component: false }), COMMUNITY)).toBeNull();
    expect(lgiComponentProps(parseNextData(communityPage()), "FloorPlanSearch")).not.toBeNull();
    expect(lgiComponentProps(parseNextData(communityPage()), "CommunitySearch")).toBeNull();
    expect(lgiRecord(communityPage(), COMMUNITY)).toMatchObject({ street: "11523 Fixture Eagles" });
    expect(lgiRecord(communityPage({ office: false }), COMMUNITY)).toMatchObject({ street: null });
    // Sold-out and not-yet-selling communities have nothing to publish; marketing labels sell.
    for (const label of ["Active", "Reduced Pricing!", "Immediate Move-in", "Now Selling", null]) expect(lgiSelling(label)).toBe(true);
    for (const label of ["Sold Out", "Coming Soon", "Closed"]) expect(lgiSelling(label)).toBe(false);
  });

  it("lists the market page's communities with pins, phones and cities, never another host, a leasing or a coming-soon community", () => {
    const entries = lgiListingEntries(marketPage, "www.lgihomes.com")!;
    expect(entries.map((entry) => [entry.url, entry.record.name, entry.record.city, entry.record.phone, entry.record.priceFrom, entry.record.geo])).toEqual([
      [COMMUNITY, "Fixture Wing", "San Antonio", "8883845144", 222_900, { lat: 29.3088049, lng: -98.4045853 }],
      [`${HOST}/texas/san-antonio/far-fixture`, "Far Fixture", "Kyle", "8558062800", 250_900, { lat: 29.918482, lng: -97.849621 }],
    ]);
    expect(lgiListingEntries(communityPage(), "www.lgihomes.com")).toBeNull();
    expect(lgiListingEntries("<html></html>", "www.lgihomes.com")).toBeNull();
  });
});

describe("LGI Homes reader: a community", () => {
  it("reads the page once and publishes the plans scrubbed, never an offer from the payment example; a sold-out or leasing community publishes nothing", async () => {
    const result = await loadOfficialDeals(config, { fetcher });
    expect(result.catalogOk).toBe(true);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes).toEqual([]);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 222_900, schoolDistrict: "Southside ISD", amenities: ["Children's Playground", "Pool"] });
    expect(result.private.incentive).toBeNull();
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78223", "lgihomes", "LGI"]) expect(json).not.toContain(secret);
    const soldOut = vi.fn(async () => new Response(communityPage({ status: "Sold Out" }), { status: 200, headers: { "content-type": "text/html" } }));
    const none = await loadOfficialDeals(config, { fetcher: soldOut });
    expect(none.holdReasons).toEqual([]);
    expect(none.private.plans).toEqual([]);
    expect(none.private.incentive).toBeNull();
    const leasing = vi.fn(async () => new Response(communityPage({ leasing: true }), { status: 200, headers: { "content-type": "text/html" } }));
    const rentals = await loadOfficialDeals(config, { fetcher: leasing });
    expect(rentals.holdReasons).toEqual([]);
    expect(rentals.private.plans).toEqual([]);
  });

  it("holds the run when the page is not a community page, when the plan component is gone, when the office address is missing, when the site is not LGI's, or when it cannot be read", async () => {
    const reshaped = vi.fn(async () => new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noComponent = vi.fn(async () => new Response(communityPage({ component: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noComponent })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noOffice = vi.fn(async () => new Response(communityPage({ office: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noOffice })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A same-host redirect to another community's page, or a plan under another community's path, is never this community's inventory.
    const redirected = vi.fn(async () => new Response(communityPage({ routeName: "other-wing" }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: redirected })).holdReasons).toEqual(["invalid_inventory_response"]);
    const foreignPlan = vi.fn(async () => new Response(communityPage({ plans: [{ ...plan({ name: "Zinnia", price: 260_000, beds: 3, baths: 2, garage: 2, sqft: 1_400 }), url: { path: "/texas/san-antonio/other-wing/zinnia" } }] }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: foreignPlan })).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://lgihomes.com/texas/san-antonio/fixture-wing" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new LgiHomesAdapter().builder).toBe("LGI Homes");
    expect(DEAL_ADAPTERS["LGI Homes"].builder).toBe("LGI Homes");
  });

  /** October 24, 2026: every San Antonio plan's primaryImage had moved to LGI's Sitecore Content Hub links, so 39 plans showed no photo. */
  it("keeps a plan photo on LGI's Content Hub links as well as its edge CDN, nothing else on those hosts", () => {
    const hub = "https://mss-p-022.sitecorecontenthub.cloud/api/public/content/90bfa3e4054845bdb760013dd9942ddf?v=f54da49c";
    const delivery = "https://mss-p-022-delivery.sitecorecontenthub.cloud/api/public/content/1c43a7e7207d4be99c3012c658a64cdc?v=300f67bd";
    const withImage = (src: string) => ({ ...plan({ name: "Ash", price: 245_900, beds: 2, baths: 2, garage: 1, sqft: 1_002 }), primaryImage: v({ src, alt: "Exterior" }) });
    const read = (src: string) => parseLgiCommunity(communityPage({ plans: [withImage(src)] }), COMMUNITY)!.plans[0]!.gallery!.map((image) => image.sourceUrl);
    expect(read(hub)).toEqual([hub]);
    expect(read(delivery)).toEqual([delivery]);
    expect(read("https://mss-p-022.sitecorecontenthub.cloud/api/other/90bfa3e4054845bdb760013dd9942ddf")).toEqual([]);
    expect(read("https://mss-p-099.sitecorecontenthub.cloud/api/public/content/90bfa3e4054845bdb760013dd9942ddf")).toEqual([]);
    expect(lgiPhotoHostPath(new URL("https://edge.sitecorecloud.io/lgihomesinc3717/media/x.jpg"))).toBe(true);
    expect(lgiPhotoHostPath(new URL("https://edge.sitecorecloud.io/someone-else/media/x.jpg"))).toBe(false);
  });
});
