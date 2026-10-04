/**
 * Every outbound FUB call carries a deadline.
 *
 * A stalled FUB connection used to hold a lead submission open with no
 * server-side limit at all; the browser gave up at 20 s, showed "try again",
 * and the retry created a duplicate contact for a lead that was already in
 * the database. These tests drive the real functions against a fetch that
 * never resolves unless its signal aborts.
 *
 * Real timers, shortened deadlines: AbortSignal.timeout() is scheduled on
 * Node's internal timer list, which vitest's fake timers do not advance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FUB_TIMEOUT, FUB_TIMEOUT_MS, sendFubNote, sendToFub, sendWebsiteInquiryToFub } from "./fub";
import { FUB_SYNC_TIMEOUT, FUB_SYNC_TIMEOUT_MS, fetchClosedStageIds } from "./statsSync";
import { NOTIFY_TIMEOUT, NOTIFY_TIMEOUT_MS, notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";

const SHORT_MS = 40;

/** A fetch that hangs forever, honouring only its abort signal. */
function hangingFetch() {
  return vi.fn((_url: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no signal → hangs forever, and the test times out
      const fail = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    });
  });
}

const savedKey = process.env.FUB_API_KEY;

beforeEach(() => {
  process.env.FUB_API_KEY = "test-key";
  FUB_TIMEOUT.ms = SHORT_MS;
  FUB_SYNC_TIMEOUT.ms = SHORT_MS;
  NOTIFY_TIMEOUT.ms = SHORT_MS;
});
afterEach(() => {
  vi.restoreAllMocks();
  FUB_TIMEOUT.ms = FUB_TIMEOUT_MS;
  FUB_SYNC_TIMEOUT.ms = FUB_SYNC_TIMEOUT_MS;
  NOTIFY_TIMEOUT.ms = NOTIFY_TIMEOUT_MS;
  if (savedKey === undefined) delete process.env.FUB_API_KEY;
  else process.env.FUB_API_KEY = savedKey;
});

const lead = {
  name: "Vitest Lead",
  email: "v@example.com",
  phone: "5551234567",
  sourceTag: "Website - Contact",
  intent: "Hot" as const,
};

describe("production deadlines", () => {
  it("are single-digit seconds, inside the browser's 20 s ceiling", () => {
    expect(FUB_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(NOTIFY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(FUB_SYNC_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});

describe("FUB calls time out instead of hanging", () => {
  it("sendToFub resolves ok:false naming the timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(hangingFetch() as never);
    const started = Date.now();
    const result = await sendToFub(lead);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });

  it("sendFubNote resolves ok:false naming the timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(hangingFetch() as never);
    const result = await sendFubNote("42", "subject", "body");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });

  it("sendWebsiteInquiryToFub resolves ok:false naming the timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(hangingFetch() as never);
    const result = await sendWebsiteInquiryToFub({ name: "A", email: "a@b.co", message: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });

  it("the stats sync's FUB reads reject on timeout rather than holding the cron open", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(hangingFetch() as never);
    await expect(fetchClosedStageIds("test-key")).rejects.toMatchObject({
      name: expect.stringMatching(/TimeoutError|AbortError/),
    });
  });

  it("does not fire the timeout on a healthy fast response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 9, person: { id: 3 } }), { status: 200 })
    );
    const result = await sendToFub(lead);
    expect(result).toMatchObject({ ok: true, fubId: "9", personId: "3" });
  });

  it("every FUB request actually carries a signal (the deadline cannot be dropped silently)", async () => {
    // A fresh Response per call: a body can only be read once.
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
    await sendToFub(lead);
    await sendFubNote("1", "s", "b");
    await sendWebsiteInquiryToFub({ name: "A", email: "a@b.co" });
    await fetchClosedStageIds("test-key");
    expect(spy).toHaveBeenCalledTimes(4);
    for (const [, init] of spy.mock.calls) {
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe("owner notification times out instead of hanging", () => {
  it("returns false after the deadline", async () => {
    const savedUrl = ENV.forgeApiUrl;
    const savedApiKey = ENV.forgeApiKey;
    ENV.forgeApiUrl = "https://forge.example";
    ENV.forgeApiKey = "k";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(hangingFetch() as never);
    try {
      expect(await notifyOwner({ title: "t", content: "c" })).toBe(false);
    } finally {
      ENV.forgeApiUrl = savedUrl;
      ENV.forgeApiKey = savedApiKey;
    }
  });
});
