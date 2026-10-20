import { beforeEach, describe, expect, it, vi } from "vitest";
import { DreesAdapter, dreesApiUrl, dreesDiscoveryEntries, dreesOfferText, dreesStatus, parseDreesAreaId, parseDreesHomes, parseDreesNeighborhoods, parseDreesPage, parseDreesPlans, resetDreesCaches, withParentAddress } from "./dealsAdapters.drees";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Drees pages and API bodies in the shape the live site served in
 * October 2026: an app shell naming its content id, and POST search queries
 * for the market's neighborhoods, a neighborhood's homes and its plans.
 * Names, addresses and ids are invented.
 */
const HOST = "https://www.dreeshomes.com";
const COMMUNITY = `${HOST}/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/`;
const PARENT = `${HOST}/new-homes-san-antonio/san-antonio/comm-fixture-hills/`;
const NOW = new Date("2026-10-20T15:00:00Z");
const page = (contentId: number, kind: "neighborhood" | "parent" | "none" = "neighborhood", url?: string) => `<!DOCTYPE html><html><head><title>New Homes at Fixture Ranch</title><script>
    var contentId = ${contentId};
    var isAreaPage = false;
    ${kind === "neighborhood" ? "var isNeighborhoodPage = true;" : kind === "parent" ? "var isCommunityPage=true;" : ""}
    ${url ? `var url="${url}";` : ""}
    window.dataLayer = window.dataLayer || [];
</script></head><body><div id="app"></div><footer>Drees Custom Homes, 20734 Stone Oak Parkway Suite 103 San Antonio, TX 78258 | (210) 969-4100</footer></body></html>`;
const neighborhood = (input: { id: number; name: string; url: string; street?: string | null; city?: string; zip?: string; parent?: boolean; qmi?: number; plans?: number; priceLow?: number; geo?: [number, number]; caption?: string }) => ({
  contentId: input.id, ...(input.parent ? { communityName: input.name, isCommunity: true, neighborhoodCount: 2 } : { neighborhoodName: input.name, isCommunity: false }), url: input.url,
  ...(input.street === null ? {} : { address: input.street ?? "105 Fixture Wind" }), cityName: input.city ?? "Boerne", zipCode: input.zip ?? "78006", stateInitials: "TX", modelPhone: "210-555-0142", nhsPhoneNumber: "210-555-0199",
  lat: input.geo?.[0] ?? 29.807127, lng: input.geo?.[1] ?? -98.64016, priceLow: input.priceLow ?? 1_174_900, priceHigh: 1_599_900, qmiCount: input.qmi ?? 2, modelQmiCount: 1, planCount: input.plans ?? 2, caption: input.caption ?? "Now Selling!", schoolDistricts: ["Fixture ISD"],
  amenities: [], images: [], drivingDirections: "<p>Private directions.</p>", officehoursList: [],
});
const NEIGHBORHOODS = [
  neighborhood({ id: 309651, name: "Fixture Ranch", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/" }),
  neighborhood({ id: 326325, name: "Fixture Hills", url: "/new-homes-san-antonio/san-antonio/comm-fixture-hills/", parent: true, street: null, city: "San Antonio", zip: "78253", qmi: 1, geo: [29.4975, -98.8081] }),
  neighborhood({ id: 310329, name: "Fixture Hills 50S", url: "/new-homes-san-antonio/san-antonio/comm-fixture-hills/fixture-hills-50s/", street: "9512 Fixture Hollow", city: "San Antonio", zip: "78253", qmi: 1, geo: [29.4975, -98.8081] }),
  neighborhood({ id: 400, name: "Far Fixture", url: "/new-homes-san-antonio/kyle/far-fixture/far-fixture/", street: "1 Far Rd", city: "Kyle", zip: "78640", geo: [29.918, -97.85] }),
  neighborhood({ id: 401, name: "Elsewhere", url: "https://evil.example/x/" }),
  neighborhood({ id: 402, name: "Fixture Summit", url: "/new-homes-san-antonio/san-antonio/fixture-summit/fixture-summit/", street: null, city: "San Antonio", zip: "78257", caption: "Coming Soon!", geo: [29.6, -98.6] }),
  neighborhood({ id: 403, name: "Fixture Soon", url: "/new-homes-san-antonio/san-antonio/fixture-soon/fixture-soon/", street: "1 Soon Way", city: "San Antonio", zip: "78257", caption: "Coming Soon!", geo: [29.6, -98.6] }),
];
const home = (input: { address: string; url: string; date?: string | null; price: number; was?: number; model?: boolean; boyl?: boolean; plan?: string }) => ({
  address: input.address, cityName: "Boerne", stateInitials: "TX", zipCode: "78006", planName: input.plan ?? "Bennrook", elevation: "D", neighborhoodName: "Fixture Ranch", mlsNumber: "1993683", moveInDate: input.date === undefined ? "Jan 08, 2027" : input.date,
  actualPrice: input.was ?? 0, discountedPrice: input.price, url: input.url, isModelHome: input.model ?? false, isBoylHome: input.boyl ?? false, bedLow: 4, bedHigh: 0, bathLow: 4, halfBathLow: 1, sqFtLow: 4_400, garagesLow: 3, storiesLow: 1, latitude: 29.8, longitude: -98.64, images: null, contentId: 335052, productFavoriteId: "SAN::FIX::FIX::BENS::0015",
});
const HOMES = [
  home({ address: "217 Fixture Dog", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/217-fixture-dog/", price: 1_374_900 }),
  home({ address: "221 Fixture Dog", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/221-fixture-dog/", date: "Oct 16, 2026", price: 1_200_000, was: 1_250_000, plan: "Chase" }),
  home({ address: "225 Fixture Dog", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/225-fixture-dog/", date: null, price: 1_100_000 }),
  home({ address: "229 Fixture Dog", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/229-fixture-dog/", price: 1_300_000, model: true }),
  home({ address: "Your lot", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/boyl/", price: 900_000, boyl: true }),
];
const PROMOS = [{ promoId: "p1", title: "Save Your Way Up To $50,000!*", description: "<div class=\"rtf-content\"><p><span>Spice up your new home and save with great customization options! Hurry, this promotion ends </span><strong>November 22, 2026!</strong></p></div>", inactive: false, areaCodes: ["SAN"], promoImageUrl: "/link/abc.aspx" }];
const qmiBody = (homes: unknown[], total = homes.length, promos: unknown[] = PROMOS) => JSON.stringify({ data: { homes, promos, filteredRecords: total }, isSuccess: true });
const PLANS = [
  { planName: "Vermentino II", address: "Vermentino II", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/vermentino-ii-floorplan/", priceLow: 1_220_900, suppressPrice: false, isPlanAvailable: true, bedLow: 4, bathLow: 4, halfBathLow: 1, sqFtLow: 4_130, garagesLow: 3 },
  { planName: "Chase", address: "Chase", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/chase-floorplan/", priceLow: 1_290_900, suppressPrice: true, isPlanAvailable: true, bedLow: 4, bathLow: 4, halfBathLow: 1, sqFtLow: 4_349, garagesLow: 3 },
  { planName: "Gone", address: "Gone", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/gone-floorplan/", priceLow: 1, isPlanAvailable: false, bedLow: 3, bathLow: 2, sqFtLow: 2_000, garagesLow: 2 },
];
const planBody = (plans: unknown[]) => JSON.stringify({ data: { plans, promos: PROMOS, filteredRecords: plans.length }, isSuccess: true });
const AREAS = JSON.stringify({ data: [{ areaName: "Austin", id: "AUST", pageId: 959, pageUrl: "/new-homes-austin/" }, { areaName: "San Antonio", id: "SAN", pageId: 310095, pageUrl: "/new-homes-san-antonio/" }] });
const listBody = (rows: unknown[] = NEIGHBORHOODS) => JSON.stringify({ data: { neighborhoods: rows, promos: PROMOS, filteredRecords: rows.length } });

type Entry = { body: string; status?: number };
const site: Record<string, Entry> = { [COMMUNITY]: { body: page(309651) }, [dreesApiUrl("areas")]: { body: AREAS } };
const posts: Record<string, (body: Record<string, unknown>) => Entry> = {
  [dreesApiUrl("community")]: (body) => body.contentId === 310095 ? { body: listBody() } : { body: "not found", status: 404 },
  [dreesApiUrl("qmi")]: (body) => body.contentId === 309651 ? { body: qmiBody(HOMES) } : body.contentId === 326325 ? { body: qmiBody([home({ address: "9513 Fixture Hollow", url: "/new-homes-san-antonio/san-antonio/comm-fixture-hills/fixture-hills-50s/9513-fixture-hollow/", price: 500_000 })]) } : { body: qmiBody([]) },
  [dreesApiUrl("plan")]: (body) => body.contentId === 309651 ? { body: planBody(PLANS) } : { body: planBody([]) },
};
const requested: Array<[string, string | null]> = [];
const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
  const body = init?.method === "POST" && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  requested.push([input, body ? JSON.stringify(body) : null]);
  const entry = body ? posts[input]?.(body) : site[input];
  return entry ? new Response(entry.body, { status: entry.status ?? 200, headers: { "content-type": body ? "application/json" : "text/html" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const withSite = (overrides: Record<string, Entry>, postOverrides: Record<string, (body: Record<string, unknown>) => Entry> = {}) => vi.fn(async (input: string, init?: RequestInit) => {
  const body = init?.method === "POST" && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  const entry = body ? (postOverrides[input] ?? posts[input])?.(body) : (overrides[input] ?? site[input]);
  return entry ? new Response(entry.body, { status: entry.status ?? 200, headers: { "content-type": body ? "application/json" : "text/html" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Drees Custom Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Ranch", scrubList: ["Fixture Ranch", "Fixture Wind", "Fixture Dog"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; resetDreesCaches(); });

describe("Drees reader: page and API bodies", () => {
  it("reads the page's own id and kind, the market's neighborhoods, the homes (status from the move-in date, price with the cut, specs, plan; models and build-on-your-lot told apart) and the plans", () => {
    expect(parseDreesPage(page(309651))).toEqual({ contentId: 309651, parent: false, url: null });
    expect(parseDreesPage(page(326325, "parent", "/new-homes-san-antonio/san-antonio/comm-fixture-hills/"))).toEqual({ contentId: 326325, parent: true, url: "/new-homes-san-antonio/san-antonio/comm-fixture-hills/" });
    expect(parseDreesPage(page(310095, "none"))).toBeNull();
    expect(parseDreesPage("<html><body>new layout</body></html>")).toBeNull();
    expect(parseDreesAreaId(AREAS)).toBe(310095);
    expect(parseDreesAreaId(JSON.stringify({ data: [{ areaName: "Austin", pageId: 959 }] }))).toBeNull();
    expect(parseDreesAreaId("<html>")).toBeNull();
    const rows = parseDreesNeighborhoods(listBody(), "www.dreeshomes.com")!;
    expect(rows.map((row) => [row.contentId, row.record.name, row.url, row.parent, row.record.street, row.record.phone, row.qmiCount, row.record.priceFrom])).toEqual([
      [309651, "Fixture Ranch", COMMUNITY, false, "105 Fixture Wind", "2105550142", 2, 1_174_900],
      [326325, "Fixture Hills", PARENT, true, null, "2105550142", 1, 1_174_900],
      [310329, "Fixture Hills 50S", `${PARENT}fixture-hills-50s/`, false, "9512 Fixture Hollow", "2105550142", 1, 1_174_900],
      [400, "Far Fixture", `${HOST}/new-homes-san-antonio/kyle/far-fixture/far-fixture/`, false, "1 Far Rd", "2105550142", 2, 1_174_900],
      [402, "Fixture Summit", `${HOST}/new-homes-san-antonio/san-antonio/fixture-summit/fixture-summit/`, false, null, "2105550142", 2, 1_174_900],
      [403, "Fixture Soon", `${HOST}/new-homes-san-antonio/san-antonio/fixture-soon/fixture-soon/`, false, "1 Soon Way", "2105550142", 2, 1_174_900],
    ]);
    // A parent takes its first sub-neighborhood's sales address.
    expect(withParentAddress(rows).find((row) => row.parent)!.record).toMatchObject({ street: "9512 Fixture Hollow", city: "San Antonio", zip: "78253" });
    expect(parseDreesNeighborhoods("<html>", "www.dreeshomes.com")).toBeNull();
    expect(parseDreesNeighborhoods(JSON.stringify({ data: {} }), "www.dreeshomes.com")).toBeNull();
    const homes = parseDreesHomes(qmiBody(HOMES), COMMUNITY, NOW)!;
    expect(homes).toMatchObject({ listed: 5, total: 5, foreignHome: false });
    expect(homes.homes.map((entry) => [entry.privateName, entry.privatePlanName, entry.status, entry.readyNow, entry.moveInDate, entry.price, entry.previousPrice, entry.priceDrop, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage])).toEqual([
      ["217 Fixture Dog", "Bennrook", "Quick Move-In (January 2027)", false, "January 2027", 1_374_900, null, null, 4, 4.5, 4_400, 3],
      ["221 Fixture Dog", "Chase", "Quick Move-In", false, null, 1_200_000, 1_250_000, 50_000, 4, 4.5, 4_400, 3],
      ["225 Fixture Dog", "Bennrook", "Quick Move-In", false, null, 1_100_000, null, null, 4, 4.5, 4_400, 3],
      ["229 Fixture Dog", "Bennrook", "Model", false, null, 1_300_000, null, null, 4, 4.5, 4_400, 3],
    ]);
    expect(homes.homes[0]!.sourceUrl).toBe(`${COMMUNITY}217-fixture-dog/`);
    expect(homes.homes[0]).toMatchObject({ privateAddress: "217 Fixture Dog, Boerne, TX 78006" });
    expect(homes.offer).toBe("Save Your Way Up To $50,000! Spice up your new home and save with great customization options! Hurry, this promotion ends November 22, 2026!");
    // A home under another neighborhood's path is foreign; one without a readable street keeps its place with no status.
    const odd = parseDreesHomes(qmiBody([home({ address: "9 Other", url: "/new-homes-san-antonio/boerne/other-ranch/other-ranch/9-other/", price: 1 }), home({ address: "", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/x/", price: 1 })]), COMMUNITY, NOW)!;
    expect(odd.foreignHome).toBe(true);
    expect(odd.homes.map((entry) => [entry.sourceUrl.replace(COMMUNITY, ""), entry.status])).toEqual([["unreadable-0", null], ["unreadable-1", null]]);
    expect(parseDreesHomes("<html>", COMMUNITY, NOW)).toBeNull();
    expect(parseDreesHomes(JSON.stringify({ data: { plans: [] } }), COMMUNITY, NOW)).toBeNull();
    // Status wording: a future month, a passed date (undated), none (undated), unknown (hold).
    expect(dreesStatus("Jan 23, 2027", NOW)).toEqual({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    expect(dreesStatus("Oct 16, 2026", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(dreesStatus("12/01/2026", NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(dreesStatus(null, NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    for (const word of ["Soon", "TBD", "Jan 2027", "Jan 08, 2099"]) expect(dreesStatus(word, NOW).status).toBeNull();
    const plans = parseDreesPlans(planBody(PLANS), COMMUNITY)!;
    expect(plans.foreignPlan).toBe(false);
    expect(plans.plans.map((entry) => [entry.sourceUrl.replace(COMMUNITY, ""), entry.privatePlanName, entry.price, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage])).toEqual([
      ["vermentino-ii-floorplan/", "Vermentino II", 1_220_900, 4, 4.5, 4_130, 3],
      ["chase-floorplan/", "Chase", null, 4, 4.5, 4_349, 3],
    ]);
    expect(parseDreesPlans(planBody([{ ...PLANS[0], url: "/new-homes-san-antonio/boerne/other-ranch/other-ranch/vermentino-ii-floorplan/" }]), COMMUNITY)).toMatchObject({ foreignPlan: true, plans: [] });
    // One promotion is the offer, the one naming a rate first; an inactive one is left out.
    expect(dreesOfferText([{ title: "Closing help", description: "<p>Up to $10,000.</p>", inactive: false }, { title: "4.99% (5.6% APR) 30-year fixed FHA with 3.5% down", description: "", inactive: false }])).toBe("4.99% (5.6% APR) 30-year fixed FHA with 3.5% down.");
    expect(dreesOfferText([{ title: "Old", description: "", inactive: true }])).toBeNull();
  });
});

describe("Drees reader: a community", () => {
  it("reads the page, the market list (once an hour) and the two search queries, and publishes the homes, plans and promotion scrubbed; a parent community publishes its sub-neighborhoods' homes", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested.map(([url, body]) => [url.replace(HOST, ""), body])).toEqual([[COMMUNITY.replace(HOST, ""), null], ["/api/en/dreeshomes/areas", null], ["/api/en/dreeshomes/community", JSON.stringify({ contentId: 310095, pageSize: 1000, pageNumber: 1 })], ["/api/en/dreeshomes/qmi", JSON.stringify({ contentId: 309651, pageSize: 1000, pageNumber: 1 })], ["/api/en/dreeshomes/plan", JSON.stringify({ contentId: 309651, pageSize: 1000, pageNumber: 1 })]]);
    expect(result.private.homes).toHaveLength(4);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 1_174_900 });
    expect(result.private.incentive?.text).toMatch(/^Save Your Way Up To \$50,000!/);
    expect(result.private.incentive?.facts).toMatchObject({ rateKind: "none" });
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78006", "dreeshomes", "Drees", "1993683", "Bennrook", "Private directions"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((entry) => entry.status)).toEqual(["Quick Move-In (January 2027)", "Quick Move-In", "Quick Move-In", "Model"]);
    // The market list is reused within the hour.
    requested.length = 0;
    const parent = await loadOfficialDeals({ ...config, sourceUrl: PARENT, privateCommunityName: "Fixture Hills" }, { fetcher: withSite({ [PARENT]: { body: page(326325, "parent", "/new-homes-san-antonio/san-antonio/comm-fixture-hills/") } }), now: () => new Date("2026-10-20T15:30:00Z") });
    expect(parent.holdReasons).toEqual([]);
    expect(parent.private.homes.map((entry) => [entry.privateName, entry.sourceUrl.replace(HOST, "")])).toEqual([["9513 Fixture Hollow", "/new-homes-san-antonio/san-antonio/comm-fixture-hills/fixture-hills-50s/9513-fixture-hollow/"]]);
  });

  it("holds the run when the page is not a community page, when the market list does not name it or its address, when the page is another community's, when the list is short of the query's total or the market's count, when a home or plan is another community's, when the site is not Drees's, or when a read fails", async () => {
    const hold = async (fetch: typeof fetcher, source = COMMUNITY) => (await loadOfficialDeals({ ...config, sourceUrl: source }, { fetcher: fetch, now: () => NOW })).holdReasons;
    expect(await hold(withSite({ [COMMUNITY]: { body: "<html><body>new layout</body></html>" } }))).toEqual(["expected_community_container_not_found"]);
    expect(await hold(withSite({ [COMMUNITY]: { body: page(310095, "none") } }))).toEqual(["expected_community_container_not_found"]);
    // An id the market list does not carry, or a listed row without its sales address.
    expect(await hold(withSite({ [COMMUNITY]: { body: page(999) } }))).toEqual(["expected_community_container_not_found"]);
    resetDreesCaches();
    expect(await hold(withSite({}, { [dreesApiUrl("community")]: () => ({ body: listBody([neighborhood({ id: 309651, name: "Fixture Ranch", url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/", street: null })]) }) }))).toEqual(["expected_community_container_not_found"]);
    resetDreesCaches();
    // A tracking snippet's `var url` ahead of the page's own is not the page's; a same-host redirect answer to the search is a failed read, not another host.
    const tracked = page(309651, "neighborhood", "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/").replace("<head>", `<head><script>var url = "https://www.dreeshomes.com/link/track.aspx"; var tracker = url;</script>`);
    expect(parseDreesPage(tracked)).toMatchObject({ contentId: 309651, url: "/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/" });
    expect(await hold(vi.fn(async (input: string, init?: RequestInit) => init?.method === "POST" && input === dreesApiUrl("qmi") ? new Response("", { status: 302, headers: { location: "/api/en/dreeshomes/qmi/" } }) : withSite({})(input, init)))).toEqual(["community_fetch_failed"]);
    expect(await hold(vi.fn(async (input: string, init?: RequestInit) => init?.method === "POST" && input === dreesApiUrl("qmi") ? new Response("", { status: 302, headers: { location: "https://evil.example/qmi" } }) : withSite({})(input, init)))).toEqual(["unsupported_official_host"]);
    resetDreesCaches();
    // The page says it is another community (a same-host redirect), or the market list places this id at another URL.
    expect(await hold(withSite({ [COMMUNITY]: { body: page(309651, "neighborhood", "/new-homes-san-antonio/boerne/other-ranch/other-ranch/") } }))).toEqual(["invalid_inventory_response"]);
    expect(await hold(withSite({}, { [dreesApiUrl("community")]: () => ({ body: listBody([neighborhood({ id: 309651, name: "Fixture Ranch", url: "/new-homes-san-antonio/boerne/other-ranch/other-ranch/" })]) }) }))).toEqual(["invalid_inventory_response"]);
    resetDreesCaches();
    expect(await hold(withSite({}, { [dreesApiUrl("qmi")]: () => ({ body: qmiBody(HOMES.slice(0, 2), 5) }) }))).toEqual(["incomplete_inventory"]);
    expect(await hold(withSite({}, { [dreesApiUrl("qmi")]: () => ({ body: qmiBody(HOMES.slice(0, 1)) }) }))).toEqual(["incomplete_inventory"]);
    expect(await hold(withSite({}, { [dreesApiUrl("qmi")]: () => ({ body: qmiBody([...HOMES, home({ address: "9 Other", url: "/new-homes-san-antonio/boerne/other-ranch/other-ranch/9-other/", price: 1 })]) }) }))).toEqual(["invalid_inventory_response"]);
    expect(await hold(withSite({}, { [dreesApiUrl("plan")]: () => ({ body: planBody([{ ...PLANS[0], url: "/new-homes-san-antonio/boerne/other-ranch/other-ranch/v/" }]) }) }))).toEqual(["invalid_inventory_response"]);
    expect(await hold(withSite({}, { [dreesApiUrl("qmi")]: () => ({ body: "<html>" }) }))).toEqual(["expected_community_container_not_found"]);
    expect(await hold(withSite({}, { [dreesApiUrl("plan")]: () => ({ body: "<html>" }) }))).toEqual(["expected_community_container_not_found"]);
    expect(await hold(withSite({}, { [dreesApiUrl("qmi")]: () => ({ body: "down", status: 503 }) }))).toEqual(["community_fetch_failed"]);
    resetDreesCaches();
    expect(await hold(withSite({ [dreesApiUrl("areas")]: { body: "down", status: 503 } }))).toEqual(["community_fetch_failed"]);
    resetDreesCaches();
    expect(await hold(withSite({ [dreesApiUrl("areas")]: { body: JSON.stringify({ data: [] }) } }))).toEqual(["expected_community_container_not_found"]);
    expect(await hold(fetcher, "https://dreeshomes.com/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/")).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect(await hold(down)).toEqual(["community_fetch_failed"]);
  });

  it("lists the market for discovery: every selling neighborhood with its record (sub-neighborhoods as their own pages, no parents, no coming-soon or address-less rows), never another host", async () => {
    const entries = (await dreesDiscoveryEntries(fetcher, NOW.getTime()))!;
    expect(entries.map((entry) => [entry.url.replace(HOST, ""), entry.record?.name, entry.record?.street, entry.record?.geo])).toEqual([
      ["/new-homes-san-antonio/boerne/fixture-ranch/fixture-ranch/", "Fixture Ranch", "105 Fixture Wind", { lat: 29.807127, lng: -98.64016 }],
      ["/new-homes-san-antonio/san-antonio/comm-fixture-hills/fixture-hills-50s/", "Fixture Hills 50S", "9512 Fixture Hollow", { lat: 29.4975, lng: -98.8081 }],
      ["/new-homes-san-antonio/kyle/far-fixture/far-fixture/", "Far Fixture", "1 Far Rd", { lat: 29.918, lng: -97.85 }],
    ]);
    resetDreesCaches();
    expect(await dreesDiscoveryEntries(withSite({ [dreesApiUrl("areas")]: { body: "down", status: 503 } }), NOW.getTime())).toBeNull();
  });

  it("is an adapter the registry knows", () => {
    expect(new DreesAdapter().builder).toBe("Drees Custom Homes");
    expect(DEAL_ADAPTERS["Drees Custom Homes"].builder).toBe("Drees Custom Homes");
  });
});
