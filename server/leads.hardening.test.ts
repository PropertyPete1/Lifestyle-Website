/**
 * Lead-path hardening from the Sep 2026 audit:
 * - bookkeeping after a successful FUB send can never 500 the visitor (a 500
 *   → "try again" → a duplicate FUB contact for a lead already stored)
 * - `answers` is bounded so an anonymous caller cannot overflow the TEXT
 *   column (which fails the INSERT and loses the lead) or the FUB note
 * - corrupt cached rows on the share pages read as "not found", not 500
 * - City Finder only writes narratives for the five markets it knows
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const createLead = vi.fn(async () => 42);
const updateLead = vi.fn(async () => {});
const getVisitorActivity = vi.fn(async () => []);
const getPartnerPitchBySlug = vi.fn();
const getCityMatchBySlug = vi.fn();

vi.mock("./db", () => ({
  createLead: (...a: unknown[]) => createLead(...(a as [])),
  updateLead: (...a: unknown[]) => updateLead(...(a as [])),
  getVisitorActivity: (...a: unknown[]) => getVisitorActivity(...(a as [])),
  getPartnerPitchBySlug: (...a: unknown[]) => getPartnerPitchBySlug(...(a as [])),
  getCityMatchBySlug: (...a: unknown[]) => getCityMatchBySlug(...(a as [])),
  createCityMatch: vi.fn(async () => undefined),
}));
const sendToFub = vi.fn();
vi.mock("./fub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fub")>();
  return { ...actual, sendToFub: (...a: unknown[]) => sendToFub(...(a as [])) };
});
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn(async () => true) }));
vi.mock("./cityNarrative", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cityNarrative")>();
  return {
    ...actual,
    generateCityNarrative: vi.fn(async ({ city }: { city: string }) => ({ cityPitch: `p ${city}`, ldrPitch: "l" })),
  };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ctx = (): TrpcContext => ({
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
});

const base = {
  name: "Vitest Lead",
  email: "vitest@example.com",
  phone: "(555) 111-2222",
  sourceTag: "Website - Contact",
  tcpaConsent: true as const,
  answers: { timeline: "ASAP" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("leads.submit bookkeeping never costs the visitor", () => {
  it("succeeds even when the post-FUB status write fails (lead stored, FUB sent)", async () => {
    sendToFub.mockResolvedValue({ ok: true, fubId: "123" });
    updateLead.mockRejectedValueOnce(new Error("deadlock"));
    const res = await appRouter.createCaller(ctx()).leads.submit(base);
    expect(res.success).toBe(true);
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(sendToFub).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/status update failed/), expect.anything());
  });

  it("still fails loudly when the lead itself cannot be stored", async () => {
    createLead.mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(appRouter.createCaller(ctx()).leads.submit(base)).rejects.toThrow(/DB unavailable/);
    expect(sendToFub).not.toHaveBeenCalled();
  });
});

describe("leads.submit answers are bounded", () => {
  it("rejects more than 40 answer fields", async () => {
    const answers: Record<string, string> = {};
    for (let i = 0; i < 41; i++) answers[`k${i}`] = "v";
    await expect(appRouter.createCaller(ctx()).leads.submit({ ...base, answers })).rejects.toThrow(/at most 40/);
    expect(createLead).not.toHaveBeenCalled();
  });

  it("rejects a 2,000-character answer value", async () => {
    await expect(
      appRouter.createCaller(ctx()).leads.submit({ ...base, answers: { note: "x".repeat(2000) } })
    ).rejects.toThrow();
    expect(createLead).not.toHaveBeenCalled();
  });

  it("accepts every shape the live forms send (strings, numbers, arrays)", async () => {
    sendToFub.mockResolvedValue({ ok: true });
    const res = await appRouter.createCaller(ctx()).leads.submit({
      ...base,
      sourceTag: "Website - City Finder",
      answers: { budget: "300-500k", matchedCity: "Austin", cityFinderSlug: "abc", selections: ["a", "b"], n: 3 },
    });
    expect(res.success).toBe(true);
  });
});

describe("share pages with corrupt cached rows", () => {
  it("partnerPitch.getBySlug returns null instead of throwing", async () => {
    getPartnerPitchBySlug.mockResolvedValue({
      slug: "bad", city: "Austin", pitch: "p", partnerName: null, selections: "{not json", stats: "[]",
    });
    await expect(appRouter.createCaller(ctx()).partnerPitch.getBySlug({ slug: "bad" })).resolves.toBeNull();
  });

  it("partnerPitch.getBySlug returns null when only the stats column is corrupt", async () => {
    getPartnerPitchBySlug.mockResolvedValue({
      slug: "bad2", city: "Austin", pitch: "p", partnerName: null,
      selections: JSON.stringify(["Space & Land"]), stats: "[not json",
    });
    await expect(appRouter.createCaller(ctx()).partnerPitch.getBySlug({ slug: "bad2" })).resolves.toBeNull();
  });

  it("cityFinder.getBySlug returns null when only one of its columns is corrupt", async () => {
    for (const bad of ["answers", "rankedCities", "narratives"] as const) {
      const row = { slug: "b", answers: "{}", rankedCities: "[\"Austin\"]", narratives: "{}" };
      getCityMatchBySlug.mockResolvedValueOnce({ ...row, [bad]: "<html>" });
      await expect(appRouter.createCaller(ctx()).cityFinder.getBySlug({ slug: "b" })).resolves.toBeNull();
    }
  });

  it("cityFinder.getBySlug returns null instead of throwing", async () => {
    getCityMatchBySlug.mockResolvedValue({
      slug: "bad", answers: "{}", rankedCities: "[\"Austin\"]", narratives: "<html>",
    });
    await expect(appRouter.createCaller(ctx()).cityFinder.getBySlug({ slug: "bad" })).resolves.toBeNull();
  });

  it("a healthy row still round-trips", async () => {
    getPartnerPitchBySlug.mockResolvedValue({
      slug: "ok", city: "Austin", pitch: "p", partnerName: "Sam",
      selections: JSON.stringify({ picks: ["Space & Land"] }), stats: JSON.stringify(["s1"]),
    });
    const res = await appRouter.createCaller(ctx()).partnerPitch.getBySlug({ slug: "ok" });
    expect(res).toMatchObject({ slug: "ok", selections: ["Space & Land"], stats: ["s1"], partnerName: "Sam" });
  });
});

describe("cityFinder.generate input bounds", () => {
  it("refuses a city the narrative prompt does not know", async () => {
    await expect(
      appRouter.createCaller(ctx()).cityFinder.generate({ answers: { budget: "under-300k" }, rankedCities: ["Narnia" as never] })
    ).rejects.toThrow();
  });

  it("refuses oversized answers (prompt-injection / column-overflow surface)", async () => {
    const caller = appRouter.createCaller(ctx());
    await expect(
      caller.cityFinder.generate({ answers: { budget: "x".repeat(121) }, rankedCities: ["Austin"] })
    ).rejects.toThrow();
    const many: Record<string, string> = {};
    for (let i = 0; i < 13; i++) many[`q${i}`] = "a";
    await expect(caller.cityFinder.generate({ answers: many, rankedCities: ["Austin"] })).rejects.toThrow(/too many/);
  });

  it("accepts the real quiz payload", async () => {
    const res = await appRouter.createCaller(ctx()).cityFinder.generate({
      answers: { budget: "300-500k", monthlyComfort: "2000-3000", buildType: "either", lifestyle: "schools", household: "3-4", timeline: "ASAP" },
      rankedCities: ["DFW", "San Antonio", "Austin"],
    });
    expect(Object.keys(res.narratives)).toEqual(["DFW", "San Antonio", "Austin"]);
  });
});
