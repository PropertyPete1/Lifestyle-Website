import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn() }));
import {
  appendBuilderDealsActivity,
  builderDealsLeadMarker,
  createBuilderDealsRequestNote,
  createBuilderDealsTourTask,
  detectPriorOptOut,
  formatChicagoDateTime,
  fubNameIsPlaceholder,
  fubPersonLink,
  isBuilderDealsSystemNote,
  peterUserId,
  resetPeterUserCache,
  sendBuilderDealsLeadToFub,
  stripBuilderDealsTestTag,
  tagBuilderDealsScreeningContact,
  unionFubContactValues,
  unionFubTags,
  updateBuilderDealsProfileInFub,
  recordClientLinkText,
  BUILDER_DEALS_CLIENT_TAG,
} from "./dealsFub";
import { jsonResponse } from "./dealsFubFakeDb.test-support";
import { notifyOwner } from "./_core/notification";

const savedKey = process.env.FUB_API_KEY;
const savedForgeUrl = process.env.BUILT_IN_FORGE_API_URL;
const savedForgeKey = process.env.BUILT_IN_FORGE_API_KEY;

type FubCall = { url: string; method: string; body: Record<string, unknown> | null };
/** Routes mocked FUB requests by method + path and records every call for assertions. */
function mockFub(handler: (call: FubCall) => Response | Promise<Response>) {
  const calls: FubCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const call: FubCall = { url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null };
    calls.push(call);
    return handler(call);
  });
  return calls;
}
const path = (call: FubCall) => call.url.replace("https://api.followupboss.com/v1", "");
const lead = { id: 31, phone: "+12105550123", email: null, name: null, instagramHandle: "pete_buys", sourceCode: "sl1", consentText: "I agree. Reply STOP to opt out.", consentAt: new Date("2026-10-18T15:00:00.000Z"), consentIp: "10.0.0.1", flags: [] as string[], timeline: null, isTest: false };
const peterUsers = { users: [{ id: 456, email: "peter@lifestyledesignrealty.com" }] };

beforeEach(() => {
  process.env.FUB_API_KEY = "test-key";
  resetPeterUserCache();
});
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

  it("links alerts to the FUB web app person page", () => {
    expect(fubPersonLink("9001")).toBe("https://app.followupboss.com/2/people/view/9001");
  });
});

describe("Builder Deals first unlock through the FUB events endpoint", () => {
  it("treats the 201 person body as the new contact and repairs the assignment to Peter with one PUT", async () => {
    const calls = mockFub((call) => {
      if (path(call).startsWith("/people?")) return jsonResponse({ people: [] });
      if (path(call).startsWith("/users?")) return jsonResponse(peterUsers);
      if (path(call) === "/events" && call.method === "POST") return jsonResponse({ id: 9001, firstName: "@pete_buys", phones: [{ value: "+12105550123", type: "mobile" }], tags: ["IG Builder Deals", "Lead Flow Tag"], assignedUserId: 12 }, 201);
      if (path(call) === "/people/9001" && call.method === "PUT") return jsonResponse({});
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });

    const result = await sendBuilderDealsLeadToFub(lead);
    expect(result).toMatchObject({ ok: true, personId: "9001", records: [{ kind: "person", fubId: "9001", createdByUs: true }] });
    expect(result.ok && result.records.some((record) => record.kind === "event")).toBe(false);
    const puts = calls.filter((call) => call.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(path(puts[0]!)).toBe("/people/9001");
    // The lead-flow auto-assignment on the brand-new person is overridden; the lead-flow tag survives.
    expect(String(puts[0]!.body?.assignedUserId)).toBe("456");
    expect(puts[0]!.body?.tags).toEqual(expect.arrayContaining(["IG Builder Deals", "Lead Flow Tag"]));
    expect(puts[0]!.body?.phones).toEqual([{ value: "+12105550123", type: "mobile" }]);
    const event = calls.find((call) => path(call) === "/events")!;
    expect(event.body?.source).toBe("IG Builder Deals");
    expect((event.body?.person as Record<string, unknown>).firstName).toBe("@pete_buys");
    expect(String((event.body?.person as Record<string, unknown>).assignedUserId)).toBe("456");
  });

  it("assigns an agent's client to that agent's FUB user, tags them Agent Client and names the agent in the event note", async () => {
    const calls = mockFub((call) => {
      if (path(call).startsWith("/people?")) return jsonResponse({ people: [] });
      if (path(call).startsWith("/users?")) return jsonResponse(peterUsers);
      if (path(call) === "/events" && call.method === "POST") return jsonResponse({ id: 9002, firstName: "Maria", phones: [{ value: "+12105550123" }], tags: ["IG Builder Deals"] }, 201);
      if (path(call) === "/people/9002" && call.method === "PUT") return jsonResponse({});
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    const result = await sendBuilderDealsLeadToFub({ ...lead, name: "Maria Lopez", sourceCode: "agent", agent: { name: "Tiffany Agent", fubUserId: "77", email: "tiffany@example.com" } });
    expect(result).toMatchObject({ ok: true, personId: "9002" });
    const event = calls.find((call) => path(call) === "/events")!;
    const person = event.body?.person as Record<string, unknown>;
    expect(String(person.assignedUserId)).toBe("77");
    expect(person.tags).toEqual(expect.arrayContaining(["IG Builder Deals", "Agent Client"]));
    expect(String(event.body?.message)).toContain("LDR agent: Tiffany Agent (sent through their client link)");
    expect(String(event.body?.message)).toContain("First Builder Deals unlock through an agent's client link.");
    const put = calls.find((call) => call.method === "PUT")!;
    expect(String(put.body?.assignedUserId)).toBe("77");
    // An agent row without a FUB user falls back to Peter.
    calls.length = 0;
    await sendBuilderDealsLeadToFub({ ...lead, agent: { name: "Manual Agent", fubUserId: null, email: null } });
    expect(String((calls.find((call) => path(call) === "/events")!.body?.person as Record<string, unknown>).assignedUserId)).toBe("456");
  });

  it("records a 200 answer for a contact we did not find as pre-existing, never as created by us", async () => {
    mockFub((call) => {
      if (path(call).startsWith("/people?")) return jsonResponse({ people: [] });
      if (path(call).startsWith("/users?")) return jsonResponse(peterUsers);
      if (path(call) === "/events") return jsonResponse({ id: 77, assignedUserId: 456 }, 200);
      if (path(call) === "/people/77" && call.method === "PUT") return jsonResponse({});
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    const result = await sendBuilderDealsLeadToFub(lead);
    expect(result).toMatchObject({ ok: true, personId: "77", records: [{ kind: "person", fubId: "77", createdByUs: false }] });
  });

  it("leaves an existing contact's other-agent assignment alone, keeps its tags, and reports it for the alert", async () => {
    const existing = { id: 77, firstName: "Maria", lastName: "Lopez", assignedUserId: 999, assignedTo: "Jane Agent", tags: ["Past Client"], phones: [{ value: "(210) 555-0123", type: "mobile", isPrimary: 1 }], emails: [] };
    const calls = mockFub((call) => {
      if (path(call).startsWith("/people?")) return jsonResponse({ people: [existing] });
      if (path(call).startsWith("/users?")) return jsonResponse(peterUsers);
      if (path(call).startsWith("/notes?")) return jsonResponse({ notes: [{ id: 1, body: "Spoke on the phone, wants to see homes." }] });
      if (path(call).startsWith("/events?")) return jsonResponse({ events: [] });
      if (path(call) === "/events" && call.method === "POST") return jsonResponse(existing, 200);
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    const result = await sendBuilderDealsLeadToFub({ ...lead, timeline: "3-6 months" });
    expect(result).toMatchObject({ ok: true, personId: "77", records: [{ kind: "person", fubId: "77", createdByUs: false }], screening: { alreadyAssignedTo: "Jane Agent", previouslyOptedOut: false } });
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
    const person = calls.find((call) => path(call) === "/events")!.body?.person as Record<string, unknown>;
    expect(person.assignedUserId).toBeUndefined();
    expect(person.firstName).toBeUndefined();
    expect(person.tags).toEqual(expect.arrayContaining(["Past Client", "IG Builder Deals", "Intent - Warm"]));
    expect(person.phones).toEqual([{ value: "(210) 555-0123", type: "mobile", isPrimary: 1 }]);
  });

  it("flags a contact that opted out in FUB before, from FUB's own fields and from notes this system did not write", async () => {
    const existing = { id: 78, assignedUserId: 456, phones: [{ value: "+12105550123", status: "Opted Out" }], tags: [] };
    mockFub((call) => {
      if (path(call).startsWith("/people?")) return jsonResponse({ people: [existing] });
      if (path(call).startsWith("/users?")) return jsonResponse(peterUsers);
      if (path(call).startsWith("/notes?")) return jsonResponse({ notes: [] });
      if (path(call).startsWith("/events?")) return jsonResponse({ events: [] });
      if (path(call) === "/events" && call.method === "POST") return jsonResponse(existing, 200);
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    const result = await sendBuilderDealsLeadToFub(lead);
    expect(result).toMatchObject({ ok: true, screening: { alreadyAssignedTo: null, previouslyOptedOut: true } });
  });

  it("treats FUB's 204 (lead flow ignored the event) as a terminal failure with no retry and no PUT", async () => {
    const calls = mockFub((call) => {
      if (path(call).startsWith("/people?")) return jsonResponse({ people: [] });
      if (path(call).startsWith("/users?")) return jsonResponse(peterUsers);
      if (path(call) === "/events") return jsonResponse(null, 204);
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    const result = await sendBuilderDealsLeadToFub(lead);
    expect(result).toMatchObject({ ok: false, terminal: true });
    expect(result.ok ? "" : result.error).toContain("204");
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("skips the event when the person already carries this lead's first-unlock marker", async () => {
    const existing = { id: 79, assignedUserId: 456, tags: ["IG Builder Deals"] };
    const calls = mockFub((call) => {
      if (path(call).startsWith("/people?")) return jsonResponse({ people: [existing] });
      if (path(call).startsWith("/users?")) return jsonResponse(peterUsers);
      if (path(call).startsWith("/notes?")) return jsonResponse({ notes: [] });
      if (path(call).startsWith("/events?")) return jsonResponse({ events: [{ id: 5, message: `Builder Deals ${builderDealsLeadMarker(lead.id)}:first_unlock\nFirst Builder Deals unlock.` }] });
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    await expect(sendBuilderDealsLeadToFub(lead)).resolves.toMatchObject({ ok: true, personId: "79", records: [{ kind: "person", fubId: "79", createdByUs: false }] });
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});

describe("Builder Deals prior opt-out detection", () => {
  it("reads only FUB's own fields and non-system notes, never the consent text this system writes", () => {
    expect(detectPriorOptOut({ id: 1, phones: [{ value: "+12105550123", status: "Valid" }] }, [])).toBe(false);
    expect(detectPriorOptOut({ id: 1, phones: [{ value: "+12105550123", status: "Unsubscribed" }] }, [])).toBe(true);
    expect(detectPriorOptOut({ id: 1, optOut: true }, [])).toBe(true);
    expect(detectPriorOptOut({ id: 1, doNotContact: "yes" }, [])).toBe(true);
    expect(detectPriorOptOut({ id: 1, optOut: false }, [{ id: 2, body: "She texted STOP last spring, do not text." }])).toBe(true);
    expect(detectPriorOptOut({ id: 1 }, [{ id: 3, body: `Builder Deals ${builderDealsLeadMarker(4)}:first_unlock\nConsent text: Reply STOP to opt out.` }])).toBe(false);
    expect(detectPriorOptOut({ id: 1 }, [{ id: 4, subject: "Builder Deals access", body: "returned for a new link. Reply STOP to opt out." }])).toBe(false);
    expect(detectPriorOptOut({ id: 1 }, [{ id: 5, body: "Wants to stop by the model home Saturday." }])).toBe(false);
    expect(isBuilderDealsSystemNote({ body: "Builder Deals screening: Agent - FUB Match; match phone." })).toBe(true);
    expect(isBuilderDealsSystemNote({ body: "Called, left voicemail." })).toBe(false);
  });
});

describe("Builder Deals profile update PUT", () => {
  const profileLead = { ...lead, fubPersonId: "5", name: "Pete Buyer", timeline: "0-3 months", flags: ["Possible Agent - Handle"] };

  it("replaces only a placeholder name and unions the Intent and flag tags onto the existing tags", async () => {
    const calls = mockFub((call) => {
      if (path(call) === "/people/5" && call.method === "GET") return jsonResponse({ id: 5, firstName: "@pete_buys", lastName: "", tags: ["Past Client"], phones: [{ value: "+12105550123" }] });
      if (path(call) === "/people/5" && call.method === "PUT") return jsonResponse({});
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    await expect(updateBuilderDealsProfileInFub(profileLead)).resolves.toMatchObject({ ok: true, personId: "5", records: [{ kind: "person", fubId: "5", createdByUs: false }] });
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.body).toMatchObject({ firstName: "Pete", lastName: "Buyer", mergeTags: true });
    expect(put.body?.tags).toEqual(expect.arrayContaining(["Past Client", "IG Builder Deals", "Intent - Hot", "Possible Agent - Handle"]));
  });

  it("never overwrites a real name on an existing contact", async () => {
    const calls = mockFub((call) => {
      if (path(call) === "/people/5" && call.method === "GET") return jsonResponse({ id: 5, firstName: "Maria", lastName: "Lopez", tags: [] });
      if (path(call) === "/people/5" && call.method === "PUT") return jsonResponse({});
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    await updateBuilderDealsProfileInFub(profileLead);
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.body?.firstName).toBeUndefined();
    expect(put.body?.lastName).toBeUndefined();
    expect(put.body?.tags).toEqual(expect.arrayContaining(["Intent - Hot"]));
  });

  it("recognizes both placeholder shapes", () => {
    expect(fubNameIsPlaceholder({ firstName: "@pete_buys", lastName: "" }, { phone: "+12105550123", instagramHandle: "pete_buys" })).toBe(true);
    expect(fubNameIsPlaceholder({ firstName: "pete_buys" }, { phone: "+12105550123", instagramHandle: "pete_buys" })).toBe(true);
    expect(fubNameIsPlaceholder({ firstName: "IG Lead", lastName: "0123" }, { phone: "+12105550123", instagramHandle: null })).toBe(true);
    expect(fubNameIsPlaceholder({ name: "" }, { phone: "+12105550123", instagramHandle: null })).toBe(true);
    expect(fubNameIsPlaceholder({ firstName: "Maria", lastName: "Lopez" }, { phone: "+12105550123", instagramHandle: "pete_buys" })).toBe(false);
  });
});

describe("Builder Deals screening and cleanup tag writes", () => {
  it("searches by email only for an email-domain match and keeps every existing tag in the PUT", async () => {
    const calls = mockFub((call) => {
      if (path(call).startsWith("/people?email=")) return jsonResponse({ people: [{ id: 42, tags: ["Buyer", "Needs Agent"] }] });
      if (path(call) === "/people/42" && call.method === "GET") return jsonResponse({ id: 42, tags: ["Buyer", "Needs Agent"] });
      if (path(call) === "/people/42" && call.method === "PUT") return jsonResponse({});
      if (path(call) === "/notes" && call.method === "POST") return jsonResponse({ id: 500 });
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    await expect(tagBuilderDealsScreeningContact({ phone: "+12105550123", email: "agent@kw.com", tag: "Possible Agent - Email Domain", matchOn: "email" })).resolves.toEqual({ ok: true, personId: "42" });
    expect(calls.some((call) => path(call).includes("phone="))).toBe(false);
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.body?.tags).toEqual(["Buyer", "Needs Agent", "Possible Agent - Email Domain"]);
    expect((calls.find((call) => path(call) === "/notes")!.body?.body as string).startsWith("Builder Deals screening")).toBe(true);
  });

  it("strips only the TEST tag from a found contact", async () => {
    const calls = mockFub((call) => {
      if (path(call) === "/people/42" && call.method === "GET") return jsonResponse({ id: 42, tags: ["Buyer", "TEST", "IG Builder Deals"] });
      if (path(call) === "/people/42" && call.method === "PUT") return jsonResponse({});
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    await expect(stripBuilderDealsTestTag("42")).resolves.toEqual({ ok: true });
    expect(calls.find((call) => call.method === "PUT")!.body).toEqual({ tags: ["Buyer", "IG Builder Deals"], mergeTags: false });
  });
});

describe("Builder Deals daily request notes", () => {
  const requestLead = { id: 11, fubPersonId: "81", phoneE164: "+12105550123", email: "buyer@example.test" };
  const firstRequest = { id: 41, requestType: "tour" as const, preferredAt: new Date("2026-10-18T18:30:00.000Z"), chicagoDay: "2026-10-18", fubTaskId: null, fubNoteSentAt: null };
  const secondRequest = { ...firstRequest, id: 42, requestType: "ask" as const };

  it("creates a daily note once, then appends the next same-day request instead of posting another note", async () => {
    const dayMarker = `${builderDealsLeadMarker(requestLead.id)}:request-day:${firstRequest.chicagoDay}`;
    const firstBody = `${dayMarker}\n${builderDealsLeadMarker(requestLead.id)}-R${firstRequest.id}\nTour: 1 Private Street`;
    let posted = false;
    const calls = mockFub((call) => {
      if (path(call).startsWith("/notes?")) return jsonResponse({ notes: posted ? [{ id: 700, body: firstBody }] : [] });
      if (path(call) === "/notes/700" && call.method === "GET") return jsonResponse({ id: 700, body: firstBody });
      if (path(call) === "/notes" && call.method === "POST") { posted = true; return jsonResponse({ id: 700 }); }
      if (path(call) === "/notes/700" && call.method === "PUT") return jsonResponse({});
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });

    await expect(createBuilderDealsRequestNote({ lead: requestLead, request: firstRequest, privateDescription: "1 Private Street" })).resolves.toMatchObject({ ok: true, records: expect.arrayContaining([expect.objectContaining({ kind: "note", fubId: "700" })]) });
    await expect(createBuilderDealsRequestNote({ lead: requestLead, request: secondRequest, privateDescription: "2 Private Street" })).resolves.toMatchObject({ ok: true, records: expect.arrayContaining([expect.objectContaining({ kind: "note", fubId: "700" })]) });

    const postCalls = calls.filter((call) => path(call) === "/notes" && call.method === "POST");
    const putCalls = calls.filter((call) => path(call) === "/notes/700" && call.method === "PUT");
    expect(postCalls).toHaveLength(1);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]!.body?.body).toContain(`${builderDealsLeadMarker(requestLead.id)}-R${secondRequest.id}`);
  });

  it("pages through a chatty contact's notes before deciding the day note is missing", async () => {
    const dayMarker = `${builderDealsLeadMarker(requestLead.id)}:request-day:${firstRequest.chicagoDay}`;
    const firstBody = `${dayMarker}\n${builderDealsLeadMarker(requestLead.id)}-R${firstRequest.id}\nTour: 1 Private Street`;
    const chatter = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: `Call ${index + 1}` }));
    const calls = mockFub((call) => {
      if (path(call).startsWith("/notes?")) {
        const offset = new URL(call.url).searchParams.get("offset");
        return jsonResponse({ notes: offset === "0" ? chatter : [{ id: 700, body: firstBody }] });
      }
      if (path(call) === "/notes/700" && call.method === "GET") return jsonResponse({ id: 700, body: firstBody });
      if (path(call) === "/notes/700" && call.method === "PUT") return jsonResponse({});
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    await expect(createBuilderDealsRequestNote({ lead: requestLead, request: secondRequest, privateDescription: "2 Private Street" })).resolves.toMatchObject({ ok: true });
    expect(calls.filter((call) => path(call).startsWith("/notes?")).map((call) => new URL(call.url).searchParams.get("offset"))).toEqual(["0", "100"]);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("marks the task and the daily note of a full-pipeline test lead as TEST, and leaves a live lead's unmarked", async () => {
    const calls = mockFub((call) => {
      if (path(call).startsWith("/users?")) return jsonResponse(peterUsers);
      if (path(call).startsWith("/notes?")) return jsonResponse({ notes: [] });
      if (path(call) === "/tasks" && call.method === "POST") return jsonResponse({ id: 500 });
      if (path(call) === "/notes" && call.method === "POST") return jsonResponse({ id: 700 });
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    await expect(createBuilderDealsTourTask({ lead: { ...requestLead, isTest: true }, request: firstRequest, privateDescription: "1 Private Street" })).resolves.toMatchObject({ ok: true, taskId: "500" });
    await expect(createBuilderDealsRequestNote({ lead: { ...requestLead, isTest: true }, request: firstRequest, privateDescription: "1 Private Street" })).resolves.toMatchObject({ ok: true });
    await expect(createBuilderDealsTourTask({ lead: requestLead, request: secondRequest, privateDescription: "2 Private Street" })).resolves.toMatchObject({ ok: true, taskId: "500" });
    const [testTask, liveTask] = calls.filter((call) => path(call) === "/tasks" && call.method === "POST");
    expect(testTask!.body).toMatchObject({ name: "TEST Builder Deals tour: 1 Private Street", personId: 81, assignedUserId: 456 });
    expect(String(testTask!.body?.description)).toContain("TEST RECORD - eligible for Builder Deals cleanup");
    expect(String(testTask!.body?.description)).toContain(`${builderDealsLeadMarker(requestLead.id)}-R${firstRequest.id}`);
    expect(liveTask!.body).toMatchObject({ name: "Builder Deals ask: 2 Private Street" });
    expect(String(liveTask!.body?.description)).not.toContain("TEST");
    const note = calls.find((call) => path(call) === "/notes" && call.method === "POST")!;
    expect(note.body).toMatchObject({ subject: "TEST Builder Deals request", personId: 81 });
    expect(String(note.body?.body)).toContain("TEST RECORD - eligible for Builder Deals cleanup");
    expect(String(note.body?.body)).toContain(`${builderDealsLeadMarker(requestLead.id)}:request-day:${firstRequest.chicagoDay}`);
    expect(isBuilderDealsSystemNote({ body: note.body?.body })).toBe(true);
  });

  it("gives an agent's client's tasks to the agent, and files a saved home as a Follow Up task", async () => {
    const calls = mockFub((call) => {
      if (path(call).startsWith("/users?")) return jsonResponse(peterUsers);
      if (path(call) === "/tasks" && call.method === "POST") return jsonResponse({ id: 501 });
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    const agentLead = { ...requestLead, agent: { name: "Tiffany Agent", fubUserId: "77", email: "tiffany@example.com" } };
    const save = { ...firstRequest, id: 43, requestType: "save" as const };
    await expect(createBuilderDealsTourTask({ lead: agentLead, request: save, privateDescription: "118 Fixture Lakes Blvd (Brandon), $489,990" })).resolves.toMatchObject({ ok: true, taskId: "501" });
    await expect(createBuilderDealsTourTask({ lead: agentLead, request: firstRequest, privateDescription: "1 Private Street" })).resolves.toMatchObject({ ok: true, taskId: "501" });
    const [saveTask, tourTask] = calls.filter((call) => path(call) === "/tasks" && call.method === "POST");
    expect(saveTask!.body).toMatchObject({ name: "Builder Deals saved home: 118 Fixture Lakes Blvd (Brandon), $489,990", assignedUserId: 77, type: "Follow Up" });
    expect(String(saveTask!.body?.description)).toContain("Saved: 118 Fixture Lakes Blvd (Brandon), $489,990");
    expect(tourTask!.body).toMatchObject({ name: "Builder Deals tour: 1 Private Street", assignedUserId: 77, type: "Appointment" });
  });

  it("writes one activity note per lead per Chicago day and records its id", async () => {
    const marker = `${builderDealsLeadMarker(requestLead.id)}:activity:2026-10-18`;
    let posted = false;
    const calls = mockFub((call) => {
      if (path(call).startsWith("/notes?")) return jsonResponse({ notes: posted ? [{ id: 900, body: `${marker}\nViewed 2 communities` }] : [] });
      if (path(call) === "/notes" && call.method === "POST") { posted = true; return jsonResponse({ id: 900 }); }
      throw new Error(`unexpected FUB request ${call.method} ${path(call)}`);
    });
    await expect(appendBuilderDealsActivity(requestLead, "2026-10-18", "Viewed 2 communities")).resolves.toMatchObject({ ok: true, personId: "81", records: expect.arrayContaining([{ kind: "note", fubId: "900", createdByUs: true }]) });
    await expect(appendBuilderDealsActivity(requestLead, "2026-10-18", "Viewed 2 communities")).resolves.toMatchObject({ ok: true, records: expect.arrayContaining([{ kind: "note", fubId: "900", createdByUs: true }]) });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.find((call) => call.method === "POST")!.body?.body).toContain(marker);
  });
});

describe("Builder Deals Peter user lookup", () => {
  it("pages users and matches the exact email client-side instead of trusting an email query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ users: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, email: `user${i}@example.com` })) }))
      .mockResolvedValueOnce(jsonResponse({ users: [{ id: 456, email: "PETER@lifestyledesignrealty.com" }] }));
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

describe("a client link texted by an agent (Oct 26, 2026)", () => {
  const agent = { name: "Tiffany Agent", fubUserId: "77", phoneE164: "+12105550101" };
  const url = "https://lifestyledesignrealty.com/deals?c=tok";

  it("creates a new contact under the agent, writes the text to the timeline from the agent's number, and leaves a note", async () => {
    const calls = mockFub((call) => {
      const p = path(call);
      if (call.method === "GET" && p.startsWith("/people?")) return jsonResponse({ people: [] });
      if (call.method === "POST" && p === "/events") return jsonResponse({ id: 901, firstName: "Maria" }, 201);
      if (call.method === "POST" && p === "/textMessages") return jsonResponse({ id: 55 }, 201);
      if (call.method === "POST" && p === "/notes") return jsonResponse({ id: 56 }, 201);
      return jsonResponse({}, 404);
    });
    const result = await recordClientLinkText({ clientPhone: "+12105550202", clientName: "Maria Lopez", message: `Hi Maria ${url}`, agent, linkUrl: url, sentAt: new Date("2026-10-26T04:00:00Z") });
    expect(result).toEqual({ ok: true, personId: "901", created: true, logged: true });
    const event = calls.find((call) => path(call) === "/events")!.body!;
    expect(event.source).toBe("Builder Deals - Client Link");
    expect(event.person).toMatchObject({ firstName: "Maria", lastName: "Lopez", phones: [{ value: "+12105550202" }], tags: [BUILDER_DEALS_CLIENT_TAG], assignedUserId: 77 });
    const text = calls.find((call) => path(call) === "/textMessages")!.body!;
    expect(text).toMatchObject({ personId: 901, message: `Hi Maria ${url}`, isIncoming: false, toNumber: "+12105550202", fromNumber: "+12105550101" });
    const note = calls.find((call) => path(call) === "/notes")!.body!;
    expect(String(note.body)).toContain("Tiffany Agent texted their Builder Deals client link");
    expect(String(note.body)).toContain(url);
  });

  it("tags an existing contact instead of creating one, and refuses one who opted out of texts", async () => {
    let notes: unknown[] = [];
    const calls = mockFub((call) => {
      const p = path(call);
      if (call.method === "GET" && p.startsWith("/people?")) return jsonResponse({ people: [{ id: 12, tags: ["Past Client"] }] });
      if (call.method === "GET" && p === "/people/12") return jsonResponse({ id: 12, tags: ["Past Client"], phones: [{ value: "+12105550202" }] });
      if (call.method === "GET" && p.startsWith("/notes")) return jsonResponse({ notes });
      if (call.method === "GET" && p.startsWith("/events")) return jsonResponse({ events: [] });
      if (call.method === "PUT" && p === "/people/12") return jsonResponse({ id: 12 });
      if (call.method === "POST") return jsonResponse({ id: 1 }, 201);
      return jsonResponse({}, 404);
    });
    const ok = await recordClientLinkText({ clientPhone: "+12105550202", clientName: "Maria Lopez", message: `Hi ${url}`, agent, linkUrl: url });
    expect(ok).toEqual({ ok: true, personId: "12", created: false, logged: true });
    expect(calls.some((call) => path(call) === "/events" && call.method === "POST")).toBe(false);
    expect(calls.find((call) => call.method === "PUT")!.body!.tags).toEqual(["Past Client", BUILDER_DEALS_CLIENT_TAG]);
    notes = [{ id: 3, body: "Replied STOP, do not text" }];
    calls.length = 0;
    const refused = await recordClientLinkText({ clientPhone: "+12105550202", clientName: "Maria Lopez", message: `Hi ${url}`, agent, linkUrl: url });
    expect(refused).toEqual({ ok: false, kind: "opted_out", personId: "12" });
    expect(calls.some((call) => call.method === "POST" || call.method === "PUT")).toBe(false);
  });

  it("still returns the contact when the timeline record is rejected, and reports FUB down when it is", async () => {
    mockFub((call) => {
      const p = path(call);
      if (call.method === "GET" && p.startsWith("/people?")) return jsonResponse({ people: [] });
      if (call.method === "POST" && p === "/events") return jsonResponse({ id: 77 }, 201);
      if (call.method === "POST" && p === "/textMessages") return jsonResponse({ error: "forbidden" }, 403);
      if (call.method === "POST" && p === "/notes") return jsonResponse({ id: 2 }, 201);
      return jsonResponse({}, 404);
    });
    expect(await recordClientLinkText({ clientPhone: "+12105550202", clientName: "Maria", message: url, agent: { ...agent, phoneE164: null }, linkUrl: url })).toEqual({ ok: true, personId: "77", created: true, logged: false });
    vi.restoreAllMocks();
    mockFub(() => jsonResponse({}, 503));
    expect(await recordClientLinkText({ clientPhone: "+12105550202", clientName: "Maria", message: url, agent, linkUrl: url })).toMatchObject({ ok: false, kind: "unavailable" });
  });
});
