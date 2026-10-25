import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoverBuilderCommunities, perryDiscoveryReader } from "./dealsDiscovery";
import { parsePerryCommunityPage, parsePerrySalesCenter, perryCommunityPath, resetPerryDiscoveryCache } from "./dealsAdapters.perryDiscovery";

/**
 * Perry Homes in both markets (October 25, 2026, Peter: Austin). The fixtures are trimmed excerpts of Perry's live
 * Austin and San Antonio pages that day (Easton Park and Cibolo Valley Heights: each community page and its first
 * collection's sales-center page), with the Flight shapes as served; the plans-only community is invented in the same shape.
 */
vi.mock("./db", () => ({ getDb: async () => null }));

const fixture = (name: string) => readFileSync(new URL(`./fixtures/deals/${name}.html`, import.meta.url), "utf8");
const COMMUNITY = fixture("perry-austin-community");
const SALES_CENTER = fixture("perry-austin-sales-center");
const flight = (payload: string) => `<html><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`;
const SA_COMMUNITY = fixture("perry-sa-community");
const SA_SALES_CENTER = fixture("perry-sa-sales-center");
/** A community listed before any collection has an office page: not placed yet. */
const NEW_COMMUNITY = flight(`"community_name":"Fixture Grove","node":{"url":"/new-homes/texas/austin/fixture-grove/fixture-grove-45","ranges_from_price_sq_ft":{"from_price":300000}}`);

const P = "https://www.perryhomes.com";
const SITEMAP = `<?xml version="1.0"?><urlset>${[
  `${P}/new-homes/texas/austin`,
  `${P}/new-homes/texas/austin/easton-park`,
  `${P}/new-homes/texas/austin/easton-park/easton-park-40`,
  `${P}/new-homes/texas/austin/easton-park/easton-park-40/sales-center`,
  `${P}/new-homes/texas/austin/easton-park/easton-park-40/7006-ezra-brooks-bend`,
  `${P}/new-homes/texas/austin/easton-park/easton-park-40/2206h`,
  `${P}/new-homes/texas/austin/fixture-grove`,
  `${P}/new-homes/texas/austin/promotion/x`,
  `${P}/new-homes/texas/san-antonio/cibolo-valley-heights`,
  `${P}/new-homes/texas/san-antonio/cibolo-valley-heights/cibolo-valley-heights-65/sales-center`,
  `${P}/new-homes/texas/houston/far-away`,
].map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;

const PAGES: Record<string, string> = {
  [`${P}/sitemap.xml`]: SITEMAP,
  [`${P}/new-homes/texas/austin/easton-park`]: COMMUNITY,
  [`${P}/new-homes/texas/austin/easton-park/easton-park-40/sales-center`]: SALES_CENTER,
  [`${P}/new-homes/texas/austin/fixture-grove`]: NEW_COMMUNITY,
  [`${P}/new-homes/texas/san-antonio/cibolo-valley-heights`]: SA_COMMUNITY,
  [`${P}/new-homes/texas/san-antonio/cibolo-valley-heights/cibolo-valley-heights-65/sales-center`]: SA_SALES_CENTER,
};

const fetched: string[] = [];
const fetcher = vi.fn(async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  fetched.push(url);
  const body = PAGES[url.replace(/\/+$/, "")];
  return new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": url.endsWith(".xml") ? "application/xml" : "text/html" } });
}) as unknown as typeof fetch;

beforeEach(() => { resetPerryDiscoveryCache(); fetched.length = 0; });

describe("Perry Homes discovery", () => {
  it("reads the live Austin community page: its name, its collections in order and the lowest collection price", () => {
    expect(parsePerryCommunityPage(COMMUNITY, `${P}/new-homes/texas/austin/easton-park`)).toEqual({
      name: "Easton Park",
      sections: ["/new-homes/texas/austin/easton-park/easton-park-40", "/new-homes/texas/austin/easton-park/easton-park-50", "/new-homes/texas/austin/easton-park/easton-park-60"],
      priceFrom: 400_000,
    });
    // A collection page is not a community page: nothing is listed under it.
    expect(parsePerryCommunityPage(COMMUNITY, `${P}/new-homes/texas/austin/easton-park/easton-park-40`)).toBeNull();
    expect(perryCommunityPath("austin").test("/new-homes/texas/austin/easton-park")).toBe(true);
    expect(perryCommunityPath("austin").test("/new-homes/texas/austin/easton-park/easton-park-40")).toBe(false);
    expect(perryCommunityPath("austin").test("/new-homes/texas/austin/promotion")).toBe(false);
  });

  it("reads the live sales-center page: the office's street, city, ZIP, exact point and phone, never the model home's", () => {
    expect(parsePerrySalesCenter(SALES_CENTER)).toEqual({ street: "7808 Skytree Drive", city: "Austin", zip: "78744", geo: { lat: 30.1559496, lng: -97.716514 }, phone: "+17372006053" });
    expect(parsePerrySalesCenter("<html></html>")).toBeNull();
  });

  it("finds both markets' communities from the sitemap, each placed at its first collection's sales office; a new one with no office page yet and other markets are left out", async () => {
    const found = await discoverBuilderCommunities(perryDiscoveryReader(), fetcher);
    expect(found.ok).toBe(true);
    expect(found.communities.map((community) => [community.name, community.city, community.zip, community.address, community.salesPhone, community.priceFrom, community.sourceUrl])).toEqual([
      ["Cibolo Valley Heights", "Cibolo", "78108", "222 Krueger Way, Cibolo, TX 78108", "+12104181442", 560_000, `${P}/new-homes/texas/san-antonio/cibolo-valley-heights`],
      ["Easton Park", "Austin", "78744", "7808 Skytree Drive, Austin, TX 78744", "+17372006053", 400_000, `${P}/new-homes/texas/austin/easton-park`],
    ]);
    expect(found.skipped).toEqual([{ url: `${P}/new-homes/texas/austin/fixture-grove`, reason: "no_community_record" }]);
    // The sitemap once, each community page once and one sales-center page per placed community; never a home, plan or promotion page.
    expect(fetched.filter((url) => url.endsWith("sitemap.xml"))).toHaveLength(1);
    expect(fetched.filter((url) => url.endsWith("/sales-center"))).toEqual([`${P}/new-homes/texas/san-antonio/cibolo-valley-heights/cibolo-valley-heights-65/sales-center`, `${P}/new-homes/texas/austin/easton-park/easton-park-40/sales-center`, `${P}/new-homes/texas/austin/fixture-grove/fixture-grove-45/sales-center`]);
    expect(fetched.some((url) => /ezra-brooks|2206h|promotion|far-away/.test(url))).toBe(false);
  });

  it("skips the communities already in the database without reading their pages", async () => {
    // The 30 San Antonio communities already in the database are stored by their community-page URL, as here.
    const known = new Set([`${P}/new-homes/texas/san-antonio/cibolo-valley-heights`]);
    const found = await discoverBuilderCommunities(perryDiscoveryReader(), fetcher, known);
    expect(found.known).toBe(1);
    expect(found.communities.map((community) => community.name)).toEqual(["Easton Park"]);
    expect(fetched.some((url) => url.includes("san-antonio/cibolo-valley-heights"))).toBe(false);
  });

  it("reports the builder unreadable when the sitemap cannot be read, so the run moves on", async () => {
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const found = await discoverBuilderCommunities(perryDiscoveryReader(), down);
    expect(found.ok).toBe(false);
    expect(found.reason).toBe("sitemap_unreadable");
  });
});
