import { beforeEach, describe, expect, it, vi } from "vitest";
import { LENNAR_MAX_HOMES, LennarAdapter, lennarHomesAvailable, lennarListingEntries, lennarListingUrl, lennarRecord, lennarStatus, parseLennarCommunity, parseLennarNextData, resolveLennarRef } from "./dealsAdapters.lennar";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";
import { normalizedDealSourceKey } from "../shared/deals";

/**
 * Synthetic Lennar pages in the shape the live site served in October 2026:
 * a Next.js page whose `__NEXT_DATA__` carries a normalized Apollo cache
 * (masterplan, collections, plans, homesites, city) linked by `{ __ref }`.
 * Names and addresses are invented.
 */
const HOST = "https://www.lennar.com";
const PATH = "/new-homes/texas/san-antonio/san-antonio/fixture-ranch";
const COMMUNITY = `${HOST}${PATH}`;
const NOW = new Date("2026-10-20T15:00:00Z");
const CDN = "https://cdn.lennar.com/api/images/contentassets";
const image = (name: string) => ({ __typename: "TitleImageType", image: { __typename: "ImageType", url: `${CDN}/abc123/${name}.jpg?d=20260331T174538`, alt: name } });

type Home = { id: string; lot: string; number: string; plan: string; street: string; status: string | null; price: number | null; wasPrice?: number | null; beds?: number; baths?: number; halfBaths?: number; sqft?: number; url?: string; geo?: [number, number] | null; orphan?: boolean };
const HOMES: Home[] = [
  { id: "h_1", lot: "40477523124", number: "3124", plan: "p_1", street: "8707 Fixture Crest", status: "MOVE_IN_READY", price: 267_499, wasPrice: 284_999, geo: [29.347248, -98.730865] },
  { id: "h_2", lot: "40477523125", number: "3125", plan: "p_1", street: "8711 Fixture Crest", status: "UNDER_CONSTRUCTION", price: 271_999, wasPrice: null },
  { id: "h_3", lot: "40477523130", number: "3130", plan: "p_2", street: "8720 Fixture Crest", status: "COMING_SOON", price: 299_999, beds: 4, baths: 2, halfBaths: 1, sqft: 2_100 },
  { id: "h_4", lot: "40478523001", number: "3001", plan: "p_4", street: "120 Fixture Loop", status: "SOLD", price: 231_499, wasPrice: 231_499, orphan: true },
];
type Plan = { id: string; name: string; collection: string; startingPrice: number | null; customPrice?: string | null; beds?: number; baths?: number; halfBaths?: number; sqft?: number | null; status?: string; url?: string; homes?: string[] };
const PLANS: Plan[] = [
  { id: "p_1", name: "Rio", collection: "eventide-collection", startingPrice: 267_499, beds: 3, baths: 2, sqft: 1_650, homes: ["h_1", "h_2"] },
  { id: "p_2", name: "Aruba", collection: "eventide-collection", startingPrice: 289_999, beds: 4, baths: 2, halfBaths: 1, sqft: 2_100, homes: ["h_3"] },
  { id: "p_3", name: "Lark", collection: "cottage-collection", startingPrice: null, sqft: 1_400, status: "INACTIVE" },
  { id: "p_4", name: "Wren", collection: "cottage-collection", startingPrice: null, customPrice: "From $230k", sqft: null },
];
type Collection = { id: string; name: string; slug: string; address: string | null; zip: string; so?: { address: string; city: string; zip: string } | null; prices: [number, number]; plans: string[] };
const COLLECTIONS: Collection[] = [
  { id: "c_1", name: "Eventide Collection", slug: "eventide-collection", address: "8702 Fixture Glen", zip: "78252", prices: [254_999, 313_499], plans: ["p_1", "p_2"] },
  { id: "c_2", name: "Cottage Collection", slug: "cottage-collection", address: "Fixture Rd and Other Rd", zip: "78254", so: { address: "100 Fixture Office Dr", city: "Helotes", zip: "78023" }, prices: [229_999, 251_999], plans: ["p_3", "p_4"] },
];
type PageInput = { path?: string; mpcUrl?: string; homes?: Home[]; plans?: Plan[]; collections?: Collection[]; heading?: string | null; mpcid?: number | null; customPrice?: string; phone?: string | null; geo?: [number, number] };
function cacheOf(input: PageInput = {}): Record<string, unknown> {
  const path = input.path ?? PATH;
  const homes = input.homes ?? HOMES;
  const plans = input.plans ?? PLANS;
  const collections = input.collections ?? COLLECTIONS;
  const cache: Record<string, unknown> = {
    "CityType:ct_64_san antonio": { __typename: "CityType", id: "ct_64_san antonio", name: "San Antonio", url: "/new-homes/texas/san-antonio/san-antonio" },
    "MpcType:m_5000": {
      __typename: "MpcType", id: "m_5000", name: "Fixture Ranch", url: input.mpcUrl ?? path, city: { __ref: "CityType:ct_64_san antonio" }, status: "ACTIVE", customPrice: input.customPrice ?? "$254,999 - $313,499",
      latitude: (input.geo ?? [29.348139, -98.731111])[0], longitude: (input.geo ?? [29.348139, -98.731111])[1], mpcid: 5000, badge: "Now Selling!",
      consultants: { __typename: "ConsultantType", phoneNumber: input.phone === undefined ? "210-555-0142" : input.phone, introText: "We are Texas natives." },
      communities: collections.map((collection) => ({ __ref: `CommunityType:${collection.id}` })),
    },
    ROOT_QUERY: { __typename: "Query", 'mpc({"mpcid":5000})': { __ref: "MpcType:m_5000" } },
  };
  for (const collection of collections) {
    cache[`CommunityType:${collection.id}`] = {
      __typename: "CommunityType", id: collection.id, name: collection.name, url: `${path}/${collection.slug}`, address: collection.address, zipCode: collection.zip, priceRange: collection.prices, status: "ACTIVE", homesitesCount: 43, stateCode: "TX",
      soAddress: collection.so?.address ?? null, soCityName: collection.so?.city ?? null, soZipCode: collection.so?.zip ?? null, consultants: { __typename: "ConsultantType", phoneNumber: "210-555-0199" },
      plans: collection.plans.map((id) => ({ __ref: `PlanType:${id}` })), heroImage: image(`${collection.slug}-streetscape`),
    };
  }
  for (const plan of plans) {
    cache[`PlanType:${plan.id}`] = {
      __typename: "PlanType", id: plan.id, name: plan.name, url: plan.url ?? `${path}/${plan.collection}/${plan.name.toLowerCase()}`, beds: plan.beds ?? 3, baths: plan.baths ?? 2, halfBaths: plan.halfBaths ?? 0, sqft: plan.sqft === undefined ? 1_500 : plan.sqft,
      startingPrice: plan.startingPrice, customPrice: plan.customPrice ?? null, status: plan.status ?? "ACTIVE", availableHomesitesCount: (plan.homes ?? []).length,
      'elevationImages({"first":1})': [image(`${plan.name.toLowerCase()}-elevation`)], homesites: (plan.homes ?? []).map((id) => ({ __ref: `HomesiteType:${id}` })),
    };
  }
  for (const home of homes) {
    const plan = plans.find((row) => row.id === home.plan);
    cache[`HomesiteType:${home.id}`] = {
      __typename: "HomesiteType", id: home.id, lotid: home.lot, number: home.number, plan: { __ref: `PlanType:${home.plan}` }, price: home.price, wasPrice: home.wasPrice ?? null, formattedPrice: "", lotSize: 0, status: home.status,
      address: home.street, sqft: home.sqft ?? 1_650, beds: home.beds ?? 3, baths: home.baths ?? 2, halfBaths: home.halfBaths ?? 0,
      url: home.url ?? `${path}/${plan?.collection ?? "eventide-collection"}/${plan?.name.toLowerCase() ?? "rio"}/${home.lot}`,
      elevationImage: image(`${home.lot}-elevation`), isHotw: false, soldDate: null, latitude: home.geo?.[0] ?? null, longitude: home.geo?.[1] ?? null, offerAvailable: false, offerEndDate: null,
    };
  }
  return cache;
}
function communityPage(input: PageInput = {}): string {
  const homes = input.homes ?? HOMES;
  const heading = input.heading === undefined ? `<h3 class="h3 Typography_h3__cyf5y">${homes.length}<!-- --> homes available</h3>` : input.heading ?? "";
  const data = { props: { pageProps: { pageType: "MASTER_PLANNED_COMMUNITY", isCollection: false, divisionNumber: "SANLEN", variables: { mpcid: input.mpcid === undefined ? 5000 : input.mpcid, id: "7e624445" }, initialApolloState: cacheOf(input) } }, page: "/new-homes/[state]/[market]/[city]/[mpc]" };
  return `<!DOCTYPE html><html><head><title>Fixture Ranch New Home Community - San Antonio, TX by Lennar</title><link rel="canonical" href="${COMMUNITY}"/></head><body><div id="__next"><h1 class="h2">Fixture Ranch</h1><p>Zoned to Northside ISD.</p><div class="HomesitesTableV3_root">${heading}</div><p>Call 210-555-0142</p></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}
function marketPage(): string {
  const cache = cacheOf();
  const mpc = cache["MpcType:m_5000"] as Record<string, unknown>;
  cache["MpcType:m_5001"] = { ...mpc, id: "m_5001", name: "Far Fixture", url: "/new-homes/texas/san-antonio/lubbock/far-fixture", latitude: 33.616608, longitude: -101.918101, mpcid: 5001, customPrice: "Now Selling", communities: [{ __ref: "CommunityType:c_3" }], city: { __ref: "CityType:ct_64_lubbock" } };
  cache["CityType:ct_64_lubbock"] = { __typename: "CityType", id: "ct_64_lubbock", name: "Lubbock" };
  cache["CommunityType:c_3"] = { __typename: "CommunityType", id: "c_3", basePrice: 230_999, address: "1 Far Rd", zipCode: "79423", plans: [] };
  cache["MpcType:m_5002"] = { ...mpc, id: "m_5002", name: "Coming Fixture", url: "/new-homes/texas/san-antonio/saint-hedwig/coming-fixture", mpcid: 5002, customPrice: "Coming soon", communities: [] };
  cache["MpcType:m_5003"] = { ...mpc, id: "m_5003", name: "Fixture Ranch", url: `${PATH}/` };
  cache["MpcType:m_5004"] = { ...mpc, id: "m_5004", name: "Elsewhere", url: "https://evil.example/new-homes/texas/san-antonio/x/elsewhere" };
  const data = { props: { pageProps: { marketCode: "SAN", initialApolloState: cache } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Lennar", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Ranch", scrubList: ["Fixture Ranch", "Fixture Crest", "Fixture Glen", "Fixture Loop", "Fixture Office"] };
const html = (body: string) => vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }));

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Lennar reader: the page data", () => {
  it("reads the Next.js data and follows cache references", () => {
    const pageProps = parseLennarNextData(communityPage());
    const cache = pageProps?.initialApolloState as Record<string, unknown>;
    expect(cache).toBeTruthy();
    expect((resolveLennarRef(cache, { __ref: "MpcType:m_5000" }) as { name: string }).name).toBe("Fixture Ranch");
    expect((resolveLennarRef(cache, [{ __ref: "CommunityType:c_1" }]) as Array<{ name: string }>).map((row) => row.name)).toEqual(["Eventide Collection"]);
    expect(resolveLennarRef(cache, { __ref: "MpcType:m_9999" })).toBeNull();
    expect(resolveLennarRef(cache, "plain")).toBe("plain");
    expect(parseLennarNextData("<html><body>no data</body></html>")).toBeNull();
    expect(parseLennarNextData('<script id="__NEXT_DATA__" type="application/json">{not json</script>')).toBeNull();
  });

  it("reads statuses", () => {
    expect(lennarStatus("MOVE_IN_READY")).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(lennarStatus("UNDER_CONSTRUCTION")).toEqual({ status: "Quick Move-In (Under Construction)", readyNow: false, moveInDate: null });
    expect(lennarStatus("under construction")).toMatchObject({ status: "Quick Move-In (Under Construction)" });
    expect(lennarStatus("COMING_SOON")).toMatchObject({ status: "Coming Soon", readyNow: false });
    expect(lennarStatus("SOLD")).toMatchObject({ status: "Sold" });
    expect(lennarStatus("RESERVED")).toEqual({ status: null, readyNow: false, moveInDate: null });
    expect(lennarStatus(null)).toMatchObject({ status: null });
  });

  it("reads the homesite table heading's count", () => {
    expect(lennarHomesAvailable('<h3 class="h3">36<!-- --> homes available</h3>')).toBe(36);
    expect(lennarHomesAvailable("<h3>1 home available</h3>")).toBe(1);
    expect(lennarHomesAvailable("<h3>No homes available</h3><p>There are currently no homes available.</p>")).toBe(0);
    expect(lennarHomesAvailable("<p>36 homes available</p>")).toBeNull();
    expect(lennarHomesAvailable("<h3>Find the home that's right for you</h3>")).toBeNull();
  });
});

describe("Lennar reader: page data", () => {
  it("reads the masterplan (sales office, city, ZIP, phone, pin, lowest price), every collection's homes (status, price and a cut's previous price, specs, plan, lot, pin, elevation photo), the plans for sale (inactive and figure-less left out) and the heading's count", () => {
    const page = parseLennarCommunity(communityPage(), COMMUNITY);
    expect(page?.record).toEqual({ name: "Fixture Ranch", street: "8702 Fixture Glen", city: "San Antonio", zip: "78252", phone: "2105550142", priceFrom: 229_999, geo: { lat: 29.348139, lng: -98.731111 } });
    expect(page).toMatchObject({ foreignPage: false, foreignHome: false, foreignPlan: false, collections: 2, homesAvailable: 4 });
    expect(page?.homes.map((home) => [home.privateName, home.status, home.price, home.previousPrice, home.priceDrop, home.readyNow, home.privatePlanName, home.homesite])).toEqual([
      ["8707 Fixture Crest", "Quick Move-In (Move-In Ready)", 267_499, 284_999, 17_500, true, "Rio", "Lot 3124"],
      ["8711 Fixture Crest", "Quick Move-In (Under Construction)", 271_999, null, null, false, "Rio", "Lot 3125"],
      ["8720 Fixture Crest", "Coming Soon", 299_999, null, null, false, "Aruba", "Lot 3130"],
      ["120 Fixture Loop", "Sold", 231_499, null, null, false, "Wren", "Lot 3001"],
    ]);
    expect(page?.homes[0]).toMatchObject({ sourceUrl: `${COMMUNITY}/eventide-collection/rio/40477523124`, privateAddress: "8707 Fixture Crest, San Antonio, TX 78252", bedrooms: 3, bathrooms: 2, squareFeet: 1_650, geo: { latitude: 29.347248, longitude: -98.730865 }, gallery: [{ sourceUrl: `${CDN}/abc123/40477523124-elevation.jpg` }] });
    expect(page?.homes[2]).toMatchObject({ bedrooms: 4, bathrooms: 2.5, squareFeet: 2_100, geo: null });
    // The orphan home (no plan lists it) is read from the cache under the page; its address takes the masterplan's city.
    expect(page?.homes[3]).toMatchObject({ sourceUrl: `${COMMUNITY}/cottage-collection/wren/40478523001`, privateAddress: "120 Fixture Loop, San Antonio, TX 78252" });
    expect(page?.plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.sourceUrl])).toEqual([
      ["Rio", 267_499, 3, 2, 1_650, `${COMMUNITY}/eventide-collection/rio`],
      ["Aruba", 289_999, 4, 2.5, 2_100, `${COMMUNITY}/eventide-collection/aruba`],
    ]);
    expect(page?.plans[0]?.gallery).toEqual([{ sourceUrl: `${CDN}/abc123/rio-elevation.jpg`, caption: "Representative image", width: null, height: null, srcSet: null }]);
    expect(lennarRecord(communityPage(), COMMUNITY)?.name).toBe("Fixture Ranch");
    expect(lennarRecord("<html><body>none</body></html>", COMMUNITY)).toBeNull();
  });

  it("takes a sales office override for the record (the homes keep the masterplan's city and their collection's ZIP), finds the masterplan by its URL without the page variables, and flags a row elsewhere and foreign links", () => {
    const override = parseLennarCommunity(communityPage({ collections: [COLLECTIONS[1]!, COLLECTIONS[0]!], homes: [{ ...HOMES[0]!, plan: "p_4" }], plans: [{ ...PLANS[3]!, homes: ["h_1"] }] }), COMMUNITY);
    expect(override?.record).toMatchObject({ street: "100 Fixture Office Dr", city: "Helotes", zip: "78023" });
    expect(override?.homes[0]?.privateAddress).toBe("8707 Fixture Crest, San Antonio, TX 78254");
    expect(parseLennarCommunity(communityPage({ mpcid: null }), COMMUNITY)?.record.name).toBe("Fixture Ranch");
    expect(parseLennarCommunity(communityPage({ mpcUrl: "/new-homes/texas/san-antonio/san-antonio/fixture-creek" }), COMMUNITY)).toMatchObject({ foreignPage: true });
    expect(parseLennarCommunity(communityPage({ mpcUrl: "https://lennar.com/new-homes/texas/san-antonio/san-antonio/fixture-ranch" }), COMMUNITY)).toMatchObject({ foreignPage: true });
    expect(parseLennarCommunity(communityPage({ mpcUrl: "" }), COMMUNITY)).toMatchObject({ foreignPage: true });
    expect(parseLennarCommunity(communityPage({ homes: [{ ...HOMES[0]!, url: "/new-homes/texas/san-antonio/san-antonio/fixture-creek/eventide-collection/rio/1" }] }), COMMUNITY)).toMatchObject({ foreignHome: true, homes: [] });
    expect(parseLennarCommunity(communityPage({ homes: [{ ...HOMES[0]!, url: "https://evil.example/x" }] }), COMMUNITY)).toMatchObject({ foreignHome: true });
    expect(parseLennarCommunity(communityPage({ plans: [{ ...PLANS[0]!, url: "/new-homes/texas/san-antonio/san-antonio/fixture-creek/eventide-collection/rio" }] }), COMMUNITY)).toMatchObject({ foreignPlan: true, plans: [] });
    expect(parseLennarCommunity(communityPage({ collections: [], homes: [] }), COMMUNITY)).toMatchObject({ collections: 0, homes: [], plans: [] });
    expect(parseLennarCommunity(communityPage({ heading: null }), COMMUNITY)?.homesAvailable).toBeNull();
    expect(parseLennarCommunity(communityPage({ customPrice: "Coming soon", collections: [{ ...COLLECTIONS[0]!, prices: [0, 0] }] }), COMMUNITY)?.record.priceFrom).toBeNull();
    expect(parseLennarCommunity("<html><body>none</body></html>", COMMUNITY)).toBeNull();
  });

  it("lists the market page's selling masterplans for discovery with their records, once each, on the official host only", () => {
    const entries = lennarListingEntries(marketPage(), "www.lennar.com");
    expect(entries?.map((entry) => [entry.url, entry.record.name, entry.record.street, entry.record.city, entry.record.zip, entry.record.priceFrom, entry.record.geo])).toEqual([
      [COMMUNITY, "Fixture Ranch", "8702 Fixture Glen", "San Antonio", "78252", 229_999, { lat: 29.348139, lng: -98.731111 }],
      [`${HOST}/new-homes/texas/san-antonio/lubbock/far-fixture`, "Far Fixture", "1 Far Rd", "Lubbock", "79423", 230_999, { lat: 33.616608, lng: -101.918101 }],
    ]);
    expect(entries?.map((entry) => normalizedDealSourceKey(entry.url))).toEqual(Array.from(new Set(entries?.map((entry) => normalizedDealSourceKey(entry.url)))));
    expect(lennarListingEntries("<html><body>no data</body></html>", "www.lennar.com")).toBeNull();
    expect(lennarListingEntries('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialApolloState":{"ROOT_QUERY":{}}}}}</script>', "www.lennar.com")).toBeNull();
    expect(lennarListingUrl()).toBe("https://www.lennar.com/new-homes/texas/san-antonio");
  });
});

describe("Lennar reader: adapter", () => {
  it("is registered under its builder id", () => {
    expect(DEAL_ADAPTERS.Lennar).toBeInstanceOf(LennarAdapter);
    expect(DEAL_ADAPTERS.Lennar.builder).toBe("Lennar");
  });

  it("reads the page once and publishes the homes (a coming-soon one absent, a sold one sold), the plans and the facts, with no incentive", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes.map((home) => [home.privateName, home.status, home.price, home.previousPrice])).toEqual([["8707 Fixture Crest", "Quick Move-In (Move-In Ready)", 267_499, 284_999], ["8711 Fixture Crest", "Quick Move-In (Under Construction)", 271_999, null], ["8720 Fixture Crest", "Coming Soon", 299_999, null], ["120 Fixture Loop", "Sold", 231_499, null]]);
    expect(result.private.plans.map((plan) => plan.privatePlanName)).toEqual(["Rio", "Aruba"]);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 229_999, schoolDistrict: "Northside ISD" });
    expect(result.private.incentive).toBeNull();
    // Lennar has no offer source: an empty incentive never takes an admin's promo down.
    expect(result.private.offerRead).toBeFalsy();
    expect(result.public.incentive).toBeNull();
    expect(result.private.pages.map((page) => page.kind)).toEqual(["community", "home", "home", "home", "home", "plan", "plan"]);
    expect(result.public.homes).toHaveLength(4);
    expect(JSON.stringify(result.public)).not.toMatch(/Fixture|40477523124|555-0142|555-0199|lennar\.com|Texas natives/);
  });

  it("publishes nothing for a community with no homes for sale and a 'No homes available' heading", async () => {
    const result = await loadOfficialDeals(config, { fetcher: html(communityPage({ homes: [], heading: "<h3>No homes available</h3>", plans: [PLANS[0]!] })), now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(result.private.homes).toEqual([]);
    expect(result.private.plans).toHaveLength(1);
    // Without the heading nothing is read as empty: the page has changed shape.
    const noHeading = await loadOfficialDeals(config, { fetcher: html(communityPage({ homes: [], heading: null, plans: [PLANS[0]!] })), now: () => NOW });
    expect(noHeading.holdReasons).toEqual(["expected_community_container_not_found"]);
  });

  it("holds when the page is not a community page, when no collection sells yet, when the row or its links are another community's, when the heading's count and the data disagree or the heading is missing, and when the site or the read fails; a home with an unknown status has none (the sync holds it)", async () => {
    const load = (page: string) => loadOfficialDeals(config, { fetcher: html(page), now: () => NOW });
    expect((await load("<html><body>new layout</body></html>")).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ collections: [], customPrice: "Coming soon" }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await load(communityPage({ mpcUrl: "/new-homes/texas/san-antonio/san-antonio/fixture-creek" }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ homes: [{ ...HOMES[0]!, url: "/new-homes/texas/san-antonio/san-antonio/fixture-creek/eventide-collection/rio/1" }] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ plans: [{ ...PLANS[0]!, url: "/new-homes/texas/san-antonio/san-antonio/fixture-creek/eventide-collection/rio" }] }))).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await load(communityPage({ heading: "<h3>5<!-- --> homes available</h3>" }))).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await load(communityPage({ heading: null }))).holdReasons).toEqual(["expected_community_container_not_found"]);
    const unknown = await load(communityPage({ homes: [...HOMES, { ...HOMES[0]!, id: "h_9", lot: "1", number: "1", street: "9 Fixture Way", status: "RESERVED" }], plans: [{ ...PLANS[0]!, homes: ["h_1", "h_2", "h_9"] }, PLANS[1]!, PLANS[2]!, PLANS[3]!] }));
    expect(unknown.catalogOk).toBe(true);
    expect(unknown.private.homes.find((home) => home.privateName === "9 Fixture Way")?.status).toBeNull();
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://lennar.com/new-homes/texas/san-antonio/san-antonio/fixture-ranch" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("busy", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
    const away = vi.fn(async () => new Response("", { status: 302, headers: { location: "https://www.lennarmortgage.com/" } }));
    expect((await loadOfficialDeals(config, { fetcher: away })).holdReasons).toEqual(["unsupported_official_host"]);
  });

  it("holds a community with more homes for sale than the cap", async () => {
    const many = Array.from({ length: LENNAR_MAX_HOMES + 1 }, (_, index) => ({ ...HOMES[0]!, id: `h_${100 + index}`, lot: String(40_477_600_000 + index), number: String(1_000 + index), street: `${100 + index} Fixture Crest` }));
    expect((await loadOfficialDeals(config, { fetcher: html(communityPage({ homes: many, plans: [{ ...PLANS[0]!, homes: many.map((home) => home.id) }] })), now: () => NOW })).holdReasons).toEqual(["incomplete_inventory"]);
  });
});
