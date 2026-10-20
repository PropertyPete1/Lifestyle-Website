import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealJobRuns } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Discovery from builders' own sitemaps and schema.org records. Synthetic
 * pages that follow the shapes the two live sites use (October 2026): Chesmar
 * serves a sitemap index and a LocalBusiness record with an address array; M/I
 * serves one URL set and a HomeAndConstructionBusiness record next to its
 * Organization and breadcrumb records.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), refreshCommunityGeography: vi.fn(), sendBuilderDealsEmail: vi.fn(), onboardFailure: null as string | null }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsOnboarding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dealsOnboarding")>();
  return { ...actual, onboardDiscoveredCommunities: async (communities: Array<{ builder: string }>) => {
    if (mocks.onboardFailure && communities.some((community) => community.builder === mocks.onboardFailure)) throw new Error("geocoder exploded");
    return actual.onboardDiscoveredCommunities(communities);
  } };
});
import { leaseBuilder } from "./dealsSync";

import { DISCOVERY_READERS, communityRecordFromHtml, discoverBuilderCommunities, drhListingPaths, priceFromRange, runCommunityDiscovery } from "./dealsDiscovery";

const CH = "https://www.chesmar.com";
const MI = "https://www.mihomes.com";
const DRH = "https://www.drhorton.com";
/** D.R. Horton: a page-title "Place" record with lower-case address keys and coordinates, then the community's LocalBusiness record. */
const drhRecords = (name: string, street: string, city: string, zip: string, geo = { latitude: 29.3778, longitude: -98.3754 }) => [
  { name: `Houses For Sale in ${city}, TX | ${name} | D.R. Horton`, description: "Find homes for sale", "@context": "http://schema.org", "@type": "Place", url: `${DRH}/x`, address: { "@type": "PostalAddress", addresslocality: city.toUpperCase(), addressregion: "TX", postalcode: zip, streetaddress: street }, ...geo },
  { "@context": "https://schema.org", "@type": "LocalBusiness", name, address: { "@type": "PostalAddress", streetAddress: street, addressLocality: city.toUpperCase(), postalCode: zip, addressRegion: "TX", addressCountry: "US" } },
  { "@context": "https://schema.org", "@type": "WebPage", name: `Houses For Sale in ${city}, TX | ${name} | D.R. Horton`, publisher: { "@type": "Organization", name: "D.R. Horton" } },
];
const drhListing = (entries: Array<[string, string]>) => JSON.stringify({ MetaData: { AreaInfoData: { Name: "San Antonio" } }, FacetData: {}, CommunityData: entries.map(([commName, commPageLink]) => ({ commName, commPageLink, commSellingStatus: "Now Selling", commAvailableHomes: 3, commMinPrice: 242_000 })) });
const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const urlset = (urls: string[]) => xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`);
const page = (records: unknown[], body = "<h1>Community</h1><p>Now selling</p>") => `<!doctype html><html><head>${records.map((record) => `<script type="application/ld+json">${JSON.stringify(record)}</script>`).join("")}</head><body>${body}</body></html>`;
const chesmarRecord = (name: string, street: string, city: string, zip: string, geo = { latitude: "29.42", longitude: "-98.31" }) => ({ "@context": "http://schema.org", "@type": "LocalBusiness", name, telephone: "2105550100", geo: { ...geo, "@type": "GeoCoordinates" }, address: [{ addressCountry: "US", addressLocality: city, addressRegion: "TX", postalCode: zip, streetAddress: street }] });
const miRecords = (name: string, street: string, city: string, zip: string, geo = { latitude: 29.52, longitude: -98.31 }) => [
  { "@context": "https://schema.org", "@type": "Organization", name: "M/I Homes", url: MI },
  { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] },
  { "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", name, telephone: "+12105550200", priceRange: "$289,990 - $412,990", geo: { "@type": "GeoCoordinates", ...geo }, address: { "@type": "PostalAddress", streetAddress: street, addressLocality: city, addressRegion: "TX", postalCode: zip, addressCountry: "US" } },
];

const site: Record<string, { status?: number; body: string; type?: string; location?: string }> = {
  [`${CH}/sitemap.xml`]: { body: xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${CH}/sitemap-communities.xml</loc></sitemap><sitemap><loc>${CH}/sitemap-homes.xml</loc></sitemap></sitemapindex>`), type: "application/xml" },
  [`${CH}/sitemap-communities.xml`]: { body: urlset([`${CH}/texas/san-antonio-new-homes/`, `${CH}/texas/san-antonio-new-homes/san-antonio/`, `${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes/`, `${CH}/texas/san-antonio-new-homes/boerne/esperanza-60's/`, `${CH}/texas/austin-new-homes/leander/elsewhere/`, `${CH}/texas/san-antonio-new-homes/schertz/no-record/`]), type: "application/xml" },
  [`${CH}/sitemap-homes.xml`]: { body: urlset([`${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes/brandon/`, `${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes/brandon/118-x/`]), type: "application/xml" },
  [`${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes/`]: { body: page([chesmarRecord("Sienna Lakes", "9010 Arroyo Grove", "San Antonio", "78263")]) },
  [`${CH}/texas/san-antonio-new-homes/boerne/esperanza-60's/`]: { body: page([chesmarRecord("Esperanza 60&#39;s", "218 Navarro", "Boerne", "78006", { latitude: "29.79", longitude: "-98.73" })]) },
  [`${CH}/texas/san-antonio-new-homes/schertz/no-record/`]: { body: "<html><body><h1>Coming soon</h1></body></html>" },
  [`${MI}/Sitemap/sitemap.xml`]: { body: urlset([`${MI}/new-homes/texas/greater-san-antonio/communities`, `${MI}/new-homes/texas/greater-san-antonio/quick-move-in-homes/some-home`, `${MI}/new-homes/texas/greater-san-antonio/converse/paloma-park`, `${MI}/new-homes/texas/greater-san-antonio/san-marcos/high-branch`, `${MI}/new-homes/texas/greater-san-antonio/converse/paloma-park/some-plan`]), type: "application/xml" },
  [`${MI}/new-homes/texas/greater-san-antonio/converse/paloma-park`]: { body: page(miRecords("Paloma Park", "10223 White Hart Lane", "Converse", "78109")) },
  [`${MI}/new-homes/texas/greater-san-antonio/san-marcos/high-branch`]: { body: page(miRecords("High Branch", "1 Branch Rd", "San Marcos", "78666", { latitude: 29.88, longitude: -97.94 })) },
  [`${DRH}/api/comms/direct/texas/san-antonio`]: { body: drhListing([["Fixture Ranch", "/texas/san-antonio/san-antonio/fixture-ranch"], ["Far Fixture", "/texas/san-antonio/kyle/far-fixture"], ["Market page", "/texas/san-antonio"]]), type: "application/json; charset=utf-8" },
  [`${DRH}/texas/san-antonio/san-antonio/fixture-ranch`]: { body: page(drhRecords("Fixture Ranch", "3702 Fixture Terrace", "San Antonio", "78222")) },
  // Kyle is about 55 miles out: the market listing reaches past the area we cover.
  [`${DRH}/texas/san-antonio/kyle/far-fixture`]: { body: page(drhRecords("Far Fixture", "1 Far Rd", "Kyle", "78640", { latitude: 29.99, longitude: -97.87 })) },
};

const requested: string[] = [];
const fetcher = vi.fn(async (input: string) => {
  requested.push(input);
  const entry = site[input];
  if (!entry) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  return new Response(entry.body, { status: entry.status ?? 200, headers: { "content-type": entry.type ?? "text/html", ...(entry.location ? { location: entry.location } : {}) } });
});

let db: FakeDealsDb;
beforeEach(() => {
  vi.clearAllMocks();
  requested.length = 0;
  mocks.onboardFailure = null;
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.refreshCommunityGeography.mockResolvedValue({ ok: false, reason: "test" });
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true });
});

describe("reading a builder's own records", () => {
  it("takes the community record, not the builder's or the breadcrumb, and reads its price range", () => {
    expect(communityRecordFromHtml(page(miRecords("Paloma Park", "10223 White Hart Lane", "Converse", "78109")))).toEqual({ name: "Paloma Park", street: "10223 White Hart Lane", city: "Converse", zip: "78109", phone: "+12105550200", priceFrom: 289_990, geo: { lat: 29.52, lng: -98.31 } });
    expect(communityRecordFromHtml(page([{ "@type": "Organization", name: "Builder", address: { streetAddress: "1 HQ", postalCode: "78000" } }]))).toBeNull();
    expect(communityRecordFromHtml(page([{ "@graph": [chesmarRecord("Graph Place", "1 Main", "Seguin", "78155")] }]))).toMatchObject({ name: "Graph Place", city: "Seguin", zip: "78155" });
    expect(communityRecordFromHtml(page([{ ...chesmarRecord("Far Place", "1 Main", "Dallas", "75001"), address: [{ addressRegion: "OK", postalCode: "73001", streetAddress: "x" }] }]))).toBeNull();
    expect(communityRecordFromHtml("<script type=\"application/ld+json\">{broken</script>")).toBeNull();
    // D.R. Horton: the plain-named LocalBusiness record wins over the page-title Place record, which lends its coordinates.
    expect(communityRecordFromHtml(page(drhRecords("Fixture Ranch", "3702 Fixture Terrace", "San Antonio", "78222")))).toEqual({ name: "Fixture Ranch", street: "3702 Fixture Terrace", city: "San Antonio", zip: "78222", phone: null, priceFrom: null, geo: { lat: 29.3778, lng: -98.3754 } });
    expect(drhListingPaths(drhListing([["A", "/texas/san-antonio/a/b"]]))).toEqual(["/texas/san-antonio/a/b"]);
    expect(drhListingPaths("<html>maintenance</html>")).toBeNull();
    expect(drhListingPaths("{\"MetaData\":{}}")).toBeNull();
    expect(priceFromRange("From $1,250,000")).toBe(1_250_000);
    expect(priceFromRange("$$")).toBeNull();
  });
});

describe("discovery", () => {
  it("finds a builder's San Antonio communities from its sitemap, one page at a time, and skips what is not one", async () => {
    const chesmar = await discoverBuilderCommunities(DISCOVERY_READERS[0]!, fetcher);
    expect(chesmar.ok).toBe(true);
    expect(chesmar.communities.map((community) => [community.name, community.city, community.zip, community.address])).toEqual([
      ["Sienna Lakes", "San Antonio", "78263", "9010 Arroyo Grove, San Antonio, TX 78263"],
      ["Esperanza 60's", "Boerne", "78006", "218 Navarro, Boerne, TX 78006"],
    ]);
    expect(chesmar.skipped).toEqual([{ url: `${CH}/texas/san-antonio-new-homes/schertz/no-record/`, reason: "no_community_record" }]);
    // Market and city index pages, plans, homes and other markets are never fetched as communities.
    expect(requested.some((url) => /austin|brandon|\/san-antonio\/$/.test(url))).toBe(false);

    const mi = await discoverBuilderCommunities(DISCOVERY_READERS[1]!, fetcher);
    expect(mi.communities.map((community) => community.name)).toEqual(["Paloma Park"]);
    // San Marcos is about 50 miles out: outside the area we cover.
    expect(mi.skipped).toEqual([{ url: `${MI}/new-homes/texas/greater-san-antonio/san-marcos/high-branch`, reason: "outside_area" }]);
    expect(mi.communities[0]).toMatchObject({ priceFrom: 289_990, salesPhone: "+12105550200" });

    // D.R. Horton lists its communities in a market listing, not a sitemap; the market page itself is not a community.
    const drh = await discoverBuilderCommunities(DISCOVERY_READERS[2]!, fetcher);
    expect(drh.ok).toBe(true);
    expect(drh.communities.map((community) => [community.name, community.city, community.zip, community.address])).toEqual([["Fixture Ranch", "San Antonio", "78222", "3702 Fixture Terrace, San Antonio, TX 78222"]]);
    expect(drh.skipped).toEqual([{ url: `${DRH}/texas/san-antonio/kyle/far-fixture`, reason: "outside_area" }]);
    expect(requested.filter((url) => url === `${DRH}/texas/san-antonio`)).toEqual([]);
  });

  it("adds new communities hidden, leaves the ones already there alone, and emails what it found", async () => {
    db.seed(dealCommunities, { builder: "Chesmar", privateName: "Sienna Lakes", sourceUrl: `${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes`, privateAddress: "9010 Arroyo Grove, San Antonio, TX 78263", publicLabel: "Southeast San Antonio | Half-Acre Lots and Lakes", areaLabel: "Southeast San Antonio", amenities: "[]", reelCode: "sl1", scrubList: "{}", active: true, paused: false, manualMode: false });
    const run = await runCommunityDiscovery(fetcher);
    expect(run).toMatchObject({ created: 3, builders: [{ builder: "Chesmar", ok: true, found: 2, created: 1, existing: 1 }, { builder: "M/I Homes", ok: true, found: 1, created: 1 }, { builder: "D.R. Horton", ok: true, found: 1, created: 1 }] });
    const added = db.rows(dealCommunities).filter((row) => row.awaitingFirstSync);
    expect(added.map((row) => [row.privateName, row.active, row.areaLabel])).toEqual([["Esperanza 60's", false, "Boerne"], ["Paloma Park", false, "Greater San Antonio"], ["Fixture Ranch", false, "Greater San Antonio"]]);
    // The exact coordinates on the builder's page are never stored.
    expect(JSON.stringify(db.rows(dealCommunities))).not.toMatch(/29\.79|98\.73|29\.52/);
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledTimes(1);
    const email = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { subject: string; content: string };
    expect(email.subject).toBe("Builder Deals: 3 new communities found");
    expect(email.content).toContain("Esperanza 60's (Chesmar)");
    expect(email.content).toContain("Paloma Park (M/I Homes)");
    expect(email.content).toContain("Fixture Ranch (D.R. Horton)");
    // Running again adds nothing and sends nothing.
    mocks.sendBuilderDealsEmail.mockClear();
    expect(await runCommunityDiscovery(fetcher)).toMatchObject({ created: 0 });
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();
  });

  it("adds nothing for a builder whose sitemap cannot be read, says so, and carries on with the rest", async () => {
    const broken = vi.fn(async (input: string) => input.startsWith(CH) ? new Response("<html>maintenance</html>", { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const run = await runCommunityDiscovery(broken);
    expect(run).toMatchObject({ created: 2, builders: [{ builder: "Chesmar", ok: false, reason: "sitemap_unreadable", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }, { builder: "D.R. Horton", ok: true, created: 1 }] });
    const email = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { content: string };
    expect(email.content).toContain("Could not read Chesmar's site list this time");
  });

  it("reads each builder under its lease, so a lane or Refresh now never reads the same site at the same time, and releases it after", async () => {
    const run = await runCommunityDiscovery(fetcher);
    expect(run).toMatchObject({ created: 4 });
    const leases = db.rows(dealJobRuns).filter((row) => row.jobName.startsWith("builder-deals-lane-"));
    expect(leases.map((row) => [row.jobName, row.status]).sort()).toEqual([["builder-deals-lane-Chesmar", "ok"], ["builder-deals-lane-D.R. Horton", "ok"], ["builder-deals-lane-M/I Homes", "ok"]]);
    // Leases were released: another holder gets them right away.
    const lease = await leaseBuilder("Chesmar");
    expect(lease).not.toBeNull();
    await lease!.release();
  });

  it("skips a builder whose lease stays busy and reports it, without waiting on the rest", async () => {
    const held = await leaseBuilder("Chesmar");
    expect(held).not.toBeNull();
    // The lease was taken a moment ago, so the wait (twenty minutes, advanced by the fake sleep) ends well inside its two-hour life.
    let clock = Date.now();
    const run = await runCommunityDiscovery(fetcher, { now: () => clock, sleep: async (ms) => { clock += ms; } });
    expect(run).toMatchObject({ created: 2, builders: [{ builder: "Chesmar", ok: false, reason: "builder_busy", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }, { builder: "D.R. Horton", ok: true, created: 1 }] });
    expect(requested.some((url) => url.startsWith(CH))).toBe(false);
    await held!.release();
  });

  it("reports a builder whose onboarding throws and still finishes the others and the email", async () => {
    mocks.onboardFailure = "Chesmar";
    const run = await runCommunityDiscovery(fetcher);
    expect(run).toMatchObject({ created: 2, builders: [{ builder: "Chesmar", ok: false, reason: "onboarding_failed", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }, { builder: "D.R. Horton", ok: true, created: 1 }] });
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledTimes(1);
    // The failed builder's lease was released despite the error.
    const lease = await leaseBuilder("Chesmar");
    expect(lease).not.toBeNull();
    await lease!.release();
    // The run row records the failure for Admin to see.
    expect(db.rows(dealJobRuns).find((row) => row.jobName === "builder-deals-discovery-run")).toMatchObject({ status: "failed" });
  });

  it("runs once across servers: a second start while a run is in flight is refused, and a dead run is taken over after three hours", async () => {
    const started = new Date();
    db.seed(dealJobRuns, { jobName: "builder-deals-discovery-run", chicagoDay: "run", status: "running", startedAt: started, detail: null, completedAt: null });
    expect(await runCommunityDiscovery(fetcher, { now: () => started.getTime() + 60_000 })).toEqual({ skipped: "already_running" });
    expect(requested).toEqual([]);
    const later = await runCommunityDiscovery(fetcher, { now: () => started.getTime() + 4 * 60 * 60_000 });
    expect(later).toMatchObject({ created: 4 });
    expect(db.rows(dealJobRuns).filter((row) => row.jobName === "builder-deals-discovery-run")).toHaveLength(1);
    expect(db.rows(dealJobRuns).find((row) => row.jobName === "builder-deals-discovery-run")).toMatchObject({ status: "ok" });
  });

  it("never follows a sitemap or page to another host", async () => {
    const offHost = vi.fn(async (input: string) => input === `${CH}/sitemap.xml`
      ? new Response(xml(`<sitemapindex><sitemap><loc>https://evil.example/sitemap.xml</loc></sitemap></sitemapindex>`), { status: 200, headers: { "content-type": "application/xml" } })
      : fetcher(input));
    const chesmar = await discoverBuilderCommunities(DISCOVERY_READERS[0]!, offHost);
    expect(chesmar).toMatchObject({ ok: false, reason: "sitemap_unreadable", communities: [] });
    expect(offHost.mock.calls.map(([url]) => url)).not.toContain("https://evil.example/sitemap.xml");
  });
});
