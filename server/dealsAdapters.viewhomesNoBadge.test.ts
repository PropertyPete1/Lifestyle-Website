import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseViewHomesCommunity, resetViewHomesCaches, viewHomesListingUrl } from "./dealsAdapters.viewhomes";
import { loadOfficialDeals, type HtmlFetcher } from "./dealsAdapters";

/**
 * Nov 24, 2026: August Fields was held as a changed page because two of its home cards carried no status badge at all
 * (the others still did). Such a card's own page is read the same way as an offer-badge card's; a page that says nothing
 * leaves the home unlabelled (held), and a page whose cards all lack a badge is still a changed page.
 */
const fixture = (file: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-11-04/viewhomes-${file}.html.gz`, import.meta.url))).toString("utf8");
const AUGUST = "https://yourviewhome.com/communities/august-fields-new-braunfels-tx/";
const HOME = `${AUGUST}homes/926-manger-lane/`;
const NOW = new Date("2026-11-24T15:30:00Z");
const config = { builder: "View Homes" as const, sourceUrl: AUGUST, privateCommunityName: "August Fields", scrubList: ["August Fields"] };

function siteFetcher(site: Record<string, string>) {
  const requested: string[] = [];
  const fetcher = vi.fn(async (input: string) => {
    requested.push(input);
    const body = site[input];
    return body === undefined ? new Response("not found", { status: 404, headers: { "content-type": "text/html" } }) : new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  });
  return { fetcher: fetcher as unknown as HtmlFetcher, requested };
}

/** The August Fields page with the first card's badge removed (or every card's). */
const noBadgePage = (all = false) => {
  const page = fixture("communities_august-fields-new-braunfels-tx_");
  const badge = /<span class="home-preview__status">[^<]*<\/span>/;
  const swapped = all ? page.replace(new RegExp(badge.source, "g"), "") : page.replace(badge, "");
  expect(swapped).not.toBe(page);
  return swapped;
};
const siteFor = (page: string, home?: string) => {
  const promoUrl = parseViewHomesCommunity(page, AUGUST)!.promoUrl;
  return siteFetcher({ [AUGUST]: page, [viewHomesListingUrl()]: fixture("region_texas_"), ...(promoUrl ? { [promoUrl]: "<html><body>none</body></html>" } : {}), ...(home ? { [HOME]: home } : {}) });
};

beforeEach(() => resetViewHomesCaches());

describe("View Homes: a card with no status badge", () => {
  it("takes its status from its own page (titled For Sale: a quick move-in with no date), and only that page is read", async () => {
    const page = noBadgePage();
    expect(parseViewHomesCommunity(page, AUGUST)!.homes[0]!.statusText).toBeNull();
    const { fetcher, requested } = siteFor(page, "<html><head><title>For Sale: 926 Manger Lane</title></head><body></body></html>");
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons.filter((reason) => reason !== "expected_incentive_container_not_found")).toEqual([]);
    expect(result.private.homes[0]).toMatchObject({ privateName: "926 Manger Lane", status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(requested.filter((url) => url.includes("/homes/"))).toEqual([HOME]);
  });

  it("a badge-less card whose page says nothing (or does not load) stays unlabelled, never guessed", async () => {
    for (const body of ["<html><head><title>A home</title><meta name=\"description\" content=\"A beautiful home.\" /></head></html>", undefined]) {
      resetViewHomesCaches();
      const { fetcher } = siteFor(noBadgePage(), body);
      const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
      expect(result.private.homes[0]).toMatchObject({ privateName: "926 Manger Lane", status: null, readyNow: false });
    }
  });

  it("a page whose cards all lack a badge is a changed page and holds without reading any home page", async () => {
    const { fetcher, requested } = siteFor(noBadgePage(true), "<html><head><title>For Sale: 926 Manger Lane</title></head></html>");
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toContain("expected_community_container_not_found");
    expect(requested.filter((url) => url.includes("/homes/"))).toEqual([]);
  });
});
