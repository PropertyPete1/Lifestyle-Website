import { beforeEach, describe, expect, it, vi } from "vitest";
import { CenturyAdapter, centuryStatus, parseCenturyRecords } from "./dealsAdapters.century";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Century Communities community page in the shape the live site
 * served in October 2026: a ProductGroup of the homes for sale, the
 * community's business record, and a card per home with its completion, plan
 * and struck-through price. Names and addresses are invented.
 */
const HOST = "https://www.centurycommunities.com";
const COMMUNITY = `${HOST}/find-your-new-home/texas/san-antonio-metro/san-antonio/fixture-grove/`;
const ld = (record: unknown) => `<script type="application/ld+json">${JSON.stringify(record)}</script>`;
const HOMES = [
  { lot: "15177A", street: "9122 FIXTURE RDG", slug: "15177a-9122-fixture-rdg", price: 267_475, was: 330_880, beds: 3, baths: 2, sqft: 1_388, plan: "Easton - 1388", est: "Dec. Move In." },
  { lot: "19177A", street: "9208 FIXTURE RDG", slug: "19177a-9208-fixture-rdg", price: 314_990, was: null, beds: 4, baths: 2.5, sqft: 2_260, plan: "Frederick - 2260", est: "Move-in Ready!" },
  { lot: "22177A", street: "9220 FIXTURE RDG", slug: "22177a-9220-fixture-rdg", price: 349_990, was: 350_695, beds: 5, baths: 3.5, sqft: 2_511, plan: "Riley - 2511", est: "Jan. Move In." },
];
const variant = (home: typeof HOMES[number]) => ({ "@type": "Product", name: `${home.street}, San Antonio, TX 78222`, description: `${home.beds} beds, ${home.baths} baths, ${home.sqft.toLocaleString("en-US")} sq ft`, sku: `00011204_${home.lot}_CCS`, url: `${COMMUNITY}lots/${home.slug}/`, image: `${HOST}/globalassets/century/assets/elevations--amenities/ccs/ccs-tx/san-antonio/fixture/${home.slug}-01.jpg`, offers: { "@type": "Offer", price: home.price, priceCurrency: "USD", availability: "https://schema.org/InStock", url: `${COMMUNITY}lots/${home.slug}/` } });
const card = (home: typeof HOMES[number]) => `
<div class="card available-lot"><div class="card-img"><img src="${HOST}/globalassets/x/${home.slug}-01.jpg" alt="Front"></div>
<div class="text_content card-body">
  <div class="d-flex align-items-center justify-content-between">
    <h4 class="street-number font-header fw-normal" id="available-lot-name-${home.lot}"><a href="/find-your-new-home/texas/san-antonio-metro/san-antonio/fixture-grove/lots/${home.slug}/"><span class="street-number-text">${home.street} | Lot ${home.lot}</span></a></h4>
    <span class="est-complete-date"><span class="est-date-label">Est. Completion: </span><br>${home.est}</span>
  </div>
  <span class="title"> ${home.plan} </span><p class="home-type"> Single Family Home </p>
  <div class="d-flex justify-content-between align-items-center"><div class="per-month-price prices_container "></div><div class="pricing-wrapper"><div class="starting-price"><span class="start-from"> </span>${home.was ? `<span class="wasPrice">was $${home.was.toLocaleString("en-US")}</span>` : ""}<span class="price"> $${home.price.toLocaleString("en-US")} </span></div></div></div>
  <ul class="specs_contain"><li class="cell"><p><span class="spec-value">${home.sqft.toLocaleString("en-US")}</span><small class="spec-label">sq ft</small></p></li><li class="cell"><p><span class="spec-value">${home.beds}</span><small class="spec-label">beds</small></p></li></ul>
  <div class="button-groups"><a class="btn btn-secondary" href="/buy-online/emailverification2/?sku=00011204_${home.lot}_CCS">Buy Now</a><a class="btn btn-primary" href="/find-your-new-home/texas/san-antonio-metro/san-antonio/fixture-grove/lots/${home.slug}/">View Details</a></div>
</div></div>`;

function communityPage(input: { homes?: typeof HOMES; variants?: typeof HOMES; business?: boolean } = {}) {
  const homes = input.homes ?? HOMES;
  const variants = input.variants ?? homes;
  return `<!DOCTYPE html><html><head><title>Fixture Grove - New Homes - San Antonio | Century Communities</title>
${ld({ "@context": "https://schema.org", "@type": "Organization", name: "Century Communities" })}
${input.business === false ? "" : ld({ "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", "@id": `${COMMUNITY}#community`, name: "Fixture Grove", url: COMMUNITY, telephone: "+1 210-555-0500", address: { "@type": "PostalAddress", streetAddress: "9106 Fixture Rdg", addressLocality: "San Antonio", addressRegion: "TX", postalCode: "78222", addressCountry: "US" }, geo: { "@type": "GeoCoordinates", latitude: 29.33, longitude: -98.4 } })}
${ld({ "@context": "https://schema.org", "@type": "ProductGroup", name: "Fixture Grove", url: COMMUNITY, productGroupID: "Fixture_1", brand: { "@type": "Brand", name: "Century Communities" }, hasVariant: variants.map(variant) })}
</head><body><main>
<h1>Fixture Grove</h1><p>Zoned to East Central ISD. Flexible Tours | Below-Market Rates | Made-for-You Financing Options</p>
<section id="available-homes"><h2>AVAILABLE HOMES</h2>${homes.map(card).join("\n")}</section>
</main></body></html>`;
}

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Century Communities", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Grove", scrubList: ["Fixture Grove", "Fixture Rdg"] };
const NOW = new Date("2026-10-20T12:00:00Z");

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Century Communities reader: records", () => {
  it("reads the homes from the ProductGroup and their completion, plan and price drop from the cards", async () => {
    const records = parseCenturyRecords(communityPage(), "www.centurycommunities.com")!;
    expect(records.community).toMatchObject({ name: "Fixture Grove" });
    expect(records.homes.map((home) => [home.privateAddress, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.gallery?.length])).toEqual([
      ["9122 Fixture Rdg, San Antonio, TX 78222", 267_475, 3, 2, 1_388, 1],
      ["9208 Fixture Rdg, San Antonio, TX 78222", 314_990, 4, 2.5, 2_260, 1],
      ["9220 Fixture Rdg, San Antonio, TX 78222", 349_990, 5, 3.5, 2_511, 1],
    ]);
    expect(parseCenturyRecords("<html><body>new layout</body></html>", "www.centurycommunities.com")).toBeNull();
    // A month without a year is the next such month; "Move-in Ready!" is ready now; other wording has no status.
    expect(centuryStatus("Est. Completion: Dec. Move In.", NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(centuryStatus("Est. Completion: Jan. Move In.", NOW)).toEqual({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    expect(centuryStatus("Est. Completion: Move-in Ready!", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(centuryStatus("Est. Completion: Sold", NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    // In a completion field "pending" is an unknown date, not a sale; an explicit month already past is no date.
    expect(centuryStatus("Est. Completion: Pending", NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    expect(centuryStatus("Est. Completion: Dec. 2025 Move In.", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    // @type given as an array reads the same.
    expect(parseCenturyRecords(communityPage().replace('"@type":"ProductGroup"', '"@type":["ProductGroup","Thing"]').replace('"@type":"HomeAndConstructionBusiness"', '"@type":["HomeAndConstructionBusiness","LocalBusiness"]'), "www.centurycommunities.com")!.homes).toHaveLength(3);
    expect(centuryStatus("Est. Completion: TBD", NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    expect(centuryStatus(null, NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes.map((home) => [home.privateName, home.privatePlanName, home.status, home.previousPrice, home.priceDrop])).toEqual([
      ["9122 Fixture Rdg", "Easton", "Quick Move-In (December 2026)", 330_880, 63_405],
      ["9208 Fixture Rdg", "Frederick", "Quick Move-In (Move-In Ready)", null, null],
      ["9220 Fixture Rdg", "Riley", "Quick Move-In (January 2027)", 350_695, 705],
    ]);
    expect(result.private.communityFacts).toMatchObject({ schoolDistrict: "East Central ISD" });
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78222", "centurycommunities", "Century", "Easton", "15177"]) expect(json).not.toContain(secret);
  });

  it("holds the run when the page is not a community page, when cards outnumber records, when a card has no completion, when the site is not Century's, or when it cannot be read", async () => {
    const reshaped = vi.fn(async () => new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noBusiness = vi.fn(async () => new Response(communityPage({ business: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noBusiness })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // Records changed shape (one dropped) while the cards still show three homes: never a sale.
    const fewerRecords = vi.fn(async () => new Response(communityPage({ variants: HOMES.slice(0, 2) }), { status: 200, headers: { "content-type": "text/html" } }));
    const held = await loadOfficialDeals(config, { fetcher: fewerRecords });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    // A variant of another community on the host is not this community's inventory.
    const nearby = JSON.stringify(variant({ ...HOMES[0]!, slug: "7a-1-other-way", street: "1 OTHER WAY" })).replace(/fixture-grove\/lots/g, "other-grove/lots");
    const otherCommunity = vi.fn(async () => new Response(communityPage().replace('"hasVariant":[', `"hasVariant":[${nearby},`), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: otherCommunity })).holdReasons).toEqual(["invalid_inventory_response"]);
    // The photo linked before the heading: the plan and the previous price still come from the home's own card, never a neighbour's.
    const photoFirst = communityPage().replace(/<div class="card-img"><img src="([^"]+)" alt="Front"><\/div>/g, (_match, src: string) => `<div class="card-img"><a href="${src.includes("9208") ? "/find-your-new-home/texas/san-antonio-metro/san-antonio/fixture-grove/lots/19177a-9208-fixture-rdg/" : "/x/"}"><img src="${src}" alt="Front"></a></div>`).replace('<span class="title"> Frederick - 2260 </span>', "");
    const linkedPhoto = vi.fn(async () => new Response(photoFirst, { status: 200, headers: { "content-type": "text/html" } }));
    const own = await loadOfficialDeals(config, { fetcher: linkedPhoto, now: () => NOW });
    expect(own.private.homes.map((home) => [home.privatePlanName, home.previousPrice])).toEqual([["Easton", 330_880], [null, null], ["Riley", 350_695]]);
    // A card without its completion: the home has no status, so the sync holds the run.
    const noEst = vi.fn(async () => new Response(communityPage().replace(/<span class="est-complete-date">[\s\S]*?Move In\.<\/span>/, ""), { status: 200, headers: { "content-type": "text/html" } }));
    const unlabelled = await loadOfficialDeals(config, { fetcher: noEst, now: () => NOW });
    expect(unlabelled.private.homes.some((home) => home.status === null)).toBe(true);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://centurycommunities.com/find-your-new-home/texas/san-antonio-metro/san-antonio/fixture-grove/" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new CenturyAdapter().builder).toBe("Century Communities");
    expect(DEAL_ADAPTERS["Century Communities"].builder).toBe("Century Communities");
  });
});
