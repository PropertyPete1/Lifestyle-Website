import { beforeEach, describe, expect, it, vi } from "vitest";
import { PerryHomesAdapter, decodeFlightPayload, parsePerryDetail, perrySlugKind, resetPerrySitemapCache } from "./dealsAdapters.perry";
import { loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Perry pages in the shape the live site served in October 2026:
 * a Next.js React Flight payload in `self.__next_f.push` script tags. The
 * fixture names and addresses are invented.
 */
const COMMUNITY = "https://www.perryhomes.com/new-homes/texas/san-antonio/fixture-heights";
const COLLECTION = `${COMMUNITY}/fixture-heights-65`;

/** Wraps a Flight string the way Next does: split into chunks, each JSON-escaped inside a push. */
function flightHtml(head: string, bodyText: string, flight: string): string {
  const chunks: string[] = [];
  for (let index = 0; index < flight.length; index += 7_000) chunks.push(flight.slice(index, index + 7_000));
  const pushes = chunks.map((chunk) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`).join("\n");
  return `<!DOCTYPE html><html lang="en"><head>${head}</head><body><main>${bodyText}</main>\n<script>(self.__next_f=self.__next_f||[]).push([0])</script>\n${pushes}</body></html>`;
}

const image = (publicId: string, metadata: Record<string, unknown>) =>
  `{"public_id":"${publicId}","secure_url":"https://res.cloudinary.com/perryhomes/image/upload/v1791840778/${publicId}.jpg","width":2048,"height":1151,"display_name":"${publicId}","filename":"${publicId}","version":"1791840778","metadata":${JSON.stringify({ active: "active", ...metadata })},"format":"jpg","bytes":222779,"url":"http://res.cloudinary.com/perryhomes/image/upload/v1791840778/${publicId}.jpg","resource_type":"image","type":"upload","tags":[],"context":{},"exif":{},"faces":[],"colors":[],"derived":[],"moderation":{},"predominant":{},"coordinates":{},"access_control":[],"pages":1}`;

/** A home page: the home's photos carry its job number; the design's representative photos carry none. */
function homePage(input: { slug: string; street: string; job: string; price: number; discounted?: number; sqft: number; beds: number; baths: number; garage: number; halfBaths?: number; badge: string; design: string; ownPhotos: number }) {
  const path = `/new-homes/texas/san-antonio/fixture-heights/fixture-heights-65/${input.slug}`;
  const own = Array.from({ length: input.ownPhotos }, (_, index) => image(`${input.street.replace(/\s+/g, "")}${index ? `-0${index}` : ""}_x${index}`, { type: [index ? "interior" : "exterior"], design_id: input.design, job_number: input.job, community: "Fixture Heights", section: "Fixture Heights 65", address: input.street.replace(/\s+/g, "") }));
  const design = [image(`Designs/${input.design}/${input.design}_E1_web`, { type: ["exterior"], design_id: input.design, elevation_id: 1 }), image(`${input.design}-FP_abc`, { type: ["floor_plan"], design_id: input.design })];
  const flight = `e:["$","main",null,{"id":"main-content","children":[["$","$L26",null,{"home_title":"${input.street}","home_address":"${input.street}  Cibolo TX","home_details_id":"${input.job}","home_market":"san-antonio","community_name":"fixture-heights"}],["$","$28",null,{"children":["$","$L29",null,{"images":[${own.join(",")}],"address":{"address_1":"${input.street}","address_2":null,"city":"Cibolo","state":"TX","zip":"78108"},"home_details":{"baths":${input.baths},"bedrooms":${input.beds},"description":{"json":{"type":"doc","children":[]}},"design":{"designConnection":{"edges":[{"node":{"title":"${input.design}","images":[${design.join(",")}],"bedrooms":${input.beds + 1},"baths":${input.baths + 1}}}]}},"garage":${input.garage},"half_baths":${input.halfBaths ?? 0},"price":${input.price},"price_discounted":${input.discounted ?? 0},"sq_ft":${input.sqft},"story":2},"home_details_id":"${input.job}","home_description":"<p dir=\\"ltr\\">Description coming soon...</p>","move_in_ready_display_status":${input.badge === "Move-In Ready" ? "\"Move-In Ready\"" : "null"},"sales_date":null,"market":"san-antonio","community":"fixture-heights","section_title":"Fixture Heights 65'","section_url":"/new-homes/texas/san-antonio/fixture-heights/fixture-heights-65","home_title":"${input.street}","home_url":"${path}","designTitle":"","isFeatured":true,"cardChips":[],"badge":"${input.badge}","className":"mb-[3.2rem]","metadata":{"url":"https://www.perryhomes.com${path}","hashtags":["New Homes","Texas"]},"warehouse_id":"20381.65","design_id":"${input.design}","marketDisplayName":"San Antonio","communityDisplayName":"Fixture Heights"}]}]]}]`;
  return flightHtml(`<title>${input.street}, San Antonio, Texas | Fixture Heights 65 | San Antonio Home for Sale</title>`, `San Antonio/Fixture Heights/Fixture Heights 65'/${input.street}$${input.discounted ?? input.price}${input.street}Cibolo, TX 78108${input.badge}${input.sqft} Sq. Ft.${input.beds} Beds`, flight);
}

function planPage(input: { slug: string; design: string; price: number; sqft: number; beds: number; baths: number }) {
  const path = `/new-homes/texas/san-antonio/fixture-heights/fixture-heights-65/${input.slug}`;
  const design = [image(`Designs/${input.design}/${input.design}_E1_web`, { type: ["exterior"], design_id: input.design, elevation_id: 1 }), image(`Designs/${input.design}/${input.design}_E30_web`, { type: ["exterior"], design_id: input.design, elevation_id: 30 })];
  const flight = `e:["$","main",null,{"children":[["$","$L26",null,{"home_title":"","home_address":"","home_details_id":"","home_market":"san-antonio","community_name":"fixture-heights"}],["$","$28",null,{"children":["$","$L29",null,{"images":[${design.join(",")}],"address":{},"home_details":{"baths":${input.baths},"bedrooms":${input.beds},"description":null,"garage":2,"half_baths":0,"price":${input.price},"price_discounted":0,"sq_ft":${input.sqft},"story":1},"home_details_id":"$undefined","move_in_ready_display_status":"$undefined","sales_date":"$undefined","market":"san-antonio","community":"fixture-heights","section_title":"Fixture Heights 65'","section_url":"/new-homes/texas/san-antonio/fixture-heights/fixture-heights-65","home_title":"","home_url":"${path}","designTitle":"${input.design}","isFeatured":false,"cardChips":[],"badge":"Available to Build","metadata":{"url":"https://www.perryhomes.com${path}"},"design_id":"${input.design}"}]}]]}]`;
  return flightHtml(`<title>Design ${input.design} | Fixture Heights 65</title>`, `Design ${input.design}AVAILABLE TO BUILD`, flight);
}

const communityPage = flightHtml(
  "<title>Fixture Heights New Homes | San Antonio Area</title>",
  "New Homes for Sale in Fixture Heights Students attend Schertz-Cibolo-Universal City ISD. NOW OPEN Fixture Heights 65' From the $560s 2,200-4,000 Sq. Ft. View 3 Homes (210) 555-0100",
  `e:["$","main",null,{"children":[["$","$L30",null,{"sections":[{"section_title":"Fixture Heights 65'","section_url":"/new-homes/texas/san-antonio/fixture-heights/fixture-heights-65","from_price":"From the $560s"}]}]]}]`,
);

const sitemap = (urls: string[]) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;

const pages: Record<string, string> = {
  [COMMUNITY]: communityPage,
  [`${COLLECTION}/119-fixture-trail`]: homePage({ slug: "119-fixture-trail", street: "119 Fixture Trail", job: "20381.0030", price: 715_900, discounted: 624_900, sqft: 3_330, beds: 4, baths: 3, garage: 3, halfBaths: 1, badge: "Move-In Ready", design: "3330M", ownPhotos: 3 }),
  [`${COLLECTION}/143-fixture-trail`]: homePage({ slug: "143-fixture-trail", street: "143 Fixture Trail", job: "20381.0036", price: 686_900, discounted: 674_900, sqft: 2_920, beds: 5, baths: 4, garage: 2, badge: "December Move-In", design: "2608V", ownPhotos: 0 }),
  [`${COLLECTION}/2206h`]: planPage({ slug: "2206h", design: "2206H", price: 568_900, sqft: 2_206, beds: 3, baths: 2 }),
};
const SITEMAP_URLS = [
  "https://www.perryhomes.com/", "https://www.perryhomes.com/new-homes/texas/san-antonio", COMMUNITY, COLLECTION, `${COLLECTION}/sales-center`,
  `${COLLECTION}/119-fixture-trail`, `${COLLECTION}/143-fixture-trail`, `${COLLECTION}/2206h`,
  "https://www.perryhomes.com/new-homes/texas/san-antonio/other-place/other-place-50/100-other-way",
  "https://www.perryhomes.com/new-homes/florida/tampa/fixture-heights/fixture-heights-50/1-palm-court",
];

const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  if (input === "https://www.perryhomes.com/sitemap.xml") return new Response(sitemap(SITEMAP_URLS), { status: 200, headers: { "content-type": "application/xml" } });
  const page = pages[input.replace(/\/$/, "")];
  return page ? new Response(page, { status: 200, headers: { "content-type": "text/html" } }) : new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
});

const config: CommunitySourceConfig = { builder: "Perry Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Heights", scrubList: ["Fixture Heights", "Fixture Trail"] };

beforeEach(() => { requested.length = 0; fetcher.mockClear(); resetPerrySitemapCache(); });

describe("Perry Homes reader: page shapes", () => {
  it("tells homes, plans, collections and the sales center apart by their slugs", () => {
    const base = "/new-homes/texas/san-antonio/fixture-heights";
    expect(perrySlugKind(`${base}/fixture-heights-65/119-fixture-trail`, base)).toBe("home");
    expect(perrySlugKind(`${base}/fixture-heights-65/2206h`, base)).toBe("plan");
    expect(perrySlugKind(`${base}/fixture-heights-65/2608v`, base)).toBe("plan");
    expect(perrySlugKind(`${base}/fixture-heights-65`, base)).toBe("collection");
    expect(perrySlugKind(`${base}/fixture-heights-65/sales-center`, base)).toBe("other");
    expect(perrySlugKind(`${base}-north/x-50/1-main-st`, base)).toBe("other");
    expect(perrySlugKind("/new-homes/texas/san-antonio/other/other-50/1-main-st", base)).toBe("other");
  });

  it("reads a move-in-ready home: sale price with the list price it dropped from, specs, address, its own photos only", () => {
    const home = parsePerryDetail(pages[`${COLLECTION}/119-fixture-trail`]!, `${COLLECTION}/119-fixture-trail`);
    expect(home).toMatchObject({ kind: "home", status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null, price: 624_900, previousPrice: 715_900, priceDrop: 91_000, bedrooms: 4, bathrooms: 3, squareFeet: 3_330, garage: 3, privateName: "119 Fixture Trail", privateAddress: "119 Fixture Trail, Cibolo, TX 78108", privatePlanName: "Design 3330M", designId: "3330M" });
    expect(home?.gallery?.map((photo) => photo.sourceUrl.split("/").pop())).toEqual(["119FixtureTrail_x0.jpg", "119FixtureTrail-01_x1.jpg", "119FixtureTrail-02_x2.jpg"]);
    expect(home?.gallery?.every((photo) => photo.caption === null)).toBe(true);
  });

  it("reads a home still being built: month badge as the move-in date, the design's photo as a labelled stand-in", () => {
    const home = parsePerryDetail(pages[`${COLLECTION}/143-fixture-trail`]!, `${COLLECTION}/143-fixture-trail`);
    expect(home).toMatchObject({ status: "Quick Move-In (December Move-In)", readyNow: false, moveInDate: "December", price: 674_900, previousPrice: 686_900, bedrooms: 5, bathrooms: 4 });
    expect(home?.gallery).toEqual([{ sourceUrl: "https://res.cloudinary.com/perryhomes/image/upload/v1791840778/Designs/2608V/2608V_E1_web.jpg", caption: "Representative image", width: 2048, height: 1151, srcSet: null }]);
  });

  it("reads a plan: design name, starting price, the design's exterior photos, never the floor-plan drawing", () => {
    const plan = parsePerryDetail(pages[`${COLLECTION}/2206h`]!, `${COLLECTION}/2206h`);
    expect(plan).toMatchObject({ kind: "plan", privateName: "Design 2206H", privatePlanName: "Design 2206H", price: 568_900, previousPrice: null, bedrooms: 3, bathrooms: 2, squareFeet: 2_206, privateAddress: null, readyNow: false });
    expect(plan?.gallery?.map((photo) => photo.sourceUrl.split("/").pop())).toEqual(["2206H_E1_web.jpg", "2206H_E30_web.jpg"]);
  });

  it("returns nothing for a page without this path's object, and decodes escaped chunks", () => {
    expect(parsePerryDetail("<html><body>maintenance</body></html>", `${COLLECTION}/119-fixture-trail`)).toBeNull();
    expect(parsePerryDetail(pages[`${COLLECTION}/119-fixture-trail`]!, `${COLLECTION}/999-nowhere-lane`)).toBeNull();
    expect(decodeFlightPayload('<script>self.__next_f.push([1,"a\\"b\\u0026c"])</script><script>self.__next_f.push([1,"d"])</script>')).toBe("a\"b&cd");
  });
});

describe("Perry Homes reader: a community", () => {
  it("lists the community's homes and plans from the sitemap, reads each page once, and publishes them scrubbed", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => new Date("2026-10-20T12:00:00Z") });
    expect(result.ok).toBe(true);
    expect(result.private.homes.map((home) => [home.privateAddress, home.status, home.price])).toEqual([
      ["119 Fixture Trail, Cibolo, TX 78108", "Quick Move-In (Move-In Ready)", 624_900],
      ["143 Fixture Trail, Cibolo, TX 78108", "Quick Move-In (December Move-In)", 674_900],
    ]);
    expect(result.private.plans.map((plan) => [plan.privatePlanName, plan.price])).toEqual([["Design 2206H", 568_900]]);
    expect(result.private.communityFacts).toMatchObject({ schoolDistrict: "Schertz-Cibolo-Universal City ISD" });
    // Other communities, other markets, the collection page and the sales center are never fetched.
    expect(requested.filter((url) => /other-place|florida|sales-center/.test(url))).toEqual([]);
    expect(requested.filter((url) => url === COLLECTION)).toEqual([]);
    expect(requested.filter((url) => url === "https://www.perryhomes.com/sitemap.xml")).toHaveLength(1);
    // Public output carries figures only.
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture Trail", "Fixture Heights", "Cibolo", "78108", "3330M", "perryhomes.com"]) expect(json).not.toContain(secret);
    expect(result.public.homes).toHaveLength(2);
  });

  it("reads the sitemap once an hour across communities, and holds when a listed page cannot be read", async () => {
    await loadOfficialDeals(config, { fetcher, now: () => new Date("2026-10-20T12:00:00Z") });
    fetcher.mockClear(); requested.length = 0;
    await loadOfficialDeals(config, { fetcher, now: () => new Date("2026-10-20T12:30:00Z") });
    expect(requested).not.toContain("https://www.perryhomes.com/sitemap.xml");
    const flaky = vi.fn(async (input: string) => input.endsWith("/2206h") ? new Response("down", { status: 503, headers: { "content-type": "text/html" } }) : fetcher(input));
    const held = await loadOfficialDeals(config, { fetcher: flaky, now: () => new Date("2026-10-20T12:40:00Z") });
    expect(held.ok).toBe(false);
    expect(held.holdReasons).toEqual(["detail_fetch_failed"]);
    expect(held.public.homes).toEqual([]);
  });

  it("holds the run when a page's shape changed, when the site is not Perry's, or when there are too many pages to read safely", async () => {
    const reshaped = vi.fn(async (input: string) => input.endsWith("/119-fixture-trail") ? new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_detail_container_not_found"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://perryhomes.com/new-homes/texas/san-antonio/fixture-heights" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    resetPerrySitemapCache();
    const huge = vi.fn(async (input: string) => input === "https://www.perryhomes.com/sitemap.xml" ? new Response(sitemap(Array.from({ length: 160 }, (_, index) => `${COLLECTION}/${index + 100}-fixture-trail`)), { status: 200, headers: { "content-type": "application/xml" } }) : fetcher(input));
    expect((await loadOfficialDeals(config, { fetcher: huge })).holdReasons).toEqual(["incomplete_inventory"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new PerryHomesAdapter().builder).toBe("Perry Homes");
  });
});
