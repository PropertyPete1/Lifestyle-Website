import { describe, expect, it } from "vitest";
import { areaLabelFor, isGeneratedArea, marketOf, nearestTown, refreshedAreaLabel } from "../shared/dealsArea";
import { DISCOVERY_READERS, discoverBuilderCommunities, drhListingEntries, inDiscoveryArea, type DiscoveryReader } from "./dealsDiscovery";
import { normalizedDealSourceKey } from "../shared/deals";
import { weekleyListingUrl, weekleyMarketFor, weekleyPromotionsUrl } from "./dealsAdapters.weekley";
import { pulteListingUrl, pulteRegionFor } from "./dealsAdapters.pultegroup";
import { dreesAreaFor, parseDreesAreaId } from "./dealsAdapters.drees";
import { empireRecord, empireRegionLinks } from "./dealsAdapters.empire";
import { starlightListingEntries } from "./dealsAdapters.starlight";
import { hakesListingEntries } from "./dealsAdapters.hakes";

/**
 * AUSTIN (October 25, 2026, Peter: "add all the communities in the other cities I mentioned", asked more than once):
 * Austin, Kyle, San Marcos, Georgetown and their towns are a second market beside San Antonio, and San Antonio's reach
 * goes out to its far outskirts. Labels stay coarse: a side of Austin inside its metro, else a listed town.
 */
const point = (lat: number, lng: number) => ({ lat, lng });

describe("the Austin market", () => {
  it("counts Austin's towns and San Antonio's far outskirts, and leaves Waco, Killeen and Houston out", () => {
    for (const [name, at] of [["Georgetown", point(30.6333, -97.6772)], ["Jarrell", point(30.8249, -97.6045)], ["Lockhart", point(29.8849, -97.67)], ["San Marcos", point(29.8833, -97.9414)], ["Bastrop", point(30.1105, -97.3153)], ["Dripping Springs", point(30.1902, -98.0867)], ["Liberty Hill", point(30.6649, -97.9225)], ["Fredericksburg", point(30.2752, -98.872)], ["Kerrville", point(30.0474, -99.1403)], ["Hondo", point(29.3475, -99.1417)], ["Gonzales", point(29.5016, -97.4525)], ["Pleasanton", point(28.9672, -98.4786)]] as const) {
      expect([name, inDiscoveryArea(at)]).toEqual([name, true]);
    }
    for (const [name, at] of [["Waco", point(31.5493, -97.1467)], ["Killeen", point(31.1171, -97.7278)], ["Houston", point(29.7604, -95.3698)], ["Uvalde", point(29.2097, -99.7862)]] as const) {
      expect([name, inDiscoveryArea(at)]).toEqual([name, false]);
    }
  });

  it("labels a community by the nearer market: a side of Austin inside its metro, a town beyond, San Antonio's labels unchanged", () => {
    // About 8 miles north of downtown Austin.
    expect(areaLabelFor({ centroid: point(30.383, -97.743) })).toBe("North Austin");
    expect(areaLabelFor({ centroid: point(30.27, -97.745) })).toBe("Central Austin");
    expect(areaLabelFor({ centroid: point(30.146, -97.711), city: "Austin" })).toBe("South Austin");
    expect(areaLabelFor({ centroid: point(30.5788, -97.8531), city: "Leander" })).toBe("Leander");
    // A builder that lists "Austin" for a Leander-area community still reads as the town near its ZIP centre.
    expect(areaLabelFor({ centroid: point(30.57, -97.84), city: "Austin" })).toBe("Leander");
    expect(areaLabelFor({ centroid: point(29.99, -97.88), city: "Kyle" })).toBe("Kyle");
    expect(areaLabelFor({ centroid: point(30.374, -97.533), city: "Manor" })).toBe("Manor");
    // Open country past the metro with no listed town near: the side of Austin.
    expect(areaLabelFor({ centroid: point(30.0, -97.45) })).toBe("Southeast of Austin");
    expect(areaLabelFor({ city: "Austin" })).toBe("Greater Austin");
    expect(areaLabelFor({ city: "Round Rock" })).toBe("Round Rock");
    // San Antonio's own labels do not move.
    expect(areaLabelFor({ centroid: point(29.60, -98.70) })).toBe("Northwest San Antonio");
    expect(areaLabelFor({ centroid: point(29.82, -98.67), city: "San Antonio" })).toBe("Boerne");
    expect(areaLabelFor({ centroid: point(30.27, -98.87) })).toBe("Fredericksburg");
    expect(marketOf(point(29.70, -98.12)).name).toBe("San Antonio");
    expect(marketOf(point(29.88, -97.94)).name).toBe("Austin");
    expect(nearestTown(point(30.51, -97.68))).toBe("Round Rock");
    for (const label of ["North Austin", "Central Austin", "Greater Austin", "Southeast of Austin", "Georgetown", "Southeast San Antonio"]) expect(isGeneratedArea(label)).toBe(true);
    expect(refreshedAreaLabel({ areaLabel: "Greater Austin", publicLabel: "Greater Austin | From the $300s", centroid: point(30.383, -97.743), city: "Austin", fromPrice: 349_990 })).toEqual({ areaLabel: "North Austin", publicLabel: "North Austin | From the $300s" });
  });
});

describe("each builder's Austin listing", () => {
  const reader = (builder: string) => DISCOVERY_READERS.find((item) => item.builder === builder)!;
  const paths = (builder: string) => [reader(builder).communityPath, ...(reader(builder).more ?? []).map((market) => market.communityPath)];
  const accepts = (builder: string, path: string) => paths(builder).some((pattern) => pattern.test(path));

  it("reads every builder's Austin market beside San Antonio's, on the builder's own site", () => {
    const urls = (builder: string) => (reader(builder).more ?? []).map((market) => "url" in market.index ? market.index.url : "reader");
    expect(urls("D.R. Horton")).toEqual(["austin", "san-marcos", "new-braunfels", "killeen-temple-waco"].map((division) => `https://www.drhorton.com/api/comms/direct/texas/${division}`));
    expect(urls("Pulte")).toEqual([pulteListingUrl("www.pulte.com", "Pulte", "Austin")]);
    expect(urls("David Weekley Homes")).toEqual([weekleyListingUrl("markets/4")]);
    expect(urls("Toll Brothers")).toEqual(["https://www.tollbrothers.com/luxury-homes/Austin-TX"]);
    expect(urls("Lennar")).toEqual(["https://www.lennar.com/new-homes/texas/austin"]);
    expect(urls("Coventry Homes")).toEqual(["https://www.coventryhomes.com/new-homes/tx/austin/"]);
    expect(urls("Ashton Woods")).toEqual(["https://www.ashtonwoods.com/ashton-woods/get-division-community-map/3"]);
    expect(urls("Drees Custom Homes")).toEqual(["reader"]);
    for (const builder of ["LGI Homes", "Starlight Homes", "Hakes Brothers", "Empire Homes", "DRB Homes"]) expect(urls(builder)).toHaveLength(1);
  });

  it("accepts the Austin community pages each builder publishes, and not their plan, home or market pages", () => {
    expect(accepts("D.R. Horton", "/texas/austin/manor/monarch-ranch")).toBe(true);
    expect(accepts("D.R. Horton", "/texas/san-marcos/lockhart/lantana")).toBe(true);
    expect(accepts("D.R. Horton", "/texas/new-braunfels/new-braunfels/mayfair")).toBe(true);
    expect(accepts("D.R. Horton", "/texas/killeen-temple-waco/jarrell/cool-water")).toBe(true);
    // The division's far towns are never read.
    expect(accepts("D.R. Horton", "/texas/killeen-temple-waco/killeen/far-fixture")).toBe(false);
    expect(accepts("KB Home", "/new-homes-austin/adelton")).toBe(true);
    expect(accepts("KB Home", "/new-homes-austin/adelton/plan-1547")).toBe(false);
    expect(accepts("Highland Homes", "/austin/austin/easton-park")).toBe(true);
    expect(accepts("Highland Homes", "/austin/austin/easton-park/7011-068")).toBe(false);
    expect(accepts("Century Communities", "/find-your-new-home/texas/austin-metro/austin/evelyn/")).toBe(true);
    expect(accepts("M/I Homes", "/new-homes/texas/greater-austin/austin/cascades-at-onion-creek")).toBe(true);
    expect(accepts("First America Homes", "/new-homes/tx/austin-metro/kyle/ridge-west/")).toBe(true);
    expect(accepts("Pulte", "/homes/texas/austin/pflugerville/kuempel-estates-211449")).toBe(true);
    expect(accepts("David Weekley Homes", "/new-homes/tx/austin/buda/sunfield")).toBe(true);
    expect(accepts("David Weekley Homes", "/new-homes/tx/austin/austin/suburban-build-on-your-lot-executive-collection")).toBe(true);
    expect(accepts("Lennar", "/new-homes/texas/austin-central-texas/hutto/cotton-brook")).toBe(true);
    expect(accepts("Ashton Woods", "/austin/lagos-reserve")).toBe(true);
    expect(accepts("LGI Homes", "/texas/austin/whisper-valley")).toBe(true);
    expect(accepts("Starlight Homes", "/austin/sonterra")).toBe(true);
    expect(accepts("Hakes Brothers", "/austin/la-cima")).toBe(true);
    expect(accepts("Empire Homes", "/us/texas/austin/bastrop/adelton/")).toBe(true);
    expect(accepts("Drees Custom Homes", "/new-homes-austin/leander/fixture/fixture-50s/")).toBe(true);
    expect(accepts("DRB Homes", "/drbhomes/find-your-home/communities/texas/austin/hawkes-landing")).toBe(true);
  });

  it("parses each Austin listing's links (the same parsers, the Austin market's own paths)", () => {
    const drh = drhListingEntries(JSON.stringify({ CommunityData: [{ commPageLink: "/texas/austin/manor/monarch-ranch" }, { commPageLink: "/texas/san-marcos/maxwell/hymeadow" }] }), "www.drhorton.com");
    expect(drh?.map((entry) => entry.url)).toEqual(["https://www.drhorton.com/texas/austin/manor/monarch-ranch", "https://www.drhorton.com/texas/san-marcos/maxwell/hymeadow"]);
    const star = `<a href="/austin/sonterra">Sonterra</a><a href="/austin/areas/jarrell">Jarrell</a><a href="/san-antonio/cordova-trails">x</a>`;
    expect(starlightListingEntries(star, "www.starlighthomes.com", "austin")?.map((entry) => entry.url)).toEqual(["https://www.starlighthomes.com/austin/sonterra"]);
    expect(starlightListingEntries(star, "www.starlighthomes.com")?.map((entry) => entry.url)).toEqual(["https://www.starlighthomes.com/san-antonio/cordova-trails"]);
    const hakes = `<a href="https://www.hakesbrothers.com/austin/la-cima">La Cima</a><a href="https://www.hakesbrothers.com/austin/la-cima/home/119-horseherb-way">home</a>`;
    expect(hakesListingEntries(hakes, "www.hakesbrothers.com", "austin")?.map((entry) => entry.url)).toEqual(["https://www.hakesbrothers.com/austin/la-cima"]);
    const empire = `<html><body><a href="https://empirehomes.com/us/texas/austin/bastrop/adelton/">Adelton</a><a href="https://empirehomes.com/us/texas/austin/bastrop/adelton/home-plans/burnet-36980/">plan</a><a href="https://empirehomes.com/us/texas/san-antonio/x/y/">SA</a></body></html>`;
    expect(empireRegionLinks(empire, "empirehomes.com", "austin")).toEqual(["https://empirehomes.com/us/texas/austin/bastrop/adelton/"]);
  });

  it("reads an Austin Empire page's address, which ends in \", USA\"", () => {
    const html = `<html><body><img src="https://maps.googleapis.com/maps/api/staticmap?center=30.1026026,-97.382397&amp;zoom=14" alt="Map of 122 Vogel Ln, Bastrop, TX 78602, USA"><div class="map-agent-static-label">Adelton</div></body></html>`;
    expect(empireRecord(html, "https://empirehomes.com/us/texas/austin/bastrop/adelton/")).toMatchObject({ name: "Adelton", street: "122 Vogel Ln", city: "Bastrop", zip: "78602" });
  });

  it("reads an Austin community's homes and offers from its own market's lists, never San Antonio's", () => {
    expect(weekleyMarketFor("https://www.davidweekleyhomes.com/new-homes/tx/austin/buda/sunfield")).toBe("markets/4");
    expect(weekleyMarketFor("https://www.davidweekleyhomes.com/new-homes/tx/san-antonio/boerne/fixture")).toBe("markets/3");
    expect(weekleyPromotionsUrl("markets/4")).toBe("https://www.davidweekleyhomes.com/promotion/marketpromotionslist?marketId=markets/4");
    expect(pulteRegionFor("/homes/texas/austin/buda/sunfield-210070")).toBe("Austin");
    expect(pulteRegionFor("/homes/texas/san-antonio/san-antonio/bison-ridge-210867")).toBe("San Antonio");
    expect(pulteListingUrl("www.pulte.com", "Pulte", "Austin")).toContain("Region=Austin");
    expect(dreesAreaFor("/new-homes-austin/leander/fixture/fixture-50s/")).toBe("Austin");
    expect(dreesAreaFor("/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/")).toBe("San Antonio");
    const areas = JSON.stringify({ data: [{ areaName: "Austin", id: "AUST", pageId: 959 }, { areaName: "San Antonio", id: "SAN", pageId: 310095 }] });
    expect([parseDreesAreaId(areas, "Austin"), parseDreesAreaId(areas)]).toEqual([959, 310095]);
  });
});

describe("one run across both markets", () => {
  const H = "https://www.drhorton.com";
  const reader: DiscoveryReader = {
    builder: "D.R. Horton", host: "www.drhorton.com",
    index: { kind: "listing", url: `${H}/sa`, accept: "application/json", entries: drhListingEntries },
    communityPath: /^\/texas\/[a-z-]+\/[a-z0-9-]+\/[a-z0-9-]+$/,
    more: [{ index: { kind: "listing", url: `${H}/aus`, accept: "application/json", entries: drhListingEntries }, communityPath: /^\/texas\/austin\/[a-z0-9-]+\/[a-z0-9-]+$/ }, { index: { kind: "listing", url: `${H}/gone`, accept: "application/json", entries: drhListingEntries }, communityPath: /^\/x$/ }],
  };
  const record = (name: string, city: string, lat: number, lng: number) => `<script type="application/ld+json">${JSON.stringify({ "@type": "LocalBusiness", name, address: { streetAddress: "1 Fixture Rd", addressLocality: city, addressRegion: "TX", postalCode: "78653" }, geo: { latitude: lat, longitude: lng } })}</script>`;
  const site: Record<string, string> = {
    [`${H}/sa`]: JSON.stringify({ CommunityData: [{ commPageLink: "/texas/san-antonio/san-antonio/known-ranch" }] }),
    [`${H}/aus`]: JSON.stringify({ CommunityData: [{ commPageLink: "/texas/austin/manor/monarch-ranch" }, { commPageLink: "/texas/austin/waco/far-fixture" }] }),
    [`${H}/texas/austin/manor/monarch-ranch`]: record("Monarch Ranch", "Manor", 30.374, -97.533),
    [`${H}/texas/austin/waco/far-fixture`]: record("Far Fixture", "Waco", 31.55, -97.15),
  };

  it("finds Austin's communities beside San Antonio's, reads no page it already has, and says which market it could not read", async () => {
    const requested: string[] = [];
    const fetcher = (async (input: string | URL | Request) => { const url = String(input); requested.push(url); return site[url] ? new Response(site[url], { status: 200, headers: { "content-type": url.endsWith("sa") || url.endsWith("aus") ? "application/json" : "text/html" } }) : new Response("missing", { status: 404 }); }) as typeof fetch;
    const known = new Set([normalizedDealSourceKey(`${H}/texas/san-antonio/san-antonio/known-ranch`)]);
    const found = await discoverBuilderCommunities(reader, fetcher, known);
    expect(found.communities.map((community) => [community.name, community.city])).toEqual([["Monarch Ranch", "Manor"]]);
    expect(found.skipped).toEqual([{ url: `${H}/texas/austin/waco/far-fixture`, reason: "outside_area" }]);
    expect(found.known).toBe(1);
    expect(found.unreadMarkets).toEqual([`${H}/gone`]);
    expect(requested).not.toContain(`${H}/texas/san-antonio/san-antonio/known-ranch`);
  });
});
