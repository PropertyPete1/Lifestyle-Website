import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealIncentives, dealLeads, dealPhotos } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Every community in the area means hundreds of rows: the catalog pages must
 * read them in a fixed number of queries, not a few per community or per home.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { gatedDealsCatalog, publicDealsCatalog } from "./dealsService";

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
});
