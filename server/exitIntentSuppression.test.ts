import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * REGRESSION LOCK — exit-intent suppression must not key off page copy.
 *
 * The original guard did `/we typically respond within 30 minutes/i.test(
 * document.body.innerText)` to detect "this visitor already converted". That
 * exact sentence is ALSO a static selling point rendered beside the Get Started
 * form on Home and GetStarted, so the modal was suppressed on the highest
 * traffic pages and could never fire there. Verified live before the fix.
 *
 * The contract now: suppression reads an explicit `data-lead-converted` marker
 * that only post-submit success states render.
 */

const CLIENT = join(process.cwd(), "client", "src");
const read = (p: string) => readFileSync(join(CLIENT, p), "utf-8");
/** Source with comments removed, so explanatory prose can't satisfy or trip a check. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("exit-intent conversion suppression", () => {
  const modal = read("components/ExitIntentModal.tsx");

  it("does not scan page text for the confirmation sentence", () => {
    const src = code("components/ExitIntentModal.tsx");
    expect(src).not.toMatch(/innerText/);
    expect(src).not.toMatch(/respond within 30 minutes/i);
  });

  it("suppresses on an explicit converted marker instead", () => {
    expect(modal).toMatch(/data-lead-converted/);
  });

  it("keeps the mobile and once-per-session guards", () => {
    expect(modal).toMatch(/pointer:\s*coarse/);
    expect(modal).toMatch(/innerWidth\s*<\s*1024/);
    expect(modal).toMatch(/sessionStorage/);
  });

  it.each([
    ["components/GetStartedForm.tsx"],
    ["components/LeadForm.tsx"],
    ["components/RecruitForm.tsx"],
  ])("%s marks its post-submit success state as converted", (file) => {
    expect(read(file)).toMatch(/data-lead-converted/);
  });

  it("pages that only advertise the response time are NOT marked converted", () => {
    // Static selling copy must never look like a conversion to the modal.
    for (const page of ["pages/Home.tsx", "pages/GetStarted.tsx"]) {
      const src = read(page);
      expect(src).toMatch(/respond within 30 minutes/i);
      expect(src).not.toMatch(/data-lead-converted/);
    }
  });
});

/**
 * The DOM marker only exists while the confirmation is still mounted. A visitor
 * who submitted on the homepage and then clicked through to /team lost it, and
 * the nudge came back to ask someone already in the pipeline to get started.
 * Conversion is therefore also recorded for the SESSION, and the modal checks
 * both.
 */
describe("exit-intent suppression survives navigation after converting", () => {
  it.each([
    ["components/GetStartedForm.tsx"],
    ["components/LeadForm.tsx"],
    ["components/RecruitForm.tsx"],
  ])("%s records the conversion for the session", (file) => {
    const src = code(file);
    expect(src, `${file} must call markLeadCaptured() on success`).toMatch(/markLeadCaptured\(\)/);
  });

  it("the modal consults the session flag, not just the DOM marker", () => {
    const src = code("components/ExitIntentModal.tsx");
    expect(src).toMatch(/isLeadCaptured\(\)/);
  });

  it("the session flag is actually read somewhere (it was dead code before)", () => {
    const consumers = ["components/ExitIntentModal.tsx"].filter((f) =>
      /isLeadCaptured/.test(code(f))
    );
    expect(consumers.length).toBeGreaterThan(0);
  });
});

describe("leadSession flag behaviour", () => {
  const withStorage = async (store: Storage | null, fn: () => Promise<void> | void) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        if (store === null) throw new Error("storage blocked");
        return store;
      },
    });
    try {
      await fn();
    } finally {
      if (original) Object.defineProperty(globalThis, "sessionStorage", original);
      else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
  };

  const fakeStore = (): Storage => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    } as Storage;
  };

  it("reports captured only after a lead is marked", async () => {
    const { isLeadCaptured, markLeadCaptured } = await import("../client/src/lib/leadSession");
    await withStorage(fakeStore(), () => {
      expect(isLeadCaptured()).toBe(false);
      markLeadCaptured();
      expect(isLeadCaptured()).toBe(true);
    });
  });

  it("degrades silently when storage is blocked (private mode)", async () => {
    const { isLeadCaptured, markLeadCaptured } = await import("../client/src/lib/leadSession");
    await withStorage(null, () => {
      // Neither call may throw; the visitor still gets a working site.
      expect(() => markLeadCaptured()).not.toThrow();
      expect(isLeadCaptured()).toBe(false);
    });
  });
});
