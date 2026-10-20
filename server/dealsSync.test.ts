import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomePriceHistory, dealHomes, dealIncentives, dealSettings, dealSyncDigestEntries } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import type { DealAdapterResult, DealHoldReason, PrivatePlanOrHome } from "./dealsAdapters";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  loadOfficialDeals: vi.fn(),
  sendBuilderDealsEmail: vi.fn(),
  refreshCommunityGeography: vi.fn(),
  processDealPhoto: vi.fn(),
  processPendingDealPhotos: vi.fn(),
  listHeartbeatJobs: vi.fn(),
  createHeartbeatJob: vi.fn(),
  updateHeartbeatJob: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsPhotos", () => ({ processDealPhoto: (...args: unknown[]) => mocks.processDealPhoto(...args), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));
vi.mock("./dealsAdapters", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsAdapters")>()), loadOfficialDeals: (...args: unknown[]) => mocks.loadOfficialDeals(...args) }));
vi.mock("./_core/heartbeat", () => ({
  listHeartbeatJobs: (...args: unknown[]) => mocks.listHeartbeatJobs(...args),
  createHeartbeatJob: (...args: unknown[]) => mocks.createHeartbeatJob(...args),
  updateHeartbeatJob: (...args: unknown[]) => mocks.updateHeartbeatJob(...args),
}));

import { parsePromotionalRate } from "./dealsAdapters";
import { buildersInFlight, communityRefreshDue, leaseBuilder, leaseRenewingFetcher, refreshDueCommunitiesBatch, refreshOfficialDeals, revalidateDealIncentives, sendSyncDigestIfReady, storedScrubConfig } from "./dealsSync";
import { DEALS_JOB_DEFINITIONS, ensureDealsCron } from "./registerCron";
import { chicagoEndOfDay } from "./dealsService";

const COMMUNITY_URL = "https://www.mihomes.com/new-homes/texas/greater-san-antonio/southeast-san-antonio/fixture-gardens";
const home = (slug: string) => `${COMMUNITY_URL}/fixture-a-plan/${slug}`;
const plan = (slug: string) => `${COMMUNITY_URL}/${slug}-plan`;
const DAY = 86_400_000;
const T0 = new Date("2026-10-18T11:04:00Z"); // 06:04 Chicago (CDT)

type Item = Partial<PrivatePlanOrHome> & { sourceUrl: string };
function item(sourceUrl: string, overrides: Partial<PrivatePlanOrHome> = {}): PrivatePlanOrHome {
  return { sourceUrl, privateName: overrides.privateName ?? sourceUrl.split("/").pop()!, status: "Quick Move-In", price: 400_000, bedrooms: 4, bathrooms: 3, squareFeet: 2_300, gallery: [], ...overrides };
}

function snapshot(input: { homes?: Item[]; plans?: Item[]; incentiveText?: string | null; catalogOk?: boolean; holdReasons?: DealHoldReason[]; incentiveHoldReasons?: DealHoldReason[]; facts?: DealAdapterResult["private"]["communityFacts"]; discovered?: DealAdapterResult["private"]["discoveredScrubConfig"] } = {}): DealAdapterResult {
  const homes = (input.homes ?? []).map((value) => item(value.sourceUrl, value));
  const plans = (input.plans ?? []).map((value) => item(value.sourceUrl, { status: null, ...value }));
  const catalogOk = input.catalogOk ?? true;
  const holdReasons = input.holdReasons ?? [];
  const incentive = input.incentiveText ? { sourceUrl: `${COMMUNITY_URL}/incentives/current`, text: input.incentiveText, facts: parsePromotionalRate(input.incentiveText) } : null;
  return {
    ok: catalogOk && holdReasons.length === 0,
    catalogOk,
    incentiveHoldReasons: input.incentiveHoldReasons ?? (incentive && !incentive.facts.publishable ? incentive.facts.holdReasons : []),
    fetchedAt: T0.toISOString(),
    private: { builder: "M/I Homes", sourceUrl: COMMUNITY_URL, privateCommunityName: "Fixture Gardens", pages: [], plans, homes, incentive, communityFacts: input.facts, discoveredScrubConfig: input.discovered },
    public: { plans: [], homes: [], incentive: null, holdReasons },
    holdReasons,
  };
}

const FULL_TEXT = "Fall Into Savings: first-year rates as low as 4.25% (6.051% APR). 5.25% (6.051% APR) for years 2-30 on a 30-year fixed FHA loan with 3.5% down payment. Valid on contracts written between 10/12/2026 and 11/8/2026; buyer must close by 11/30/2026.";
const NO_DATE_TEXT = "4.999% (5.737% APR) FHA 30-year fixed-rate financing on select homes with 3.5% down payment.";
const HELD_TEXT = "First-year rates as low as 4.25% (6.051% APR) on selected quick move-in homes. Sign a purchase agreement by October 18.";

let db: FakeDealsDb;
let communityId: number;

function seedCommunity(overrides: Partial<typeof dealCommunities.$inferInsert> = {}) {
  return db.seed(dealCommunities, {
    builder: "M/I Homes", privateName: "Fixture Gardens", sourceUrl: COMMUNITY_URL, privateAddress: "8106 Fixture Street, San Antonio, TX 78263",
    publicLabel: "Southeast San Antonio | New Phase Now Selling", areaLabel: "Southeast San Antonio", reelCode: "vg1",
    scrubList: JSON.stringify(["Vista Gardens"]), active: true, paused: false, manualMode: false, ...overrides,
  });
}

const activeIncentives = () => db.rows(dealIncentives).filter((row) => row.active);
const emails = () => mocks.sendBuilderDealsEmail.mock.calls.map(([input]) => input as { category: string; subject: string; content: string; recipients: string[] });

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "sent", deliveryLog: "resend sent" });
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: true });
  mocks.processDealPhoto.mockResolvedValue({ ok: true });
  mocks.processPendingDealPhotos.mockResolvedValue({ processed: 0, retried: 0, skipped: 0 });
  communityId = seedCommunity();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("official refresh: homes", () => {
  it("adds, marks absent homes sold on a complete snapshot, and sets a reappearing listing back to available in place", async () => {
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }, { sourceUrl: home("8305-b") }], plans: [{ sourceUrl: plan("fixture-a") }] }));
    const first = await refreshOfficialDeals({ communityId, now: T0 });
    expect(first).toEqual([{ communityId, reelCode: "vg1", ok: true }]);
    expect(db.rows(dealHomes).map((row) => [row.sourceUrl, row.kind, row.status])).toEqual([
      [plan("fixture-a"), "to_be_built", "available"], [home("8301-a"), "quick_move_in", "available"], [home("8305-b"), "quick_move_in", "available"],
    ]);
    const hiddenId = db.seed(dealHomes, { communityId, sourceKey: "hidden-key", sourceUrl: home("hidden"), kind: "quick_move_in", status: "hidden", origin: "official" });
    const manualId = db.seed(dealHomes, { communityId, sourceKey: "manual-key", sourceUrl: home("manual"), kind: "quick_move_in", status: "available", origin: "manual" });

    // 8305-b disappears, the plan disappears, and a model home is never a QMI.
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }, { sourceUrl: home("9010-model"), status: "Model For Tour" }] }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 3 * DAY) });
    const byUrl = () => Object.fromEntries(db.rows(dealHomes).map((row) => [row.sourceUrl, row.status]));
    expect(byUrl()).toMatchObject({ [home("8301-a")]: "available", [home("8305-b")]: "sold", [plan("fixture-a")]: "sold", [home("hidden")]: "hidden", [home("manual")]: "available" });
    expect(db.rows(dealHomes).some((row) => row.sourceUrl === home("9010-model"))).toBe(false);
    const summary = emails().filter((email) => email.category === "deals_sync_summary").at(-1);
    expect(summary?.content).toContain("sold: 8305-b");
    expect(summary?.content).toContain("sold: fixture-a-plan");

    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }, { sourceUrl: home("8305-b") }, { sourceUrl: home("8309-c"), status: "Sold" }] }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 6 * DAY) });
    expect(byUrl()).toMatchObject({ [home("8305-b")]: "available", [home("8309-c")]: "sold", [home("8301-a")]: "available" });
    expect(db.rows(dealHomes).find((row) => row.id === hiddenId)?.status).toBe("hidden");
    expect(db.rows(dealHomes).find((row) => row.id === manualId)?.status).toBe("available");
    expect(emails().filter((email) => email.category === "deals_sync_summary").at(-1)?.content).toContain("back on the market: 8305-b");
  });

  it("records every observed price, derives the Price drop from 30-day history only, and ignores the card's was-price", async () => {
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a"), price: 400_000, previousPrice: 450_000 }] }));
    await refreshOfficialDeals({ communityId, now: T0 });
    const row = () => db.rows(dealHomes).find((value) => value.sourceUrl === home("8301-a"))!;
    expect(row()).toMatchObject({ price: 400_000, previousPrice: null });
    expect(db.rows(dealHomePriceHistory).map((value) => value.price)).toEqual([400_000]);

    const dropDay = new Date(T0.getTime() + 40 * DAY);
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a"), price: 380_000, previousPrice: 450_000 }] }));
    await refreshOfficialDeals({ communityId, now: dropDay });
    expect(row()).toMatchObject({ price: 380_000, previousPrice: 400_000 });
    expect(db.rows(dealHomePriceHistory).map((value) => value.price)).toEqual([400_000, 400_000, 380_000]);
    expect(emails().at(-1)?.content).toContain("price drop: 8301-a $400,000 to $380,000");

    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a"), price: 380_000 }] }));
    await refreshOfficialDeals({ communityId, now: new Date(dropDay.getTime() + 3 * DAY) });
    expect(db.rows(dealHomePriceHistory)).toHaveLength(3);
    expect(row().previousPrice).toBe(400_000);

    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a"), price: 380_000 }] }));
    await refreshOfficialDeals({ communityId, now: new Date(dropDay.getTime() + 35 * DAY) });
    expect(row().previousPrice).toBeNull();
  });

  it("writes community facts and merges discovered plan and street names into the categorized scrub list", async () => {
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({
      homes: [{ sourceUrl: home("8301-a") }],
      facts: { fromPrice: 354_990, schoolDistrict: "Fixture County ISD", lotSizes: "Half-acre homesites", amenities: ["Walking trails", "Fixture Gardens clubhouse"] },
      discovered: { builder: [], lender: [], community: [], plan: ["Magnolia"], street: ["Fixture Street"], other: [] },
    }));
    await refreshOfficialDeals({ communityId, now: T0 });
    const community = db.rows(dealCommunities)[0];
    expect(community).toMatchObject({ fromPrice: 354_990, schoolDistrict: "Fixture County ISD", lotSizes: "Half-acre homesites" });
    expect(JSON.parse(String(community.amenities))).toEqual(["Walking trails", "this community clubhouse"]);
    const scrub = storedScrubConfig(community as never);
    expect(scrub.plan).toEqual(["Magnolia"]);
    expect(scrub.street).toEqual(["Fixture Street"]);
    expect(scrub.community).toEqual(["Fixture Gardens"]);
    expect(scrub.other).toEqual(["Vista Gardens"]);
    expect(scrub.builder).toEqual(expect.arrayContaining(["M/I Homes", "M/I"]));
  });
});

describe("official refresh: holds", () => {
  it("records a catalog hold once, keeps the last good data, and stays quiet after Dismiss until the parse result changes", async () => {
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }] }));
    await refreshOfficialDeals({ communityId, now: T0 });
    mocks.sendBuilderDealsEmail.mockClear();
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ catalogOk: false, holdReasons: ["expected_community_container_not_found"] }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 3 * DAY) });
    const community = () => db.rows(dealCommunities)[0];
    expect(community()).toMatchObject({ catalogHoldReason: "expected_community_container_not_found", holdReason: "catalog: expected_community_container_not_found" });
    expect(community().catalogHoldSeenAt).toBeInstanceOf(Date);
    expect(db.rows(dealHomes)[0].status).toBe("available");
    expect(emails().map((email) => email.category)).toEqual(["deals_sync_hold"]);
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 6 * DAY) });
    expect(emails()).toHaveLength(1);

    const { dismissCatalogHold } = await import("./dealsSyncAdmin");
    expect(await dismissCatalogHold(communityId)).toEqual({ ok: true, dismissed: "expected_community_container_not_found" });
    expect(community()).toMatchObject({ catalogHoldReason: "dismissed:expected_community_container_not_found", holdReason: null });
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 9 * DAY) });
    expect(emails()).toHaveLength(1);
    expect(community().holdReason).toBeNull();

    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ catalogOk: false, holdReasons: ["community_fetch_failed"] }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 12 * DAY) });
    expect(emails()).toHaveLength(2);
    expect(community().holdReason).toBe("catalog: community_fetch_failed");

    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ homes: [{ sourceUrl: home("8301-a") }] }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 15 * DAY) });
    expect(community()).toMatchObject({ catalogHoldReason: null, catalogHoldSeenAt: null, holdReason: null });
  });

  it("holds the run as unlabelled_home_status when a home card has no readable status, publishing nothing and sweeping nothing to sold", async () => {
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }, { sourceUrl: home("8305-b") }], incentiveText: FULL_TEXT }));
    await refreshOfficialDeals({ communityId, now: T0 });
    expect(db.rows(dealHomes).map((row) => row.status)).toEqual(["available", "available"]);
    mocks.sendBuilderDealsEmail.mockClear();

    // A wording drift leaves one card without "Quick Move-In"/"Sold": the whole run is held, nothing flips.
    const drifted = snapshot({ homes: [{ sourceUrl: home("8301-a") }, { sourceUrl: home("8305-b"), status: null }, { sourceUrl: home("8309-c"), status: "Quick Move-In", price: 420_000 }], incentiveText: NO_DATE_TEXT });
    mocks.loadOfficialDeals.mockResolvedValue(drifted);
    const later = new Date(T0.getTime() + 3 * DAY);
    expect(await refreshOfficialDeals({ communityId, now: later })).toEqual([{ communityId, reelCode: "vg1", ok: false, reason: "unlabelled_home_status" }]);
    const community = () => db.rows(dealCommunities)[0];
    expect(community()).toMatchObject({ catalogHoldReason: "unlabelled_home_status", catalogHoldSeenAt: later, holdReason: "catalog: unlabelled_home_status", lastAttemptAt: later, lastSuccessfulSyncAt: T0 });
    expect(db.rows(dealHomes).map((row) => [row.sourceUrl, row.status])).toEqual([[home("8301-a"), "available"], [home("8305-b"), "available"]]);
    expect(db.rows(dealHomes).some((row) => row.sourceUrl === home("8309-c"))).toBe(false);
    expect(activeIncentives().map((row) => row.publicText)).toHaveLength(1);
    expect(String(activeIncentives()[0].publicText)).toContain("4.25%");
    expect(emails().map((email) => email.category)).toEqual(["deals_sync_hold"]);
    expect(emails()[0].content).toContain("catalog hold: unlabelled_home_status");
    expect(emails()[0].content).not.toContain("sold:");

    // The same parse result stays quiet; a readable page clears the hold and resumes publishing.
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 6 * DAY) });
    expect(emails()).toHaveLength(1);
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ homes: [{ sourceUrl: home("8301-a") }, { sourceUrl: home("8309-c"), price: 420_000 }] }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 9 * DAY) });
    expect(community()).toMatchObject({ catalogHoldReason: null, holdReason: null });
    expect(Object.fromEntries(db.rows(dealHomes).map((row) => [row.sourceUrl, row.status]))).toMatchObject({ [home("8301-a")]: "available", [home("8305-b")]: "sold", [home("8309-c")]: "available" });
  });

  it("keeps the admin's excluded terms across a sync and never re-adds an excluded discovered name", async () => {
    db.rows(dealCommunities)[0].scrubList = JSON.stringify({ plan: ["Magnolia"], street: ["New Homes in San Antonio"], other: ["Vista Gardens"], excludedTerms: ["New Homes in San Antonio"] });
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({
      homes: [{ sourceUrl: home("8301-a") }],
      discovered: { builder: [], lender: [], community: [], plan: ["Cypress"], street: ["New Homes in San Antonio", "Fixture Street"], other: [] },
    }));
    await refreshOfficialDeals({ communityId, now: T0 });
    const community = db.rows(dealCommunities)[0];
    const stored = JSON.parse(String(community.scrubList)) as Record<string, string[]>;
    expect(stored.excludedTerms).toEqual(["New Homes in San Antonio"]);
    expect(stored.street).toEqual(["Fixture Street"]);
    expect(stored.plan).toEqual(["Magnolia", "Cypress"]);
    const scrub = storedScrubConfig(community as never);
    expect(scrub.street).toEqual(["Fixture Street"]);
    expect(scrub.community).toEqual(["Fixture Gardens"]);
    // The adapter configuration carries the exclusion so a re-discovered heading is not treated as private either.
    expect(mocks.loadOfficialDeals.mock.calls[0]![0]).toMatchObject({ excludedTerms: ["New Homes in San Antonio"], scrubConfig: expect.objectContaining({ street: [] }) });
  });
});

describe("official refresh: incentive lifecycle", () => {
  it("publishes a new text, re-confirms the same text in place, and replaces it with a new record when the text changes", async () => {
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: FULL_TEXT }));
    await refreshOfficialDeals({ communityId, now: T0 });
    expect(db.rows(dealIncentives)).toHaveLength(1);
    const first = db.rows(dealIncentives)[0];
    expect(first).toMatchObject({ active: true, held: false, manual: false, headlineRate: "4.25%", followOnRate: "5.25%", apr: "6.051%", loanType: "FHA", downPayment: "3.5% down payment", repaymentTerms: "30-year fixed" });
    expect(first.contractBy).toEqual(chicagoEndOfDay(2026, 11, 8));
    expect(first.expiresAt).toEqual(chicagoEndOfDay(2026, 11, 8));
    expect(String(first.publicText)).not.toContain("Fixture Gardens");

    const later = new Date(T0.getTime() + 3 * DAY);
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: FULL_TEXT.replace("selected", "select") }));
    await refreshOfficialDeals({ communityId, now: later });
    expect(db.rows(dealIncentives)).toHaveLength(1);
    expect(db.rows(dealIncentives)[0].confirmedAt).toEqual(later);

    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: NO_DATE_TEXT }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 6 * DAY) });
    expect(db.rows(dealIncentives).map((row) => [row.active, row.expiresAt === null])).toEqual([[false, false], [true, true]]);
    expect(emails().at(-1)?.content).toContain("New incentive published");
  });

  it("holds unpublishable text behind Accept, takes the previous promo off at once, and emails that hold once", async () => {
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: FULL_TEXT }));
    await refreshOfficialDeals({ communityId, now: T0 });
    mocks.sendBuilderDealsEmail.mockClear();
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: HELD_TEXT }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 3 * DAY) });
    expect(activeIncentives()).toEqual([]);
    const held = db.rows(dealIncentives).find((row) => row.held)!;
    expect(JSON.parse(String(held.holdReason))).toEqual(["missing_follow_on_rate", "missing_follow_on_period", "missing_contract_deadline"]);
    expect(held.active).toBe(false);
    const community = db.rows(dealCommunities)[0];
    expect(String(community.incentiveHoldReason)).toMatch(/^missing_contract_deadline, missing_follow_on_period, missing_follow_on_rate \(text [0-9a-f]{8}\)$/);
    expect(String(community.holdReason)).toMatch(/^incentive: missing_contract_deadline/);
    expect(emails().filter((email) => email.category === "deals_sync_hold")).toHaveLength(1);
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 6 * DAY) });
    expect(emails().filter((email) => email.category === "deals_sync_hold")).toHaveLength(1);
    expect(db.rows(dealIncentives).filter((row) => row.held)).toHaveLength(1);

    // The builder moves on to publishable text: the stale held record is retired, not left pending.
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: NO_DATE_TEXT }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 9 * DAY) });
    expect(db.rows(dealIncentives).find((row) => row.id === held.id)).toMatchObject({ held: false, active: false, holdReason: "superseded" });
    expect(activeIncentives().map((row) => row.publicText)).toEqual([NO_DATE_TEXT]);
    expect(db.rows(dealCommunities)[0]).toMatchObject({ incentiveHoldReason: null, holdReason: null });
  });

  it("keeps a manual override and its sticky dates, holds a differing scrape with differs_from_manual_override, and names a dropped manual date", async () => {
    const manualId = db.seed(dealIncentives, { communityId, normalizedText: "4.999% 5.737% apr fha 30 year fixed rate financing on select homes with 3.5% down payment", publicText: NO_DATE_TEXT, manual: true, active: true, held: false, contractBy: chicagoEndOfDay(2026, 11, 8), contractByManual: true, expiresAt: chicagoEndOfDay(2026, 11, 8), confirmedAt: new Date(T0.getTime() - 5 * DAY) });
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: NO_DATE_TEXT }));
    await refreshOfficialDeals({ communityId, now: T0 });
    const manual = () => db.rows(dealIncentives).find((row) => row.id === manualId)!;
    expect(manual()).toMatchObject({ active: true, manual: true, contractBy: chicagoEndOfDay(2026, 11, 8), confirmedAt: T0 });
    expect(db.rows(dealIncentives)).toHaveLength(1);

    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: FULL_TEXT }));
    await refreshOfficialDeals({ communityId, now: new Date(T0.getTime() + 3 * DAY) });
    expect(manual().active).toBe(true);
    const scraped = db.rows(dealIncentives).find((row) => row.id !== manualId)!;
    expect(scraped).toMatchObject({ active: false, held: true });
    expect(JSON.parse(String(scraped.holdReason))).toEqual(["replaces_manual_date", "differs_from_manual_override"]);
    const hold = emails().find((email) => email.category === "deals_sync_hold")!;
    expect(hold.content).toContain("Dropped manual date(s): contract-by 2026-11-08");
    expect(hold.content).toContain("differs_from_manual_override");
  });

  it("never revives a date-expired or dismissed record for the same text, but a lapsed no-date record returns", async () => {
    db.seed(dealIncentives, { communityId, normalizedText: "4.999% 5.737% apr fha 30 year fixed rate financing on select homes with 3.5% down payment", publicText: NO_DATE_TEXT, active: false, held: false, holdReason: "expired", expiresAt: new Date(T0.getTime() - DAY), confirmedAt: new Date(T0.getTime() - 10 * DAY) });
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: NO_DATE_TEXT }));
    await refreshOfficialDeals({ communityId, now: T0 });
    expect(db.rows(dealIncentives)).toHaveLength(1);
    expect(db.rows(dealIncentives)[0]).toMatchObject({ active: false, holdReason: "expired" });

    const lapsedId = db.seed(dealIncentives, { communityId, normalizedText: "lapsed promo text 4%", publicText: "Lapsed promo text 4%", active: false, held: false, holdReason: "lapsed_unconfirmed", confirmedAt: new Date(T0.getTime() - 20 * DAY) });
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: "Lapsed promo text 4%" }));
    await refreshOfficialDeals({ communityId, now: T0 });
    expect(db.rows(dealIncentives).find((row) => row.id === lapsedId)).toMatchObject({ active: true, holdReason: null, confirmedAt: T0 });

    const dismissedId = db.seed(dealIncentives, { communityId, normalizedText: "dismissed text", publicText: "Dismissed text", active: false, held: false, holdReason: "dismissed", confirmedAt: T0 });
    mocks.loadOfficialDeals.mockResolvedValueOnce(snapshot({ homes: [{ sourceUrl: home("8301-a") }], incentiveText: "Dismissed text" }));
    await refreshOfficialDeals({ communityId, now: T0 });
    expect(db.rows(dealIncentives).find((row) => row.id === dismissedId)).toMatchObject({ active: false, holdReason: "dismissed" });
    expect(emails().filter((email) => email.category === "deals_sync_hold")).toHaveLength(0);
  });

  it("expires dated records and lapses undated ones in the evening job, into one digest entry for the follow-up email, leaving fresh records alone", async () => {
    db.seed(dealIncentives, { communityId, normalizedText: "dated", publicText: "Dated promo", active: true, expiresAt: new Date(T0.getTime() - 60_000), closeBy: new Date(T0.getTime() - 60_000), confirmedAt: new Date(T0.getTime() - DAY) });
    db.seed(dealIncentives, { communityId, normalizedText: "undated old", publicText: "Undated old promo", active: true, confirmedAt: new Date(T0.getTime() - 15 * DAY) });
    db.seed(dealIncentives, { communityId, normalizedText: "undated fresh", publicText: "Undated fresh promo", active: true, confirmedAt: new Date(T0.getTime() - 2 * DAY) });
    const result = await revalidateDealIncentives(T0);
    expect(result).toEqual({ ok: true, expired: 1, lapsed: 1, checked: 3 });
    expect(db.rows(dealIncentives).map((row) => [row.active, row.holdReason])).toEqual([[false, "expired"], [false, "lapsed_unconfirmed"], [true, null]]);
    // No email per incentive: both go into the digest, and the 6 PM follow-up carries them in one message.
    expect(emails()).toEqual([]);
    expect(db.rows(dealSyncDigestEntries)).toHaveLength(1);
    expect(await sendSyncDigestIfReady(new Date("2026-10-19T00:10:00Z"), true)).toBe("sent");
    expect(emails().map((email) => email.subject)).toEqual(["Builder Deals update: 4 changes"]);
    expect(emails()[0].content).toContain("came off the page: reached its close-by date (2026-10-18)");
    expect(emails()[0].content).toContain("came off the page: no dates and not re-confirmed for 14 days");
    expect(emails()[0].recipients).toEqual(["peter@lifestyledesignrealty.com"]);
    expect(mocks.loadOfficialDeals).not.toHaveBeenCalled();
  });
});

describe("scheduling", () => {
  it("is due daily by default (or every N days from Admin) regardless of the finish time, and refreshes only the due communities", async () => {
    expect(communityRefreshDue(null, T0)).toBe(true);
    // Daily by default: yesterday's pull is due this morning, today's is not.
    expect(communityRefreshDue(T0, new Date("2026-10-19T11:00:00Z"))).toBe(true);
    expect(communityRefreshDue(T0, new Date("2026-10-18T23:00:00Z"))).toBe(false);
    // Admin can slow it to every third day, the earlier pace.
    expect(communityRefreshDue(T0, new Date("2026-10-21T11:00:00Z"), 3)).toBe(true); // 06:04 day 0 -> 06:00 day 3
    expect(communityRefreshDue(T0, new Date("2026-10-20T11:30:00Z"), 3)).toBe(false);
    expect(communityRefreshDue(new Date("2026-10-31T23:30:00Z"), new Date("2026-11-03T12:00:00Z"), 3)).toBe(true); // across the DST change
    expect(communityRefreshDue(T0, new Date("2026-10-19T11:00:00Z"), 0)).toBe(true); // a nonsense setting falls back to daily
    db.seed(dealSettings, { key: "builder_deals", value: JSON.stringify({ catalogRefreshDays: 3 }) });
    db.rows(dealCommunities)[0].lastSuccessfulSyncAt = T0;
    const freshId = seedCommunity({ reelCode: "fresh", privateName: "Fresh Fixture", lastSuccessfulSyncAt: new Date("2026-10-20T12:00:00Z") });
    const dueId = seedCommunity({ reelCode: "due", privateName: "Due Fixture", lastSuccessfulSyncAt: null });
    seedCommunity({ reelCode: "manual", privateName: "Manual Fixture", builder: "Manual", manualMode: true, lastSuccessfulSyncAt: null });
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ homes: [{ sourceUrl: home("8301-a") }] }));
    const batch = await refreshDueCommunitiesBatch({ clock: () => Date.parse("2026-10-21T11:00:00Z") });
    // Never-pulled first, then the oldest data.
    expect(batch.results.map((result) => [result.communityId, result.ok])).toEqual([[dueId, true], [communityId, true]]);
    expect(batch).toMatchObject({ checked: 2, ok: 2, failed: 0, remaining: 0, stoppedForTime: false, digest: "sent" });
    expect(mocks.loadOfficialDeals).toHaveBeenCalledTimes(2);
    expect(db.rows(dealCommunities).find((row) => row.id === freshId)?.lastAttemptAt).toBeNull();
    // Everything due was tried, so the morning summary went out at 6 AM in one email.
    expect(emails().map((email) => email.category)).toEqual(["deals_sync_summary"]);
    mocks.loadOfficialDeals.mockClear();
    expect(await refreshDueCommunitiesBatch({ clock: () => Date.parse("2026-10-21T12:00:00Z") })).toMatchObject({ checked: 0, remaining: 0, results: [] });
    expect(mocks.loadOfficialDeals).not.toHaveBeenCalled();
  });

  it("reports every due community as failed when all of them are held, in one hold email", async () => {
    const secondId = seedCommunity({ reelCode: "second", privateName: "Second Fixture", lastSuccessfulSyncAt: null });
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ catalogOk: false, holdReasons: ["community_fetch_failed"] }));
    const batch = await refreshDueCommunitiesBatch({ clock: () => Date.parse("2026-10-21T11:00:00Z") });
    expect(batch.results).toEqual([
      { communityId, reelCode: "vg1", ok: false, reason: "community_fetch_failed" },
      { communityId: secondId, reelCode: "second", ok: false, reason: "community_fetch_failed" },
    ]);
    expect(batch).toMatchObject({ ok: 0, failed: 2 });
    expect(db.rows(dealCommunities).map((row) => [row.catalogHoldReason, row.lastSuccessfulSyncAt])).toEqual([["community_fetch_failed", null], ["community_fetch_failed", null]]);
    // One hold email names both communities; the data each one had (none yet) is untouched.
    expect(emails().map((email) => email.category)).toEqual(["deals_sync_hold"]);
    expect(emails()[0].subject).toBe("Builder Deals hold: Fixture Gardens, Second Fixture");
    expect(db.rows(dealHomes)).toEqual([]);
  });

  it("stops starting communities when its few minutes are up, and the next batch picks up the rest", async () => {
    const ids = [communityId, seedCommunity({ reelCode: "b", privateName: "B", sourceUrl: `${COMMUNITY_URL}-b` }), seedCommunity({ reelCode: "c", privateName: "C", sourceUrl: `${COMMUNITY_URL}-c` })];
    let clock = Date.parse("2026-10-21T11:00:00Z");
    // Each builder page takes 100 seconds.
    mocks.loadOfficialDeals.mockImplementation(async (config: { sourceUrl: string }) => { clock += 100_000; return snapshot({ homes: [{ sourceUrl: `${config.sourceUrl}/fixture-a-plan/8301-a` }] }); });
    const first = await refreshDueCommunitiesBatch({ clock: () => clock, budgetMs: 150_000 });
    expect(first).toMatchObject({ checked: 2, remaining: 1, stoppedForTime: true, digest: "waiting" });
    expect(emails()).toEqual([]);
    clock += 10 * 60_000;
    const second = await refreshDueCommunitiesBatch({ clock: () => clock, budgetMs: 150_000 });
    expect(second).toMatchObject({ checked: 1, remaining: 0, stoppedForTime: false, digest: "sent" });
    expect(new Set([...first.results, ...second.results].map((result) => result.communityId))).toEqual(new Set(ids));
    // Both batches' changes arrive in one summary email.
    expect(emails().map((email) => email.category)).toEqual(["deals_sync_summary"]);
    for (const name of ["Fixture Gardens", "B", "C"]) expect(emails()[0].content).toContain(`${name} (M/I Homes)\n  added:`);
  });

  it("checks different builders side by side but one builder's communities one at a time", async () => {
    seedCommunity({ reelCode: "m2", privateName: "M2", sourceUrl: `${COMMUNITY_URL}-2` });
    seedCommunity({ reelCode: "c1", privateName: "C1", builder: "Chesmar", sourceUrl: "https://www.chesmar.com/c1/" });
    seedCommunity({ reelCode: "c2", privateName: "C2", builder: "Chesmar", sourceUrl: "https://www.chesmar.com/c2/" });
    const inFlight: string[] = [];
    let mostAtOnce = 0;
    let sameBuilderOverlap = false;
    mocks.loadOfficialDeals.mockImplementation(async (config: { builder: string }) => {
      if (inFlight.includes(config.builder)) sameBuilderOverlap = true;
      inFlight.push(config.builder);
      mostAtOnce = Math.max(mostAtOnce, inFlight.length);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight.splice(inFlight.indexOf(config.builder), 1);
      return snapshot({ homes: [{ sourceUrl: home("8301-a") }] });
    });
    const batch = await refreshDueCommunitiesBatch({ clock: () => Date.parse("2026-10-21T11:00:00Z") });
    expect(batch).toMatchObject({ checked: 4, ok: 4 });
    expect(mostAtOnce).toBe(2);
    expect(sameBuilderOverlap).toBe(false);
  });

  it("does not retry a community within 90 minutes of its last try, and never checks one another batch just took", async () => {
    const at = Date.parse("2026-10-21T11:00:00Z");
    db.rows(dealCommunities)[0].lastAttemptAt = new Date(at - 30 * 60_000);
    const olderTry = seedCommunity({ reelCode: "older", privateName: "Older", sourceUrl: `${COMMUNITY_URL}-older`, lastAttemptAt: new Date(at - 2 * 3_600_000) });
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ homes: [{ sourceUrl: home("8301-a") }] }));
    const batch = await refreshDueCommunitiesBatch({ clock: () => at });
    expect(batch.results.map((result) => result.communityId)).toEqual([olderTry]);
  });

  it("leaves a discovered community alone until its builder has a reader: no hold, no email, no attempt", async () => {
    const waiting = seedCommunity({ reelCode: "auto-p", privateName: "Meritage Place", builder: "Meritage Homes", sourceUrl: "https://www.meritagehomes.com/x", active: false, awaitingFirstSync: true });
    db.rows(dealCommunities)[0].lastSuccessfulSyncAt = new Date("2026-10-21T10:00:00Z");
    const batch = await refreshDueCommunitiesBatch({ clock: () => Date.parse("2026-10-21T11:00:00Z") });
    expect(batch).toMatchObject({ checked: 0, results: [] });
    expect(await refreshOfficialDeals({ communityId: waiting, now: new Date("2026-10-21T11:00:00Z") })).toEqual([{ communityId: waiting, reelCode: "auto-p", ok: false, skipped: "no_builder_reader" }]);
    expect(mocks.loadOfficialDeals).not.toHaveBeenCalled();
    expect(db.rows(dealCommunities).find((row) => row.id === waiting)).toMatchObject({ lastAttemptAt: null, catalogHoldReason: null, active: false, awaitingFirstSync: true });
    expect(emails()).toEqual([]);
  });

  it("lets an admin's pause, archive or manual switch during a batch win: the community is skipped or stays off", async () => {
    const at = Date.parse("2026-10-21T11:00:00Z");
    const waiting = seedCommunity({ reelCode: "auto-w", privateName: "Waiting", sourceUrl: `${COMMUNITY_URL}-w`, active: false, awaitingFirstSync: true });
    const paused = seedCommunity({ reelCode: "p", privateName: "Paused Later", sourceUrl: `${COMMUNITY_URL}-p` });
    mocks.loadOfficialDeals.mockImplementation(async (config: { sourceUrl: string }) => {
      // The admin acts while the batch is reading pages: turns the waiting one off, pauses the other.
      if (config.sourceUrl.endsWith("-w")) { const row = db.rows(dealCommunities).find((r) => r.id === waiting)!; row.active = false; row.awaitingFirstSync = false; }
      if (config.sourceUrl === COMMUNITY_URL) { db.rows(dealCommunities).find((r) => r.id === paused)!.paused = true; }
      return snapshot({ homes: [{ sourceUrl: `${config.sourceUrl}/fixture-a-plan/8301-a` }] });
    });
    const batch = await refreshDueCommunitiesBatch({ clock: () => at, lanes: 1 });
    // The waiting community was turned off mid-pull: it stays off. The paused one was never read.
    expect(db.rows(dealCommunities).find((r) => r.id === waiting)).toMatchObject({ active: false, awaitingFirstSync: false });
    expect(batch.results.some((result) => result.communityId === paused)).toBe(false);
    expect(mocks.loadOfficialDeals.mock.calls.some(([config]) => (config as { sourceUrl: string }).sourceUrl.endsWith("-p"))).toBe(false);
  });

  it("keeps a day's changes when the digest email fails, and sends them on the next try", async () => {
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ homes: [{ sourceUrl: home("8301-a") }] }));
    mocks.sendBuilderDealsEmail.mockResolvedValueOnce({ ok: false, status: "failed", deliveryLog: "Resend 500" });
    expect(await refreshDueCommunitiesBatch({ clock: () => Date.parse("2026-10-21T11:00:00Z") })).toMatchObject({ digest: "waiting" });
    expect(db.rows(dealSyncDigestEntries).every((entry) => entry.sentAt === null)).toBe(true);
    // Ten minutes later the slot is free again and the same entries go out.
    expect(await sendSyncDigestIfReady(new Date("2026-10-21T11:10:00Z"), true)).toBe("sent");
    expect(emails().map((email) => email.category)).toEqual(["deals_sync_summary", "deals_sync_summary"]);
    expect(db.rows(dealSyncDigestEntries).every((entry) => entry.sentAt !== null)).toBe(true);
  });

  it("writes each community's digest entry as it finishes, so a crash mid-batch loses nothing already found", async () => {
    seedCommunity({ reelCode: "b", privateName: "B", sourceUrl: `${COMMUNITY_URL}-b` });
    let calls = 0;
    mocks.loadOfficialDeals.mockImplementation(async (config: { sourceUrl: string }) => {
      calls += 1;
      if (calls === 2) throw new Error("boom");
      return snapshot({ homes: [{ sourceUrl: `${config.sourceUrl}/fixture-a-plan/8301-a` }] });
    });
    await refreshDueCommunitiesBatch({ clock: () => Date.parse("2026-10-21T09:00:00Z"), lanes: 1 });
    // The first community's changes are already on file, and the crash itself is a hold the admin will hear about.
    expect(db.rows(dealSyncDigestEntries)).toHaveLength(2);
    expect(JSON.parse(db.rows(dealSyncDigestEntries)[0]!.summaries as string)).toHaveLength(1);
    expect(JSON.parse(db.rows(dealSyncDigestEntries)[1]!.holds as string)).toMatchObject([{ kind: "catalog", reason: "refresh_failed" }]);
    expect(db.rows(dealCommunities).find((row) => row.privateName === "B")?.catalogHoldReason).toBe("refresh_failed");
  });

  it("holds a builder lease: a second batch (or Refresh now) skips a builder another run is reading, and the morning email waits for it", async () => {
    const at = Date.parse("2026-10-21T11:00:00Z");
    seedCommunity({ reelCode: "c1", privateName: "C1", builder: "Chesmar", sourceUrl: "https://www.chesmar.com/c1/" });
    const lease = await leaseBuilder("M/I Homes", new Date(at));
    expect(lease).not.toBeNull();
    expect(await leaseBuilder("M/I Homes", new Date(at))).toBeNull();
    expect(await buildersInFlight(new Date(at))).toEqual(["M/I Homes"]);
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ homes: [{ sourceUrl: home("8301-a") }] }));
    const batch = await refreshDueCommunitiesBatch({ clock: () => at });
    // Only Chesmar was read; the M/I community is left for the run that holds the lease, and the summary waits.
    expect(batch.results.map((result) => result.reelCode)).toEqual(["c1"]);
    expect(batch).toMatchObject({ remaining: 1, digest: "waiting" });
    // That other run has claimed the M/I community (tried today, still in flight): the summary still waits for it.
    db.rows(dealCommunities)[0].lastAttemptAt = new Date(at - 5 * 60_000);
    expect(await refreshDueCommunitiesBatch({ clock: () => at + 60_000 })).toMatchObject({ checked: 0, digest: "waiting" });
    await lease!.release();
    expect(await buildersInFlight(new Date(at))).toEqual([]);
    expect(await refreshDueCommunitiesBatch({ clock: () => at + 120_000 })).toMatchObject({ checked: 0, digest: "sent" });
    // A lease with no heartbeat for two hours belongs to a dead run and can be taken; a heartbeat keeps it alive.
    const first = await leaseBuilder("Chesmar", new Date(at));
    expect(first).not.toBeNull();
    expect(await leaseBuilder("Chesmar", new Date(at + 90 * 60_000))).toBeNull();
    await first!.heartbeat();
    expect(await buildersInFlight(new Date(Date.now() + 100 * 60_000))).toEqual(["Chesmar"]);
    const taker = await leaseBuilder("Chesmar", new Date(Date.now() + 121 * 60_000));
    expect(taker).not.toBeNull();
    // Only the holder can release or extend its lease: the dead run's late release leaves the new holder's lease standing.
    await first!.release();
    await first!.heartbeat();
    expect(await buildersInFlight(new Date(Date.now() + 121 * 60_000))).toEqual(["Chesmar"]);
    await taker!.release();
    expect(await buildersInFlight(new Date(Date.now() + 121 * 60_000))).toEqual([]);
    // One lease row per builder, whatever the day: a run across midnight is still one stream.
    expect(await leaseBuilder("Chesmar", new Date("2026-10-22T05:30:00Z"))).not.toBeNull();
    expect(await leaseBuilder("Chesmar", new Date("2026-10-22T05:35:00Z"))).toBeNull();
  });

  it("renews the builder lease while one community's pages are still being read, so a long community never looks dead", async () => {
    const at = Date.parse("2026-10-21T11:00:00Z");
    seedCommunity({ reelCode: "c1", privateName: "C1", builder: "Chesmar", sourceUrl: "https://www.chesmar.com/c1/" });
    // The reader is handed a fetcher that renews the lease: a batch lane passes its own heartbeat through.
    let options: { fetcher?: unknown } | undefined;
    mocks.loadOfficialDeals.mockImplementation(async (_config: unknown, passed?: { fetcher?: unknown }) => { options = passed; return snapshot({ homes: [{ sourceUrl: home("8301-a") }] }); });
    await refreshDueCommunitiesBatch({ clock: () => at });
    expect(typeof options?.fetcher).toBe("function");
    // The fetcher renews at most once a minute, after a page comes back, and swallows a failed renewal.
    let clock = at;
    const heartbeat = vi.fn(async () => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const fetcher = leaseRenewingFetcher(heartbeat, () => clock, 60_000);
    await fetcher("https://www.chesmar.com/a/");
    expect(heartbeat).not.toHaveBeenCalled();
    clock += 61_000;
    await fetcher("https://www.chesmar.com/b/");
    await fetcher("https://www.chesmar.com/c/");
    expect(heartbeat).toHaveBeenCalledTimes(1);
    clock += 61_000;
    heartbeat.mockRejectedValueOnce(new Error("db away"));
    await expect(fetcher("https://www.chesmar.com/d/")).resolves.toBeInstanceOf(Response);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    fetchSpy.mockRestore();
  });

  it("sends the morning summary once, holds later finds for the 7 PM follow-up, and sends at 10 AM if checks are still running", async () => {
    let clock = Date.parse("2026-10-21T09:05:00Z"); // 4:05 AM Chicago
    const second = seedCommunity({ reelCode: "b", privateName: "B", sourceUrl: `${COMMUNITY_URL}-b` });
    mocks.loadOfficialDeals.mockImplementation(async () => { clock += 100_000; return snapshot({ catalogOk: false, holdReasons: ["community_fetch_failed"] }); });
    // 4:05: one of two tried, the summary waits.
    expect(await refreshDueCommunitiesBatch({ clock: () => clock, budgetMs: 50_000 })).toMatchObject({ checked: 1, digest: "waiting" });
    expect(emails()).toEqual([]);
    // 4:15: the second is tried; everything due has been tried today, so the summary goes out.
    clock = Date.parse("2026-10-21T09:15:00Z");
    expect(await refreshDueCommunitiesBatch({ clock: () => clock, budgetMs: 50_000 })).toMatchObject({ checked: 1, digest: "sent" });
    expect(emails().map((email) => email.subject)).toEqual(["Builder Deals hold: Fixture Gardens, B"]);
    // 6:00: the first community's retry succeeds; the change waits for the evening.
    clock = Date.parse("2026-10-21T11:00:00Z");
    mocks.loadOfficialDeals.mockImplementation(async () => snapshot({ homes: [{ sourceUrl: home("8301-a") }] }));
    expect(await refreshDueCommunitiesBatch({ clock: () => clock })).toMatchObject({ ok: 2, digest: "waiting" });
    expect(emails()).toHaveLength(1);
    // 6:15 PM: not yet (the incentive job runs then); 7:05 PM: the follow-up carries it; a later batch with nothing new sends nothing.
    expect(await sendSyncDigestIfReady(new Date("2026-10-21T23:15:00Z"), true)).toBe("waiting");
    expect(await sendSyncDigestIfReady(new Date("2026-10-22T00:05:00Z"), true)).toBe("sent");
    expect(emails().map((email) => email.category)).toEqual(["deals_sync_hold", "deals_sync_summary"]);
    expect(await sendSyncDigestIfReady(new Date("2026-10-22T00:15:00Z"), true)).toBe("nothing_new");
    // Next day: checks still running at 10 AM, the summary goes out anyway.
    db.seed(dealSyncDigestEntries, { summaries: JSON.stringify([{ communityId: second, privateName: "B", builder: "M/I Homes", added: ["x"], sold: [], reappeared: [], priceChanges: [], incentive: [] }]), holds: "[]" });
    expect(await sendSyncDigestIfReady(new Date("2026-10-22T14:55:00Z"), false)).toBe("waiting"); // 9:55 AM
    expect(await sendSyncDigestIfReady(new Date("2026-10-22T15:05:00Z"), false)).toBe("sent"); // 10:05 AM
    expect(emails()).toHaveLength(3);
  });

  it("reconciles a registered job whose cron expression changed and leaves identical jobs untouched", async () => {
    const catalog = DEALS_JOB_DEFINITIONS.find((job) => job.payload.job === "catalog")!;
    const health = DEALS_JOB_DEFINITIONS.find((job) => job.payload.job === "health")!;
    mocks.listHeartbeatJobs.mockResolvedValue({ total: 2, actorUserId: "owner", jobs: [
      { name: catalog.name, taskUid: "stale-catalog", cronExpression: "0 45 0,23 * * *", callbackPath: catalog.path, callbackPayload: JSON.stringify(catalog.payload) },
      { name: health.name, taskUid: "same-health", cronExpression: health.cron, callbackPath: health.path, callbackPayload: JSON.stringify(health.payload) },
    ] });
    mocks.createHeartbeatJob.mockResolvedValue({ taskUid: "new" });
    mocks.updateHeartbeatJob.mockResolvedValue({});
    await ensureDealsCron();
    expect(mocks.updateHeartbeatJob).toHaveBeenCalledTimes(1);
    expect(mocks.updateHeartbeatJob).toHaveBeenCalledWith("stale-catalog", expect.objectContaining({ cron: catalog.cron, path: catalog.path, payload: catalog.payload }), "");
    expect(mocks.createHeartbeatJob).toHaveBeenCalledTimes(DEALS_JOB_DEFINITIONS.length - 2);
    expect(mocks.createHeartbeatJob.mock.calls.map(([job]) => (job as { payload: { job: string } }).payload.job)).toEqual(expect.arrayContaining(["photos", "activity"]));
  });
});
