import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealIncentives, dealLeads, dealPhotos } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Every community in the area means hundreds of rows: the catalog pages must
 * read them in a fixed number of queries, not a few per community or per home.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { buildGatedCatalog, catalogBuildsSinceStart, gatedCatalogViewKey, gatedDealsCatalog, publicDealsCatalog } from "./dealsService";

let db: FakeDealsDb;
let selects = 0;

function seedCommunities(count: number) {
  for (let index = 0; index < count; index++) {
    const communityId = db.seed(dealCommunities, {
      builder: "Chesmar", privateName: `Place ${index}`, sourceUrl: `https://www.chesmar.com/p${index}/`, privateAddress: "1 Main St, San Antonio, TX 78263",
      publicLabel: `Area ${index} | New Homes`, areaLabel: `Area ${index}`, amenities: "[]", reelCode: `r${index}`, scrubList: "{}", active: true, paused: false, manualMode: false,
    });
    for (let home = 0; home < 3; home++) {
      const homeId = db.seed(dealHomes, { communityId, sourceKey: `k-${index}-${home}`, sourceUrl: `https://www.chesmar.com/p${index}/h${home}/`, kind: "quick_move_in", status: "available", origin: "official", price: 300_000 + home * 1_000 });
      db.seed(dealPhotos, { homeId, sourceUrl: `https://www.chesmar.com/p${index}/h${home}.jpg`, processingState: "processed", automaticHidden: false, adminHidden: false, sortOrder: 0 } as never);
    }
    db.seed(dealIncentives, { communityId, normalizedText: `o${index}`, publicText: `Offer ${index}`, confirmedAt: new Date(), active: true, held: false, manual: false });
  }
}

beforeEach(() => {
  db = new FakeDealsDb();
  selects = 0;
  const select = db.select.bind(db);
  db.select = ((fields?: Record<string, unknown>) => { selects += 1; return select(fields); }) as typeof db.select;
  mocks.getDb.mockResolvedValue(db);
});

describe("catalog reads at the scale of every community", () => {
  it("reads the landing page and a private list in the same number of queries for 2 or 40 communities", async () => {
    seedCommunities(2);
    const leadId = db.seed(dealLeads, { phoneE164: "+12105550123", status: "verified", expiresAt: new Date(Date.now() + 3_600_000), deviceHash: "d".repeat(64), consentText: "c", flags: "[]", sourceCode: "r0" });
    selects = 0;
    const smallPublic = await publicDealsCatalog();
    const publicReads = selects;
    selects = 0;
    const smallGated = await gatedDealsCatalog(leadId) as Array<{ homes: Array<{ photos: string[] }>; incentive: { text: string } | null }>;
    const gatedReads = selects;
    expect(smallPublic).toHaveLength(2);
    expect(smallGated).toHaveLength(2);

    seedCommunities(38);
    selects = 0;
    const bigPublic = await publicDealsCatalog();
    expect(selects).toBe(publicReads);
    selects = 0;
    const bigGated = await gatedDealsCatalog(leadId) as Array<{ label: string; homes: Array<{ photos: string[] }>; incentive: { text: string } | null }>;
    expect(selects).toBe(gatedReads);
    expect(bigPublic).toHaveLength(40);
    expect(bigPublic.every((entry) => entry.homesAvailable === 3)).toBe(true);
    // Each community still gets its own homes, photos and offer.
    expect(bigGated).toHaveLength(40);
    expect(bigGated.find((entry) => entry.label === "Area 17 | New Homes")).toMatchObject({ incentive: { text: "Offer 17" } });
    expect(bigGated.every((entry) => entry.homes.length === 3 && entry.homes.every((home) => home.photos.length === 1))).toBe(true);
    expect(new Set(bigGated.flatMap((entry) => entry.homes.flatMap((home) => home.photos))).size).toBe(120);
  });

  it("puts the community from the visitor's reel first on the landing page and on their private list", async () => {
    seedCommunities(5);
    const pub = await publicDealsCatalog("R3");
    expect(pub[0]).toMatchObject({ label: "Area 3 | New Homes", fromYourReel: true });
    expect(pub.filter((entry) => entry.fromYourReel)).toHaveLength(1);
    expect((await publicDealsCatalog()).every((entry) => !entry.fromYourReel)).toBe(true);
    const leadId = db.seed(dealLeads, { phoneE164: "+12105550124", status: "verified", expiresAt: new Date(Date.now() + 3_600_000), deviceHash: "e".repeat(64), consentText: "c", flags: "[]", sourceCode: "r4" });
    const gated = await gatedDealsCatalog(leadId) as Array<{ label: string; fromYourReel: boolean; key: string }>;
    expect(gated[0]).toMatchObject({ label: "Area 4 | New Homes", fromYourReel: true });
    expect(new Set(gated.map((entry) => entry.key)).size).toBe(5);
  });

  it("serves one shared build of the list per view, ordering it and marking the reel per lead without rebuilding (Oct 27)", async () => {
    seedCommunities(5);
    const built = await buildGatedCatalog({ view: "gated" });
    expect(built.map((item) => item.id)).toEqual([...built.map((item) => item.id)].sort((a, b) => a - b));
    expect(built.every((item) => item.entry.fromYourReel === false)).toBe(true);
    const loader = vi.fn(async () => built);
    const r4 = db.seed(dealLeads, { phoneE164: "+12105550124", status: "verified", expiresAt: new Date(Date.now() + 3_600_000), deviceHash: "e".repeat(64), consentText: "c", flags: "[]", sourceCode: "r4" });
    const r2 = db.seed(dealLeads, { phoneE164: "+12105550125", status: "verified", expiresAt: new Date(Date.now() + 3_600_000), deviceHash: "f".repeat(64), consentText: "c", flags: "[]", sourceCode: "R2" });
    const listFour = await gatedDealsCatalog(r4, { view: "gated" }, { built: loader }) as Array<{ label: string; fromYourReel: boolean }>;
    const listTwo = await gatedDealsCatalog(r2, { view: "gated" }, { built: loader }) as Array<{ label: string; fromYourReel: boolean }>;
    expect(loader).toHaveBeenCalledTimes(2);
    expect(listFour[0]).toMatchObject({ label: "Area 4 | New Homes", fromYourReel: true });
    expect(listTwo[0]).toMatchObject({ label: "Area 2 | New Homes", fromYourReel: true });
    expect(listFour.filter((entry) => entry.fromYourReel)).toHaveLength(1);
    // The shared build is never written to by a lead's pass.
    expect(built.every((item) => item.entry.fromYourReel === false)).toBe(true);
    // An expired lead gets nothing and never asks for the build.
    const expired = db.seed(dealLeads, { phoneE164: "+12105550126", status: "verified", expiresAt: new Date(Date.now() - 1), deviceHash: "a".repeat(64), consentText: "c", flags: "[]", sourceCode: "r1" });
    expect(await gatedDealsCatalog(expired, { view: "gated" }, { built: loader })).toEqual([]);
    expect(loader).toHaveBeenCalledTimes(2);
    // Admin health reads how long the last build took and what it held.
    expect(catalogBuildsSinceStart().gated).toMatchObject({ communities: 5, homes: expect.any(Number) });
    expect(catalogBuildsSinceStart().gated.readMs).toBeLessThanOrEqual(catalogBuildsSinceStart().gated.ms);
    expect(gatedCatalogViewKey({ view: "gated" })).toBe("gated");
    expect(gatedCatalogViewKey({ view: "full", builderPages: true })).toBe("full:pages");
    expect(gatedCatalogViewKey({ view: "full", builderPages: false })).toBe("full:nopages");
  });

  it("gives the landing page an offer's teaser and figures only; the full wording, the exact homes and the deadlines wait for sign-up", async () => {
    seedCommunities(1);
    const offer = db.rows(dealIncentives)[0]!;
    // What the M/I reader stores: a headline with a closing date, the body, and fine print with both deadlines.
    offer.publicText = "Fall Into Savings: first-year rates as low as 4.99% (6.2% APR) on selected quick move-in homes closing by 11/30, plus up to $10,000 paid closing costs. Selected Quick Move-In homes in this community receive a 1/0 buydown on a 30-year fixed FHA loan. Valid on full priced contracts written between 10/12/2026 and 11/8/2026. Buyer must close by 11/30/2026.";
    offer.headlineRate = "4.99%";
    offer.apr = "6.2%";
    offer.contractBy = new Date("2026-11-08T06:00:00Z");
    offer.closeBy = new Date("2026-12-20T06:00:00Z");
    const pub = await publicDealsCatalog();
    const teaser = "Fall Into Savings: first-year rates as low as 4.99% (6.2% APR) on selected quick move-in homes, plus up to $10,000 paid closing costs.";
    expect(pub[0]!.incentive).toMatchObject({ text: teaser, teaser, headlineRate: "4.99%", contractBy: null, closeBy: null });
    expect(JSON.stringify(pub)).not.toMatch(/Selected Quick Move-In|11\/30|10\/12\/2026|11\/8\/2026|2026-11-08|2026-12-20|buydown/);
    const leadId = db.seed(dealLeads, { phoneE164: "+12105550125", status: "verified", expiresAt: new Date(Date.now() + 3_600_000), deviceHash: "f".repeat(64), consentText: "c", flags: "[]", sourceCode: "r0" });
    const gated = await gatedDealsCatalog(leadId) as Array<{ incentive: { text: string; contractBy: unknown } }>;
    expect(gated[0]!.incentive.text).toContain("Buyer must close by 11/30/2026");
    expect(gated[0]!.incentive.contractBy).not.toBeNull();
  });
});
