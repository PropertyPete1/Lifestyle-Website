import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), notifyOwner: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./_core/notification", () => ({ notifyOwner: (...args: unknown[]) => mocks.notifyOwner(...args) }));

import { dealEmailLogs } from "../drizzle/schema";
import { createFakeDealsDb, jsonResponse } from "./dealsFubFakeDb.test-support";
import { OWNER_ONLY_DELIVERY_LOG, builderDealsEmailStatus, sendBuilderDealsEmail } from "./dealsEmail";

const input = { category: "health", recipients: ["Peter@lifestyledesignrealty.com", "steven@lifestyledesignrealty.com"], subject: "Builder Deals health check", content: "Twilio balance is low." };
const logRow = (db: ReturnType<typeof createFakeDealsDb>) => db.writes.find((write) => write.op === "insert" && write.table === dealEmailLogs)!.values as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
  mocks.notifyOwner.mockResolvedValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Builder Deals email transport", () => {
  it("falls back to the project-owner notification without a Resend key and logs the owner-only delivery", async () => {
    const db = createFakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(sendBuilderDealsEmail(input)).resolves.toEqual({ ok: true, status: "owner_only_fallback", deliveryLog: OWNER_ONLY_DELIVERY_LOG });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).toHaveBeenCalledWith({ title: input.subject, content: expect.stringContaining("NOT emailed") });
    expect(logRow(db)).toMatchObject({ provider: "owner_notification", deliveryStatus: "owner_only_fallback", deliveryLog: expect.stringContaining("owner only"), recipients: JSON.stringify(["peter@lifestyledesignrealty.com", "steven@lifestyledesignrealty.com"]) });
    expect(builderDealsEmailStatus(input.recipients)).toMatchObject({ provider: "owner_notification_fallback", fromConfigured: false, misconfiguration: null });
  });

  it("requires RESEND_FROM_EMAIL when the Resend key is set: logs a clear error, records it, and still notifies the owner", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const db = createFakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await sendBuilderDealsEmail(input);
    expect(result).toMatchObject({ ok: true, status: "owner_only_fallback", error: expect.stringContaining("RESEND_FROM_EMAIL is not set") });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("RESEND_FROM_EMAIL is not set"));
    expect(logRow(db)).toMatchObject({ provider: "owner_notification", lastError: expect.stringContaining("RESEND_FROM_EMAIL") });
    expect(builderDealsEmailStatus(input.recipients).misconfiguration).toContain("RESEND_FROM_EMAIL");
  });

  it("sends one Resend message from the configured sender to every recipient and logs it", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "Lifestyle Design Realty <deals@lifestyledesignrealty.com>");
    const db = createFakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: "email_1" }));
    await expect(sendBuilderDealsEmail(input)).resolves.toEqual({ ok: true, status: "sent", deliveryLog: "resend sent" });
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(init?.body))).toEqual({ from: "Lifestyle Design Realty <deals@lifestyledesignrealty.com>", to: ["peter@lifestyledesignrealty.com", "steven@lifestyledesignrealty.com"], subject: input.subject, text: input.content });
    expect(logRow(db)).toMatchObject({ provider: "resend", deliveryStatus: "sent" });
    expect(builderDealsEmailStatus(input.recipients).provider).toBe("resend");
  });

  it("records a Resend rejection as a failed delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "deals@lifestyledesignrealty.com");
    const db = createFakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("domain not verified", { status: 403 }));
    await expect(sendBuilderDealsEmail(input)).resolves.toMatchObject({ ok: false, status: "failed", error: "Resend 403: domain not verified" });
    expect(logRow(db)).toMatchObject({ provider: "resend", deliveryStatus: "failed", deliveredAt: null });
  });
});
