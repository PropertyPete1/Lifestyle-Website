import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { detailStatBlock, loadOfficialDeals, parseCommunityFacts, type CommunitySourceConfig } from "./dealsAdapters";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "deals");
export const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

/** Mirrors the synthetic fixture set (see server/fixtures/deals/README.md). */
export const MI_FIXTURE = {
  community: "https://www.mihomes.com/new-homes/texas/greater-san-antonio/southeast-san-antonio/fixture-gardens",
  guid: "11111111-2222-4333-8444-555555555555",
  incentive: "https://www.mihomes.com/new-homes/texas/greater-san-antonio/incentives/fall-into-savings-fixture",
  streets: ["8301 Fixture Street", "8305 Fixture Street", "8309 Fixture Street", "7702 Sample Basket", "7706 Sample Basket", "7710 Sample Basket", "8402 Placeholder Road", "8406 Placeholder Road"],
  plans: ["Fixture A", "Fixture B", "Fixture C"],
};
const slug = (value: string) => value.toLowerCase().replace(/\s+/g, "-");
export const miHomeUrl = (index: number) => `${MI_FIXTURE.community}/${slug(MI_FIXTURE.plans[index % 3])}-plan/${slug(MI_FIXTURE.streets[index])}`;
export const miPlanUrl = (index: number) => `${MI_FIXTURE.community}/${slug(MI_FIXTURE.plans[index])}-plan`;
const miEndpoint = (type: "homes" | "plans", offset: number) =>
  `https://www.mihomes.com/sitecore/api/ssc/MIHomes-Project-Website-Api-Controllers/PlansQmi/?id=${encodeURIComponent(`{${MI_FIXTURE.guid}}`)}&type=${type}&items=${offset}`;

/** Every M/I detail page is the captured-shaped home/plan fixture re-addressed for that record. */
export function miDocuments(options: { plans?: boolean } = {}): Record<string, string> {
  const homePage = fixture("mi-home-page.html");
  const planPage = fixture("mi-plan-page.html");
  const documents: Record<string, string> = {
    [MI_FIXTURE.community]: fixture("mi-community.html"),
    [miEndpoint("homes", 0)]: fixture("mi-plansqmi-homes-items-0.json"),
    [miEndpoint("homes", 5)]: fixture("mi-plansqmi-homes-items-5.json"),
    [miEndpoint("plans", 0)]: fixture(options.plans === false ? "mi-plansqmi-plans-items-0-empty.json" : "mi-plansqmi-plans-items-0.json"),
    [MI_FIXTURE.incentive]: fixture("mi-promotion-page.html"),
  };
  for (let index = 0; index < MI_FIXTURE.streets.length; index++) {
    documents[miHomeUrl(index)] = homePage
      .replaceAll(miHomeUrl(0), miHomeUrl(index))
      .replaceAll(slug(MI_FIXTURE.streets[0]), slug(MI_FIXTURE.streets[index]))
      .replaceAll(MI_FIXTURE.streets[0], MI_FIXTURE.streets[index]);
  }
  for (let index = 0; index < MI_FIXTURE.plans.length; index++) {
    documents[miPlanUrl(index)] = planPage
      .replaceAll(miPlanUrl(0), miPlanUrl(index))
      .replaceAll(slug(MI_FIXTURE.plans[0]), slug(MI_FIXTURE.plans[index]))
      .replaceAll(`${MI_FIXTURE.plans[0]} Plan`, `${MI_FIXTURE.plans[index]} Plan`);
  }
  return documents;
}

export const CHESMAR_FIXTURE = {
  community: "https://www.chesmar.com/texas/san-antonio-new-homes/san-antonio/fixture-lakes/",
  plans: ["sample-magnolia", "sample-cypress", "sample-live-oak"],
  qmi: "https://www.chesmar.com/texas/san-antonio-new-homes/san-antonio/fixture-lakes/sample-magnolia/100200-001/",
  model: "https://www.chesmar.com/texas/san-antonio-new-homes/san-antonio/fixture-lakes/sample-magnolia/100201-002/",
  secondQmi: "https://www.chesmar.com/texas/san-antonio-new-homes/san-antonio/fixture-lakes/sample-cypress/100300-001/",
  incentives: "https://www.chesmar.com/incentives/",
};

export function chesmarDocuments(): Record<string, string> {
  const planPage = fixture("chesmar-plan-page.html");
  const documents: Record<string, string> = {
    [CHESMAR_FIXTURE.community]: fixture("chesmar-community.html"),
    "https://www.chesmar.com/sitemap.xml": fixture("chesmar-sitemap-index.xml"),
    "https://www.chesmar.com/sitemap-pages.xml": fixture("chesmar-sitemap-pages.xml"),
    "https://www.chesmar.com/sitemap-homes.xml": fixture("chesmar-sitemap-homes.xml"),
    [`${CHESMAR_FIXTURE.community}sample-magnolia/`]: planPage,
    [`${CHESMAR_FIXTURE.community}sample-cypress/`]: planPage.replaceAll("Sample Magnolia", "Sample Cypress").replaceAll("sample-magnolia", "sample-cypress").replace("$410,000", "$455,000").replace("2,900 Sq. Ft.", "3,200 Sq. Ft."),
    [`${CHESMAR_FIXTURE.community}sample-live-oak/`]: planPage.replaceAll("Sample Magnolia", "Sample Live Oak").replaceAll("sample-magnolia", "sample-live-oak").replace("$410,000", "$499,990").replace("4 Beds", "5 Beds").replace("2,900 Sq. Ft.", "3,834 Sq. Ft."),
    [CHESMAR_FIXTURE.qmi]: fixture("chesmar-inventory-page.html"),
    [CHESMAR_FIXTURE.model]: fixture("chesmar-model-page.html"),
    [CHESMAR_FIXTURE.secondQmi]: fixture("chesmar-inventory-page.html").replaceAll("9012 Sample Grove", "9105 Sample Hollow").replaceAll("100200-001", "100300-001").replace("$425,000", "$468,500"),
    [CHESMAR_FIXTURE.incentives]: fixture("chesmar-incentives.html"),
  };
  return documents;
}

export function fixtureFetcher(documents: Record<string, string>) {
  return vi.fn(async (input: string) => {
    const body = documents[input];
    const type = input.endsWith(".xml") ? "application/xml" : /PlansQmi/.test(input) ? "application/json" : "text/html";
    return new Response(body ?? "not found", { status: body === undefined ? 404 : 200, headers: { "content-type": type } });
  });
}

const miConfig: CommunitySourceConfig = {
  builder: "M/I Homes",
  sourceUrl: MI_FIXTURE.community,
  privateCommunityName: "Fixture Gardens",
  scrubList: [],
  scrubConfig: { builder: ["M/I Homes", "M/I"], lender: ["M/I Financial, LLC", "M/I Financial"], community: ["Fixture Gardens"], plan: [], street: [], other: [] },
};

const chesmarConfig: CommunitySourceConfig = {
  builder: "Chesmar",
  sourceUrl: CHESMAR_FIXTURE.community,
  privateCommunityName: "Fixture Lakes",
  scrubList: [],
  scrubConfig: { builder: ["Chesmar Homes", "Chesmar"], lender: ["HomeAmerican Mortgage Corporation", "HomeAmerican"], community: ["Fixture Lakes"], plan: [], street: [], other: [] },
};

describe("M/I adapter on the captured-shaped fixtures", () => {
  it("enumerates PlansQmi items=0 and items=5 into eight unique homes, three plans, galleries and a publishable incentive", async () => {
    const fetcher = fixtureFetcher(miDocuments());
    const result = await loadOfficialDeals(miConfig, { fetcher });
    expect(result.catalogOk).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.private.homes.map((home) => home.sourceUrl)).toEqual(MI_FIXTURE.streets.map((_, index) => miHomeUrl(index)));
    const offsets = fetcher.mock.calls.map(([url]) => url).filter((url) => url.includes("type=homes")).map((url) => new URL(url).searchParams.get("items"));
    expect(offsets).toEqual(["0", "5"]);
    expect(result.private.plans.map((plan) => plan.sourceUrl)).toEqual([0, 1, 2].map(miPlanUrl));
    expect(result.private.homes[0]).toMatchObject({ status: "Available Now", readyNow: true, price: 399990, bedrooms: 3, bathrooms: 2, squareFeet: 1900, privatePlanName: "Fixture A", privateAddress: "8301 Fixture Street, San Antonio, TX 78263" });
    expect(result.private.homes[1]).toMatchObject({ status: "Quick Move-In", price: 409990, previousPrice: 429990 });
    expect(result.private.homes[7]).toMatchObject({ status: "Sold" });
    expect(result.private.homes.every((home) => home.gallery?.length === 3)).toBe(true);
    expect(result.private.plans.every((plan) => plan.gallery?.length === 2)).toBe(true);
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 354990, schoolDistrict: "Fixture County ISD", lotSizes: "Half-Acre Homesites" });
    expect(result.private.communityFacts?.amenities).toEqual(["Spacious homesites", "Access to Sample Lake", "Close to major roadways", "Fixture Gardens clubhouse"]);
    expect(result.private.incentive?.sourceUrl).toBe(MI_FIXTURE.incentive);
    expect(result.private.incentive?.facts).toMatchObject({
      rateKind: "promotional", promotionalRatePercent: 4.25, promotionalPeriod: "first-year", followOnRatePercent: 5.25, followOnPeriod: "years 2-30",
      aprPercent: 6.051, loanType: "FHA", repaymentTermYears: 30, downPaymentPercent: 3.5,
      contractDeadline: { isoDate: "2026-11-08" }, closingDeadline: { isoDate: "2026-11-30" }, publishable: true,
    });
    expect(result.public.incentive?.text).toContain("the builder's lender");
    const publicJson = JSON.stringify(result.public);
    for (const privateValue of ["Fixture Gardens", "Fixture Street", "Sample Basket", "Placeholder Road", "M/I", MI_FIXTURE.guid, "mihomes.com"]) expect(publicJson).not.toContain(privateValue);
    expect(result.private.discoveredScrubConfig?.plan).toEqual(expect.arrayContaining(["Fixture A", "Fixture B", "Fixture C"]));
    expect(result.private.discoveredScrubConfig?.street).toEqual(expect.arrayContaining(["Fixture Street", "Sample Basket", "Placeholder Road"]));
  });

  it("keeps a genuine zero-plan catalog successful", async () => {
    const result = await loadOfficialDeals(miConfig, { fetcher: fixtureFetcher(miDocuments({ plans: false })) });
    expect(result.catalogOk).toBe(true);
    expect(result.private.plans).toEqual([]);
    expect(result.private.homes).toHaveLength(8);
  });
});

describe("Chesmar adapter on the captured-shaped fixtures", () => {
  it("reads plans and homes from the h1 stat block, skips non-plan child pages and scopes galleries to the slider", async () => {
    const fetcher = fixtureFetcher(chesmarDocuments());
    const result = await loadOfficialDeals(chesmarConfig, { fetcher });
    expect(result.holdReasons).toEqual([]);
    expect(result.catalogOk).toBe(true);
    const requested = fetcher.mock.calls.map(([url]) => url);
    for (const child of ["site-map", "virtual-tour", "gallery"]) expect(requested.some((url) => url.includes(`fixture-lakes/${child}/`))).toBe(false);
    expect(result.private.plans.map((plan) => plan.sourceUrl).sort()).toEqual(CHESMAR_FIXTURE.plans.map((plan) => `${CHESMAR_FIXTURE.community}${plan}/`).sort());
    const magnolia = result.private.plans.find((plan) => plan.sourceUrl.endsWith("sample-magnolia/"));
    // The nav carries "From $499,990" and "3 - 5 Beds | 2 - 4 Baths | 2,340 to 3,834 Sq. Ft."; none of it may leak into the plan.
    expect(magnolia).toMatchObject({ privateName: "Sample Magnolia", status: null, price: 410000, bedrooms: 4, bathrooms: 3, squareFeet: 2900 });
    expect(magnolia?.gallery?.map((image) => image.sourceUrl)).toEqual([
      "https://www.chesmar.com/images/plans/sample-magnolia/exterior-1600x1067.jpg",
      "https://www.chesmar.com/images/plans/sample-magnolia/kitchen-1600x1067.jpg",
    ]);
    const qmi = result.private.homes.find((home) => home.sourceUrl === CHESMAR_FIXTURE.qmi);
    expect(qmi).toMatchObject({ privateName: "9012 Sample Grove", status: "Quick Move-In", price: 425000, bedrooms: 4, bathrooms: 3, squareFeet: 2920 });
    expect(qmi?.gallery?.map((image) => image.sourceUrl)).toEqual([
      "https://www.chesmar.com/images/homes/100200-001/front-1600x1067.jpg",
      "https://www.chesmar.com/images/homes/100200-001/kitchen-1600x1067.jpg",
    ]);
    const model = result.private.homes.find((home) => home.sourceUrl === CHESMAR_FIXTURE.model);
    expect(model).toMatchObject({ status: "Model For Tour", price: null });
    expect(result.private.communityFacts).toMatchObject({ fromPrice: 499990, schoolDistrict: "Fixture County ISD", lotSizes: "Half-acre lots" });
    expect(result.private.communityFacts?.amenities).toContain("Walking trails");
    expect(result.private.incentive?.facts).toMatchObject({ rateKind: "fixed", promotionalRatePercent: 4.999, aprPercent: 5.737, contractDeadline: { isoDate: "2026-10-18" }, closingDeadline: { isoDate: "2026-12-31" }, publishable: true });
    const publicJson = JSON.stringify(result.public);
    for (const privateValue of ["Fixture Lakes", "Sample Grove", "Sample Magnolia", "Chesmar", "HomeAmerican", "chesmar.com"]) expect(publicJson).not.toContain(privateValue);
  });

  it("holds the catalog when a whitelisted plan page loses its stat block or its gallery container", async () => {
    const withoutStats = chesmarDocuments();
    withoutStats[`${CHESMAR_FIXTURE.community}sample-cypress/`] = withoutStats[`${CHESMAR_FIXTURE.community}sample-cypress/`].replace(/<ul class="plan-hero__stats">[\s\S]*?<\/ul>/, "");
    const statsResult = await loadOfficialDeals(chesmarConfig, { fetcher: fixtureFetcher(withoutStats) });
    expect(statsResult.catalogOk).toBe(false);
    expect(statsResult.holdReasons).toEqual(["expected_detail_container_not_found"]);
    const withoutGallery = chesmarDocuments();
    withoutGallery[CHESMAR_FIXTURE.qmi] = withoutGallery[CHESMAR_FIXTURE.qmi].replace('class="swiper gallery"', 'class="content"').replace('class="home-gallery"', 'class="home-media"').replaceAll('class="swiper-slide"', 'class="frame"');
    const galleryResult = await loadOfficialDeals(chesmarConfig, { fetcher: fixtureFetcher(withoutGallery) });
    expect(galleryResult.catalogOk).toBe(false);
    expect(galleryResult.holdReasons).toEqual(["expected_detail_container_not_found"]);
  });

  it("holds when an inventory exceeds the safety cap instead of truncating it", async () => {
    const documents = chesmarDocuments();
    const extra = Array.from({ length: 70 }, (_, index) => `<url><loc>${CHESMAR_FIXTURE.community}sample-magnolia/${200000 + index}-001/</loc></url>`).join("");
    documents["https://www.chesmar.com/sitemap-homes.xml"] = documents["https://www.chesmar.com/sitemap-homes.xml"].replace("</urlset>", `${extra}</urlset>`);
    const result = await loadOfficialDeals(chesmarConfig, { fetcher: fixtureFetcher(documents) });
    expect(result.catalogOk).toBe(false);
    expect(result.holdReasons).toEqual(["incomplete_inventory"]);
  });

  it("does not take nav or footer text as a detail stat block", () => {
    expect(detailStatBlock('<nav>From $499,990 · 3 - 5 Beds | 2 - 4 Baths</nav><h1>Plan</h1><footer>4 Beds 3 Baths 2,000 Sq. Ft.</footer>')).toBeNull();
    const stats = detailStatBlock('<nav>Quick Move-In Homes 5 Beds 4 Baths 2,340 Sq. Ft.</nav><main><h1>Plan</h1><p>Starting From $410,000</p><ul><li>4 Beds</li><li>3 Baths</li><li>2,900 Sq. Ft.</li></ul></main>');
    expect(stats?.block).toBe("4 Beds 3 Baths 2,900 Sq. Ft.");
    expect(stats?.region).toContain("$410,000");
    expect(parseCommunityFacts('<p>Priced from $354,990</p><p>Northside ISD</p><ul class="amenities"><li>Pool</li><li>Trails</li></ul>')).toEqual({ fromPrice: 354990, schoolDistrict: "Northside ISD", lotSizes: null, amenities: ["Pool", "Trails"] });
    // A lot size needs a lot word next to it: a park's acreage is never a lot size.
    expect(parseCommunityFacts("<p>Walk to a one-acre dog park and 15 acres of trails.</p>").lotSizes).toBeNull();
    expect(parseCommunityFacts("<p>Homesites from 0.25 to 0.5 acres with a one-acre dog park.</p>").lotSizes).toBe("Homesites from 0.25 to 0.5 acres");
    expect(parseCommunityFacts("<p>Quarter-acre lots</p>").lotSizes).toBe("Quarter-acre lots");
  });
});
