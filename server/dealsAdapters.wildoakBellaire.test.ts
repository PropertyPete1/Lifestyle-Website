import { normalizedDealSourceKey } from "../shared/deals";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { DEAL_ADAPTERS, OFFICIAL_BUILDER_HOSTS, loadOfficialDeals, type CommunitySourceConfig, type HtmlFetcher } from "./dealsAdapters";
import { WILDOAK_MAX_HOMES, parseWildOakCommunity, wildOakListingEntries, wildOakPhotoUrl, wildOakRecord, wildOakStatus } from "./dealsAdapters.wildoak";
import { bellaireListingEntries, bellaireRecord, bellaireStatus, parseBellaireGallery, parseBellaireHomes } from "./dealsAdapters.bellaire";

/**
 * Nov 5, 2026 (Peter: Heritage Woods, Medina Trails and Annabelle Ranch were missing from the site). Two new readers,
 * each pinned to the builder's real pages as fetched that day (fixtures/deals/live-2026-11-05).
 */
const NOW = new Date("2026-11-05T18:00:00Z");
const fixture = (file: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-11-05/${file}.html.gz`, import.meta.url))).toString("utf8");
const siteFetcher = (site: Record<string, string>) => {
  const requested: string[] = [];
  const fetcher = vi.fn(async (input: string) => {
    requested.push(input);
    const body = site[input];
    return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  });
  return { fetcher: fetcher as unknown as HtmlFetcher, requested };
};

describe("Wild Oak Homes reader", () => {
  const HW = "https://wildoakhomes.com/heritage-woods/";

  it("is registered with its official host", () => {
    expect(OFFICIAL_BUILDER_HOSTS["Wild Oak Homes"]).toBe("wildoakhomes.com");
    expect(DEAL_ADAPTERS["Wild Oak Homes"].builder).toBe("Wild Oak Homes");
  });

  it("reads the badge as the status", () => {
    expect(wildOakStatus("Quick Move-In")).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, kind: "home" });
    expect(wildOakStatus("Under Construction")).toEqual({ status: "Quick Move-In", readyNow: false, kind: "home" });
    expect(wildOakStatus("Coming Soon").status).toBe("Quick Move-In");
    expect(wildOakStatus("New Home").status).toBe("Quick Move-In");
    expect(wildOakStatus("Under Contract").status).toBe("Sold");
    expect(wildOakStatus("Model Home").kind).toBe("model");
    expect(wildOakStatus("Floor Plan").kind).toBe("plan");
    expect(wildOakStatus("Something New")).toEqual({ status: null, readyNow: false, kind: "home" });
  });

  it("maps the image CDN copy of a photo back to the official host, without the size query", () => {
    expect(wildOakPhotoUrl("https://i0.wp.com/wildoakhomes.com/wp-content/uploads/2026/04/Lavaca.png?fit=1024%2C683&ssl=1")?.toString()).toBe("https://wildoakhomes.com/wp-content/uploads/2026/04/Lavaca.png");
    expect(wildOakPhotoUrl("https://wildoakhomes.com/wp-content/uploads/2026/04/Lavaca.png?w=300")?.toString()).toBe("https://wildoakhomes.com/wp-content/uploads/2026/04/Lavaca.png");
    expect(wildOakPhotoUrl("https://i0.wp.com/other.com/wp-content/uploads/x.png")).toBeNull();
    expect(wildOakPhotoUrl("https://cdn.example/x.png")).toBeNull();
  });

  it("reads Heritage Woods: the sales office, eight home cards (the model skipped), eleven plans with from-prices and photos on the official host", () => {
    const html = fixture("wildoak-heritage-woods");
    expect(wildOakRecord(html)).toEqual({ name: "Heritage Woods", street: "113 Syrah Street", city: "La Vernia", zip: "78121", phone: null, priceFrom: 554_000, geo: null });
    const parsed = parseWildOakCommunity(html, HW)!;
    expect(parsed.cardCount).toBe(8);
    expect(parsed.foreignHome).toBe(false);
    expect(parsed.homes).toHaveLength(8);
    expect(parsed.homes.every((home) => home.status !== null)).toBe(true);
    const ready = parsed.homes.find((home) => home.readyNow)!;
    expect([ready.privateAddress, ready.privatePlanName, ready.status, ready.price, ready.bedrooms, ready.bathrooms, ready.squareFeet, ready.homesite, ready.gallery?.length, ready.sourceUrl])
      .toEqual(["105 Tempranillo Terrace, La Vernia, TX 78121", "Lavaca", "Quick Move-In (Move-In Ready)", 489_900, 4, 2.5, 1_880, "Lot 64 · 1.10 acres", 21, "https://wildoakhomes.com/property/lavacaheritagewoods/"]);
    expect(ready.gallery![0]!.sourceUrl).toBe("https://wildoakhomes.com/wp-content/uploads/2026/04/Lavaca.png");
    const elm = parsed.homes.find((home) => home.privatePlanName === "Elm")!;
    expect([elm.status, elm.price, elm.readyNow]).toEqual(["Quick Move-In", 554_000, false]);
    const sold = parsed.homes.find((home) => home.privatePlanName === "Trinity")!;
    expect(sold.status).toBe("Sold");
    expect(parsed.homes.filter((home) => home.price === null && home.status === "Quick Move-In")).toHaveLength(5);
    expect(parsed.homes.some((home) => /sales center|model/i.test(home.privateAddress ?? ""))).toBe(false);
    expect(parsed.plans.map((plan) => [plan.privatePlanName, plan.price])).toEqual([["Lavaca", 532_645], ["Blackjack", 521_450], ["Elm", 554_000], ["Trinity", 578_700], ["Sabine", 566_423], ["Angelina", 597_343], ["Brazos", 631_273], ["Leona", 664_146], ["Medina", 675_104], ["Comal", 694_563], ["San Jacinto", 787_241]]);
    expect(parsed.plans[0]!.gallery![0]!.caption).toBe("Representative image");
    // Nov 6: the same plan links from every community with only ?community= differing, which the source key drops, so
    // Heritage Woods' and Medina Trails' copies of a plan kept overwriting each other (the other's sweep then "sold" them).
    expect(parsed.plans[0]!.sourceUrl).toBe("https://wildoakhomes.com/property/lavaca/community/heritage-woods/");
    expect(normalizedDealSourceKey(parsed.plans[0]!.sourceUrl)).not.toBe(normalizedDealSourceKey("https://wildoakhomes.com/property/lavaca/?community=medina-trails"));
    for (const item of [...parsed.homes, ...parsed.plans]) for (const image of item.gallery ?? []) expect(image.sourceUrl.startsWith("https://wildoakhomes.com/wp-content/uploads/")).toBe(true);
  });

  it("reads Medina Trails, whose sales address sits in the FAQ", () => {
    const html = fixture("wildoak-medina-trails");
    expect(wildOakRecord(html)).toMatchObject({ name: "Medina Trails", street: "729 CR 664", city: "Devine", zip: "78016" });
    const parsed = parseWildOakCommunity(html, "https://wildoakhomes.com/medina-trails/")!;
    expect(parsed.homes).toHaveLength(3);
    expect(parsed.plans).toHaveLength(11);
    expect(parsed.homes.every((home) => home.privateAddress?.endsWith(", Devine, TX 78016"))).toBe(true);
    // "New Home" cards on lots with no street yet: the lot names the home, the plan page is its link, and it is for sale.
    expect(parsed.homes.map((home) => [home.status, home.privateName, home.privateAddress, home.sourceUrl])).toEqual([
      ["Quick Move-In", "Elm – Lot 5", "Lot 5, Devine, TX 78016", "https://wildoakhomes.com/property/elm-mt/"],
      ["Quick Move-In", "Angelina – Lot 4", "Lot 4, Devine, TX 78016", "https://wildoakhomes.com/property/angelina-mt/"],
      ["Quick Move-In", "Sabine – Lot 1", "Lot 1, Devine, TX 78016", "https://wildoakhomes.com/property/sabine-mt/"],
    ]);
  });

  it("holds a page whose cards are missing or carry an unknown badge", () => {
    expect(parseWildOakCommunity("<html><body><h1>Heritage Woods</h1></body></html>", HW)).toBeNull();
    const unknown = fixture("wildoak-heritage-woods").replace('class="wo-hc-badge qmi">Quick Move-In', 'class="wo-hc-badge qmi">Reserved');
    expect(parseWildOakCommunity(unknown, HW)!.homes.some((home) => home.status === null)).toBe(true);
  });

  it("lists the seven communities from the site menu", () => {
    expect(wildOakListingEntries(fixture("wildoak-our-communities"), "wildoakhomes.com")?.map((entry) => `${entry.record.name} ${entry.url}`)).toEqual([
      "Copper Ridge https://wildoakhomes.com/copper-ridge/", "Heritage Woods https://wildoakhomes.com/heritage-woods/", "La Ventana https://wildoakhomes.com/la-ventana/", "Maroon Meadows https://wildoakhomes.com/maroon-meadows/",
      "Medina Trails https://wildoakhomes.com/medina-trails/", "Mesquite Meadows https://wildoakhomes.com/mesquite-meadows/", "Vintage Oaks https://wildoakhomes.com/vintage-oaks/",
    ]);
  });

  it("loads the community through the reader with the private names scrubbed from the public snapshot", async () => {
    const { fetcher, requested } = siteFetcher({ [HW]: fixture("wildoak-heritage-woods") });
    const config: CommunitySourceConfig = { builder: "Wild Oak Homes", sourceUrl: HW, privateCommunityName: "Heritage Woods", scrubList: ["Heritage Woods", "Tempranillo", "Syrah", "Pinot", "La Vernia"] };
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(requested).toEqual([HW]);
    expect(result.private.homes).toHaveLength(8);
    expect(result.private.plans).toHaveLength(11);
    expect(result.private.communityFacts?.fromPrice).toBe(554_000);
    const text = JSON.stringify(result.public);
    expect(text).not.toMatch(/Heritage Woods|Tempranillo|Syrah|wildoak/i);
    expect(result.public.homes.length).toBeGreaterThan(0);
    expect(WILDOAK_MAX_HOMES).toBe(150);
  });

  it("holds the wrong host and a fetch failure", async () => {
    const { fetcher } = siteFetcher({});
    const bad = await loadOfficialDeals({ builder: "Wild Oak Homes", sourceUrl: "https://www.wildoakhomes.com/heritage-woods/", privateCommunityName: "x", scrubList: [] }, { fetcher, now: () => NOW });
    expect(bad.holdReasons).toEqual(["unsupported_official_host"]);
    const missing = await loadOfficialDeals({ builder: "Wild Oak Homes", sourceUrl: HW, privateCommunityName: "x", scrubList: [] }, { fetcher, now: () => NOW });
    expect(missing.catalogOk).toBe(false);
  });
});

describe("Bellaire Homes reader", () => {
  const AR = "https://bellairehomes.net/texas/neighborhoods/annabelle-ranch/";
  const AR_HOMES = `${AR}move-in-ready-homes/`;
  const PK = "https://bellairehomes.net/texas/neighborhoods/the-parklands/";
  const PK_HOMES = `${PK}move-in-ready-homes/`;
  const PK_HOME = "https://bellairehomes.net/texas/5128-island-park/";

  it("is registered with its official host", () => {
    expect(OFFICIAL_BUILDER_HOSTS["Bellaire Homes"]).toBe("bellairehomes.net");
    expect(DEAL_ADAPTERS["Bellaire Homes"].builder).toBe("Bellaire Homes");
  });

  it("reads the move-in cell as the status, a bare month in this year or the next", () => {
    expect(bellaireStatus("NOW", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(bellaireStatus("November", NOW)).toEqual({ status: "Quick Move-In (November 2026)", readyNow: false, moveInDate: "November 2026" });
    expect(bellaireStatus("December", NOW).moveInDate).toBe("December 2026");
    expect(bellaireStatus("February", NOW).moveInDate).toBe("February 2027");
    expect(bellaireStatus("March 2027", NOW).moveInDate).toBe("March 2027");
    expect(bellaireStatus("SOLD", NOW).status).toBe("Sold");
    expect(bellaireStatus("TBD", NOW).status).toBeNull();
  });

  it("reads the neighborhood's name, city, sales address and pin from the page and its map embed", () => {
    expect(bellaireRecord(fixture("bellaire-annabelle-ranch"))).toEqual({ name: "Annabelle Ranch", street: "5011 Tupelo Row", city: "San Antonio", zip: "78263", phone: null, priceFrom: null, geo: { lat: 29.37556367516407, lng: -98.3141931880858 } });
    expect(bellaireRecord(fixture("bellaire-the-parklands"))).toMatchObject({ name: "The Parklands", street: "5128 Island Pk", city: "Schertz", zip: "78108" });
    expect(bellaireRecord("<html><body><p>nothing</p></body></html>")).toBeNull();
  });

  it("reads the move-in-ready table: address, plan, stories/beds/baths/garage, sq ft, was/now prices, move-in and the photo page", () => {
    expect(parseBellaireHomes(fixture("bellaire-annabelle-ranch-homes"), AR_HOMES)).toEqual([
      { address: "5707 Lehi", plan: "Leander", stories: 1, beds: 4, baths: 3, garage: 3, sqft: 2_725, was: 549_845, now: 531_645, moveIn: "November", photoPage: null },
      { address: "5703 Lehi", plan: "Gibbon", stories: 1, beds: 4, baths: 3.5, garage: 3, sqft: 3_064, was: 563_696, now: 553_696, moveIn: "November", photoPage: null },
      { address: "5705 Provo Place", plan: "Misson", stories: 1, beds: 4, baths: 3, garage: 2, sqft: 2_284, was: 538_872, now: 511_241, moveIn: "November", photoPage: null },
      { address: "9019 Weber Way", plan: "Gibbon", stories: 1, beds: 4, baths: 3.5, garage: 2, sqft: 3_064, was: 573_320, now: 562_826, moveIn: "November", photoPage: null },
    ]);
    const parklands = parseBellaireHomes(fixture("bellaire-the-parklands-homes"), PK_HOMES)!;
    expect(parklands.map((row) => [row.address, row.now, row.moveIn, row.photoPage])).toEqual([
      ["4197 Garden Path", 459_990, "SOLD", "https://bellairehomes.net/texas/4197-garden-path/"],
      ["5108 Island Park", 471_329, "December", null],
      ["5308 Park Overlook", 468_740, "December", null],
      ["5128 Island Park", 544_195, "NOW", PK_HOME],
    ]);
    expect(parseBellaireHomes("<html><body><table class=\"other\"></table></body></html>", AR_HOMES)).toBeNull();
  });

  it("reads a home page's gallery (full-size uploads only, no site logo or banner)", () => {
    const gallery = parseBellaireGallery(fixture("bellaire-home-5128-island-park"));
    expect(gallery).toHaveLength(15);
    expect(gallery[0]!.sourceUrl).toBe("https://bellairehomes.net/texas/wp-content/uploads/2026/10/6ae0f2f8e183a518cddb58da.jpeg");
    expect(gallery.every((image) => /\/texas\/wp-content\/uploads\/2026\/10\/[a-f0-9]+\.jpeg$/.test(image.sourceUrl))).toBe(true);
  });

  it("lists the six neighborhoods from the index", () => {
    expect(bellaireListingEntries(fixture("bellaire-neighborhoods"), "bellairehomes.net")?.map((entry) => entry.url).sort()).toEqual([
      "https://bellairehomes.net/texas/neighborhoods/annabelle-ranch/", "https://bellairehomes.net/texas/neighborhoods/buffalo-crossing/", "https://bellairehomes.net/texas/neighborhoods/confluence/",
      "https://bellairehomes.net/texas/neighborhoods/country-village-estates/", "https://bellairehomes.net/texas/neighborhoods/morgan-meadows/", "https://bellairehomes.net/texas/neighborhoods/the-parklands/",
    ]);
  });

  it("loads The Parklands: the page, its homes table and the one photo page (not the sold home's), prices with their drops, scrubbed public snapshot", async () => {
    const { fetcher, requested } = siteFetcher({ [PK]: fixture("bellaire-the-parklands"), [PK_HOMES]: fixture("bellaire-the-parklands-homes"), [PK_HOME]: fixture("bellaire-home-5128-island-park") });
    const config: CommunitySourceConfig = { builder: "Bellaire Homes", sourceUrl: PK, privateCommunityName: "The Parklands", scrubList: ["The Parklands", "Island Park", "Garden Path", "Park Overlook", "Schertz"] };
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(requested).toEqual([PK, PK_HOMES, PK_HOME]);
    expect(result.private.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.previousPrice, home.priceDrop, home.stories, home.bedrooms, home.bathrooms, home.garage, home.squareFeet, home.readyNow, home.gallery?.length])).toEqual([
      ["4197 Garden Path, Schertz, TX 78108", "Yosemite", "Sold", 459_990, 505_838, 45_848, 1, 3, 3, 3, 2_244, false, 0],
      ["5108 Island Park, Schertz, TX 78108", "Olympic", "Quick Move-In (December 2026)", 471_329, null, null, 1, 4, 3, 3, 2_501, false, 0],
      ["5308 Park Overlook, Schertz, TX 78108", "Rainier", "Quick Move-In (December 2026)", 468_740, null, null, 1, 3, 3, 3, 2_394, false, 0],
      ["5128 Island Park, Schertz, TX 78108", "Rainier", "Quick Move-In (Move-In Ready)", 544_195, null, null, 1, 3, 3, 3, 2_394, true, 15],
    ]);
    expect(result.private.communityFacts?.fromPrice).toBe(459_990);
    // Homes without a photo page keep distinct source keys (a hash would collapse them into one).
    expect(new Set(result.private.homes.map((home) => home.sourceUrl.replace(/#.*$/, ""))).size).toBe(4);
    expect(result.private.homes[1]!.sourceUrl).toBe(`${PK_HOMES}5108-island-park/`);
    expect(JSON.stringify(result.public)).not.toMatch(/Parklands|Island Park|Schertz|bellaire/i);
  });

  it("holds when the homes table is missing", async () => {
    const { fetcher } = siteFetcher({ [AR]: fixture("bellaire-annabelle-ranch"), [AR_HOMES]: "<html><body><p>Coming soon</p></body></html>" });
    const result = await loadOfficialDeals({ builder: "Bellaire Homes", sourceUrl: AR, privateCommunityName: "Annabelle Ranch", scrubList: [] }, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(false);
    expect(result.holdReasons).toEqual(["expected_community_container_not_found"]);
  });
});
