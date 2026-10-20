import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities } from "../drizzle/schema";
import { areaLabelFor, headlineFor, priceBand, publicLabelFor, sectorOf } from "../shared/dealsArea";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import type { DealAdapterResult } from "./dealsAdapters";

/**
 * Communities a builder reader discovers: added privately, labeled with coarse
 * generic words only, and kept off every page until their first clean sync.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), refreshCommunityGeography: vi.fn(), loadOfficialDeals: vi.fn(), sendBuilderDealsEmail: vi.fn(), processPendingDealPhotos: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsPhotos", () => ({ processDealPhoto: vi.fn(), processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));
vi.mock("./dealsAdapters", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsAdapters")>()), loadOfficialDeals: (...args: unknown[]) => mocks.loadOfficialDeals(...args) }));

import { autoReelCode, initialScrubConfig, onboardDiscoveredCommunities, streetFromAddress } from "./dealsOnboarding";
import { publicDealsCatalog } from "./dealsService";
import { refreshOfficialDeals } from "./dealsSync";

describe("area labels and headlines", () => {
  it("names a side of San Antonio from the ZIP centroid, a larger town farther out, never a small town", () => {
    expect(areaLabelFor({ centroid: { lat: 29.42, lng: -98.49 } })).toBe("Central San Antonio");
    expect(areaLabelFor({ centroid: { lat: 29.30, lng: -98.32 }, city: "San Antonio" })).toBe("Southeast San Antonio");
    expect(areaLabelFor({ centroid: { lat: 29.60, lng: -98.70 } })).toBe("Northwest San Antonio");
    // Converse is a suburb inside the metro: the side of town, not its name.
    expect(areaLabelFor({ centroid: { lat: 29.518, lng: -98.316 }, city: "Converse" })).toBe("Northeast San Antonio");
    expect(areaLabelFor({ centroid: { lat: 29.70, lng: -98.12 }, city: "New Braunfels" })).toBe("New Braunfels");
    // A small far-out town is too precise: the direction from San Antonio instead.
    expect(areaLabelFor({ centroid: { lat: 29.02, lng: -98.48 }, city: "Somerset" })).toBe("South of San Antonio");
    expect(areaLabelFor({ city: "Seguin" })).toBe("Seguin");
    expect(areaLabelFor({ city: "Adkins" })).toBe("Greater San Antonio");
    expect(sectorOf({ lat: 29.7, lng: -98.49 })).toBe("North");
  });

  it("builds headlines from a fixed vocabulary only", () => {
    expect(headlineFor({ acres: 0.5, amenities: ["Access to Calaveras Lake"] })).toBe("Half-Acre Lots and Lakes");
    expect(headlineFor({ fromPrice: 289_990, moveInReadyCount: 6 })).toBe("From the $200s and Move-In Ready Homes");
    expect(headlineFor({ amenities: ["Resort-style pool", "Miles of trails", "Lakes"] })).toBe("Lakes and Resort-Style Pool");
    expect(headlineFor({})).toBe("New Homes");
    expect(priceBand(1_250_000)).toBe("Over $1M");
    // Whatever an amenity says, only the vocabulary word reaches the label.
    expect(publicLabelFor("Southeast San Antonio", { amenities: ["Sienna Lakes Clubhouse"] })).toBe("Southeast San Antonio | Lakes");
  });
});

describe("onboarding discovered communities", () => {
  let db: FakeDealsDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = new FakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.processPendingDealPhotos.mockResolvedValue(undefined);
    mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true });
    // Geocoding writes the ZIP centroid, as the real one does.
    mocks.refreshCommunityGeography.mockImplementation(async (id: number) => {
      const row = db.rows(dealCommunities).find((r) => r.id === id)!;
      row.zipCentroidLat = "29.300500";
      row.zipCentroidLng = "-98.320500";
      return { ok: true };
    });
  });

  const discovered = {
    builder: "Chesmar",
    name: "Sienna Lakes",
    sourceUrl: "https://www.chesmar.com/texas/san-antonio-new-homes/san-antonio/sienna-lakes/",
    city: "San Antonio",
    address: "9010 Arroyo Grove, San Antonio, TX 78263",
    salesPhone: "(210) 555-0999",
    status: "selling" as const,
    priceFrom: 499_990,
    lotSizesText: "Half-acre homesites",
  };

  it("adds a new community privately: inactive until its first sync, coarse labels, names in the scrub list", async () => {
    const result = await onboardDiscoveredCommunities([discovered, { ...discovered, name: "Old Place", sourceUrl: "https://www.chesmar.com/old-place/", status: "closeout" }, { ...discovered, name: "Bad", sourceUrl: "http://insecure.example/" }]);
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toEqual([{ name: "Old Place", reason: "closeout" }, { name: "Bad", reason: "invalid_name_or_url" }]);
    const row = db.rows(dealCommunities)[0]!;
    expect(row).toMatchObject({ builder: "Chesmar", privateName: "Sienna Lakes", privateAddress: "9010 Arroyo Grove, San Antonio, TX 78263", active: false, awaitingFirstSync: true, areaLabel: "Southeast San Antonio", publicLabel: "Southeast San Antonio | Half-Acre Lots and From the $400s", reelCode: autoReelCode(discovered.sourceUrl) });
    const scrub = JSON.parse(row.scrubList as string);
    expect(scrub.community).toContain("Sienna Lakes");
    expect(scrub.street).toContain("Arroyo Grove");
    expect(scrub.builder).toEqual(expect.arrayContaining(["Chesmar", "Chesmar Homes"]));
    // Running discovery again adds nothing.
    expect(await onboardDiscoveredCommunities([discovered])).toMatchObject({ created: [], existing: 1 });
    // Nothing shows to buyers yet.
    expect(await publicDealsCatalog()).toEqual([]);
  });

  it("turns the community on after its first clean sync, with a headline from what the sync found", async () => {
    const { created: [id] } = await onboardDiscoveredCommunities([discovered]);
    const snapshot = {
      ok: true, catalogOk: true, incentiveHoldReasons: [], holdReasons: [], fetchedAt: new Date().toISOString(),
      private: { builder: "Chesmar", sourceUrl: discovered.sourceUrl, privateCommunityName: "Sienna Lakes", pages: [], plans: [], incentive: null, homes: [{ sourceUrl: `${discovered.sourceUrl}homes/1/`, privateName: "1", status: "Quick Move-In", price: 507_990, bedrooms: 4, bathrooms: 3, squareFeet: 2776, gallery: [] }], communityFacts: { fromPrice: 499_990, schoolDistrict: null, lotSizes: "Half-acre lots", amenities: ["Lakes", "Walking trails"] } },
      public: { plans: [], homes: [], incentive: null, holdReasons: [] },
    } as unknown as DealAdapterResult;
    mocks.loadOfficialDeals.mockResolvedValue(snapshot);
    const [result] = await refreshOfficialDeals();
    expect(result).toMatchObject({ communityId: id, ok: true });
    const row = db.rows(dealCommunities).find((r) => r.id === id)!;
    expect(row).toMatchObject({ active: true, awaitingFirstSync: false, publicLabel: "Southeast San Antonio | Half-Acre Lots and Lakes" });
    expect((await publicDealsCatalog()).map((entry) => entry.label)).toEqual(["Southeast San Antonio | Half-Acre Lots and Lakes"]);
  });

  it("keeps a label an admin rewrote while the community waited, and still turns it on", async () => {
    const { created: [id] } = await onboardDiscoveredCommunities([discovered]);
    db.rows(dealCommunities).find((r) => r.id === id)!.publicLabel = "Southeast San Antonio | Peter's Pick";
    mocks.loadOfficialDeals.mockResolvedValue({
      ok: true, catalogOk: true, incentiveHoldReasons: [], holdReasons: [], fetchedAt: new Date().toISOString(),
      private: { builder: "Chesmar", sourceUrl: discovered.sourceUrl, privateCommunityName: "Sienna Lakes", pages: [], plans: [], incentive: null, homes: [{ sourceUrl: `${discovered.sourceUrl}homes/1/`, privateName: "1", status: "Quick Move-In", price: 507_990, bedrooms: 4, bathrooms: 3, squareFeet: 2776, gallery: [] }], communityFacts: { fromPrice: 499_990, schoolDistrict: null, lotSizes: "Half-acre lots", amenities: ["Lakes"] } },
      public: { plans: [], homes: [], incentive: null, holdReasons: [] },
    } as unknown as DealAdapterResult);
    await refreshOfficialDeals();
    expect(db.rows(dealCommunities).find((r) => r.id === id)).toMatchObject({ active: true, awaitingFirstSync: false, publicLabel: "Southeast San Antonio | Peter's Pick" });
  });

  it("keeps a community that fails its first sync off the page, and never revives one an admin turned off", async () => {
    const { created: [id] } = await onboardDiscoveredCommunities([discovered]);
    mocks.loadOfficialDeals.mockResolvedValue({ ok: false, catalogOk: false, holdReasons: ["community_fetch_failed"], incentiveHoldReasons: [], fetchedAt: "", private: { homes: [], plans: [] }, public: { holdReasons: [] } });
    await refreshOfficialDeals();
    expect(db.rows(dealCommunities).find((r) => r.id === id)).toMatchObject({ active: false, awaitingFirstSync: true });
    const turnedOff = db.seed(dealCommunities, { builder: "Chesmar", privateName: "Admin Off", sourceUrl: "https://www.chesmar.com/admin-off/", privateAddress: "1 Main St, San Antonio, TX 78263", publicLabel: "x", areaLabel: "x", amenities: "[]", reelCode: "off1", scrubList: "{}", active: false, paused: false, manualMode: false });
    mocks.loadOfficialDeals.mockClear();
    const results = await refreshOfficialDeals();
    expect(results.some((r) => r.communityId === turnedOff)).toBe(false);
  });

  it("reads streets out of addresses and starts every scrub list with the builder and the community", () => {
    expect(streetFromAddress("9010 Arroyo Grove, San Antonio, TX 78263")).toBe("Arroyo Grove");
    expect(streetFromAddress("8106 Onion Patch Dr., San Antonio, TX 78263")).toBe("Onion Patch");
    expect(streetFromAddress("San Antonio, TX 78263")).toBeNull();
    expect(initialScrubConfig({ builder: "Perry Homes", name: "Kallison Ranch", address: "123 Ranch View Trl, San Antonio, TX" })).toMatchObject({ builder: ["Perry Homes"], community: ["Kallison Ranch"], street: ["Ranch View"] });
  });
});
