import type { AddressInfo } from "net";
import { createServer, type Server } from "http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealEvents, dealHomePriceHistory, dealHomes, dealSuppliedImports } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Nov 17, 2026: Legend's daily import failed two days running. Tuesday's call answered 400 for the whole payload
 * because three communities came back with null counts, so the seven the agent had read were thrown away with them,
 * and nobody was told. These tests hold the daily refresh to: each community on its own, last good listings kept,
 * a real "no homes" told apart from a page that did not load, a missed run flagged, and a retry or replay that
 * never writes twice.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), loadOfficialDeals: vi.fn(), sendBuilderDealsEmail: vi.fn(), refreshCommunityGeography: vi.fn(), processDealPhoto: vi.fn(), processPendingDealPhotos: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsPhotoExterior", () => ({ exteriorCovers: async (ids: readonly number[]) => new Map(ids.map((id) => [id, undefined])), exteriorFirst: <T,>(rows: readonly T[]) => rows.slice() }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapGeometry: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsPhotos", () => ({ processDealPhoto: (...args: unknown[]) => mocks.processDealPhoto(...args), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));
vi.mock("./dealsAdapters", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsAdapters")>()), loadOfficialDeals: (...args: unknown[]) => mocks.loadOfficialDeals(...args) }));

import type { SuppliedImport } from "./dealsAdapters.supplied";
import { generateSuppliedImportKey, suppliedImportHealth, suppliedImportOverview, SUPPLIED_IMPORT_FAILED_EVENT } from "./dealsSuppliedStore";
import { createSuppliedImportHandler, resetSuppliedImportAuthFailures, SUPPLIED_IMPORT_PATH, suppliedImportBodyLimit, type SuppliedImportResponse } from "./dealsSuppliedImport";

const BUILDER = "Legend Homes";
const SITE = "https://www.livelegendhomes.com";
const PAGES = ["fixture-ranch", "fixture-crossing", "fixture-creek"].map((slug) => `${SITE}/communities/san-antonio/schertz-cibolo/guadalupe/cibolo/${slug}`);
const [C1, C2, C3] = PAGES as [string, string, string];

type Home = SuppliedImport["communities"][number]["homes"][number];
type Community = SuppliedImport["communities"][number];
const home = (page: string, n: number, over: Partial<Home> = {}): Home => ({ url: `${page}/quick-move-in-homes/${n}-fixture-way`, address: `${n} Fixture Way, Cibolo, TX 78108`, plan: "Kerrville", price: 329_990 + n, beds: 4, baths: 2.5, sqft: 2_100, garage: 2, status: "available", moveIn: "ready now", ...over });
const community = (page: string, homes: Home[], over: Partial<Community> = {}): Community => ({ communityUrl: page, pageComplete: true, homesShownCount: homes.filter((entry) => entry.status !== "sold").length, incentiveText: null, homes, ...over });
const body = (communities: unknown[], capturedAt: Date) => ({ builder: BUILDER, capturedAt: capturedAt.toISOString(), communities });
/** A full, good day: 2, 3 and 1 homes. */
const goodDay = (capturedAt: Date) => body([community(C1, [home(C1, 101), home(C1, 102)]), community(C2, [home(C2, 201), home(C2, 202), home(C2, 203)]), community(C3, [home(C3, 301)])], capturedAt);

let db: FakeDealsDb;
let server: Server;
let base: string;
let key: string;
let clock: Date;
let ids: number[];
const T0 = new Date("2026-11-15T12:18:00Z"); // Sunday 6:18 AM Central: the last good run.
const hours = (count: number) => new Date(T0.getTime() + count * 3_600_000);

beforeEach(async () => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true });
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: true });
  mocks.processDealPhoto.mockResolvedValue({ ok: true });
  mocks.processPendingDealPhotos.mockResolvedValue({ processed: 0, retried: 0, skipped: 0 });
  // Legend's site is never fetched: the import is the only source.
  mocks.loadOfficialDeals.mockImplementation(async () => { throw new Error("network read attempted"); });
  resetSuppliedImportAuthFailures();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  ids = PAGES.map((page, index) => db.seed(dealCommunities, { builder: BUILDER, privateName: `Fixture ${index + 1}`, sourceUrl: page, privateAddress: "100 Fixture Way, Cibolo, TX 78108", publicLabel: "Northeast San Antonio | Near Randolph", areaLabel: "Northeast San Antonio", reelCode: `lg${index + 1}`, scrubList: JSON.stringify({ community: [`Fixture ${index + 1}`] }), active: true, paused: false, manualMode: false, zipCentroidLat: "29.56", zipCentroidLng: "-98.23" }));
  key = (await generateSuppliedImportKey(BUILDER)).key;
  clock = T0;
  const app = express();
  app.use(SUPPLIED_IMPORT_PATH, suppliedImportBodyLimit());
  app.use(express.json({ limit: "50mb" }));
  app.post(SUPPLIED_IMPORT_PATH, createSuppliedImportHandler({ leaseWaitMs: 0, now: () => clock }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${SUPPLIED_IMPORT_PATH}`;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); vi.restoreAllMocks(); vi.clearAllMocks(); });

/** The agent's call at `at`: the pages were read five minutes before it. */
async function post(at: Date, make: (capturedAt: Date) => unknown) {
  clock = at;
  const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(make(new Date(at.getTime() - 5 * 60_000))) });
  return { status: response.status, body: await response.json() as SuppliedImportResponse & { error?: string; issues?: Array<{ path: string; message: string }> } };
}
type HomeRow = typeof dealHomes.$inferSelect;
const available = (id: number) => (db.rows(dealHomes) as HomeRow[]).filter((row) => row.communityId === id && row.status === "available");
const liveCounts = () => ids.map((id) => available(id).length);
const failures = () => (db.rows(dealEvents) as Array<{ kind: string; detail: string }>).filter((row) => row.kind === SUPPLIED_IMPORT_FAILED_EVENT).map((row) => JSON.parse(row.detail) as { communityId: number; status: string; reasons: string[] });
const adminRow = async (id: number, at: Date) => (await suppliedImportOverview(at))[0]!.communities.find((entry) => entry.id === id)!;

describe("Legend daily import: each community on its own", () => {
  it("success: every community publishes, the response says what is live, nothing is flagged", async () => {
    const run = await post(T0, goodDay);
    expect(run.status).toBe(200);
    expect(run.body.ok).toBe(true);
    expect(run.body.communities.map((entry) => [entry.status, entry.retry, entry.live?.homesAvailable])).toEqual([["published", false, 2], ["published", false, 3], ["published", false, 1]]);
    expect(run.body.communities.every((entry) => entry.live?.lastPublishedAt === T0.toISOString())).toBe(true);
    expect(liveCounts()).toEqual([2, 3, 1]);
    expect(failures()).toEqual([]);
    expect(await suppliedImportHealth(hours(1))).toEqual([]);
    expect(await adminRow(ids[0]!, hours(1))).toMatchObject({ homesAvailable: 2, lastPublishedAt: T0, lastFailure: null });
  });

  it("a null feed for one community (Tuesday's failure): the others publish, that one keeps its last good listings and is reported for a retry", async () => {
    await post(T0, goodDay);
    // Next morning the agent could not read the third page: null counts, no homes list.
    const run = await post(hours(24), (capturedAt) => body([
      community(C1, [home(C1, 101, { price: 319_990 }), home(C1, 102), home(C1, 103)]),
      community(C2, [home(C2, 201), home(C2, 202)]),
      { communityUrl: C3, pageComplete: null, homesShownCount: null, incentiveText: null, homes: null },
    ], capturedAt));
    expect(run.status).toBe(200);
    expect(run.body.ok).toBe(false);
    expect(run.body.communities.map((entry) => entry.status)).toEqual(["published", "published", "rejected"]);
    const unread = run.body.communities[2]!;
    expect(unread).toMatchObject({ communityUrl: C3, index: 2, reasons: ["invalid_payload"], retry: true, homesShownCount: null, live: { homesAvailable: 1, lastPublishedAt: T0.toISOString() } });
    expect(unread.problems.join(" ")).toContain("communities.2.homesShownCount");
    // The two complete communities took their changes: a third home, a sold home, a price drop.
    expect(liveCounts()).toEqual([3, 2, 1]);
    expect(available(ids[0]!).find((row) => row.sourceUrl.endsWith("101-fixture-way"))!.price).toBe(319_990);
    // The unread one kept Sunday's listing and Sunday's import: nothing was stored for it.
    expect((db.rows(dealSuppliedImports) as Array<{ communityId: number }>).filter((row) => row.communityId === ids[2]).length).toBe(1);
    expect(failures()).toEqual([{ communityId: ids[2], status: "rejected", reasons: ["invalid_payload"], capturedAt: expect.any(String) }]);
    expect((await adminRow(ids[2]!, hours(24.5))).lastFailure).toMatchObject({ status: "rejected", reasons: ["invalid_payload"] });
    // The 7 AM check (after the run) names it; the two that refreshed are not in the line.
    const health = await suppliedImportHealth(hours(24.7));
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ builder: BUILDER, expected: 3, missed: [], held: [], failed: [ids[2]] });
    expect(health[0]!.line).toContain("1 of 3 communities did not refresh");
  });

  it("a payload where nothing could be read still answers 400, stores nothing, and leaves a failure on record for each known community", async () => {
    await post(T0, goodDay);
    const run = await post(hours(24), (capturedAt) => body(PAGES.map((page) => ({ communityUrl: page, pageComplete: true, homesShownCount: null, homes: [] })), capturedAt));
    expect(run.status).toBe(400);
    expect(run.body.error).toBe("invalid_payload");
    expect(run.body.issues!.map((issue) => issue.path)).toEqual(["communities.0.homesShownCount", "communities.1.homesShownCount", "communities.2.homesShownCount"]);
    expect(run.body.communities.map((entry) => [entry.status, entry.retry])).toEqual([["rejected", true], ["rejected", true], ["rejected", true]]);
    expect(liveCounts()).toEqual([2, 3, 1]);
    expect(db.rows(dealSuppliedImports)).toHaveLength(3);
    expect(failures().map((entry) => entry.communityId)).toEqual(ids);
  });

  it("retry: the failed community sent again alone publishes, clears its failure, and touches nothing else", async () => {
    await post(T0, goodDay);
    await post(hours(24), (capturedAt) => body([community(C1, [home(C1, 101), home(C1, 102)]), community(C2, [home(C2, 201), home(C2, 202), home(C2, 203)]), { communityUrl: C3, pageComplete: true, homesShownCount: null, homes: [] }], capturedAt));
    const before = JSON.stringify((db.rows(dealHomes) as HomeRow[]).filter((row) => row.communityId !== ids[2]));
    const retry = await post(hours(24.2), (capturedAt) => body([community(C3, [home(C3, 301), home(C3, 302)])], capturedAt));
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, communities: [{ status: "published", retry: false, live: { homesAvailable: 2 } }] });
    expect(liveCounts()).toEqual([2, 3, 2]);
    expect(JSON.stringify((db.rows(dealHomes) as HomeRow[]).filter((row) => row.communityId !== ids[2]))).toBe(before);
    expect((await adminRow(ids[2]!, hours(24.5))).lastFailure).toBeNull();
    expect(await suppliedImportHealth(hours(24.7))).toEqual([]);
  });

  it("a partial page (fewer homes sent than the page shows) holds that community only, keeps its listings, and asks for a retry", async () => {
    await post(T0, goodDay);
    const run = await post(hours(24), (capturedAt) => body([community(C1, [home(C1, 101), home(C1, 102)]), community(C2, [home(C2, 201)], { homesShownCount: 3 }), community(C3, [home(C3, 301)], { pageComplete: false })], capturedAt));
    expect(run.body.communities.map((entry) => [entry.status, entry.reasons.join(), entry.retry])).toEqual([["published", "", false], ["held", "supplied_import_incomplete", true], ["held", "supplied_import_incomplete", true]]);
    // Nothing swept to sold on a partial read.
    expect(liveCounts()).toEqual([2, 3, 1]);
    const health = await suppliedImportHealth(hours(24.7));
    expect(health[0]).toMatchObject({ missed: [], held: [ids[1], ids[2]], failed: [] });
    expect(health[0]!.line).toContain("2 of 3 communities did not refresh");
    expect(health[0]!.line).not.toMatch(/Fixture|Way/);
  });
});

describe("Legend daily import: a real zero is not missing data", () => {
  it("a complete page with no homes holds on the first visit, is not confirmed by a retry minutes later, and sweeps to sold only when the next day's visit agrees", async () => {
    await post(T0, goodDay);
    const zero = (capturedAt: Date) => body([community(C3, [])], capturedAt);
    const first = await post(hours(24), zero);
    expect(first.body.communities[0]).toMatchObject({ status: "held", reasons: ["supplied_import_incomplete"], retry: false, live: { homesAvailable: 1 } });
    expect(first.body.communities[0]!.problems.join(" ")).toMatch(/second visit at least 6 hours later/);
    // The agent retries ten minutes later: the same failed visit, not a second opinion.
    const again = await post(hours(24.2), zero);
    expect(again.body.communities[0]).toMatchObject({ status: "held", live: { homesAvailable: 1 } });
    expect(liveCounts()).toEqual([2, 3, 1]);
    // Tomorrow's run finds none again: verified zero inventory.
    const next = await post(hours(48), zero);
    expect(next.body.communities[0]).toMatchObject({ status: "published", retry: false, live: { homesAvailable: 0 } });
    expect(liveCounts()).toEqual([2, 3, 0]);
  });

  it("missing data (null count, no list) is never read as zero, however many times it is sent", async () => {
    await post(T0, goodDay);
    for (const at of [24, 48, 72]) {
      const run = await post(hours(at), (capturedAt) => body([{ communityUrl: C3, pageComplete: true, homesShownCount: null, homes: null }], capturedAt));
      expect(run.status).toBe(400);
    }
    expect(liveCounts()).toEqual([2, 3, 1]);
    expect((db.rows(dealHomes) as HomeRow[]).filter((row) => row.status === "sold")).toHaveLength(0);
  });
});

describe("Legend daily import: missed run and replay", () => {
  it("a missed run: the last good listings stay live and the morning check flags every community with no import in 26 hours", async () => {
    await post(T0, goodDay);
    expect(await suppliedImportHealth(hours(18))).toEqual([]);
    // Monday's run never arrived. Monday 7 AM check:
    const health = await suppliedImportHealth(hours(24.7 + 2));
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ expected: 3, missed: ids, held: [], lastCapturedAt: new Date(T0.getTime() - 5 * 60_000) });
    expect(health[0]!.line).toContain("3 of 3 communities did not refresh");
    expect(liveCounts()).toEqual([2, 3, 1]);
    // A paused or Manual community is not expected to refresh.
    (db.rows(dealCommunities) as Array<{ id: number; paused: boolean }>).find((row) => row.id === ids[0])!.paused = true;
    expect((await suppliedImportHealth(hours(27)))[0]).toMatchObject({ expected: 2, missed: [ids[1], ids[2]] });
  });

  it("replay: the same body sent twice writes once (no second import row, no second home, no second price entry) and keeps the visit before it", async () => {
    await post(T0, goodDay);
    const captured = new Date(hours(24).getTime() - 5 * 60_000);
    const day2 = () => body([community(C1, [home(C1, 101, { price: 319_990 }), home(C1, 102)]), community(C2, [home(C2, 201), home(C2, 202), home(C2, 203)]), community(C3, [home(C3, 301)])], captured);
    const first = await post(hours(24), day2);
    const snapshot = () => JSON.stringify({ homes: (db.rows(dealHomes) as HomeRow[]).map((row) => [row.communityId, row.sourceKey, row.status, row.price, row.previousPrice]), history: db.rows(dealHomePriceHistory).length, imports: (db.rows(dealSuppliedImports) as Array<{ communityId: number; capturedAt: Date }>).map((row) => [row.communityId, row.capturedAt.toISOString()]).sort() });
    const once = snapshot();
    const second = await post(hours(24.1), day2);
    expect(second.status).toBe(200);
    expect(second.body.communities.map((entry) => entry.status)).toEqual(first.body.communities.map((entry) => entry.status));
    expect(snapshot()).toBe(once);
    // Two visits per community are kept: Sunday's and Monday's, not Monday's twice.
    expect((db.rows(dealSuppliedImports) as Array<{ communityId: number }>).filter((row) => row.communityId === ids[0])).toHaveLength(2);
    expect(failures()).toEqual([]);
  });

  it("a corrected resend of the same visit takes the first one's place; an older capture never rolls a community back", async () => {
    await post(T0, goodDay);
    const captured = new Date(hours(24).getTime() - 5 * 60_000);
    await post(hours(24), () => body([community(C3, [home(C3, 301)], { homesShownCount: 2 })], captured));
    expect(liveCounts()[2]).toBe(1);
    const fixed = await post(hours(24.1), () => body([community(C3, [home(C3, 301), home(C3, 302)])], captured));
    expect(fixed.body.communities[0]).toMatchObject({ status: "published", live: { homesAvailable: 2 } });
    expect((db.rows(dealSuppliedImports) as Array<{ communityId: number }>).filter((row) => row.communityId === ids[2])).toHaveLength(2);
    const old = await post(hours(24.2), () => body([community(C3, [home(C3, 301)])], new Date(T0.getTime() - 60 * 60_000)));
    expect(old.body.communities[0]).toMatchObject({ status: "rejected", reasons: ["older_than_stored"], retry: false, live: { homesAvailable: 2 } });
    expect(liveCounts()[2]).toBe(2);
  });
});
