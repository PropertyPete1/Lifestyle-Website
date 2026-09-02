/**
 * Customer-facing copy may only claim what the code does.
 *
 * The Sep 2026 audit found four claims with no implementation behind them:
 * an "instant home valuation" (the page is a lead form a person answers), a
 * "valuation engine" on the recruiting page, an "AI scores intent … and
 * behavior" step (computeIntent is a rule over timeline / pre-approval /
 * license status), and a City Finder gate that asked "where to send" a report
 * that is only ever shown on screen. The AI narrative also pointed visitors at
 * "AI search" while that feature is gated off.
 *
 * This test scans the source so any of them coming back fails the build.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "../shared/site";
import { FALLBACK_LDR_PITCH, LIVE_TOOLS_LINE, fallbackNarrative } from "./cityNarrative";

const root = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf-8");

const RETIRED_CLAIMS: [string, RegExp][] = [
  ["client/src/pages/Valuation.tsx", /Instant (Home )?Valuation|Instant result/i],
  ["client/src/pages/Home.tsx", /Instant property valuation/i],
  ["client/src/components/TechShowcase.tsx", /Instant Market Insights|Live valuations/i],
  ["client/src/pages/Join.tsx", /valuation engine/i],
  ["client/src/components/LeadFlowDiagram.tsx", /AI Scores Intent|behavior score|tagged and assigned/i],
  ["client/src/pages/CityFinder.tsx", /where to send your personalized city report/i],
];

describe("retired claims stay retired", () => {
  for (const [file, pattern] of RETIRED_CLAIMS) {
    it(`${file} no longer says ${pattern}`, () => {
      expect(read(file)).not.toMatch(pattern);
    });
  }

  it("the valuation page describes a request a person answers", () => {
    const src = read("client/src/pages/Valuation.tsx");
    expect(src).toMatch(/Free Home Valuation/);
    expect(src).toMatch(/professional will prepare/);
  });

  it("the lead-flow diagram describes the real scoring inputs", () => {
    const src = read("client/src/components/LeadFlowDiagram.tsx");
    expect(src).toMatch(/Timeline, readiness, and license status/);
  });
});

describe("the AI narrative only names tools that are live", () => {
  it("drops AI search from the prompt and the fallback while property search is gated off", () => {
    if (FEATURES.SHOW_PROPERTY_SEARCH) {
      expect(LIVE_TOOLS_LINE).toContain("AI search");
      expect(FALLBACK_LDR_PITCH).toContain("AI-powered search");
    } else {
      expect(LIVE_TOOLS_LINE).not.toMatch(/AI search/i);
      expect(FALLBACK_LDR_PITCH).not.toMatch(/AI-powered search/i);
      for (const city of ["Austin", "Nowhere"]) {
        expect(fallbackNarrative(city).ldrPitch).not.toMatch(/AI-powered search/i);
      }
    }
    // The prompt text is built from the same constant.
    expect(read("server/cityNarrative.ts")).toContain("${LIVE_TOOLS_LINE}");
    // The 30-minute promise the rest of the site makes survives either way.
    expect(FALLBACK_LDR_PITCH).toContain("30 minutes");
  });
});

describe("admin CMS is code-split out of the public bundle", () => {
  it("App.tsx lazy-loads the Admin page", () => {
    const src = read("client/src/App.tsx");
    expect(src).toMatch(/lazy\(\(\) => import\("\.\/pages\/Admin"\)\)/);
    expect(src).not.toMatch(/^import Admin from/m);
    expect(src).toContain("<Suspense");
  });
});
