import { beforeEach, describe, expect, it, vi } from "vitest";
import { KbHomeAdapter, kbMoveInCount, kbRecord, kbStatus, parseKbArray, parseKbCommunity } from "./dealsAdapters.kbhome";
const NOW = new Date("2026-10-20T12:00:00Z");
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic KB Home community page in the shape the live site served in
 * October 2026: a Place record in a JSON-LD graph, and the inventory as inline
 * `FloorPlanList`, `LocalQMIs` and `LocalMIR` arrays with string numbers.
 * Names and addresses are invented.
 */
const HOST = "https://www.kbhome.com";
const COMMUNITY = `${HOST}/new-homes-san-antonio/fixture-heights`;
const PLANS = [
  { id: 1201202, name: "Plan 1243 Modeled", pricedFrom: "224995", bedroomsMin: "3", bathroomsMin: "2", garagesMin: "2", size: "1243", pageUrl: "/new-homes-san-antonio/fixture-heights/plan-1243-modeled", image: "/globalassets/images/community-images/texas/san-antonio/fixture-heights/floor-plan/exterior-images-front/1243-a-1200x800.jpg" },
  { id: 1201349, name: "Plan 2246", pricedFrom: null, bedroomsMin: "3", bathroomsMin: "2.5", garagesMin: "2", size: "2246", pageUrl: "/new-homes-san-antonio/fixture-heights/plan-2246", image: "/globalassets/images/community-images/texas/san-antonio/fixture-heights/floor-plan/exterior-images-front/2246-c2-1200x800.jpg" },
];
const HOMES = [
  { id: 1373580, address: "4229 Fixture Lee Ln.", price: "281002", bedrooms: "4", bathrooms: "3", garages: "2", size: "2246", homesite: "246", floorPlanLink: "1201349", moveInDateCopy: "Available Now", photos: ["/globalassets/images/community-images/texas/san-antonio/fixture-heights/model-photography/1-custom-fixture-lee-ln-s2608-001.jpg", "/globalassets/images/community-images/texas/san-antonio/fixture-heights/floor-plan/2246-floorplan.jpg"] },
  { id: 1384289, address: "4206 Fixture Lee Ln.", price: "279741", bedrooms: "3", bathrooms: "2", garages: "2", size: "1243", homesite: "045", floorPlanLink: "1201202", moveInDateCopy: "Nov 2026", photos: [] },
];
const plan = (input: typeof PLANS[number]) => ({ specialCopy: null, pricedFrom: input.pricedFrom, stories: "1", pricingHtml: input.pricedFrom ? `From <span class='pl-1'>$${Number(input.pricedFrom).toLocaleString("en-US")}</span>` : "", communityStatus: "", communityPriceStatus: "Call for information", style: "Single Family", floorPlanID: `03018097-F-${input.size}`, title: input.name, size: input.size, bedroomsMax: "5", bedroomsMin: input.bedroomsMin, bathroomsMin: input.bathroomsMin, bathroomsMax: "3", garagesMin: input.garagesMin, garagesMax: "2", thumbnailImage: { image: input.image, caption: "Exterior A", alternateText: "Exterior A", imageId: "1201352" }, communityName: "Fixture Heights - Heritage Collection", communityCityState: "New Braunfels, TX", id: input.id, name: input.name, pageUrl: input.pageUrl, isActive: false });
const home = (input: typeof HOMES[number]) => ({ homesite: input.homesite, floorPlanLink: input.floorPlanLink, amenities: null, size: input.size, stories: "2", bedrooms: input.bedrooms, bathrooms: input.bathrooms, garages: input.garages, style: "Single Family", price: input.price, pricingHtml: `<span class='price'>$${Number(input.price).toLocaleString("en-US")}</span>`, mlsNumber: "1971489", websitePhotos: input.photos.map((image, index) => ({ image, caption: index ? "Floor plan" : "Front exterior", alternateText: "x", imageId: String(index) })), address: input.address, communityName: "Fixture Heights", communityOfficeAddress: "1308 Fixture Ave.", communityOfficePhone: "8305550066", city: "New Braunfels", state: "TX", zipCode: "78130", tract: "10-4", description: { fragments: [{ internalFormat: "<p>See sales counselor for approximate timing required for move-in ready homes.</p>" }] }, moveInDate: "2026-09-01T00:00:00+00:00", moveInDateCopy: input.moveInDateCopy, isTourable: true, pricedFromDisplayText: `$${Number(input.price).toLocaleString("en-US")}`, id: input.id, name: `MIR Lot ${input.homesite}/10-4`, pageUrl: `/new-homes-san-antonio/fixture-heights/mir?homesite=${input.id}`, isActive: false });
const graph = { "@context": "https://schema.org", "@graph": [
  { "@type": "Place", "@id": `${COMMUNITY}#community`, name: "Fixture Heights - Heritage Collection", url: COMMUNITY, address: { "@type": "PostalAddress", streetAddress: "1308 Fixture Ave.", addressLocality: "New Braunfels", addressRegion: "TX", postalCode: "78130", addressCountry: "US" }, telephone: "+1-830-555-0066", geo: { "@type": "GeoCoordinates", latitude: 29.638174786259775, longitude: -98.11239800620231 }, additionalProperty: [{ "@type": "PropertyValue", name: "Nearby school", value: "Fixture Point Elementary" }] },
  { "@type": "Product", "@id": `${COMMUNITY}#homes`, name: "New Homes at Fixture Heights - Heritage Collection", brand: { "@type": "Brand", name: "KB Home" } },
] };

function communityPage(input: { homes?: typeof HOMES; qmis?: boolean; plans?: typeof PLANS; place?: boolean } = {}) {
  const homes = input.homes ?? HOMES;
  const plans = input.plans ?? PLANS;
  return `<!DOCTYPE html><html><head><title>Fixture Heights - Heritage Collection - A New Home Community by KB Home</title>
<script type='application/ld+json'>${JSON.stringify(input.place === false ? { ...graph, "@graph": graph["@graph"].slice(1) } : graph)}</script>
</head><body>
<h1>Fixture Heights - Heritage Collection</h1><p>Students attend Comal ISD schools.</p>
<h2>Move-in ready homes to get you moving.</h2>
${homes.map((entry) => `<h3>${entry.address}</h3>`).join("\n")}
<script> $(document).ready(function() { var url = window.location.href; }); var Plans = ""; var Homes = ""; monthlyPaymentDisclaimer = "&lt;p&gt;KBHS Home Loans, LLC NMLS 1542802&lt;/p&gt;";
FloorPlanList = ${JSON.stringify(plans.map(plan))};
${input.qmis === false ? "" : `LocalQMIs = ${JSON.stringify(homes.map(home))};`}
LocalMIR = ${JSON.stringify(plans.map(plan))}; LocalMIR.length = 0; for (i = 0; i < LocalQMIs.length; i++) { var id = "[x]"; }
</script></body></html>`;
}

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "KB Home", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Heights", scrubList: ["Fixture Heights", "Fixture Lee", "Fixture Ave"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("KB Home reader: page data", () => {
  it("reads the inline arrays: homes with the office's city and ZIP, plan names by id, string numbers, lot, status, photos without the floor plan; plans with their from-price", () => {
    expect(parseKbArray('x = 1; LocalQMIs = [{"a":"]","b":[1,{"c":"\\"}"}]}]; y', "LocalQMIs")).toEqual([{ a: "]", b: [1, { c: "\"}" }] }]);
    expect(parseKbArray("LocalQMIs = [1, 2", "LocalQMIs")).toBeNull();
    expect(parseKbArray("var Homes = \"\";", "LocalQMIs")).toBeNull();
    expect(parseKbArray("LocalQMIs = [1]; FloorPlanList = {}", "FloorPlanList")).toBeNull();
    // An empty initialiser before the real list does not win; two different lists are no list.
    expect(parseKbArray("var LocalQMIs = []; LocalQMIs = [{\"a\":1}];", "LocalQMIs")).toEqual([{ a: 1 }]);
    expect(parseKbArray("LocalQMIs = [{\"a\":1}]; LocalQMIs = [];", "LocalQMIs")).toEqual([{ a: 1 }]);
    expect(parseKbArray("LocalQMIs = [{\"a\":1}]; LocalQMIs = [{\"a\":2}];", "LocalQMIs")).toBeNull();
    expect(kbMoveInCount("<h2>Move-in Ready (3)</h2>")).toBe(3);
    expect(kbMoveInCount("<h2>Move-in ready homes to get you moving.</h2>")).toBeNull();
    // The market navigation counts the whole market; the smaller count is the community's.
    expect(kbMoveInCount("<nav>Move-in Ready (57)</nav><h2>Move-in Ready (3)</h2>")).toBe(3);
    // A nearby-homes strip links other communities' homes; they are not this page's cards.
    expect(parseKbCommunity(communityPage({ homes: [] }).replace("<h2>Move-in ready homes to get you moving.</h2>", `<a href="/new-homes-san-antonio/other-grove/mir?homesite=99">Nearby</a>`), COMMUNITY, NOW)!.renderedHomeLinks).toBe(0);
    const parsed = parseKbCommunity(communityPage(), COMMUNITY, NOW)!;
    expect(parsed.homes.map((entry) => [entry.privateAddress, entry.privatePlanName, entry.status, entry.price, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage, entry.homesite, entry.readyNow, entry.moveInDate, entry.gallery?.length])).toEqual([
      ["4229 Fixture Lee Ln., New Braunfels, TX 78130", "Plan 2246", "Quick Move-In (Move-In Ready)", 281_002, 4, 3, 2_246, 2, "Lot 246", true, null, 1],
      ["4206 Fixture Lee Ln., New Braunfels, TX 78130", "Plan 1243 Modeled", "Quick Move-In (November 2026)", 279_741, 3, 2, 1_243, 2, "Lot 45", false, "November 2026", 0],
    ]);
    expect(parsed.homes[0]!.sourceUrl).toBe(`${COMMUNITY}/mir?homesite=1373580`);
    expect(parsed.homes[0]!.gallery![0]!.sourceUrl).toBe(`${HOST}/globalassets/images/community-images/texas/san-antonio/fixture-heights/model-photography/1-custom-fixture-lee-ln-s2608-001.jpg`);
    expect(parsed.plans.map((entry) => [entry.privatePlanName, entry.price, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.gallery?.[0]?.caption ?? null])).toEqual([["Plan 1243 Modeled", 224_995, 3, 2, 1_243, "Representative image"], ["Plan 2246", null, 3, 2.5, 2_246, "Representative image"]]);
    expect(parsed.plans[1]!.sourceUrl).toBe(`${COMMUNITY}/plan-2246`);
    expect(parsed.record).toEqual({ name: "Fixture Heights - Heritage Collection", street: "1308 Fixture Ave.", city: "New Braunfels", zip: "78130", phone: "8305550066", priceFrom: null, geo: { lat: 29.638174786259775, lng: -98.11239800620231 } });
    expect(kbRecord("<html><body>new layout</body></html>")).toBeNull();
    expect(parseKbCommunity("<html><body>new layout</body></html>", COMMUNITY)).toBeNull();
    // Status words: ready, a month, sold; anything else or none is no status.
    expect(kbStatus("Available Now", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(kbStatus("Est. Completion Dec 2026", NOW)).toEqual({ status: "Quick Move-In (December 2026)", readyNow: false, moveInDate: "December 2026" });
    expect(kbStatus("Sold", NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    // A past month is a stale estimate (no date); "pending" in a date copy is an unknown date, not a sale.
    expect(kbStatus("Sep 2026", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    for (const word of ["Coming Soon", "Call for details", "Date Pending", "", null]) expect(kbStatus(word, NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    // The record reads an array @type too.
    expect(kbRecord(communityPage().replace('"@type":"Place"', '"@type":["Place","LocalBusiness"]'))).toMatchObject({ street: "1308 Fixture Ave." });
    // An entry without an address or link, or with wording the reader does not know, stays in the list with no status.
    const odd = parseKbCommunity(communityPage({ homes: [{ ...HOMES[0]!, address: "" }, { ...HOMES[1]!, moveInDateCopy: "Call for details" }] }), COMMUNITY, NOW)!;
    expect(odd.homes.map((entry) => entry.status)).toEqual([null, null]);
    expect(odd.homes).toHaveLength(2);
    expect(odd.foreignHome).toBe(false);
  });
});

describe("KB Home reader: a community", () => {
  it("reads the page once and publishes homes and plans scrubbed; an empty move-in list is a community with plans only", async () => {
    const result = await loadOfficialDeals(config, { fetcher });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes).toHaveLength(2);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.communityFacts).toMatchObject({ schoolDistrict: "Comal ISD", fromPrice: 224_995 });
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78130", "kbhome", "KB Home", "KBHS", "1373580"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((entry) => entry.status)).toEqual(["Quick Move-In (Move-In Ready)", "Quick Move-In (November 2026)"]);
    const none = vi.fn(async () => new Response(communityPage({ homes: [] }), { status: 200, headers: { "content-type": "text/html" } }));
    const plansOnly = await loadOfficialDeals(config, { fetcher: none });
    expect(plansOnly.holdReasons).toEqual([]);
    expect(plansOnly.private.homes).toEqual([]);
    expect(plansOnly.private.plans).toHaveLength(2);
  });

  it("holds the run when the page is not a community page, when the move-in array is gone, when the site is not KB's, or when it cannot be read", async () => {
    const reshaped = vi.fn(async () => new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // The plans still there but the move-in array renamed: a changed shape, never two sold homes.
    const noQmis = vi.fn(async () => new Response(communityPage({ qmis: false }), { status: 200, headers: { "content-type": "text/html" } }));
    const held = await loadOfficialDeals(config, { fetcher: noQmis });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    // An empty list while the page still renders home links or counts homes is a changed shape, never a sale.
    const emptyButLinked = vi.fn(async () => new Response(communityPage({ homes: [] }).replace("<h2>Move-in ready homes to get you moving.</h2>", `<h2>Move-in Ready (2)</h2><a href="/new-homes-san-antonio/fixture-heights/mir?homesite=1373580">4229 Fixture Lee Ln.</a>`), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: emptyButLinked })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // A home whose page lives under another community's slug is not this community's inventory.
    const foreign = vi.fn(async () => new Response(communityPage().replace("/new-homes-san-antonio/fixture-heights/mir?homesite=1384289", "/new-homes-san-antonio/other-grove/mir?homesite=1384289"), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: foreign })).holdReasons).toEqual(["invalid_inventory_response"]);
    const noPlace = vi.fn(async () => new Response(communityPage({ place: false }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noPlace })).holdReasons).toEqual(["expected_community_container_not_found"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://kbhome.com/new-homes-san-antonio/fixture-heights" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new KbHomeAdapter().builder).toBe("KB Home");
    expect(DEAL_ADAPTERS["KB Home"].builder).toBe("KB Home");
  });
});
