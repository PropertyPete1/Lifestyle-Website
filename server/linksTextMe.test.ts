import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf-8");

/** Nov 3, 2026 (Peter: "make our social links text them too"): /links asks a first name, a number and the interest pick. */
describe("/links: drop your number, we text you", () => {
  it("the links capture is the text-me form with the interest pick kept (it routes recruits and sellers)", () => {
    const links = read("client/src/pages/Links.tsx");
    expect(links).toContain('submitLabel="Text me"');
    expect(links).toMatch(/compact\s+textMe/);
    expect(links).toContain('options: ["Buying", "Selling", "Leasing", "Joining the team"]');
    expect(links).toContain("drop your number and we'll text you");
  });

  it("the text-me form hides email and the checkbox, keeps the consent sentence, and notes the ask in FUB", () => {
    const form = read("client/src/components/LeadForm.tsx");
    expect(form).toContain('data-lead-text-me={textMe ? "true" : undefined}');
    expect(form).toContain("{!textMe && <div className=\"space-y-1.5\">");
    expect(form).toContain("if (!consent && !textMe) {");
    expect(form).toContain('...(textMe ? { textMe: "Yes - asked to be texted from the website" } : {})');
    expect(form).toContain("We'll text you in the next few minutes");
    // every other LeadForm on the site is unchanged: the checkbox and email box stay by default
    expect(form).toContain("{!textMe && <div className=\"flex items-start gap-3 pt-1\">");
    for (const page of ["CityFinder", "Contact", "Valuation", "Sell", "Lease", "Team"]) expect(read(`client/src/pages/${page}.tsx`)).not.toContain("textMe");
  });
});
