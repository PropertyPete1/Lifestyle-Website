/**
 * Regression guard for a bug that was LIVE: the lead-form submit timeout never
 * fired.
 *
 * client/src/main.tsx wrapped fetch with
 *     signal: init?.signal ?? AbortSignal.timeout(20_000)
 * which reads as "use the caller's signal if there is one, otherwise time out".
 * But tRPC's httpBatchLink ALWAYS passes a signal (it races the caller's signal
 * against its own cancellation controller), so `init.signal` was never nullish,
 * the `??` always took tRPC's signal, and the 20s deadline was constructed and
 * discarded on every single request.
 *
 * The visitor-facing consequence: a hung submit left the button spinning
 * "Submitting..." forever — no error banner, no "Try again", no tap-to-call
 * fallback. The lead was silently lost while the visitor believed it sent.
 *
 * The first test drives the REAL @trpc/client against a server that accepts the
 * connection and never responds, which is the only way to catch this class of
 * bug: every unit test of the error-formatting path passed while the abort that
 * triggers it could never happen.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUEST_TIMEOUT_MS, withTimeout } from "../shared/requestTimeout";
import { humanizeSubmitError, NETWORK_SUBMIT_ERROR } from "../shared/formErrors";

/** Shortened from the production 20s so the suite stays fast; logic is identical. */
const TEST_TIMEOUT_MS = 300;

let server: http.Server;
let port = 0;

beforeAll(async () => {
  // Accepts the request, then never responds — a hung backend.
  server = http.createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("submit timeout fires through the real tRPC client", () => {
  it("aborts a hung request instead of hanging forever", async () => {
    let sawSignal = false;
    const client = createTRPCClient<never>({
      links: [
        httpBatchLink({
          url: `http://127.0.0.1:${port}/api/trpc`,
          // The exact wrapper shape used in client/src/main.tsx.
          fetch(input, init) {
            sawSignal = !!init?.signal;
            return globalThis.fetch(input as string, {
              ...(init ?? {}),
              signal: withTimeout(init?.signal, TEST_TIMEOUT_MS),
            });
          },
        }),
      ],
    });

    const started = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((client as any).leads.submit.mutate({ name: "x" })).rejects.toThrow();
    const elapsed = Date.now() - started;

    // The precondition that made the old code wrong: tRPC always supplies one.
    expect(sawSignal, "httpBatchLink always passes its own signal").toBe(true);
    // And the deadline still wins, well inside a multiple of the budget.
    expect(elapsed).toBeLessThan(TEST_TIMEOUT_MS * 10);
  });

  it("the old `??` pattern would NOT have timed out (documents the bug)", async () => {
    const trpcSignal = new AbortController().signal;
    // Old code: caller signal present → timeout discarded entirely.
    expect(trpcSignal ?? AbortSignal.timeout(TEST_TIMEOUT_MS)).toBe(trpcSignal);
    // New code: both can abort.
    const combined = withTimeout(trpcSignal, TEST_TIMEOUT_MS);
    expect(combined).not.toBe(trpcSignal);
    await new Promise((r) => setTimeout(r, TEST_TIMEOUT_MS * 2));
    expect(combined.aborted, "combined signal must abort on the deadline").toBe(true);
  });
});

/**
 * The wrapper sits on EVERY request the site makes, so the failure mode that
 * matters most is not "the timeout doesn't fire" but "normal traffic broke".
 */
describe("normal traffic is unaffected", () => {
  it("completes a successful round-trip and does not abort early", async () => {
    const ok = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ result: { data: { ok: true } } }]));
      });
    });
    await new Promise<void>((resolve) => ok.listen(0, resolve));
    const okPort = (ok.address() as AddressInfo).port;

    let combined = false;
    const client = createTRPCClient<never>({
      links: [
        httpBatchLink({
          url: `http://127.0.0.1:${okPort}/api/trpc`,
          fetch(input, init) {
            const signal = withTimeout(init?.signal, REQUEST_TIMEOUT_MS);
            combined = signal !== init?.signal;
            return globalThis.fetch(input as string, { ...(init ?? {}), signal });
          },
        }),
      ],
    });

    try {
      // A run of sequential requests: nothing may abort, and the per-request
      // timeout must not accumulate or fire on a healthy server.
      for (let i = 0; i < 25; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect((client as any).health.check.query()).resolves.toBeDefined();
      }
      expect(combined, "must be using the combined signal, not tRPC's raw one").toBe(true);
    } finally {
      await new Promise<void>((resolve) => ok.close(() => resolve()));
    }
  });
});

describe("withTimeout", () => {
  it("times out when there is no caller signal", async () => {
    const s = withTimeout(undefined, 50);
    await new Promise((r) => setTimeout(r, 120));
    expect(s.aborted).toBe(true);
  });

  it("still lets the caller's own abort win (React Query cancellation)", () => {
    const ac = new AbortController();
    const s = withTimeout(ac.signal, 10_000);
    ac.abort();
    expect(s.aborted).toBe(true);
  });

  it("passes through a signal that already aborted", () => {
    const ac = new AbortController();
    ac.abort();
    expect(withTimeout(ac.signal, 10_000).aborted).toBe(true);
  });

  it("works without AbortSignal.any (Safari < 17.4 ponyfill path)", async () => {
    const original = (AbortSignal as unknown as { any?: unknown }).any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (AbortSignal as any).any;
    try {
      const ac = new AbortController();
      const s = withTimeout(ac.signal, 50);
      expect(s.aborted).toBe(false);
      await new Promise((r) => setTimeout(r, 120));
      expect(s.aborted, "ponyfill must still honour the deadline").toBe(true);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (original !== undefined) (AbortSignal as any).any = original;
    }
  });

  it("production budget stays at the documented 20 seconds", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(20_000);
  });
});

describe("a timed-out submit reaches the visitor as an actionable message", () => {
  it("maps the abort to the connection error, with the phone fallback", () => {
    // What the abort actually surfaces as through tRPC.
    for (const raw of ["The operation was aborted due to timeout", "signal is aborted without reason"]) {
      expect(humanizeSubmitError(raw)).toBe(NETWORK_SUBMIT_ERROR);
    }
    expect(NETWORK_SUBMIT_ERROR).toMatch(/\(210\) 981-3830/);
  });
});
