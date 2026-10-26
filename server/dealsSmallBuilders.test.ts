import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEAL_ADAPTERS } from "./dealsAdapters";
import { DISCOVERY_READERS, discoverBuilderCommunities } from "./dealsDiscovery";
import { pacesetterSitemapEntries, pacesetterStatus, parsePacesetterCommunity } from "./dealsAdapters.pacesetter";
import { parseSaratogaCommunity, parseSaratogaPlanHomes, saratogaListingEntries } from "./dealsAdapters.saratoga";
import { josephCreekListingEntries, parseJosephCreekCommunity, parseJosephCreekHomes } from "./dealsAdapters.josephcreek";

/**
 * Three small builders New Home Buddy lists that we did not (October 26, 2026, Peter: "make sure we have them all"):
 * Pacesetter (Austin), Saratoga (Austin) and Joseph Creek (San Antonio). The fixtures are trimmed excerpts of each
 * builder's live pages that day, with the markup as served.
 */
vi.mock("./db", () => ({ getDb: async () => null }));

const fixture = (name: string) => readFileSync(new URL(`./fixtures/deals/${name}`, import.meta.url), "utf8");
const NOW = new Date(Date.UTC(2026, 9, 26, 12));
const reader = (builder: string) => DISCOVERY_READERS.find((entry) => entry.builder === builder)!;
const fetcherFor = (pages: Record<string, string>) => {
  const fetched: string[] = [];
  const fetcher = (async (input: string) => {
    fetched.push(input);
    const body = pages[input.replace(/\/+$/, "")] ?? pages[`${input.replace(/\/+$/, "")}/`];
    return new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": input.endsWith(".xml") ? "application/xml" : "text/html" } });
  }) as unknown as typeof fetch;
  return { fetcher, fetched };
};
const config = (builder: "Pacesetter Homes" | "Saratoga Homes" | "Joseph Creek Homes", sourceUrl: string, privateCommunityName: string) => ({ builder, sourceUrl, privateCommunityName, scrubList: [privateCommunityName] });

describe("Pacesetter Homes", () => {
  const P = "https://pacesetterhomestexas.com";
  const COMMUNITY = fixture("pacesetter-community.html");
  const URL_ = `${P}/new-homes-for-sale-austin/kyle-tx/crosswinds/`;

  it("reads the live community page: the office, the pin from a home card, the homes with their facts and the plans", () => {
    const page = parsePacesetterCommunity(COMMUNITY, URL_, NOW)!;
    expect(page.record).toEqual({ name: "Crosswinds", street: "283 Tailwind Drive", city: "Kyle", zip: "78640", phone: null, priceFrom: 297_900, geo: { lat: 30.0199751, lng: -97.8154556 } });
    expect(page.homes).toHaveLength(2);
    expect(page.homes[0]).toMatchObject({ sourceUrl: `${P}/new-homes-for-sale-austin/kyle-tx/crosswinds/quick-move-in-home/238-bay-breeze-drive/`, privateName: "238 Bay Breeze Drive", privateAddress: "238 Bay Breeze Drive, Kyle, TX 78640", price: 297_900, bedrooms: 3, bathrooms: 2, squareFeet: 1_487, garage: 2, stories: 1, status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(page.homes[0]!.gallery).toHaveLength(1);
    expect(page.homes[1]).toMatchObject({ status: "Quick Move-In (December 2026)", moveInDate: "December 2026", readyNow: false, stories: 2 });
    expect(page.plans).toHaveLength(2);
    expect(page.plans[0]).toMatchObject({ privatePlanName: "Austin", price: 329_900, bedrooms: 3, bathrooms: 2, squareFeet: 1_487, garage: 2, sourceUrl: `${P}/new-homes-for-sale-austin/kyle-tx/crosswinds/floor-plan-ready-to-build/austin-2/` });
    expect(pacesetterStatus("Sold", NOW).status).toBe("Sold");
    expect(pacesetterStatus("Available March 2026", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(pacesetterStatus("Call for details", NOW).status).toBeNull();
  });

  it("lists the Austin market's community pages from the community sitemap and leaves Dallas out", () => {
    const entries = pacesetterSitemapEntries(fixture("pacesetter-community-sitemap.xml"), "pacesetterhomestexas.com")!;
    expect(entries.map((entry) => entry.url)).toEqual([`${P}/new-homes-for-sale-austin/san-marcos-tx/trace-2/`, `${P}/new-homes-for-sale-austin/kyle-tx/crosswinds/`, `${P}/new-homes-for-sale-austin/manor-tx/whisper-valley/`]);
  });

  it("discovers Crosswinds placed at its home's pin, and the catalog reader lists its homes and plans with the names scrubbed", async () => {
    const { fetcher, fetched } = fetcherFor({ [`${P}/community-sitemap.xml`]: fixture("pacesetter-community-sitemap.xml"), [URL_]: COMMUNITY });
    const found = await discoverBuilderCommunities(reader("Pacesetter Homes"), fetcher);
    expect(found.ok).toBe(true);
    expect(found.communities).toEqual([{ builder: "Pacesetter Homes", name: "Crosswinds", sourceUrl: URL_, city: "Kyle", zip: "78640", address: "283 Tailwind Drive, Kyle, TX 78640", salesPhone: null, status: "selling", priceFrom: 297_900 }]);
    expect(found.skipped.map((entry) => entry.reason)).toEqual(["page_unreadable", "page_unreadable"]);
    expect(fetched.filter((url) => /quick-move-in-home|floor-plan/.test(url))).toHaveLength(0);
    const result = await DEAL_ADAPTERS["Pacesetter Homes"].load(config("Pacesetter Homes", URL_, "Crosswinds"), { fetcher: fetcherFor({ [URL_]: COMMUNITY }).fetcher, now: () => NOW });
    expect(result.ok).toBe(true);
    expect(result.private.homes.map((home) => home.price)).toEqual([297_900, 379_900]);
    expect(result.private.plans.map((plan) => plan.privatePlanName)).toEqual(["Austin", "Beaumont"]);
    const json = JSON.stringify(result.public);
    for (const secret of ["Crosswinds", "Pacesetter", "Bay Breeze", "Tailwind"]) expect(json).not.toContain(secret);
  });
});

describe("Saratoga Homes", () => {
  const S = "https://www.saratogahomestexas.com";
  const COMMUNITY = fixture("saratoga-community.html");
  const PLAN = fixture("saratoga-plan.html");
  // The plan page lists every community's homes: the second card re-homed to another community must be left out.
  const PLAN_MIXED = PLAN.replace(/data-community="Enclave at Cele"/, 'data-community="Enclave at Cele"').replace(/(data-save-home="19124-ariel-elena-way"[^>]*data-community=")Enclave at Cele/, "$1Butler Farms");
  const URL_ = `${S}/community/enclave-at-cele/`;

  it("reads the live community page: the name and pin from the map script, the city from the title, and the plans", () => {
    const page = parseSaratogaCommunity(COMMUNITY, URL_)!;
    expect(page.record).toEqual({ name: "Enclave at Cele", street: null, city: "Pflugerville", zip: null, phone: null, priceFrom: 447_950, geo: { lat: 30.4482465, lng: -97.5398209 } });
    expect(page.plans).toHaveLength(2);
    expect(page.plans[0]).toMatchObject({ privatePlanName: "Bennington 2434 S 3CG", price: 538_950, bedrooms: 4, bathrooms: 3.5, squareFeet: 2_453, garage: 3, sourceUrl: `${S}/floor-plan/bennington-2434-s-3cg/` });
    // "From the $500s" is the band's low end.
    expect(page.plans[1]).toMatchObject({ privatePlanName: "Lennox 2575 S 3CG", price: 500_000, bedrooms: 5 });
  });

  it("reads the model home from the hero's details block and a 'Now Selling in' title (Oct 26: SilverLeaf had read as 'Austin, TX' with no pin)", () => {
    const silverleaf = COMMUNITY
      .replace("<title>New Homes in Pflugerville, TX | Enclave at Cele - Saratoga</title>", "<title>New Homes Now Selling in Cedar Creek, TX | SilverLeaf - Saratoga</title>")
      .replace('<div class="hero"><p>From $447,950</p></div>', '<section class="community_hero"><div class="hero__content"><h1>SilverLeaf</h1><h2 class="uppercase">Now Selling</h2><h3>From $379,950</h3><div class="community__details">\n<p>\n  119 Stetson Court<br>\n  Cedar Creek, TX 78612            </p>\n<p>\n  Model Hours:<br>\n  Mon – Sat: 9am - 7pm    Sun: 12pm - 6pm            </p>\n</div></div></section>')
      .replace('window.community = "Enclave at Cele"', 'window.community = "SilverLeaf"');
    expect(parseSaratogaCommunity(silverleaf, `${S}/community/silverleaf/`)!.record).toMatchObject({ name: "SilverLeaf", street: "119 Stetson Court", city: "Cedar Creek", zip: "78612", priceFrom: 379_950 });
    // Without a details block the city still comes from the title.
    const titled = COMMUNITY.replace("<title>New Homes in Pflugerville, TX | Enclave at Cele - Saratoga</title>", "<title>New Homes Now Selling in Pflugerville, TX | Enclave at Cele - Saratoga</title>");
    expect(parseSaratogaCommunity(titled, URL_)!.record).toMatchObject({ street: null, city: "Pflugerville", zip: null });
  });

  it("keeps only this community's homes from a plan page, with the struck 'was' price as the previous price", () => {
    const homes = parseSaratogaPlanHomes(PLAN_MIXED, `${S}/floor-plan/bennington-2434-s-3cg/`, "Enclave at Cele", "Bennington 2434 S 3CG");
    expect(homes).toHaveLength(1);
    expect(homes[0]).toMatchObject({ sourceUrl: `${S}/new-homes/19136-kleingrass-lane`, privateName: "19136 Kleingrass Lane", privateAddress: "19136 Kleingrass Lane, Pflugerville, TX", price: 538_950, previousPrice: 558_950, bedrooms: 4, bathrooms: 3.5, squareFeet: 2_453, garage: 3, status: "Quick Move-In (Move-In Ready)", readyNow: true });
    expect(homes[0]!.gallery).toHaveLength(1);
    expect(parseSaratogaPlanHomes(PLAN, `${S}/floor-plan/bennington-2434-s-3cg/`, "Enclave at Cele", null)).toHaveLength(2);
  });

  it("lists the Austin region's communities with city and starting price, never Houston's; discovery places each by its page's pin", async () => {
    const entries = saratogaListingEntries(fixture("saratoga-communities.html"), "www.saratogahomestexas.com")!;
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => /enclave-at-cele/.test(entry.url))!.record).toEqual({ name: "Enclave at Cele", street: null, city: "Austin", zip: null, phone: null, priceFrom: 447_950, geo: null });
    const { fetcher } = fetcherFor({ [`${S}/communities/`]: fixture("saratoga-communities.html"), [URL_]: COMMUNITY });
    const found = await discoverBuilderCommunities(reader("Saratoga Homes"), fetcher);
    expect(found.ok).toBe(true);
    expect(found.communities).toEqual([{ builder: "Saratoga Homes", name: "Enclave at Cele", sourceUrl: URL_, city: "Pflugerville", zip: null, address: "Pflugerville, TX", salesPhone: null, status: "selling", priceFrom: 447_950 }]);
  });

  it("the catalog reader reads the community then each plan page, keeping this community's homes", async () => {
    const { fetcher, fetched } = fetcherFor({ [URL_]: COMMUNITY, [`${S}/floor-plan/bennington-2434-s-3cg/`]: PLAN_MIXED, [`${S}/floor-plan/lennox-2575-s-3cg/`]: "<html><body></body></html>" });
    const result = await DEAL_ADAPTERS["Saratoga Homes"].load(config("Saratoga Homes", URL_, "Enclave at Cele"), { fetcher, now: () => NOW });
    expect(result.ok).toBe(true);
    expect(fetched).toHaveLength(3);
    expect(result.private.homes.map((home) => home.privateName)).toEqual(["19136 Kleingrass Lane"]);
    expect(result.private.plans).toHaveLength(2);
    const json = JSON.stringify(result.public);
    for (const secret of ["Enclave at Cele", "Saratoga", "Kleingrass"]) expect(json).not.toContain(secret);
  });
});

describe("Joseph Creek Homes", () => {
  const J = "https://www.josephcreekhomes.com";
  const COMMUNITY = fixture("josephcreek-community.html");
  const AVAILABLE = fixture("josephcreek-available.html");
  const URL_ = `${J}/communities/rhine-valley`;

  it("reads the live community page: name, model home office, pin from the map embed, phone and plans", () => {
    const page = parseJosephCreekCommunity(COMMUNITY, URL_)!;
    expect(page.record).toEqual({ name: "Rhine Valley", street: "10106 Mulhouse Dr", city: "Schertz", zip: "78154", phone: "2109392575", priceFrom: 359_999, geo: { lat: 29.529378797569837, lng: -98.24013955386698 } });
    expect(page.plans).toHaveLength(2);
    expect(page.plans[0]).toMatchObject({ privatePlanName: "The Maverick", price: 359_999, bedrooms: 3, bathrooms: 2, squareFeet: 1_700, stories: 1, sourceUrl: `${J}/floorplans/the-maverick-at-rhine-valley` });
  });

  it("reads the office two divs under its label and the site's 'Tx.,' spellings, and takes the community's own place from the map embed over a shared office (Oct 26: Pradera Ridge and Country Village Estates had no address)", () => {
    // Pradera Ridge, as served: the address one div deeper, "Floresville Tx., 78114", a coordinates-only embed (no "!2s" address).
    const pradera = COMMUNITY
      .replace('<h1 class="h1-welcome">Rhine Valley</h1>', '<h1 class="h1-welcome">Pradera Ridge</h1>')
      .replace('<div class="text-block-24">10106 Mulhouse Dr, Schertz, TX 78154</div>', '<div class="text-block-24"><div>108 Pradera Ridge Drive, Floresville Tx., 78114</div></div>')
      .replace(/!2d-98\.24013955386698!3d29\.529378797569837/, "!2d-98.24246373340037!3d29.223516975347145")
      .replace(/!3m3!1m2!1s0x865cecb38c07caf7%3A0x5c92e5e889448d5!2s10106%20Mulhouse%20Dr%2C%20Schertz%2C%20TX%2078154/, "!3m2!1m1!2zMjnCsDEzJzI0LjciTiA5OMKwMTInMDQuNiJX");
    expect(parseJosephCreekCommunity(pradera, `${J}/communities/pradera-ridge`)!.record).toMatchObject({ name: "Pradera Ridge", street: "108 Pradera Ridge Drive", city: "Floresville", zip: "78114", geo: { lat: 29.223516975347145, lng: -98.24246373340037 } });
    // Country Village Estates: the office is Pradera Ridge's (Floresville, "Floresville, Tx. 78114"); the embed pins 161 Janice Ave, Castroville.
    const castroville = COMMUNITY
      .replace('<h1 class="h1-welcome">Rhine Valley</h1>', '<h1 class="h1-welcome">Country Village Estates</h1>')
      .replace('<div class="text-block-24">10106 Mulhouse Dr, Schertz, TX 78154</div>', '<div class="text-block-24"><div>108 Pradera Ridge Drive, Floresville, Tx. 78114</div></div>')
      .replace(/!2d-98\.24013955386698!3d29\.529378797569837/, "!2d-98.8649058246136!3d29.360095675275293")
      .replace(/!2s10106%20Mulhouse%20Dr%2C%20Schertz%2C%20TX%2078154/, "!2s161%20Janice%20Ave%2C%20Castroville%2C%20TX%2078009");
    expect(parseJosephCreekCommunity(castroville, `${J}/communities/country-village-estates`)!.record).toMatchObject({ name: "Country Village Estates", street: "161 Janice Ave", city: "Castroville", zip: "78009", geo: { lat: 29.360095675275293, lng: -98.8649058246136 } });
    // The original shape still reads as before.
    expect(parseJosephCreekCommunity(COMMUNITY, URL_)!.record).toMatchObject({ street: "10106 Mulhouse Dr", city: "Schertz", zip: "78154" });
  });

  it("keeps this community's homes from the site-wide page", () => {
    const homes = parseJosephCreekHomes(AVAILABLE, `${J}/available-homes`, "Rhine Valley", "Schertz, TX 78154");
    expect(homes).toHaveLength(2);
    expect(homes[0]).toMatchObject({ status: "Quick Move-In", bedrooms: expect.any(Number), price: expect.any(Number) });
    expect(homes[0]!.sourceUrl).toMatch(new RegExp(`^${J}/available-homes/[a-z0-9-]+$`));
    expect(homes[0]!.privateAddress).toMatch(/, Schertz, TX 78154$/);
    expect(parseJosephCreekHomes(AVAILABLE, `${J}/available-homes`, "Pradera Ridge", null)).toHaveLength(1);
  });

  it("discovers each community from the communities page and the catalog reader lists plans and homes with the names scrubbed", async () => {
    expect(josephCreekListingEntries(fixture("josephcreek-communities.html"), "www.josephcreekhomes.com")!.map((entry) => entry.url)).toHaveLength(6);
    const { fetcher } = fetcherFor({ [`${J}/our-communities`]: fixture("josephcreek-communities.html"), [URL_]: COMMUNITY, [`${J}/available-homes`]: AVAILABLE });
    const found = await discoverBuilderCommunities(reader("Joseph Creek Homes"), fetcher);
    expect(found.ok).toBe(true);
    expect(found.communities).toEqual([{ builder: "Joseph Creek Homes", name: "Rhine Valley", sourceUrl: URL_, city: "Schertz", zip: "78154", address: "10106 Mulhouse Dr, Schertz, TX 78154", salesPhone: "2109392575", status: "selling", priceFrom: 359_999 }]);
    const result = await DEAL_ADAPTERS["Joseph Creek Homes"].load(config("Joseph Creek Homes", URL_, "Rhine Valley"), { fetcher, now: () => NOW });
    expect(result.ok).toBe(true);
    expect(result.private.homes).toHaveLength(2);
    expect(result.private.plans).toHaveLength(2);
    const json = JSON.stringify(result.public);
    for (const secret of ["Rhine Valley", "Joseph Creek", "Mulhouse"]) expect(json).not.toContain(secret);
  });
});
