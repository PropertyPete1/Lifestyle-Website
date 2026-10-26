import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { dealClientLinks, dealEvents, dealLeads, dealTeamAllowlist } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * "Text it" on a client link (Oct 26, 2026, Peter: one tap to send a client their list): the agent's phone sends the
 * message; FUB gets the person, the timeline message and a note; the agent's event remembers it. The FUB text endpoint
 * only records a message, it never delivers one, so this never claims to have sent anything.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), recordClientLinkText: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsMap", () => ({ communityAreaMap: () => null, areaMapGeometry: () => null, areaMapRadius: () => 5 }));
vi.mock("./dealsFub", () => ({ recordClientLinkText: (...args: unknown[]) => mocks.recordClientLinkText(...args) }));

import { CLIENT_LINK_TEXTED_EVENT, TEXT_DEDUPE_MS, agentWorkspace, clientLinkTextMessage, createClientLink, textClientLink } from "./dealsClientLinks";

const HOUR = 3_600_000;
const AGENT_PHONE = "+12105550101";
let db: FakeDealsDb;
const lead = (overrides: Partial<typeof dealLeads.$inferInsert> & { phoneE164: string }) => {
  const id = db.seed(dealLeads, { status: "verified", expiresAt: new Date(Date.now() + HOUR), deviceHash: "d".repeat(64), consentText: "c", consentIp: "127.0.0.1", flags: "[]", sourceCode: "sl1", ...overrides });
  return db.rows(dealLeads).find((row) => row.id === id) as typeof dealLeads.$inferSelect;
};

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.recordClientLinkText.mockResolvedValue({ ok: true, personId: "501", created: true, logged: true });
  vi.stubEnv("DEALS_SITE_ORIGIN", "https://lifestyledesignrealty.com");
  db.seed(dealTeamAllowlist, { name: "Tiffany Agent", phoneE164: AGENT_PHONE, email: "tiffany@example.com", fubUserId: "77", fubIdentityKey: "fub:77:+12105550101", source: "fub", active: true });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

async function linkFor(agent: typeof dealLeads.$inferSelect, clientPhone?: string) {
  const created = await createClientLink({ agentLead: agent, clientName: "Maria Lopez", clientPhone });
  if (!created.ok) throw new Error(created.kind);
  return created;
}

describe("texting a client link", () => {
  it("records the send in FUB under the agent, with the default message, and remembers it for the workspace", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await linkFor(agent, "(210) 555-0202");
    const result = await textClientLink(agent, { linkId: created.link.id });
    expect(result).toMatchObject({ ok: true, smsTo: "+12105550202", fub: "logged", repeat: false });
    const url = `https://lifestyledesignrealty.com${created.path}`;
    expect(result.ok && result.message).toBe(clientLinkTextMessage({ clientName: "Maria Lopez", agentFirstName: "Tiffany", url }));
    expect(result.ok && result.message).toContain(url);
    expect(mocks.recordClientLinkText).toHaveBeenCalledWith(expect.objectContaining({ clientPhone: "+12105550202", clientName: "Maria Lopez", linkUrl: url, agent: expect.objectContaining({ name: "Tiffany Agent", fubUserId: "77", phoneE164: AGENT_PHONE }) }));
    const event = db.rows(dealEvents).find((row) => row.kind === CLIENT_LINK_TEXTED_EVENT);
    expect(event?.detail).toBe(`link:${created.link.id};fub:logged;person:501`);
    const workspace = await agentWorkspace(agent);
    expect(workspace?.clients[0]?.lastTextedAt).toBeTruthy();
  });

  it("refuses a link that is not the agent's, one with no phone, and a closed one", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const noPhone = await linkFor(agent);
    expect(await textClientLink(agent, { linkId: noPhone.link.id })).toEqual({ ok: false, kind: "no_phone" });
    expect(await textClientLink(agent, { linkId: 999_999 })).toEqual({ ok: false, kind: "not_found" });
    const withPhone = await linkFor(agent, "2105550202");
    await db.update(dealClientLinks).set({ revokedAt: new Date() }).where(eq(dealClientLinks.id, withPhone.link.id));
    expect(await textClientLink(agent, { linkId: withPhone.link.id })).toEqual({ ok: false, kind: "closed" });
    expect(mocks.recordClientLinkText).not.toHaveBeenCalled();
  });

  it("stops before the phone opens when the contact opted out of texts, and logs the refusal", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await linkFor(agent, "2105550202");
    mocks.recordClientLinkText.mockResolvedValueOnce({ ok: false, kind: "opted_out", personId: "9" });
    expect(await textClientLink(agent, { linkId: created.link.id })).toEqual({ ok: false, kind: "opted_out" });
    expect(db.rows(dealEvents).some((row) => row.kind === "client_link_text_refused")).toBe(true);
    expect(db.rows(dealEvents).some((row) => row.kind === CLIENT_LINK_TEXTED_EVENT)).toBe(false);
  });

  it("still hands the phone the message when FUB is down, and says so; a second tap within ten minutes logs nothing twice", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await linkFor(agent, "2105550202");
    mocks.recordClientLinkText.mockResolvedValueOnce({ ok: false, kind: "unavailable", error: "FUB 503" });
    const first = await textClientLink(agent, { linkId: created.link.id });
    expect(first).toMatchObject({ ok: true, fub: "unavailable", repeat: false });
    const second = await textClientLink(agent, { linkId: created.link.id });
    expect(second).toMatchObject({ ok: true, fub: "skipped", repeat: true });
    // Past the window, it logs again.
    const later = await textClientLink(agent, { linkId: created.link.id, now: new Date(Date.now() + TEXT_DEDUPE_MS + 1_000) });
    expect(later).toMatchObject({ ok: true, repeat: false });
    expect(mocks.recordClientLinkText).toHaveBeenCalledTimes(2);
    expect(db.rows(dealEvents).filter((row) => row.kind === CLIENT_LINK_TEXTED_EVENT)).toHaveLength(2);
  });

  it("keeps an edited message only when it is short and still carries the link", async () => {
    const agent = lead({ phoneE164: AGENT_PHONE, status: "team" });
    const created = await linkFor(agent, "2105550202");
    const url = `https://lifestyledesignrealty.com${created.path}`;
    expect(await textClientLink(agent, { linkId: created.link.id, message: "Hi Maria, here you go" })).toEqual({ ok: false, kind: "invalid_message" });
    expect(await textClientLink(agent, { linkId: created.link.id, message: `${"x".repeat(300)} ${url}` })).toEqual({ ok: false, kind: "invalid_message" });
    const ok = await textClientLink(agent, { linkId: created.link.id, message: `Maria, your   list: ${url}` });
    expect(ok.ok && ok.message).toBe(`Maria, your list: ${url}`);
  });
});
