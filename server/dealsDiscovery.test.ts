import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealJobRuns } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Discovery from builders' own sitemaps and schema.org records. Synthetic
 * pages that follow the shapes the two live sites use (October 2026): Chesmar
 * serves a sitemap index and a LocalBusiness record with an address array; M/I
 * serves one URL set and a HomeAndConstructionBusiness record next to its
 * Organization and breadcrumb records.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), refreshCommunityGeography: vi.fn(), sendBuilderDealsEmail: vi.fn(), onboardFailure: null as string | null }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsOnboarding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dealsOnboarding")>();
  return { ...actual, onboardDiscoveredCommunities: async (communities: Array<{ builder: string }>) => {
    if (mocks.onboardFailure && communities.some((community) => community.builder === mocks.onboardFailure)) throw new Error("geocoder exploded");
    return actual.onboardDiscoveredCommunities(communities);
  } };
});
import { leaseBuilder } from "./dealsSync";

import { DISCOVERY_READERS, communityRecordFromHtml, discoverBuilderCommunities, drhListingEntries, priceFromRange, pulteListingEntries, runCommunityDiscovery } from "./dealsDiscovery";

const CH = "https://www.chesmar.com";
const MI = "https://www.mihomes.com";
const DRH = "https://www.drhorton.com";
const KB = "https://www.kbhome.com";
const kbPage = (name: string, street: string, city: string, zip: string, geo: { latitude: number; longitude: number }) => `<html><head><script type='application/ld+json'>${JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Place", "@id": `${KB}/new-homes-san-antonio/x#community`, name, address: { "@type": "PostalAddress", streetAddress: street, addressLocality: city, addressRegion: "TX", postalCode: zip, addressCountry: "US" }, telephone: "+1-830-555-0066", geo: { "@type": "GeoCoordinates", ...geo } }, { "@type": "Product", "@id": `${KB}/new-homes-san-antonio/x#homes`, name: `New Homes at ${name}` }] })}</script></head><body><script>FloorPlanList = []; LocalQMIs = [];</script></body></html>`;
const CC = "https://www.centurycommunities.com";
const centuryPage = (name: string, street: string, city: string, zip: string, geo: { latitude: number; longitude: number }) => page([{ "@context": "https://schema.org", "@type": "Organization", name: "Century Communities" }, { "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", name, telephone: "+1 210-555-0500", address: { "@type": "PostalAddress", streetAddress: street, addressLocality: city, addressRegion: "TX", postalCode: zip, addressCountry: "US" }, geo: { "@type": "GeoCoordinates", ...geo } }, { "@type": "ProductGroup", name, hasVariant: [] }]);

const HH = "https://www.highlandhomes.com";
const highlandPage = (name: string, street: string, city: string, zip: string, geo: { lat: number; lng: number }) => `<html><head><title>New Homes in ${name} - Home Builder in ${city} TX</title></head><body><h1>Highland Homes</h1><div class="column"><h1><strong>${name}</strong></h1><p class="row column subheader"><span id="salesOfficeAddressDirectionsLink">${street}, <nobr>${city}, TX ${zip}</nobr></span></p><a href="https://maps.google.com/maps?q=loc:${geo.lat},${geo.lng}(${street})">Directions</a><p>O: 210-686-1496</p></div><p>0 quick move-in homes</p></body></html>`;

const DAV = "https://www.davidsonhomes.com";
const nextPage = (pageProps: unknown) => `<html><head><link rel="preload" href="https://cdn.sanity.io/images/2nureyi3/production/x-1x1.jpg"></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps }, page: "/x" })}</script></body></html>`;
const davidsonCommunity = (title: string, street: string, city: string, zip: string, geo: { lat: number; lng: number }) => nextPage({ community: { title, phone: "2105550400", communityStatus: "Now Selling", salesOffice: { streetAddress: street, zipCode: zip }, coordinates: { _type: "geopoint", ...geo }, communityPriceRange: { lowestPrice: 260_990 }, schools: [], features: [], availableHomes: [], plans: [], communityBanner: { enableCommunityBanner: false } }, city: { title: city } });

const reader = (builder: string) => DISCOVERY_READERS.find((entry) => entry.builder === builder)!;
const FAH = "https://www.firstamericahomes.com";
const COV = "https://www.coventryhomes.com";
/** Homefiniti: the community's HomeAndConstructionBusiness record with coordinates and phone. */
const homefinitiRecord = (name: string, street: string, city: string, zip: string, geo = { latitude: "29.31", longitude: "-98.55" }) => ({ "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", name, url: "x", telephone: "+12105550300", geo: { "@type": "GeoCoordinates", ...geo }, address: { "@type": "PostalAddress", postalCode: zip, addressRegion: "TX", streetAddress: street, addressCountry: "US", addressLocality: city }, parentOrganization: { name: "Builder", "@type": "Organization" } });

const PULTE = "https://www.pulte.com";
const CENTEX = "https://www.centex.com";
const DELWEBB = "https://www.delwebb.com";
/** PulteGroup's market listing names every brand's communities; other brands' pages are absolute URLs on their own hosts. */
const pulteListing = JSON.stringify([
  { id: 211074, name: "Fixture Ridge", status: "Save on To-Be-Built Homes", brandName: "Pulte", address: { street1: "13607 Fixture Way", zipCode: "78245", city: "San Antonio" }, latitude: 29.39, longitude: -98.72, isCommunityActive: true, pageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211074", salesPhoneNumber: "(210) 555-0101", startingFromPrice: 333_990 },
  { id: 211073, name: "Fixture Ridge", status: "Quick Move-Ins Available", brandName: "Centex", address: { street1: "13607 Fixture Way", zipCode: "78245", city: "San Antonio" }, latitude: 29.39, longitude: -98.72, isCommunityActive: true, pageURL: `${CENTEX}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073`, salesPhoneNumber: "(210) 555-0100", startingFromPrice: 251_490 },
  { id: 211338, name: "Fixture Webb at Far Falls", status: "New Phase Available", brandName: "Del Webb", address: { street1: "1 Far Rd", zipCode: "78640", city: "Kyle" }, latitude: 29.99, longitude: -97.87, isCommunityActive: true, pageURL: `${DELWEBB}/homes/texas/san-antonio/kyle/fixture-webb-211338`, salesPhoneNumber: null, startingFromPrice: 400_000 },
  { id: 211799, name: "Closed Fixture", status: "Sold Out", brandName: "Pulte", address: { street1: "2 Done St", zipCode: "78245", city: "San Antonio" }, latitude: 29.39, longitude: -98.72, isCommunityActive: false, pageURL: "/homes/texas/san-antonio/san-antonio/closed-fixture-211799", salesPhoneNumber: null, startingFromPrice: null },
]);
const pulteListingUrl = (host: string, brand: string) => `https://${host}/API/Community/Search?State=Texas&Region=San%20Antonio&Brand=${encodeURIComponent(brand)}&JsonFormat=true&pageSize=0`;
/** D.R. Horton: a page-title "Place" record with lower-case address keys and coordinates, then the community's LocalBusiness record. */
const drhRecords = (name: string, street: string, city: string, zip: string, geo = { latitude: 29.3778, longitude: -98.3754 }) => [
  { name: `Houses For Sale in ${city}, TX | ${name} | D.R. Horton`, description: "Find homes for sale", "@context": "http://schema.org", "@type": "Place", url: `${DRH}/x`, address: { "@type": "PostalAddress", addresslocality: city.toUpperCase(), addressregion: "TX", postalcode: zip, streetaddress: street }, ...geo },
  { "@context": "https://schema.org", "@type": "LocalBusiness", name, address: { "@type": "PostalAddress", streetAddress: street, addressLocality: city.toUpperCase(), postalCode: zip, addressRegion: "TX", addressCountry: "US" } },
  { "@context": "https://schema.org", "@type": "WebPage", name: `Houses For Sale in ${city}, TX | ${name} | D.R. Horton`, publisher: { "@type": "Organization", name: "D.R. Horton" } },
];
const drhListing = (entries: Array<[string, string]>) => JSON.stringify({ MetaData: { AreaInfoData: { Name: "San Antonio" } }, FacetData: {}, CommunityData: entries.map(([commName, commPageLink]) => ({ commName, commPageLink, commSellingStatus: "Now Selling", commAvailableHomes: 3, commMinPrice: 242_000 })) });
const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const urlset = (urls: string[]) => xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`);
const page = (records: unknown[], body = "<h1>Community</h1><p>Now selling</p>") => `<!doctype html><html><head>${records.map((record) => `<script type="application/ld+json">${JSON.stringify(record)}</script>`).join("")}</head><body>${body}</body></html>`;
const chesmarRecord = (name: string, street: string, city: string, zip: string, geo = { latitude: "29.42", longitude: "-98.31" }) => ({ "@context": "http://schema.org", "@type": "LocalBusiness", name, telephone: "2105550100", geo: { ...geo, "@type": "GeoCoordinates" }, address: [{ addressCountry: "US", addressLocality: city, addressRegion: "TX", postalCode: zip, streetAddress: street }] });
const miRecords = (name: string, street: string, city: string, zip: string, geo = { latitude: 29.52, longitude: -98.31 }) => [
  { "@context": "https://schema.org", "@type": "Organization", name: "M/I Homes", url: MI },
  { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] },
  { "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", name, telephone: "+12105550200", priceRange: "$289,990 - $412,990", geo: { "@type": "GeoCoordinates", ...geo }, address: { "@type": "PostalAddress", streetAddress: street, addressLocality: city, addressRegion: "TX", postalCode: zip, addressCountry: "US" } },
];

const site: Record<string, { status?: number; body: string; type?: string; location?: string }> = {
  [`${CH}/sitemap.xml`]: { body: xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${CH}/sitemap-communities.xml</loc></sitemap><sitemap><loc>${CH}/sitemap-homes.xml</loc></sitemap></sitemapindex>`), type: "application/xml" },
  [`${CH}/sitemap-communities.xml`]: { body: urlset([`${CH}/texas/san-antonio-new-homes/`, `${CH}/texas/san-antonio-new-homes/san-antonio/`, `${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes/`, `${CH}/texas/san-antonio-new-homes/boerne/esperanza-60's/`, `${CH}/texas/austin-new-homes/leander/elsewhere/`, `${CH}/texas/san-antonio-new-homes/schertz/no-record/`]), type: "application/xml" },
  [`${CH}/sitemap-homes.xml`]: { body: urlset([`${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes/brandon/`, `${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes/brandon/118-x/`]), type: "application/xml" },
  [`${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes/`]: { body: page([chesmarRecord("Sienna Lakes", "9010 Arroyo Grove", "San Antonio", "78263")]) },
  [`${CH}/texas/san-antonio-new-homes/boerne/esperanza-60's/`]: { body: page([chesmarRecord("Esperanza 60&#39;s", "218 Navarro", "Boerne", "78006", { latitude: "29.79", longitude: "-98.73" })]) },
  [`${CH}/texas/san-antonio-new-homes/schertz/no-record/`]: { body: "<html><body><h1>Coming soon</h1></body></html>" },
  [`${MI}/Sitemap/sitemap.xml`]: { body: urlset([`${MI}/new-homes/texas/greater-san-antonio/communities`, `${MI}/new-homes/texas/greater-san-antonio/quick-move-in-homes/some-home`, `${MI}/new-homes/texas/greater-san-antonio/converse/paloma-park`, `${MI}/new-homes/texas/greater-san-antonio/san-marcos/high-branch`, `${MI}/new-homes/texas/greater-san-antonio/converse/paloma-park/some-plan`]), type: "application/xml" },
  [`${MI}/new-homes/texas/greater-san-antonio/converse/paloma-park`]: { body: page(miRecords("Paloma Park", "10223 White Hart Lane", "Converse", "78109")) },
  [`${MI}/new-homes/texas/greater-san-antonio/san-marcos/high-branch`]: { body: page(miRecords("High Branch", "1 Branch Rd", "San Marcos", "78666", { latitude: 29.88, longitude: -97.94 })) },
  [`${DRH}/api/comms/direct/texas/san-antonio`]: { body: drhListing([["Fixture Ranch", "/texas/san-antonio/san-antonio/fixture-ranch"], ["Far Fixture", "/texas/san-antonio/kyle/far-fixture"], ["Market page", "/texas/san-antonio"]]), type: "application/json; charset=utf-8" },
  [`${DRH}/texas/san-antonio/san-antonio/fixture-ranch`]: { body: page(drhRecords("Fixture Ranch", "3702 Fixture Terrace", "San Antonio", "78222")) },
  // Kyle is about 55 miles out: the market listing reaches past the area we cover.
  [`${DRH}/texas/san-antonio/kyle/far-fixture`]: { body: page(drhRecords("Far Fixture", "1 Far Rd", "Kyle", "78640", { latitude: 29.99, longitude: -97.87 })) },
  // Each host serves the same listing; only its own brand's pages are relative paths.
  [pulteListingUrl("www.pulte.com", "Pulte")]: { body: pulteListing, type: "application/json; charset=utf-8" },
  [pulteListingUrl("www.centex.com", "Centex")]: { body: pulteListing.replaceAll("\"pageURL\":\"/homes/", `"pageURL":"${PULTE}/homes/`).replace(`${CENTEX}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073`, "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073"), type: "application/json; charset=utf-8" },
  [`${FAH}/sitemap.xml`]: { body: urlset([`${FAH}/new-homes/tx/san-antonio-metro/`, `${FAH}/new-homes/tx/san-antonio-metro/san-antonio/fixture-meadows/`, `${FAH}/new-homes/tx/san-antonio-metro/floorplans/calista/`, `${FAH}/new-homes/tx/houston-metro/katy/far-fixture/`, `${FAH}/new-homes/tx/san-antonio/fixture-meadows/vail/2326-fixture-way/`]), type: "application/xml" },
  [`${FAH}/new-homes/tx/san-antonio-metro/san-antonio/fixture-meadows/`]: { body: page([homefinitiRecord("Fixture Meadows", "10318 Fixture Junction", "San Antonio", "78224")]) },
  [`${COV}/new-homes/tx/san-antonio/`]: { body: `<html><body><a href="/new-homes/tx/san-antonio/available-homes/">All</a><a href="/new-homes/tx/cibolo/buffalo-fixture/">Buffalo Fixture</a><a href="/new-homes/tx/new-braunfels/build-on-your-lot-2/">BOYL</a><a href="/new-homes/tx/kyle/far-fixture/">Far</a></body></html>` },
  [`${COV}/new-homes/tx/cibolo/buffalo-fixture/`]: { body: page([homefinitiRecord("Buffalo Fixture", "1 Fixture Rd", "Cibolo", "78108", { latitude: "29.58", longitude: "-98.22" })]) },
  [`${COV}/new-homes/tx/kyle/far-fixture/`]: { body: page([homefinitiRecord("Far Fixture", "1 Far Rd", "Kyle", "78640", { latitude: "29.99", longitude: "-97.87" })]) },
  [`${DAV}/states/texas/san-antonio-market-area/`]: { body: nextPage({ communities: [{ title: "Fixture Meadows", city: "San Antonio", uri: "/states/texas/san-antonio-market-area/san-antonio/fixture-meadows/" }, { title: "Far Fixture", city: "Kyle", uri: "/states/texas/san-antonio-market-area/kyle/far-fixture/" }] }) },
  [`${DAV}/states/texas/san-antonio-market-area/san-antonio/fixture-meadows/`]: { body: davidsonCommunity("Fixture Meadows", "10326 Fixture Jct", "San Antonio", "78224", { lat: 29.31, lng: -98.55 }) },
  [`${DAV}/states/texas/san-antonio-market-area/kyle/far-fixture/`]: { body: davidsonCommunity("Far Fixture", "1 Far Rd", "Kyle", "78640", { lat: 29.99, lng: -97.87 }) },
  [`${HH}/sitemap.xml`]: { body: urlset([`${HH}/san-antonio`, `${HH}/san-antonio/san-antonio/fixture-ranch`, `${HH}/san-antonio/san-antonio/fixture-ranch/760-026`, `${HH}/san-antonio/san-antonio/new-home-concierge`, `${HH}/san-antonio/san-marcos/far-fixture`, `${HH}/dallas/frisco/other-fixture`]), type: "application/xml" },
  [`${HH}/san-antonio/san-antonio/fixture-ranch`]: { body: highlandPage("Fixture Ranch", "13316 Fixture Acacia", "San Antonio", "78245", { lat: 29.3931, lng: -98.7605 }) },
  [`${HH}/san-antonio/san-marcos/far-fixture`]: { body: highlandPage("Far Fixture", "1 Far Rd", "San Marcos", "78666", { lat: 29.88, lng: -97.94 }) },
  [`${KB}/sitemap.xml`]: { body: urlset([`${KB}/new-homes-san-antonio`, `${KB}/new-homes-san-antonio/fixture-heights`, `${KB}/new-homes-san-antonio/fixture-heights/plan-2246`, `${KB}/new-homes-austin/far-fixture`, `${KB}/new-homes-san-antonio/far-fixture`]), type: "application/xml" },
  [`${KB}/new-homes-san-antonio/fixture-heights`]: { body: kbPage("Fixture Heights - Heritage Collection", "1308 Fixture Ave.", "New Braunfels", "78130", { latitude: 29.638, longitude: -98.112 }) },
  [`${KB}/new-homes-san-antonio/far-fixture`]: { body: kbPage("Far Fixture", "1 Far Rd.", "Kyle", "78640", { latitude: 29.99, longitude: -97.87 }) },
  [`${CC}/sitemap.xml`]: { body: urlset([`${CC}/find-your-new-home/texas/san-antonio-metro/`, `${CC}/find-your-new-home/texas/san-antonio-metro/san-antonio/fixture-grove/`, `${CC}/find-your-new-home/texas/san-antonio-metro/san-antonio/fixture-grove/lots/15177a-9122-fixture-rdg/`, `${CC}/find-your-new-home/texas/houston-metro/katy/far-fixture/`]), type: "application/xml" },
  [`${CC}/find-your-new-home/texas/san-antonio-metro/san-antonio/fixture-grove/`]: { body: centuryPage("Fixture Grove", "9106 Fixture Rdg", "San Antonio", "78222", { latitude: 29.33, longitude: -98.4 }) },
  [pulteListingUrl("www.delwebb.com", "Del Webb")]: { body: pulteListing.replaceAll("\"pageURL\":\"/homes/", `"pageURL":"${PULTE}/homes/`).replace(`${DELWEBB}/homes/texas/san-antonio/kyle/fixture-webb-211338`, "/homes/texas/san-antonio/kyle/fixture-webb-211338"), type: "application/json; charset=utf-8" },
};

const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const entry = site[input];
  if (!entry) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  return new Response(entry.body, { status: entry.status ?? 200, headers: { "content-type": entry.type ?? "text/html", ...(entry.location ? { location: entry.location } : {}) } });
});

let db: FakeDealsDb;
beforeEach(() => {
  vi.clearAllMocks();
  requested.length = 0;
  mocks.onboardFailure = null;
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: false, reason: "test" });
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true });
});

describe("reading a builder's own records", () => {
  it("takes the community record, not the builder's or the breadcrumb, and reads its price range", () => {
    expect(communityRecordFromHtml(page(miRecords("Paloma Park", "10223 White Hart Lane", "Converse", "78109")))).toEqual({ name: "Paloma Park", street: "10223 White Hart Lane", city: "Converse", zip: "78109", phone: "+12105550200", priceFrom: 289_990, geo: { lat: 29.52, lng: -98.31 } });
    expect(communityRecordFromHtml(page([{ "@type": "Organization", name: "Builder", address: { streetAddress: "1 HQ", postalCode: "78000" } }]))).toBeNull();
    expect(communityRecordFromHtml(page([{ "@graph": [chesmarRecord("Graph Place", "1 Main", "Seguin", "78155")] }]))).toMatchObject({ name: "Graph Place", city: "Seguin", zip: "78155" });
    expect(communityRecordFromHtml(page([{ ...chesmarRecord("Far Place", "1 Main", "Dallas", "75001"), address: [{ addressRegion: "OK", postalCode: "73001", streetAddress: "x" }] }]))).toBeNull();
    expect(communityRecordFromHtml("<script type=\"application/ld+json\">{broken</script>")).toBeNull();
    // D.R. Horton: the plain-named LocalBusiness record wins over the page-title Place record, which lends its coordinates.
    expect(communityRecordFromHtml(page(drhRecords("Fixture Ranch", "3702 Fixture Terrace", "San Antonio", "78222")))).toEqual({ name: "Fixture Ranch", street: "3702 Fixture Terrace", city: "San Antonio", zip: "78222", phone: null, priceFrom: null, geo: { lat: 29.3778, lng: -98.3754 } });
    expect(drhListingEntries(drhListing([["A", "/texas/san-antonio/a/b"]]), "www.drhorton.com")).toEqual([{ url: `${DRH}/texas/san-antonio/a/b`, record: null }]);
    expect(drhListingEntries("<html>maintenance</html>", "www.drhorton.com")).toBeNull();
    expect(drhListingEntries("{\"MetaData\":{}}", "www.drhorton.com")).toBeNull();
    // PulteGroup's listing carries the record itself, for every brand; each reader keeps its own host's entries.
    const pulte = pulteListingEntries(pulteListing, "www.pulte.com")!;
    expect(pulte.map((entry) => entry.url)).toEqual([`${PULTE}/homes/texas/san-antonio/san-antonio/fixture-ridge-211074`, `${CENTEX}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073`, `${DELWEBB}/homes/texas/san-antonio/kyle/fixture-webb-211338`]);
    expect(pulte[0]!.record).toEqual({ name: "Fixture Ridge", street: "13607 Fixture Way", city: "San Antonio", zip: "78245", phone: "2105550101", priceFrom: 333_990, geo: { lat: 29.39, lng: -98.72 } });
    expect(pulteListingEntries("<html>maintenance</html>", "www.pulte.com")).toBeNull();
    // With the brand given, another brand's entry is left out even when its page URL is relative; a (0, 0) coordinate is no place.
    const mixed = pulteListing.replace(`${CENTEX}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073`, "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073").replace("\"latitude\":29.39,\"longitude\":-98.72,\"isCommunityActive\":true,\"pageURL\":\"/homes/texas/san-antonio/san-antonio/fixture-ridge-211074\"", "\"latitude\":0,\"longitude\":0,\"isCommunityActive\":true,\"pageURL\":\"/homes/texas/san-antonio/san-antonio/fixture-ridge-211074\"");
    const own = pulteListingEntries(mixed, "www.pulte.com", "Pulte")!;
    expect(own.map((entry) => [entry.url, entry.record?.geo ?? null])).toEqual([[`${PULTE}/homes/texas/san-antonio/san-antonio/fixture-ridge-211074`, null]]);
    // The community record: a business record wins over a featured home's residence record placed before it, and a page-title Place record.
    const featuredFirst = page([
      { "@type": "SingleFamilyResidence", name: "5919 Granite Fixture", address: { streetAddress: "5919 Granite Fixture", addressLocality: "San Antonio", postalCode: "78222" }, geo: { latitude: 29.37, longitude: -98.37 } },
      ...drhRecords("Fixture Ranch", "3702 Fixture Terrace", "San Antonio", "78222"),
    ]);
    expect(communityRecordFromHtml(featuredFirst)).toMatchObject({ name: "Fixture Ranch", street: "3702 Fixture Terrace" });
    // Without a business record there is no community on the page: a lone residence record is a featured home, never the community.
    const residenceOnly = page([{ "@type": "SingleFamilyResidence", name: "5919 Granite Fixture", address: { streetAddress: "5919 Granite Fixture", addressLocality: "San Antonio", postalCode: "78222" }, geo: { latitude: 29.37, longitude: -98.37 } }]);
    expect(communityRecordFromHtml(residenceOnly)).toBeNull();
    expect(priceFromRange("From $1,250,000")).toBe(1_250_000);
    expect(priceFromRange("$$")).toBeNull();
  });
});

describe("discovery", () => {
  it("finds a builder's San Antonio communities from its sitemap, one page at a time, and skips what is not one", async () => {
    const chesmar = await discoverBuilderCommunities(reader("Chesmar"), fetcher);
    expect(chesmar.ok).toBe(true);
    expect(chesmar.communities.map((community) => [community.name, community.city, community.zip, community.address])).toEqual([
      ["Sienna Lakes", "San Antonio", "78263", "9010 Arroyo Grove, San Antonio, TX 78263"],
      ["Esperanza 60's", "Boerne", "78006", "218 Navarro, Boerne, TX 78006"],
    ]);
    expect(chesmar.skipped).toEqual([{ url: `${CH}/texas/san-antonio-new-homes/schertz/no-record/`, reason: "no_community_record" }]);
    // Market and city index pages, plans, homes and other markets are never fetched as communities.
    expect(requested.some((url) => /austin|brandon|\/san-antonio\/$/.test(url))).toBe(false);

    const mi = await discoverBuilderCommunities(reader("M/I Homes"), fetcher);
    expect(mi.communities.map((community) => community.name)).toEqual(["Paloma Park"]);
    // San Marcos is about 50 miles out: outside the area we cover.
    expect(mi.skipped).toEqual([{ url: `${MI}/new-homes/texas/greater-san-antonio/san-marcos/high-branch`, reason: "outside_area" }]);
    expect(mi.communities[0]).toMatchObject({ priceFrom: 289_990, salesPhone: "+12105550200" });

    // A community the sitemap spells with and without a trailing slash is one community, read once.
    const doubled = vi.fn(async (input: string) => input === `${CH}/sitemap-communities.xml` ? new Response(urlset([`${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes/`, `${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes`]), { status: 200, headers: { "content-type": "application/xml" } }) : fetcher(input));
    requested.length = 0;
    const once = await discoverBuilderCommunities(reader("Chesmar"), doubled);
    expect(once.communities.map((community) => community.name)).toEqual(["Sienna Lakes"]);
    expect(requested.filter((url) => /sienna-lakes/.test(url))).toHaveLength(1);

    // D.R. Horton lists its communities in a market listing, not a sitemap; the market page itself is not a community.
    const drh = await discoverBuilderCommunities(reader("D.R. Horton"), fetcher);
    expect(drh.ok).toBe(true);
    expect(drh.communities.map((community) => [community.name, community.city, community.zip, community.address])).toEqual([["Fixture Ranch", "San Antonio", "78222", "3702 Fixture Terrace, San Antonio, TX 78222"]]);
    expect(drh.skipped).toEqual([{ url: `${DRH}/texas/san-antonio/kyle/far-fixture`, reason: "outside_area" }]);
    expect(requested.filter((url) => url === `${DRH}/texas/san-antonio`)).toEqual([]);

    // Homefiniti: First America from its sitemap (San Antonio market paths only, never a plan or a home page); Coventry from its market page.
    const fah = await discoverBuilderCommunities(reader("First America Homes"), fetcher);
    expect(fah.communities.map((community) => [community.name, community.address, community.salesPhone])).toEqual([["Fixture Meadows", "10318 Fixture Junction, San Antonio, TX 78224", "+12105550300"]]);
    expect(requested.filter((url) => /houston-metro|floorplans|2326-fixture-way/.test(url))).toEqual([]);
    const coventry = await discoverBuilderCommunities(reader("Coventry Homes"), fetcher);
    expect(coventry.communities.map((community) => community.name)).toEqual(["Buffalo Fixture"]);
    expect(coventry.skipped).toEqual([{ url: `${COV}/new-homes/tx/kyle/far-fixture/`, reason: "outside_area" }]);
    expect(requested.filter((url) => /build-on-your-lot|available-homes/.test(url))).toEqual([]);

    // Davidson: the market page's Next.js data lists the communities; the community page's data gives the sales address (no schema.org record there).
    const davidson = await discoverBuilderCommunities(reader("Davidson Homes"), fetcher);
    expect(davidson.communities.map((community) => [community.name, community.address, community.salesPhone, community.priceFrom])).toEqual([["Fixture Meadows", "10326 Fixture Jct, San Antonio, TX 78224", "2105550400", 260_990]]);
    expect(davidson.skipped).toEqual([{ url: `${DAV}/states/texas/san-antonio-market-area/kyle/far-fixture/`, reason: "outside_area" }]);
    // A page whose record has no coordinates cannot pass the area check and is not added on faith.
    const placed = site[`${DAV}/states/texas/san-antonio-market-area/kyle/far-fixture/`]!;
    site[`${DAV}/states/texas/san-antonio-market-area/kyle/far-fixture/`] = { body: placed.body.replace(/"coordinates":\{[^}]*\}/g, "\"coordinates\":null").replace(/"salesOfficeGeocode":\{[^}]*\}/g, "\"salesOfficeGeocode\":null") };
    const unplaced = await discoverBuilderCommunities(reader("Davidson Homes"), fetcher);
    expect(unplaced.communities.map((community) => community.name)).toEqual(["Fixture Meadows"]);
    expect(unplaced.skipped).toEqual([{ url: `${DAV}/states/texas/san-antonio-market-area/kyle/far-fixture/`, reason: "no_community_record" }]);
    site[`${DAV}/states/texas/san-antonio-market-area/kyle/far-fixture/`] = placed;

    // Highland: the sitemap's San Antonio market pages, each read for its office line and map link; the concierge page, home pages and other markets are left.
    requested.length = 0;
    const highland = await discoverBuilderCommunities(reader("Highland Homes"), fetcher);
    expect(highland.communities.map((community) => [community.name, community.address, community.salesPhone])).toEqual([["Fixture Ranch", "13316 Fixture Acacia, San Antonio, TX 78245", "2106861496"]]);
    expect(highland.skipped).toEqual([{ url: `${HH}/san-antonio/san-marcos/far-fixture`, reason: "outside_area" }]);
    expect(requested.filter((url) => /concierge|760-026|dallas/.test(url))).toEqual([]);

    // KB Home: the sitemap's San Antonio market community pages, never a plan page or another market; the Place record places them.
    requested.length = 0;
    const kb = await discoverBuilderCommunities(reader("KB Home"), fetcher);
    expect(kb.communities.map((community) => [community.name, community.address, community.salesPhone])).toEqual([["Fixture Heights - Heritage Collection", "1308 Fixture Ave., New Braunfels, TX 78130", "8305550066"]]);
    expect(kb.skipped).toEqual([{ url: `${KB}/new-homes-san-antonio/far-fixture`, reason: "outside_area" }]);
    expect(requested.filter((url) => /plan-|new-homes-austin/.test(url))).toEqual([]);

    // Century: the sitemap's San Antonio metro community pages, never a lot page or another metro.
    requested.length = 0;
    const century = await discoverBuilderCommunities(reader("Century Communities"), fetcher);
    expect(century.communities.map((community) => [community.name, community.address])).toEqual([["Fixture Grove", "9106 Fixture Rdg, San Antonio, TX 78222"]]);
    expect(requested.filter((url) => /lots\/|houston-metro/.test(url))).toEqual([]);

    // PulteGroup: the listing carries the record, so no community page is read; each brand keeps its own; a closed community and one 55 miles out are left.
    requested.length = 0;
    const pulte = await discoverBuilderCommunities(reader("Pulte"), fetcher);
    expect(pulte.communities.map((community) => [community.builder, community.name, community.address, community.salesPhone, community.priceFrom])).toEqual([["Pulte", "Fixture Ridge", "13607 Fixture Way, San Antonio, TX 78245", "2105550101", 333_990]]);
    const centex = await discoverBuilderCommunities(reader("Centex"), fetcher);
    expect(centex.communities.map((community) => [community.builder, community.sourceUrl])).toEqual([["Centex", `${CENTEX}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073`]]);
    const delWebb = await discoverBuilderCommunities(reader("Del Webb"), fetcher);
    expect(delWebb).toMatchObject({ ok: true, communities: [], skipped: [{ url: `${DELWEBB}/homes/texas/san-antonio/kyle/fixture-webb-211338`, reason: "outside_area" }] });
    expect(requested.every((url) => url.includes("/API/Community/Search"))).toBe(true);
  });

  it("adds new communities hidden, leaves the ones already there alone, and emails what it found", async () => {
    db.seed(dealCommunities, { builder: "Chesmar", privateName: "Sienna Lakes", sourceUrl: `${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes`, privateAddress: "9010 Arroyo Grove, San Antonio, TX 78263", publicLabel: "Southeast San Antonio | Half-Acre Lots and Lakes", areaLabel: "Southeast San Antonio", amenities: "[]", reelCode: "sl1", scrubList: "{}", active: true, paused: false, manualMode: false });
    const run = await runCommunityDiscovery(fetcher);
    expect(run).toMatchObject({ created: 11, builders: [{ builder: "Chesmar", ok: true, found: 2, created: 1, existing: 1 }, { builder: "M/I Homes", ok: true, found: 1, created: 1 }, { builder: "D.R. Horton", ok: true, found: 1, created: 1 }, { builder: "First America Homes", ok: true, found: 1, created: 1 }, { builder: "Coventry Homes", ok: true, found: 1, created: 1 }, { builder: "Davidson Homes", ok: true, found: 1, created: 1 }, { builder: "Highland Homes", ok: true, found: 1, created: 1 }, { builder: "KB Home", ok: true, found: 1, created: 1 }, { builder: "Century Communities", ok: true, found: 1, created: 1 }, { builder: "Pulte", ok: true, found: 1, created: 1 }, { builder: "Centex", ok: true, found: 1, created: 1 }, { builder: "Del Webb", ok: true, found: 0, created: 0 }] });
    const added = db.rows(dealCommunities).filter((row) => row.awaitingFirstSync);
    expect(added.map((row) => [row.privateName, row.active, row.areaLabel])).toEqual([["Esperanza 60's", false, "Boerne"], ["Paloma Park", false, "Greater San Antonio"], ["Fixture Ranch", false, "Greater San Antonio"], ["Fixture Meadows", false, "Greater San Antonio"], ["Buffalo Fixture", false, "Greater San Antonio"], ["Fixture Meadows", false, "Greater San Antonio"], ["Fixture Ranch", false, "Greater San Antonio"], ["Fixture Heights - Heritage Collection", false, "New Braunfels"], ["Fixture Grove", false, "Greater San Antonio"], ["Fixture Ridge", false, "Greater San Antonio"], ["Fixture Ridge", false, "Greater San Antonio"]]);
    // The exact coordinates on the builder's page are never stored.
    expect(JSON.stringify(db.rows(dealCommunities))).not.toMatch(/29\.79|98\.73|29\.52/);
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledTimes(1);
    const email = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { subject: string; content: string };
    expect(email.subject).toBe("Builder Deals: 11 new communities found");
    expect(email.content).toContain("Esperanza 60's (Chesmar)");
    expect(email.content).toContain("Paloma Park (M/I Homes)");
    expect(email.content).toContain("Fixture Ranch (D.R. Horton)");
    // Running again adds nothing and sends nothing.
    mocks.sendBuilderDealsEmail.mockClear();
    expect(await runCommunityDiscovery(fetcher)).toMatchObject({ created: 0 });
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();
  });

  it("adds nothing for a builder whose sitemap cannot be read, says so, and carries on with the rest", async () => {
    const broken = vi.fn(async (input: string) => input.startsWith(CH) ? new Response("<html>maintenance</html>", { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const run = await runCommunityDiscovery(broken);
    expect(run).toMatchObject({ created: 10, builders: [{ builder: "Chesmar", ok: false, reason: "sitemap_unreadable", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }, { builder: "D.R. Horton", ok: true, created: 1 }, { builder: "First America Homes", ok: true, created: 1 }, { builder: "Coventry Homes", ok: true, created: 1 }, { builder: "Davidson Homes", ok: true, created: 1 }, { builder: "Highland Homes", ok: true, created: 1 }, { builder: "KB Home", ok: true, created: 1 }, { builder: "Century Communities", ok: true, created: 1 }, { builder: "Pulte", ok: true, created: 1 }, { builder: "Centex", ok: true, created: 1 }, { builder: "Del Webb", ok: true, created: 0 }] });
    const email = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { content: string };
    expect(email.content).toContain("Could not read Chesmar's site list this time");
  });

  it("reads each builder under its lease, so a lane or Refresh now never reads the same site at the same time, and releases it after", async () => {
    const run = await runCommunityDiscovery(fetcher);
    expect(run).toMatchObject({ created: 12 });
    const leases = db.rows(dealJobRuns).filter((row) => row.jobName.startsWith("builder-deals-lane-"));
    expect(leases.map((row) => [row.jobName, row.status]).sort()).toEqual([["builder-deals-lane-Centex", "ok"], ["builder-deals-lane-Century Communities", "ok"], ["builder-deals-lane-Chesmar", "ok"], ["builder-deals-lane-Coventry Homes", "ok"], ["builder-deals-lane-D.R. Horton", "ok"], ["builder-deals-lane-Davidson Homes", "ok"], ["builder-deals-lane-Del Webb", "ok"], ["builder-deals-lane-First America Homes", "ok"], ["builder-deals-lane-Highland Homes", "ok"], ["builder-deals-lane-KB Home", "ok"], ["builder-deals-lane-M/I Homes", "ok"], ["builder-deals-lane-Pulte", "ok"]]);
    // Leases were released: another holder gets them right away.
    const lease = await leaseBuilder("Chesmar");
    expect(lease).not.toBeNull();
    await lease!.release();
  });

  it("skips a builder whose lease stays busy and reports it, without waiting on the rest", async () => {
    const held = await leaseBuilder("Chesmar");
    expect(held).not.toBeNull();
    // The lease was taken a moment ago, so the wait (twenty minutes, advanced by the fake sleep) ends well inside its two-hour life.
    let clock = Date.now();
    const run = await runCommunityDiscovery(fetcher, { now: () => clock, sleep: async (ms) => { clock += ms; } });
    expect(run).toMatchObject({ created: 10, builders: [{ builder: "Chesmar", ok: false, reason: "builder_busy", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }, { builder: "D.R. Horton", ok: true, created: 1 }, { builder: "First America Homes", ok: true, created: 1 }, { builder: "Coventry Homes", ok: true, created: 1 }, { builder: "Davidson Homes", ok: true, created: 1 }, { builder: "Highland Homes", ok: true, created: 1 }, { builder: "KB Home", ok: true, created: 1 }, { builder: "Century Communities", ok: true, created: 1 }, { builder: "Pulte", ok: true, created: 1 }, { builder: "Centex", ok: true, created: 1 }, { builder: "Del Webb", ok: true, created: 0 }] });
    expect(requested.some((url) => url.startsWith(CH))).toBe(false);
    await held!.release();
  });

  it("reports a builder whose onboarding throws and still finishes the others and the email", async () => {
    mocks.onboardFailure = "Chesmar";
    const run = await runCommunityDiscovery(fetcher);
    expect(run).toMatchObject({ created: 10, builders: [{ builder: "Chesmar", ok: false, reason: "onboarding_failed", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }, { builder: "D.R. Horton", ok: true, created: 1 }, { builder: "First America Homes", ok: true, created: 1 }, { builder: "Coventry Homes", ok: true, created: 1 }, { builder: "Davidson Homes", ok: true, created: 1 }, { builder: "Highland Homes", ok: true, created: 1 }, { builder: "KB Home", ok: true, created: 1 }, { builder: "Century Communities", ok: true, created: 1 }, { builder: "Pulte", ok: true, created: 1 }, { builder: "Centex", ok: true, created: 1 }, { builder: "Del Webb", ok: true, created: 0 }] });
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledTimes(1);
    // The failed builder's lease was released despite the error.
    const lease = await leaseBuilder("Chesmar");
    expect(lease).not.toBeNull();
    await lease!.release();
    // The run row records the failure for Admin to see.
    expect(db.rows(dealJobRuns).find((row) => row.jobName === "builder-deals-discovery-run")).toMatchObject({ status: "failed" });
  });

  it("runs once across servers: a second start while a run is in flight is refused, and a dead run is taken over after three hours", async () => {
    const started = new Date();
    db.seed(dealJobRuns, { jobName: "builder-deals-discovery-run", chicagoDay: "run", status: "running", startedAt: started, detail: null, completedAt: null });
    expect(await runCommunityDiscovery(fetcher, { now: () => started.getTime() + 60_000 })).toEqual({ skipped: "already_running" });
    expect(requested).toEqual([]);
    const later = await runCommunityDiscovery(fetcher, { now: () => started.getTime() + 4 * 60 * 60_000 });
    expect(later).toMatchObject({ created: 12 });
    expect(db.rows(dealJobRuns).filter((row) => row.jobName === "builder-deals-discovery-run")).toHaveLength(1);
    expect(db.rows(dealJobRuns).find((row) => row.jobName === "builder-deals-discovery-run")).toMatchObject({ status: "ok" });

    // A run taken over while still working cannot close the taker's row: the row carries the taker's token.
    const row = db.rows(dealJobRuns).find((entry) => entry.jobName === "builder-deals-discovery-run")!;
    row.status = "running"; row.startedAt = new Date(Date.now() - 4 * 60 * 60_000); row.detail = "run:stale-token"; row.completedAt = null;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = vi.fn(async (input: string) => { if (input.startsWith(CH)) await gate; return fetcher(input); });
    const stale = runCommunityDiscovery(slow, { now: () => Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The stale run is mid-read when a fresh start takes the row over...
    const taker = await runCommunityDiscovery(fetcher, { now: () => Date.now() + 4 * 60 * 60_000 });
    expect(taker).toMatchObject({ created: 0 });
    const takerToken = db.rows(dealJobRuns).find((entry) => entry.jobName === "builder-deals-discovery-run")!.detail;
    // ...and when the stale run finishes, the taker's row stands as the taker left it.
    release!();
    await stale;
    expect(db.rows(dealJobRuns).find((entry) => entry.jobName === "builder-deals-discovery-run")).toMatchObject({ status: "ok", detail: takerToken });
  });

  it("never follows a sitemap or page to another host", async () => {
    const offHost = vi.fn(async (input: string) => input === `${CH}/sitemap.xml`
      ? new Response(xml(`<sitemapindex><sitemap><loc>https://evil.example/sitemap.xml</loc></sitemap></sitemapindex>`), { status: 200, headers: { "content-type": "application/xml" } })
      : fetcher(input));
    const chesmar = await discoverBuilderCommunities(reader("Chesmar"), offHost);
    expect(chesmar).toMatchObject({ ok: false, reason: "sitemap_unreadable", communities: [] });
    expect(offHost.mock.calls.map(([url]) => url)).not.toContain("https://evil.example/sitemap.xml");
  });
});
