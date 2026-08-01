import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  EXIT_INTENT_EXCLUDED_PATHS,
  isExitIntentExcluded,
} from "../client/src/components/ExitIntentModal";

/**
 * REGRESSION LOCK — the exit-intent nudge must never appear on /links.
 *
 * /links is the Instagram link-in-bio landing page. It is deliberately a
 * no-brainer: one screen of tap targets, including a prominent "Find Your Texas
 * City" button. A modal asking that same question interrupted social traffic
 * before they had read the page, so the nudge is scoped out of the route.
 *
 * The nudge REMAINS active on the rest of the site, so these tests also pin
 * that the exclusion stays narrow.
 */

const MODAL = join(process.cwd(), "client", "src", "components", "ExitIntentModal.tsx");
const src = readFileSync(MODAL, "utf-8");
/** Source with comments stripped, so prose can't satisfy a check. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("exit-intent /links exclusion", () => {
  it("lists /links as an excluded path", () => {
    expect(EXIT_INTENT_EXCLUDED_PATHS).toContain("/links");
  });

  it.each(["/links", "/links/", "/links/anything"])("excludes %s", (path) => {
    expect(isExitIntentExcluded(path)).toBe(true);
  });

  it.each([
    "/",
    "/city-finder",
    "/convince",
    "/team",
    "/valuation",
    "/lease",
    "/join",
    "/testimonials",
  ])("still allows the nudge on %s", (path) => {
    expect(isExitIntentExcluded(path)).toBe(false);
  });

  it("does not match paths that merely start with the same letters", () => {
    // A future /linkspage route must not be caught by the /links rule.
    expect(isExitIntentExcluded("/linkspage")).toBe(false);
    expect(isExitIntentExcluded("/linked")).toBe(false);
  });

  it("reads the current route so the exclusion applies at runtime", () => {
    expect(code).toMatch(/useLocation/);
    expect(code).toMatch(/isExitIntentExcluded\(location\)/);
  });

  it("bails out of the listener effect on excluded routes", () => {
    // The mouseout listener must never be armed on /links, not merely have its
    // render suppressed — otherwise a show event would still be tracked.
    expect(code).toMatch(/if\s*\(excluded\)\s*return;/);
  });

  it("refuses to render while excluded even if state says open", () => {
    expect(code).toMatch(/!open\s*\|\|\s*excluded/);
  });

  it("keeps the exclusion narrow — only the link-in-bio route", () => {
    expect(EXIT_INTENT_EXCLUDED_PATHS).toHaveLength(1);
  });
});
