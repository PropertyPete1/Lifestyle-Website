import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealIncentives, dealLeads } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import { normalizedText } from "../shared/deals";
import type { DealAdapterResult, PrivatePlanOrHome, PromotionalRateFacts } from "./dealsAdapters";
import { AUTO_ACCEPTED_ADMIN_STATUS, AUTO_ACCEPTED_DATED_ADMIN_STATUS, AUTO_ACCEPTED_NO_DEADLINE, HELD_INCENTIVE_PUBLIC_LINE, heldIncentivePublicEntry, unreadDateIn } from "../shared/dealsHeldIncentive";

/**
 * Review fixes (F1-F5) for the owner's 2026-10-21 rule for held offers: a text held only for a deadline it does not date publishes by itself
 * (undated, so the lapse rule applies), and every other held text shows only "Builder incentive available — ask us for
 * details" on the buyer pages until an Accept or a later read clears it. Adapter mocked; real sync, admin, catalogs and
 * featured ranking on the fake DB.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), loadOfficialDeals: vi.fn(), sendBuilderDealsEmail: vi.fn(), refreshCommunityGeography: vi.fn(), processDealPhoto: vi.fn(), processPendingDealPhotos: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsPhotos", () => ({ processDealPhoto: (...args: unknown[]) => mocks.processDealPhoto(...args), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args), pruneDealPhotoRenders: vi.fn() }));
vi.mock("./dealsAdapters", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsAdapters")>()), loadOfficialDeals: (...args: unknown[]) => mocks.loadOfficialDeals(...args) }));

import { normalizeIncentiveText, parsePromotionalRate } from "./dealsAdapters";
import { refreshOfficialDeals, revalidateDealIncentives } from "./dealsSync";
import { listCommunityDiagnostics, saveIncentiveForCommunity } from "./dealsSyncAdmin";
import { gatedDealsCatalog, publicDealsCatalog } from "./dealsService";
import { featuredDeals } from "./dealsFeatured";
import { heldIncentiveCountsAsShowingLine } from "./dealsMaintenance";

const COMMUNITY_URL = "https://www.mihomes.com/new-homes/texas/greater-san-antonio/southeast-san-antonio/fixture-gardens";
const T0 = new Date(Date.now() - 12 * 3_600_000);
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);
const DAY = 86_400_000;

function item(sourceUrl: string, overrides: Partial<PrivatePlanOrHome> = {}): PrivatePlanOrHome {
  return { sourceUrl, privateName: sourceUrl.split("/").pop()!, status: "Quick Move-In", price: 400_000, bedrooms: 4, bathrooms: 3, squareFeet: 2_300, gallery: [], ...overrides };
}
type Read = { text: string | null; holds?: string[]; offerRead?: boolean; facts?: PromotionalRateFacts };
function snapshot(read: Read): DealAdapterResult {
  const incentive = read.text ? { sourceUrl: `${COMMUNITY_URL}/incentives/current`, text: read.text, facts: read.facts ?? parsePromotionalRate(read.text) } : null;
  return {
    ok: true, catalogOk: true,
    incentiveHoldReasons: read.holds ?? (incentive && !incentive.facts.publishable ? incentive.facts.holdReasons : []),
    fetchedAt: T0.toISOString(),
    private: { builder: "M/I Homes", sourceUrl: COMMUNITY_URL, privateCommunityName: "Fixture Gardens", pages: [], plans: [], homes: [item(`${COMMUNITY_URL}/fixture-a-plan/h1`)], incentive, offerRead: read.offerRead ?? Boolean(incentive), communityFacts: undefined, discoveredScrubConfig: undefined },
    public: { plans: [], homes: [], incentive: null, holdReasons: [] }, holdReasons: [],
  } as DealAdapterResult;
}

let db: FakeDealsDb;
beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true });
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: true });
  mocks.processDealPhoto.mockResolvedValue({ ok: true });
  mocks.processPendingDealPhotos.mockResolvedValue({ processed: 0, retried: 0, skipped: 0 });
});
afterEach(() => { vi.clearAllMocks(); });

function seedCommunity() {
  return db.seed(dealCommunities, { builder: "M/I Homes", privateName: "Fixture Gardens", sourceUrl: COMMUNITY_URL, privateAddress: "8106 Fixture Patch, San Antonio, TX 78263", publicLabel: "Southeast San Antonio | New Phase", areaLabel: "Southeast San Antonio", reelCode: "vg1", scrubList: JSON.stringify({ community: ["Fixture Gardens"], street: ["Fixture Patch"], lender: ["M/I Financial"] }), active: true, paused: false, manualMode: false, zipCentroidLat: "29.3", zipCentroidLng: "-98.4" });
}
function seedLead() {
  return db.seed(dealLeads, { phoneE164: "+12105550123", sourceCode: "vg1", consentText: "c", consentAt: T0, consentIp: "203.0.113.9", deviceHash: "d".repeat(64), status: "verified", expiresAt: new Date(Date.now() + DAY), flags: "[]" });
}
const emails = () => mocks.sendBuilderDealsEmail.mock.calls.map((call) => call[0] as { category: string; subject: string; content: string });
const holdEmails = () => emails().filter((mail) => mail.category === "deals_sync_hold");
const run = async (read: Read | string | null, hours: number, communityId: number) => {
  mocks.loadOfficialDeals.mockResolvedValue(snapshot(typeof read === "object" && read !== null ? read : { text: read, offerRead: true }));
  const result = await refreshOfficialDeals({ communityId, now: at(hours) });
  expect(result[0]).toMatchObject({ ok: true });
};
type Row = typeof dealIncentives.$inferSelect;
const incentiveRows = () => db.rows(dealIncentives) as Row[];
const live = () => incentiveRows().filter((row) => row.active && !row.held);
const heldRows = () => incentiveRows().filter((row) => row.held);
type Entry = { incentive: ({ text: string; headlineRate: string | null; apr: string | null; pending?: boolean } & Record<string, unknown>) | null };
const gated = async (lead: number) => ((await gatedDealsCatalog(lead)) as Entry[])[0]!.incentive;
const team = async (lead: number) => ((await gatedDealsCatalog(lead, { view: "full", builderPages: true })) as Entry[])[0]!.incentive;
const landing = async () => (await publicDealsCatalog())[0]!.incentive as Entry["incentive"];

/** Deadline wording ("closing costs paid by") with no date anywhere: the parser holds it for missing_closing_deadline. */
const NO_DATE = "Up to $10,000 toward closing costs paid by the builder on select quick move-in homes.";
/** The same kind of wording with a date the parser cannot read as a date (no year). */
const UNREAD_DATE = "Up to $10,000 toward closing costs on homes that close by December 15.";
const SIGN = "Sign a contract and receive $5,000 in design studio upgrades from the builder.";
/** One deadline dated, the other named only: it publishes and expires by its date. */
const ONE_DATED = "$15,000 in flex cash on homes closing by 12/31/2026 when you sign a contract by our preferred lender.";
const MANUAL = "Ask about our fall savings event on select quick move-in homes.";
/** A full offer with figures and private names, for the Reg Z reasons. */
const FIGURES = "M/I Financial offers 4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment at Fixture Gardens, plus $10,000 toward closing costs.";
const A_NO_APR = "4.99% interest rate on a 30-year fixed FHA loan with 3.5% down payment on select homes.";

const CLEAN = "Ask about $5,000 in design studio upgrades on select quick move-in homes.";
const NO_DATE_2 = "Up to $12,000 toward closing costs paid by the builder on select quick move-in homes.";
const DIGITS = /\d|%|\$/;

describe("F1: a dated offer the parser cannot date is never published as undated", () => {
  const unread = (text: string) => { const facts = parsePromotionalRate(text); return unreadDateIn(normalizeIncentiveText(text), [facts.contractDeadline, facts.closingDeadline]); };
  it("finds the deadline in every wording the review listed", () => {
    for (const text of [
      "Contract by 12/31 with our preferred lender and get $10,000", "Sign by 12/31 plan pricing", "Close by 12/31 homes only", "Contracts by 12/31 lot premiums", "Sign by 11/30 option", "Sign by 12/31 study",
      "Close by 12/31 bath upgrade", "Close by end of Oct", "Contracts through Dec.", "Close by mid-Nov", "Sign by Sept", "Contracts by Oct-31", "Close by 11.30", "Close by 11-30", "Close by New Year's Eve",
      "Close by year's end", "Contracts by EOM", "Close by Halloween", "Close by the holidays", "Close in the fourth quarter", "Close in Q4", "Close this month", "Offer ends today; closing costs paid by builder",
      "Close by fall for $5,000", "Contracts by the 15th get $5,000", "Valid on select homes for contracts written 10/1/26-10/31/26 and closing by 12/31/26.",
    ]) expect(unread(text), text).not.toBeNull();
  });
  it("still leaves undated wording alone (APR, money, loan figures, buydown and ARM figures, a season's sale name)", () => {
    for (const text of [NO_DATE, SIGN, ONE_DATED, "4.99% (5.62% APR) 30-yr fixed FHA with 3.5% down. Up to $10,000 toward closing costs paid by seller.", "4.99% (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment. Closing costs paid by the builder.", "$5,000 toward closing costs paid by the builder with a 3-2-1 buydown.", "Closing costs paid by builder; 5/1 ARM available.", "Fall Savings Event: closing costs paid by the builder. Call today!"]) {
      expect(unread(text), text).toBeNull();
    }
  });
  it("R5: 'Contract by 12/31 with our preferred lender' stays held and every buyer list shows only the neutral line", async () => {
    const T = "Contract by 12/31 with our preferred lender and get $10,000 toward closing costs.";
    expect(parsePromotionalRate(T).holdReasons).toEqual(["missing_contract_deadline"]);
    const id = seedCommunity();
    const lead = seedLead();
    await run(T, 0, id);
    expect(live()).toHaveLength(0);
    expect(heldRows()).toHaveLength(1);
    for (const incentive of [await landing(), await gated(lead), await team(lead)]) {
      expect(incentive).toEqual(heldIncentivePublicEntry());
      expect(JSON.stringify(incentive)).not.toMatch(DIGITS);
    }
    // No teaser of the held text anywhere on the landing entry.
    expect(JSON.stringify((await publicDealsCatalog())[0])).not.toMatch(/preferred lender|10,000/);
    expect(holdEmails()[0]!.content).toContain("a date the reader could not read");
  });
});

describe("F2: a returning record takes this read's figures and dates", () => {
  it("R3: a superseded record an older parser misread returns with the figures this read gives", async () => {
    const TEXT = "4.99% (5.62% APR) 30-year fixed FHA loan with 3.5% down payment. Closing costs paid by the builder.";
    expect(parsePromotionalRate(TEXT).holdReasons).toEqual(["missing_closing_deadline"]);
    const id = seedCommunity();
    const lead = seedLead();
    db.seed(dealIncentives, { communityId: id, normalizedText: normalizedText(TEXT), publicText: TEXT, headlineRate: "3.5%", apr: "4.99%", loanType: "FHA", downPayment: "3.5% down payment", repaymentTerms: "30-year fixed", closeBy: new Date(Date.now() - DAY), expiresAt: new Date(Date.now() - DAY), active: false, held: false, holdReason: "superseded", confirmedAt: at(-48), manual: false, contractByManual: false, closeByManual: false });
    await run(TEXT, 0, id);
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ holdReason: AUTO_ACCEPTED_NO_DEADLINE, headlineRate: "4.99%", apr: "5.62%", closeBy: null, expiresAt: null });
    expect(await gated(lead)).toMatchObject({ text: TEXT, headlineRate: "4.99%", apr: "5.62%" });
  });

  it("a lapsed record with no reasons returns with this read's figures too", async () => {
    const TEXT = "4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment on select homes.";
    const id = seedCommunity();
    db.seed(dealIncentives, { communityId: id, normalizedText: normalizedText(TEXT), publicText: TEXT, headlineRate: "4.5%", apr: "4.99%", active: false, held: false, holdReason: "lapsed_unconfirmed", confirmedAt: at(-500), manual: false, contractByManual: false, closeByManual: false });
    await run(TEXT, 0, id);
    expect(live()[0]).toMatchObject({ holdReason: null, headlineRate: "4.99%", apr: "5.62%" });
  });
});

describe("F3: a text never takes off an admin's date by itself", () => {
  it("R1: a new deadline-only text beside a record with an admin's date is held (replaces_manual_date)", async () => {
    const id = seedCommunity();
    await run(CLEAN, 0, id);
    await saveIncentiveForCommunity({ communityId: id, id: live()[0]!.id, publicText: CLEAN, manual: false, closeBy: "2026-12-31" });
    await run(NO_DATE_2, 1, id);
    expect(JSON.parse(heldRows()[0]!.holdReason!)).toEqual(expect.arrayContaining(["missing_closing_deadline", "replaces_manual_date"]));
    expect(incentiveRows().some((row) => row.holdReason === AUTO_ACCEPTED_NO_DEADLINE)).toBe(false);
  });

  it("R2: a returning deadline-only text beside a record with an admin's date is held and e-mailed, not published", async () => {
    const id = seedCommunity();
    await run(NO_DATE, 0, id);
    expect(live()[0]).toMatchObject({ holdReason: AUTO_ACCEPTED_NO_DEADLINE });
    await run(CLEAN, 1, id);
    await saveIncentiveForCommunity({ communityId: id, id: live()[0]!.id, publicText: CLEAN, manual: false, closeBy: "2026-12-31" });
    mocks.sendBuilderDealsEmail.mockClear();
    await run(NO_DATE, 2, id);
    expect(live().some((row) => row.publicText === NO_DATE)).toBe(false);
    expect(heldRows()).toHaveLength(1);
    expect(heldRows()[0]!.publicText).toBe(NO_DATE);
    expect(JSON.parse(heldRows()[0]!.holdReason!)).toEqual(expect.arrayContaining(["missing_closing_deadline", "replaces_manual_date"]));
    expect(holdEmails()).toHaveLength(1);
    expect(holdEmails()[0]!.content).toMatch(/Dropped manual date\(s\): close-by 2026-12-31/);
  });
});

describe("F4: wording that says what really happens", () => {
  it("R4: with a manual override live, the hold e-mail says buyers keep seeing the override", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    await saveIncentiveForCommunity({ communityId: id, publicText: MANUAL, manual: true });
    await run(A_NO_APR, 0, id);
    expect((await gated(lead))!.text).toBe(MANUAL);
    const content = holdEmails()[0]!.content;
    expect(content).toContain("Buyers keep seeing the manual override");
    expect(content).not.toContain(`Buyers see "${HELD_INCENTIVE_PUBLIC_LINE}" for this community`);
    expect(content).toContain("or the manual override, where one is live");
  });

  it("R6: an automatic record that kept one readable date does not say 'no deadline'", async () => {
    const id = seedCommunity();
    await run(ONE_DATED, 0, id);
    expect((await listCommunityDiagnostics(at(1)))[0]!.incentive).toMatchObject({ autoAccepted: true, status: AUTO_ACCEPTED_DATED_ADMIN_STATUS });
    expect(emails().some((mail) => mail.content.includes(AUTO_ACCEPTED_DATED_ADMIN_STATUS))).toBe(true);
    expect(emails().some((mail) => mail.content.includes(AUTO_ACCEPTED_ADMIN_STATUS))).toBe(false);
  });

  it("the health check counts only held offers that really show the neutral line", () => {
    const now = new Date();
    const fresh = new Date(now.getTime() - DAY);
    expect(heldIncentiveCountsAsShowingLine({ holdReason: JSON.stringify(["missing_apr"]), confirmedAt: fresh, expiresAt: null }, now, 14)).toBe(true);
    expect(heldIncentiveCountsAsShowingLine({ holdReason: JSON.stringify(["missing_apr", "differs_from_manual_override"]), confirmedAt: fresh, expiresAt: null }, now, 14)).toBe(false);
    expect(heldIncentiveCountsAsShowingLine({ holdReason: JSON.stringify(["differs_from_manual_override"]), confirmedAt: fresh, expiresAt: null }, now, 14)).toBe(false);
    expect(heldIncentiveCountsAsShowingLine({ holdReason: JSON.stringify(["missing_apr"]), confirmedAt: new Date(now.getTime() - 20 * DAY), expiresAt: null }, now, 14)).toBe(false);
    expect(heldIncentiveCountsAsShowingLine({ holdReason: JSON.stringify(["missing_apr"]), confirmedAt: fresh, expiresAt: new Date(now.getTime() - 60_000) }, now, 14)).toBe(false);
  });
});

describe("F5: the admin-side reasons are judged on the state now", () => {
  it("a deadline-only text held beside a manual override publishes by itself once the override has gone", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    await saveIncentiveForCommunity({ communityId: id, publicText: MANUAL, manual: true });
    await run(NO_DATE, 0, id);
    expect(JSON.parse(heldRows()[0]!.holdReason!)).toEqual(expect.arrayContaining(["missing_closing_deadline", "differs_from_manual_override"]));
    await run(NO_DATE, 1, id);
    expect(heldRows()).toHaveLength(1);
    // The undated override lapses.
    await revalidateDealIncentives(new Date(Date.now() + 15 * DAY));
    expect(live()).toHaveLength(0);
    await run(NO_DATE, 2, id);
    expect(heldRows()).toHaveLength(0);
    expect(live()[0]).toMatchObject({ publicText: NO_DATE, holdReason: AUTO_ACCEPTED_NO_DEADLINE });
    expect(await gated(lead)).toMatchObject({ text: NO_DATE });
  });

  it("replaces_manual_date stays while the admin's date still runs, and goes when it has passed", async () => {
    const id = seedCommunity();
    await run(CLEAN, 0, id);
    await saveIncentiveForCommunity({ communityId: id, id: live()[0]!.id, publicText: CLEAN, manual: false, closeBy: "2099-12-31" });
    await run(NO_DATE_2, 1, id);
    expect(JSON.parse(heldRows()[0]!.holdReason!)).toContain("replaces_manual_date");
    // The record with the admin's date is off now, but its date still runs: the text keeps waiting.
    await run(NO_DATE_2, 2, id);
    expect(JSON.parse(heldRows()[0]!.holdReason!)).toContain("replaces_manual_date");
    expect(live()).toHaveLength(0);
    // Once the admin's date has passed, the text is judged on its own (deadline-only) reasons and publishes.
    const dated = incentiveRows().find((row) => row.publicText === CLEAN)!;
    dated.closeBy = new Date(Date.now() - DAY); dated.expiresAt = new Date(Date.now() - DAY);
    await run(NO_DATE_2, 3, id);
    expect(heldRows()).toHaveLength(0);
    expect(live()[0]).toMatchObject({ publicText: NO_DATE_2, holdReason: AUTO_ACCEPTED_NO_DEADLINE });
  });
});

describe("Reg Z on the buyer strip: a builder rate is printed with its APR", () => {
  it("the featured strip prints the APR beside the builder rate", async () => {
    const id = seedCommunity();
    db.seed(dealHomes, { communityId: id, sourceKey: "home-a", sourceUrl: `${COMMUNITY_URL}/a`, privateAddress: "1 Fixture Patch", kind: "quick_move_in", status: "available", origin: "official", price: 400_000 });
    db.seed(dealIncentives, { communityId: id, normalizedText: "live", publicText: "4.99% (5.62% APR) FHA", headlineRate: "4.99%", apr: "5.62%", loanType: "FHA", downPayment: "3.5%", confirmedAt: new Date(), active: true, held: false, manual: false });
    const { rateLine } = await import("../client/src/components/deals/FeaturedDeals");
    for (const featured of [await featuredDeals("public"), await featuredDeals({ view: "gated" })]) {
      expect(featured.bestRate?.rate).toMatchObject({ ratePercent: 4.99, aprPercent: 5.62, builderOffer: true });
      expect(rateLine(featured.bestRate!)).toBe("at 4.99% (5.62% APR) FHA, 3.5% down");
    }
  });
});

describe("Reg Z on every buyer surface: no rate without its stored APR", () => {
  const NO_APR_TEXT = "Rates as low as 4.99% on a 30-year fixed FHA loan with 3.5% down payment. Plus up to $10,000 toward closing costs on select homes.";
  it("the public, gated and team lists keep only the offer's non-rate wording, with no rate or financing-term fields", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    db.seed(dealIncentives, { communityId: id, normalizedText: "legacy", publicText: NO_APR_TEXT, headlineRate: "4.99%", loanType: "FHA", downPayment: "3.5% down payment", repaymentTerms: "30-year fixed", confirmedAt: new Date(), active: true, held: false, manual: false });
    for (const incentive of [await landing(), await gated(lead), await team(lead)]) {
      expect(incentive).toMatchObject({ headlineRate: null, followOnRate: null, apr: null, downPayment: null, repaymentTerms: null });
      expect(incentive!.text).toBe("Plus up to $10,000 toward closing costs on select homes.");
      expect(JSON.stringify(incentive)).not.toMatch(/4\.99|3\.5%|30-year/);
    }
  });

  it("an offer that is nothing but a rate without an APR shows no incentive at all; one with its APR shows in full", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    const row = db.seed(dealIncentives, { communityId: id, normalizedText: "legacy", publicText: "Rates as low as 4.99% on select homes.", headlineRate: "4.99%", confirmedAt: new Date(), active: true, held: false, manual: false });
    expect(await gated(lead)).toBeNull();
    expect(await landing()).toBeNull();
    (incentiveRows().find((candidate) => candidate.id === row) as { apr: string | null }).apr = "5.62%";
    expect(await gated(lead)).toMatchObject({ text: "Rates as low as 4.99% on select homes.", headlineRate: "4.99%", apr: "5.62%" });
  });

  it("the featured strip never uses or prints a builder rate with no APR: those homes rank and print at the market rate", async () => {
    const id = seedCommunity();
    db.seed(dealHomes, { communityId: id, sourceKey: "home-a", sourceUrl: `${COMMUNITY_URL}/a`, privateAddress: "1 Fixture Patch", kind: "quick_move_in", status: "available", origin: "official", price: 400_000 });
    const none = await featuredDeals("public");
    db.seed(dealIncentives, { communityId: id, normalizedText: "legacy", publicText: NO_APR_TEXT, headlineRate: "4.99%", loanType: "FHA", downPayment: "3.5%", confirmedAt: new Date(), active: true, held: false, manual: false });
    const featured = await featuredDeals("public");
    expect(featured).toEqual(none);
    expect(featured.bestRate).toBeNull();
    const { rateLine } = await import("../client/src/components/deals/FeaturedDeals");
    expect(rateLine(featured.lowestPayment[0]!)).toBe("at the 7.4% market rate, 5% down");
    // A deal that says it has no APR prints no figure.
    expect(rateLine({ ...featured.lowestPayment[0]!, rate: { ratePercent: 4.99, firstYearRatePercent: null, loanType: "FHA", builderOffer: true, aprPercent: null }, downPercent: 3.5 })).toBe("with the builder's financing, 3.5% down");
  });
});
