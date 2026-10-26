import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealAlerts, dealClientLinks, dealCommunities, dealHomes, dealLeads, dealTeamAllowlist, dealTourRequests } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Oct 26, 2026: a price drop on a home a buyer saved. The buyer's agent gets an email right away and the owners'
 * digest a line; once per home, buyer and new price; quiet test numbers and lapsed buyers are skipped.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), sendBuilderDealsEmail: vi.fn(), getDealSettings: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsService", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsService")>()), getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args) }));
vi.mock("./dealsMap", () => ({ communityAreaMap: () => null, areaMapGeometry: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));

import { queueSavedHomePriceDropAlerts } from "./dealsAlerts";

const HOUR = 3_600_000;
let db: FakeDealsDb;
let teamId: number;
let homeId: number;
const lead = (overrides: Partial<typeof dealLeads.$inferInsert> & { phoneE164: string }) => {
  const id = db.seed(dealLeads, { status: "verified", expiresAt: new Date(Date.now() + HOUR), deviceHash: "d".repeat(64), consentText: "c", consentIp: "127.0.0.1", flags: "[]", sourceCode: "sl1", ...overrides });
  return db.rows(dealLeads).find((row) => row.id === id) as typeof dealLeads.$inferSelect;
};
const alerts = () => db.rows(dealAlerts) as Array<typeof dealAlerts.$inferSelect>;

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "sent", deliveryLog: "test" });
  mocks.getDealSettings.mockResolvedValue({ alertRecipients: ["peter@lifestyledesignrealty.com"], alertMode: "hourly_digest", testNumbers: ["+12105559999"], testModeFullPipeline: false });
  teamId = db.seed(dealTeamAllowlist, { name: "Tiffany Agent", phoneE164: "+12105550101", email: "tiffany@example.com", fubUserId: "77", source: "fub", active: true });
  const communityId = db.seed(dealCommunities, { builder: "Chesmar", privateName: "Fixture Lakes", sourceUrl: "https://www.chesmar.com/fixture-lakes/", publicLabel: "Southeast San Antonio | Lakes", areaLabel: "Southeast San Antonio", reelCode: "sl1", active: true, paused: false, manualMode: false, scrubList: "{}" });
  homeId = db.seed(dealHomes, { communityId, sourceKey: "k1", sourceUrl: "https://www.chesmar.com/fixture-lakes/brandon/1/", privateAddress: "118 Fixture Lakes Blvd", privatePlanName: "Brandon", kind: "quick_move_in", status: "available", origin: "official", price: 479_990 });
});
afterEach(() => { vi.clearAllMocks(); });

describe("price drops on saved homes", () => {
  it("emails the client's agent and the owners once per drop, naming the home and the client", async () => {
    const linkId = db.seed(dealClientLinks, { token: "t".repeat(32), agentTeamId: teamId, agentLeadId: 1, clientName: "Maria Lopez", expiresAt: new Date(Date.now() + HOUR) });
    const maria = lead({ phoneE164: "+12105550202", agentTeamId: teamId, clientLinkId: linkId, sourceCode: "agent" });
    db.seed(dealTourRequests, { leadId: maria.id, homeId, requestType: "save", preferredAt: new Date(), chicagoDay: "2026-10-26" });
    // A buyer who unsaved it, and one whose access lapsed, hear nothing; neither does anyone about an unchanged home.
    const gone = lead({ phoneE164: "+12105550303" });
    db.seed(dealTourRequests, { leadId: gone.id, homeId, requestType: "save", preferredAt: new Date(), chicagoDay: "2026-10-26", removedAt: new Date() });
    const lapsed = lead({ phoneE164: "+12105550404", expiresAt: new Date(Date.now() - HOUR) });
    db.seed(dealTourRequests, { leadId: lapsed.id, homeId, requestType: "save", preferredAt: new Date(), chicagoDay: "2026-10-26" });

    expect(await queueSavedHomePriceDropAlerts([{ homeId, from: 489_990, to: 479_990 }, { homeId: 999, from: 5, to: 4 }, { homeId, from: 400_000, to: 400_000 }])).toEqual({ queued: 2 });
    const agent = alerts().find((alert) => alert.dedupeKey === `price_drop:${homeId}:${maria.id}:479990:agent`)!;
    expect(agent).toMatchObject({ kind: "agent_update", deliveryMode: "immediate", recipients: JSON.stringify(["tiffany@example.com"]), subject: "Builder Deals: Maria Lopez's saved home dropped $10,000" });
    expect(agent.content).toContain("118 Fixture Lakes Blvd (Brandon) · Chesmar Fixture Lakes dropped $10,000: $489,990 → $479,990.");
    expect(agent.content).toContain("Maria Lopez has this home saved.");
    const owners = alerts().find((alert) => alert.dedupeKey === `price_drop:${homeId}:${maria.id}:479990`)!;
    expect(owners).toMatchObject({ kind: "agent_update", deliveryMode: "hourly_digest", recipients: JSON.stringify(["peter@lifestyledesignrealty.com"]) });
    expect(owners.content).toContain("Their agent: Tiffany Agent (tiffany@example.com), emailed.");
    expect(alerts()).toHaveLength(2);
    // The same drop again carries the same dedupe keys, so the unique index keeps MySQL from queueing it twice
    // (the fake database has no unique indexes, so only the keys are checked here).
    await queueSavedHomePriceDropAlerts([{ homeId, from: 489_990, to: 479_990 }]);
    expect(new Set(alerts().map((alert) => alert.dedupeKey)).size).toBe(2);
  });

  it("tells the owners alone about a reel buyer with no agent, and stays quiet for a quiet test number", async () => {
    const buyer = lead({ phoneE164: "+12105550505" });
    db.seed(dealTourRequests, { leadId: buyer.id, homeId, requestType: "save", preferredAt: new Date(), chicagoDay: "2026-10-26" });
    const quiet = lead({ phoneE164: "+12105559999" });
    db.seed(dealTourRequests, { leadId: quiet.id, homeId, requestType: "save", preferredAt: new Date(), chicagoDay: "2026-10-26" });
    expect(await queueSavedHomePriceDropAlerts([{ homeId, from: 489_990, to: 479_990 }])).toEqual({ queued: 1 });
    const [owners] = alerts();
    expect(owners.dedupeKey).toBe(`price_drop:${homeId}:${buyer.id}:479990`);
    expect(owners.content).toContain("No agent on this buyer.");
    expect(owners.subject).toBe("Builder Deals: a saved home dropped $10,000");
  });
});
