import { beforeEach, describe, expect, it, vi } from "vitest";
import { SitterleAdapter, parseSitterleCommunity, sitterleListingEntries, sitterleRecord, sitterleStatus } from "./dealsAdapters.sitterle";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Sitterle community page in the shape the live site (WordPress with
 * Elementor) served in October 2026: listing cards for homes and plans, the
 * community name and address blocks, a Google Maps directions link; and the
 * communities page's result cards. Names and addresses are invented.
 */
const HOST = "https://www.sitterlehomes.com";
const COMMUNITY = `${HOST}/communities/fixture-ranch/`;
const NOW = new Date("2026-10-20T12:00:00Z");
const homeCard = (input: { street: string; slug: string; price: number; was?: number; plan: string; note: string | null; kind?: "inventory" | "construction"; beds: number; baths: number; sqft: number; community?: string; link?: boolean }) => `
<div class="comm--listing-container ${input.kind ?? "inventory"}"><div class="comm--listing-thumbnail-container"><a href="${HOST}/listings/${input.slug}/" target="_blank"><img src="${HOST}/wp-content/uploads/2025/10/${input.slug}.jpg" class="comm--listing-thumbnail" alt=""></a></div><div class="listing--info-container">${input.link === false ? `<span class="result--title">${input.street}</span>` : `<a href="${HOST}/listings/${input.slug}/" class="result--title">${input.street}</a>`}<div><p>in ${input.community ?? "Fixture Ranch"}</p>${input.was ? `<p>Price: <strong class="custom-strikethrough">$${input.was.toLocaleString("en-US")}</strong></p><p>Reduced Price: <strong>$${input.price.toLocaleString("en-US")}</strong></p>` : `<p>Price: <strong>$${input.price.toLocaleString("en-US")}</strong></p>`}<hr class="result--hr"><p>Plan: <strong>${input.plan}</strong></p>${input.note === null ? "" : `<p>Estimated Completion: <span class="comm--custom-note">${input.note}</span></p>`}<hr class="result--hr"><div class="mini-stats-container"><p><strong>${input.beds}</strong><br>Beds</p><p><strong>${input.baths}</strong><br>Baths</p><p><strong>2</strong><br>Car Garage</p><p><strong>${input.sqft.toLocaleString("en-US")}</strong><br>Sq. Ft.</p></div></div></div></div>`;
const planCard = (input: { name: string; price: number; sqft: number; beds: number; baths: number }) => `
<div class="comm--listing-container plan"><div class="comm--listing-thumbnail-container"><a href="${HOST}/plans/${input.name.toLowerCase()}-fixture-ranch/" target="_blank"><img src="${HOST}/wp-content/uploads/2024/01/${input.name.toLowerCase()}-elevation.jpg" class="comm--listing-thumbnail" alt=""></a></div><div class="listing--info-container"><a href="${HOST}/plans/${input.name.toLowerCase()}-fixture-ranch/" class="result--title">${input.name} Plan</a><div><p>in Fixture Ranch</p><p>Price: <strong>$${input.price.toLocaleString("en-US")}</strong></p><p>From ${input.sqft.toLocaleString("en-US")} Sq. Ft.</p><hr class="result--hr"><div class="mini-stats-container"><p><strong>${input.beds}</strong><br>Beds</p><p><strong>${input.baths}</strong><br>Baths</p><p><strong>2</strong><br>Car Garage</p><p><strong>1</strong><br>Stories</p></div></div></div></div>`;
const HOMES = [
  { street: "10141 Fixture Hein", slug: "10141-fixture-hein-ozona-fixture-ranch", price: 445_000, was: 526_730, plan: "Ozona", note: "Available Now", beds: 2, baths: 2, sqft: 1_664 },
  { street: "10145 Fixture Hein", slug: "10145-fixture-hein-tarpley-fixture-ranch", price: 495_000, plan: "Tarpley", note: "Fall 2026", kind: "construction" as const, beds: 3, baths: 3, sqft: 2_195 },
  { street: "10149 Fixture Hein", slug: "10149-fixture-hein-lamesa-fixture-ranch", price: 489_000, plan: "Lamesa", note: "January 2027", kind: "construction" as const, beds: 3, baths: 3.5, sqft: 2_283 },
];
const PLANS = [{ name: "Ozona", price: 420_000, sqft: 1_664, beds: 2, baths: 2 }, { name: "Tarpley", price: 480_000, sqft: 2_195, beds: 3, baths: 3 }];
function communityPage(input: { homes?: typeof HOMES; plans?: typeof PLANS; address?: string | null; name?: boolean; block?: boolean } = {}) {
  return `<!DOCTYPE html><html><head><title>Fixture Ranch | Sitterle Homes</title></head><body>
<div class="elementor-widget"><h1 class="elementor-heading-title">• Fixture Ranch •</h1></div>
${input.address === null ? "" : `<div class="elementor-element comm-page-address elementor-widget"><div class="elementor-widget-container"> ${input.address ?? "10103 Fixture Zimmer, San Antonio, TX 78254, U.S.A."} </div></div>`}
<a href="https://www.google.com/maps/dir//Sitterle+Homes+-+Fixture+Ranch,+10103+Fixture+Zimmer,+San+Antonio,+TX+78254/@29.5371268,-98.7423396,18z/data=!4m8!4m7!1m0?entry=ttu">Get Directions</a>
<p>Students attend Northside ISD schools. Sales Consultant Alan Fixture, 726-260-6767.</p>
${input.name === false ? "" : `<div id="community-name" class="elementor-widget"><div class="elementor-shortcode">Fixture Ranch </div></div>`}
<div id="comm--filter-btns"><button class="comm--inventory-btn">Inventory</button><button class="comm--inventory-btn">Under Construction</button><button class="comm--inventory-btn">Plans</button></div>
${input.block === false ? "" : `<div id="comm--filters-content"><div class="elementor-shortcode"><div class="comm--listings-container"><div id="comm--empty-message" style="display:none;"></div>${(input.homes ?? HOMES).map(homeCard).join("\n")}${(input.plans ?? PLANS).map(planCard).join("\n")}</div></div></div>`}
<h2>Estimate My Monthly Payment</h2>
</body></html>`;
}
const listPage = `<html><body><div id="communities-results">
<div class="single-result-container status-final-opportunity" id="result-id-81350"><div class="result--thumbnail-container"><div class="result--status-flag"><p>Final Opportunity</p></div><a href="${COMMUNITY}" target="_blank"><img class="result--thumbnail" src="${HOST}/wp-content/uploads/x.jpg" alt="thumbnail"></a></div><div class="result--info-container"><div><a class="result--title" href="${COMMUNITY}" target="_blank">Fixture Ranch</a><p class="result--city">San Antonio, TX 78254</p><p class="result--from-the">From the Mid $400's</p></div></div></div>
<div class="single-result-container" id="result-id-2"><div class="result--info-container"><a class="result--title" href="${HOST}/communities/far-fixture/" target="_blank">Far Fixture</a><p class="result--city">Magnolia, TX 77354</p></div></div>
<div class="single-result-container" id="result-id-3"><div class="result--info-container"><a class="result--title" href="https://evil.example/communities/x/" target="_blank">Elsewhere</a><p class="result--city">San Antonio, TX</p></div></div>
</div></body></html>`;

const site: Record<string, string> = { [COMMUNITY]: communityPage() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Sitterle Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Ranch", scrubList: ["Fixture Ranch", "Fixture Hein", "Fixture Zimmer", "Alan Fixture"] };

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Sitterle reader: cards", () => {
  it("reads home cards with their reduced price, plan, completion and stats, and plan cards with their from-price; the address block and map link give the record", () => {
    const parsed = parseSitterleCommunity(communityPage(), COMMUNITY, NOW)!;
    expect(parsed.record).toEqual({ name: "Fixture Ranch", street: "10103 Fixture Zimmer", city: "San Antonio", zip: "78254", phone: null, priceFrom: null, geo: { lat: 29.5371268, lng: -98.7423396 } });
    expect(parsed.cardCount).toBe(3);
    expect(parsed.foreignHome).toBe(false);
    expect(parsed.homes.map((home) => [home.privateAddress, home.privatePlanName, home.status, home.price, home.previousPrice, home.priceDrop, home.bedrooms, home.bathrooms, home.squareFeet, home.garage, home.readyNow, home.moveInDate, home.gallery?.length])).toEqual([
      ["10141 Fixture Hein, San Antonio, TX 78254", "Ozona", "Quick Move-In (Move-In Ready)", 445_000, 526_730, 81_730, 2, 2, 1_664, 2, true, null, 1],
      ["10145 Fixture Hein, San Antonio, TX 78254", "Tarpley", "Quick Move-In (Fall 2026)", 495_000, null, null, 3, 3, 2_195, 2, false, "Fall 2026", 1],
      ["10149 Fixture Hein, San Antonio, TX 78254", "Lamesa", "Quick Move-In (January 2027)", 489_000, null, null, 3, 3.5, 2_283, 2, false, "January 2027", 1],
    ]);
    expect(parsed.homes[0]!.sourceUrl).toBe(`${HOST}/listings/10141-fixture-hein-ozona-fixture-ranch/`);
    expect(parsed.homes[0]!.gallery![0]!.sourceUrl).toBe(`${HOST}/wp-content/uploads/2025/10/10141-fixture-hein-ozona-fixture-ranch.jpg`);
    expect(parsed.plans.map((plan) => [plan.privatePlanName, plan.price, plan.bedrooms, plan.bathrooms, plan.squareFeet, plan.gallery?.[0]?.caption])).toEqual([["Ozona", 420_000, 2, 2, 1_664, "Representative image"], ["Tarpley", 480_000, 3, 3, 2_195, "Representative image"]]);
    expect(parsed.plans[0]!.sourceUrl).toBe(`${HOST}/plans/ozona-fixture-ranch/`);
    expect(parseSitterleCommunity("<html><body>new layout</body></html>", COMMUNITY)).toBeNull();
    expect(parseSitterleCommunity(communityPage({ block: false }), COMMUNITY, NOW)).toBeNull();
    expect(sitterleRecord(communityPage({ address: "28430 Fixture Way, San Antonio, TX, USA" }))).toMatchObject({ street: "28430 Fixture Way", city: "San Antonio", zip: null });
    expect(sitterleRecord(communityPage({ address: null }))).toBeNull();
    expect(sitterleRecord(communityPage({ name: false }))).toBeNull();
    // Status: ready now, a season or month ahead, a past one (no date), sold, unknown wording or none (no status).
    expect(sitterleStatus("Available Now", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(sitterleStatus("Est. Completion: Winter 2027", NOW)).toEqual({ status: "Quick Move-In (Winter 2027)", readyNow: false, moveInDate: "Winter 2027" });
    expect(sitterleStatus("Summer 2026", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(sitterleStatus("Sep 2026", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(sitterleStatus("Sold", NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    for (const word of ["Coming Soon", "TBD", "Pending", "", null]) expect(sitterleStatus(word, NOW)).toEqual({ status: null, readyNow: false, moveInDate: null });
    // A card without its completion note, or without its link, has no status.
    const odd = parseSitterleCommunity(communityPage({ homes: [{ ...HOMES[0]!, note: null }, { ...HOMES[1]!, link: false }] }), COMMUNITY, NOW)!;
    expect(odd.homes.map((home) => home.status)).toEqual([null, null]);
    // A card "in" another community is not this community's.
    expect(parseSitterleCommunity(communityPage({ homes: [{ ...HOMES[0]!, community: "Other Ranch" }] }), COMMUNITY, NOW)!.foreignHome).toBe(true);
  });

  it("lists the communities page's cards with their city lines, never another host", () => {
    const entries = sitterleListingEntries(listPage, "www.sitterlehomes.com")!;
    expect(entries.map((entry) => [entry.url, entry.record.name, entry.record.city, entry.record.zip, entry.record.geo])).toEqual([
      [`${HOST}/communities/fixture-ranch/`, "Fixture Ranch", "San Antonio", "78254", null],
      [`${HOST}/communities/far-fixture/`, "Far Fixture", "Magnolia", "77354", null],
    ]);
    expect(sitterleListingEntries("<html><body>new layout</body></html>", "www.sitterlehomes.com")).toBeNull();
  });
});

describe("Sitterle reader: a community", () => {
  it("reads the page once and publishes homes and plans scrubbed", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes).toHaveLength(3);
    expect(result.private.plans).toHaveLength(2);
    expect(result.private.communityFacts).toMatchObject({ schoolDistrict: "Northside ISD", fromPrice: 420_000 });
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78254", "sitterlehomes", "Sitterle", "Alan", "Ozona", "726-260"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((home) => home.status)).toEqual(["Quick Move-In (Move-In Ready)", "Quick Move-In (Fall 2026)", "Quick Move-In (January 2027)"]);
    // Plans only: a community with nothing move-in ready.
    const plansOnly = vi.fn(async () => new Response(communityPage({ homes: [] }), { status: 200, headers: { "content-type": "text/html" } }));
    const none = await loadOfficialDeals(config, { fetcher: plansOnly, now: () => NOW });
    expect(none.holdReasons).toEqual([]);
    expect(none.private.homes).toEqual([]);
    expect(none.private.plans).toHaveLength(2);
  });

  it("holds the run when the page is not a community page, when a card of another community is listed, when the site is not Sitterle's, or when it cannot be read", async () => {
    const reshaped = vi.fn(async () => new Response("<html><body>new layout</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: reshaped })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noAddress = vi.fn(async () => new Response(communityPage({ address: null }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: noAddress })).holdReasons).toEqual(["expected_community_container_not_found"]);
    // The listing block renamed: a changed shape, never three sold homes.
    const renamed = vi.fn(async () => new Response(communityPage().replaceAll("comm--listings-container", "comm--results").replace('id="comm--filters-content"', 'id="comm--results-content"'), { status: 200, headers: { "content-type": "text/html" } }));
    const held = await loadOfficialDeals(config, { fetcher: renamed });
    expect(held.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(held.public.homes).toEqual([]);
    const foreign = vi.fn(async () => new Response(communityPage({ homes: [HOMES[0]!, { ...HOMES[1]!, community: "Other Ranch" }] }), { status: 200, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: foreign, now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://sitterlehomes.com/communities/fixture-ranch/" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new SitterleAdapter().builder).toBe("Sitterle Homes");
    expect(DEAL_ADAPTERS["Sitterle Homes"].builder).toBe("Sitterle Homes");
  });
});
