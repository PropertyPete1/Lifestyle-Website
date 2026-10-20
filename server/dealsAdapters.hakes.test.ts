import { beforeEach, describe, expect, it, vi } from "vitest";
import { HakesBrothersAdapter, hakesComingSoon, hakesDiscoveryRecord, hakesListingEntries, hakesRecord, hakesResidences, hakesStatus, parseHakesCommunity } from "./dealsAdapters.hakes";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";
import { normalizedDealSourceKey } from "../shared/deals";

/**
 * Synthetic Hakes Brothers pages in the shape the live site served in
 * October 2026: the business and residence records, the home-designs tabs
 * with plan and quick move-in cards, and the market page. Names and
 * addresses are invented.
 */
const HOST = "https://www.hakesbrothers.com";
const COMMUNITY = `${HOST}/san-antonio/fixture-woods`;
const NOW = new Date("2026-10-20T15:00:00Z");
const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const business = (url = COMMUNITY, street: string | null = "293 Fixture Wy") => ld({ "@context": "http://schema.org", "@type": "HomeAndConstructionBusiness", name: "Hakes Brothers at Fixture Woods", image: `${HOST}/storage/app/medialibrary/public/2026/01/23286/293ivyway008.jpg`, url, address: { "@type": "PostalAddress", ...(street ? { streetAddress: street } : {}), addressLocality: "Mico", addressRegion: "TX", postalCode: "78056", addressCountry: "US" }, geo: { "@type": "GeoCoordinates", latitude: 29.518154, longitude: -98.825277 }, telephone: "+12105550142", contactPoint: { "@type": "ContactPoint", telephone: "+12105550142", email: "info@example.test" } });
type Home = { street: string; slug?: string; label: string | null; date: string; price: number; original?: number | null; sqft: number; beds: string; baths: string; garage?: string; lot: number; community?: string; city?: string; zip?: string };
const residence = (home: Home) => ld({ "@context": "http://schema.org", "@type": "SingleFamilyResidence", name: home.street, url: `${HOST}/san-antonio/${home.community ?? "fixture-woods"}/home/${home.slug ?? home.street.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, address: { "@type": "PostalAddress", streetAddress: home.street, addressLocality: home.city ?? "Mico", addressRegion: "TX", postalCode: home.zip ?? "78056" }, geo: { "@type": "GeoCoordinates", latitude: 29.522068, longitude: -98.828889 }, floorSize: { "@type": "QuantitativeValue", unitCode: "FTK", value: home.sqft }, bed: Number(home.beds.replace(/\D/g, "")), numberOfBedrooms: Number(home.beds.replace(/\D/g, "")), numberOfFullBathrooms: Math.floor(Number(home.baths.split(" ")[0])), numberOfBathroomsTotal: Math.ceil(Number(home.baths.split(" ")[0])), numberOfPartialBathrooms: Number(home.baths.split(" ")[0]) % 1 ? 1 : 0, image: `${HOST}/storage/app/medialibrary/public/2025/11/22393/${home.street.replace(/\s+/g, "-").toLowerCase()}.jpg` });
const cells = (sqft: string, beds: string, baths: string, garage: string) => `<div class="object-card__details"><div class="cell"><div class="icon icon--light"><i class="fal fa-ruler-combined fa-fw fa-lg"></i></div> Square Feet<br> <strong class="lead">${sqft}</strong></div><div class="cell"><div class="icon icon--light"><i class="fal fa-bed fa-lg"></i></div> Bedrooms<br> <strong class="lead">${beds}</strong></div><div class="cell"><div class="icon icon--light"><i class="fal fa-bath fa-lg"></i></div> Bathrooms<br> <strong class="lead">${baths}</strong></div><div class="cell"><div class="icon icon--light"><i class="fal fa-car fa-lg"></i></div> Garage<br> <strong class="lead">${garage}</strong></div></div>`;
const homeCard = (home: Home) => {
  const slug = home.slug ?? home.street.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const url = `${HOST}/san-antonio/${home.community ?? "fixture-woods"}/home/${slug}`;
  return `<div class="cell flex-container"><article class="card" style="height: 100%;" data-spec="71a711b8-${slug}" data-move-in-date="${home.date}" data-price="${home.price}" data-sqft="${home.sqft}"><div class="view overlay responsive-image"><img class="card-img-top" title="Tuscan II" src="/storage/app/medialibrary/public/2025/11/22393/conversions/${slug}-large.jpg" alt="" width="1024" height="597"><div class="card-img-overlay">${home.label === null ? "" : `<div class="h2 card-title text-white text-right"> ${home.label} </div>`}</div><a href="${url}" aria-label="${home.street}"><div class="mask"></div></a></div><div class="card-divider text-center flex-dir-column"><a title="Get directions to ${home.street}" href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(`${home.street}, Mico, TX 78056`)}" target="_blank" rel="noopener"><strong>Map Directions</strong></a></div><div class="card-section"><h4 class="h1" style="line-height: 1;"><a href="${url}">${home.street}</a></h4><div class="flex-container" style="gap: 0.5rem;">${home.original ? `<del class="card__original-price h2"> $${home.original.toLocaleString("en-US")} </del>` : ""}<strong class="h2 text-gray-850">$${home.price.toLocaleString("en-US")}</strong></div>${cells(home.sqft.toLocaleString("en-US"), home.beds, home.baths, home.garage ?? "2")}</div><div class="card-section flex-container align-bottom padding-top-0"><div><div>Fixture Woods</div><div class="flex-container flex-dir-row align-justify"><div>Homesite Number: ${home.lot}</div></div></div><button type="button" class="text-white bg-primary" data-open="spec-mortgage-calc-modal-5808"><span>Est. Monthly Payment*</span><span><strong style="font-size: 1.5rem;">$1,745</strong></span></button></div></article></div>`;
};
const planCard = (name: string, price: string | null, href = `${HOST}/san-antonio/fixture-woods/home-design/${name.toLowerCase()}-at-fixture-woods`, details = cells("1,522", "3", "2", "2")) => `<div class="cell flex-container"><article class="card"><div class="slick-slider slick-slider--white-arrows" data-slick="{&quot;slidesToShow&quot;: 1}"><div class="slide responsive-image"><a href="${href}" aria-label="${name}"><img title="Hill Country" src="/storage/app/medialibrary/public/2026/02/23801/conversions/1522-${name.toLowerCase()}-hill-country-large.jpg" alt="" width="1024" height="597"></a></div><div class="slide responsive-image"><a href="${href}"><img title="Farmhouse" src="/storage/app/medialibrary/public/2026/02/23803/conversions/1522-${name.toLowerCase()}-farmhouse-large.jpg" alt="" width="1024" height="597"></a></div><div class="slide responsive-image"><a href="${href}"><img title="Plan" src="/storage/app/medialibrary/public/2026/02/23804/conversions/1522-${name.toLowerCase()}-floorplan-large.jpg" alt=""></a></div></div><div class="card-section"><div class="plan-card-title-wrapper"><h4 class="plan-card__title h1"><a href="${href}">${name}</a></h4></div><p style="line-height: 1;"><span class="lead">Pricing starting at</span><br>${price ? `<strong class="h2 text-primary"> ${price} </strong>` : ""}</p>${details}</div></article></div>`;
const HOMES: Home[] = [
  { street: "118 Fixture Ct", label: "Move-In Ready", date: "2026-10-19", price: 279_990, original: 315_223, sqft: 1_781, beds: "4", baths: "2", lot: 4 },
  { street: "152 Fixture Ct", label: "Dec 2026", date: "2026-12-15", price: 315_990, original: 339_867, sqft: 2_290, beds: "5+", baths: "3.5", lot: 33 },
  { street: "2907 Fixture St", label: "Sep 2026", date: "2026-09-03", price: 319_990, original: null, sqft: 2_020, beds: "4", baths: "2.5 - 3", garage: "3", lot: 9 },
];
type PageInput = { business?: string | null; homes?: Home[] | null; cards?: string[]; residences?: string[]; plans?: string[]; tabs?: boolean; status?: string };
function communityPage(input: PageInput = {}) {
  const homes = input.homes === undefined ? HOMES : input.homes;
  const cards = input.cards ?? (homes ?? []).map(homeCard);
  const residences = input.residences ?? (homes ?? []).map(residence);
  const tabs = input.tabs === false ? "" : `<section id="homes" class="section--block" data-magellan-target="homes"><div class="grid-container"><h2 class="h1">Find Your New Home Design</h2><div class="flex-container"><ul id="home-tabs" class="tabs margin-top-3" data-tabs><li class="tabs-title is-active"><a href="#home-designs" aria-selected="true">Home Designs</a></li>${homes === null ? "" : `<li class="tabs-title"><a href="#quick-move-in-homes">Quick Move-In</a></li>`}</ul></div><div class="tabs-content margin-top-3" data-tabs-content="home-tabs"><div id="home-designs" class="tabs-panel is-active"><h3 class="h2">View plans available to build.</h3><div class="margin-top-1 grid-x grid-margin-x">${(input.plans ?? [planCard("Sophora", "$259,490"), planCard("Bandera", "$312,990", undefined, cells("2,440", "4 - 6", "2.5 - 3", "2")), planCard("Poinsettia", null)]).join("")}</div></div>${homes === null ? "" : `<div id="quick-move-in-homes" class="tabs-panel"><h3 class="h2">Move in sooner.</h3><div class="margin-top-1 grid-x grid-margin-x">${cards.join("")}</div></div>`}</div></div></section>`;
  return `<!DOCTYPE html><html><head><title>New Homes in Mico TX | Fixture Woods | Hakes Brothers</title>${ld({ "@context": "http://schema.org", "@type": "BreadcrumbList", itemListElement: [] })}${residences.join("")}${input.business === null ? "" : input.business ?? business()}</head><body><header><nav><a href="${HOST}/san-antonio">San Antonio</a><a href="${HOST}/san-antonio/fixture-ridge">Fixture Ridge</a></nav></header><main><div class="grid-container"><h1>Fixture Woods</h1><p class="headline community__price-min h2"> Starting at $294,990 <br><a class="link-primary" data-open="starting-price-disclaimer-modal" role="button"> Homesite premium may apply* </a></p><div class="object-details"><div class="cell"><strong> ${input.status ?? "Now Selling"} </strong></div><div class="cell"><strong>Medina Valley ISD</strong></div><div class="cell"><strong>Medina County</strong></div></div><p>Fixture Woods is a planned community near Medina Lake. The calculator automatically assumes a 10% down payment and a 6.5% interest rate.</p></div>${tabs}<section id="siteplan"><div class="siteplan-legend__item">Quick Move-In</div><div class="siteplan-legend__item">Sold</div></section><section id="contact"><a href="tel:+1-210-555-0142">(210) 555-0142</a><a href="https://www.google.com/maps/dir/?api=1&amp;destination=293+Fixture+Wy%2C+Mico%2C+TX+78056">293 Fixture Wy, Mico, TX 78056 | Get Directions</a></section></main><footer>&copy; 2026 Hakes Brothers</footer></body></html>`;
}
const marketPage = `<html><head>${residence(HOMES[0]!)}</head><body><a href="${HOST}/san-antonio/fixture-woods">Fixture Woods</a><a href="/san-antonio/fixture-ridge/">Fixture Ridge</a><a href="${HOST}/san-antonio/fixture-woods/home/118-fixture-ct">118</a><a href="${HOST}/el-paso/far-fixture">Far</a><a href="https://evil.example/san-antonio/x">x</a><a href="${HOST}/san-antonio">San Antonio</a></body></html>`;

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Hakes Brothers", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Woods", scrubList: ["Fixture Woods", "Fixture Ct", "Fixture St"] };
const html = (body: string) => vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }));

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Hakes Brothers reader: statuses", () => {
  it("reads ready, a month (a passed one undated), the card's date when the label is missing, sold, and holds on other wording", () => {
    expect(hakesStatus("Move-In Ready", "2026-10-19", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(hakesStatus("Dec 2026", "2026-12-15", NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(hakesStatus("February 2027", null, NOW)).toEqual({ status: "Quick Move-In (February 2027)", readyNow: false, moveInDate: "February 2027" });
    expect(hakesStatus("Sep 2026", "2026-09-03", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(hakesStatus("Oct 2026", "2026-10-25", NOW)).toEqual({ status: "Quick Move-In (October 2026)", readyNow: false, moveInDate: "October 2026" });
    expect(hakesStatus(null, "2026-10-19", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(hakesStatus("", "2027-01-15", NOW)).toEqual({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    expect(hakesStatus(null, null, NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    expect(hakesStatus(null, "soon", NOW).status).toBeNull();
    expect(hakesStatus("Sold", "2026-10-19", NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    for (const label of ["Coming Soon", "Model Home", "Reserved", "Dec 2099", "Octember 2026"]) expect(hakesStatus(label, null, NOW).status, label).toBeNull();
    // A label with a month name the reader does not know never defers to the card's date.
    for (const label of ["Early 2027", "Spring 2027", "Pending 2027", "Octember 2026"]) expect(hakesStatus(label, "2026-12-15", NOW).status, label).toBeNull();
  });
});

describe("Hakes Brothers reader: page data", () => {
  it("reads the business record, the residence records, the home cards (label, prices with the struck original, cells, homesite, photos) and the plan cards", () => {
    expect(hakesRecord(communityPage())).toEqual({ name: "Fixture Woods", street: "293 Fixture Wy", city: "Mico", zip: "78056", phone: "2105550142", priceFrom: null, geo: { lat: 29.518154, lng: -98.825277 } });
    expect(hakesRecord("<html><body>new layout</body></html>")).toBeNull();
    expect(hakesResidences(communityPage(), "www.hakesbrothers.com").map((home) => [home.url, home.street, home.city, home.zip, home.squareFeet, home.bedrooms, home.bathrooms, home.photo])).toEqual([
      [`${COMMUNITY}/home/118-fixture-ct`, "118 Fixture Ct", "Mico", "78056", 1_781, 4, 2, `${HOST}/storage/app/medialibrary/public/2025/11/22393/118-fixture-ct.jpg`],
      [`${COMMUNITY}/home/152-fixture-ct`, "152 Fixture Ct", "Mico", "78056", 2_290, 5, 3.5, `${HOST}/storage/app/medialibrary/public/2025/11/22393/152-fixture-ct.jpg`],
      [`${COMMUNITY}/home/2907-fixture-st`, "2907 Fixture St", "Mico", "78056", 2_020, 4, 2.5, `${HOST}/storage/app/medialibrary/public/2025/11/22393/2907-fixture-st.jpg`],
    ]);
    const page = parseHakesCommunity(communityPage(), COMMUNITY, NOW)!;
    expect(page).toMatchObject({ foreignPage: false, hasTabs: true, hasHomesTab: true, foreignHome: false, foreignPlan: false });
    expect(page.record.priceFrom).toBe(259_490);
    expect(page.homes.map((home) => [home.sourceUrl, home.privateAddress, home.status, home.readyNow, home.moveInDate, home.price, home.previousPrice, home.squareFeet, home.bedrooms, home.bathrooms, home.garage, home.homesite, home.gallery?.map((image) => image.sourceUrl)])).toEqual([
      [`${COMMUNITY}/home/118-fixture-ct`, "118 Fixture Ct, Mico, TX 78056", "Quick Move-In (Move-In Ready)", true, null, 279_990, 315_223, 1_781, 4, 2, 2, "Lot 4", [`${HOST}/storage/app/medialibrary/public/2025/11/22393/conversions/118-fixture-ct-large.jpg`, `${HOST}/storage/app/medialibrary/public/2025/11/22393/118-fixture-ct.jpg`]],
      [`${COMMUNITY}/home/152-fixture-ct`, "152 Fixture Ct, Mico, TX 78056", "Quick Move-In (December 2026)", false, "December 2026", 315_990, 339_867, 2_290, 5, 3.5, 2, "Lot 33", [`${HOST}/storage/app/medialibrary/public/2025/11/22393/conversions/152-fixture-ct-large.jpg`, `${HOST}/storage/app/medialibrary/public/2025/11/22393/152-fixture-ct.jpg`]],
      [`${COMMUNITY}/home/2907-fixture-st`, "2907 Fixture St, Mico, TX 78056", "Quick Move-In", false, null, 319_990, null, 2_020, 4, 2.5, 3, "Lot 9", [`${HOST}/storage/app/medialibrary/public/2025/11/22393/conversions/2907-fixture-st-large.jpg`, `${HOST}/storage/app/medialibrary/public/2025/11/22393/2907-fixture-st.jpg`]],
    ]);
    expect(new Set(page.homes.map((home) => normalizedDealSourceKey(home.sourceUrl))).size).toBe(3);
    expect(page.plans.map((plan) => [plan.sourceUrl, plan.privatePlanName, plan.price, plan.squareFeet, plan.bedrooms, plan.bathrooms, plan.garage, plan.gallery?.map((image) => image.sourceUrl)])).toEqual([
      [`${COMMUNITY}/home-design/sophora-at-fixture-woods`, "Sophora", 259_490, 1_522, 3, 2, 2, [`${HOST}/storage/app/medialibrary/public/2026/02/23801/conversions/1522-sophora-hill-country-large.jpg`, `${HOST}/storage/app/medialibrary/public/2026/02/23803/conversions/1522-sophora-farmhouse-large.jpg`]],
      [`${COMMUNITY}/home-design/bandera-at-fixture-woods`, "Bandera", 312_990, 2_440, 4, 2.5, 2, [`${HOST}/storage/app/medialibrary/public/2026/02/23801/conversions/1522-bandera-hill-country-large.jpg`, `${HOST}/storage/app/medialibrary/public/2026/02/23803/conversions/1522-bandera-farmhouse-large.jpg`]],
      [`${COMMUNITY}/home-design/poinsettia-at-fixture-woods`, "Poinsettia", null, 1_522, 3, 2, 2, [`${HOST}/storage/app/medialibrary/public/2026/02/23801/conversions/1522-poinsettia-hill-country-large.jpg`, `${HOST}/storage/app/medialibrary/public/2026/02/23803/conversions/1522-poinsettia-farmhouse-large.jpg`]],
    ]);
  });

  it("reads a page without the quick move-in tab, and flags a record elsewhere and foreign home or plan links", () => {
    expect(parseHakesCommunity(communityPage({ homes: null }), COMMUNITY, NOW)).toMatchObject({ hasTabs: true, hasHomesTab: false, homes: [], residenceUrls: [] });
    expect(parseHakesCommunity(communityPage({ business: business(`${HOST}/san-antonio/fixture-ridge`) }), COMMUNITY, NOW)).toMatchObject({ foreignPage: true });
    expect(parseHakesCommunity(communityPage({ cards: [homeCard({ ...HOMES[0]!, community: "fixture-ridge" })] }), COMMUNITY, NOW)).toMatchObject({ foreignHome: true, homes: [] });
    expect(parseHakesCommunity(communityPage({ plans: [planCard("Zinnia", "$1", `${HOST}/san-antonio/fixture-ridge/home-design/zinnia`)] }), COMMUNITY, NOW)).toMatchObject({ foreignPlan: true, plans: [] });
    expect(parseHakesCommunity(communityPage({ business: null }), COMMUNITY, NOW)).toBeNull();
    expect(parseHakesCommunity(communityPage({ tabs: false }), COMMUNITY, NOW)).toMatchObject({ hasTabs: false, comingSoon: false });
    // A coming-soon hero: the page parses as an empty community; discovery leaves it until it opens.
    const soon = communityPage({ tabs: false, homes: null, plans: [], status: "Coming Soon" });
    expect(hakesComingSoon(soon)).toBe(true);
    expect(parseHakesCommunity(soon, COMMUNITY, NOW)).toMatchObject({ hasTabs: false, comingSoon: true, homes: [], plans: [] });
    expect(hakesDiscoveryRecord(soon)).toBeNull();
    expect(hakesDiscoveryRecord(communityPage())).toMatchObject({ name: "Fixture Woods" });
    expect(hakesListingEntries(marketPage, "www.hakesbrothers.com")!.map((entry) => entry.url)).toEqual([COMMUNITY, `${HOST}/san-antonio/fixture-ridge`]);
    expect(hakesListingEntries("<html><body>new layout</body></html>", "www.hakesbrothers.com")).toBeNull();
  });
});

describe("Hakes Brothers reader: adapter", () => {
  it("is registered under its builder id", () => {
    expect(DEAL_ADAPTERS["Hakes Brothers"]).toBeInstanceOf(HakesBrothersAdapter);
    expect(DEAL_ADAPTERS["Hakes Brothers"].builder).toBe("Hakes Brothers");
  });

  it("reads the page once and publishes the homes, the plans and the facts, with no offer and nothing private", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes.map((home) => [home.privateName, home.status])).toEqual([["118 Fixture Ct", "Quick Move-In (Move-In Ready)"], ["152 Fixture Ct", "Quick Move-In (December 2026)"], ["2907 Fixture St", "Quick Move-In"]]);
    expect(result.private.plans.map((plan) => plan.privatePlanName)).toEqual(["Sophora", "Bandera", "Poinsettia"]);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 259_490, schoolDistrict: "Medina Valley ISD" });
    expect(result.private.incentive).toBeNull();
    expect(result.private.pages.map((page) => page.kind)).toEqual(["community", "home", "home", "home", "plan", "plan", "plan"]);
    expect(result.public.homes).toHaveLength(3);
    expect(result.public.plans).toHaveLength(3);
    expect(result.public.incentive).toBeNull();
    expect(JSON.stringify(result.public)).not.toMatch(/Fixture|Mico|555-0142|hakesbrothers|Homesite Number|71a711b8/);
  });

  it("publishes nothing for a community with no quick move-in tab, and plans only", async () => {
    const result = await loadOfficialDeals(config, { fetcher: html(communityPage({ homes: null })), now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toEqual([]);
    expect(result.private.plans).toHaveLength(3);
  });

  it("holds when the page is not a community page, when it or its links are another community's, when the cards and the residence records disagree, when a card has wording it does not know, and when the site or the read fails", async () => {
    const load = (page: string) => loadOfficialDeals(config, { fetcher: html(page), now: () => NOW });
    expect((await load("<html><body>new layout</body></html>")).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ business: business(COMMUNITY, null) }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ tabs: false }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    const soon = await load(communityPage({ tabs: false, homes: null, plans: [], status: "Coming Soon" }));
    expect(soon.catalogOk).toBe(true);
    expect(soon.private.homes).toEqual([]);
    expect(soon.private.plans).toEqual([]);
    expect((await load(communityPage({ business: business(`${HOST}/san-antonio/fixture-ridge`) }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ cards: [homeCard({ ...HOMES[0]!, community: "fixture-ridge" })] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ plans: [planCard("Zinnia", "$1", `${HOST}/san-antonio/fixture-ridge/home-design/zinnia`)] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    // A card without its record, a record without its card, a tab with no cards.
    expect((await load(communityPage({ cards: HOMES.slice(0, 2).map(homeCard) }))).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load(communityPage({ residences: HOMES.slice(0, 2).map(residence) }))).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load(communityPage({ cards: [...HOMES.slice(0, 2), { ...HOMES[2]!, slug: "2907-other-st" }].map(homeCard) }))).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load(communityPage({ cards: [], residences: [] }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A residence record beside a page with no tab is a changed page too.
    expect((await load(communityPage({ homes: null, residences: [residence(HOMES[0]!)] }))).holdReasons).toEqual(["incomplete_inventory"]);
    const unknown = await load(communityPage({ homes: [...HOMES, { ...HOMES[0]!, street: "9 Fixture Way", label: "Reserved", date: "soon" }] }));
    expect(unknown.holdReasons).toEqual([]);
    expect(unknown.private.homes.find((home) => home.privateName === "9 Fixture Way")?.status).toBeNull();
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://hakesbrothers.com/san-antonio/fixture-woods" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("busy", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });
});
