import { beforeEach, describe, expect, it, vi } from "vitest";
import { HighlandAdapter, highlandBaths, highlandCommunityFacts, highlandHomeCount, highlandRecord, highlandStatus, parseHighlandCards } from "./dealsAdapters.highland";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Highland Homes community page in the shape the live site served
 * in October 2026: `a.homeSpec` cards, a "N quick move-in homes" count, the
 * sales office line and a Google Maps link. Names and addresses are invented.
 */
const HOST = "https://www.highlandhomes.com";
const COMMUNITY = `${HOST}/san-antonio/san-antonio/fixture-ranch`;

const card = (input: { lot: string; price: number; street: string; plan: string; beds: number; baths: string; stories: number; garages: number; sqft: number; tag: string | null; image?: string }) => `
<a href="/san-antonio/san-antonio/fixture-ranch/${input.lot}" class="thumbnail home-container homeSpec algolia-track-view" data-algolia-object-id="spec-${input.lot}" data-equalizer-watch="">
  <img data-src="${input.image ?? `https://media.hhomesltd.com/images/452000/${input.street.replace(/\s+/g, "")}-${input.plan}-D001_700x400.jpg`}">
  <span class="button-favorite button-fave-unfave" title="Add Home to Favorites"><span class="hide">Add to Favorites</span></span>
  <div class="homeInfo">
    <p style="margin-bottom: 0px">
      <span class="homePrice"><span class="mortgage-calculator-label showCalculatorModal" id="mortgage-calculator-${input.lot}"><span class="price">$${input.price.toLocaleString("en-US")}</span> <i class="fa fa-calculator" aria-hidden="true" data-price="${input.price}&quot;" data-taxrate="2.53" data-defaultinterest="6.50"></i></span></span>
      <span class="homeIdentifier">${input.street}</span>
      <span class="homeUpgrades"> ${input.plan} Plan <em>with 3 upgrades</em> </span>
    </p>
    <div class="homeDetails">
      <div class="homeDetailItem"><p><span class="numeral">${input.beds}</span><span class="label">beds</span></p></div>
      <div class="homeDetailItem"><p><span class="numeral">${input.baths}</span><span class="label">baths</span></p></div>
      <div class="homeDetailItem"><p><span class="numeral">${input.stories}</span><span class="label">stories</span></p></div>
      <div class="homeDetailItem"><p><span class="numeral">${input.garages}</span><span class="label">garages</span></p></div>
    </div>
    <div class="homeSqFootage"><p><span class="numeral">${input.sqft.toLocaleString("en-US")}</span><span class="label">sq ft</span></p></div>
  </div>
  <div class="home-container-cta"> View 28 Photos &amp; <nobr>3D Tour</nobr> </div>
  ${input.tag === null ? "" : `<span class="home-tag absolute text-white completed-home bg-color--tertiary-accent">${input.tag}</span>`}
</a>`;

const HOMES = [
  { lot: "760-026", price: 649_816, street: "13207 Fixture Pine", plan: "216", beds: 4, baths: "3", stories: 1, garages: 3, sqft: 3_050, tag: "Complete &amp; Move-in Ready!" },
  { lot: "760-016", price: 674_040, street: "4122 Fixture Tree", plan: "218", beds: 4, baths: "4/1", stories: 1, garages: 3, sqft: 3_032, tag: "Est. Completion - Nov '26" },
  { lot: "760-005", price: 693_147, street: "3714 Fixture Elm", plan: "Bradford", beds: 4, baths: "3", stories: 1, garages: 3, sqft: 3_057, tag: "Est. Completion - Dec '26" },
];

function communityPage(input: { homes?: typeof HOMES; count?: number; office?: boolean } = {}) {
  const homes = input.homes ?? HOMES;
  return `<!DOCTYPE html><html><head><title>New Homes in Fixture Ranch - Home Builder in San Antonio TX</title></head><body>
<header><a href="/"><h1>Highland Homes</h1></a><nav><a href="/san-antonio">San Antonio</a></nav></header>
<div class="row"><div class="column">
  <a class="promotion promotion-overlay show-for-medium"><span class="promoTitleArea"><div class="promo-text-wrap"><span class="promoTitle">Rates as Low as 4.99%</span><span class="promoSubtitle">Or up to $50,000 in savings!</span></div></span></a>
  <h1><strong>Fixture Ranch</strong></h1>
  ${input.office === false ? "" : `<p class="row column subheader"><span id="salesOfficeAddressDirectionsLink">13316 Fixture Acacia, <nobr>San Antonio, TX 78245</nobr></span></p>`}
  <a href="https://maps.google.com/maps?q=loc:29.393168609101,-98.760523796082(13316 Fixture Acacia)" target="_blank">Get Driving Directions</a>
  <p>Sales Counselor Alan Fixture<br>O: <a href="tel:2106861496">210-686-1496</a><br>C: 210-937-2008</p>
  <p>Students attend Northside ISD schools.</p>
</div></div>
<section><h2>Quick Move-in</h2><p>${input.count ?? homes.length} quick move-in homes</p>
<div class="card-grid" data-equalizer="">${homes.map(card).join("\n")}</div></section>
<section><h2>Floor Plans</h2><p>14 home plans</p><div class="plans-compare card-grid"></div></section>
</body></html>`;
}

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Highland Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Ranch", scrubList: ["Fixture Ranch", "Fixture Pine", "Fixture Tree", "Fixture Elm", "Fixture Acacia"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Highland Homes reader: cards", () => {
  it("reads a Coming Soon tag as coming soon (not an unreadable status that holds the community)", () => {
    expect(highlandStatus("Coming Soon", new Date("2026-10-22T20:00:00Z"))).toEqual({ status: "Coming Soon", readyNow: false, moveInDate: null });
  });

  it("reads every card: price, street with the office's city and ZIP, plan, beds, baths from full/half, square feet, garage, status tag, photo", () => {
    const homes = parseHighlandCards(communityPage(), COMMUNITY)!;
    expect(homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.garage, home.readyNow, home.moveInDate])).toEqual([
      ["13207 Fixture Pine, San Antonio, TX 78245", "216 Plan", "Quick Move-In (Move-In Ready)", 649_816, 4, 3, 3_050, 3, true, null],
      ["4122 Fixture Tree, San Antonio, TX 78245", "218 Plan", "Quick Move-In (November 2026)", 674_040, 4, 4.5, 3_032, 3, false, "November 2026"],
      ["3714 Fixture Elm, San Antonio, TX 78245", "Bradford Plan", "Quick Move-In (December 2026)", 693_147, 4, 3, 3_057, 3, false, "December 2026"],
    ]);
    expect(homes[0]!.sourceUrl).toBe(`${COMMUNITY}/760-026`);
    expect(homes[0]!.gallery![0]!.sourceUrl).toBe("https://media.hhomesltd.com/images/452000/13207FixturePine-216-D001_700x400.jpg");
    // A card without a status tag, or with wording the reader does not know, has no status (the sync holds the run).
    expect(parseHighlandCards(communityPage({ homes: [{ ...HOMES[0]!, tag: null }] }), COMMUNITY)![0]).toMatchObject({ status: null });
    expect(highlandStatus("Last chance!")).toEqual({ status: null, readyNow: false, moveInDate: null });
    // A completion month already past is a stale estimate: still for sale, no date.
    expect(highlandStatus("Est. Completion - Sep '26", new Date("2026-10-20T12:00:00Z"))).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(highlandStatus("Est. Completion - Oct '26", new Date("2026-10-20T12:00:00Z"))).toEqual({ status: "Quick Move-In (October 2026)", readyNow: false, moveInDate: "October 2026" });
    // A card without its link is not read on a guess: no status.
    expect(parseHighlandCards(communityPage().replace('href="/san-antonio/san-antonio/fixture-ranch/760-026" ', ""), COMMUNITY)![0]).toMatchObject({ status: null });
    expect(highlandStatus("Sold")).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    expect(highlandBaths("4/1")).toBe(4.5);
    expect(highlandBaths("3")).toBe(3);
    expect(highlandBaths("x")).toBeNull();
    expect(highlandHomeCount(communityPage())).toBe(3);
    expect(highlandCommunityFacts(communityPage())).toEqual({ name: "Fixture Ranch", street: "13316 Fixture Acacia", city: "San Antonio", zip: "78245", phone: "2106861496", geo: { lat: 29.393168609101, lng: -98.760523796082 } });
    expect(highlandRecord(communityPage())).toMatchObject({ name: "Fixture Ranch", street: "13316 Fixture Acacia", zip: "78245" });
    expect(highlandRecord("<html><body>new layout</body></html>")).toBeNull();
  });
});

describe("Highland Homes reader: a community", () => {
  it("reads the page once and publishes the homes scrubbed; plans are not on the page", async () => {
    const result = await loadOfficialDeals(config, { fetcher });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes).toHaveLength(3);
    expect(result.private.plans).toEqual([]);
    expect(result.private.communityFacts).toMatchObject({ schoolDistrict: "Northside ISD" });
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78245", "highlandhomes", "Highland", "Bradford", "760-026"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((home) => home.status)).toEqual(["Quick Move-In (Move-In Ready)", "Quick Move-In (November 2026)", "Quick Move-In (December 2026)"]);
  });

  it("holds the run when the page is not a community page, when fewer cards parse than the page counts, when the site is not Highland's, or when it cannot be read", async () => {
    const reshaped = vi.fn(async () => new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // The card class renamed: the page still counts 3 homes.
    const renamed = vi.fn(async () => new Response(communityPage().replaceAll("homeSpec", "homeCard"), { status: 200, headers: { "content-type": "text/html" } }));
    const held = await loadOfficialDeals(config, { fetcher: renamed });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    // The card class renamed and the count sentence reworded: zero cards is not zero homes, so the run is held rather than every home swept to sold.
    const reworded = vi.fn(async () => new Response(communityPage().replaceAll("homeSpec", "homeCard").replace("3 quick move-in homes", "Quick move-in homes available now"), { status: 200, headers: { "content-type": "text/html" } }));
    const swept = await loadOfficialDeals(config, { fetcher: reworded });
    expect(swept.holdReasons).toEqual(["expected_community_container_not_found"]);
    // A page that counts zero homes is a community with none for sale.
    const zero = vi.fn(async () => new Response(communityPage({ homes: [], count: 0 }), { status: 200, headers: { "content-type": "text/html" } }));
    const none = await loadOfficialDeals(config, { fetcher: zero });
    expect(none.holdReasons).toEqual([]);
    expect(none.private.homes).toEqual([]);
    // No office line: not a community page either.
    const noOffice = vi.fn(async () => new Response(communityPage({ office: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noOffice })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://highlandhomes.com/san-antonio/san-antonio/fixture-ranch" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new HighlandAdapter().builder).toBe("Highland Homes");
    expect(DEAL_ADAPTERS["Highland Homes"].builder).toBe("Highland Homes");
  });
});
