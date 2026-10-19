import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealIncentives, dealLeads } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsMap", () => ({ communityAreaMap: () => null }));

import { gatedDealsCatalog, publicDealsCatalog } from "./dealsService";

const DAY = 86_400_000;
let db: FakeDealsDb;
let communityId: number;
let leadId: number;

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  communityId = db.seed(dealCommunities, {
    builder: "M/I Homes", privateName: "Fixture Gardens", sourceUrl: "https://www.mihomes.com/x", privateAddress: "8106 Fixture Street, San Antonio, TX 78263",
    publicLabel: "Southeast San Antonio | New Phase Now Selling", areaLabel: "Southeast San Antonio", schoolDistrict: "Fixture County ISD", lotSizes: "Half-acre homesites", amenities: JSON.stringify(["Walking trails", "Fixture Gardens clubhouse"]),
    reelCode: "vg1", scrubList: JSON.stringify({ plan: ["Magnolia"], street: ["Fixture Street"], other: [] }), active: true, paused: false, manualMode: false,
  });
  leadId = db.seed(dealLeads, { phoneE164: "+12105550123", status: "verified", expiresAt: new Date(Date.now() + 3_600_000), deviceHash: "d".repeat(64), consentText: "c", flags: "[]", sourceCode: "vg1" });
});

afterEach(() => vi.clearAllMocks());

const seedHome = (values: Partial<typeof dealHomes.$inferInsert>) => db.seed(dealHomes, { communityId, sourceKey: `key-${Math.random()}`, sourceUrl: `https://www.mihomes.com/${Math.random()}`, kind: "quick_move_in", status: "available", origin: "official", price: 400_000, ...values });
const catalog = async () => (await gatedDealsCatalog(leadId) as Array<{ homes: Array<{ kind: string }>; incentive: unknown; amenities: string[]; label: string }>)[0];

describe("gated catalog selection and privacy", () => {
  it("shows To Be Built cards only when the community has zero quick move-ins", async () => {
    seedHome({ kind: "to_be_built", privatePlanName: "Magnolia", price: 354_990 });
    seedHome({ kind: "to_be_built", privatePlanName: "Cypress", price: 380_000 });
    expect((await catalog()).homes.map((home) => home.kind)).toEqual(["to_be_built", "to_be_built"]);
    seedHome({ kind: "quick_move_in", privateAddress: "8106 Fixture Street", price: 410_000 });
    expect((await catalog()).homes.map((home) => home.kind)).toEqual(["quick_move_in"]);
    seedHome({ kind: "quick_move_in", privateAddress: "8110 Fixture Street", price: 420_000, status: "sold" });
    expect((await catalog()).homes).toHaveLength(1);
  });

  it("scrubs community text by category and refuses the whole payload when private residue survives", async () => {
    const entry = await catalog();
    expect(entry.amenities).toEqual(["Walking trails", "this community clubhouse"]);
    expect(JSON.stringify(entry)).not.toContain("Fixture Gardens");
    expect(JSON.stringify(entry)).not.toContain("Fixture Street");
    db.rows(dealCommunities)[0].scrubList = JSON.stringify({ other: ["VGX"] });
    db.rows(dealCommunities)[0].amenities = JSON.stringify(["Near VGX"]);
    await expect(gatedDealsCatalog(leadId)).rejects.toThrow(/Private builder data would reach the gated catalog/);
    db.rows(dealCommunities)[0].publicLabel = "VGX homes";
    await expect(publicDealsCatalog()).rejects.toThrow(/public catalog/);
  });

  it("applies the incentive lapse days at render time and never shows a held, expired or lapsed record", async () => {
    const seedIncentive = (values: Partial<typeof dealIncentives.$inferInsert>) => db.seed(dealIncentives, { communityId, normalizedText: `t${Math.random()}`, publicText: "Promo", active: true, held: false, ...values });
    seedIncentive({ publicText: "Lapsed no-date promo", confirmedAt: new Date(Date.now() - 15 * DAY) });
    expect((await catalog()).incentive).toBeNull();
    expect((await publicDealsCatalog())[0].incentive).toBeNull();
    seedIncentive({ publicText: "Fresh no-date promo", confirmedAt: new Date(Date.now() - 13 * DAY) });
    expect((await catalog()).incentive).toMatchObject({ text: "Fresh no-date promo" });
    db.rows(dealIncentives).forEach((row) => { row.active = false; });
    seedIncentive({ publicText: "Past date promo", confirmedAt: new Date(), expiresAt: new Date(Date.now() - 60_000) });
    seedIncentive({ publicText: "Held promo", confirmedAt: new Date(), held: true, active: false });
    expect((await catalog()).incentive).toBeNull();
    seedIncentive({ publicText: "Future date promo", confirmedAt: new Date(Date.now() - 30 * DAY), expiresAt: new Date(Date.now() + DAY) });
    expect((await catalog()).incentive).toMatchObject({ text: "Future date promo" });
  });
});
