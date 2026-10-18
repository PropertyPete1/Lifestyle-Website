import { afterEach, describe, expect, it, vi } from "vitest";
import { builderDealsLeadMarker, formatChicagoDateTime, peterUserId, unionFubContactValues } from "./dealsFub";
import { notifyOwner } from "./_core/notification";

const savedKey = process.env.FUB_API_KEY;
const savedForgeUrl = process.env.BUILT_IN_FORGE_API_URL;
const savedForgeKey = process.env.BUILT_IN_FORGE_API_KEY;

afterEach(() => {
  if (savedKey === undefined) delete process.env.FUB_API_KEY; else process.env.FUB_API_KEY = savedKey;
  if (savedForgeUrl === undefined) delete process.env.BUILT_IN_FORGE_API_URL; else process.env.BUILT_IN_FORGE_API_URL = savedForgeUrl;
  if (savedForgeKey === undefined) delete process.env.BUILT_IN_FORGE_API_KEY; else process.env.BUILT_IN_FORGE_API_KEY = savedForgeKey;
  vi.restoreAllMocks();
});

describe("Builder Deals FUB contact preservation", () => {
  it("unions existing tags/contact values instead of replacing phone or email arrays", () => {
    const values = unionFubContactValues({ phones: [{ value: "+12105550123" }, { value: "210-555-9876" }], emails: [{ value: "OLD@example.com" }] }, { phone: "+12105550123", email: "new@example.com" });
    expect(values.phones).toEqual([{ value: "+12105550123" }, { value: "210-555-9876" }]);
    expect(values.emails).toEqual([{ value: "OLD@example.com" }, { value: "new@example.com" }]);
  });

  it("uses a stable opaque lead marker rather than a raw database id", () => {
    const marker = builderDealsLeadMarker(123);
    expect(marker).toMatch(/^BDL-[a-f0-9]{20}$/);
    expect(marker).not.toContain("123");
  });

  it("formats owner-facing request times in America/Chicago rather than UTC ISO", () => {
    expect(formatChicagoDateTime(new Date("2026-07-01T18:30:00.000Z"))).toContain("1:30 PM CDT");
  });
});

describe("Builder Deals Peter user lookup", () => {
  it("pages users and matches the exact email client-side instead of trusting an email query", async () => {
    process.env.FUB_API_KEY = "test-key";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ users: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, email: `user${i}@example.com` })) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ users: [{ id: 456, email: "PETER@lifestyledesignrealty.com" }] }), { status: 200 }));
    await expect(peterUserId()).resolves.toBe("456");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/users?limit=100&offset=0");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/users?limit=100&offset=100");
  });
});

describe("owner notification recipient limitation", () => {
  it("sends only the Manus project-owner notification payload; it has no email recipient or CC field", async () => {
    process.env.BUILT_IN_FORGE_API_URL = "https://forge.example/";
    process.env.BUILT_IN_FORGE_API_KEY = "test-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(notifyOwner({ title: "Builder Deals test", content: "Recipient routing test" })).resolves.toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ title: "Builder Deals test", content: "Recipient routing test" });
    expect(body).not.toHaveProperty("to");
    expect(body).not.toHaveProperty("cc");
  });
});
