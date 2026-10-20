import { beforeEach, describe, expect, it, vi } from "vitest";
import { AshtonWoodsAdapter, ashtonListingEntries, ashtonRecord, ashtonStatus, parseAshtonCommunity } from "./dealsAdapters.ashton";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Ashton Woods community page in the shape the live site served in
 * October 2026: series cards for the plans, property cards for the homes with
 * a status line, a two-line title, a struck-through price and a feature list;
 * the business record in JSON-LD; the division map as the listing. Names and
 * addresses are invented.
 */
const HOST = "https://www.ashtonwoods.com";
const COMMUNITY = `${HOST}/san-antonio/fixture-hollow`;
const NOW = new Date("2026-10-20T12:00:00Z");
const ld = (record: unknown) => `<script type="application/ld+json">${JSON.stringify(record)}</script>`;
const business = ld({ "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", name: "Fixture Hollow By Ashton Woods", brand: "Ashton Woods", description: "Discover new homes.", url: COMMUNITY, address: { "@type": "PostalAddress", streetAddress: "14738 Fixture Pass", addressLocality: "San Antonio", addressRegion: "TX", postalCode: "78252", addressCountry: "USA" } });
const icon = (name: string) => `<img class="icon" alt="icon" src="/assets/icons/${name}.svg">`;
const series = (input: { name: string; price: number; beds: number; baths: number; sqft: number }) => `
<div class="property-card property-card--is-series js-property-card ">
  <div class="js-carousel card-image-carousel js-carousel--dots-limited card-image-carousel--tab-element"><a href="/san-antonio/preserve-at-fixture-hollow/preserve-at-fixture-hollow-${input.name.toLowerCase()}"><div class="property-card__image"><picture><img src="https://awh.widen.net/content/plan${input.name}/jpeg/cms_${input.name}.jpg?w=758&amp;h=501&amp;crop=yes"></picture></div></a></div>
  <div class="property-card__main"><div class="property-card__header property-card__header--flag-exists"><h4 class="property-card__title"><a href="/san-antonio/preserve-at-fixture-hollow/preserve-at-fixture-hollow-${input.name.toLowerCase()}">${input.name}</a></h4></div>
  <div class="property-card__body"><div class="property-card__price">From $${input.price.toLocaleString("en-US")}</div>
  <ul class="property-card__feature-list property-card__feature-list--has-icons"><li>${icon("bed")}<span class="text">${input.beds} Beds</span></li><li>${icon("bath")}<span class="text">${input.baths} Baths</span></li><li>${icon("sqft")}<span class="text">${input.sqft} sq. ft.</span></li><li>${icon("stairs")}<span class="text">1 Story</span></li><li>${icon("garage")}<span class="text">2 Car Garage</span></li></ul></div></div>
</div>`;
const home = (input: { id: string; street: string; zip: string; plan: string; price: number; was?: number; status: string; beds: number; baths: number; sqft: number; link?: boolean }) => `
<div class="property-card js-property-card " data-property-id="${input.id}" data-property-image-url="https://awh.widen.net/content/h${input.id}/jpeg/cms_${input.id}-1.jpg?w=1027">
  <div class="card-image-carousel--tab-element"><div class="js-carousel card-image-carousel"><a href="/san-antonio/preserve-at-fixture-hollow/preserve-at-fixture-hollow-${input.plan.toLowerCase()}/${input.street.toLowerCase().replace(/\s+/g, "-")}"><div class="js-carousel__slider card-image-carousel__slider">
    <div class="property-card__image"><picture><source media="(max-width: 992px)" srcset="https://awh.widen.net/content/h${input.id}/jpeg/cms_${input.id}-1.jpg?w=493"><img src="https://awh.widen.net/content/h${input.id}/jpeg/cms_${input.id}-1.jpg?w=758&amp;h=501&amp;crop=yes&amp;keep=c&amp;quality=80"></picture><span class="visually-hidden">${input.plan}</span></div>
    <div class="property-card__image"><picture><img src="https://awh.widen.net/content/h${input.id}/webp/cms_kitchen.png?w=758"></picture></div>
  </div></a></div></div>
  <div class="property-card__main"><div class="d-flex flex-column flex-lg-row justify-content-between w-100">
    <div class="property-card__head-action order-lg-2"><ul class="property-card__action-list"><li class="property-card__action-item"><button class="property-card__action" type="button" data-community-id="1114" data-qmi-id="${input.id}"><span class="text">Request Info</span></button></li></ul></div>
    <div class="d-flex flex-column"><div class="property-card__head"><div class="property-card__head-info">
      <div class="property-card__body-title"><svg></svg> ${input.status} </div>
      <div class="property-card__header"><div class="property-card__heading"><h4 class="property-card__title property-card__title--small">${input.link === false ? `${input.street} <br> San Antonio, TX ${input.zip}` : `<a href="/san-antonio/preserve-at-fixture-hollow/preserve-at-fixture-hollow-${input.plan.toLowerCase()}/${input.street.toLowerCase().replace(/\s+/g, "-")}">${input.street} <br> San Antonio, TX ${input.zip}</a>`}</h4></div></div>
    </div></div>
    <div class="property-card__body"><div class="property-card__body-section">
      <div class="property-card__price">${input.was ? `<span class="property-card__price--strike"> $${input.was.toLocaleString("en-US")} </span> <span class="property-card__price--red"> $${input.price.toLocaleString("en-US")} </span> <span class="image-content__flag">Price Reduced</span>` : ` $${input.price.toLocaleString("en-US")} `}</div>
      <ul class="property-card__feature-list property-card__feature-list--has-icons property-card__feature-list--2-col"><li>${icon("plan")}<a class="text" href="/san-antonio/all-home-plans/${input.plan.toLowerCase()}-${input.sqft}">${input.plan}</a></li><li>${icon("collection")}<span class="text">Laguna</span></li><li>${icon("home")}<span class="text">Single Family</span></li><li>${icon("bed")}<span class="text">${input.beds} Beds</span></li><li>${icon("bath")}<span class="text">${input.baths} Baths</span></li><li>${icon("sqft")}<span class="text">${input.sqft} sq. ft.</span></li><li>${icon("stairs")}<span class="text">1 Story</span></li><li>${icon("garage")}<span class="text">2 Car Garage</span></li></ul>
    </div></div></div>
  </div></div>
</div>`;
const HOMES = [
  { id: "23630", street: "7419 Fixture Crossing", zip: "78252", plan: "Alyssa", price: 379_990, was: 450_990, status: "Available Now", beds: 4, baths: 3, sqft: 2_165 },
  { id: "23631", street: "14231 Fixture View", zip: "78252", plan: "Jordan", price: 440_990, status: "Available Nov 2026", beds: 4, baths: 2.5, sqft: 2_520 },
  { id: "23632", street: "14224 Fixture View", zip: "78252", plan: "Gage", price: 459_990, status: "Available Jan 2027", beds: 5, baths: 3, sqft: 2_780 },
];
const PLANS = [{ name: "Makenzie", price: 358_240, beds: 3, baths: 2, sqft: 1_570 }, { name: "Alyssa", price: 382_240, beds: 4, baths: 3, sqft: 2_165 }];
function communityPage(input: { homes?: typeof HOMES; plans?: typeof PLANS; business?: boolean; extraCards?: string } = {}) {
  return `<!DOCTYPE html><html><head><title>Fixture Hollow</title>${input.business === false ? "" : business}${ld({ "@type": "BreadcrumbList", itemListElement: [] })}</head><body>
<header><nav><a href="/san-antonio">San Antonio</a><a href="/san-antonio/quick-move-ins">Quick Move-Ins</a></nav></header>
<section class="division-list"><div class="modal-offer__price division-list__specs--price">Fall Savings that Feel Right at Home</div></section>
<h2>Fixture Hollow</h2><p>Students attend Medina Valley ISD schools. Sales Consultant Alan Fixture.</p>
<section class="property-cards"><h3 class="property-cards__title">Series in Fixture Hollow</h3><div class="property-cards__cards">${(input.plans ?? PLANS).map(series).join("\n")}</div></section>
<section class="tabs"><div class="tabs__carousel-card">${(input.homes ?? HOMES).map(home).join("\n")}${input.extraCards ?? ""}</div></section>
<section class="nearby"><h2>More Communities near San Antonio</h2><div class="card"><h3>Fixture Ridge</h3><a href="/san-antonio/fixture-ridge">View</a></div></section>
</body></html>`;
}
const listing = JSON.stringify({ division: "San Antonio", coordinates: { lat: "29.4814305", lon: "-98.5144044" }, zoom: 9, communities: [
  { items: [{ cid: 713, url: `${HOST}/san-antonio/fixture-hollow`, community_title: "Fixture Hollow", community_phone: "210-361-0710", area: "San Antonio", area_url: `${HOST}/san-antonio/san-antonio-0`, child_communities: [{ cid: 714 }, { cid: 1114 }] }], coordinates: { lat: "29.3603446", lon: "-98.7874964" } },
  { items: [{ cid: 258, url: `${HOST}/san-antonio/far-fixture`, community_title: "Far Fixture", community_phone: "210-899-7711", area: "Kyle", area_url: `${HOST}/san-antonio/kyle`, child_communities: [] }], coordinates: { lat: "29.99", lon: " -97.87" } },
  { items: [{ cid: 1, url: "https://evil.example/san-antonio/x", community_title: "Elsewhere" }], coordinates: { lat: "29.5", lon: "-98.5" } },
] });

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Ashton Woods", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Hollow", scrubList: ["Fixture Hollow", "Fixture Crossing", "Fixture View", "Fixture Pass", "Alan Fixture"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Ashton Woods reader: cards", () => {
  it("reads the series cards as plans and the property cards as homes: two-line address, status line, dropped price, plan link, features, photos", () => {
    const parsed = parseAshtonCommunity(communityPage(), COMMUNITY, NOW)!;
    expect(parsed.record).toEqual({ name: "Fixture Hollow", street: "14738 Fixture Pass", city: "San Antonio", zip: "78252", phone: null, priceFrom: null, geo: null });
    expect(parsed.homes.map((entry) => [entry.privateAddress, entry.privatePlanName, entry.status, entry.price, entry.previousPrice, entry.priceDrop, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage, entry.readyNow, entry.moveInDate, entry.gallery?.length])).toEqual([
      ["7419 Fixture Crossing, San Antonio, TX 78252", "Alyssa", "Quick Move-In (Move-In Ready)", 379_990, 450_990, 71_000, 4, 3, 2_165, 2, true, null, 2],
      ["14231 Fixture View, San Antonio, TX 78252", "Jordan", "Quick Move-In (November 2026)", 440_990, null, null, 4, 2.5, 2_520, 2, false, "November 2026", 2],
      ["14224 Fixture View, San Antonio, TX 78252", "Gage", "Quick Move-In (January 2027)", 459_990, null, null, 5, 3, 2_780, 2, false, "January 2027", 2],
    ]);
    expect(parsed.homes[0]!.sourceUrl).toBe(`${HOST}/san-antonio/preserve-at-fixture-hollow/preserve-at-fixture-hollow-alyssa/7419-fixture-crossing`);
    expect(parsed.homes[0]!.gallery![0]!.sourceUrl).toBe("https://awh.widen.net/content/h23630/jpeg/cms_23630-1.jpg");
    expect(parsed.plans.map((entry) => [entry.privatePlanName, entry.price, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.gallery?.[0]?.caption])).toEqual([["Makenzie", 358_240, 3, 2, 1_570, "Representative image"], ["Alyssa", 382_240, 4, 3, 2_165, "Representative image"]]);
    expect(parsed.plans[0]!.sourceUrl).toBe(`${HOST}/san-antonio/preserve-at-fixture-hollow/preserve-at-fixture-hollow-makenzie`);
    expect(parseAshtonCommunity("<html><body>new layout</body></html>", COMMUNITY)).toBeNull();
    expect(parseAshtonCommunity(communityPage({ business: false }), COMMUNITY, NOW)).toBeNull();
    expect(ashtonRecord(communityPage())).toMatchObject({ name: "Fixture Hollow", street: "14738 Fixture Pass" });
    expect(ashtonRecord(communityPage().replace("14738 Fixture Pass", "By Appointment Only"))).toMatchObject({ street: null });
    // Status: ready now, a future month, a past month (no date), unknown wording or none (no status), sold.
    expect(ashtonStatus("Available Now", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(ashtonStatus("Available Dec 2026", NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(ashtonStatus("Available Sep 2026", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(ashtonStatus("Sold", NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    for (const word of ["Coming Soon", "Available Soon", "Reserved", "", null]) expect(ashtonStatus(word, NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    // A card without its link, or with wording the reader does not know, has no status.
    const odd = parseAshtonCommunity(communityPage({ homes: [{ ...HOMES[0]!, link: false }, { ...HOMES[1]!, status: "Reserved" }] }), COMMUNITY, NOW)!;
    expect(odd.homes.map((entry) => entry.status)).toEqual([null, null]);
  });

  it("lists the division map's parent communities with their pins and phones, never another host", () => {
    const entries = ashtonListingEntries(listing, "www.ashtonwoods.com")!;
    expect(entries.map((entry) => [entry.url, entry.record.name, entry.record.city, entry.record.phone, entry.record.geo])).toEqual([
      [COMMUNITY, "Fixture Hollow", "San Antonio", "2103610710", { lat: 29.3603446, lng: -98.7874964 }],
      [`${HOST}/san-antonio/far-fixture`, "Far Fixture", "Kyle", "2108997711", { lat: 29.99, lng: -97.87 }],
    ]);
    expect(ashtonListingEntries("<html>", "www.ashtonwoods.com")).toBeNull();
  });
});

describe("Ashton Woods reader: a community", () => {
  it("reads the page once and publishes homes and plans scrubbed", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes).toHaveLength(3);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.communityFacts).toMatchObject({ schoolDistrict: "Medina Valley ISD", fromPrice: 358_240 });
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78252", "ashtonwoods", "Ashton", "Alan", "23630", "Alyssa"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((entry) => entry.status)).toEqual(["Quick Move-In (Move-In Ready)", "Quick Move-In (November 2026)", "Quick Move-In (January 2027)"]);
  });

  it("holds the run when the page is not a community page, when fewer homes read than the page's cards, when the site is not Ashton's, or when it cannot be read", async () => {
    const reshaped = vi.fn(async () => new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noBusiness = vi.fn(async () => new Response(communityPage({ business: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noBusiness })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // The card class renamed while the cards still carry their ids: a changed shape, never three sold homes.
    const renamed = vi.fn(async () => new Response(communityPage().replaceAll("js-property-card", "js-listing-card"), { status: 200, headers: { "content-type": "text/html" } }));
    const held = await loadOfficialDeals(config, { fetcher: renamed });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    // Plans only: a community with nothing move-in ready.
    const plansOnly = vi.fn(async () => new Response(communityPage({ homes: [] }), { status: 200, headers: { "content-type": "text/html" } }));
    const none = await loadOfficialDeals(config, { fetcher: plansOnly, now: () => NOW });
    expect(none.holdReasons).toEqual([]);
    expect(none.private.homes).toEqual([]);
    expect(none.private.plans).toHaveLength(2);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://ashtonwoods.com/san-antonio/fixture-hollow" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new AshtonWoodsAdapter().builder).toBe("Ashton Woods");
    expect(DEAL_ADAPTERS["Ashton Woods"].builder).toBe("Ashton Woods");
  });
});
