import { describe, expect, it } from "vitest";
import { buildTag } from "./fub";

describe("lease listing inquiry FUB routing", () => {
  it("tags lease inquiries as Landlord — never buyer/seller", () => {
    const tags = buildTag("Lease Listing Inquiry", "Unknown");
    expect(tags).toContain("Lease Listing Inquiry");
    expect(tags).toContain("Landlord");
    expect(tags.join(" ")).not.toMatch(/Buyer|Seller/);
  });

  it("keeps intent suffix alongside the Landlord tag", () => {
    const tags = buildTag("Lease Listing Inquiry", "Hot");
    expect(tags).toEqual(["Lease Listing Inquiry", "Landlord", "Lease Listing Inquiry - Hot"]);
  });

  it("does not add Landlord to other source tags", () => {
    expect(buildTag("Website - Valuation", "Warm")).toEqual([
      "Website - Valuation",
      "Website - Valuation - Warm",
    ]);
  });
});
