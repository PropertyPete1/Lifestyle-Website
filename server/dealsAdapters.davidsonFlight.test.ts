import { beforeEach, describe, expect, it, vi } from "vitest";
import { davidsonMarketLinks, parseDavidsonCommunity, parseDavidsonPromotion, parseFlightProps, resetDavidsonCaches } from "./dealsAdapters.davidson";
import { loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Davidson Homes pages in the shape the live site served from
 * November 2026: Next.js App Router pages whose data arrives as component
 * props in the RSC flight stream (`self.__next_f.push([1, "…"])`), long text
 * as separate `T` rows referenced by "$<id>", and strings starting with "$"
 * escaped as "$$". Names and addresses are invented.
 */
const HOST = "https://www.davidsonhomes.com";
const COMMUNITY = `${HOST}/states/texas/san-antonio-market-area/san-antonio/fixture-flats/`;
const PROMO = "/states/texas/san-antonio-market-area/promotions/fixture-sale-sat/";
const NOW = new Date("2026-11-22T12:00:00Z");

/** Escape strings the way React does: a leading "$" becomes "$$". */
const escape = (value: unknown): unknown => typeof value === "string" ? (value.startsWith("$") ? `$${value}` : value)
  : Array.isArray(value) ? value.map(escape)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === undefined ? "$undefined" : escape(item)])) : value;
/** A text row: id, "T", the UTF-8 byte length in hex, a comma, the text (no newline). */
const textRow = (id: string, text: string) => `${id}:T${Buffer.byteLength(text, "utf8").toString(16)},${text}`;
/** One page: the flight string split across several pushes, as the site sends it. */
const flightPage = (flight: string) => {
  const parts = [flight.slice(0, 40), flight.slice(40, Math.floor(flight.length / 2)), flight.slice(Math.floor(flight.length / 2))];
  return `<!DOCTYPE html><html><head><title>Fixture</title><link rel="preload" href="https://cdn.sanity.io/images/2nureyi3/production/39b2f0e5e6be541d3f4ef287c96dc3-1330x256.jpg"></head><body><div>Fixture</div>`
    + `<script>(self.__next_f=self.__next_f||[]).push([0])</script>`
    + parts.map((part) => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join("")
    + `</body></html>`;
};
const element = (props: unknown, raw: Record<string, unknown> = {}) => JSON.stringify([["$", "$L27", null, { vars: { city: { title: "San Antonio" } } }], ["$", "$L28", null, { ...(escape(props) as object), ...raw }]]);

const image = (hash: string, alt = "Home exterior") => ({ alt, asset: { _ref: `image-${hash}-1620x1080-jpg`, hotspot: null, lqip: "LQIP_REF" }, caption: null });
const home = (title: string, slug: string, price: number, overrideMls: string, est: string, hash: string, extra: Record<string, unknown> = {}) => ({
  _id: `id-${slug}`, title, slug: { _type: "slug", current: slug }, status: "Active", overrideMls, estCompletionMonth: est, price, oldPrice: null, beds: 4, baths: 2, halfBaths: 1, sqft: 2_000, lotId: "7-1",
  floorPlanPicker: { title: "The Fixture A" }, promotions: [], specialRateDetails: null, propertyImages: [image(hash)], ...extra,
});
const homes = [
  home("101 Fixture Path", "101-fixture-path", 289_990, "moveinready", "2026-11-12", "aaa1"),
  home("105 Fixture Path", "105-fixture-path", 319_990, "nooverride", "2027-02-10", "bbb2", { specialRateDetails: { finePrint: [{ children: [{ text: "$10,000 Flex Cash on select homes." }] }] } }),
];
const community = {
  _id: "c1", title: "Fixture Flats", communityStatus: "Now Selling", phone: 2105550111, subStreet1: "1 Fixture Office", subZipCode: "78222",
  salesOffice: { outOfCommunity: false, streetAddress: "1 Fixture Office", zipCode: "78222" }, coordinates: { lat: 29.34, lng: -98.39 },
  communityPriceRange: { lowestPrice: 254_990 }, schools: [{ schoolTitle: "Fixture Central ISD" }], features: [],
  communityBanner: { enableCommunityBanner: true, template: { bannerLink: PROMO, campaign: {} } }, availableHomes: homes,
  plans: [{ _id: "p1", title: "The Fixture A", slug: { current: "the-fixture-a-sat" }, price: 254_990, beds: 3, baths: 2, halfBaths: null, sqft: 1_253, propertyImages: [image("ddd4", "The Fixture A elevation")] }],
};
const communityFlight = (props: unknown) => [
  "0:{\"P\":null,\"b\":\"build1\"}\n",
  "4:I[76229,[],\"\"]\n",
  "1:\"$Sreact.fragment\"\n",
  textRow("29", "*Offer details – see a New Home Consultant."),
  `6:${element(props).replaceAll("\"LQIP_REF\"", "\"$2b\"")}\n`,
].join("");
const communityPage = flightPage(communityFlight({ community, city: { title: "San Antonio" }, region: { title: "San Antonio Region" } }));

const FINE_PRINT = "*FHA 5/1 ARM initial rate 3.99% (5.940% APR) on homes signed 11/13/2026 – 11/27/2026 that close by 12/30/2026; 3.5% down; adjusts after 60 months.";
const promoProps = {
  title: "Enjoy Rates as Low as 3.99% (5.940% APR)!", phone: 2105550199,
  body: [{ children: [{ text: "For a limited time, enjoy a 3.99% (5.940% APR) FHA 5/1 ARM plus " }, { text: "$10,000 Flex Cash" }, { text: " on select homes." }] }],
  region: "San Antonio Region",
  regions: [{ communities: [{ title: "Fixture Flats", availableHomes: [] }, { title: "Royal Fixture", availableHomes: [] }] }],
};
const promoFlight = (fineText: string) => [
  "0:{\"P\":null,\"b\":\"build1\"}\n",
  textRow("47", FINE_PRINT),
  textRow("48", "data:image/jpeg;base64,xx"),
  `7:${JSON.stringify([["$", "$L28", null, { ...(escape(promoProps) as object), finePrint: [{ children: [{ text: fineText }] }, { children: [{ text: "$$10,000 Flex Cash valid on quick move-in homes." }] }] }]])}\n`,
].join("");
const promoPage = flightPage(promoFlight("$47"));
const marketPage = flightPage(`0:{"b":"build1"}\n5:${element({ communities: [{ _id: "1", title: "Fixture Flats", uri: "/states/texas/san-antonio-market-area/san-antonio/fixture-flats/" }, { _id: "2", title: "Far Fixture", uri: "/states/texas/san-antonio-market-area/kyle/far-fixture/" }] })}\n`);

const site: Record<string, string> = { [COMMUNITY]: communityPage, [`${HOST}${PROMO}`]: promoPage };
const fetcher = vi.fn(async (input: string) => {
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Davidson Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Flats", scrubList: ["Fixture Flats", "Fixture Path", "Fixture Office"] };

beforeEach(() => { vi.clearAllMocks(); resetDavidsonCaches(); });

describe("Davidson Homes reader: App Router (flight) pages, November 2026", () => {
  it("reads element props from the flight stream: rows split across pushes, $$ unescaped, text rows resolved by UTF-8 length, other references left as references", () => {
    const props = parseFlightProps(communityPage)!;
    const page = props.find((entry) => entry.community)!;
    const read = (page.community as { availableHomes: Array<{ specialRateDetails: { finePrint: Array<{ children: Array<{ text: string }> }> } | null; propertyImages: Array<{ asset: { lqip: unknown } }> }> }).availableHomes;
    expect(read[1]!.specialRateDetails!.finePrint[0]!.children[0]!.text).toBe("$10,000 Flex Cash on select homes.");
    expect(read[0]!.propertyImages[0]!.asset.lqip).toEqual({ flightRef: "$2b" });
    const promo = parseFlightProps(promoPage)!.find((entry) => entry.finePrint) as { finePrint: Array<{ children: Array<{ text: unknown }> }> };
    expect(promo.finePrint[0]!.children[0]!.text).toBe(FINE_PRINT);
    expect(promo.finePrint[1]!.children[0]!.text).toBe("$10,000 Flex Cash valid on quick move-in homes.");
    expect(parseFlightProps("<html><body>no flight</body></html>")).toBeNull();
  });

  it("reads the community, its homes, plans and banner from the flight page the same way as the old page data", () => {
    const parsed = parseDavidsonCommunity(communityPage, COMMUNITY, NOW)!;
    expect(parsed.homes.map((entry) => [entry.privateAddress, entry.status, entry.price, entry.bathrooms, entry.homesite])).toEqual([
      ["101 Fixture Path, San Antonio, TX 78222", "Quick Move-In (Move-In Ready)", 289_990, 2.5, "Lot 7-1"],
      ["105 Fixture Path, San Antonio, TX 78222", "Quick Move-In (February 2027)", 319_990, 2.5, "Lot 7-1"],
    ]);
    expect(parsed.homes[0]!.sourceUrl).toBe(`${COMMUNITY}available-homes/101-fixture-path/`);
    expect(parsed.homes[0]!.gallery![0]!.sourceUrl).toBe("https://cdn.sanity.io/images/2nureyi3/production/aaa1-1620x1080.jpg");
    expect(parsed.plans.map((plan) => [plan.privatePlanName, plan.price])).toEqual([["The Fixture A", 254_990]]);
    expect(parsed.facts).toMatchObject({ name: "Fixture Flats", city: "San Antonio", zip: "78222", phone: "2105550111", fromPrice: 254_990, schoolDistrict: "Fixture Central ISD" });
    expect(parsed.promotionPath).toBe(PROMO);
    expect(davidsonMarketLinks(marketPage)).toEqual(["/states/texas/san-antonio-market-area/san-antonio/fixture-flats/", "/states/texas/san-antonio-market-area/kyle/far-fixture/"]);
  });

  it("keeps holding on a partial signal: a home field that points elsewhere gives no status, a page without the community is no community, and an offer whose copy points elsewhere is not read", async () => {
    // A status (or slug, or price) the flight stream sends as a reference is unknown: the home stays listed without a status, so the run holds.
    const withRef = flightPage(communityFlight({ community: { ...community, availableHomes: homes.map((entry, index) => index === 0 ? { ...entry } : entry) }, city: { title: "San Antonio" } })
      .replace("\"status\":\"Active\"", "\"status\":\"$2a\""));
    const refRead = parseDavidsonCommunity(withRef, COMMUNITY, NOW)!;
    expect(refRead.homes.map((entry) => entry.status)).toEqual([null, "Quick Move-In (February 2027)"]);
    const slugRef = flightPage(communityFlight({ community, city: { title: "San Antonio" } }).replace("\"current\":\"105-fixture-path\"", "\"current\":\"$3c\""));
    expect(parseDavidsonCommunity(slugRef, COMMUNITY, NOW)!.homes.map((entry) => entry.status)).toEqual(["Quick Move-In (Move-In Ready)", null]);
    // Flight data with no community props (or a community missing its plans) is not a community page.
    const noCommunity = flightPage(communityFlight({ city: { title: "San Antonio" } }));
    expect(parseDavidsonCommunity(noCommunity, COMMUNITY, NOW)).toBeNull();
    expect(parseDavidsonCommunity(flightPage(communityFlight({ community: { ...community, plans: undefined } })), COMMUNITY, NOW)).toBeNull();
    const reshaped = vi.fn(async () => new Response(noCommunity, { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // Fine print that points at a row the page did not send cannot be read: the offer holds, the homes still publish.
    const unresolved = flightPage(promoFlight("$5f"));
    expect(parseDavidsonPromotion(unresolved)).toBeNull();
    const offerFetcher = vi.fn(async (input: string) => input.endsWith(PROMO) ? new Response(unresolved, { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const held = await loadOfficialDeals(config, { fetcher: offerFetcher, now: () => NOW });
    expect(held.catalogOk).toBe(true);
    expect(held.incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
    expect(held.private.incentive).toBeNull();
  });

  it("reads the flight promotion page's title, body and fine print, and the communities it lists", async () => {
    const promo = parseDavidsonPromotion(promoPage)!;
    expect(promo.title).toBe("Enjoy Rates as Low as 3.99% (5.940% APR)!");
    expect(promo.communities).toEqual(["Fixture Flats", "Royal Fixture"]);
    expect(promo.text).toContain("3.99% (5.940% APR) FHA 5/1 ARM plus $10,000 Flex Cash");
    expect(promo.text).toContain("3.5% down");
    expect(parseDavidsonPromotion(communityPage)).toBeNull();
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(result.holdReasons).not.toContain("expected_community_container_not_found");
    expect(result.private.homes).toHaveLength(2);
    expect(result.private.incentive?.facts).toMatchObject({ promotionalRatePercent: 3.99, aprPercent: 5.94, loanType: "FHA" });
    expect(result.incentiveHoldReasons).toContain("adjustable_rate");
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78222", "davidsonhomes", "Davidson"]) expect(json).not.toContain(secret);
  });
});
