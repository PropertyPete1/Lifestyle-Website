import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getDealSettings: vi.fn(), sendBuilderDealsEmail: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsService")>()),
  getDealSettings: (...args: unknown[]) => mocks.getDealSettings(...args),
}));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));

import { dealAlerts } from "../drizzle/schema";
import { createFakeDealsDb } from "./dealsFubFakeDb.test-support";
import { adminLeadLink, digestContent, queueFirstUnlockAlert, queueProfileFlagAlert } from "./dealsAlerts";

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
    expect(content).toContain("Block and kill link (opens admin, login required, confirm button): https://lifestyledesignrealty.com/admin/deals?lead=31");
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
