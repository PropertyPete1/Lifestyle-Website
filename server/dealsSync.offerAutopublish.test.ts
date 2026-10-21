import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealIncentives, dealLeads } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import { normalizedText } from "../shared/deals";
import type { DealAdapterResult, PrivatePlanOrHome, PromotionalRateFacts } from "./dealsAdapters";
import { AUTO_ACCEPTED_ADMIN_STATUS, AUTO_ACCEPTED_NO_DEADLINE, HELD_INCENTIVE_ADMIN_STATUS, HELD_INCENTIVE_PUBLIC_LINE, heldIncentivePublicEntry, heldIncentiveShowsLine, unreadDateIn } from "../shared/dealsHeldIncentive";

/**
 * The owner's 2026-10-21 rule for held offers: a text held only for a deadline it does not date publishes by itself
 * (undated, so the lapse rule applies), and every other held text shows only "Builder incentive available — ask us for
 * details" on the buyer pages until an Accept or a later read clears it. Adapter mocked; real sync, admin, catalogs and
 * featured ranking on the fake DB.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), loadOfficialDeals: vi.fn(), sendBuilderDealsEmail: vi.fn(), refreshCommunityGeography: vi.fn(), processDealPhoto: vi.fn(), processPendingDealPhotos: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsPhotos", () => ({ processDealPhoto: (...args: unknown[]) => mocks.processDealPhoto(...args), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));
vi.mock("./dealsAdapters", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsAdapters")>()), loadOfficialDeals: (...args: unknown[]) => mocks.loadOfficialDeals(...args) }));

import { normalizeIncentiveText, parsePromotionalRate } from "./dealsAdapters";
import { acceptedBeforeRecorded, refreshOfficialDeals, revalidateDealIncentives } from "./dealsSync";
import { acceptIncentiveHold, listCommunityDiagnostics, saveIncentiveForCommunity } from "./dealsSyncAdmin";
import { gatedDealsCatalog, publicDealsCatalog } from "./dealsService";
import { featuredDeals } from "./dealsFeatured";

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

describe("the parser's deadline-only reads used here", () => {
  it("hold for a deadline reason only", () => {
    expect(parsePromotionalRate(NO_DATE).holdReasons).toEqual(["missing_closing_deadline"]);
    expect(parsePromotionalRate(UNREAD_DATE).holdReasons).toEqual(["missing_closing_deadline"]);
    expect(parsePromotionalRate(SIGN).holdReasons).toEqual(["missing_contract_deadline"]);
    expect(parsePromotionalRate(ONE_DATED)).toMatchObject({ holdReasons: ["missing_contract_deadline"], closingDeadline: { isoDate: "2026-12-31" } });
  });
});

describe("unreadDateIn", () => {
  const unread = (text: string) => { const facts = parsePromotionalRate(text); return unreadDateIn(normalizeIncentiveText(text), [facts.contractDeadline, facts.closingDeadline]); };
  it("finds a date-like phrase the parser could not read, and ignores the deadlines it did read", () => {
    for (const text of [UNREAD_DATE, "Contracts written by 10/31 get $5,000.", "Close by end of year and save.", "Sign by Oct. 31 and close by 12/31/2026.", "Contract between Oct. 1 and Oct. 31, 2026; close within 60 days.", "Offer ends this weekend on homes that close by the builder's date.", "Homes that close by Thanksgiving.", "Contract by 2/30/26 for $5,000.", "Ends in 10 days: closing costs paid by the builder.", "Close by May 30 for $5,000."]) {
      expect(unread(text), text).not.toBeNull();
    }
    for (const text of [NO_DATE, SIGN, ONE_DATED, "4.99% (5.62% APR) 30-yr fixed FHA with 3.5% down. Up to $10,000 toward closing costs paid by seller.", "$5,000 toward closing costs paid by the builder on 4/2.5 homes with a 2/1 buydown.", "Contracts written between September 4 and September 30, 2026 receive $5,000; closing costs paid by the builder.", "Closing costs paid by the builder; you may sign at the model."]) {
      expect(unread(text), text).toBeNull();
    }
  });
});

describe("a deadline-only hold", () => {
  it("publishes by itself, undated, marked as automatic; re-reads keep it; the lapse rule takes it off; a read brings it back", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    await run(NO_DATE, 0, id);
    expect(heldRows()).toHaveLength(0);
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ holdReason: AUTO_ACCEPTED_NO_DEADLINE, acceptedAt: null, contractBy: null, closeBy: null, expiresAt: null, manual: false });
    expect((db.rows(dealCommunities)[0] as typeof dealCommunities.$inferSelect).incentiveHoldReason).toBeNull();
    // No hold e-mail: nothing to do. The change summary says what happened.
    expect(holdEmails()).toHaveLength(0);
    expect(emails().some((mail) => mail.content.includes(AUTO_ACCEPTED_ADMIN_STATUS))).toBe(true);
    // The full offer shows like any undated offer.
    expect(await gated(lead)).toMatchObject({ text: NO_DATE, contractBy: null, closeBy: null });
    expect((await gated(lead))!.pending).toBeUndefined();
    expect((await landing())!.text).toContain("$10,000");
    const diagnostics = (await listCommunityDiagnostics(at(1)))[0]!;
    expect(diagnostics.incentive).toMatchObject({ autoAccepted: true, status: AUTO_ACCEPTED_ADMIN_STATUS });
    expect(diagnostics.heldIncentives).toEqual([]);
    // Never taken for a legacy admin Accept, whatever the evidence test says.
    expect(acceptedBeforeRecorded(live()[0]!, ["missing_closing_deadline"])).toBe(false);

    // Re-read: same record, still marked, confirmation moves (so the lapse window counts from the latest read).
    const first = live()[0]!;
    await run(NO_DATE, 2, id);
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ id: first.id, holdReason: AUTO_ACCEPTED_NO_DEADLINE, acceptedAt: null });
    expect(live()[0]!.confirmedAt.getTime()).toBe(at(2).getTime());

    // Not re-confirmed for longer than the lapse days: it comes off like any undated offer, and no neutral line replaces it.
    const result = await revalidateDealIncentives(new Date(Date.now() + 15 * DAY));
    expect(result).toMatchObject({ lapsed: 1, expired: 0 });
    expect(live()).toHaveLength(0);
    expect(incentiveRows()[0]).toMatchObject({ active: false, held: false, holdReason: "lapsed_unconfirmed" });
    expect(await gated(lead)).toBeNull();
    expect(await landing()).toBeNull();

    // The builder still shows it: it returns, marked again.
    await run(NO_DATE, 3, id);
    expect(live()[0]).toMatchObject({ id: first.id, holdReason: AUTO_ACCEPTED_NO_DEADLINE, acceptedAt: null });
    expect(holdEmails()).toHaveLength(0);
  });

  it("with one deadline dated publishes and expires by that date", async () => {
    const id = seedCommunity();
    await run(ONE_DATED, 0, id);
    expect(live()[0]).toMatchObject({ holdReason: AUTO_ACCEPTED_NO_DEADLINE, contractBy: null });
    expect(live()[0]!.expiresAt?.toISOString()).toBe(live()[0]!.closeBy?.toISOString());
    expect(live()[0]!.closeBy).not.toBeNull();
  });

  it("held before this rule (today's holds) is published on its next read", async () => {
    const id = seedCommunity();
    const heldId = db.seed(dealIncentives, { communityId: id, normalizedText: normalizedText(SIGN), publicText: SIGN, active: false, held: true, holdReason: JSON.stringify(["missing_contract_deadline"]), confirmedAt: at(-1), manual: false, contractByManual: false, closeByManual: false });
    db.rows(dealCommunities)[0]!.incentiveHoldReason = "missing_contract_deadline (text 00000000)";
    await run(SIGN, 1, id);
    expect(heldRows()).toHaveLength(0);
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ id: heldId, holdReason: AUTO_ACCEPTED_NO_DEADLINE, acceptedAt: null, contractBy: null, expiresAt: null });
    expect((db.rows(dealCommunities)[0] as typeof dealCommunities.$inferSelect).incentiveHoldReason).toBeNull();
    expect(holdEmails()).toHaveLength(0);
    expect(emails().some((mail) => mail.content.includes(AUTO_ACCEPTED_ADMIN_STATUS))).toBe(true);
  });

  it("with a date the parser could not read stays held, shows the neutral line, and the e-mail asks nothing", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    await run(UNREAD_DATE, 0, id);
    expect(live()).toHaveLength(0);
    expect(heldRows()[0]).toMatchObject({ holdReason: JSON.stringify(["missing_closing_deadline"]) });
    expect(await gated(lead)).toEqual(heldIncentivePublicEntry());
    expect(await landing()).toEqual(heldIncentivePublicEntry());
    expect(holdEmails()).toHaveLength(1);
    const content = holdEmails()[0]!.content;
    expect(content).toContain("a date the reader could not read");
    expect(content).toContain(HELD_INCENTIVE_PUBLIC_LINE);
    expect(content).toMatch(/needs nothing from you/);
    expect(content).toMatch(/Accept this update \(optional\)/);
    expect((await listCommunityDiagnostics(at(1)))[0]!.heldIncentives[0]).toMatchObject({ status: HELD_INCENTIVE_ADMIN_STATUS });
    // The admin can still Accept it with the date.
    await acceptIncentiveHold({ id: heldRows()[0]!.id, closeBy: "2026-12-15" });
    expect(live()[0]).toMatchObject({ holdReason: null, closeByManual: true });
    expect(live()[0]!.acceptedAt).not.toBeNull();
    expect(await gated(lead)).toMatchObject({ text: UNREAD_DATE });
  });

  it("is never published by itself while a manual override is live", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    await saveIncentiveForCommunity({ communityId: id, publicText: MANUAL, manual: true });
    await run(NO_DATE, 0, id);
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ manual: true, publicText: MANUAL });
    expect(heldRows()).toHaveLength(1);
    expect(JSON.parse(heldRows()[0]!.holdReason!)).toEqual(expect.arrayContaining(["missing_closing_deadline", "differs_from_manual_override"]));
    expect((await gated(lead))!.text).toBe(MANUAL);
    await run(NO_DATE, 1, id);
    expect(live()[0]).toMatchObject({ manual: true });
    expect(incentiveRows().some((row) => row.holdReason === AUTO_ACCEPTED_NO_DEADLINE)).toBe(false);

    // A text published by itself that a manual override then replaced is not published again while the override is live.
    db = new FakeDealsDb(); mocks.getDb.mockResolvedValue(db);
    const other = seedCommunity();
    await run(NO_DATE, 0, other);
    expect(live()[0]).toMatchObject({ holdReason: AUTO_ACCEPTED_NO_DEADLINE });
    await saveIncentiveForCommunity({ communityId: other, publicText: MANUAL, manual: true });
    await run(NO_DATE, 1, other);
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ manual: true });
    expect(JSON.parse(heldRows()[0]!.holdReason!)).toContain("differs_from_manual_override");
  });
});

describe("a held offer for any other reason", () => {
  const REG_Z_REASONS = ["ambiguous_rate", "apr_check", "adjustable_rate", "missing_apr", "missing_repayment_term", "missing_down_payment", "missing_follow_on_rate", "missing_follow_on_period", "private_text_remaining"] as const;
  const NAMES = ["Fixture Gardens", "Fixture Patch", "M/I", "Financial", "mihomes"];

  for (const reason of REG_Z_REASONS) {
    it(`${reason}: the public, gated and team lists show only the neutral line, with no figure or name`, async () => {
      const id = seedCommunity();
      const lead = seedLead();
      const facts: PromotionalRateFacts = { ...parsePromotionalRate(FIGURES), holdReasons: reason === "private_text_remaining" ? [] : [reason], publishable: false };
      await run({ text: FIGURES, facts, ...(reason === "private_text_remaining" ? { holds: ["private_text_remaining"] } : {}) }, 0, id);
      expect(live()).toHaveLength(0);
      expect(heldRows()).toHaveLength(1);
      expect(JSON.parse(heldRows()[0]!.holdReason!)).toContain(reason);
      for (const incentive of [await landing(), await gated(lead), await team(lead)]) {
        expect(incentive).toEqual(heldIncentivePublicEntry());
        expect(incentive!.text).toBe("Builder incentive available — ask us for details");
        const json = JSON.stringify(incentive);
        expect(json).not.toMatch(/\d/);
        expect(json).not.toMatch(/[%$]/);
        for (const name of NAMES) expect(json).not.toContain(name);
      }
      // Not one figure of the held text reaches any buyer field of the community entry.
      expect(JSON.stringify((await publicDealsCatalog())[0])).not.toMatch(/4\.99|5\.62|3\.5%|10,000/);
      expect(JSON.stringify(await gatedDealsCatalog(lead))).not.toMatch(/4\.99|5\.62|3\.5%|10,000/);
      expect((await listCommunityDiagnostics(at(1)))[0]!.heldIncentives[0]).toMatchObject({ status: HELD_INCENTIVE_ADMIN_STATUS });
      expect(holdEmails()[0]!.content).toContain(HELD_INCENTIVE_PUBLIC_LINE);
    });
  }

  it("a real parser hold (missing APR) shows the line; an Admin Accept with the APR replaces it with the full offer", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    await run(A_NO_APR, 0, id);
    expect(JSON.parse(heldRows()[0]!.holdReason!)).toEqual(["missing_apr"]);
    expect(await gated(lead)).toEqual(heldIncentivePublicEntry());
    // Accept is refused without the field the reason needs: the line stays.
    await expect(acceptIncentiveHold({ id: heldRows()[0]!.id })).rejects.toThrow(/apr/);
    expect(await landing()).toEqual(heldIncentivePublicEntry());
    await acceptIncentiveHold({ id: heldRows()[0]!.id, apr: "6.62%" });
    const shown = await gated(lead);
    expect(shown).toMatchObject({ text: A_NO_APR, headlineRate: "4.99%", apr: "6.62%" });
    expect(shown!.pending).toBeUndefined();
    expect((await landing())!.apr).toBe("6.62%");
    expect((await listCommunityDiagnostics(at(1)))[0]!.heldIncentives).toEqual([]);
  });

  it("a later read that resolves the hold publishes the full offer", async () => {
    const TEXT = "4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment on select homes.";
    const misread: PromotionalRateFacts = { ...parsePromotionalRate(TEXT), aprPercent: 4.99, holdReasons: ["apr_check"], publishable: false };
    const id = seedCommunity();
    const lead = seedLead();
    await run({ text: TEXT, facts: misread }, 0, id);
    expect(await gated(lead)).toEqual(heldIncentivePublicEntry());
    await run(TEXT, 1, id);
    expect(heldRows()).toHaveLength(0);
    expect(live()[0]).toMatchObject({ apr: "5.62%", holdReason: null });
    expect(await gated(lead)).toMatchObject({ text: TEXT, headlineRate: "4.99%", apr: "5.62%" });
  });

  it("a held text nobody has re-read within the lapse window, or past a date it carries, no longer shows the line", () => {
    const now = new Date();
    const base = { held: true, holdReason: JSON.stringify(["missing_apr"]), expiresAt: null, confirmedAt: new Date(now.getTime() - DAY) };
    expect(heldIncentiveShowsLine(base, now, 14)).toBe(true);
    expect(heldIncentiveShowsLine({ ...base, confirmedAt: new Date(now.getTime() - 15 * DAY) }, now, 14)).toBe(false);
    expect(heldIncentiveShowsLine({ ...base, expiresAt: new Date(now.getTime() - 60_000) }, now, 14)).toBe(false);
    expect(heldIncentiveShowsLine({ ...base, holdReason: JSON.stringify(["differs_from_manual_override"]) }, now, 14)).toBe(false);
    expect(heldIncentiveShowsLine({ ...base, held: false }, now, 14)).toBe(false);
  });

  it("the featured ranking ignores a held offer's rate: those homes rank exactly as homes with no offer", async () => {
    const id = seedCommunity();
    db.seed(dealHomes, { communityId: id, sourceKey: "home-a", sourceUrl: `${COMMUNITY_URL}/a`, privateAddress: "1 Fixture Patch", kind: "quick_move_in", status: "available", origin: "official", price: 400_000 });
    db.seed(dealHomes, { communityId: id, sourceKey: "home-b", sourceUrl: `${COMMUNITY_URL}/b`, privateAddress: "2 Fixture Patch", kind: "quick_move_in", status: "available", origin: "official", price: 350_000 });
    const none = { public: await featuredDeals("public"), gated: await featuredDeals({ view: "gated" }), full: await featuredDeals({ view: "full", builderPages: true }) };
    expect(none.public.bestRate).toBeNull();
    db.seed(dealIncentives, { communityId: id, normalizedText: "held", publicText: FIGURES, headlineRate: "2.99%", followOnRate: "3.99%", apr: "4.1%", loanType: "FHA", downPayment: "3.5% down payment", repaymentTerms: "30-year fixed", confirmedAt: new Date(), active: false, held: true, holdReason: JSON.stringify(["ambiguous_rate"]), manual: false });
    expect(await featuredDeals("public")).toEqual(none.public);
    expect(await featuredDeals({ view: "gated" })).toEqual(none.gated);
    expect(await featuredDeals({ view: "full", builderPages: true })).toEqual(none.full);
    // A published offer's rate does count (the comparison is not vacuous).
    db.seed(dealIncentives, { communityId: id, normalizedText: "live", publicText: "x", headlineRate: "2.99%", loanType: "FHA", downPayment: "3.5%", confirmedAt: new Date(), active: true, held: false, manual: false });
    expect((await featuredDeals("public")).bestRate).not.toBeNull();
  });
});
