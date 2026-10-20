import { beforeEach, describe, expect, it, vi } from "vitest";
import { PulteGroupAdapter, flag, parsePulteListing, parsePulteOffers, parsePulteQmi, pulteCommunityId, pulteMoveIn, pulteSoldDate, resetPulteGroupCaches } from "./dealsAdapters.pultegroup";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic PulteGroup responses in the shape the live platform served in
 * October 2026: the market listing, the two inventory endpoints, and a home
 * page carrying the market offers carousel. Names and addresses are invented.
 */
const HOST = "www.centex.com";
const COMMUNITY = `https://${HOST}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073`;
const LISTING = `https://${HOST}/API/Community/Search?State=Texas&Region=San%20Antonio&Brand=Centex&JsonFormat=true&pageSize=0`;
const image = (id: string, rank: number, imageType: string, caption = "") => ({ name: "", imageID: id, path: `https://pultegroup.cdn.picturepark.com/v/${id}/`, altText: caption, imageRank: rank, caption, imageType, refID: 1 });

const listing = JSON.stringify([
  { id: 211073, name: "Fixture Ridge", status: "Quick Move-Ins Available", brandName: "Centex", address: { street1: "13607 Fixture Way", street2: "", zipCode: "78245", city: "San Antonio", state: "Texas" }, latitude: 29.39, longitude: -98.72, isCommunityActive: true, pageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073", salesPhoneNumber: "(210) 555-0100", startingFromPrice: 251_490, schoolDistrictLabel: null, inventoryCount: 2, planCount: 2 },
  { id: 211074, name: "Fixture Ridge", status: "Save on To-Be-Built Homes", brandName: "Pulte", address: { street1: "13607 Fixture Way", zipCode: "78245", city: "San Antonio" }, latitude: 29.39, longitude: -98.72, isCommunityActive: true, pageURL: "https://www.pulte.com/homes/texas/san-antonio/san-antonio/fixture-ridge-211074", salesPhoneNumber: "(210) 555-0101", startingFromPrice: 333_990 },
  { id: 211338, name: "Fixture Webb at Far Falls", status: "New Phase Available", brandName: "Del Webb", address: { street1: "1 Far Rd", zipCode: "78640", city: "Kyle" }, latitude: 29.99, longitude: -97.87, isCommunityActive: true, pageURL: "https://www.delwebb.com/homes/texas/san-antonio/kyle/fixture-webb-211338", salesPhoneNumber: null, startingFromPrice: 400_000 },
]);

const qmis = JSON.stringify([
  { inventoryHomeID: 1154490, communityId: 211073, communityName: "Fixture Ridge", brandName: "Centex", planId: 699869, planName: "Livingston", address: { street1: "13723 Fixture Pass", street2: "", zipCode: "78245", city: "San Antonio", state: "Texas" }, bedrooms: 3, bathrooms: 2, halfBaths: 0, totalBaths: 2, squareFeet: 1_438, floors: 1, garages: 2, lotBlock: "01505", dateAvailable: "Available Now", price: 289_790, priceDiscount: 15_000, finalPrice: 274_790, soldDate: null, qmiFlagName: "Special Financing Available", inventoryPageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/livingston-699869/1154490", images: [image("Q2Interior", 2, "Inventory Interior", "Kitchen"), image("Q1Exterior", 1, "Inventory Exterior", "Front"), image("QFloor", 0, "Floor Plan", "Livingston floor plan")], mortgagePayment: { interestRatePercent: 4.75, forwardCommitmentFlag: true } },
  { inventoryHomeID: 1155006, communityId: 211073, planName: "Kemp", address: { street1: "13727 Fixture Pass", zipCode: "78245", city: "San Antonio" }, bedrooms: 4, totalBaths: 2.5, squareFeet: 1_902, garages: 2, lotBlock: "01605", dateAvailable: "Dec 2026", price: 312_990, priceDiscount: 0, finalPrice: 312_990, soldDate: null, inventoryPageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/kemp-699939/1155006", images: [] },
  { inventoryHomeID: 1155007, communityId: 211073, planName: "Adams", address: { street1: "13731 Fixture Pass", zipCode: "78245", city: "San Antonio" }, bedrooms: 3, totalBaths: 2, squareFeet: 1_204, garages: 2, lotBlock: "01705", dateAvailable: "Available Now", price: 257_490, priceDiscount: 0, finalPrice: 257_490, soldDate: "2026-10-12T00:00:00Z", inventoryPageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/adams-695863/1155007", images: [] },
]);

const plans = JSON.stringify([
  { id: 695863, communityId: 211073, planName: "Adams", price: 257_490, bedrooms: 3, bathrooms: 2, maxTotalBaths: 2, squareFeet: 1_204, garages: 2, isSoldOut: false, isFutureRelease: false, isPlanActive: true, pageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/adams-695863", images: [image("P1", 1, "Home Exterior", "Adams exterior")] },
  { id: 699939, communityId: 211073, planName: "Kemp", price: 251_490, bedrooms: 3, bathrooms: 2, maxTotalBaths: 2, squareFeet: 1_276, garages: 2, isSoldOut: false, isFutureRelease: false, isPlanActive: true, pageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/kemp-699939", images: [] },
  { id: 700000, communityId: 211073, planName: "Gone", price: 0, bedrooms: 3, bathrooms: 2, squareFeet: 1_000, isSoldOut: true, isFutureRelease: false, isPlanActive: true, pageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/gone-700000", images: [] },
]);

const disclaimer = `<a href="#" class="popover-close-btn"><i class="icon-close" aria-label="close"></i></a> <h4 class="SpecialOffersV2__popover-title">Disclaimer</h4> <p><p>*&quot;Savings Up To&quot; offer available on new purchase agreements for select quick move-in homes that are accepted by builder by 10/31/2026. Offer is subject to change or withdrawal at any time without notice. Amount of savings varies by home and community.&nbsp; Community Association fees required. &copy;2026 PulteGroup, Inc. and/or its affiliates. All rights reserved.</p> <p>*Example based on new contracts signed and financing through Pulte Mortgage LLC (NMLS 1791), based on a FHA 30 year fixed mortgage, sales price $349,000, loan amount $342,678 (includes upfront mortgage insurance premium) with a 3.5% down payment and interest rate of 4.75%/5.58% APR, effective 10/2/26. Rate based on FICO score of 700 and a primary residence only. Loans must be locked and closed by 10/31/26. Monthly payment of $2,555 includes principal, interest, mortgage insurance, estimated taxes and insurance. Loans subject to lender approval. Pulte Mortgage is an Equal Opportunity Lender. Licensing information: secure.pultemortgage.com/information/contactus.aspx or <a href="http://www.nmlsconsumeraccess.org/" target="_blank">www.nmlsconsumeraccess.org</a>. [October 2026]</p> </p>`;
const slide = (title: string, disclaimerHtml: string, description: string) => `<div class="SpecialOffersV2__content d-sm-flex"><div class="SpecialOffersV2__slide"><h4 class="SpecialOffersV2__title mt-0 mb-md-3" data-event-title-color="#3d3d3d"> <span>${title}</span> <button id="SpecialOffersV2__disclaimer" class="SpecialOffersV2__disclaimer PopoverBtn" data-popover="true" data-html="true" role="button" data-content='${disclaimerHtml}'> <span id="tooltip" aria-label="tooltip">i</span> </button> </h4> <div class="SpecialOffersV2__description flex-sm-grow-1 mb-4"> ${description} </div> <div><a href="https://${HOST}/homes/texas/san-antonio#QMI" class="btn btn-primary SpecialOffersV2__cta">See Available Homes</a></div></div></div>`;
const homePage = `<!doctype html><html><head><title>13723 Fixture Pass | Centex</title></head><body><main><h1>13723 Fixture Pass</h1><p>$274,790</p>
<div class="SpecialOffersV2__wrapper"><div class="SpecialOffersV2__carousel-container"><div id="SpecialOffersV2__carousel" class="SpecialOffersV2__carousel owl-carousel">
${slide("We’re Proud to Honor Heroes Like You!", `<h4 class="SpecialOffersV2__popover-title">Disclaimer</h4> <p>Valid on new purchase agreements accepted in San Antonio area Centex communities between 1/1/26 and 12/31/26. At closing builder will credit an eligible buyer up to $2,000 toward selected design center options.</p>`, "When you purchase a new Centex&#174; home, you will receive a $2,000* incentive as a&#160;way of saying thank you. Offer applies to teachers, nurses, EMS, police, firefighters and active/former military.")}
${slide("More to Love This Fall", disclaimer, "Make your move this fall and save up to $43,000 on select Centex homes, plus take advantage of an FHA 30-year fixed rate as low as 4.75% / 5.58% APR. Explore available homes and limited-time savings through October 31.")}
${slide("Builder&#39;s Best Pricing Available on Select Quick Move-Ins", `<p>Builder's Best Price is available on select quick move-in homes as indicated.</p>`, "Builder Best Price available on select quick move-in homes as indicated.")}
</div></div></div></main></body></html>`;

const site: Record<string, { body: string; type: string }> = {
  [LISTING]: { body: listing, type: "application/json; charset=utf-8" },
  [`https://${HOST}/api/plan/qmiplans?communityId=211073`]: { body: qmis, type: "application/json; charset=utf-8" },
  [`https://${HOST}/api/plan/homeplans?communityId=211073`]: { body: plans, type: "application/json; charset=utf-8" },
  [`https://${HOST}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/livingston-699869/1154490`]: { body: homePage, type: "text/html; charset=utf-8" },
};

const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const entry = site[input];
  if (!entry) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  return new Response(entry.body, { status: 200, headers: { "content-type": entry.type } });
});

// No scrub config is passed: the builder's and lender's names come from the shared builder table (builderScrubConfig).
const config: CommunitySourceConfig = { builder: "Centex", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Ridge", scrubList: ["Fixture Ridge", "Fixture Pass", "Fixture Way"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; resetPulteGroupCaches(); });

describe("PulteGroup reader: record shapes", () => {
  it("reads the market listing for every brand, the community id from a path, and move-in wording", () => {
    const listings = parsePulteListing(listing)!;
    expect(listings.map((entry) => [entry.id, entry.brandName, entry.address?.zipCode])).toEqual([[211073, "Centex", "78245"], [211074, "Pulte", "78245"], [211338, "Del Webb", "78640"]]);
    expect(parsePulteListing("<html>maintenance</html>")).toBeNull();
    expect(parsePulteListing(JSON.stringify([{ id: 1 }]))).toBeNull();
    expect(pulteCommunityId("/homes/texas/san-antonio/san-antonio/fixture-ridge-211073")).toBe(211073);
    expect(pulteCommunityId("/homes/texas/san-antonio/san-antonio/")).toBeNull();
    expect(pulteMoveIn("Available Now")).toEqual({ readyNow: true, moveInDate: null, unknown: false });
    expect(pulteMoveIn("Oct 2026")).toEqual({ readyNow: false, moveInDate: "October 2026", unknown: false });
    expect(pulteMoveIn("Sept 2026")).toEqual({ readyNow: false, moveInDate: "September 2026", unknown: false });
    expect(pulteMoveIn(null)).toEqual({ readyNow: false, moveInDate: null, unknown: false });
    // Wording the reader does not know is never published as a move-in date.
    for (const odd of ["Under Contract", "Pending", "Coming Soon", "TBD", "Model Home", "Not Available"]) expect(pulteMoveIn(odd)).toEqual({ readyNow: false, moveInDate: null, unknown: true });
    // A sale needs a real past date; .NET's default date and a future date are not sales.
    const at = new Date("2026-10-20T12:00:00Z");
    expect(pulteSoldDate("2026-10-12T00:00:00Z", at)).toBe(true);
    expect(pulteSoldDate("0001-01-01T00:00:00", at)).toBe(false);
    expect(pulteSoldDate("2027-03-01T00:00:00Z", at)).toBe(false);
    expect(pulteSoldDate("", at)).toBe(false);
    expect(pulteSoldDate(null, at)).toBe(false);
    expect(flag("true")).toBe(true); expect(flag("False")).toBe(false); expect(flag(true)).toBe(true); expect(flag(undefined)).toBeNull();
  });

  it("reads a home for sale: sale price with the list price it dropped from, specs, homesite, address, photos in rank order without the floor plan", () => {
    const home = parsePulteQmi(JSON.parse(qmis)[0], HOST)!;
    expect(home).toMatchObject({ privateName: "13723 Fixture Pass", privateAddress: "13723 Fixture Pass, San Antonio, TX 78245", privatePlanName: "Livingston", status: "Quick Move-In (Move-In Ready)", price: 274_790, previousPrice: 289_790, priceDrop: 15_000, bedrooms: 3, bathrooms: 2, squareFeet: 1_438, garage: 2, homesite: "Homesite 01505", readyNow: true, moveInDate: null });
    expect(home.sourceUrl).toBe(`https://${HOST}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/livingston-699869/1154490`);
    expect(home.gallery!.map((photo) => photo.sourceUrl)).toEqual(["https://pultegroup.cdn.picturepark.com/v/Q1Exterior/", "https://pultegroup.cdn.picturepark.com/v/Q2Interior/"]);
    expect(parsePulteQmi(JSON.parse(qmis)[1], HOST)).toMatchObject({ status: "Quick Move-In (December 2026)", moveInDate: "December 2026", price: 312_990, previousPrice: null, bathrooms: 2.5 });
    expect(parsePulteQmi(JSON.parse(qmis)[2], HOST, new Date("2026-10-20T12:00:00Z"))).toMatchObject({ status: "Sold" });
    expect(parsePulteQmi({ planName: "No address" }, HOST)).toBeNull();
    // "Under Contract" in dateAvailable: no status, so the sync holds the run rather than listing the home as available.
    expect(parsePulteQmi({ ...JSON.parse(qmis)[1], dateAvailable: "Under Contract" }, HOST)).toMatchObject({ status: null, moveInDate: null, readyNow: false });
    // A sentinel sold date is not a sale: the home stays for sale.
    expect(parsePulteQmi({ ...JSON.parse(qmis)[2], soldDate: "0001-01-01T00:00:00" }, HOST, new Date("2026-10-20T12:00:00Z"))).toMatchObject({ status: "Quick Move-In (Move-In Ready)" });
  });

  it("reads the market offers from a home page and picks the slide that names a rate, with its disclaimer and without links", () => {
    const offers = parsePulteOffers(homePage)!;
    expect(offers.slides.map((entry) => entry.title)).toEqual(["We’re Proud to Honor Heroes Like You!", "More to Love This Fall", "Builder's Best Pricing Available on Select Quick Move-Ins"]);
    expect(offers.rateOffer).toContain("FHA 30-year fixed rate as low as 4.75% / 5.58% APR");
    expect(offers.rateOffer).toContain("accepted by builder by 10/31/2026");
    expect(offers.rateOffer).toContain("3.5% down payment");
    expect(offers.rateOffer).not.toMatch(/nmlsconsumeraccess|pultemortgage\.com|Licensing information|http|www\.|&copy;|All rights reserved|\[October 2026\]|\bor \.|NMLS/i);
    expect(offers.rateOffer).not.toMatch(/^Disclaimer/);
    expect(parsePulteOffers("<html><body>new layout</body></html>")).toBeNull();
    expect(parsePulteOffers(homePage.replace(/More to Love This Fall[\s\S]*?<\/div><\/div>/, ""))!.rateOffer).toBeNull();
  });
});

describe("PulteGroup reader: a community", () => {
  it("reads the listing and the two inventory endpoints, one offers page an hour per brand, and publishes homes, plans and the rate offer with its facts", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => new Date("2026-10-20T12:00:00Z") });
    expect(result.holdReasons).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.private.homes.map((home) => [home.privateName, home.status, home.price])).toEqual([
      ["13723 Fixture Pass", "Quick Move-In (Move-In Ready)", 274_790],
      ["13727 Fixture Pass", "Quick Move-In (December 2026)", 312_990],
      ["13731 Fixture Pass", "Sold", 257_490],
    ]);
    // The sold-out plan is left out; the others carry a labelled representative image.
    expect(result.private.plans.map((plan) => [plan.privatePlanName, plan.price, plan.gallery?.[0]?.caption ?? null])).toEqual([["Adams", 257_490, "Representative image"], ["Kemp", 251_490, null]]);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 251_490 });
    expect(result.private.incentive?.facts).toMatchObject({ rateKind: "fixed", promotionalRatePercent: 4.75, aprPercent: 5.58, loanType: "FHA", repaymentTermYears: 30, downPaymentPercent: 3.5, contractDeadline: { isoDate: "2026-10-31" }, publishable: true });
    expect(result.public.incentive).toMatchObject({ promotionalRatePercent: 4.75, aprPercent: 5.58, loanType: "FHA", downPaymentPercent: 3.5 });
    expect(requested).toEqual([LISTING, `https://${HOST}/api/plan/qmiplans?communityId=211073`, `https://${HOST}/api/plan/homeplans?communityId=211073`, `https://${HOST}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/livingston-699869/1154490`]);
    // Public output names no builder, lender, street or community.
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "Centex", "Pulte", "78245", "centex.com", "Livingston", "01505"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((home) => home.status)).toEqual(["Quick Move-In (Move-In Ready)", "Quick Move-In (December 2026)", "Sold"]);

    // The gated text names no lender id either.
    expect(JSON.stringify(result.private.incentive?.text)).not.toMatch(/NMLS/i);
    // Within the hour, another community of the brand reuses the listing and the offers: only its own two endpoints are read.
    requested.length = 0;
    const otherId = 211073 + 1;
    site[LISTING] = { body: listing.replace("\"brandName\":\"Pulte\"", "\"brandName\":\"Centex\"").replace(`https://www.pulte.com/homes/texas/san-antonio/san-antonio/fixture-ridge-${otherId}`, `/homes/texas/san-antonio/san-antonio/other-fixture-${otherId}`), type: "application/json" };
    site[`https://${HOST}/api/plan/qmiplans?communityId=${otherId}`] = { body: "[]", type: "application/json" };
    site[`https://${HOST}/api/plan/homeplans?communityId=${otherId}`] = { body: "[]", type: "application/json" };
    const second = await loadOfficialDeals({ ...config, sourceUrl: `https://${HOST}/homes/texas/san-antonio/san-antonio/other-fixture-${otherId}`, privateCommunityName: "Other Fixture" }, { fetcher, now: () => new Date("2026-10-20T12:30:00Z") });
    expect(second.holdReasons).toEqual([]);
    expect(requested).toEqual([`https://${HOST}/api/plan/qmiplans?communityId=${otherId}`, `https://${HOST}/api/plan/homeplans?communityId=${otherId}`]);
    // With no home or plan page of its own to read, the cached brand offer still applies.
    expect(second.private.incentive).not.toBeNull();
    site[LISTING] = { body: listing, type: "application/json; charset=utf-8" };
  });

  it("holds the run for a community the listing no longer carries, a path without an id, another brand's host, an endpoint that changed shape, or a failed read; a failed offers page holds the offer only", async () => {
    expect((await loadOfficialDeals({ ...config, sourceUrl: `https://${HOST}/homes/texas/san-antonio/san-antonio/gone-999999` }, { fetcher })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: `https://${HOST}/homes/texas/san-antonio/san-antonio/` }, { fetcher })).holdReasons).toEqual(["missing_community_guid"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://www.pulte.com/homes/texas/san-antonio/san-antonio/fixture-ridge-211074" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const reshaped = vi.fn(async (input: string) => input.includes("qmiplans") ? new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["invalid_inventory_response"]);
    const foreign = vi.fn(async (input: string) => input.includes("qmiplans") ? new Response(qmis.replace(/"communityId":211073/, "\"communityId\":210296"), { status: 200, headers: { "content-type": "application/json" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: foreign })).holdReasons).toEqual(["invalid_inventory_response"]);
    resetPulteGroupCaches();
    const down = vi.fn(async (input: string) => input.includes("homeplans") ? new Response("down", { status: 503, headers: { "content-type": "text/html" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["inventory_fetch_failed"]);
    resetPulteGroupCaches();
    const noOffers = vi.fn(async (input: string) => /\/(?:livingston|kemp|adams)-/.test(input) ? new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const held = await loadOfficialDeals(config, { fetcher: noOffers });
    expect(held.catalogOk).toBe(true);
    expect(held.incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
    expect(held.public.homes).toHaveLength(3);
    expect(held.public.incentive).toBeNull();
    // The first home's page is gone (sold since): the next home's page is read for the offer instead of holding.
    resetPulteGroupCaches();
    const firstGone = vi.fn(async (input: string) => input.includes("/livingston-") ? new Response("gone", { status: 404, headers: { "content-type": "text/html" } }) : input.includes("/kemp-699939/1155006") ? new Response(homePage, { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const recovered = await loadOfficialDeals(config, { fetcher: firstGone });
    expect(recovered.incentiveHoldReasons).toEqual([]);
    expect(recovered.private.incentive).not.toBeNull();
  });

  it("is three adapters the registry knows, one per brand host", () => {
    expect(new PulteGroupAdapter("Pulte")).toMatchObject({ builder: "Pulte", host: "www.pulte.com" });
    expect(DEAL_ADAPTERS.Centex.builder).toBe("Centex");
    expect(DEAL_ADAPTERS["Del Webb"].builder).toBe("Del Webb");
  });
});
