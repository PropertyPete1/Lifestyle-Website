import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Discovery from builders' own sitemaps and schema.org records. Synthetic
 * pages that follow the shapes the two live sites use (October 2026): Chesmar
 * serves a sitemap index and a LocalBusiness record with an address array; M/I
 * serves one URL set and a HomeAndConstructionBusiness record next to its
 * Organization and breadcrumb records.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), refreshCommunityGeography: vi.fn(), sendBuilderDealsEmail: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsMap", () => ({ refreshCommunityGeography: (...args: unknown[]) => mocks.refreshCommunityGeography(...args), communityAreaMap: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));

import { DISCOVERY_READERS, communityRecordFromHtml, discoverBuilderCommunities, priceFromRange, runCommunityDiscovery } from "./dealsDiscovery";

const CH = "https://www.chesmar.com";
const MI = "https://www.mihomes.com";
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
  });

  it("adds new communities hidden, leaves the ones already there alone, and emails what it found", async () => {
    db.seed(dealCommunities, { builder: "Chesmar", privateName: "Sienna Lakes", sourceUrl: `${CH}/texas/san-antonio-new-homes/san-antonio/sienna-lakes`, privateAddress: "9010 Arroyo Grove, San Antonio, TX 78263", publicLabel: "Southeast San Antonio | Half-Acre Lots and Lakes", areaLabel: "Southeast San Antonio", amenities: "[]", reelCode: "sl1", scrubList: "{}", active: true, paused: false, manualMode: false });
    const run = await runCommunityDiscovery(fetcher);
    expect(run).toMatchObject({ created: 2, builders: [{ builder: "Chesmar", ok: true, found: 2, created: 1, existing: 1 }, { builder: "M/I Homes", ok: true, found: 1, created: 1 }] });
    const added = db.rows(dealCommunities).filter((row) => row.awaitingFirstSync);
    expect(added.map((row) => [row.privateName, row.active, row.areaLabel])).toEqual([["Esperanza 60's", false, "Boerne"], ["Paloma Park", false, "Greater San Antonio"]]);
    // The exact coordinates on the builder's page are never stored.
    expect(JSON.stringify(db.rows(dealCommunities))).not.toMatch(/29\.79|98\.73|29\.52/);
    expect(mocks.sendBuilderDealsEmail).toHaveBeenCalledTimes(1);
    const email = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { subject: string; content: string };
    expect(email.subject).toBe("Builder Deals: 2 new communities found");
    expect(email.content).toContain("Esperanza 60's (Chesmar)");
    expect(email.content).toContain("Paloma Park (M/I Homes)");
    // Running again adds nothing and sends nothing.
    mocks.sendBuilderDealsEmail.mockClear();
    expect(await runCommunityDiscovery(fetcher)).toMatchObject({ created: 0 });
    expect(mocks.sendBuilderDealsEmail).not.toHaveBeenCalled();
  });

  it("adds nothing for a builder whose sitemap cannot be read, says so, and carries on with the rest", async () => {
    const broken = vi.fn(async (input: string) => input.startsWith(CH) ? new Response("<html>maintenance</html>", { status: 200, headers: { "content-type": "text/html" } }) : fetcher(input));
    const run = await runCommunityDiscovery(broken);
    expect(run).toMatchObject({ created: 1, builders: [{ builder: "Chesmar", ok: false, reason: "sitemap_unreadable", created: 0 }, { builder: "M/I Homes", ok: true, created: 1 }] });
    const email = mocks.sendBuilderDealsEmail.mock.calls[0]![0] as { content: string };
    expect(email.content).toContain("Could not read Chesmar's site list this time");
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
