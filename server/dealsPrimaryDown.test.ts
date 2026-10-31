import { describe, expect, it } from "vitest";
import { primaryDownFrom } from "./dealsAdapters";

/** Oct 31, 2026 (Peter: a "master bed downstairs" filter like New Home Buddy's). Phrases from the builders' own pages. */
describe("primaryDownFrom: where one plan's primary bedroom is", () => {
  it("reads the builders' location fields", () => {
    expect(primaryDownFrom("1st Floor")).toBe(true); // Toll masterBedroomLocation
    expect(primaryDownFrom("2nd Floor")).toBe(false);
    expect(primaryDownFrom("Main Level")).toBe(true);
    expect(primaryDownFrom("Down")).toBe(true);
    expect(primaryDownFrom("Upstairs")).toBe(false);
    expect(primaryDownFrom(true)).toBe(true);
    expect(primaryDownFrom(false)).toBe(false);
    expect(primaryDownFrom(null)).toBeNull();
    expect(primaryDownFrom(2)).toBeNull();
  });

  it("finds a main-floor primary in a plan's own description", () => {
    expect(primaryDownFrom("A main-floor primary suite keeps you close to the action while still offering privacy.")).toBe(true); // Chesmar Shenandoah
    expect(primaryDownFrom(["Enjoy a secluded main-level owner's suite featuring a spa-style bath", "Luxurious first-floor primary suite "])).toBe(true); // Drees features
    expect(primaryDownFrom("1st-Floor Primary")).toBe(true); // Toll tag
    expect(primaryDownFrom("Downstairs primary suite offers a private bath and a walk-in closet")).toBe(true); // Ashton
    expect(primaryDownFrom("The owner’s retreat is located on the first floor.")).toBe(true);
    expect(primaryDownFrom("Master on main with a huge closet")).toBe(true);
    expect(primaryDownFrom("Primary down, game room up")).toBe(true);
  });

  it("finds an upstairs primary", () => {
    expect(primaryDownFrom("&nbsp;Upstairs, the primary suite features Shaw&reg; carpeting and a connecting bath")).toBe(false); // KB
    expect(primaryDownFrom("On the second floor, the owner's suite has a walk-in closet")).toBe(false); // Lennar
    expect(primaryDownFrom("A second-floor primary bedroom with a sitting area")).toBe(false);
    expect(primaryDownFrom("The primary suite is located upstairs.")).toBe(false);
  });

  it("stays out of it when the text does not say, says both, speaks of several plans or an option", () => {
    expect(primaryDownFrom("The primary suite features a spa-like bath and walk-in closet")).toBeNull(); // Chesmar, no floor
    expect(primaryDownFrom("the lavish primary suite and generous secondary bedrooms will be waiting")).toBeNull(); // Chesmar Cayman
    expect(primaryDownFrom("4-6 bedrooms, open-concept living, and first-floor primary suites")).toBeNull(); // Hakes community page
    expect(primaryDownFrom("dedicated studies, first-floor owner's suites, a secondary bedroom downstairs")).toBeNull(); // First America community page
    expect(primaryDownFrom("Optional first-floor primary suite available")).toBeNull();
    expect(primaryDownFrom("First-floor primary suite, with an optional second-floor primary suite")).toBe(true);
    expect(primaryDownFrom("First-floor primary suite or second-floor primary suite")).toBeNull();
    expect(primaryDownFrom("A master-planned community with a primary down payment program")).toBeNull();
    expect(primaryDownFrom("A secondary bedroom downstairs and a game room upstairs")).toBeNull();
  });
});
