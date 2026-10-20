import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealIncentives, dealLeads } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import type { DealAdapterResult, PrivatePlanOrHome, PromotionalRateFacts } from "./dealsAdapters";

/**
 * The incentive state machine with offerRead and the adoption of rows accepted before acceptance was recorded,
 * plus the buydown and rate-wording reads that feed it. Adapter mocked; real sync, admin and catalog on the fake DB.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), loadOfficialDeals: vi.fn(), sendBuilderDealsEmail: vi.fn(), refreshCommunityGeography: vi.fn(), processDealPhoto: vi.fn(), processPendingDealPhotos: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsPhotos", () => ({ processDealPhoto: (...args: unknown[]) => mocks.processDealPhoto(...args), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));
vi.mock("./dealsAdapters", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsAdapters")>()), loadOfficialDeals: (...args: unknown[]) => mocks.loadOfficialDeals(...args) }));

import { parsePromotionalRate, publicTextResidue } from "./dealsAdapters";
import { refreshOfficialDeals, revalidateDealIncentives } from "./dealsSync";
import { acceptIncentiveHold, dismissIncentiveHold, listCommunityDiagnostics, saveIncentiveForCommunity } from "./dealsSyncAdmin";
import { gatedDealsCatalog, publicDealsCatalog } from "./dealsService";

const COMMUNITY_URL = "https://www.mihomes.com/new-homes/texas/greater-san-antonio/southeast-san-antonio/fixture-gardens";
const home = (slug: string) => `${COMMUNITY_URL}/fixture-a-plan/${slug}`;
const T0 = new Date(Date.now() - 12 * 3_600_000);
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);

function item(sourceUrl: string, overrides: Partial<PrivatePlanOrHome> = {}): PrivatePlanOrHome {
  return { sourceUrl, privateName: overrides.privateName ?? sourceUrl.split("/").pop()!, status: "Quick Move-In", price: 400_000, bedrooms: 4, bathrooms: 3, squareFeet: 2_300, gallery: [], ...overrides };
}
type Read = { text: string | null; holds?: string[]; offerRead?: boolean; facts?: PromotionalRateFacts };
function snapshot(read: Read): DealAdapterResult {
  const incentive = read.text ? { sourceUrl: `${COMMUNITY_URL}/incentives/current`, text: read.text, facts: read.facts ?? parsePromotionalRate(read.text) } : null;
  return {
    ok: true, catalogOk: true,
    incentiveHoldReasons: read.holds ?? (incentive && !incentive.facts.publishable ? incentive.facts.holdReasons : []),
    fetchedAt: T0.toISOString(),
    private: { builder: "M/I Homes", sourceUrl: COMMUNITY_URL, privateCommunityName: "Fixture Gardens", pages: [], plans: [], homes: [item(home("h1"))], incentive, offerRead: read.offerRead ?? Boolean(incentive), communityFacts: undefined, discoveredScrubConfig: undefined },
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
  return db.seed(dealCommunities, { builder: "M/I Homes", privateName: "Fixture Gardens", sourceUrl: COMMUNITY_URL, privateAddress: "8106 Fixture Patch, San Antonio, TX 78263", publicLabel: "Southeast San Antonio | New Phase", areaLabel: "Southeast San Antonio", reelCode: "vg1", scrubList: JSON.stringify({ community: ["Fixture Gardens"], street: ["Fixture Patch"] }), active: true, paused: false, manualMode: false, zipCentroidLat: "29.3", zipCentroidLng: "-98.4" });
}
function seedLead() {
  return db.seed(dealLeads, { phoneE164: "+12105550123", sourceCode: "vg1", consentText: "c", consentAt: T0, consentIp: "203.0.113.9", deviceHash: "d".repeat(64), status: "verified", expiresAt: new Date(Date.now() + 86_400_000), flags: "[]" });
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
const community = () => db.rows(dealCommunities)[0] as typeof dealCommunities.$inferSelect;
const live = () => incentiveRows().filter((row) => row.active && !row.held);
const heldRows = () => incentiveRows().filter((row) => row.held);
type Gated = Array<{ incentive: { text: string; headlineRate: string | null; followOnRate: string | null; apr: string | null } | null }>;

const A_NO_APR = "4.99% interest rate on a 30-year fixed FHA loan with 3.5% down payment on select homes.";
const PHONE_OFFER = "4.99% (6.62% APR) 30-year fixed FHA financing with 3.5% down payment on select homes. Questions? Call (210) 555-0142.";
const CLEAN_EDIT = "4.99% (6.62% APR) 30-year fixed FHA financing with 3.5% down payment on select homes.";
const B_CLEAN = "5.49% (6.80% APR) 30-year fixed FHA financing with 3.5% down payment on select homes. Contracts must be signed by 12/31/2026.";
const C_CLEAN = "5.25% (6.40% APR) 30-year fixed FHA financing with 3.5% down payment on select quick move-in homes.";
const MANUAL = "Ask about our fall savings event on select quick move-in homes.";

const BUYDOWN = "3.99% first-year rate, 4.99% for years 2-30 (5.40% APR) on a 30-year fixed FHA loan with 3.5% down payment.";

describe("buydowns written figure first", () => {
  it("read the first-year figure before its label, never an APR as a rate", () => {
    const cases: Array<[string, number, number, number]> = [
      [BUYDOWN, 3.99, 4.99, 5.4],
      ["Year-end savings: 3.99% first-year rate, 4.99% years 2-30 (5.40% APR).", 3.99, 4.99, 5.4],
      ["Get a 3.99% first-year rate (5.62% APR); 4.99% for years 2-30.", 3.99, 4.99, 5.62],
      ["3.75% Year 1 rate / 4.75% Years 2-30, 5.31% APR, 30-year fixed conventional loan with 5% down payment.", 3.75, 4.75, 5.31],
      ["First-year rate of 3.99%, 4.99% for years 2-30 (5.40% APR).", 3.99, 4.99, 5.4],
    ];
    for (const [text, headline, followOn, apr] of cases) expect(parsePromotionalRate(text), text).toMatchObject({ rateKind: "promotional", promotionalRatePercent: headline, followOnRatePercent: followOn, aprPercent: apr, holdReasons: [] });
  });

  it("hold ambiguous_rate when the first-year figure is not the first rate the text states", () => {
    const facts = parsePromotionalRate("Special financing: 4.99% for years 2-30 and a first-year rate of 3.99% (5.40% APR).");
    expect(facts.holdReasons).toContain("ambiguous_rate");
  });

  it("publish with the right rate fields end to end", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    await run(BUYDOWN, 0, id);
    expect(live()[0]).toMatchObject({ headlineRate: "3.99%", followOnRate: "4.99%", apr: "5.4%" });
    expect(((await gatedDealsCatalog(lead)) as Gated)[0]!.incentive).toMatchObject({ headlineRate: "3.99%", followOnRate: "4.99%", apr: "5.4%" });
  });
});

describe("rate wording", () => {
  it("an amount word before a figure does not hide loan wording after it", () => {
    for (const text of ["Receive 4.99% financing on select quick move-in homes.", "Receive 3.99% fixed for 30 years on select homes.", "Earn a 4.99% FHA rate on select homes.", "Receive a 4.99% 30-year fixed FHA loan on select homes.", "Receive 2.99% financing through our preferred lender.", "Up to 4.99% fixed on select homes.", "Earn 3.99% interest on select quick move-in homes."]) {
      // A rate, so never published without its APR.
      expect(parsePromotionalRate(text).holdReasons, text).toContain("missing_apr");
    }
    for (const text of ["Receive 2% when you use our preferred lender.", "Save up to 3% on closing costs.", "Starting at 3% down on select homes.", "2% builder contribution with a 10-year structural warranty.", "Builder pays 2% for your 2-year HOA dues."]) {
      expect(parsePromotionalRate(text), text).toMatchObject({ rateKind: "none", holdReasons: [] });
    }
  });

  it("a stated starting rate is the headline whatever follows it", () => {
    for (const [text, rate] of [["Rates starting at 4.99% in select communities (5.62% APR).", 4.99], ["Starting at 4.99% in our Fall Event! 5.62% APR on a 30-year fixed conventional loan with 5% down payment.", 4.99], ["Rates from 3.99% off the builder's preferred lender list; 5.10% APR.", 3.99], ["Rates starting at 4.75% credit-qualified buyers, 5.9% APR.", 4.75], ["Rates starting at 4.99% in Austin and 5.25% in San Antonio, 5.62% APR.", 4.99]] as const) {
      expect(parsePromotionalRate(text).promotionalRatePercent, text).toBe(rate);
    }
  });

  it("a web address with an upper-case or title-case top-level domain is residue; a road or state abbreviation is not", () => {
    for (const text of ["Visit DRHorton.COM for details.", "See MiHomes.US for complete terms.", "Learn more at PulteMortgage.CO today.", "Details at LennarMortgage.NET.", "Terms at DavidWeekleyHomes.Us.", "Visit Taylor-Morrison.COM for offer details.", "MIHOMES.COM", "mihomes.Com"]) expect(publicTextResidue(text), text).toBe("web address");
    for (const text of ["Off Hwy.US 281 north.", "Fort Sam Houston, TX.Us Army families welcome.", "Near I-35.Co-located amenities.", "on select homes.Homes must close by 12/31/2026."]) expect(publicTextResidue(text), text).toBeNull();
  });
});

describe("rows accepted before acceptance was recorded", () => {
  it("a row an older parser published with a guess the text states is judged again, not adopted", async () => {
    const TEXT = "Homes starting at 3% down. 30-year fixed FHA loan, 6.1% APR.";
    const older: PromotionalRateFacts = { ...parsePromotionalRate(TEXT), rateKind: "fixed", promotionalRatePercent: 3, holdReasons: [], publishable: true };
    const id = seedCommunity();
    await run({ text: TEXT, facts: older }, 0, id);
    expect(live()[0]).toMatchObject({ headlineRate: "3%", acceptedAt: null });
    await run(TEXT, 1, id);
    expect(live()).toHaveLength(0);
    expect(heldRows()[0]).toMatchObject({ holdReason: JSON.stringify(["missing_promotional_rate"]), acceptedAt: null });
    expect(holdEmails()).toHaveLength(1);
  });

  it("a figure a later parser declines to guess is not adopted either", async () => {
    const id = seedCommunity();
    const older: PromotionalRateFacts = { ...parsePromotionalRate(BUYDOWN), promotionalRatePercent: 4.99, holdReasons: [], publishable: true };
    await run({ text: BUYDOWN, facts: older }, 0, id);
    const declined: PromotionalRateFacts = { ...parsePromotionalRate(BUYDOWN), promotionalRatePercent: null, holdReasons: ["missing_promotional_rate"], publishable: false };
    await run({ text: BUYDOWN, facts: declined }, 1, id);
    expect(live()).toHaveLength(0);
    expect(heldRows()).toHaveLength(1);
  });

  it("an APR the admin typed (one the text never states) is adopted, live or returning", async () => {
    const id = seedCommunity();
    await run(A_NO_APR, 0, id);
    await acceptIncentiveHold({ id: heldRows()[0]!.id, apr: "6.62%" });
    const a = live()[0]!;
    (a as { acceptedAt: Date | null }).acceptedAt = null;
    await run(A_NO_APR, 1, id);
    expect(live()[0]).toMatchObject({ id: a.id, apr: "6.62%" });
    expect(live()[0]!.acceptedAt).not.toBeNull();
    expect(holdEmails()).toHaveLength(1);
    // Replaced before deploy, back after it.
    (incentiveRows().find((row) => row.id === a.id) as { acceptedAt: Date | null }).acceptedAt = null;
    await run(B_CLEAN, 2, id);
    await run(A_NO_APR, 3, id);
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ id: a.id, apr: "6.62%" });
    expect(live()[0]!.acceptedAt).not.toBeNull();
    expect(heldRows()).toHaveLength(0);
    expect(holdEmails()).toHaveLength(1);
  });

  it("an admin's clean edit of a phone hold stays live with no second e-mail", async () => {
    const id = seedCommunity();
    const lead = seedLead();
    await run(PHONE_OFFER, 0, id);
    await acceptIncentiveHold({ id: heldRows()[0]!.id, publicText: CLEAN_EDIT });
    const accepted = live()[0]!;
    (accepted as { acceptedAt: Date | null }).acceptedAt = null;
    await run(PHONE_OFFER, 1, id);
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ id: accepted.id, publicText: CLEAN_EDIT });
    expect(live()[0]!.acceptedAt).not.toBeNull();
    expect(heldRows()).toHaveLength(0);
    expect(holdEmails()).toHaveLength(1);
    expect(((await gatedDealsCatalog(lead)) as Gated)[0]!.incentive).toMatchObject({ text: expect.not.stringMatching(/555/) });
  });
});

describe("round 24: savings amounts, amount words, residue and labelled legacy figures", () => {
  it("a first-year savings amount is never the first-year rate", () => {
    for (const text of ["1% first-year savings with a 1-0 buydown: 5.99% for years 2-30 (6.10% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "Enjoy 1% first year rate savings on a 1-0 buydown. 5.99% years 2-30, 6.1% APR, 30-year fixed FHA loan, 3.5% down payment."]) {
      expect(parsePromotionalRate(text), text).toMatchObject({ promotionalRatePercent: null, publishable: false });
      expect(parsePromotionalRate(text).holdReasons, text).toContain("missing_promotional_rate");
    }
    expect(parsePromotionalRate("2% year 1 / 1% year 2 rate buydown on a 6.25% (6.4% APR) 30-year fixed conventional loan with 5% down payment.").publishable).toBe(false);
  });

  it("an amount word hides a whole figure, not a rate written with decimals", () => {
    for (const text of ["Receive 4.99% on a 30-year fixed FHA loan with 3.5% down payment.", "Receive 3.99% through our preferred lender on select homes.", "Earn 3.99% when you finance with our preferred lender.", "Receive 4.99%* on select homes when you finance with our preferred lender."]) {
      expect(parsePromotionalRate(text).holdReasons, text).toEqual(expect.arrayContaining(["missing_promotional_rate", "missing_apr"]));
    }
    for (const text of ["Earn 2.5% back at closing.", "Low tax rate of 2.1% in this community.", "Agent co-op rate of 3% of base price."]) expect(parsePromotionalRate(text), text).toMatchObject({ rateKind: "none", holdReasons: [] });
  });

  it("a leading incentive, co-op, minimum down or APR does not make a correct buydown ambiguous", () => {
    for (const text of ["Get 6% builder incentive plus a 3.99% first-year rate, 4.99% years 2-30 (5.40% APR).", "The Annual Percentage Rate (APR) is 6.12% with a first-year rate of 3.99%, 4.99% for years 2-30.", "FHA 3.5% min. down. 3.99% first-year rate, 4.99% years 2-30 (5.40% APR) on a 30-year fixed FHA loan."]) {
      expect(parsePromotionalRate(text), text).toMatchObject({ promotionalRatePercent: 3.99, followOnRatePercent: 4.99, holdReasons: [] });
    }
    expect(parsePromotionalRate("Rates starting at 4.99% in Austin and 5.25% in San Antonio, 5.62% APR.").holdReasons).toContain("ambiguous_rate");
  });

  it("reads 'APR of N%' and 'a down payment of N%'", () => {
    expect(parsePromotionalRate("4.99% fixed rate, APR of 5.62%, 30-year FHA loan with 3.5% down payment on select homes.")).toMatchObject({ aprPercent: 5.62, holdReasons: [] });
    expect(parsePromotionalRate("4.99% (5.62% APR) 30-year fixed FHA loan with a down payment of 3.5% on select homes.")).toMatchObject({ downPaymentPercent: 3.5, holdReasons: [] });
  });

  it("short names before .COM are addresses; glued sentences are not", () => {
    for (const text of ["Apply with UWM.COM today.", "Visit PNC.COM for details.", "Visit DRB.COM for details."]) expect(publicTextResidue(text), text).toBe("web address");
    for (const text of ["Offer valid on select homes.HOMES MUST CLOSE BY 12/31/2026.", "Ask about financing in San Antonio.US Bank is our preferred lender.", "Proud to serve Fort Sam Houston.US Army families save more.", "Realtors welcome.Co-op paid at closing.", "10/31.US 281"]) expect(publicTextResidue(text), text).toBeNull();
  });

  it("a legacy Accept of a figure the text states is held once more, never kept on a stored value alone", async () => {
    const LABELLED = "4.99% fixed rate; APR: 5.62% on a 30-year fixed FHA loan with 3.5% down payment on select homes.";
    const blind: PromotionalRateFacts = { ...parsePromotionalRate(LABELLED), aprPercent: null, holdReasons: ["missing_apr"], publishable: false };
    const id = seedCommunity();
    await run({ text: LABELLED, facts: blind }, 0, id);
    await acceptIncentiveHold({ id: heldRows()[0]!.id, apr: "5.62%" });
    (live()[0] as { acceptedAt: Date | null }).acceptedAt = null;
    await run({ text: LABELLED, facts: blind }, 1, id);
    expect(live()).toHaveLength(0);
    expect(heldRows()).toHaveLength(1);
    // An older parser's guess beside the word "rate" is not kept either.
    db = new FakeDealsDb(); mocks.getDb.mockResolvedValue(db); mocks.sendBuilderDealsEmail.mockClear();
    const TAX = "Low tax rate of 2.1%. 5.62% APR on a 30-year fixed FHA loan with 3.5% down payment.";
    const older: PromotionalRateFacts = { ...parsePromotionalRate(TAX), rateKind: "fixed", promotionalRatePercent: 2.1, holdReasons: [], publishable: true };
    const other = seedCommunity();
    await run({ text: TAX, facts: older }, 0, other);
    await run(TAX, 1, other);
    expect(live()).toHaveLength(0);
    expect(heldRows()[0]!.acceptedAt).toBeNull();
  });
});

describe("round 25: relative rates, down payments beside an APR, amounts, regional rates, residue", () => {
  it("a first-year discount or buydown never publishes the follow-on as the first-year rate", () => {
    for (const text of ["1% first year discount: 5.99% for years 2-30 (6.10% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "Enjoy a 1% first year buydown. 5.99% for years 2-30 (6.10% APR), 30-year fixed FHA loan, 3.5% down payment.", "Get 1% off your first-year rate: 5.99% for years 2-30 (6.10% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "A 1% lower rate the first year! 5.99% for years 2-30 (6.10% APR) on a 30-year fixed FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text).publishable, text).toBe(false);
    }
  });

  it("a down payment disclosed beside the APR is not the rate", () => {
    for (const text of ["4.99% fixed rate with a down payment of 3.5% (5.62% APR) on a 30-year FHA loan.", "4.99% fixed rate on a 30-year conventional loan with a down payment of 5% (5.62% APR).", "Get a 4.99% 30-year fixed conventional rate with a down payment of 10% (5.21% APR)."]) {
      const facts = parsePromotionalRate(text);
      expect(facts.promotionalRatePercent === facts.downPaymentPercent && facts.publishable, text).toBe(false);
      expect(facts.promotionalRatePercent, text).not.toBe(facts.downPaymentPercent);
    }
  });

  it("a rate reduction is never the rate", () => {
    for (const text of ["Get a 1% interest rate reduction when you finance with our preferred lender. 5.99% 30-year fixed FHA (6.1% APR) with 3.5% down payment.", "Receive a 0.5% rate discount with our preferred lender. 5.99% 30-year fixed FHA, 6.1% APR, 3.5% down payment."]) {
      const facts = parsePromotionalRate(text);
      expect(facts.promotionalRatePercent === null || facts.promotionalRatePercent >= 5 || !facts.publishable, text).toBe(true);
    }
  });

  it("small amounts after an amount word, and shares, are not rates", () => {
    for (const text of ["Receive 1.5% from the builder when you finance with our preferred lender.", "Up to 1.5% buyer incentive with our preferred lender.", "Up to 1.5% builder contribution when you finance with our preferred lender.", "Use our preferred lender and save 0.25% on your rate.", "Save 1.25% with our preferred lender on select homes.", "Receive up to 1.5% when you finance with our preferred lender.", "Commission rate of 3% to cooperating brokers.", "Co-op rate of 3% to Realtors on all quick move-in homes.", "Low MUD rate of 0.9% and PID rate of 0.2%."]) {
      expect(parsePromotionalRate(text), text).toMatchObject({ rateKind: "none", holdReasons: [] });
    }
    expect(parsePromotionalRate("A 3.99% bonus rate for VA buyers this month.").holdReasons).toContain("missing_apr");
  });

  it("a second starting figure is a rate only when it is one", () => {
    for (const text of ["Rates starting at 4.99% and 2% toward closing costs with our preferred lender; 5.62% APR on a 30-year fixed FHA loan with 3.5% down payment.", "Rates from 4.99% and 1% lender credit, 5.62% APR on a 30-year fixed FHA loan with 3.5% down payment.", "Rates starting at 4.99% and 6% builder incentive, 5.62% APR on a 30-year fixed FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text).holdReasons, text).not.toContain("ambiguous_rate");
    }
    for (const text of ["Rates as low as 4.99% in Austin and 5.25% in San Antonio, 5.62% APR.", "Rates starting at 4.99% in Austin, 5.25% in San Antonio, 5.62% APR.", "Rates starting at 4.99% in Austin & 5.25% in San Antonio, 5.62% APR."]) {
      expect(parsePromotionalRate(text).holdReasons, text).toContain("ambiguous_rate");
    }
  });

  it("a name before .COM/.NET/.ORG is always an address", () => {
    for (const text of ["Apply at Guild.COM Today.", "Visit Chase.COM Today for details.", "See Fairway.Com For details.", "Visit lennar.COM Today.", "See Perry.Net For terms."]) expect(publicTextResidue(text), text).toBe("web address");
    // An all-caps passage is flagged (a cheap false hold) rather than risk a missed address.
    expect(publicTextResidue("OFFER VALID ON SELECT HOMES.HOMES MUST CLOSE BY 12/31/2026.")).toBe("web address");
  });
});

describe("round 26: stepped buydowns, label-first APRs, holds and reads", () => {
  it("a 2-1 buydown never publishes its year-2 rate as the rate from year 3", () => {
    for (const text of ["2-1 buydown: 2.99% year 1, 3.99% year 2, beginning in year 3 the rate is 4.99% (5.12% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "2-1 buydown: 2.99% for year 1, 3.99% for year 2, 4.99% for years 3 through 30 (5.12% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "Get a 2-1 buydown: 4.99% year 1, 5.99% year 2 and 6.99% years 3 through 30. 6.75% APR on a 30-year fixed FHA loan with 3.5% down payment."]) {
      const facts = parsePromotionalRate(text);
      expect(facts.followOnRatePercent === 3.99 || facts.followOnRatePercent === 5.99 ? facts.publishable : false, text).toBe(false);
    }
    expect(parsePromotionalRate("1-0 buydown: 3.99% for year 1, 4.99% for years 2 and beyond (5.40% APR) on a 30-year fixed FHA loan with 3.5% down payment.")).toMatchObject({ promotionalRatePercent: 3.99, followOnRatePercent: 4.99 });
  });

  it("an APR label after the rate does not make the rate the APR", () => {
    expect(parsePromotionalRate("Rates as low as 4.99%! Interest Rate 4.99% APR 5.62% on a 30-year fixed FHA loan with 3.5% down payment.")).toMatchObject({ promotionalRatePercent: 4.99, aprPercent: 5.62 });
    expect(parsePromotionalRate("Rates as low as 4.99% APR* on select homes.").publishable).toBe(false);
  });

  it("choices, headings and marketing words beside a rate do not hold it", () => {
    for (const text of ["Seller credit of $15,000 or 4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment.", "Fall Into Savings 4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment.", "Get a 4.99% rate for lower monthly payments with our preferred lender (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "4.99% 30-Year Fixed Rate (5.737% APR) FHA with 3.5% down payment."]) {
      expect(parsePromotionalRate(text), text).toMatchObject({ promotionalRatePercent: 4.99, holdReasons: [] });
    }
  });

  it("an incentive rate is a rate; a tax rate is not the headline", () => {
    expect(parsePromotionalRate("Special 4.99% incentive rate with our preferred lender on select homes.").holdReasons).toContain("missing_apr");
    expect(parsePromotionalRate("Tax rates as low as 1.98%! Interest rate: 4.99%, APR: 5.62%, 30-year fixed FHA loan with 3.5% down payment.").promotionalRatePercent).toBe(4.99);
    expect(parsePromotionalRate("Enjoy a 1% first-year rate cut! 5.99% for years 2-30 (6.1% APR) on a 30-year fixed FHA loan with 3.5% down payment.").holdReasons.filter((reason) => reason === "ambiguous_rate")).toHaveLength(1);
    expect(publicTextResidue("Apply at GUILD.MORTGAGE Today.")).toBe("web address");
  });
});

describe("round 27: APR layouts, multi-step buydowns, guarded APR pairs", () => {
  it("a value-first APR followed by a down payment or points is the APR", () => {
    for (const [text, apr] of [["3.99% first-year rate with a 1-0 buydown, 4.99% for years 2-30, 5.81% APR* 5% down payment, 30-year fixed conventional.", 5.81], ["3.99% First-Year Rate 4.99% Years 2-30 5.62% APR 3.5% Down 30-Year Fixed FHA", 5.62], ["1-0 buydown 3.99% Year 1 Rate 4.99% Years 2-30 Rate 5.21% APR 5% Down Payment 30-year fixed conventional", 5.21], ["4.99% Rate 5.62% APR 3.5% Down 30-Year Fixed FHA", 5.62], ["4.75% fixed rate, 5.12% APR 0.5% discount points, 30-year fixed conventional loan with 5% down payment.", 5.12]] as const) {
      expect(parsePromotionalRate(text).aprPercent, text).toBe(apr);
    }
    expect(parsePromotionalRate("Interest Rate 4.875% APR 5.512% on a 30-year fixed FHA loan with 3.5% down payment.")).toMatchObject({ promotionalRatePercent: 4.875, aprPercent: 5.512 });
  });

  it("a buydown with more than one later step holds", () => {
    for (const text of ["2-1 buydown: 3.99% first year, 4.99% beginning in year 2 and 5.99% beginning in year 3 (6.1% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "3.99% for the first year, 4.99% after the first year and 5.99% after the second year (6.1% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "3.99% first year; beginning in year 2 the rate is 4.99%; beginning in year 3 the rate is 5.99% (6.1% APR) on a 30-year fixed FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text).holdReasons, text).toContain("ambiguous_rate");
    }
  });

  it("a small or whole figure after closing costs, a discount or savings is not an APR-paired rate", () => {
    for (const text of ["Closing costs up to 3% (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "Rate discount of 1% (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment.", "Savings 1% (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text).publishable, text).toBe(false);
    }
    expect(parsePromotionalRate("Seller credit of $15,000 or 4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment.")).toMatchObject({ promotionalRatePercent: 4.99, holdReasons: [] });
    expect(publicTextResidue("PRE-QUALIFY AT DHIMORTGAGE.LOANS NOW")).toBe("web address");
  });
});

describe("round 28: unlabelled stepped buydowns, step keys, rate cards, held records", () => {
  it("an unlabelled 2-1 buydown read as one step from year 2 holds", () => {
    for (const text of ["Rate buydown: 2.99% first year, 3.99% starting year 2, 4.99% from the third year on (5.12% APR), 30-year fixed FHA loan, 3.5% down payment.", "2.99% first-year rate, 3.99% after the first year, 4.99% from year 3 (5.12% APR) on a 30-year fixed FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text).publishable, text).toBe(false);
    }
  });

  it("a 1-0 buydown with a restated period, a dated contract window or a 2-1/2 bath is not a stepped buydown", () => {
    for (const text of ["3.99% first-year rate, 4.99% for years 2-30 (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment. After the first year, the interest rate increases to 4.99% for the remaining term.", "1-0 Buydown: Year 1 – 3.99% | Years 2-30 – 4.99% | 5.62% APR on a 30-year fixed FHA loan with 3.5% down payment.", "3.99% first-year rate, 4.99% for years 2-30 (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment on contracts beginning 10/1/2026.", "3.99% first-year rate, 4.99% for years 2-30 (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment. 4 bed, 2-1/2 bath."]) {
      expect(parsePromotionalRate(text), text).toMatchObject({ promotionalRatePercent: 3.99, followOnRatePercent: 4.99, holdReasons: [] });
    }
  });

  it("reads rate cards and an incentive rate with loan wording", () => {
    expect(parsePromotionalRate("Rate 4.99% APR 5.62% Down Payment 3.5% Term 30-year fixed FHA")).toMatchObject({ promotionalRatePercent: 4.99, aprPercent: 5.62, downPaymentPercent: 3.5, holdReasons: [] });
    expect(parsePromotionalRate("3.99% First-Year Rate 4.99% Years 2-30 5.62% APR 3.5% Down 30-Year Fixed FHA")).toMatchObject({ aprPercent: 5.62, downPaymentPercent: 3.5 });
    expect(parsePromotionalRate("Builder incentive: 5% fixed (5.805% APR) on a 30-year FHA loan with 3.5% down payment.")).toMatchObject({ promotionalRatePercent: 5, aprPercent: 5.805, holdReasons: [] });
    expect(parsePromotionalRate("Closing cost assistance up to 3.5% (5.62% APR) on a 30-year fixed conventional loan with 5% down payment.").promotionalRatePercent).not.toBe(3.5);
    expect(parsePromotionalRate("Rates as low as 4.99% APR on a 30-year fixed FHA loan with 3.5% down payment.").holdReasons).toContain("apr_check");
    expect(publicTextResidue("APPLY AT TEXAS.LOANS NOW")).toBe("web address");
  });

  it("a held record takes each read's figures and reasons, and is released when the rules pass it", async () => {
    const TEXT = "4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment on select homes.";
    const misread: PromotionalRateFacts = { ...parsePromotionalRate(TEXT), aprPercent: 4.99, holdReasons: ["apr_check"], publishable: false };
    const id = seedCommunity();
    await run({ text: TEXT, facts: misread }, 0, id);
    expect(heldRows()[0]).toMatchObject({ apr: "4.99%", holdReason: JSON.stringify(["apr_check"]) });
    await run(TEXT, 1, id);
    expect(heldRows()).toHaveLength(0);
    expect(live()[0]).toMatchObject({ apr: "5.62%", acceptedAt: null });
    expect(holdEmails()).toHaveLength(1);
  });
});

describe("round 29: tile down payments, manual override beside a held text, 'year one'", () => {
  it("a value-first down payment followed by another tile keeps its own figure; a label-first card reads its labels", () => {
    for (const [text, dp, apr] of [["4.99% (5.62% APR) 30-yr fixed FHA, 3.5% down payment 6% seller paid closing costs", 3.5, 5.62], ["4.99% Rate 5.62% APR 3.5% Down Payment 6% Seller Contribution 30-Year Fixed FHA", 3.5, 5.62], ["3.99% First-Year Rate 5.81% APR 10% Down Payment 3% Seller Credit 4.99% Years 2-30 30-Year Fixed Conventional", 10, 5.81], ["3.99% First-Year Rate 4.99% Years 2-30 5.81% APR 5% Down 1% Lender Credit 30-Year Fixed Conventional", 5, 5.81], ["Rate 4.99% APR 5.62% Down Payment 3.5% Term 30-year fixed FHA", 3.5, 5.62], ["Rate: 4.99% APR: 5.62% Term: 30-year fixed FHA Down payment: 3.5%", 3.5, 5.62], ["1-0 buydown 3.99% Year 1 Rate 4.99% Years 2-30 Rate 5.21% APR 5% Down Payment 30-year fixed conventional", 5, 5.21]] as const) {
      expect(parsePromotionalRate(text), text).toMatchObject({ downPaymentPercent: dp, aprPercent: apr });
    }
  });

  it("'year one' is a buydown period; an incentive or assistance figure before an APR is not a rate", () => {
    expect(parsePromotionalRate("3.99% year one, 4.99% thereafter (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment.")).toMatchObject({ rateKind: "promotional", promotionalRatePercent: 3.99, followOnRatePercent: 4.99, followOnPeriod: "thereafter" });
    expect(parsePromotionalRate("Incentive: 3% (5.62% APR) FHA 30-year fixed, 3.5% down payment.").promotionalRatePercent).not.toBe(3);
    expect(parsePromotionalRate("Use your flex cash at 4.99% (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment.")).toMatchObject({ promotionalRatePercent: 4.99, holdReasons: [] });
    expect(parsePromotionalRate("Closing costs up to 3% (5.62% APR) 30-year fixed FHA loan with 3.5% down payment.").promotionalRatePercent).not.toBe(3);
  });

  it("a held text the rules now pass stays held while a manual override is live", async () => {
    const TEXT = "4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment on select homes.";
    const older: PromotionalRateFacts = { ...parsePromotionalRate(TEXT), holdReasons: ["ambiguous_rate"], publishable: false };
    const id = seedCommunity();
    const lead = seedLead();
    await run({ text: TEXT, facts: older }, 0, id);
    await saveIncentiveForCommunity({ communityId: id, publicText: MANUAL, manual: true });
    await run(TEXT, 1, id);
    expect(live()).toHaveLength(1);
    expect(live()[0]!.manual).toBe(true);
    expect(JSON.parse(heldRows()[0]!.holdReason!)).toContain("differs_from_manual_override");
    expect(((await gatedDealsCatalog(lead)) as Gated)[0]!.incentive!.text).toBe(MANUAL);
  });
});

describe("round 30: tile APRs by plausibility and position, assistance, one-year wordings", () => {
  it("a long rate label before a value-first APR does not make the next tile the APR", () => {
    for (const text of ["3.99% First Year Interest Rate 5.81% APR 10% Down Payment 3% Seller Credit 4.99% Years 2-30 30-Year Fixed Conventional", "3.99% Year 1 Rate 4.99% Years 2 - 30 Rate 5.81% APR 10% Down Payment 2% Seller Credit 30-Year Fixed Conventional", "3.99% First Year Interest Rate 5.81% APR 20% Down Payment 4.99% Years 2-30 30-Year Fixed Conventional"]) {
      const facts = parsePromotionalRate(text);
      expect(facts.aprPercent, text).toBe(5.81);
      expect([10, 20], text).toContain(facts.downPaymentPercent);
    }
    expect(parsePromotionalRate("5% Rate 5.25% APR 5% Down Payment 3% Seller Credit 30-Year Fixed Conventional").downPaymentPercent).toBe(5);
  });

  it("down payment assistance is not the down payment", () => {
    for (const text of ["Up to 5% down payment assistance available! 4.99% (5.62% APR) 30-year fixed FHA with 3.5% down payment.", "3% down payment assistance plus 4.99% (5.62% APR) on a 30-year fixed FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text).downPaymentPercent, text).toBe(3.5);
    }
  });

  it("one-year rates written '1st year', '(APR) year one', 'in year one' are buydowns with their follow-on", () => {
    for (const text of ["3.99% (5.62% APR) 1st year, 4.99% thereafter, 30-year fixed FHA loan with 3.5% down payment.", "Get 3.99% (5.62% APR) in year one and 4.99% after that on a 30-year fixed FHA loan with 3.5% down payment.", "Enjoy 3.99% (5.62% APR) for year one! 4.99% for the remaining term. 30-year fixed FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text), text).toMatchObject({ rateKind: "promotional", promotionalRatePercent: 3.99, followOnRatePercent: 4.99 });
    }
    expect(parsePromotionalRate("2.99% year one, 3.99% year two, 4.99% thereafter (5.12% APR) on a 30-year fixed FHA loan with 3.5% down payment.").holdReasons).toContain("ambiguous_rate");
  });
});

describe("round 31: composite buydown APRs, assistance wordings, unlabelled periods", () => {
  it("a buydown's composite APR below its note rate is its APR; a second APR on the page holds for a look", () => {
    expect(parsePromotionalRate("Year 1: 3.99% | Years 2-30: 4.99% | APR: 4.85% | 30-year fixed conventional | 5% down").aprPercent).toBe(4.85);
    for (const text of ["1-0 buydown: 4.99% first year, 5.99% years 2-30 (5.95% APR). Standard 30-year fixed FHA rate 5.99% (6.12% APR). 3.5% down payment.", "1-0 buydown: 4.99% (5.95% APR) first year, 5.99% (6.08% APR) years 2-30 on a 30-year fixed FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text).holdReasons, text).toContain("apr_check");
    }
  });

  it("down payment assistance in any wording is not the down payment", () => {
    for (const text of ["Up to 5% down payment and closing cost assistance! 4.99% (5.62% APR) 30-year fixed FHA with 3.5% down payment.", "Up to 5% Down Payment & Closing Cost Assistance. 4.99% (5.62% APR) 30-year fixed FHA loan, 3.5% down payment.", "5% Down-Payment Assistance + 4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment.", "5% down payment incentive plus 4.99% (5.62% APR) 30-year fixed FHA financing with 3.5% down payment."]) {
      expect(parsePromotionalRate(text).downPaymentPercent, text).toBe(3.5);
    }
    expect(parsePromotionalRate("Builder covers 5% down payment toward your home! 4.99% (5.62% APR) 30-year fixed FHA with 3.5% down payment.").downPaymentPercent).toBe(3.5);
  });

  it("a follow-on rate with an unrecognised first period holds; 1st year and year one forms read", () => {
    expect(parsePromotionalRate("3.99% (5.62% APR) for the first two years, 4.99% thereafter, 30-year fixed FHA loan with 3.5% down payment.").holdReasons).toContain("ambiguous_rate");
    for (const text of ["3.99% 1st year rate, 4.99% years 2-30 (5.62% APR), 30-year fixed FHA, 3.5% down payment.", "Year one rate of 3.99% (5.62% APR), 4.99% for years 2-30, on a 30-year fixed FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text), text).toMatchObject({ promotionalRatePercent: 3.99, followOnRatePercent: 4.99, holdReasons: [] });
    }
    expect(parsePromotionalRate("4.99% (5.62% APR) 30-year fixed FHA with 3.5% down payment. Rate locked for 60 days; 0.25% thereafter.").followOnRatePercent).toBeNull();
  });
});

describe("round 32: assistance verbs and nouns, label-first loan down payment, label-first comparison APRs", () => {
  it("assistance in any form never publishes as the loan's down payment", () => {
    for (const text of ["Get 5% down payment matched! 4.99% (5.62% APR) 30-year fixed FHA loan with a down payment of 3.5%.", "Builder covers 5% down payment toward your home! 4.99% (5.62% APR) 30-year fixed FHA loan with a down payment of 3.5%.", "Up to 5% down payment savings on select homes! 4.99% (5.62% APR) on a 30-year fixed FHA loan. Down Payment: 3.5%.", "Builder pays 5% down payment! 4.99% (5.62% APR) 30-year fixed FHA loan, down payment as low as 3.5%."]) {
      expect(parsePromotionalRate(text).downPaymentPercent, text).toBe(3.5);
    }
    for (const text of ["Up to 5% down payment savings on select homes! 4.99% (5.62% APR) 30-year fixed FHA loan.", "5% Down Payment Covered! 4.99% (5.62% APR) 30-year fixed conventional."]) {
      expect(parsePromotionalRate(text).holdReasons, text).toContain("missing_down_payment");
    }
  });

  it("a rate card keeps its label-first down payment; a comparison APR in any layout holds", () => {
    expect(parsePromotionalRate("Rate 4.99% APR 5.62% Down Payment 3.5% Term 30-year fixed FHA")).toMatchObject({ aprPercent: 5.62, downPaymentPercent: 3.5, holdReasons: [] });
    expect(parsePromotionalRate("Interest Rate 4.75% APR 5% Down Payment 10% 30-Year Fixed Conventional")).toMatchObject({ aprPercent: 5, downPaymentPercent: 10, holdReasons: [] });
    expect(parsePromotionalRate("5.62% APR 4.99% interest rate on a 30-year fixed FHA loan with 3.5% down payment.")).toMatchObject({ aprPercent: 5.62, holdReasons: [] });
    for (const text of ["Market APR: 6.71% | Our Rate: 4.99% | APR: 5.62% | 30-Year Fixed FHA | 3.5% Down", "Typical APR 6.92%. Builder APR 5.62%. Fixed rate 4.99% on a 30-year FHA loan with 3.5% down payment."]) {
      expect(parsePromotionalRate(text).holdReasons, text).toContain("apr_check");
    }
  });
});

describe("round 33: a rate card's own APR, skipped assistance tiles, the buyer's own down payment", () => {
  it("a label-first rate card keeps its own APR and down payment; any other APR on the page holds", () => {
    for (const text of ["Rate 4.99% APR 5.62% Down Payment 3.5% Term 30-Year Fixed FHA. Today's average: 6.71% APR.", "Rate 4.99% APR 5.62% Down Payment 3.5% Term 30-Year Fixed FHA. With points, 5.48% APR."]) {
      const facts = parsePromotionalRate(text);
      expect(facts, text).toMatchObject({ aprPercent: 5.62, downPaymentPercent: 3.5 });
      expect(facts.holdReasons, text).toContain("apr_check");
    }
    for (const text of ["3.99% First-Year Rate 5.81% APR 6% Max Seller Contribution 4.99% Years 2-30 30-Year Fixed Conventional 5% Down", "4.99% Rate 5.62% APR 3.5% Down Payment 6% Seller Contribution 30-Year Fixed FHA", "Interest Rate 4.75% APR 5% Down Payment 10% 30-Year Fixed Conventional"]) {
      expect(parsePromotionalRate(text).holdReasons, text).toEqual([]);
    }
    expect(parsePromotionalRate("National Average APR: 6.92% Our APR: 5.62% Our Rate: 4.99% Term: 30-Year Fixed FHA Down Payment: 3.5%").holdReasons).toContain("apr_check");
  });

  it("a skipped assistance tile's label never takes the next tile's figure; the buyer's own 'pay N% down' is a down payment", () => {
    for (const text of ["Builder Pays 5% Down Payment 3% Closing Costs 4.99% Rate 5.62% APR 30-Year Fixed FHA", "Seller Covers 3.5% Down Payment 2% Seller Credit 4.99% (5.62% APR) 30-Year Fixed FHA", "Down payment of 5% paid for you! 4.99% (5.62% APR) 30-year fixed conventional loan."]) {
      expect(parsePromotionalRate(text).downPaymentPercent, text).toBeNull();
    }
    expect(parsePromotionalRate("You pay 3.5% down on a 4.99% (5.62% APR) 30-year fixed FHA loan.").downPaymentPercent).toBe(3.5);
    expect(parsePromotionalRate("4.99% (5.62% APR) 30-year fixed FHA. You pay 3.5% down; conventional buyers 5% down.").holdReasons).toContain("ambiguous_rate");
  });
});

describe("round 34: a named payer, separated card tiles, the primary counted, tile labels after a down payment", () => {
  it("assistance paid by a named builder or program is never the loan's down payment; the buyer's own is", () => {
    for (const text of ["Pulte pays 5% down payment! 4.99% (5.62% APR) 30-year fixed conventional loan.", "Seller-paid 5% down payment! 4.99% (5.62% APR) 30-year fixed conventional loan.", "4.99% (5.62% APR) on a 30-year fixed FHA loan. Texas Homebuyer Program pays 5% down payment."]) {
      expect(parsePromotionalRate(text).downPaymentPercent, text).toBeNull();
    }
    expect(parsePromotionalRate("Pulte pays 5% down payment! 4.99% (5.62% APR) 30-year fixed conventional loan with a down payment of 3.5%.").downPaymentPercent).toBe(3.5);
    expect(parsePromotionalRate("You pay 3.5% down on a 4.99% (5.62% APR) 30-year fixed FHA loan.").downPaymentPercent).toBe(3.5);
  });

  it("a separated or reordered rate card beside a second APR holds; a comparison read first holds too", () => {
    for (const text of ["Rate 4.99% / APR 5.62% Down Payment 3.5% Term 30-Year Fixed FHA. National average 6.71% APR.", "Interest Rate 4.99% Term 30-Year Fixed APR 5.62% Down Payment 3.5% Loan Type FHA. Today's average: 6.71% APR.", "Without Buydown: APR 6.12% With Buydown: APR 5.95% 4.99% first year, 5.99% years 2-30, 30-year fixed FHA, 3.5% down payment."]) {
      expect(parsePromotionalRate(text).holdReasons, text).toContain("apr_check");
    }
  });

  it("a tile label after a down payment is not assistance", () => {
    expect(parsePromotionalRate("Rate 4.99% APR 5.62% Down Payment 3.5% Credit Score 620+ 30-Year Fixed FHA")).toMatchObject({ downPaymentPercent: 3.5, holdReasons: [] });
    expect(parsePromotionalRate("4.99% (5.62% APR) 30-year fixed. FHA Down Payment 3.5% Credit Score 580. Conventional loans 5% down.").holdReasons).toContain("ambiguous_rate");
  });
});

describe("a run that did not read the offer source", () => {
  it("leaves the community's hold line as it was", async () => {
    const id = seedCommunity();
    await run(A_NO_APR, 0, id);
    await run({ text: null, offerRead: false }, 1, id);
    expect(heldRows()).toHaveLength(1);
    expect(community().incentiveHoldReason).toMatch(/missing_apr/);
    expect((await listCommunityDiagnostics(at(2)))[0]!.incentiveHold).not.toBeNull();

    db = new FakeDealsDb(); mocks.getDb.mockResolvedValue(db); mocks.sendBuilderDealsEmail.mockClear();
    const other = seedCommunity();
    await run(C_CLEAN, 0, other);
    await run({ text: null, holds: ["incentive_fetch_failed"] }, 1, other);
    await run({ text: null, offerRead: false }, 2, other);
    await run({ text: null, holds: ["incentive_fetch_failed"] }, 3, other);
    expect(holdEmails()).toHaveLength(1);
  });
});

describe("an expired or dismissed text shown again", () => {
  it("writes a change line that reads right", async () => {
    const past = new Date(Date.now() - 2 * 86_400_000);
    const D_PAST = `5.15% (6.30% APR) 30-year fixed FHA financing with 3.5% down payment on select homes. Contracts must be signed by ${past.getUTCMonth() + 1}/${past.getUTCDate()}/${past.getUTCFullYear()}.`;
    const id = seedCommunity();
    await run(D_PAST, 0, id);
    await revalidateDealIncentives(new Date());
    await run(C_CLEAN, 1, id);
    await run(D_PAST, 2, id);
    expect(live()).toHaveLength(0);
    expect(emails().some((mail) => /The builder shows again an incentive that was expired/.test(mail.content))).toBe(true);
  });
});

describe("incentive state machine: random sequences with offerRead", () => {
  const prng = (seed: number) => () => { seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff; return seed / 0x7fffffff; };
  const past = new Date(Date.now() - 2 * 86_400_000);
  const D_PAST = `5.15% (6.30% APR) 30-year fixed FHA financing with 3.5% down payment on select homes. Contracts must be signed by ${past.getUTCMonth() + 1}/${past.getUTCDate()}/${past.getUTCFullYear()}.`;
  const TEXTS = [A_NO_APR, PHONE_OFFER, B_CLEAN, C_CLEAN, D_PAST];

  it("600 random sequences of 14 steps (5 texts, empty read with offerRead true, a not-read run with offerRead false, fetch failure, Accept, Dismiss, editor save, manual override, lapse/expiry job, a legacy reset of accepted_at): r22's invariants hold after every read; a not-read run changes no incentive row and sends no hold e-mail; an empty read leaves nothing live or held but a manual override", async () => {
    const identity = new Map<string, string>();
    for (const text of TEXTS) {
      db = new FakeDealsDb(); mocks.getDb.mockResolvedValue(db);
      const id = seedCommunity();
      await run(text, 0, id);
      identity.set(text, incentiveRows()[0]!.normalizedText);
    }
    const violations: string[] = [];
    const stats: Record<string, number> = {};
    const bump = (key: string) => { stats[key] = (stats[key] ?? 0) + 1; };
    const legacyLog: string[] = [];
    const snapshotRows = () => JSON.stringify(incentiveRows().map(({ updatedAt: _u, ...row }) => row));
    for (let sequence = 0; sequence < 600; sequence++) {
      db = new FakeDealsDb(); mocks.getDb.mockResolvedValue(db); mocks.sendBuilderDealsEmail.mockClear();
      const random = prng(sequence + 7);
      const communityId = seedCommunity();
      const log: string[] = [];
      let hours = 0;
      const accepted = new Set<string>();
      const legacy = new Set<string>();
      for (let step = 0; step < 14; step++) {
        const pick = Math.floor(random() * 14);
        const check = (label: string, ok: boolean) => { if (!ok) violations.push(`seq ${sequence} after [${log.join(" → ")}]: ${label}`); };
        if (pick <= 4) {
          const text = TEXTS[pick]!;
          log.push(`read ${pick}`); bump("read");
          await run(text, hours++, communityId);
          const want = identity.get(text)!;
          check("live non-manual row for another text", live().every((row) => row.manual || row.normalizedText === want));
          check("held row for another text", heldRows().every((row) => row.normalizedText === want));
          const own = incentiveRows().find((row) => row.normalizedText === want && !row.manual);
          if (own && accepted.has(want) && own.holdReason !== "expired" && own.holdReason !== "dismissed" && !live().some((row) => row.manual)) {
            bump("acceptChecks");
            // A legacy row (accepted before accepted_at, no admin date, so 0022 does not mark it) that comes back held is r22 #3's remainder, counted apart.
            if (legacy.has(want) && !(own.active && own.acceptedAt)) { bump(`legacy re-held (${own.holdReason})`); if (legacyLog.length < 3) legacyLog.push(log.join(" → ")); }
            else check("acceptance lost", own.active && Boolean(own.acceptedAt));
          }
        } else if (pick === 5) {
          log.push("empty read"); bump("empty read");
          await run({ text: null, offerRead: true }, hours++, communityId);
          check("live non-manual row after an empty read", live().every((row) => row.manual));
          check("held row after an empty read", heldRows().length === 0);
        } else if (pick === 6) {
          log.push("not read"); bump("not read");
          const before = snapshotRows();
          const mails = holdEmails().length;
          await run({ text: null, offerRead: false }, hours++, communityId);
          check("a not-read run changed an incentive row", snapshotRows() === before);
          check("a not-read run sent a hold e-mail", holdEmails().length === mails);
          if (heldRows().length && !community().incentiveHoldReason) bump("held row with a blank community line");
        } else if (pick === 7) {
          log.push("fetch failure"); bump("fetch failure");
          const before = snapshotRows();
          await run({ text: null, holds: ["incentive_fetch_failed"] }, hours++, communityId);
          check("a fetch failure changed an incentive row", snapshotRows() === before);
        } else if (pick === 8 && heldRows().length) {
          const row = heldRows()[0]!;
          log.push("accept"); bump("accept");
          await acceptIncentiveHold({ id: row.id, publicText: row.publicText.includes("(210)") ? CLEAN_EDIT : undefined, apr: row.apr ?? "6.62%", headlineRate: row.headlineRate ?? "4.99%", loanType: row.loanType ?? "FHA", downPayment: row.downPayment ?? "3.5% down payment", repaymentTerms: row.repaymentTerms ?? "30-year fixed" }).catch((error: Error) => { log.push(`(accept refused: ${error.message.slice(0, 40)})`); });
          const after = incentiveRows().find((candidate) => candidate.id === row.id)!;
          if (after.acceptedAt) accepted.add(after.normalizedText);
        } else if (pick === 9 && heldRows().length) {
          log.push("dismiss"); bump("dismiss");
          await dismissIncentiveHold(heldRows()[0]!.id);
        } else if (pick === 10 && live().length && !live()[0]!.manual) {
          const row = live()[0]!;
          log.push("save"); bump("save");
          await saveIncentiveForCommunity({ id: row.id, communityId, publicText: row.publicText, manual: false, contractBy: "2026-12-31", headlineRate: row.headlineRate ?? "4.99%", apr: row.apr ?? "6.62%", loanType: row.loanType ?? "FHA", downPayment: row.downPayment ?? "3.5% down payment", repaymentTerms: row.repaymentTerms ?? "30-year fixed" }).then(() => accepted.add(row.normalizedText)).catch((error: Error) => { log.push(`(save refused: ${error.message.slice(0, 40)})`); });
        } else if (pick === 11) {
          log.push("lapse job"); bump("lapse job");
          await revalidateDealIncentives(new Date(Date.now() + 15 * 86_400_000));
        } else if (pick === 12 && !live().some((row) => row.manual) && random() < 0.3) {
          log.push("manual override"); bump("manual override");
          await saveIncentiveForCommunity({ communityId, publicText: MANUAL, manual: true });
        } else if (pick === 13 && live().length && !live()[0]!.manual && live()[0]!.acceptedAt && !live()[0]!.contractByManual && !live()[0]!.closeByManual) {
          // A row as a pre-0021 Accept left it, and as 0022 leaves it (no manual flag, no admin date): accepted_at NULL.
          log.push("legacy reset"); bump("legacy reset");
          legacy.add(live()[0]!.normalizedText);
          (live()[0] as { acceptedAt: Date | null }).acceptedAt = null;
        }
        if (heldRows().length > 1) violations.push(`seq ${sequence} after [${log.join(" → ")}]: ${heldRows().length} held rows`);
        if (incentiveRows().filter((row) => row.active).length > 1) violations.push(`seq ${sequence} after [${log.join(" → ")}]: two live rows`);
      }
    }
    console.log("STATS", JSON.stringify(stats));
    console.log("LEGACY", JSON.stringify(legacyLog));
    expect(stats["not read"]).toBeGreaterThan(300);
    expect(violations.slice(0, 5)).toEqual([]);
  }, 300_000);
});

