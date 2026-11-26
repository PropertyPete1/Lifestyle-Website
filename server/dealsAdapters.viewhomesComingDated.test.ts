import { beforeEach, describe, expect, it, vi } from "vitest";
import { isViewHomesComingSoonBadge, resetViewHomesCaches, viewHomesListingUrl } from "./dealsAdapters.viewhomes";
import { loadOfficialDeals, type HtmlFetcher } from "./dealsAdapters";

/**
 * Nov 26, 2026: Ladera and Enclave 35 were held (expected_community_container_not_found) because their hero badge changed
 * from "Coming Soon" to the opening month ("Coming February 2027"). Their pages still carry no homes-and-plans module. A
 * badge naming a real month and year is read as coming soon (nothing for sale); a partial badge still holds.
 * Invented community, address and phone.
 */
const PAGE = "https://yourviewhome.com/communities/fixture-meadow/";
const NOW = new Date("2026-11-26T15:00:00Z");
const config = { builder: "View Homes" as const, sourceUrl: PAGE, privateCommunityName: "Fixture Meadow", scrubList: ["Fixture Meadow"] };

const page = (badge: string) => `<html><head><link rel="canonical" href="${PAGE}" /></head><body>
<section class="module module-community-intro"><div class="module-community-intro__inner">
<span class="module-community-intro__status">${badge}</span>
<h1 class="module-community-intro__title notranslate">Fixture Meadow</h1>
<a class="notranslate" href="https://maps.google.com/?q=100+Example+Way">100 Example Way, San Antonio, TX 78200</a>
<a href="tel:2105550100">(210) 555-0100</a>
</div></section>
<section class="module module-community-overview"><p>Overview text.</p></section>
</body></html>`;
const region = `<html><body><script>oceanFloorModules.homepageCommunities.push({ communities: [{"post_id": 9001, "post_title": "Fixture Meadow", "permalink": "${PAGE}", "lat": "29.4", "lng": "-98.6"}] });</script></body></html>`;

function fetcherFor(body: string) {
  const site: Record<string, string> = { [PAGE]: body, [viewHomesListingUrl()]: region };
  return vi.fn(async (input: string) => site[input] === undefined
    ? new Response("not found", { status: 404, headers: { "content-type": "text/html" } })
    : new Response(site[input], { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as HtmlFetcher;
}

beforeEach(() => resetViewHomesCaches());

describe("View Homes: a coming-soon badge that names the opening month", () => {
  it("reads 'Coming Soon' and 'Coming <Month> <Year>' as coming soon, and nothing partial", () => {
    for (const label of ["Coming Soon", "Coming February 2027", "Coming Jan. 2027", "Coming Sept 2027!"]) expect(isViewHomesComingSoonBadge(label), label).toBe(true);
    for (const label of [null, "", "Coming", "Coming 2027", "Coming February", "Coming Octember 2027", "Coming Early 2027", "Now Selling"]) expect(isViewHomesComingSoonBadge(label), String(label)).toBe(false);
  });

  it("a dated coming-soon page with no module publishes nothing for sale and holds nothing", async () => {
    const result = await loadOfficialDeals(config, { fetcher: fetcherFor(page("Coming February 2027")), now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toEqual([]);
    expect(result.private.plans).toEqual([]);
  });

  it("a page with no module and a partial badge still holds", async () => {
    for (const badge of ["Coming", "Coming 2027", "Coming Octember 2027", ""]) {
      resetViewHomesCaches();
      const result = await loadOfficialDeals(config, { fetcher: fetcherFor(page(badge)), now: () => NOW });
      expect(result.holdReasons, badge).toEqual(["expected_community_container_not_found"]);
    }
  });
});
