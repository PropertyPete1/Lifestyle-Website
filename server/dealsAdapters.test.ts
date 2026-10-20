import { describe, expect, it, vi } from "vitest";

import {
  DEAL_ADAPTERS,
  categorizedPrivateTerms,
  loadOfficialDeals,
  looksLikeStreetAddress,
  normalizeIncentiveText,
  parsePromotionalRate,
  toPublicSafeText,
  type CommunitySourceConfig,
  type PrivateDealSnapshot,
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
/** Site chrome carries the community range and a QMI menu entry; only the h1 stat block and gallery count. */
function chesmarDetailPage(heading: string, stats: string): string {
  return `<nav><a href="/quick-move-in/">Quick Move-In Homes</a> From $499,990 · 2,340 to 3,834 Sq. Ft. | 3 - 5 Beds | 2 - 4 Baths</nav>
    <main><h1>${heading}</h1><p>${stats}</p><div class="plan-gallery slick"><img src="/images/${heading.toLowerCase().replace(/\s+/g, "-")}-1600x1067.jpg" alt="Kitchen"><img src="/images/logo.png"></div></main>
    <footer>Quick Move-In Homes · From $499,990</footer>`;
}
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
    expect(Object.keys(DEAL_ADAPTERS).sort()).toEqual(["Ashton Woods", "Beazer Homes", "Centex", "Century Communities", "Chesmar", "Coventry Homes", "D.R. Horton", "DRB Homes", "David Weekley Homes", "Davidson Homes", "Del Webb", "Drees Custom Homes", "Empire Homes", "First America Homes", "Hakes Brothers", "Highland Homes", "KB Home", "LGI Homes", "Legend Homes", "Lennar", "M/I Homes", "Manual", "Perry Homes", "Pulte", "Scott Felder Homes", "Sitterle Homes", "Starlight Homes", "Texas Homes", "Toll Brothers", "View Homes"]);
    expect(DEAL_ADAPTERS["Perry Homes"].builder).toBe("Perry Homes");
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
    // A promotional headline without repayment wording needs only its follow-on
    // rate and period; "first year" is a promotional period, not a term.
    expect(facts.holdReasons).toEqual(["missing_follow_on_rate", "missing_follow_on_period"]);
    const withTerm = parsePromotionalRate("First year: 4.25% Rate / 6.051% APR; 5.25% for years 2-30 on a 30-year loan.");
    expect(withTerm.holdReasons).toEqual(["missing_loan_type", "missing_down_payment"]);
    // An adjustable-rate offer is held however it is spelled.
    for (const wording of ["5/1 ARM", "5/1 Arm", "Adjustable Rate Mortgage", "Adjustable-Rate", "ADJUSTABLE RATE", "7/6 ARM", "the rate adjusts annually", "4.5% initial interest rate", "rate fixed for 5 years then adjusts annually for years 6-30", "fixed for 7 years with a balloon payment", "4.5% for 5 years, then 6.5% for the remaining term"]) {
      expect(parsePromotionalRate(`4.5% (6.38% APR) FHA, 3.5% down, 30-year, ${wording}.`).holdReasons).toContain("adjustable_rate");
    }
    expect(parsePromotionalRate("4.5% (6.38% APR) FHA 30-year fixed, 3.5% down; arm yourself with savings.").holdReasons).not.toContain("adjustable_rate");
    // "fixed for 5 years then adjusts" reads the fixed period as no plain term: the hold stands and the publishable flag is off.
    expect(parsePromotionalRate("4.99% (6.62% APR) FHA financing, 3.5% down payment, rate fixed for 5 years then adjusts annually for years 6-30 based on the index plus margin.").publishable).toBe(false);
    // Two different rate figures in one fixed offer are the admin's call; the figure beside the APR is the headline.
    const two = parsePromotionalRate("Interest Rates as Low as 3.99%. 4.99% (6.62% APR) 30-year fixed FHA with 3.5% down.");
    expect(two).toMatchObject({ promotionalRatePercent: 4.99, aprPercent: 6.62 });
    expect(two.holdReasons).toContain("ambiguous_rate");
    expect(parsePromotionalRate("4.99% fixed rate FHA/VA financing. A 4.99% interest rate (5.75% Annual Percentage Rate) for FHA 30-year fixed, 3.5% down.").holdReasons).not.toContain("ambiguous_rate");
    expect(parsePromotionalRate("4.990% (6.619% APR) FHA 30-year fixed with 3.5% down; 4.99% interest rate.").holdReasons).not.toContain("ambiguous_rate");
    // "4.99% 30-year fixed FHA financing" is a rate: it needs its APR.
    for (const wording of ["4.99% 30-year fixed FHA financing on select homes.", "4.99% FHA/VA on select homes.", "4.99% 30 yr fixed on select homes."]) {
      expect(parsePromotionalRate(wording).rateKind, wording).toBe("fixed");
      expect(parsePromotionalRate(wording).holdReasons, wording).toContain("missing_apr");
    }
    // Boilerplate "subject to change and adjust at any time" names no stepped rate.
    expect(parsePromotionalRate("4.5% (6.38% APR) FHA 30-year fixed, 3.5% down. Prices, plans and incentives are subject to change and adjust at any time.").holdReasons).not.toContain("adjustable_rate");
    // Dates are only required when the source actually names a contract or closing deadline.
  });

  it("reads the follow-on rate before 'for years 2' and never takes the down payment or a closing date for it", () => {
    const facts = parsePromotionalRate("First-year rates as low as 4.25% (6.051% APR); 5.25% (6.051% APR) for years 2-30 on a 30-year fixed FHA loan with 3.5% down.");
    expect(facts).toMatchObject({ promotionalRatePercent: 4.25, followOnRatePercent: 5.25, followOnPeriod: "years 2-30", downPaymentPercent: 3.5, loanType: "FHA", repaymentTermYears: 30, publishable: true });
    const forward = parsePromotionalRate("First-year 4.25% (6.051% APR). For years 2-30 the rate is 5.25% on a 30-year FHA loan with 3.5% down payment.");
    expect(forward.followOnRatePercent).toBe(5.25);
    const onlyDown = parsePromotionalRate("First-year rates as low as 4.25% (6.051% APR). Years 2-30 on a 30-year FHA loan with 3.5% down payment.");
    expect(onlyDown.followOnRatePercent).toBeNull();
    expect(onlyDown.holdReasons).toContain("missing_follow_on_rate");
    const crossing = parsePromotionalRate("4.999% (5.737% APR) FHA 30-year fixed, 3.5% down. Sign a purchase agreement by October 18 and close by 12/31/26.");
    expect(crossing.contractDeadline).toBeNull();
    expect(crossing.closingDeadline).toMatchObject({ isoDate: "2026-12-31" });
    expect(crossing.holdReasons).toEqual(["missing_contract_deadline"]);
  });

  it("reads 'year one/two/three' and '2/1 Program' wording as a temporary buydown only when it is rate wording, never a discount as the rate, and '(APR N%)' as the APR", () => {
    const buydown = parsePromotionalRate("2.99% (APR 6.81%) 30-YR Fixed FHA loan 3.5% down payment required. 2/1 Program includes a 2% decrease on the interest rate for year one and a 1% decrease in the interest rate for year two. The interest rate that applies to year one is 2.99%. Beginning in year three, the fixed rate of 4.99% applies to the remainder of the loan life.");
    expect(buydown).toMatchObject({ rateKind: "promotional", promotionalRatePercent: 2.99, promotionalPeriod: "year one", followOnRatePercent: 4.99, aprPercent: 6.81, loanType: "FHA", repaymentTermYears: 30, downPaymentPercent: 3.5, publishable: true });
    // "year two" in an HOA sentence is not a buydown; a fixed-rate offer stays fixed and publishable.
    const hoa = parsePromotionalRate("4.99% (5.50% APR) 30-year fixed FHA rate with 3.5% down on select homes. Builder pays the HOA dues for year two.");
    expect(hoa).toMatchObject({ rateKind: "fixed", promotionalRatePercent: 4.99, publishable: true });
    // "2 years of HOA dues" is not the loan term, and the rate window does not run across "!"; "a term of 30 years" is.
    const dues = parsePromotionalRate("Builder pays up to $10,000 in closing costs and 2 years of HOA dues. 4.99% (5.5% APR) 30-year fixed FHA with 3.5% down payment.");
    expect(dues).toMatchObject({ repaymentTermYears: 30, publishable: true });
    expect(parsePromotionalRate("Lock your rate today! HOA dues are covered for year one. 4.99% (5.50% APR) 30-year fixed FHA with 3.5% down payment.")).toMatchObject({ rateKind: "fixed", publishable: true });
    expect(parsePromotionalRate("4.99% (5.5% APR) FHA financing with a term of 30 years and 3.5% down payment.")).toMatchObject({ repaymentTermYears: 30 });
    expect(parsePromotionalRate("10 yrs structural warranty. 4.99% (5.5% APR) FHA with 3.5% down payment.")).toMatchObject({ repaymentTermYears: null });
    expect(parsePromotionalRate("4.99% (5.5% APR) 30 yr. fixed FHA with 3.5% down payment.")).toMatchObject({ repaymentTermYears: 30 });
    expect(parsePromotionalRate("4.99% (5.5% APR) FHA, fixed for 30 years, 3.5% down payment.")).toMatchObject({ repaymentTermYears: 30 });
    // "the rate for year one is 2% lower" is a discount, not the rate.
    const discount = parsePromotionalRate("2/1 buydown on select homes: the interest rate for year one is 2% lower than the note rate. Note rate 4.99% (6.81% APR) 30-year fixed FHA, 3.5% down payment. Beginning in year three, the fixed rate of 4.99% applies.");
    expect(discount.promotionalRatePercent).not.toBe(2);
    // The Starlight headline form without the "year one is" sentence still names the rate.
    expect(parsePromotionalRate("2.99% (APR 6.81%) 30-YR Fixed FHA loan 3.5% down payment required.").promotionalRatePercent).toBe(2.99);
  });

  it("uses the shared scrubber and refuses output when a short private term cannot safely be scrubbed", () => {
    expect(toPublicSafeText("Secret Grove offers Hidden Plan.", config)).toBe("This community offers this community.");
    expect(toPublicSafeText("AUX is private", { ...config, scrubList: ["AUX"] })).toBeNull();
    // A lender's NMLS id in any spelling names the lender.
    for (const id of ["NMLS 1791", "NMLS #1791", "NMLS ID No. 1791", "NMLSR ID 1791", "NMLS Unique Identifier 1791", "N.M.L.S. 1791", "NMLS Consumer Access 1791"]) expect(toPublicSafeText(`Financing through our lender (${id}).`, config)).toBeNull();
    expect(toPublicSafeText("Financing through our lender.", config)).toBe("Financing through our lender.");
    // A bare domain and a ten-digit phone number are residue like a link is; prices and ZIP codes are not.
    expect(toPublicSafeText("See TollBrothersMortgage.com for details.", config)).toBeNull();
    expect(toPublicSafeText("Call 8775000508 today.", config)).toBeNull();
    for (const phone of ["(210) 555-0142", "210-555-0142", "210.555.0142", "210 555 0142"]) expect(toPublicSafeText(`Call ${phone} to book.`, config)).toBeNull();
    // A phone number that ends a sentence is residue too.
    for (const text of ["Call (210) 555-0142.", "Call 210.555.0142. Thanks.", "Call 8775000508."]) expect(toPublicSafeText(text, config)).toBeNull();
    expect(toPublicSafeText("Homes from $1,234,567 in the 78255 area.", config)).toBe("Homes from $1,234,567 in the 78255 area.");
  });

  it("scrubs plan names only in plan fields or in the 'the X' / 'X plan' forms and keeps other words verbatim", () => {
    const categorized = { ...config, scrubList: [], scrubConfig: { builder: ["M/I Homes"], lender: ["M/I Financial"], community: ["Secret Grove"], plan: ["Magnolia"], street: ["Private Street"], other: [] } };
    expect(toPublicSafeText("Magnolia trees are planted along the entry. Ask about the Magnolia plan on Private Street with M/I Financial.", categorized))
      .toBe("Magnolia trees are planted along the entry. Ask about this plan on this street with the builder's lender.");
    expect(toPublicSafeText("Magnolia", categorized, true)).toBe("this plan");
  });

  it("puts only address-shaped names in the street category and drops admin-excluded false positives", () => {
    for (const address of ["8106 Onion Patch", "8106 Onion Patch, San Antonio, TX 78263", "9012 Sample Grove", "12A Fixture Street", " 7702 Sample Basket "]) expect(looksLikeStreetAddress(address)).toBe(true);
    for (const heading of ["New Homes in San Antonio", "Hidden Plan", "123", "", "Lot 12 Block 3", "2026 Fall Savings Event!", null, undefined]) expect(looksLikeStreetAddress(heading)).toBe(false);

    const discovered: PrivateDealSnapshot = {
      builder: "Chesmar", sourceUrl: "https://www.chesmar.com/texas/example/secret-grove/", privateCommunityName: "Secret Grove", pages: [], incentive: null,
      plans: [{ sourceUrl: "https://www.chesmar.com/texas/example/secret-grove/magnolia/", privateName: "Magnolia - B", status: null, price: null, bedrooms: null, bathrooms: null, squareFeet: null }],
      homes: [
        { sourceUrl: "https://www.chesmar.com/texas/example/secret-grove/magnolia/1/", privateName: "9012 Sample Grove", status: "Quick Move-In", price: null, bedrooms: null, bathrooms: null, squareFeet: null },
        // A detail page whose h1 is a marketing heading, not an address: verbatim text, never a street term.
        { sourceUrl: "https://www.chesmar.com/texas/example/secret-grove/magnolia/2/", privateName: "New Homes in San Antonio", status: "Quick Move-In", price: null, bedrooms: null, bathrooms: null, squareFeet: null },
        { sourceUrl: "https://www.mihomes.com/x/3", privateName: "Fixture A", privateAddress: "8301 Fixture Street, San Antonio, TX 78263", privatePlanName: "Fixture A", status: "Quick Move-In", price: null, bedrooms: null, bathrooms: null, squareFeet: null },
      ],
    };
    const base = { builder: "Chesmar" as const, privateCommunityName: "Secret Grove", scrubList: [] as string[] };
    const terms = categorizedPrivateTerms(base, discovered);
    expect(terms.street).toEqual(["9012 Sample Grove", "Sample Grove", "8301 Fixture Street, San Antonio, TX 78263", "Fixture Street"]);
    expect(terms.plan).toEqual(["Magnolia - B", "Magnolia", "Fixture A"]);
    expect(JSON.stringify(terms)).not.toContain("New Homes in San Antonio");
    const excluded = categorizedPrivateTerms({ ...base, excludedTerms: ["sample grove", "Fixture A", "Secret Grove", "Chesmar"] }, discovered);
    expect(excluded.street).toEqual(["9012 Sample Grove", "8301 Fixture Street, San Antonio, TX 78263", "Fixture Street"]);
    expect(excluded.plan).toEqual(["Magnolia - B", "Magnolia"]);
    // Builder and community names can never be excluded.
    expect(excluded.community).toEqual(["Secret Grove"]);
    expect(excluded.builder).toEqual(expect.arrayContaining(["Chesmar", "Chesmar Homes"]));
  });

  it("does not treat a Chesmar home page heading as a street name, and leaves an admin-excluded heading verbatim in the incentive", async () => {
    const communityUrl = "https://www.chesmar.com/texas/example/secret-grove/";
    const planUrl = `${communityUrl}hidden-plan/`;
    const homeUrl = `${planUrl}123456-0001/`;
    // The heading phrase lands in the FHA headline the adapter reads (the shortest matching strong/p element).
    const incentiveHtml = chesmarIncentiveHtml.replace("<strong>4.999%", "<strong>New Homes in San Antonio: ask about our fall savings. 4.999%");
    const documents: Record<string, string> = {
      [communityUrl]: '<section id="floorplans"><div class="search-results-container">FloorPlans</div></section>',
      "https://www.chesmar.com/sitemap.xml": "<sitemapindex><sitemap><loc>https://www.chesmar.com/sitemap5.xml</loc></sitemap><sitemap><loc>https://www.chesmar.com/sitemap6.xml</loc></sitemap></sitemapindex>",
      "https://www.chesmar.com/sitemap5.xml": `<urlset><url><loc>${planUrl}</loc></url></urlset>`,
      "https://www.chesmar.com/sitemap6.xml": `<urlset><url><loc>${homeUrl}</loc></url></urlset>`,
      [planUrl]: chesmarDetailPage("Hidden Plan", "Starting From $410,000 · 4 Beds · 3 Baths · 2,300 Sq. Ft."),
      [homeUrl]: chesmarDetailPage("New Homes in San Antonio", "Quick Move-In · $425,000 · 4 Beds · 3 Baths · 2,320 Sq. Ft."),
      [chesmarIncentivesUrl]: incentiveHtml,
    };
    const fetcher = fixtureFetcher(documents);
    const source: CommunitySourceConfig = { builder: "Chesmar", sourceUrl: communityUrl, privateCommunityName: "Secret Grove", scrubList: ["Secret Grove", "Hidden Plan"] };

    const result = await loadOfficialDeals(source, { fetcher });
    expect(result.catalogOk).toBe(true);
    expect(result.private.homes[0]).toMatchObject({ privateName: "New Homes in San Antonio", status: "Quick Move-In" });
    expect(result.private.discoveredScrubConfig?.street).toEqual([]);
    expect(result.private.discoveredScrubConfig?.plan).toEqual(["Hidden Plan"]);
    // Without an exclusion the heading is still a discovered private name, so the incentive text is scrubbed, not held.
    expect(result.public.incentive?.text).toContain("This community: ask about our fall savings");
    expect(result.public.incentive?.text).not.toContain("New Homes in San Antonio");

    const relaxed = await loadOfficialDeals({ ...source, excludedTerms: ["New Homes in San Antonio"] }, { fetcher: fixtureFetcher(documents) });
    expect(relaxed.catalogOk).toBe(true);
    expect(relaxed.holdReasons).toEqual([]);
    expect(relaxed.public.incentive?.text).toContain("New Homes in San Antonio: ask about our fall savings");
    expect(JSON.stringify(relaxed.public)).not.toContain("Secret Grove");
    expect(JSON.stringify(relaxed.public)).not.toContain("Hidden Plan");
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
      "https://www.chesmar.com/sitemap.xml": "<sitemapindex><sitemap><loc>https://www.chesmar.com/sitemap5.xml</loc></sitemap><sitemap><loc>https://www.chesmar.com/sitemap6.xml</loc></sitemap></sitemapindex>",
      "https://www.chesmar.com/sitemap5.xml": `<urlset><url><loc>${planUrl}</loc></url></urlset>`,
      "https://www.chesmar.com/sitemap6.xml": `<urlset><url><loc>${homeUrl}</loc></url></urlset>`,
      [planUrl]: chesmarDetailPage("Hidden Plan", "Starting From $410,000 · 4 Beds · 3 Baths · 2,300 Sq. Ft."),
      [homeUrl]: chesmarDetailPage("1234 Private Address", "Quick Move-In · $425,000 · 4 Beds · 3 Baths · 2,320 Sq. Ft."),
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
    for (let i = 0; i < 6; i++) documents[`${miCommunityUrl}/hidden-${i}-plan`] = miDetail(i);
    const fetcher = fixtureFetcher(documents);
    const result = await loadOfficialDeals({ ...config, builder: "M/I Homes", sourceUrl: miCommunityUrl }, { fetcher });
    expect(result.ok).toBe(true);
    expect(result.private.homes).toEqual([]);
    expect(result.public.homes).toEqual([]);
    expect(result.private.plans).toHaveLength(6);
    expect(fetcher.mock.calls.filter(([url]) => url.includes("type=plans")).map(([url]) => new URL(url).searchParams.get("items"))).toEqual(["0", "5"]);
    expect(fetcher.mock.calls).toHaveLength(10); // Community + empty homes + two plan pages + six reviewed plan galleries.
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
    const planUrl = `${communityUrl}hidden-plan/`;
    const documents: Record<string, string> = {
      [communityUrl]: '<section id="floorplans"><div class="search-results-container">FloorPlans</div></section>',
      "https://www.chesmar.com/sitemap.xml": "<sitemapindex><sitemap><loc>https://www.chesmar.com/sitemap5.xml</loc></sitemap><sitemap><loc>https://www.chesmar.com/sitemap6.xml</loc></sitemap></sitemapindex>",
      "https://www.chesmar.com/sitemap5.xml": `<urlset><url><loc>${planUrl}</loc></url></urlset>`,
      "https://www.chesmar.com/sitemap6.xml": "<urlset></urlset>",
      [planUrl]: chesmarDetailPage("Hidden Plan", "Starting From $410,000 · 4 Beds · 3 Baths · 2,300 Sq. Ft."),
      [chesmarIncentivesUrl]: chesmarIncentiveHtml,
    };
    const fetcher = fixtureFetcher(documents);
    const chesmarConfig: CommunitySourceConfig = { ...config, builder: "Chesmar", sourceUrl: communityUrl, planSlugs: ["hidden-plan"], incentiveSourceUrl: "https://www.chesmar.com/campaigns/2553" };
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
      "https://www.chesmar.com/sitemap.xml": "<sitemapindex><sitemap><loc>https://www.chesmar.com/sitemap5.xml</loc></sitemap><sitemap><loc>https://www.chesmar.com/sitemap6.xml</loc></sitemap></sitemapindex>",
      "https://www.chesmar.com/sitemap5.xml": `<urlset><url><loc>${planUrl}</loc></url></urlset>`,
      "https://www.chesmar.com/sitemap6.xml": "<urlset></urlset>",
      [planUrl]: chesmarDetailPage("Hidden Plan", "Starting From $410,000 · 4 Beds · 3 Baths · 2,300 Sq. Ft."),
    };
    if (failure === "container") documents[chesmarIncentivesUrl] = "<h1>Other content</h1>";
    if (failure === "disclosure") documents[chesmarIncentivesUrl] = chesmarIncentiveHtml.replace("3.50% down payment", "down payment required");
    const result = await loadOfficialDeals({ ...config, builder: "Chesmar", sourceUrl: communityUrl, planSlugs: ["hidden-plan"] }, { fetcher: fixtureFetcher(documents) });
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
    // "closing by 11/30/2026" is a closing deadline; "contracts … closing by" names no contract deadline; cash "toward rate buydown" is not a buydown rate.
    const closing = parsePromotionalRate("Purchase a quick move-in home closing by 11/30 and choose a 5.25% Fixed-Rate or up to $55,000 in flex cash! FHA – 5.25% (5.993% APR) based on 3.5% down payment. Below-market interest rates valid on new home contracts for eligible properties entered into as of 10/30/2026 closing by 11/30/2026. Flex cash can be applied toward rate buydown, appliances or closing costs. 30-year fixed.");
    expect(closing).toMatchObject({ rateKind: "fixed", promotionalRatePercent: 5.25, aprPercent: 5.993, loanType: "FHA", downPaymentPercent: 3.5, repaymentTermYears: 30, contractDeadline: null, closingDeadline: { raw: "11/30/2026", isoDate: "2026-11-30" }, holdReasons: [] });
    expect(parsePromotionalRate("5.25% (5.993% APR) FHA 30-year. A 2/1 buydown applies; must close on or before 12/31/2026.")).toMatchObject({ rateKind: "promotional", closingDeadline: { isoDate: "2026-12-31" } });
    // Square brackets and the spelled-out APR name the rate too; "close per contract by" is a closing deadline; a 5/1 ARM holds as adjustable.
    const arm = parsePromotionalRate("Lock In 4.99%! 4.99% Limited Time 5/1 ARM [6.62% APR] with Choice Lender! Homes must be contracted between 10/07/2026 and 12/07/2026 and close per contract by 12/07/2026. FHA 5/1 Adjustable Rate Mortgage with an initial interest rate of 4.990% (6.619% Annual Percentage Rate(APR)).");
    expect(arm).toMatchObject({ promotionalRatePercent: 4.99, aprPercent: 6.62, contractDeadline: { isoDate: "2026-12-07" }, closingDeadline: { isoDate: "2026-12-07" } });
    expect(arm.holdReasons).toContain("adjustable_rate");
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
