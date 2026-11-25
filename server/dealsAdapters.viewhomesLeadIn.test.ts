import { describe, expect, it } from "vitest";
import { viewHomesDescriptionStatus } from "./dealsAdapters.viewhomes";

/**
 * Nov 25, 2026: Weltner Farms was held (unlabelled_home_status) because two badge-less home cards' own pages describe the
 * home as "New Home by View Homes: <street> is For Sale in ..." (one misspelt "s For Sale"), with a plain page title.
 * Invented fixtures only.
 */
const page = (description: string, title = "4410 Sample Ridge Yard: New Home in Exampleville, TX | View Homes") =>
  `<html><head><title>${title}</title><meta name="description" content="${description}" /></head><body></body></html>`;

describe("View Homes: a description with the builder's lead-in", () => {
  it("reads '<own street> is For Sale' after the lead-in as For Sale", () => {
    expect(viewHomesDescriptionStatus(page("New Home by View Homes: 4410 Sample Ridge Yard is For Sale in Sample Farms, Exampleville, TX 70000- 2 Story, 4 Bedroom"), "4410 Sample Ridge")).toBe("For Sale");
    expect(viewHomesDescriptionStatus(page("New Home by View Homes: 4410 Sample Ridge Yard s For Sale in Sample Farms, Exampleville, TX 70000- 1 Story"), "4410 Sample Ridge")).toBe("For Sale");
  });

  it("a partial signal still holds: another street, no card street, or no for-sale wording gives nothing", () => {
    const line = page("New Home by View Homes: 4410 Sample Ridge Yard is For Sale in Sample Farms, Exampleville, TX 70000");
    expect(viewHomesDescriptionStatus(line)).toBeNull();
    expect(viewHomesDescriptionStatus(line, "4414 Sample Ridge")).toBeNull();
    expect(viewHomesDescriptionStatus(line, "4410 Other Ridge")).toBeNull();
    expect(viewHomesDescriptionStatus(page("New Home by View Homes: 4410 Sample Ridge Yard in Sample Farms, Exampleville, TX 70000- 2 Story"), "4410 Sample Ridge")).toBeNull();
    expect(viewHomesDescriptionStatus(page("New Home by View Homes: 4410 Sample Ridge Yard has sold in Sample Farms"), "4410 Sample Ridge")).toBeNull();
  });
});
