
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealIncentives } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import type { CommunitySourceConfig, DealAdapterResult, HtmlFetcher } from "./dealsAdapters";

/**
 * offerRead for the Pulte group closeout path: real readers on fixture pages, the sync and catalog on the fake DB.
 * A community with no page of its own takes the brand's offer read within the hour, including a read that showed none.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), sendBuilderDealsEmail: vi.fn(), refreshCommunityGeography: vi.fn(), processDealPhoto: vi.fn(), processPendingDealPhotos: vi.fn(), fetcher: null as HtmlFetcher | null, snapshot: null as DealAdapterResult | null }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapGeometry: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsPhotos", () => ({ processDealPhoto: (...args: unknown[]) => mocks.processDealPhoto(...args), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));
// The real readers, fed by a fixture fetcher; a test may instead hand the sync a fixed snapshot.
vi.mock("./dealsAdapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("./dealsAdapters")>();
  return { ...original, loadOfficialDeals: (config: CommunitySourceConfig, options: Record<string, unknown> = {}) => mocks.snapshot ? Promise.resolve(mocks.snapshot) : original.loadOfficialDeals(config, { ...options, fetcher: mocks.fetcher! }) };
});

import { refreshOfficialDeals } from "./dealsSync";
import { saveIncentiveForCommunity } from "./dealsSyncAdmin";
import { publicDealsCatalog } from "./dealsService";
import { resetPulteGroupCaches } from "./dealsAdapters.pultegroup";

let db: FakeDealsDb;
beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true });
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: true });
  mocks.processDealPhoto.mockResolvedValue({ ok: true });
  mocks.processPendingDealPhotos.mockResolvedValue({ processed: 0, retried: 0, skipped: 0 });
  mocks.snapshot = null;
  resetPulteGroupCaches();
});
afterEach(() => { vi.clearAllMocks(); });

type Row = typeof dealIncentives.$inferSelect;
const incentiveRows = () => db.rows(dealIncentives) as Row[];
const emails = () => mocks.sendBuilderDealsEmail.mock.calls.map((call) => call[0] as { category: string; subject: string; content: string });

// ---- Pulte group fixture (the shape of dealsAdapters.pultegroup.test.ts) ----
const HOST = "www.centex.com";
const URL_R = `https://${HOST}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073`;
const URL_Z = `https://${HOST}/homes/texas/san-antonio/san-antonio/fixture-bluff-211075`;
const LISTING = `https://${HOST}/API/Community/Search?State=Texas&Region=San%20Antonio&Brand=Centex&JsonFormat=true&pageSize=0`;
const listing = JSON.stringify([
  { id: 211073, name: "Fixture Ridge", status: "Quick Move-Ins Available", brandName: "Centex", address: { street1: "13607 Fixture Way", street2: "", zipCode: "78245", city: "San Antonio", state: "Texas" }, latitude: 29.39, longitude: -98.72, isCommunityActive: true, pageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073", salesPhoneNumber: "(210) 555-0100", startingFromPrice: 251_490, schoolDistrictLabel: null, inventoryCount: 1, planCount: 1 },
  // A closeout between phases: still listed, nothing for sale this week.
  { id: 211075, name: "Fixture Bluff", status: "Closeout", brandName: "Centex", address: { street1: "1 Fixture Bluff", street2: "", zipCode: "78245", city: "San Antonio", state: "Texas" }, latitude: 29.4, longitude: -98.7, isCommunityActive: true, pageURL: "/homes/texas/san-antonio/san-antonio/fixture-bluff-211075", salesPhoneNumber: null, startingFromPrice: 260_000, schoolDistrictLabel: null, inventoryCount: 0, planCount: 0 },
]);
const qmis = JSON.stringify([
  { inventoryHomeID: 1154490, communityId: 211073, communityName: "Fixture Ridge", brandName: "Centex", planId: 699869, planName: "Livingston", address: { street1: "13723 Fixture Pass", street2: "", zipCode: "78245", city: "San Antonio", state: "Texas" }, bedrooms: 3, bathrooms: 2, halfBaths: 0, totalBaths: 2, squareFeet: 1_438, floors: 1, garages: 2, lotBlock: "01505", dateAvailable: "Available Now", price: 289_790, priceDiscount: 15_000, finalPrice: 274_790, soldDate: null, qmiFlagName: "Special Financing Available", inventoryPageURL: "/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/livingston-699869/1154490", images: [] },
]);
const disclaimer = `<a href="#" class="popover-close-btn"><i class="icon-close" aria-label="close"></i></a> <h4 class="SpecialOffersV2__popover-title">Disclaimer</h4> <p><p>*&quot;Savings Up To&quot; offer available on new purchase agreements for select quick move-in homes that are accepted by builder by 10/31/2026. Offer is subject to change or withdrawal at any time without notice. Amount of savings varies by home and community.&nbsp; Community Association fees required. &copy;2026 PulteGroup, Inc. and/or its affiliates. All rights reserved.</p> <p>*Example based on new contracts signed and financing through Pulte Mortgage LLC (NMLS 1791), based on a FHA 30 year fixed mortgage, sales price $349,000, loan amount $342,678 (includes upfront mortgage insurance premium) with a 3.5% down payment and interest rate of 4.75%/5.58% APR, effective 10/2/26. Rate based on FICO score of 700 and a primary residence only. Loans must be locked and closed by 10/31/26. Monthly payment of $2,555 includes principal, interest, mortgage insurance, estimated taxes and insurance. Loans subject to lender approval. Pulte Mortgage is an Equal Opportunity Lender. Licensing information: secure.pultemortgage.com/information/contactus.aspx or <a href="http://www.nmlsconsumeraccess.org/" target="_blank">www.nmlsconsumeraccess.org</a>. [October 2026]</p> </p>`;
const homePage = `<!doctype html><html><head><title>13723 Fixture Pass | Centex</title></head><body><main><h1>13723 Fixture Pass</h1>
<div class="SpecialOffersV2__wrapper"><div class="SpecialOffersV2__carousel-container"><div id="SpecialOffersV2__carousel" class="SpecialOffersV2__carousel owl-carousel">
<div class="SpecialOffersV2__content d-sm-flex"><div class="SpecialOffersV2__slide"><h4 class="SpecialOffersV2__title mt-0 mb-md-3"> <span>More to Love This Fall</span> <button id="SpecialOffersV2__disclaimer" class="SpecialOffersV2__disclaimer PopoverBtn" data-popover="true" data-html="true" role="button" data-content='${disclaimer}'> <span>i</span> </button> </h4> <div class="SpecialOffersV2__description flex-sm-grow-1 mb-4"> Make your move this fall and save up to $43,000 on select Centex homes, plus take advantage of an FHA 30-year fixed rate as low as 4.75% / 5.58% APR. Explore available homes and limited-time savings through October 31. </div></div></div>
</div></div></div></main></body></html>`;
const site: Record<string, { body: string; type: string }> = {
  [LISTING]: { body: listing, type: "application/json; charset=utf-8" },
  [`https://${HOST}/api/plan/qmiplans?communityId=211073`]: { body: qmis, type: "application/json; charset=utf-8" },
  [`https://${HOST}/api/plan/homeplans?communityId=211073`]: { body: "[]", type: "application/json; charset=utf-8" },
  [`https://${HOST}/api/plan/qmiplans?communityId=211075`]: { body: "[]", type: "application/json; charset=utf-8" },
  [`https://${HOST}/api/plan/homeplans?communityId=211075`]: { body: "[]", type: "application/json; charset=utf-8" },
  [`https://${HOST}/homes/texas/san-antonio/san-antonio/fixture-ridge-211073/livingston-699869/1154490`]: { body: homePage, type: "text/html; charset=utf-8" },
};
const fixtureFetcher: HtmlFetcher = async (input) => {
  const entry = site[String(input)];
  if (!entry) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  return new Response(entry.body, { status: 200, headers: { "content-type": entry.type } });
};
const seedCentex = (name: string, sourceUrl: string, reelCode: string) => db.seed(dealCommunities, { builder: "Centex", privateName: name, sourceUrl, privateAddress: "1 Fixture Way, San Antonio, TX 78245", publicLabel: `West San Antonio | ${reelCode}`, areaLabel: "West San Antonio", reelCode, scrubList: JSON.stringify({ community: [name], street: ["Fixture Pass", "Fixture Way"] }), active: true, paused: false, manualMode: false, zipCentroidLat: "29.4", zipCentroidLng: "-98.7" });

// The same home page after the brand drops its rate slide: the carousel is there, with a slide that names no rate.
const homePageNoRate = homePage.replace(/plus take advantage of an FHA 30-year fixed rate as low as 4\.75% \/ 5\.58% APR\. /, "").replace(/data-content='[^']*'/, "data-content='<p>Offer subject to change.</p>'");
const withHomePage = (body: string): HtmlFetcher => async (input) => {
  const key = String(input);
  if (key.endsWith("/1154490")) return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  return fixtureFetcher(input);
};

describe("Pulte group closeout: the brand offer read within the hour", () => {
  it("a closeout with a warm cache that shows no rate offer takes the withdrawn promo down with its siblings", async () => {
    mocks.fetcher = fixtureFetcher;
    const ridge = seedCentex("Fixture Ridge", URL_R, "cx1");
    const bluff = seedCentex("Fixture Bluff", URL_Z, "cx2");
    await refreshOfficialDeals({ communityIds: [ridge, bluff], now: new Date() });
    const liveFor = (id: number) => incentiveRows().filter((row) => row.communityId === id && row.active);
    expect(liveFor(ridge)).toHaveLength(1);
    expect(liveFor(bluff)).toHaveLength(1);

    expect(homePageNoRate).not.toMatch(/4\.75%/);
    resetPulteGroupCaches();
    mocks.fetcher = withHomePage(homePageNoRate);
    await refreshOfficialDeals({ communityIds: [ridge, bluff], now: new Date() });
    expect(liveFor(ridge)).toHaveLength(0);
    expect(liveFor(bluff)).toHaveLength(0);
    const catalog = await publicDealsCatalog();
    expect(catalog.find((entry) => entry.label.endsWith("cx1"))!.incentive).toBeNull();
    expect(catalog.find((entry) => entry.label.endsWith("cx2"))!.incentive).toBeNull();
  });

  it("a 'Refresh now' of the closeout alone on a cold cache no longer takes the brand offer down (not read: the last one stays to the lapse rule), and no change line or e-mail is written", async () => {
    mocks.fetcher = fixtureFetcher;
    const ridge = seedCentex("Fixture Ridge", URL_R, "cx1");
    const bluff = seedCentex("Fixture Bluff", URL_Z, "cx2");
    await refreshOfficialDeals({ communityIds: [ridge, bluff], now: new Date() });
    const sent = emails().length;
    resetPulteGroupCaches();
    await refreshOfficialDeals({ communityId: bluff, now: new Date() });
    expect(incentiveRows().filter((row) => row.communityId === bluff && row.active)).toHaveLength(1);
    expect(emails()).toHaveLength(sent);
  });
});
