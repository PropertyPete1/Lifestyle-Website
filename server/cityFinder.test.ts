import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

// Mock DB helpers so no live DB is touched
vi.mock("./db", () => ({
  createCityMatch: vi.fn(async () => undefined),
  getCityMatchBySlug: vi.fn(async (slug: string) => {
    if (slug === "known-slug") {
      return {
        id: 1,
        slug: "known-slug",
        answers: JSON.stringify({ budget: "300-500k", lifestyle: "lake-hill" }),
        rankedCities: JSON.stringify(["New Braunfels", "San Antonio", "Austin"]),
        narratives: JSON.stringify({
          "New Braunfels": { cityPitch: "Cached city pitch.", ldrPitch: "Cached LDR pitch." },
          "San Antonio": { cityPitch: "SA pitch.", ldrPitch: "SA LDR." },
          Austin: { cityPitch: "ATX pitch.", ldrPitch: "ATX LDR." },
        }),
        createdAt: new Date(),
      };
    }
    return undefined;
  }),
}));

// Mock AI generation — no live Anthropic calls in tests
vi.mock("./cityNarrative", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cityNarrative")>();
  return {
    ...actual,
    generateCityNarrative: vi.fn(async ({ city }: { city: string }) => ({
      cityPitch: `AI pitch for ${city}.`,
      ldrPitch: `LDR pitch for ${city}.`,
    })),
  };
});

import { appRouter } from "./routers";
import * as db from "./db";
import { generateCityNarrative, fallbackNarrative, CITY_DATA } from "./cityNarrative";
import { violatesCompliance } from "./partnerPitch";

function publicCtx(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: { clearCookie: () => undefined, cookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cityFinder.generate", () => {
  it("generates narratives for the top 3 cities and caches the result", async () => {
    const caller = appRouter.createCaller(publicCtx());
    const res = await caller.cityFinder.generate({
      answers: { budget: "300-500k", lifestyle: "lake-hill", household: "3-4" },
      rankedCities: ["New Braunfels", "San Antonio", "Austin"],
    });

    expect(res.slug).toBeTruthy();
    expect(res.slug.length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(res.narratives)).toEqual(["New Braunfels", "San Antonio", "Austin"]);
    expect(res.narratives["New Braunfels"].cityPitch).toContain("New Braunfels");
    expect(res.narratives["New Braunfels"].ldrPitch).toBeTruthy();

    // Cached in city_matches
    expect(db.createCityMatch).toHaveBeenCalledOnce();
    const saved = vi.mocked(db.createCityMatch).mock.calls[0][0];
    expect(saved.slug).toBe(res.slug);
    expect(JSON.parse(saved.rankedCities)).toEqual(["New Braunfels", "San Antonio", "Austin"]);
    expect(JSON.parse(saved.narratives)).toEqual(res.narratives);
  });

  it("caps generation at 3 cities even when more are sent", async () => {
    const caller = appRouter.createCaller(publicCtx());
    const res = await caller.cityFinder.generate({
      answers: { budget: "under-300k" },
      rankedCities: ["Houston", "San Antonio", "DFW", "Austin", "New Braunfels"],
    });
    expect(Object.keys(res.narratives)).toHaveLength(3);
    expect(generateCityNarrative).toHaveBeenCalledTimes(3);
  });

  it("falls back to templated copy when AI generation fails (never a broken result)", async () => {
    vi.mocked(generateCityNarrative).mockRejectedValueOnce(new Error("API down"));
    const caller = appRouter.createCaller(publicCtx());
    const res = await caller.cityFinder.generate({
      answers: { budget: "300-500k" },
      rankedCities: ["San Antonio", "Austin"],
    });
    // First city failed → fallback text; second succeeded → AI text
    expect(res.narratives["San Antonio"].cityPitch).toBeTruthy();
    expect(res.narratives["San Antonio"].ldrPitch).toContain("30 minutes");
    expect(res.narratives["Austin"].cityPitch).toBe("AI pitch for Austin.");
  });

  it("rejects empty rankedCities", async () => {
    const caller = appRouter.createCaller(publicCtx());
    await expect(
      caller.cityFinder.generate({ answers: {}, rankedCities: [] })
    ).rejects.toThrow();
  });
});

describe("cityFinder.getBySlug", () => {
  it("returns the identical cached result for a known slug (reproducible share links)", async () => {
    const caller = appRouter.createCaller(publicCtx());
    const res = await caller.cityFinder.getBySlug({ slug: "known-slug" });
    expect(res).not.toBeNull();
    expect(res!.slug).toBe("known-slug");
    expect(res!.rankedCities).toEqual(["New Braunfels", "San Antonio", "Austin"]);
    expect(res!.narratives["New Braunfels"].cityPitch).toBe("Cached city pitch.");
    expect(res!.answers.budget).toBe("300-500k");
    // Never regenerates
    expect(generateCityNarrative).not.toHaveBeenCalled();
  });

  it("returns null for an unknown slug", async () => {
    const caller = appRouter.createCaller(publicCtx());
    const res = await caller.cityFinder.getBySlug({ slug: "nope-nope" });
    expect(res).toBeNull();
  });
});

describe("cityNarrative helpers", () => {
  it("fallbackNarrative produces compliant copy for every market city", () => {
    for (const city of Object.keys(CITY_DATA)) {
      const fb = fallbackNarrative(city);
      expect(fb.cityPitch.length).toBeGreaterThan(20);
      expect(fb.ldrPitch).toContain("30 minutes");
      expect(violatesCompliance(fb.cityPitch)).toBe(false);
      expect(violatesCompliance(fb.ldrPitch)).toBe(false);
    }
  });

  it("fallbackNarrative handles an unknown city gracefully", () => {
    const fb = fallbackNarrative("Nowhere");
    expect(fb.cityPitch).toBeTruthy();
    expect(fb.ldrPitch).toBeTruthy();
  });

  it("compliance guard rejects rate/dollar mentions (guard shared with Convince Your Partner)", () => {
    expect(violatesCompliance("We can get you 3.99% rates")).toBe(true);
    expect(violatesCompliance("Homes from $300,000 here")).toBe(true);
    expect(violatesCompliance("A warm community with great parks and top schools.")).toBe(false);
  });
});
