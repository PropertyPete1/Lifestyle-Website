import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getDealSettings: vi.fn(), sendBuilderDealsEmail: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsService")>()),
  getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args),
}));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));

import { dealAlerts, dealClientLinks, dealTeamAllowlist } from "../drizzle/schema";
import { createFakeDealsDb } from "./dealsFubFakeDb.test-support";
import { adminLeadLink, digestContent, queueAgentRequestAlert, queueClientLinkAttachedAlert, queueFirstUnlockAlert, queueProfileFlagAlert } from "./dealsAlerts";

const EM_DASH = "—";
const lead = { id: 31, name: null, phoneE164: "+12105550123", email: null, instagramHandle: "pete_buys", sourceCode: "sl1", timeline: "0-3 months" };
const settings = { alertRecipients: ["peter@lifestyledesignrealty.com", "steven@lifestyledesignrealty.com"], alertMode: "immediate" as const };
const insertedAlert = (db: ReturnType<typeof createFakeDealsDb>) => db.writes.find((write) => write.op === "insert" && write.table === dealAlerts)!.values as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDealSettings.mockResolvedValue(settings);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "sent", deliveryLog: "resend sent" });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("Builder Deals first-unlock alert content", () => {
  it("carries phone, handle, src, name, flags, the assignment note, the opt-out marker, the FUB link and the admin block link in one email", async () => {
    const db = createFakeDealsDb([[dealAlerts, []]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(queueFirstUnlockAlert(lead, { flags: ["Possible Agent - Handle", "Possible Agent - TREC Name Match"], fubPersonId: "9001", alreadyAssignedTo: "Jane Agent", previouslyOptedOut: true })).resolves.toEqual({ queued: true, reason: undefined });
    const alert = insertedAlert(db);
    expect(alert).toMatchObject({ dedupeKey: "first_unlock:31", leadId: 31, kind: "first_unlock", deliveryMode: "immediate", recipients: JSON.stringify(settings.alertRecipients), status: "pending" });
    expect(String(alert.subject)).not.toContain(EM_DASH);
    const content = String(alert.content);
    expect(content).not.toContain(EM_DASH);
    expect(content).toContain("Phone: +12105550123");
    expect(content).toContain("Instagram: @pete_buys");
    expect(content).toContain("Source: sl1");
    expect(content).toContain("Name: Not provided");
    expect(content).toContain("Flags: Possible Agent - Handle, Possible Agent - TREC Name Match");
    expect(content).toContain("already assigned to Jane Agent");
    expect(content).toContain("Previously opted out, do not text manually.");
    expect(content).toContain("FUB contact: https://app.followupboss.com/2/people/view/9001");
    expect(content).toContain("Turn off access (opens admin, login required, confirm button): https://lifestyledesignrealty.com/admin/deals?lead=31");
    expect(content).not.toMatch(/\/deals\/v\//);
  });

  it("omits the opt-out and assignment lines when they do not apply and says when FUB has not synced", async () => {
    vi.stubEnv("DEALS_SITE_ORIGIN", "https://preview.example.test/");
    const db = createFakeDealsDb([[dealAlerts, []]]);
    mocks.getDb.mockResolvedValue(db);
    await queueFirstUnlockAlert(lead, { flags: [], fubPersonId: null, alreadyAssignedTo: null, previouslyOptedOut: false, fubIssue: "FUB delivery failed" });
    const content = String(insertedAlert(db).content);
    expect(content).toContain("Flags: none");
    expect(content).not.toContain("opted out");
    expect(content).not.toContain("already assigned");
    expect(content).toContain("FUB contact: not synced yet (FUB delivery failed)");
    expect(content).toContain("https://preview.example.test/admin/deals?lead=31");
    expect(adminLeadLink(31)).toBe("https://preview.example.test/admin/deals?lead=31");
  });

  it("queues exactly one alert per lead: the second insert is a duplicate", async () => {
    const db = createFakeDealsDb([[dealAlerts, []]], { affectedRows: 0 });
    mocks.getDb.mockResolvedValue(db);
    await expect(queueFirstUnlockAlert(lead, {})).resolves.toEqual({ queued: false, reason: "duplicate" });
  });

  it("schedules hourly-digest alerts for the next hour instead of dispatching immediately", async () => {
    mocks.getDealSettings.mockResolvedValue({ ...settings, alertMode: "hourly_digest" });
    const db = createFakeDealsDb([[dealAlerts, []]]);
    mocks.getDb.mockResolvedValue(db);
    await queueFirstUnlockAlert(lead, {});
    const alert = insertedAlert(db);
    expect(alert.deliveryMode).toBe("hourly_digest");
    expect((alert.scheduledFor as Date).getTime()).toBeGreaterThan(Date.now());
    expect((alert.scheduledFor as Date).getUTCMinutes()).toBe(0);
  });
});

describe("Builder Deals follow-up flag alert and digest copy", () => {
  it("lists only the newly set flags with the admin link and no em dashes", async () => {
    const db = createFakeDealsDb([[dealAlerts, []]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(queueProfileFlagAlert(lead, ["Possible Agent - TREC Name Match"])).resolves.toEqual({ queued: true, reason: undefined });
    const alert = insertedAlert(db);
    expect(alert.dedupeKey).toBe("profile_flag:31:possible agent - trec name match");
    expect(String(alert.subject)).not.toContain(EM_DASH);
    expect(String(alert.content)).toContain("- Possible Agent - TREC Name Match");
    expect(String(alert.content)).toContain("https://lifestyledesignrealty.com/admin/deals?lead=31");
    await expect(queueProfileFlagAlert(lead, [])).resolves.toEqual({ queued: false, reason: "no_new_flags" });
  });

  it("formats the hourly digest without em dashes", () => {
    const digest = digestContent([{ subject: "Builder Deals: new buyer unlocked the list", content: "Phone: +12105550123" }]);
    expect(digest).toContain("Builder Deals hourly alert digest: 1 alert.");
    expect(digest).not.toContain(EM_DASH);
  });
});

describe("alerts for an agent's client", () => {
  const tiffany = { id: 5, name: "Tiffany Agent", phoneE164: "+12105550101", email: "tiffany@example.com", fubUserId: "77", fubIdentityKey: null, source: "fub", active: true, createdAt: new Date() };
  const link = { id: 3, clientName: "Maria Lopez" };
  const alertsOf = (db: ReturnType<typeof createFakeDealsDb>) => db.writes.filter((write) => write.op === "insert" && write.table === dealAlerts).map((write) => write.values as Record<string, unknown>);
  const ownersCopy = (db: ReturnType<typeof createFakeDealsDb>) => alertsOf(db).find((alert) => alert.kind !== "agent_update")!;
  const agentCopy = (db: ReturnType<typeof createFakeDealsDb>) => alertsOf(db).find((alert) => alert.kind === "agent_update");
  const agentClient = { ...lead, sourceCode: "agent", agentTeamId: 5, clientLinkId: 3 };

  it("tells the owners and the agent, separately, what actually happened to the FUB assignment", async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>, string, string]> = [
      [tiffany, { fubPersonId: "9001" }, "The FUB contact is assigned to Tiffany Agent.", "Their Follow Up Boss contact is assigned to you."],
      [{ ...tiffany, fubUserId: null }, { fubPersonId: "9001" }, "Tiffany Agent has no Follow Up Boss user yet, so the FUB contact is assigned to Peter.", "Your team profile has no Follow Up Boss user yet, so their Follow Up Boss contact is assigned to Peter for now."],
      [tiffany, { fubPersonId: "9001", alreadyAssignedTo: "Jane Agent" }, "The FUB contact was already assigned to Jane Agent; the assignment was left alone.", "They were already in Follow Up Boss with Jane Agent, so that assignment was left alone; a note names you."],
      [tiffany, { fubIssue: "FUB delivery failed" }, "The FUB contact is not synced yet; it will be assigned to Tiffany Agent.", "Their Follow Up Boss contact is still syncing; it will be assigned to you."],
      [tiffany, { fubPersonId: "9001", fubWarning: "FUB assignment repair failed" }, "Assigning the FUB contact to Tiffany Agent did not go through (FUB assignment repair failed); assign it in FUB.", "Their Follow Up Boss contact could not be assigned to you automatically; Peter has been told and will assign it."],
    ];
    for (const [row, details, ownersLine, agentLine] of cases) {
      const db = createFakeDealsDb([[dealTeamAllowlist, [row]], [dealTeamAllowlist, [row]], [dealClientLinks, [link]], [dealAlerts, []]]);
      mocks.getDb.mockResolvedValue(db);
      await queueFirstUnlockAlert(agentClient, details);
      const owners = ownersCopy(db);
      expect(owners).toMatchObject({ dedupeKey: "first_unlock:31", kind: "first_unlock", subject: "Builder Deals: Tiffany Agent's client unlocked the list", recipients: JSON.stringify(settings.alertRecipients) });
      expect(String(owners.content)).toContain(ownersLine);
      const agent = agentCopy(db)!;
      expect(agent).toMatchObject({ dedupeKey: "first_unlock:31:agent", deliveryMode: "immediate", recipients: JSON.stringify(["tiffany@example.com"]), subject: "Builder Deals: Maria Lopez opened the list you sent" });
      const content = String(agent.content);
      expect(content).toContain(agentLine);
      expect(content).toContain("Phone: (210) 555-0123");
      expect(content).toContain("Your clients and their activity: https://lifestyledesignrealty.com/deals/team");
      // Agents have no admin login: their copy never points at admin, the retry queue or the block link.
      expect(content).not.toMatch(/admin|Admin|retry queue|Block and kill|Turn off access/);
      expect(content).not.toContain(EM_DASH);
    }
  });

  it("tells the agent a buyer signed up through their own bio link, and that they see the list without addresses (Oct 28)", async () => {
    const db = createFakeDealsDb([[dealTeamAllowlist, [tiffany]], [dealTeamAllowlist, [tiffany]], [dealAlerts, []]]);
    mocks.getDb.mockResolvedValue(db);
    await queueFirstUnlockAlert({ ...lead, name: "Jordan Ellis", sourceCode: "agent-page", agentTeamId: 5, clientLinkId: null }, { fubPersonId: "9001" });
    expect(ownersCopy(db)).toMatchObject({ subject: "Builder Deals: Tiffany Agent's link brought a new buyer" });
    expect(String(ownersCopy(db).content)).toContain("Tiffany Agent's lead signed up through their own Builder Deals link. The FUB contact is assigned to Tiffany Agent.");
    const agent = agentCopy(db)!;
    expect(agent).toMatchObject({ subject: "Builder Deals: Jordan Ellis signed up through your link" });
    expect(String(agent.content)).toContain("They see the home list without addresses; send them a client link from Agent tools when you want them to see every address.");
    expect(String(agent.content)).toContain("Their Follow Up Boss contact is assigned to you.");
  });

  it("sends the agent's copy right away even when the owners take an hourly digest", async () => {
    mocks.getDealSettings.mockResolvedValue({ ...settings, alertMode: "hourly_digest" });
    const db = createFakeDealsDb([[dealTeamAllowlist, [tiffany]], [dealTeamAllowlist, [tiffany]], [dealClientLinks, [link]], [dealAlerts, []]]);
    mocks.getDb.mockResolvedValue(db);
    await queueFirstUnlockAlert(agentClient, { fubPersonId: "9001" });
    expect(ownersCopy(db).deliveryMode).toBe("hourly_digest");
    expect(agentCopy(db)!.deliveryMode).toBe("immediate");
  });

  it("leaves an agent who left the team, or has no email, out of it", async () => {
    for (const row of [{ ...tiffany, active: false }, { ...tiffany, email: null }]) {
      const db = createFakeDealsDb([[dealTeamAllowlist, [row]], [dealTeamAllowlist, [row]], [dealClientLinks, [link]], [dealAlerts, []]]);
      mocks.getDb.mockResolvedValue(db);
      await queueFirstUnlockAlert(agentClient, { fubPersonId: "9001" });
      expect(agentCopy(db)).toBeUndefined();
      expect(JSON.parse(String(ownersCopy(db).recipients))).toEqual(settings.alertRecipients);
    }
  });

  it("tells the agent once per link when an existing buyer connects through it", async () => {
    const db = createFakeDealsDb([[dealClientLinks, [link]], [dealAlerts, []]]);
    mocks.getDb.mockResolvedValue(db);
    await queueClientLinkAttachedAlert(agentClient, { name: "Tiffany Agent", email: "tiffany@example.com" }, 3);
    expect(ownersCopy(db)).toMatchObject({ dedupeKey: "client_link_attached:31:3", subject: "Builder Deals: Tiffany Agent's client is on their list", recipients: JSON.stringify(settings.alertRecipients) });
    expect(String(ownersCopy(db).content)).toContain("keeps its current assignment; a note on it names Tiffany Agent");
    const agent = agentCopy(db)!;
    expect(agent).toMatchObject({ dedupeKey: "client_link_attached:31:3:agent", subject: "Builder Deals: Maria Lopez connected to the list you sent", recipients: JSON.stringify(["tiffany@example.com"]) });
    expect(String(agent.content)).not.toMatch(/admin|Admin/);
    expect(String(agent.content)).not.toContain(EM_DASH);
  });

  it("writes the agent's copy of a save, a tour request and a question, once per request", async () => {
    const shapes: Array<["save" | "tour" | "ask", boolean, string, string, string]> = [
      ["save", true, "Builder Deals: Maria Lopez saved a home", "Maria Lopez saved 8106 Private Street (Hidden Plan), $489,990.", "A Follow Up Boss task for this is assigned to you."],
      ["tour", false, "Builder Deals: Maria Lopez asked for a tour", "Maria Lopez asked to tour 8106 Private Street (Hidden Plan), $489,990.", "A Follow Up Boss task for you is being created."],
      ["ask", true, "Builder Deals: Maria Lopez asked about a home", "Maria Lopez asked about 8106 Private Street (Hidden Plan), $489,990.", "A Follow Up Boss task for this is assigned to you."],
    ];
    for (const [requestType, taskCreated, subject, sentence, task] of shapes) {
      const db = createFakeDealsDb([[dealClientLinks, [link]], [dealAlerts, []]]);
      mocks.getDb.mockResolvedValue(db);
      await queueAgentRequestAlert({ lead: agentClient, agent: { name: "Tiffany Agent", email: "tiffany@example.com", fubUserId: "77" }, requestId: 44, requestType, description: "8106 Private Street (Hidden Plan), $489,990", when: "Sat, Oct 18, 1:30 PM", taskCreated, isTest: false });
      const alert = agentCopy(db)!;
      expect(alert).toMatchObject({ dedupeKey: "request:44:agent", kind: "agent_update", subject, recipients: JSON.stringify(["tiffany@example.com"]), deliveryMode: "immediate" });
      expect(String(alert.content)).toContain(sentence);
      expect(String(alert.content)).toContain(task);
      expect(String(alert.content)).not.toMatch(/admin|Admin/);
    }
  });
});
