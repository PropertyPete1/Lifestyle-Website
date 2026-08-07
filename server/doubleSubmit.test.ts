/**
 * ONE LEAD PER SUBMISSION.
 *
 * Every lead form disables its submit button while the mutation is in flight,
 * and that absorbs real double-taps: measured live against production, a
 * synchronous 3-click burst, an 80ms double-click, a 250ms double-click, and an
 * Enter keypress while pending each produced exactly one POST.
 *
 * But that made the invariant a property of a DOM attribute rather than of the
 * send function — anything that reaches `doSubmit` another way (a dispatched
 * submit event, a future caller, the failure banner's "Try again") bypassed it.
 * A duplicate here is a duplicate contact in Follow Up Boss, so the in-flight
 * check is pinned at the send.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const CLIENT = join(process.cwd(), "client", "src");
/** Source with comments stripped, so prose can't satisfy a check. */
const code = (p: string) =>
  readFileSync(join(CLIENT, p), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const FORMS = [
  "components/LeadForm.tsx",
  "components/GetStartedForm.tsx",
  "components/RecruitForm.tsx",
  "components/WebsiteInquiryModal.tsx",
];

describe("double-submit protection", () => {
  it.each(FORMS)("%s refuses to send while a submit is in flight", (file) => {
    const src = code(file);
    expect(
      src,
      `${file}: doSubmit must start with an in-flight guard`
    ).toMatch(/const doSubmit = \(\) => \{\s*if \(submit\.isPending\) return;/);
  });

  it.each(FORMS)("%s also keeps the disabled-button guard", (file) => {
    const src = code(file);
    expect(src).toMatch(/submit\.isPending/);
    // The button must still visibly disable — the guard is defence in depth,
    // not a replacement for the affordance.
    expect(src).toMatch(/disabled=\{(submit\.isPending|!canSubmit)\}/);
  });

  it("the retry path in the failure banner goes through the same guard", () => {
    for (const file of FORMS) {
      const src = code(file);
      if (!/FormError/.test(src)) continue;
      // Retry must call doSubmit (guarded), never submit.mutate directly.
      expect(src, `${file}: retry must reuse doSubmit`).toMatch(/onRetry=\{doSubmit\}/);
    }
  });

  it("no form calls submit.mutate outside its guarded doSubmit", () => {
    for (const file of FORMS) {
      const src = code(file);
      const mutateCalls = src.match(/submit\.mutate\(/g) ?? [];
      expect(mutateCalls.length, `${file} should send from exactly one place`).toBe(1);
    }
  });
});
