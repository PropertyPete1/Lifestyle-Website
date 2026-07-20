import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the lead submission pipeline:
 * 1. Successful path — lead stored, FUB synced, status updated to "synced".
 * 2. FUB failure path — lead still stored, status updated to "failed",
 *    owner notified; the mutation still succeeds (no lead is ever lost).
 */

const createLead = vi.fn(async () => 42);
const updateLead = vi.fn(async () => {});

vi.mock("./db", () => ({
  createLead: (...args: unknown[]) => createLead(...args),
  updateLead: (...args: unknown[]) => updateLead(...args),
}));

const sendToFub = vi.fn();
vi.mock("./fub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fub")>();
  return {
    ...actual,
    sendToFub: (...args: unknown[]) => sendToFub(...args),
  };
});

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(async () => true),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function publicCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const baseInput = {
  name: "Vitest Lead",
  email: "vitest@example.com",
  phone: "(555) 111-2222",
  sourceTag: "Website - Contact" as const,
  tcpaConsent: true as const,
  answers: { timeline: "ASAP" },
};

beforeEach(() => {
  createLead.mockClear();
  updateLead.mockClear();
  sendToFub.mockReset();
});

describe("leads.submit", () => {
  it("stores the lead and marks it synced when FUB succeeds", async () => {
    sendToFub.mockResolvedValue({ ok: true, fubId: "123" });
    const caller = appRouter.createCaller(publicCtx());

    const result = await caller.leads.submit(baseInput);

    expect(result.success).toBe(true);
    expect(result.intent).toBe("Hot");
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(createLead.mock.calls[0]?.[0]).toMatchObject({
      name: "Vitest Lead",
      sourceTag: "Website - Contact",
      intent: "Hot",
      tcpaConsent: true,
      fubStatus: "pending",
    });
    expect(updateLead).toHaveBeenCalledWith(42, { fubStatus: "synced", fubId: "123" });
  });

  it("keeps the lead with failed status when FUB is unavailable", async () => {
    sendToFub.mockResolvedValue({ ok: false, error: "FUB down" });
    const caller = appRouter.createCaller(publicCtx());

    const result = await caller.leads.submit(baseInput);

    // Submission still succeeds for the visitor; lead is preserved locally.
    expect(result.success).toBe(true);
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(updateLead).toHaveBeenCalledWith(42, { fubStatus: "failed", fubId: undefined });
  });

  it("rejects submissions without TCPA consent", async () => {
    const caller = appRouter.createCaller(publicCtx());
    await expect(
      caller.leads.submit({ ...baseInput, tcpaConsent: false as unknown as true })
    ).rejects.toThrow();
    expect(createLead).not.toHaveBeenCalled();
  });
});
