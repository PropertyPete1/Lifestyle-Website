import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isViewHomesOfferBadge, parseViewHomesCommunity, resetViewHomesCaches, viewHomesDescriptionStatus, viewHomesListingUrl } from "./dealsAdapters.viewhomes";
import { loadOfficialDeals, type HtmlFetcher } from "./dealsAdapters";

/**
 * Nov 20, 2026: View Homes put its offer ("4.99%*+ $10K Closing Costs!") in a home card's status badge, so Talley Fields
 * and Weltner Farms were held for an unlabelled home. Such a home's own page still says "Move-in ready" in its
 * description line; that is read, and a home whose page says nothing readable stays held.
 */
const fixture = (file: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-11-04/viewhomes-${file}.html.gz`, import.meta.url))).toString("utf8");
const AUGUST = "https://yourviewhome.com/communities/august-fields-new-braunfels-tx/";
const HOME = `${AUGUST}homes/926-manger-lane/`;
const NOW = new Date("2026-11-20T15:30:00Z");
const OFFER = "4.99%*+ $10K Closing Costs!";
const homePage = (description: string, title = "A home") => `<html><head><title>${title}</title><meta name="description" content="${description}" /></head><body><span class="module-floorplan-hero__status">${OFFER}</span></body></html>`;

function siteFetcher(site: Record<string, string>) {
  const requested: string[] = [];
  const fetcher = vi.fn(async (input: string) => {
    requested.push(input);
    const body = site[input];
    return body === undefined ? new Response("not found", { status: 404, headers: { "content-type": "text/html" } }) : new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  });
  return { fetcher: fetcher as unknown as HtmlFetcher, requested };
}

/** The August Fields page with the first card's "Ready Now!" badge replaced by the offer. */
const offerPage = () => {
  const page = fixture("communities_august-fields-new-braunfels-tx_");
  const swapped = page.replace(/(<span class="home-preview__status">)Ready Now!\s*(<\/span>)/, (_match, open: string, close: string) => `${open}${OFFER}${close}`);
  expect(swapped).not.toBe(page);
  return swapped;
};

beforeEach(() => resetViewHomesCaches());

describe("View Homes: an offer in the status badge", () => {
  it("tells an offer badge from a status, and reads the home page's description line", () => {
    expect([OFFER, "$5,000 toward closing", "Rates from 3.99%", "Special incentive!"].every(isViewHomesOfferBadge)).toBe(true);
    expect(["Ready Now!", "Est. Completion- November", "Sold", "Under Contract", "", null].some((badge) => isViewHomesOfferBadge(badge as string | null))).toBe(false);
    expect(viewHomesDescriptionStatus(homePage("Move-in ready Sunrise View at Sample Farms in New Braunfels. 2,105 sq ft."))).toBe("Ready Now!");
    expect(viewHomesDescriptionStatus(homePage("Est. Completion- January 2027 for this Azalea home."))).toBe("Est. Completion- January 2027");
    expect(viewHomesDescriptionStatus(homePage("A beautiful Azalea home in New Braunfels."))).toBeNull();
    expect(viewHomesDescriptionStatus("<html><head></head></html>")).toBeNull();
    // Talley Fields: no description line, but the page is titled "For Sale: <street>" — for sale, timing not given.
    expect(viewHomesDescriptionStatus("<html><head><title>For Sale: 14723 Sample Clover</title></head></html>")).toBe("For Sale");
    expect(viewHomesDescriptionStatus(homePage("Move-in ready Azalea.", "For Sale: 1 Sample Way"))).toBe("Ready Now!");
  });

  it("Nov 23: a description opening with the home's own street and saying home for sale reads as For Sale; a partial line holds", () => {
    const line = "4521 Sample Bnd., Exampleville, TX 70000- New 2,040 sq. ft. home for sale in Other Meadows by View Homes with 4 bed.";
    const plain = homePage(line, "4521 Sample Bend, Exampleville | View Homes | New Construction");
    expect(viewHomesDescriptionStatus(plain, "4521 Sample Bend")).toBe("For Sale");
    // Without the card's street to compare, another home's street, or no "for sale": nothing.
    expect(viewHomesDescriptionStatus(plain)).toBeNull();
    expect(viewHomesDescriptionStatus(plain, "4525 Sample Bend")).toBeNull();
    expect(viewHomesDescriptionStatus(plain, "4521 Other Bend")).toBeNull();
    expect(viewHomesDescriptionStatus(homePage("4521 Sample Bnd., Exampleville, TX 70000- New 2,040 sq. ft. home in Other Meadows."), "4521 Sample Bend")).toBeNull();
    expect(viewHomesDescriptionStatus(homePage("New home for sale in Exampleville."), "4521 Sample Bend")).toBeNull();
  });

  it("a card whose page only says its own street is a home for sale publishes as a quick move-in with no date", async () => {
    const page = offerPage();
    const promoUrl = parseViewHomesCommunity(page, AUGUST)!.promoUrl!;
    const street = parseViewHomesCommunity(page, AUGUST)!.homes[0]!.street!;
    const number = /^\d+/.exec(street)![0];
    const name = /^\d+\s+([A-Za-z]+)/.exec(street)![1];
    const body = homePage(`${number} ${name} Ln., Exampleville, TX 70000- New home for sale in Other Meadows by View Homes.`);
    const { fetcher } = siteFetcher({ [AUGUST]: page, [viewHomesListingUrl()]: fixture("region_texas_"), [promoUrl]: "<html><body>none</body></html>", [HOME]: body });
    const result = await loadOfficialDeals({ builder: "View Homes", sourceUrl: AUGUST, privateCommunityName: "August Fields", scrubList: ["August Fields"] }, { fetcher, now: () => NOW });
    expect(result.private.homes[0]).toMatchObject({ status: "Quick Move-In", readyNow: false, moveInDate: null });
  });

  it("a card with an offer badge takes its status from its own page, and the community publishes", async () => {
    const page = offerPage();
    expect(parseViewHomesCommunity(page, AUGUST)!.homes[0]!.statusText).toBe(OFFER);
    const promoUrl = parseViewHomesCommunity(page, AUGUST)!.promoUrl!;
    const { fetcher, requested } = siteFetcher({ [AUGUST]: page, [viewHomesListingUrl()]: fixture("region_texas_"), [promoUrl]: "<html><body>none</body></html>", [HOME]: homePage("Move-in ready Wisteria at August Fields in New Braunfels.") });
    const result = await loadOfficialDeals({ builder: "View Homes", sourceUrl: AUGUST, privateCommunityName: "August Fields", scrubList: ["August Fields"] }, { fetcher, now: () => NOW });
    expect(result.holdReasons.filter((reason) => reason !== "expected_incentive_container_not_found")).toEqual([]);
    expect(result.private.homes[0]).toMatchObject({ privateName: "926 Manger Lane", status: "Quick Move-In (Move-In Ready)", readyNow: true });
    // Only the offer card's page was read; the others kept their own badges.
    expect(requested.filter((url) => url.includes("/homes/"))).toEqual([HOME]);
  });

  it("a home whose page is only titled For Sale is published as a quick move-in with no date", async () => {
    const page = offerPage();
    const promoUrl = parseViewHomesCommunity(page, AUGUST)!.promoUrl!;
    const { fetcher } = siteFetcher({ [AUGUST]: page, [viewHomesListingUrl()]: fixture("region_texas_"), [promoUrl]: "<html><body>none</body></html>", [HOME]: "<html><head><title>For Sale: 926 Manger Lane</title></head><body></body></html>" });
    const result = await loadOfficialDeals({ builder: "View Homes", sourceUrl: AUGUST, privateCommunityName: "August Fields", scrubList: ["August Fields"] }, { fetcher, now: () => NOW });
    expect(result.private.homes[0]).toMatchObject({ privateName: "926 Manger Lane", status: "Quick Move-In", readyNow: false, moveInDate: null });
  });

  it("a home whose page does not say (or does not load) stays unlabelled, which the sync holds as unlabelled_home_status", async () => {
    for (const body of [homePage("A beautiful Wisteria home."), undefined]) {
      resetViewHomesCaches();
      const page = offerPage();
      const promoUrl = parseViewHomesCommunity(page, AUGUST)!.promoUrl!;
      const { fetcher } = siteFetcher({ [AUGUST]: page, [viewHomesListingUrl()]: fixture("region_texas_"), [promoUrl]: "<html><body>none</body></html>", ...(body ? { [HOME]: body } : {}) });
      const result = await loadOfficialDeals({ builder: "View Homes", sourceUrl: AUGUST, privateCommunityName: "August Fields", scrubList: ["August Fields"] }, { fetcher, now: () => NOW });
      expect(result.private.homes[0]).toMatchObject({ privateName: "926 Manger Lane", status: null, readyNow: false });
    }
  });
});
