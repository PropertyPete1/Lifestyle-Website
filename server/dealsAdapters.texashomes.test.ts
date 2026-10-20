import { beforeEach, describe, expect, it, vi } from "vitest";
import { TexasHomesAdapter, parseTexasHomesCommunity, parseTexasHomesHomePage, parseTexasHomesListing, parseTexasHomesPromo, resetTexasHomesCaches, texasHomesHomesUrl, texasHomesListingEntries, texasHomesListingUrl, texasHomesMenuCount, texasHomesRecord, texasHomesStatus } from "./dealsAdapters.texashomes";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";
import { normalizedDealSourceKey } from "../shared/deals";

/**
 * Synthetic Texas Homes pages in the shape the live site served in October
 * 2026: the Drupal community page with its plan teasers and sales address,
 * the filtered quick move-in list, the home page with the site menu and the
 * promotion, and the campaign page. Names and addresses are invented.
 */
const HOST = "https://www.texas-homes.com";
const COMMUNITY = `${HOST}/fixture-acres`;
const PROMO = `${HOST}/fixture-flex-cash`;
const ID = 466;
const NOW = new Date("2026-10-20T15:00:00Z");

const features = (values: Record<string, string>) => `<div class="plan-features-container">${Object.entries(values).map(([token, value]) => `<div class="features-single-container ${token}"><i class="fas fa-home"></i> <span class="features-label">${token}: </span> <span class="features-content">${value}</span></div>`).join(" ")}</div>`;
const menu = (rows: Array<[string, string, number | null]> = [["Fixture Acres", "/fixture-acres", 4], ["Fixture Grove", "/fixture-grove", 7], ["Far Fixture", "/far-fixture", 1]]) => `<nav class="main-menu"><div class="views-element-container"><div class="views-row"><div class="views-field views-field-title"><span class="field-content"><a href="/build-on-your-lot" class="main-menu-main-link"><span class="main-menu-title-link">Build On Your Lot</span></a></span></div></div>${rows.map(([name, path, count]) => `<div class="views-row"><div class="views-field views-field-title"><span class="field-content"><a href="${path}" class="main-menu-main-link"><span class="main-menu-title-link">${name}</span><span class="views-field-field-link-sub-title">Castroville, TX | One-Acre Estate Homes</span></a></span></div>${count === null ? "" : `<div class="views-field views-field-nid"><span class="field-content"><a class="neighborhood-menu-mir--link" href="/move-in-ready?field_neighborhood_target_id=${path === "/fixture-acres" ? ID : 999}"><span class="menu-mir-count">${count}</span><span class="menu-mir-available">View Quick Move-In Homes</span></a></span></div>`}</div>`).join("")}<div class="views-row"><a href="/move-in-ready" class="main-menu-main-link">View All Quick Move-In Homes</a></div></div></nav>`;
const planTeaser = (name: string, price: string | null, href = `/fixture-acres/${name.toLowerCase().replace(/\s+/g, "-")}`, neighborhoodId = ID) => `<div class="views-row"><div class="plan-teaser"><div><div class="plan-teaser-left"><h2><a href="${href}" rel="bookmark"><span>${name}</span></a></h2>${price ? `<div class="plan-teaser-price-label price"><div class="teaser-price-label">Starting from</div><div class="teaser-price">${price}</div></div>` : ""}<div><div class="field field--name-field-main-elevation field--type-image field--label-hidden field__item"><img loading="lazy" src="/sites/default/files/2022-12/${name.replace(/\s+/g, "")}C.jpg" width="1800" height="1350" alt="Exterior Elevation"></div></div></div><div class="plan-teaser-right">${features({ stories: "1", sqft: "3245 to 3550", beds: "3 to 4", baths: "2", garage: "3", "half-baths": "1" })}<div class="highlights-container"><a class="highlights-virtual-builder" target="_blank" href="https://texas-homes.blu-plan.com/plan/3245_1">Floorplan Designer</a><a class="highlights-smart" href="/sites/default/files/2021-07/Home%20Automation.pdf">Smart Home</a><div class="home-count"><span class="home-count-number">1</span> <a href="/move-in-ready-plan?neighborhood_id=${neighborhoodId}&amp;plan_id=470&amp;name=Fixture Acres">Quick Move-In Homes</a></div></div><div class="plan-teaser-left-bottom"><a class="solid-cta" href="${href}" rel="bookmark">View Plan and Details</a></div></div></div></div></div>`;
type PageInput = { name?: string; address?: string | null; geo?: string | null; mirLink?: string | null; plans?: string[]; menuRows?: Array<[string, string, number | null]>; logo?: string | null };
function communityPage(input: PageInput = {}) {
  const name = input.name ?? "Fixture Acres";
  const address = input.address === undefined ? "241 Fixture Loop, Castroville, TX, 78009" : input.address;
  const mir = input.mirLink === undefined ? `/move-in-ready?field_neighborhood_target_id=${ID}` : input.mirLink;
  return `<!DOCTYPE html><html><head><title>New Homes in Castroville, TX | ${name} Homes for Sale</title><link rel="canonical" href="${COMMUNITY}" /></head><body><div class="dialog-off-canvas-main-canvas"><header>${menu(input.menuRows)}</header><main>
<article data-history-node-id="466" about="/fixture-acres"><div class="neighborhood-top">${input.logo === null ? "" : `<div class="field field--name-field-logo field--type-image"><img src="${input.logo ?? "/sites/default/files/2021-07/fixture-acres-logo.png"}" alt="${name}"></div>`}<h1><span>${name}</span></h1><div class="field field--name-field-description-short field--type-text-long field--label-hidden field__item"><ul><li>Beautiful One-Acre Homesites</li><li>Gated Community</li></ul></div><div class="field field--name-field-geolocation field--type-geolocation field--label-hidden field__item"><div class="geolocation-map-wrapper" id="map-1" data-map-type="google_maps"><div class="geolocation-map-controls"><div class="geolocation-map-control control_locate">Locate</div></div><div class="geolocation-map-container js-show"><div class="geolocation-location js-hide" data-lat="29.4293913" data-lng="-98.8569532"><div class="location-title">${input.geo === undefined ? "29.4293913, -98.8569532" : input.geo ?? ""}</div></div></div></div></div></div>
<div class="neighborhood-left"><div class="field field--name-field-description"><p>${name} is nestled in the Texas Hill Country, zoned to Medina Valley ISD. Homes start from the $650s.</p></div><a href="/sites/default/files/2025-07/Features.pdf">Download Feature Sheet</a>${mir ? `<a href="${mir}">Quick Move-In Homes in <span>${name}</span></a>` : ""}</div>
<div class="neighborhood-right"><div><article data-history-node-id="511" about="/sales-person"><div class="contact-teaser"><div><h3><span>A. Person</span></h3><div class="contact-title"><div class="field field--name-field-title">Sales Manager</div></div></div><a class="contact-phone" href="tel:210-555-0142"><div class="field field--name-field-phone">210-555-0142</div></a><a class="contact-text" href="/text-agent?community_hidden&amp;agent=A.%20Person&amp;agent_id=511">Send a Text</a></div></article></div><div class="model-home-hours">${address === null ? "" : `<div class="sales-address-link"><p><strong>Model Home</strong></p><p><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(address).replace(/%20/g, "+")}" target="_blank" rel="noopener">${address.split(", ").slice(0, -3).join(", ")}<br>${address.split(", ").slice(-3).join(", ")}</a></p></div>`}<div class="field field--name-field-model-home-hours"><p><em>From 1604 go West on Potranco Rd.</em></p><p><strong>MODEL HOME HOURS:</strong></p><p>Tue-Sat: 10 AM to 6 PM</p></div></div></div></article>
<div class="susy-container"><div id="see-plans"></div><div class="view-plans">${(input.plans ?? [planTeaser("Plan 2568", "$657,990"), planTeaser("Plan 3245", "$755,990"), planTeaser("Plan 4408", null)]).join("")}</div></div>
<div class="promo-view js-view-dom-id-abc"> </div></main><footer><p>© 2026 Texas Homes. All rights reserved.</p></footer></div></body></html>`;
}
type Row = { street: string; status: string | null; valued: string; now?: string; sold?: boolean; href?: string; photos?: string[]; logo?: string; noDate?: boolean };
const row = (home: Row) => {
  const href = home.href ?? `/move-in-ready/${home.street.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const photos = home.photos ?? [`/sites/default/files/styles/neighborhood_teaser/public/2026-02/${home.street.replace(/\s+/g, "")}-1.jpg?itok=Sdcc9QDp`, `/sites/default/files/styles/neighborhood_teaser/public/2026-02/${home.street.replace(/\s+/g, "")}-2.jpg?itok=PmOH6y8X`];
  return `<div class="views-row"><article data-history-node-id="650" about="${href}"><div class="mir-teaser"><div><div class="single-elevation-image ${home.now ? "mir-teaser-reduced" : ""} ${home.sold ? "mir-teaser-sold" : ""}"><div class="field field--name-field-images field--type-image field--label-hidden field__items"><div class="flexslider"><ul class="slides">${photos.map((src) => `<li><img loading="lazy" src="${src}" width="640" height="460" alt="exterior"></li>`).join("")}</ul></div></div>${home.sold ? `<div class="sold">SOLD</div>` : ""}</div><h3><a href="${href}"><span>${home.street}</span></a></h3><div class="mir-teaser-bottom"><div class="mir-teaser-bottom-left">${features({ stories: "1", sqft: "2674", beds: "3", baths: "3", garage: "3", mls: "1948201" })}${home.sold ? "" : home.now ? `<div class="mir-teaser-reduced-price"><div class="mir-price"><div class="mir-price-inner"><span class="mir-price-label">Valued at: </span><span class="mir-price-teaser">${home.valued}<img class="squig-teaser" src="/themes/custom/digett_atomic/images/squig1.svg"></span></div></div><div class="reduced-price-teaser">Now: ${home.now}</div></div>` : `<div class="mir-price"><span class="mir-price-label">Valued at: </span><span>${home.valued}</span></div>`}${home.status === null || home.noDate ? "" : `<div class="mir-date"><span class="mir-date-label">Available </span><span>${home.status}</span></div>`}</div><div class="mir-teaser-bottom-right"><img src="${home.logo ?? `${HOST}/sites/default/files/2021-07/fixture-acres-logo.png`}"></div></div></div></div></article></div>`;
};
const ROWS: Row[] = [
  { street: "159 Fixture Lane", status: "Move In Ready Now", valued: "$739,737", now: "$719,737" },
  { street: "399 Fixture Way", status: "November 2026", valued: "$827,999", now: "$789,777" },
  { street: "241 Fixture Loop", status: "Ready Now!", valued: "$823,422" },
  { street: "497 Fixture Way", status: "", valued: "$892,301" },
  { street: "398 Fixture Loop", status: null, valued: "", sold: true },
];
const listPage = (rows: Row[] = ROWS, pager = false, selected: number | null = ID) => `<!DOCTYPE html><html><head><title>Quick Move-Ins | Texas Homes</title></head><body>${menu()}<main><h1>Quick Move-Ins</h1><div class="views-element-container"><div class="mir-view js-view-dom-id-1"><form class="views-exposed-form" action="/move-in-ready" method="get"><select name="field_mir_price_value"><option value="">Select Starting Price</option></select>${selected === null ? "" : `<select name="field_neighborhood_target_id"><option value="All">- Any -</option><option value="999">Fixture Grove</option><option value="${selected}" selected="selected">Fixture Acres</option></select>`}</form><div class="view-content">${rows.map(row).join("")}</div>${pager ? `<nav class="pager" role="navigation"><ul class="pager__items js-pager__items"><li class="pager__item pager__item--next"><a href="?field_neighborhood_target_id=466&amp;page=1">Next</a></li></ul></nav>` : ""}</div></div></main></body></html>`;
const homePage = (promo = true) => `<!DOCTYPE html><html><head><title>Texas Homes</title></head><body>${menu()}<main><div class="field field--name-field-wysiwyg field--type-text-long field--label-hidden field__item"><h1>Texas Homes</h1><p>Beautiful New Homes in San Antonio.</p></div>${promo ? `<div class="field field--name-field-wysiwyg field--type-text-long field--label-hidden field__item"><h2>4.99% 30-year fixed FHA/VA</h2></div><div class="field field--name-field-wysiwyg field--type-text-long field--label-hidden field__item"><a class="white-cta" href="/fixture-flex-cash">Learn More</a> <!--<a class="white-border-cta">Contact Us</a>--></div>` : ""}<div class="field field--name-field-wysiwyg field--type-text-long field--label-hidden field__item"><h2>Why Texas Homes?</h2><a href="/why-texas-homes">Learn More</a></div></main></body></html>`;
const promoPage = (footnote: string | null = "*A 4.99% interest rate (5.75% Annual Percentage Rate) is available for qualifying FHA or VA 30-year fixed-rate financing on select quick move-in homes in the San Antonio area. Financing is available only through Texas Homes' preferred lender, CMG Mortgage, Inc. dba CMG Home Loans, NMLS ID #1820, and is subject to Texas Homes' management approval. Buyers may also receive up to $7,000 toward eligible closing costs. Valid only on new contracts written between September 4 and September 30, 2026. Homes must close by October 31, 2026. Call 210-555-0142 or see www.texas-homes.com for details.") => `<!DOCTYPE html><html><head><title>Choose It &amp; Use It Flex Cash</title><link rel="canonical" href="${PROMO}" /></head><body>${menu()}<main><div class="field field--name-field-wysiwyg"><h1 class="text-align-center"><strong>CHOOSE IT &amp; USE IT FLEX CASH</strong></h1><h3>Incentive Programs Designed to Best Suit You</h3></div><div class="field field--name-field-wysiwyg"><h2>4.99% fixed rate FHA/VA financing or Up to $50,000 in Customized Incentives*</h2><p>Whether you want to lower your monthly payments with a rate buy-down, reduce closing costs, or use your flex cash towards home upgrades - we can tailor an incentive package just for you.</p></div><div class="field field--name-field-wysiwyg"><h3>Rate Buy Down</h3><p>Save money on your monthly payment.</p></div><form><input name="first_name"></form>${footnote === null ? "" : `<div class="field field--name-field-wysiwyg">${footnote}</div>`}</main></body></html>`;

const site: Record<string, string> = { [COMMUNITY]: communityPage(), [texasHomesHomesUrl(ID)]: listPage(), [texasHomesListingUrl()]: homePage(), [PROMO]: promoPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Texas Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Acres", scrubList: ["Fixture Acres", "Fixture Loop", "Fixture Way", "Fixture Lane"] };
const withPage = (page: string, overrides: Record<string, string | null> = {}) => vi.fn(async (input: string) => {
  const body = input === COMMUNITY ? page : (input in overrides ? overrides[input] : site[input]);
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const load = (page: string, overrides: Record<string, string | null> = {}) => { resetTexasHomesCaches(); return loadOfficialDeals(config, { fetcher: withPage(page, overrides), now: () => NOW }); };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; resetTexasHomesCaches(); });

describe("Texas Homes reader: statuses", () => {
  it("reads ready-now wording, a month (a passed one undated), no wording as an undated quick move-in, sold, and holds on other wording", () => {
    for (const label of ["Move In Ready Now", "Available Move In Ready", "Ready Now!", "Ready Now", "Available Now"]) expect(texasHomesStatus(label, false, NOW), label).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(texasHomesStatus("Available November 2026", false, NOW)).toEqual({ status: "Quick Move-In (November 2026)", readyNow: false, moveInDate: "November 2026" });
    expect(texasHomesStatus("February 2027", false, NOW)).toEqual({ status: "Quick Move-In (February 2027)", readyNow: false, moveInDate: "February 2027" });
    expect(texasHomesStatus("September 2026", false, NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(texasHomesStatus("October 2026", false, NOW)).toEqual({ status: "Quick Move-In (October 2026)", readyNow: false, moveInDate: "October 2026" });
    expect(texasHomesStatus("Available", false, NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(texasHomesStatus(null, false, NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(texasHomesStatus("Available November 2026", true, NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    expect(texasHomesStatus("Under Contract", false, NOW)).toMatchObject({ status: "Sold" });
    for (const label of ["Coming Soon", "Model", "Octember 2026", "November 2099", "Reserved"]) expect(texasHomesStatus(label, false, NOW).status, label).toBeNull();
  });
});

describe("Texas Homes reader: community page", () => {
  it("reads the name, sales address (from the maps query), pin, phone, the quick move-in list id, the plans (ranges at their low end, baths with halves, elevation photo) and the menu count", () => {
    const page = parseTexasHomesCommunity(communityPage(), COMMUNITY)!;
    expect(page.record).toEqual({ name: "Fixture Acres", street: "241 Fixture Loop", city: "Castroville", zip: "78009", phone: "2105550142", priceFrom: 657_990, geo: { lat: 29.4293913, lng: -98.8569532 } });
    expect(page).toMatchObject({ neighborhoodId: ID, foreignPlan: false, hasRecord: true });
    expect(page.plans.map((plan) => [plan.sourceUrl, plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.garage, plan.gallery?.map((image) => image.sourceUrl)])).toEqual([
      [`${COMMUNITY}/plan-2568`, "Plan 2568", 657_990, 3, 2.5, 3_245, 3, [`${HOST}/sites/default/files/2022-12/Plan2568C.jpg`]],
      [`${COMMUNITY}/plan-3245`, "Plan 3245", 755_990, 3, 2.5, 3_245, 3, [`${HOST}/sites/default/files/2022-12/Plan3245C.jpg`]],
      [`${COMMUNITY}/plan-4408`, "Plan 4408", null, 3, 2.5, 3_245, 3, [`${HOST}/sites/default/files/2022-12/Plan4408C.jpg`]],
    ]);
    expect(texasHomesMenuCount(communityPage(), "/fixture-acres")).toBe(4);
    expect(texasHomesMenuCount(communityPage(), "/fixture-grove/")).toBe(7);
    expect(texasHomesMenuCount(communityPage(), "/nowhere")).toBeNull();
    expect(texasHomesMenuCount(communityPage({ menuRows: [["Fixture Acres", "/fixture-acres", null]] }), "/fixture-acres")).toBeNull();
    expect(texasHomesRecord(communityPage(), COMMUNITY)).toMatchObject({ name: "Fixture Acres", street: "241 Fixture Loop" });
  });

  it("reads a page without the address or list link, falls back to the link's text, and flags plans under another page or neighborhood id", () => {
    expect(parseTexasHomesCommunity(communityPage({ address: null }), COMMUNITY)).toMatchObject({ record: { street: null, city: null, zip: null, geo: { lat: 29.4293913, lng: -98.8569532 } }, hasRecord: true });
    expect(parseTexasHomesCommunity(communityPage({ address: null, geo: null }), COMMUNITY)).toMatchObject({ record: { street: null, geo: null }, hasRecord: true });
    expect(parseTexasHomesCommunity(communityPage({ mirLink: null }), COMMUNITY)).toMatchObject({ neighborhoodId: null });
    const textOnly = communityPage().replace(/href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=[^"]+"/, `href="https://maps.google.com/"`);
    expect(parseTexasHomesCommunity(textOnly, COMMUNITY)!.record).toMatchObject({ street: "241 Fixture Loop", city: "Castroville", zip: "78009" });
    expect(parseTexasHomesCommunity(communityPage({ address: "241 Fixture Loop, Castroville, TX 78009" }), COMMUNITY)!.record).toMatchObject({ street: "241 Fixture Loop", city: "Castroville", zip: "78009" });
    expect(parseTexasHomesCommunity(communityPage(), COMMUNITY)).toMatchObject({ logo: "/sites/default/files/2021-07/fixture-acres-logo.png" });
    expect(parseTexasHomesCommunity(communityPage({ logo: null }), COMMUNITY)).toMatchObject({ logo: null });
    expect(parseTexasHomesCommunity(communityPage({ plans: [planTeaser("Plan 1592", "$1", "/fixture-grove/plan-1592")] }), COMMUNITY)).toMatchObject({ foreignPlan: true, plans: [] });
    expect(parseTexasHomesCommunity(communityPage({ plans: [planTeaser("Plan 1592", "$1", undefined, 999)] }), COMMUNITY)).toMatchObject({ foreignPlan: true });
    expect(parseTexasHomesCommunity("<html><body><p>new layout</p></body></html>", COMMUNITY)).toBeNull();
    expect(texasHomesRecord(`<html><body>${menu()}<h1>About Texas Homes</h1><p>Our story.</p></body></html>`, `${HOST}/about-texas-homes`)).toBeNull();
  });
});

describe("Texas Homes reader: quick move-in list", () => {
  it("reads each row (street, status, price with a cut as the previous price, specs, photos as originals), sold rows and the pager", () => {
    const listing = parseTexasHomesListing(listPage(), texasHomesHomesUrl(ID), NOW, "Castroville, TX 78009", "/sites/default/files/2021-07/fixture-acres-logo.png")!;
    expect(listing).toMatchObject({ hasPager: false, foreignHome: false, selectedNeighborhoodId: ID, available: 4 });
    expect(listing.homes.map((home) => [home.sourceUrl, home.privateAddress, home.status, home.readyNow, home.moveInDate, home.price, home.previousPrice, home.bedrooms, home.bathrooms, home.squareFeet, home.garage, home.gallery?.length])).toEqual([
      [`${HOST}/move-in-ready/159-fixture-lane`, "159 Fixture Lane, Castroville, TX 78009", "Quick Move-In (Move-In Ready)", true, null, 719_737, 739_737, 3, 3, 2_674, 3, 2],
      [`${HOST}/move-in-ready/399-fixture-way`, "399 Fixture Way, Castroville, TX 78009", "Quick Move-In (November 2026)", false, "November 2026", 789_777, 827_999, 3, 3, 2_674, 3, 2],
      [`${HOST}/move-in-ready/241-fixture-loop`, "241 Fixture Loop, Castroville, TX 78009", "Quick Move-In (Move-In Ready)", true, null, 823_422, null, 3, 3, 2_674, 3, 2],
      [`${HOST}/move-in-ready/497-fixture-way`, "497 Fixture Way, Castroville, TX 78009", "Quick Move-In", false, null, 892_301, null, 3, 3, 2_674, 3, 2],
      [`${HOST}/move-in-ready/398-fixture-loop`, "398 Fixture Loop, Castroville, TX 78009", "Sold", false, null, null, null, 3, 3, 2_674, 3, 2],
    ]);
    expect(listing.homes[0]!.gallery![0]!.sourceUrl).toBe(`${HOST}/sites/default/files/2026-02/159FixtureLane-1.jpg`);
    expect(new Set(listing.homes.map((home) => normalizedDealSourceKey(home.sourceUrl))).size).toBe(5);
    expect(parseTexasHomesListing(listPage(ROWS, true), texasHomesHomesUrl(ID), NOW, "TX")).toMatchObject({ hasPager: true });
    expect(parseTexasHomesListing(listPage([{ ...ROWS[0]!, href: "https://evil.example/move-in-ready/x" }]), texasHomesHomesUrl(ID), NOW, "TX")).toMatchObject({ foreignHome: true, homes: [] });
    expect(parseTexasHomesListing(listPage([{ ...ROWS[0]!, href: "/fixture-acres/plan-2568" }]), texasHomesHomesUrl(ID), NOW, "TX")).toMatchObject({ foreignHome: true });
    expect(parseTexasHomesListing(listPage([{ ...ROWS[0]!, photos: ["https://evil.example/a.jpg", "/themes/custom/x/logo.png", "/sites/default/files/2026-02/plan-floorplan.jpg"] }]), texasHomesHomesUrl(ID), NOW, "TX")!.homes[0]!.gallery).toEqual([]);
    expect(parseTexasHomesListing("<html><body><h1>Quick Move-Ins</h1><p>new layout</p></body></html>", texasHomesHomesUrl(ID), NOW, "TX")).toBeNull();
    // A row carrying another community's logo is not this community's; without a logo to check, rows are taken as the filter gives them.
    expect(parseTexasHomesListing(listPage([ROWS[0]!, { ...ROWS[1]!, logo: `${HOST}/sites/default/files/2024-05/fixture-grove-logo.png` }]), texasHomesHomesUrl(ID), NOW, "TX", "/sites/default/files/2021-07/fixture-acres-logo.png")).toMatchObject({ foreignHome: true, available: 1 });
    expect(parseTexasHomesListing(listPage([ROWS[0]!, { ...ROWS[1]!, logo: `${HOST}/sites/default/files/2024-05/fixture-grove-logo.png` }]), texasHomesHomesUrl(ID), NOW, "TX", null)).toMatchObject({ foreignHome: false, available: 2 });
    expect(parseTexasHomesListing(listPage(ROWS, false, null), texasHomesHomesUrl(ID), NOW, "TX")).toMatchObject({ selectedNeighborhoodId: null });
    // A row with no availability element at all has no status (held), where a blank one is an undated quick move-in.
    expect(parseTexasHomesListing(listPage([{ ...ROWS[0]!, noDate: true }]), texasHomesHomesUrl(ID), NOW, "TX")!.homes[0]!.status).toBeNull();
  });
});

describe("Texas Homes reader: home page and promotion", () => {
  it("reads the menu's community links and the campaign page after the rate heading; the campaign page's heading and footnote are the offer", () => {
    expect(parseTexasHomesHomePage(homePage(), "www.texas-homes.com")).toEqual({ communityUrls: [`${HOST}/build-on-your-lot`, `${HOST}/fixture-acres`, `${HOST}/fixture-grove`, `${HOST}/far-fixture`, `${HOST}/move-in-ready`], promoUrl: PROMO });
    expect(parseTexasHomesHomePage(homePage(false), "www.texas-homes.com")).toMatchObject({ promoUrl: null });
    // A marketing line naming a bare figure, followed by a story link, is not the promotion.
    expect(parseTexasHomesHomePage(homePage(false).replace("<h1>Texas Homes</h1>", `<h1>Texas Homes</h1><p>Homes from $300,000 in the Hill Country.</p></div><div class="field field--name-field-wysiwyg"><a href="/why-texas-homes">Our story</a></div><div class="field field--name-field-wysiwyg"><p>`), "www.texas-homes.com")).toMatchObject({ promoUrl: null });
    expect(parseTexasHomesPromo(`<html><body><div class="field field--name-field-wysiwyg"><h2>100% Committed to Quality</h2></div><div class="field field--name-field-wysiwyg">*Pictures are representative.</div></body></html>`)).toBeNull();
    expect(parseTexasHomesHomePage("<html><body>new layout</body></html>", "www.texas-homes.com")).toBeNull();
    expect(texasHomesListingEntries(homePage(), "www.texas-homes.com")!.map((entry) => entry.url)).toContain(COMMUNITY);
    const text = parseTexasHomesPromo(promoPage())!;
    expect(text).toBe("4.99% fixed rate FHA/VA financing or Up to $50,000 in Customized Incentives. A 4.99% interest rate (5.75% Annual Percentage Rate) is available for qualifying FHA or VA 30-year fixed-rate financing on select quick move-in homes in the San Antonio area. Financing is available only through Texas Homes' preferred lender, CMG Mortgage, Inc. dba CMG Home Loans, and is subject to Texas Homes' management approval. Buyers may also receive up to $7,000 toward eligible closing costs. Valid only on new contracts written between September 4 and September 30, 2026. Homes must close by October 31, 2026. Call or see for details.");
    expect(text).not.toMatch(/buy-down|NMLS|1820|555|texas-homes\.com/);
    expect(parseTexasHomesPromo(promoPage(null))).toContain("4.99% fixed rate");
    expect(parseTexasHomesPromo("<html><body><h1>Choose It</h1><p>Call us.</p></body></html>")).toBeNull();
  });
});

describe("Texas Homes reader: adapter", () => {
  it("is registered under its builder id", () => {
    expect(DEAL_ADAPTERS["Texas Homes"]).toBeInstanceOf(TexasHomesAdapter);
    expect(DEAL_ADAPTERS["Texas Homes"].builder).toBe("Texas Homes");
  });

  it("publishes the list's homes (sold rows marked sold), the page's plans, the facts and the site-wide offer; the home page and campaign page are read once per run", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(requested).toEqual([COMMUNITY, texasHomesHomesUrl(ID), texasHomesListingUrl(), PROMO]);
    expect(result.private.homes.map((home) => [home.privateName, home.status, home.price, home.previousPrice])).toEqual([["159 Fixture Lane", "Quick Move-In (Move-In Ready)", 719_737, 739_737], ["399 Fixture Way", "Quick Move-In (November 2026)", 789_777, 827_999], ["241 Fixture Loop", "Quick Move-In (Move-In Ready)", 823_422, null], ["497 Fixture Way", "Quick Move-In", 892_301, null], ["398 Fixture Loop", "Sold", null, null]]);
    expect(result.private.plans.map((plan) => plan.privatePlanName)).toEqual(["Plan 2568", "Plan 3245", "Plan 4408"]);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 657_990, schoolDistrict: "Medina Valley ISD" });
    expect(result.private.incentive?.sourceUrl).toBe(COMMUNITY);
    expect(result.private.incentive?.facts).toMatchObject({ rateKind: "fixed", promotionalRatePercent: 4.99, aprPercent: 5.75, loanType: "FHA", repaymentTermYears: 30, closingDeadline: { isoDate: "2026-10-31" }, contractDeadline: { isoDate: "2026-09-30" } });
    // The footnote names no down payment, so the offer (not the catalog) waits for a look.
    expect(result.holdReasons).toEqual(["missing_down_payment"]);
    expect(result.private.pages.map((page) => page.kind)).toEqual(["community", "inventory", "home", "home", "home", "home", "home", "plan", "plan", "plan", "incentive"]);
    expect(result.public.homes).toHaveLength(5);
    expect(result.public.plans).toHaveLength(3);
    expect(JSON.stringify(result.public)).not.toMatch(/Fixture|1948201|555-0142|texas-homes|A\. Person/);
    requested.length = 0;
    const again = await loadOfficialDeals({ ...config, sourceUrl: `${HOST}/fixture-grove`, privateCommunityName: "Fixture Grove" }, { fetcher: withPage("", { [`${HOST}/fixture-grove`]: communityPage({ name: "Fixture Grove", mirLink: null, menuRows: [["Fixture Grove", "/fixture-grove", 0]], plans: [planTeaser("Plan 1592", "$401,990", "/fixture-grove/plan-1592")] }) }), now: () => NOW });
    expect(again.catalogOk).toBe(true);
    expect(again.private.homes).toEqual([]);
    expect(again.private.incentive?.text).toContain("4.99%");
  });

  it("publishes nothing for a community whose page links no list and whose menu row counts none", async () => {
    const result = await load(communityPage({ mirLink: null, menuRows: [["Fixture Acres", "/fixture-acres", null]] }));
    expect(result.catalogOk).toBe(true);
    expect(result.private.homes).toEqual([]);
    expect(result.private.plans).toHaveLength(3);
  });

  it("holds when the page is not a community page, when a plan is another community's, when the list is missing, paged, foreign or shorter than the menu count, and when the menu counts homes the page does not link", async () => {
    expect((await load("<html><body>new layout</body></html>")).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ address: null, geo: null }).replace(/field--name-field-geolocation/g, "x").replace(/sales-address-link/g, "y"))).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ plans: [planTeaser("Plan 1592", "$1", "/fixture-grove/plan-1592")] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ plans: [planTeaser("Plan 1592", "$1", undefined, 999)] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage(), { [texasHomesHomesUrl(ID)]: null })).holdReasons).toEqual(["community_fetch_failed"]);
    expect((await load(communityPage(), { [texasHomesHomesUrl(ID)]: "<html><body>new layout</body></html>" })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage(), { [texasHomesHomesUrl(ID)]: listPage(ROWS, true) })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load(communityPage(), { [texasHomesHomesUrl(ID)]: listPage(ROWS.slice(0, 3)) })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load(communityPage(), { [texasHomesHomesUrl(ID)]: listPage([{ ...ROWS[0]!, href: "https://evil.example/move-in-ready/x" }]) })).holdReasons).toEqual(["invalid_inventory_response"]);
    // An unfiltered answer (rows with another community's logo, a filter set to another id, or more homes for sale than the menu counts) is never this community's list.
    expect((await load(communityPage(), { [texasHomesHomesUrl(ID)]: listPage([...ROWS, { ...ROWS[0]!, street: "100 Grove Trail", logo: `${HOST}/sites/default/files/2024-05/fixture-grove-logo.png` }]) })).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage(), { [texasHomesHomesUrl(ID)]: listPage(ROWS, false, 999) })).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ logo: null }), { [texasHomesHomesUrl(ID)]: listPage([...ROWS, ...Array.from({ length: 5 }, (_, index) => ({ ...ROWS[2]!, street: `${200 + index} Fixture Loop` }))], false, null) })).holdReasons).toEqual(["invalid_inventory_response"]);
    // A row with no availability element holds through the sync's status rule.
    const dateless = await load(communityPage(), { [texasHomesHomesUrl(ID)]: listPage(ROWS.map((row) => ({ ...row, noDate: true }))) });
    expect(dateless.catalogOk).toBe(true);
    expect(dateless.private.homes.filter((home) => home.status === null)).toHaveLength(4);
    expect((await load(communityPage({ mirLink: null }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A row with wording the reader does not know holds through the sync's status rule; the offer page failing holds the offer only.
    const unknown = await load(communityPage(), { [texasHomesHomesUrl(ID)]: listPage([...ROWS.slice(0, 3), { street: "9 Fixture Way", status: "Reserved", valued: "$1" }, ROWS[4]!]) });
    expect(unknown.catalogOk).toBe(true);
    expect(unknown.private.homes.find((home) => home.privateName === "9 Fixture Way")?.status).toBeNull();
    const noHome = await load(communityPage(), { [texasHomesListingUrl()]: null });
    expect(noHome.catalogOk).toBe(true);
    expect(noHome.incentiveHoldReasons).toEqual(["incentive_fetch_failed"]);
    expect((await load(communityPage(), { [PROMO]: "<html><body>new layout</body></html>" })).incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
    expect((await load(communityPage(), { [texasHomesListingUrl()]: homePage(false) })).private.incentive).toBeNull();
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://texas-homes.com/fixture-acres" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("busy", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("holds a community with more homes listed than the cap", async () => {
    const many = Array.from({ length: 151 }, (_, index) => ({ ...ROWS[2]!, street: `${100 + index} Fixture Loop` }));
    expect((await load(communityPage({ menuRows: [["Fixture Acres", "/fixture-acres", null]] }), { [texasHomesHomesUrl(ID)]: listPage(many) })).holdReasons).toEqual(["incomplete_inventory"]);
  });
});
