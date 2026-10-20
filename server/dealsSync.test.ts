import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomePriceHistory, dealHomes, dealIncentives, dealSettings } from "../drizzle/schema";
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
import { communityRefreshDue, refreshOfficialDeals, refreshOfficialDealsIfDue, revalidateDealIncentives, storedScrubConfig } from "./dealsSync";
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

  it("expires dated records and lapses undated ones in the evening job with one email each, leaving fresh records alone", async () => {
    db.seed(dealIncentives, { communityId, normalizedText: "dated", publicText: "Dated promo", active: true, expiresAt: new Date(T0.getTime() - 60_000), closeBy: new Date(T0.getTime() - 60_000), confirmedAt: new Date(T0.getTime() - DAY) });
    db.seed(dealIncentives, { communityId, normalizedText: "undated old", publicText: "Undated old promo", active: true, confirmedAt: new Date(T0.getTime() - 15 * DAY) });
    db.seed(dealIncentives, { communityId, normalizedText: "undated fresh", publicText: "Undated fresh promo", active: true, confirmedAt: new Date(T0.getTime() - 2 * DAY) });
    const result = await revalidateDealIncentives(T0);
    expect(result).toEqual({ ok: true, expired: 1, lapsed: 1, checked: 3 });
    expect(db.rows(dealIncentives).map((row) => [row.active, row.holdReason])).toEqual([[false, "expired"], [false, "lapsed_unconfirmed"], [true, null]]);
    expect(emails().map((email) => email.subject)).toEqual(["Builder Deals incentive expired: Fixture Gardens", "Builder Deals incentive lapsed: Fixture Gardens"]);
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
    const results = await refreshOfficialDealsIfDue(new Date("2026-10-21T11:00:00Z"));
    expect(results.map((result) => [result.communityId, result.ok])).toEqual([[communityId, true], [dueId, true]]);
    expect(mocks.loadOfficialDeals).toHaveBeenCalledTimes(2);
    expect(db.rows(dealCommunities).find((row) => row.id === freshId)?.lastAttemptAt).toBeNull();
    mocks.loadOfficialDeals.mockClear();
    expect(await refreshOfficialDealsIfDue(new Date("2026-10-21T12:00:00Z"))).toEqual([{ communityId: 0, reelCode: "scheduled", ok: true, skipped: "fresh_within_refresh_window" }]);
    expect(mocks.loadOfficialDeals).not.toHaveBeenCalled();
  });

  it("returns every due community as ok:false when all of them are held, so the scheduled run is recorded as failed instead of fresh", async () => {
    const secondId = seedCommunity({ reelCode: "second", privateName: "Second Fixture", lastSuccessfulSyncAt: null });
    mocks.loadOfficialDeals.mockResolvedValue(snapshot({ catalogOk: false, holdReasons: ["community_fetch_failed"] }));
    const results = await refreshOfficialDealsIfDue(new Date("2026-10-21T11:00:00Z"));
    expect(results).toEqual([
      { communityId, reelCode: "vg1", ok: false, reason: "community_fetch_failed" },
      { communityId: secondId, reelCode: "second", ok: false, reason: "community_fetch_failed" },
    ]);
    expect(results.some((result) => result.ok)).toBe(false);
    expect(db.rows(dealCommunities).map((row) => [row.catalogHoldReason, row.lastSuccessfulSyncAt])).toEqual([["community_fetch_failed", null], ["community_fetch_failed", null]]);
    // One hold email names both communities; the data each one had (none yet) is untouched.
    expect(emails().map((email) => email.category)).toEqual(["deals_sync_hold"]);
    expect(emails()[0].subject).toBe("Builder Deals hold: Fixture Gardens, Second Fixture");
    expect(db.rows(dealHomes)).toEqual([]);
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
