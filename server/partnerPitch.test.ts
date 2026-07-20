import { describe, expect, it } from "vitest";
import { fallbackPitch, matchCity, pickStats, violatesCompliance } from "./partnerPitch";

describe("violatesCompliance", () => {
  it("rejects percentages and dollar figures", () => {
    expect(violatesCompliance("rates as low as 4.99% today")).toBe(true);
    expect(violatesCompliance("homes from $350,000")).toBe(true);
  });
  it("rejects comparative affordability claims", () => {
    expect(violatesCompliance("a home that costs half what you'd pay elsewhere")).toBe(true);
    expect(violatesCompliance("twice the house for the money")).toBe(true);
    expect(violatesCompliance("living here for a fraction of the price")).toBe(true);
    expect(violatesCompliance("we can save you thousands on your move")).toBe(true);
    expect(violatesCompliance("with interest rates where they are")).toBe(true);
  });
  it("allows soft value language without numbers or comparisons", () => {
    expect(violatesCompliance("your paycheck goes further here")).toBe(false);
    expect(violatesCompliance("mornings on the lake and evenings on the porch")).toBe(false);
  });
});

describe("matchCity", () => {
  it("matches lake + hill country living to New Braunfels", () => {
    expect(matchCity(["Lake/Water Life", "Outdoor/Hill Country Living"])).toBe("New Braunfels");
  });
  it("matches nightlife to Austin", () => {
    expect(matchCity(["Nightlife & Food Scene"])).toBe("Austin");
  });
  it("matches schools to DFW", () => {
    expect(matchCity(["Top-Rated Schools"])).toBe("DFW");
  });
  it("defaults sensibly for low-tax picks", () => {
    expect(matchCity(["Low Taxes & Cost of Living"])).toBe("San Antonio");
  });
});

describe("pickStats", () => {
  it("ties stats to selections and caps at 2", () => {
    const stats = pickStats(
      ["Low Taxes & Cost of Living", "Top-Rated Schools", "Lake/Water Life"],
      "DFW"
    );
    expect(stats).toHaveLength(2);
    expect(stats[0]).toContain("no state income tax");
  });
  it("never returns an empty list", () => {
    expect(pickStats([], "Austin").length).toBeGreaterThan(0);
  });
});

describe("fallbackPitch", () => {
  it("includes partner name and city, and contains no rates", () => {
    const p = fallbackPitch({ selections: ["Space & Land"], partnerName: "Sam", city: "San Antonio" });
    expect(p).toContain("Sam");
    expect(p).toContain("San Antonio");
    expect(p).not.toMatch(/\d+(\.\d+)?%/);
  });
});

describe("ANTHROPIC_API_KEY validation (live)", () => {
  it(
    "authenticates and generates a short pitch via Claude",
    { timeout: 45000 },
    async () => {
      expect(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY must be set").toBeTruthy();
      const { generatePitch } = await import("./partnerPitch");
      const text = await generatePitch({
        selections: ["Lake/Water Life", "Family-Friendly Community"],
        partnerName: "Alex",
        city: "New Braunfels",
      });
      expect(text.length).toBeGreaterThan(40);
      // Compliance: no rates, dollar figures, or comparative affordability claims
      expect(violatesCompliance(text)).toBe(false);
    }
  );
});
