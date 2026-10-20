import { describe, expect, it } from "vitest";
import { TEASER_MAX, incentiveTeaser } from "../shared/dealsTeaser";

describe("the landing page's offer teaser", () => {
  it("keeps the sentence that names the rate and drops its dates, for each reader's wording", () => {
    // M/I: headline with a closing date, then the body and the fine print with contract and closing deadlines.
    expect(incentiveTeaser("Fall Into Savings: first-year rates as low as 4.25% (6.051% APR) on selected quick move-in homes closing by 11/30, plus up to $10,000 paid closing costs. Selected Quick Move-In homes in this community receive a 1/0 buydown on a 30-year fixed FHA loan. Year 1: 4.25% (6.051% APR). 5.25% (6.051% APR) for years 2-30. A 3.5% down payment is required. Valid on full priced contracts written between 10/12/2026 and 11/8/2026 with financing through the builder's lender. Buyer must close by 11/30/2026."))
      .toBe("Fall Into Savings: first-year rates as low as 4.25% (6.051% APR) on selected quick move-in homes, plus up to $10,000 paid closing costs.");
    // PulteGroup: the carousel description then the disclaimer.
    expect(incentiveTeaser("Make your move this fall and save up to $43,000 on select homes, plus take advantage of an FHA 30-year fixed rate as low as 4.75% / 5.58% APR. Explore available homes and limited-time savings through October 31. \"Savings Up To\" offer available on new purchase agreements for select quick move-in homes that are accepted by builder by 10/31/2026."))
      .toBe("Make your move this fall and save up to $43,000 on select homes, plus take advantage of an FHA 30-year fixed rate as low as 4.75% / 5.58% APR.");
    // Chesmar-style: a rate line followed by the homes it applies to.
    expect(incentiveTeaser("Rates as low as 4.99% (6.2% APR) with the builder's lender. Selected Quick Move-In homes: 118 Sienna Lakes Blvd $349,990.")).toBe("Rates as low as 4.99% (6.2% APR) with the builder's lender.");
    // A date in the rate sentence itself, in several forms.
    expect(incentiveTeaser("5.5% FHA rate on select homes through October 31, 2026.")).toBe("5.5% FHA rate on select homes.");
    expect(incentiveTeaser("Offer ends 11/8/2026: 5.5% FHA rate on select homes.")).toBe("5.5% FHA rate on select homes.");
    expect(incentiveTeaser("Contracts written between 10/12/2026 and 11/8/2026 get 5.5% (6.1% APR).")).toBe("Get 5.5% (6.1% APR).");
    // A month abbreviation with its day is not a sentence end; "4/2.5" and "Lamar 5" are figures and names; "contracts" stays after a preposition.
    expect(incentiveTeaser("Rates as low as 4.99% on select homes through Dec. 31. Other terms apply.")).toBe("Rates as low as 4.99% on select homes.");
    expect(incentiveTeaser("4.99% (6.051% APR) on 4/2.5 homes closing by 11/30.")).toBe("4.99% (6.051% APR) on 4/2.5 homes.");
    expect(incentiveTeaser("Save $20,000 at Lamar 5 Ranch.")).toBe("Save $20,000 at Lamar 5 Ranch.");
    expect(incentiveTeaser("Rate available on contracts through 10.31.26.")).toBe("Rate available on contracts.");
    expect(incentiveTeaser("Must close by 11/30.")).toBe("");
    // A day/month without a year is a date after a lead word, or after a connector when the clause ends there; "Rated 4/5" and "on 4/5 homes" are figures.
    expect(incentiveTeaser("Rated 4/5 on 2% rate buydowns.")).toBe("Rated 4/5 on 2% rate buydowns.");
    expect(incentiveTeaser("Rates as low as 4.5% (6.38% APR) when you purchase by 10/31.")).toBe("Rates as low as 4.5% (6.38% APR) when you purchase.");
    expect(incentiveTeaser("4.99% (6.1% APR) through 11/30 on select homes.")).toBe("4.99% (6.1% APR) on select homes.");
    expect(incentiveTeaser("Get 4.99% (6.1% APR) if you sign by 11/15.")).toBe("Get 4.99% (6.1% APR) if you sign.");
    expect(incentiveTeaser("4.99% (6.1% APR) on homes that close by 12/31.")).toBe("4.99% (6.1% APR) on homes.");
    expect(incentiveTeaser("4.99% (6.1% APR) on 4/5 homes in the community.")).toBe("4.99% (6.1% APR) on 4/5 homes in the community.");
    // "May 1 day" is a count, not a date.
    expect(incentiveTeaser("At 4.99% (6.1% APR) you may 1 day regret waiting.")).toBe("At 4.99% (6.1% APR) you may 1 day regret waiting.");
    // An adjustable-rate offer says so on the card even when the chosen sentence does not.
    expect(incentiveTeaser("Rates as low as 4.5% + $10,000 Flex Cash! Financing is a 5/1 ARM through the lender.")).toBe("Rates as low as 4.5% + $10,000 Flex Cash (adjustable rate).");
  });

  it("removes month-year, dashed, dotted, ISO and 'the 30th of' dates whole, and leaves loan-program fractions alone", () => {
    expect(incentiveTeaser("Rates as low as 4.99% (6.1% APR) valid through May 2026.")).toBe("Rates as low as 4.99% (6.1% APR).");
    expect(incentiveTeaser("Rates as low as 4.99% (6.1% APR) through the end of October 2026.")).toBe("Rates as low as 4.99% (6.1% APR).");
    expect(incentiveTeaser("Offer expires December 2026: 5.5% FHA rate on select homes.")).toBe("5.5% FHA rate on select homes.");
    expect(incentiveTeaser("5.5% FHA rate on select homes, must close by 11-30-2026.")).toBe("5.5% FHA rate on select homes.");
    expect(incentiveTeaser("5.5% FHA rate on select homes closing by 11.30.2026.")).toBe("5.5% FHA rate on select homes.");
    expect(incentiveTeaser("5.5% FHA rate on select homes until 2026-11-30.")).toBe("5.5% FHA rate on select homes.");
    expect(incentiveTeaser("5.5% FHA rate on select homes through the 30th of November.")).toBe("5.5% FHA rate on select homes.");
    expect(incentiveTeaser("Get a 2/1 buydown with a 1/0 option: 4.99% (6.1% APR) year one on 1/2 acre lots.")).toBe("Get a 2/1 buydown with a 1/0 option: 4.99% (6.1% APR) year one on 1/2 acre lots.");
    expect(incentiveTeaser("Year 1: 4.25% (6.051% APR). 5.25% (6.051% APR) for years 2-30.")).toBe("Year 1: 4.25% (6.051% APR).");
  });

  it("falls back to the first sentence when no sentence names a rate, and never runs long", () => {
    expect(incentiveTeaser("Up to $10,000 toward closing costs on select homes. Must close by 12/31/2026.")).toBe("Up to $10,000 toward closing costs on select homes.");
    expect(incentiveTeaser("")).toBe("");
    const long = incentiveTeaser(`Rates as low as 4.99% (6.2% APR) ${"on select move-in ready homes with the builder's lender and qualifying credit ".repeat(6)}today.`);
    expect(long.length).toBeLessThanOrEqual(TEASER_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(long).toContain("4.99%");
  });
});
