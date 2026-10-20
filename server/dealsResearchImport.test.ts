import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/** The research list goes in whole, hidden, with names in the scrub list and nothing private in a label. */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), refreshCommunityGeography: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));

import { builderNameFor, discoveredFromResearchRow, importResearchCommunities, parseCsv } from "./dealsResearchImport";
import { hasPrivateTerm } from "../shared/deals";
import { storedScrubConfig } from "./dealsSync";

let db: FakeDealsDb;
beforeEach(() => {
  vi.clearAllMocks();
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: false, reason: "test" });
});

describe("the research CSV", () => {
  it("parses quoted fields with commas, quotes and newlines", () => {
    const rows = parseCsv('a,b,c\n1,"x, y","line\nbreak"\n2,"say ""hi""",\n');
    expect(rows).toEqual([{ a: "1", b: "x, y", c: "line\nbreak" }, { a: "2", b: "say \"hi\"", c: "" }]);
    expect(builderNameFor("Chesmar Homes")).toBe("Chesmar");
    expect(builderNameFor("Perry Homes")).toBe("Perry Homes");
  });

  it("turns a row into a discovered community, reading the ZIP out of the address when the column is blank", () => {
    const community = discoveredFromResearchRow({ builder: "Perry Homes", community_name: "Arcadia Ridge", city: "San Antonio", zip: "", official_community_url: "https://www.perryhomes.com/x", model_home_or_sales_address: "1319 Nicholas Cove\nSan Antonio, TX 78245", sales_phone: "210-555-0100", status: "coming_soon", price_from: "$350,740", move_in_ready_count: "5", lot_sizes_text: "60' homesites", school_district: "Northside ISD" });
    expect(community).toMatchObject({ builder: "Perry Homes", name: "Arcadia Ridge", zip: "78245", address: "1319 Nicholas Cove, San Antonio, TX 78245", status: "coming_soon", priceFrom: 350_740, moveInReadyCount: 5, lotSizesText: "60' homesites", schoolDistrict: "Northside ISD" });
    expect(discoveredFromResearchRow({ builder: "X", community_name: "", official_community_url: "https://x" })).toBeNull();
  });

  it("imports the real list: hundreds of hidden communities, private names in their scrub lists, no name in any label", async () => {
    db.seed(dealCommunities, { builder: "Chesmar", privateName: "Sienna Lakes", sourceUrl: "https://www.chesmar.com/texas/san-antonio-new-homes/san-antonio/sienna-lakes/", privateAddress: "9010 Arroyo Grove, San Antonio, TX 78263", publicLabel: "Southeast San Antonio | Half-Acre Lots and Lakes", areaLabel: "Southeast San Antonio", amenities: "[]", reelCode: "sl1", scrubList: "{}", active: true, paused: false, manualMode: false });
    const result = await importResearchCommunities();
    expect(result.rows).toBeGreaterThan(500);
    expect(result.created.length).toBeGreaterThan(450);
    // The one row listed twice is one community, so nothing is "existing" on a first import but the seeded Sienna Lakes.
    expect(result.existing).toBe(1);
    expect(result.builders).toBeGreaterThan(40);
    expect(result.builders).toBeLessThanOrEqual(51);
    const added = db.rows(dealCommunities).filter((row) => row.awaitingFirstSync);
    expect(added.length).toBe(result.created.length);
    expect(added.every((row) => !row.active)).toBe(true);
    // Every generated label is clean against that community's own private names.
    for (const row of added) {
      const config = storedScrubConfig(row);
      expect(config.community).toContain(row.privateName);
      expect(hasPrivateTerm(row.publicLabel, config)).toBe(false);
      expect(hasPrivateTerm(row.areaLabel, config)).toBe(false);
      expect(row.publicLabel).toMatch(/^(?:Central |North|South|East|West|Greater )?[A-Za-z ]+ \| /);
    }
    // The research spells Chesmar "Chesmar Homes"; its communities land under the reader's name.
    expect(added.filter((row) => row.builder === "Chesmar").length).toBeGreaterThan(15);
    expect(added.some((row) => row.builder === "Chesmar Homes")).toBe(false);
    // Running it again adds nothing.
    expect((await importResearchCommunities()).created).toEqual([]);
  }, 20_000);
});
