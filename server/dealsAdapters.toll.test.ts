import { beforeEach, describe, expect, it, vi } from "vitest";
import { TollBrothersAdapter, parseTollCommunity, tollListingEntries, tollOfferText, tollStatus } from "./dealsAdapters.toll";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Toll Brothers pages in the shape the live site served in October
 * 2026: a Next.js community page whose `communityComponent` carries plans with
 * nested quick move-in homes, the sales office, the site plan's count and the
 * events; and the metro search page listing communities. Names and addresses
 * are invented.
 */
const HOST = "https://www.tollbrothers.com";
const CDN = "https://cdn.tollbrothers.com";
const COMMUNITY = `${HOST}/luxury-homes-for-sale/Texas/Toll-Brothers-at-Fixture-Ranch`;
const NOW = new Date("2026-10-20T12:00:00Z");
const nextPage = (pageProps: unknown) => `<!DOCTYPE html><html><head><title>Fixture</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps }, page: "/[...slug]" })}</script></body></html>`;
const media = (url: string, title: string, representative = false) => ({ title: "We need a title here", media: { type: "image", url, title, representative, virtual: false } });

const qmi = (input: { id: number; street: string; price: number; moveInDate: string | null; beds: number; baths: number; half: number; sqft: number; lot: string; plan: string; comingSoon?: boolean; communityId?: number }) => ({
  name: `${input.plan} Modern Farmhouse`, city: "San Antonio", state: "TX", zip: "78245", street: input.street, address: input.street, moveInDate: input.moveInDate, lotNumber: input.lot,
  url: `${COMMUNITY}/Quick-Move-In/${input.id}`, minBed: input.beds, minBath: input.baths, minHalfBath: input.half, minSqft: input.sqft, pricedFrom: input.price, stories: "1.0", minGarage: 2,
  isQMI: true, isComingSoon: input.comingSoon ?? false, communityId: input.communityId ?? 14973, modelName: input.plan,
  headShot: media(`${CDN}/communities/14973/plans/${input.id}/exteriors-resized/QMI_${input.id}_1920.jpg`, "Modern Farmhouse"),
  elevations: [media(`${CDN}/communities/14973/plans/${input.id}/exteriors-resized/QMI_${input.id}_1920.jpg`, "Modern Farmhouse"), media(`${CDN}/communities/14973/plans/${input.id}/floorplans-original/QMI_${input.id}.svg`, "Floor plan")],
  featureCallouts: ["Corner Home Site"],
});
const model = (input: { name: string; price: number | null; beds: number; baths: number; half: number; sqft: number; qmis: ReturnType<typeof qmi>[] }) => ({
  name: input.name, modelName: input.name, city: "San Antonio", state: "TX", zip: "78245", url: `${COMMUNITY}/${input.name}`, minBed: input.beds, minBath: input.baths, minHalfBath: input.half, minSqft: input.sqft, pricedFrom: input.price, stories: "1.0", minGarage: 2,
  isQMI: false, isComingSoon: false, communityId: 14973, headShot: media(`${CDN}/communities/14973/plans/279939/exteriors-resized/${input.name.toUpperCase()}_1920.jpg`, "Modern Farmhouse"), qmis: input.qmis,
});
const HOMES = [
  qmi({ id: 285653, street: "4106 Fixture Oak", price: 520_000, moveInDate: "2026-11-30", beds: 3, baths: 2, half: 0, sqft: 1_912, lot: "16", plan: "Aberforth" }),
  qmi({ id: 286536, street: "4006 Fixture Green", price: 459_000, moveInDate: "2026-10-20", beds: 4, baths: 3, half: 1, sqft: 2_610, lot: "22", plan: "Bellwether" }),
  qmi({ id: 283850, street: "13307 Fixture Cedar", price: 439_000, moveInDate: "2026-10-01", beds: 3, baths: 2, half: 0, sqft: 1_912, lot: "31", plan: "Aberforth" }),
];
const EVENTS = [
  { headline: { link: "/nse", text: "Up to $45,000 to Use Your Way on Build to Order Homes" }, cta: { text: "Get Started" }, paragraphs: [{ text: "Extended Through October 25" }], disclaimer: "Offer, if any, is valid for new buyers who purchase a home in a participating community and deposit between 10/03/2026 and 10/25/2026, sign an agreement of sale, and close on the home. Toll Brothers reserves the right to change or withdraw any offer at any time.", eventType: "nationalEvent", startDate: "2026-06-27", endDate: "2026-10-26" },
  { eventType: "bannerEventNational", headline: { link: "/5.49-fha", text: "5.49% (6.27% APR)*\nFHA 30-Year Fixed ", disclaimer: "Offers, incentives, and seller contributions, if any, vary by community. Valid for new buyers only that sign an Agreement of Sale on select quick delivery homes on or after 10/8/26 and close by 12/18/26. Based on $509,224 sales price, $491,401 base loan amount, and minimum 660 qualifying credit score. Rate/program available through Toll Brothers Mortgage Company NMLS #18154 (www.nmlsconsumeraccess.org). See www.TollBrothersMortgage.com for state licensing information. Call 877-500-0508. 10/2026." }, paragraphs: [{ text: "Choose a beautiful new Toll Brothers quick move-in home now and qualify for a special 5.49% (6.27% APR)* FHA 30-year fixed-rate mortgage with as little as 3.5% down through Toll Brothers Mortgage Company. This offer is limited to select quick move-in homes eligible to close by December 18, 2026." }] },
];
function communityPage(input: { homes?: ReturnType<typeof qmi>[]; sitePlanHomes?: number | null; office?: boolean; models?: boolean; events?: unknown[] } = {}) {
  const homes = input.homes ?? HOMES;
  const models = [model({ name: "Aberforth", price: 414_995, beds: 3, baths: 2, half: 0, sqft: 1_912, qmis: homes.filter((home) => home.modelName === "Aberforth") }), model({ name: "Bellwether", price: null, beds: 4, baths: 3, half: 1, sqft: 2_610, qmis: homes.filter((home) => home.modelName === "Bellwether") })];
  const component: Record<string, unknown> = {
    name: "Toll Brothers at Fixture Ranch", city: "San Antonio", state: "TX", zip: "78245", county: "Bexar", lat: "29.392923572709442", lon: "-98.75819022822728", communityId: 14973, pricedFrom: "414,995", pricedFromInt: 414995, url: COMMUNITY,
    salesOffice: input.office === false ? null : { city: "San Antonio", state: "TX", zip: "78245", street: "13312 Fixture Acacia", lat: "29.392923572709442", lon: "-98.75819022822728", salesOfficePhone: "210-756-0955", salesPeople: [{ name: "A. Person" }] },
    schoolInfo: { schoolDistrict: "Medina Valley Independent School District", highSchool: "Medina Valley High School" },
    amenities: { amenityGroups: [{ name: "Community", amenities: [{ name: "Resort-style pool" }, { name: "Walking trails" }] }] },
    homes: input.models === false ? { title: "Homes" } : { title: "Homes", models },
    badgeText: "Quick Move-In Homes Available", qmiSitePlanLots: input.sitePlanHomes === undefined ? homes.length : input.sitePlanHomes, availableLots: 16, soldLots: 1,
    events: input.events ?? EVENTS,
  };
  return nextPage({ componentType: "CommunityComponent", pageData: { componentType: "CommunityComponent", path: "/luxury-homes-for-sale/Texas/Toll-Brothers-at-Fixture-Ranch", name: "Toll Brothers at Fixture Ranch", communityComponent: component, masterCommunityComponent: null }, projectId: "90170000", robots: true });
}
const listingPage = nextPage({ componentType: "SearchComponent", isSearchPage: true, searchResults: { perfect: [
  { "@type": "CommunitySearchItem", isMaster: false, url: COMMUNITY, name: "Toll Brothers at Fixture Ranch", lat: "29.392923572709442", lon: "-98.75819022822728", communityId: 14973, city: "San Antonio", zipCode: "78245", streetAddress: "13312 Fixture Acacia", phone: "210-756-0955", pricedFrom: "414,995", pMin: 414995, numQDH: 3, type: "CommunitySearchItem" },
  { "@type": "MasterCommunitySearchItem", isMaster: true, url: `${HOST}/luxury-homes-for-sale/Texas/Regency-at-Fixture`, name: "Regency at Fixture", lat: "29.806395", lon: "-98.689625", city: "Boerne", pricedFrom: "Low $400,000s", communities: [
    { "@type": "CommunitySearchItem", isMaster: false, url: `${HOST}/luxury-homes-for-sale/Texas/Regency-at-Fixture/Flamenco-Collection`, name: "Regency at Fixture - Flamenco Collection", lat: "29.806", lon: "-98.689", city: "Boerne", zipCode: "78006", streetAddress: "103 Fixture Way", phone: "830-555-0100", pricedFrom: "409,995", pMin: 409995 },
  ] },
  { "@type": "CommunitySearchItem", isMaster: false, url: `${HOST}/luxury-homes-for-sale/Texas/Toll-Brothers-at-Far-Fixture`, name: "Toll Brothers at Far Fixture", lat: "29.5516", lon: "-97.944852", city: "Seguin", zipCode: "78155", streetAddress: "916 Fixture Bend", phone: "830-360-8715", pricedFrom: "315,995" },
  { "@type": "CommunitySearchItem", isMaster: false, url: "https://evil.example/luxury-homes-for-sale/Texas/x", name: "Elsewhere", lat: "29.5", lon: "-98.5", city: "San Antonio" },
] } });

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Toll Brothers", sourceUrl: COMMUNITY, privateCommunityName: "Toll Brothers at Fixture Ranch", scrubList: ["Fixture Ranch", "Fixture Oak", "Fixture Green", "Fixture Cedar", "Fixture Acacia"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Toll Brothers reader: page data", () => {
  it("reads plans and their quick move-in homes from the Next.js data: office city and ZIP, baths from full and half, status from the move-in date, lot, photos without drawings; the offer text names the rate", () => {
    const parsed = parseTollCommunity(communityPage(), COMMUNITY, NOW)!;
    expect(parsed.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.homesite, home.readyNow, home.moveInDate, home.gallery?.length])).toEqual([
      ["4106 Fixture Oak, San Antonio, TX 78245", "Aberforth", "Quick Move-In (November 2026)", 520_000, 3, 2, 1_912, "Lot 16", false, "November 2026", 1],
      ["13307 Fixture Cedar, San Antonio, TX 78245", "Aberforth", "Quick Move-In (Move-In Ready)", 439_000, 3, 2, 1_912, "Lot 31", true, null, 1],
      ["4006 Fixture Green, San Antonio, TX 78245", "Bellwether", "Quick Move-In (Move-In Ready)", 459_000, 4, 3.5, 2_610, "Lot 22", true, null, 1],
    ]);
    expect(parsed.homes[0]!.sourceUrl).toBe(`${COMMUNITY}/Quick-Move-In/285653`);
    expect(parsed.homes[0]!.gallery![0]!.sourceUrl).toBe(`${CDN}/communities/14973/plans/285653/exteriors-resized/QMI_285653_1920.jpg`);
    expect(parsed.plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.gallery?.[0]?.caption ?? null])).toEqual([["Aberforth", 414_995, 3, 2, 1_912, "Representative image"], ["Bellwether", null, 4, 3.5, 2_610, "Representative image"]]);
    expect(parsed.plans[0]!.sourceUrl).toBe(`${COMMUNITY}/Aberforth`);
    expect(parsed.record).toEqual({ name: "Toll Brothers at Fixture Ranch", street: "13312 Fixture Acacia", city: "San Antonio", zip: "78245", phone: "2107560955", priceFrom: 414_995, geo: { lat: 29.392923572709442, lng: -98.75819022822728 } });
    expect(parsed.sitePlanHomes).toBe(3);
    expect(parsed.facts).toEqual({ schoolDistrict: "Medina Valley Independent School District", amenities: ["Resort-style pool", "Walking trails"] });
    // The rate banner is the offer, with the lender's NMLS id, links and phone number stripped.
    expect(parsed.offer).toMatch(/^5\.49% \(6\.27% APR\)\* FHA 30-Year Fixed\. Choose a beautiful new Toll Brothers quick move-in home/);
    expect(parsed.offer).not.toMatch(/18154|NMLS|www\.|877-500|nmlsconsumeraccess|\( See|licensing/i);
    expect(tollOfferText([EVENTS[0]], NOW)).toMatch(/^Up to \$45,000 to Use Your Way on Build to Order Homes\. Extended Through October 25\. Offer, if any/);
    expect(tollOfferText([], NOW)).toBeNull();
    // An event that has ended or not begun is not the offer; a lender's domain without "www.", a phone without separators and a loan officer's sentence are stripped.
    expect(tollOfferText([{ ...EVENTS[0], endDate: "2026-10-19" }], NOW)).toBeNull();
    expect(tollOfferText([{ ...EVENTS[0], startDate: "2026-11-01", endDate: "2026-12-01" }], NOW)).toBeNull();
    expect(tollOfferText([{ headline: { text: "Rate 5.49% (6.27% APR)" }, disclaimer: "Visit TollBrothersMortgage.com or call 8775000508 today. Loan officer Jane Q. Lender, TBI. See www.TollBrothersMortgage.com for state licensing information." }], NOW)).toBe("Rate 5.49% (6.27% APR).");
    expect(parseTollCommunity("<html><body>new layout</body></html>", COMMUNITY)).toBeNull();
    expect(parseTollCommunity(communityPage({ models: false }), COMMUNITY, NOW)).toBeNull();
    // Status: a move-in date on or before today is ready, a later one names its month, coming soon is not for sale, no date is no status.
    expect(tollStatus("2026-10-20", false, NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(tollStatus("2027-01-15", false, NOW)).toEqual({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    expect(tollStatus("2026-12-04", true, NOW)).toEqual({ status: "Coming Soon", readyNow: false, moveInDate: null });
    expect(tollStatus(null, false, NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    expect(tollStatus("TBD", false, NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    // A home of another community id, or one without a street or link, stays in the list with no status.
    const odd = parseTollCommunity(communityPage({ homes: [qmi({ ...HOMES[0]!, id: 1, street: "", price: 1, moveInDate: "2026-11-30", beds: 3, baths: 2, half: 0, sqft: 1, lot: "1", plan: "Aberforth" }), qmi({ id: 2, street: "9 Other St", price: 400_000, moveInDate: "2026-11-30", beds: 3, baths: 2, half: 0, sqft: 1_900, lot: "2", plan: "Aberforth", communityId: 99 })] }), COMMUNITY, NOW)!;
    expect(odd.homes.map((home) => home.status)).toEqual([null, null]);
    expect(odd.shapeIntact).toBe(true);
    expect(odd.foreignHome).toBe(false);
  });

  it("lists the metro's communities from the search page, collections of a master community included, never another host", () => {
    const entries = tollListingEntries(listingPage, "www.tollbrothers.com")!;
    expect(entries.map((entry) => [entry.url, entry.record.name, entry.record.street, entry.record.city, entry.record.zip, entry.record.phone, entry.record.priceFrom, entry.record.geo])).toEqual([
      [COMMUNITY, "Toll Brothers at Fixture Ranch", "13312 Fixture Acacia", "San Antonio", "78245", "2107560955", 414_995, { lat: 29.392923572709442, lng: -98.75819022822728 }],
      [`${HOST}/luxury-homes-for-sale/Texas/Regency-at-Fixture/Flamenco-Collection`, "Regency at Fixture - Flamenco Collection", "103 Fixture Way", "Boerne", "78006", "8305550100", 409_995, { lat: 29.806, lng: -98.689 }],
      [`${HOST}/luxury-homes-for-sale/Texas/Toll-Brothers-at-Far-Fixture`, "Toll Brothers at Far Fixture", "916 Fixture Bend", "Seguin", "78155", "8303608715", 315_995, { lat: 29.5516, lng: -97.944852 }],
    ]);
    expect(tollListingEntries("<html><body>new layout</body></html>", "www.tollbrothers.com")).toBeNull();
  });
});

describe("Toll Brothers reader: a community", () => {
  it("reads the page once and publishes homes, plans and the offer scrubbed", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    // The rate banner names a contract window without a parseable deadline, so the offer waits for an admin look; the catalog publishes.
    expect(result.catalogOk).toBe(true);
    expect(result.incentiveHoldReasons).toEqual(["missing_contract_deadline"]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes).toHaveLength(3);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 414_995, schoolDistrict: "Medina Valley Independent School District" });
    expect(result.private.incentive?.text).toContain("5.49% (6.27% APR)");
    expect(result.private.incentive?.facts.holdReasons).not.toContain("adjustable_rate");
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78245", "tollbrothers", "Toll Brothers", "Toll", "TBI", "Aberforth", "285653", "A. Person"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((home) => home.status)).toEqual(["Quick Move-In (November 2026)", "Quick Move-In (Move-In Ready)", "Quick Move-In (Move-In Ready)"]);
    // No events: no offer, nothing held.
    const quiet = vi.fn(async () => new Response(communityPage({ events: [] }), { status: 200, headers: { "content-type": "text/html" } }));
    const plain = await loadOfficialDeals(config, { fetcher: quiet, now: () => NOW });
    expect(plain.holdReasons).toEqual([]);
    expect(plain.private.incentive).toBeNull();
  });

  it("holds the run when the page is not a community page, when the site plan counts more homes than the data lists, when the site is not Toll's, or when it cannot be read", async () => {
    const reshaped = vi.fn(async () => new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noModels = vi.fn(async () => new Response(communityPage({ models: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noModels })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noOffice = vi.fn(async () => new Response(communityPage({ office: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noOffice })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // The home list changed shape (qmis moved) while the site plan still counts three homes for sale: never three sold homes.
    const fewer = vi.fn(async () => new Response(communityPage({ homes: [], sitePlanHomes: 3 }), { status: 200, headers: { "content-type": "text/html" } }));
    const held = await loadOfficialDeals(config, { fetcher: fewer, now: () => NOW });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    // The home lists gone from every model while the site plan says nothing: a changed shape, never a sale; so is a home listed as a top-level model.
    const noLists = vi.fn(async () => new Response(communityPage({ homes: [], sitePlanHomes: null }).replace(/"qmis":\[\]/g, "\"homesForSale\":[]"), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noLists, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const topLevel = vi.fn(async () => new Response(communityPage({ homes: [], sitePlanHomes: null }).replace("\"isQMI\":false,\"isComingSoon\":false,\"communityId\":14973,\"headShot\"", "\"isQMI\":true,\"isComingSoon\":false,\"communityId\":14973,\"headShot\""), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: topLevel, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A home under another community's path, or data describing another community page, is not this community's inventory.
    const foreign = vi.fn(async () => new Response(communityPage({ homes: [qmi({ id: 999, street: "1 Other Way", price: 400_000, moveInDate: "2026-11-30", beds: 3, baths: 2, half: 0, sqft: 1_900, lot: "9", plan: "Aberforth" })] }).replace(`${COMMUNITY}/Quick-Move-In/999`, `${HOST}/luxury-homes-for-sale/Texas/Other-Community/Quick-Move-In/999`), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: foreign, now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    const redirected = vi.fn(async () => new Response(communityPage().replace(`"pricedFromInt":414995,"url":"${COMMUNITY}"`, `"pricedFromInt":414995,"url":"${HOST}/luxury-homes-for-sale/Texas/Other-Community"`), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: redirected, now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    // An apostrophe spelled "%27" in the page data and "'" in the configured URL (or the reverse) is the same page.
    const spelled = vi.fn(async () => new Response(communityPage().split(COMMUNITY).join(`${HOST}/luxury-homes-for-sale/Texas/Fixture-60%27s`), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals({ ...config, sourceUrl: `${HOST}/luxury-homes-for-sale/Texas/Fixture-60's` }, { fetcher: spelled, now: () => NOW })).holdReasons).not.toContain("invalid_inventory_response");
    // No homes and a site plan that agrees: a community with plans only.
    const none = vi.fn(async () => new Response(communityPage({ homes: [], sitePlanHomes: 0 }), { status: 200, headers: { "content-type": "text/html" } }));
    const plansOnly = await loadOfficialDeals(config, { fetcher: none, now: () => NOW });
    expect(plansOnly.catalogOk).toBe(true);
    expect(plansOnly.private.plans).toHaveLength(2);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://tollbrothers.com/luxury-homes-for-sale/Texas/Toll-Brothers-at-Fixture-Ranch" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new TollBrothersAdapter().builder).toBe("Toll Brothers");
    expect(DEAL_ADAPTERS["Toll Brothers"].builder).toBe("Toll Brothers");
  });
});
