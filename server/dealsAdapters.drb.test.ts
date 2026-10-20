import { beforeEach, describe, expect, it, vi } from "vitest";
import { DrbHomesAdapter, drbApiUrl, drbCommunityPath, drbListingEntries, drbListingUrl, drbSlug, drbStatus, parseDrbCommunity, parseDrbHomes, parseDrbOffer, parseDrbPlans } from "./dealsAdapters.drb";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic DRB Homes API bodies in the shape the live API served in October
 * 2026 (the site itself is an app shell). Names, addresses and ids are
 * invented; the audit fields the real rows carry are left out or dummied.
 */
const HOST = "https://www.drbhomes.com";
const ASSETS = "https://assets.drbhomes.com/ndg-cms-prod-assets/image";
const COMMUNITY = `${HOST}/drbhomes/find-your-home/communities/texas/san-antonio/fixture-landmark`;
const NOW = new Date("2026-10-20T15:00:00Z");
const img = (name: string, type: string, title = "Exterior Front") => ({ id: 1, url: `${ASSETS}/${name}.jpg`, type, title, altTag: "", caption: "" });
const communityRow = (input: { id?: number; name?: string; street?: string | null; availability?: string; moveInNow?: number; priceFrom?: number } = {}) => ({
  id: input.id ?? 567, brand: "drbhomes", name: input.name ?? "Fixture Landmark", salesOfficePhone: "2105550142", callTrackingNumber: "2105550199", marketingHeadline: "The Only Builder Offering More Living Space",
  marketingDisplayPromotion: false, marketingPromotionDisclaimer: null, regions: [{ label: "San Antonio", stateName: "TX" }],
  address: { address1: input.street === undefined ? "130 Fixture Grove" : input.street, address2: "", city: "San Antonio", zip: "78253", latitude: 29.4660313, longitude: -98.8158263, directions: "Head northwest." },
  communityAvailabilityRef: { id: 221, name: input.availability ?? "Active", label: "Current" }, priceFrom: input.priceFrom ?? 269_990, plansCount: 2, modelHomesCount: 0, moveInNowHomesCount: input.moveInNow ?? 1,
  salesManagers: [{ id: 1, contactId: 9 }], contacts: [{ id: 9, email: "private@drbgroup.com", firstName: "Private", lastName: "Person", phone: "5555555555" }],
  images: [img("c1", "community_exterior")],
});
const home = (input: { id: number; street: string; homesite?: string | null; price: number; was?: number; status?: string | null; date?: string | null; model?: boolean; display?: boolean; communityId?: number; plan?: string }) => ({
  id: input.id, communityId: input.communityId ?? 567, communityName: "Fixture Landmark", brand: "drbhomes", listingType: "new_home", status: "active", salesStatus: input.status === undefined ? "available" : input.status,
  availabilityDate: input.date === undefined ? "2026-09-22" : input.date, isModel: input.model ?? false, displayInventory: input.display ?? true, homesite: input.homesite === undefined ? "12.19" : input.homesite,
  address: { address1: input.street, address2: "", city: "San Antonio", zip: "78253", latitude: 29.4645245, longitude: -98.8167986 },
  price: input.price, originalPrice: input.was ?? 0, planName: input.plan ?? "Driskill", planId: 4061, beds: 4, fullBaths: 2, halfBaths: 1, sqFt: 1_809, garageSpaces: 2, stories: 1, mlsNumber: "1993968",
  marketingHeadline: "Smart Design", marketingDescription: "<p><strong>Driskill Plan</strong></p>", createdBy: 252, lastIP: null,
  images: [img(`h${input.id}a`, "inventory_exterior"), img(`h${input.id}b`, "inventory_interior", "Kitchen"), img(`h${input.id}fp`, "inventory_floorplan", "Floor plan")],
  exteriorImages: [{ url: `${ASSETS}/h${input.id}a.jpg` }], interiorImages: [{ url: `${ASSETS}/h${input.id}b.jpg` }], floorplanImages: [{ url: `${ASSETS}/h${input.id}fp.jpg` }],
});
const HOMES = [
  home({ id: 9957, street: "151 Fixture Arrow", price: 324_990, was: 329_990 }),
  home({ id: 9958, street: "158 Fixture Hike", homesite: "12.29", price: 339_990, date: "2026-11-01" }),
  home({ id: 9959, street: "160 Fixture Hike", homesite: "12.30", price: 341_000, date: "2026-10-30", plan: "Palm" }),
  home({ id: 9960, street: "162 Fixture Hike", homesite: "12.31", price: 0, status: "sold", date: null }),
  home({ id: 9961, street: "164 Fixture Hike", homesite: "12.32", price: 350_000, model: true }),
  home({ id: 9962, street: "166 Fixture Hike", homesite: "12.33", price: 350_000, display: false }),
];
const list = (items: unknown[]) => JSON.stringify({ items, meta: { currentPage: 1, itemCount: items.length, itemsPerPage: 1000, totalItems: items.length, totalPages: 1 } });
const plan = (input: { id: number; name: string; price: number; status?: string; sales?: string }) => ({
  id: input.id, planId: input.id + 1000, brand: "drbhomes", name: input.name, marketingHeadline: input.name, status: input.status ?? "active", communityPlanSalesStatus: input.sales ?? "available", isModel: false, isTemplate: false,
  basePrice: input.price, bedsMin: 3, bedsMax: 4, bathsFullMin: 2, bathsFullMax: 3, bathsHalfMin: 1, bathsHalfMax: 1, sqFtMin: 1_850, sqFtMax: 1_850, garageSpacesMin: 2, garageSpacesMax: 3, stories: 1,
  images: [img(`p${input.id}`, "plan_elevation", "Elevation L"), img(`p${input.id}fp`, "plan_floorplan", "Floor plan")], elevationImages: [{ url: `${ASSETS}/p${input.id}.jpg` }], floorplanImages: [],
});
const PLANS = [plan({ id: 3212, name: "The Mahogany", price: 424_990 }), plan({ id: 3213, name: "Palm Plan", price: 427_990 }), plan({ id: 3214, name: "Retired", price: 1, status: "inactive" }), plan({ id: 3215, name: "Later", price: 500_000, sales: "coming_soon" })];
const OFFER = { id: 1635, title: "Up to $50K in Flex Cash, Plus 2% Lender Credit on Select Move-In Homes*", description: "The Joy of Owning New and the Confidence to buy Now! Hurry take advantage of $50K in Flex Cash and 2% in Lender Credit on Select Quick Move-In Homes.", type: "popup", displayFrom: "2026-10-01", displayThrough: "2026-12-31", status: "active", visibilities: ["community", "region"],
  content: { titleOne: "Up to $50K Flex Cash", disclaimer: "Home and community information subject to change without notice. DRB Group Texas, LLC (“DRB Homes”). *Up to $50,000 in flex cash credit(s) from DRB Homes and up to 2% in Approved Lender credit(s) toward closing costs available only for new contracts signed with DRB Homes between October 1, 2026, and December 31, 2026. Call 210-555-0142 or visit www.drbhomes.com for details. NMLS #123456." } };
const RATE_OFFER = { ...OFFER, id: 1636, title: "4.99% (5.42% APR) 30-year fixed FHA rate with 3.5% down on select homes", description: "", content: { disclaimer: "" } };

const byName = (slug: string) => drbApiUrl(`public/community/state/region/by-name?state=texas&region=san-antonio&name=${slug}`);
const site: Record<string, { body: string; status?: number }> = {
  [byName("fixture-landmark")]: { body: JSON.stringify({ id: 567 }) },
  [drbApiUrl("public-drb/community/567")]: { body: JSON.stringify(communityRow()) },
  [drbApiUrl("public/community/567/move-in-homes?page=1&limit=1000")]: { body: list(HOMES) },
  [drbApiUrl("public/community/567/plans?page=1&limit=1000")]: { body: list(PLANS) },
  [drbApiUrl("public/offers-v2/by-community/567")]: { body: JSON.stringify([OFFER]) },
};
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const entry = site[input];
  return entry ? new Response(entry.body, { status: entry.status ?? 200, headers: { "content-type": "application/json" } }) : new Response(JSON.stringify({ statusCode: 400, message: "No community with such name" }), { status: 400, headers: { "content-type": "application/json" } });
});
const config: CommunitySourceConfig = { builder: "DRB Homes", sourceUrl: `${COMMUNITY}/quick-move-in-homes`, privateCommunityName: "Fixture Landmark", scrubList: ["Fixture Landmark", "Fixture Grove", "Fixture Arrow", "Fixture Hike"] };
const withOverrides = (overrides: Record<string, { body: string; status?: number }>) => vi.fn(async (input: string) => {
  const entry = overrides[input] ?? site[input];
  return entry ? new Response(entry.body, { status: entry.status ?? 200, headers: { "content-type": "application/json" } }) : new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
});

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("DRB Homes reader: statuses, slugs and paths", () => {
  it("reads 'available' against the availability date, sells 'sold', gives no status to other wording; slugs as the site spells them", () => {
    expect(drbStatus("available", "2026-09-22", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(drbStatus("available", "2026-10-20", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(drbStatus("available", "2026-10-30", NOW)).toEqual({ status: "Quick Move-In (October 2026)", readyNow: false, moveInDate: "October 2026" });
    expect(drbStatus("available", "2026-11-01", NOW)).toEqual({ status: "Quick Move-In (November 2026)", readyNow: false, moveInDate: "November 2026" });
    expect(drbStatus("available", null, NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(drbStatus("available", "2099-01-01", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(drbStatus("sold", null, NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    expect(drbStatus("under_contract", "2026-11-01", NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    for (const label of [null, "", "pending", "reserved", "coming_soon", "model"]) expect(drbStatus(label, "2026-09-22", NOW).status).toBeNull();
    expect(drbSlug("Meyer Ranch – Premier")).toBe("meyer-ranch--premier");
    expect(drbSlug("Meyer Ranch - Enclave")).toBe("meyer-ranch--enclave");
    expect(drbSlug("Casinas at Gruene")).toBe("casinas-at-gruene");
    expect(drbSlug("151 Red Arrow")).toBe("151-red-arrow");
    expect(drbSlug("The Mahogany")).toBe("the-mahogany");
    expect(drbCommunityPath(new URL(COMMUNITY))).toEqual({ state: "texas", region: "san-antonio", slug: "fixture-landmark" });
    expect(drbCommunityPath(new URL(`${COMMUNITY}/quick-move-in-homes/`))).toEqual({ state: "texas", region: "san-antonio", slug: "fixture-landmark" });
    expect(drbCommunityPath(new URL(`${COMMUNITY}/quick-move-in-homes/151-fixture-arrow-1219`))).toBeNull();
    expect(drbCommunityPath(new URL(`${HOST}/drbhomes/find-your-home/communities/texas/san-antonio`))).toBeNull();
  });
});

describe("DRB Homes reader: API bodies", () => {
  it("reads the community, its homes (statuses, prices with the drop, specs, plan, homesite, photos without drawings) and its selling plans; a model, a hidden and another community's home are told apart", () => {
    const community = parseDrbCommunity(JSON.stringify(communityRow()))!;
    expect(community).toEqual({ id: 567, record: { name: "Fixture Landmark", street: "130 Fixture Grove", city: "San Antonio", zip: "78253", phone: "2105550142", priceFrom: 269_990, geo: { lat: 29.4660313, lng: -98.8158263 } }, availability: "Active", brand: "drbhomes", moveInNowCount: 1, plansCount: 2 });
    expect(parseDrbCommunity(JSON.stringify(communityRow({ street: "By Appointment" })))!.record!.street).toBeNull();
    expect(parseDrbCommunity("<html>")).toBeNull();
    expect(parseDrbCommunity(JSON.stringify({ name: "x" }))).toBeNull();
    const homes = parseDrbHomes(list(HOMES), 567, COMMUNITY, community.record, NOW)!;
    expect(homes.foreignHome).toBe(false);
    expect(homes.total).toBe(6);
    expect(homes.listed).toBe(6);
    expect(homes.homes.map((entry) => [entry.sourceUrl.replace(COMMUNITY, ""), entry.privateName, entry.privatePlanName, entry.status, entry.readyNow, entry.moveInDate, entry.price, entry.previousPrice, entry.priceDrop, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage, entry.homesite])).toEqual([
      ["/quick-move-in-homes/151-fixture-arrow-1219", "151 Fixture Arrow", "Driskill", "Quick Move-In (Move-In Ready)", true, null, 324_990, 329_990, 5_000, 4, 2.5, 1_809, 2, "Homesite 12.19"],
      ["/quick-move-in-homes/158-fixture-hike-1229", "158 Fixture Hike", "Driskill", "Quick Move-In (November 2026)", false, "November 2026", 339_990, null, null, 4, 2.5, 1_809, 2, "Homesite 12.29"],
      ["/quick-move-in-homes/160-fixture-hike-1230", "160 Fixture Hike", "Palm", "Quick Move-In (October 2026)", false, "October 2026", 341_000, null, null, 4, 2.5, 1_809, 2, "Homesite 12.30"],
      ["/quick-move-in-homes/162-fixture-hike-1231", "162 Fixture Hike", "Driskill", "Sold", false, null, null, null, null, 4, 2.5, 1_809, 2, "Homesite 12.31"],
      ["/quick-move-in-homes/164-fixture-hike-1232", "164 Fixture Hike", "Driskill", "Model", false, null, 350_000, null, null, 4, 2.5, 1_809, 2, "Homesite 12.32"],
    ]);
    expect(homes.homes[0]).toMatchObject({ privateAddress: "151 Fixture Arrow, San Antonio, TX 78253", geo: { latitude: 29.4645245, longitude: -98.8167986 } });
    // Photos: the asset host's, each once, floor-plan drawings left out.
    expect(homes.homes[0]!.gallery!.map((image) => image.sourceUrl.replace(ASSETS, ""))).toEqual(["/h9957a.jpg", "/h9957b.jpg"]);
    // A home without a readable address keeps its place with no status; another community's home is foreign.
    const odd = parseDrbHomes(list([home({ id: 1, street: "", price: 1 }), home({ id: 2, street: "9 Other", price: 1, communityId: 999 })]), 567, COMMUNITY, community.record, NOW)!;
    expect(odd.homes.map((entry) => [entry.sourceUrl.replace(COMMUNITY, ""), entry.status])).toEqual([["/unreadable-0", null]]);
    expect(odd.foreignHome).toBe(true);
    expect(parseDrbHomes("<html>", 567, COMMUNITY, null, NOW)).toBeNull();
    expect(parseDrbHomes(JSON.stringify({ data: [] }), 567, COMMUNITY, null, NOW)).toBeNull();
    const plans = parseDrbPlans(list(PLANS), COMMUNITY)!;
    expect(plans.map((entry) => [entry.sourceUrl.replace(COMMUNITY, ""), entry.privatePlanName, entry.price, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage, entry.gallery!.map((image) => [image.sourceUrl.replace(ASSETS, ""), image.caption])])).toEqual([
      ["/home-plans/the-mahogany", "The Mahogany", 424_990, 3, 2.5, 1_850, 2, [["/p3212.jpg", "Representative image"]]],
      ["/home-plans/palm-plan", "Palm Plan", 427_990, 3, 2.5, 1_850, 2, [["/p3213.jpg", "Representative image"]]],
    ]);
    expect(parseDrbPlans("[]", COMMUNITY)).toBeNull();
  });

  it("takes ONE current offer as the text (the one naming a rate first), with links, phones, e-mails and NMLS ids gone; expired, future and inactive offers do not count", () => {
    const text = parseDrbOffer(JSON.stringify([OFFER]), NOW);
    expect(text).toBe("Up to $50K in Flex Cash, Plus 2% Lender Credit on Select Move-In Homes. The Joy of Owning New and the Confidence to buy Now! Hurry take advantage of $50K in Flex Cash and 2% in Lender Credit on Select Quick Move-In Homes. Home and community information subject to change without notice. DRB Group Texas, LLC (“DRB Homes”). Up to $50,000 in flex cash credit(s) from DRB Homes and up to 2% in Approved Lender credit(s) toward closing costs available only for new contracts signed with DRB Homes between October 1, 2026, and December 31, 2026.");
    expect(parseDrbOffer(JSON.stringify([OFFER, RATE_OFFER]), NOW)).toBe("4.99% (5.42% APR) 30-year fixed FHA rate with 3.5% down on select homes.");
    expect(parseDrbOffer(JSON.stringify([{ ...OFFER, displayThrough: "2026-10-19" }, { ...OFFER, displayFrom: "2026-10-21" }, { ...OFFER, status: "inactive" }]), NOW)).toBeNull();
    expect(parseDrbOffer("[]", NOW)).toBeNull();
    expect(parseDrbOffer("{}", NOW)).toBe("unreadable");
    expect(parseDrbOffer("<html>", NOW)).toBe("unreadable");
  });

  it("lists the market's communities from the API with their records, coming-soon ones left out, each under the slug the site spells", () => {
    const body = list([communityRow(), communityRow({ id: 449, name: "Fixture Ranch – Premier", priceFrom: 364_990 }), communityRow({ id: 629, name: "Later Fixture", availability: "ComingSoon", priceFrom: 0 }), { id: 1 }]);
    const entries = drbListingEntries(body, "www.drbhomes.com")!;
    expect(entries.map((entry) => [entry.url, entry.record?.name, entry.record?.street, entry.record?.priceFrom])).toEqual([
      [COMMUNITY, "Fixture Landmark", "130 Fixture Grove", 269_990],
      [`${HOST}/drbhomes/find-your-home/communities/texas/san-antonio/fixture-ranch--premier`, "Fixture Ranch – Premier", "130 Fixture Grove", 364_990],
    ]);
    expect(drbListingEntries("<html>", "www.drbhomes.com")).toBeNull();
    expect(drbListingUrl()).toContain("api.drbhomes.com/api/v1/public-drb/community?");
  });
});

describe("DRB Homes reader: a community", () => {
  it("resolves the slug, reads the community, its homes, plans and offer from the API, and publishes them scrubbed", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([byName("fixture-landmark"), drbApiUrl("public-drb/community/567"), drbApiUrl("public/community/567/move-in-homes?page=1&limit=1000"), drbApiUrl("public/community/567/plans?page=1&limit=1000"), drbApiUrl("public/offers-v2/by-community/567")]);
    expect(result.private.homes).toHaveLength(5);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 269_990 });
    expect(result.private.incentive?.text).toMatch(/^Up to \$50K in Flex Cash/);
    expect(result.private.incentive?.facts).toMatchObject({ rateKind: "none", contractDeadline: { isoDate: "2026-12-31" } });
    expect(result.public.incentive?.text).not.toMatch(/DRB/);
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78253", "drbhomes", "DRB", "Private", "drbgroup", "5555555555", "1993968", "Driskill"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((entry) => [entry.status, entry.price])).toEqual([["Quick Move-In (Move-In Ready)", 324_990], ["Quick Move-In (November 2026)", 339_990], ["Quick Move-In (October 2026)", 341_000], ["Sold", null], ["Model", 350_000]]);
    // The community page itself is the sync's source; the API rows are listed as its pages.
    expect(result.private.pages[0]).toMatchObject({ kind: "community", sourceUrl: COMMUNITY });
    // A sold-out community publishes nothing; a close-out one still does.
    const soldOut = await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public-drb/community/567")]: { body: JSON.stringify(communityRow({ availability: "SoldOut", moveInNow: 0 })) } }), now: () => NOW });
    expect(soldOut.holdReasons).toEqual([]);
    expect(soldOut.private.homes).toEqual([]);
    expect(soldOut.private.incentive).toBeNull();
    const closeOut = await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public-drb/community/567")]: { body: JSON.stringify(communityRow({ availability: "Closeout" })) } }), now: () => NOW });
    expect(closeOut.private.homes).toHaveLength(5);
  });

  it("holds the run when the slug is unknown, when the community row is not the community's, when the list is short of the API's total or the community's move-in count, when a home is another community's, when the availability wording is unknown, when the site is not DRB's, or when the API cannot be read; a missing offer list holds the offer only", async () => {
    expect((await loadOfficialDeals({ ...config, sourceUrl: `${HOST}/drbhomes/find-your-home/communities/texas/san-antonio/not-a-fixture` }, { fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: `${HOST}/drbhomes/find-your-home/communities/texas/san-antonio` }, { fetcher, now: () => NOW })).holdReasons).toEqual(["invalid_source_url"]);
    expect((await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public-drb/community/567")]: { body: JSON.stringify(communityRow({ id: 568 })) } }), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public-drb/community/567")]: { body: JSON.stringify(communityRow({ name: "" })) } }), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public-drb/community/567")]: { body: JSON.stringify(communityRow({ availability: "Paused" })) } }), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const short = JSON.stringify({ items: HOMES.slice(0, 2), meta: { totalItems: 6 } });
    expect((await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public/community/567/move-in-homes?page=1&limit=1000")]: { body: short } }), now: () => NOW })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public-drb/community/567")]: { body: JSON.stringify(communityRow({ moveInNow: 9 })) } }), now: () => NOW })).holdReasons).toEqual(["incomplete_inventory"]);
    expect((await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public/community/567/move-in-homes?page=1&limit=1000")]: { body: list([...HOMES, home({ id: 3, street: "9 Other", price: 1, communityId: 999 })]) } }), now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public/community/567/move-in-homes?page=1&limit=1000")]: { body: "<html>" } }), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public/community/567/plans?page=1&limit=1000")]: { body: "[]" } }), now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A home without a readable address keeps its place with no status: the sync holds the run.
    const blank = await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public/community/567/move-in-homes?page=1&limit=1000")]: { body: list([...HOMES, home({ id: 4, street: "", price: 1 })]) } }), now: () => NOW });
    expect(blank.private.homes.at(-1)?.status).toBeNull();
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://drbhomes.com/drbhomes/find-your-home/communities/texas/san-antonio/fixture-landmark" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public-drb/community/567")]: { body: "down", status: 503 } }), now: () => NOW })).holdReasons).toEqual(["community_fetch_failed"]);
    const noOffers = await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public/offers-v2/by-community/567")]: { body: "gone", status: 404 } }), now: () => NOW });
    expect(noOffers.catalogOk).toBe(true);
    expect(noOffers.incentiveHoldReasons).toEqual(["incentive_fetch_failed"]);
    const oddOffers = await loadOfficialDeals(config, { fetcher: withOverrides({ [drbApiUrl("public/offers-v2/by-community/567")]: { body: "{}" } }), now: () => NOW });
    expect(oddOffers.catalogOk).toBe(true);
    expect(oddOffers.incentiveHoldReasons).toEqual(["expected_incentive_container_not_found"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new DrbHomesAdapter().builder).toBe("DRB Homes");
    expect(DEAL_ADAPTERS["DRB Homes"].builder).toBe("DRB Homes");
  });
});
