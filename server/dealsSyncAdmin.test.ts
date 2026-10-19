import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealIncentives, dealJobRuns } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import type { DealAdapterResult, DealHoldReason } from "./dealsAdapters";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  loadOfficialDeals: vi.fn(),
  sendBuilderDealsEmail: vi.fn(),
  refreshCommunityGeography: vi.fn(),
  processDealPhoto: vi.fn(),
  processPendingDealPhotos: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null }));
vi.mock("./dealsPhotos", () => ({ processDealPhoto: (...args: unknown[]) => mocks.processDealPhoto(...args), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));
vi.mock("./dealsAdapters", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsAdapters")>()), loadOfficialDeals: (...args: unknown[]) => mocks.loadOfficialDeals(...args) }));

import { CATALOG_HOLD_REASON_HELP, DealsAdminError, acceptIncentiveHold, describeCatalogHold, dismissIncentiveHold, heldIncentiveMissingFields, listCommunityDiagnostics, refreshCommunityInBackground, saveIncentiveForCommunity, storedScrubListForCommunity, testCommunitySource } from "./dealsSyncAdmin";
import { chicagoEndOfDay } from "./dealsService";

const COMMUNITY_URL = "https://www.mihomes.com/new-homes/texas/greater-san-antonio/southeast-san-antonio/fixture-gardens";
let db: FakeDealsDb;
let communityId: number;

function okSnapshot(): DealAdapterResult {
  return {
    ok: true, catalogOk: true, incentiveHoldReasons: [], fetchedAt: new Date().toISOString(), holdReasons: [],
    private: { builder: "M/I Homes", sourceUrl: COMMUNITY_URL, privateCommunityName: "Fixture Gardens", pages: [], plans: [], homes: [{ sourceUrl: `${COMMUNITY_URL}/fixture-a-plan/8301-a`, privateName: "8301 A", status: "Quick Move-In", price: 400_000, bedrooms: 4, bathrooms: 3, squareFeet: 2_300, gallery: [] }], incentive: null },
    public: { plans: [], homes: [], incentive: null, holdReasons: [] },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(() => setTimeout(resolve, 0)));

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "sent", deliveryLog: "resend sent" });
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: true });
  mocks.processDealPhoto.mockResolvedValue({ ok: true });
  mocks.processPendingDealPhotos.mockResolvedValue({ processed: 0, retried: 0, skipped: 0 });
  mocks.loadOfficialDeals.mockResolvedValue(okSnapshot());
  communityId = db.seed(dealCommunities, {
    builder: "M/I Homes", privateName: "Fixture Gardens", sourceUrl: COMMUNITY_URL, privateAddress: "8106 Fixture Street, San Antonio, TX 78263",
    publicLabel: "Southeast San Antonio | New Phase Now Selling", areaLabel: "Southeast San Antonio", reelCode: "vg1",
    scrubList: JSON.stringify({ builder: ["M/I Homes", "M/I"], lender: ["M/I Financial"], community: ["Fixture Gardens"], plan: ["Magnolia"], street: ["Fixture Street"], other: [] }),
    active: true, paused: false, manualMode: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("refreshCommunityInBackground", () => {
  it("records a job run, runs the single-community refresh after returning, and refuses a concurrent second run", async () => {
    const first = await refreshCommunityInBackground(communityId);
    expect(first).toEqual({ queued: true, jobName: `deals-refresh-community-${communityId}` });
    expect(db.rows(dealJobRuns)[0]).toMatchObject({ jobName: `deals-refresh-community-${communityId}`, status: "running" });
    expect(mocks.loadOfficialDeals).not.toHaveBeenCalled();
    expect(await refreshCommunityInBackground(communityId)).toMatchObject({ queued: false, reason: "already_running" });
    await flush();
    expect(mocks.loadOfficialDeals).toHaveBeenCalledTimes(1);
    expect(db.rows(dealJobRuns)[0]).toMatchObject({ status: "ok" });
    expect(db.rows(dealHomes)).toHaveLength(1);
    expect(db.rows(dealCommunities)[0].lastSuccessfulSyncAt).toBeInstanceOf(Date);
    // Finished today: the same day may be refreshed again.
    expect(await refreshCommunityInBackground(communityId)).toMatchObject({ queued: true });
  });

  it("refuses manual-mode and Manual-builder communities", async () => {
    const manualId = db.seed(dealCommunities, { builder: "Manual", privateName: "Hand Fixture", sourceUrl: "https://example.test/", privateAddress: "", publicLabel: "Label", areaLabel: "Area", reelCode: "mn1", scrubList: "[]", manualMode: true });
    await expect(refreshCommunityInBackground(manualId)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    db.rows(dealCommunities)[0].manualMode = true;
    await expect(refreshCommunityInBackground(communityId)).rejects.toBeInstanceOf(DealsAdminError);
    expect(db.rows(dealJobRuns)).toHaveLength(0);
  });
});

describe("incentive admin", () => {
  it("saves a manual incentive with categorized scrubbing, sticky dates and re-confirmation, replacing the active row", async () => {
    db.seed(dealIncentives, { communityId, normalizedText: "old", publicText: "Old promo", active: true, confirmedAt: new Date(Date.now() - 86_400_000) });
    db.rows(dealCommunities)[0].incentiveHoldReason = "missing_apr (text 12345678)";
    db.rows(dealCommunities)[0].holdReason = "incentive: missing_apr (text 12345678)";
    const saved = await saveIncentiveForCommunity({ communityId, manual: true, publicText: "4.999% (5.737% APR) FHA 30-year fixed through M/I Financial on select homes with 3.5% down payment. Contract by 11/8/26.", headlineRate: "4.999%", apr: "5.737%", loanType: "FHA", repaymentTerms: "30-year fixed", downPayment: "3.5% down payment", contractBy: "2026-11-08" });
    const row = db.rows(dealIncentives).find((value) => value.id === saved.id)!;
    expect(row).toMatchObject({ manual: true, active: true, held: false, contractByManual: true, closeByManual: false, contractBy: chicagoEndOfDay(2026, 11, 8), expiresAt: chicagoEndOfDay(2026, 11, 8) });
    expect(row.publicText).toContain("the builder's lender");
    expect(row.publicText).not.toContain("M/I");
    expect(db.rows(dealIncentives).filter((value) => value.active)).toHaveLength(1);
    expect(db.rows(dealCommunities)[0]).toMatchObject({ incentiveHoldReason: null, holdReason: null });
    expect(db.rows(dealCommunities)[0].catalogUpdatedAt).toBeInstanceOf(Date);
  });

  it("scrubs plan and street names by category, refuses residue it cannot scrub, and requires the fields the wording needs", async () => {
    const saved = await saveIncentiveForCommunity({ communityId, manual: true, publicText: "Ask about the Magnolia plan on Fixture Street. Magnolia trees line the entry." });
    expect(db.rows(dealIncentives).find((row) => row.id === saved.id)?.publicText).toBe("Ask about this plan on this street. Magnolia trees line the entry.");
    db.rows(dealCommunities)[0].scrubList = JSON.stringify({ other: ["VGX"] });
    await expect(saveIncentiveForCommunity({ communityId, manual: true, publicText: "Ask about VGX today." })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Private names remain in incentive text." });
    await expect(saveIncentiveForCommunity({ communityId, manual: true, publicText: "First-year rates as low as 4.25% (6.051% APR).", apr: "6.051%" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Required before publication: followOnRate, followOnPeriod" });
    expect(db.rows(dealIncentives)).toHaveLength(1);
  });

  it("accepts a held incentive only once its hold reasons are satisfied, making the entered date sticky", async () => {
    const manualId = db.seed(dealIncentives, { communityId, normalizedText: "manual", publicText: "Manual promo 4% rate 5% APR", active: true, manual: true, confirmedAt: new Date() });
    const heldId = db.seed(dealIncentives, { communityId, normalizedText: "held", publicText: "First-year rates as low as 4.25% (6.051% APR). Sign a purchase agreement by October 18.", headlineRate: "4.25%", apr: "6.051%", active: false, held: true, holdReason: JSON.stringify(["missing_follow_on_rate", "missing_follow_on_period", "missing_contract_deadline", "differs_from_manual_override"]), confirmedAt: new Date() });
    db.rows(dealCommunities)[0].incentiveHoldReason = "pending";
    const held = db.rows(dealIncentives).find((row) => row.id === heldId)! as typeof dealIncentives.$inferSelect;
    expect(heldIncentiveMissingFields(held)).toEqual(["followOnRate", "followOnPeriod", "contractBy"]);
    await expect(acceptIncentiveHold({ id: heldId, followOnRate: "5.25%" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await acceptIncentiveHold({ id: heldId, followOnRate: "5.25%", followOnPeriod: "years 2-30", contractBy: "2026-10-18" });
    expect(db.rows(dealIncentives).find((row) => row.id === heldId)).toMatchObject({ active: true, held: false, holdReason: null, followOnRate: "5.25%", contractBy: chicagoEndOfDay(2026, 10, 18), contractByManual: true, expiresAt: chicagoEndOfDay(2026, 10, 18) });
    expect(db.rows(dealIncentives).find((row) => row.id === manualId)?.active).toBe(false);
    expect(db.rows(dealCommunities)[0].incentiveHoldReason).toBeNull();
    await expect(acceptIncentiveHold({ id: heldId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accepts the 'no contract deadline in the text' tick instead of a date and dismisses a hold without publishing", async () => {
    const heldId = db.seed(dealIncentives, { communityId, normalizedText: "held", publicText: "Sign a purchase agreement by the end of the month for $5,000 in closing costs.", active: false, held: true, holdReason: JSON.stringify(["missing_contract_deadline"]), confirmedAt: new Date() });
    await expect(acceptIncentiveHold({ id: heldId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await acceptIncentiveHold({ id: heldId, noContractDeadline: true });
    expect(db.rows(dealIncentives).find((row) => row.id === heldId)).toMatchObject({ active: true, held: false, contractBy: null, contractByManual: false });
    const otherId = db.seed(dealIncentives, { communityId, normalizedText: "other", publicText: "Other", active: false, held: true, holdReason: JSON.stringify(["missing_apr"]), confirmedAt: new Date() });
    db.rows(dealCommunities)[0].incentiveHoldReason = "missing_apr (text 00000000)";
    await dismissIncentiveHold(otherId);
    expect(db.rows(dealIncentives).find((row) => row.id === otherId)).toMatchObject({ active: false, held: false, holdReason: "dismissed" });
    expect(db.rows(dealCommunities)[0].incentiveHoldReason).toBeNull();
  });
});

describe("testCommunitySource", () => {
  it("refuses Manual communities and non-www official hosts without any network request", async () => {
    const fetcher = vi.fn();
    const manualId = db.seed(dealCommunities, { builder: "Manual", privateName: "Hand Fixture", sourceUrl: "https://internal.example/", privateAddress: "", publicLabel: "Label", areaLabel: "Area", reelCode: "mn1", scrubList: "[]", manualMode: true });
    await expect(testCommunitySource(manualId, fetcher as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    db.rows(dealCommunities)[0].sourceUrl = "https://mihomes.com/new-homes/texas/fixture";
    await expect(testCommunitySource(communityId, fetcher as never)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("www.mihomes.com") });
    db.rows(dealCommunities)[0].sourceUrl = "https://www.mihomes.com:8443/new-homes/texas/fixture";
    await expect(testCommunitySource(communityId, fetcher as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads at most 64 KB of the body and reports a redirect without following it", async () => {
    const big = new Uint8Array(200 * 1024).fill(97);
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) { for (let offset = 0; offset < big.length; offset += 16 * 1024) controller.enqueue(big.slice(offset, offset + 16 * 1024)); controller.close(); } }), { status: 200 }));
    const result = await testCommunitySource(communityId, fetcher as never);
    expect(result).toMatchObject({ host: "www.mihomes.com", status: 200, bytes: 65_536, truncated: true, redirected: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", method: "GET" });
    const redirecting = vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://attacker.example/" } }));
    expect(await testCommunitySource(communityId, redirecting as never)).toMatchObject({ status: 301, redirected: true, redirectSameHost: false, bytes: 0 });
    expect(redirecting).toHaveBeenCalledTimes(1);
  });
});

describe("diagnostics and scrub storage", () => {
  it("stores a categorized scrub list with the builder and community always present and never the word Manual", () => {
    const stored = JSON.parse(storedScrubListForCommunity({ builder: "Chesmar", privateName: "Fixture Lakes", scrubList: ["Fixture Lakes", "Arroyo Fixture", "Manual", "Chesmar"] }));
    expect(stored.builder).toEqual(expect.arrayContaining(["Chesmar Homes", "Chesmar"]));
    expect(stored.community).toEqual(["Fixture Lakes"]);
    expect(stored.other).toEqual(["Arroyo Fixture"]);
    const categorized = JSON.parse(storedScrubListForCommunity({ builder: "Chesmar", privateName: "Fixture Lakes", scrubList: { plan: ["Magnolia"], street: ["Grove Fixture"] }, existing: JSON.stringify(["Legacy Term"]) }));
    expect(categorized).toMatchObject({ plan: ["Magnolia"], street: ["Grove Fixture"], other: ["Legacy Term"] });
    expect(categorized.excludedTerms).toBeUndefined();
  });

  it("extends the discovered plan and street lists by default, replaces them only with replaceDiscovered, and keeps the exclusion list beside the categories", () => {
    const existing = JSON.stringify({ builder: ["Chesmar Homes", "Chesmar"], community: ["Fixture Lakes"], plan: ["Magnolia", "Cypress"], street: ["Grove Fixture", "New Homes in San Antonio"], other: ["Legacy Term"], excludedTerms: ["New Homes in San Antonio"] });
    const union = JSON.parse(storedScrubListForCommunity({ builder: "Chesmar", privateName: "Fixture Lakes", scrubList: { plan: ["Oak"] }, existing }));
    expect(union).toMatchObject({ plan: ["Magnolia", "Cypress", "Oak"], street: ["Grove Fixture"], other: ["Legacy Term"], excludedTerms: ["New Homes in San Antonio"] });

    const replaced = JSON.parse(storedScrubListForCommunity({ builder: "Chesmar", privateName: "Fixture Lakes", scrubList: { plan: ["Oak"], street: [] }, existing, replaceDiscovered: true }));
    expect(replaced).toMatchObject({ plan: ["Oak"], street: [], other: ["Legacy Term"], community: ["Fixture Lakes"], excludedTerms: ["New Homes in San Antonio"] });
    expect(replaced.builder).toEqual(expect.arrayContaining(["Chesmar Homes", "Chesmar"]));

    // A submitted list replaces the stored exclusions (an empty one clears them) and is stripped from plan/street/other at save time.
    const excluded = JSON.parse(storedScrubListForCommunity({ builder: "Chesmar", privateName: "Fixture Lakes", scrubList: { plan: ["Oak"] }, existing, excludedTerms: ["  Magnolia ", "magnolia", "Fixture Lakes", "Chesmar"] }));
    expect(excluded).toMatchObject({ plan: ["Cypress", "Oak"], excludedTerms: ["Magnolia", "Fixture Lakes", "Chesmar"], community: ["Fixture Lakes"] });
    expect(excluded.builder).toEqual(expect.arrayContaining(["Chesmar"]));
    const cleared = JSON.parse(storedScrubListForCommunity({ builder: "Chesmar", privateName: "Fixture Lakes", existing, excludedTerms: [] }));
    expect(cleared.excludedTerms).toBeUndefined();
    expect(cleared.street).toEqual(["Grove Fixture", "New Homes in San Antonio"]);
  });

  it("describes every catalog-level hold reason for the operator, including an unlabelled home status", () => {
    const reasons: DealHoldReason[] = ["invalid_source_url", "unsupported_official_host", "community_fetch_failed", "sitemap_fetch_failed", "detail_fetch_failed", "missing_community_guid", "inventory_fetch_failed", "invalid_inventory_response", "incomplete_inventory", "expected_community_container_not_found", "expected_detail_container_not_found", "unlabelled_home_status", "private_text_remaining"];
    for (const reason of reasons) expect(CATALOG_HOLD_REASON_HELP[reason]).toEqual(expect.stringMatching(/\w/));
    expect(describeCatalogHold("unlabelled_home_status")).toEqual(["A home card's status could not be read, so nothing was published or marked sold this run."]);
    expect(describeCatalogHold("community_fetch_failed, detail_fetch_failed")).toHaveLength(2);
    expect(describeCatalogHold("something_new")).toEqual(["something new"]);
    for (const text of Object.values(CATALOG_HOLD_REASON_HELP)) expect(text).not.toContain("—");
  });

  it("lists holds, counts and held incentives with their missing fields per community", async () => {
    db.rows(dealCommunities)[0].catalogHoldReason = "community_fetch_failed";
    db.rows(dealCommunities)[0].catalogHoldSeenAt = new Date(Date.now() - 5 * 3_600_000);
    db.seed(dealHomes, { communityId, sourceKey: "k1", sourceUrl: "https://www.mihomes.com/a", kind: "quick_move_in", status: "available", origin: "official" });
    db.seed(dealHomes, { communityId, sourceKey: "k2", sourceUrl: "https://www.mihomes.com/b", kind: "to_be_built", status: "sold", origin: "official" });
    db.seed(dealIncentives, { communityId, normalizedText: "held", publicText: "First-year 4.25% (6.051% APR)", apr: "6.051%", active: false, held: true, holdReason: JSON.stringify(["missing_follow_on_rate"]), confirmedAt: new Date() });
    const [diagnostics] = await listCommunityDiagnostics();
    expect(diagnostics).toMatchObject({ id: communityId, builder: "M/I Homes", refreshDue: true, catalogHold: { reason: "community_fetch_failed", ageHours: 5, help: ["The official community page could not be fetched."] }, homes: { quickMoveIn: 1, toBeBuilt: 0, sold: 1, hidden: 0, manual: 0 }, incentive: null });
    expect(diagnostics.heldIncentives[0]).toMatchObject({ reasons: ["missing_follow_on_rate"], missingFields: ["followOnRate", "followOnPeriod"] });
    expect(diagnostics.scrubConfig.plan).toEqual(["Magnolia"]);
    expect(diagnostics.excludedTerms).toEqual([]);

    // Excluded terms are reported and removed from the effective categories the admin sees.
    db.rows(dealCommunities)[0].scrubList = JSON.stringify({ plan: ["Magnolia"], street: ["Fixture Street", "New Homes in San Antonio"], excludedTerms: ["New Homes in San Antonio"] });
    const [excluded] = await listCommunityDiagnostics();
    expect(excluded.excludedTerms).toEqual(["New Homes in San Antonio"]);
    expect(excluded.scrubConfig.street).toEqual(["Fixture Street"]);
  });
});
