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
