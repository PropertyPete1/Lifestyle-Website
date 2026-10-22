import crypto from "crypto";
import { readFileSync } from "fs";
import type { AddressInfo } from "net";
import { createServer, type Server } from "http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomePriceHistory, dealHomes, dealIncentives, dealLeads, dealPhotos, dealSuppliedImportCalls, dealSuppliedImportKeys, dealSuppliedImports, dealSyncDigestEntries } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Supplied source import (docs/builder-deals-supplied-import.md): the import key,
 * the HTTP route with its limits, and the stored import read through the real
 * sync on the fake DB, so holds, sold sweeps, price history, incentive parsing,
 * featured ranking and scrubbing are the ones a fetched page gets. The builder's
 * site is never fetched for a builder that takes imports.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), loadOfficialDeals: vi.fn(), sendBuilderDealsEmail: vi.fn(), refreshCommunityGeography: vi.fn(), processDealPhoto: vi.fn(), processPendingDealPhotos: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsPhotos", () => ({ processDealPhoto: (...args: unknown[]) => mocks.processDealPhoto(...args), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));
vi.mock("./dealsAdapters", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsAdapters")>()), loadOfficialDeals: (...args: unknown[]) => mocks.loadOfficialDeals(...args) }));

import { failedResult, parsePromotionalRate } from "./dealsAdapters";
import { checkSuppliedCommunity, suppliedImportSchema, SUPPLIED_IMPORT_STALE_MS, type SuppliedImport } from "./dealsAdapters.supplied";
import { authenticateSuppliedImportKey, generateSuppliedImportKey, revokeSuppliedImportKey, suppliedImportOverview } from "./dealsSuppliedStore";
import { createSuppliedImportHandler, processSuppliedImport, resetSuppliedImportAuthFailures, SUPPLIED_IMPORT_CALLS_PER_HOUR, SUPPLIED_IMPORT_MAX_BYTES, SUPPLIED_IMPORT_PATH, suppliedImportBodyLimit, type SuppliedImportResponse } from "./dealsSuppliedImport";
import { leaseBuilder, refreshDueCommunitiesBatch, refreshOfficialDeals, SUPPLIED_IMPORT_HOLD_DETAIL } from "./dealsSync";
import { describeCatalogHold } from "./dealsSyncAdmin";
import { gatedDealsCatalog, hashSecret, publicDealsCatalog } from "./dealsService";
import { featuredDeals } from "./dealsFeatured";

const BUILDER = "Legend Homes";
const SITE = "https://www.livelegendhomes.com";
const C1 = `${SITE}/communities/san-antonio/schertz-cibolo/guadalupe/cibolo/fixture-ranch`;
const C2 = `${SITE}/communities/san-antonio/new-braunfels-seguin/comal/new-braunfels/fixture-crossing`;
const Y = new Date().getUTCFullYear() + 1;
/** A realistic Legend "Open Door Deal": fixed-rate FHA with APR, term, down payment and dates; the phone and link are cleaned off as the reader cleans them. */
const GOOD_OFFER = `Open Door Deal. Get a 4.99% (5.27% APR) 30-year fixed FHA rate with 3.5% down payment on select move-in ready homes. Contracts must be signed by 12/31/${Y} and close by 1/31/${Y + 1}. Call (210) 555-0142 or visit www.livelegendhomes.com for details.`;
/** The banner Legend ran in October 2026 with a rate figure: no APR, so it holds for review. */
const HELD_OFFER = "Open Door Deal. From now until Oct. 31, enjoy limited-time, low-interest rates as low as 4.99% on select homes. See a Legend Home Sales Professional for details.";
const PRIVATE = ["Legend", "Fixture Ranch", "Fixture Crossing", "Fixture Way", "Kerrville", "Llano", "livelegendhomes", "Camillo", "quick-move-in-homes", "101 ", "102 ", "103 "];

type Home = SuppliedImport["communities"][number]["homes"][number];
type Community = SuppliedImport["communities"][number];
const home = (n: number, over: Partial<Home> = {}, community = C1): Home => ({ url: `${community}/quick-move-in-homes/${n}-fixture-way`, address: `${n} Fixture Way, Cibolo, TX 78108`, plan: "Kerrville", price: 329_990 + n, beds: 4, baths: 2.5, sqft: 2_100, status: "available", moveIn: "ready now", ...over });
const community = (homes: Home[], over: Partial<Community> = {}): Community => ({ communityUrl: C1, pageComplete: true, homesShownCount: homes.filter((entry) => entry.status !== "sold").length, incentiveText: GOOD_OFFER, homes, ...over });
const payload = (communities: Community[], capturedAt: Date): SuppliedImport => ({ builder: BUILDER, capturedAt: capturedAt.toISOString(), communities });

let db: FakeDealsDb;
beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true });
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: true });
  mocks.processDealPhoto.mockResolvedValue({ ok: true });
  mocks.processPendingDealPhotos.mockResolvedValue({ processed: 0, retried: 0, skipped: 0 });
  // The builder's site is never read for a builder that takes imports: any call here is a failure unless a test expects it.
  mocks.loadOfficialDeals.mockImplementation(async () => { throw new Error("network read attempted"); });
  resetSuppliedImportAuthFailures();
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

function seedCommunity(over: Partial<typeof dealCommunities.$inferInsert> = {}) {
  return db.seed(dealCommunities, { builder: BUILDER, privateName: "Fixture Ranch", sourceUrl: C1, privateAddress: "100 Fixture Way, Cibolo, TX 78108", publicLabel: "Northeast San Antonio | Near Randolph", areaLabel: "Northeast San Antonio", reelCode: `lg${db.rows(dealCommunities).length + 1}`, scrubList: JSON.stringify({ community: ["Fixture Ranch"] }), active: true, paused: false, manualMode: false, zipCentroidLat: "29.56", zipCentroidLng: "-98.23", catalogHoldReason: "source_access_refused", holdReason: "catalog: source_access_refused", ...over });
}
function seedLead() {
  return db.seed(dealLeads, { phoneE164: "+12105550123", sourceCode: "lg1", consentText: "c", consentAt: new Date(), consentIp: "203.0.113.9", deviceHash: "d".repeat(64), status: "verified", expiresAt: new Date(Date.now() + 86_400_000), flags: "[]" });
}
type CommunityRow = typeof dealCommunities.$inferSelect;
type HomeRow = typeof dealHomes.$inferSelect;
type IncentiveRow = typeof dealIncentives.$inferSelect;
const communityRow = (id: number) => (db.rows(dealCommunities) as CommunityRow[]).find((row) => row.id === id)!;
const homesOf = (id: number) => (db.rows(dealHomes) as HomeRow[]).filter((row) => row.communityId === id);
const available = (id: number) => homesOf(id).filter((row) => row.status === "available");
const incentives = () => db.rows(dealIncentives) as IncentiveRow[];
const digestHolds = () => (db.rows(dealSyncDigestEntries) as Array<{ holds: string }>).flatMap((row) => JSON.parse(row.holds) as Array<{ reason: string; detail?: string; kind: string }>);
const digestSummaries = () => (db.rows(dealSyncDigestEntries) as Array<{ summaries: string }>).flatMap((row) => JSON.parse(row.summaries) as Array<{ sold: string[]; priceChanges: unknown[]; added: string[] }>);
/** One import, validated by the same schema as the route, processed and awaited. */
async function importNow(data: SuppliedImport, now = new Date()) {
  return processSuppliedImport(BUILDER, suppliedImportSchema.parse(data), { now, leaseWaitMs: 0 });
}
const hoursAgo = (hours: number, from = new Date()) => new Date(from.getTime() - hours * 3_600_000);

describe("import key", () => {
  it("stores only the SHA-256 of the key with its creation time, and shows the plaintext once", async () => {
    const { key, createdAt } = await generateSuppliedImportKey(BUILDER);
    expect(key).toMatch(/^ldrimp_[A-Za-z0-9_-]{43}$/);
    const rows = db.rows(dealSuppliedImportKeys) as Array<{ builder: string; keyHash: string; createdAt: Date }>;
    expect(rows).toEqual([expect.objectContaining({ builder: BUILDER, keyHash: hashSecret(key), createdAt })]);
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(JSON.stringify(await suppliedImportOverview())).not.toContain(key);
    expect(await authenticateSuppliedImportKey(key)).toBe(BUILDER);
  });

  it("regenerate replaces the key at once; revoke removes it; a builder without an official site gets none", async () => {
    const first = await generateSuppliedImportKey(BUILDER);
    const second = await generateSuppliedImportKey(BUILDER);
    expect(db.rows(dealSuppliedImportKeys)).toHaveLength(1);
    expect(await authenticateSuppliedImportKey(first.key)).toBeNull();
    expect(await authenticateSuppliedImportKey(second.key)).toBe(BUILDER);
    expect(await revokeSuppliedImportKey(BUILDER)).toEqual({ revoked: true });
    expect(await authenticateSuppliedImportKey(second.key)).toBeNull();
    await expect(generateSuppliedImportKey("Manual")).rejects.toThrow(/official site/);
    await expect(generateSuppliedImportKey("Nobody Homes")).rejects.toThrow(/official site/);
  });

  it("each builder has its own key; the check compares with every stored hash in constant time and no early exit", async () => {
    const legend = await generateSuppliedImportKey(BUILDER);
    const drb = await generateSuppliedImportKey("DRB Homes");
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    expect(await authenticateSuppliedImportKey(legend.key)).toBe(BUILDER);
    // The first row matched, and the second was still compared.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await authenticateSuppliedImportKey(drb.key)).toBe("DRB Homes");
    expect(spy).toHaveBeenCalledTimes(4);
    // A wrong key of the right shape is compared against every row; a malformed one never reaches the database.
    expect(await authenticateSuppliedImportKey(`ldrimp_${"A".repeat(43)}`)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(6);
    for (const bad of ["", "ldrimp_short", legend.key.slice(0, -1), `${legend.key}x`, legend.key.replace(/^ldrimp_/, "LDRIMP_"), ` ${legend.key}`]) expect(await authenticateSuppliedImportKey(bad)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(6);
  });
});

describe("payload validation", () => {
  const valid = () => payload([community([home(101)])], new Date());
  it("accepts the documented shape and the copy-paste example in the doc", () => {
    expect(suppliedImportSchema.safeParse(valid()).success).toBe(true);
    const doc = readFileSync(new URL("../docs/builder-deals-supplied-import.md", import.meta.url), "utf8");
    const example = /```json\n([\s\S]*?)\n```/.exec(doc.slice(doc.indexOf("## Example payload")))?.[1];
    expect(example, "the doc carries an example payload").toBeTruthy();
    const parsed = suppliedImportSchema.safeParse(JSON.parse(example!));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("rejects unknown fields at every level and wrong types", () => {
    const cases: Array<(data: Record<string, any>) => void> = [
      (data) => { data.extra = 1; },
      (data) => { data.communities[0].builderName = "x"; },
      (data) => { data.communities[0].homes[0].lotSize = "0.2 acres"; },
      (data) => { data.communities[0].homes[0].price = "329990"; },
      (data) => { data.communities[0].homes[0].status = "pending"; },
      (data) => { data.communities[0].homesShownCount = 1.5; },
      (data) => { data.communities[0].pageComplete = "true"; },
      (data) => { data.capturedAt = "yesterday"; },
      (data) => { data.communities = []; },
      (data) => { delete data.communities[0].homes[0].price; },
      (data) => { data.communities[0].homes[0].address = ""; },
    ];
    for (const mutate of cases) {
      const data = JSON.parse(JSON.stringify(valid()));
      mutate(data);
      expect(suppliedImportSchema.safeParse(data).success, mutate.toString()).toBe(false);
    }
  });
});

describe("supplied import through the normal sync", () => {
  it("happy path: publishes the homes and the incentive, clears source_access_refused, never fetches the site", async () => {
    await generateSuppliedImportKey(BUILDER);
    const id = seedCommunity();
    const now = new Date();
    const { processed, response } = await importNow(payload([community([home(101), home(102, { status: "under_construction", moveIn: `March ${Y}`, plan: "Llano" }), home(103, { status: "sold", price: null })])], hoursAgo(1, now)), now);
    expect(processed).toBe(true);
    expect(response).toMatchObject({ ok: true, builder: BUILDER, communities: [{ communityUrl: C1, status: "published", reasons: [], problems: [], homesForSale: 2, homesSold: 1, homesShownCount: 2, incentiveHold: null }] });
    expect(mocks.loadOfficialDeals).not.toHaveBeenCalled();
    const row = communityRow(id);
    expect(row).toMatchObject({ catalogHoldReason: null, holdReason: null, incentiveHoldReason: null });
    expect(row.lastSuccessfulSyncAt?.getTime()).toBe(now.getTime());
    expect(available(id).map((entry) => [entry.privateAddress, entry.kind, entry.price, entry.beds, entry.baths, entry.sqft, entry.readyNow, entry.moveInDate, entry.privatePlanName])).toEqual([
      ["101 Fixture Way, Cibolo, TX 78108", "quick_move_in", 330_091, "4", "2.5", 2_100, true, null, "Kerrville"],
      ["102 Fixture Way, Cibolo, TX 78108", "quick_move_in", 330_092, "4", "2.5", 2_100, false, `March ${Y}`, "Llano"],
    ]);
    expect(homesOf(id).find((entry) => entry.privateAddress?.startsWith("103"))?.status).toBe("sold");
    expect(db.rows(dealHomePriceHistory)).toHaveLength(2);
    const live = incentives().filter((entry) => entry.active && !entry.held);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ headlineRate: "4.99%", apr: "5.27%", loanType: "FHA", downPayment: "3.5% down payment", repaymentTerms: "30-year fixed" });
    // The phone number and the site link were cleaned off as the reader cleans them, and the parser is the reader's.
    expect(live[0]!.publicText).not.toMatch(/555|www\./);
    expect(live[0]!.publicText).toBe(`Open Door Deal. Get a 4.99% (5.27% APR) 30-year fixed FHA rate with 3.5% down payment on select move-in ready homes. Contracts must be signed by 12/31/${Y} and close by 1/31/${Y + 1}.`);
    expect(parsePromotionalRate(live[0]!.publicText).holdReasons).toEqual([]);
    expect(digestSummaries()[0]!.added).toHaveLength(3);
    expect(db.rows(dealSuppliedImports)).toHaveLength(1);
  });

  it("an offer that cannot be published is held for review while the homes publish", async () => {
    await generateSuppliedImportKey(BUILDER);
    const id = seedCommunity();
    const { response } = await importNow(payload([community([home(101)], { incentiveText: HELD_OFFER })], hoursAgo(1)));
    expect(response.communities[0]).toMatchObject({ status: "published" });
    expect(response.communities[0]!.incentiveHold).toMatch(/^missing_apr \(text [0-9a-f]{8}\)$/);
    expect(available(id)).toHaveLength(1);
    expect(incentives().filter((entry) => entry.active)).toHaveLength(0);
    const held = incentives().find((entry) => entry.held)!;
    // The held text is scrubbed like a read's: the builder's name never reaches the record.
    expect(held.publicText).not.toMatch(/Legend/);
    expect(digestHolds()).toEqual([expect.objectContaining({ kind: "incentive", reason: expect.stringContaining("missing_apr") })]);
  });

  it("a later import that drops a home marks it sold and records the price drop; omitting the offer keeps it, null takes it down", async () => {
    await generateSuppliedImportKey(BUILDER);
    const id = seedCommunity();
    const t0 = hoursAgo(30);
    await importNow(payload([community([home(101), home(102)])], t0), hoursAgo(29));
    const { response } = await importNow(payload([community([home(101, { price: 309_990 })], { incentiveText: undefined })], hoursAgo(5)), hoursAgo(4));
    expect(response.communities[0]).toMatchObject({ status: "published" });
    expect(available(id).map((entry) => entry.privateAddress)).toEqual(["101 Fixture Way, Cibolo, TX 78108"]);
    expect(homesOf(id).find((entry) => entry.privateAddress?.startsWith("102"))?.status).toBe("sold");
    expect(available(id)[0]).toMatchObject({ price: 309_990, previousPrice: 330_091 });
    const summary = digestSummaries().at(-1)!;
    expect(summary.sold).toEqual(["102 Fixture Way, Cibolo, TX 78108"]);
    expect(summary.priceChanges).toEqual([{ name: "101 Fixture Way, Cibolo, TX 78108", from: 330_091, to: 309_990 }]);
    // incentiveText omitted: the agent did not look, so the offer stays.
    expect(incentives().filter((entry) => entry.active)).toHaveLength(1);
    await importNow(payload([community([home(101, { price: 309_990 })], { incentiveText: null })], hoursAgo(2)), hoursAgo(1));
    expect(incentives().filter((entry) => entry.active)).toHaveLength(0);
    // Only the latest import and the one before it are kept.
    expect(db.rows(dealSuppliedImports)).toHaveLength(2);
  });

  it("a partial import holds supplied_import_incomplete and never sweeps homes to sold", async () => {
    await generateSuppliedImportKey(BUILDER);
    const id = seedCommunity();
    await importNow(payload([community([home(101), home(102), home(103)])], hoursAgo(10)), hoursAgo(9));
    expect(available(id)).toHaveLength(3);
    const notWhole = await importNow(payload([community([home(101)], { pageComplete: false, homesShownCount: 1 })], hoursAgo(5)), hoursAgo(4));
    expect(notWhole.response.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_incomplete"], problems: ["pageComplete is false"] });
    expect(available(id)).toHaveLength(3);
    const short = await importNow(payload([community([home(101)], { homesShownCount: 3 })], hoursAgo(3)), hoursAgo(2));
    expect(short.response.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_incomplete"], problems: ["1 homes for sale sent, the page shows 3"] });
    expect(available(id)).toHaveLength(3);
    expect(communityRow(id).catalogHoldReason).toBe("supplied_import_incomplete");
    // One e-mail for the hold, with the plain-language detail; the same hold again sends no second one.
    const holds = digestHolds().filter((hold) => hold.kind === "catalog");
    expect(holds).toEqual([expect.objectContaining({ reason: "supplied_import_incomplete", detail: SUPPLIED_IMPORT_HOLD_DETAIL.supplied_import_incomplete })]);
    expect(describeCatalogHold("supplied_import_incomplete")[0]).toMatch(/partial/);
  });

  it("an import older than 36 hours holds supplied_import_stale on the next refresh instead of publishing", async () => {
    await generateSuppliedImportKey(BUILDER);
    const id = seedCommunity();
    const captured = hoursAgo(40);
    await importNow(payload([community([home(101), home(102)])], captured), hoursAgo(39));
    expect(available(id)).toHaveLength(2);
    // The scheduled refresh 37 hours after capture reads the stored import: too old, so held, and nothing is swept.
    const results = await refreshOfficialDeals({ communityId: id, now: new Date(captured.getTime() + SUPPLIED_IMPORT_STALE_MS + 3_600_000) });
    expect(results[0]).toMatchObject({ ok: false, reason: "supplied_import_stale" });
    expect(available(id)).toHaveLength(2);
    expect(communityRow(id).catalogHoldReason).toBe("supplied_import_stale");
    expect(mocks.loadOfficialDeals).not.toHaveBeenCalled();
    // An import that arrives already stale is stored and held at once.
    const late = await importNow(payload([community([home(101)])], hoursAgo(37)));
    expect(late.response.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_stale"] });
    expect(available(id)).toHaveLength(2);
  });

  it("the scheduled batch reads the stored import for a builder that takes imports, and holds supplied_import_missing when none has arrived", async () => {
    await generateSuppliedImportKey(BUILDER);
    const withImport = seedCommunity();
    const without = seedCommunity({ privateName: "Fixture Crossing", sourceUrl: C2, scrubList: JSON.stringify({ community: ["Fixture Crossing"] }) });
    await importNow(payload([community([home(101)])], hoursAgo(1)));
    db.rows(dealCommunities).forEach((row) => { (row as CommunityRow).lastSuccessfulSyncAt = hoursAgo(48); (row as CommunityRow).lastAttemptAt = hoursAgo(48); });
    const batch = await refreshDueCommunitiesBatch({ lanes: 1 });
    expect(batch.results).toEqual(expect.arrayContaining([expect.objectContaining({ communityId: withImport, ok: true }), expect.objectContaining({ communityId: without, ok: false, reason: "supplied_import_missing" })]));
    expect(mocks.loadOfficialDeals).not.toHaveBeenCalled();
    expect(digestHolds()).toContainEqual(expect.objectContaining({ reason: "supplied_import_missing", detail: SUPPLIED_IMPORT_HOLD_DETAIL.supplied_import_missing }));
    // Revoked: the builder is read from its site again (here the site refuses the reader, as Legend's does).
    await revokeSuppliedImportKey(BUILDER);
    mocks.loadOfficialDeals.mockImplementation(async (config) => failedResult(config, new Date().toISOString(), { builder: BUILDER, sourceUrl: C1, privateCommunityName: "Fixture Ranch", pages: [], plans: [], homes: [], incentive: null } as never, ["source_access_refused"]));
    const refetched = await refreshOfficialDeals({ communityId: withImport });
    expect(refetched[0]).toMatchObject({ ok: false, reason: "source_access_refused" });
    expect(mocks.loadOfficialDeals).toHaveBeenCalledTimes(1);
    expect(available(withImport)).toHaveLength(1);
  });

  it("sanity bounds: any figure outside them holds the community and nothing from it is published", async () => {
    await generateSuppliedImportKey(BUILDER);
    const cases: Array<[Partial<Home>, string]> = [
      [{ price: 12_000 }, "price 12000 is outside 50,000-5,000,000"],
      [{ price: 5_000_001 }, "price 5000001 is outside 50,000-5,000,000"],
      [{ price: 329_990.5 }, "price 329990.5 is outside 50,000-5,000,000"],
      [{ beds: 0 }, "beds 0 is outside 1-10"],
      [{ beds: 11 }, "beds 11 is outside 1-10"],
      [{ beds: 3.5 }, "beds 3.5 is outside 1-10"],
      [{ baths: 2.25 }, "baths 2.25 is outside 1-10 in steps of 0.5"],
      [{ baths: 0.5 }, "baths 0.5 is outside 1-10 in steps of 0.5"],
      [{ baths: 10.5 }, "baths 10.5 is outside 1-10 in steps of 0.5"],
      [{ sqft: 399 }, "sqft 399 is outside 400-15,000"],
      [{ sqft: 15_001 }, "sqft 15001 is outside 400-15,000"],
    ];
    for (const [index, [over, problem]] of cases.entries()) {
      const id = seedCommunity({ privateName: `Bounds ${index}`, sourceUrl: `${C1}-${index}`, scrubList: "{}" });
      const url = `${C1}-${index}`;
      const { response } = await importNow(payload([community([home(101, {}, url), home(102, over, url)], { communityUrl: url })], hoursAgo(1)));
      expect(response.communities[0], problem).toMatchObject({ status: "held", reasons: ["supplied_import_out_of_bounds"], problems: [`homes[1]: ${problem}`] });
      expect(homesOf(id), problem).toHaveLength(0);
      expect(incentives().filter((entry) => entry.communityId === id), problem).toHaveLength(0);
    }
    // The edges themselves are inside.
    const edge = checkSuppliedCommunity(BUILDER, { capturedAt: new Date(), community: community([home(101, { price: 50_000, beds: 1, baths: 1, sqft: 400 }), home(102, { price: 5_000_000, beds: 10, baths: 10, sqft: 15_000 }), home(103, { price: null, beds: null, baths: null, sqft: null })]) }, new Date());
    expect(edge.reasons).toEqual([]);
  });

  it("homes off the builder's site, without a street address or with unreadable move-in wording hold the community", async () => {
    await generateSuppliedImportKey(BUILDER);
    const cases: Array<[Partial<Home> | ((page: string) => Partial<Home>), string]> = [
      [{ url: "https://www.example.com/homes/101" }, "url is not an https link on the builder's site"],
      [{ url: `http://www.livelegendhomes.com/communities/x/101` }, "url is not an https link on the builder's site"],
      [{ url: "https://livelegendhomes.com/communities/x/101" }, "url is not an https link on the builder's site"],
      [(page) => ({ url: `${page}/` }), "url is the community page, not the home's page"],
      [{ address: "Homesite 12, Cibolo, TX" }, "address does not start with a house number and street"],
      [{ moveIn: "Soon" }, "moveIn is not \"ready now\" or \"Month YYYY\""],
      [{ moveIn: "Spring 2027" }, "moveIn is not \"ready now\" or \"Month YYYY\""],
      [{ status: "under_construction", moveIn: "ready now" }, "an under-construction home cannot be \"ready now\""],
      [{ photos: ["https://cdn.example.com/a.jpg"] }, "photos[0] is not on the builder's site or image host"],
    ];
    for (const [index, [over, problem]] of cases.entries()) {
      const url = `${C1}-v${index}`;
      const id = seedCommunity({ privateName: `Invalid ${index}`, sourceUrl: url, scrubList: "{}" });
      const { response } = await importNow(payload([community([home(101, {}, url), home(102, typeof over === "function" ? over(url) : over, url)], { communityUrl: url })], hoursAgo(1)));
      expect(response.communities[0], problem).toMatchObject({ status: "held", reasons: ["supplied_import_invalid_home"], problems: [`homes[1]: ${problem}`] });
      expect(homesOf(id), problem).toHaveLength(0);
    }
  });

  it("the same home twice (by link or by address) holds the community", async () => {
    await generateSuppliedImportKey(BUILDER);
    const id = seedCommunity();
    const byUrl = await importNow(payload([community([home(101), home(102, { url: home(101).url.toUpperCase().replace("HTTPS://WWW.LIVELEGENDHOMES.COM", SITE) + "/" })])], hoursAgo(3)));
    expect(byUrl.response.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_duplicate_home"], problems: ["homes[1]: same url as homes[0]"] });
    const byAddress = await importNow(payload([community([home(101), home(102, { address: "101 Fixture Way, Cibolo, TX 78108" })])], hoursAgo(2)));
    expect(byAddress.response.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_duplicate_home"], problems: ["homes[1]: same address as homes[0]"] });
    expect(homesOf(id)).toHaveLength(0);
  });

  it("unknown or unofficial communities are reported and never created; a community absent from a payload is untouched", async () => {
    await generateSuppliedImportKey(BUILDER);
    const a = seedCommunity();
    const b = seedCommunity({ privateName: "Fixture Crossing", sourceUrl: C2, scrubList: JSON.stringify({ community: ["Fixture Crossing"] }) });
    await importNow(payload([community([home(101)]), community([home(201, {}, C2), home(202, {}, C2)], { communityUrl: C2 })], hoursAgo(5)), hoursAgo(4));
    expect(available(b)).toHaveLength(2);
    const bSynced = communityRow(b).lastSuccessfulSyncAt;
    const { response } = await importNow(payload([
      community([home(101)]),
      community([home(301, {}, `${SITE}/communities/san-antonio/x/y/z/not-set-up`)], { communityUrl: `${SITE}/communities/san-antonio/x/y/z/not-set-up` }),
      community([home(401, {}, "https://www.example.com/fixture")], { communityUrl: "https://www.example.com/fixture" }),
    ], hoursAgo(1)));
    expect(response.communities.map((entry) => [entry.status, entry.reasons])).toEqual([["published", []], ["rejected", ["unknown_community"]], ["rejected", ["unofficial_url"]]]);
    expect(response.ok).toBe(false);
    expect(db.rows(dealCommunities)).toHaveLength(2);
    expect(available(a)).toHaveLength(1);
    expect(available(b)).toHaveLength(2);
    expect(communityRow(b).lastSuccessfulSyncAt).toEqual(bSynced);
    // The page link matches however it is spelled (trailing slash, case of the host, a fragment).
    const spelled = await importNow(payload([community([home(101)], { communityUrl: `${C1.replace("www.livelegendhomes.com", "WWW.LiveLegendHomes.com")}/#homes` })], hoursAgo(0.5)));
    expect(spelled.response.communities[0]).toMatchObject({ status: "published" });
  });

  it("an import older than the stored one is refused (no rolling back), a paused or manual community is reported as skipped", async () => {
    await generateSuppliedImportKey(BUILDER);
    const id = seedCommunity();
    await importNow(payload([community([home(101)])], hoursAgo(2)));
    const older = await importNow(payload([community([home(101), home(102)])], hoursAgo(3)));
    expect(older.response.communities[0]).toMatchObject({ status: "rejected", reasons: ["older_than_stored"] });
    expect(available(id)).toHaveLength(1);
    (db.rows(dealCommunities)[0] as CommunityRow).manualMode = true;
    const manual = await importNow(payload([community([home(101), home(102)])], hoursAgo(1)));
    expect(manual.response.communities[0]).toMatchObject({ status: "skipped", reasons: ["manual_mode"] });
    expect(manual.response.communities[0]!.problems[0]).toMatch(/Manual mode/);
    expect(available(id)).toHaveLength(1);
  });

  it("waits for the builder's lease: while another run reads the builder, the import is stored and not processed", async () => {
    await generateSuppliedImportKey(BUILDER);
    const id = seedCommunity();
    const lease = await leaseBuilder(BUILDER);
    expect(lease).not.toBeNull();
    const busy = await importNow(payload([community([home(101)])], hoursAgo(1)));
    expect(busy.processed).toBe(false);
    expect(busy.response.communities[0]).toMatchObject({ status: "stored_not_processed" });
    expect(homesOf(id)).toHaveLength(0);
    await lease!.release();
    const again = await importNow(payload([community([home(101)])], hoursAgo(1)));
    expect(again.response.communities[0]).toMatchObject({ status: "published" });
  });

  it("featured ranking includes the imported homes, and no public or gated output carries a private name", async () => {
    await generateSuppliedImportKey(BUILDER);
    const id = seedCommunity();
    const lead = seedLead();
    await importNow(payload([community([home(101, { photos: ["https://assets.livelegendhomes.com/legend-cms-prod-assets/image/a.jpg?w=1200"] }), home(102, { status: "under_construction", moveIn: `March ${Y}`, plan: "Llano" })])], hoursAgo(1)));
    expect(available(id)).toHaveLength(2);
    // The photo is queued from the builder's image host, its query string dropped as the reader drops it.
    expect((db.rows(dealPhotos) as Array<{ sourceUrl: string }>).map((photo) => photo.sourceUrl)).toEqual(["https://assets.livelegendhomes.com/legend-cms-prod-assets/image/a.jpg"]);
    const pub = await featuredDeals("public");
    expect(pub.lowestPayment.map((deal) => deal.label)).toEqual(["Northeast San Antonio | Near Randolph"]);
    expect(pub.bestRate).toMatchObject({ label: "Northeast San Antonio | Near Randolph", rate: { ratePercent: 4.99, loanType: "FHA" }, downPercent: 3.5 });
    const gated = await featuredDeals({ view: "gated" });
    expect(gated.lowestPayment).toHaveLength(1);
    const catalog = await publicDealsCatalog();
    expect(catalog[0]).toMatchObject({ label: "Northeast San Antonio | Near Randolph", homesAvailable: 2 });
    const gatedCatalog = await gatedDealsCatalog(lead);
    expect(gatedCatalog).toHaveLength(1);
    for (const output of [pub, gated, catalog, gatedCatalog]) {
      const json = JSON.stringify(output);
      for (const term of PRIVATE) expect(json, term).not.toContain(term);
    }
  });
});

describe("supplied import: review regressions (foreign homes, empty imports, stale estimates, link case)", () => {
  /** A home under the given community's page. */
  const homeUnder = (n: number, communityUrl: string, over: Partial<Home> = {}): Home => ({ ...home(n), url: `${communityUrl}/quick-move-in-homes/${n}-fixture-way`, ...over });

  it("a home whose page is under another community of the builder holds this community and never moves the other's home", async () => {
    await generateSuppliedImportKey(BUILDER);
    const c1 = seedCommunity();
    const c2 = seedCommunity({ privateName: "Fixture Crossing", sourceUrl: C2 });
    const now = new Date();
    expect((await importNow(payload([community([homeUnder(201, C2)], { communityUrl: C2 })], hoursAgo(2, now)), now)).response.communities[0]!.status).toBe("published");
    expect(available(c2).map((row) => row.sourceUrl)).toEqual([`${C2}/quick-move-in-homes/201-fixture-way`]);
    // C1's list carries C2's home (a "nearby homes" card the agent copied): the whole of C1 holds, C2's home stays C2's.
    const { response } = await importNow(payload([community([home(101), homeUnder(201, C2)])], hoursAgo(1, now)), now);
    expect(response.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_invalid_home"] });
    expect(response.communities[0]!.problems).toContain("homes[1]: url is not under this community's page");
    expect(homesOf(c1)).toEqual([]);
    expect(available(c2).map((row) => row.communityId)).toEqual([c2]);
    expect(communityRow(c1).catalogHoldReason).toBe("supplied_import_invalid_home");
    // The rule itself: a link on the builder's site but outside the community's page, or one that only shares its prefix, is not a home of it.
    for (const url of [`${SITE}/communities/san-antonio/quick-move-in-homes/101-fixture-way`, `${C1}-north/quick-move-in-homes/101-fixture-way`]) {
      expect(checkSuppliedCommunity(BUILDER, { capturedAt: now, community: community([home(101, { url })]) }, now).reasons).toEqual(["supplied_import_invalid_home"]);
    }
    expect(checkSuppliedCommunity(BUILDER, { capturedAt: now, community: community([home(101)]) }, now).reasons).toEqual([]);
  });

  it("an import with no homes for sale sweeps nothing until an earlier, separate import agreed; a resent copy is not a second visit", async () => {
    await generateSuppliedImportKey(BUILDER);
    const c1 = seedCommunity();
    const now = new Date();
    await importNow(payload([community([home(101), home(102), home(103)])], hoursAgo(30, now)), now);
    expect(available(c1)).toHaveLength(3);
    // The list failed to load: "complete" and a count of 0. Held, all three stay live.
    const empty = (at: Date) => importNow(payload([community([], { homesShownCount: 0 })], at), now);
    expect((await empty(hoursAgo(20, now))).response.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_incomplete"] });
    expect(available(c1)).toHaveLength(3);
    // The same capture resent (a 503 retry): still one visit, still held.
    expect((await empty(hoursAgo(20, now))).response.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_incomplete"] });
    expect(available(c1)).toHaveLength(3);
    // A later, separate import says the same: the community really is sold out.
    expect((await empty(hoursAgo(2, now))).response.communities[0]).toMatchObject({ status: "published", reasons: [] });
    expect(available(c1)).toEqual([]);
    expect(homesOf(c1).every((row) => row.status === "sold")).toBe(true);
  });

  it("a first import with no homes for sale holds; an empty list whose sold homes are listed still counts as empty", async () => {
    await generateSuppliedImportKey(BUILDER);
    const c1 = seedCommunity();
    const now = new Date();
    const { response } = await importNow(payload([community([home(101, { status: "sold", price: null })], { homesShownCount: 0 })], hoursAgo(1, now)), now);
    expect(response.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_incomplete"] });
    expect(homesOf(c1)).toEqual([]);
  });

  it("an under-construction home whose month has passed publishes with no date; a coming month and a finished home read as before", () => {
    const now = new Date(Date.UTC(2026, 9, 21, 15));
    const read = (over: Partial<Home>) => checkSuppliedCommunity(BUILDER, { capturedAt: now, community: community([home(101, over)]) }, now);
    expect(read({ status: "under_construction", moveIn: "August 2026" })).toMatchObject({ reasons: [], homes: [expect.objectContaining({ status: "Quick Move-In", readyNow: false, moveInDate: null })] });
    expect(read({ status: "under_construction", moveIn: "October 2026" }).homes[0]).toMatchObject({ status: "Quick Move-In (October 2026)", moveInDate: "October 2026" });
    expect(read({ status: "under_construction", moveIn: "January 2027" }).homes[0]).toMatchObject({ status: "Quick Move-In (January 2027)", readyNow: false, moveInDate: "January 2027" });
    // Abbreviated months read as the full month (Legend's Oct 22 import sent them); two letters stay unreadable.
    for (const moveIn of ["Jan 2027", "jan. 2027", "Janu 2027"]) expect(read({ status: "under_construction", moveIn }).homes[0], moveIn).toMatchObject({ status: "Quick Move-In (January 2027)", moveInDate: "January 2027" });
    expect(read({ status: "under_construction", moveIn: "Sept 2027" }).homes[0]).toMatchObject({ moveInDate: "September 2027" });
    expect(read({ status: "under_construction", moveIn: "Ja 2027" }).reasons).toEqual(["supplied_import_invalid_home"]);
    expect(read({ status: "available", moveIn: "August 2026" }).homes[0]).toMatchObject({ status: "Quick Move-In (Move-In Ready)", readyNow: true, moveInDate: null });
  });

  it("the same home sent with its link in another letter case is the same home: one row, still for sale, never swept to sold", async () => {
    await generateSuppliedImportKey(BUILDER);
    const c1 = seedCommunity();
    const now = new Date();
    await importNow(payload([community([home(101)])], hoursAgo(5, now)), now);
    const { response } = await importNow(payload([community([home(101, { url: `${C1}/Quick-Move-In-Homes/101-Fixture-Way` })])], hoursAgo(1, now)), now);
    expect(response.communities[0]).toMatchObject({ status: "published", reasons: [] });
    expect(homesOf(c1).map((row) => [row.sourceUrl, row.status])).toEqual([[`${C1}/quick-move-in-homes/101-fixture-way`, "available"]]);
    expect(digestSummaries().flatMap((summary) => summary.sold)).toEqual([]);
  });
});

describe("POST /api/deals/import over HTTP", () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    const app = express();
    app.set("trust proxy", 1);
    // The production order (server/_core/index.ts): this path's own 2 MB parser, then the app-wide 50 MB one, then the route.
    app.use(SUPPLIED_IMPORT_PATH, suppliedImportBodyLimit());
    app.use(express.json({ limit: "50mb" }));
    app.post(SUPPLIED_IMPORT_PATH, createSuppliedImportHandler({ leaseWaitMs: 0 }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${SUPPLIED_IMPORT_PATH}`;
  });
  afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(base, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("end to end: a key from Admin, a Legend payload in, homes and the offer published, the summary back", async () => {
    const id = seedCommunity();
    const { key } = await generateSuppliedImportKey(BUILDER);
    const logs = [vi.spyOn(console, "info").mockImplementation(() => undefined), vi.spyOn(console, "error").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined)];
    const response = await post(payload([community([home(101), home(102, { status: "sold", price: null })])], hoursAgo(0.2)), { authorization: `Bearer ${key}` });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as SuppliedImportResponse;
    expect(body).toMatchObject({ ok: true, builder: BUILDER, communities: [{ communityUrl: C1, status: "published", homesForSale: 1, homesSold: 1, homesShownCount: 1, incentiveHold: null }] });
    expect(available(id)).toHaveLength(1);
    expect(incentives().filter((entry) => entry.active)).toHaveLength(1);
    expect(communityRow(id).catalogHoldReason).toBeNull();
    // Nothing private or secret reached the log: counts only.
    const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
    for (const term of [key, ...PRIVATE, "Open Door", "4.99"]) expect(logged, term).not.toContain(term);
    expect(logged).toContain("1 published");
  });

  it("401 without a key, with a wrong key and with a revoked key; nothing is stored", async () => {
    seedCommunity();
    const { key } = await generateSuppliedImportKey(BUILDER);
    const good = payload([community([home(101)])], hoursAgo(0.2));
    expect((await post(good)).status).toBe(401);
    expect((await post(good, { authorization: key })).status).toBe(401);
    expect((await post(good, { authorization: `Bearer ldrimp_${"x".repeat(43)}` })).status).toBe(401);
    expect((await post(good, { authorization: `Basic ${key}` })).status).toBe(401);
    await revokeSuppliedImportKey(BUILDER);
    const revoked = await post(good, { authorization: `Bearer ${key}` });
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toBe("Bearer");
    expect(await revoked.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(db.rows(dealSuppliedImports)).toHaveLength(0);
    expect(db.rows(dealHomes)).toHaveLength(0);
  });

  it("too many failed keys from one address get 429", async () => {
    for (let attempt = 0; attempt < 20; attempt++) expect((await post({}, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await post({}, { authorization: "Bearer nope" })).status).toBe(429);
  });

  it("validation: bad JSON, unknown fields, wrong content type, another builder's name, a future capture time and a repeated community are refused", async () => {
    seedCommunity();
    const { key } = await generateSuppliedImportKey(BUILDER);
    const auth = { authorization: `Bearer ${key}` };
    expect((await post("{not json", auth)).status).toBe(400);
    expect((await fetch(base, { method: "POST", headers: { "content-type": "application/json", ...auth } })).status).toBe(400);
    const unknown = await post({ ...payload([community([home(101)])], hoursAgo(0.2)), note: "x" }, auth);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: "invalid_payload", issues: [expect.objectContaining({ path: "" })] });
    const typed = await post(payload([community([home(101, { price: "329990" as never })])], hoursAgo(0.2)), auth);
    expect(await typed.json()).toMatchObject({ error: "invalid_payload", issues: [expect.objectContaining({ path: "communities.0.homes.0.price" })] });
    expect((await fetch(base, { method: "POST", headers: { "content-type": "text/plain", ...auth }, body: JSON.stringify(payload([community([home(101)])], hoursAgo(0.2))) })).status).toBe(415);
    const other = await post({ ...payload([community([home(101)])], hoursAgo(0.2)), builder: "DRB Homes" }, auth);
    expect(other.status).toBe(403);
    const future = await post(payload([community([home(101)])], new Date(Date.now() + 11 * 60_000)), auth);
    expect(future.status).toBe(400);
    expect(await future.json()).toEqual({ ok: false, error: "captured_at_in_future" });
    expect((await post(payload([community([home(101)]), community([home(101)], { communityUrl: `${C1}/` })], hoursAgo(0.2)), auth)).status).toBe(400);
    expect(db.rows(dealSuppliedImports)).toHaveLength(0);
    // A few minutes of clock difference is accepted.
    expect((await post(payload([community([home(101)])], new Date(Date.now() + 5 * 60_000)), auth)).status).toBe(200);
  });

  it("refuses a body over 2 MB before the app-wide 50 MB parser sees it", async () => {
    const { key } = await generateSuppliedImportKey(BUILDER);
    const big = await post(`{"pad":"${"x".repeat(SUPPLIED_IMPORT_MAX_BYTES)}"}`, { authorization: `Bearer ${key}` });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ ok: false, error: "body_too_large", limitBytes: SUPPLIED_IMPORT_MAX_BYTES });
    expect(db.rows(dealSuppliedImportCalls)).toHaveLength(0);
  });

  it("rate limit: 30 calls an hour per builder, then 429", async () => {
    const { key } = await generateSuppliedImportKey(BUILDER);
    for (let call = 0; call < SUPPLIED_IMPORT_CALLS_PER_HOUR; call++) expect((await post("{}", { authorization: `Bearer ${key}` })).status).toBe(400);
    const limited = await post("{}", { authorization: `Bearer ${key}` });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");
    // Another builder's key has its own allowance.
    const drb = await generateSuppliedImportKey("DRB Homes");
    expect((await post("{}", { authorization: `Bearer ${drb.key}` })).status).toBe(400);
    // Calls older than an hour no longer count.
    (db.rows(dealSuppliedImportCalls) as Array<{ createdAt: Date }>).forEach((row) => { row.createdAt = hoursAgo(1.1); });
    expect((await post("{}", { authorization: `Bearer ${key}` })).status).toBe(400);
  });

  it("answers 503 with Retry-After while the builder is being read, the import stored", async () => {
    seedCommunity();
    const { key } = await generateSuppliedImportKey(BUILDER);
    const lease = await leaseBuilder(BUILDER);
    const busy = await post(payload([community([home(101)])], hoursAgo(0.2)), { authorization: `Bearer ${key}` });
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("120");
    expect(await busy.json()).toMatchObject({ error: "builder_busy_retry", communities: [{ status: "stored_not_processed" }] });
    await lease!.release();
  });

  it("is wired in the server: its own body parser before the app-wide one, the route beside the scheduled one", () => {
    const source = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");
    const limit = source.indexOf("app.use(SUPPLIED_IMPORT_PATH, suppliedImportBodyLimit())");
    const json = source.indexOf('app.use(express.json({ limit: "50mb" }))');
    const scheduled = source.indexOf('app.post("/api/scheduled/refreshDeals", scheduledDealsHandler)');
    const route = source.indexOf("app.post(SUPPLIED_IMPORT_PATH, suppliedImportHandler)");
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThan(json);
    expect(route).toBeGreaterThan(scheduled);
    expect(source.indexOf('"/api/trpc"')).toBeGreaterThan(route);
  });
});
