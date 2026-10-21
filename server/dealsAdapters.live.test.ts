import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { chesmarDetailFacts, chesmarGallery, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Fixtures shaped like the official Chesmar pages served in October 2026
 * (Blazor server markup): the community page renders its floor-plan list
 * client-side, so the served HTML carries an empty results container; plan
 * and home pages keep their photos in a Bootstrap hero carousel of <picture>
 * elements, their facts in a labelled Overview list, and the sale status in
 * the document title.
 */
const FIXTURES = path.join(import.meta.dirname, "fixtures", "deals");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
const COMMUNITY = "https://www.chesmar.com/texas/san-antonio-new-homes/san-antonio/fixture-lakes/";
const config: CommunitySourceConfig = {
  builder: "Chesmar",
  sourceUrl: COMMUNITY,
  privateCommunityName: "Fixture Lakes",
  scrubList: [],
  scrubConfig: { builder: ["Chesmar Homes", "Chesmar"], lender: ["HomeAmerican Mortgage Corporation", "HomeAmerican"], community: ["Fixture Lakes"], plan: [], street: [], other: [] },
};

function liveDocuments(): Record<string, string> {
  const plan = fixture("chesmar-plan-page-live.html");
  return {
    [COMMUNITY]: fixture("chesmar-community-live.html"),
    "https://www.chesmar.com/sitemap.xml": fixture("chesmar-sitemap-live-index.xml"),
    "https://www.chesmar.com/sitemap5.xml": fixture("chesmar-sitemap-live-plans.xml"),
    "https://www.chesmar.com/sitemap6.xml": fixture("chesmar-sitemap-live-homes.xml"),
    [`${COMMUNITY}brandon/`]: plan,
    [`${COMMUNITY}evan/`]: plan.replaceAll("Brandon", "Evan").replaceAll("brandon", "evan").replaceAll("$499,990", "$524,990").replace("<b>Beds</b>: 4", "<b>Beds</b>: 5"),
    [`${COMMUNITY}silas/`]: plan.replaceAll("Brandon", "Silas").replaceAll("brandon", "silas").replaceAll("$499,990", "$559,990"),
    // A real child page that is not a floor plan: probed, recognised, skipped.
    [`${COMMUNITY}our-story/`]: '<!DOCTYPE html><html><head><title>Our Story | Chesmar Homes</title></head><body><app><main><article><h1>Our Story</h1><p>Chesmar Homes has built thousands of homes across Texas with 4 bedrooms or more.</p></article></main></app></body></html>',
    [`${COMMUNITY}silas/42260000-0010/`]: fixture("chesmar-home-page-live.html"),
    "https://www.chesmar.com/incentives/": fixture("chesmar-incentives.html"),
  };
}

const fetcher = (documents: Record<string, string>) => vi.fn(async (input: string) => {
  const body = documents[input];
  return new Response(body ?? "not found", { status: body === undefined ? 404 : 200, headers: { "content-type": input.endsWith(".xml") ? "application/xml" : "text/html" } });
});

describe("Chesmar adapter on the live-structure fixtures", () => {
  it("discovers every sitemap plan page when the community page renders its plan list client-side", async () => {
    const fetch = fetcher(liveDocuments());
    const result = await loadOfficialDeals(config, { fetcher: fetch });
    expect(result.holdReasons).toEqual([]);
    expect(result.catalogOk).toBe(true);
    const requested = fetch.mock.calls.map(([url]) => url);
    expect(requested).not.toContain(`${COMMUNITY}site-map/`);
    expect(requested).toContain(`${COMMUNITY}our-story/`);
    expect(result.private.plans.map((plan) => plan.sourceUrl).sort()).toEqual([`${COMMUNITY}brandon/`, `${COMMUNITY}evan/`, `${COMMUNITY}silas/`]);
    const brandon = result.private.plans.find((plan) => plan.sourceUrl.endsWith("brandon/"));
    expect(brandon).toMatchObject({ privatePlanName: "Brandon", price: 499990, bedrooms: 4, bathrooms: 3, squareFeet: 2340, status: null });
    expect(result.private.plans.find((plan) => plan.sourceUrl.endsWith("evan/"))).toMatchObject({ privatePlanName: "Evan", price: 524990, bedrooms: 5 });
    // One photo per carousel slide, never the .webp and .jpg variants of the same slide twice.
    expect(brandon?.gallery?.map((image) => image.sourceUrl)).toEqual(Array.from({ length: 10 }, (_, index) => `https://www.chesmar.com/content/che/media-2045${65 + index}.jpg`));
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 499990, schoolDistrict: "Fixture County ISD" });
    expect(result.private.discoveredScrubConfig?.plan).toEqual(expect.arrayContaining(["Brandon", "Evan", "Silas"]));
  });

  it("reads the model home's status from the title and its lot address from the breadcrumb", async () => {
    const result = await loadOfficialDeals(config, { fetcher: fetcher(liveDocuments()) });
    expect(result.private.homes).toHaveLength(1);
    expect(result.private.homes[0]).toMatchObject({ status: "Model For Tour", price: null, bedrooms: 4, bathrooms: 3.5, squareFeet: 2982, privatePlanName: "Silas", privateAddress: "9010 Fixture Grove" });
    expect(result.private.homes[0].gallery).toHaveLength(5);
    expect(result.private.discoveredScrubConfig?.street).toEqual(expect.arrayContaining(["9010 Fixture Grove", "Fixture Grove"]));
    const publicJson = JSON.stringify(result.public);
    for (const privateValue of ["Fixture Lakes", "Fixture Grove", "Brandon", "Chesmar", "HomeAmerican", "chesmar.com"]) expect(publicJson).not.toContain(privateValue);
  });

  it("keeps the configured whitelist strict while still fetching a home's parent plan", async () => {
    const fetch = fetcher(liveDocuments());
    const result = await loadOfficialDeals({ ...config, planSlugs: ["brandon"] }, { fetcher: fetch });
    expect(result.catalogOk).toBe(true);
    const requested = fetch.mock.calls.map(([url]) => url);
    expect(requested).not.toContain(`${COMMUNITY}evan/`);
    expect(requested).not.toContain(`${COMMUNITY}our-story/`);
    expect(result.private.plans.map((plan) => plan.sourceUrl).sort()).toEqual([`${COMMUNITY}brandon/`, `${COMMUNITY}silas/`]);
  });

  it("reads labelled facts and dedupes picture variants on their own", () => {
    const facts = chesmarDetailFacts(fixture("chesmar-home-page-live.html"));
    expect(facts).toEqual({ price: null, bedrooms: 4, bathrooms: 3.5, squareFeet: 2982, status: "Model For Tour", planName: "Silas", address: "9010 Fixture Grove" });
    const gallery = chesmarGallery(COMMUNITY, '<div class="carousel"><picture><source type="image/webp" srcset="https://www.chesmar.com/content/che/media-1.webp" /><img src="https://www.chesmar.com/content/che/media-1.webp" alt="a" /></picture><picture><source srcset="https://www.chesmar.com/content/che/media-1.jpg" /></picture><img src="https://www.chesmar.com/content/che/media-2.png" alt="b" /></div>');
    expect(gallery?.map((image) => image.sourceUrl)).toEqual(["https://www.chesmar.com/content/che/media-1.jpg", "https://www.chesmar.com/content/che/media-2.png"]);
  });
});

describe("official page fetches", () => {
  const page = '<html><head><title>Fixture Lakes in San Antonio, Texas | Chesmar Homes</title></head><body><main><h1>Fixture Lakes</h1><section id="floorplans"><div class="search-results-container">FloorPlans</div></section></main></body></html>';
  it("retries once after a network failure or a server error, never after a client error", async () => {
    const documents = liveDocuments();
    let communityCalls = 0;
    const flaky = vi.fn(async (input: string) => {
      if (input === COMMUNITY && communityCalls++ === 0) throw new TypeError("fetch failed");
      const body = documents[input];
      return new Response(body ?? "not found", { status: body === undefined ? 404 : 200, headers: { "content-type": input.endsWith(".xml") ? "application/xml" : "text/html" } });
    });
    const result = await loadOfficialDeals(config, { fetcher: flaky });
    expect(result.catalogOk).toBe(true);
    expect(communityCalls).toBe(2);

    let serverErrorCalls = 0;
    const serverError = vi.fn(async (input: string) => {
      if (input === COMMUNITY && serverErrorCalls++ === 0) return new Response("busy", { status: 503 });
      const body = documents[input];
      return new Response(body ?? "not found", { status: body === undefined ? 404 : 200, headers: { "content-type": input.endsWith(".xml") ? "application/xml" : "text/html" } });
    });
    expect((await loadOfficialDeals(config, { fetcher: serverError })).catalogOk).toBe(true);
    expect(serverErrorCalls).toBe(2);

    const forbidden = vi.fn(async () => new Response("forbidden", { status: 403 }));
    const refused = await loadOfficialDeals(config, { fetcher: forbidden });
    expect(refused.catalogOk).toBe(false);
    // A 403 is the builder refusing the reader: its own hold, so the admin switches the community to Manual (never retried, never evaded).
    expect(refused.holdReasons).toEqual(["source_access_refused"]);
    expect(forbidden).toHaveBeenCalledTimes(1);
    void page;
  }, 20_000);
});
