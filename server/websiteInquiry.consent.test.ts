import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The website-design inquiry collects a phone number and creates a CRM contact
 * we then call/text, so it carries the same TCPA consent requirement as every
 * other lead form. Consent must be *collected*, never assumed by the server.
 */

const createLead = vi.fn(async () => 7);
const updateLead = vi.fn(async () => {});

vi.mock("./db", () => ({
  createLead: (...args: unknown[]) => createLead(...args),
  updateLead: (...args: unknown[]) => updateLead(...args),
}));

vi.mock("./fub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fub")>();
  return { ...actual, sendWebsiteInquiryToFub: vi.fn(async () => ({ ok: true, fubId: "1" })) };
});

vi.mock("./inquiryEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inquiryEmail")>();
  return { ...actual, emailWebsiteInquiryCopy: vi.fn(async () => ({ ok: true as const })) };
});

vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn(async () => true) }));

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
  name: "Jane Business",
  email: "jane@example.com",
  phone: "(555) 123-4567",
  business: "Jane's Bakery",
  message: "I'd love a website like yours.",
  tcpaConsent: true as const,
};

beforeEach(() => {
  createLead.mockClear();
  updateLead.mockClear();
});

describe("websiteInquiry.submit — TCPA consent", () => {
  it("accepts a submission that includes consent", async () => {
    const caller = appRouter.createCaller(publicCtx());
    const res = await caller.websiteInquiry.submit(baseInput);
    expect(res.success).toBe(true);
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(createLead.mock.calls[0]?.[0]).toMatchObject({ tcpaConsent: true });
  });

  it("rejects a submission without consent — and stores nothing", async () => {
    const caller = appRouter.createCaller(publicCtx());
    await expect(
      caller.websiteInquiry.submit({ ...baseInput, tcpaConsent: false as unknown as true })
    ).rejects.toThrow();
    expect(createLead).not.toHaveBeenCalled();
  });

  it("rejects a submission that omits the consent field entirely", async () => {
    const caller = appRouter.createCaller(publicCtx());
    const { tcpaConsent: _omitted, ...withoutConsent } = baseInput;
    await expect(
      caller.websiteInquiry.submit(withoutConsent as typeof baseInput)
    ).rejects.toThrow();
    expect(createLead).not.toHaveBeenCalled();
  });
});
