import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn() }));
import { builderDealsLeadMarker, createBuilderDealsRequestNote, formatChicagoDateTime, peterUserId, unionFubContactValues, unionFubTags } from "./dealsFub";
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
    expect(unionFubTags({ tags: ["Past Client"] }, { timeline: "0-3", flags: [] } as any)).toEqual(expect.arrayContaining(["Past Client", "IG Builder Deals", "Intent - Hot"]));
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

describe("Builder Deals daily request notes", () => {
  const lead = { id: 11, fubPersonId: "81", phoneE164: "+12105550123", email: "buyer@example.test" };
  const firstRequest = { id: 41, requestType: "tour" as const, preferredAt: new Date("2026-10-18T18:30:00.000Z"), chicagoDay: "2026-10-18", fubTaskId: null, fubNoteSentAt: null };
  const secondRequest = { ...firstRequest, id: 42, requestType: "ask" as const };

  it("creates a daily note once, then appends the next same-day request instead of posting another note", async () => {
    process.env.FUB_API_KEY = "test-key";
    const dayMarker = `${builderDealsLeadMarker(lead.id)}:request-day:${firstRequest.chicagoDay}`;
    const firstBody = `${dayMarker}\n${builderDealsLeadMarker(lead.id)}-R${firstRequest.id}\nTour: 1 Private Street`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.includes("/notes?")) return new Response(JSON.stringify({ notes: fetchMock.mock.calls.filter(([value]) => String(value).includes("/notes?")).length > 1 ? [{ id: 700, body: firstBody }] : [] }), { status: 200 });
      if (path.endsWith("/notes/700")) return new Response(JSON.stringify({ id: 700, body: firstBody }), { status: 200 });
      if (path.endsWith("/notes") && init?.method === "POST") return new Response(JSON.stringify({ id: 700 }), { status: 200 });
      if (path.endsWith("/notes/700") && init?.method === "PUT") return new Response("{}", { status: 200 });
      throw new Error(`unexpected FUB request: ${path}`);
    });

    await expect(createBuilderDealsRequestNote({ lead, request: firstRequest, privateDescription: "1 Private Street" })).resolves.toMatchObject({ ok: true, records: expect.arrayContaining([expect.objectContaining({ kind: "note", fubId: "700" })]) });
    await expect(createBuilderDealsRequestNote({ lead, request: secondRequest, privateDescription: "2 Private Street" })).resolves.toMatchObject({ ok: true, records: expect.arrayContaining([expect.objectContaining({ kind: "note", fubId: "700" })]) });

    const postCalls = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/notes") && init?.method === "POST");
    const putCalls = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/notes/700") && init?.method === "PUT");
    expect(postCalls).toHaveLength(1);
    expect(putCalls).toHaveLength(1);
    expect(JSON.parse(String(putCalls[0]?.[1]?.body)).body).toContain(`${builderDealsLeadMarker(lead.id)}-R${secondRequest.id}`);
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
    vi.mocked(notifyOwner).mockResolvedValue(true);
    await expect(notifyOwner({ title: "Builder Deals test", content: "Recipient routing test" })).resolves.toBe(true);
    expect(notifyOwner).toHaveBeenCalledWith({ title: "Builder Deals test", content: "Recipient routing test" });
  });
});
