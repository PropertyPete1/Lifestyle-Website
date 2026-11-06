import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Nov 6, 2026 (Peter): the social /links page no longer offers the separate
// "Review My Home's Value" / "Plan My Rental Listing" block — it repeated the
// form below. The form itself (first name + mobile, optional interest with
// Selling/Leasing, consent) must stay exactly as it was.
const page = readFileSync(new URL("../client/src/pages/Links.tsx", import.meta.url), "utf8");

describe("/links owner shortcuts removed", () => {
  it("no longer renders the repetitive seller/landlord block", () => {
    expect(page).not.toContain("data-links-owner-shortcuts");
    expect(page).not.toContain("Review My Home&rsquo;s Value");
    expect(page).not.toContain("Plan My Rental Listing");
    expect(page).not.toContain("Selling or renting out a property?");
  });

  it("keeps the text-me form with the optional interest selector and its routing tag", () => {
    expect(page).toContain('sourceTag="Website - Links Page"');
    expect(page).toContain("textMe");
    expect(page).toContain('options: ["Buying", "Selling", "Leasing", "Joining the team"]');
    expect(page).toContain("onSuccess={logFormSubmit}");
  });
});
