import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), notifyOwner: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./_core/notification", () => ({ notifyOwner: (...args: unknown[]) => mocks.notifyOwner(...args) }));

import { dealEmailLogs } from "../drizzle/schema";
import { createFakeDealsDb } from "./dealsFubFakeDb.test-support";
import { OWNER_ONLY_DELIVERY_LOG, OWNER_ONLY_REJECTED_LOG, sendBuilderDealsEmail } from "./dealsEmail";
import { OWNER_NOTIFICATION_CONTENT_MAX, OWNER_NOTIFICATION_TITLE_MAX } from "./dealsEmailLimits";

/** The owner notification's own validation (server/_core/notification.ts): it throws on an over-long title or content. */
function strictNotifyOwner(payload: { title: string; content: string }) {
  if (payload.title.trim().length > OWNER_NOTIFICATION_TITLE_MAX) throw new Error(`Notification title must be at most ${OWNER_NOTIFICATION_TITLE_MAX} characters.`);
  if (payload.content.trim().length > OWNER_NOTIFICATION_CONTENT_MAX) throw new Error(`Notification content must be at most ${OWNER_NOTIFICATION_CONTENT_MAX} characters.`);
  return Promise.resolve(true);
}

const recipients = ["peter@lifestyledesignrealty.com", "steven@lifestyledesignrealty.com"];
const logs = (db: ReturnType<typeof createFakeDealsDb>) => db.writes.filter((write) => write.op === "insert" && write.table === dealEmailLogs).map((write) => write.values as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
  mocks.notifyOwner.mockImplementation(strictNotifyOwner);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Builder Deals email size limits (owner-notification fallback)", () => {
  it("sends a body over 20,000 characters as numbered parts the notification accepts, losing nothing", async () => {
    const db = createFakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    const lines = Array.from({ length: 900 }, (_, index) => `- Community ${index} (Lennar): 3 new: 12345 Blue Sage Trail, 23456 Cypress Bend Way, +1 more`);
    const content = lines.join("\n");
    expect(content.length).toBeGreaterThan(60_000);
    const result = await sendBuilderDealsEmail({ category: "health", recipients, subject: "Builder Deals System OK: all checks passed", content });
    expect(result).toEqual({ ok: true, status: "owner_only_fallback", deliveryLog: OWNER_ONLY_DELIVERY_LOG });
    const calls = mocks.notifyOwner.mock.calls.map(([payload]) => payload as { title: string; content: string });
    expect(calls.length).toBeGreaterThanOrEqual(4);
    calls.forEach((call, index) => {
      expect(call.title).toBe(`Builder Deals System OK: all checks passed (${index + 1}/${calls.length})`);
      expect(call.content.length).toBeLessThanOrEqual(OWNER_NOTIFICATION_CONTENT_MAX);
      expect(call.content).toContain("NOT emailed");
    });
    const delivered = calls.map((call) => call.content).join("\n");
    for (const index of [0, 450, 899]) expect(delivered).toContain(`- Community ${index} (Lennar)`);
    expect(logs(db).map((row) => row.deliveryStatus)).toEqual(calls.map(() => "owner_only_fallback"));
  });

  it("caps an over-long subject (a hold email naming every community) instead of having the whole email refused", async () => {
    const db = createFakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    const subject = `Builder Deals hold: ${Array.from({ length: 120 }, (_, index) => `Saddle Creek Ranch ${index}`).join(", ")}`;
    expect(subject.length).toBeGreaterThan(OWNER_NOTIFICATION_TITLE_MAX);
    expect((await sendBuilderDealsEmail({ category: "team_sync", recipients, subject, content: "x" })).ok).toBe(true);
    const title = (mocks.notifyOwner.mock.calls[0]![0] as { title: string }).title;
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.startsWith("Builder Deals hold: Saddle Creek Ranch 0, ")).toBe(true);
    expect(logs(db)[0]!.subject).toBe(title);
  });

  it("logs a notification the service did not accept as failed, so the health check's email-failure count sees it", async () => {
    const db = createFakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.notifyOwner.mockResolvedValue(false);
    const result = await sendBuilderDealsEmail({ category: "fub_failure", recipients, subject: "Builder Deals morning summary: 3 changes", content: "x" });
    expect(result).toMatchObject({ ok: false, status: "owner_only_fallback", error: "Owner notification was not accepted" });
    // builderDealsOperationalSnapshot counts deal_email_logs rows with delivery_status "failed" in the last 24 hours.
    expect(logs(db)).toEqual([expect.objectContaining({ provider: "owner_notification", deliveryStatus: "failed", deliveryLog: OWNER_ONLY_REJECTED_LOG, deliveredAt: null, lastError: "Owner notification was not accepted" })]);

    // A thrown validation error is the same: not accepted, logged failed. One refused part of three fails the message.
    const parts = createFakeDealsDb();
    mocks.getDb.mockResolvedValue(parts);
    let call = 0;
    mocks.notifyOwner.mockImplementation(async () => { call += 1; if (call === 2) throw new Error("Notification content must be at most 20000 characters."); return true; });
    const long = Array.from({ length: 600 }, (_, index) => `line ${index} ${"z".repeat(80)}`).join("\n");
    const partial = await sendBuilderDealsEmail({ category: "health", recipients, subject: "Builder Deals health check: 2 items need attention", content: long });
    expect(partial).toMatchObject({ ok: false, error: expect.stringMatching(/not accepted for part 2 of \d/) });
    expect(logs(parts).map((row) => row.deliveryStatus)).toEqual(["owner_only_fallback", "failed", ...logs(parts).slice(2).map(() => "owner_only_fallback")]);
  });
});

describe("routine reports are not emailed", () => {
  it("sends no update summary, new-communities report or Monday report, and says ok so nothing is retried; lead and failure emails still go", async () => {
    const { ROUTINE_EMAIL_CATEGORIES, NOT_SENT_ROUTINE_LOG } = await import("./dealsEmail");
    for (const category of ["deals_sync_summary", "deals_sync_hold", "deals_discovery", "weekly"]) {
      expect(ROUTINE_EMAIL_CATEGORIES.has(category)).toBe(true);
      expect(await sendBuilderDealsEmail({ category, recipients: ["peter@lifestyledesignrealty.com"], subject: "x", content: "y" })).toEqual({ ok: true, status: "not_sent_routine", deliveryLog: NOT_SENT_ROUTINE_LOG });
    }
    for (const category of ["hourly_digest", "health", "fub_failure", "team_sync", "deals_verify_threshold"]) expect(ROUTINE_EMAIL_CATEGORIES.has(category)).toBe(false);
  });
});
