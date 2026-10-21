import { beforeEach, describe, expect, it, vi } from "vitest";
import { DrHortonAdapter, drhCommunityAddress, drhListingCounts, parseDrhCommunityCards, parseDrhHomeDetail } from "./dealsAdapters.drhorton";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic D.R. Horton pages in the shape the live site served in October
 * 2026: a Sitecore community page with server-rendered home and plan cards,
 * and a home page with a lazy-loaded photo gallery. Names and addresses are
 * invented.
 */
const COMMUNITY = "https://www.drhorton.com/texas/san-antonio/san-antonio/fixture-ranch";
const MEDIA = "/-/media/drhorton/productcatalog/778-san-antonio-east/77813-fixture-ranch";

const homeCard = (input: { slug: string; street: string; price?: number; was?: number; beds: number; baths: number; garage: number; stories: number; sqft: number; lot: number; underContract?: boolean; plan: string }) => `
<a class="CoveoResultLink ${input.underContract ? "disabled " : ""}available-home-card" role="link" tabindex="0" ${input.underContract ? "" : `href="/texas/san-antonio/san-antonio/fixture-ranch/qmis/${input.slug}"`} aria-label="Home for sale card">
  ${input.underContract ? "" : `<div class="image-bdg"><img class="rte-badge" src="/-/media/files/rte/resources/rte_event-banner.svg?rev=c3f6"></div>`}
  <div class="card">
    <div class="card-image" style="background-image: url('${MEDIA}/778200000-fixture-ranch-units-4--6/${input.plan}/0014-${input.slug}/${input.plan}_b_web.jpg?iar=1&amp;sc=1&amp;thn=1&amp;w=425&amp;rev=3efb&amp;hash=DB2A')"></div>
    <div class="card-content">
      <h2> ${input.underContract ? "Under Contract" : `$${input.price!.toLocaleString("en-US")} ${input.was ? `<span class="wasPricingCard"><del aria-label="Original price was $${input.was.toLocaleString("en-US")}">was $${input.was.toLocaleString("en-US")}</del></span>` : ""}
        <object><p class="estimate-container"><a href="#" class="open-modal estimatedLink" data-mfp-src=".modal.calc.B-1" title="Open estimated payment window link"><span class="estimate"> $1,850.65 / monthly* </span> *see total est. payment details</a></p>
        <div class="modal calc B-1 mfp-hide"><div><b> How Estimated Monthly Payment Is Calculated </b></div><iframe src="https://mpc.drhorton.com/3376899" loading="lazy"></iframe></div></object>`} </h2>
      <h3>${input.street}</h3>
      <p> ${input.beds}<span> Bed </span> <span class="vert-divider">|</span> ${input.baths}<span> Bath</span> <span class="vert-divider">|</span> ${input.garage}<span> Garage</span> </p>
      <p> ${input.stories}<span> Story</span> <span class="vert-divider">|</span> ${input.sqft.toLocaleString("en-US")}<span> Sq. Ft.</span> <span class="vert-divider">|</span> <span class="lot-number">Lot ${input.lot}</span> </p>
    </div>
  </div>
</a>`;

const planCard = (input: { slug: string; name: string; band: number; beds: number; baths: number; sqft: number }) => `
<a class="CoveoResultLink" tabindex="0" href="/texas/san-antonio/san-antonio/fixture-ranch/floor-plans/${input.slug}">
  <div class="card">
    <div class="card-image" style="background-image: url('${MEDIA}/778180000-fixture-t25s/${input.slug}/${input.slug}_j.jpg?as=1&amp;w=425&amp;rev=1eb3&amp;hash=5CAB')"></div>
    <div class="card-content">
      <h2>${input.name}</h2>
      <h3>Starting in the $${input.band}s</h3>
      <p class="stats"> ${input.beds}<span> Bed </span> <span class="vert-divider">|</span> ${input.baths}<span> Bath</span> <span class="vert-divider">|</span> 2<span> Garage</span> <span class="vert-divider mobile-vert-divider">|</span> </p>
      <p class="stats"> 1<span> Story</span> <span class="vert-divider">|</span><span class="mobile-vert"></span> ${input.sqft.toLocaleString("en-US")}<span> Sq. Ft.</span> </p>
    </div>
  </div>
</a>`;

const HOMES = [
  { slug: "5919-granite-fixture", street: "5919 Granite Fixture", price: 255_500, was: 256_500, beds: 3, baths: 2, garage: 2, stories: 1, sqft: 1_489, lot: 20, plan: "x30c" },
  { slug: "5934-basalt-fixture", street: "5934 Basalt Fixture", price: 280_550, beds: 4, baths: 2.5, garage: 2, stories: 2, sqft: 1_952, lot: 49, plan: "x30d" },
  { slug: "5926-celestite-fixture", street: "5926 Celestite Fixture", beds: 3, baths: 2, garage: 2, stories: 1, sqft: 1_190, lot: 65, plan: "t25a", underContract: true },
];

function communityPage(input: { homes?: typeof HOMES; rendered?: number; total?: number; plansBlock?: boolean } = {}) {
  const homes = input.homes ?? HOMES;
  const rendered = input.rendered ?? homes.length;
  const total = input.total ?? homes.length;
  return `<!DOCTYPE html><html lang="en"><head>
<title>Houses For Sale in San Antonio, TX | Fixture Ranch | D.R. Horton</title>
<script type="application/ld+json">
	{"name":"Houses For Sale in San Antonio, TX | Fixture Ranch | D.R. Horton","description":"Find homes for sale in San Antonio, TX!","@context":"http://schema.org","@type":"Place","url":"${COMMUNITY}","address":{"@type":"PostalAddress","addresslocality":"SAN ANTONIO","addressregion":"TX","postalcode":"78222","streetaddress":"3702 Fixture Terrace"},"latitude":29.3778,"longitude":-98.3754}
</script>
<script type="application/ld+json">
	{"@context":"https://schema.org","@type":"LocalBusiness","name":"Fixture Ranch","address":{"@type":"PostalAddress","streetAddress":"3702 Fixture Terrace","addressLocality":"SAN ANTONIO","postalCode":"78222","addressRegion":"TX","addressCountry":"US"},"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday"],"opens":"13:00","closes":"19:00"}]}
</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Houses For Sale in San Antonio, TX | Fixture Ranch | D.R. Horton","publisher":{"@type":"Organization","name":"D.R. Horton"}}</script>
</head><body>
<header><nav><a href="/texas/san-antonio">San Antonio</a></nav></header>
<main>
<h1>Homes for sale at Fixture Ranch</h1>
<p>From $242,000 | Express Series® 3702 Fixture Terrace, San Antonio, TX 78222</p>
<p>3 - 5 Bed| 2 - 3 Bath | 1 - 2 Garage 1 - 2 Story | From 1,190 Sq. Ft.</p>
<section class="community-description"><p>Welcome to Fixture Ranch, a vibrant new home community in San Antonio, TX. Students will attend nearby East Central ISD schools.</p></section>
<section class="community-amenities"><h2>Community amenities</h2><ul><li>HOA</li><li>Home is Connected Smart Home System</li><li>Park</li><li>Playground</li></ul></section>
<div class="one-three-right right-two community-additional-details">
  <section>
    <div id="relatedmovein" class="related-move-in" tabindex="0" data-itemid="0725b084" data-currentindex="${rendered}" data-totalitems="${total}" data-blocksize="8" data-moreurl="moveinreadyapi/getrelated">
      <h2>${total} homes for sale in this community</h2>
      ${homes.map(homeCard).join("\n")}
    </div>
  </section>
  ${input.plansBlock === false ? "" : `<section>
    <div id="floorplans" class="related-floorplans" tabindex="0" data-itemid="0725b084" data-currentindex="2" data-totalitems="2" data-blocksize="8" data-moreurl="floorplandetailapi/getrelated">
      <h2>2 floor plans in this community</h2>
      ${planCard({ slug: "t25a", name: "The Alamo", band: 242, beds: 3, baths: 2, sqft: 1_190 })}
      ${planCard({ slug: "x30c", name: "The Caroline", band: 255, beds: 3, baths: 2, sqft: 1_489 })}
    </div>
  </section>`}
  <section><div id="nearbycommunities" class="nearby-communities" data-currentindex="1" data-totalitems="1" data-moreurl="communitylandingapi/getnearby">
    <a class="CoveoResultLink available-home-card" href="/texas/san-antonio/converse/other-fixture"><div class="card"><div class="card-content"><h2>$199,990</h2><h3>Other Fixture</h3></div></div></a>
  </div></section>
</div>
</main>
<footer><a href="/texas/san-antonio/san-antonio/fixture-ranch/qmis/9999-footer-fixture">Footer</a></footer>
</body></html>`;
}

const gallery = (slug: string, plan: string, files: string[]) => files.map((file) => `<div class="property-gallery property-photo" role="link" tabindex="0" aria-label="Property photo"><img data-lazy="${MEDIA}/778200000-fixture-ranch-units-4--6/${plan}/0014-${slug}/${file}?as=1&amp;w=494&amp;rev=b07d&amp;hash=3751" alt="." src="${MEDIA}/778200000-fixture-ranch-units-4--6/${plan}/0014-${slug}/${file}?as=1&amp;w=1280&amp;rev=b07d&amp;hash=CA2D"></div>`).join("");

function homePage(input: { slug: string; street: string; plan: string; planName: string; price: number; was?: number; photos: string[] }) {
  return `<!DOCTYPE html><html><head><title>Home For Sale in Fixture Ranch | San Antonio, TX | D.R. Horton</title>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"House","url":"${COMMUNITY}/qmis/${input.slug}","numberOfBedrooms":3,"floorSize":1489,"address":{"@type":"PostalAddress","addresslocality":"SAN ANTONIO","postalcode":"78222","streetaddress":"${input.street}"}}</script>
</head><body>
<div class="PropertyGallery-container"><div class="PropertyGallery">
  <div class="image-bdg-desktop"><img class="rte-badge" src="/-/media/files/rte/resources/rte_event-banner.svg?rev=c3f6" data-lazy="/-/media/files/rte/resources/rte_event-banner.svg?rev=c3f6"></div>
  <div class="sevenImages">${gallery(input.slug, input.plan, input.photos)}
    <div class="property-gallery property-photo"><img data-lazy="${MEDIA}/778200000-fixture-ranch-units-4--6/${input.plan}/fp-1489_${input.plan}.jpg?rev=9105&amp;hash=ABD0" alt="DR Horton San Antonio Fixture Ranch ${input.planName.toLowerCase()} 1489 sq ft" src="${MEDIA}/778200000-fixture-ranch-units-4--6/${input.plan}/fp-1489_${input.plan}.jpg?rev=9105"></div>
    <div class="property-gallery property-photo"><img data-lazy="${MEDIA}/778200000-fixture-ranch-units-4--6/${input.plan}/interior_features_-_x30_-_package_1.jpg?rev=1" alt="features" src="${MEDIA}/778200000-fixture-ranch-units-4--6/${input.plan}/interior_features_-_x30_-_package_1.jpg?rev=1"></div>
    <div class="property-gallery property-photo"><img data-lazy="${MEDIA}/778200000-fixture-ranch-units-4--6/${input.plan}/0037-5926-celestite-fixture/5926-cb-edited-web.jpg?rev=1" alt="another home" src="${MEDIA}/778200000-fixture-ranch-units-4--6/${input.plan}/0037-5926-celestite-fixture/5926-cb-edited-web.jpg?rev=1"></div>
  </div>
</div></div>
<main>
  <h1>Home for sale at ${input.street}</h1><p>San Antonio, TX 78222</p><p>Express Series®</p>
  <div class="home-price"><div>$${input.price.toLocaleString("en-US")}</div>${input.was ? `<div class="wasPricingHeader"><del aria-label="Original price was $${input.was.toLocaleString("en-US")}">was $${input.was.toLocaleString("en-US")}</del></div>` : ""}</div>
  <p class="estimate">$1,850.65 / monthly* *see total est. payment details</p>
  <p>3 Bed | 2 Bath | 2 Garage | 1 Story</p>
  <p>1,489 Sq. Ft. | Lot       20 |${input.planName} floor plan</p>
  <h2>About this home</h2><p>Introducing ${input.planName} plan, a stunning one-story home featured in Fixture Ranch in San Antonio, TX.</p>
</main></body></html>`;
}

const site: Record<string, string> = {
  [COMMUNITY]: communityPage(),
  [`${COMMUNITY}/qmis/5919-granite-fixture`]: homePage({ slug: "5919-granite-fixture", street: "5919 Granite Fixture", plan: "x30c", planName: "The Caroline", price: 255_500, was: 256_500, photos: ["x30c_b_web.jpg", "1-entry_01.jpg", "03kitchen_01.jpg"] }),
  [`${COMMUNITY}/qmis/5934-basalt-fixture`]: homePage({ slug: "5934-basalt-fixture", street: "5934 Basalt Fixture", plan: "x30d", planName: "The Dalton", price: 280_550, photos: ["x30d_a_web.jpg"] }),
};

const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  if (!body) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
});

const config: CommunitySourceConfig = { builder: "D.R. Horton", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Ranch", scrubList: ["Fixture Ranch", "Granite Fixture", "Basalt Fixture", "Celestite Fixture", "Fixture Terrace"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("D.R. Horton reader: page shapes", () => {
  it("reads every home card: sale price with the price it dropped from, specs, lot, address with the community's city and ZIP, the card photo", () => {
    const cards = parseDrhCommunityCards(communityPage(), COMMUNITY)!;
    const homes = cards.filter((card) => card.kind === "home");
    expect(homes.map((home) => [home.privateAddress, home.status, home.price, home.previousPrice, home.priceDrop, home.bedrooms, home.bathrooms, home.garage, home.squareFeet, home.homesite])).toEqual([
      ["5919 Granite Fixture, San Antonio, TX 78222", "Quick Move-In (For Sale)", 255_500, 256_500, 1_000, 3, 2, 2, 1_489, "Lot 20"],
      ["5934 Basalt Fixture, San Antonio, TX 78222", "Quick Move-In (For Sale)", 280_550, null, null, 4, 2.5, 2, 1_952, "Lot 49"],
      ["5926 Celestite Fixture, San Antonio, TX 78222", "Under Contract", null, null, null, 3, 2, 2, 1_190, "Lot 65"],
    ]);
    expect(homes[0]!.sourceUrl).toBe(`${COMMUNITY}/qmis/5919-granite-fixture`);
    expect(homes[0]!.gallery![0]!.sourceUrl).toContain("/0014-5919-granite-fixture/x30c_b_web.jpg");
    // The estimated payment next to the price is never read as the price.
    expect(homes.some((home) => home.price === 1_850)).toBe(false);
    // Cards outside the homes block (nearby communities, footer links) are not homes here.
    expect(homes.some((home) => /Other Fixture|footer/i.test(home.privateName ?? ""))).toBe(false);
  });

  it("reads every plan card: name, the low end of its starting band, specs, and a labelled representative image", () => {
    const plans = parseDrhCommunityCards(communityPage(), COMMUNITY)!.filter((card) => card.kind === "plan");
    expect(plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.status])).toEqual([
      ["The Alamo", 242_000, 3, 2, 1_190, null],
      ["The Caroline", 255_000, 3, 2, 1_489, null],
    ]);
    expect(plans[0]!.sourceUrl).toBe(`${COMMUNITY}/floor-plans/t25a`);
    expect(plans[0]!.gallery![0]).toMatchObject({ caption: "Representative image" });
  });

  it("knows the community's address from its LocalBusiness record, not the page-title Place record, and the blocks' item counts", () => {
    expect(drhCommunityAddress(communityPage())).toEqual({ street: "3702 Fixture Terrace", city: "San Antonio", zip: "78222" });
    expect(drhListingCounts(communityPage({ rendered: 8, total: 19 }))).toEqual({ homes: { rendered: 8, total: 19 }, plans: { rendered: 2, total: 2 } });
    expect(drhListingCounts("<html><body>new layout</body></html>")).toEqual({ homes: null, plans: null });
    expect(parseDrhCommunityCards("<html><body><div id='floorplans'></div></body></html>", COMMUNITY)).toBeNull();
  });

  it("reads a home page's own photos only, without thumbnail sizing, never a floor plan, feature sheet or another home's photo, plus the plan name", () => {
    const detail = parseDrhHomeDetail(site[`${COMMUNITY}/qmis/5919-granite-fixture`]!, `${COMMUNITY}/qmis/5919-granite-fixture`)!;
    expect(detail.gallery.map((image) => image.sourceUrl)).toEqual([
      `https://www.drhorton.com${MEDIA}/778200000-fixture-ranch-units-4--6/x30c/0014-5919-granite-fixture/x30c_b_web.jpg?rev=b07d&hash=3751`,
      `https://www.drhorton.com${MEDIA}/778200000-fixture-ranch-units-4--6/x30c/0014-5919-granite-fixture/1-entry_01.jpg?rev=b07d&hash=3751`,
      `https://www.drhorton.com${MEDIA}/778200000-fixture-ranch-units-4--6/x30c/0014-5919-granite-fixture/03kitchen_01.jpg?rev=b07d&hash=3751`,
    ]);
    expect(detail).toMatchObject({ planName: "The Caroline", price: 255_500, previousPrice: 256_500 });
    expect(parseDrhHomeDetail("<html><body>new layout</body></html>", `${COMMUNITY}/qmis/5919-granite-fixture`)).toBeNull();
  });
});

describe("D.R. Horton reader: a community", () => {
  it("reads the community page once and each home for sale once, publishes homes and plans scrubbed, and leaves a home under contract unpublished", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => new Date("2026-10-20T12:00:00Z") });
    expect(result.ok).toBe(true);
    expect(result.private.homes.map((home) => [home.privateName, home.privatePlanName, home.status, home.gallery?.length])).toEqual([
      ["5919 Granite Fixture", "The Caroline", "Quick Move-In (For Sale)", 3],
      ["5934 Basalt Fixture", "The Dalton", "Quick Move-In (For Sale)", 1],
      ["5926 Celestite Fixture", null, "Under Contract", 1],
    ]);
    expect(result.private.plans.map((plan) => plan.privatePlanName)).toEqual(["The Alamo", "The Caroline"]);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 242_000, schoolDistrict: "East Central ISD", amenities: ["HOA", "Home is Connected Smart Home System", "Park", "Playground"] });
    expect(requested).toEqual([COMMUNITY, `${COMMUNITY}/qmis/5919-granite-fixture`, `${COMMUNITY}/qmis/5934-basalt-fixture`]);
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "Granite", "Basalt", "78222", "drhorton.com", "Caroline", "Lot 20"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((home) => [home.status, home.price])).toEqual([["Quick Move-In (For Sale)", 255_500], ["Quick Move-In (For Sale)", 280_550], ["Under Contract", null]]);
  });

  it("holds the run when the page is not a community page, when the site is not D.R. Horton's, when a home page cannot be read, and when the page did not render every item", async () => {
    const reshaped = vi.fn(async (input: string) => input === COMMUNITY ? new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://drhorton.com/texas/san-antonio/san-antonio/fixture-ranch" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const flaky = vi.fn(async (input: string) => input.endsWith("/5934-basalt-fixture") ? new Response("down", { status: 503, headers: { "content-type": "text/html" } }) : fetcher(input));
    const held = await loadOfficialDeals(config, { fetcher: flaky });
    expect(held.holdReasons).toEqual(["detail_fetch_failed"]);
    expect(held.public.homes).toEqual([]);
    const partial = vi.fn(async (input: string) => input === COMMUNITY ? new Response(communityPage({ rendered: 8, total: 19 }), { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: partial })).holdReasons).toEqual(["incomplete_inventory"]);
    expect(partial.mock.calls).toHaveLength(1);
    const challenge = vi.fn(async () => new Response("<html><head><title>Just a moment...</title></head><body><div id=\"cf-chl-widget\"></div></body></html>", { status: 403, headers: { "content-type": "text/html" } }));
    // A bot challenge (HTTP 403) is the site refusing the reader: held as such, never worked around.
    expect((await loadOfficialDeals(config, { fetcher: challenge })).holdReasons).toEqual(["source_access_refused"]);
  });

  it("never mistakes a card the reader cannot read for a sold home: fewer cards than the block says, a restyled card, or a card without a street all hold the run", async () => {
    // The card class renamed: the block still says 3 homes, the reader finds none.
    const restyled = vi.fn(async (input: string) => input === COMMUNITY ? new Response(communityPage().replaceAll("available-home-card", "listing-card"), { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const held = await loadOfficialDeals(config, { fetcher: restyled });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    // A card without its street: the card stays, unnamed and without a status, so the sync holds (unlabelled_home_status) instead of sweeping.
    const noStreet = communityPage().replace("<h3>5934 Basalt Fixture</h3>", "<div>5934 Basalt Fixture</div>");
    const cards = parseDrhCommunityCards(noStreet, COMMUNITY)!.filter((card) => card.kind === "home");
    expect(cards).toHaveLength(3);
    expect(cards[1]).toMatchObject({ status: null, privateName: null, price: null, detailPath: null });
    const unlabelled = vi.fn(async (input: string) => input === COMMUNITY ? new Response(noStreet, { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const result = await loadOfficialDeals(config, { fetcher: unlabelled });
    expect(result.private.homes.some((home) => home.status === null)).toBe(true);
    // Counts are read whatever the quoting or the element.
    expect(drhListingCounts(`<section id='relatedmovein' data-currentindex='4' data-totalitems='4'></section>`)).toEqual({ homes: { rendered: 4, total: 4 }, plans: null });
    // No homes block at all is not a community page.
    const noBlock = vi.fn(async (input: string) => input === COMMUNITY ? new Response(communityPage().replace('id="relatedmovein"', 'id="somethingelse"'), { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: noBlock })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });

  it("reads the plan name from this home's own stats line, not from a similar-homes card elsewhere on the page", () => {
    const page = site[`${COMMUNITY}/qmis/5919-granite-fixture`]!.replace("<main>", "<main><div class=\"related\"><p>| The Alamo floor plan</p></div>");
    expect(parseDrhHomeDetail(page, `${COMMUNITY}/qmis/5919-granite-fixture`)).toMatchObject({ planName: "The Caroline" });
  });

  it("is an adapter the registry knows", () => {
    expect(new DrHortonAdapter().builder).toBe("D.R. Horton");
    expect(DEAL_ADAPTERS["D.R. Horton"].builder).toBe("D.R. Horton");
  });
});
