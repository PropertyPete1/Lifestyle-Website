import { beforeEach, describe, expect, it, vi } from "vitest";
import { StarlightAdapter, parseStarlightCommunity, starlightListingEntries, starlightRecord, starlightStatus } from "./dealsAdapters.starlight";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Starlight pages in the shape the live site served in October
 * 2026: the schema.org business record, the quick move-in table, the plan
 * cards and the financing-terms paragraph. Names and addresses are invented.
 */
const HOST = "https://www.starlighthomes.com";
const COMMUNITY = `${HOST}/san-antonio/fixture-trails`;
const NOW = new Date("2026-10-20T15:00:00Z");
const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const business = (url = COMMUNITY, street = "101 Fixture Street") => ld({ "@context": "http://schema.org", "@type": "HomeAndConstructionBusiness", url, name: "Fixture Trails by Starlight Homes", brand: "Starlight Homes", address: { "@type": "postalAddress", streetAddress: street, addressLocality: "Seguin", addressRegion: "TX", postalCode: "78155", addressCountry: "United States" }, telephone: "+1-830-555-0142", geo: { "@type": "GeoCoordinates", latitude: "29.6285335", longitude: "-97.9853734" } });
const review = ld({ "@context": "http://schema.org/", "@type": "Review", itemReviewed: { "@type": "homeandconstructionbusiness", name: "Fixture Trails", address: { "@type": "PostalAddress", streetAddress: "101 Fixture Street" } }, author: { "@type": "Person", name: "Private Reviewer" }, reviewBody: "Great." });
const row = (price: string, street: string, plan: string, details: string, date: string) => `<tr class="qmi-table__row"><td class="qmi-table__cell order-5"><span class="qmi-table__price"> ${price} </span></td><td class="qmi-table__cell qmi-table__cell--location order-2"> ${street} </td><td class="qmi-table__cell order-3 qmi-table__cell--plan order-3"><span class="d-md-none">Home Plan</span><a href="/san-antonio/fixture-trails/${plan.toLowerCase()}"> ${plan} </a></td><td class="qmi-table__cell order-3 qmi-table__cell--details order-4"> ${details} </td><td class="qmi-table__cell qmi-table__cell--date order-1"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5" fill="#0072BC"></circle></svg> ${date} </td></tr>`;
const ROWS = [
  row("$269,990", "1412 Fixture Street", "Sterling", "3 Beds | 2 Baths<br> 1,402 sq. ft.", "Ready Now"),
  row("$285,990", "140 Fixture Loop", "Glimmer", "3 Beds | 2 Baths<br> 1,536 sq. ft.", "Available November 2026"),
  row("$310,990", "1408 Fixture Street", "Prism", "4 Beds | 3 Baths<br> 1,912 sq. ft.", "Available January 2027"),
  row("$315,990", "144 Fixture Loop", "Magellan", "4 Beds | 3 Baths<br> 2,268 sq. ft.", "Available September 2026"),
];
const plan = (name: string, href = `/san-antonio/fixture-trails/${name.toLowerCase()}`) => `<div class="col-md-6 col-lg-4 js-community-filter__card" data-home-type="Single Family Home"><div class="plan-card"><div class="plan-card__image-wrapper image-carousel js-plan-card-carousel"><a href="${href}" class="js-plan-card-carousel__items"><img height="246" width="328" alt="New Home" class="plan-card__image" src="https://awh.widen.net/content/abc${name}/webp/SL_${name}_Elev_K.jpg?w=328&amp;h=246" /><img class="plan-card__image" src="https://awh.widen.net/content/def${name}/webp/SL_${name}_Kitchen.jpeg?w=328" /><img class="plan-card__image" src="https://awh.widen.net/content/fp${name}/webp/SL_${name}_Floorplan.jpg" /><img class="plan-card__image" src="https://evil.example/x.jpg" /></a></div><div class="plan-card__heading"><a href="${href}">${name}</a></div><div class="specs"><div class="specs__items"><div class="row"><div class="col-6"><div class="specs__item specs__item--beds">3 Beds</div></div><div class="col-6"><div class="specs__item specs__item--baths">2 Baths</div></div><div class="col-6"><div class="specs__item specs__item--stories">1 Stories</div></div><div class="col-6"><div class="specs__item specs__item--garage">2 Car Garage</div></div><div class="col-6"><div class="specs__item specs__item--area">1,212 sq. ft.</div></div></div></div></div></div></div>`;
const TERMS = "*Terms are based upon a loan with the following terms: Payment is for principal and interest only. Credit terms are based on a 30-year fixed mortgage. Purchase price of $250,490. 2.99% (APR 6.81%) 30-YR Fixed FHA loan 3.5% down payment required, and a 620 credit score. 2/1 Program includes a 2% decrease on the interest rate for year one and a 1% decrease in the interest rate for year two. The interest rate that applies to year one is 2.99%. The interest rate that applies to year two is 3.99%. Beginning in year three, the fixed rate of 4.99% applies to the remainder of the loan life. Financing is offered Velocio Mortgage (NMLS ID #1529234) or Trailblazer Mortgage (NMLS ID #2106646), affiliated lenders of Starlight. Rate is only available until pool of funds is depleted or the rate expires on October 31, 2026. Call 830-555-0142 or visit www.starlighthomes.com for details.";
function communityPage(input: { rows?: string[]; count?: string | null; table?: boolean; plans?: string[]; business?: boolean; url?: string; street?: string; terms?: string | null } = {}) {
  const rows = input.rows ?? ROWS;
  const count = input.count === undefined ? `${rows.length} Available Homes In This Neighborhood` : input.count;
  const table = input.table === false ? "" : `<table class="qmi-table js-qmi-table-carousel"><thead class="qmi-table__head"><tr class="qmi-table__row"><th class="qmi-table__cell order-5">Price</th><th class="qmi-table__cell qmi-table__cell--location order-2">Address</th></tr></thead><tbody class="qmi-table__body">${rows.join("")}</tbody></table>`;
  return `<!DOCTYPE html><html><head><title>Fixture Trails - Move-In Ready New Homes in Seguin, TX | Starlight Homes</title>${input.business === false ? "" : business(input.url, input.street)}${review}</head><body><div class="hero"><h1>Fixture Trails</h1><p>Own your new home from $ 1427 /month*</p><p>Students attend Seguin ISD schools.</p></div>
<section class="js-expando qmi-section"><div class="qmi-section__heading">${count ?? ""}</div><div class="qmi-section__wrapper">${table}</div></section>
<section class="plans">${(input.plans ?? [plan("Falcon"), plan("Sterling")]).join("")}</section>
<footer><p>Sutton Fixture San Antonio, Texas View Neighborhood</p><p>${input.terms === undefined ? TERMS : input.terms ?? ""}</p><p>**Monthly payment shown is an estimate.</p><p>&copy; 2026 Starlight Homes, LLC.</p></footer></body></html>`;
}
const marketPage = `<html><body><a href="/san-antonio/fixture-trails">Fixture Trails</a><a href="/san-antonio/fixture-trails/falcon">Falcon</a><a href="/san-antonio/areas/san-antonio">Area</a><a href="/san-antonio/far-fixture/">Far Fixture</a><a href="https://evil.example/san-antonio/x">x</a></body></html>`;

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Starlight Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Trails", scrubList: ["Fixture Trails", "Fixture Street", "Fixture Loop"] };
const html = (body: string) => vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }));

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Starlight reader: page data", () => {
  it("reads the homes from the table (status from the availability cell, price, plan, specs), the plans from the cards (photos on the asset host, drawings left out) and the financing terms as the offer", () => {
    const parsed = parseStarlightCommunity(communityPage(), COMMUNITY, NOW)!;
    expect(parsed.record).toEqual({ name: "Fixture Trails", street: "101 Fixture Street", city: "Seguin", zip: "78155", phone: "8305550142", priceFrom: null, geo: { lat: 29.6285335, lng: -97.9853734 } });
    expect(parsed).toMatchObject({ foreignPage: false, foreignPlan: false, statedHomeCount: 4, hasTable: true });
    expect(parsed.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.readyNow, home.moveInDate, home.price, home.bedrooms, home.bathrooms, home.squareFeet])).toEqual([
      ["1412 Fixture Street, Seguin, TX 78155", "Sterling", "Quick Move-In (Move-In Ready)", true, null, 269_990, 3, 2, 1_402],
      ["140 Fixture Loop, Seguin, TX 78155", "Glimmer", "Quick Move-In (November 2026)", false, "November 2026", 285_990, 3, 2, 1_536],
      ["1408 Fixture Street, Seguin, TX 78155", "Prism", "Quick Move-In (January 2027)", false, "January 2027", 310_990, 4, 3, 1_912],
      ["144 Fixture Loop, Seguin, TX 78155", "Magellan", "Quick Move-In", false, null, 315_990, 4, 3, 2_268],
    ]);
    // The homes have no pages of their own: each is a fragment of the community page.
    expect(parsed.homes.map((home) => home.sourceUrl)).toEqual([`${COMMUNITY}#home-1412-fixture-street`, `${COMMUNITY}#home-140-fixture-loop`, `${COMMUNITY}#home-1408-fixture-street`, `${COMMUNITY}#home-144-fixture-loop`]);
    expect(parsed.plans.map((entry) => [entry.sourceUrl, entry.privatePlanName, entry.price, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage, entry.gallery!.map((image) => image.sourceUrl)])).toEqual([
      [`${COMMUNITY}/falcon`, "Falcon", null, 3, 2, 1_212, 2, ["https://awh.widen.net/content/abcFalcon/webp/SL_Falcon_Elev_K.jpg", "https://awh.widen.net/content/defFalcon/webp/SL_Falcon_Kitchen.jpeg"]],
      [`${COMMUNITY}/sterling`, "Sterling", null, 3, 2, 1_212, 2, ["https://awh.widen.net/content/abcSterling/webp/SL_Sterling_Elev_K.jpg", "https://awh.widen.net/content/defSterling/webp/SL_Sterling_Kitchen.jpeg"]],
    ]);
    expect(parsed.offer).toMatch(/^Terms are based upon a loan/);
    expect(parsed.offer).not.toMatch(/NMLS|1529234|830-555|www\./);
    expect(parsed.offer).toMatch(/expires on October 31, 2026/);
    expect(parseStarlightCommunity(communityPage({ terms: null }), COMMUNITY, NOW)!.offer).toBeNull();
    // Status wording: ready now, a future month, a past month (no date), unknown or none (no status), sold.
    expect(starlightStatus("Ready Now", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(starlightStatus("Available December 2026", NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(starlightStatus("Available October 2026", NOW)).toEqual({ status: "Quick Move-In (October 2026)", readyNow: false, moveInDate: "October 2026" });
    expect(starlightStatus("Sold", NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    for (const word of ["Coming Soon", "Available Soon", "Available 2027", "", null]) expect(starlightStatus(word, NOW).status).toBeNull();
    // A row without a readable street or with unknown wording has no status.
    const odd = parseStarlightCommunity(communityPage({ rows: [row("$1", "", "Prism", "3 Beds", "Ready Now"), row("$2", "9 Fixture Way", "Prism", "3 Beds", "Reserved")] }), COMMUNITY, NOW)!;
    expect(odd.homes.map((home) => [home.sourceUrl.replace(COMMUNITY, ""), home.status])).toEqual([["/unreadable-0", null], ["#home-9-fixture-way", null]]);
    // Another community's page under this URL, a plan under another community's path.
    expect(parseStarlightCommunity(communityPage({ url: `${HOST}/san-antonio/other-trails` }), COMMUNITY, NOW)!.foreignPage).toBe(true);
    expect(parseStarlightCommunity(communityPage({ plans: [plan("Zinnia", "/san-antonio/other-trails/zinnia")] }), COMMUNITY, NOW)).toMatchObject({ foreignPlan: true, plans: [] });
    expect(parseStarlightCommunity(communityPage({ business: false }), COMMUNITY, NOW)).toBeNull();
    expect(parseStarlightCommunity("<html><body>new layout</body></html>", COMMUNITY, NOW)).toBeNull();
    expect(starlightRecord(communityPage({ street: "By Appointment Only" }))).toMatchObject({ street: null, geo: { lat: 29.6285335, lng: -97.9853734 } });
  });

  it("lists the market page's community links, never an area page, a plan page or another host", () => {
    expect(starlightListingEntries(marketPage, "www.starlighthomes.com")).toEqual([{ url: COMMUNITY, record: null }, { url: `${HOST}/san-antonio/far-fixture`, record: null }]);
    expect(starlightListingEntries("<html></html>", "www.starlighthomes.com")).toBeNull();
  });
});

describe("Starlight reader: a community", () => {
  it("reads the page once and publishes the homes, plans and the buydown offer scrubbed", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes).toHaveLength(4);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 269_990, schoolDistrict: "Seguin ISD" });
    expect(result.private.incentive?.facts).toMatchObject({ rateKind: "promotional", promotionalRatePercent: 2.99, followOnRatePercent: 4.99, aprPercent: 6.81, loanType: "FHA", repaymentTermYears: 30, downPaymentPercent: 3.5, publishable: true });
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78155", "starlighthomes", "Starlight", "Velocio", "Trailblazer", "NMLS", "Private Reviewer", "widen"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((home) => home.status)).toEqual(["Quick Move-In (Move-In Ready)", "Quick Move-In (November 2026)", "Quick Move-In (January 2027)", "Quick Move-In"]);
    // A community with no homes shows no table and no count.
    const none = await loadOfficialDeals(config, { fetcher: html(communityPage({ rows: [], count: null, table: false })), now: () => NOW });
    expect(none.holdReasons).toEqual([]);
    expect(none.private.homes).toEqual([]);
    expect(none.private.plans).toHaveLength(2);
  });

  it("holds the run when the page is not a community page, when the office address is missing, when the count and the table disagree, when the page is another community's, when the site is not Starlight's, or when it cannot be read", async () => {
    expect((await loadOfficialDeals(config, { fetcher: html("<html><body>new layout</body></html>"), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals(config, { fetcher: html(communityPage({ street: "By Appointment Only" })), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // Four counted, three rows: a changed table, never a sold home.
    expect((await loadOfficialDeals(config, { fetcher: html(communityPage({ rows: ROWS.slice(0, 3), count: "4 Available Homes In This Neighborhood" })), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A count with no table, or rows with no count.
    expect((await loadOfficialDeals(config, { fetcher: html(communityPage({ table: false, count: "4 Available Homes In This Neighborhood" })), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals(config, { fetcher: html(communityPage({ count: null })), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals(config, { fetcher: html(communityPage({ url: `${HOST}/san-antonio/other-trails` })), now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await loadOfficialDeals(config, { fetcher: html(communityPage({ plans: [plan("Zinnia", "/san-antonio/other-trails/zinnia")] })), now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    // A row with unknown wording keeps its place with no status: the sync holds the run.
    const held = await loadOfficialDeals(config, { fetcher: html(communityPage({ rows: [...ROWS, row("$1", "9 Fixture Way", "Prism", "3 Beds", "Reserved")] })), now: () => NOW });
    expect(held.private.homes.at(-1)?.status).toBeNull();
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://starlighthomes.com/san-antonio/fixture-trails" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new StarlightAdapter().builder).toBe("Starlight Homes");
    expect(DEAL_ADAPTERS["Starlight Homes"].builder).toBe("Starlight Homes");
  });
});
