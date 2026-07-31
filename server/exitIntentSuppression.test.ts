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
