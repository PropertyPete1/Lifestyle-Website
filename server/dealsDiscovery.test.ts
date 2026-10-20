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
const SIT = "https://www.sitterlehomes.com";
const sitterleList = `<html><body><div class="single-result-container"><div class="result--info-container"><a class="result--title" href="${SIT}/communities/fixture-ranch/">Fixture Ranch</a><p class="result--city">San Antonio, TX 78254</p></div></div><div class="single-result-container"><div class="result--info-container"><a class="result--title" href="${SIT}/communities/far-fixture/">Far Fixture</a><p class="result--city">Magnolia, TX 77354</p></div></div></body></html>`;
const sitterlePage = (name: string, street: string, city: string, zip: string, geo: string) => `<html><body><div class="comm-page-address">${street}, ${city}, TX ${zip}, U.S.A.</div><a href="https://www.google.com/maps/dir//X/@${geo},18z/data=!4m8">Directions</a><div id="community-name"><div class="elementor-shortcode">${name}</div></div><div id="comm--filters-content"><div class="comm--listings-container"></div></div></body></html>`;
const SF = "https://www.scottfelderhomes.com";
const sfCommunity = (id: string, name: string, shared: string, area: string, city: string, street: string, zip: string, geo: [number, number]) => ({ _id: id, name, sharedName: shared, area, status: "Active", published: true, address: { streetAddress: street, addressLocality: city, addressRegion: "TX", postalCode: zip }, telephone: "(210) 555 - 0142", geoIndexed: [geo[1], geo[0]], priceLow: 404990, headline: "Rates as Low As 3.99%*" });
const sfState = JSON.stringify({ cloudData: { communities: { b1: { data: [sfCommunity("c1", "Fixture Vine", "fixture-vine", "Schertz/Cibolo", "Schertz", "12372 Fixture Petal", "78154", [29.5069, -98.2372]), sfCommunity("c2", "Far Fixture", "far-fixture", "Round Rock", "Round Rock", "100 Far Fixture Way", "78665", [30.5873, -97.6105])] } }, homes: { b1: { data: [] } }, plans: { b1: { data: [] } } } });
const sfMarket = `<html><body><h1>San Antonio AreaCommunities</h1><a href="/communities/san-antonio-area/schertzcibolo/fixture-vine">Fixture Vine</a><a href="/communities/san-antonio-area/schertzcibolo/fixture-vine#homes">Homes</a><a href="/communities/austin-area/round-rock/far-fixture">Far Fixture</a><a href="/communities/san-antonio-area/san-antonio/unknown-fixture">Unknown</a><script>window.__PRELOADED_STATE__ = ${sfState};</script></body></html>`;
const DRB = "https://www.drbhomes.com";
const drbRow = (id: number, name: string, city: string, street: string, zip: string, geo: [number, number], availability = "Active") => ({ id, brand: "drbhomes", name, salesOfficePhone: "2105550142", address: { address1: street, city, zip, latitude: geo[0], longitude: geo[1] }, communityAvailabilityRef: { id: 221, name: availability, label: "Current" }, priceFrom: 269990, moveInNowHomesCount: 1, plansCount: 2 });
const drbListing = JSON.stringify({ items: [drbRow(567, "Fixture Landmark", "San Antonio", "130 Fixture Grove", "78253", [29.4660313, -98.8158263]), drbRow(457, "Far Fixture Waters", "Seguin", "1 Far Rd", "78155", [29.56, -97.96]), drbRow(629, "Later Fixture", "Marion", "1 Later Rd", "78124", [29.57, -98.14], "ComingSoon")], meta: { totalItems: 3 } });
const STAR = "https://www.starlighthomes.com";
const starlightMarket = `<html><body><a href="/san-antonio/fixture-trails">Fixture Trails</a><a href="/san-antonio/fixture-trails/falcon">Falcon</a><a href="/san-antonio/areas/san-antonio">Area</a><a href="/san-antonio/far-fixture">Far Fixture</a></body></html>`;
const starlightPage = (name: string, street: string, city: string, zip: string, geo: [number, number]) => `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "http://schema.org", "@type": "HomeAndConstructionBusiness", url: `${STAR}/san-antonio/${name.toLowerCase().replace(/\s+/g, "-")}`, name: `${name} by Starlight Homes`, address: { "@type": "postalAddress", streetAddress: street, addressLocality: city, addressRegion: "TX", postalCode: zip }, telephone: "+1-830-555-0142", geo: { "@type": "GeoCoordinates", latitude: String(geo[0]), longitude: String(geo[1]) } })}</script></head><body><h1>${name}</h1></body></html>`;
const LEG = "https://www.livelegendhomes.com";
const legendRow = (id: number, name: string, region: string, county: string, city: string, street: string, zip: string, geo: [number, number], availability = "Active") => ({ id, brand: "legendhomes", name, salesOfficePhone: "2105550142", regions: [{ label: region, stateName: "TX" }], address: { address1: street, city, zip, latitude: geo[0], longitude: geo[1], countyName: county }, communityAvailabilityRef: { id: 1, name: availability, label: "Current" }, priceFrom: 252990, moveInNowHomesCount: 2, plansCount: 6 });
const legendListing = JSON.stringify({ items: [legendRow(104, "Fixture Ranch", "Schertz/Cibolo", "Bexar", "Converse", "9810 Fixture Way", "78109", [29.5205, -98.3012]), legendRow(500, "Far Fixture", "Houston", "Harris", "Katy", "1 Far Rd", "77449", [29.79, -95.82])], meta: { totalItems: 2 } });
const LGI = "https://www.lgihomes.com";
const lgiNext = (route: Record<string, unknown>, componentProps: Record<string, unknown>) => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page: { layout: { sitecore: { route } } }, dictionary: {}, componentProps } } })}</script></body></html>`;
const lgiMarket = lgiNext({ name: "san-antonio", fields: {}, placeholders: { "headless-main": [{ componentName: "LGIMarketLandingPage", uid: "m1", placeholders: { "community-search": [{ componentName: "CommunitySearch", uid: "cs1" }] } }] } }, { cs1: { communities: { results: [
  { url: { path: "/texas/san-antonio/fixture-wing" }, communityName: { value: "Fixture Wing" }, locationIdentifier: { value: "San Antonio" }, latitude: { jsonValue: { value: 29.3088 } }, longitude: { jsonValue: { value: -98.4046 } }, phone: { value: "(888) 384-5144" }, minListPrice: { jsonValue: { value: 222900 } } },
  { url: { path: "/texas/san-antonio/far-fixture" }, communityName: { value: "Far Fixture" }, locationIdentifier: { value: "Kyle" }, latitude: { jsonValue: { value: 29.918 } }, longitude: { jsonValue: { value: -97.85 } }, phone: { value: "(855) 806-2800" } },
] } } });
const lgiPage = (name: string, street: string, city: string, zip: string, geo: [number, number]) => lgiNext({ name: "x", fields: { CommunityName: { value: name }, Address1: { value: street }, City: { value: city }, ZipCode: { value: zip }, Phone: { value: "(888) 384-5144" }, Latitude: { value: geo[0] }, Longitude: { value: geo[1] }, MinListPrice: { value: 222900 }, SaleStatus: { fields: { Key: { value: "Active" } } }, PandIInfo: { value: "" } }, placeholders: { "headless-main": [{ componentName: "LGICommunityLandingPage", uid: "c1", placeholders: { "floorplan-search": [{ componentName: "FloorPlanSearch", uid: "fs1" }] } }] } }, { fs1: { community: { floorplans: { results: [] } } } });
const AW = "https://www.ashtonwoods.com";
const ashtonPage = (name: string, street: string, city: string, zip: string) => `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", name: `${name} By Ashton Woods`, address: { "@type": "PostalAddress", streetAddress: street, addressLocality: city, addressRegion: "TX", postalCode: zip } })}</script></head><body><div class="property-card js-property-card" data-property-id="1"><h4 class="property-card__title"><a href="/san-antonio/x/x-plan/1-street">1 Street <br> ${city}, TX ${zip}</a></h4><div class="property-card__body-title">Available Now</div><div class="property-card__price">$300,000</div></div></body></html>`;
const ashtonListing = JSON.stringify({ division: "San Antonio", communities: [
  { items: [{ cid: 713, url: `${AW}/san-antonio/fixture-hollow`, community_title: "Fixture Hollow", community_phone: "210-361-0710", area: "San Antonio", child_communities: [{ cid: 714 }] }], coordinates: { lat: "29.3603446", lon: "-98.7874964" } },
  { items: [{ cid: 258, url: `${AW}/san-antonio/far-fixture`, community_title: "Far Fixture", community_phone: "210-899-7711", area: "Kyle", child_communities: [] }], coordinates: { lat: "29.99", lon: "-97.87" } },
  { items: [{ cid: 259, url: `${AW}/san-antonio/appointment-fixture`, community_title: "Appointment Fixture", community_phone: "210-899-7712", area: "Live Oak", child_communities: [] }], coordinates: { lat: "29.56", lon: "-98.33" } },
] });
const DWH = "https://www.davidweekleyhomes.com";
const weekleyPage = (name: string, street: string, city: string, zip: string, geo: string) => `<html><body><script>window.pageData= ${JSON.stringify({ communityName: name, communityId: "communities/1", communityAvailability: "Active", basePrice: 365480, salesOffices: [{ Address: `${street}<br />${city}, TX ${zip}`, SearchableAddress: geo }], floorplans: [{ Name: "Cassia", Token: "/x/cassia", Community: { PhoneNumber: "210-399-2074" }, BasePrice: 1, Bedrooms: {}, FullBaths: {}, HalfBaths: {}, Garages: {}, SquareFootage: {} }], quickMoveIns: [] })};</script></body></html>`;
const weekleyListing = JSON.stringify({ Communities: [
  { Id: "communities/13442", Token: "/new-homes/tx/san-antonio/san-antonio/build-on-your-lot-san-antonio", Name: "Build on Your Lot", CommunityType: 2 },
  { Id: "communities/1", Token: "/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45", Name: "Fixture Ranch – Select Classic Series", CommunityType: 1 },
  { Id: "communities/2", Token: "/new-homes/tx/san-antonio/kyle/far-fixture", Name: "Far Fixture", CommunityType: 1 },
], NeighborhoodGroups: [{ NeighborhoodName: "Fixture Ranch", Communities: [{ Id: "communities/1", Token: "/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45", Name: "Fixture Ranch – Select Classic Series", CommunityType: 1 }] }] });
const TOLL = "https://www.tollbrothers.com";
const tollListing = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { componentType: "SearchComponent", searchResults: { perfect: [
  { "@type": "CommunitySearchItem", isMaster: false, url: `${TOLL}/luxury-homes-for-sale/Texas/Toll-Brothers-at-Fixture-Ranch`, name: "Toll Brothers at Fixture Ranch", lat: "29.3929", lon: "-98.7582", city: "San Antonio", zipCode: "78245", streetAddress: "13312 Fixture Acacia", phone: "210-756-0955", pMin: 414995 },
  { "@type": "MasterCommunitySearchItem", isMaster: true, url: `${TOLL}/luxury-homes-for-sale/Texas/Regency-at-Fixture`, name: "Regency at Fixture", city: "Boerne", communities: [{ "@type": "CommunitySearchItem", isMaster: false, url: `${TOLL}/luxury-homes-for-sale/Texas/Regency-at-Fixture/Flamenco-Collection`, name: "Regency at Fixture - Flamenco Collection", lat: "29.806", lon: "-98.689", city: "Boerne", zipCode: "78006", streetAddress: "103 Fixture Way", phone: "830-555-0100", pMin: 409995 }] },
  { "@type": "CommunitySearchItem", isMaster: false, url: `${TOLL}/luxury-homes-for-sale/Texas/Toll-Brothers-at-Far-Fixture`, name: "Toll Brothers at Far Fixture", lat: "29.99", lon: "-97.87", city: "Kyle", zipCode: "78640", streetAddress: "1 Far Rd", phone: "830-360-8715", pMin: 315995 },
  { "@type": "CommunitySearchItem", isMaster: false, url: `${TOLL}/luxury-homes-for-sale/Texas/Toll-Brothers-at-Unplaced`, name: "Unplaced", city: "San Antonio", streetAddress: "2 Nowhere Rd" },
] } } } })}</script></body></html>`;
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
  [`${TOLL}/luxury-homes/San-Antonio-TX`]: { body: tollListing },
  [`${DWH}/search/CommunityData?marketId=markets/3`]: { body: weekleyListing, type: "application/json" },
  [`${LGI}/texas/san-antonio`]: { body: lgiMarket },
  [`${SF}/communities/san-antonio-area`]: { body: sfMarket },
  [`${STAR}/san-antonio`]: { body: starlightMarket },
  [`${STAR}/san-antonio/fixture-trails`]: { body: starlightPage("Fixture Trails", "101 Fixture Street", "Seguin", "78155", [29.6285, -97.9854]) },
  [`${STAR}/san-antonio/far-fixture`]: { body: starlightPage("Far Fixture", "1 Far Rd", "Kyle", "78640", [29.918, -97.85]) },
  ["https://api.drbhomes.com/api/v1/public-drb/community?searchField=communityRegion&searchValue=San%20Antonio&state=texas&region=san-antonio&page=1&limit=1000"]: { body: drbListing, type: "application/json" },
  ["https://api.livelegendhomes.com/api/v1/public-epcon/community/for-legend?limit=1000&division=san-antonio&barebones=false"]: { body: legendListing, type: "application/json" },
  [`${SIT}/communities/`]: { body: sitterleList },
  [`${SIT}/communities/fixture-ranch/`]: { body: sitterlePage("Fixture Ranch", "10103 Fixture Zimmer", "San Antonio", "78254", "29.5371268,-98.7423396") },
  [`${SIT}/communities/far-fixture/`]: { body: sitterlePage("Far Fixture", "1 Far Rd", "Magnolia", "77354", "30.21,-95.75") },
  [`${LGI}/texas/san-antonio/fixture-wing`]: { body: lgiPage("Fixture Wing", "11523 Fixture Eagles", "San Antonio", "78223", [29.3088, -98.4046]) },
  [`${LGI}/texas/san-antonio/far-fixture`]: { body: lgiPage("Far Fixture", "1 Far Rd", "Kyle", "78640", [29.918, -97.85]) },
  [`${AW}/ashton-woods/get-division-community-map/13`]: { body: ashtonListing, type: "application/json" },
  [`${AW}/san-antonio/fixture-hollow`]: { body: ashtonPage("Fixture Hollow", "14738 Fixture Pass", "San Antonio", "78252") },
  [`${AW}/san-antonio/far-fixture`]: { body: ashtonPage("Far Fixture", "1 Far Rd", "Kyle", "78640") },
  [`${AW}/san-antonio/appointment-fixture`]: { body: ashtonPage("Appointment Fixture", "By Appointment Only", "Live Oak", "78233") },
  [`${DWH}/new-homes/tx/san-antonio/san-antonio/fixture-ranch-45`]: { body: weekleyPage("Fixture Ranch – Select Classic Series", "13222 Fixture Acacia", "San Antonio", "78245", "29.3929823888344,-98.7576751930276") },
  [`${DWH}/new-homes/tx/san-antonio/kyle/far-fixture`]: { body: weekleyPage("Far Fixture", "1 Far Rd", "Kyle", "78640", "29.99,-97.87") },
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

    // Sitterle: the communities page names every Texas community; each page gives the address and pin, and the 45-mile rule drops Houston's.
    requested.length = 0;
    const sitterle = await discoverBuilderCommunities(reader("Sitterle Homes"), fetcher);
    expect(sitterle.communities.map((community) => [community.name, community.address])).toEqual([["Fixture Ranch", "10103 Fixture Zimmer, San Antonio, TX 78254"]]);
    expect(sitterle.skipped).toEqual([{ url: `${SIT}/communities/far-fixture/`, reason: "outside_area" }]);

    // Scott Felder: the market page's inline state carries every record, so no community page is read; a link outside the San Antonio market folder is not a candidate.
    requested.length = 0;
    const scottFelder = await discoverBuilderCommunities(reader("Scott Felder Homes"), fetcher);
    expect(scottFelder.communities.map((community) => [community.name, community.address, community.salesPhone, community.priceFrom])).toEqual([["Fixture Vine", "12372 Fixture Petal, Schertz, TX 78154", "2105550142", 404_990]]);
    expect(scottFelder.skipped).toEqual([]);
    expect(requested).toEqual([`${SF}/communities/san-antonio-area`]);

    // DRB: the public API's region list carries every record, read on the API host; a coming-soon community is left out; Seguin is within the area.
    requested.length = 0;
    const drb = await discoverBuilderCommunities(reader("DRB Homes"), fetcher);
    expect(drb.communities.map((community) => [community.name, community.sourceUrl, community.address, community.salesPhone, community.priceFrom])).toEqual([
      ["Fixture Landmark", `${DRB}/drbhomes/find-your-home/communities/texas/san-antonio/fixture-landmark`, "130 Fixture Grove, San Antonio, TX 78253", "2105550142", 269_990],
      ["Far Fixture Waters", `${DRB}/drbhomes/find-your-home/communities/texas/san-antonio/far-fixture-waters`, "1 Far Rd, Seguin, TX 78155", "2105550142", 269_990],
    ]);
    expect(drb.skipped).toEqual([]);
    expect(requested).toEqual(["https://api.drbhomes.com/api/v1/public-drb/community?searchField=communityRegion&searchValue=San%20Antonio&state=texas&region=san-antonio&page=1&limit=1000"]);

    // Starlight: the market page links every community; each page's business record places it, and the 45-mile rule drops Kyle.
    requested.length = 0;
    const starlight = await discoverBuilderCommunities(reader("Starlight Homes"), fetcher);
    expect(starlight.communities.map((community) => [community.name, community.address, community.salesPhone])).toEqual([["Fixture Trails", "101 Fixture Street, Seguin, TX 78155", "8305550142"]]);
    expect(starlight.skipped).toEqual([{ url: `${STAR}/san-antonio/far-fixture`, reason: "outside_area" }]);
    expect(requested.filter((url) => /falcon|areas/.test(url))).toEqual([]);

    // Legend: the division list on the API carries every record; the page is the row's region, county, city and name as slugs; Katy is outside the area.
    requested.length = 0;
    const legend = await discoverBuilderCommunities(reader("Legend Homes"), fetcher);
    expect(legend.communities.map((community) => [community.name, community.sourceUrl, community.address])).toEqual([["Fixture Ranch", `${LEG}/communities/san-antonio/schertz-cibolo/bexar/converse/fixture-ranch`, "9810 Fixture Way, Converse, TX 78109"]]);
    expect(legend.skipped).toEqual([{ url: `${LEG}/communities/san-antonio/houston/harris/katy/far-fixture`, reason: "outside_area" }]);

    // LGI: the market page's Next.js data lists the communities with pins; each page gives the sales address.
    requested.length = 0;
    const lgi = await discoverBuilderCommunities(reader("LGI Homes"), fetcher);
    expect(lgi.communities.map((community) => [community.name, community.address, community.salesPhone, community.priceFrom])).toEqual([["Fixture Wing", "11523 Fixture Eagles, San Antonio, TX 78223", "8883845144", 222_900]]);
    expect(lgi.skipped).toEqual([{ url: `${LGI}/texas/san-antonio/far-fixture`, reason: "outside_area" }]);

    // Ashton Woods: the division map's pins (coordinates, phone) plus each page's business record (address); a by-appointment community keeps its city line.
    requested.length = 0;
    const ashton = await discoverBuilderCommunities(reader("Ashton Woods"), fetcher);
    expect(ashton.communities.map((community) => [community.name, community.address, community.salesPhone])).toEqual([["Fixture Hollow", "14738 Fixture Pass, San Antonio, TX 78252", "2103610710"], ["Appointment Fixture", "Live Oak, TX 78233", "2108997712"]]);
    expect(ashton.skipped).toEqual([{ url: `${AW}/san-antonio/far-fixture`, reason: "outside_area" }]);
    expect(requested[0]).toBe(`${AW}/ashton-woods/get-division-community-map/13`);

    // David Weekley: the market's JSON list names the community pages (build-on-your-lot left out, each once); each page gives the office and coordinates.
    requested.length = 0;
    const weekley = await discoverBuilderCommunities(reader("David Weekley Homes"), fetcher);
    expect(weekley.communities.map((community) => [community.name, community.address, community.salesPhone, community.priceFrom])).toEqual([["Fixture Ranch – Select Classic Series", "13222 Fixture Acacia, San Antonio, TX 78245", "2103992074", 365_480]]);
    expect(weekley.skipped).toEqual([{ url: `${DWH}/new-homes/tx/san-antonio/kyle/far-fixture`, reason: "outside_area" }]);
    expect(requested.filter((url) => /build-on-your-lot/.test(url))).toEqual([]);
    expect(requested.filter((url) => url.endsWith("fixture-ranch-45"))).toHaveLength(1);

    // Toll Brothers: the metro search page lists every community with its record (collections of a master included); no page is read; the unplaced one and the far one are skipped.
    requested.length = 0;
    const toll = await discoverBuilderCommunities(reader("Toll Brothers"), fetcher);
    expect(toll.communities.map((community) => [community.name, community.address, community.salesPhone, community.priceFrom])).toEqual([["Toll Brothers at Fixture Ranch", "13312 Fixture Acacia, San Antonio, TX 78245", "2107560955", 414_995], ["Regency at Fixture - Flamenco Collection", "103 Fixture Way, Boerne, TX 78006", "8305550100", 409_995]]);
    expect(toll.skipped).toEqual([{ url: `${TOLL}/luxury-homes-for-sale/Texas/Toll-Brothers-at-Far-Fixture`, reason: "outside_area" }, { url: `${TOLL}/luxury-homes-for-sale/Texas/Toll-Brothers-at-Unplaced`, reason: "no_community_record" }]);
    expect(requested).toEqual([`${TOLL}/luxury-homes/San-Antonio-TX`]);

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
    expect(run).toMatchObject({ created: 23, builders: [{ builder: "Chesmar", ok: true, found: 2, created: 1, existing: 1 }, { builder: "M/I Homes", ok: true, found: 1, created: 1 }, { builder: "D.R. Horton", ok: true, found: 1, created: 1 }, { builder: "First America Homes", ok: true, found: 1, created: 1 }, { builder: "Coventry Homes", ok: true, found: 1, created: 1 }, { builder: "Davidson Homes", ok: true, found: 1, created: 1 }, { builder: "Highland Homes", ok: true, found: 1, created: 1 }, { builder: "KB Home", ok: true, found: 1, created: 1 }, { builder: "Toll Brothers", ok: true, found: 2, created: 2 }, { builder: "David Weekley Homes", ok: true, found: 1, created: 1 }, { builder: "Ashton Woods", ok: true, found: 2, created: 2 }, { builder: "LGI Homes", ok: true, found: 1, created: 1 }, { builder: "Sitterle Homes", ok: true, found: 1, created: 1 }, { builder: "Scott Felder Homes", ok: true, found: 1, created: 1 }, { builder: "DRB Homes", ok: true, found: 2, created: 2 }, { builder: "Starlight Homes", ok: true, found: 1, created: 1 }, { builder: "Legend Homes", ok: true, found: 1, created: 1 }, { builder: "Century Communities", ok: true, found: 1, created: 1 }, { builder: "Pulte", ok: true, found: 1, created: 1 }, { builder: "Centex", ok: true, found: 1, created: 1 }, { builder: "Del Webb", ok: true, found: 0, created: 0 }] });
    const added = db.rows(dealCommunities).filter((row) => row.awaitingFirstSync);
    expect(added.map((row) => [row.privateName, row.active, row.areaLabel])).toEqual([["Esperanza 60's", false, "Boerne"], ["Paloma Park", false, "Greater San Antonio"], ["Fixture Ranch", false, "Greater San Antonio"], ["Fixture Meadows", false, "Greater San Antonio"], ["Buffalo Fixture", false, "Greater San Antonio"], ["Fixture Meadows", false, "Greater San Antonio"], ["Fixture Ranch", false, "Greater San Antonio"], ["Fixture Heights - Heritage Collection", false, "New Braunfels"], ["Toll Brothers at Fixture Ranch", false, "Greater San Antonio"], ["Regency at Fixture - Flamenco Collection", false, "Boerne"], ["Fixture Ranch – Select Classic Series", false, "Greater San Antonio"], ["Fixture Hollow", false, "Greater San Antonio"], ["Appointment Fixture", false, "Greater San Antonio"], ["Fixture Wing", false, "Greater San Antonio"], ["Fixture Ranch", false, "Greater San Antonio"], ["Fixture Vine", false, "Greater San Antonio"], ["Fixture Landmark", false, "Greater San Antonio"], ["Far Fixture Waters", false, "Seguin"], ["Fixture Trails", false, "Seguin"], ["Fixture Ranch", false, "Greater San Antonio"], ["Fixture Grove", false, "Greater San Antonio"], ["Fixture Ridge", false, "Greater San Antonio"], ["Fixture Ridge", false, "Greater San Antonio"]]);
    // The exact coordinates on the builder's page are never stored.
    expect(JSON.stringify(db.rows(dealCommunities))).not.toMatch(/29\.79|98\.73|29\.52/);
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledTimes(1);
    const email = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { subject: string; content: string };
    expect(email.subject).toBe("Builder Deals: 23 new communities found");
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
    expect(run).toMatchObject({ created: 22, builders: [{ builder: "Chesmar", ok: false, reason: "sitemap_unreadable", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }, { builder: "D.R. Horton", ok: true, created: 1 }, { builder: "First America Homes", ok: true, created: 1 }, { builder: "Coventry Homes", ok: true, created: 1 }, { builder: "Davidson Homes", ok: true, created: 1 }, { builder: "Highland Homes", ok: true, created: 1 }, { builder: "KB Home", ok: true, created: 1 }, { builder: "Toll Brothers", ok: true, created: 2 }, { builder: "David Weekley Homes", ok: true, created: 1 }, { builder: "Ashton Woods", ok: true, created: 2 }, { builder: "LGI Homes", ok: true, created: 1 }, { builder: "Sitterle Homes", ok: true, created: 1 }, { builder: "Scott Felder Homes", ok: true, created: 1 }, { builder: "DRB Homes", ok: true, created: 2 }, { builder: "Starlight Homes", ok: true, created: 1 }, { builder: "Legend Homes", ok: true, created: 1 }, { builder: "Century Communities", ok: true, created: 1 }, { builder: "Pulte", ok: true, created: 1 }, { builder: "Centex", ok: true, created: 1 }, { builder: "Del Webb", ok: true, created: 0 }] });
    const email = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { content: string };
    expect(email.content).toContain("Could not read Chesmar's site list this time");
  });

  it("reads each builder under its lease, so a lane or Refresh now never reads the same site at the same time, and releases it after", async () => {
    const run = await runCommunityDiscovery(fetcher);
    expect(run).toMatchObject({ created: 24 });
    const leases = db.rows(dealJobRuns).filter((row) => row.jobName.startsWith("builder-deals-lane-"));
    expect(leases.map((row) => [row.jobName, row.status]).sort()).toEqual([["builder-deals-lane-Ashton Woods", "ok"], ["builder-deals-lane-Centex", "ok"], ["builder-deals-lane-Century Communities", "ok"], ["builder-deals-lane-Chesmar", "ok"], ["builder-deals-lane-Coventry Homes", "ok"], ["builder-deals-lane-D.R. Horton", "ok"], ["builder-deals-lane-DRB Homes", "ok"], ["builder-deals-lane-David Weekley Homes", "ok"], ["builder-deals-lane-Davidson Homes", "ok"], ["builder-deals-lane-Del Webb", "ok"], ["builder-deals-lane-First America Homes", "ok"], ["builder-deals-lane-Highland Homes", "ok"], ["builder-deals-lane-KB Home", "ok"], ["builder-deals-lane-LGI Homes", "ok"], ["builder-deals-lane-Legend Homes", "ok"], ["builder-deals-lane-M/I Homes", "ok"], ["builder-deals-lane-Pulte", "ok"], ["builder-deals-lane-Scott Felder Homes", "ok"], ["builder-deals-lane-Sitterle Homes", "ok"], ["builder-deals-lane-Starlight Homes", "ok"], ["builder-deals-lane-Toll Brothers", "ok"]]);
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
    expect(run).toMatchObject({ created: 22, builders: [{ builder: "Chesmar", ok: false, reason: "builder_busy", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }, { builder: "D.R. Horton", ok: true, created: 1 }, { builder: "First America Homes", ok: true, created: 1 }, { builder: "Coventry Homes", ok: true, created: 1 }, { builder: "Davidson Homes", ok: true, created: 1 }, { builder: "Highland Homes", ok: true, created: 1 }, { builder: "KB Home", ok: true, created: 1 }, { builder: "Toll Brothers", ok: true, created: 2 }, { builder: "David Weekley Homes", ok: true, created: 1 }, { builder: "Ashton Woods", ok: true, created: 2 }, { builder: "LGI Homes", ok: true, created: 1 }, { builder: "Sitterle Homes", ok: true, created: 1 }, { builder: "Scott Felder Homes", ok: true, created: 1 }, { builder: "DRB Homes", ok: true, created: 2 }, { builder: "Starlight Homes", ok: true, created: 1 }, { builder: "Legend Homes", ok: true, created: 1 }, { builder: "Century Communities", ok: true, created: 1 }, { builder: "Pulte", ok: true, created: 1 }, { builder: "Centex", ok: true, created: 1 }, { builder: "Del Webb", ok: true, created: 0 }] });
    expect(requested.some((url) => url.startsWith(CH))).toBe(false);
    await held!.release();
  });

  it("reports a builder whose onboarding throws and still finishes the others and the email", async () => {
    mocks.onboardFailure = "Chesmar";
    const run = await runCommunityDiscovery(fetcher);
    expect(run).toMatchObject({ created: 22, builders: [{ builder: "Chesmar", ok: false, reason: "onboarding_failed", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }, { builder: "D.R. Horton", ok: true, created: 1 }, { builder: "First America Homes", ok: true, created: 1 }, { builder: "Coventry Homes", ok: true, created: 1 }, { builder: "Davidson Homes", ok: true, created: 1 }, { builder: "Highland Homes", ok: true, created: 1 }, { builder: "KB Home", ok: true, created: 1 }, { builder: "Toll Brothers", ok: true, created: 2 }, { builder: "David Weekley Homes", ok: true, created: 1 }, { builder: "Ashton Woods", ok: true, created: 2 }, { builder: "LGI Homes", ok: true, created: 1 }, { builder: "Sitterle Homes", ok: true, created: 1 }, { builder: "Scott Felder Homes", ok: true, created: 1 }, { builder: "DRB Homes", ok: true, created: 2 }, { builder: "Starlight Homes", ok: true, created: 1 }, { builder: "Legend Homes", ok: true, created: 1 }, { builder: "Century Communities", ok: true, created: 1 }, { builder: "Pulte", ok: true, created: 1 }, { builder: "Centex", ok: true, created: 1 }, { builder: "Del Webb", ok: true, created: 0 }] });
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
    expect(later).toMatchObject({ created: 24 });
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
