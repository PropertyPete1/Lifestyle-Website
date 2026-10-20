import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPIRE_MAX_HOMES, EmpireHomesAdapter, empireHomes, empireListingUrl, empirePlans, empireRecord, empireRegionLinks, empireRegionUrl, empireStatus, parseEmpireCampaign, parseEmpireCommunity, parseEmpireListing, parseEmpireWidgets } from "./dealsAdapters.empire";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Empire Homes pages in the shape the live site served in October
 * 2026: an Elementor page with the sales office's static map, two listing
 * widgets (base64 `data-detail`), the first four home cards and the market's
 * promotion banner; the listing endpoint's JSON. Names and addresses are
 * invented.
 */
const HOST = "https://empirehomes.com";
const PATH = "/us/texas/san-antonio/fixture-agave/";
const COMMUNITY = `${HOST}${PATH}`;
const CAMPAIGN = `${HOST}/us/texas/san-antonio/smart-move-campaign/`;
const NOW = new Date("2026-10-20T15:00:00Z");
const detail = (display: string, community = "Fixture Agave", permalink = COMMUNITY) => Buffer.from(JSON.stringify({ items_per_page: "4", display, endpoint: "https://empirehomes.com//wp-json/custom/v1/get_lots_by_community_name", community, region: "San Antonio, Texas", permalink, is_rental: "0" })).toString("base64");

type Home = { slug: string; street: string; status: string; price: string; was?: string; day?: string; beds?: string; baths?: string; half?: string; sqft?: string; lot?: string; active?: string; permalink?: string; plan?: string };
const HOMES: Home[] = [
  { slug: "duval-a-4966-fixture-glen-h50448", street: "4966 Fixture Glen", status: "MoveInReady", price: "274990", was: "279490", day: "2025-07-27", plan: "Duval A | 4966 Fixture Glen", lot: "4" },
  { slug: "bandera-a-4954-fixture-way-h50425", street: "4954 Fixture Way", status: "UnderConstruction", price: "299998", was: "314990", day: "2026-12-15", beds: "4", baths: "2", half: "1", sqft: "1945", plan: "Bandera A | 4954 Fixture Way", lot: "14" },
  { slug: "navarro-c-4950-fixture-way-h50426", street: "4950 Fixture Way", status: "UnderConstruction", price: "329990", was: "0", day: "2026-09-30", plan: "Navarro C | 4950 Fixture Way", lot: "13" },
  { slug: "sabine-c-4958-fixture-way-h50427", street: "4958 Fixture Way", status: "UnderConstruction", price: "349990", was: "359990", day: "", plan: "Sabine C | 4958 Fixture Way", lot: "15" },
  { slug: "presidio-a-4950-fixture-glen-h50452", street: "4950 Fixture Glen", status: "Sold", price: "314990", was: "321990", day: "", plan: "Presidio A | 4950 Fixture Glen", lot: "9" },
];
const homeRow = (home: Home) => ({
  builder_id: "EMPIRE-SANANTONIO", builder_name: "Empire Homes", community_type: "Home", community_id: "1124", community_name: "Fixture Agave", unit_id: home.slug.split("-").pop()!.toUpperCase(), floorplan_id: "37018",
  unit_name: `Fixture Agave ${home.plan}`, unit_name_single: home.plan, unit_status: home.status, unit_stories: "1", unit_type: "Unit", price: home.price, size: home.sqft ?? "1408", previus_price: home.was ?? "0",
  bedrooms: home.beds ?? "3", bathrooms: home.baths ?? "2", halfbaths: home.half ?? "0", plan_images: [], interior_images: [`https://empirehomes.com/wp-content/uploads/2025/10/${home.slug}-kitchen.jpg`, "https://evil.example/x.jpg", `https://empirehomes.com/wp-content/uploads/2025/10/${home.slug}-floorplan.jpg`],
  unit_garages: "2", unit_collection_parent: "40' Fixture Collection", unit_address: home.street, mls: "1945599", move_in_date: home.status === "Sold" ? "Sold" : "Move-in Ready", move_in_date_day: home.day ?? "",
  phase: "Phase 1", lot: home.lot ?? "", block: "13", unit_elevation: "A", is_active: home.active ?? "1", spec_featured: "0", spcMortPromInterest: "4.99", spcMortPromLoanDuration: "30", type: "spec",
  custom_banner_presale: "October Low Pricing", unit_sale_status: home.status === "Sold" ? "Sold" : "", ID: 261805, post_title: `${home.plan} - H50448`, unit_slug: home.slug, permalink: home.permalink ?? `${COMMUNITY}listing/${home.slug}/`,
  plan_images_details: [{ url: `https://empirehomes.com/wp-content/uploads/2025/10/${home.slug}-front.jpg`, sizes: { large: `https://empirehomes.com/wp-content/uploads/2025/10/${home.slug}-front-512x341.jpg` } }],
  button_url: "https://empire.utourhomes.com/visitor?tourPropertyId=15944de8", is_rental: "0",
});
type Plan = { slug: string; name: string; price: string; size?: string; beds?: string; baths?: string; half?: string; elevations?: Array<[string, string]>; permalink?: string; active?: string };
const PLANS: Plan[] = [
  { slug: "blanco-37327", name: "Blanco", price: "269990", size: "1326", elevations: [["A", "269990.00"], ["B", "273990.00"]] },
  { slug: "medina-37019", name: "Medina", price: "0", size: "1658", beds: "4", baths: "2", half: "1", elevations: [["A", "299990.00"], ["B", "0"]] },
  { slug: "lark-37020", name: "Lark", price: "0", size: "0" },
];
const planRow = (plan: Plan) => ({
  builder_id: "EMPIRE-SANANTONIO", builder_name: "Empire Homes", community_name: "Fixture Agave", unit_id: plan.slug.split("-").pop(), unit_name: `Fixture Agave ${plan.name}`, unit_name_single: plan.name, unit_status: "Active", unit_type: "Plan",
  price: plan.price, size: plan.size ?? "0", previus_price: "0", bedrooms: plan.beds ?? "3", bathrooms: plan.baths ?? "2", halfbaths: plan.half ?? "0", plan_pdf: "https://empire-portal.com/uploads/x.pdf", plan_images: [], floorplan_images: ["https://empirehomes.com/wp-content/uploads/2026/01/40-00-blanco-january-2026-scaled.jpg"],
  elevations: (plan.elevations ?? []).map(([name, price]) => ({ ElevationName: name, ElevationPrice: price, ElevationSize: plan.size ?? "0", ElevationImage: [`\nhttps://empire-portal.com/uploads/images/LowRise/Plans/${plan.name}/40-00_${name}.jpg\n`] })),
  unit_garages: "2", unit_collection: "40' Fixture Collection", move_in_date_day: "", is_active: plan.active ?? "1", type: "plan", permalink: plan.permalink ?? `${COMMUNITY}home-plans/${plan.slug}/`,
});
const listing = (rows: unknown[], pagination: Partial<{ total: number; per_page: number; current_page: number; last_page: number }> = {}) => JSON.stringify({ success: true, data: { filter: {}, data: rows, query: "SELECT …", pagination: { total: rows.length, per_page: 100, current_page: 1, last_page: 1, ...pagination } }, cacheDate: "2026-10-20" });
const MAP = (address: string, center = "29.3378048,-98.3938141") => `<div class="elementor-widget-container"><div class="map-agent-widget"><div class="map-agent-static-container" id="map_agent_d9a8004_static"><img decoding="async" src="https://maps.googleapis.com/maps/api/staticmap?center=${center}&#038;zoom=14&#038;size=600x400&#038;key=FIXTUREKEY" alt="Map of ${address}" /><div class="map-agent-static-pin"></div><div class="map-agent-static-label">Fixture Agave</div></div></div></div>`;
const card = (home: Home) => `<div class="homes-grid-item v2 quick-homes-grid-item" data-listing-id="261805" data-community="Fixture Agave"><span class="promo-label v1 yellow">October Low Pricing</span><div class="homes-content"><span class="pre-title-state green">Move-in Ready</span><div class="wrap"><span class="region">${home.plan?.split("|")[0]}</span><span class="hesh">MLS #1945599</span></div><a href="${COMMUNITY}listing/${home.slug}/" class="wrap title-wrap"><span class="name">${home.street}</span></a><div class="wrap"><span class="address">Phase 1 - Block 13 - Lot ${home.lot}</span></div><div class="info-home-wrapper"><span class="info-home"><span class="label-title">Price</span><span class="regular">$${Number(home.price).toLocaleString("en-US")}</span></span></div><div class="wrap"><a href="${COMMUNITY}listing/${home.slug}/" class="btn-more">Learn More</a></div></div></div>`;
type PageInput = { map?: string | null; widgets?: string[] | null; cards?: Home[]; promo?: boolean; campaign?: string | null; phone?: string | null };
function communityPage(input: PageInput = {}): string {
  const widgets = input.widgets === undefined ? [detail("quick_delivery_homes"), detail("new_home_plans")] : input.widgets ?? [];
  const cards = input.cards ?? HOMES.slice(0, 4);
  const promo = input.promo === false ? "" : `<div class="elementor-widget-container"><div class="banner-promotion-single"><section class="banner-section"><div class="banner-content"><div class="wrap-title"><div class="top-title"><p>UNPACK YOUR BUYING POWER</p></div><div class="title"><p><span>Smart Move Sales Event</span></p></div></div><div class="wrap-description"><div class="description"><p>Smart Move Sales Event offers are here, giving you even more reasons to make your move now. Whatever&#8217;s standing between you and your next home, we&#8217;ve got a way to help you get there with promotion offerings including:</p><ul><li>Interest Rates as Low as 3.99%*</li><li>4.99% Fixed FHA/VA Interest Rate*</li><li>Up to $50,000 in Price Reductions</li><li>Up to $10,000 Closing Costs</li><li>Paid Owners Title Policy</li><li>Move-in Package <ul><li>Refrigerator</li><li>Blinds</li></ul></li></ul></div><a href="#elementor-action" class="btn"> Request Information </a></div></div></section></div></div>`;
  const campaign = input.campaign === undefined ? CAMPAIGN : input.campaign;
  return `<!DOCTYPE html><html><head><title>New Homes for Sale in East San Antonio | Empire Homes Fixture Agave</title><link rel="canonical" href="${COMMUNITY}"/></head><body>
<header><a href="${HOST}/us/texas/san-antonio/">San Antonio</a>${campaign ? `<p>Your Smart Move starts here. 12 packages available. <a href="${campaign}">View Offers</a></p>` : ""}</header>
<main><h1 class="elementor-heading-title">New Homes for Sale in San Antonio, TX. Starting from the Mid $200&#8217;s.</h1><p>Fixture Agave NOW SELLING</p><p>Zoned to East Central ISD.</p>
<section id="find-us"><span class="elementor-heading-title">Find Us</span><div class="elementor-widget-container">Schedule an appointment at our sales center.<ul><li>Sunday – Monday: 12 PM – 6 PM</li></ul></div>${input.phone === null ? "" : `<div class="elementor-widget-container"> ${input.phone ?? "210-555-0142"} </div>`}<div class="elementor-widget-container"><a href="mailto:fixture@empirehomes.com">fixture@empirehomes.com</a></div><div class="elementor-widget-container"><div class="elementor-shortcode">8602 Fixture Glen, San Antonio, TX 78222</div></div>${input.map === undefined ? MAP("8602 Fixture Glen, San Antonio, TX 78222") : input.map ?? ""}<a href="https://maps.google.com/?saddr=Current+Location&#038;daddr=29.332977999623,%20-98.397593530479">get directions</a></section>
<section id="quick-delivery"><h2>quick delivery homes</h2>${widgets[0] ? `<div class="apartments-widget" id="apartments-widget-1" data-detail="${widgets[0]}" data-current-page="1"><div class="apartments-grid homes-grid-wrapper">${cards.map(card).join("")}</div>${cards.length >= 4 ? '<button class="load-more">Load More</button>' : ""}</div>` : ""}</section>
${promo}
<section id="plans"><h2>new home Plans</h2>${widgets[1] ? `<div class="apartments-widget" id="apartments-widget-2" data-detail="${widgets[1]}" data-current-page="1"><div class="apartments-grid"><div class="homes-grid-item"><a href="${COMMUNITY}home-plans/blanco-37327/" class="btn-more">Learn More</a></div></div></div>` : ""}</section>
</main><footer><p>Prices, sizes, and specifications are subject to change without notice. E &amp; O.E.</p></footer></body></html>`;
}
const campaignPage = (footnote: string | null = "Disclaimer: *Offer valid on select move-in ready homes in participating Empire Homes communities. Must be presented before signing the contract and cannot be combined with other promotions, discounts, or incentives. Special rate applies to qualifying Primary Residence loans with contracts dated October 1st-December 31st and must close by December 31st. Loan approval is subject to income, credit, and acceptable property appraisal. Buyer must apply and use Alta Home Lending (NMLS #40561; A. Person, NMLS #743526) as lender. Loan programs, prices, plans, and terms are subject to change without notice. Restrictions may apply. See a Sales Consultant for complete details. E &#038; O.E.") => `<!DOCTYPE html><html><head><title>Smart Move Sales Event - San Antonio | Empire Homes</title><link rel="canonical" href="${CAMPAIGN}"/></head><body><main><h1>Your Smart Move starts here.</h1><div class="elementor-widget-container"><p>Smart Move Sales Event offers give you even more reasons to make your move now.</p></div>${footnote === null ? "" : `<div class="elementor-element elementor-widget elementor-widget-text-editor"><div class="elementor-widget-container"> ${footnote} </div></div>`}</main></body></html>`;
const regionPage = `<html><body><a href="${HOST}/us/texas/san-antonio/smart-move-campaign/">View Offers</a><a href="${COMMUNITY}">Fixture Agave</a><a href="${HOST}/us/texas/san-antonio/new-braunfels/fixture-brook/">Fixture Brook</a><a href="${HOST}/us/texas/san-antonio/new-braunfels/">New Braunfels</a><a href="${COMMUNITY}listing/duval-a-4966-fixture-glen-h50448/">4966 Fixture Glen</a><a href="${COMMUNITY}home-plans/blanco-37327/">Blanco</a><a href="${HOST}/us/texas/austin/fixture-hill/">Fixture Hill</a><a href="https://evil.example/us/texas/san-antonio/x/">x</a><a href="${COMMUNITY}">Fixture Agave again</a></body></html>`;

const HOMES_URL = empireListingUrl("Fixture Agave", "homes");
const PLANS_URL = empireListingUrl("Fixture Agave", "plans");
const site: Record<string, string> = { [COMMUNITY]: communityPage(), [HOMES_URL]: listing(HOMES.map(homeRow)), [PLANS_URL]: listing(PLANS.map(planRow)), [CAMPAIGN]: campaignPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": input.includes("wp-json") ? "application/json" : "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const withSite = (overrides: Record<string, string | null>) => vi.fn(async (input: string) => {
  const body = Object.prototype.hasOwnProperty.call(overrides, input) ? overrides[input] : site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": input.includes("wp-json") ? "application/json" : "text/html" } }) : new Response("busy", { status: 503, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Empire Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Agave", scrubList: ["Fixture Agave", "Fixture Glen", "Fixture Way", "Fixture Collection"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Empire reader: the page", () => {
  it("reads the listing widgets' detail", () => {
    const widgets = parseEmpireWidgets(communityPage());
    expect(widgets.map((widget) => [widget.display, widget.community, widget.permalink?.toString(), widget.endpoint?.toString()])).toEqual([
      ["quick_delivery_homes", "Fixture Agave", COMMUNITY, "https://empirehomes.com/wp-json/custom/v1/get_lots_by_community_name"],
      ["new_home_plans", "Fixture Agave", COMMUNITY, "https://empirehomes.com/wp-json/custom/v1/get_lots_by_community_name"],
    ]);
    expect(parseEmpireWidgets('<div data-detail="bm90IGpzb24="></div><div data-detail="e30="></div>')).toEqual([]);
  });

  it("reads statuses from the unit status and the move-in day", () => {
    expect(empireStatus("MoveInReady", "2025-07-27", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(empireStatus("UnderConstruction", "2026-12-15", NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(empireStatus("UnderConstruction", "2026-09-30", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(empireStatus("UnderConstruction", "", NOW)).toMatchObject({ status: "Quick Move-In" });
    expect(empireStatus("UnderConstruction", "soon", NOW)).toMatchObject({ status: "Quick Move-In" });
    expect(empireStatus("Under Construction", "2027-01-05", NOW)).toMatchObject({ status: "Quick Move-In (January 2027)" });
    expect(empireStatus("Sold", "", NOW)).toMatchObject({ status: "Sold" });
    expect(empireStatus("Reserved", "", NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    expect(empireStatus(null, null, NOW)).toMatchObject({ status: null });
    // The sale status decides first: sold is sold whatever construction says; another sale word is unknown; a "Sold" move-in text is sold too.
    expect(empireStatus("MoveInReady", "2025-07-27", NOW, "Sold")).toMatchObject({ status: "Sold", readyNow: false });
    expect(empireStatus("UnderConstruction", "2026-12-15", NOW, "Pending")).toEqual({ status: null, readyNow: false, moveInDate: null });
    expect(empireStatus("MoveInReady", "", NOW, "", "Sold")).toMatchObject({ status: "Sold" });
    expect(empireStatus("MoveInReady", "", NOW, "", "Move-in Ready")).toMatchObject({ readyNow: true });
  });

  it("reads the sales office (name from the map label, street and ZIP from the map's caption, phone, pin from the map's center), the widgets, the cards, the banner and the campaign link", () => {
    const page = parseEmpireCommunity(communityPage(), COMMUNITY);
    expect(page?.record).toEqual({ name: "Fixture Agave", street: "8602 Fixture Glen", city: "San Antonio", zip: "78222", phone: "2105550142", priceFrom: null, geo: { lat: 29.3378048, lng: -98.3938141 } });
    expect(page).toMatchObject({ community: "Fixture Agave", hasPlansWidget: true, foreignPage: false, campaignUrl: CAMPAIGN });
    expect(page?.cardUrls).toEqual(HOMES.slice(0, 4).map((home) => `${COMMUNITY}listing/${home.slug}`));
    expect(page?.promo).toMatch(/^UNPACK YOUR BUYING POWER Smart Move Sales Event Smart Move Sales Event offers are here.*Interest Rates as Low as 3\.99% 4\.99% Fixed FHA\/VA Interest Rate Up to \$50,000 in Price Reductions.*Blinds$/);
    // The caption's other spelling, a page without the phone, and a sold-out page (map, no widgets).
    expect(parseEmpireCommunity(communityPage({ map: MAP("1531 Fixture Grove, New Braunfels, TX, 78130", "29.676805,-98.0502314"), phone: null }), COMMUNITY)?.record).toMatchObject({ street: "1531 Fixture Grove", city: "New Braunfels", zip: "78130", phone: null, geo: { lat: 29.676805, lng: -98.0502314 } });
    expect(parseEmpireCommunity(communityPage({ widgets: null, cards: [] }), COMMUNITY)).toMatchObject({ community: null, hasPlansWidget: false, cardUrls: [] });
    expect(parseEmpireCommunity(communityPage({ widgets: [detail("quick_delivery_homes", "Fixture Agave", `${HOST}/us/texas/san-antonio/fixture-creek/`)] }), COMMUNITY)).toMatchObject({ foreignPage: true });
    expect(parseEmpireCommunity(communityPage({ promo: false, campaign: null }), COMMUNITY)).toMatchObject({ promo: null, campaignUrl: null });
    // Another market's promotions page ahead of the market's link is never this community's campaign; the market's own link is, wherever it sits.
    const foreignNav = communityPage().replace("<header>", `<header><nav><a href="${HOST}/us/texas/houston/promotions/">Houston Promotions</a><a href="${HOST}/ca/ontario/offers/">Offers</a></nav>`);
    expect(parseEmpireCommunity(foreignNav, COMMUNITY)?.campaignUrl).toBe(CAMPAIGN);
    expect(parseEmpireCommunity(communityPage({ campaign: `${HOST}/us/texas/houston/promotions/` }), COMMUNITY)?.campaignUrl).toBeNull();
    expect(parseEmpireCommunity(communityPage({ map: null }), COMMUNITY)).toBeNull();
    expect(parseEmpireCommunity("<html><body>new layout</body></html>", COMMUNITY)).toBeNull();
    expect(empireRecord(communityPage(), COMMUNITY)?.name).toBe("Fixture Agave");
    expect(empireRecord(communityPage({ map: MAP("Fixture Rd and Other Rd, San Antonio, TX 78222") }), COMMUNITY)).toBeNull();
  });

  it("reads the campaign page's footnote without its phone numbers and NMLS ids", () => {
    const footnote = parseEmpireCampaign(campaignPage());
    expect(footnote).toMatch(/^Disclaimer: Offer valid on select move-in ready homes.*must close by December 31st\./);
    expect(footnote).not.toMatch(/40561|743526|NMLS|A\. Person/);
    expect(footnote).toMatch(/use Alta Home Lending as lender\./);
    expect(parseEmpireCampaign(campaignPage(null))).toBeNull();
  });

  it("lists the region page's community links for discovery, once each, on the official host and under the market only", () => {
    expect(empireRegionLinks(regionPage, "empirehomes.com")).toEqual([`${HOST}/us/texas/san-antonio/smart-move-campaign/`, COMMUNITY, `${HOST}/us/texas/san-antonio/new-braunfels/fixture-brook/`, `${HOST}/us/texas/san-antonio/new-braunfels/`]);
    expect(empireRegionLinks("<html><body>none</body></html>", "empirehomes.com")).toBeNull();
    expect(empireRegionUrl()).toBe("https://empirehomes.com/us/texas/san-antonio/");
    expect(HOMES_URL).toBe("https://empirehomes.com/wp-json/custom/v1/get_lots_by_community_name?per_page=100&page=1&name=Fixture+Agave&meta_key=apartment_type&meta_value=quick_delivery&sort_comminity=collection&orderby=collection&order=DESC");
    expect(PLANS_URL).toContain("&meta_value=new_home_plan&sort_comminity=collection&orderby=collection&order=DESC&unit_type=Plan");
  });
});

describe("Empire reader: the listing", () => {
  it("reads the homes (status, price and a cut's previous price, specs, garage, lot, plan, photos on the uploads only) and flags a row elsewhere", () => {
    const parsed = parseEmpireListing(site[HOMES_URL]!)!;
    expect(parsed).toMatchObject({ total: 5, lastPage: 1 });
    const { homes, foreignHome } = empireHomes(parsed, COMMUNITY, parseEmpireCommunity(communityPage(), COMMUNITY)!.record, NOW);
    expect(foreignHome).toBe(false);
    expect(homes.map((home) => [home.privateName, home.status, home.price, home.previousPrice, home.priceDrop, home.readyNow, home.moveInDate, home.privatePlanName, home.homesite])).toEqual([
      ["4966 Fixture Glen", "Quick Move-In (Move-In Ready)", 274_990, 279_490, 4_500, true, null, "Duval A", "Lot 4"],
      ["4954 Fixture Way", "Quick Move-In (December 2026)", 299_998, 314_990, 14_992, false, "December 2026", "Bandera A", "Lot 14"],
      ["4950 Fixture Way", "Quick Move-In", 329_990, null, null, false, null, "Navarro C", "Lot 13"],
      ["4958 Fixture Way", "Quick Move-In", 349_990, 359_990, 10_000, false, null, "Sabine C", "Lot 15"],
      ["4950 Fixture Glen", "Sold", 314_990, 321_990, 7_000, false, null, "Presidio A", "Lot 9"],
    ]);
    expect(homes[1]).toMatchObject({ sourceUrl: `${COMMUNITY}listing/bandera-a-4954-fixture-way-h50425`, privateAddress: "4954 Fixture Way, San Antonio, TX 78222", bedrooms: 4, bathrooms: 2.5, squareFeet: 1_945, garage: 2 });
    expect(homes[0]?.gallery.map((image) => image.sourceUrl)).toEqual(["https://empirehomes.com/wp-content/uploads/2025/10/duval-a-4966-fixture-glen-h50448-front.jpg", "https://empirehomes.com/wp-content/uploads/2025/10/duval-a-4966-fixture-glen-h50448-kitchen.jpg"]);
    const foreign = empireHomes(parseEmpireListing(listing([homeRow({ ...HOMES[0]!, permalink: `${HOST}/us/texas/san-antonio/fixture-creek/listing/x/` }), homeRow({ ...HOMES[1]!, active: "0" })]))!, COMMUNITY, parseEmpireCommunity(communityPage(), COMMUNITY)!.record, NOW);
    expect(foreign).toMatchObject({ foreignHome: true, homes: [] });
    expect(empireHomes(parseEmpireListing(listing([homeRow({ ...HOMES[0]!, status: "Reserved" })]))!, COMMUNITY, parseEmpireCommunity(communityPage(), COMMUNITY)!.record, NOW).homes[0]?.status).toBeNull();
    // A row sold in its sale status is sold whatever its construction status; a rental row is not a home for sale.
    const record = parseEmpireCommunity(communityPage(), COMMUNITY)!.record;
    expect(empireHomes(parseEmpireListing(listing([{ ...homeRow(HOMES[0]!), unit_sale_status: "Sold" }]))!, COMMUNITY, record, NOW).homes[0]).toMatchObject({ status: "Sold", readyNow: false });
    expect(empireHomes(parseEmpireListing(listing([{ ...homeRow(HOMES[1]!), unit_sale_status: "Pending" }]))!, COMMUNITY, record, NOW).homes[0]?.status).toBeNull();
    expect(empireHomes(parseEmpireListing(listing([{ ...homeRow(HOMES[0]!), is_rental: "1", price: "2450" }, homeRow(HOMES[1]!)]))!, COMMUNITY, record, NOW).homes.map((home) => home.privateName)).toEqual(["4954 Fixture Way"]);
    expect(parseEmpireListing("<html>not json</html>")).toBeNull();
    expect(parseEmpireListing(JSON.stringify({ success: false, data: { data: [] } }))).toBeNull();
    expect(parseEmpireListing(JSON.stringify({ success: true, data: { rows: [] } }))).toBeNull();
  });

  it("reads the plans (price from the elevations when the row has none; a row with neither price nor size left out) and flags a row elsewhere", () => {
    const { plans, foreignPlan } = empirePlans(parseEmpireListing(site[PLANS_URL]!)!, COMMUNITY);
    expect(foreignPlan).toBe(false);
    expect(plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.sourceUrl])).toEqual([
      ["Blanco", 269_990, 3, 2, 1_326, `${COMMUNITY}home-plans/blanco-37327`],
      ["Medina", 299_990, 4, 2.5, 1_658, `${COMMUNITY}home-plans/medina-37019`],
    ]);
    expect(plans[0]?.gallery).toEqual([]);
    expect(empirePlans(parseEmpireListing(listing([planRow({ ...PLANS[0]!, permalink: `${HOST}/us/texas/san-antonio/fixture-creek/home-plans/blanco-1/` })]))!, COMMUNITY)).toMatchObject({ foreignPlan: true, plans: [] });
  });
});

describe("Empire reader: adapter", () => {
  it("is registered under its builder id", () => {
    expect(DEAL_ADAPTERS["Empire Homes"]).toBeInstanceOf(EmpireHomesAdapter);
    expect(DEAL_ADAPTERS["Empire Homes"].builder).toBe("Empire Homes");
  });

  it("reads the page, both listings and the campaign page, and publishes the homes and plans with the offer held for its missing terms", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(requested).toEqual([COMMUNITY, HOMES_URL, PLANS_URL, CAMPAIGN]);
    expect(result.private.homes.map((home) => [home.privateName, home.status, home.price])).toEqual([["4966 Fixture Glen", "Quick Move-In (Move-In Ready)", 274_990], ["4954 Fixture Way", "Quick Move-In (December 2026)", 299_998], ["4950 Fixture Way", "Quick Move-In", 329_990], ["4958 Fixture Way", "Quick Move-In", 349_990], ["4950 Fixture Glen", "Sold", 314_990]]);
    expect(result.private.plans.map((plan) => plan.privatePlanName)).toEqual(["Blanco", "Medina"]);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 269_990, schoolDistrict: "East Central ISD" });
    expect(result.private.incentive?.text).toMatch(/Smart Move Sales Event.*Disclaimer: Offer valid/);
    expect(result.private.incentive?.text).not.toMatch(/40561|555-0142/);
    expect(result.incentiveHoldReasons.length).toBeGreaterThan(0);
    expect(result.public.incentive).toBeNull();
    expect(result.private.pages.map((page) => page.kind)).toEqual(["community", "inventory", "inventory", "home", "home", "home", "home", "home", "plan", "plan", "incentive"]);
    expect(result.public.homes).toHaveLength(5);
    expect(JSON.stringify(result.public)).not.toMatch(/Fixture|1945599|555-0142|empirehomes\.com|utourhomes|FIXTUREKEY|A\. Person/);
  });

  it("publishes without plans when the page has no plans widget, and holds the offer only when the campaign page cannot be read or has no footnote", async () => {
    const noPlans = await loadOfficialDeals(config, { fetcher: withSite({ [COMMUNITY]: communityPage({ widgets: [detail("quick_delivery_homes")] }) }), now: () => NOW });
    expect(noPlans.catalogOk).toBe(true);
    expect(noPlans.private.plans).toEqual([]);
    expect(noPlans.private.homes).toHaveLength(5);
    const down = await loadOfficialDeals(config, { fetcher: withSite({ [CAMPAIGN]: null }), now: () => NOW });
    expect(down.catalogOk).toBe(true);
    expect(down.incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
    expect(down.private.incentive).toBeNull();
    const bare = await loadOfficialDeals(config, { fetcher: withSite({ [CAMPAIGN]: campaignPage(null) }), now: () => NOW });
    expect(bare.incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
    expect(down.private.offerRead).toBeFalsy();
    const quiet = await loadOfficialDeals(config, { fetcher: withSite({ [COMMUNITY]: communityPage({ promo: false }) }), now: () => NOW });
    expect(quiet.catalogOk).toBe(true);
    // The page was read and shows no banner: the builder shows no offer.
    expect(quiet.private.offerRead).toBe(true);
    expect(quiet.incentiveHoldReasons).toEqual([]);
    expect(quiet.private.incentive).toBeNull();
  });

  it("holds when the page is not a community page or is sold out, when a widget names another page, when a listing cannot be read or is not the list, when the listing is paged or its count disagrees, when a card is missing from the listing, when a row links elsewhere, and when the site fails", async () => {
    const load = (overrides: Record<string, string | null>) => loadOfficialDeals(config, { fetcher: withSite(overrides), now: () => NOW });
    expect((await load({ [COMMUNITY]: "<html><body>new layout</body></html>" })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load({ [COMMUNITY]: communityPage({ widgets: null, cards: [] }) })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load({ [COMMUNITY]: communityPage({ map: MAP("Fixture Rd and Other Rd, San Antonio, TX 78222") }) })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load({ [COMMUNITY]: communityPage({ widgets: [detail("quick_delivery_homes", "Fixture Agave", `${HOST}/us/texas/san-antonio/fixture-creek/`), detail("new_home_plans")] }) })).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load({ [HOMES_URL]: null })).holdReasons).toEqual(["community_fetch_failed"]);
    expect((await load({ [HOMES_URL]: "<html>maintenance</html>" })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load({ [HOMES_URL]: listing(HOMES.map(homeRow), { last_page: 2 }) })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load({ [HOMES_URL]: listing(HOMES.map(homeRow), { total: 6 }) })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load({ [HOMES_URL]: listing(HOMES.slice(1).map(homeRow)) })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load({ [HOMES_URL]: listing([...HOMES.map(homeRow), homeRow({ ...HOMES[0]!, slug: "x-h1", permalink: `${HOST}/us/texas/san-antonio/fixture-creek/listing/x-h1/` })]) })).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load({ [PLANS_URL]: null })).holdReasons).toEqual(["community_fetch_failed"]);
    expect((await load({ [PLANS_URL]: "<html>maintenance</html>" })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load({ [PLANS_URL]: listing(PLANS.map(planRow), { last_page: 3 }) })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load({ [PLANS_URL]: listing(PLANS.map(planRow), { total: 9 }) })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load({ [PLANS_URL]: listing([planRow({ ...PLANS[0]!, permalink: `${HOST}/us/texas/san-antonio/fixture-creek/home-plans/blanco-1/` })]) })).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load({ [COMMUNITY]: null })).holdReasons).toEqual(["community_fetch_failed"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://www.empirehomes.com/us/texas/san-antonio/fixture-agave/" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const away = vi.fn(async () => new Response("", { status: 302, headers: { location: "https://empire-portal.com/" } }));
    expect((await loadOfficialDeals(config, { fetcher: away })).holdReasons).toEqual(["unsupported_official_host"]);
  });

  it("holds a community with more homes for sale than one listing page carries", async () => {
    const many = Array.from({ length: EMPIRE_MAX_HOMES + 1 }, (_, index) => homeRow({ ...HOMES[0]!, slug: `fixture-${index}-h${1000 + index}`, street: `${100 + index} Fixture Glen` }));
    expect((await loadOfficialDeals(config, { fetcher: withSite({ [HOMES_URL]: listing(many) }), now: () => NOW })).holdReasons).toEqual(["incomplete_inventory"]);
  });
});
