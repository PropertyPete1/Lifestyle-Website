import { describe, expect, it } from "vitest";
import { buildTag, computeIntent } from "./fub";

describe("computeIntent", () => {
  it("returns Hot for ASAP + pre-approved buyer", () => {
    expect(computeIntent({ timeline: "ASAP", preApproved: "Yes" })).toBe("Hot");
  });
  it("returns Warm for ASAP but not pre-approved", () => {
    expect(computeIntent({ timeline: "ASAP", preApproved: "Not yet" })).toBe("Warm");
  });
  it("returns Hot for ASAP seller (no preApproved field)", () => {
    expect(computeIntent({ timeline: "ASAP" })).toBe("Hot");
  });
  it("returns Warm for 3-6 months", () => {
    expect(computeIntent({ timeline: "3-6 months", preApproved: "No" })).toBe("Warm");
  });
  it("returns Cold for just browsing", () => {
    expect(computeIntent({ timeline: "Just browsing" })).toBe("Cold");
  });
  it("returns Hot for active license recruiting", () => {
    expect(computeIntent({ licenseStatus: "Licensed active" })).toBe("Hot");
  });
  it("returns Cold for not licensed", () => {
    expect(computeIntent({ licenseStatus: "Not licensed" })).toBe("Cold");
  });
  it("returns Unknown for no answers", () => {
    expect(computeIntent(undefined)).toBe("Unknown");
  });
});

describe("buildTag", () => {
  it("appends intent to source tag", () => {
    expect(buildTag("Website - Valuation", "Hot")).toEqual([
      "Website - Valuation",
      "Website - Valuation - Hot",
    ]);
  });
  it("omits intent tag when Unknown", () => {
    expect(buildTag("Website - Newsletter", "Unknown")).toEqual(["Website - Newsletter"]);
  });
});

describe("FUB API key validation", () => {
  it(
    "authenticates against the FUB identity endpoint",
    { timeout: 30000 },
    async () => {
      const apiKey = process.env.FUB_API_KEY;
      expect(apiKey, "FUB_API_KEY must be set").toBeTruthy();
      const res = await fetch("https://api.followupboss.com/v1/identity", {
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
          // FUB's CloudFront edge rejects requests without a User-Agent (403)
          "User-Agent": "LifestyleDesignRealty-Website/1.0",
        },
        signal: AbortSignal.timeout(25000),
      });
      expect(res.status).toBe(200);
    }
  );
});
