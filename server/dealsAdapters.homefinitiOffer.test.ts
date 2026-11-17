import { describe, expect, it, vi } from "vitest";
import { HomefinitiAdapter, homefinitiBanner, homefinitiEventMarkets, readHomefinitiEventPage, scheduledBuydownFacts } from "./dealsAdapters.homefiniti";
import { builderScrubConfig, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Nov 16, 2026 (Peter: an agent found Coventry's 2.99% offer on the builder's site and it was not on ours; "we need to
 * be able to read every banner as that is the headline info per community"). Pages in the shape coventryhomes.com
 * served that day: the banner on every page, the hub it links to, and each market's sales-event page with its homes
 * and its footnote. The footnote and banner wording are the builder's; names and addresses are invented.
 */
const HOST = "www.coventryhomes.com";
const SITE = `https://${HOST}`;
const COMMUNITY = `${SITE}/new-homes/tx/san-antonio/fixture-grove/`;
const OTHER = `${SITE}/new-homes/tx/cibolo/fixture-crossing/`;

const BANNER = `<div class="promo-nav promo-text p-md-3 p-2 d-block banner-red no-print"><div class="d-flex justify-content-center align-items-center">
  <span class="d-inline-block h4 f-headline-bold text-uppercase ls-1 mb-md-0"><p>Interest Rates Starting at 2.99% (5.959% APR)*</p></span>
  <a href="/sales-event/" role="button" class="dynamic-sales-event-link btn btn-secondary ms-lg-4 oi-incentive-view sales-event-promo-cta">Details</a></div>
  <div class="disclaimer text-center m-0">When Financing Through Jet HomeLoans, LP SM (&ldquo;Jet&rdquo;) NMLS ID# 1660135. See Sales Event Page for Full Details.</div></div>`;
const LICENSING = "©Jet HomeLoans, LP SM. NMLS#1660135. 7200 N MoPac Expy, Ste 400, Austin, TX 78731 | 833-270-7191. TX Mortgage Banker Registration; NMLS #1660135. Equal Housing Lender. Jet is an affiliate of Dream Finders Homes. Coventry Homes is a Dream Finders Homes company. This is not a commitment to lend. TX consumers: For complaint/recovery fund info, visit www.sml.texas.gov or call TX Dept of Savings ";
const SAN_ANTONIO_TERMS = "*FHA Scenario is an estimate and is based on primary residences only, 640 FICO score and a 2/1 buydown on a $400,000 purchase price with an FHA 30-year agreement (360 months) fixed rate loan amount of $392,755 at 96.5% LTV. Year 1 (0-12 months) rate at 2.99%, APR of 5.959%, and monthly payment of $1,829; Year 2 (13-24 months) rate at 3.99%, APR of 5.959%, and monthly payment of $2,048; Years 3-30 (25-360 months) rate at 4.99%, APR of 5.959%, and monthly payment of $2,282. Monthly payments include principal, interest, and mortgage insurance. Example payment does not include property taxes, homeowners’ insurance, HOA or CDD (if applicable) and payment obligation may be greater. **4.99% rate is based on a builder paid forward commitment to buydown the market rate. The forward commitment is offered on government loans for primary residences only. See your builder representative for further details on expiration terms and available homesites. Offers and incentives require financing with Jet, however borrower does not have to utilize this affiliate for financing to purchase a home from the builder. Offer valid for select homesites on loans closed on or before December 31, 2026.";
const HOUSTON_TERMS = "*Rate shown is an adjustable rate for the fixed period. The 3.99% rate shown is based on a builder paid forward commitment to buydown the market rate. Only available in select communities on select inventory for contracts written and closed by December 31, 2026";

const ld = (record: unknown) => `<script type="application/ld+json">${JSON.stringify(record)}</script>`;
const home = (base: string, plan: string, slug: string, street: string, price: number) => ld({
  "@context": "https://schema.org", "@type": ["Product", "SingleFamilyResidence"], name: street,
  address: { "@type": "PostalAddress", addressLocality: "San Antonio", addressRegion: "TX", postalCode: "78222", streetAddress: street },
  image: ["https://media.coventryhomes.com/434/2026/10/27/front_1.jpg"], model: `${base}${plan}/`, numberOfBedrooms: 4, numberOfFullBathrooms: 3, numberOfPartialBathrooms: 0, floorSize: { "@type": "QuantitativeValue", value: 2533 },
  offers: { "@type": "Offer", price: `${price}.00`, priceCurrency: "USD", url: `${base}${plan}/${slug}/` }, url: `${base}${plan}/${slug}/`,
});
const card = (path: string, price: number) => `<article class="card-spec card d-flex flex-column h-100 oi-map-item" data-price="${price}"><div class="position-relative"><div class="swiper"><a href="${path}" class="oi-aspect d-block"><img src="https://media.coventryhomes.com/434/x.jpg" alt="a home"></a></div><div class="badge-status-2"><p class="status mb-0">Move-In Ready</p></div></div><div class="card-body"><a href="${path}"><p class="fs-4 mb-0">$${price.toLocaleString("en-US")}</p></a></div></article>`;
const communityPage = (url: string, name: string, slug: string, street: string, banner = BANNER) => `<!DOCTYPE html><html><head><title>${name}</title>
${ld({ "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", name, url, address: { "@type": "PostalAddress", postalCode: "78222", addressRegion: "TX", streetAddress: "1 Fixture Gate", addressLocality: "San Antonio" } })}
${home(url, "howard", slug, street, 364_999)}</head><body>${banner}<main><h1>${name}</h1><div class="row">${card(new URL(`${url}howard/${slug}/`).pathname, 364_999)}</div></main></body></html>`;
const eventPage = (terms: string, cards: string[]) => `<!DOCTYPE html><html><body>${BANNER}<main><section class="homes">${cards.join("")}</section>
<section class="sales-event-disclaimer py-lg-6 py-5 bg-gray-300"><div class="container"><div class="row"><div class="col-12 fs-12"><div>${LICENSING}${terms}</div></div></div></div></section></main></body></html>`;
const HUB = `<!DOCTYPE html><html><body>${BANNER}<main><a href="/houston/sales-event-listing/">Houston</a><a href="/san-antonio/sales-event-listing/">San Antonio</a><a href="https://evil.example/x/sales-event-listing/">x</a></main></body></html>`;

function site(overrides: Record<string, string | null> = {}) {
  const pages: Record<string, string | null> = {
    [COMMUNITY]: communityPage(COMMUNITY, "Fixture Grove", "8328-fixture-view", "8328 Fixture View"),
    [OTHER]: communityPage(OTHER, "Fixture Crossing", "520-fixture-park", "520 Fixture Park"),
    [`${SITE}/sales-event/`]: HUB,
    [`${SITE}/houston/sales-event-listing/`]: eventPage(HOUSTON_TERMS, [card("/new-homes/tx/houston/somewhere/plan/1-main/", 300_000)]),
    [`${SITE}/san-antonio/sales-event-listing/`]: eventPage(SAN_ANTONIO_TERMS, [card("/new-homes/tx/san-antonio/fixture-grove/howard/8328-fixture-view/", 364_999)]),
    ...overrides,
  };
  const requested: string[] = [];
  const fetcher = vi.fn(async (input: string) => {
    requested.push(input);
    const body = pages[input];
    return body ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  });
  return { fetcher, requested };
}
const config = (sourceUrl: string, name: string, street: string): CommunitySourceConfig => ({ builder: "Coventry Homes", sourceUrl, privateCommunityName: name, scrubList: [name, street], scrubConfig: { ...builderScrubConfig("Coventry Homes"), community: [name], street: [street] } });

describe("Homefiniti reader: the banner's offer", () => {
  it("reads the banner, the hub's market pages and a market page's homes and terms", () => {
    expect(homefinitiBanner(BANNER, HOST)).toEqual({ headline: "Interest Rates Starting at 2.99% (5.959% APR)*", eventUrl: `${SITE}/sales-event/` });
    expect(homefinitiBanner("<main>no banner</main>", HOST)).toBeNull();
    expect(homefinitiEventMarkets(HUB, HOST)).toEqual([`${SITE}/houston/sales-event-listing/`, `${SITE}/san-antonio/sales-event-listing/`]);
    const page = readHomefinitiEventPage(eventPage(SAN_ANTONIO_TERMS, [card("/new-homes/tx/san-antonio/fixture-grove/howard/8328-fixture-view/", 364_999)]), HOST)!;
    expect(Array.from(page.homePaths)).toEqual(["/new-homes/tx/san-antonio/fixture-grove/howard/8328-fixture-view"]);
    // The lender's licensing block (name, NMLS id, phone) is not offer text.
    expect(page.terms.startsWith("*FHA Scenario")).toBe(true);
    expect(page.terms).not.toMatch(/NMLS|833-270|MoPac/);
  });

  it("states a 2/1 buydown as it is: 2.99% the first year, 4.99% for years 3-30, never a fixed 2.99%", () => {
    const facts = scheduledBuydownFacts(`Interest Rates Starting at 2.99% (5.959% APR)* ${SAN_ANTONIO_TERMS}`);
    expect(facts).toMatchObject({
      rateKind: "promotional", promotionalRatePercent: 2.99, promotionalPeriod: "Year 1", followOnRatePercent: 4.99, followOnPeriod: "Years 3-30",
      aprPercent: 5.959, loanType: "FHA", repaymentTermYears: 30, downPaymentPercent: 3.5, closingDeadline: { isoDate: "2026-12-31" }, holdReasons: [], publishable: true,
    });
    // A schedule that does not agree with itself, or wording in any other form, is left held for a person.
    expect(scheduledBuydownFacts(`Interest Rates Starting at 2.99% (5.959% APR)* ${SAN_ANTONIO_TERMS.replace("Years 3-30 (25-360 months) rate at 4.99%, APR of 5.959%", "Years 3-30 (25-360 months) rate at 4.99%, APR of 6.2%")}`).publishable).toBe(false);
    expect(scheduledBuydownFacts(`Interest Rates Starting at 3.25% (5.959% APR)* ${SAN_ANTONIO_TERMS}`).publishable).toBe(false);
    expect(scheduledBuydownFacts(`Interest Rates Starting at 2.99% (5.959% APR)* ${SAN_ANTONIO_TERMS.replace(" on loans closed on or before December 31, 2026", "")}`).publishable).toBe(false);
    expect(scheduledBuydownFacts(`Interest Rates Starting at 2.99% (5.959% APR)* ${HOUSTON_TERMS}`).publishable).toBe(false);
  });

  it("gives a community the offer of the market page that lists one of its homes, with no builder or lender name in the buyer's text", async () => {
    const { fetcher, requested } = site();
    const result = await new HomefinitiAdapter("Coventry Homes").load(config(COMMUNITY, "Fixture Grove", "Fixture View"), { fetcher: fetcher as never });
    expect(result.ok).toBe(true);
    expect(result.incentiveHoldReasons).toEqual([]);
    expect(result.private.offerRead).toBe(true);
    expect(result.private.incentive?.sourceUrl).toBe(`${SITE}/san-antonio/sales-event-listing/`);
    const offer = result.public.incentive!;
    expect(offer).toMatchObject({ promotionalRatePercent: 2.99, followOnRatePercent: 4.99, followOnPeriod: "Years 3-30", aprPercent: 5.959, loanType: "FHA", repaymentTermYears: 30, downPaymentPercent: 3.5 });
    expect(offer.text).toContain("Interest Rates Starting at 2.99% (5.959% APR)");
    expect(offer.text).toContain("Years 3-30 (25-360 months) rate at 4.99%");
    expect(offer.text).toContain("require financing with the builder's lender");
    expect(offer.text).not.toMatch(/\bJet\b|Coventry|Dream Finders|NMLS/);
    expect(requested).toContain(`${SITE}/sales-event/`);
  });

  it("gives no offer to a community with no home on any market's list, and reads the event pages once for both", async () => {
    const { fetcher, requested } = site();
    const adapter = new HomefinitiAdapter("Coventry Homes");
    await adapter.load(config(COMMUNITY, "Fixture Grove", "Fixture View"), { fetcher: fetcher as never });
    const other = await adapter.load(config(OTHER, "Fixture Crossing", "Fixture Park"), { fetcher: fetcher as never });
    expect(other.ok).toBe(true);
    expect(other.private.incentive).toBeNull();
    // Read, and none found: the sync may take a stale offer down.
    expect(other.private.offerRead).toBe(true);
    expect(requested.filter((url) => url.includes("sales-event"))).toHaveLength(3);
  });

  it("holds the offer, never the homes, when the event pages cannot be read; no banner means no offer", async () => {
    const down = site({ [`${SITE}/sales-event/`]: null });
    const held = await new HomefinitiAdapter("Coventry Homes").load(config(COMMUNITY, "Fixture Grove", "Fixture View"), { fetcher: down.fetcher as never });
    expect(held.catalogOk).toBe(true);
    expect(held.public.homes).toHaveLength(1);
    expect(held.incentiveHoldReasons).toEqual(["incentive_fetch_failed"]);
    expect(held.private.offerRead).toBeUndefined();
    const bare = site({ [COMMUNITY]: communityPage(COMMUNITY, "Fixture Grove", "8328-fixture-view", "8328 Fixture View", "") });
    const none = await new HomefinitiAdapter("Coventry Homes").load(config(COMMUNITY, "Fixture Grove", "Fixture View"), { fetcher: bare.fetcher as never });
    expect(none.private.incentive).toBeNull();
    expect(none.private.offerRead).toBe(true);
    expect(bare.requested.some((url) => url.includes("sales-event"))).toBe(false);
  });
});
