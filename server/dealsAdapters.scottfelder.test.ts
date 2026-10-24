import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScottFelderAdapter, parseScottFelderCommunity, parseScottFelderState, scottFelderAreaSlug, scottFelderListingEntries, scottFelderRecord, scottFelderSlug, scottFelderStatus } from "./dealsAdapters.scottfelder";
import { DEAL_ADAPTERS, loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Synthetic Scott Felder pages in the shape the live site served in October
 * 2026: the whole catalogue in one inline `window.__PRELOADED_STATE__` object,
 * the rendered page showing at most six home cards and a "N Quick Move-In
 * Homes" line. Names, addresses and ids are invented.
 */
const HOST = "https://www.scottfelderhomes.com";
const COMMUNITY = `${HOST}/communities/san-antonio-area/schertzcibolo/fixture-vine`;
const PARENT = `${HOST}/communities/san-antonio-area/san-antonio/fixture-point`;
const BUCKET = "https://s3.amazonaws.com/buildercloud";
const BUILDER = "5702d464f410954eb27d1538";
const NOW = new Date("2026-10-20T15:00:00Z");
const img = (name: string, extra: Record<string, unknown> = {}) => ({ "@type": "ImageObject", contentUrl: `${BUCKET}/${name}.jpeg`, ...extra });
const community = (input: { id: string; name: string; shared: string; area: string; city: string; street: string | null; zip: string; parent?: string; isParent?: boolean; status?: string; headline?: string | null; banner?: string | null; card?: string | null; published?: boolean }) => ({
  _id: input.id, name: input.name, sharedName: input.shared, uniqueName: `${input.shared}-by-scott-felder-homes`, area: input.area, status: input.status ?? "Active", published: input.published ?? true, publishedFAB: true,
  address: { "@type": "PostalAddress", streetAddress: input.street ?? "BOOK BY APPOINTMENT", addressLocality: input.city, addressRegion: "TX", postalCode: input.zip }, telephone: "(210) 555 - 0142",
  geoIndexed: [-98.237159, 29.506923], priceLow: 404_990, priceHigh: 520_990, headline: input.headline === undefined ? "Rates as Low As 3.99%*" : input.headline, custom_banner: input.banner === undefined ? "Rates as Low As 3.99%*" : input.banner,
  card_feature_headline: input.card === undefined ? "Low Fixed Rates + Closing Cost Assistance" : input.card, featured_info: [{ copy: "<ul><li>Resort style pool </li><li>Events pavilion</li></ul>" }],
  schools: [{ name: "Fixture Elementary School" }], builder: BUILDER, ...(input.parent ? { parent_community: input.parent } : {}), ...(input.isParent ? { is_parent_community: true } : {}),
});
const home = (input: { id: string; in: string; street: string; city?: string; zip?: string; price: number; was?: number; status?: string | null; move?: string | null; plan?: string; beds?: number; full?: number; half?: number; sqft?: number; special?: string | null; lot?: boolean; published?: boolean }) => ({
  _id: input.id, "@type": "SingleFamilyResidence", containedIn: input.in, builder: BUILDER, isLot: input.lot ?? false, published: input.published ?? true, publishedFAB: true,
  address: { "@type": "PostalAddress", streetAddress: input.street, addressLocality: input.city ?? "Schertz", addressRegion: "TX", postalCode: input.zip ?? "78154" },
  price: input.price, originalPrice: input.was ?? input.price, status: input.status === undefined ? "Active" : input.status, moveInDate: input.move === undefined ? "2026-06-15T05:00:00.000Z" : input.move,
  plan: input.plan ?? "plan-cam", beds: input.beds ?? 4, bathsFull: input.full ?? 3, bathsHalf: input.half ?? 0, sqft: input.sqft ?? 2_614, garages: 2, stories: 1, geoIndexed: [-98.237159, 29.506923],
  photos: [img(`h-${input.id}-1`), img(`h-${input.id}-2`)], elevationPhotos: [img(`h-${input.id}-1`)], floorplanPhotos: [img(`fp-${input.id}`)],
  special_feature_headline: input.special === undefined ? "Rates as low as 4.99% + $10,000 in Closing Cost" : input.special,
});
const plan = (input: { id: string; name: string; communities: Array<{ id: string; price?: number }>; price: number; hide?: boolean; hiddenIn?: string }) => ({
  _id: input.id, "@type": "ProductModel", name: input.name, uniqueName: `${scottFelderSlug(input.name)}-by-scott-felder-homes`, builder: BUILDER, published: true, price: input.price, priceLow: input.price,
  hide_price: input.hide ?? false, dont_show_price_on_detail: false, beds: 4, bathsFull: 3, bathsHalf: 1, sqft: 2_408, sqftLow: 2_408, sqftHigh: 2_517, garages: 2, garagesLow: 2, garagesHigh: 3, stories: 1,
  communities: input.communities.map((entry) => ({ community: entry.id, communityModelProperties: { feedType: "plan", ...(entry.price ? { price: entry.price, priceLow: entry.price } : {}) } })),
  photos: [img(`p-${input.id}-1`)], elevationPhotos: [img(`p-${input.id}-a`, { caption: "Elevation A", ...(input.hiddenIn ? { hiddenCommunities: { [input.hiddenIn]: true } } : {}) })], floorplanPhotos: [],
});
const COMMUNITIES = [
  community({ id: "c-vine", name: "Fixture Vine", shared: "fixture-vine", area: "Schertz/Cibolo", city: "Schertz", street: "12372 Fixture Petal", zip: "78154" }),
  community({ id: "c-point", name: "Fixture Point", shared: "fixture-point", area: "San Antonio", city: "San Antonio", street: "2110 Fixture Point", zip: "78245", isParent: true, headline: "Grand Opening Savings", banner: null, card: null }),
  community({ id: "c-point-55", name: "Fixture Point 55'", shared: "fixture-point-55", area: "San Antonio", city: "San Antonio", street: "2110 Fixture Point", zip: "78245", parent: "c-point" }),
  community({ id: "c-manor", name: "Fixture Manor", shared: "fixture-manor", area: "San Antonio", city: "San Antonio", street: null, zip: "78256" }),
  community({ id: "c-far", name: "Far Fixture", shared: "far-fixture", area: "Round Rock", city: "Round Rock", street: "100 Far Fixture Way", zip: "78665" }),
  community({ id: "c-hidden", name: "Hidden Fixture", shared: "hidden-fixture", area: "San Antonio", city: "San Antonio", street: "1 Hidden", zip: "78245", published: false }),
];
const HOMES = [
  home({ id: "h1", in: "c-vine", street: "8314 Fixture Circle", price: 559_990, was: 562_990 }),
  home({ id: "h2", in: "c-vine", street: "8157 Fixture Pt.", price: 489_990, status: "Under Construction", move: "2026-11-23T06:00:00.000Z", plan: "plan-ham", beds: 5, full: 4, half: 1, sqft: 3_010 }),
  home({ id: "h3", in: "c-vine", street: "8160 Fixture Pt.", price: 470_000, status: "Under Construction", move: "2026-09-12T05:00:00.000Z" }),
  home({ id: "h4", in: "c-vine", street: "8162 Fixture Pt.", price: 471_000, status: "Active", move: "2027-01-01T06:00:00.000Z" }),
  home({ id: "h5", in: "c-vine", street: "8164 Fixture Pt.", price: 0, status: "Sold", move: null, special: null }),
  home({ id: "h6", in: "c-vine", street: "Lot 12", price: 99_000, lot: true }),
  home({ id: "h7", in: "c-vine", street: "8166 Fixture Pt.", price: 472_000, published: false }),
  home({ id: "h8", in: "c-point-55", street: "2130 Fixture Point", city: "San Antonio", zip: "78245", price: 512_000, status: "Under Construction", move: "2027-03-10T05:00:00.000Z", plan: "plan-ham" }),
  home({ id: "h9", in: "c-far", street: "101 Far Fixture Way", city: "Round Rock", zip: "78665", price: 400_000 }),
];
const PLANS = [
  plan({ id: "plan-cam", name: "Cameron", communities: [{ id: "c-vine", price: 414_990 }, { id: "c-far" }], price: 339_990 }),
  plan({ id: "plan-ham", name: "Hamilton", communities: [{ id: "c-point-55" }, { id: "c-vine" }], price: 445_990, hiddenIn: "c-vine" }),
  plan({ id: "plan-hid", name: "Quiet", communities: [{ id: "c-vine" }], price: 300_000, hide: true }),
  plan({ id: "plan-far", name: "Elsewhere", communities: [{ id: "c-far" }], price: 320_000 }),
];
const state = (input: { communities?: unknown[]; homes?: unknown[]; plans?: unknown[] } = {}) => JSON.stringify({
  compare: {}, favorites: {}, router: { location: { pathname: "/" } },
  filters: { AreaMetro: [{ label: "San Antonio Area", value: { subMetros: ["New Braunfels", "Boerne", "San Antonio", "Schertz/Cibolo"] } }] },
  cloudData: { communities: { [BUILDER]: { data: input.communities ?? COMMUNITIES } }, homes: { [BUILDER]: { data: input.homes ?? HOMES } }, plans: { [BUILDER]: { data: input.plans ?? PLANS } }, agents: { [BUILDER]: { data: [{ name: "Private Agent" }] } } },
});
const card = (path: string, street: string, label: string) => `<div class="HomeCard__wrapper"><a class="HomeCard__mediaImage" href="${path}"><img src="https://dlqxt4mfnxo6k.cloudfront.net/x" alt=""/></a><h4 class="HomeCard__headline">Rates as low as 4.99% + $10,000 in Closing Cost</h4><h4><a class="HomeCard__name d-flex flex-column" href="${path}"><!-- react-text: 1 -->${street}<!-- /react-text --><span class="HomeCard__city">Schertz, TX 78154</span></a></h4><div class="HomeOverview__moveInWrapper"><h4 class="HomeOverview__moveIn mb-0">${label}</h4></div></div>`;
function page(input: { heading?: string; cards?: string; count?: string; body?: string; stateJson?: string } = {}) {
  const base = "/homes/san-antonio-area/schertzcibolo/fixture-vine";
  const cards = input.cards ?? [card(`${base}/8314-fixture-circle`, "8314 Fixture Circle", "Ready Now!"), card(`${base}/8157-fixture-pt`, "8157 Fixture Pt.", "available - November"), card(`${base}/8160-fixture-pt`, "8160 Fixture Pt.", "Ready Now!")].join("");
  return `<!DOCTYPE html><html><head><title>Fixture Vine | Schertz New Home Community</title></head><body><div id="root"><div class="HeaderPromoBanner_highlightedHeadline">Rates as Low As 3.99%*</div><h1 class="CommunityHeader__title"><!-- react-text: 2 -->${input.heading ?? "Fixture Vine"}<!-- /react-text --><span>12372 Fixture Petal</span><span>Schertz, TX 78154</span></h1><p>Area Schertz/Cibolo 8 Available Floor Plans ${input.count ?? "4 Quick Move-In Homes"} Rates as Low As 3.99%*</p><p>Students attend Schertz-Cibolo-Universal City ISD schools.</p>${cards}${input.body ?? ""}<a href="/plan/fixture-vine/cameron">Cameron</a></div><script>window.__PRELOADED_STATE__ = ${input.stateJson ?? state()};</script></body></html>`;
}
const marketPage = `<!DOCTYPE html><html><head><title>San Antonio Area New Homes</title></head><body><div id="root"><h1>San Antonio AreaCommunities</h1><a href="/communities/austin-area">Austin</a><a href="/communities/san-antonio-area">San Antonio</a>
<div class="CommunityCard__wrapper"><a href="/communities/san-antonio-area/schertzcibolo/fixture-vine">Fixture Vine</a><a href="/communities/san-antonio-area/schertzcibolo/fixture-vine#plans">Plans</a><a href="/communities/san-antonio-area/schertzcibolo/fixture-vine#homes">Homes</a></div>
<div class="CommunityCard__wrapper"><a href="/communities/san-antonio-area/san-antonio/fixture-point">Fixture Point</a><a href="/communities/san-antonio-area/san-antonio/fixture-point#overview">Overview</a></div>
<div class="CommunityCard__wrapper"><a href="/communities/san-antonio-area/san-antonio/fixture-manor">Fixture Manor</a></div>
<div class="CommunityCard__wrapper"><a href="/communities/san-antonio-area/san-antonio/unknown-fixture">Unknown</a></div>
<div class="CommunityCard__wrapper"><a href="/communities/san-antonio-area/san-antonio/hidden-fixture">Hidden</a></div>
<a href="https://evil.example/communities/san-antonio-area/san-antonio/fixture-point">x</a></div><script>window.__PRELOADED_STATE__ = ${state()};</script></body></html>`;

const site: Record<string, string> = { [COMMUNITY]: page() };
const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const body = site[input];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
});
const config: CommunitySourceConfig = { builder: "Scott Felder Homes", sourceUrl: COMMUNITY, privateCommunityName: "Fixture Vine", scrubList: ["Fixture Vine", "Fixture Petal", "Fixture Circle", "Fixture Pt"] };
const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

beforeEach(() => { vi.clearAllMocks(); requested.length = 0; });

describe("Scott Felder reader: statuses and slugs", () => {
  it("reads 'Active' and 'Under Construction' against the move-in date, sells only sold wording, and gives no status to the rest", () => {
    expect(scottFelderStatus("Active", "2026-06-15T05:00:00.000Z", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(scottFelderStatus("Active", "2026-10-20T05:00:00.000Z", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    expect(scottFelderStatus("Active", "2026-10-27T05:00:00.000Z", NOW)).toEqual({ status: "Quick Move-In (October 2026)", readyNow: false, moveInDate: "October 2026" });
    expect(scottFelderStatus("Active", "2027-01-01T06:00:00.000Z", NOW)).toEqual({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    // No usable date: a quick move-in, not a ready one.
    expect(scottFelderStatus("Active", null, NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(scottFelderStatus("Active", "soon", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(scottFelderStatus("Under Construction", "2026-11-23T06:00:00.000Z", NOW)).toEqual({ status: "Quick Move-In (November 2026)", readyNow: false, moveInDate: "November 2026" });
    // The site says "Ready Now!" once the estimate has passed, but the status still says under construction.
    expect(scottFelderStatus("Under Construction", "2026-09-12T05:00:00.000Z", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(scottFelderStatus("Under Construction", null, NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(scottFelderStatus("Sold", null, NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    expect(scottFelderStatus("Under Contract", "2026-11-01T05:00:00.000Z", NOW)).toEqual({ status: "Sold", readyNow: false, moveInDate: null });
    for (const label of ["Pending", "Model", "Coming Soon", "Available"]) expect(scottFelderStatus(label, "2026-06-15T05:00:00.000Z", NOW).status).toBeNull();
    // A blank status is rendered by its date, as "Active" (9822 Brivet Creek: "", August, "Ready Now!" on its page).
    for (const label of [null, "", "  "]) expect(scottFelderStatus(label, "2026-08-27T05:00:00.000Z", NOW)).toEqual({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
    // A date decades out is not a move-in estimate.
    expect(scottFelderStatus("Active", "2099-01-01T00:00:00.000Z", NOW)).toEqual({ status: "Quick Move-In", readyNow: false, moveInDate: null });
    expect(scottFelderSlug("8157 Fixture Pt.")).toBe("8157-fixture-pt");
    expect(scottFelderSlug("Santa Rita Ranch 70'")).toBe("santa-rita-ranch-70");
    expect(scottFelderSlug("The Cameron")).toBe("the-cameron");
  });

  it("reads the inline state by matching braces outside strings", () => {
    expect(parseScottFelderState(page())).toMatchObject({ cloudData: expect.any(Object) });
    expect(parseScottFelderState(`<script>window.__PRELOADED_STATE__ = {"a":"}{","b":[1,{"c":"\\"}"}]};</script>`)).toEqual({ a: "}{", b: [1, { c: '"}' }] });
    expect(parseScottFelderState("<script>window.__PRELOADED_STATE__ = {broken</script>")).toBeNull();
    expect(parseScottFelderState("<html></html>")).toBeNull();
  });
});

describe("Scott Felder reader: page data", () => {
  it("reads the community's homes and plans from the state: statuses from the move-in date, prices with the drop, specs, plan names, photos from the bucket only; lots, unpublished and other communities' rows left out", () => {
    const parsed = parseScottFelderCommunity(page(), COMMUNITY, NOW)!;
    expect(parsed.record).toEqual({ name: "Fixture Vine", street: "12372 Fixture Petal", city: "Schertz", zip: "78154", phone: "2105550142", priceFrom: 404_990, geo: { lat: 29.506923, lng: -98.237159 } });
    expect(parsed.communityId).toBe("c-vine");
    expect(parsed.communityStatus).toBe("Active");
    expect(parsed.shapeIntact).toBe(true);
    expect(parsed.foreignHome).toBe(false);
    expect(parsed.statedHomeCount).toBe(4);
    const base = "/homes/san-antonio-area/schertzcibolo/fixture-vine";
    expect(parsed.homes.map((entry) => [entry.sourceUrl.replace(HOST, ""), entry.privateName, entry.privatePlanName, entry.status, entry.readyNow, entry.moveInDate, entry.price, entry.previousPrice, entry.priceDrop, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage])).toEqual([
      [`${base}/8314-fixture-circle`, "8314 Fixture Circle", "Cameron", "Quick Move-In (Move-In Ready)", true, null, 559_990, 562_990, 3_000, 4, 3, 2_614, 2],
      [`${base}/8157-fixture-pt`, "8157 Fixture Pt.", "Hamilton", "Quick Move-In (November 2026)", false, "November 2026", 489_990, null, null, 5, 4.5, 3_010, 2],
      [`${base}/8160-fixture-pt`, "8160 Fixture Pt.", "Cameron", "Quick Move-In", false, null, 470_000, null, null, 4, 3, 2_614, 2],
      [`${base}/8162-fixture-pt`, "8162 Fixture Pt.", "Cameron", "Quick Move-In (January 2027)", false, "January 2027", 471_000, null, null, 4, 3, 2_614, 2],
      [`${base}/8164-fixture-pt`, "8164 Fixture Pt.", "Cameron", "Sold", false, null, null, null, null, 4, 3, 2_614, 2],
    ]);
    expect(parsed.homes[0]).toMatchObject({ privateAddress: "8314 Fixture Circle, Schertz, TX 78154", geo: { latitude: 29.506923, longitude: -98.237159 } });
    // Photos: the bucket's, each once, floor-plan drawings left out.
    expect(parsed.homes[0]!.gallery!.map((image) => image.sourceUrl)).toEqual([`${BUCKET}/h-h1-1.jpeg`, `${BUCKET}/h-h1-2.jpeg`]);
    // Plans placed in this community, priced for it; a hidden price is not read; a rendering hidden for this community is not shown.
    expect(parsed.plans.map((entry) => [entry.sourceUrl.replace(HOST, ""), entry.privatePlanName, entry.price, entry.bedrooms, entry.bathrooms, entry.squareFeet, entry.garage, entry.gallery!.map((image) => image.sourceUrl.replace(BUCKET, ""))])).toEqual([
      ["/plan/fixture-vine/cameron", "Cameron", 414_990, 4, 3.5, 2_408, 2, ["/p-plan-cam-a.jpeg", "/p-plan-cam-1.jpeg"]],
      ["/plan/fixture-vine/hamilton", "Hamilton", 445_990, 4, 3.5, 2_408, 2, ["/p-plan-ham-1.jpeg"]],
      ["/plan/fixture-vine/quiet", "Quiet", null, 4, 3.5, 2_408, 2, ["/p-plan-hid-a.jpeg", "/p-plan-hid-1.jpeg"]],
    ]);
    // One banner is the offer; the per-home labels never join it.
    expect(parsed.offer).toBe("Rates as Low As 3.99%.");
    expect(parseScottFelderCommunity(page({ stateJson: state({ communities: COMMUNITIES.map((row) => row._id === "c-vine" ? { ...row, headline: null, custom_banner: "  ", card_feature_headline: "$10,000 Closing Cost Assistance! Call (210) 555-0142 to book." } : row) }) }), COMMUNITY, NOW)!.offer).toBe("$10,000 Closing Cost Assistance! Call to book.");
    // The site marks a model home only in its label: not for sale.
    const model = parseScottFelderCommunity(page({ stateJson: state({ homes: [...HOMES, home({ id: "h11", in: "c-vine", street: "6023 Fixture Park", price: 500_000, special: "Model Home Available" })] }) }), COMMUNITY, NOW)!;
    expect(model.homes.at(-1)).toMatchObject({ status: "Model", readyNow: false, moveInDate: null });
    expect(model.offer).toBe("Rates as Low As 3.99%.");
    // The builder's homes and plans collections must be there as arrays; a missing one is a changed page, never zero homes.
    const noHomes = JSON.parse(state()); delete noHomes.cloudData.homes;
    expect(parseScottFelderCommunity(page({ cards: "", count: "", stateJson: JSON.stringify(noHomes) }), COMMUNITY, NOW)).toMatchObject({ shapeIntact: false, homes: [] });
    const noPlans = JSON.parse(state()); noPlans.cloudData.plans = { [BUILDER]: { data: "x" } };
    expect(parseScottFelderCommunity(page({ stateJson: JSON.stringify(noPlans) }), COMMUNITY, NOW)!.shapeIntact).toBe(false);
    const emptyHomes = JSON.parse(state()); emptyHomes.cloudData.homes = { [BUILDER]: { data: [] } };
    expect(parseScottFelderCommunity(page({ cards: "", count: "0 Quick Move-In Homes", stateJson: JSON.stringify(emptyHomes) }), COMMUNITY, NOW)).toMatchObject({ shapeIntact: true, homes: [] });
    // A rendered card for a lot is neither a changed page nor another community's.
    expect(parseScottFelderCommunity(page({ cards: card("/homes/san-antonio-area/schertzcibolo/fixture-vine/lot-12", "Lot 12", "Ready Now!") }), COMMUNITY, NOW)).toMatchObject({ shapeIntact: true, foreignHome: false });
    expect(scottFelderAreaSlug("Schertz/Cibolo")).toBe("schertzcibolo");
    expect(scottFelderAreaSlug("New Braunfels")).toBe("new-braunfels");
    expect(parsed.facts).toEqual({ fromPrice: 404_990, schoolDistrict: "Schertz-Cibolo-Universal City ISD", amenities: ["Resort style pool", "Events pavilion"] });
  });

  it("shows a parent community its sub-communities' homes and plans under their own slugs", () => {
    const parsed = parseScottFelderCommunity(page({ heading: "Fixture Point", cards: "", count: "1 Quick Move-In Homes" }), PARENT, NOW)!;
    expect(parsed.record?.name).toBe("Fixture Point");
    expect(parsed.homes.map((entry) => [entry.sourceUrl.replace(HOST, ""), entry.status])).toEqual([["/homes/san-antonio-area/san-antonio/fixture-point-55/2130-fixture-point", "Quick Move-In (March 2027)"]]);
    expect(parsed.plans.map((entry) => entry.sourceUrl.replace(HOST, ""))).toEqual(["/plan/fixture-point-55/hamilton"]);
    expect(parsed.offer).toBe("Grand Opening Savings.");
    // A sub-community in another sub-market keeps its own sub-market in its homes' URLs.
    const elsewhere = parseScottFelderCommunity(page({ heading: "Fixture Point", cards: "", count: "1 Quick Move-In Homes", stateJson: state({ communities: COMMUNITIES.map((row) => row._id === "c-point-55" ? { ...row, area: "Boerne" } : row) }) }), PARENT, NOW)!;
    expect(elsewhere.homes.map((entry) => entry.sourceUrl.replace(HOST, ""))).toEqual(["/homes/san-antonio-area/boerne/fixture-point-55/2130-fixture-point"]);
  });

  it("keeps an unreadable home with no status, and tells a changed page, a foreign card and the market page apart", () => {
    const blank = parseScottFelderCommunity(page({ stateJson: state({ homes: [...HOMES, home({ id: "h10", in: "c-vine", street: "", price: 500_000 })] }) }), COMMUNITY, NOW)!;
    expect(blank.homes.at(-1)).toMatchObject({ sourceUrl: `${COMMUNITY}/unreadable-5`, privateName: null, status: null });
    // A card the state does not have under this community: the page changed shape.
    const reshaped = parseScottFelderCommunity(page({ cards: card("/homes/san-antonio-area/schertzcibolo/fixture-vine/9999-new-fixture", "9999 New Fixture", "Ready Now!") }), COMMUNITY, NOW)!;
    expect(reshaped.shapeIntact).toBe(false);
    expect(reshaped.foreignHome).toBe(false);
    // A card under another community's slug.
    const foreign = parseScottFelderCommunity(page({ cards: card("/homes/san-antonio-area/boerne/other-fixture/1-other", "1 Other", "Ready Now!") }), COMMUNITY, NOW)!;
    expect(foreign.foreignHome).toBe(true);
    expect(foreign.shapeIntact).toBe(true);
    // An unknown path renders the market page with the same state: the heading gives it away.
    expect(parseScottFelderCommunity(page({ heading: "San Antonio AreaCommunities" }), COMMUNITY, NOW)!.record).toBeNull();
    expect(parseScottFelderCommunity(page(), `${HOST}/communities/san-antonio-area/schertzcibolo/not-a-fixture`, NOW)!.record).toBeNull();
    // The same slug under another sub-market is another community's page, or none.
    expect(parseScottFelderCommunity(page(), `${HOST}/communities/san-antonio-area/boerne/fixture-vine`, NOW)!.record).toBeNull();
    expect(parseScottFelderCommunity(page(), `${HOST}/communities/san-antonio-area/san-antonio/hidden-fixture`, NOW)!.record).toBeNull();
    expect(parseScottFelderCommunity("<html><body>new layout</body></html>", COMMUNITY, NOW)).toBeNull();
    expect(scottFelderRecord(page(), COMMUNITY)).toMatchObject({ street: "12372 Fixture Petal" });
    // "BOOK BY APPOINTMENT" is not a sales address.
    expect(scottFelderRecord(page({ heading: "Fixture Manor" }), `${HOST}/communities/san-antonio-area/san-antonio/fixture-manor`)).toMatchObject({ name: "Fixture Manor", street: null, geo: { lat: 29.506923, lng: -98.237159 } });
  });

  it("lists the market page's communities with their records from the state, never another host, an unknown slug, an unpublished community or a sub-community", () => {
    const withChild = marketPage.replace("</div>\n<a href=\"https://evil.example", `<a href="/communities/san-antonio-area/san-antonio/fixture-point-55">Fixture Point 55'</a></div>\n<a href="https://evil.example`);
    expect(withChild).not.toBe(marketPage);
    const entries = scottFelderListingEntries(withChild, "www.scottfelderhomes.com")!;
    expect(entries.map((entry) => [entry.url.replace(HOST, ""), entry.record?.name, entry.record?.street, entry.record?.city, entry.record?.phone, entry.record?.priceFrom, entry.record?.geo])).toEqual([
      ["/communities/san-antonio-area/schertzcibolo/fixture-vine", "Fixture Vine", "12372 Fixture Petal", "Schertz", "2105550142", 404_990, { lat: 29.506923, lng: -98.237159 }],
      ["/communities/san-antonio-area/san-antonio/fixture-point", "Fixture Point", "2110 Fixture Point", "San Antonio", "2105550142", 404_990, { lat: 29.506923, lng: -98.237159 }],
      ["/communities/san-antonio-area/san-antonio/fixture-manor", "Fixture Manor", null, "San Antonio", "2105550142", 404_990, { lat: 29.506923, lng: -98.237159 }],
    ]);
    expect(scottFelderListingEntries("<html></html>", "www.scottfelderhomes.com")).toBeNull();
    expect(scottFelderListingEntries(`<html><body><script>window.__PRELOADED_STATE__ = ${state()};</script></body></html>`, "www.scottfelderhomes.com")).toBeNull();
  });
});

describe("Scott Felder reader: a community", () => {
  it("reads the page once and publishes the homes, plans and the banner offer scrubbed; the banner rate without its APR is held for a look", async () => {
    const result = await loadOfficialDeals(config, { fetcher, now: () => NOW });
    expect(result.catalogOk).toBe(true);
    expect(requested).toEqual([COMMUNITY]);
    expect(result.private.homes).toHaveLength(5);
    expect(result.private.plans).toHaveLength(3);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 404_990, schoolDistrict: "Schertz-Cibolo-Universal City ISD", amenities: ["Resort style pool", "Events pavilion"] });
    expect(result.private.incentive?.text).toBe("Rates as Low As 3.99%.");
    expect(result.private.incentive?.facts).toMatchObject({ promotionalRatePercent: 3.99, aprPercent: null });
    expect(result.incentiveHoldReasons).toContain("missing_apr");
    const json = JSON.stringify(result.public);
    for (const secret of ["Fixture", "78154", "scottfelder", "Scott Felder", "buildercloud", "Private Agent"]) expect(json).not.toContain(secret);
    expect(result.public.homes.map((entry) => [entry.status, entry.price])).toEqual([["Quick Move-In (Move-In Ready)", 559_990], ["Quick Move-In (November 2026)", 489_990], ["Quick Move-In", 470_000], ["Quick Move-In (January 2027)", 471_000], ["Sold", null]]);
    expect(result.private.homes.map((entry) => [entry.status, entry.readyNow, entry.moveInDate, entry.price])).toEqual([
      ["Quick Move-In (Move-In Ready)", true, null, 559_990],
      ["Quick Move-In (November 2026)", false, "November 2026", 489_990],
      ["Quick Move-In", false, null, 470_000],
      ["Quick Move-In (January 2027)", false, "January 2027", 471_000],
      ["Sold", false, null, null],
    ]);
  });

  it("publishes nothing for a sold-out community, and holds the run on an unknown community status", async () => {
    const soldOut = vi.fn(async () => html(page({ stateJson: state({ communities: COMMUNITIES.map((row) => row._id === "c-vine" ? { ...row, status: "Sold Out" } : row) }) })));
    const none = await loadOfficialDeals(config, { fetcher: soldOut, now: () => NOW });
    expect(none.holdReasons).toEqual([]);
    expect(none.private.homes).toEqual([]);
    expect(none.private.plans).toEqual([]);
    expect(none.private.incentive).toBeNull();
    const odd = vi.fn(async () => html(page({ stateJson: state({ communities: COMMUNITIES.map((row) => row._id === "c-vine" ? { ...row, status: "Paused" } : row) }) })));
    expect((await loadOfficialDeals(config, { fetcher: odd, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const blank = vi.fn(async () => html(page({ stateJson: state({ communities: COMMUNITIES.map((row) => row._id === "c-vine" ? { ...row, status: null } : row) }) })));
    expect((await loadOfficialDeals(config, { fetcher: blank, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const noHomes = JSON.parse(state()); delete noHomes.cloudData.homes;
    const missing = vi.fn(async () => html(page({ cards: "", count: "", stateJson: JSON.stringify(noHomes) })));
    expect((await loadOfficialDeals(config, { fetcher: missing, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
  });

  it("holds the run when the page is not this community's, when a card is not in the state, when a card is another community's, when the page states more homes than the state has, when the site is not Scott Felder's, or when it cannot be read", async () => {
    const market = vi.fn(async () => html(page({ heading: "San Antonio AreaCommunities" })));
    expect((await loadOfficialDeals(config, { fetcher: market, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const reshaped = vi.fn(async () => html("<html><body>new layout</body></html>"));
    expect((await loadOfficialDeals(config, { fetcher: reshaped, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const newCard = vi.fn(async () => html(page({ cards: card("/homes/san-antonio-area/schertzcibolo/fixture-vine/9999-new-fixture", "9999 New Fixture", "Ready Now!") })));
    expect((await loadOfficialDeals(config, { fetcher: newCard, now: () => NOW })).holdReasons).toEqual(["expected_community_container_not_found"]);
    const foreign = vi.fn(async () => html(page({ cards: card("/homes/san-antonio-area/boerne/other-fixture/1-other", "1 Other", "Ready Now!") })));
    expect((await loadOfficialDeals(config, { fetcher: foreign, now: () => NOW })).holdReasons).toEqual(["invalid_inventory_response"]);
    const more = vi.fn(async () => html(page({ count: "9 Quick Move-In Homes" })));
    expect((await loadOfficialDeals(config, { fetcher: more, now: () => NOW })).holdReasons).toEqual(["incomplete_inventory"]);
    // A home without a readable address keeps its place with no status: the sync holds the run.
    const blank = vi.fn(async () => html(page({ stateJson: state({ homes: [...HOMES, home({ id: "h10", in: "c-vine", street: "", price: 500_000 })] }) })));
    const held = await loadOfficialDeals(config, { fetcher: blank, now: () => NOW });
    expect(held.private.homes).toHaveLength(6);
    expect(held.private.homes.at(-1)?.status).toBeNull();
    expect((await loadOfficialDeals({ ...config, sourceUrl: "https://scottfelderhomes.com/communities/san-antonio-area/schertzcibolo/fixture-vine" }, { fetcher })).holdReasons).toEqual(["unsupported_official_host"]);
    const down = vi.fn(async () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }));
    expect((await loadOfficialDeals(config, { fetcher: down })).holdReasons).toEqual(["community_fetch_failed"]);
  });

  it("is an adapter the registry knows", () => {
    expect(new ScottFelderAdapter().builder).toBe("Scott Felder Homes");
    expect(DEAL_ADAPTERS["Scott Felder Homes"].builder).toBe("Scott Felder Homes");
  });
});
