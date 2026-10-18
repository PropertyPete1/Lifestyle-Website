import { describe, expect, it, vi } from "vitest";

import {
  DEAL_ADAPTERS,
  loadOfficialDeals,
  normalizeIncentiveText,
  parsePromotionalRate,
  toPublicSafeText,
  type CommunitySourceConfig,
} from "./dealsAdapters";

const config: CommunitySourceConfig = {
  builder: "Manual",
  sourceUrl: "https://review.example.test/community",
  privateCommunityName: "Secret Grove",
  scrubList: ["Secret Grove", "Hidden Plan", "M/I Homes"],
};

const completeIncentive = `
  Fall in love with Secret Grove. Quick Move-In homes receive a 1/0 buydown
  on a 30-year fixed FHA loan. Year 1: 4.25% Rate / 6.051% APR.
  Year 2-30: 5.25% Rate / 6.051% APR. A 3.5% down payment is required.
  Valid on FULL PRICED CONTRACTS written between 10/12/2026 to 11/8/2026.
  Buyer must close by 11/30/2026.
`;

const chesmarIncentivesUrl = "https://www.chesmar.com/incentives/";
const chesmarIncentiveHtml = `
  <nav>HomeAmerican Mortgage Corporation</nav><h1>Imagine Happier Bonus</h1>
  <p><strong>4.999% (5.737% APR) FHA 30-year, fixed-rate financing on select homes that close by 12/31/26*</strong></p>
  <em>Available 10/1/26 through 10/18/26 with financing provided by HomeAmerican Mortgage Corporation</em>
  <section><small><em>*Loan promotions are valid for buyers who sign purchase agreements on select homes
  with Chesmar Homes between October 1, 2026, and October 18, 2026, inclusive, and close on or before
  December 31, 2026, when financing is provided by HomeAmerican Mortgage Corporation.
  Interest rate is not guaranteed and is subject to change without notice. Funds are limited and are
  available on a first-come, first-served basis. Example is based on a sales price of $555,000 and a
  30-year, fixed-rate FHA loan with an interest rate of 4.999% and a 3.50% down payment. Total loan
  amount, including the upfront mortgage insurance premium, is $544,947. Monthly principal and
  interest payment = $2,925.06. APR = 5.737%. Taxes, hazard insurance and monthly mortgage insurance
  premiums are not calculated in the above payment; actual payment will be higher. This interest rate
  is available to owner occupants only, subject to a maximum 96.5% loan-to-value ratio and a minimum
  FICO score of 680. Loan amount cannot exceed the lesser of the county limit or $832,750. Not valid
  on loans already locked with HomeAmerican Mortgage Corporation.<br><br>
  **Loan promotions: a 30-year, fixed-rate conventional loan at 5.375%, APR = 5.508%, 10.00% down payment.<br><br>
  ***Loan promotions: a 30-year, fixed-rate VA loan at 4.999%, APR = 5.287%, no down payment.<br><br>
  HomeAmerican Mortgage Corporation licensing information and Chesmar Homes affiliation.</em></small></section>
`;

const miCommunityUrl = "https://www.mihomes.com/new-homes/texas/example/secret-grove";
const miGuid = "ae41fce7-a685-420b-b820-bc97b1c482f9";
const miHomeUrl = (index: number) => `${miCommunityUrl}/hidden-plan/${8300 + index}-private-street`;
const miImageUrl = (index: number, image = 0) => `https://dam.mihomes.com/media/${index + 1}/${image}.jpeg`;
const miEndpointUrl = (type: "homes" | "plans", offset: number) =>
  `https://www.mihomes.com/sitecore/api/ssc/MIHomes-Project-Website-Api-Controllers/PlansQmi/?id=${encodeURIComponent(`{${miGuid}}`)}&type=${type}&items=${offset}`;
const miCommunityHtml = `
  <div data-guid="11111111-1111-1111-1111-111111111111"></div>
  <DIV data-name='Secret Grove' DATA-GUID='%7B${miGuid.toUpperCase()}%7D' id=pqmb></DIV>
  <h2 id="product-homes-list">The home plan that's right for you</h2>
  <a href="${miHomeUrl(14)}">Only server-rendered home link</a>
`;

function miCard(index: number, plan = false): string {
  const product = {
    "@context": "https://schema.org",
    "@type": plan ? "ProductModel" : "Product",
    name: plan ? `Hidden Plan ${index}` : `${8300 + index} Private Street`,
    url: plan ? `${miCommunityUrl}/hidden-${index}-plan` : miHomeUrl(index),
    image: [miImageUrl(index)],
    offers: { price: "399000.00", availability: "https://schema.org/InStock" },
    geo: { latitude: 29.345, longitude: -98.33 },
    numberOfBedrooms: { value: 5 },
    numberOfFullBathrooms: { value: 4 },
    numberOfPartialBathrooms: { value: 1 },
    floorSize: { value: 4099, unitCode: "FTK" },
  };
  const meta = (label: string, value: string) => `<p class='home-card-meta-item'>${label}<span class="home-card-meta-value"><span>${value}</span></span></p>`;
  return `<div class="col"><div data-test='nested > card' class='home-card ${plan ? "home-card--plans" : "home-card--inventory"}'>
    <script type='application/ld+json'>${JSON.stringify(product)}</script>
    <div class="home-card-header"><div><ul class="home-card__flags"><li>${index === 0 ? "READY NOW" : ""}</li></ul></div></div>
    <div class="home-card-bottom"><div class="home-card-info">
      <p class='home-card-name'>${product.name}, San Antonio, TX</p>
      <span class="home-card-price home-card-price-old"><span>$420,000</span></span>
      <span class="home-card-price home-card-price-new"><span>$400,000</span></span>
    </div><div class="home-card-meta">
      ${meta("Plan", `Hidden &amp; Plan ${index} - C`)}
      ${meta("Estimated Move in Date", index === 0 ? "Ready Now" : "March 21, 2027")}
      ${meta("Bed", "5")}${meta("Bath", "4.5")}${meta("Garage", "3")}
      ${meta("Sq Ft", "4,099")}${meta("Homesite", `54${index.toString().padStart(2, "0")}`)}
    </div></div></div></div>`;
}

function miDetail(index: number): string {
  return `<h1>${8300 + index} Private Street</h1><script type="application/ld+json">not valid JSON</script>
    <script type='application/ld+json'>${JSON.stringify({
      "@type": "Product", url: miHomeUrl(index), image: [miImageUrl(index), miImageUrl(index, 1), miImageUrl(index, 2)],
    })}</script>
    <div class="gallery-modal" id="simple-gallery-modal"><ul>
      <li data-caption="Kitchen &amp; Dining > Living" data-count="<strong>1</strong>" class="gallery-slide-container">
        <div><img width=2560 height='1703' src='${miImageUrl(index)}'
        srcset='${miImageUrl(index)} 1800w, ${miImageUrl(index, 1)} 2400w' alt="Kitchen"></div>
      </li><li class="gallery-slide-container"><img src='${miImageUrl(index)}' alt='Kitchen &amp; Dining > Living' width=2560 height=1703></li>
    </ul></div><img src="https://untrusted.example/tracker.png"><img src="https://dam.mihomes.com/navigation-logo.jpeg">`;
}

function fixtureFetcher(documents: Record<string, string>) {
  return vi.fn(async (input: string) => {
    const body = documents[input];
    return new Response(body ?? "not found", { status: body === undefined ? 404 : 200 });
  });
}

function miDocuments(total = 15): Record<string, string> {
  const documents: Record<string, string> = {
    [miCommunityUrl]: miCommunityHtml,
    [miEndpointUrl("plans", 0)]: JSON.stringify({ TotalItems: 0, Html: '<div class="row"></div>' }),
  };
  for (let offset = 0; offset < total || offset === 0; offset = offset === 0 ? 5 : offset + 3) {
    const end = Math.min(total, offset + (offset === 0 ? 5 : 3));
    const cards = Array.from({ length: end - offset }, (_, i) => miCard(offset + i));
    if (offset > 0) cards.unshift(miCard(0)); // Page overlap must not count as another home.
    documents[miEndpointUrl("homes", offset)] = JSON.stringify({ TotalItems: total, Html: `<div class="row">${cards.join("")}</div>` });
  }
  for (let i = 0; i < total; i++) documents[miHomeUrl(i)] = miDetail(i);
  return documents;
}

describe("deals adapters", () => {
  it("registers the required generic builder adapters", () => {
    expect(Object.keys(DEAL_ADAPTERS).sort()).toEqual(["Chesmar", "M/I Homes", "Manual"]);
  });

  it("normalizes and extracts only fully disclosed promotional-rate facts", () => {
    expect(normalizeIncentiveText("  Rate*** /  APR*  ")).toBe("Rate / APR");

    const facts = parsePromotionalRate(completeIncentive);
    expect(facts).toMatchObject({
      promotionalRatePercent: 4.25,
      promotionalPeriod: "Year 1",
      followOnRatePercent: 5.25,
      followOnPeriod: "Year 2-30",
      aprPercent: 6.051,
      loanType: "FHA",
      repaymentTermYears: 30,
      downPaymentPercent: 3.5,
      contractDeadline: { raw: "11/8/2026", isoDate: "2026-11-08" },
      closingDeadline: { raw: "11/30/2026", isoDate: "2026-11-30" },
      publishable: true,
    });
    expect(facts.holdReasons).toEqual([]);
  });

  it("holds promotional rates when a required disclosure is unavailable", () => {
    const facts = parsePromotionalRate("First year: 4.25% Rate / 6.051% APR on an FHA loan.");
    expect(facts.publishable).toBe(false);
    expect(facts.holdReasons).toContain("missing_repayment_term");
    expect(facts.holdReasons).toContain("missing_follow_on_rate");
    expect(facts.holdReasons).toContain("missing_down_payment");
    expect(facts.holdReasons).toContain("missing_contract_deadline");
    expect(facts.holdReasons).toContain("missing_closing_deadline");
  });

  it("uses the shared scrubber and refuses output when a short private term cannot safely be scrubbed", () => {
    expect(toPublicSafeText("Secret Grove offers Hidden Plan.", config)).toBe("this community offers this community.");
    expect(toPublicSafeText("AUX is private", { ...config, scrubList: ["AUX"] })).toBeNull();
  });

  it("keeps private URLs and names out of Manual public DTOs", async () => {
    const result = await loadOfficialDeals({
      ...config,
      manualEntries: [{ kind: "plan", privateName: "Hidden Plan", price: 400_000, status: "Now Selling" }],
    });

    expect(result.ok).toBe(true);
    expect(result.private.sourceUrl).toContain("review.example.test");
    expect(result.private.plans[0]?.privateName).toBe("Hidden Plan");
    expect(result.public).toEqual({
      plans: [{ status: "Now Selling", price: 400_000, bedrooms: null, bathrooms: null, squareFeet: null }],
      homes: [],
      incentive: null,
      holdReasons: [],
    });
    expect(JSON.stringify(result.public)).not.toContain("Hidden Plan");
    expect(JSON.stringify(result.public)).not.toContain("review.example.test");
    expect(JSON.stringify(result.public)).not.toContain("Secret Grove");
  });

  it("discovers Chesmar plan and specific-home URLs only from official sitemaps and redacts their names", async () => {
    const communityUrl = "https://www.chesmar.com/texas/example/secret-grove/";
    const planUrl = `${communityUrl}hidden-plan/`;
    const homeUrl = `${planUrl}123456-0001/`;
    const documents: Record<string, string> = {
      [communityUrl]: '<section id="floorplans"><div class="search-results-container">FloorPlans</div></section>',
      "https://www.chesmar.com/sitemap5.xml": `<urlset><url><loc>${planUrl}</loc></url></urlset>`,
      "https://www.chesmar.com/sitemap6.xml": `<urlset><url><loc>${homeUrl}</loc></url></urlset>`,
      [planUrl]: "<h1>Hidden Plan</h1><p>Starting From $410,000 · 4 Beds · 3 Baths · 2,300 Sq. Ft.</p>",
      [homeUrl]: "<h1>1234 Private Address</h1><p>Quick Move-In · $425,000 · 4 Beds · 3 Baths · 2,320 Sq. Ft.</p>",
      [chesmarIncentivesUrl]: chesmarIncentiveHtml,
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const key = typeof input === "string" ? input : input.toString();
      const body = documents[key];
      return new Response(body ?? "not found", { status: body ? 200 : 404 });
    });

    const result = await loadOfficialDeals(
      {
        builder: "Chesmar",
        sourceUrl: communityUrl,
        privateCommunityName: "Secret Grove",
        scrubList: ["Secret Grove", "Hidden Plan", "1234 Private Address"],
      },
      { fetcher },
    );

    expect(result.ok).toBe(true);
    expect(result.private.plans[0]?.sourceUrl).toBe(planUrl);
    expect(result.private.homes[0]?.sourceUrl).toBe(homeUrl);
    expect(result.public.plans).toEqual([{ status: null, price: 410_000, bedrooms: 4, bathrooms: 3, squareFeet: 2300 }]);
    expect(result.public.homes).toEqual([{ status: "Quick Move-In", price: 425_000, bedrooms: 4, bathrooms: 3, squareFeet: 2320 }]);
    const publicJson = JSON.stringify(result.public);
    expect(publicJson).not.toContain("Hidden Plan");
    expect(publicJson).not.toContain("Private Address");
    expect(publicJson).not.toContain("chesmar.com");
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining("api/"), expect.anything());
    expect(fetcher).toHaveBeenCalledWith(chesmarIncentivesUrl, expect.objectContaining({ method: "GET" }));
    expect(result.private.incentive?.facts).toMatchObject({
      rateKind: "fixed", promotionalRatePercent: 4.999, aprPercent: 5.737, loanType: "FHA",
      repaymentTermYears: 30, downPaymentPercent: 3.5,
      contractDeadline: { raw: "October 18, 2026", isoDate: "2026-10-18" },
      closingDeadline: { raw: "December 31, 2026", isoDate: "2026-12-31" },
      followOnRatePercent: null, followOnPeriod: null, publishable: true,
    });
    expect(result.public.incentive?.rateKind).toBe("fixed");
    expect(result.private.incentive?.text).toContain("$544,947");
    expect(result.private.incentive?.text).toContain("96.5%");
    expect(result.private.incentive?.text).not.toContain("10.00%");
    expect(publicJson).not.toContain("HomeAmerican");
  });

  it("enumerates all 15 M/I Product URLs at offsets 0, 5, 8, 11, 14 despite overlap and a smaller detail limit", async () => {
    const fetcher = fixtureFetcher(miDocuments());
    const result = await loadOfficialDeals(
      { ...config, builder: "M/I Homes", sourceUrl: miCommunityUrl, maxDetailPages: 2 },
      { fetcher },
    );
    expect(result.ok).toBe(true);
    expect(result.catalogOk).toBe(true);
    expect(result.private.homes).toHaveLength(15);
    expect(result.private.homes.map((home) => home.sourceUrl)).toEqual(Array.from({ length: 15 }, (_, i) => miHomeUrl(i)));
    const requests = fetcher.mock.calls.map(([input]) => input);
    const offsets = requests.filter((url) => url.includes("type=homes")).map((url) => Number(new URL(url).searchParams.get("items")));
    expect(offsets).toEqual([0, 5, 8, 11, 14]);
    const endpoint = new URL(requests.find((url) => url.includes("type=homes"))!);
    expect(endpoint.searchParams.get("id")).toBe(`{${miGuid}}`);
    expect(endpoint.href).toContain(`id=${encodeURIComponent(`{${miGuid}}`)}`);
    expect(requests.filter((url) => url.includes("/hidden-plan/"))).toHaveLength(15);
    for (const [, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) expect(init.method).toBe("GET");
    expect(result.private.homes[0]).toMatchObject({
      privateName: "8300 Private Street", privateAddress: "8300 Private Street, San Antonio, TX",
      privatePlanName: "Hidden & Plan 0 - C", status: "Available Now", readyNow: true,
      price: 400000, previousPrice: 420000, priceDrop: 20000, bedrooms: 5, bathrooms: 4.5,
      squareFeet: 4099, garage: 3, homesite: "5400", moveInDate: "Ready Now",
      geo: { latitude: 29.345, longitude: -98.33 },
    });
    expect(result.private.homes[14]).toMatchObject({ readyNow: false, status: "Quick Move-In", moveInDate: "March 21, 2027", homesite: "5414" });
    expect(result.private.homes[0].gallery).toHaveLength(3);
    expect(result.private.homes[0].gallery?.[0]).toMatchObject({
      sourceUrl: miImageUrl(0), caption: "Kitchen & Dining > Living", width: 2560, height: 1703,
      srcSet: `${miImageUrl(0)} 1800w, ${miImageUrl(0, 1)} 2400w`,
    });
    expect(result.public.homes[0]).toEqual({ status: "Available Now", price: 400000, bedrooms: 5, bathrooms: 4.5, squareFeet: 4099 });
    const publicJson = JSON.stringify(result.public);
    for (const privateValue of ["Private Street", "Hidden", miGuid, "mihomes.com", "gallery", "srcSet", "geo", "homesite", "privateAddress", "privatePlanName"]) {
      expect(publicJson).not.toContain(privateValue);
    }
  });

  it("enumerates the M/I plan endpoint with the same offset semantics and preserves a genuine zero-homes catalog", async () => {
    const documents = miDocuments(0);
    documents[miEndpointUrl("plans", 0)] = JSON.stringify({ TotalItems: 6, Html: `<div class="row">${Array.from({ length: 5 }, (_, i) => miCard(i, true)).join("")}</div>` });
    documents[miEndpointUrl("plans", 5)] = JSON.stringify({ TotalItems: 6, Html: `<div class="row">${miCard(5, true)}</div>` });
    const fetcher = fixtureFetcher(documents);
    const result = await loadOfficialDeals({ ...config, builder: "M/I Homes", sourceUrl: miCommunityUrl }, { fetcher });
    expect(result.ok).toBe(true);
    expect(result.private.homes).toEqual([]);
    expect(result.public.homes).toEqual([]);
    expect(result.private.plans).toHaveLength(6);
    expect(fetcher.mock.calls.filter(([url]) => url.includes("type=plans")).map(([url]) => new URL(url).searchParams.get("items"))).toEqual(["0", "5"]);
    expect(fetcher.mock.calls).toHaveLength(4); // Community + empty homes + two plan pages; no home detail fetches.
  });

  it("does not use an unrelated GUID or silently fall back to one server-rendered M/I home", async () => {
    const fetcher = fixtureFetcher({ [miCommunityUrl]: `<h2 id="product-homes-list">Homes</h2><div data-guid="${miGuid}"></div><a href="${miHomeUrl(0)}">One home</a>` });
    const result = await loadOfficialDeals({ ...config, builder: "M/I Homes", sourceUrl: miCommunityUrl }, { fetcher });
    expect(result.ok).toBe(false);
    expect(result.catalogOk).toBe(false);
    expect(result.holdReasons).toEqual(["missing_community_guid"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["non-JSON", "not JSON"],
    ["invalid total", JSON.stringify({ TotalItems: "15", Html: miCard(0) })],
    ["missing HTML", JSON.stringify({ TotalItems: 0 })],
    ["arbitrary zero-total page", JSON.stringify({ TotalItems: 0, Html: "<h1>Layout changed</h1>" })],
    ["zero-total with a home", JSON.stringify({ TotalItems: 0, Html: `<div class="row">${miCard(0)}</div>` })],
    ["broken Product JSON", JSON.stringify({ TotalItems: 1, Html: miCard(0).replace('"@context"', 'broken "@context"') })],
    ["cross-host Product URL", JSON.stringify({ TotalItems: 1, Html: miCard(0).replace(miHomeUrl(0), "https://attacker.example/home") })],
    ["excessive total", JSON.stringify({ TotalItems: 501, Html: miCard(0) })],
  ])("fails closed on %s M/I inventory without publishing empty/partial homes", async (_, response) => {
    const documents = miDocuments(1);
    documents[miEndpointUrl("homes", 0)] = response;
    const result = await loadOfficialDeals({ ...config, builder: "M/I Homes", sourceUrl: miCommunityUrl }, { fetcher: fixtureFetcher(documents) });
    expect(result.ok).toBe(false);
    expect(result.catalogOk).toBe(false);
    expect(result.holdReasons).toEqual(["invalid_inventory_response"]);
    expect(result.public.homes).toEqual([]);
  });

  it.each(["stuck", "changed total", "missing cards", "failed GET"])("holds a %s later M/I page rather than publishing the first five homes", async (failure) => {
    const documents = miDocuments();
    if (failure === "failed GET") delete documents[miEndpointUrl("homes", 5)];
    else documents[miEndpointUrl("homes", 5)] = JSON.stringify({
      TotalItems: failure === "changed total" ? 14 : 15,
      Html: failure === "missing cards" ? "<h1>Unexpected layout</h1>" : `<div class="row">${miCard(0)}</div>`,
    });
    const fetcher = fixtureFetcher(documents);
    const result = await loadOfficialDeals({ ...config, builder: "M/I Homes", sourceUrl: miCommunityUrl }, { fetcher });
    expect(result.ok).toBe(false);
    expect(result.catalogOk).toBe(false);
    expect(result.holdReasons).toEqual([failure === "failed GET" ? "inventory_fetch_failed" : "incomplete_inventory"]);
    expect(result.public.homes).toEqual([]);
    expect(fetcher.mock.calls).toHaveLength(3);
  });

  it.each(["failed GET", "missing gallery"])("holds M/I catalog publication when a detail gallery has %s", async (failure) => {
    const documents = miDocuments(1);
    if (failure === "failed GET") delete documents[miHomeUrl(0)];
    else documents[miHomeUrl(0)] = "<h1>Unrelated page</h1><p>5 beds</p>";
    const result = await loadOfficialDeals({ ...config, builder: "M/I Homes", sourceUrl: miCommunityUrl }, { fetcher: fixtureFetcher(documents) });
    expect(result.catalogOk).toBe(false);
    expect(result.holdReasons).toEqual([failure === "failed GET" ? "detail_fetch_failed" : "expected_detail_container_not_found"]);
    expect(result.public.homes).toEqual([]);
  });

  it("discovers the M/I linked incentive detail page and does not discard a successful catalog for missing loan terms", async () => {
    const documents = miDocuments(1);
    const incentiveUrl = "https://www.mihomes.com/new-homes/texas/incentives/current-window";
    documents[miCommunityUrl] += `<a href="${incentiveUrl}">View details</a>`;
    documents[incentiveUrl] = `<h1>Fall into savings</h1><p>${completeIncentive.replace("A 3.5% down payment is required.", "")}</p>`;
    const fetcher = fixtureFetcher(documents);
    const result = await loadOfficialDeals({ ...config, builder: "M/I Homes", sourceUrl: miCommunityUrl }, { fetcher });
    expect(result.ok).toBe(false);
    expect(result.catalogOk).toBe(true);
    expect(result.incentiveHoldReasons).toEqual(["missing_down_payment"]);
    expect(result.private.homes).toHaveLength(1);
    expect(result.public.homes).toHaveLength(1);
    expect(result.public.incentive).toBeNull();
    expect(result.private.incentive?.sourceUrl).toBe(incentiveUrl);
    expect(fetcher).toHaveBeenCalledWith(incentiveUrl, expect.objectContaining({ method: "GET" }));
  });

  it("uses the current Chesmar incentives page over a configured obsolete campaign and reparses a changed dated window", async () => {
    const communityUrl = "https://www.chesmar.com/texas/example/secret-grove/";
    const documents: Record<string, string> = {
      [communityUrl]: '<section id="floorplans"><div class="search-results-container">FloorPlans</div></section>',
      "https://www.chesmar.com/sitemap5.xml": "<urlset></urlset>",
      "https://www.chesmar.com/sitemap6.xml": "<urlset></urlset>",
      [chesmarIncentivesUrl]: chesmarIncentiveHtml,
    };
    const fetcher = fixtureFetcher(documents);
    const chesmarConfig: CommunitySourceConfig = { ...config, builder: "Chesmar", sourceUrl: communityUrl, incentiveSourceUrl: "https://www.chesmar.com/campaigns/2553" };
    const first = await loadOfficialDeals(chesmarConfig, { fetcher });
    expect(first.ok).toBe(true);
    expect(first.private.incentive?.sourceUrl).toBe(chesmarIncentivesUrl);
    expect(first.public.incentive?.contractDeadline.isoDate).toBe("2026-10-18");
    documents[chesmarIncentivesUrl] = chesmarIncentiveHtml.replaceAll("October 18, 2026", "November 8, 2026").replaceAll("10/18/26", "11/8/26");
    const second = await loadOfficialDeals(chesmarConfig, { fetcher });
    expect(second.ok).toBe(true);
    expect(second.public.incentive?.contractDeadline.isoDate).toBe("2026-11-08");
    expect(second.private.incentive?.facts.normalizedText).not.toBe(first.private.incentive?.facts.normalizedText);
    expect(fetcher.mock.calls.some(([url]) => url.includes("/campaigns/"))).toBe(false);
  });

  it.each(["fetch", "container", "disclosure"])("keeps the Chesmar catalog successful with a separate incentive %s hold", async (failure) => {
    const communityUrl = "https://www.chesmar.com/texas/example/secret-grove/";
    const planUrl = `${communityUrl}hidden-plan/`;
    const documents: Record<string, string> = {
      [communityUrl]: '<section id="floorplans"><div class="search-results-container">FloorPlans</div></section>',
      "https://www.chesmar.com/sitemap5.xml": `<urlset><url><loc>${planUrl}</loc></url></urlset>`,
      "https://www.chesmar.com/sitemap6.xml": "<urlset></urlset>",
      [planUrl]: "<h1>Hidden Plan</h1><p>Starting From $410,000 · 4 Beds · 3 Baths · 2,300 Sq. Ft.</p>",
    };
    if (failure === "container") documents[chesmarIncentivesUrl] = "<h1>Other content</h1>";
    if (failure === "disclosure") documents[chesmarIncentivesUrl] = chesmarIncentiveHtml.replace("3.50% down payment", "down payment required");
    const result = await loadOfficialDeals({ ...config, builder: "Chesmar", sourceUrl: communityUrl }, { fetcher: fixtureFetcher(documents) });
    expect(result.ok).toBe(false);
    expect(result.catalogOk).toBe(true);
    expect(result.public.plans).toHaveLength(1);
    expect(result.public.incentive).toBeNull();
    expect(result.incentiveHoldReasons).toEqual([failure === "fetch" ? "incentive_fetch_failed" : failure === "container" ? "expected_incentive_container_not_found" : "missing_down_payment"]);
    expect(result.holdReasons).toEqual(result.incentiveHoldReasons);
  });

  it("parses explicit short dates and 30yr fixed terms without inventing a follow-on rate", () => {
    const facts = parsePromotionalRate(`4.999% (5.737% APR) FHA 30yr, fixed-rate special financing.
      3.5% minimum down payment. Buyers sign purchase agreements between 10/1/26 and 10/18/26 and close on or before 12/31/26.`);
    expect(facts).toMatchObject({ rateKind: "fixed", repaymentTermYears: 30, downPaymentPercent: 3.5, publishable: true,
      promotionalPeriod: null, followOnRatePercent: null, followOnPeriod: null,
      contractDeadline: { raw: "10/18/26", isoDate: "2026-10-18" },
      closingDeadline: { raw: "12/31/26", isoDate: "2026-12-31" },
    });
    expect(facts.holdReasons).toEqual([]);
  });

  it("does not make a buydown fixed or infer missing/invalid contract dates from the scrape time", () => {
    const base = "4.999% (5.737% APR) FHA 30-year, fixed-rate financing. 3.50% down payment.";
    const temporary = parsePromotionalRate(`${base} A 1/0 buydown applies. Contract by 10/18/26; close by 12/31/26.`);
    expect(temporary.rateKind).toBe("promotional");
    expect(temporary.holdReasons).toContain("missing_follow_on_rate");
    const undated = parsePromotionalRate(`${base} Contract by 10/18; close by 12/31.`);
    expect(undated.contractDeadline).toBeNull();
    expect(undated.closingDeadline).toBeNull();
    expect(undated.holdReasons).toContain("missing_contract_deadline");
    const invalidDate = parsePromotionalRate(`${base} Contract by 2/30/26; close by 12/31/26.`);
    expect(invalidDate.contractDeadline?.isoDate).toBeNull();
    expect(invalidDate.publishable).toBe(false);
  });

  it("fails closed without leaking a private source URL when official community GET fails", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const sourceUrl = "https://www.mihomes.com/new-homes/example/private-community";
    const result = await loadOfficialDeals(
      { ...config, builder: "M/I Homes", sourceUrl },
      { fetcher },
    );

    expect(result.ok).toBe(false);
    expect(result.holdReasons).toEqual(["community_fetch_failed"]);
    expect(result.public).toEqual({ plans: [], homes: [], incentive: null, holdReasons: ["community_fetch_failed"] });
    expect(JSON.stringify(result.public)).not.toContain(sourceUrl);
    expect(fetcher).toHaveBeenCalledWith(sourceUrl, expect.objectContaining({ method: "GET" }));
  });

  it("fails closed rather than treating an arbitrary M/I page as a community container", async () => {
    const sourceUrl = "https://www.mihomes.com/new-homes/example/private-community";
    const fetcher = vi.fn().mockResolvedValue(new Response("<html><h1>Other page</h1></html>", { status: 200 }));
    const result = await loadOfficialDeals(
      { ...config, builder: "M/I Homes", sourceUrl },
      { fetcher },
    );

    expect(result.ok).toBe(false);
    expect(result.holdReasons).toEqual(["expected_community_container_not_found"]);
    expect(JSON.stringify(result.public)).not.toContain(sourceUrl);
  });
});
