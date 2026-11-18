import type { AddressInfo } from "net";
import { createServer, type Server } from "http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aptApiKeys, aptProperties } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Pay updates from outside: a keyed address that changes only what a community pays, only for a community it can
 * match to exactly one on file, and never lets an older reading overwrite a newer one. Fixtures are invented.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { APT_PAY_PATH, aptPayKeyStatus, createAptPayHandler, generateAptPayKey, payNameKey, resetAptPayRateLimit, revokeAptPayKey } from "./apartmentsPayImport";
import { importApartments, loadApartments } from "./apartmentsStore";

const NOW = new Date("2026-11-18T13:00:00Z"); // 7:00 AM Central
let db: FakeDealsDb;
let server: Server;
let base: string;
let key: string;
beforeEach(async () => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  resetAptPayRateLimit();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  await importApartments([
    { sourceKey: "manual:flats", name: "The Fixture Flats Apartments", address: "100 Fixture Pkwy, San Antonio, TX 78216", zip: "78216", city: "San Antonio", areaLabel: "North Central San Antonio", sendPercent: 50, escortPercent: 100, commissionVerifiedOn: "2026-11-10", specialText: "One month free", brokenLease: "yes" },
    { sourceKey: "manual:lofts-sa", name: "Sample Lofts", address: "200 Sample St, San Antonio, TX 78209", zip: "78209", city: "San Antonio", areaLabel: "Alamo Heights" },
    { sourceKey: "manual:lofts-atx", name: "Sample Lofts", address: "900 Sample Ave, Austin, TX 78702", zip: "78702", city: "Austin", areaLabel: "East Austin" },
    { sourceKey: "manual:closed", name: "Closed Court", address: "1 Closed Ct, Austin, TX 78702", city: "Austin", areaLabel: "East Austin", active: false },
  ]);
  key = (await generateAptPayKey(NOW)).key;
  const app = express();
  app.use(express.json());
  app.post(APT_PAY_PATH, createAptPayHandler({ now: () => NOW }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${APT_PAY_PATH}`;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); vi.restoreAllMocks(); });

const post = async (body: unknown, auth: string | null = key) => {
  const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as { ok: boolean; error?: string; updated?: number; unchanged?: number; skipped?: number; notApplied?: Array<{ index: number; name: string; status: string; reason?: string }> } };
};
const byKey = async (sourceKey: string) => { const row = (db.rows(aptProperties) as Array<{ id: number; sourceKey: string }>).find((entry) => entry.sourceKey === sourceKey)!; return (await loadApartments()).find((property) => property.id === row.id)!; };

describe("pay updates from outside", () => {
  it("needs the key; the key is stored only as a hash and a new one retires the old", async () => {
    expect((await post({ updates: [] }, null)).status).toBe(401);
    expect((await post({ updates: [] }, "ldrapt_wrong")).status).toBe(401);
    expect(JSON.stringify(db.rows(aptApiKeys))).not.toContain(key);
    const next = (await generateAptPayKey(NOW)).key;
    expect((await post({ updates: [{ name: "Fixture Flats", sendPercent: 60, confirmedOn: "2026-11-18" }] }, key)).status).toBe(401);
    expect((await post({ updates: [{ name: "Fixture Flats", sendPercent: 60, confirmedOn: "2026-11-18" }] }, next)).status).toBe(200);
    expect(await aptPayKeyStatus()).toMatchObject({ exists: true, lastUsedAt: NOW });
    await revokeAptPayKey();
    expect((await post({ updates: [{ name: "Fixture Flats", sendPercent: 70, confirmedOn: "2026-11-18" }] }, next)).status).toBe(401);
  });

  it("updates only the pay of the one community a line means, and dates it", async () => {
    const result = await post({ updates: [{ name: "Fixture Flats", address: "100 Fixture Pkwy, San Antonio, TX 78216", escortPercent: 125, bonusAmount: 300, bonusExpiresOn: "2026-12-31", confirmedOn: "2026-11-18" }] });
    expect(result).toMatchObject({ status: 200, body: { ok: true, updated: 1, notApplied: [] } });
    const flats = await byKey("manual:flats");
    // The send rate was not in the line, so it stays. Nothing but pay moved.
    expect(flats).toMatchObject({ sendPercent: 50, escortPercent: 125, bonusAmount: 300, bonusExpiresOn: "2026-12-31", commissionVerifiedOn: "2026-11-18", specialText: "One month free", brokenLease: "yes", name: "The Fixture Flats Apartments" });
    // The same line again changes nothing.
    expect((await post({ updates: [{ name: "Fixture Flats", address: "100 Fixture Pkwy, San Antonio, TX 78216", escortPercent: 125, bonusAmount: 300, bonusExpiresOn: "2026-12-31", confirmedOn: "2026-11-18" }] })).body).toMatchObject({ updated: 0, unchanged: 1 });
    // An explicit null clears a figure (the bonus ended).
    await post({ updates: [{ name: "Fixture Flats", bonusAmount: null, bonusExpiresOn: null, confirmedOn: "2026-11-18" }] });
    expect(await byKey("manual:flats")).toMatchObject({ bonusAmount: null, escortPercent: 125 });
  });

  it("never guesses: an unknown name, two communities with one name, a wrong address, an inactive one and a bad line are handed back", async () => {
    const result = await post({ updates: [
      { name: "Nowhere Place", sendPercent: 50, confirmedOn: "2026-11-18" },
      { name: "Sample Lofts", sendPercent: 75, confirmedOn: "2026-11-18" },
      { name: "Fixture Flats", address: "999 Other Rd, San Antonio, TX 78216", sendPercent: 75, confirmedOn: "2026-11-18" },
      { name: "Closed Court", sendPercent: 75, confirmedOn: "2026-11-18" },
      { name: "Sample Lofts", address: "900 Sample Ave, Austin, TX 78702", sendPercent: 400, confirmedOn: "2026-11-18" },
      { name: "Sample Lofts", address: "900 Sample Ave, Austin, TX 78702", confirmedOn: "2026-11-18" },
      { name: "Sample Lofts", address: "900 Sample Ave, Austin, TX 78702", sendPercent: 75, confirmedOn: "2026-11-25" },
      { name: "Sample Lofts", address: "900 Sample Ave, Austin, TX 78702", sendPercent: 75, escortPercent: 100, confirmedOn: "2026-11-17" },
      { name: "Sample Lofts", address: "900 Sample Ave, Austin, TX 78702", sendPercent: 20, confirmedOn: "2026-11-17" },
    ] });
    expect(result.body).toMatchObject({ ok: false, updated: 1 });
    expect(result.body.notApplied!.map((entry) => [entry.index, entry.status, entry.reason])).toEqual([
      [0, "unmatched", "no_community_with_this_name"],
      [1, "unmatched", "more_than_one_community_matches_send_the_address"],
      [2, "unmatched", "name_matches_but_address_does_not"],
      [3, "unmatched", "no_community_with_this_name"],
      [4, "invalid", expect.stringContaining("sendPercent")],
      [5, "invalid", "no pay figure in this line"],
      [6, "invalid", "confirmedOn is in the future"],
      [8, "skipped", "this community is already in this call"],
    ]);
    expect(await byKey("manual:lofts-atx")).toMatchObject({ sendPercent: 75, escortPercent: 100, commissionVerifiedOn: "2026-11-17" });
    expect(await byKey("manual:lofts-sa")).toMatchObject({ sendPercent: null, commissionVerifiedOn: null });
    expect(await byKey("manual:flats")).toMatchObject({ sendPercent: 50, commissionVerifiedOn: "2026-11-10" });
  });

  it("an older reading never overwrites a newer one, and a body of the wrong shape is refused whole", async () => {
    expect((await post({ updates: [{ name: "Fixture Flats", sendPercent: 25, confirmedOn: "2026-11-01" }] })).body.notApplied).toEqual([{ index: 0, name: "Fixture Flats", status: "skipped", reason: "stored pay was confirmed 2026-11-10, after this line" }]);
    expect((await byKey("manual:flats")).sendPercent).toBe(50);
    expect((await post({ rows: [] })).status).toBe(400);
    expect((await post({ updates: [], extra: true })).status).toBe(400);
    // Anything that is not pay is refused, so this door can never rename a community or change its policies.
    expect((await post({ updates: [{ name: "Fixture Flats", sendPercent: 60, brokenLease: "no", confirmedOn: "2026-11-18" }] })).body.notApplied![0]).toMatchObject({ status: "invalid" });
    expect((await byKey("manual:flats"))).toMatchObject({ sendPercent: 50, brokenLease: "yes" });
  });

  it("stops after 30 calls in an hour, and names compare without filler words", async () => {
    for (let call = 0; call < 30; call++) expect((await post({ updates: [{ name: "Nowhere", sendPercent: 1, confirmedOn: "2026-11-18" }] })).status).toBe(200);
    expect((await post({ updates: [{ name: "Nowhere", sendPercent: 1, confirmedOn: "2026-11-18" }] })).status).toBe(429);
    expect(payNameKey("The Fixture Flats Apartments")).toBe(payNameKey("fixture flats"));
    expect(payNameKey("Résidences & Co. at Fixture")).toBe("residences and co fixture");
    expect(payNameKey("The Apartments")).toBe("");
  });
});
