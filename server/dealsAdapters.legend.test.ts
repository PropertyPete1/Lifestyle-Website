import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegendHomesAdapter, legendApiUrl, legendCommunityPath, legendListingEntries, legendListingUrl, legendPageUrlFor, legendSlug } from "./dealsAdapters.legend";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Legend Homes API bodies in the shape the live API served in
 * October 2026 (the same platform as DRB Homes). Names, addresses and ids are
 * invented.
 */
const HOST = "https://www.livelegendhomes.com";
const ASSETS = "https://assets.livelegendhomes.com/legend-cms-prod-assets/image";
const COMMUNITY = `${HOST}/communities/san-antonio/schertz-cibolo/bexar/converse/fixture-ranch`;
const NOW = new Date("2026-10-20T15:00:00Z");
const row = (input: { id?: number; name?: string; region?: string; county?: string; city?: string; availability?: string } = {}) => ({
  id: input.id ?? 104, brand: "legendhomes", name: input.name ?? "Fixture Ranch", divisionName: "San Antonio", salesOfficePhone: "2105550142", marketingHeadline: "New homes in Converse",
  regions: [{ label: input.region ?? "Schertz/Cibolo", stateId: 45, stateName: "TX", stateLabel: "Texas" }],
  address: { address1: "9810 Fixture Way", address2: "", city: input.city ?? "Converse", zip: "78109", latitude: 29.5205, longitude: -98.3012, countyId: 2538, countyName: input.county ?? "Bexar" },
  communityAvailabilityRef: { id: 1, name: input.availability ?? "Active", label: "Current" }, priceFrom: 252_990, plansCount: 1, modelHomesCount: 0, moveInNowHomesCount: 2,
  contacts: [{ id: 1, email: "private@legend.example", firstName: "Private", lastName: "Person" }], createdBy: 18, lastIP: null,
});
const home = (id: number, street: string, status: string, date: string, price: number, was = 0) => ({
  id, communityId: 104, brand: "legendhomes", listingType: "new_home", status: "active", salesStatus: status, availabilityDate: date, isModel: false, displayInventory: true, homesite: "0055",
  address: { address1: street, address2: "", city: "Converse", zip: "78109", latitude: 29.52, longitude: -98.30 }, price, originalPrice: was, planName: "The Redbud", beds: 4, fullBaths: 2, halfBaths: 1, sqFt: 2_622, garageSpaces: 2, mlsNumber: "1917040",
  images: [{ id: 1, url: `${ASSETS}/h${id}.png`, type: "inventory_exterior", title: "Front" }], exteriorImages: [], interiorImages: [], floorplanImages: [{ url: `${ASSETS}/fp${id}.png` }],
});
const list = (items: unknown[]) => JSON.stringify({ items, meta: { totalItems: items.length } });
const OFFERS = [
  { id: 164, title: "Open Door Deal_InPage", description: "Updated ODD offer on homes for San Antonio's Open Door Deal in October", type: "in-page-banner", status: "active", displayFrom: "2026-10-08", displayThrough: "2026-10-31", visibilities: ["community", "division", "region"], content: { titleOne: "Open Door Deal", copyOne: "From now until Oct. 31, enjoy limited-time, low-interest rates and closing costs assistance on select homes. See a Legend Home Sales Professional for details.", disclaimer: "" } },
  { id: 140, title: "Self tour_Fixture Ranch", description: "", type: "image-only-popup", status: "active", displayFrom: "2026-03-05", displayThrough: "2039-12-31", visibilities: ["community"], content: { titleOne: null, copyOne: "", disclaimer: "" } },
];
const lookup = legendApiUrl("public-epcon/community/state/region/county/city/by-name-v2?state=texas&region=schertz-cibolo&county=bexar&city=converse&name=fixture-ranch");
const site: Record<string, { body: string; status?: number }> = {
  [lookup]: { body: JSON.stringify({ id: 104, name: "Fixture Ranch", regionName: "Schertz/Cibolo" }) },
  [legendApiUrl("public-drb/community/104")]: { body: JSON.stringify(row()) },
  [legendApiUrl("public/community/104/move-in-homes?page=1&limit=1000")]: { body: list([home(3121, "13813 Fixture Lane", "available", "2026-10-19", 324_990, 358_419), home(3122, "13817 Fixture Lane", "available", "2027-02-11", 339_990), home(3123, "13821 Fixture Lane", "contract_pending", "2026-10-19", 330_000), home(3124, "13825 Fixture Lane", "sold", "2026-10-19", 0)]) },
  [legendApiUrl("public/community/104/plans?page=1&limit=1000")]: { body: list([{ id: 1536, name: "The Lakewood", status: "active", communityPlanSalesStatus: "available", basePrice: 357_990, bedsMin: 3, bathsFullMin: 2, bathsHalfMin: 1, sqFtMin: 2_602, garageSpacesMin: 2, images: [{ id: 2, url: `${ASSETS}/p1536.jpg`, type: "plan_elevation", title: "Elevation" }] }]) },
  [legendApiUrl("public/offers-v2/by-community/104")]: { body: JSON.stringify(OFFERS) },
};
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const entry = site[input];
  return entry ? new Response(entry.body, { status: entry.status ?? 200, headers: { "content-type": "application/json" } }) : new Response(JSON.stringify({ statusCode: 400, message: "Bad Request" }), { status: 400, headers: { "content-type": "application/json" } });
});
const config: CommunitySourceConfig = { builder: "Legend Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Ranch", scrubList: ["Fixture Ranch", "Fixture Way", "Fixture Lane"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Legend Homes reader", () => {
  it("spells slugs and pages as the site does, and lists the division's communities with their records", () => {
    expect(legendSlug("New Braunfels/Seguin")).toBe("new-braunfels-seguin");
    expect(legendSlug("Schertz/Cibolo")).toBe("schertz-cibolo");
    expect(legendSlug("Saint Hedwig")).toBe("saint-hedwig");
    expect(legendSlug("Abbott Place")).toBe("abbott-place");
    expect(legendCommunityPath(new URL(COMMUNITY))).toEqual({ division: "san-antonio", region: "schertz-cibolo", county: "bexar", city: "converse", slug: "fixture-ranch" });
    expect(legendCommunityPath(new URL(`${HOST}/communities/san-antonio/schertz-cibolo`))).toBeNull();
    expect(legendPageUrlFor(row())).toBe(COMMUNITY);
    expect(legendPageUrlFor(row({ name: "Dauer Fixture", region: "New Braunfels/Seguin", county: "Comal", city: "New Braunfels" }))).toBe(`${HOST}/communities/san-antonio/new-braunfels-seguin/comal/new-braunfels/dauer-fixture`);
    expect(legendPageUrlFor({ ...row(), regions: [] })).toBeNull();
    const entries = legendListingEntries(list([row(), row({ id: 629, name: "Later Fixture", availability: "ComingSoon" }), { id: 1 }]), "www.livelegendhomes.com")!;
    expect(entries.map((entry) => [entry.url, entry.record?.name, entry.record?.street, entry.record?.geo])).toEqual([[COMMUNITY, "Fixture Ranch", "9810 Fixture Way", { lat: 29.5205, lng: -98.3012 }]]);
    expect(legendListingUrl()).toBe("https://api.livelegendhomes.com/api/v1/public-epcon/community/for-legend?limit=1000&division=san-antonio&barebones=false");
  });

  it("resolves the page through by-name-v2, publishes the homes (a pending contract left out, not held), the plan and the Open Door Deal banner scrubbed", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(result.holdReasons).toEqual(["missing_promotional_rate", "missing_apr"]);
    expect(requested[0]).toBe(lookup);
    expect(result.private.homes.map((entry) => [entry.privateName, entry.status, entry.price, entry.previousPrice])).toEqual([["13813 Fixture Lane", "Quick Move-In (Move-In Ready)", 324_990, 358_419], ["13817 Fixture Lane", "Quick Move-In (February 2027)", 339_990, null], ["13821 Fixture Lane", "Pending", 330_000, null], ["13825 Fixture Lane", "Sold", null, null]]);
    expect(result.private.homes[0]!.sourceUrl).toBe(`${COMMUNITY}/quick-move-in-homes/13813-fixture-lane-0055`);
    expect(result.private.plans.map((entry) => [entry.sourceUrl, entry.price])).toEqual([[`${COMMUNITY}/home-plans/the-lakewood`, 357_990]]);
    // The banner's public copy, never the back office's name; the rate wording without a rate is held for a look.
    expect(result.private.incentive?.text).toBe("Open Door Deal. From now until Oct. 31, enjoy limited-time, low-interest rates and closing costs assistance on select homes. See a Legend Home Sales Professional for details.");
    expect(result.incentiveHoldReasons).toContain("missing_promotional_rate");
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78109", "livelegendhomes", "Legend", "Private", "1917040", "InPage", "Redbud"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((entry) => entry.status)).toEqual(["Quick Move-In (Move-In Ready)", "Quick Move-In (February 2027)", "Pending", "Sold"]);
    // An unknown page holds; the apex host is not the official site.
    expect((await loadOfficialDeals({ ...config, sourceUrl: `${HOST}/communities/san-antonio/schertz-cibolo/bexar/converse/not-a-fixture` }, { fetcher, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://livelegendhomes.com/communities/san-antonio/schertz-cibolo/bexar/converse/fixture-ranch" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new LegendHomesAdapter().builder).toBe("Legend Homes");
    expect(DEAL_ADAPTERS["Legend Homes"].builder).toBe("Legend Homes");
  });
});
