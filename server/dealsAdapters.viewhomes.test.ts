import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewHomesAdapter, parseViewHomesCommunity, parseViewHomesPromo, parseViewHomesRoster, resetViewHomesCaches, viewHomesListingEntries, viewHomesListingUrl, viewHomesStatus } from "./dealsAdapters.viewhomes";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";
import { normalizedDealSourceKey } from "../shared/deals";

/**
 * Synthetic View Homes pages in the shape the live site served in October
 * 2026: the Texas region page with its embedded roster, a community page
 * with its hero, home cards and plan cards, and a promotion page. Names and
 * addresses are invented.
 */
const HOST = "https://yourviewhome.com";
const COMMUNITY = `${HOST}/communities/fixture-fields/`;
const PROMO = `${HOST}/promo-fixture-savings/`;
const NOW = new Date("2026-10-20T15:00:00Z");

type RosterHome = { street: string; plan: string; status: string; moveIn?: string; price: string; sqft: string; beds: string; baths: string; garage?: string; slug?: string; photo?: string; community?: string };
const rosterHome = (home: RosterHome) => {
  const community = home.community ?? "fixture-fields";
  const slug = home.slug ?? home.street.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    post_id: 80000 + slug.length, post_title: home.street, permalink: `${HOST}/communities/${community}/homes/${slug}/`,
    thumbnail: `${HOST}/wp-content/uploads/2026/09/${slug}-400x225.jpg`, full: home.photo ?? `${HOST}/wp-content/uploads/2026/09/${slug}.jpg`,
    community: { id: 13896, name: "Fixture Fields", link: `${HOST}/communities/${community}/` },
    plan: { id: "54468", name: home.plan, link: `${HOST}/communities/${community}/floorplans/${home.plan.toLowerCase()}/` },
    move_in: home.moveIn ?? "", status: { text: home.status }, specs: { sqft: home.sqft, beds: home.beds, baths: home.baths, garage: home.garage ?? "2", levels: "1" }, price: home.price,
  };
};
const HOMES: RosterHome[] = [
  { street: "14803 Fixture Clover", plan: "Sycamore", status: "Est. Completion- October", moveIn: "Oct 2026", price: "$345,990", sqft: "2120", beds: "3", baths: "2.5" },
  { street: "14755 Fixture Clover", plan: "Juniper", status: "Est. Completion- November", moveIn: "Nov 2026", price: "$339,990", sqft: "1965", beds: "4", baths: "2" },
  { street: "14743 Fixture Clover", plan: "Garden View", status: "Ready Now! ", price: "$329,990", sqft: "1775", beds: "4", baths: "3" },
  { street: "14735 Fixture Clover", plan: "Creek View", status: "Est. Completion- September", moveIn: "Sep 2026", price: "$309,990", sqft: "1524", beds: "4", baths: "2", photo: "https://evil.example/x.jpg" },
];
type RosterCommunity = { title: string; slug: string; status: [string, string]; street: string; city: string; zip: string; lat: string; lng: string; priceLow: number; priceText: string; homes: RosterHome[]; phone?: string };
const rosterCommunity = (community: RosterCommunity) => ({
  post_id: 13000 + community.slug.length, post_title: community.title, permalink: `${HOST}/communities/${community.slug}/`,
  thumbnail: `${HOST}/wp-content/uploads/2026/03/${community.slug}-400x267.jpg`, full: `${HOST}/wp-content/uploads/2026/03/${community.slug}.jpg`,
  status: { status: { value: community.status[0], label: community.status[1] } },
  address: { street: community.street, city: community.city, state: "TX", zip: community.zip, lat: community.lat, lng: community.lng, has_valid_coords: true },
  address_link: `https://www.google.com/maps/place/${encodeURIComponent(community.title)}/@${community.lat},${community.lng},17z/`,
  price: { value: "", text: community.priceText }, price_range: { PriceLow: community.priceLow, PriceHigh: 399_900, SqftLow: 1_522, SqftHigh: 2_608 },
  phone: community.phone ?? "(210) 555-0142", email: "sales@example.test",
  region: { term_id: 8, name: "San Antonio", slug: "san-antonio" }, thoughtful_collection: false,
  specs: { sqft_min: 1_522, sqft_max: 2_608, beds_min: 3, beds_max: 4, baths_min: 2, baths_max: 3.5 },
  homes: community.homes.map((home) => rosterHome({ ...home, community: community.slug })),
});
const FIXTURE: RosterCommunity = { title: "Fixture Fields", slug: "fixture-fields", status: ["now", "Now Selling"], street: "14515 Fixture Clover", city: "San Antonio", zip: "78253", lat: "29.5060502", lng: "-98.7824544", priceLow: 0, priceText: "Starting from the Low $300's", homes: HOMES };
const SOON: RosterCommunity = { title: "Fixture Enclave", slug: "fixture-enclave", status: ["soon", "Coming Soon"], street: "", city: "San Antonio", zip: "78240", lat: "29.526858", lng: "-98.566718", priceLow: 0, priceText: "", homes: [] };
const FAR: RosterCommunity = { title: "Fixture Mesa", slug: "fixture-mesa", status: ["now", "Now Selling"], street: "960 Fixture Dr", city: "Horizon City", zip: "79928", lat: "31.65462", lng: "-106.179398", priceLow: 214_900, priceText: "Starting from $214,900", homes: [{ street: "1 Fixture Mesa Way", plan: "Mesa", status: "Ready Now!", price: "$214,900", sqft: "1067", beds: "3", baths: "2" }], phone: "(915) 555-0199" };
function regionPage(communities: Array<ReturnType<typeof rosterCommunity>> = [rosterCommunity(FIXTURE), rosterCommunity(SOON)], far: Array<ReturnType<typeof rosterCommunity>> = [rosterCommunity(FAR)]) {
  const regions = [
    { id: 4, name: "El Paso", link: `${HOST}/region/el-paso-tx/`, contact: { phone: "(915) 555-0199" }, communities: far, center: { lat: "31.7", lng: "-106.3" }, regions: [{ id: 105, name: "Horizon City", link: `${HOST}/region/horizon-city/`, communities: far, regions: [] }] },
    { id: 8, name: "San Antonio", link: `${HOST}/region/san-antonio/`, contact: { phone: "(210) 555-0142" }, communities, center: { lat: "29.4", lng: "-98.5" }, regions: [] },
  ];
  return `<!DOCTYPE html><html><head><title>New Homes For Sale in Texas | View Homes</title></head><body><div id="communities-list-map" class="module module-communities-list-map"><div class="community-card" data-region="sanantonio"><h4 class="community-card__name">Fixture Fields</h4><a href="${COMMUNITY}" class="community-card__link"></a></div></div>
<script>if (typeof oceanFloorModules.communitiesMapList === 'undefined') { oceanFloorModules.communitiesMapList = []; } oceanFloorModules.communitiesMapList.push({ id: 'communities-list-map', map: { id: 'communities-list-map-map', icons: {"default":"<svg xmlns=\\"http:\\/\\/www.w3.org\\/2000\\/svg\\" width=\\"27\\"><path d=\\"M0 [1] {2}\\"\\/><\\/svg>"}, }, regions: ${JSON.stringify(regions).replace(/\//g, "\\/")}, formId: 'communities-map-list-form', currentPage: 'texas', });</script>
<section class="region-info"><h2>What to know about buying new in Texas</h2></section></body></html>`;
}

const homeCard = (home: RosterHome, community = "fixture-fields") => {
  const slug = home.slug ?? home.street.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `<div class="module-community-floorplans-homes__col filter__item js-filter-item" data-price="${home.price.replace(/[^\d]/g, "")}" data-sqft="${home.sqft}" data-beds="${home.beds}" data-baths="${home.baths}" data-levels="1"><div class="home-preview"><div class="home-preview__image image-fit"> <img class="br-lazy" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" data-breeze="${HOST}/wp-content/uploads/2026/09/${slug}-400x225.jpg" alt="${home.street}"><div class="home-preview__status heading-mini"><span>${home.status}</span></div></div><div class="home-preview__info"><div class="heading-h4 home-preview__title">${home.street}</div><div class="home-preview__plan-wrap"><div class="home-preview__plan"><b>Plan: </b>${home.plan}</div>${home.moveIn ? `<div class="home-preview__move_in"><b>Move In: </b>${home.moveIn}</div>` : ""}</div><div class="home-preview__price">${home.price}</div><div class="home-preview__specs"><div class="home-preview__spec"><div class="home-preview__spec-value"> ${home.sqft}</div><div class="home-preview__spec-label">Sq. Ft.</div></div><div class="home-preview__spec"><div class="home-preview__spec-value">${home.beds}</div><div class="home-preview__spec-label">Beds</div></div><div class="home-preview__spec"><div class="home-preview__spec-value">${home.baths}</div><div class="home-preview__spec-label">Baths</div></div><div class="home-preview__spec"><div class="home-preview__spec-value">2</div><div class="home-preview__spec-label">Garage</div></div></div> <a class="home-preview__link no-style" href="${HOST}/communities/${community}/homes/${slug}/">View Details</a></div></div></div>`;
};
const planCard = (name: string, price: string | null, status: string | null, href = `${HOST}/communities/fixture-fields/floorplans/${name.toLowerCase().replace(/\s+/g, "-")}/`) => `<div class="module-community-floorplans-homes__col grid__col" data-price="301990" data-sqft="1,522" data-beds="4" data-baths="2" data-levels="1"><div class="floorplan-preview"><div class="floorplan-preview__image image-fit"> <img class="br-lazy" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" data-breeze="${HOST}/wp-content/uploads/2026/03/Plan-${name.replace(/\s+/g, "-")}-Elevation-D-400x250.jpg" alt="${name}">${status ? `<div class="floorplan-preview__status heading-mini"><span>${status}</span></div>` : ""}</div><div class="floorplan-preview__info"><div class="heading-h4 floorplan-preview__title">${name}</div>${price ? `<div class="floorplan-preview__price"> Starting From ${price}</div>` : ""}<div class="floorplan-preview__specs"><div class="floorplan-preview__spec"><div class="floorplan-preview__spec-value">1,522</div><div class="floorplan-preview__spec-label">Sq. Ft.</div></div><div class="floorplan-preview__spec"><div class="floorplan-preview__spec-value">4</div><div class="floorplan-preview__spec-label">Beds</div></div><div class="floorplan-preview__spec"><div class="floorplan-preview__spec-value">2</div><div class="floorplan-preview__spec-label">Baths</div></div><div class="floorplan-preview__spec"><div class="floorplan-preview__spec-value">2</div><div class="floorplan-preview__spec-label">Garage</div></div></div> <a class="floorplan-preview__link no-style" href="${href}">View Details</a></div></div></div>`;
type PageInput = { name?: string; heroStatus?: string; address?: string; startingPrice?: string | null; canonical?: string | null; module?: boolean; homes?: RosterHome[] | null; cards?: string[]; plans?: string[]; banner?: string | null };
function communityPage(input: PageInput = {}) {
  const homes = input.homes === undefined ? HOMES : input.homes;
  const cards = input.cards ?? (homes ?? []).map((home) => homeCard(home));
  const tab = homes === null ? "" : `<div class="tabs__title js-tabs-title is-active" data-slug="homes" data-text="Available Homes">Available Homes</div>`;
  const slide = homes === null ? "" : `<div class="swiper-slide" id="homes"><div class="container filter js-filter"><div class="tabs__content-header"><div class="tabs__content-heading heading heading-mini"> Available Homes</div><div class="module-community-floorplans-homes__grid js-filter-items"><div class="filter__gutter js-filter-gutter"></div>${cards.join("")}</div><div class="filter__no-results js-filter-no-results"><h3>No Results Found</h3></div></div></div></div>`;
  const module = input.module === false ? "" : `<div id="floorplans" class="module module-community-floorplans-homes floorplans js-community-floorplans-homes "><div class="module__container"><div class="module-community-floorplans-homes__header container"><h2 class="heading-h2"> Available Homes + Home Designs</h2></div><div class="module-community-floorplans-homes__tabs tabs js-tabs" id="floorplans-tabs"><div class="tabs__titles-wrap container"><div class="tabs__titles js-tabs-titles">${tab}<div class="tabs__title js-tabs-title" data-slug="homedesigns" data-text="Home Designs">Home Designs</div></div></div><div class="tabs__content swiper-container js-tabs-content"><div class="swiper-wrapper">${slide}<div class="swiper-slide" id="Home Designs"><div class="container"><div class="tabs__content-header"><div class="tabs__content-heading heading heading-mini">Home Designs</div><div class="module-community-floorplans-homes__grid grid grid--fixed-4">${(input.plans ?? [planCard("Creek View", "$301,990", "New Floor Plan!"), planCard("Garden View", "$328,990", "Inventory Only"), planCard("Sycamore", null, "Model")]).join("")}</div></div></div></div></div></div></div></div></div>`;
  const banner = input.banner === undefined ? PROMO : input.banner;
  return `<!DOCTYPE html><html><head><title>${input.name ?? "Fixture Fields"}: New Homes For Sale in San Antonio | View Homes</title>${input.canonical === null ? "" : `<link rel="canonical" href="${input.canonical ?? COMMUNITY}" />`}<script type="application/ld+json">{"@context":"https:\\/\\/schema.org","@graph":[{"@type":"WebPage","@id":"${COMMUNITY}","url":"${COMMUNITY}","name":"Fixture Fields: New Homes For Sale in San Antonio"}]}</script></head><body>
${banner ? `<div class="banner-ad container"> <a href="${banner}" class="banner-ad__link"> <img class="banner-ad__image br-lazy" src="data:," data-breeze="${HOST}/wp-content/uploads/2026/09/Promo_2000x287.jpg" alt=""></a></div>` : ""}
<div id="community-hero" class="module module-community-hero hero js-hero"><div class="module__container"><div class="module-community-hero__contents"><div class="community-hero__slider hero__slider swiper-container"><div class="swiper-wrapper"><div class="module-community-hero__slide swiper-slide"><div class="module-community-hero__image hero__image"> <img class="br-lazy" src="data:," data-breeze="${HOST}/wp-content/uploads/2023/04/hero-400x267.jpg" alt=""></div></div></div></div><div class="hero__content"><div class="hero__statuses"><div class="hero__status status bg-color-secondary">${input.heroStatus ?? "Now Selling"}</div></div><h1 class="hero__heading hero__heading--cfh heading-h1 color-white js-hero-title">Welcome to<br>${input.name ?? "Fixture Fields"}</h1> <a href="tel:(210) 555-0142" class=" color-white">(210) 555-0142</a> <span class="hero__text color-white"> - </span> <a target="_blank" href="https://www.google.com/maps/place/Fixture+Fields+by+View+Homes/@29.5060502,-98.7824544,17z/data=!3m1" class="color-white notranslate"> ${input.address ?? "14515 Fixture Clover, San Antonio, TX 78253"} </a><div class="hero__meta">${input.startingPrice === null ? "" : `<div class="hero__meta-item"><div class="hero__meta-value">${input.startingPrice ?? "$309,990"}</div><div class="hero__meta-label">Starting Price</div></div>`}<div class="hero__meta-item"><div class="hero__meta-value">1524 - 2608</div><div class="hero__meta-label">Sq. Ft.</div></div><div class="hero__meta-item"><div class="hero__meta-value">3 - 4</div><div class="hero__meta-label">Beds</div></div></div></div></div></div></div>
<div id="overview" class="module module-two-column overview"><div class="content"><p>Fixture Fields is a new home community in San Antonio, TX, zoned to Medina Valley ISD. Homes start from the low $300s on 50' homesites.</p></div></div>
${module}
<div id="contact" class="module module-contact contact"><p>Fixture Fields Model Home: 14515 Fixture Clover, San Antonio, TX 78253. Call (210) 555-0142.</p></div>
<footer><p>&copy; 2026 View Homes. Msg &amp; data rates may apply.</p></footer></body></html>`;
}
function promoPage(input: { communities?: string[]; option?: string | null; disclaimer?: string[] } = {}) {
  const communities = input.communities ?? [`${HOST}/communities/fixture-fields/`, `${HOST}/communities/fixture-ridge/`];
  const option = input.option === undefined ? "Lower rates could mean more buying power this fall. Purchase a quick move-in home closing by 11/30 and choose a 5.25%* Fixed-Rate or up to $55,000** in flex cash! <br>" : input.option;
  const disclaimer = input.disclaimer ?? ["*FHA –&nbsp;5.25% (5.993% APR) based on 3.5% down payment", "VA –&nbsp;5.25% (5.465% APR) based on 0% down payment", "*For a limited time, View Homes is offering below-market interest rates valid on new home contracts for eligible properties entered into as of 10/30/2026 closing by 11/30/2026 (the “Promotion”). View Homes has locked in, through View Homes Lending (NMLS #123456), fixed interest rates using a pool of funds. Call (210) 555-0142 or visit www.yourviewhome.com for details.", "**For a limited time, View Homes is offering flex cash UP TO 10% of the home’s sales price that can be applied toward rate buydown, appliances, closing costs, or additional Realtor commission. Void where prohibited by law."];
  return `<!DOCTYPE html><html><head><title>Save on Quick Move-In Homes | Limited Time 5.25% Fixed Rate</title><link rel="canonical" href="${PROMO}" /></head><body><section class="promo-overview"><div class="promo-overview__inner container"><div class="promo-overview__copy"><div class="promo-overview__sub-heading heading-mini">New Season. New Home.</div><h2 class="promo-overview__heading heading-h2">Autumn Is Here with Fresh Savings on Your New Home</h2><div class="promo-overview__highlight">On Select Homes Closing by 11/30</div><div class="promo-overview__content content"><div>Move into a new View Home this fall and take advantage of limited-time incentives on select Quick Move-In Homes throughout Greater San Antonio.</div></div><div class="promo-overview__options"><div class="promo-overview__option"><div class="promo-overview__option-label">Fixture Savings!</div><h3 class="promo-overview__option-title">Choose a Below-Market Rate or Flex Cash to Use Your Way!</h3>${option === null ? "" : `<p class="promo-overview__option-text">${option}</p>`}</div></div></div><div id="promo-form" class="promo-overview__form"><form method="post"><input name="input_32" type="text"></form></div></div></section>
<section class="promo-info"><div class="promo-info__communities"><h3 class="promo-info__communities-heading">Participating Communities</h3><div class="promo-info__communities-panel"><div class="promo-info__region"><div class="promo-info__region-name">San Antonio</div><ul class="promo-info__community-list">${communities.map((url) => `<li> <a href="${url}">Community</a></li>`).join("")}<li> <a href="https://evil.example/communities/fixture-fields/">Elsewhere</a></li></ul></div></div></div></section>
<footer class="PromoFooter"><div class="PromoFooter__disclaimer content">${disclaimer.map((text) => `<p class="x_x_xmsonormal"><span>${text}</span></p>`).join("")}</div></footer></body></html>`;
}

const site: Record<string, string> = { [COMMUNITY]: communityPage(), [viewHomesListingUrl()]: regionPage(), [PROMO]: promoPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "View Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Fields", scrubList: ["Fixture Fields", "Fixture Clover"] };
/** A fetcher serving the given community page with the standard roster and promo page. */
const withPage = (page: string, overrides: Record<string, string | null> = {}) => vi.fn(async (input: string) => {
  const body = input === COMMUNITY ? page : (input in overrides ? overrides[input] : site[input]);
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; resetViewHomesCaches(); });

describe("View Homes reader: statuses", () => {
  it("reads ready-now, the estimated completion month with its move-in year, a passed month as an undated quick move-in, sold, and holds on other wording", () => {
    expect(viewHomesStatus("Ready Now! ", "", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(viewHomesStatus("Move-In Ready", null, NOW)).toMatchObject({ readyNow: true });
    expect(viewHomesStatus("Est. Completion- October", "Oct 2026", NOW)).toEqual({ status: "Quick Move-In (October 2026)", readyNow: false, moveInDate: "October 2026" });
    expect(viewHomesStatus("Est. Completion- November", "Move In: Nov 2026", NOW)).toEqual({ status: "Quick Move-In (November 2026)", readyNow: false, moveInDate: "November 2026" });
    expect(viewHomesStatus("Est. Completion- January", "Jan 2027", NOW)).toEqual({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    // The move-in line names the year; a month that has passed is a stale estimate with no date.
    expect(viewHomesStatus("Est. Completion- September", "Sep 2026", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    // Without the line the badge's month is the next such month: this year's at or after the current month, next year's before it.
    expect(viewHomesStatus("Est. Completion- December", "", NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(viewHomesStatus("Est. Completion- October", null, NOW)).toEqual({ status: "Quick Move-In (October 2026)", readyNow: false, moveInDate: "October 2026" });
    expect(viewHomesStatus("Est. Completion- March", null, NOW)).toEqual({ status: "Quick Move-In (March 2027)", readyNow: false, moveInDate: "March 2027" });
    expect(viewHomesStatus("Est. Completion- January", null, NOW)).toEqual({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    // A move-in line that names another month than the badge is the newer figure.
    expect(viewHomesStatus("Est. Completion- October", "Dec 2026", NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(viewHomesStatus("Sold", null, NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    expect(viewHomesStatus("Under Contract", null, NOW)).toMatchObject({ status: "Sold" });
    for (const label of ["", "Model", "Coming Soon", "Est. Completion- Soon", "Reserved"]) expect(viewHomesStatus(label, "Oct 2026", NOW).status, label).toBeNull();
    expect(viewHomesStatus("Est. Completion- October 2099", null, NOW).status).toBeNull();
    expect(viewHomesStatus("Est. Completion- January 2027", null, NOW)).toEqual({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    expect(viewHomesStatus("Est. Completion- October", "Octember 2026", NOW).status).toBeNull();
    expect(viewHomesStatus("Est. Completion- October", "Oct 2099", NOW).status).toBeNull();
  });
});

describe("View Homes reader: roster", () => {
  it("reads every Texas community once with its record, status and homes for sale (nested regions folded, other hosts left out)", () => {
    const roster = parseViewHomesRoster(regionPage(), "yourviewhome.com")!;
    expect(roster.map((row) => [row.url, row.status, row.record.name, row.record.street, row.record.city, row.record.zip, row.record.phone, row.record.priceFrom, row.record.geo, row.homes.length])).toEqual([
      [`${HOST}/communities/fixture-mesa/`, { value: "now", label: "Now Selling" }, "Fixture Mesa", "960 Fixture Dr", "Horizon City", "79928", "9155550199", 214_900, { lat: 31.65462, lng: -106.179398 }, 1],
      [COMMUNITY, { value: "now", label: "Now Selling" }, "Fixture Fields", "14515 Fixture Clover", "San Antonio", "78253", "2105550142", null, { lat: 29.5060502, lng: -98.7824544 }, 4],
      [`${HOST}/communities/fixture-enclave/`, { value: "soon", label: "Coming Soon" }, "Fixture Enclave", null, "San Antonio", "78240", "2105550142", null, { lat: 29.526858, lng: -98.566718 }, 0],
    ]);
    expect(roster[1]!.homes[0]).toEqual({ url: `${COMMUNITY}homes/14803-fixture-clover/`, street: "14803 Fixture Clover", plan: "Sycamore", statusText: "Est. Completion- October", moveIn: "Oct 2026", price: 345_990, squareFeet: 2_120, bedrooms: 3, bathrooms: 2.5, garage: 2, photo: `${HOST}/wp-content/uploads/2026/09/14803-fixture-clover.jpg` });
    // A photo off the official host falls back to the thumbnail on it.
    expect(roster[1]!.homes[3]!.photo).toBe(`${HOST}/wp-content/uploads/2026/09/14735-fixture-clover-400x225.jpg`);
    // A coming-soon row has nothing to read yet and is left out of discovery.
    expect(viewHomesListingEntries(regionPage(), "yourviewhome.com")!.map((entry) => [entry.url, entry.record.street])).toEqual([[`${HOST}/communities/fixture-mesa/`, "960 Fixture Dr"], [COMMUNITY, "14515 Fixture Clover"]]);
  });

  it("reads nothing from a page without the roster script, with unbalanced JSON or with another host's rows", () => {
    expect(parseViewHomesRoster("<html><body>new layout</body></html>", "yourviewhome.com")).toBeNull();
    expect(parseViewHomesRoster(`<script>oceanFloorModules.communitiesMapList.push({ regions: [{"id": 1, "communities": [ </script>`, "yourviewhome.com")).toBeNull();
    const foreign = regionPage([{ ...rosterCommunity(FIXTURE), permalink: "https://evil.example/communities/fixture-fields/" }], []);
    expect(parseViewHomesRoster(foreign, "yourviewhome.com")).toEqual([]);
    expect(viewHomesListingEntries(regionPage([], []), "yourviewhome.com")).toEqual([]);
  });
});

describe("View Homes reader: community page", () => {
  it("reads the hero (name, status, address, phone, starting price), the home card links, the plan cards and the promotion banner", () => {
    const page = parseViewHomesCommunity(communityPage(), COMMUNITY)!;
    expect(page).toMatchObject({ name: "Fixture Fields", heroStatus: "Now Selling", street: "14515 Fixture Clover", city: "San Antonio", zip: "78253", phone: "2105550142", priceFrom: 309_990, foreignPage: false, hasModule: true, hasHomesTab: true, foreignHome: false, foreignPlan: false, promoUrl: PROMO });
    expect(page.homeUrls).toEqual(HOMES.map((home) => `${COMMUNITY}homes/${home.street.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/`));
    expect(page.plans.map((plan) => [plan.sourceUrl, plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.garage, plan.status, plan.gallery?.map((image) => image.sourceUrl)])).toEqual([
      [`${COMMUNITY}floorplans/creek-view/`, "Creek View", 301_990, 4, 2, 1_522, 2, null, [`${HOST}/wp-content/uploads/2026/03/Plan-Creek-View-Elevation-D.jpg`]],
      [`${COMMUNITY}floorplans/garden-view/`, "Garden View", 328_990, 4, 2, 1_522, 2, null, [`${HOST}/wp-content/uploads/2026/03/Plan-Garden-View-Elevation-D.jpg`]],
      [`${COMMUNITY}floorplans/sycamore/`, "Sycamore", null, 4, 2, 1_522, 2, null, [`${HOST}/wp-content/uploads/2026/03/Plan-Sycamore-Elevation-D.jpg`]],
    ]);
  });

  it("reads a coming-soon page with only a city line and no module tab, a page without the starting price, and flags foreign links and a canonical elsewhere", () => {
    const soon = parseViewHomesCommunity(communityPage({ name: "Fixture Enclave", heroStatus: "Coming Soon", address: "San Antonio, TX 78240", startingPrice: null, homes: null, plans: [] }), COMMUNITY)!;
    expect(soon).toMatchObject({ name: "Fixture Enclave", heroStatus: "Coming Soon", street: null, city: "San Antonio", zip: "78240", priceFrom: null, hasModule: true, hasHomesTab: false, homeUrls: [], plans: [] });
    expect(parseViewHomesCommunity(communityPage({ address: "767 Fixture Ave., New Braunfels, TX 78130" }), COMMUNITY)).toMatchObject({ street: "767 Fixture Ave.", city: "New Braunfels", zip: "78130" });
    expect(parseViewHomesCommunity(communityPage({ cards: [homeCard(HOMES[0]!, "fixture-ridge")] }), COMMUNITY)).toMatchObject({ foreignHome: true, homeUrls: [] });
    expect(parseViewHomesCommunity(communityPage({ plans: [planCard("Zinnia", "$1", null, `${HOST}/communities/fixture-ridge/floorplans/zinnia/`)] }), COMMUNITY)).toMatchObject({ foreignPlan: true, plans: [] });
    expect(parseViewHomesCommunity(communityPage({ canonical: `${HOST}/communities/fixture-ridge/` }), COMMUNITY)).toMatchObject({ foreignPage: true });
    expect(parseViewHomesCommunity(communityPage({ canonical: null }), COMMUNITY)).toMatchObject({ foreignPage: false });
    expect(parseViewHomesCommunity(communityPage({ module: false }), COMMUNITY)).toMatchObject({ hasModule: false, hasHomesTab: false });
    expect(parseViewHomesCommunity(communityPage({ banner: "https://evil.example/promo/" }), COMMUNITY)).toMatchObject({ promoUrl: null });
    expect(parseViewHomesCommunity("<html><body><h1>New layout</h1></body></html>", COMMUNITY)).toBeNull();
  });
});

describe("View Homes reader: promotion page", () => {
  it("reads the offer (headline, option and footnotes, with links, phones, NMLS ids and footnote marks gone) and the participating communities on the official host", () => {
    const promo = parseViewHomesPromo(promoPage(), PROMO)!;
    expect(promo.communityUrls).toEqual([COMMUNITY, `${HOST}/communities/fixture-ridge/`]);
    expect(promo.hasCommunityList).toBe(true);
    // A "www." link names the same page on the apex host.
    expect(parseViewHomesPromo(promoPage({ communities: ["https://www.yourviewhome.com/communities/fixture-fields/"] }), PROMO)!.communityUrls).toEqual([COMMUNITY]);
    expect(promo.text).toBe("On Select Homes Closing by 11/30 Fixture Savings! Choose a Below-Market Rate or Flex Cash to Use Your Way! Lower rates could mean more buying power this fall. Purchase a quick move-in home closing by 11/30 and choose a 5.25% Fixed-Rate or up to $55,000 in flex cash! FHA – 5.25% (5.993% APR) based on 3.5% down payment VA – 5.25% (5.465% APR) based on 0% down payment For a limited time, View Homes is offering below-market interest rates valid on new home contracts for eligible properties entered into as of 10/30/2026 closing by 11/30/2026 (the “Promotion”). View Homes has locked in, through View Homes Lending, fixed interest rates using a pool of funds. Call or visit for details. For a limited time, View Homes is offering flex cash UP TO 10% of the home’s sales price that can be applied toward rate buydown, appliances, closing costs, or additional Realtor commission. Void where prohibited by law.");
    expect(promo.text).not.toMatch(/555|NMLS|123456|yourviewhome\.com/);
    // A page without the offer section is not a promotion; one whose copy names no rate or amount says nothing.
    expect(parseViewHomesPromo("<html><body><h1>New layout</h1></body></html>", PROMO)).toBeNull();
    expect(parseViewHomesPromo(promoPage({ option: null, disclaimer: ["Terms apply."] }), PROMO)).toMatchObject({ text: null, communityUrls: [COMMUNITY, `${HOST}/communities/fixture-ridge/`] });
    expect(parseViewHomesPromo(promoPage().replace(/<section class="promo-info">[\s\S]*?<\/section>/, ""), PROMO)).toMatchObject({ communityUrls: [], hasCommunityList: false });
  });
});

describe("View Homes reader: adapter", () => {
  it("is registered under its builder id", () => {
    expect(DEAL_ADAPTERS["View Homes"]).toBeInstanceOf(ViewHomesAdapter);
    expect(DEAL_ADAPTERS["View Homes"].builder).toBe("View Homes");
  });

  it("publishes the roster's homes for the page (statuses with the move-in year, prices, specs, photo), the page's plans, the facts and the promotion that names the community", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    // The promotion names no repayment term, so the offer (not the catalog) waits for a look.
    expect(result.holdReasons).toEqual(["missing_repayment_term"]);
    expect(result.catalogOk).toBe(true);
    expect(requested).toEqual([COMMUNITY, viewHomesListingUrl(), PROMO]);
    const { private: privateSnapshot, public: snapshot } = result;
    expect(privateSnapshot.homes.map((home) => [home.sourceUrl, home.privateAddress, home.privatePlanName, home.status, home.readyNow, home.moveInDate, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.garage, home.gallery?.map((image) => image.sourceUrl)])).toEqual([
      [`${COMMUNITY}homes/14803-fixture-clover/`, "14803 Fixture Clover, San Antonio, TX 78253", "Sycamore", "Quick Move-In (October 2026)", false, "October 2026", 345_990, 3, 2.5, 2_120, 2, [`${HOST}/wp-content/uploads/2026/09/14803-fixture-clover.jpg`]],
      [`${COMMUNITY}homes/14755-fixture-clover/`, "14755 Fixture Clover, San Antonio, TX 78253", "Juniper", "Quick Move-In (November 2026)", false, "November 2026", 339_990, 4, 2, 1_965, 2, [`${HOST}/wp-content/uploads/2026/09/14755-fixture-clover.jpg`]],
      [`${COMMUNITY}homes/14743-fixture-clover/`, "14743 Fixture Clover, San Antonio, TX 78253", "Garden View", "Quick Move-In (Move-In Ready)", true, null, 329_990, 4, 3, 1_775, 2, [`${HOST}/wp-content/uploads/2026/09/14743-fixture-clover.jpg`]],
      [`${COMMUNITY}homes/14735-fixture-clover/`, "14735 Fixture Clover, San Antonio, TX 78253", "Creek View", "Quick Move-In", false, null, 309_990, 4, 2, 1_524, 2, [`${HOST}/wp-content/uploads/2026/09/14735-fixture-clover-400x225.jpg`]],
    ]);
    expect(new Set(privateSnapshot.homes.map((home) => normalizedDealSourceKey(home.sourceUrl))).size).toBe(4);
    expect(privateSnapshot.plans.map((plan) => plan.privatePlanName)).toEqual(["Creek View", "Garden View", "Sycamore"]);
    expect(privateSnapshot.communityFacts).toMatchObject({ fromPrice: 309_990, schoolDistrict: "Medina Valley ISD" });
    expect(privateSnapshot.incentive?.sourceUrl).toBe(COMMUNITY);
    expect(privateSnapshot.incentive?.text).toContain("5.25% Fixed-Rate or up to $55,000 in flex cash");
    expect(privateSnapshot.incentive?.facts).toMatchObject({ rateKind: "fixed", promotionalRatePercent: 5.25, aprPercent: 5.993, loanType: "FHA", downPaymentPercent: 3.5, repaymentTermYears: null, contractDeadline: null, closingDeadline: { raw: "11/30/2026", isoDate: "2026-11-30" }, holdReasons: ["missing_repayment_term"] });
    expect(privateSnapshot.pages.map((page) => page.kind)).toEqual(["community", "home", "home", "home", "home", "plan", "plan", "plan", "incentive"]);
    expect(snapshot.homes).toHaveLength(4);
    expect(snapshot.plans).toHaveLength(3);
    // The held offer is not published until it is accepted.
    expect(snapshot.incentive).toBeNull();
    expect(JSON.stringify(snapshot)).not.toMatch(/Fixture Clover|14803|555-0142|yourviewhome/);
  });

  it("reads the roster and the promotion once per run, and leaves the offer out of a community the promotion does not name", async () => {
    await loadOfficialDeals(config, { fetcher, now: () => NOW });
    const ridge = `${HOST}/communities/fixture-ridge/`;
    const ridgeConfig = { ...config, sourceUrl: ridge, privateCommunityName: "Fixture Ridge" };
    site[ridge] = communityPage({ name: "Fixture Ridge", homes: null, plans: [planCard("Zinnia", "$401,990", null, `${ridge}floorplans/zinnia/`)] }).replaceAll(`<link rel="canonical" href="${COMMUNITY}" />`, `<link rel="canonical" href="${ridge}" />`);
    const other = `${HOST}/communities/fixture-other/`;
    site[other] = communityPage({ name: "Fixture Other", homes: null, plans: [] }).replaceAll(`<link rel="canonical" href="${COMMUNITY}" />`, `<link rel="canonical" href="${other}" />`);
    site[viewHomesListingUrl()] = regionPage([rosterCommunity(FIXTURE), rosterCommunity({ ...FIXTURE, title: "Fixture Ridge", slug: "fixture-ridge", homes: [] }), rosterCommunity({ ...FIXTURE, title: "Fixture Other", slug: "fixture-other", homes: [] })]);
    resetViewHomesCaches();
    requested.length = 0;
    try {
      const first = await loadOfficialDeals(config, { fetcher, now: () => NOW });
      const second = await loadOfficialDeals(ridgeConfig, { fetcher, now: () => NOW });
      const third = await loadOfficialDeals({ ...config, sourceUrl: other, privateCommunityName: "Fixture Other" }, { fetcher, now: () => NOW });
      expect([first.catalogOk, second.catalogOk, third.catalogOk]).toEqual([true, true, true]);
      expect([first.holdReasons, second.holdReasons, third.holdReasons]).toEqual([["missing_repayment_term"], ["missing_repayment_term"], []]);
      expect(requested).toEqual([COMMUNITY, viewHomesListingUrl(), PROMO, ridge, other]);
      expect(second.private.incentive?.text).toContain("flex cash");
      expect(second.private.homes).toEqual([]);
      expect(third.private.incentive).toBeNull();
      expect(third.public.incentive).toBeNull();
    } finally {
      delete site[ridge];
      delete site[other];
      site[viewHomesListingUrl()] = regionPage();
    }
  });

  it("publishes nothing for a coming-soon community and nothing for one the roster lists without homes", async () => {
    const soon = `${HOST}/communities/fixture-enclave/`;
    const page = communityPage({ name: "Fixture Enclave", heroStatus: "Coming Soon", address: "San Antonio, TX 78240", startingPrice: null, homes: null, plans: [], banner: null }).replaceAll(`<link rel="canonical" href="${COMMUNITY}" />`, `<link rel="canonical" href="${soon}" />`);
    const result = await loadOfficialDeals({ ...config, sourceUrl: soon, privateCommunityName: "Fixture Enclave" }, { fetcher: withPage("", { [soon]: page }), now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toEqual([]);
    expect(result.private.plans).toEqual([]);
    expect(result.private.incentive).toBeNull();
    expect(result.public.homes).toEqual([]);
  });

  it("holds when the page is not a community page, when it or its links belong to another community, when the roster is missing or does not list it, and when the cards and the roster disagree", async () => {
    const load = (page: string, overrides: Record<string, string | null> = {}) => { resetViewHomesCaches(); return loadOfficialDeals(config, { fetcher: withPage(page, overrides), now: () => NOW }); };
    expect((await load("<html><body>new layout</body></html>")).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ module: false }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ canonical: `${HOST}/communities/fixture-ridge/` }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ cards: [homeCard(HOMES[0]!, "fixture-ridge")] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ plans: [planCard("Zinnia", "$1", null, `${HOST}/communities/fixture-ridge/floorplans/zinnia/`)] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    // The roster: unreachable, unreadable, or without the page's community.
    expect((await load(communityPage(), { [viewHomesListingUrl()]: null })).holdReasons).toEqual(["community_fetch_failed"]);
    expect((await load(communityPage(), { [viewHomesListingUrl()]: "<html><body>new layout</body></html>" })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage(), { [viewHomesListingUrl()]: regionPage([rosterCommunity(SOON)]) })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // The cards and the roster must be the same set: a card missing, a card too many, a renamed street, or an "Available Homes" tab with no cards at all.
    expect((await load(communityPage({ cards: HOMES.slice(0, 3).map((home) => homeCard(home)) }))).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load(communityPage(), { [viewHomesListingUrl()]: regionPage([rosterCommunity({ ...FIXTURE, homes: HOMES.slice(0, 3) })]) })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load(communityPage({ cards: [...HOMES.slice(0, 3), { ...HOMES[3]!, street: "14735 Other Clover" }].map((home) => homeCard(home)) }))).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load(communityPage({ cards: [] }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A home with wording the reader does not know holds the run through the sync's status rule.
    const unknown = await load(communityPage({ homes: [...HOMES, { ...HOMES[0]!, street: "9 Fixture Way", status: "Reserved" }] }), { [viewHomesListingUrl()]: regionPage([rosterCommunity({ ...FIXTURE, homes: [...HOMES, { ...HOMES[0]!, street: "9 Fixture Way", status: "Reserved" }] })]) });
    expect(unknown.catalogOk).toBe(true);
    expect(unknown.private.homes.find((home) => home.privateName === "9 Fixture Way")?.status).toBeNull();
    // The promotion page: unreachable or changed holds the offer only; a banner elsewhere is no offer.
    const noPromo = await load(communityPage(), { [PROMO]: null });
    expect(noPromo.holdReasons).toEqual(["incentive_fetch_failed"]);
    expect(noPromo.catalogOk).toBe(true);
    expect(noPromo.incentiveHoldReasons).toEqual(["incentive_fetch_failed"]);
    expect(noPromo.private.homes).toHaveLength(4);
    const changedPromo = await load(communityPage(), { [PROMO]: "<html><body>new layout</body></html>" });
    expect(changedPromo.incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
    expect((await load(communityPage({ banner: null }))).private.incentive).toBeNull();
    // A promotion page with the offer but no participating-communities block is a changed page: the offer holds.
    const noList = await load(communityPage(), { [PROMO]: promoPage().replace(/<section class="promo-info">[\s\S]*?<\/section>/, "") });
    expect(noList.incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
    expect(noList.private.incentive).toBeNull();
    // Hosts and fetch failures.
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://www.yourviewhome.com/communities/fixture-fields/" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("busy", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("holds a community with more homes for sale than the cap", async () => {
    const many = Array.from({ length: 151 }, (_, index) => ({ ...HOMES[2]!, street: `${100 + index} Fixture Clover` }));
    const result = await loadOfficialDeals(config, { fetcher: withPage(communityPage({ homes: many }), { [viewHomesListingUrl()]: regionPage([rosterCommunity({ ...FIXTURE, homes: many })]) }), now: () => NOW });
    expect(result.holdReasons).toEqual(["incomplete_inventory"]);
  });
});
