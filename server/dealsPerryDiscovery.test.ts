import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoverBuilderCommunities, perryDiscoveryReader } from "./dealsDiscovery";
import { parsePerryCommunityPage, parsePerryHomeAddress, perryCommunityPath, resetPerryDiscoveryCache } from "./dealsAdapters.perryDiscovery";

/**
 * Perry Homes in both markets (October 25, 2026, Peter: Austin). Perry's pages carry no schema.org record and no
 * coordinates: a community is placed from the street address on its first home's page and that ZIP's centroid.
 * Fixture names, streets and ZIP points are invented; the Flight shapes are Perry's.
 */
vi.mock("./db", () => ({ getDb: async () => null }));

const flight = (payload: string) => `<html><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`;
const communityPage = (market: string, slug: string, name: string, band: string) => flight(`e:["$","main",null,{"children":[["$","$L30",null,{"communityDisplayName":"${name}","marketDisplayName":"x","sections":[{"section_title":"${name} 50'","section_url":"/new-homes/texas/${market}/${slug}/${slug}-50","from_price":"From the $${band}s"},{"section_title":"${name} 60'","section_url":"/new-homes/texas/${market}/${slug}/${slug}-60","from_price":"From the $999s"}]}]]}]`);
const homePage = (street: string, city: string, zip: string) => flight(`e:["$","main",null,{"children":[["$","$L29",null,{"address":{"address_1":"${street}","address_2":null,"city":"${city}","state":"TX","zip":"${zip}"},"home_details":{"price":400000}}]]}]`);
const planOnlyCommunity = (market: string, slug: string) => flight(`e:["$","main",null,{"children":[["$","$L30",null,{"communityDisplayName":"Plans Only","sections":[{"section_title":"Plans Only 45'","section_url":"/new-homes/texas/${market}/${slug}/${slug}-45","from_price":"From the $300s"}]}]]}]`);

const SITEMAP = `<?xml version="1.0"?><urlset>${[
  "https://www.perryhomes.com/new-homes/texas/austin",
  "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge",
  "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge/fixture-ridge-50",
  "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge/fixture-ridge-50/2206h",
  "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge/fixture-ridge-50/sales-center",
  "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge/fixture-ridge-50/204-fixture-pass",
  "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge/fixture-ridge-60/118-fixture-way",
  "https://www.perryhomes.com/new-homes/texas/austin/plans-only",
  "https://www.perryhomes.com/new-homes/texas/austin/plans-only/plans-only-45/2401w",
  "https://www.perryhomes.com/new-homes/texas/austin/promotion/x",
  "https://www.perryhomes.com/new-homes/texas/san-antonio/fixture-heights",
  "https://www.perryhomes.com/new-homes/texas/san-antonio/fixture-heights/fixture-heights-50/119-fixture-trail",
  "https://www.perryhomes.com/new-homes/texas/houston/far-away",
  "https://www.perryhomes.com/new-homes/texas/houston/far-away/far-away-50/1-far-st",
].map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;

const PAGES: Record<string, string> = {
  "https://www.perryhomes.com/sitemap.xml": SITEMAP,
  "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge": communityPage("austin", "fixture-ridge", "Fixture Ridge", "380"),
  "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge/fixture-ridge-50/204-fixture-pass": homePage("204 Fixture Pass", "Leander", "78641"),
  "https://www.perryhomes.com/new-homes/texas/austin/plans-only": planOnlyCommunity("austin", "plans-only"),
  "https://www.perryhomes.com/new-homes/texas/san-antonio/fixture-heights": communityPage("san-antonio", "fixture-heights", "Fixture Heights", "560"),
  "https://www.perryhomes.com/new-homes/texas/san-antonio/fixture-heights/fixture-heights-50/119-fixture-trail": homePage("119 Fixture Trail", "Cibolo", "78108"),
};
const ZIPS: Record<string, { lat: number; lng: number }> = { "78641": { lat: 30.56, lng: -97.86 }, "78108": { lat: 29.56, lng: -98.23 } };

const fetched: string[] = [];
const fetcher = vi.fn(async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  fetched.push(url);
  const body = PAGES[url.replace(/\/+$/, "")];
  return new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": url.endsWith(".xml") ? "application/xml" : "text/html" } });
}) as unknown as typeof fetch;
const geocodeZip = vi.fn(async (zip: string) => ZIPS[zip] ?? null);

beforeEach(() => { resetPerryDiscoveryCache(); fetched.length = 0; geocodeZip.mockClear(); });

describe("Perry Homes discovery", () => {
  it("reads the community page's name, collections and price band, and a home page's address", () => {
    const page = parsePerryCommunityPage(PAGES["https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge"]!, "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge")!;
    expect(page).toEqual({ name: "Fixture Ridge", sections: ["/new-homes/texas/austin/fixture-ridge/fixture-ridge-50", "/new-homes/texas/austin/fixture-ridge/fixture-ridge-60"], priceFrom: 380_000 });
    expect(parsePerryHomeAddress(PAGES["https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge/fixture-ridge-50/204-fixture-pass"]!)).toEqual({ street: "204 Fixture Pass", city: "Leander", zip: "78641" });
    expect(parsePerryHomeAddress("<html></html>")).toBeNull();
    expect(perryCommunityPath("austin").test("/new-homes/texas/austin/fixture-ridge")).toBe(true);
    expect(perryCommunityPath("austin").test("/new-homes/texas/austin/fixture-ridge/fixture-ridge-50")).toBe(false);
    expect(perryCommunityPath("austin").test("/new-homes/texas/austin/promotion")).toBe(false);
  });

  it("finds both markets' communities from the sitemap and places each at its first home's ZIP centroid; plans-only and other markets are left out", async () => {
    const found = await discoverBuilderCommunities(perryDiscoveryReader(geocodeZip), fetcher);
    expect(found.ok).toBe(true);
    expect(found.communities.map((community) => [community.name, community.city, community.zip, community.address, community.priceFrom, community.sourceUrl])).toEqual([
      ["Fixture Heights", "Cibolo", "78108", "119 Fixture Trail, Cibolo, TX 78108", 560_000, "https://www.perryhomes.com/new-homes/texas/san-antonio/fixture-heights"],
      ["Fixture Ridge", "Leander", "78641", "204 Fixture Pass, Leander, TX 78641", 380_000, "https://www.perryhomes.com/new-homes/texas/austin/fixture-ridge"],
    ]);
    // A community with plans only has no home page and so no address yet: skipped, found again once a home is listed.
    expect(found.skipped).toEqual([{ url: "https://www.perryhomes.com/new-homes/texas/austin/plans-only", reason: "no_community_record" }]);
    // The sitemap once, each community page once, and one home page per placed community; never a collection, plan, promotion or sales-center page.
    expect(fetched.filter((url) => url.endsWith("sitemap.xml"))).toHaveLength(1);
    expect(fetched.some((url) => /sales-center|2206h|2401w|promotion|far-away/.test(url))).toBe(false);
    expect(geocodeZip.mock.calls.map(([zip]) => zip).sort()).toEqual(["78108", "78641"]);
  });

  it("skips the communities already in the database without reading their pages", async () => {
    const known = new Set(["https://www.perryhomes.com/new-homes/texas/san-antonio/fixture-heights"]);
    const found = await discoverBuilderCommunities(perryDiscoveryReader(geocodeZip), fetcher, known);
    expect(found.known).toBe(1);
    expect(found.communities.map((community) => community.name)).toEqual(["Fixture Ridge"]);
    expect(fetched.some((url) => url.includes("san-antonio/fixture-heights"))).toBe(false);
  });

  it("reports the builder unreadable when the sitemap cannot be read, so the run moves on", async () => {
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const found = await discoverBuilderCommunities(perryDiscoveryReader(geocodeZip), down);
    expect(found.ok).toBe(false);
    expect(found.reason).toBe("sitemap_unreadable");
  });
});
