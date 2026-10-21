import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getDealSettings: vi.fn(), revokeNonTeamMatchingDealLinks: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsService", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsService")>()), getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args) }));
vi.mock("./dealsEligibility", () => ({ revokeNonTeamMatchingDealLinks: (...args: unknown[]) => mocks.revokeNonTeamMatchingDealLinks(...args) }));

import { dealJobRuns, dealKnownAgents } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import { jsonResponse } from "./dealsFubFakeDb.test-support";
import { KNOWN_AGENT_SYNC_BUDGET_MS, retryAfterMs, syncKnownAgentsFromFub } from "./dealsKnownAgents";

/**
 * The nightly FUB known-agent mirror against a large account: FUB answers 429 with Retry-After when a limit is spent
 * (notes allow 10 requests per 10 seconds), and the run lives inside one cron request. These tests drive a fake clock:
 * every FUB answer takes one second, and every wait the sync asks for moves the clock instead of sleeping.
 */
const settings = { textLine: "(512) 542-1477", testNumbers: [], fubRealtorTags: ["Recruit"], fubRealtorSources: [] };
const recruit = (id: number) => ({ id, name: `Recruit ${id}`, tags: ["Recruit - Website"], phones: [{ value: `(210) 555-${String(1000 + id).slice(-4)}` }] });

let db: FakeDealsDb;
let now: number;
let sleeps: number[];
const clock = () => now;
const sleep = async (ms: number) => { sleeps.push(ms); now += ms; };
type Answer = Response | ((url: URL) => Response);

let fetchSpy: { mockRestore: () => void } | null = null;
function mockFub(handlers: { people: Answer | Answer[]; users?: Answer; notes?: (url: URL) => Response }) {
  fetchSpy?.mockRestore();
  const peopleQueue = Array.isArray(handlers.people) ? [...handlers.people] : null;
  const urls: URL[] = [];
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    now += 1_000;
    const answer = (value: Answer) => (typeof value === "function" ? value(url) : value.clone());
    if (url.pathname.endsWith("/people")) return answer(peopleQueue ? (peopleQueue.length > 1 ? peopleQueue.shift()! : peopleQueue[0]!) : handlers.people as Answer);
    if (url.pathname.endsWith("/users")) return answer(handlers.users ?? jsonResponse({ users: [] }));
    if (url.pathname.endsWith("/notes")) return handlers.notes ? handlers.notes(url) : jsonResponse({ notes: [] });
    throw new Error(`unexpected FUB request ${url}`);
  });
  return urls;
}

const rateLimited = (retryAfter: string | null, context = "global") => new Response("", { status: 429, headers: { ...(retryAfter === null ? {} : { "retry-after": retryAfter }), "x-ratelimit-context": context } });

beforeEach(() => {
  db = new FakeDealsDb();
  now = Date.parse("2026-10-21T06:45:00Z");
  sleeps = [];
  mocks.getDb.mockResolvedValue(db);
  mocks.getDealSettings.mockResolvedValue(settings);
  mocks.revokeNonTeamMatchingDealLinks.mockResolvedValue(0);
  vi.stubEnv("FUB_API_KEY", "test-key");
});
afterEach(() => { fetchSpy?.mockRestore(); fetchSpy = null; vi.unstubAllEnvs(); });

describe("known-agent sync against FUB rate limits and the cron time limit", () => {
  it("reads Retry-After in seconds or as a date", () => {
    expect(retryAfterMs("7")).toBe(7_000);
    expect(retryAfterMs(new Date(Date.parse("2026-10-21T06:45:12Z")).toUTCString(), Date.parse("2026-10-21T06:45:00Z"))).toBe(12_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });

  it("waits what a 429's Retry-After says and resends, instead of failing the whole night on one busy page", async () => {
    const urls = mockFub({ people: [rateLimited("7"), jsonResponse({ people: [recruit(101)] })] });
    const result = await syncKnownAgentsFromFub({ clock, sleep });
    expect(result).toMatchObject({ ok: true, peopleFetched: 1, recruitTagged: 1, upserted: 1, rateLimited: 1, notesDeferred: 0 });
    expect(sleeps).toContain(7_000);
    expect(urls.filter((url) => url.pathname.endsWith("/people"))).toHaveLength(2);
    expect(db.rows(dealKnownAgents)).toEqual([expect.objectContaining({ phoneE164: "+12105551101", source: "fub_recruit", fubPersonId: "101" })]);
  });

  it("gives up after a few 429s with a precise reason (page, tries, Retry-After, context), changing nothing", async () => {
    mockFub({ people: rateLimited("20") });
    const result = await syncKnownAgentsFromFub({ clock, sleep });
    expect(result).toMatchObject({ ok: false, reason: "fub_rate_limited", detail: expect.stringMatching(/^\/people page 1 \(0 read so far\): \/people: HTTP 429 after 5 tries \(Retry-After 20, context global\); scan: 0 people in 0 pages and 1 users page, \d+s of a 180s scan budget$/) });
    expect(sleeps).toEqual([20_000, 20_000, 20_000, 20_000]);
    expect(db.rows(dealKnownAgents)).toEqual([]);
  });

  it("retries a gateway error, and names the status of one that persists", async () => {
    mockFub({ people: [new Response("", { status: 503 }), jsonResponse({ people: [recruit(101)] })] });
    expect(await syncKnownAgentsFromFub({ clock, sleep })).toMatchObject({ ok: true, upserted: 1 });
    mockFub({ people: new Response("", { status: 503 }) });
    expect(await syncKnownAgentsFromFub({ clock, sleep })).toMatchObject({ ok: false, reason: "fub_unavailable", detail: expect.stringContaining("HTTP 503") });
    mockFub({ people: new Response("", { status: 401 }) });
    expect(await syncKnownAgentsFromFub({ clock, sleep })).toMatchObject({ ok: false, reason: "fub_auth_failed" });
  });

  it("paces the notes pass by FUB's X-RateLimit headers instead of drawing 429s", async () => {
    let remaining = 3;
    mockFub({
      people: jsonResponse({ people: [recruit(101), recruit(102), recruit(103)] }),
      notes: () => { remaining = Math.max(0, remaining - 1); return new Response(JSON.stringify({ notes: [] }), { status: 200, headers: { "content-type": "application/json", "x-ratelimit-remaining": String(remaining), "x-ratelimit-window": "10", "x-ratelimit-context": "notes" } }); },
    });
    const result = await syncKnownAgentsFromFub({ clock, sleep });
    expect(result).toMatchObject({ ok: true, upserted: 3, noteFetchFailures: 0, rateLimited: 0 });
    // After the second notes answer said one request was left, the third waited for the window.
    expect(sleeps).toEqual([10_000]);
  });

  it("stops starting notes reads when its time is up: the rest keep their rows, and the next night resumes after the last one read", async () => {
    const people = Array.from({ length: 12 }, (_, index) => recruit(101 + index));
    // Every recruit already has a row, plus one person who is no longer a recruit at all.
    for (const person of [...people, recruit(999)]) db.seed(dealKnownAgents, { name: person.name, phoneE164: `+1210555${String(1000 + person.id).slice(-4)}`, source: "fub_recruit", fubPersonId: String(person.id), fubIdentityKey: `fub:${person.id}:+1210555${String(1000 + person.id).slice(-4)}`, active: true });
    const notesFor: string[] = [];
    mockFub({ people: jsonResponse({ people }), notes: (url) => { notesFor.push(url.searchParams.get("personId")!); return jsonResponse({ notes: [] }); } });
    // 30 s budget, 20 s kept for the writes: the scan takes 2 s, then one notes read a second until 10 s.
    const first = await syncKnownAgentsFromFub({ clock, sleep, budgetMs: 30_000 });
    expect(first).toMatchObject({ ok: true, recruitTagged: 12, noteFetchFailures: 0, notesDeferred: 4 });
    expect(notesFor).toEqual(["101", "102", "103", "104", "105", "106", "107", "108"]);
    // Nobody unread was deactivated; only the ex-recruit's row was.
    const rows = () => db.rows(dealKnownAgents);
    expect(rows().filter((row) => !row.active).map((row) => row.fubPersonId)).toEqual(["999"]);
    expect(db.rows(dealJobRuns)).toEqual([expect.objectContaining({ jobName: "builder-deals-known-agent-cursor", chicagoDay: "cursor", detail: "108" })]);

    notesFor.length = 0;
    const second = await syncKnownAgentsFromFub({ clock, sleep, budgetMs: 30_000 });
    // Resumes after 108 and wraps around to 101; the budget again stops after eight, at 104.
    expect(notesFor.slice(0, 4)).toEqual(["109", "110", "111", "112"]);
    expect(second).toMatchObject({ ok: true, notesDeferred: 4 });
    expect(db.rows(dealJobRuns)[0]).toMatchObject({ detail: "104" });
    notesFor.length = 0;
    // With room for everyone, the pass starts after 104, reads all twelve, and clears the cursor.
    const third = await syncKnownAgentsFromFub({ clock, sleep, budgetMs: 60_000 });
    expect(third).toMatchObject({ ok: true, notesDeferred: 0 });
    expect(notesFor[0]).toBe("105");
    expect(notesFor).toHaveLength(12);
    expect(db.rows(dealJobRuns)).toHaveLength(1);
    expect(db.rows(dealJobRuns)[0]).toMatchObject({ detail: null });
    expect(rows().filter((row) => !row.active).map((row) => row.fubPersonId)).toEqual(["999"]);
  });

  it("gives the people scan its own budget: a scan that cannot finish in it stops with its size recorded and writes nothing", async () => {
    // A big account: every people page is full and points to a next page.
    let page = 0;
    mockFub({ people: () => { page += 1; return jsonResponse({ people: Array.from({ length: 100 }, (_, index) => ({ id: page * 1_000 + index, name: "Buyer", tags: ["Buyer"] })), _metadata: { next: `cursor-${page}` } }); } });
    const result = await syncKnownAgentsFromFub({ clock, sleep, budgetMs: 60_000, scanBudgetMs: 10_000 });
    expect(result).toMatchObject({ ok: false, reason: "time_budget_exceeded", peopleFetched: 900, scan: { peopleFetched: 900, peoplePages: 9, usersPages: 1 } });
    expect((result as { detail: string }).detail).toMatch(/; scan: 900 people in 9 pages and 1 users page, 10s of a 10s scan budget$/);
    expect(db.rows(dealKnownAgents)).toEqual([]);
    expect(db.rows(dealJobRuns)).toEqual([]);
  });

  it("lets the notes pass use what the scan left, up to the overall cap, and records the scan's size", async () => {
    const notesAt: number[] = [];
    let page = 0;
    mockFub({
      people: () => { page += 1; return page < 5 ? jsonResponse({ people: [{ id: 9_000 + page, tags: ["Buyer"] }], _metadata: { next: `c${page}` } }) : jsonResponse({ people: Array.from({ length: 12 }, (_, index) => recruit(101 + index)) }); },
      notes: () => { notesAt.push(now); return jsonResponse({ notes: [] }); },
    });
    const start = now;
    const result = await syncKnownAgentsFromFub({ clock, sleep, budgetMs: 60_000, scanBudgetMs: 10_000 });
    expect(result).toMatchObject({ ok: true, recruitTagged: 12, upserted: 12, notesDeferred: 0, scan: { peopleFetched: 16, peoplePages: 5, usersPages: 1, ms: 6_000 } }); // six answers at one fake second each
    // Notes ran past the scan's 10 s, inside the 60 s cap less the 20 s kept for writes.
    expect(Math.max(...notesAt) - start).toBeGreaterThan(10_000);
    expect(Math.max(...notesAt) - start).toBeLessThanOrEqual(40_000);
  });

  it("reads new recruits (no rows yet) first, ahead of the rotating pass, without moving its cursor for them", async () => {
    const people = Array.from({ length: 12 }, (_, index) => recruit(101 + index));
    // 101..110 are mirrored; 111 and 112 joined since the last pass. The last pass stopped after 103.
    for (const person of people.slice(0, 10)) db.seed(dealKnownAgents, { name: person.name, phoneE164: `+1210555${String(1000 + person.id).slice(-4)}`, source: "fub_recruit", fubPersonId: String(person.id), fubIdentityKey: `fub:${person.id}:+1210555${String(1000 + person.id).slice(-4)}`, active: true });
    db.seed(dealJobRuns, { jobName: "builder-deals-known-agent-cursor", chicagoDay: "cursor", status: "ok", detail: "103" });
    const notesFor: string[] = [];
    mockFub({ people: jsonResponse({ people }), notes: (url) => { notesFor.push(url.searchParams.get("personId")!); return jsonResponse({ notes: [] }); } });
    const result = await syncKnownAgentsFromFub({ clock, sleep, budgetMs: 30_000 });
    expect(notesFor).toEqual(["111", "112", "104", "105", "106", "107", "108", "109"]);
    expect(result).toMatchObject({ ok: true, newRecruits: 2, notesDeferred: 4 });
    expect(db.rows(dealKnownAgents).filter((row) => row.fubPersonId === "111" || row.fubPersonId === "112")).toHaveLength(2);
    expect(db.rows(dealJobRuns).find((row) => row.jobName === "builder-deals-known-agent-cursor")).toMatchObject({ detail: "109" });
  });

  it("keeps the default budget under the catalog batch's few minutes per cron call", () => {
    expect(KNOWN_AGENT_SYNC_BUDGET_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});
