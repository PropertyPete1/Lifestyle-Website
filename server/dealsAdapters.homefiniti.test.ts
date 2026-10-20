import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomefinitiAdapter, homefinitiMarketLinks, homefinitiStatus, jsonLdRecords, parseHomefinitiRecords } from "./dealsAdapters.homefiniti";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Homefiniti community pages in the shape First America Homes and
 * Coventry Homes served in October 2026: one schema.org record per home and
 * plan, and a card per home with its status and (Coventry) the price it
 * dropped from. Names and addresses are invented.
 */
const FAH = "https://www.firstamericahomes.com";
const COMMUNITY = `${FAH}/new-homes/tx/san-antonio-metro/san-antonio/fixture-meadows/`;
const MEDIA = "https://media.firstamericahomes.com/436";

const ld = (record: unknown) => `<script type="application/ld+json">${JSON.stringify(record)}</script>`;
const homeRecord = (input: { street: string; plan: string; slug: string; price: number; beds: number; full: number; partial: number; sqft: number; images: string[] }) => ld({
  "@context": "https://schema.org", "@type": ["Product", "SingleFamilyResidence"], sku: `HF-C436-B725-S${input.slug.length}`, name: input.street,
  address: { "@type": "PostalAddress", addressCountry: "US", addressLocality: "San Antonio", addressRegion: "TX", postalCode: "78224", streetAddress: input.street },
  brand: { "@type": "Brand", name: "First America Homes" }, geo: { "@type": "GeoCoordinates", latitude: "29.31", longitude: "-98.54" },
  image: input.images.map((file) => `${MEDIA}/2026/7/7/${file}`), model: `${FAH}/new-homes/tx/san-antonio/fixture-meadows/${input.plan.toLowerCase()}/`,
  numberOfBedrooms: input.beds, numberOfFullBathrooms: input.full, numberOfPartialBathrooms: input.partial, floorSize: { "@type": "QuantitativeValue", unitCode: "FTK", value: input.sqft },
  offers: { "@type": "Offer", availability: "https://schema.org/InStock", price: `${input.price}.00`, priceCurrency: "USD", url: `${FAH}/new-homes/tx/san-antonio/fixture-meadows/${input.plan.toLowerCase()}/${input.slug}/` },
  url: `${FAH}/new-homes/tx/san-antonio/fixture-meadows/${input.plan.toLowerCase()}/${input.slug}/`, yearBuilt: 2026,
});
const planRecord = (input: { name: string; price: number; beds: [number, number]; sqft: [number, number] }) => ld({
  "@context": "https://schema.org", "@type": ["ProductModel", "SingleFamilyResidence"], sku: `HF-C436-B725-P${input.name.length}`, name: input.name, brand: { "@type": "Brand", name: "First America Homes" },
  image: [`${MEDIA}/2025/9/30/${input.name}_Elevation_A.jpg`, `${MEDIA}/2025/9/30/${input.name}_Floorplan.jpg`],
  numberOfBedrooms: { "@type": "QuantitativeValue", minValue: input.beds[0], maxValue: input.beds[1] }, numberOfFullBathrooms: { "@type": "QuantitativeValue", minValue: 2, maxValue: 2 }, numberOfPartialBathrooms: { "@type": "QuantitativeValue", minValue: 1, maxValue: 1 },
  floorSize: { "@type": "QuantitativeValue", minValue: input.sqft[0], maxValue: input.sqft[1], unitCode: "FTK" },
  offers: { "@type": "Offer", availability: "https://schema.org/PreSale", price: `${input.price}.00`, priceCurrency: "USD", url: `${FAH}/new-homes/tx/san-antonio/fixture-meadows/${input.name.toLowerCase()}/` },
});
const business = ld({ "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", name: "Fixture Meadows", url: COMMUNITY, telephone: "+12105550100", geo: { "@type": "GeoCoordinates", latitude: "29.31414", longitude: "-98.552033" }, address: { "@type": "PostalAddress", postalCode: "78224", addressRegion: "TX", streetAddress: "10318 Fixture Junction", addressCountry: "US", addressLocality: "San Antonio" }, parentOrganization: { name: "First America Homes", "@type": "Organization" } });

/** First America's card: `.status-text` and the price, plan and address as separate links. */
const fahCard = (input: { street: string; plan: string; slug: string; price: number; status: string }) => `
<div class="card h-100"><div class="card-body row g-0 p-3"><div class="col-8">
  <div class="status-text"> ${input.status} </div>
  <a href="/new-homes/tx/san-antonio/fixture-meadows/${input.plan.toLowerCase()}/${input.slug}/"><div class="fs-4 f-display text-primary"> $${input.price.toLocaleString("en-US")} </div></a>
  <a href="/new-homes/tx/san-antonio/fixture-meadows/${input.plan.toLowerCase()}/${input.slug}/"><div class="fs-5 fw-semibold text-primary mt-1"> ${input.plan} </div></a>
  <a href="/new-homes/tx/san-antonio/fixture-meadows/${input.plan.toLowerCase()}/${input.slug}/"><div class="address pt-2 pb-1"> ${input.street}<br> San Antonio, TX 78224 </div></a>
</div><div class="col-4"><a class="extra-link" href="/new-homes/tx/san-antonio/fixture-meadows/${input.plan.toLowerCase()}/${input.slug}/#hero-gallery"> View Photos </a><a class="extra-link" href="//maps.google.com/maps?q=29.31,-98.54" target="_blank"> Get Directions </a></div>
<hr class="gray-400"><a href="/new-homes/tx/san-antonio/fixture-meadows/${input.plan.toLowerCase()}/${input.slug}/"><div class="col-12"><div class="row"><div class="col-5"><span class="stat">4 Beds</span></div><div class="col-7"><span class="stat">2 Stories</span></div></div></div></a>
</div></div>`;

/** Coventry's card: `.status` badge, a struck-through previous price and a "$50K off" badge. */
const coventryCard = (input: { path: string; price: number; was?: number; status: string }) => `
<article class="card-spec card d-flex flex-column h-100 oi-map-item" data-price="${input.price}">
  <div class="position-relative"><div class="swiper collection-card-swiper card-img-top"><div class="swiper-wrapper"><div class="swiper-slide"><a href="${input.path}" class="oi-aspect d-block overflow-hidden"><img src="https://media.coventryhomes.com/434/2026/9/10/x_1.jpg?width=400" alt="a home"></a></div></div></div>
  <div class="badge-status-2"><p class="status mb-0">${input.status}</p></div></div>
  <div class="card-body"><a href="${input.path}"><div class="d-flex"><p class="fs-4 mb-0">$${input.price.toLocaleString("en-US")}</p>${input.was ? `<p class="text-strikethrough text-muted mb-0">$${input.was.toLocaleString("en-US")}</p> <p class="badge text-white bg-red fw-normal mb-0">$${Math.round((input.was - input.price) / 1000)}K off</p>` : ""}</div></a></div>
</article>`;

const HOMES = [
  { street: "2326 Fixture Way", plan: "Vail", slug: "2326-fixture-way", price: 326_140, beds: 4, full: 2, partial: 1, sqft: 1_857, images: ["8578_Redhawk_Loop_3.jpg", "Vail_Floorplan_-_09.25.jpg", "2326_FIXTURE_WAY_SELECTS.jpg"], status: "Under Construction" },
  { street: "2318 Fixture Way", plan: "Linden", slug: "2318-fixture-way", price: 366_280, beds: 4, full: 3, partial: 0, sqft: 2_125, images: ["2125-Linden-A-Scheme_5.jpg"], status: "Move-In Ready" },
  { street: "2314 Fixture Way", plan: "Birch", slug: "2314-fixture-way", price: 351_860, beds: 3, full: 2, partial: 1, sqft: 2_026, images: [], status: "Sold" },
];

function communityPage(input: { cards?: boolean; business?: boolean } = {}) {
  return `<!DOCTYPE html><html lang="en"><head><title>San Antonio, TX New Homes | Fixture Meadows from First America Homes</title>
${ld({ "@context": "https://schema.org", "@type": "Organization", name: "First America Homes", url: FAH })}
${input.business === false ? "" : business}
${ld({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] })}
${HOMES.map(homeRecord).join("\n")}
${planRecord({ name: "Vail", price: 300_990, beds: [4, 4], sqft: [1_857, 1_857] })}
${planRecord({ name: "Linden", price: 335_990, beds: [4, 5], sqft: [2_125, 2_125] })}
</head><body>
<header><nav><a href="/new-homes/tx/san-antonio-metro/">San Antonio Communities</a></nav></header>
<main>
<h1>FIXTURE MEADOWS</h1><p>10318 Fixture Junction, San Antonio, TX 78224</p>
<p>Students attend Southside ISD schools. $0 down available for qualified buyers.</p>
<section class="amenities"><h2>Amenities</h2><ul><li>Swimming pool</li><li>Community center</li><li>Playgrounds</li></ul></section>
<h2>AVAILABLE HOMES</h2>
<div class="row">${input.cards === false ? "" : HOMES.map(fahCard).join("\n")}</div>
<h2>FLOORPLANS</h2>
<div class="row"><div class="card"><a href="/new-homes/tx/san-antonio/fixture-meadows/vail/"><div class="fs-5">Vail</div></a><div class="fs-6">From $300,990</div></div></div>
</main></body></html>`;
}

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "First America Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Meadows", scrubList: ["Fixture Meadows", "Fixture Way", "Fixture Junction"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Homefiniti reader: records", () => {
  it("reads every home and plan record on the page: address, price, beds, baths from full and half, square feet, photos without the floor plan", () => {
    const records = parseHomefinitiRecords(communityPage(), "www.firstamericahomes.com");
    expect(records.community).toMatchObject({ name: "Fixture Meadows" });
    expect(records.homes.map((home) => [home.privateAddress, home.privatePlanName, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.gallery?.length])).toEqual([
      ["2326 Fixture Way, San Antonio, TX 78224", "Vail", 326_140, 4, 2.5, 1_857, 2],
      ["2318 Fixture Way, San Antonio, TX 78224", "Linden", 366_280, 4, 3, 2_125, 1],
      ["2314 Fixture Way, San Antonio, TX 78224", "Birch", 351_860, 3, 2.5, 2_026, 0],
    ]);
    expect(records.homes[0]!.gallery!.map((photo) => photo.sourceUrl.split("/").pop())).toEqual(["8578_Redhawk_Loop_3.jpg", "2326_FIXTURE_WAY_SELECTS.jpg"]);
    expect(records.plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.gallery?.map((photo) => photo.caption)])).toEqual([
      ["Vail", 300_990, 4, 2.5, 1_857, ["Representative image"]],
      ["Linden", 335_990, 4, 2.5, 2_125, ["Representative image"]],
    ]);
    // A record pointing at another host is not this builder's.
    const foreign = communityPage().replaceAll(`${FAH}/new-homes/tx/san-antonio/fixture-meadows/vail/2326-fixture-way/`, "https://evil.example/x/");
    expect(parseHomefinitiRecords(foreign, "www.firstamericahomes.com").homes.map((home) => home.privateName)).toEqual(["2318 Fixture Way", "2314 Fixture Way"]);
    expect(jsonLdRecords("<script type=\"application/ld+json\">{broken</script>")).toEqual([]);
  });

  it("turns a card's status into the status the sync publishes on, and reads market-page links", () => {
    expect(homefinitiStatus("Move-In Ready")).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true });
    expect(homefinitiStatus("Under Construction")).toEqual({ status: "Quick Move-In (Under Construction)", readyNow: false });
    expect(homefinitiStatus("Sold")).toEqual({ status: "Sold", readyNow: false });
    expect(homefinitiStatus("Under Contract")).toEqual({ status: "Sold", readyNow: false });
    expect(homefinitiStatus("Model Home")).toEqual({ status: "Model Home", readyNow: false });
    expect(homefinitiStatus(null)).toEqual({ status: "Quick Move-In", readyNow: false });
    const market = `<a href="/new-homes/tx/san-antonio/available-homes/">All</a><a href="/new-homes/tx/cibolo/buffalo-fixture/">Buffalo</a><a href="/new-homes/tx/cibolo/buffalo-fixture/?x=1">Buffalo again</a><a href="/new-homes/tx/new-braunfels/build-on-your-lot-2/">BOYL</a><a href="https://www.coventryhomes.com/new-homes/tx/schertz/homestead-65/">Homestead 65</a><a href="https://evil.example/new-homes/tx/a/b/">x</a><a href="/new-homes/tx/san-antonio/">Market</a>`;
    expect(homefinitiMarketLinks(market, "www.coventryhomes.com")).toEqual(["https://www.coventryhomes.com/new-homes/tx/cibolo/buffalo-fixture/", "https://www.coventryhomes.com/new-homes/tx/schertz/homestead-65/"]);
  });
});

describe("Homefiniti reader: a community", () => {
  it("reads the page once, takes each home's status and price drop from its card, and publishes homes and plans scrubbed", async () => {
    const result = await loadOfficialDeals(config, { fetcher });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes.map((home) => [home.privateName, home.status, home.readyNow, home.price])).toEqual([
      ["2326 Fixture Way", "Quick Move-In (Under Construction)", false, 326_140],
      ["2318 Fixture Way", "Quick Move-In (Move-In Ready)", true, 366_280],
      ["2314 Fixture Way", "Sold", false, 351_860],
    ]);
    expect(result.private.plans.map((plan) => plan.privatePlanName)).toEqual(["Vail", "Linden"]);
    expect(result.private.communityFacts).toMatchObject({ schoolDistrict: "Southside ISD", amenities: ["Swimming pool", "Community center", "Playgrounds"] });
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78224", "firstamericahomes", "First America", "Vail", "Linden"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((home) => home.status)).toEqual(["Quick Move-In (Under Construction)", "Quick Move-In (Move-In Ready)", "Sold"]);
  });

  it("reads Coventry's cards: the struck-through price is the one the home dropped from", async () => {
    const path = "/new-homes/tx/cibolo/buffalo-fixture/collin/520-fixture-park/";
    const record = ld({ "@type": ["Product", "SingleFamilyResidence"], name: "520 Fixture Park", url: `https://www.coventryhomes.com${path}`, address: { streetAddress: "520 Fixture Park", addressLocality: "Cibolo", postalCode: "78108" }, offers: { price: "599999.00", url: `https://www.coventryhomes.com${path}` }, numberOfBedrooms: 4, numberOfFullBathrooms: 3, numberOfPartialBathrooms: 1, floorSize: { value: 3037 }, image: ["https://media.coventryhomes.com/434/2026/9/10/SAN_Buffalo_Fixture_Collin_520_1.jpg"] });
    const page = `<html><head>${ld({ "@type": "HomeAndConstructionBusiness", name: "Buffalo Fixture", address: { streetAddress: "1 Fixture Rd", addressLocality: "Cibolo", postalCode: "78108" } })}${record}</head><body><main>${coventryCard({ path, price: 599_999, was: 650_363, status: "Move-In Ready" })}</main></body></html>`;
    const coventry = vi.fn(async () => new Response(page, { status: 200, headers: { "content-type": "text/html" } }));
    const result = await loadOfficialDeals({ builder: "Coventry Homes", sourceUrl: "https://www.coventryhomes.com/new-homes/tx/cibolo/buffalo-fixture/", privateCommunityName: "Buffalo Fixture", scrubList: ["Buffalo Fixture", "Fixture Park"] }, { fetcher: coventry });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes[0]).toMatchObject({ privateAddress: "520 Fixture Park, Cibolo, TX 78108", status: "Quick Move-In (Move-In Ready)", readyNow: true, price: 599_999, previousPrice: 650_363, priceDrop: 50_364, bathrooms: 3.5 });
  });

  it("holds the run when the page is not a community page, when a home has no card, when the site is not the builder's, or when it cannot be read", async () => {
    const noBusiness = vi.fn(async () => new Response(communityPage({ business: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noBusiness })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noCards = vi.fn(async () => new Response(communityPage({ cards: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noCards })).holdReasons).toEqual(["unlabelled_home_status"]);
    // The home records gone but the cards still there: a changed record shape, never three sold homes.
    const noRecords = vi.fn(async () => new Response(communityPage().replace(/"@type":\["Product","SingleFamilyResidence"\]/g, "\"@type\":[\"Thing\"]"), { status: 200, headers: { "content-type": "text/html" } }));
    const held = await loadOfficialDeals(config, { fetcher: noRecords });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://firstamericahomes.com/new-homes/tx/san-antonio-metro/san-antonio/fixture-meadows/" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://www.coventryhomes.com/new-homes/tx/cibolo/x/" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is two adapters the registry knows, one per host", () => {
    expect(new HomefinitiAdapter("Coventry Homes")).toMatchObject({ builder: "Coventry Homes", host: "www.coventryhomes.com" });
    expect(DEAL_ADAPTERS["First America Homes"].builder).toBe("First America Homes");
  });
});
