import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadOfficialDeals, type CommunitySourceConfig, type HtmlFetcher } from "./dealsAdapters";
import { drhCommunityStatus } from "./dealsAdapters.drhorton";

/**
 * Communities the builders' own pages call coming soon, captured on October 22,
 * 2026 (styles, inline SVG, comments and image source sets removed, then
 * gzipped; scripts and markup as served). Each nothing-for-sale page reads as
 * community_coming_soon, which lists the community in the Coming Soon section,
 * instead of expected_community_container_not_found, which flagged a broken page.
 */
const fixture = (file: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-10-22/${file}.html.gz`, import.meta.url))).toString("utf8");
const NOW = new Date("2026-10-22T20:00:00Z");

/** Serves each fixture at any URL whose last path segment matches; everything else is a 404. */
function siteFetcher(bySlug: Record<string, string>): HtmlFetcher {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const slug = decodeURIComponent(url.pathname.replace(/\/+$/, "").split("/").pop() ?? "").toLowerCase();
    const body = bySlug[slug];
    return body ? new Response(body, { status: 200, headers: { "content-type": "text/html" } }) : new Response("not captured", { status: 404, headers: { "content-type": "text/html" } });
  }) as HtmlFetcher;
}
const read = (builder: string, sourceUrl: string, bySlug: Record<string, string>) =>
  loadOfficialDeals({ builder, sourceUrl, privateCommunityName: "Fixture", scrubList: [] } as CommunitySourceConfig, { fetcher: siteFetcher(bySlug), now: () => NOW });

describe("Coming soon communities (October 22, 2026 captures)", () => {
  it("D.R. Horton: the header's own status badge, with no home block", async () => {
    const mcqueeney = fixture("drh-mcqueeney-oaks");
    expect(drhCommunityStatus(mcqueeney)).toBe("Coming Soon");
    expect((await read("D.R. Horton", "https://www.drhorton.com/texas/new-braunfels/new-braunfels/mcqueeney-oaks", { "mcqueeney-oaks": mcqueeney })).holdReasons).toEqual(["community_coming_soon"]);
    const winding = fixture("drh-winding-creek");
    expect(drhCommunityStatus(winding)).toBe("New Phase Coming Soon");
    expect((await read("D.R. Horton", "https://www.drhorton.com/texas/new-braunfels/new-braunfels/winding-creek", { "winding-creek": winding })).holdReasons).toEqual(["community_coming_soon"]);
    // A header saying anything else on a page without the home block is still a changed page.
    const selling = mcqueeney.replace(/(class="home-info__community-status"[\s\S]{0,400}?<span>)Coming Soon(<\/span>)/, "$1Now Selling$2");
    expect(drhCommunityStatus(selling)).toBe("Now Selling");
    expect((await read("D.R. Horton", "https://www.drhorton.com/texas/new-braunfels/new-braunfels/mcqueeney-oaks", { "mcqueeney-oaks": selling })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });

  it("David Weekley: a neighborhood whose every series says Coming Soon with no home or plan", async () => {
    const pages = { viana: fixture("weekley-viana"), "viana-elite-estate-series": fixture("weekley-viana-elite-estate-series"), "viana-signature-reserve-series": fixture("weekley-viana-signature-reserve-series") };
    expect((await read("David Weekley Homes", "https://www.davidweekleyhomes.com/neighborhoods/tx/san-antonio/viana", pages)).holdReasons).toEqual(["community_coming_soon"]);
  });

  it("Chesmar: no floor plans and the facts list's price reads \"Coming soon\"", async () => {
    const purlsong = fixture("chesmar-purlsong");
    expect((await read("Chesmar", "https://www.chesmar.com/texas/central-texas-new-homes/new-braunfels/purlsong/", { purlsong })).holdReasons).toEqual(["community_coming_soon"]);
    const priced = purlsong.replace(/(<b>\s*Starting From\s*<\/b>\s*:\s*)Coming soon/i, "$1$399,990");
    expect((await read("Chesmar", "https://www.chesmar.com/texas/central-texas-new-homes/new-braunfels/purlsong/", { purlsong: priced })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });

  it("Lennar: a masterplan with no selling collection whose price reads \"Coming soon\"", async () => {
    expect((await read("Lennar", "https://www.lennar.com/new-homes/texas/san-antonio/saint-hedwig/spring-grove", { "spring-grove": fixture("lennar-spring-grove") })).holdReasons).toEqual(["community_coming_soon"]);
  });

  it("Beazer: a VIP-list community with nothing for sale", async () => {
    expect((await read("Beazer Homes", "https://www.beazer.com/san-antonio-TX/san-antonio/sunday-creek-at-kinder-ranch", { "sunday-creek-at-kinder-ranch": fixture("beazer-sunday-creek-at-kinder-ranch") })).holdReasons).toEqual(["community_coming_soon"]);
  });
});
