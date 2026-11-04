import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseViewHomesCommunity, parseViewHomesRoster, resetViewHomesCaches, viewHomesListingEntries, viewHomesListingUrl } from "./dealsAdapters.viewhomes";
import { loadOfficialDeals, type HtmlFetcher } from "./dealsAdapters";

/**
 * Nov 4, 2026: View Homes rebuilt yourviewhome.com overnight and all eleven of its communities went on hold
 * (expected_community_container_not_found). These are the pages the site served that morning (Peter's Mac, 9:29 AM CT):
 * the Texas region page (the roster is now `oceanFloorModules.homepageCommunities`, with no status and no homes), the
 * August Fields community page (hero became `.module-community-intro`, cards state their specs as text) and one home
 * and one plan page. Real addresses, as the builder publishes them.
 */
const fixture = (file: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-11-04/viewhomes-${file}.html.gz`, import.meta.url))).toString("utf8");
const HOST = "yourviewhome.com";
const AUGUST = "https://yourviewhome.com/communities/august-fields-new-braunfels-tx/";
const NOW = new Date("2026-11-04T15:30:00Z");

function siteFetcher(site: Record<string, string>) {
  const requested: string[] = [];
  const fetcher = vi.fn(async (input: string) => {
    requested.push(input);
    const body = site[input];
    return body === undefined ? new Response("not found", { status: 404, headers: { "content-type": "text/html" } }) : new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  });
  return { fetcher: fetcher as unknown as HtmlFetcher, requested };
}

beforeEach(() => resetViewHomesCaches());

describe("View Homes, November 2026 site", () => {
  it("the region page's map list is the roster: every Texas community with its page and pin, no status, no homes", () => {
    const roster = parseViewHomesRoster(fixture("region_texas_"), HOST)!;
    expect(roster.length).toBe(18);
    const august = roster.find((row) => row.url === AUGUST)!;
    expect(august).toMatchObject({ postId: 694, status: { value: null, label: null }, cardsOnly: true, homes: [] });
    expect(august.record).toMatchObject({ name: "August Fields", geo: { lat: 29.7105232, lng: -98.0785788 } });
    // discovery lists every community (coming soon is read from the page now)
    expect(viewHomesListingEntries(fixture("region_texas_"), HOST)!.some((entry) => entry.url === AUGUST)).toBe(true);
  });

  it("the community page: intro hero, address, phone, five home cards with specs from their text, and ten plans", () => {
    const page = parseViewHomesCommunity(fixture("communities_august-fields-new-braunfels-tx_"), AUGUST)!;
    expect(page).toMatchObject({ name: "August Fields", heroStatus: "Now Selling", street: "713 Willowbrook Ave", city: "New Braunfels", zip: "78130", phone: "2108175507", hasModule: true, hasHomesTab: true, foreignPage: false, foreignHome: false, foreignPlan: false });
    expect(page.homeUrls).toHaveLength(5);
    expect(page.homes[0]).toEqual({
      url: `${AUGUST}homes/926-manger-lane/`, street: "926 Manger Lane", plan: "Wisteria", statusText: "Ready Now!", moveIn: "Oct 2026",
      price: 406_690, squareFeet: 2_489, bedrooms: 4, bathrooms: 3, garage: 2, photo: "https://yourviewhome.com/wp-content/uploads/2026/09/2489-Wisteria-C.jpg",
    });
    expect(page.homes[1]).toMatchObject({ street: "930 Manger Lane", plan: "Azalea", statusText: "Est. Completion- November", price: 434_690, bathrooms: 3.5 });
    expect(page.plans).toHaveLength(10);
    expect(page.plans[0]).toMatchObject({ privatePlanName: "Desert View", price: 363_990, squareFeet: 1_609, bedrooms: 3, bathrooms: 2, garage: 2 });
    expect(page.promoUrl).toMatch(/^https:\/\/yourviewhome\.com\//);
  });

  it("the adapter reads August Fields from the page's cards, corroborated by the map roster", async () => {
    const promoUrl = parseViewHomesCommunity(fixture("communities_august-fields-new-braunfels-tx_"), AUGUST)!.promoUrl!;
    const { fetcher } = siteFetcher({ [AUGUST]: fixture("communities_august-fields-new-braunfels-tx_"), [viewHomesListingUrl()]: fixture("region_texas_"), [promoUrl]: "<html><body>no promo module here</body></html>" });
    const result = await loadOfficialDeals({ builder: "View Homes", sourceUrl: AUGUST, privateCommunityName: "August Fields", scrubList: ["August Fields"] }, { fetcher, now: () => NOW });
    expect(result.holdReasons.filter((reason) => reason !== "expected_incentive_container_not_found")).toEqual([]);
    // 930 Manger: the badge says November but the "Move In: Oct 2026" line is a passed month, so (as before) it is a
    // quick move-in with no date rather than a November promise.
    expect(result.private.homes.map((home) => [home.privateName, home.privatePlanName, home.status, home.price, home.bedrooms, home.bathrooms, home.squareFeet, home.garage, home.readyNow])).toEqual([
      ["926 Manger Lane", "Wisteria", "Quick Move-In (Move-In Ready)", 406_690, 4, 3, 2_489, 2, true],
      ["930 Manger Lane", "Azalea", "Quick Move-In", 434_690, 4, 3.5, 2_608, 2, false],
      ["966 Manger Lane", "Garden View", "Quick Move-In (Move-In Ready)", 375_135, 4, 2, 1_775, 2, true],
      ["962 Manger Lane", "Desert View", "Quick Move-In (Move-In Ready)", 364_390, 3, 2, 1_609, 2, true],
      ["947 Manger Lane", "Azalea", "Quick Move-In (Move-In Ready)", 412_290, 4, 3.5, 2_608, 2, true],
    ]);
    expect(result.private.homes[0]!.privateAddress).toBe("926 Manger Lane, New Braunfels, TX 78130");
    expect(result.private.plans).toHaveLength(10);
    expect(result.private.communityFacts?.fromPrice).toBe(363_990);
  });

  it("a November page whose cards lost their price or status is held, not read half-empty", async () => {
    const page = fixture("communities_august-fields-new-braunfels-tx_").replace(/<p class="home-preview__price">\$406,690<\/p>/, "");
    expect(page).not.toContain("$406,690</p>");
    const { fetcher } = siteFetcher({ [AUGUST]: page, [viewHomesListingUrl()]: fixture("region_texas_") });
    const result = await loadOfficialDeals({ builder: "View Homes", sourceUrl: AUGUST, privateCommunityName: "August Fields", scrubList: ["August Fields"] }, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual(["expected_community_container_not_found"]);
  });
});
