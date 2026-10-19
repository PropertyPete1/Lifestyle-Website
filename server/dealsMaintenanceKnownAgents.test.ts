import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDealSettings: vi.fn(),
  revokeNonTeamMatchingDealLinks: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsPhotos", () => ({ pruneDealPhotoRenders: () => Promise.resolve({ scanned: 0, expiredRows: 0, staleRows: 0, rowsDeleted: 0, objectsDeleted: 0, objectsFailed: 0 }) }));
vi.mock("./dealsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsService")>()),
  getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args),
}));
vi.mock("./dealsEligibility", () => ({ revokeNonTeamMatchingDealLinks: (...args: unknown[]) => mocks.revokeNonTeamMatchingDealLinks(...args) }));

import { dealDoNotAutoImport, dealFubRecords, dealKnownAgents, dealLeads, dealTeamAllowlist } from "../drizzle/schema";
import { builderDealsLeadMarker } from "./dealsFub";
import { createFakeDealsDb, jsonResponse } from "./dealsFubFakeDb.test-support";
import { configuredRealtorMatch, extractNotePhones, syncKnownAgentsFromFub } from "./dealsKnownAgents";

const settings = {
  textLine: "(512) 542-1477",
  testNumbers: ["+12105550300"],
  fubRealtorTags: ["Recruit - Website", "Agent - Blocked", "Agent - FUB Match", "Possible Agent - Email Domain", "Recruit"],
  fubRealtorSources: ["New Agent Inquiry", "Agent Scouting"],
};
const recruitOne = { id: 101, name: "Recruit One", tags: ["Recruit - Test"], phones: [{ value: "(210) 555-0201" }], emails: [{ value: "R1@agents.test" }] };
const buyer = { id: 102, name: "Just A Buyer", tags: ["Buyer"], phones: [{ value: "+12105550204" }] };
const scouted = { id: 103, name: "Scouted Agent", source: "Agent Scouting", phones: [{ value: "210-555-0205" }] };
const lowercaseRecruit = { id: 104, name: "Also Recruit", tags: ["recruit"], phones: [{ value: "(210) 555-0206" }] };
const users = [{ id: 1, email: "peter@lifestyledesignrealty.com", phones: [{ value: "(210) 555-0206" }] }];
const recruitOneNotes = [
  { id: 1, body: "Replied STOP from +1 (210) 555-0202; moved the number out of the phone field." },
  { id: 2, body: "Spouse number 210.555.0203, referral 2105550204, test phone 210-555-0300, our text line 512-542-1477." },
  { id: 3, body: `Builder Deals ${builderDealsLeadMarker(9)}:first_unlock\nConsent text: Reply STOP to opt out. Consent IP 10.0.0.1` },
  { id: 5, body: "Builder Deals screening follow-up, call 2105550999 later." },
];
type Call = { url: string };
function mockFub(notesFor: (personId: string) => Response) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    calls.push({ url });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/people")) return jsonResponse({ people: [recruitOne, buyer, scouted, lowercaseRecruit] });
    if (parsed.pathname.endsWith("/users")) return jsonResponse({ users });
    if (parsed.pathname.endsWith("/notes")) return notesFor(parsed.searchParams.get("personId") ?? "");
    throw new Error(`unexpected FUB request ${url}`);
  });
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FUB_API_KEY", "test-key");
  mocks.getDealSettings.mockResolvedValue(settings);
  mocks.revokeNonTeamMatchingDealLinks.mockResolvedValue(0);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Builder Deals known-agent note extraction", () => {
  it("accepts formatted, dotted, dashed, +1 and bare eleven-digit numbers and normalizes them", () => {
    expect(extractNotePhones("Call 2105550123 or (210) 555-0124, 210-555-0125, 210.555.0126, +1 210 555 0127, 12105550128.")).toEqual([
      "+12105550123", "+12105550124", "+12105550125", "+12105550126", "+12105550127", "+12105550128",
    ]);
    expect(extractNotePhones("Account 123456789012 and zip 78258 are not phones; 555-0123 alone is not either.")).toEqual([]);
    expect(extractNotePhones(42)).toEqual([]);
  });

  it("matches the admin list exactly, any tag starting with Recruit, and the admin sources", () => {
    const tags = new Set(settings.fubRealtorTags.map((value) => value.toLowerCase()));
    const sources = new Set(settings.fubRealtorSources.map((value) => value.toLowerCase()));
    expect(configuredRealtorMatch(recruitOne, tags, sources)).toBe(true);
    expect(configuredRealtorMatch(lowercaseRecruit, tags, sources)).toBe(true);
    expect(configuredRealtorMatch(scouted, tags, sources)).toBe(true);
    expect(configuredRealtorMatch(buyer, tags, sources)).toBe(false);
    expect(configuredRealtorMatch({ id: 9, tags: ["Needs Agent", "No Agent"] }, tags, sources)).toBe(false);
  });
});

describe("Builder Deals nightly FUB known-agent mirror", () => {
  it("copies recruit phones from fields and notes, skips per number, keeps rows alive on a notes failure, and retires rows the scan no longer produces", async () => {
    const calls = mockFub((personId) => personId === "103" ? new Response("", { status: 500 }) : jsonResponse({ notes: personId === "101" ? recruitOneNotes : [] }));
    const staleRows = [
      { id: 1, fubPersonId: "103", fubIdentityKey: "fub:103:+12105550205", active: true },
      { id: 2, fubPersonId: "104", fubIdentityKey: "fub:104:+12105550206", active: true },
      { id: 3, fubPersonId: "101", fubIdentityKey: "fub:101:+12105550201", active: true },
    ];
    const db = createFakeDealsDb([
      [dealDoNotAutoImport, [{ value: "+12105550203", kind: "phone" }]],
      [dealDoNotAutoImport, []],
      [dealTeamAllowlist, []],
      [dealLeads, []],
      [dealKnownAgents, []],
      [dealKnownAgents, [{ id: 3, source: "fub_recruit", fubIdentityKey: "fub:101:+12105550201" }]],
      [dealKnownAgents, []],
      [dealKnownAgents, staleRows],
      [dealFubRecords, [{ fubId: "5" }]],
    ]);
    mocks.getDb.mockResolvedValue(db);

    const result = await syncKnownAgentsFromFub();
    expect(result).toMatchObject({
      ok: true,
      peopleFetched: 4,
      recruitTagged: 3,
      upserted: 2,
      noteFetchFailures: 1,
      skippedBy: { doNotAutoImport: 1, textLineAndTestNumbers: 2, nonRecruitContacts: 1, activeFubUsers: 1, systemNotes: 2, teamAllowlist: 0, teamPreviewLeads: 0, manuallyManagedKnownAgents: 0 },
    });
    // The recruit's own number refreshes its existing row; the STOP number parked in a note becomes a new row.
    const knownAgentWrites = db.writes.filter((write) => write.table === dealKnownAgents);
    expect(knownAgentWrites.filter((write) => write.op === "update" && (write.set as { active?: boolean }).active === true).map((write) => write.set)).toEqual([expect.objectContaining({ phoneE164: "+12105550201", email: "r1@agents.test", source: "fub_recruit", fubPersonId: "101" })]);
    expect(knownAgentWrites.filter((write) => write.op === "insert").map((write) => write.values)).toEqual([expect.objectContaining({ phoneE164: "+12105550202", email: "r1@agents.test", source: "fub_recruit", fubPersonId: "101", fubIdentityKey: "fub:101:+12105550202" })]);
    // Only the recruit whose every number is skipped loses its row; the notes-failure person keeps its row.
    expect(knownAgentWrites.filter((write) => write.op === "update" && (write.set as { active?: boolean }).active === false)).toHaveLength(1);
    expect(mocks.revokeNonTeamMatchingDealLinks).toHaveBeenCalledTimes(2);
    // One full people scan (FUB's tags filter is exact), no undocumented users fields.
    const peopleRequests = calls.filter((call) => new URL(call.url).pathname.endsWith("/people"));
    expect(peopleRequests).toHaveLength(1);
    expect(peopleRequests[0]!.url).not.toContain("tags=");
    expect(calls.find((call) => new URL(call.url).pathname.endsWith("/users"))!.url).not.toContain("fields=");
  });
});
