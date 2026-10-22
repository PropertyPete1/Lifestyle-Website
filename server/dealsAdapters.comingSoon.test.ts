import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadOfficialDeals, type CommunitySourceConfig, type HtmlFetcher } from "./dealsAdapters";
import { drhCommunityStatus } from "./dealsAdapters.drhorton";
import { resetDreesCaches } from "./dealsAdapters.drees";
import { highlandComingSoonHeading } from "./dealsAdapters.highland";
import { sitterleComingSoon } from "./dealsAdapters.sitterle";

/**
 * Communities the builders' own pages call coming soon, captured on October 22,
 * 2026 (styles, inline SVG, comments and image source sets removed, then
 * gzipped; scripts and markup as served). Each nothing-for-sale page reads as
 * community_coming_soon, which lists the community in the Coming Soon section,
 * instead of expected_community_container_not_found, which flagged a broken page.
 */
const fixture = (file: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-10-22/${/\.json$/.test(file) ? file : `${file}.html`}.gz`, import.meta.url))).toString("utf8");
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

  it("Lennar: a masterplan whose every collection's price also reads \"Coming Soon\" and that lists no home", async () => {
    const sunshine = fixture("lennar-sunshine-trails");
    const url = "https://www.lennar.com/new-homes/texas/san-antonio/atascosa/sunshine-trails";
    expect((await read("Lennar", url, { "sunshine-trails": sunshine })).holdReasons).toEqual(["community_coming_soon"]);
    // One collection with a real price is selling: not coming soon.
    const oneSelling = sunshine.replace(/("customPrice":)"Coming Soon"(,"priceRange":\[194999)/, '$1"$194,999 - $214,999"$2');
    expect(oneSelling).not.toBe(sunshine);
    expect((await read("Lennar", url, { "sunshine-trails": oneSelling })).holdReasons).not.toContain("community_coming_soon");
  });

  it("Highland: no home on the page and the overview heading announces the next phase", async () => {
    const vida = fixture("highland-vida");
    expect(highlandComingSoonHeading(vida)).toBe("New Phase Coming Spring 2027");
    expect((await read("Highland Homes", "https://www.highlandhomes.com/san-antonio/san-antonio/vida", { vida })).holdReasons).toEqual(["community_coming_soon"]);
    const other = vida.replace("New Phase Coming Spring 2027", "Now Selling");
    expect(highlandComingSoonHeading(other)).toBeNull();
    expect((await read("Highland Homes", "https://www.highlandhomes.com/san-antonio/san-antonio/vida", { vida: other })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });

  it("Sitterle: an empty listing block under an introduction that opens \"Coming soon\"", async () => {
    const oak = fixture("sitterle-oak-bend-estates");
    expect(sitterleComingSoon(oak)).toBe(true);
    expect((await read("Sitterle Homes", "https://www.sitterlehomes.com/communities/oak-bend-estates/", { "oak-bend-estates": oak })).holdReasons).toEqual(["community_coming_soon"]);
    const reworded = oak.replace(/Coming soon to Fair Oaks Ranch/g, "Welcome to Fair Oaks Ranch");
    expect(sitterleComingSoon(reworded)).toBe(false);
    expect((await read("Sitterle Homes", "https://www.sitterlehomes.com/communities/oak-bend-estates/", { "oak-bend-estates": reworded })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });

  it("Drees: the market list's own row says \"Coming Soon!\" with no plan and no home", async () => {
    const pages = { "shavano-summit2": fixture("drees-shavano-summit"), areas: fixture("drees-areas.json"), community: fixture("drees-community.json"), qmi: fixture("drees-shavano-summit-qmi.json"), plan: fixture("drees-shavano-summit-plan.json") };
    const url = "https://www.dreeshomes.com/new-homes-san-antonio/san-antonio/shavano-highlands/shavano-summit2/";
    resetDreesCaches();
    expect((await read("Drees Custom Homes", url, pages)).holdReasons).toEqual(["community_coming_soon"]);
    // A row with a plan is selling something: the missing address is a changed page again.
    resetDreesCaches();
    const withPlan = { ...pages, community: pages.community.replace(/("caption":"Coming Soon!"[^{}]*?"planCount":)0/, "$11") };
    expect(withPlan.community).not.toBe(pages.community);
    expect((await read("Drees Custom Homes", url, withPlan)).holdReasons).toEqual(["expected_community_container_not_found"]);
    resetDreesCaches();
  });

  it("Beazer: a VIP-list community with nothing for sale", async () => {
    expect((await read("Beazer Homes", "https://www.beazer.com/san-antonio-TX/san-antonio/sunday-creek-at-kinder-ranch", { "sunday-creek-at-kinder-ranch": fixture("beazer-sunday-creek-at-kinder-ranch") })).holdReasons).toEqual(["community_coming_soon"]);
  });
});

describe("Toll Brothers: a page listing every home under one quick move-in entry (October 22, 2026 capture)", () => {
  it("reads Sunset Ridge's 12 homes when the page's own heading counts 12, though the site plan counts 13", async () => {
    const page = fixture("toll-sunset-ridge");
    const url = "https://www.tollbrothers.com/luxury-homes-for-sale/Texas/Toll-Brothers-at-Sunset-Ridge";
    const result = await read("Toll Brothers", url, { "toll-brothers-at-sunset-ridge": page });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toHaveLength(12);
    // A heading that counts more homes than the data lists is a short read: held as before.
    const short = page.replace(/>12 Quick Move-In Homes(<!-- -->)? Available</, ">13 Quick Move-In Homes$1 Available<");
    expect(short).not.toBe(page);
    expect((await read("Toll Brothers", url, { "toll-brothers-at-sunset-ridge": short })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });
});
