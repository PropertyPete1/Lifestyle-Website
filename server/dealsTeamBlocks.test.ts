import { describe, expect, it } from "vitest";
import { dealBlocklist, dealEvents } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import { clearAgentBlocksForTeamIdentity } from "./dealsMaintenance";

/**
 * Nov 16, 2026: a new agent tried the builder link before she was on the team list. The screening wrote an agent
 * block on her number and on her browser, and every later visit sent that browser to the recruiting page. Joining
 * the team (the FUB mirror) lifts those blocks and nobody else's.
 */
describe("joining the team lifts the agent blocks the screening wrote", () => {
  const at = new Date("2026-11-16T20:00:10Z");
  const seed = () => {
    const db = new FakeDealsDb();
    const phoneRow = db.seed(dealBlocklist, { phoneE164: "+12105550123", email: null, deviceHash: null, searchPhone: null, reason: "fub_realtor", expiresAt: null, createdAt: at } as never);
    const browserRow = db.seed(dealBlocklist, { phoneE164: null, email: null, deviceHash: "a".repeat(64), searchPhone: null, reason: "fub_realtor device cooldown", expiresAt: null, createdAt: new Date(at.getTime() + 400) } as never);
    // Someone else's browser, flagged an hour later: not hers.
    const otherBrowser = db.seed(dealBlocklist, { phoneE164: null, email: null, deviceHash: "b".repeat(64), searchPhone: null, reason: "known_agent device cooldown", expiresAt: null, createdAt: new Date(at.getTime() + 3_600_000) } as never);
    // A buyer's "working with an agent" answer and an admin's block are never lifted by this.
    const buyerRow = db.seed(dealBlocklist, { phoneE164: null, email: null, deviceHash: "c".repeat(64), searchPhone: "+12105550123", reason: "Confirmed working with an agent", expiresAt: null, createdAt: at } as never);
    const adminRow = db.seed(dealBlocklist, { phoneE164: "+12105550123", email: null, deviceHash: null, searchPhone: null, reason: "admin review", expiresAt: null, createdAt: at } as never);
    return { db, phoneRow, browserRow, otherBrowser, buyerRow, adminRow };
  };
  const ids = (db: FakeDealsDb) => db.rows(dealBlocklist).map((row) => (row as { id: number }).id).sort((a, b) => a - b);

  it("removes her number's block and the browser block written with it, and keeps every other row", async () => {
    const { db, otherBrowser, buyerRow, adminRow } = seed();
    expect(await clearAgentBlocksForTeamIdentity(db as never, "+12105550123", null)).toBe(2);
    expect(ids(db)).toEqual([otherBrowser, buyerRow, adminRow].sort((a, b) => a - b));
  });

  it("also removes the block on a browser an event ties to her number", async () => {
    const { db, otherBrowser, buyerRow, adminRow } = seed();
    db.seed(dealEvents, { kind: "blocked", phoneE164: "+12105550123", deviceHash: "b".repeat(64), sourceCode: "sl1", detail: "known_agent" } as never);
    expect(await clearAgentBlocksForTeamIdentity(db as never, "+12105550123", null)).toBe(3);
    expect(ids(db)).toEqual([buyerRow, adminRow].sort((a, b) => a - b));
    void otherBrowser;
  });

  it("does nothing for a team member with no agent block", async () => {
    const { db } = seed();
    expect(await clearAgentBlocksForTeamIdentity(db as never, "+12105550999", null)).toBe(0);
    expect(db.rows(dealBlocklist)).toHaveLength(5);
  });
});
