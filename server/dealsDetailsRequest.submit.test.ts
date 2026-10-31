import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ events: [] as Array<{ kind: string; phone?: string | null }>, leads: [] as Array<Record<string, unknown>>, updates: [] as Array<Record<string, unknown>>, fub: [] as Array<Record<string, unknown>>, notify: [] as Array<{ title: string; content: string }>, blocked: false, rate: 0, team: false }));

vi.mock("./dealsService", () => ({
  getDealSettings: async () => ({ ipLimitPerHour: 10, allowCanada: false, commentKeyword: "HOME", textLine: "(512) 542-1477", testNumbers: [] }),
  ensureDealsCookies: () => ({ deviceHash: "dev1", hasProbe: true }),
  realClientIp: () => "1.2.3.4",
  currentDealSource: (source: string | null) => source ?? "landing",
  rateLimitCount: async () => calls.rate,
  logDealEvent: async (event: { kind: string; phone?: string | null }) => { calls.events.push(event); },
  getActiveBlock: async () => calls.blocked ? { reason: "blocked" } : undefined,
  safeBlockedMessage: () => "This page is for buyers.",
  isTeamPhone: async () => calls.team,
  landingCommunityId: async () => null,
}));
vi.mock("./dealsAgentPages", () => ({
  AGENT_PAGE_SOURCE: "agent-page",
  agentPageSlugFromRequest: (_req: unknown, explicit?: string) => explicit ?? null,
  agentForPageSlug: async (slug: string) => slug === "tiffany-proske" ? { teamId: 7, name: "Tiffany Proske", firstName: "Tiffany", email: null, phoneE164: null, fubUserId: "77", active: true } : null,
}));
vi.mock("./db", () => ({
  getDb: async () => null,
  createLead: async (lead: Record<string, unknown>) => { calls.leads.push(lead); return 41; },
  updateLead: async (_id: number, data: Record<string, unknown>) => { calls.updates.push(data); },
}));
vi.mock("./dealsFub", () => ({
  sendBuilderDealsDetailsRequestToFub: async (input: Record<string, unknown>) => { calls.fub.push(input); return { ok: true, personId: "901" }; },
}));
vi.mock("./_core/notification", () => ({ notifyOwner: async (message: { title: string; content: string }) => { calls.notify.push(message); return true; } }));

const { submitDetailsRequest } = await import("./dealsDetailsRequest");
const req = {} as never;
const res = {} as never;
const base = { name: "Maria Lopez", phone: "(210) 555-0123", email: "Maria@Example.com", consent: true as const, home: { key: "a1b2c3d4e5f6", area: "East San Antonio", price: 329_990, beds: 3, sqft: 1800, kind: "quick_move_in" } };

describe("submitting a details request (Oct 31, 2026)", () => {
  beforeEach(() => { calls.events.length = 0; calls.leads.length = 0; calls.updates.length = 0; calls.fub.length = 0; calls.notify.length = 0; calls.blocked = false; calls.rate = 0; calls.team = false; });

  it("saves the lead, sends it to FUB under the agent's link, and tells Peter", async () => {
    const result = await submitDetailsRequest({ ...base, notes: "Need a big yard", a: "tiffany-proske" }, req, res);
    expect(result).toEqual({ ok: true, firstName: "Maria" });
    expect(calls.events.map((event) => event.kind)).toEqual(["details_request"]);
    expect(calls.leads[0]).toMatchObject({ name: "Maria Lopez", email: "maria@example.com", phone: "+12105550123", sourceTag: "Builder Deals - Home Details", intent: "Hot", tcpaConsent: true, fubStatus: "pending" });
    expect(String(calls.leads[0]!.message)).toContain("Notes: Need a big yard");
    expect(calls.fub[0]).toMatchObject({ name: "Maria Lopez", phone: "+12105550123", email: "maria@example.com", agent: { name: "Tiffany Proske", fubUserId: "77", email: null }, isTest: false });
    expect(String(calls.fub[0]!.note)).toContain("Came through Tiffany Proske's Builder Deals link.");
    expect(calls.updates[0]).toMatchObject({ fubStatus: "synced", fubId: "901" });
    expect(calls.notify[0]!.title).toBe("Builder Deals: Maria Lopez wants a home's details");
    expect(calls.notify[0]!.content).toContain("Home: 3 beds · 1,800 sq ft · $329,990 · Move-in ready · East San Antonio");
  });

  it("goes to Peter when no agent link, and skips the alert for team or test numbers", async () => {
    calls.team = true;
    await submitDetailsRequest(base, req, res);
    expect(calls.fub[0]).toMatchObject({ agent: null, isTest: true });
    expect(calls.notify).toHaveLength(0);
  });

  it("turns away a bad number, a blocked buyer and too many requests", async () => {
    expect((await submitDetailsRequest({ ...base, phone: "12" }, req, res))).toMatchObject({ ok: false, kind: "invalid_phone" });
    calls.blocked = true;
    expect((await submitDetailsRequest(base, req, res))).toMatchObject({ ok: false, kind: "blocked" });
    calls.blocked = false;
    calls.rate = 10;
    expect((await submitDetailsRequest(base, req, res))).toMatchObject({ ok: false, kind: "rate_limited" });
    expect(calls.leads).toHaveLength(0);
    expect(calls.fub).toHaveLength(0);
  });
});
