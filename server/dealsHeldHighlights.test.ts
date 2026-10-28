import { describe, expect, it } from "vitest";
import { HELD_INCENTIVE_PUBLIC_LINE, heldIncentiveHighlights, heldIncentiveLine } from "../shared/dealsHeldIncentive";

// Builder texts held for the rate review on Oct 28 (Peter: "yes show the incentives"); names are already scrubbed.
const openDoor = "Open Door Deal Sales Event Open Door Deal Enjoy our best deal of the year with rates as low as 3.99% with a 2-1 buydown on select homes! See a Home Sales Professional for details. Offer expires Oct. 31.";
const program321 = "Terms are based upon a loan with the following terms: Payment is for principal and interest only. Credit terms are based on a 30-year fixed mortgage. Purchase price of $253,840. 5.99% (APR 6.677%) 30-YR Fixed FHA loan 3.5% down payment required, and a 620 credit score. 3/2/1 Program includes a 3% decrease on the interest rate for year one.";
const unpack = "UNPACK YOUR BUYING POWER offers are here. Mortgage rates starting as low as 4.75% Reduced Sales Price Paid Closing Costs Paid Owners Title Policy Prepaid HOA Fees Customizable Move-in Package Upgraded RO Drinking Water Filtration Refrigerator Blinds";
const fixed = "5.49% (5.76% APR)* 30-Year Fixed. Choose a beautiful new quick move-in home now and qualify for a special 5.49 (5.76% APR)* 30-year fixed-rate mortgage with as little as 10% down. This offer is limited to select quick move-in homes eligible to close by December 28, 2026.";
const closing = "For a limited time, enjoy first-year rates as low as 3.25% Rate* with a temporary 2/1 Buydown or up to 3% in closing costs.";
const dollars = "Receive up to $10,000 in paid closing costs and half-off homesite premiums on select homes.";

describe("a held offer's highlights (Oct 28: show what it gives that is not a rate)", () => {
  it("names a buydown without its figures and keeps closing-cost help, in our own words", () => {
    expect(heldIncentiveHighlights(openDoor)).toEqual(["2-1 rate buydown"]);
    expect(heldIncentiveHighlights(program321)).toEqual(["3-2-1 rate buydown"]);
    expect(heldIncentiveHighlights(closing)).toEqual(["2-1 rate buydown", "Up to 3% toward closing costs"]);
    expect(heldIncentiveHighlights(dollars)).toEqual(["Up to $10,000 toward closing costs", "Half-off homesite premiums"]);
    expect(heldIncentiveHighlights(fixed)).toEqual(["Special financing"]);
    expect(heldIncentiveHighlights(unpack)).toEqual(["Special financing", "Paid closing costs", "Reduced prices"]);
  });

  it("writes one line with no rate, APR, payment, down payment or term in it", () => {
    for (const text of [openDoor, program321, unpack, fixed, closing, dollars]) {
      const line = heldIncentiveLine({ holdReason: JSON.stringify(["missing_apr"]), publicText: text });
      expect(line).toMatch(/^Builder incentive: .+ — ask us for details$/);
      expect(line).not.toMatch(/\d(?:\.\d+)?\s?%(?!\s+toward closing costs)/);
      expect(line).not.toMatch(/\bAPR\b|per month|down payment|\byears?\b|\$[\d,]+(?![\d,])(?! toward closing costs)/i);
    }
    expect(heldIncentiveLine({ holdReason: "[\"missing_apr\"]", publicText: openDoor })).toBe("Builder incentive: 2-1 rate buydown on select homes — ask us for details");
    expect(heldIncentiveLine({ holdReason: "[\"missing_apr\"]", publicText: dollars })).toBe("Builder incentive: Up to $10,000 toward closing costs and half-off homesite premiums on select homes — ask us for details");
  });

  it("counts the same dollars once, reads a choice as \"or\", and keeps mid-sentence parts lower case", () => {
    const flex = "Rates as low as 4.5% (6.43% APR) + $10,000 Flex Cash!* Use up to $10,000 toward closing costs on select quick move-in homes.";
    expect(heldIncentiveHighlights(flex)).toEqual(["Special financing", "$10,000 in flex cash"]);
    const choice = "Purchase a quick move-in home closing by 11/30 and choose a 5.25% Fixed-Rate or up to $55,000 in flex cash! The builder has locked in a buydown.";
    expect(heldIncentiveLine({ holdReason: "[\"missing_apr\"]", publicText: choice })).toBe("Builder incentive: Rate buydown or up to $55,000 in flex cash — ask us for details");
    const custom = "4.99% fixed rate FHA/VA financing or Up to $50,000 in Customized Incentives on select quick move-in homes.";
    expect(heldIncentiveLine({ holdReason: "[\"ambiguous_rate\"]", publicText: custom })).toBe("Builder incentive: Special financing or up to $50,000 in incentives on select homes — ask us for details");
  });

  it("keeps the neutral line for a private name, a manual override, an unread deadline, or nothing to name", () => {
    expect(heldIncentiveLine({ holdReason: JSON.stringify(["missing_apr", "missing_contract_deadline"]), publicText: dollars })).toBe(HELD_INCENTIVE_PUBLIC_LINE);
    expect(heldIncentiveLine({ holdReason: JSON.stringify(["ambiguous_rate", "private_text_remaining"]), publicText: closing })).toBe(HELD_INCENTIVE_PUBLIC_LINE);
    expect(heldIncentiveLine({ holdReason: JSON.stringify(["differs_from_manual_override"]), publicText: closing })).toBe(HELD_INCENTIVE_PUBLIC_LINE);
    expect(heldIncentiveLine({ holdReason: JSON.stringify(["missing_apr"]), publicText: "See a Home Sales Professional for details." })).toBe(HELD_INCENTIVE_PUBLIC_LINE);
    expect(heldIncentiveLine({ holdReason: null, publicText: null })).toBe(HELD_INCENTIVE_PUBLIC_LINE);
  });
});
