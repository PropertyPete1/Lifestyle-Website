import { describe, expect, it } from "vitest";
import {
  CITY_IMAGERY,
  selectCityImage,
  vibeFromAnswers,
  type CityVibe,
} from "../shared/cityImagery";

/**
 * The result card and the /city-finder/:slug OG card both resolve imagery
 * through this module, so a regression here ships a mismatched share preview
 * or a broken image on a customer-facing result.
 */

const CITIES = ["San Antonio", "New Braunfels", "Austin", "DFW", "Houston"];

describe("manifest integrity", () => {
  it("covers every city the quiz can rank", () => {
    for (const c of CITIES) expect(CITY_IMAGERY[c], c).toBeDefined();
  });

  it("gives each city a default and 2-4 vibe slots", () => {
    for (const c of CITIES) {
      const entry = CITY_IMAGERY[c];
      expect(entry.default, c).toMatch(/^\/manus-storage\/.+\.(jpg|jpeg|png|webp)$/);
      expect(entry.slots.length, c).toBeGreaterThanOrEqual(2);
      expect(entry.slots.length, c).toBeLessThanOrEqual(4);
    }
  });

  it("never has an empty or non-absolute image path (would render broken)", () => {
    for (const c of CITIES) {
      for (const s of CITY_IMAGERY[c].slots) {
        expect(s.src, `${c}/${s.vibe}`).toMatch(/^\/manus-storage\/.+/);
        expect(s.label.length, `${c}/${s.vibe}`).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate vibe within a city (selection would be ambiguous)", () => {
    for (const c of CITIES) {
      const vibes = CITY_IMAGERY[c].slots.map((s) => s.vibe);
      expect(new Set(vibes).size, c).toBe(vibes.length);
    }
  });
});

describe("vibeFromAnswers", () => {
  it.each([
    ["schools", "family"],
    ["nightlife", "nightlife"],
    ["land", "outdoors"],
    ["commute", "skyline"],
    ["military", "family"],
    ["lake-hill", "outdoors"],
  ] as [string, CityVibe][])("maps lifestyle=%s to %s", (lifestyle, expected) => {
    expect(vibeFromAnswers({ lifestyle })).toBe(expected);
  });

  it("falls back to family for a larger household when lifestyle is unknown", () => {
    expect(vibeFromAnswers({ household: "3-4" })).toBe("family");
    expect(vibeFromAnswers({ household: "5-plus" })).toBe("family");
  });

  it("returns null when answers carry no usable signal", () => {
    expect(vibeFromAnswers({})).toBeNull();
    expect(vibeFromAnswers(undefined)).toBeNull();
    expect(vibeFromAnswers({ budget: "300-500k", household: "1-2" })).toBeNull();
  });

  it("prefers the explicit lifestyle answer over the household heuristic", () => {
    expect(vibeFromAnswers({ lifestyle: "nightlife", household: "5-plus" })).toBe("nightlife");
  });
});

describe("selectCityImage", () => {
  it("picks the slot matching the visitor's vibe", () => {
    const res = selectCityImage("Austin", { lifestyle: "nightlife" });
    expect(res.vibe).toBe("nightlife");
    expect(res.src).toBe(CITY_IMAGERY.Austin.slots.find((s) => s.vibe === "nightlife")!.src);
    expect(res.alt).toBe("Austin — music and food scene");
  });

  it("uses the Hill Country art for outdoors-minded visitors where it applies", () => {
    const res = selectCityImage("New Braunfels", { lifestyle: "lake-hill" });
    expect(res.vibe).toBe("outdoors");
    expect(res.src).toContain("area-boerne");
  });

  it("falls back to the city default when no vibe matches", () => {
    const res = selectCityImage("Houston", {});
    expect(res.vibe).toBeNull();
    expect(res.label).toBeNull();
    expect(res.src).toBe(CITY_IMAGERY.Houston.default);
    expect(res.alt).toBe("Houston");
  });

  it("falls back to the city default when the city has no slot for that vibe", () => {
    // DFW intentionally has no "outdoors" slot.
    expect(CITY_IMAGERY.DFW.slots.some((s) => s.vibe === "outdoors")).toBe(false);
    const res = selectCityImage("DFW", { lifestyle: "land" });
    expect(res.vibe).toBeNull();
    expect(res.src).toBe(CITY_IMAGERY.DFW.default);
  });

  it("never returns an empty src for an unknown city", () => {
    const res = selectCityImage("Nowhere, TX", { lifestyle: "schools" });
    expect(res.src).toMatch(/^\/manus-storage\/.+/);
    expect(res.vibe).toBeNull();
  });

  it("is deterministic — the OG card and the result card must agree", () => {
    const answers = { lifestyle: "commute", household: "3-4" };
    const a = selectCityImage("San Antonio", answers);
    const b = selectCityImage("San Antonio", answers);
    expect(a).toEqual(b);
  });

  it("resolves a real image for every city × every mapped lifestyle answer", () => {
    const lifestyles = ["schools", "nightlife", "land", "commute", "military", "lake-hill"];
    for (const city of CITIES) {
      for (const lifestyle of lifestyles) {
        const res = selectCityImage(city, { lifestyle });
        expect(res.src, `${city}/${lifestyle}`).toMatch(/^\/manus-storage\/.+/);
      }
    }
  });
});
