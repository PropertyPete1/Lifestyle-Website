/**
 * /links quick-capture form: FUB tag routing by "I'm interested in..."
 * selection, and the links_form analytics kind. The critical guarantee:
 * "Joining the team" gets the Recruit treatment and never lands in
 * buyer/seller pipelines; "Leasing" routes as a Landlord lead.
 */
import { describe, expect, it } from "vitest";
import { buildTag } from "./fub";

const SOURCE = "Website - Links Page";

describe("/links capture — FUB tag routing", () => {
  it("tags 'Joining the team' with the Recruit treatment", () => {
    const tags = buildTag(SOURCE, "Unknown", { interest: "Joining the team" });
    expect(tags).toContain(SOURCE);
    expect(tags).toContain("Recruit - Website");
    expect(tags.join(" ")).not.toMatch(/Interest - (Buying|Selling)/);
  });

  it("tags 'Leasing' as a Landlord lead", () => {
    const tags = buildTag(SOURCE, "Unknown", { interest: "Leasing" });
    expect(tags).toContain("Landlord");
    expect(tags).not.toContain("Recruit - Website");
  });

  it("tags Buying and Selling with explicit interest tags", () => {
    expect(buildTag(SOURCE, "Unknown", { interest: "Buying" })).toContain("Interest - Buying");
    expect(buildTag(SOURCE, "Unknown", { interest: "Selling" })).toContain("Interest - Selling");
  });

  it("leaves non-links leads unchanged (no interest answer)", () => {
    expect(buildTag("Website - Valuation", "Hot")).toEqual([
      "Website - Valuation",
      "Website - Valuation - Hot",
    ]);
    // Lease Listing Inquiry keeps its Landlord tag independent of answers
    expect(buildTag("Lease Listing Inquiry", "Unknown")).toContain("Landlord");
  });
});
